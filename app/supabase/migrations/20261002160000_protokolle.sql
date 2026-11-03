-- Phase 3: Protokollnummer, Firmendaten, PDF-Protokolle, Revisionen (Spezifikation 3.7, 4.4, 5)

-- ---------------------------------------------------------------------------
-- Firmendaten des Dienstleisters (eine Zeile) für Protokollkopf und Etiketten
-- ---------------------------------------------------------------------------
create table firma (
  id int primary key default 1 check (id = 1),
  name text not null,
  strasse text, plz text, ort text,
  telefon text, email text, web text,
  zusatz text,
  protokoll_hinweis text,
  geaendert_am timestamptz not null default now()
);
create trigger firma_geaendert_am before update on firma for each row execute function setze_geaendert_am();
create trigger firma_audit after insert or update or delete on firma for each row execute function audit();
alter table firma enable row level security;
create policy firma_lesen on firma for select to authenticated using (ist_aktiv());
create policy firma_admin on firma for all to authenticated using (ist_admin()) with check (ist_admin());

insert into firma (name, strasse, plz, ort, telefon, email, web, zusatz, protokoll_hinweis) values (
  'Muster Prüfservice GmbH', 'Musterstraße 1', '12345', 'Musterstadt', '+49 123 456789',
  'info@example.com', 'www.example.com', 'Prüfung von Fluchtwegtüren und automatischen Türen',
  'Die Prüfung erfolgte nach bestem Wissen anhand der angegebenen Checkliste. Festgestellte Mängel sind zeitnah zu beseitigen; Mängel der Stufe 3 machen die Tür nicht betriebssicher.'
);

-- ---------------------------------------------------------------------------
-- Protokollnummer JJJJ-0001, fortlaufend je Jahr, vergeben beim ersten Abschluss
-- ---------------------------------------------------------------------------
create table protokoll_zaehler (jahr int primary key, letzte int not null);
alter table protokoll_zaehler enable row level security; -- nur über Funktionen

create function naechste_protokoll_nr() returns text
language plpgsql security definer set search_path = public as $$
declare
  j int := extract(year from now())::int;
  n int;
begin
  insert into protokoll_zaehler (jahr, letzte) values (j, 1)
    on conflict (jahr) do update set letzte = protokoll_zaehler.letzte + 1
    returning letzte into n;
  return j::text || '-' || lpad(n::text, 4, '0');
end $$;
revoke execute on function naechste_protokoll_nr() from public, anon, authenticated;

create function session_protokoll_nr() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'abgeschlossen' and old.status <> 'abgeschlossen' and new.protokoll_nr is null then
    new.protokoll_nr := naechste_protokoll_nr();
  end if;
  return new;
end $$;
create trigger session_protokoll_nr before update of status on session
  for each row execute function session_protokoll_nr();

-- ---------------------------------------------------------------------------
-- Gespeicherte PDFs: unveränderlich, je Session/Revision/Art/Tür höchstens einmal
-- ---------------------------------------------------------------------------
create unique index protokoll_einmalig on protokoll
  (session_id, revision, art, coalesce(tuerpruefung_id, '00000000-0000-0000-0000-000000000000'::uuid));

create policy protokoll_anlegen on protokoll for insert to authenticated
  with check (ist_aktiv() and exists (
    select 1 from session s where s.id = session_id and s.status = 'abgeschlossen' and s.revision = protokoll.revision));

create function protokoll_unveraenderlich() returns trigger
language plpgsql as $$
begin
  -- Einzige Ausnahme: Wartung mit Service-Role (z. B. Testdaten aufräumen), nie aus der App
  if tg_op = 'DELETE' and auth.role() = 'service_role' then return old; end if;
  raise exception 'Gespeicherte Protokolle sind unveränderlich';
end $$;
create trigger protokoll_unveraenderlich before update or delete on protokoll
  for each row execute function protokoll_unveraenderlich();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('protokolle', 'protokolle', false, 52428800, array['application/pdf'])
  on conflict (id) do nothing;
create policy protokolle_lesen on storage.objects for select to authenticated
  using (bucket_id = 'protokolle' and public.ist_aktiv());
create policy protokolle_hochladen on storage.objects for insert to authenticated
  with check (bucket_id = 'protokolle' and public.ist_aktiv());
-- kein Update/Delete: PDFs bleiben unverändert

-- ---------------------------------------------------------------------------
-- Revision: Admin öffnet eine abgeschlossene Prüfung mit Begründung wieder
-- ---------------------------------------------------------------------------
create table session_revision (
  session_id uuid not null references session (id),
  revision int not null,
  grund text not null check (nullif(trim(grund), '') is not null),
  von uuid not null references benutzer (id) default auth.uid(),
  am timestamptz not null default now(),
  primary key (session_id, revision)
);
alter table session_revision enable row level security;
create policy session_revision_lesen on session_revision for select to authenticated using (ist_aktiv());
create trigger session_revision_audit after insert on session_revision for each row execute function audit();

create function session_revision_oeffnen(p_session_id uuid, p_grund text, p_leiter_id uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  s session;
begin
  if not ist_admin() then raise exception 'Nur Admins dürfen eine Revision erstellen'; end if;
  if nullif(trim(p_grund), '') is null then raise exception 'Bitte den Grund der Revision angeben'; end if;
  select * into s from session where id = p_session_id for update;
  if s.id is null then raise exception 'Prüfung nicht gefunden'; end if;
  if s.status <> 'abgeschlossen' then raise exception 'Nur abgeschlossene Prüfungen können revidiert werden'; end if;
  if exists (select 1 from session where objekt_id = s.objekt_id and status = 'offen' and zusammengefuehrt_in is null) then
    raise exception 'Für dieses Objekt läuft bereits eine Prüfung. Bitte diese zuerst abschließen.';
  end if;
  if p_leiter_id is not null and not exists (select 1 from session_teilnehmer where session_id = s.id and benutzer_id = p_leiter_id) then
    raise exception 'Der Sessionleiter muss an der Prüfung teilgenommen haben';
  end if;
  insert into session_revision (session_id, revision, grund) values (s.id, s.revision + 1, trim(p_grund));
  update session set status = 'offen', revision = s.revision + 1, abgeschlossen_am = null,
         unterschrift_leiter = null, unterschrift_kunde = null, kunde_name = null,
         leiter_id = coalesce(p_leiter_id, s.leiter_id)
   where id = s.id;
  -- Teilnehmer müssen nach der Korrektur erneut fertig melden
  update session_teilnehmer set fertig_am = null where session_id = s.id;
  return s.revision + 1;
end $$;
revoke execute on function session_revision_oeffnen(uuid, text, uuid) from public, anon;
grant execute on function session_revision_oeffnen(uuid, text, uuid) to authenticated;

-- Audit-Log auch für Tabellen ohne Spalte „id“ (z. B. session_revision mit zusammengesetztem Schlüssel)
create or replace function audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  zeile jsonb := to_jsonb(coalesce(new, old));
begin
  insert into audit_log (tabelle, datensatz_id, aktion, alt, neu)
  values (
    tg_table_name,
    coalesce(zeile ->> 'id', concat_ws(':', zeile ->> 'session_id', zeile ->> 'revision', zeile ->> 'benutzer_id')),
    tg_op,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;
