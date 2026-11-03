-- Version 2.36.0: Elektrische Anlagen (DIN VDE 0100-600 / 0105-100) und ortsveränderliche Geräte (DIN EN 50678 / 50699)
-- als weitere Anlagenarten, gleiche Bausteine wie die übrigen Arten. Felder, Elementarten und Messgrößen mit Grenzwerten
-- stehen im Code (src/lib/anlagenarten.ts). Beide Arten sind zunächst ausgeschaltet.
insert into anlagenart (schluessel, name, aktiv, reihenfolge) values
  ('elektro', 'Elektrische Anlagen', false, 7),
  ('geraete', 'Ortsveränderliche Geräte', false, 8)
on conflict (schluessel) do nothing;

-- Messwerte je Element und Prüfung, z. B. {"riso": 250, "zs": 0.85}. Die Bewertung gegen die Grenzwerte macht die App
-- (außerhalb → Element „defekt“ mit Mangel); hier nur die Form.
alter table element_ergebnis add column messwerte jsonb not null default '{}'
  constraint element_ergebnis_messwerte_objekt check (jsonb_typeof(messwerte) = 'object');
comment on column element_ergebnis.messwerte is 'Messwerte je Messgröße (Definition im Code: src/lib/anlagenarten.ts, elemente.messungen), z. B. riso, zs, rcd_ta';

-- Namen der neuen Eigenschaften für die Logdateien (seriennummer, zugang gibt es schon)
insert into log_bezeichnung (tabelle, spalte, text) values
  ('eigenschaften', 'netzform', 'Netzform'), ('eigenschaften', 'nennspannung', 'Nennspannung'),
  ('eigenschaften', 'hausanschluss', 'Hausanschlusssicherung'), ('eigenschaften', 'erder', 'Erder'),
  ('eigenschaften', 'verteiler', 'Anzahl Verteiler'), ('eigenschaften', 'ueberspannungsschutz', 'Überspannungsschutz (SPD)'),
  ('eigenschaften', 'umfang', 'Umfang der Prüfung'), ('eigenschaften', 'unterlagen', 'Standort Schaltpläne / Anlagenbuch'),
  ('eigenschaften', 'schutzorgan', 'Schutzorgan'), ('eigenschaften', 'rcd', 'RCD (Bemessungsdifferenzstrom)'),
  ('eigenschaften', 'rcd_typ', 'RCD-Typ'), ('eigenschaften', 'leitung', 'Leitung'), ('eigenschaften', 'stromkreis', 'Stromkreis'),
  ('eigenschaften', 'leistung', 'Bemessungsleistung'), ('eigenschaften', 'abteilung', 'Abteilung / Kostenstelle'),
  ('eigenschaften', 'ansprechpartner', 'Ansprechpartner beim Betreiber'), ('eigenschaften', 'schutzklasse', 'Schutzklasse'),
  ('eigenschaften', 'laenge', 'Leitungslänge'), ('eigenschaften', 'heizung', 'Mit Heizelementen')
on conflict (tabelle, spalte) do nothing;
