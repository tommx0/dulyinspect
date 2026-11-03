-- Neue Rolle „Planer“: alle Verwaltungsrechte eines Admins, aber keine Systemverwaltung
-- (Firmendaten/Impressum/Datenschutz, Benutzerverwaltung, Wiederherstellung aus der Datensicherung).
-- ist_admin() bedeutet ab hier „darf verwalten“ (Admin oder Planer), ist_systemadmin() nur Admin.

alter type rolle add value if not exists 'planer';

-- Vergleich über Text: der neue Enum-Wert ist in derselben Transaktion noch nicht verwendbar
create or replace function ist_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from benutzer where id = auth.uid() and rolle::text in ('admin', 'planer') and aktiv);
$$;

create function ist_systemadmin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from benutzer where id = auth.uid() and rolle::text = 'admin' and aktiv);
$$;

-- Benutzer: Rolle, Status und E-Mail ändern nur Admins (über die Edge Function bzw. direkt)
drop policy benutzer_admin on benutzer;
create policy benutzer_admin on benutzer for all to authenticated using (ist_systemadmin()) with check (ist_systemadmin());

create or replace function benutzer_schutz() returns trigger
language plpgsql as $$
begin
  -- Serverseitige Aufrufe (Edge Function mit Service-Role, Migrationen) sind erlaubt
  if auth.role() = 'service_role' or auth.uid() is null then
    return new;
  end if;
  if not ist_systemadmin() and (new.rolle <> old.rolle or new.aktiv <> old.aktiv or new.email <> old.email) then
    raise exception 'Nur Admins dürfen Rolle, Status oder E-Mail ändern';
  end if;
  return new;
end $$;

-- Firmendaten, Impressum, Datenschutz: nur Admins
drop policy firma_admin on firma;
create policy firma_admin on firma for all to authenticated using (ist_systemadmin()) with check (ist_systemadmin());

-- Wiederherstellung aus der Datensicherung: nur Admins (Funktion sonst unverändert)
create or replace function admin_wiederherstellen(p_tabelle text, p_zeilen jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  erlaubt constant text[] := array['benutzer', 'firma', 'endkunde', 'objekt', 'checkliste', 'checkliste_version', 'tuertyp',
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
