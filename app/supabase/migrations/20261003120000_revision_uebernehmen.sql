-- Revision: Die Sessionleitung kann die abgeschlossene Türprüfung eines anderen Prüfers übernehmen und korrigieren.
-- Sie wird damit Prüfer dieser Tür (unterschreibt sie beim Abschluss); der ursprüngliche Prüfer bleibt vermerkt.
-- Außerdem: Fertigmeldungen werden nicht mehr bei jeder Revision für alle zurückgesetzt, sondern nur für den,
-- dessen Tür wieder geöffnet wird – wer nichts ändert, muss nicht erneut unterschreiben.

alter table tuerpruefung
  add column urspruenglicher_pruefer_id uuid references benutzer (id),
  add column uebernommen_am timestamptz;

-- Prüfer einer Türprüfung bleibt unveränderlich – außer bei der Übernahme in einer Revision (nur per RPC)
create or replace function tuerpruefung_vor_aendern() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.session_id <> old.session_id or new.tuer_id <> old.tuer_id
     or (new.pruefer_id <> old.pruefer_id and coalesce(current_setting('tuerpruefung.uebernehmen', true), '') <> 'ja') then
    raise exception 'Session, Tür und Prüfer einer Türprüfung sind unveränderlich';
  end if;
  -- Ein Duplikat bleibt Duplikat, bis der Sessionleiter es klärt (Sync des Geräts darf das nicht überschreiben)
  if old.status = 'duplikat' and new.status <> 'duplikat'
     and coalesce(current_setting('tuerpruefung.aufloesen', true), '') <> 'ja' then
    new.status := 'duplikat';
    new.duplikat_von := old.duplikat_von;
    new.duplikat_geklaert := old.duplikat_geklaert;
  end if;
  -- Übernahme-Vermerk kann das Gerät nicht verändern
  if coalesce(current_setting('tuerpruefung.uebernehmen', true), '') <> 'ja' then
    new.urspruenglicher_pruefer_id := old.urspruenglicher_pruefer_id;
    new.uebernommen_am := old.uebernommen_am;
  end if;
  return new;
end $$;

-- Tür wieder geöffnet → Fertigmeldung dieses Prüfers gilt nicht mehr (muss nach der Korrektur neu unterschreiben)
create function tuerpruefung_wieder_geoeffnet() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'geprueft' and new.status = 'in_pruefung' then
    update session_teilnehmer set fertig_am = null
     where session_id = new.session_id and benutzer_id = new.pruefer_id and fertig_am is not null;
  end if;
  return null;
end $$;
create trigger tuerpruefung_wieder_geoeffnet after update of status on tuerpruefung
  for each row execute function tuerpruefung_wieder_geoeffnet();

-- RPC: abgeschlossene Tür eines anderen Prüfers in der Revision übernehmen (nur Sessionleitung)
create function pruefung_uebernehmen(p_tuerpruefung_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  tp tuerpruefung;
  s session;
begin
  select * into tp from tuerpruefung where id = p_tuerpruefung_id for update;
  if tp.id is null then raise exception 'Prüfung nicht gefunden'; end if;
  select * into s from session where id = tp.session_id;
  if s.status <> 'offen' or s.revision = 0 then raise exception 'Türen anderer Prüfer können nur in einer Revision übernommen werden'; end if;
  if not ist_leiter(s.id) then raise exception 'Nur die Sessionleitung kann Türen übernehmen'; end if;
  if tp.pruefer_id = auth.uid() then return; end if;
  if tp.status <> 'geprueft' then raise exception 'Nur abgeschlossene Türprüfungen können übernommen werden'; end if;
  perform set_config('tuerpruefung.uebernehmen', 'ja', true);
  update tuerpruefung
     set urspruenglicher_pruefer_id = coalesce(urspruenglicher_pruefer_id, pruefer_id), pruefer_id = auth.uid(),
         uebernommen_am = now(), status = 'in_pruefung', beendet_am = null, letzte_aktivitaet = now()
   where id = tp.id;
  perform set_config('tuerpruefung.uebernehmen', '', true);
end $$;
revoke execute on function pruefung_uebernehmen(uuid) from public, anon;
grant execute on function pruefung_uebernehmen(uuid) to authenticated;

-- Fotos zu einer übernommenen (eigenen, offenen) Prüfung darf der neue Prüfer löschen, auch wenn er sie nicht aufgenommen hat
create policy foto_loeschen_eigene_pruefung on foto for delete to authenticated
  using (ist_aktiv() and (
    (bezug_typ = 'antwort' and exists (select 1 from antwort a where a.id = foto.bezug_id and ist_eigene_offene_pruefung(a.tuerpruefung_id)))
    or (bezug_typ = 'mangel' and exists (select 1 from mangel m where m.id = foto.bezug_id and ist_eigene_offene_pruefung(m.entdeckt_in)))
  ));

-- Revision öffnen: Fertigmeldungen bleiben bestehen (siehe Trigger oben)
create or replace function session_revision_oeffnen(p_session_id uuid, p_grund text, p_leiter_id uuid default null) returns int
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
  return s.revision + 1;
end $$;
