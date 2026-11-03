-- Version 2.2.0, Phase 3 aus docs/KONZEPT-ANLAGEN.md: Elemente einer Anlage (z. B. Leuchten, Melder).
-- 1. Elemente je Anlage mit Gruppe (Stromkreis/Meldergruppe) und Nummer
-- 2. Ergebnis je Prüfung und Element (i.O., defekt, nicht zugänglich); ein Defekt ist ein Mangel
-- 3. Prüfart legt fest, ob und welcher Anteil der Elemente je Termin geprüft wird
-- 4. Abgeschlossene Prüfung schreibt „zuletzt geprüft“ am Element fort (Grundlage für Teilprüfungen)

-- ---------------------------------------------------------------------------
-- 1. Elemente
-- ---------------------------------------------------------------------------
create table anlage_element (
  id uuid primary key default gen_random_uuid(),
  anlage_id uuid not null references anlage (id) on delete cascade,
  gruppe text check (gruppe is null or length(trim(gruppe)) between 1 and 40),
  nummer text not null check (length(trim(nummer)) between 1 and 40),
  elementart text check (elementart is null or elementart ~ '^[a-z_]+$'),
  ort text,
  typ text,
  eigenschaften jsonb not null default '{}'::jsonb check (jsonb_typeof(eigenschaften) = 'object'),
  aktiv boolean not null default true,
  zuletzt_geprueft_am date,
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  erstellt_von uuid references benutzer (id) default auth.uid()
);
create index on anlage_element (anlage_id);
-- Eine Nummer je Gruppe nur einmal unter den aktiven Elementen (ersetzte Elemente bleiben stillgelegt erhalten)
create unique index anlage_element_nummer on anlage_element (anlage_id, coalesce(gruppe, ''), nummer) where aktiv;
comment on table anlage_element is 'Element einer Anlage, z. B. Leuchte einer Sicherheitsbeleuchtung oder Melder einer BMA (Elementarten im Code: src/lib/anlagenarten.ts)';
comment on column anlage_element.zuletzt_geprueft_am is 'Letzte abgeschlossene Prüfung mit Ergebnis für dieses Element (wird automatisch gesetzt)';

create trigger anlage_element_geaendert_am before update on anlage_element for each row execute function setze_geaendert_am();
create trigger anlage_element_audit after insert or update or delete on anlage_element for each row execute function audit();
alter table anlage_element enable row level security;
-- Wie bei der Anlage: alle aktiven Benutzer lesen, erfassen und ergänzen (auch vor Ort), löschen nur Admin/Planer
create policy anlage_element_lesen on anlage_element for select to authenticated using (ist_aktiv());
create policy anlage_element_anlegen on anlage_element for insert to authenticated with check (ist_aktiv());
create policy anlage_element_aendern on anlage_element for update to authenticated using (ist_aktiv()) with check (ist_aktiv());
create policy anlage_element_loeschen on anlage_element for delete to authenticated using (ist_admin());

-- zuletzt_geprueft_am setzt nur die Datenbank
create function element_zuletzt_schuetzen() returns trigger
language plpgsql set search_path = public as $$
begin
  -- Ausnahme: Fortschreiben nach einer Prüfung und Wiederherstellen einer Datensicherung
  if coalesce(current_setting('app.element_stand', true), '') <> 'ja' and coalesce(current_setting('session.revision', true), '') <> 'ja' then
    new.zuletzt_geprueft_am := case when tg_op = 'INSERT' then null else old.zuletzt_geprueft_am end;
  end if;
  return new;
end $$;
create trigger anlage_element_zuletzt_schuetzen before insert or update on anlage_element
  for each row execute function element_zuletzt_schuetzen();

-- ---------------------------------------------------------------------------
-- 2. Ergebnis je Prüfung und Element
-- ---------------------------------------------------------------------------
alter table mangel add column element_id uuid references anlage_element (id) on delete set null;
create index on mangel (element_id);

