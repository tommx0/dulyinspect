// Was der Supportzugang (Fernwartung) in der Benutzerverwaltung darf. Ohne Abhängigkeiten, damit src/lib/support-rechte.test.ts
// es mit vitest prüfen kann.
//
// Der Supportzugang ist ein Admin ohne zweiten Faktor, freigeschaltet für 60 oder 120 Minuten. Er hilft bei Zugängen von
// Planern und Prüfern (Passwort, zweiter Faktor, Name, aktiv), darf sich aber nicht über das Zeitfenster hinaus festsetzen:
// keine neuen Zugänge, keine Admin-Rolle vergeben und keine Admin-Zugänge ändern (sonst Passwort und zweiten Faktor eines
// echten Admins zurücksetzen und mit dessen Zugang weitermachen).

/** Fehlertext, wenn der Supportzugang die Aktion nicht ausführen darf, sonst null. */
export function supportVerbot(aktion: unknown, ziel: { rolle?: string } | null, body: { rolle?: unknown }): string | null {
  switch (aktion) {
    case "anlegen":
      return "Der Supportzugang kann keine Zugänge anlegen";
    case "aktualisieren":
    case "passwort":
    case "zwei_faktor_zuruecksetzen":
      if (!ziel) return "Benutzer nicht gefunden";
      if (ziel.rolle === "admin") return "Der Supportzugang kann Admin-Zugänge nicht ändern";
      if (body.rolle === "admin") return "Der Supportzugang kann die Admin-Rolle nicht vergeben";
      return null;
    case "support_freischalten":
      return "Der Supportzugang kann sich nicht selbst freischalten";
    default:
      return null;
  }
}
