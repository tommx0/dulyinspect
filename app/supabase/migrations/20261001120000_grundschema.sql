-- Türprüf-App – Grundschema (Phase 1)
-- Spezifikation: docs/SPEZIFIKATION.md, Abschnitt 6
--
-- Phase 1 nutzt: benutzer, endkunde, objekt, tuertyp, tuer, etikett, checkliste, checkliste_version, audit_log.
-- Die Prüf-Tabellen (session ff.) werden bereits angelegt, Schreibrechte für Prüfer folgen in Phase 2
-- über RPC-Funktionen. Bis dahin dürfen dort nur Admins schreiben.

-- ---------------------------------------------------------------------------
-- Aufzählungstypen
-- ---------------------------------------------------------------------------
create type rolle as enum ('admin', 'pruefer');
create type tuer_kategorie as enum ('fluchttuer', 'automatiktuer', 'sonstige');
create type tuer_status as enum ('aktiv', 'stillgelegt');
create type ampel as enum ('gruen', 'gelb', 'rot');
create type version_status as enum ('entwurf', 'freigegeben', 'archiviert');
create type session_status as enum ('offen', 'abgeschlossen');
create type erfassung as enum ('scan', 'manuell');
create type pruefung_status as enum ('in_pruefung', 'geprueft', 'nicht_geprueft', 'duplikat');
create type antwort_status as enum ('io', 'nio', 'entfaellt');
create type mangel_status as enum ('offen', 'behoben', 'nachgeprueft', 'verworfen');
create type foto_bezug as enum ('tuer', 'antwort', 'mangel');
create type protokoll_art as enum ('sammel', 'einzel');

-- ---------------------------------------------------------------------------
-- Hilfsfunktionen
-- ---------------------------------------------------------------------------
create function setze_geaendert_am() returns trigger
language plpgsql as $$
begin
  new.geaendert_am := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Benutzer (Profil zu auth.users)
-- ---------------------------------------------------------------------------
create table benutzer (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  email text not null,
  rolle rolle not null default 'pruefer',
  sachkunde_hinweis text,
  aktiv boolean not null default true,
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now()
);

create function ist_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from benutzer where id = auth.uid() and rolle = 'admin' and aktiv);
$$;

create function ist_aktiv() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from benutzer where id = auth.uid() and aktiv);
$$;

-- Profil automatisch anlegen. Rolle kommt aus app_metadata, die nur der Server (Service-Role) setzen kann.
create function neuer_auth_benutzer() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into benutzer (id, email, name, rolle)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce((new.raw_app_meta_data ->> 'rolle')::rolle, 'pruefer')
  );
  return new;
end $$;

create trigger auth_benutzer_angelegt
  after insert on auth.users
  for each row execute function neuer_auth_benutzer();

-- Prüfer dürfen nur ihren Namen ändern, nicht Rolle/Aktiv-Status.
create function benutzer_schutz() returns trigger
language plpgsql as $$
begin
  -- Serverseitige Aufrufe (Edge Function mit Service-Role, Migrationen) sind erlaubt
  if auth.role() = 'service_role' or auth.uid() is null then
    return new;
  end if;
  if not ist_admin() and (new.rolle <> old.rolle or new.aktiv <> old.aktiv or new.email <> old.email) then
    raise exception 'Nur Admins dürfen Rolle, Status oder E-Mail ändern';
  end if;
  return new;
end $$;

create trigger benutzer_schutz before update on benutzer
  for each row execute function benutzer_schutz();

-- ---------------------------------------------------------------------------
-- Stammdaten
-- ---------------------------------------------------------------------------
create table endkunde (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  strasse text, plz text, ort text,
  ansprechpartner text, email text, telefon text,
  notiz text,
  aktiv boolean not null default true,
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  erstellt_von uuid references benutzer (id) default auth.uid()
);

create table objekt (
  id uuid primary key default gen_random_uuid(),
  endkunde_id uuid not null references endkunde (id),
  name text not null,
  strasse text, plz text, ort text,
  zugangshinweise text,
  aktiv boolean not null default true,
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  erstellt_von uuid references benutzer (id) default auth.uid()
);
create index on objekt (endkunde_id);

