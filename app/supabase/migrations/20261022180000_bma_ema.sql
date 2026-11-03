-- Version 2.5.0 (docs/KONZEPT-ANLAGEN.md, „Danach“): Brandmeldeanlagen und Alarmanlagen als weitere Anlagenarten.
-- Die Bausteine (Prüfarten, Elemente, Protokolle, Sachkunde) gibt es schon; Felder und Melderarten stehen im Code
-- (src/lib/anlagenarten.ts). Beide Arten sind zunächst ausgeschaltet.
insert into anlagenart (schluessel, name, aktiv, reihenfolge) values
  ('bma', 'Brandmeldeanlagen', false, 3),
  ('ema', 'Alarmanlagen', false, 4)
on conflict (schluessel) do nothing;
