-- Version 2.9.0: Rauch- und Wärmeabzugsanlagen (RWA) als weitere Anlagenart, gleiche Bausteine wie BMA/EMA.
-- Felder und Komponentenarten stehen im Code (src/lib/anlagenarten.ts). Die Art ist zunächst ausgeschaltet.
insert into anlagenart (schluessel, name, aktiv, reihenfolge) values
  ('rwa', 'Rauch- und Wärmeabzugsanlagen', false, 5)
on conflict (schluessel) do nothing;

-- Namen der neuen Eigenschaften für die Logdateien (vorhandene wie batterie, pruefbuch, einbau gibt es schon)
insert into log_bezeichnung (tabelle, spalte, text) values
  ('eigenschaften', 'bauart', 'Bauart'), ('eigenschaften', 'energie', 'Energieversorgung'),
  ('eigenschaften', 'rauchabschnitte', 'Anzahl Rauchabschnitte / Gruppen'), ('eigenschaften', 'geraete', 'Anzahl Rauchabzugsgeräte'),
  ('eigenschaften', 'automatisch', 'Automatische Auslösung (Rauchmelder)'), ('eigenschaften', 'bma_ansteuerung', 'Ansteuerung durch Brandmeldeanlage'),
  ('eigenschaften', 'lueftung', 'Lüftungsfunktion / Wind-Regen-Automatik'), ('eigenschaften', 'flaeche', 'Aerodynamisch wirksame Fläche')
on conflict (tabelle, spalte) do nothing;
