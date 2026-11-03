-- Version 2.1.0, Phase 2 aus docs/KONZEPT-ANLAGEN.md:
-- 1. Anlagenarten (Tür, Sicherheitsbeleuchtung), je Instanz ein- und ausschaltbar
-- 2. Anlagentyp gehört zu einer Art; die Türkategorie gilt nur für Türen
-- 3. Prüfarten je Anlagentyp mit eigener Checkliste und eigenem Intervall
-- 4. Fälligkeit je Anlage und Prüfart; die Spalten an der Anlage fassen nur noch zusammen
-- 5. Jede Prüfung gehört zu einer Prüfart
-- 6. Anlagendaten, die nur eine Art hat, in anlage.eigenschaften (z. B. Antrieb/System bei Türen)

-- ---------------------------------------------------------------------------
-- 1. Anlagenarten
-- ---------------------------------------------------------------------------
create table anlagenart (
  schluessel text primary key check (schluessel ~ '^[a-z_]+$'),
  name text not null,
  aktiv boolean not null default false,
  reihenfolge int not null default 0,
  geaendert_am timestamptz not null default now()
);
insert into anlagenart (schluessel, name, aktiv, reihenfolge) values
  ('tuer', 'Türen', true, 1),
  ('sicherheitsbeleuchtung', 'Sicherheitsbeleuchtung', false, 2);
create trigger anlagenart_geaendert_am before update on anlagenart for each row execute function setze_geaendert_am();
create trigger anlagenart_audit after insert or update or delete on anlagenart for each row execute function audit();

create function anlagenart_mindestens_eine() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from anlagenart where aktiv) then
    raise exception 'Mindestens eine Anlagenart muss eingeschaltet bleiben';
  end if;
  return null;
end $$;
create trigger anlagenart_mindestens_eine after update on anlagenart for each statement execute function anlagenart_mindestens_eine();

alter table anlagenart enable row level security;
create policy anlagenart_lesen on anlagenart for select to authenticated using (ist_aktiv());
create policy anlagenart_aendern on anlagenart for update to authenticated using (ist_systemadmin()) with check (ist_systemadmin());

-- ---------------------------------------------------------------------------
-- 2. Anlagentyp gehört zu einer Art
-- ---------------------------------------------------------------------------
alter table anlagentyp add column anlagenart text not null default 'tuer' references anlagenart (schluessel);
alter table anlagentyp alter column kategorie drop not null;
alter table anlagentyp add constraint anlagentyp_kategorie_nur_tuer check ((anlagenart = 'tuer') = (kategorie is not null));
comment on column anlagentyp.kategorie is 'Nur bei Türen: Fluchttür, Automatiktür, sonstige';

