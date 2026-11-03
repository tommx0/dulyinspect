-- Version 2.86.0: Spaltenbreiten des Protokollblatts (Prüfung in der Protokollansicht) legt der Admin für die Firma fest.
-- Die Beschriftungen der Anlagendaten brechen um, sobald sie breiter als ihr Anteil wären; die Ergebnisspalte der
-- Prüfpunkte hat einen festen Anteil. Beides in Prozent der Blattbreite, damit Werte nie zusammengedrückt werden.

alter table firma
  add column blatt_beschriftung_breite smallint not null default 20
    constraint firma_blatt_beschriftung_breite_check check (blatt_beschriftung_breite between 10 and 35),
  add column blatt_ergebnis_breite smallint not null default 42
    constraint firma_blatt_ergebnis_breite_check check (blatt_ergebnis_breite between 25 and 60);
comment on column firma.blatt_beschriftung_breite is 'Protokollblatt: höchste Breite einer Beschriftungsspalte der Anlagendaten in Prozent';
comment on column firma.blatt_ergebnis_breite is 'Protokollblatt: Breite der Ergebnisspalte der Prüfpunkte in Prozent';

insert into log_bezeichnung (tabelle, spalte, text) values
  ('firma', 'blatt_beschriftung_breite', 'Protokollblatt: Breite der Beschriftung'),
  ('firma', 'blatt_ergebnis_breite', 'Protokollblatt: Breite der Ergebnisspalte')
on conflict (tabelle, spalte) do nothing;
