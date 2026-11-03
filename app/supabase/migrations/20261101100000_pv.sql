-- Version 2.36.0: Photovoltaikanlagen (DIN EN 62446-1 / VDE 0126-23-1) mit und ohne Batteriespeicher als weitere Anlagenart.
-- Die Stränge sind Elemente mit Messwerten (element_ergebnis.messwerte). Felder, Strangarten und Messgrößen stehen im Code
-- (src/lib/anlagenarten.ts). Die Art ist zunächst ausgeschaltet.
insert into anlagenart (schluessel, name, aktiv, reihenfolge) values
  ('pv', 'Photovoltaikanlagen', false, 9)
on conflict (schluessel) do nothing;

-- Namen der neuen Eigenschaften für die Logdateien
insert into log_bezeichnung (tabelle, spalte, text) values
  ('eigenschaften', 'kwp', 'Anlagenleistung'), ('eigenschaften', 'montage', 'Montage'), ('eigenschaften', 'einspeisung', 'Betriebsweise'),
  ('eigenschaften', 'na_schutz', 'NA-Schutz'), ('eigenschaften', 'speicher', 'Batteriespeicher'), ('eigenschaften', 'speicher_kwh', 'Speicherkapazität'),
  ('eigenschaften', 'speicher_kopplung', 'Kopplung des Speichers'), ('eigenschaften', 'ersatzstrom', 'Not- / Ersatzstrom'),
  ('eigenschaften', 'feuerwehrschalter', 'DC-Freischaltstelle (Feuerwehrschalter)'), ('eigenschaften', 'blitzschutz', 'Äußerer Blitzschutz'),
  ('eigenschaften', 'mastr', 'Marktstammdatenregister-Nr.'), ('eigenschaften', 'netzbetreiber', 'Netzbetreiber'),
  ('eigenschaften', 'module_anzahl', 'Anzahl Module'), ('eigenschaften', 'modul', 'Modul'), ('eigenschaften', 'uoc_modul', 'Leerlaufspannung Modul (STC)'),
  ('eigenschaften', 'isc_modul', 'Kurzschlussstrom Modul (STC)'), ('eigenschaften', 'ausrichtung', 'Ausrichtung / Neigung'),
  ('eigenschaften', 'strangsicherung', 'Strangsicherung')
on conflict (tabelle, spalte) do nothing;
