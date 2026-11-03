-- Blaupause für mehrere Kunden:
-- 1. schema_stand(): die App prüft beim Start, ob die Datenbank zu ihr passt.
-- 2. Erscheinungsbild (App-Name, Farben, Logo) je Instanz, vom Admin in der App gepflegt, ohne Anmeldung lesbar.

create function schema_stand() returns text
language sql stable security definer set search_path = public as $$
  select max(version) from supabase_migrations.schema_migrations;
$$;
revoke all on function schema_stand() from public;
grant execute on function schema_stand() to anon, authenticated;

create table erscheinungsbild (
  id int primary key default 1 check (id = 1),
  app_name text check (app_name is null or length(trim(app_name)) between 1 and 40),
  farbe_marke text check (farbe_marke is null or farbe_marke ~ '^#[0-9a-f]{6}$'),
  farbe_akzent text check (farbe_akzent is null or farbe_akzent ~ '^#[0-9a-f]{6}$'),
  logo_pfad text,      -- Logo für die App (SVG, PNG, JPEG oder WebP) im Bucket „branding“
  logo_pdf_pfad text,  -- dasselbe Logo als PNG für die PDF-Protokolle
  geaendert_am timestamptz not null default now()
);
insert into erscheinungsbild (id) values (1);
create trigger erscheinungsbild_geaendert_am before update on erscheinungsbild for each row execute function setze_geaendert_am();
create trigger erscheinungsbild_audit after insert or update or delete on erscheinungsbild for each row execute function audit();
alter table erscheinungsbild enable row level security;
create policy erscheinungsbild_lesen on erscheinungsbild for select to anon, authenticated using (true);
create policy erscheinungsbild_aendern on erscheinungsbild for update to authenticated using (ist_systemadmin()) with check (ist_systemadmin());

-- Öffentlicher Speicher für das Logo (Anmeldeseite braucht es ohne Anmeldung)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 2097152, array['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;
create policy branding_admin_schreiben on storage.objects for insert to authenticated
  with check (bucket_id = 'branding' and public.ist_systemadmin());
create policy branding_admin_aendern on storage.objects for update to authenticated
  using (bucket_id = 'branding' and public.ist_systemadmin());
create policy branding_admin_loeschen on storage.objects for delete to authenticated
  using (bucket_id = 'branding' and public.ist_systemadmin());
create policy branding_lesen on storage.objects for select to anon, authenticated using (bucket_id = 'branding');

-- Wiederherstellung kennt die neue Tabelle (Funktion sonst unverändert)
create or replace function admin_wiederherstellen(p_tabelle text, p_zeilen jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  erlaubt constant text[] := array['benutzer', 'firma', 'erscheinungsbild', 'endkunde', 'objekt', 'checkliste', 'checkliste_version', 'tuertyp',
    'etikett', 'tuer', 'session', 'session_revision', 'session_teilnehmer', 'tuerpruefung', 'antwort', 'mangel', 'foto',
    'protokoll', 'protokoll_zaehler'];
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
      if p_tabelle = 'etikett' then zeile := zeile || '{"tuer_id": null, "zugeordnet_am": null}'::jsonb; end if;

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
end $$;
