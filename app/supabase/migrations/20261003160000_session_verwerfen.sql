-- Prüfung verwerfen: offene Prüfung ohne abgeschlossene Tür löschen (z. B. versehentlich oder zum Test gestartet).
-- Kein Protokoll, keine Protokollnummer. Sobald eine Tür ein Ergebnis hat, bleibt nur der reguläre Abschluss.

create function session_verwerfen(p_session_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  s session;
  pruefungen uuid[];
begin
  select * into s from session where id = p_session_id for update;
  if s.id is null then return; end if;  -- schon weg (z. B. erneuter Aufruf)
  if not (ist_leiter(s.id) or ist_admin()) then raise exception 'Nur die Sessionleitung, ein Planer oder Admin kann die Prüfung verwerfen'; end if;
  if s.status <> 'offen' then raise exception 'Abgeschlossene Prüfungen können nicht verworfen werden'; end if;
  if s.revision > 0 then raise exception 'Eine Revision kann nicht verworfen werden – bitte regulär abschließen'; end if;
  if exists (select 1 from tuerpruefung where session_id = s.id and status in ('geprueft', 'nicht_geprueft')) then
    raise exception 'Es gibt bereits abgeschlossene Türen – bitte die Prüfung regulär abschließen';
  end if;

  select coalesce(array_agg(id), '{}') into pruefungen from tuerpruefung where session_id = s.id;

  -- In dieser Prüfung als behoben bestätigte frühere Mängel wieder öffnen
  update mangel set status = case when behoben_am is not null then 'behoben'::mangel_status else 'offen'::mangel_status end, nachgeprueft_in = null
   where nachgeprueft_in = any (pruefungen);
  -- In dieser Prüfung festgestellte Mängel und alle Fotos dazu
  delete from foto where bezug_typ = 'mangel' and bezug_id in (select id from mangel where entdeckt_in = any (pruefungen));
  delete from foto where bezug_typ = 'antwort' and bezug_id in (select id from antwort where tuerpruefung_id = any (pruefungen));
  delete from mangel where entdeckt_in = any (pruefungen);
  delete from antwort where tuerpruefung_id = any (pruefungen);
  update tuerpruefung set duplikat_von = null where session_id = s.id;
  delete from tuerpruefung where session_id = s.id;
  delete from session_teilnehmer where session_id = s.id;
  delete from session where id = s.id;  -- tuerpruefung_freigabe per Kaskade
end $$;
revoke execute on function session_verwerfen(uuid) from public, anon;
grant execute on function session_verwerfen(uuid) to authenticated;
