-- Version 2.20.0: Rauchwarnmelder als weitere Anlagenart, gleiche Bausteine wie BMA/EMA/RWA.
-- Die Anlage ist nur der Behälter (Wohnung, Haus, Liegenschaft), geprüft werden die Melder als Elemente.
-- Felder und Melderarten stehen im Code (src/lib/anlagenarten.ts). Die Art ist zunächst ausgeschaltet.
insert into anlagenart (schluessel, name, aktiv, reihenfolge) values
  ('rauchwarnmelder', 'Rauchwarnmelder', false, 6)
on conflict (schluessel) do nothing;

-- Namen der neuen Eigenschaften für die Logdateien (einbau gibt es schon)
insert into log_bezeichnung (tabelle, spalte, text) values
  ('eigenschaften', 'zugang', 'Zugang / Schlüssel'), ('eigenschaften', 'seriennummer', 'Seriennummer'),
  ('eigenschaften', 'austausch', 'Austauschdatum (laut Aufkleber)'), ('eigenschaften', 'funk', 'Funkvernetzt')
on conflict (tabelle, spalte) do nothing;
