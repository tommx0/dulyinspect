-- Version 2.13.0: Sachkundenachweis als Datei (PDF oder Foto, z. B. mit der Handykamera) je Benutzer und Anlagenart.
-- Die Datei liegt im privaten Bucket „nachweise“ unter <benutzer_id>/<anlagenart>/<zufällige ID>.<endung>.
-- Hochladen, ersetzen und löschen dürfen nur Admins (wie die übrige Benutzerverwaltung);
-- lesen dürfen Admins und der Benutzer selbst, Kollegen sehen nur den Nachweis-Text im Protokoll.

alter table benutzer_sachkunde
  add column datei_pfad text,
  add column datei_name text;
comment on column benutzer_sachkunde.datei_pfad is 'Nachweis-Datei im Bucket nachweise (PDF oder Bild), leer = keine Datei';
comment on column benutzer_sachkunde.datei_name is 'Ursprünglicher Dateiname zur Anzeige';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nachweise', 'nachweise', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy nachweise_lesen on storage.objects for select to authenticated
  using (bucket_id = 'nachweise' and (public.ist_systemadmin() or (storage.foldername(name))[1] = auth.uid()::text));
create policy nachweise_admin on storage.objects for all to authenticated
  using (bucket_id = 'nachweise' and public.ist_systemadmin())
  with check (bucket_id = 'nachweise' and public.ist_systemadmin());

insert into log_bezeichnung (tabelle, spalte, text) values
  ('benutzer_sachkunde', 'datei_name', 'Nachweis-Datei'), ('benutzer_sachkunde', 'datei_pfad', 'Nachweis-Datei (Speicherort)')
on conflict (tabelle, spalte) do nothing;
