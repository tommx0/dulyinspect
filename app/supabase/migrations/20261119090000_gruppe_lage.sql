-- Version 2.68.0: Gebäude und Etage an den Gruppen der Elemente (Wohnung / Bereich bei Rauchwarnmeldern, Raum / Bereich bei
-- Geräten). Der Bestand eines Objekts hat keine eigene Lage; über ihre Wohnung bzw. ihren Bereich lassen sich seine Melder
-- und Geräte nun einem Gebäude zuordnen (Prüfliste je Gebäude, Protokoll). Beides ist freiwillig, die Elemente erben es von
-- ihrer Gruppe. Wie bei der Anlage freier Text, damit die Werte zu den Gebäuden und Etagen der übrigen Anlagen passen.

alter table anlage_gruppe
  add column gebaeude text check (gebaeude is null or length(trim(gebaeude)) between 1 and 100),
  add column etage text check (etage is null or length(trim(etage)) between 1 and 100);
comment on column anlage_gruppe.gebaeude is 'Gebäude der Gruppe (z. B. „Haus A“), gilt für ihre Elemente; leer = ohne Gebäude';
comment on column anlage_gruppe.etage is 'Etage der Gruppe (z. B. „EG“), gilt für ihre Elemente';

insert into log_bezeichnung (tabelle, spalte, text) values
  ('anlage_gruppe', 'gebaeude', 'Gebäude'),
  ('anlage_gruppe', 'etage', 'Etage')
  on conflict do nothing;
