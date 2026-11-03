-- Mehrpersonenprüfung: Eine Anlage kann von mehreren Prüfern gemeinsam geprüft werden.
-- Ob das möglich ist, legt der Admin je Anlagentyp fest. Wer mitprüfen will, fragt beim Hauptprüfer an
-- (der die Anlage zuerst geöffnet hat); erst nach seiner Zulassung darf der Mitprüfer Antworten, Elementergebnisse,
-- Mängel und Fotos der Prüfung erfassen. Abschluss, Gesamtergebnis und Entscheidung zu Altmängeln bleiben beim Hauptprüfer.

alter table anlagentyp add column mehrpersonenpruefung boolean not null default false;
comment on column anlagentyp.mehrpersonenpruefung is 'Mehrere Prüfer dürfen eine Anlage dieses Typs gemeinsam prüfen (der Hauptprüfer lässt sie zu)';

-- ---------------------------------------------------------------------------
-- 1. Mitprüfer einer Anlagenprüfung
-- ---------------------------------------------------------------------------
create table anlagenpruefung_mitpruefer (
  anlagenpruefung_id uuid not null references anlagenpruefung (id) on delete cascade,
  session_id uuid not null references session (id) on delete cascade,
  benutzer_id uuid not null references benutzer (id),
  status text not null default 'angefragt' check (status in ('angefragt', 'zugelassen', 'abgelehnt')),
  angefragt_am timestamptz not null default now(),
  entschieden_am timestamptz,
  primary key (anlagenpruefung_id, benutzer_id)
);
create index on anlagenpruefung_mitpruefer (session_id);
comment on table anlagenpruefung_mitpruefer is 'Anfrage und Zulassung zum Mitprüfen; geschrieben wird nur über mitpruefung_anfragen/-entscheiden/-beenden';

alter table anlagenpruefung_mitpruefer enable row level security;
create policy anlagenpruefung_mitpruefer_lesen on anlagenpruefung_mitpruefer for select to authenticated using (ist_aktiv());
create policy zwei_faktor on anlagenpruefung_mitpruefer as restrictive for all to authenticated
  using ((select zwei_faktor_erfuellt())) with check ((select zwei_faktor_erfuellt()));
revoke insert, update, delete on anlagenpruefung_mitpruefer from authenticated;

select log_ueberwachen('anlagenpruefung_mitpruefer');
insert into log_bezeichnung (tabelle, spalte, text) values
  ('anlagenpruefung_mitpruefer', '', 'Mitprüfer'),
  ('anlagenpruefung_mitpruefer', 'status', 'Status'),
  ('anlagentyp', 'mehrpersonenpruefung', 'Mehrpersonenprüfung')
  on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Zugelassene Mitprüfer schreiben wie der Hauptprüfer (solange die Prüfung läuft)
-- ---------------------------------------------------------------------------
create or replace function ist_eigene_offene_pruefung(p_anlagenpruefung_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from anlagenpruefung tp join session s on s.id = tp.session_id
    where tp.id = p_anlagenpruefung_id and s.status = 'offen'
      and (tp.pruefer_id = auth.uid()
           or (tp.status = 'in_pruefung' and exists (
                 select 1 from anlagenpruefung_mitpruefer m
                  where m.anlagenpruefung_id = tp.id and m.benutzer_id = auth.uid() and m.status = 'zugelassen')))
  ) and ist_aktiv();
$$;

