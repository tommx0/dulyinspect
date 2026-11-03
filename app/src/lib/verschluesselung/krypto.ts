// AES-GCM 256 über WebCrypto (docs/KONZEPT-VERSCHLUESSELUNG.md, „Format“). Reine Funktionen, der Schlüssel wird übergeben.
//
// Werte:   enc1.<Schlüssel-ID hex>.<IV base64url>.<Geheimtext base64url>, AAD „instanz_id:tabelle:spalte:id“
// Dateien: „enc1“ (4 Byte) + IV (12 Byte) + Geheimtext, AAD „instanz_id:bucket:pfad“; die Schlüssel-ID steht im Pfad
//          („….k<erste 8 Zeichen>.enc“, dateien.ts), der zugleich AAD ist.
// Die Schlüssel-ID im Wert ist ein Hinweis für den Server (er lehnt Werte mit veraltetem Schlüssel ab) und für das
// Umschlüsseln – geprüft wird beim Entschlüsseln weiterhin nur über AES-GCM.
import { base64urlKodieren, base64urlLesen } from './kodierung'

/** Wie ist_geheimtext() in der Datenbank. */
export const GEHEIMTEXT_MUSTER = /^enc1\.[0-9a-f]{16}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/

export function istGeheimtext(v: unknown): v is string {
  return typeof v === 'string' && GEHEIMTEXT_MUSTER.test(v)
}

/** Schlüssel-ID eines Geheimtexts (wie geheimtext_schluessel() in der Datenbank), sonst null. */
export function geheimtextSchluesselId(v: unknown): string | null {
  return istGeheimtext(v) ? v.split('.')[1] : null
}

export function wertAad(instanzId: string, tabelle: string, spalte: string, id: string): string {
  return `${instanzId}:${tabelle}:${spalte}:${id}`
}

export function dateiAad(instanzId: string, bucket: string, pfad: string): string {
  return `${instanzId}:${bucket}:${pfad}`
}

/** Entschlüsseln fehlgeschlagen: falscher Schlüssel, falsche Zusatzdaten (Instanz, Datensatz, Pfad) oder verändert. */
export class EntschluesselnFehler extends Error {
  grund: 'format' | 'ohne_kopf' | 'pruefung'
  constructor(grund: 'format' | 'ohne_kopf' | 'pruefung') {
    super(grund === 'ohne_kopf' ? 'Datei ohne enc1-Kopf' : grund === 'format' ? 'Kein Geheimtext' : 'Entschlüsseln fehlgeschlagen')
    this.grund = grund
  }
}

const IV_LAENGE = 12
const text = new TextEncoder()
const lesen = new TextDecoder('utf-8', { fatal: true })
export const DATEI_KOPF = text.encode('enc1')

async function aes(schluessel: CryptoKey, iv: Uint8Array<ArrayBuffer>, aad: string, daten: BufferSource): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: text.encode(aad) }, schluessel, daten))
}

/** Mit dem ersten passenden Schlüssel entschlüsseln (beim Schlüsseltausch: neuer und alter). */
async function aesZurueck(schluessel: CryptoKey | readonly CryptoKey[], iv: Uint8Array<ArrayBuffer>, aad: string, daten: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
  for (const s of Array.isArray(schluessel) ? schluessel : [schluessel]) {
    try {
      return await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: text.encode(aad) }, s, daten)
    } catch { /* nächster Schlüssel */ }
  }
  throw new EntschluesselnFehler('pruefung')
}

/** `schluesselId`: Kennung des Schlüssels (16 Zeichen hex), steht im Wert. */
export async function wertVerschluesseln(klartext: string, aad: string, schluessel: CryptoKey, schluesselId: string): Promise<string> {
  if (!/^[0-9a-f]{16}$/.test(schluesselId)) throw new Error('Ungültige Schlüssel-ID')
  const iv = crypto.getRandomValues(new Uint8Array(IV_LAENGE))
  const geheim = await aes(schluessel, iv, aad, text.encode(klartext))
  return `enc1.${schluesselId}.${base64urlKodieren(iv)}.${base64urlKodieren(geheim)}`
}

/** Wirft EntschluesselnFehler – nie den Rohwert zurückgeben. */
export async function wertEntschluesseln(geheimtext: string, aad: string, schluessel: CryptoKey | readonly CryptoKey[]): Promise<string> {
  if (!istGeheimtext(geheimtext)) throw new EntschluesselnFehler('format')
  const [, , iv, geheim] = geheimtext.split('.')
  const klar = await aesZurueck(schluessel, base64urlLesen(iv), aad, base64urlLesen(geheim))
  try { return lesen.decode(klar) } catch { throw new EntschluesselnFehler('pruefung') }
}

export function hatDateiKopf(bytes: Uint8Array): boolean {
  return bytes.length >= DATEI_KOPF.length + IV_LAENGE + 16 && DATEI_KOPF.every((b, i) => bytes[i] === b)
}

export async function bytesVerschluesseln(daten: Uint8Array<ArrayBuffer> | ArrayBuffer, aad: string, schluessel: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LAENGE))
  const geheim = await aes(schluessel, iv, aad, daten)
  const ergebnis = new Uint8Array(DATEI_KOPF.length + IV_LAENGE + geheim.length)
  ergebnis.set(DATEI_KOPF, 0)
  ergebnis.set(iv, DATEI_KOPF.length)
  ergebnis.set(geheim, DATEI_KOPF.length + IV_LAENGE)
  return ergebnis
}

/** Wirft EntschluesselnFehler('ohne_kopf') für Dateien ohne enc1-Kopf (Bedingung 2) und bei falschem Schlüssel/Pfad. */
export async function bytesEntschluesseln(daten: Uint8Array<ArrayBuffer>, aad: string, schluessel: CryptoKey | readonly CryptoKey[]): Promise<ArrayBuffer> {
  if (!hatDateiKopf(daten)) throw new EntschluesselnFehler('ohne_kopf')
  const iv = daten.slice(DATEI_KOPF.length, DATEI_KOPF.length + IV_LAENGE)
  return aesZurueck(schluessel, iv, aad, daten.slice(DATEI_KOPF.length + IV_LAENGE))
}
