// Feldliste der Verschlüsselung (docs/KONZEPT-VERSCHLUESSELUNG.md, „Feldliste“). Muss zu verschluesselung_felder() in der
// Migration supabase/migrations/20261107090000_verschluesselung.sql passen – felder.test.ts vergleicht beide.

/** Spalten mit Geheimtext je Tabelle; „eigenschaften.<name>“ ist ein Eintrag im JSON der Eigenschaften. */
export const WERT_FELDER = {
  endkunde: ['name', 'strasse', 'plz', 'ort', 'ansprechpartner', 'email', 'telefon', 'notiz'],
  objekt: ['name', 'strasse', 'plz', 'ort', 'zugangshinweise'],
  anlagenpruefung: ['kunde_name'],
  session: ['kunde_name'],
  anlage: ['eigenschaften.ansprechpartner'],
  benutzer_sachkunde: ['datei_name'],
} as const

export type VerschluesselteTabelle = keyof typeof WERT_FELDER

export const VERSCHLUESSELTE_BUCKETS = ['fotos', 'unterschriften', 'protokolle', 'nachweise'] as const
export type VerschluesselterBucket = (typeof VERSCHLUESSELTE_BUCKETS)[number]

/** Spalten mit Pfaden verschlüsselter Dateien (Pfad endet auf „.enc“). */
export const PFAD_FELDER: readonly { tabelle: string; spalte: string; bucket: VerschluesselterBucket }[] = [
  { tabelle: 'foto', spalte: 'storage_pfad', bucket: 'fotos' },
  { tabelle: 'protokoll', spalte: 'storage_pfad', bucket: 'protokolle' },
  { tabelle: 'benutzer_sachkunde', spalte: 'datei_pfad', bucket: 'nachweise' },
  { tabelle: 'anlagenpruefung', spalte: 'unterschrift', bucket: 'unterschriften' },
  { tabelle: 'anlagenpruefung', spalte: 'kunde_unterschrift', bucket: 'unterschriften' },
  { tabelle: 'anlagenpruefung_mitpruefer', spalte: 'unterschrift', bucket: 'unterschriften' },
  { tabelle: 'session', spalte: 'unterschrift_leiter', bucket: 'unterschriften' },
  { tabelle: 'session', spalte: 'unterschrift_kunde', bucket: 'unterschriften' },
  { tabelle: 'session_teilnehmer', spalte: 'unterschrift', bucket: 'unterschriften' },
]

/** Schlüsselspalten je Tabelle (wie verschluesselung_schluesselspalten in der Migration). */
export const SCHLUESSEL_SPALTEN: Record<string, readonly string[]> = {
  endkunde: ['id'],
  objekt: ['id'],
  anlagenpruefung: ['id'],
  session: ['id'],
  anlage: ['id'],
  foto: ['id'],
  protokoll: ['id'],
  benutzer_sachkunde: ['benutzer_id', 'anlagenart'],
  anlagenpruefung_mitpruefer: ['anlagenpruefung_id', 'benutzer_id'],
  session_teilnehmer: ['session_id', 'benutzer_id'],
}

export function istVerschluesselteTabelle(t: string): t is VerschluesselteTabelle {
  return Object.hasOwn(WERT_FELDER, t)
}

export function istVerschluesselterBucket(b: string): b is VerschluesselterBucket {
  return (VERSCHLUESSELTE_BUCKETS as readonly string[]).includes(b)
}

/**
 * Kennung einer Zeile für die Zusatzdaten (AAD) – `id`, bei zusammengesetzten Schlüsseln die Werte mit „/“
 * (z. B. benutzer_sachkunde: `<benutzer_id>/<anlagenart>`). null, wenn eine Schlüsselspalte fehlt.
 */
export function zeilenId(tabelle: string, zeile: Record<string, unknown>): string | null {
  const spalten = SCHLUESSEL_SPALTEN[tabelle] ?? ['id']
  const teile = spalten.map((s) => zeile[s])
  if (teile.some((t) => t == null || t === '')) return null
  return teile.map(String).join('/')
}

/** Wert eines Felds lesen („eigenschaften.<name>“ im JSON der Eigenschaften). */
export function feldLesen(zeile: Record<string, unknown>, spalte: string): unknown {
  const [a, b] = spalte.split('.')
  if (b === undefined) return zeile[a]
  const o = zeile[a]
  return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>)[b] : undefined
}

/** Ob das Feld in der Zeile vorkommt (bei Eigenschaften: der Eintrag im JSON). */
export function feldVorhanden(zeile: Record<string, unknown>, spalte: string): boolean {
  const [a, b] = spalte.split('.')
  if (!Object.hasOwn(zeile, a)) return false
  if (b === undefined) return true
  const o = zeile[a]
  return !!o && typeof o === 'object' && !Array.isArray(o) && Object.hasOwn(o, b)
}

/** Feld in einer Kopie setzen (Eigenschaften werden mit kopiert); `undefined` entfernt es. */
export function feldSetzen<T extends Record<string, unknown>>(zeile: T, spalte: string, wert: unknown): T {
  const [a, b] = spalte.split('.')
  const neu: Record<string, unknown> = { ...zeile }
  if (b === undefined) {
    if (wert === undefined) delete neu[a]
    else neu[a] = wert
  } else {
    const o = { ...(zeile[a] as Record<string, unknown> | null ?? {}) }
    if (wert === undefined) delete o[b]
    else o[b] = wert
    neu[a] = o
  }
  return neu as T
}