create table checkliste (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  beschreibung text,
  aktiv boolean not null default true,
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  erstellt_von uuid references benutzer (id) default auth.uid()
);

create table checkliste_version (
  id uuid primary key default gen_random_uuid(),
  checkliste_id uuid not null references checkliste (id),
  version int not null,
  status version_status not null default 'entwurf',
  punkte jsonb not null default '[]'::jsonb,
  freigegeben_am timestamptz,
  freigegeben_von uuid references benutzer (id),
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  erstellt_von uuid references benutzer (id) default auth.uid(),
  unique (checkliste_id, version),
  check (jsonb_typeof(punkte) = 'array')
);
-- Höchstens ein Entwurf und eine freigegebene Version je Checkliste
create unique index checkliste_ein_entwurf on checkliste_version (checkliste_id) where status = 'entwurf';
create unique index checkliste_eine_freigabe on checkliste_version (checkliste_id) where status = 'freigegeben';

create table tuertyp (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kategorie tuer_kategorie not null,
  checkliste_id uuid references checkliste (id),
  intervall_monate int not null default 12 check (intervall_monate between 1 and 120),
  aktiv boolean not null default true,
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  erstellt_von uuid references benutzer (id) default auth.uid()
);

create table etikett (
  id text primary key check (id ~ '^FT-[0-9]{5,}$'),
  charge text not null,
  tuer_id uuid unique,
  zugeordnet_am timestamptz,
  erstellt_am timestamptz not null default now()
);
create sequence etikett_nr start 1;

create table tuer (
  id uuid primary key default gen_random_uuid(),
  objekt_id uuid not null references objekt (id),
  tuertyp_id uuid not null references tuertyp (id),
  etikett_id text unique references etikett (id),
  kunden_bezeichnung text,
  gebaeude text, etage text, raum text,
  lage_beschreibung text,
  hersteller text, modell text, baujahr int,
  intervall_monate int check (intervall_monate between 1 and 120),
  letzte_pruefung_am date,
  letztes_ergebnis ampel,
  naechste_pruefung_am date,
  status tuer_status not null default 'aktiv',
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  erstellt_von uuid references benutzer (id) default auth.uid()
);
create index on tuer (objekt_id);
create index on tuer (naechste_pruefung_am) where status = 'aktiv';

alter table etikett add constraint etikett_tuer_fk foreign key (tuer_id) references tuer (id);

-- ---------------------------------------------------------------------------
-- Prüfungen (Schreibzugriff für Prüfer folgt in Phase 2)
-- ---------------------------------------------------------------------------
create table session (
  id uuid primary key default gen_random_uuid(),
  protokoll_nr text unique,
  objekt_id uuid not null references objekt (id),
  leiter_id uuid not null references benutzer (id),
  status session_status not null default 'offen',
  revision int not null default 0,
  zusammengefuehrt_in uuid references session (id),
  begonnen_am timestamptz not null default now(),
  abgeschlossen_am timestamptz,
  bemerkung text,
  unterschrift_leiter text,
  unterschrift_kunde text,
  kunde_name text,
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now()
);
create unique index session_eine_offene_je_objekt on session (objekt_id)
  where status = 'offen' and zusammengefuehrt_in is null;

create table session_teilnehmer (
  session_id uuid not null references session (id),
  benutzer_id uuid not null references benutzer (id),
  bereich jsonb,
  beigetreten_am timestamptz not null default now(),
  fertig_am timestamptz,
  unterschrift text,
  primary key (session_id, benutzer_id)
);

