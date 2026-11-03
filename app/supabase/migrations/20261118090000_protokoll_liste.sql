-- Liste der Prüfprotokolle unter „Übersicht“ (2.65): Admins und Planer sehen alle PDF-Protokolle, Prüfer nur die, die sie
-- allein oder mit anderen unterschrieben haben.
--
-- Wer unterschrieben hat, ergibt sich aus dem Stand beim Speichern des PDFs (das Protokoll gilt einer Revision):
--   - Prüfung je Anlage: der Hauptprüfer (Abschluss nur mit unterschrift_am) und die Mitprüfer mit Status „zugelassen“ und
--     Fertigmeldung (fertig_am). „entfernt“ steht im PDF ohne Unterschrift. Bei einer Tür einer Türanlage zählen die
--     Unterschriften der Türanlage (hauptpruefung).
--   - Termin aus der Zeit der Sessions: der Leiter und die Teilnehmer mit Fertigmeldung.
-- Nach dem Wiederöffnen erlöschen Unterschriften und der Hauptprüfer kann wechseln – deshalb merkt sich jedes Protokoll seine
-- Unterzeichner (und das Ergebnis) beim Speichern, statt sie später aus dem aktuellen Stand der Prüfung abzuleiten.

alter table protokoll add column unterzeichner uuid[] not null default '{}';
alter table protokoll add column ergebnis ampel;
comment on column protokoll.unterzeichner is 'Wer das Protokoll unterschrieben hat (Haupt- und Mitprüfer bzw. Leiter und Teilnehmer), beim Speichern festgehalten';
comment on column protokoll.ergebnis is 'Ergebnis der Prüfung in dieser Revision (Sammelprotokoll: leer)';
create index protokoll_unterzeichner on protokoll using gin (unterzeichner);

insert into log_bezeichnung (tabelle, spalte, text) values
  ('protokoll', 'unterzeichner', 'Unterzeichner'),
  ('protokoll', 'ergebnis', 'Ergebnis')
on conflict do nothing;

-- Unterzeichner einer Prüfung bzw. eines Termins im aktuellen Stand
create function protokoll_unterzeichner_von(p_session_id uuid, p_anlagenpruefung_id uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct x.id), '{}') from (
    select s.leiter_id as id from session s where s.id = p_session_id
    union all
    select t.benutzer_id from session_teilnehmer t where t.session_id = p_session_id and t.fertig_am is not null
    union all
    select ap.pruefer_id from anlagenpruefung ap
     where p_session_id is null and ap.id = hauptpruefung(p_anlagenpruefung_id) and ap.unterschrift_am is not null
    union all
    select mp.benutzer_id from anlagenpruefung_mitpruefer mp
     where p_session_id is null and mp.anlagenpruefung_id = hauptpruefung(p_anlagenpruefung_id)
       and mp.status = 'zugelassen' and mp.fertig_am is not null
  ) x where x.id is not null;
$$;
revoke all on function protokoll_unterzeichner_von(uuid, uuid) from public, anon, authenticated;

-- Beim Speichern festhalten; was die App mitschickt, zählt nicht. Beim Wiederherstellen gilt der Stand aus der Sicherung.
create function protokoll_unterzeichner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('session.revision', true), '') = 'ja' and cardinality(new.unterzeichner) > 0 then
    return new;
  end if;
  new.unterzeichner := protokoll_unterzeichner_von(new.session_id, new.anlagenpruefung_id);
  new.ergebnis := (select ap.ergebnis from anlagenpruefung ap where ap.id = new.anlagenpruefung_id);
  return new;
end $$;
create trigger protokoll_unterzeichner before insert on protokoll
  for each row execute function protokoll_unterzeichner();

-- ---------------------------------------------------------------------------
-- Vorhandene Protokolle nachtragen
-- ---------------------------------------------------------------------------
-- Aktuelle Revision einer abgeschlossenen Prüfung: Stand wie beim Speichern. Ersetzte Revisionen (oder eine gerade wieder
-- geöffnete Prüfung): Die Unterschriften sind erloschen – als Unterzeichner gelten alle, die beteiligt waren (Haupt- und
-- früherer Hauptprüfer, Mitprüfer auch ohne Fertigmeldung bzw. alle Teilnehmer). Das Ergebnis einer ersetzten Revision steht
-- als „alt“ in der ersten Ergebnisänderung der späteren Revisionen.
alter table protokoll disable trigger protokoll_unveraenderlich;
alter table protokoll disable trigger protokoll_log;

update protokoll pr set unterzeichner = case
    when pr.session_id is not null then
      case when pr.revision = s.revision and s.status = 'abgeschlossen' then protokoll_unterzeichner_von(pr.session_id, null)
           else (select coalesce(array_agg(distinct x), '{}') from (
                   select s.leiter_id union all select t.benutzer_id from session_teilnehmer t where t.session_id = s.id) y(x)) end
    when pr.revision = h.revision and h.abgeschlossen_am is not null then protokoll_unterzeichner_von(null, pr.anlagenpruefung_id)
    else (select coalesce(array_agg(distinct x), '{}') from (
            select h.pruefer_id union all select h.urspruenglicher_pruefer_id
            union all select mp.benutzer_id from anlagenpruefung_mitpruefer mp
             where mp.anlagenpruefung_id = h.id and mp.status in ('zugelassen', 'entfernt')) y(x) where x is not null) end,
  ergebnis = coalesce(
    (select (ae.alt ->> 'ergebnis')::ampel from anlagenpruefung_aenderung ae
      where ae.anlagenpruefung_id = pr.anlagenpruefung_id and ae.tabelle = 'anlagenpruefung' and ae.revision > pr.revision
      order by ae.revision, ae.am limit 1),
    ap.ergebnis)
  from protokoll p2
  left join session s on s.id = p2.session_id
  left join anlagenpruefung ap on ap.id = p2.anlagenpruefung_id
  left join anlagenpruefung h on h.id = hauptpruefung(p2.anlagenpruefung_id)
 where p2.id = pr.id;

alter table protokoll enable trigger protokoll_log;
alter table protokoll enable trigger protokoll_unveraenderlich;

-- ---------------------------------------------------------------------------
-- Liste: je Prüfung das Hauptprotokoll (Tür-Protokolle einer Türanlage stehen auf deren Seite), je Termin das
-- Sammelprotokoll. Die Rechte prüft der Server: Admins und Planer alle, sonst nur eigene Unterschriften.
-- Als setof protokoll, damit die App Prüfung, Anlage und Objekt dazu einbetten kann.
-- ---------------------------------------------------------------------------
create function protokoll_liste() returns setof protokoll
language sql stable set search_path = public as $$
  select pr.* from protokoll pr
   where ist_aktiv()
     and (ist_admin() or pr.unterzeichner @> array[auth.uid()])
     and (pr.art = 'sammel' or (pr.session_id is null and not exists (
            select 1 from anlagenpruefung ap where ap.id = pr.anlagenpruefung_id and ap.teil_von_id is not null)))
   order by pr.erzeugt_am desc;
$$;
revoke all on function protokoll_liste() from public, anon;
grant execute on function protokoll_liste() to authenticated;

notify pgrst, 'reload schema';
