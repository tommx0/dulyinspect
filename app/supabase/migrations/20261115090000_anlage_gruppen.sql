-- Version 2.63.0: Gruppen der Elemente vorab anlegen (Wohnung / Bereich, Stromkreis, Meldergruppe …).
-- Die Elemente speichern ihre Gruppe weiter als Text (anlage_element.gruppe). anlage_gruppe ist die Liste der Gruppen einer
-- Anlage, aus der die App beim Erfassen die Auswahl bildet. Jede Gruppe, die ein Element verwendet, steht automatisch in der
-- Liste – egal ob das Element einzeln, per Import, per Scan, offline oder bei einer Wiederherstellung entsteht.
-- Umbenennen ändert die Gruppe aller Elemente darin mit; löschen lässt sich eine Gruppe nur ohne aktive Elemente.

create table anlage_gruppe (
  id uuid primary key default gen_random_uuid(),
  anlage_id uuid not null references anlage (id) on delete cascade,
  -- wie anlage_element.gruppe, damit jede verwendete Gruppe in die Liste passt
  name text not null check (length(trim(name)) between 1 and 40),
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  erstellt_von uuid references benutzer (id) default auth.uid()
);
-- Gleiche Schreibweise wie in anlage_element (dessen Nummern-Index unterscheidet ebenfalls Groß-/Kleinschreibung)
create unique index anlage_gruppe_name on anlage_gruppe (anlage_id, name);
comment on table anlage_gruppe is 'Gruppe der Elemente einer Anlage, z. B. Wohnung / Bereich bei Rauchwarnmeldern; vorab anlegbar, Auswahl beim Erfassen';

alter table anlage_gruppe enable row level security;
-- Wie bei den Elementen: alle aktiven Benutzer lesen, anlegen und umbenennen (auch vor Ort), löschen nur Admin/Planer
create policy anlage_gruppe_lesen on anlage_gruppe for select to authenticated using (ist_aktiv());
create policy anlage_gruppe_anlegen on anlage_gruppe for insert to authenticated with check (ist_aktiv());
create policy anlage_gruppe_aendern on anlage_gruppe for update to authenticated using (ist_aktiv()) with check (ist_aktiv());
create policy anlage_gruppe_loeschen on anlage_gruppe for delete to authenticated using (ist_admin());
create policy zwei_faktor on anlage_gruppe as restrictive for all to authenticated
  using ((select zwei_faktor_erfuellt())) with check ((select zwei_faktor_erfuellt()));

-- ---------------------------------------------------------------------------
-- Verwendete Gruppen in die Liste
-- ---------------------------------------------------------------------------
create function anlage_gruppe_aus_elementen() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into anlage_gruppe (anlage_id, name)
  select distinct anlage_id, gruppe from neu where gruppe is not null
  on conflict do nothing;
  return null;
end $$;
create trigger anlage_element_gruppe_einfuegen after insert on anlage_element
  referencing new table as neu for each statement execute function anlage_gruppe_aus_elementen();
create trigger anlage_element_gruppe_aendern after update on anlage_element
  referencing new table as neu for each statement execute function anlage_gruppe_aus_elementen();

-- Bisherige Gruppen mit aktiven Elementen übernehmen (Gruppen nur stillgelegter Elemente nicht; sie kämen beim nächsten
-- Ändern eines solchen Elements wieder in die Liste)
insert into anlage_gruppe (anlage_id, name, erstellt_am, erstellt_von)
select anlage_id, gruppe, min(erstellt_am), null from anlage_element where gruppe is not null and aktiv group by anlage_id, gruppe
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Umbenennen und Löschen
-- ---------------------------------------------------------------------------
create function anlage_gruppe_pruefen() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.anlage_id <> old.anlage_id then raise exception 'Eine Gruppe bleibt bei ihrer Anlage'; end if;
    return new;
  end if;
  -- Mit der Anlage (Kaskade) und beim Löschen aller Kundendaten immer
  if not exists (select 1 from anlage where id = old.anlage_id) then return old; end if;
  if exists (select 1 from anlage_element where anlage_id = old.anlage_id and gruppe = old.name and aktiv) then
    raise exception '„%“ enthält noch aktive Elemente und kann nicht gelöscht werden', old.name using errcode = '23503';
  end if;
  return old;
end $$;
create trigger anlage_gruppe_pruefen before update or delete on anlage_gruppe for each row execute function anlage_gruppe_pruefen();

-- Neuer Name: die Elemente der Gruppe (auch stillgelegte) ziehen mit. Den neuen Namen gibt es in der Liste schon,
-- daher legt anlage_gruppe_aus_elementen keine zweite Gruppe an.
create function anlage_gruppe_umbenannt() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update anlage_element set gruppe = new.name where anlage_id = new.anlage_id and gruppe = old.name;
  return null;
end $$;
create trigger anlage_gruppe_umbenennen after update of name on anlage_gruppe
  for each row when (new.name is distinct from old.name) execute function anlage_gruppe_umbenannt();

create trigger anlage_gruppe_geaendert_am before update on anlage_gruppe for each row execute function setze_geaendert_am();
create trigger anlage_gruppe_audit after insert or update or delete on anlage_gruppe for each row execute function audit();
select log_ueberwachen('anlage_gruppe');
insert into log_bezeichnung (tabelle, spalte, text) values
  ('anlage_gruppe', '', 'Gruppe der Elemente'),
  ('anlage_gruppe', 'name', 'Name')
  on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Datensicherung: Gruppen werden mitgesichert und zurückgespielt (vor den Elementen)
