// Umstellung Tür → Anlage (Version 2.0): alte Namen aus App 1.x, Offline-Speicher und Datensicherungen übersetzen.

/** Alter Name → neuer Name (Tabellen, Spalten, Funktionen, Parameter). Die Türkategorie bleibt. */
export function nameUmbenennen(name: string): string {
  return name.replace(/tuerpruefung/g, 'anlagenpruefung').replace(/tuertyp/g, 'anlagentyp')
    .replace(/(?<![A-Za-z])tuer(?!_kategorie)(?![A-Za-z])/g, 'anlage')
}

/** Spaltennamen einer Zeile übersetzen; Fotos an einer Tür hängen jetzt an einer Anlage. */
export function felderUmbenennen<T extends object>(zeile: T): T {
  const neu = Object.fromEntries(Object.entries(zeile).map(([k, v]) => [nameUmbenennen(k), v])) as Record<string, unknown>
  if (neu.bezug_typ === 'tuer') neu.bezug_typ = 'anlage'
  return neu as T
}