create table tuerpruefung (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references session (id),
  tuer_id uuid not null references tuer (id),
  pruefer_id uuid not null references benutzer (id),
  checkliste_version_id uuid not null references checkliste_version (id),
  erfassung erfassung not null,
  erfasst_offline boolean not null default false,
  status pruefung_status not null default 'in_pruefung',
  nicht_geprueft_grund text,
  duplikat_von uuid references tuerpruefung (id),
  ergebnis_auto ampel,
  ergebnis ampel,
  ergebnis_begruendung text,
  begonnen_am timestamptz not null default now(),
  beendet_am timestamptz,
  letzte_aktivitaet timestamptz not null default now(),
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now()
);
-- Keine Tür doppelt je Session (Duplikate aus Offline-Betrieb ausgenommen)
create unique index tuerpruefung_einmal_je_session on tuerpruefung (session_id, tuer_id)
  where status <> 'duplikat';

create table antwort (
  id uuid primary key default gen_random_uuid(),
  tuerpruefung_id uuid not null references tuerpruefung (id),
  punkt_id text not null,
  status antwort_status,
  zahl numeric,
  text text,
  bemerkung text,
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  unique (tuerpruefung_id, punkt_id)
);

create table mangel (
  id uuid primary key default gen_random_uuid(),
  tuer_id uuid not null references tuer (id),
  entdeckt_in uuid not null references tuerpruefung (id),
  punkt_id text,
  beschreibung text not null,
  stufe smallint not null check (stufe between 1 and 3),
  status mangel_status not null default 'offen',
  behoben_am timestamptz,
  behoben_notiz text,
  nachgeprueft_in uuid references tuerpruefung (id),
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  erstellt_von uuid references benutzer (id) default auth.uid()
);
create index on mangel (tuer_id) where status in ('offen', 'behoben');

create table foto (
  id uuid primary key default gen_random_uuid(),
  bezug_typ foto_bezug not null,
  bezug_id uuid not null,
  storage_pfad text not null,
  aufgenommen_am timestamptz not null default now(),
  erstellt_von uuid references benutzer (id) default auth.uid()
);
create index on foto (bezug_typ, bezug_id);

