// Gescannte Codes auswerten: eigenes Etikett oder Herstellercode (z. B. QR-Aufkleber eines Rauchwarnmelders).
import { etikettAusScan } from './etikett'
import { melderAdresseCode, melderCodeLesen } from './melderCode'

/** Code eines Melders (oder anderen Elements): vom Hersteller aufgedruckt oder ein eigenes Melder-Etikett (src/lib/melderCode.ts). */
export type CodeErgebnis = { art: 'code'; quelle: 'hersteller' | 'eigen'; code: string; hersteller: string | null; modell: string | null; seriennummer: string | null }

export type ScanErgebnis =
  | { art: 'etikett'; etikett: string }
  | CodeErgebnis
  | { art: 'leer' }

/**
 * Ei Electronics: der QR-Code enthält den gedruckten Text „Ei650i-26W25-019DDBD8“
 * (Modell, Fertigung Jahr/Woche, Kennung). Das Austauschdatum steht nur als Text auf dem Aufkleber, nicht im Code.
 */
const EI = /^ei(\d{3,4}[a-z]{0,3})-(\d{2}w\d{2})-([0-9a-f]{6,10})$/i

/** Code für Vergleich und Speicherung vereinheitlichen: Leerraum und Steuerzeichen weg, Großschreibung egal. */
export function herstellercodeNormalisieren(code: string): string {
  // eslint-disable-next-line no-control-regex
  return code.replace(/[\u0000-\u001f\u007f]/g, '').trim()
}

/** Vergleichsschlüssel (Groß-/Kleinschreibung egal, wie der eindeutige Index in der Datenbank). */
export const herstellercodeSchluessel = (code: string) => herstellercodeNormalisieren(code).toLowerCase()

/** Erkennt, was ein gescannter Text ist; bekannte Hersteller liefern zusätzlich Modell und Seriennummer. */
export function scanAuswerten(inhalt: string): ScanErgebnis {
  const code = herstellercodeNormalisieren(inhalt)
  if (!code) return { art: 'leer' }
  // QR-Code aus dem Protokoll oder vom Etikett: App-Adresse mit ?m=<Code> → den Code darin auswerten
  const ausAdresse = melderAdresseCode(code)
  if (ausAdresse) return scanAuswerten(ausAdresse)
  // Eigene Melder-Etiketten zuerst: ihre Form ist eindeutig und das Prüfzeichen schließt Verwechslungen mit Anlagen-Etiketten aus
  const eigen = melderCodeLesen(code)
  if (eigen) return { art: 'code', quelle: 'eigen', code: eigen, hersteller: null, modell: null, seriennummer: null }
  const etikett = etikettAusScan(code)
  if (etikett) return { art: 'etikett', etikett }
  const ei = code.match(EI)
  if (ei) return { art: 'code', quelle: 'hersteller', code, hersteller: 'Ei Electronics', modell: `Ei${ei[1]}`, seriennummer: `${ei[2].toUpperCase()}-${ei[3].toUpperCase()}` }
  return { art: 'code', quelle: 'hersteller', code, hersteller: null, modell: null, seriennummer: null }
}
