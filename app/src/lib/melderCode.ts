// Eigene Melder-Codes für Etiketten, wenn ein Melder keinen brauchbaren Herstellercode trägt.
// Format: „M“ + 8 zufällige Zeichen + 1 Prüfzeichen, z. B. M4F7K2QXD3 (gedruckt in zwei Zeilen: M4F7K / 2QXD3).
// Der QR-Code enthält die App-Adresse mit ?m=<Code>, damit auch die normale Handykamera zum Melder führt.
// Die Codes entstehen im Browser und werden erst beim ersten Scan einem Melder zugewiesen (anlage_element.code,
// eindeutig). Das Alphabet lässt I, L, O, U und Z weg; 31 Zeichen, damit das Prüfzeichen (Summe mod 31) jeden
// einzelnen Tippfehler und jeden Zahlendreher benachbarter Zeichen erkennt.
import { mitMandantencode } from './mandantencode'

const ZEICHEN = '0123456789ABCDEFGHJKMNPQRSTVWXY'
const LAENGE = 8

function pruefzeichen(nutzlast: string): string {
  let summe = 0
  for (let i = 0; i < nutzlast.length; i++) summe += (i + 1) * ZEICHEN.indexOf(nutzlast[i])
  return ZEICHEN[summe % ZEICHEN.length]
}

/** Zufallsbytes; in Tests austauschbar. */
export type Zufall = (anzahl: number) => Uint8Array
const echterZufall: Zufall = (n) => crypto.getRandomValues(new Uint8Array(n))

/** Ein neuer Code. Gleichmäßig verteilt: Bytes ab 248 werden verworfen (248 = 31 × 8). */
export function melderCodeErzeugen(zufall: Zufall = echterZufall): string {
  let nutzlast = ''
  while (nutzlast.length < LAENGE) {
    for (const b of zufall(LAENGE * 2)) {
      if (b < 248 && nutzlast.length < LAENGE) nutzlast += ZEICHEN[b % ZEICHEN.length]
    }
  }
  return `M${nutzlast}${pruefzeichen(nutzlast)}`
}

/** Mehrere verschiedene Codes auf einmal. */
export function melderCodesErzeugen(anzahl: number, zufall?: Zufall): string[] {
  const codes = new Set<string>()
  while (codes.size < anzahl) codes.add(melderCodeErzeugen(zufall))
  return [...codes]
}

const MUSTER = new RegExp(`^M[${ZEICHEN}]{${LAENGE + 1}}$`)

/** Eingabe vereinheitlichen: Großbuchstaben, ohne Leerzeichen und Striche, O → 0, I/L → 1, U → V. */
function bereinigen(text: string): string {
  return text.toUpperCase().replace(/[\s\-_]+/g, '').replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V')
}

function codeAusInhalt(inhalt: string): string {
  const t = inhalt.trim()
  try {
    const url = new URL(t)
    return url.searchParams.get('m') ?? new URLSearchParams(url.hash.split('?')[1] ?? '').get('m') ?? ''
  } catch {
    return t
  }
}

/**
 * Code aus einer Melder-Adresse (…/?m=<Code>) – auch ein Herstellercode, den das Protokoll als QR-Code in dieser Form trägt.
 * Liefert null, wenn der Inhalt keine Adresse mit ?m= ist.
 */
export function melderAdresseCode(inhalt: string): string | null {
  try {
    const url = new URL(inhalt.trim())
    return url.searchParams.get('m') ?? new URLSearchParams(url.hash.split('?')[1] ?? '').get('m')
  } catch {
    return null
  }
}

/** Sieht die Eingabe wie ein eigener Melder-Code aus (Form passt, Prüfzeichen noch nicht geprüft)? */
export function istMelderCodeForm(inhalt: string): boolean {
  return MUSTER.test(bereinigen(codeAusInhalt(inhalt)))
}

/**
 * Eigenen Melder-Code lesen: reiner Code (auch mit Leerzeichen/Strichen eingetippt) oder die Adresse aus dem QR-Code
 * (…/?m=M4F7K2QXD3). Liefert die Schreibweise zum Speichern oder null, wenn es keiner ist oder das Prüfzeichen nicht passt.
 */
export function melderCodeLesen(inhalt: string): string | null {
  const code = bereinigen(codeAusInhalt(inhalt))
  if (!MUSTER.test(code)) return null
  return pruefzeichen(code.slice(1, LAENGE + 1)) === code[LAENGE + 1] ? code : null
}

/** Zum Lesen und Drucken in zwei Gruppen: M4F7K 2QXD3. Fremde Codes bleiben, wie sie sind. */
export function codeAnzeige(code: string): string {
  return melderCodeLesen(code) === code ? `${code.slice(0, 5)} ${code.slice(5)}` : code
}

/** Inhalt des QR-Codes: App-Adresse + ?m=<Code> (funktioniert auch mit der normalen Handykamera), dazu &k=<Mandantencode>. */
export function melderQrInhalt(adresse: string, code: string, mandantencode?: string | null): string {
  const basis = adresse.endsWith('/') ? adresse : `${adresse}/`
  return mitMandantencode(`${basis}?m=${encodeURIComponent(code)}`, mandantencode)
}