-- ---------------------------------------------------------------------------
-- 3. Anfragen, zulassen, beenden
-- ---------------------------------------------------------------------------
create function mitpruefung_anfragen(p_anlagenpruefung_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  tp anlagenpruefung;
  erlaubt boolean;
  art text;
  art_name text;
  pflicht boolean;
  ergebnis text;
begin
  select * into tp from anlagenpruefung where id = p_anlagenpruefung_id;
  if tp.id is null then raise exception 'Prüfung nicht gefunden'; end if;
  if not ist_teilnehmer(tp.session_id) then raise exception 'Sie nehmen an dieser Prüfung nicht teil'; end if;
  if not session_offen(tp.session_id) then raise exception 'Die Prüfung ist bereits abgeschlossen'; end if;
  if tp.status <> 'in_pruefung' then raise exception 'Diese Anlage wird nicht mehr geprüft'; end if;
  if tp.pruefer_id = auth.uid() then raise exception 'Das ist Ihre eigene Prüfung'; end if;
  select ty.mehrpersonenpruefung, ty.anlagenart, ar.name, ar.sachkunde_pflicht into erlaubt, art, art_name, pflicht
    from anlage a join anlagentyp ty on ty.id = a.anlagentyp_id join anlagenart ar on ar.schluessel = ty.anlagenart
   where a.id = tp.anlage_id;
  if not coalesce(erlaubt, false) then raise exception 'Für diesen Anlagentyp ist keine Mehrpersonenprüfung eingeschaltet'; end if;
  if pflicht and not hat_sachkunde(auth.uid(), art) then
    raise exception 'Für % ist bei Ihnen keine gültige Sachkunde hinterlegt. Admin: unter „Benutzer“ eintragen.', art_name;
  end if;
  insert into anlagenpruefung_mitpruefer (anlagenpruefung_id, session_id, benutzer_id)
    values (tp.id, tp.session_id, auth.uid())
    on conflict (anlagenpruefung_id, benutzer_id) do update
      set status = 'angefragt', angefragt_am = now(), entschieden_am = null
      where anlagenpruefung_mitpruefer.status = 'abgelehnt';
  select status into ergebnis from anlagenpruefung_mitpruefer where anlagenpruefung_id = tp.id and benutzer_id = auth.uid();
  return ergebnis;
end $$;

create function mitpruefung_entscheiden(p_anlagenpruefung_id uuid, p_benutzer_id uuid, p_zulassen boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  tp anlagenpruefung;
begin
  select * into tp from anlagenpruefung where id = p_anlagenpruefung_id;
  if tp.id is null then raise exception 'Prüfung nicht gefunden'; end if;
  if tp.pruefer_id <> auth.uid() then raise exception 'Nur der Hauptprüfer kann das Mitprüfen zulassen'; end if;
  if not session_offen(tp.session_id) or tp.status <> 'in_pruefung' then raise exception 'Diese Prüfung läuft nicht mehr'; end if;
  update anlagenpruefung_mitpruefer
     set status = case when p_zulassen then 'zugelassen' else 'abgelehnt' end, entschieden_am = now()
   where anlagenpruefung_id = tp.id and benutzer_id = p_benutzer_id and status = 'angefragt';
  if not found then raise exception 'Es liegt keine offene Anfrage vor'; end if;
end $$;

-- Hauptprüfer entfernt einen Mitprüfer, oder der Mitprüfer zieht seine Anfrage zurück bzw. verlässt die Prüfung
create function mitpruefung_beenden(p_anlagenpruefung_id uuid, p_benutzer_id uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  tp anlagenpruefung;
  wer uuid := coalesce(p_benutzer_id, auth.uid());
begin
  select * into tp from anlagenpruefung where id = p_anlagenpruefung_id;
  if tp.id is null then return; end if;
  if not (tp.pruefer_id = auth.uid() or wer = auth.uid()) then
    raise exception 'Nur der Hauptprüfer oder der Mitprüfer selbst kann das beenden';
  end if;
  if not session_offen(tp.session_id) then raise exception 'Die Prüfung ist bereits abgeschlossen'; end if;
  delete from anlagenpruefung_mitpruefer where anlagenpruefung_id = tp.id and benutzer_id = wer;
end $$;

revoke all on function mitpruefung_anfragen(uuid) from public, anon, authenticated;
revoke all on function mitpruefung_entscheiden(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function mitpruefung_beenden(uuid, uuid) from public, anon, authenticated;
grant execute on function mitpruefung_anfragen(uuid) to authenticated;
grant execute on function mitpruefung_entscheiden(uuid, uuid, boolean) to authenticated;
grant execute on function mitpruefung_beenden(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Gleichzeitig dieselbe Antwort / dasselbe Element erfasst (z. B. offline): die spätere Eingabe gilt
-- ---------------------------------------------------------------------------
create function antwort_gleicher_punkt() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  alt uuid;
begin
  select id into alt from antwort where anlagenpruefung_id = new.anlagenpruefung_id and punkt_id = new.punkt_id and id <> new.id;
  if alt is not null then
    update foto set bezug_id = new.id where bezug_typ = 'antwort' and bezug_id = alt;
    delete from antwort where id = alt;
  end if;
  return new;
end $$;
create trigger antwort_gleicher_punkt before insert on antwort for each row execute function antwort_gleicher_punkt();

create function element_ergebnis_gleiches_element() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from element_ergebnis where anlagenpruefung_id = new.anlagenpruefung_id and element_id = new.element_id and id <> new.id;
  return new;
end $$;
create trigger element_ergebnis_gleiches_element before insert on element_ergebnis for each row execute function element_ergebnis_gleiches_element();

-- ---------------------------------------------------------------------------
-- 5. Live-Stand: Änderungen an den Prüfdaten auch auf den Geräten der Mitprüfer
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['antwort', 'element_ergebnis', 'mangel', 'foto', 'anlagenpruefung_mitpruefer'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