-- ---------------------------------------------------------------------------
-- 3. Prüfarten
-- ---------------------------------------------------------------------------
create table pruefart (
  id uuid primary key default gen_random_uuid(),
  anlagentyp_id uuid not null references anlagentyp (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  checkliste_id uuid references checkliste (id),
  intervall_monate int not null default 12 check (intervall_monate between 1 and 120),
  reihenfolge int not null default 1,
  aktiv boolean not null default true,
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  erstellt_von uuid references benutzer (id) default auth.uid()
);
create index on pruefart (anlagentyp_id);
comment on table pruefart is 'Prüfart je Anlagentyp (z. B. jährliche Prüfung, monatliche Funktionsprüfung) mit eigener Checkliste und eigenem Intervall';

-- Bisherige Checkliste und Intervall des Typs werden zur ersten Prüfart.
-- Gleiche ID wie der Typ, damit sich Datensicherungen aus Version 2.0 eindeutig übersetzen lassen.
insert into pruefart (id, anlagentyp_id, name, checkliste_id, intervall_monate, reihenfolge, erstellt_am, erstellt_von)
  select id, id, 'Wiederkehrende Prüfung', checkliste_id, intervall_monate, 1, erstellt_am, erstellt_von from anlagentyp;

create trigger pruefart_geaendert_am before update on pruefart for each row execute function setze_geaendert_am();
create trigger pruefart_audit after insert or update or delete on pruefart for each row execute function audit();
alter table pruefart enable row level security;
create policy pruefart_lesen on pruefart for select to authenticated using (ist_aktiv());
create policy pruefart_admin on pruefart for all to authenticated using (ist_admin()) with check (ist_admin());

-- ---------------------------------------------------------------------------
-- 4. Fälligkeit je Anlage und Prüfart
-- ---------------------------------------------------------------------------
create table anlage_faelligkeit (
  anlage_id uuid not null references anlage (id) on delete cascade,
  pruefart_id uuid not null references pruefart (id) on delete cascade,
  intervall_monate int check (intervall_monate between 1 and 120),
  letzte_pruefung_am date,
  letztes_ergebnis ampel,
  naechste_pruefung_am date,
  geaendert_am timestamptz not null default now(),
  primary key (anlage_id, pruefart_id)
);
create index on anlage_faelligkeit (pruefart_id);
create index on anlage_faelligkeit (naechste_pruefung_am);
comment on column anlage_faelligkeit.intervall_monate is 'Abweichendes Intervall für diese Anlage; leer = Intervall der Prüfart';

create function faelligkeit_berechnen() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.letzte_pruefung_am > current_date then
    raise exception 'Das Datum der letzten Prüfung darf nicht in der Zukunft liegen';
  end if;
  new.naechste_pruefung_am := case when new.letzte_pruefung_am is null then null else
    (new.letzte_pruefung_am + make_interval(months => coalesce(new.intervall_monate,
      (select intervall_monate from pruefart where id = new.pruefart_id))))::date end;
  return new;
end $$;
create trigger anlage_faelligkeit_berechnen before insert or update on anlage_faelligkeit
  for each row execute function faelligkeit_berechnen();
create trigger anlage_faelligkeit_geaendert_am before update on anlage_faelligkeit for each row execute function setze_geaendert_am();
create trigger anlage_faelligkeit_audit after insert or update or delete on anlage_faelligkeit for each row execute function audit();
alter table anlage_faelligkeit enable row level security;
-- Wie bei der Anlage selbst: alle aktiven Benutzer lesen und erfassen (z. B. letzte Prüfung aus dem Bestand), löschen nur Admin/Planer
create policy anlage_faelligkeit_lesen on anlage_faelligkeit for select to authenticated using (ist_aktiv());
create policy anlage_faelligkeit_anlegen on anlage_faelligkeit for insert to authenticated with check (ist_aktiv());
create policy anlage_faelligkeit_aendern on anlage_faelligkeit for update to authenticated using (ist_aktiv()) with check (ist_aktiv());
create policy anlage_faelligkeit_loeschen on anlage_faelligkeit for delete to authenticated using (ist_admin());

-- Zusammenfassung an der Anlage (Listen, Startseite): letzte Prüfung, deren Ergebnis, früheste nächste Fälligkeit
-- über die aktiven Prüfarten des aktuellen Typs. Nur diese Funktion schreibt die drei Spalten.
create function anlage_zusammenfassen(p_anlage_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.zusammenfassung', 'ja', true);
  update anlage a set (letzte_pruefung_am, letztes_ergebnis, naechste_pruefung_am) = (
    select max(f.letzte_pruefung_am),
           (array_agg(f.letztes_ergebnis order by f.letzte_pruefung_am desc nulls last))[1],
           min(f.naechste_pruefung_am)
      from anlage_faelligkeit f join pruefart p on p.id = f.pruefart_id
     where f.anlage_id = a.id and p.anlagentyp_id = a.anlagentyp_id and p.aktiv)
   where a.id = p_anlage_id;
  perform set_config('app.zusammenfassung', '', true);
end $$;
revoke all on function anlage_zusammenfassen(uuid) from public, anon, authenticated;

create function anlage_zusammenfassung_schuetzen() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('app.zusammenfassung', true), '') <> 'ja' then
    if tg_op = 'INSERT' then
      new.letzte_pruefung_am := null; new.letztes_ergebnis := null; new.naechste_pruefung_am := null;
    else
      new.letzte_pruefung_am := old.letzte_pruefung_am; new.letztes_ergebnis := old.letztes_ergebnis;
      new.naechste_pruefung_am := old.naechste_pruefung_am;
    end if;
  end if;
  return new;
end $$;

create function anlage_faelligkeit_geaendert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform anlage_zusammenfassen(coalesce(new.anlage_id, old.anlage_id));
  return null;
end $$;
create trigger anlage_faelligkeit_zusammenfassen after insert or update or delete on anlage_faelligkeit
  for each row execute function anlage_faelligkeit_geaendert();

-- Intervall oder Aktiv-Status einer Prüfart geändert → Fälligkeiten neu berechnen
create function pruefart_geaendert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update anlage_faelligkeit set letzte_pruefung_am = letzte_pruefung_am where pruefart_id = new.id;
  return null;
end $$;
create trigger pruefart_geaendert after update of intervall_monate, aktiv on pruefart for each row
  when (old.intervall_monate is distinct from new.intervall_monate or old.aktiv is distinct from new.aktiv)
  execute function pruefart_geaendert();

-- Bestand übernehmen (Trigger berechnet die nächste Prüfung, die Zusammenfassung folgt unten)
insert into anlage_faelligkeit (anlage_id, pruefart_id, intervall_monate, letzte_pruefung_am, letztes_ergebnis)
  select id, anlagentyp_id, intervall_monate, letzte_pruefung_am, letztes_ergebnis from anlage
   where intervall_monate is not null or letzte_pruefung_am is not null;

-- ---------------------------------------------------------------------------
-- 5. Prüfung gehört zu einer Prüfart
-- ---------------------------------------------------------------------------
alter table anlagenpruefung add column pruefart_id uuid references pruefart (id);
alter table anlagenpruefung disable trigger user;
update anlagenpruefung p set pruefart_id = a.anlagentyp_id from anlage a where a.id = p.anlage_id;
alter table anlagenpruefung enable trigger user;
alter table anlagenpruefung alter column pruefart_id set not null;
create index on anlagenpruefung (pruefart_id);

-- Ohne Angabe: erste aktive Prüfart des Typs (z. B. „nicht geprüft“ oder Geräte mit App 2.0). Prüfart muss zum Typ passen.
create or replace function anlagenpruefung_vor_einfuegen() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  vorhanden uuid;
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
end $$;

-- Abgeschlossene Prüfung schreibt die Fälligkeit ihrer Prüfart fort
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
  end if;
  return new;
end $$;

-- Reservieren mit Prüfart (leer = erste Prüfart des Typs)
drop function anlage_reservieren(uuid, uuid, uuid, uuid, erfassung);
create function anlage_reservieren(p_id uuid, p_session_id uuid, p_anlage_id uuid, p_checkliste_version_id uuid,
                                   p_erfassung erfassung, p_pruefart_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  vorhanden anlagenpruefung;
  name text;
begin
  if not ist_teilnehmer(p_session_id) then raise exception 'Sie nehmen an dieser Prüfung nicht teil'; end if;
  if not session_offen(p_session_id) then raise exception 'Die Prüfung ist bereits abgeschlossen'; end if;
  if exists (select 1 from anlagenpruefung where id = p_id) then
    return jsonb_build_object('ok', true, 'id', p_id);
  end if;
  select * into vorhanden from anlagenpruefung
   where session_id = p_session_id and anlage_id = p_anlage_id and status <> 'duplikat'
   for update;
  if vorhanden.id is not null then
    if vorhanden.pruefer_id = auth.uid() then
      return jsonb_build_object('ok', true, 'id', vorhanden.id, 'fortsetzen', true);
    end if;
    select b.name into name from benutzer b where b.id = vorhanden.pruefer_id;
    return jsonb_build_object('ok', false, 'pruefer', name, 'status', vorhanden.status);
  end if;
  insert into anlagenpruefung (id, session_id, anlage_id, pruefer_id, checkliste_version_id, erfassung, pruefart_id)
    values (p_id, p_session_id, p_anlage_id, auth.uid(), p_checkliste_version_id, p_erfassung, p_pruefart_id);
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;
revoke all on function anlage_reservieren(uuid, uuid, uuid, uuid, erfassung, uuid) from public, anon;
grant execute on function anlage_reservieren(uuid, uuid, uuid, uuid, erfassung, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Anlagendaten je Art; Intervall und Checkliste ziehen in die Prüfart bzw. Fälligkeit um
-- ---------------------------------------------------------------------------
alter table anlage add column eigenschaften jsonb not null default '{}'::jsonb check (jsonb_typeof(eigenschaften) = 'object');
comment on column anlage.eigenschaften is 'Felder, die nur eine Anlagenart hat (Definition im Code: src/lib/anlagenarten.ts), z. B. antrieb_system bei Türen';
alter table anlage disable trigger user;
update anlage set eigenschaften = jsonb_build_object('antrieb_system', antrieb_system) where antrieb_system is not null;
alter table anlage enable trigger user;

drop trigger anlage_naechste_pruefung on anlage;
drop function anlage_naechste_pruefung();
drop trigger anlagentyp_intervall_geaendert on anlagentyp;
drop function anlagentyp_intervall_geaendert();
alter table anlage drop column antrieb_system, drop column intervall_monate;
alter table anlagentyp drop column checkliste_id, drop column intervall_monate;

comment on column anlage.letzte_pruefung_am is 'Zusammenfassung aus anlage_faelligkeit (wird automatisch gesetzt)';
comment on column anlage.letztes_ergebnis is 'Zusammenfassung aus anlage_faelligkeit (wird automatisch gesetzt)';
comment on column anlage.naechste_pruefung_am is 'Früheste Fälligkeit aller Prüfarten (wird automatisch gesetzt)';

create trigger anlage_zusammenfassung_schuetzen before insert or update on anlage
  for each row execute function anlage_zusammenfassung_schuetzen();

-- Typ einer Anlage geändert → andere Prüfarten → Zusammenfassung neu
create function anlage_typ_geaendert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform anlage_zusammenfassen(new.id);
  return null;
end $$;
create trigger anlage_typ_geaendert after update of anlagentyp_id on anlage for each row
  when (old.anlagentyp_id is distinct from new.anlagentyp_id) execute function anlage_typ_geaendert();

-- Zusammenfassung für den Bestand neu aufbauen (gleiche Werte wie vorher)
select anlage_zusammenfassen(id) from anlage;

-- Suche: artspezifische Anlagendaten mit durchsuchen
create or replace function anlage_suche(p_text text, p_limit integer default 50)
returns table (
  id uuid, etikett_id text, kunden_bezeichnung text, gebaeude text, etage text, raum text, lage_beschreibung text,
  status anlage_status, naechste_pruefung_am date, anlagentyp text, objekt_id uuid, objekt text, objekt_ort text, kunde text
)
language sql stable set search_path = public as $$
  with woerter as (
    select w from unnest(regexp_split_to_array(lower(trim(p_text)), '\s+')) w where w <> ''
  ),
  kandidaten as (
    select t.*, ty.name as typ_name, o.name as o_name, o.ort as o_ort, k.name as k_name,
           lower(concat_ws(' ',
             t.etikett_id, t.kunden_bezeichnung, t.gebaeude, t.etage, t.raum, t.lage_beschreibung,
             t.hersteller, t.modell, (select string_agg(e.value, ' ') from jsonb_each_text(t.eigenschaften) e), ty.name,
             o.name, o.strasse, o.plz, o.ort,
             k.name, k.strasse, k.plz, k.ort, k.ansprechpartner)) as suchtext
    from anlage t
    join anlagentyp ty on ty.id = t.anlagentyp_id
    join objekt o on o.id = t.objekt_id
    join endkunde k on k.id = o.endkunde_id
  )
  select c.id, c.etikett_id, c.kunden_bezeichnung, c.gebaeude, c.etage, c.raum, c.lage_beschreibung,
         c.status, c.naechste_pruefung_am, c.typ_name, c.objekt_id, c.o_name, c.o_ort, c.k_name
  from kandidaten c
  where exists (select 1 from woerter)
    and not exists (select 1 from woerter where position(w in c.suchtext) = 0)
  order by (lower(c.etikett_id) = lower(trim(p_text))) desc nulls last,
           (c.status = 'aktiv') desc, c.k_name, c.o_name, c.gebaeude, c.etage, c.kunden_bezeichnung
  limit least(greatest(p_limit, 1), 200);
$$;

-- Datensicherung kennt die neuen Tabellen (Funktion sonst unverändert)
CREATE OR REPLACE FUNCTION public.admin_wiederherstellen(p_tabelle text, p_zeilen jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  erlaubt constant text[] := array['benutzer', 'firma', 'erscheinungsbild', 'anlagenart', 'endkunde', 'objekt', 'checkliste', 'checkliste_version',
    'anlagentyp', 'pruefart', 'etikett', 'anlage', 'anlage_faelligkeit', 'session', 'session_revision', 'session_teilnehmer',
    'anlagenpruefung', 'antwort', 'mangel', 'foto', 'protokoll', 'protokoll_zaehler'];
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
