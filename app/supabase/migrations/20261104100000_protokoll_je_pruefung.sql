-- Protokoll je Prüfung: Änderungen in einer Revision festhalten, damit das Protokoll der Revision sie auflisten kann.
-- Erfasst wird nur, solange eine wieder geöffnete Prüfung (ohne Session, Revision > 0) läuft – sonst entsteht kein Eintrag.

create table anlagenpruefung_aenderung (
  id uuid primary key default gen_random_uuid(),
  anlagenpruefung_id uuid not null references anlagenpruefung (id) on delete cascade,
  revision int not null,
  tabelle text not null,
  datensatz_id uuid not null,
  aktion text not null check (aktion in ('INSERT', 'UPDATE', 'DELETE')),
  alt jsonb,
  neu jsonb,
  von uuid default auth.uid(),
  am timestamptz not null default now()
);
create index on anlagenpruefung_aenderung (anlagenpruefung_id, revision, am);
comment on table anlagenpruefung_aenderung is 'Änderungen an Antworten, Elementen, Mängeln, Fotos und Ergebnis während einer Revision (für das Protokoll)';
alter table anlagenpruefung_aenderung enable row level security;
create policy anlagenpruefung_aenderung_lesen on anlagenpruefung_aenderung for select to authenticated using (ist_aktiv());
create policy zwei_faktor on anlagenpruefung_aenderung as restrictive for all to authenticated
  using ((select zwei_faktor_erfuellt())) with check ((select zwei_faktor_erfuellt()));
revoke insert, update, delete on anlagenpruefung_aenderung from authenticated;

insert into log_bezeichnung (tabelle, spalte, text) values
  ('anlagenpruefung_aenderung', '', 'Änderung in einer Revision')
on conflict do nothing;
select log_ueberwachen('anlagenpruefung_aenderung');

create function revision_aenderung() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  zeile jsonb := to_jsonb(coalesce(new, old));
  kandidaten uuid[];
  pid uuid;
  rev int;
  ohne constant text[] := array['geaendert_am', 'erstellt_am', 'erfasst_von'];
begin
  -- Wiederherstellen und interne Aufräumarbeiten sind keine Änderungen der Prüfer
  if coalesce(current_setting('session.revision', true), '') = 'ja'
     or coalesce(current_setting('anlagenpruefung.intern', true), '') = 'ja'
     or (tg_op = 'UPDATE' and (to_jsonb(new) - ohne) = (to_jsonb(old) - ohne)) then
    return coalesce(new, old);
  end if;
  kandidaten := case tg_table_name
    -- Mängel: neu festgestellte (entdeckt_in) und frühere, die in dieser Prüfung bewertet werden (nachgeprueft_in)
    when 'mangel' then array[(zeile ->> 'entdeckt_in')::uuid, (to_jsonb(new) ->> 'nachgeprueft_in')::uuid, (to_jsonb(old) ->> 'nachgeprueft_in')::uuid]
    when 'foto' then array[foto_pruefung((zeile ->> 'bezug_typ')::foto_bezug, (zeile ->> 'bezug_id')::uuid)]
    else array[(zeile ->> 'anlagenpruefung_id')::uuid] end;
  for pid in select distinct k from unnest(kandidaten) k where k is not null loop
    select revision into rev from anlagenpruefung
     where id = pid and session_id is null and revision > 0 and status = 'in_pruefung';
    if found then
      insert into anlagenpruefung_aenderung (anlagenpruefung_id, revision, tabelle, datensatz_id, aktion, alt, neu)
      values (pid, rev, tg_table_name, (zeile ->> 'id')::uuid, tg_op,
              case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
    end if;
  end loop;
  return coalesce(new, old);
end $$;
create trigger antwort_revision_aenderung after insert or update or delete on antwort
  for each row execute function revision_aenderung();
create trigger element_ergebnis_revision_aenderung after insert or update or delete on element_ergebnis
  for each row execute function revision_aenderung();
create trigger mangel_revision_aenderung after insert or update or delete on mangel
  for each row execute function revision_aenderung();
-- Fotos vor dem Löschen: der Bezug (Antwort bzw. Mangel) ist dann sicher noch auffindbar
create trigger foto_revision_aenderung after insert or update on foto
  for each row execute function revision_aenderung();
create trigger foto_revision_loeschen before delete on foto
  for each row execute function revision_aenderung();

-- Ergebnis einer Prüfung in einer Revision geändert
create function revision_ergebnis() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.session_id is null and new.revision > 0
     and (new.ergebnis, new.ergebnis_begruendung) is distinct from (old.ergebnis, old.ergebnis_begruendung)
     and coalesce(current_setting('session.revision', true), '') <> 'ja' then
    insert into anlagenpruefung_aenderung (anlagenpruefung_id, revision, tabelle, datensatz_id, aktion, alt, neu)
    values (new.id, new.revision, 'anlagenpruefung', new.id, 'UPDATE',
            jsonb_build_object('ergebnis', old.ergebnis, 'ergebnis_begruendung', old.ergebnis_begruendung),
            jsonb_build_object('ergebnis', new.ergebnis, 'ergebnis_begruendung', new.ergebnis_begruendung));
  end if;
  return null;
end $$;
create trigger anlagenpruefung_revision_ergebnis after update on anlagenpruefung
  for each row execute function revision_ergebnis();

-- Datensicherung: auch die Änderungen der Revisionen wiederherstellen
create or replace function admin_wiederherstellen(p_tabelle text, p_zeilen jsonb) returns jsonb
language plpgsql security definer set search_path = public as $function$
declare
  erlaubt constant text[] := array['benutzer', 'firma', 'erscheinungsbild', 'anlagenart', 'benutzer_sachkunde', 'endkunde', 'objekt', 'checkliste', 'checkliste_version',
    'anlagentyp', 'pruefart', 'etikett', 'anlage', 'anlage_faelligkeit', 'anlage_element', 'session', 'session_revision',
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
