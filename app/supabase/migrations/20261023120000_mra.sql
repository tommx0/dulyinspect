-- Version 2.10.0: Maschinelle RWA (DIN 18232-5) – neue Eigenschaften der Art rwa (src/lib/anlagenarten.ts).
-- Namen für die Logdateien; volumenstrom gilt für die Anlage und für Ventilatoren.
insert into log_bezeichnung (tabelle, spalte, text) values
  ('eigenschaften', 'volumenstrom', 'Auslegungsvolumenstrom'), ('eigenschaften', 'temperaturklasse', 'Temperaturklasse der Ventilatoren')
on conflict (tabelle, spalte) do nothing;
