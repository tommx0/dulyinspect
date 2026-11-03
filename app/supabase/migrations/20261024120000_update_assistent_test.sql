-- Erste Migration über den Update-Assistenten (2.15.1): ändert nur die Beschreibung von schema_stand(),
-- keine Tabellen, keine Daten. Dient dazu, den Assistenten auf allen Instanzen einmal echt auszuprobieren.
comment on function schema_stand() is 'Neueste eingespielte Migration (Version). Die App prüft damit beim Start, ob die Datenbank zu ihr passt; sonst Update-Assistent.';
