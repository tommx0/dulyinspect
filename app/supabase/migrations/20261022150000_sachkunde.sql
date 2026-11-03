-- Version 2.4.0, Phase 5 aus docs/KONZEPT-ANLAGEN.md: Sachkunde je Benutzer und Anlagenart.
-- 1. Nachweis und Ablaufdatum je Benutzer und Art (bisheriger Sachkunde-Hinweis wird zur Sachkunde für Türen)
-- 2. Je Art einstellbar: Prüfen nur mit gültiger Sachkunde (Standard aus – Türkunden merken nichts)
-- 3. Prüfung einer Art beginnt nur, wer dafür eine gültige Sachkunde hat (wenn eingeschaltet)

create table benutzer_sachkunde (
  benutzer_id uuid not null references benutzer (id) on delete cascade,
  anlagenart text not null references anlagenart (schluessel),
  nachweis text not null check (length(trim(nachweis)) between 1 and 300),
  gueltig_bis date,
  geaendert_am timestamptz not null default now(),
  primary key (benutzer_id, anlagenart)
);
comment on table benutzer_sachkunde is 'Sachkunde eines Prüfers je Anlagenart: Nachweis (erscheint im Protokoll) und Ablaufdatum (leer = unbefristet)';
create trigger benutzer_sachkunde_geaendert_am before update on benutzer_sachkunde for each row execute function setze_geaendert_am();
create trigger benutzer_sachkunde_audit after insert or update or delete on benutzer_sachkunde for each row execute function audit();
alter table benutzer_sachkunde enable row level security;
-- Lesen alle aktiven (Protokolle nennen die Sachkunde der Kollegen), pflegen nur Admins (wie die Benutzerverwaltung)
create policy benutzer_sachkunde_lesen on benutzer_sachkunde for select to authenticated using (ist_aktiv());
create policy benutzer_sachkunde_admin on benutzer_sachkunde for all to authenticated using (ist_systemadmin()) with check (ist_systemadmin());

insert into benutzer_sachkunde (benutzer_id, anlagenart, nachweis)
  select id, 'tuer', trim(sachkunde_hinweis) from benutzer where nullif(trim(sachkunde_hinweis), '') is not null;

alter table anlagenart add column sachkunde_pflicht boolean not null default false;
comment on column anlagenart.sachkunde_pflicht is 'Prüfungen dieser Art nur mit gültiger Sachkunde des Prüfers';

create function hat_sachkunde(p_benutzer uuid, p_art text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from benutzer_sachkunde
                  where benutzer_id = p_benutzer and anlagenart = p_art and (gueltig_bis is null or gueltig_bis >= current_date));
$$;
revoke all on function hat_sachkunde(uuid, text) from public, anon;
grant execute on function hat_sachkunde(uuid, text) to authenticated, service_role;

-- Prüfung beginnen: Sachkunde prüfen (Funktion sonst unverändert)
CREATE OR REPLACE FUNCTION public.anlagenpruefung_vor_einfuegen()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  vorhanden uuid;
  art text;
  art_name text;
  pflicht boolean;
begin
  if new.pruefart_id is null then
    select p.id into new.pruefart_id from pruefart p join anlage a on a.anlagentyp_id = p.anlagentyp_id
     where a.id = new.anlage_id and p.aktiv order by p.reihenfolge, p.name limit 1;
    if new.pruefart_id is null then
      raise exception 'Für diesen Typ ist keine Prüfart angelegt. Admin: unter „Typen“ eine Prüfart ergänzen.';
    end if;
  elsif coalesce(current_setting('session.revision', true), '') <> 'ja' and not exists (
      select 1 from pruefart p join anlage a on a.anlagentyp_id = p.anlagentyp_id where a.id = new.anlage_id and p.id = new.pruefart_id) then
    raise exception 'Die Prüfart passt nicht zum Typ der Anlage';
  end if;
  -- Sachkunde: nur wenn für die Art eingeschaltet; „nicht geprüft“ vermerkt die Sessionleitung ohne Prüfung
  if new.status <> 'nicht_geprueft' and coalesce(current_setting('session.revision', true), '') <> 'ja' then
    select ty.anlagenart, ar.name, ar.sachkunde_pflicht into art, art_name, pflicht
      from anlage a join anlagentyp ty on ty.id = a.anlagentyp_id join anlagenart ar on ar.schluessel = ty.anlagenart
     where a.id = new.anlage_id;
    if pflicht and not hat_sachkunde(new.pruefer_id, art) then
      raise exception 'Für % ist bei Ihnen keine gültige Sachkunde hinterlegt. Admin: unter „Benutzer“ eintragen.', art_name;
    end if;
  end if;
  if new.status <> 'duplikat' then
    select id into vorhanden from anlagenpruefung
     where session_id = new.session_id and anlage_id = new.anlage_id and status <> 'duplikat' and id <> new.id
     limit 1;
    if vorhanden is not null then
      new.status := 'duplikat';
      new.duplikat_von := vorhanden;
      new.duplikat_geklaert := false;
    end if;
  end if;
  return new;
end $function$;

-- Datensicherung kennt die neue Tabelle
CREATE OR REPLACE FUNCTION public.admin_wiederherstellen(p_tabelle text, p_zeilen jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  erlaubt constant text[] := array['benutzer', 'firma', 'erscheinungsbild', 'anlagenart', 'benutzer_sachkunde', 'endkunde', 'objekt', 'checkliste', 'checkliste_version',
    'anlagentyp', 'pruefart', 'etikett', 'anlage', 'anlage_faelligkeit', 'anlage_element', 'session', 'session_revision',
    'session_teilnehmer', 'anlagenpruefung', 'antwort', 'mangel', 'element_ergebnis', 'foto', 'protokoll', 'protokoll_zaehler'];
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

notify pgrst, 'reload schema';
