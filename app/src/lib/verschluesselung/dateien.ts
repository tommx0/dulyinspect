// Bilder und PDFs der privaten Buckets ver- und entschlüsseln (docs/KONZEPT-VERSCHLUESSELUNG.md, „Dateien“, Bedingung 2).
//
// - Pfade verschlüsselter Dateien enden auf „.k<erste 8 Zeichen der Schlüssel-ID>.enc“, davor steht die ursprüngliche
//   Endung (…/kunde.png.k1a2b3c4d.enc). Der Pfad ist zugleich AAD; an der Kennung erkennen Storage-Policy und Trigger, mit
//   welchem Schlüssel die Datei verschlüsselt ist (veraltete lehnen sie ab), und der Tausch, was noch umzuschlüsseln ist.
// - hochladen() verschlüsselt und lädt mit application/octet-stream hoch, holen() lädt herunter, entschlüsselt und gibt
//   die Datei mit ihrem ursprünglichen Typ zurück (kleiner Speicher für die Sitzung). Ersetzt createSignedUrl(s) für
//   fotos, unterschriften, protokolle und nachweise.
// - Datei ohne enc1-Kopf, Pfad ohne „.enc“, falscher Schlüssel oder anderer Pfad (vertauschte Dateien): DateiNichtLesbar.
//   Während der Umstellung (noch nicht aktiv) werden Dateien unter einem Pfad ohne „.enc“ noch unverändert gezeigt.
// - Ohne eingerichtete Verschlüsselung (Zustand „aus“) geht alles unverändert durch, ebenso neue Dateien, während ein Admin
//   die Verschlüsselung abschaltet.
import { supabase } from '../supabase'
import { t } from '../sprache'
import { istVerschluesselterBucket, type VerschluesselterBucket } from './felder'
import { EntschluesselnFehler, bytesEntschluesseln, bytesVerschluesseln, dateiAad, hatDateiKopf } from './krypto'
import { GesperrtFehler, aktuellerZustand, beiSchluesselwechsel, pruefenAnstossen, schluesselStand, unlesbarMelden } from './schluessel'

export const ENDUNG = '.enc'
export const GEHEIM_TYP = 'application/octet-stream'

const TYPEN: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
}

export type DateiFehlerGrund = 'klartext' | 'ohne_kopf' | 'fehler' | 'ohne_schluessel'

/** Datei nicht anzeigen (Bedingung 2/4). Die Oberfläche zeigt einen Platzhalter „nicht lesbar“. */
export class DateiNichtLesbar extends Error {
  bucket: string
  pfad: string
  grund: DateiFehlerGrund
  constructor(bucket: string, pfad: string, grund: DateiFehlerGrund) {
    super(grund === 'klartext' ? t('Datei ist nicht verschlüsselt') : grund === 'ohne_kopf' ? t('Datei ohne enc1-Kopf')
      : grund === 'ohne_schluessel' ? t('Verschlüsselte Datei, aber kein Schlüssel') : t('Datei lässt sich nicht entschlüsseln'))
    this.bucket = bucket
    this.pfad = pfad
    this.grund = grund
  }
}

/** Pfad ohne „.enc“ und ohne Kennung des Schlüssels (wie verschluesselung_pfad_basis in der Datenbank). */
export function pfadBasis(pfad: string): string {
  return pfad.replace(/(\.k[0-9a-f]{8})?\.enc$/, '')
}

export function istVerschluesselterPfad(pfad: string): boolean {
  return pfad.endsWith(ENDUNG)
}

/** Kennung des Schlüssels im Pfad (8 Zeichen hex, wie verschluesselung_pfad_kennung), sonst null. */
export function pfadKennung(pfad: string): string | null {
  return /\.k([0-9a-f]{8})\.enc$/.exec(pfad)?.[1] ?? null
}

/** Ursprünglicher Typ aus der Endung vor „.enc“ (sonst application/octet-stream). */
export function ursprungsTyp(pfad: string): string {
  const endung = /\.([a-z0-9]+)$/i.exec(pfadBasis(pfad))?.[1]?.toLowerCase()
  return (endung && TYPEN[endung]) || GEHEIM_TYP
}

/** Pfad einer mit diesem Schlüssel verschlüsselten Datei: „<basis>.k<erste 8 Zeichen der Schlüssel-ID>.enc“. */
export function pfadFuer(pfad: string, schluesselId: string): string {
  return `${pfadBasis(pfad)}.k${schluesselId.slice(0, 8)}${ENDUNG}`
}

function bereit(): ReturnType<typeof schluesselStand> {
  const z = aktuellerZustand()
  if (z.art === 'aus') return null
  const st = z.art === 'bereit' ? schluesselStand() : null
  if (!st) throw new GesperrtFehler()
  return st
}

/**
 * Speicherpfad für eine neue Datei: mit eingerichteter Verschlüsselung „<pfad>.k<Schlüssel-ID>.enc“ (während eines eigenen
 * Schlüsseltauschs mit der Kennung des neuen Schlüssels), sonst unverändert. Vor dem Anlegen des Datensatzes
 * (foto.storage_pfad, Unterschrift, Protokoll, Nachweis) aufrufen, damit Datensatz und Datei passen. Wirft GesperrtFehler,
 * solange gesperrt.
 */
export function speicherPfad(pfad: string): string {
  const st = bereit()
  if (!st || st.abschaltung || istVerschluesselterPfad(pfad)) return pfad
  return pfadFuer(pfad, st.schreibId)
}

