-- Version 2.88.0: Brandschutzbegehungen und Feuerlöscher als weitere Anlagenarten.
-- Brandschutzbegehung: die Anlage ist das begangene Gebäude bzw. der Bereich, ohne Elemente, geprüft wird nur die Checkliste.
-- Feuerlöscher: Bestand je Objekt wie Rauchwarnmelder und Geräte (docs/KONZEPT-BESTAND-JE-OBJEKT.md), die Löscher sind die
-- Elemente mit Fälligkeit je Löscher. Felder und Löscherarten stehen im Code (src/lib/anlagenarten.ts). Beide Arten sind
-- zunächst ausgeschaltet.
insert into anlagenart (schluessel, name, aktiv, reihenfolge) values
  ('brandschutz', 'Brandschutzbegehungen', false, 11),
  ('feuerloescher', 'Feuerlöscher', false, 12)
on conflict (schluessel) do nothing;

create or replace function bestand_art(p_art text) returns boolean
language sql immutable set search_path = public as $$ select coalesce(p_art in ('rauchwarnmelder', 'geraete', 'feuerloescher'), false) $$;

-- Namen der neuen Eigenschaften für die Logdateien (seriennummer gibt es schon)
insert into log_bezeichnung (tabelle, spalte, text) values
  ('eigenschaften', 'gebaeudeklasse', 'Gebäudeklasse'), ('eigenschaften', 'sonderbau', 'Sonderbau'),
  ('eigenschaften', 'geschosse', 'Anzahl Geschosse'), ('eigenschaften', 'brandschutzkonzept', 'Brandschutzkonzept / -nachweis vorhanden'),
  ('eigenschaften', 'brandschutzordnung', 'Brandschutzordnung (DIN 14096) vorhanden'),
  ('eigenschaften', 'rettungsplaene', 'Flucht- und Rettungspläne (DIN ISO 23601)'), ('eigenschaften', 'feuerwehrplaene', 'Feuerwehrpläne (DIN 14095)'),
  ('eigenschaften', 'brandschutzhelfer', 'Anzahl Brandschutzhelfer'), ('eigenschaften', 'unterlagen', 'Standort der Brandschutzunterlagen'),
  ('eigenschaften', 'fuellmenge', 'Füllmenge'), ('eigenschaften', 'loescheinheiten', 'Löschmitteleinheiten (LE)'),
  ('eigenschaften', 'bauart', 'Bauart'), ('eigenschaften', 'baujahr', 'Herstelljahr'),
  ('eigenschaften', 'druckpruefung', 'Nächste Druckbehälterprüfung / Instandsetzung')
on conflict (tabelle, spalte) do nothing;
