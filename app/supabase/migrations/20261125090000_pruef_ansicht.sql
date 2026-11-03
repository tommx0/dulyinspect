-- Version 2.85.0: Ansicht, in der eine Prüfung öffnet (Protokollblatt oder Liste), legt der Admin für die Firma fest.
-- Wer in der Prüfung umschaltet, behält seine Wahl auf diesem Gerät (localStorage, src/lib/ansicht.ts).

alter table firma add column pruef_ansicht text not null default 'protokoll'
  constraint firma_pruef_ansicht_check check (pruef_ansicht in ('protokoll', 'liste'));
comment on column firma.pruef_ansicht is 'Standardansicht der laufenden Prüfung: protokoll oder liste; ein Gerät darf abweichen';

insert into log_bezeichnung (tabelle, spalte, text) values ('firma', 'pruef_ansicht', 'Ansicht der Prüfung')
on conflict (tabelle, spalte) do nothing;