create table protokoll (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references session (id),
  tuerpruefung_id uuid references tuerpruefung (id),
  art protokoll_art not null,
  revision int not null default 0,
  storage_pfad text not null,
  sha256 text not null,
  erzeugt_am timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- geaendert_am-Trigger
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['benutzer','endkunde','objekt','checkliste','checkliste_version','tuertyp','tuer',
                           'session','tuerpruefung','antwort','mangel'] loop
    execute format('create trigger %I_geaendert_am before update on %I for each row execute function setze_geaendert_am()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Audit-Log
-- ---------------------------------------------------------------------------
create table audit_log (
  id bigint generated always as identity primary key,
  tabelle text not null,
  datensatz_id text not null,
  aktion text not null,
  alt jsonb,
  neu jsonb,
  benutzer_id uuid default auth.uid(),
  zeitpunkt timestamptz not null default now()
);
create index on audit_log (tabelle, datensatz_id);

create function audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (tabelle, datensatz_id, aktion, alt, neu)
  values (
    tg_table_name,
    coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id'),
    tg_op,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['benutzer','endkunde','objekt','checkliste','checkliste_version','tuertyp','tuer','etikett',
                           'session','tuerpruefung','mangel'] loop
    execute format('create trigger %I_audit after insert or update or delete on %I for each row execute function audit()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Checklisten-Versionierung
-- ---------------------------------------------------------------------------

-- Freigegebene/archivierte Versionen sind unveränderlich (nur Statuswechsel freigegeben → archiviert erlaubt).
create function version_schutz() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'entwurf' then
      raise exception 'Freigegebene Checklisten-Versionen können nicht gelöscht werden';
    end if;
    return old;
  end if;
  if old.status = 'entwurf' then
    return new;
  end if;
  if old.status = 'freigegeben' and new.status = 'archiviert'
     and new.punkte = old.punkte and new.version = old.version and new.checkliste_id = old.checkliste_id then
    return new;
  end if;
  raise exception 'Checklisten-Version % ist % und kann nicht geändert werden', old.version, old.status;
end $$;

create trigger checkliste_version_schutz before update or delete on checkliste_version
  for each row execute function version_schutz();

-- Prüft die Punkte-Struktur. Liefert Fehlertexte (leer = gültig).
create function checkliste_punkte_pruefen(p_punkte jsonb) returns text[]
language plpgsql immutable as $$
declare
  fehler text[] := '{}';
  punkt jsonb;
  bezug jsonb;
  vorher jsonb := '{}'::jsonb;
  erlaubt text[];
  wert text;
  typen constant text[] := array['status','messwert','ja_nein','auswahl','text','foto'];
begin
  if jsonb_array_length(p_punkte) = 0 then
    return array['Checkliste enthält keine Prüfpunkte'];
  end if;
  for punkt in select * from jsonb_array_elements(p_punkte) loop
    if coalesce(punkt ->> 'id', '') = '' or coalesce(punkt ->> 'text', '') = '' then
      fehler := fehler || 'Prüfpunkt ohne ID oder Text';
      continue;
    end if;
    if vorher ? (punkt ->> 'id') then
      fehler := fehler || format('Doppelte Punkt-ID %s', punkt ->> 'id');
    end if;
    if not (punkt ->> 'typ' = any (typen)) then
      fehler := fehler || format('%s: unbekannter Typ %s', punkt ->> 'id', punkt ->> 'typ');
    end if;
    if punkt ->> 'typ' = 'auswahl' and jsonb_array_length(coalesce(punkt -> 'optionen', '[]')) < 2 then
      fehler := fehler || format('%s: Auswahl braucht mindestens 2 Optionen', punkt ->> 'id');
    end if;
    if (punkt ->> 'verifizieren')::boolean is true then
      fehler := fehler || format('%s: Grenzwert noch nicht fachlich bestätigt', punkt ->> 'id');
    end if;
    if punkt ? 'nur_wenn' then
      bezug := vorher -> (punkt -> 'nur_wenn' ->> 'punkt');
      if bezug is null then
        fehler := fehler || format('%s: Bedingung verweist nicht auf einen vorherigen Punkt', punkt ->> 'id');
      elsif bezug ->> 'typ' not in ('ja_nein', 'auswahl') then
        fehler := fehler || format('%s: Bedingung muss auf Ja/Nein- oder Auswahl-Punkt verweisen', punkt ->> 'id');
      else
        erlaubt := case when bezug ->> 'typ' = 'ja_nein' then array['ja','nein']
                        else array(select o ->> 'wert' from jsonb_array_elements(bezug -> 'optionen') o) end;
        for wert in
          select jsonb_array_elements_text(punkt -> 'nur_wenn' -> 'in')
          union all select punkt -> 'nur_wenn' ->> 'ist' where punkt -> 'nur_wenn' ? 'ist'
          union all select punkt -> 'nur_wenn' ->> 'ist_nicht' where punkt -> 'nur_wenn' ? 'ist_nicht'
        loop
          if not (wert = any (erlaubt)) then
            fehler := fehler || format('%s: ungültiger Bedingungswert „%s“', punkt ->> 'id', wert);
          end if;
        end loop;
      end if;
    end if;
    vorher := vorher || jsonb_build_object(punkt ->> 'id', punkt);
  end loop;
  return fehler;
end $$;

-- Entwurf freigeben: prüfen, bisherige Freigabe archivieren.
create function checkliste_version_freigeben(p_version_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v checkliste_version;
  fehler text[];
begin
  if not ist_admin() then raise exception 'Nur Admins dürfen Checklisten freigeben'; end if;
  select * into v from checkliste_version where id = p_version_id for update;
  if v is null or v.status <> 'entwurf' then raise exception 'Nur Entwürfe können freigegeben werden'; end if;
  fehler := checkliste_punkte_pruefen(v.punkte);
  if array_length(fehler, 1) > 0 then
    raise exception 'Freigabe nicht möglich: %', array_to_string(fehler, '; ');
  end if;
  update checkliste_version set status = 'archiviert'
    where checkliste_id = v.checkliste_id and status = 'freigegeben';
  update checkliste_version
    set status = 'freigegeben', freigegeben_am = now(), freigegeben_von = auth.uid()
    where id = p_version_id;
end $$;

-- Neuen Entwurf aus der neuesten Version erzeugen (oder vorhandenen Entwurf zurückgeben).
create function checkliste_neuer_entwurf(p_checkliste_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  vorhanden uuid;
  neueste checkliste_version;
  neu uuid;
begin
  if not ist_admin() then raise exception 'Nur Admins dürfen Checklisten bearbeiten'; end if;
  select id into vorhanden from checkliste_version where checkliste_id = p_checkliste_id and status = 'entwurf';
  if vorhanden is not null then return vorhanden; end if;
  select * into neueste from checkliste_version where checkliste_id = p_checkliste_id order by version desc limit 1;
  insert into checkliste_version (checkliste_id, version, punkte)
    values (p_checkliste_id, coalesce(neueste.version, 0) + 1, coalesce(neueste.punkte, '[]'::jsonb))
    returning id into neu;
  return neu;
end $$;

-- ---------------------------------------------------------------------------
-- Etiketten
-- ---------------------------------------------------------------------------
create function etiketten_erzeugen(p_anzahl int, p_charge text default null) returns setof etikett
language plpgsql security definer set search_path = public as $$
declare
  charge text := coalesce(nullif(p_charge, ''), to_char(now(), 'YYYY-MM-DD HH24:MI'));
begin
  if not ist_admin() then raise exception 'Nur Admins dürfen Etiketten erzeugen'; end if;
  if p_anzahl not between 1 and 1000 then raise exception 'Anzahl muss zwischen 1 und 1000 liegen'; end if;
  return query
    insert into etikett (id, charge)
    select 'FT-' || lpad(nextval('etikett_nr')::text, 5, '0'), charge
    from generate_series(1, p_anzahl)
    returning *;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table benutzer enable row level security;
alter table endkunde enable row level security;
alter table objekt enable row level security;
alter table checkliste enable row level security;
alter table checkliste_version enable row level security;
alter table tuertyp enable row level security;
alter table etikett enable row level security;
alter table tuer enable row level security;
alter table session enable row level security;
alter table session_teilnehmer enable row level security;
alter table tuerpruefung enable row level security;
alter table antwort enable row level security;
alter table mangel enable row level security;
alter table foto enable row level security;
alter table protokoll enable row level security;
alter table audit_log enable row level security;

-- Lesen: alle aktiven Benutzer sehen alles (Prüfer sehen alle Endkunden – Entscheidung aus der Planung)
do $$
declare t text;
begin
  foreach t in array array['benutzer','endkunde','objekt','checkliste','checkliste_version','tuertyp','etikett','tuer',
                           'session','session_teilnehmer','tuerpruefung','antwort','mangel','foto','protokoll'] loop
    execute format('create policy %I on %I for select to authenticated using (ist_aktiv())', t || '_lesen', t);
    execute format('create policy %I on %I for all to authenticated using (ist_admin()) with check (ist_admin())', t || '_admin', t);
  end loop;
end $$;

create policy audit_log_admin_lesen on audit_log for select to authenticated using (ist_admin());

-- Eigenes Profil (Name) ändern
create policy benutzer_selbst on benutzer for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Prüfer dürfen Türen vor Ort anlegen und Stammdaten pflegen (last write wins + Audit-Log)
create policy tuer_pruefer_anlegen on tuer for insert to authenticated with check (ist_aktiv());
create policy tuer_pruefer_aendern on tuer for update to authenticated using (ist_aktiv()) with check (ist_aktiv());

-- RPCs nur für angemeldete Benutzer
revoke execute on function checkliste_version_freigeben(uuid) from public, anon;
revoke execute on function checkliste_neuer_entwurf(uuid) from public, anon;
revoke execute on function etiketten_erzeugen(int, text) from public, anon;
grant execute on function checkliste_version_freigeben(uuid) to authenticated;
grant execute on function checkliste_neuer_entwurf(uuid) to authenticated;
grant execute on function etiketten_erzeugen(int, text) to authenticated;
