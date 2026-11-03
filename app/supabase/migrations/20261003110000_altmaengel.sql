-- Bewertung offener Mängel aus früheren Prüfungen („besteht weiter“ / „behoben“) an der Türprüfung speichern,
-- damit sie auf jedem Gerät gilt (vorher nur lokal). „behoben“ setzt weiterhin zusätzlich mangel.status = 'nachgeprueft'.
alter table tuerpruefung add column altmaengel jsonb not null default '{}'::jsonb
  constraint tuerpruefung_altmaengel_objekt check (jsonb_typeof(altmaengel) = 'object');
