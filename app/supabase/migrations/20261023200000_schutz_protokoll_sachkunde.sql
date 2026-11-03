-- Sicherheit: Angaben, die auf Prüfprotokollen stehen, darf nur noch berechtigtes Personal setzen.
-- 1. Name und Sachkunde-Hinweis eines Benutzers ändern nur Admins (bisher konnte jeder sein eigenes Profil ändern).
-- 2. Protokoll-PDFs und -Einträge legen nur Teilnehmer der Prüfung, Planer oder Admins an – und nur für die
--    abgeschlossene, aktuelle Revision unter <session_id>/r<revision>/<datei>. Bisher durfte jeder aktive Benutzer
--    beliebige Dateien in den Bucket legen, auch vorab unter dem erwarteten Namen eines künftigen Protokolls.

-- ---------------------------------------------------------------------------
-- 1. Benutzerprofil
-- ---------------------------------------------------------------------------
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
  -- Beides steht auf den Protokollen; die Pflege läuft über die Benutzerverwaltung (Edge Function)
  if not ist_systemadmin() and (new.name, new.sachkunde_hinweis) is distinct from (old.name, old.sachkunde_hinweis) then
    raise exception 'Nur Admins dürfen Name und Sachkunde-Hinweis ändern';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Protokolle
-- ---------------------------------------------------------------------------
-- Pfad <session_id>/r<revision>/<datei> einer abgeschlossenen Prüfung in ihrer aktuellen Revision,
-- und der Aufrufer hat an ihr teilgenommen oder darf verwalten
create function protokoll_pfad_erlaubt(p_pfad text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(array_length(string_to_array(p_pfad, '/'), 1) = 3 and split_part(p_pfad, '/', 3) <> '', false)
     and exists (
       select 1 from session s
        where s.id::text = split_part(p_pfad, '/', 1)
          and split_part(p_pfad, '/', 2) = 'r' || s.revision
          and s.status = 'abgeschlossen'
          and (ist_teilnehmer(s.id) or ist_admin()));
$$;
revoke all on function protokoll_pfad_erlaubt(text) from public, anon;
grant execute on function protokoll_pfad_erlaubt(text) to authenticated;

drop policy protokolle_hochladen on storage.objects;
create policy protokolle_hochladen on storage.objects for insert to authenticated
  with check (bucket_id = 'protokolle' and public.protokoll_pfad_erlaubt(name));

drop policy protokoll_anlegen on protokoll;
create policy protokoll_anlegen on protokoll for insert to authenticated
  with check (
    protokoll_pfad_erlaubt(storage_pfad)
    and split_part(storage_pfad, '/', 1) = session_id::text
    and split_part(storage_pfad, '/', 2) = 'r' || revision
    and case art
      when 'sammel' then anlagenpruefung_id is null
      else exists (select 1 from anlagenpruefung ap where ap.id = anlagenpruefung_id and ap.session_id = protokoll.session_id)
    end);
