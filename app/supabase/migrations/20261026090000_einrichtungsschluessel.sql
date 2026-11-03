-- Einrichtungsschlüssel: Die Ersteinrichtung (erster Admin, Edge Function „ersteinrichtung“) verlangt einen Schlüssel,
-- den nur kennt, wer die Instanz ausgerollt hat. Vorher wurde Admin, wer die Adresse zuerst aufrief.
-- Die Ausroll-Skripte zeigen ihn an; von Hand: select schluessel from intern.einrichtungsschluessel;
-- Eigenes Schema „intern“: nicht über die API erreichbar, nicht in Datensicherung und Logdateien.
-- Die Edge Function löscht den Schlüssel, sobald der erste Admin angelegt ist.
create schema if not exists intern;
revoke all on schema intern from public, anon, authenticated;

create table intern.einrichtungsschluessel (
  schluessel text not null check (schluessel ~ '^[0-9A-F]{20}$'),
  angelegt timestamptz not null default now()
);
revoke all on intern.einrichtungsschluessel from public, anon, authenticated;

-- Nur für Instanzen ohne Zugang: 20 Hex-Zeichen (80 Bit Zufall), angezeigt als XXXX-XXXX-XXXX-XXXX-XXXX
insert into intern.einrichtungsschluessel (schluessel)
select upper(left(md5(gen_random_uuid()::text || gen_random_uuid()::text), 20))
where not exists (select 1 from auth.users);
