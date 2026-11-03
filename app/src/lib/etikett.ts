// Etikett-IDs: <Präfix der Instanz>-<6 Ziffern Nummer><1 Prüfziffer>, z. B. PK-0000427 (Präfix in firma.etikett_praefix).
// Vor Version 2.12 hießen alle Etiketten FT-00001 (5 Ziffern, ohne Prüfziffer); sie bleiben gültig.
import { APP_ADRESSE } from './konfig'
import { mitMandantencode } from './mandantencode'
import { t } from './sprache'

/** Prüfziffer nach Damm: erkennt jeden einzelnen Tippfehler und jeden Zahlendreher benachbarter Ziffern. */
const DAMM = [
  [0, 3, 1, 7, 5, 9, 8, 6, 4, 2], [7, 0, 9, 2, 1, 5, 4, 8, 6, 3], [4, 2, 0, 6, 8, 7, 1, 3, 5, 9], [1, 7, 5, 0, 9, 8, 3, 4, 2, 6],
  [6, 1, 2, 3, 0, 4, 5, 9, 7, 8], [3, 6, 7, 4, 2, 0, 9, 5, 8, 1], [5, 8, 6, 9, 7, 2, 0, 1, 3, 4], [8, 9, 4, 5, 3, 6, 2, 0, 1, 7],
  [9, 4, 3, 8, 6, 1, 7, 2, 0, 5], [2, 5, 8, 1, 4, 3, 6, 7, 9, 0],
]

/** Prüfziffer zu einer Ziffernfolge (dieselbe Rechnung wie etikett_damm() in der Datenbank). */
export function pruefziffer(ziffern: string): number {
  return [...ziffern].reduce((z, c) => DAMM[z][Number(c)], 0)
}

/** Präfix: 2–3 Buchstaben, nicht FT (das ist den alten Etiketten vorbehalten). */
export const PRAEFIX_MUSTER = /^[A-Z]{2,3}$/

const ALT = /^FT-?(\d+)$/
const NEU = /^([A-Z]{2,3})-?(\d{1,7})$/

/** Neues Format mit falscher Prüfziffer? Dann ist es fast sicher ein Tippfehler. */
export function etikettTippfehler(id: string): string | null {
  const m = id.match(/^([A-Z]{2,3})-(\d{7})$/)
  if (!m || m[1] === 'FT' || pruefziffer(m[2]) === 0) return null
  return t('Die Prüfziffer von {id} passt nicht – vermutlich ein Tippfehler. Bitte die Nummer auf dem Etikett prüfen.', { id })
}

/** Für den Druck lesbarer gruppiert: PK-0000427 → „PK-000 0427“; alte FT-Etiketten bleiben, wie sie sind. */
export function etikettAnzeige(id: string): string {
  const m = id.match(/^([A-Z]{2,3})-(\d{3})(\d{4})$/)
  return m && m[1] !== 'FT' ? `${m[1]}-${m[2]} ${m[3]}` : id
}

/**
 * Etikett-ID aus einem gescannten Code lesen.
 * Unsere QR-Codes enthalten https://<app>/?t=PK-0000427, ältere oder fremde Codes evtl. nur die ID.
 * Liefert null, wenn der Inhalt nicht nach einem Etikett aussieht.
 */
export function etikettAusScan(inhalt: string): string | null {
  const text = inhalt.trim()
  if (!text) return null
  try {
    const url = new URL(text)
    const t = url.searchParams.get('t') ?? new URLSearchParams(url.hash.split('?')[1] ?? '').get('t')
    if (t) return normalisiereEtikett(t)
    const pfad = url.hash.match(/\/(?:anlage|tuer)\/([^/?#]+)/)
    if (pfad) return normalisiereEtikett(decodeURIComponent(pfad[1]))
    return null
  } catch {
    // keine URL
  }
  return /^[a-z]{2,3}-?\d+$/i.test(text.replace(/\s+/g, '')) ? normalisiereEtikett(text) : null
}

/** "pk427", "PK-000 0427" → "PK-0000427"; alte Etiketten: "ft00815", "FT-815" → "FT-00815" */
export function normalisiereEtikett(id: string): string {
  const t = id.replace(/\s+/g, '').toUpperCase()
  const alt = t.match(ALT)
  if (alt) return `FT-${alt[1].padStart(5, '0')}`
  const neu = t.match(NEU)
  return neu ? `${neu[1]}-${neu[2].padStart(7, '0')}` : t
}

/**
 * Inhalt des QR-Codes auf dem Etikett: App-Adresse + ?t=<ID> (funktioniert auch mit der normalen Handykamera),
 * mit Mandantencode der Instanz zusätzlich &k=<Code> (siehe mandantencode.ts).
 */
export function qrInhalt(adresse: string, etikett: string, mandantencode?: string | null): string {
  const basis = adresse.endsWith('/') ? adresse : `${adresse}/`
  return mitMandantencode(`${basis}?t=${encodeURIComponent(etikett)}`, mandantencode)
}

/** Läuft die App eingebettet (z. B. im deploybase-Share-Link)? Dort sind Kamera und Drucken gesperrt. */
export function imFremdenRahmen(): boolean {
  try { return window.self !== window.top } catch { return true }
}

/**
 * Öffentliche Adresse der App für QR-Codes und Hinweise – je Kunde als Build-Variable VITE_APP_ADRESSE
 * oder in konfig.js (Einzelinstanz-Image).
 * Ohne Angabe die aktuelle Adresse (stimmt nur nicht im deploybase-Share-Link, dort Variable setzen).
 */
export const DIREKTE_ADRESSE: string = APP_ADRESSE
  || (typeof window === 'undefined' ? '' : window.location.origin + window.location.pathname.replace(/index\.html$/, ''))