-- ---------------------------------------------------------------------------
create or replace function admin_wiederherstellen(p_tabelle text, p_zeilen jsonb) returns jsonb
language plpgsql security definer set search_path = public as $function$
declare
  erlaubt constant text[] := array['benutzer', 'firma', 'erscheinungsbild', 'anlagenart', 'benutzer_sachkunde', 'endkunde', 'objekt', 'checkliste', 'checkliste_version',
    'anlagentyp', 'pruefart', 'etikett', 'anlage', 'anlage_faelligkeit', 'anlage_gruppe', 'anlage_element', 'session', 'session_revision',
    'session_teilnehmer', 'anlagenpruefung', 'anlagenpruefung_mitpruefer', 'anlagenpruefung_revision', 'anlagenpruefung_aenderung', 'antwort', 'mangel',
    'element_ergebnis', 'foto', 'protokoll', 'protokoll_zaehler'];
  zeile jsonb;
  spalten text;
  n int;
  eingefuegt int := 0;
  vorhanden int := 0;
  fehler text[] := '{}';
  neu_angelegt boolean;
begin
  if not ist_systemadmin() then raise exception 'Nur Admins dürfen wiederherstellen'; end if;
  if not (p_tabelle = any (erlaubt)) then raise exception 'Tabelle % kann nicht wiederhergestellt werden', p_tabelle; end if;
  if jsonb_typeof(p_zeilen) <> 'array' then raise exception 'Zeilen müssen ein Array sein'; end if;

  -- Schutzregeln für abgeschlossene Prüfungen gelten beim Wiederherstellen nicht (nur in dieser Transaktion)
  perform set_config('session.revision', 'ja', true);

  for zeile in select * from jsonb_array_elements(p_zeilen) loop
    begin
      if p_tabelle = 'benutzer' then
        -- Zugang anlegen, falls er fehlt (ohne Passwort – Admin vergibt danach ein neues)
        neu_angelegt := false;
        if not exists (select 1 from auth.users where id = (zeile ->> 'id')::uuid) then
          if exists (select 1 from auth.users where lower(email) = lower(zeile ->> 'email')) then
            raise exception 'E-Mail % gehört bereits einem anderen Zugang', zeile ->> 'email';
          end if;
          insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                                  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                                  confirmation_token, recovery_token, email_change_token_new, email_change)
          values ('00000000-0000-0000-0000-000000000000', (zeile ->> 'id')::uuid, 'authenticated', 'authenticated',
                  zeile ->> 'email', '', now(),
                  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'rolle', zeile ->> 'rolle'),
                  jsonb_build_object('name', zeile ->> 'name'), now(), now(), '', '', '', '');
          insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
          values (zeile ->> 'id', (zeile ->> 'id')::uuid,
                  jsonb_build_object('sub', zeile ->> 'id', 'email', zeile ->> 'email'), 'email', now(), now())
          on conflict (provider_id, provider) do update set user_id = excluded.user_id, identity_data = excluded.identity_data;
          neu_angelegt := true;
        end if;
        if neu_angelegt then
          update benutzer set name = coalesce(zeile ->> 'name', name), sachkunde_hinweis = zeile ->> 'sachkunde_hinweis',
                 aktiv = coalesce((zeile ->> 'aktiv')::boolean, true)
           where id = (zeile ->> 'id')::uuid;
          eingefuegt := eingefuegt + 1;
        else
          vorhanden := vorhanden + 1;
        end if;
        continue;
      end if;

      if p_tabelle = 'protokoll_zaehler' then
        insert into protokoll_zaehler (jahr, letzte) values ((zeile ->> 'jahr')::int, (zeile ->> 'letzte')::int)
          on conflict (jahr) do update set letzte = greatest(protokoll_zaehler.letzte, excluded.letzte);
        eingefuegt := eingefuegt + 1;
        continue;
      end if;

      -- Etiketten zuerst ohne Tür; die Zuordnung setzt der Trigger beim Wiederherstellen der Tür
      if p_tabelle = 'etikett' then zeile := zeile || '{"anlage_id": null, "zugeordnet_am": null}'::jsonb; end if;

      -- Nur Spalten übernehmen, die im Backup UND in der Tabelle vorkommen (Standardwerte bleiben sonst erhalten)
      select string_agg(quote_ident(k), ', ') into spalten
        from jsonb_object_keys(zeile) k
       where exists (select 1 from information_schema.columns c
                      where c.table_schema = 'public' and c.table_name = p_tabelle and c.column_name = k
                        and c.is_generated = 'NEVER' and c.identity_generation is null);
      begin
        execute format('insert into %I (%s) select %s from jsonb_populate_record(null::%I, $1) on conflict do nothing',
                       p_tabelle, spalten, spalten, p_tabelle) using zeile;
      exception when unique_violation then
        -- Alte freigegebene Checklisten-Version, obwohl heute eine neuere freigegeben ist → als archiviert ergänzen
        if p_tabelle = 'checkliste_version' and zeile ->> 'status' = 'freigegeben' then
          zeile := zeile || '{"status": "archiviert"}'::jsonb;
          execute format('insert into %I (%s) select %s from jsonb_populate_record(null::%I, $1) on conflict do nothing',
                         p_tabelle, spalten, spalten, p_tabelle) using zeile;
        else
          raise;
        end if;
      end;
      get diagnostics n = row_count;
      if n > 0 then eingefuegt := eingefuegt + 1; else vorhanden := vorhanden + 1; end if;
    exception when others then
      if array_length(fehler, 1) is null or array_length(fehler, 1) < 20 then
        fehler := fehler || format('%s %s: %s', p_tabelle, coalesce(zeile ->> 'id', ''), sqlerrm);
      end if;
    end;
  end loop;

  return jsonb_build_object('eingefuegt', eingefuegt, 'vorhanden', vorhanden,
                            'fehlgeschlagen', jsonb_array_length(p_zeilen) - eingefuegt - vorhanden, 'fehler', to_jsonb(fehler));
end $function$;