/** Blob für `pfad` (auf „.enc“) verschlüsseln – z. B. vor dem Ablegen im Gerätespeicher (Dexie `dateien`). Ohne Verschlüsselung unverändert. */
export async function dateiVerschluesseln(bucket: VerschluesselterBucket, pfad: string, blob: Blob): Promise<Blob> {
  const st = bereit()
  if (!st || (st.abschaltung && !istVerschluesselterPfad(pfad))) return blob
  if (pfadKennung(pfad) !== st.schreibId.slice(0, 8)) throw new Error(`Pfad einer verschlüsselten Datei muss auf .k<Schlüssel>${ENDUNG} enden (speicherPfad)`)
  const bytes = await bytesVerschluesseln(new Uint8Array(await blob.arrayBuffer()), dateiAad(st.instanzId, bucket, pfad), st.schreiben)
  return new Blob([bytes], { type: GEHEIM_TYP })
}

/** Verschlüsselten Blob (vom Server oder aus dem Gerätespeicher) entschlüsseln. Wirft DateiNichtLesbar, nie den Rohinhalt. */
export async function dateiEntschluesseln(bucket: VerschluesselterBucket, pfad: string, blob: Blob): Promise<Blob> {
  const st = bereit()
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (!st) {
    if (istVerschluesselterPfad(pfad) || hatDateiKopf(bytes)) {
      pruefenAnstossen()
      throw new DateiNichtLesbar(bucket, pfad, 'ohne_schluessel')
    }
    return blob
  }
  if (!istVerschluesselterPfad(pfad)) {
    // Während der Umstellung der noch nicht umgeschlüsselte Bestand, danach ein Fehler (Bedingung 2)
    if (!st.aktiv && !hatDateiKopf(bytes)) return blob
    unlesbarMelden(1, `${bucket}: Datei ohne Verschlüsselung`)
    throw new DateiNichtLesbar(bucket, pfad, 'klartext')
  }
  try {
    const klar = await bytesEntschluesseln(bytes, dateiAad(st.instanzId, bucket, pfad), st.lesen)
    return new Blob([klar], { type: ursprungsTyp(pfad) })
  } catch (e) {
    unlesbarMelden(1, `${bucket}: Datei nicht entschlüsselbar`)
    throw new DateiNichtLesbar(bucket, pfad, e instanceof EntschluesselnFehler && e.grund === 'ohne_kopf' ? 'ohne_kopf' : 'fehler')
  }
}

/**
 * Verschlüsselt hochladen (application/octet-stream, nie überschreiben). `pfad` ohne oder mit „.enc“; zurück kommt der
 * tatsächliche Speicherpfad (für den Datensatz). Wirft den Fehler von Storage (z. B. „already exists“).
 */
export async function hochladen(bucket: VerschluesselterBucket, pfad: string, blob: Blob): Promise<string> {
  const ziel = speicherPfad(pfad)
  const daten = await dateiVerschluesseln(bucket, ziel, blob)
  const { error } = await supabase.storage.from(bucket).upload(ziel, daten, { contentType: daten.type || blob.type, upsert: false })
  if (error) throw error
  return ziel
}

// ---------------------------------------------------------------------------
// Holen mit Speicher für die Sitzung
// ---------------------------------------------------------------------------
const MAX_CACHE = 200
const cache = new Map<string, Promise<Blob>>()
const urls = new Map<string, string>()

function verdraengen() {
  while (cache.size > MAX_CACHE) {
    const aeltester = cache.keys().next().value!
    cache.delete(aeltester)
    const url = urls.get(aeltester)
    if (url) { URL.revokeObjectURL(url); urls.delete(aeltester) }
  }
}

export function istDateiNichtLesbar(e: unknown): e is DateiNichtLesbar {
  return e instanceof DateiNichtLesbar
}

/** Entschlüsselte Dateien und Blob-URLs verwerfen (bei Schlüsselwechsel, Sperre, Abmelden automatisch). */
export function dateiCacheLeeren() {
  cache.clear()
  for (const url of urls.values()) URL.revokeObjectURL(url)
  urls.clear()
}
beiSchluesselwechsel(dateiCacheLeeren)

/**
 * Datei holen und entschlüsseln (Typ wie vor dem Verschlüsseln: PDF, PNG, JPEG, WebP). Wirft DateiNichtLesbar bzw. den
 * Fehler von Storage (Netz, nicht gefunden). Andere Buckets (branding) unverändert.
 */
export function holen(bucket: string, pfad: string): Promise<Blob> {
  const k = `${bucket}/${pfad}`
  const vorhanden = cache.get(k)
  if (vorhanden) {
    // zuletzt benutzt ans Ende (Verdrängen trifft die ältesten)
    cache.delete(k)
    cache.set(k, vorhanden)
    return vorhanden
  }
  const p = (async () => {
    if (istVerschluesselterBucket(bucket)) bereit()  // gesperrt: gar nicht erst laden
    const { data, error } = await supabase.storage.from(bucket).download(pfad)
    if (error || !data) throw error ?? new Error(t('Datei nicht gefunden'))
    return istVerschluesselterBucket(bucket) ? dateiEntschluesseln(bucket, pfad, data) : data
  })()
  cache.set(k, p)
  p.catch(() => { if (cache.get(k) === p) cache.delete(k) })
  verdraengen()
  return p
}

/**
 * Wie holen(), als Blob-URL für <img>/<iframe>/Download. Bleibt gültig, bis die Datei aus dem Speicher verdrängt oder der
 * Speicher geleert wird (Schlüsselwechsel, Sperre, Abmelden) – nicht selbst freigeben.
 */
export async function holenUrl(bucket: string, pfad: string): Promise<string> {
  const k = `${bucket}/${pfad}`
  const blob = await holen(bucket, pfad)
  const vorhanden = urls.get(k)
  if (vorhanden) return vorhanden
  const url = URL.createObjectURL(blob)
  urls.set(k, url)
  return url
}