create table element_ergebnis (
  id uuid primary key default gen_random_uuid(),
  anlagenpruefung_id uuid not null references anlagenpruefung (id) on delete cascade,
  -- Kein Löschen von Elementen mit Ergebnissen (Verlauf bleibt erhalten, dafür „stillgelegt“)
  element_id uuid not null references anlage_element (id),
  status text not null check (status in ('io', 'defekt', 'nicht_zugaenglich')),
  grund text,
  bemerkung text,
  mangel_id uuid references mangel (id) on delete set null,
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  unique (anlagenpruefung_id, element_id)
);
create index on element_ergebnis (element_id);
create trigger element_ergebnis_geaendert_am before update on element_ergebnis for each row execute function setze_geaendert_am();
-- Sperre nach Abschluss wie bei Antworten. Wird die Prüfung selbst gelöscht (Freigeben, Verwerfen), verschwinden ihre
-- Ergebnisse mit; dann gibt es keine Prüfung mehr, deren Session gesperrt sein könnte.
create or replace function session_sperre() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  sid uuid;
begin
  if tg_table_name = 'anlagenpruefung' then
    sid := coalesce(new.session_id, old.session_id);
  else
    sid := pruefung_session(coalesce(new.anlagenpruefung_id, old.anlagenpruefung_id));
    if sid is null and tg_op = 'DELETE' then return old; end if;
  end if;
  if not session_offen(sid) and coalesce(current_setting('session.revision', true), '') <> 'ja' then
    raise exception 'Die Prüfung ist abgeschlossen und kann nicht mehr geändert werden';
  end if;
  return coalesce(new, old);
end $$;
create trigger element_ergebnis_sperre before insert or update or delete on element_ergebnis for each row execute function session_sperre();
alter table element_ergebnis enable row level security;
create policy element_ergebnis_lesen on element_ergebnis for select to authenticated using (ist_aktiv());
create policy element_ergebnis_schreiben on element_ergebnis for all to authenticated
  using (ist_eigene_offene_pruefung(anlagenpruefung_id)) with check (ist_eigene_offene_pruefung(anlagenpruefung_id));
create policy element_ergebnis_admin on element_ergebnis for all to authenticated using (ist_admin()) with check (ist_admin());

-- ---------------------------------------------------------------------------
-- 3. Prüfart: Elemente prüfen
-- ---------------------------------------------------------------------------
alter table pruefart
  add column elemente text not null default 'keine' check (elemente in ('keine', 'alle', 'anteil')),
  add column elemente_anteil int check (elemente_anteil between 1 and 100),
  add column elemente_zyklus_monate int not null default 12 check (elemente_zyklus_monate between 1 and 120),
  add constraint pruefart_anteil_noetig check (elemente <> 'anteil' or elemente_anteil is not null);
comment on column pruefart.elemente is 'keine | alle (jeder Termin prüft alle Elemente) | anteil (je Termin elemente_anteil Prozent, jedes Element mindestens alle elemente_zyklus_monate)';

-- ---------------------------------------------------------------------------
-- 4. Abgeschlossene Prüfung: Fälligkeit der Prüfart und Stand der Elemente fortschreiben
-- ---------------------------------------------------------------------------
create or replace function anlagenpruefung_nach_aendern() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  tag date;
begin
  if new.status = 'geprueft' and new.ergebnis is not null then
    tag := coalesce(new.beendet_am, new.begonnen_am)::date;
    insert into anlage_faelligkeit (anlage_id, pruefart_id, letzte_pruefung_am, letztes_ergebnis)
      values (new.anlage_id, new.pruefart_id, tag, new.ergebnis)
      on conflict (anlage_id, pruefart_id) do update
        set letzte_pruefung_am = excluded.letzte_pruefung_am, letztes_ergebnis = excluded.letztes_ergebnis
        where anlage_faelligkeit.letzte_pruefung_am is null or anlage_faelligkeit.letzte_pruefung_am <= excluded.letzte_pruefung_am;
    perform set_config('app.element_stand', 'ja', true);
    update anlage_element e set zuletzt_geprueft_am = tag
      from element_ergebnis r
     where r.anlagenpruefung_id = new.id and r.element_id = e.id and r.status <> 'nicht_zugaenglich'
       and (e.zuletzt_geprueft_am is null or e.zuletzt_geprueft_am < tag);
    perform set_config('app.element_stand', '', true);
  end if;
  return new;
end $$;

-- Freigeben/Verwerfen einer laufenden Prüfung: Ergebnisse der Elemente verschwinden mit der Prüfung (on delete cascade),
-- Mängel aus Elementen löschen die bestehenden Funktionen über entdeckt_in mit.

-- Datensicherung kennt die neuen Tabellen (Funktion sonst unverändert)
CREATE OR REPLACE FUNCTION public.admin_wiederherstellen(p_tabelle text, p_zeilen jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  erlaubt constant text[] := array['benutzer', 'firma', 'erscheinungsbild', 'anlagenart', 'endkunde', 'objekt', 'checkliste', 'checkliste_version',
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
