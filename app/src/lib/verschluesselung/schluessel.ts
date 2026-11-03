// Firmenschlüssel auf dem Gerät und Prüfung der Instanz (docs/KONZEPT-VERSCHLUESSELUNG.md, „Firmenschlüssel“,
// „Trennung der Mandanten“ Bedingung 3, „Abgang eines Mitarbeiters“).
//
// Zustand der App (useVerschluesselung): Erst nach pruefen() ist klar, ob die Instanz verschlüsselt ist und das Gerät den
// passenden Schlüssel hat. Bis dahin (und bei falscher Instanz, ohne Schlüssel, während eines fremden Tauschs) lehnen
// werte.ts und dateien.ts jedes Ver- und Entschlüsseln ab, instanzPruefen() jeden Abgleich – die Oberfläche zeigt einen
// Sperrbildschirm (src/components/Verschluesselungssperre.tsx, eingebunden in src/auth.tsx).
import { useSyncExternalStore } from 'react'
import { db, metaLesen, metaSchreiben } from '../../offline/db'
import { loggen } from '../log'
import { fehlertext, supabase } from '../supabase'
import { t, tMeldung } from '../sprache'
import { base32Kodieren, base32Lesen, base64urlKodieren, base64urlLesen, hexKodieren } from './kodierung'
import { wertAad, wertEntschluesseln, wertVerschluesseln } from './krypto'

/** Frist ohne erfolgreichen Abgleich mit dem Server, danach wird der Schlüssel vom Gerät gelöscht. */
export const FRIST_MS = 14 * 86_400_000
/** Ab so viel Restzeit warnt die App vor dem Ablauf der Frist. */
export const WARNUNG_MS = 3 * 86_400_000
/**
 * Stichtag (ISO-Datum): Ab dann startet die App auf einer Instanz ohne Verschlüsselung nicht mehr (Bedingung 1).
 * Noch nicht festgelegt – erst scharf schalten, wenn alle Instanzen umgestellt sind.
 */
export const STICHTAG: string | null = null

const PRUEFTEXT = 'tpk1-pruefwert'
/** Inhalt des Abschaltnachweises (nur wer den Schlüssel hat, kann ihn erzeugen) */
const NACHWEISTEXT = 'tpk1-abgeschaltet'
const QR_PRAEFIX = 'tpk1'
const SCHLUESSEL_BYTES = 32

export const META_SCHLUESSEL = {
  /** aktueller Schlüssel (GespeicherterSchluessel) */
  schluessel: 'verschluesselung:schluessel',
  /** neuer Schlüssel während eines eigenen Schlüsseltauschs */
  tausch: 'verschluesselung:tausch',
  /** alter Schlüssel nach einem Tausch, bis das Gerät seine lokalen Daten umgeschlüsselt hat (geraet.ts) */
  alt: 'verschluesselung:alt',
  /** Zeitpunkt des letzten erfolgreichen Abgleichs (Bedingung 3), für die Frist */
  abgleich: 'verschluesselung:abgleich',
  /** letzter Stand vom Server (für den Start ohne Netz) */
  server: 'verschluesselung:server',
  /** neuer Schlüssel beim Einrichten, solange der Server die Kennung noch nicht bestätigt hat (vor der RPC abgelegt) */
  einrichten: 'verschluesselung:einrichten',
  /** Schlüsselblatt noch nicht als verwahrt bestätigt ({ welcher, schluesselId }) – bis dahin kein Umschlüsseln, kein stilles Löschen */
  blatt: 'verschluesselung:blatt',
  /** Gerätespeicher muss nach dem Wechsel auf „aktiv“ noch verschlüsselt werden (bleibt bis zum Erfolg) */
  nachziehen: 'verschluesselung:nachziehen',
  /** Gerätespeicher muss nach dem Beginn der Abschaltung noch entschlüsselt werden (bleibt bis zum Erfolg) */
  abschalten: 'verschluesselung:abschalten',
  /** Schlüssel wurde nach Ablauf der Frist gelöscht (für die Meldung auf dem Sperrbildschirm) */
  frist: 'verschluesselung:frist',
} as const

/** Alle Einträge der Verschlüsselung im Gerätespeicher (meta) */
export const ALLE_META = Object.values(META_SCHLUESSEL)

export interface GespeicherterSchluessel {
  instanzId: string
  schluesselId: string
  schluessel: CryptoKey
  /** Admin-Geräte: exportierbar (Schlüsselblatt neu drucken), Prüfer-Geräte nicht */
  exportierbar: boolean
  gespeichertAm: number
}

/** Antwort von verschluesselung_kennung() */
export interface ServerKennung {
  berechtigt: boolean
  eingerichtet?: boolean
  aktiv?: boolean
  instanz_id?: string | null
  schluessel_id?: string | null
  pruefwert?: string | null
  tausch_seit?: string | null
  tausch_von?: string | null
  tausch_schluessel_id?: string | null
  tausch_pruefwert?: string | null
  /** Verschlüsselung abgeschaltet (dann eingerichtet: false, Kennung und Nachweis bleiben) */
  abgeschaltet?: boolean
  abschaltung_seit?: string | null
  abschaltnachweis?: string | null
}

export type Zustand =
  /** noch nicht geprüft – alles gesperrt */
  | { art: 'unbekannt' }
  /** Instanz ohne Verschlüsselung: App wie bisher */
  | { art: 'aus' }
  /**
   * Schlüssel passt. `aktiv`: Umstellung abgeschlossen; `tausch`: dieses Gerät tauscht gerade den Schlüssel;
   * `abschaltung`: ein Admin schaltet die Verschlüsselung gerade ab (neue Werte und Dateien gehen als Klartext hinaus)
   */
  | { art: 'bereit'; instanzId: string; schluesselId: string; aktiv: boolean; tausch: boolean; abschaltung: boolean; exportierbar: boolean; letzterAbgleich: number }
  /**
   * Schlüsselblatt scannen: fehlt auf dem Gerät, wurde getauscht, nach der Frist gelöscht – oder die Verschlüsselung wurde
   * abgeschaltet und der Gerätespeicher enthält noch Geheimtext, den nur das bisherige Blatt lesbar macht
   */
  | { art: 'scannen'; grund: 'fehlt' | 'getauscht' | 'frist' | 'abgeschaltet' }
  /** Verschlüsselung abgeschaltet, Nachweis passt: das Gerät entschlüsselt seinen Gerätespeicher und löscht den Schlüssel */
  | { art: 'abgeschaltet' }
  /** Bedingung 3/4: Server und Gerät passen nicht zusammen */
  | { art: 'falsche_instanz'; grund: string }
  /** ein Admin tauscht gerade den Schlüssel (auf einem anderen Gerät) */
  | { art: 'tausch' }
  /** nach dem Stichtag ohne Verschlüsselung (Bedingung 1) */
  | { art: 'pflicht' }

/** Ver-/Entschlüsseln ohne freigegebenen Schlüssel (Sperrbildschirm, noch nicht geprüft) */
export class GesperrtFehler extends Error {
  constructor() { super(t('Die Daten sind gesperrt (Schlüssel fehlt oder Instanz nicht geprüft).')) }
}
/** Bedingung 3: Server gehört nicht zum Schlüssel des Geräts – nichts senden, nichts übernehmen */
export class FalscheInstanzFehler extends Error {
  constructor(grund: string) { super(t('Falsche Instanz: {grund}', { grund: tMeldung(grund) })) }
}
/** Prüfung nicht möglich (keine Verbindung, nicht angemeldet) – wie ein Netzwerkfehler behandeln */
export class NichtPruefbarFehler extends Error {}
/** Schlüssel einlesen fehlgeschlagen – Meldung für die Oberfläche */
export class SchluesselFehler extends Error {}

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------
let zustand: Zustand = { art: 'unbekannt' }
/** Bedingung 4 hat angeschlagen: bleibt gesperrt, bis jemand „Erneut prüfen“ wählt (entsperrenVersuchen) */
let alarmGrund: string | null = null
let geraet: GespeicherterSchluessel | null = null
let tauschSchluessel: GespeicherterSchluessel | null = null
let geladen = false
let letztePruefung = 0
/** Schlüsselblatt noch nicht bestätigt (H2): dieses Gerät hält womöglich den einzigen Schlüssel */
let blattOffenWert: 'aktuell' | 'tausch' | null = null
/** Zuletzt „berechtigt: false“ an die App gemeldet (höchstens alle 30 Sekunden) */
let unberechtigtGemeldet = 0
const hoerer = new Set<() => void>()
const beiWechsel = new Set<() => void>()
const beiUnberechtigt = new Set<() => void>()

function setze(neu: Zustand) {
  const vorher = zustand
  zustand = neu
  const schluesselAnders = vorher.art !== neu.art || (vorher.art === 'bereit' && neu.art === 'bereit'
    && (vorher.schluesselId !== neu.schluesselId || vorher.tausch !== neu.tausch))
  if (schluesselAnders) beiWechsel.forEach((h) => h())
  hoerer.forEach((h) => h())
}

export function aktuellerZustand(): Zustand {
  return zustand
}

/** Ob der Zustand die App sperrt (src/auth.tsx). Admins dürfen bei „pflicht“ weiter, um die Verschlüsselung einzurichten. */
export function appGesperrt(z: Zustand, systemadmin: boolean): boolean {
  return z.art === 'unbekannt' || z.art === 'scannen' || z.art === 'falsche_instanz' || z.art === 'tausch' || z.art === 'abgeschaltet'
    || (z.art === 'pflicht' && !systemadmin)
}

export function zustandBeobachten(h: () => void): () => void {
  hoerer.add(h)
  return () => { hoerer.delete(h) }
}

/** Für werte.ts/dateien.ts: Merkspeicher leeren, sobald sich Schlüssel oder Zustand ändern. */
export function beiSchluesselwechsel(h: () => void): () => void {
  beiWechsel.add(h)
  return () => { beiWechsel.delete(h) }
}

export function useVerschluesselung(): Zustand {
  return useSyncExternalStore(zustandBeobachten, aktuellerZustand)
}

/**
 * Schlüsselblatt noch nicht als verwahrt bestätigt: 'aktuell' nach dem Einrichten, 'tausch' nach dem Vorbereiten eines
 * Tauschs, sonst null. Solange es offen ist, hält dieses Gerät den einzigen Schlüssel – kein Umschlüsseln, kein stilles Löschen.
 */
export function blattOffen(): 'aktuell' | 'tausch' | null {
  return blattOffenWert
}

/** Wie blattOffen(), liest den Gerätespeicher bei Bedarf erst (z. B. beim Abmelden vor der ersten Prüfung). */
export async function blattOffenLaden(): Promise<'aktuell' | 'tausch' | null> {
  await laden()
  return blattOffenWert
}

export function useBlattOffen(): 'aktuell' | 'tausch' | null {
  return useSyncExternalStore(zustandBeobachten, blattOffen)
}

/** Der Server meldet `berechtigt: false`, obwohl eine Sitzung besteht (deaktiviert?) – src/auth.tsx lädt dann das Profil neu. */
export function beiNichtBerechtigt(h: () => void): () => void {
  beiUnberechtigt.add(h)
  return () => { beiUnberechtigt.delete(h) }
}

export interface SchluesselStand {
  instanzId: string
  /** zum Entschlüsseln (beim eigenen Tausch: neuer und alter) */
  lesen: CryptoKey[]
  /** zum Verschlüsseln (beim eigenen Tausch: der neue) */
  schreiben: CryptoKey
  schreibId: string
  /** Umstellung abgeschlossen – ab dann gilt Klartext als Fehler (Bedingung 2) */
  aktiv: boolean
  /** dieses Gerät tauscht gerade den Schlüssel (neue Dateien bekommen die Kennung des neuen Schlüssels im Pfad) */
  tausch: boolean
  /** Abschaltung läuft: neue Werte und Dateien als Klartext schreiben, beides lesen */
  abschaltung: boolean
}

/** Schlüssel für werte.ts/dateien.ts – null, solange nicht freigegeben. */
export function schluesselStand(): SchluesselStand | null {
  if (zustand.art !== 'bereit' || !geraet) return null
  const t = zustand.tausch ? tauschSchluessel : null
  return {
    instanzId: geraet.instanzId,
    lesen: t ? [t.schluessel, geraet.schluessel] : [geraet.schluessel],
    schreiben: (t ?? geraet).schluessel,
    schreibId: (t ?? geraet).schluesselId,
    aktiv: zustand.aktiv,
    tausch: !!t,
    abschaltung: zustand.abschaltung,
  }
}

/** Nur für das Umschlüsseln: beide Schlüssel einzeln. */
export function schluesselFuerTausch(): { alt: GespeicherterSchluessel; neu: GespeicherterSchluessel | null } | null {
  if (zustand.art !== 'bereit' || !geraet) return null
  return { alt: geraet, neu: zustand.tausch ? tauschSchluessel : null }
}

/**
 * Beim Abmelden und Löschen des Gerätespeichers (src/auth.tsx, lokalesVergessen): nichts mehr im Arbeitsspeicher halten.
 * Den Schlüssel in Dexie löscht lokaleDatenLoeschen (Tabelle meta).
 */
export function schluesselVergessen() {
  geraet = null
  tauschSchluessel = null
  geladen = false
  letztePruefung = 0
  alarmGrund = null
  fehlerZeiten = []
  blattOffenWert = null
  unberechtigtGemeldet = 0
  setze({ art: 'unbekannt' })
}

/**
 * Nur die Schlüssel vom Gerät löschen, der übrige Gerätespeicher (auch die Outbox, sie ist Geheimtext) bleibt – z. B. wenn
 * die Sitzung von außen endet und noch Änderungen ausstehen (src/auth.tsx). Nach erneutem Anmelden und Scannen geht die
 * Outbox mit demselben Schlüssel hinaus. Ein noch nicht bestätigtes Schlüsselblatt hält den einzigen Schlüssel: dann bleibt
 * er (Ergebnis false).
 */
export async function schluesselEntfernen(optionen: { auchUnbestaetigt?: boolean } = {}): Promise<boolean> {
  await laden()
  if (blattOffenWert && !optionen.auchUnbestaetigt) return false
  await db.meta.bulkDelete(ALLE_META)
  schluesselVergessen()
  return true
}

/**
 * Gerätespeicher leeren, die Schlüssel aber behalten – beim Abmelden und wenn die Sitzung endet (src/auth.tsx), damit nicht
 * nach jeder Nacht das Schlüsselblatt gescannt werden muss. Ohne Anmeldung nützt der Schlüssel nichts; den Abgang eines
 * Mitarbeiters fangen Deaktivieren, gesperrte Anmeldung und die Frist ohne Serverkontakt ab. Steht noch etwas in der Outbox,
 * bleibt der ganze Gerätespeicher (Geheimtext) für die nächste Anmeldung – außer `auchOutbox` (Abmelden von Hand, das
 * Verwerfen hat der Benutzer bestätigt).
 */
/** Liegt ein Schlüssel der Verschlüsselung auf diesem Gerät (auch ein neuer beim Einrichten oder Tausch)? */
export async function schluesselAufGeraet(): Promise<boolean> {
  return (await db.meta.bulkGet([META_SCHLUESSEL.schluessel, META_SCHLUESSEL.tausch, META_SCHLUESSEL.einrichten])).some(Boolean)
}

export async function geraetLeerenSchluesselBehalten(optionen: { auchOutbox?: boolean } = {}): Promise<void> {
  if (!optionen.auchOutbox && await db.outbox.count() > 0) return
  await Promise.all(db.tables.filter((t) => t.name !== db.meta.name).map((t) => t.clear()))
  await db.meta.where('schluessel').noneOf(ALLE_META).delete()
  schluesselVergessen()
}

// ---------------------------------------------------------------------------
// Schlüssel erzeugen, importieren, Prüfwert, Schlüsselblatt
// ---------------------------------------------------------------------------
export async function schluesselIdBerechnen(roh: Uint8Array<ArrayBuffer>): Promise<string> {
  return hexKodieren(new Uint8Array(await crypto.subtle.digest('SHA-256', roh)).slice(0, 8))
}

export function schluesselImportieren(roh: Uint8Array<ArrayBuffer>, exportierbar: boolean): Promise<CryptoKey> {
  if (roh.length !== SCHLUESSEL_BYTES) throw new SchluesselFehler(t('Der Schlüssel ist unvollständig.'))
  return crypto.subtle.importKey('raw', roh, { name: 'AES-GCM', length: 256 }, exportierbar, ['encrypt', 'decrypt'])
}

export function pruefwertErzeugen(schluessel: CryptoKey, instanzId: string, schluesselId: string): Promise<string> {
  return wertVerschluesseln(PRUEFTEXT, wertAad(instanzId, 'verschluesselung', 'pruefwert', '1'), schluessel, schluesselId)
}

export async function pruefwertPruefen(schluessel: CryptoKey, instanzId: string, pruefwert: string): Promise<boolean> {
  try {
    return await wertEntschluesseln(pruefwert, wertAad(instanzId, 'verschluesselung', 'pruefwert', '1'), schluessel) === PRUEFTEXT
  } catch {
    return false
  }
}

/**
 * Abschaltnachweis (Konzept „Abschalten der Verschlüsselung“): fester Text, mit dem Schlüssel verschlüsselt. Geräte mit
 * Schlüssel glauben eine Abschaltung nur, wenn sie ihn lesen können – den Prüfwert kennt der Server dagegen schon.
 */
export function abschaltnachweisErzeugen(schluessel: CryptoKey, instanzId: string, schluesselId: string): Promise<string> {
  return wertVerschluesseln(NACHWEISTEXT, wertAad(instanzId, 'verschluesselung', 'abschaltnachweis', '1'), schluessel, schluesselId)
}

export async function abschaltnachweisPruefen(schluessel: CryptoKey, instanzId: string, nachweis: string | null | undefined): Promise<boolean> {
  if (!nachweis) return false
  try {
    return await wertEntschluesseln(nachweis, wertAad(instanzId, 'verschluesselung', 'abschaltnachweis', '1'), schluessel) === NACHWEISTEXT
  } catch {
    return false
  }
}

/** Inhalt des QR-Codes auf dem Schlüsselblatt: tpk1:<instanz_id>:<schlüssel base64url> */
export function qrInhalt(instanzId: string, roh: Uint8Array): string {
  return `${QR_PRAEFIX}:${instanzId}:${base64urlKodieren(roh)}`
}

/** Schlüssel zum Abtippen: Crockford-Base32 in Gruppen à 4 Zeichen (52 Zeichen, Groß-/Kleinschreibung egal). */
export function schluesselText(roh: Uint8Array): string {
  return base32Kodieren(roh).match(/.{1,4}/g)!.join(' ')
}

/** QR-Inhalt oder abgetippten Text lesen. instanzId fehlt beim abgetippten Text (dann gilt die Instanz des Servers). */
export function schluesselLesen(text: string): { instanzId: string | null; roh: Uint8Array<ArrayBuffer> } {
  const eingabe = text.trim()
  const qr = /^tpk1:([0-9a-f-]{36}):([A-Za-z0-9_-]{43})$/i.exec(eingabe)
  try {
    const roh = qr ? base64urlLesen(qr[2]) : new Uint8Array(base32Lesen(eingabe))
    if (roh.length !== SCHLUESSEL_BYTES) throw new Error('Länge')
    return { instanzId: qr ? qr[1].toLowerCase() : null, roh }
  } catch {
    throw new SchluesselFehler(eingabe.startsWith(`${QR_PRAEFIX}:`) ? t('Der QR-Code des Schlüsselblatts ist unvollständig.')
      : t('Das ist kein Schlüsselblatt dieser App. Bitte den QR-Code des Schlüsselblatts scannen oder den Schlüssel vollständig abtippen.'))
  }
}

export interface Schluesselblatt {
  instanzId: string
  schluesselId: string
  /** Inhalt des QR-Codes */
  qr: string
  /** Schlüssel zum Abtippen (Gruppen à 4 Zeichen) */
  text: string
}

async function blattAus(g: GespeicherterSchluessel): Promise<Schluesselblatt> {
  if (!g.exportierbar || !g.schluessel.extractable) throw new SchluesselFehler(t('Auf diesem Gerät lässt sich der Schlüssel nicht anzeigen (nur Admin-Geräte).'))
  const roh = new Uint8Array(await crypto.subtle.exportKey('raw', g.schluessel))
  return { instanzId: g.instanzId, schluesselId: g.schluesselId, qr: qrInhalt(g.instanzId, roh), text: schluesselText(roh) }
}

/** Daten für das Schlüsselblatt (nur Admin-Geräte): aktueller oder – während eines Tauschs – neuer Schlüssel. */
export async function schluesselblatt(welcher: 'aktuell' | 'tausch' = 'aktuell'): Promise<Schluesselblatt> {
  await laden()
  const g = welcher === 'tausch' ? tauschSchluessel : geraet
  if (!g) throw new SchluesselFehler(welcher === 'tausch' ? t('Kein neuer Schlüssel vorbereitet.') : t('Kein Schlüssel auf diesem Gerät.'))
  return blattAus(g)
}

async function neuErzeugen(instanzId: string, vermeiden?: string): Promise<{ g: GespeicherterSchluessel; pruefwert: string; roh: Uint8Array<ArrayBuffer> }> {
  for (;;) {
    const roh = crypto.getRandomValues(new Uint8Array(SCHLUESSEL_BYTES))
    const schluesselId = await schluesselIdBerechnen(roh)
    // Die Kennung im Dateipfad sind die ersten 8 Zeichen: beim Tausch muss sie sich vom bisherigen Schlüssel unterscheiden
    if (vermeiden && schluesselId.slice(0, 8) === vermeiden.slice(0, 8)) continue
    const schluessel = await schluesselImportieren(roh, true)
    const g: GespeicherterSchluessel = { instanzId, schluesselId, schluessel, exportierbar: true, gespeichertAm: Date.now() }
    return { g, pruefwert: await pruefwertErzeugen(schluessel, instanzId, schluesselId), roh }
  }
}

/** Schlüssel für die Ersteinrichtung einer neuen Instanz (src/components/Ersteinrichtung.tsx), noch ohne Anmeldung */
export interface NeuerSchluessel {
  blatt: Schluesselblatt
  /** Angaben für die Edge-Funktion `ersteinrichtung` (nie der Schlüssel) */
  kennung: { instanz_id: string; schluessel_id: string; pruefwert: string }
  /** Schlüssel auf diesem Gerät ablegen (Admin-Gerät: exportierbar). Das Blatt ist im Formular schon bestätigt. */
  ablegen: () => Promise<void>
}

/**
 * Neue Instanz: Schlüssel und Instanz-ID im Browser erzeugen. Die Kennung geht an die Edge-Funktion, den Schlüssel legt
 * `ablegen()` danach im Gerätespeicher ab; die Prüfung gegen den Server (pruefen) läuft erst nach der Anmeldung.
 */
export async function ersteinrichtungSchluessel(): Promise<NeuerSchluessel> {
  const { g, pruefwert, roh } = await neuErzeugen(crypto.randomUUID())
  return {
    blatt: { instanzId: g.instanzId, schluesselId: g.schluesselId, qr: qrInhalt(g.instanzId, roh), text: schluesselText(roh) },
    kennung: { instanz_id: g.instanzId, schluessel_id: g.schluesselId, pruefwert },
    ablegen: async () => {
      await laden()
      await speichern('schluessel', { ...g, gespeichertAm: Date.now() })
      await metaSchreiben(META_SCHLUESSEL.abgleich, Date.now())
      await db.meta.bulkDelete([META_SCHLUESSEL.alt, META_SCHLUESSEL.tausch, META_SCHLUESSEL.einrichten, META_SCHLUESSEL.blatt, META_SCHLUESSEL.frist])
      tauschSchluessel = null
      blattSetzen(null)
    },
  }
}

// ---------------------------------------------------------------------------
// Gerätespeicher
// ---------------------------------------------------------------------------
async function laden() {
  if (geladen) return
  geraet = (await metaLesen<GespeicherterSchluessel>(META_SCHLUESSEL.schluessel)) ?? null
  tauschSchluessel = (await metaLesen<GespeicherterSchluessel>(META_SCHLUESSEL.tausch)) ?? null
  const b = await metaLesen<{ welcher: 'aktuell' | 'tausch'; schluesselId: string }>(META_SCHLUESSEL.blatt)
  // Nur, solange der Schlüssel dazu noch auf dem Gerät liegt
  blattOffenWert = b && (b.welcher === 'aktuell' ? geraet : tauschSchluessel)?.schluesselId === b.schluesselId ? b.welcher : null
  geladen = true
}

function blattSetzen(welcher: 'aktuell' | 'tausch' | null) {
  if (blattOffenWert === welcher) return
  blattOffenWert = welcher
  hoerer.forEach((h) => h())
}

async function blattMerken(welcher: 'aktuell' | 'tausch', schluesselId: string) {
  await metaSchreiben(META_SCHLUESSEL.blatt, { welcher, schluesselId })
  blattSetzen(welcher)
}

/** Aufbewahrung des Schlüsselblatts bestätigen (dauerhaft im Gerätespeicher). Erst danach Umschlüsseln bzw. Tausch beginnen. */
export async function blattBestaetigen(welcher: 'aktuell' | 'tausch'): Promise<void> {
  await laden()
  const b = await metaLesen<{ welcher: string }>(META_SCHLUESSEL.blatt)
  if (b?.welcher === welcher) await db.meta.delete(META_SCHLUESSEL.blatt)
  if (blattOffenWert === welcher) blattSetzen(null)
  void loggen('Verschlüsselung', welcher === 'tausch' ? 'Neues Schlüsselblatt als verwahrt bestätigt' : 'Schlüsselblatt als verwahrt bestätigt')
}

async function speichern(art: 'schluessel' | 'tausch' | 'alt', g: GespeicherterSchluessel | null) {
  if (g) await metaSchreiben(META_SCHLUESSEL[art], g)
  else await db.meta.delete(META_SCHLUESSEL[art])
  if (art === 'schluessel') geraet = g
  if (art === 'tausch') tauschSchluessel = g
}

/** Alle Schlüssel vom Gerät löschen (Frist abgelaufen). Der übrige Gerätespeicher bleibt, ist ohne Schlüssel aber unlesbar. */
async function alleSchluesselLoeschen() {
  await db.meta.bulkDelete([META_SCHLUESSEL.schluessel, META_SCHLUESSEL.tausch, META_SCHLUESSEL.alt, META_SCHLUESSEL.abgleich,
    META_SCHLUESSEL.einrichten, META_SCHLUESSEL.blatt, META_SCHLUESSEL.nachziehen])
  await metaSchreiben(META_SCHLUESSEL.frist, true)
  geraet = null
  tauschSchluessel = null
  blattSetzen(null)
}

/**
 * Frist ohne Serverkontakt (Konzept „Abgang eines Mitarbeiters“ 2): beim App-Start unabhängig von Anmeldung und Netz prüfen
 * (src/auth.tsx) und ggf. die Schlüssel löschen. Ein noch nicht bestätigtes Schlüsselblatt hält den einzigen Schlüssel –
 * er bleibt. Ergebnis: true, wenn gelöscht wurde.
 */
export async function fristPruefen(jetzt = Date.now()): Promise<boolean> {
  await laden()
  if (!geraet || blattOffenWert) return false
  const abgleich = (await metaLesen<number>(META_SCHLUESSEL.abgleich)) ?? geraet.gespeichertAm ?? 0
  if (jetzt - abgleich <= FRIST_MS) return false
  await alleSchluesselLoeschen()
  void loggen('Verschlüsselung', `Schlüssel nach ${Math.round(FRIST_MS / 86_400_000)} Tagen ohne Serverkontakt vom Gerät gelöscht`)
  if (zustand.art === 'bereit') setze({ art: 'scannen', grund: 'frist' })
  return true
}

// ---------------------------------------------------------------------------
// Prüfung gegen den Server (Bedingung 3)
// ---------------------------------------------------------------------------
async function kennungLaden(): Promise<ServerKennung> {
  const { data, error } = await supabase.rpc('verschluesselung_kennung')
  if (error) {
    // Datenbank aus der Zeit vor der Verschlüsselung (Funktion fehlt): keine Verschlüsselung
    if (error.code === 'PGRST202' || error.code === '42883') return { berechtigt: true, eingerichtet: false }
    throw new NichtPruefbarFehler(fehlertext(error) || t('Keine Verbindung zum Server'))
  }
  const k = data as unknown as ServerKennung | null
  if (!k || typeof k !== 'object' || typeof k.berechtigt !== 'boolean') throw new NichtPruefbarFehler(t('Unerwartete Antwort des Servers'))
  return k
}

/**
 * Stand des Servers mit dem Schlüssel des Geräts vergleichen (reine Funktion).
 * `tausch`: neuer Schlüssel dieses Geräts während eines Tauschs, `ich`: angemeldeter Benutzer.
 */
export function bewerten(k: ServerKennung, g: GespeicherterSchluessel | null, tausch: GespeicherterSchluessel | null, ich: string | null,
  letzterAbgleich: number, jetzt = Date.now()): Zustand {
  if (!k.eingerichtet) {
    if (k.abgeschaltet && g) {
      // Abgeschaltet: nur glauben, wenn Instanz und Schlüssel passen (den Nachweis prüft pruefenIntern, er braucht WebCrypto)
      if (g.instanzId !== k.instanz_id) return { art: 'falsche_instanz', grund: 'Die Instanz-ID des Servers passt nicht zum Schlüssel des Geräts.' }
      if (g.schluesselId !== k.schluessel_id) return { art: 'scannen', grund: 'abgeschaltet' }
      return { art: 'abgeschaltet' }
    }
    if (g) return { art: 'falsche_instanz', grund: 'Der Server meldet keine Verschlüsselung, das Gerät hat aber einen Schlüssel.' }
    if (STICHTAG && jetzt >= Date.parse(STICHTAG)) return { art: 'pflicht' }
    return { art: 'aus' }
  }
  if (!g) return { art: 'scannen', grund: 'fehlt' }
  if (g.instanzId !== k.instanz_id) return { art: 'falsche_instanz', grund: 'Die Instanz-ID des Servers passt nicht zum Schlüssel des Geräts.' }
  if (g.schluesselId !== k.schluessel_id) {
    // Gleiche Instanz, anderer Schlüssel: Tausch abgeschlossen (ein fremdes Blatt hätte eine andere Instanz-ID)
    return { art: 'scannen', grund: 'getauscht' }
  }
  const eigenerTausch = !!k.tausch_seit && k.tausch_von === ich && tausch?.schluesselId === k.tausch_schluessel_id
  if (k.tausch_seit && !eigenerTausch) return { art: 'tausch' }
  return { art: 'bereit', instanzId: g.instanzId, schluesselId: g.schluesselId, aktiv: !!k.aktiv, tausch: eigenerTausch,
    abschaltung: !!k.abschaltung_seit, exportierbar: g.exportierbar, letzterAbgleich }
}

async function ichBin(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

/** Frist ohne Serverkontakt: Ablauf und ob gewarnt werden soll (null ohne Schlüssel). */
export function fristStand(z: Zustand = zustand, jetzt = Date.now()): { ablaufAm: number; warnen: boolean } | null {
  if (z.art !== 'bereit') return null
  const ablaufAm = z.letzterAbgleich + FRIST_MS
  return { ablaufAm, warnen: ablaufAm - jetzt <= WARNUNG_MS }
}

let laufend: Promise<{ zustand: Zustand; fehler: NichtPruefbarFehler | null }> | null = null

/**
 * Zustand bestimmen: beim Start, bei jeder Anmeldung, bei Rückkehr in die App und vor jedem Abgleich (instanzPruefen).
 * Ohne Verbindung bleibt der letzte Stand (bzw. der zuletzt gespeicherte Stand vom Server); mit `werfen` gibt es dann
 * einen NichtPruefbarFehler. Gleichzeitige Aufrufe teilen sich eine Anfrage.
 */
export async function pruefen(werfen = false): Promise<Zustand> {
  laufend ??= pruefenIntern().finally(() => { laufend = null })
  const { zustand: z, fehler } = await laufend
  if (werfen && fehler) throw fehler
  return z
}

/** „Erneut prüfen“ auf dem Sperrbildschirm: hebt auch eine Sperre nach Bedingung 4 auf, wenn der Server passt. */
export function entsperrenVersuchen(): Promise<Zustand> {
  alarmGrund = null
  return pruefen()
}

async function pruefenIntern(): Promise<{ zustand: Zustand; fehler: NichtPruefbarFehler | null }> {
  await laden()
  const jetzt = Date.now()
  await fristPruefen(jetzt)
  const abgleich = (await metaLesen<number>(META_SCHLUESSEL.abgleich)) ?? geraet?.gespeichertAm ?? 0
  const fristAbgelaufen = !geraet && !!(await metaLesen<boolean>(META_SCHLUESSEL.frist))

  let k: ServerKennung
  try {
    k = await kennungLaden()
    if (!k.berechtigt) {
      // Sitzung besteht, der Server verweigert aber jede Aussage (deaktiviert, Supportzugang abgelaufen …): Profil neu laden
      if (jetzt - unberechtigtGemeldet > 30_000) { unberechtigtGemeldet = jetzt; beiUnberechtigt.forEach((h) => h()) }
      throw new NichtPruefbarFehler(t('Nicht angemeldet oder Zugang gesperrt'))
    }
  } catch (e) {
    const fehler = e instanceof NichtPruefbarFehler ? e : new NichtPruefbarFehler(fehlertext(e))
    if (zustand.art === 'unbekannt' || fristAbgelaufen) {
      // Ohne Verbindung starten: letzter bekannter Stand vom Server
      const letzter = await metaLesen<ServerKennung>(META_SCHLUESSEL.server)
      if (fristAbgelaufen) setze({ art: 'scannen', grund: 'frist' })
      else if (letzter) setze(mitAlarm(bewerten(letzter, geraet, tauschSchluessel, await ichBin(), abgleich, jetzt)))
      else setze(geraet ? { art: 'falsche_instanz', grund: 'Der Stand des Servers ist unbekannt. Bitte einmal online öffnen.' } : { art: 'aus' })
    }
    return { zustand, fehler }
  }

  // Einrichten abgebrochen, nachdem der Server die Kennung schon hatte: den vorher abgelegten Schlüssel übernehmen
  const einrichtung = await metaLesen<GespeicherterSchluessel>(META_SCHLUESSEL.einrichten)
  if (einrichtung) {
    if (k.eingerichtet && k.instanz_id === einrichtung.instanzId && k.schluessel_id === einrichtung.schluesselId
        && geraet?.schluesselId !== einrichtung.schluesselId) {
      await eingerichtetUebernehmen(einrichtung)
    } else if (k.eingerichtet && k.schluessel_id !== einrichtung.schluesselId) {
      // Der Server hat eine andere Kennung: dieser Versuch ist überholt. (Ohne Kennung bleibt er – die RPC kann noch unterwegs sein.)
      await db.meta.delete(META_SCHLUESSEL.einrichten)
    }
  }

  // Eigener Tausch auf dem Server abgeschlossen, aber noch nicht auf dem Gerät (z. B. Abbruch direkt danach): neuen übernehmen
  if (k.eingerichtet && geraet && tauschSchluessel && geraet.schluesselId !== k.schluessel_id && tauschSchluessel.schluesselId === k.schluessel_id) {
    await neuenSchluesselUebernehmen()
  }
  // Eigener Tausch auf dem Server abgebrochen (oder von einem anderen Admin): vorbereiteter Schlüssel ist nur noch gültig,
  // solange auf dem Server kein Tausch mit einem anderen Schlüssel läuft
  if (k.eingerichtet && tauschSchluessel && k.tausch_seit && k.tausch_schluessel_id !== tauschSchluessel.schluesselId) {
    await speichern('tausch', null)
  }

  const vorher = await metaLesen<ServerKennung>(META_SCHLUESSEL.server)
  let neu = bewerten(k, geraet, tauschSchluessel, await ichBin(), jetzt, jetzt)
  if (neu.art === 'aus' && k.abgeschaltet) {
    // Abgeschaltet, Gerät ohne Schlüssel (z. B. nach der Frist): Geheimtext im Gerätespeicher macht nur das bisherige Blatt lesbar
    const { geraetHatGeheimtext } = await import('./geraet')
    if (await geraetHatGeheimtext()) neu = { art: 'scannen', grund: 'abgeschaltet' }
  }
  if (neu.art === 'scannen' && fristAbgelaufen && neu.grund !== 'abgeschaltet') neu = { art: 'scannen', grund: 'frist' }
  if (neu.art === 'scannen' && (neu.grund === 'getauscht' || neu.grund === 'abgeschaltet') && geraet) {
    // Alter Schlüssel bleibt nur, bis das neue Blatt gescannt ist – dann schlüsselt das Gerät seine lokalen Daten um
    await metaSchreiben(META_SCHLUESSEL.alt, geraet)
    await speichern('schluessel', null)
    await speichern('tausch', null)
    void loggen('Verschlüsselung', 'Schlüssel wurde getauscht – neues Schlüsselblatt nötig')
  }
  if (neu.art === 'abgeschaltet') {
    const ergebnis = await abschaltungUebernehmen(k)
    if (ergebnis.fehler) return ergebnis
    neu = ergebnis.zustand
  }
  if (neu.art === 'falsche_instanz' && zustand.art !== 'falsche_instanz') {
    void loggen('Verschlüsselung: falsche Instanz', neu.grund)
  }
  if (neu.art === 'bereit' && k.aktiv && vorher?.aktiv === false) {
    // Wechsel auf „aktiv“: Klartext aus der Zeit der Umstellung im Gerätespeicher würde sonst als Fehler gelten. Der Merker
    // bleibt, bis das Verschlüsseln geklappt hat (bricht es ab, geht es bei der nächsten Prüfung weiter).
    await metaSchreiben(META_SCHLUESSEL.nachziehen, true)
  }
  if (neu.art === 'bereit' && k.abschaltung_seit && !vorher?.abschaltung_seit) {
    // Beginn der Abschaltung: Gerätespeicher und Outbox entschlüsseln, damit Klartext hinausgeht (Merker bis zum Erfolg)
    await metaSchreiben(META_SCHLUESSEL.abschalten, true)
  }
  if (!k.abschaltung_seit) await db.meta.delete(META_SCHLUESSEL.abschalten)
  if (neu.art === 'bereit' || neu.art === 'tausch' || neu.art === 'aus') {
    await metaSchreiben(META_SCHLUESSEL.server, k)
    if (neu.art !== 'aus') await metaSchreiben(META_SCHLUESSEL.abgleich, jetzt)
  }
  if (neu.art === 'bereit' && geraet) {
    // Lokale Daten nachziehen: nach einem Tausch (alter Schlüssel liegt noch da) bzw. nach dem Wechsel auf „aktiv“
    const { geraetEntschluesseln, geraetNachziehen } = await import('./geraet')
    const nachziehen = !!(await metaLesen<boolean>(META_SCHLUESSEL.nachziehen))
    await geraetNachziehen(geraet, nachziehen)
    if (nachziehen) await db.meta.delete(META_SCHLUESSEL.nachziehen)
    if (k.abschaltung_seit && await metaLesen<boolean>(META_SCHLUESSEL.abschalten)) {
      await geraetEntschluesseln(geraet)
      await db.meta.delete(META_SCHLUESSEL.abschalten)
    }
  }
  letztePruefung = Date.now()
  setze(mitAlarm(neu))
  return { zustand, fehler: null }
}

/**
 * Server meldet „abgeschaltet“, Instanz und Schlüssel passen: Nachweis prüfen (sonst falsche Instanz), dann Gerätespeicher
 * und Outbox entschlüsseln und alle Schlüssel vom Gerät löschen. Bricht das Entschlüsseln ab, bleibt der Schlüssel, und
 * es geht bei der nächsten Prüfung weiter.
 */
async function abschaltungUebernehmen(k: ServerKennung): Promise<{ zustand: Zustand; fehler: NichtPruefbarFehler | null }> {
  const g = geraet!
  if (!await abschaltnachweisPruefen(g.schluessel, g.instanzId, k.abschaltnachweis)) {
    return { zustand: { art: 'falsche_instanz', grund: 'Der Server meldet die Verschlüsselung als abgeschaltet, der Nachweis passt aber nicht zum Schlüssel des Geräts.' }, fehler: null }
  }
  // Das Gerät, das selbst abgeschaltet hat, bleibt dabei auf seiner Seite (die Sperre würde sie neu aufbauen)
  if (!eigeneAbschaltung) setze({ art: 'abgeschaltet' })
  try {
    const { geraetEntschluesseln, geraetNachziehen } = await import('./geraet')
    await geraetNachziehen(g, false)
    await geraetEntschluesseln(g)
  } catch (e) {
    void loggen('Verschlüsselung', `Abschaltung: Gerätespeicher ließ sich nicht entschlüsseln (${fehlertext(e)})`)
    return { zustand, fehler: new NichtPruefbarFehler(t('Der Gerätespeicher ließ sich nicht entschlüsseln. Bitte erneut versuchen.')) }
  }
  await db.meta.bulkDelete(ALLE_META)
  geraet = null
  tauschSchluessel = null
  blattSetzen(null)
  void loggen('Verschlüsselung', 'Verschlüsselung abgeschaltet – Gerätespeicher entschlüsselt, Schlüssel vom Gerät gelöscht')
  return { zustand: { art: 'aus' }, fehler: null }
}

let eigeneAbschaltung = false

/** Nach verschluesselung_abschalten auf dem eigenen Gerät (umschluesseln.ts): Gerätespeicher entschlüsseln, ohne zu sperren. */
export async function eigeneAbschaltungUebernehmen(): Promise<Zustand> {
  eigeneAbschaltung = true
  try {
    return await pruefen()
  } finally {
    eigeneAbschaltung = false
  }
}

/** Abschaltnachweis mit dem Schlüssel dieses Geräts (für verschluesselung_abschaltung_beginnen, umschluesseln.ts). */
export async function abschaltnachweis(): Promise<string> {
  await laden()
  if (!geraet) throw new SchluesselFehler(t('Kein Schlüssel auf diesem Gerät.'))
  return abschaltnachweisErzeugen(geraet.schluessel, geraet.instanzId, geraet.schluesselId)
}

function mitAlarm(z: Zustand): Zustand {
  return alarmGrund && z.art === 'bereit' ? { art: 'falsche_instanz', grund: alarmGrund } : z
}

/**
 * Bedingung 3 vor jedem Abgleich und jeder Übertragung (src/offline/abgleich.ts, sync.ts). Wirft FalscheInstanzFehler bzw.
 * GesperrtFehler, wenn nicht gesendet oder übernommen werden darf, NichtPruefbarFehler ohne Verbindung.
 * Während eines Schlüsseltauschs auf einem anderen Gerät wird nichts übertragen: Was jetzt noch mit dem alten Schlüssel
 * ankäme, wäre nach dem Tausch für alle unlesbar. Nach dem Scannen des neuen Blatts schlüsselt geraet.ts die Outbox um.
 */
export async function instanzPruefen(optionen: { frisch?: boolean } = {}): Promise<void> {
  const z = !optionen.frisch && Date.now() - letztePruefung < 3_000 && !laufend ? zustand : await pruefen(true)
  if (z.art === 'bereit' || z.art === 'aus') return
  if (z.art === 'falsche_instanz') throw new FalscheInstanzFehler(z.grund)
  throw new GesperrtFehler()
}

let anstoss: ReturnType<typeof setTimeout> | undefined
/** Erneut prüfen (z. B. wenn im Zustand „aus“ Geheimtext auftaucht: die Instanz wurde inzwischen eingerichtet). */
export function pruefenAnstossen() {
  clearTimeout(anstoss)
  anstoss = setTimeout(() => { void pruefen().catch(() => undefined) }, 200)
}

// ---------------------------------------------------------------------------
// Bedingung 4: mehrere unlesbare Werte → wie falsche Instanz
// ---------------------------------------------------------------------------
const FENSTER_MS = 60_000
let fehlerZeiten: number[] = []

/**
 * Sperrt sofort (Bedingung 3/4). Der Schlüssel bleibt auf dem Gerät: „Erneut prüfen“ (entsperrenVersuchen) gibt wieder
 * frei, wenn der Server passt. Automatische Prüfungen (Abgleich, Rückkehr in die App) heben die Sperre nicht auf.
 */
export function alarm(grund: string) {
  if (zustand.art === 'falsche_instanz') return
  alarmGrund = grund
  void loggen('Verschlüsselung: falsche Instanz', grund)
  setze({ art: 'falsche_instanz', grund })
}

/**
 * Nicht lesbare Werte bzw. Dateien melden. Mehrere in einer Antwort oder drei innerhalb einer Minute gelten als
 * Fehlleitung (Bedingung 4).
 */
export function unlesbarMelden(anzahl: number, wo: string) {
  if (anzahl <= 0) return
  const jetzt = Date.now()
  fehlerZeiten = [...fehlerZeiten.filter((t) => jetzt - t < FENSTER_MS), ...Array<number>(anzahl).fill(jetzt)]
  void loggen('Verschlüsselung: nicht lesbar', `${anzahl} × ${wo}`)
  if (anzahl >= 2 || fehlerZeiten.length >= 3) {
    fehlerZeiten = []
    alarm(`Mehrere Daten ließen sich nicht entschlüsseln (${wo}).`)
  }
}

// ---------------------------------------------------------------------------
// Einrichten, Scannen, Tausch
// ---------------------------------------------------------------------------
/**
 * Neue Verschlüsselung einrichten (nur Admin): Schlüssel und Instanz-ID im Browser erzeugen, auf dem Gerät exportierbar
 * speichern, Kennung und Prüfwert an den Server. Danach Schlüsselblatt drucken (schluesselblatt()) und den Bestand
 * umschlüsseln (umschluesseln.ts) bzw. bei einer neuen Instanz gleich umstellungAbschliessen().
 */
export async function einrichten(optionen: { ersetzen?: boolean } = {}): Promise<Schluesselblatt> {
  await laden()
  // Schon eine Kennung da (erneutes Einrichten, solange nichts verschlüsselt ist): Instanz-ID behalten – andere Geräte
  // sehen dann „Schlüssel getauscht“ statt „falsche Instanz“
  let instanzId: string = crypto.randomUUID()
  const vorher = await kennungLaden().catch(() => null)
  // Nach einer Abschaltung ebenso: Geräte mit dem alten Schlüssel sehen dann „getauscht“
  if ((vorher?.eingerichtet && (!vorher.aktiv || optionen.ersetzen) || vorher?.abgeschaltet) && vorher.instanz_id) instanzId = vorher.instanz_id
  const { g, pruefwert } = await neuErzeugen(instanzId)
  // Zuerst auf dem Gerät ablegen: geht danach etwas schief (Antwort verloren, Tab geschlossen), ist der Schlüssel noch da
  // und wird übernommen, sobald der Server die Kennung meldet (pruefenIntern)
  await metaSchreiben(META_SCHLUESSEL.einrichten, g)
  const { error } = await supabase.rpc(optionen.ersetzen ? 'verschluesselung_ersetzen' : 'verschluesselung_einrichten',
    { p_instanz_id: g.instanzId, p_schluessel_id: g.schluesselId, p_pruefwert: pruefwert })
  if (error) {
    const k = await kennungLaden().catch(() => null)
    if (!k) throw new SchluesselFehler(t('{fehler} – ob der Server den Schlüssel übernommen hat, zeigt sich bei der nächsten Verbindung.', { fehler: fehlertext(error) }))
    if (k.schluessel_id !== g.schluesselId) {
      await db.meta.delete(META_SCHLUESSEL.einrichten)
      throw new SchluesselFehler(fehlertext(error))
    }
  }
  await eingerichtetUebernehmen(g)
  void loggen('Verschlüsselung', `${optionen.ersetzen ? 'Neu eingerichtet (leere Instanz)' : 'Eingerichtet'}, Schlüssel-ID ${g.schluesselId}`)
  // Leere Instanz, die schon aktiv war (Ersteinrichtung): gleich wieder aktiv – es gibt nichts umzuschlüsseln
  if (optionen.ersetzen && vorher?.aktiv) await supabase.rpc('verschluesselung_aktivieren')
  await pruefen()
  return blattAus(g)
}

/**
 * Admin ohne Schlüssel auf dem Gerät (Zustand „scannen“), Schlüsselblatt nicht zur Hand: neu einrichten – nur, solange noch
 * nichts verschlüsselt ist (eine leere Instanz auch, wenn sie schon aktiv ist). Ergebnis null, wenn das nicht geht.
 */
export async function neuEinrichtenMoeglich(): Promise<{ ersetzen: boolean } | null> {
  const { data, error } = await supabase.rpc('verschluesselung_stand')
  if (error || !data) return null
  const st = data as { verschluesselt?: number; leer?: boolean }
  if (st.leer) return { ersetzen: true }
  const k = await kennungLaden().catch(() => null)
  return st.verschluesselt === 0 && k?.eingerichtet && !k.aktiv && !k.tausch_seit ? { ersetzen: false } : null
}

/** Vom Server bestätigte neue Kennung: Schlüssel wird der aktuelle, Blatt gilt als noch nicht bestätigt. */
async function eingerichtetUebernehmen(g: GespeicherterSchluessel) {
  // Ein bisheriger Schlüssel derselben Instanz (erneutes Einrichten) bleibt als „alt“, bis der Gerätespeicher umgeschlüsselt ist
  if (geraet && geraet.instanzId === g.instanzId && geraet.schluesselId !== g.schluesselId) await metaSchreiben(META_SCHLUESSEL.alt, geraet)
  else await db.meta.delete(META_SCHLUESSEL.alt)
  await blattMerken('aktuell', g.schluesselId)
  await speichern('schluessel', g)
  await db.meta.bulkDelete([META_SCHLUESSEL.einrichten, META_SCHLUESSEL.frist])
  const { geraetVerschluesseln } = await import('./geraet')
  await geraetVerschluesseln(g)
}

/**
 * Gescanntes oder abgetipptes Schlüsselblatt übernehmen. Prüft Instanz-ID, Schlüssel-ID und Prüfwert gegen den Server.
 * Admins bekommen den Schlüssel exportierbar. Während eines Tauschs nimmt ein Admin so auch den neuen Schlüssel auf
 * (zum Fortsetzen bzw. Übernehmen des Tauschs). Wirft SchluesselFehler mit einer Meldung für die Oberfläche.
 */
export async function schluesselEinlesen(text: string, optionen: { systemadmin: boolean }): Promise<'aktuell' | 'tausch'> {
  const gelesen = schluesselLesen(text)
  await laden()
  let k: ServerKennung
  try { k = await kennungLaden() } catch { throw new SchluesselFehler(t('Zum Einlesen des Schlüssels ist eine Verbindung zum Server nötig.')) }
  if (!k.berechtigt) throw new SchluesselFehler(t('Bitte erneut anmelden.'))
  // Abgeschaltet: das bisherige Blatt macht noch nicht übertragene Änderungen lesbar (danach entschlüsselt pruefen sie)
  if ((!k.eingerichtet && !k.abgeschaltet) || !k.instanz_id || !k.schluessel_id || !k.pruefwert) throw new SchluesselFehler(t('Auf dieser Instanz ist keine Verschlüsselung eingerichtet.'))
  if (gelesen.instanzId && gelesen.instanzId !== k.instanz_id) {
    void loggen('Verschlüsselung', 'Schlüsselblatt einer anderen Instanz abgelehnt')
    throw new SchluesselFehler(t('Dieses Schlüsselblatt gehört zu einer anderen Instanz.'))
  }
  const id = await schluesselIdBerechnen(gelesen.roh)
  const istTausch = !!k.tausch_seit && id === k.tausch_schluessel_id
  if (id !== k.schluessel_id && !istTausch) throw new SchluesselFehler(t('Dieser Schlüssel ist nicht (mehr) gültig. Bitte das aktuelle Schlüsselblatt scannen.'))
  const schluessel = await schluesselImportieren(gelesen.roh, optionen.systemadmin)
  if (!await pruefwertPruefen(schluessel, k.instanz_id, (istTausch ? k.tausch_pruefwert : k.pruefwert) ?? '')) {
    throw new SchluesselFehler(t('Der Schlüssel passt nicht zu dieser Instanz.'))
  }
  const g: GespeicherterSchluessel = { instanzId: k.instanz_id, schluesselId: id, schluessel, exportierbar: optionen.systemadmin, gespeichertAm: Date.now() }

  if (istTausch) {
    if (!optionen.systemadmin) throw new SchluesselFehler(t('Der Schlüssel wird gerade getauscht. Bitte warten, bis der Admin fertig ist.'))
    if (geraet?.schluesselId !== k.schluessel_id) throw new SchluesselFehler(t('Bitte zuerst das bisherige Schlüsselblatt scannen, dann das neue.'))
    await speichern('tausch', g)
    if (k.tausch_von !== await ichBin()) {
      const { error } = await supabase.rpc('verschluesselung_tausch_beginnen', { p_schluessel_id: id, p_pruefwert: k.tausch_pruefwert! })
      if (error) throw new SchluesselFehler(fehlertext(error))
      void loggen('Verschlüsselung', 'Schlüsseltausch übernommen')
    }
    await pruefen()
    return 'tausch'
  }

  await speichern('schluessel', g)
  await metaSchreiben(META_SCHLUESSEL.abgleich, Date.now())
  await db.meta.bulkDelete([META_SCHLUESSEL.frist, META_SCHLUESSEL.blatt])
  blattSetzen(null)
  if (k.abgeschaltet) {
    void loggen('Verschlüsselung', `Bisheriges Schlüsselblatt nach der Abschaltung eingelesen (Schlüssel-ID ${id})`)
    await pruefen()
    return 'aktuell'
  }
  // Lokale Daten: Klartext aus der Zeit vor der Verschlüsselung verschlüsseln; nach einem Tausch vom alten auf den neuen
  // Schlüssel (pruefen → geraetNachziehen, solange der alte Schlüssel in meta liegt)
  const { geraetVerschluesseln } = await import('./geraet')
  await geraetVerschluesseln(g)
  void loggen('Verschlüsselung', `Schlüssel auf dem Gerät eingelesen (Schlüssel-ID ${id})`)
  await pruefen()
  return 'aktuell'
}

/** Schlüsseltausch vorbereiten (nur Admin): neuen Schlüssel erzeugen und nur auf diesem Gerät ablegen. Danach Blatt drucken, dann tauschBeginnen(). */
export async function tauschVorbereiten(): Promise<Schluesselblatt> {
  await laden()
  if (zustand.art !== 'bereit' || !zustand.aktiv || !geraet) throw new SchluesselFehler(t('Tauschen geht nur bei aktiver Verschlüsselung mit Schlüssel auf diesem Gerät.'))
  if (!geraet.exportierbar) throw new SchluesselFehler(t('Bitte das Schlüsselblatt auf diesem Gerät als Admin neu scannen.'))
  const { g } = await neuErzeugen(geraet.instanzId, geraet.schluesselId)
  await speichern('tausch', g)
  await blattMerken('tausch', g.schluesselId)
  return blattAus(g)
}

/**
 * Vorbereiteten neuen Schlüssel verwerfen (Tausch noch nicht begonnen oder auf dem Server abgebrochen, siehe
 * umschluesseln.ts tauschAbbrechen). Das neue Blatt ist danach ungültig.
 */
export async function tauschVerwerfen(): Promise<void> {
  await laden()
  await speichern('tausch', null)
  const b = await metaLesen<{ welcher: string }>(META_SCHLUESSEL.blatt)
  if (b?.welcher === 'tausch') await db.meta.delete(META_SCHLUESSEL.blatt)
  if (blattOffenWert === 'tausch') blattSetzen(null)
  void loggen('Verschlüsselung', 'Vorbereiteter Schlüsseltausch verworfen')
  await pruefen()
}

/** Tausch auf dem Server beginnen: andere Geräte sperren, umschluesseln nimmt Geheimtext → neuer Geheimtext an. */
export async function tauschBeginnen(): Promise<void> {
  await laden()
  if (!tauschSchluessel || !geraet) throw new SchluesselFehler(t('Kein neuer Schlüssel vorbereitet.'))
  if (blattOffenWert === 'tausch') throw new SchluesselFehler(t('Bitte zuerst das neue Schlüsselblatt ausdrucken und die Aufbewahrung bestätigen.'))
  const pruefwert = await pruefwertErzeugen(tauschSchluessel.schluessel, tauschSchluessel.instanzId, tauschSchluessel.schluesselId)
  const { error } = await supabase.rpc('verschluesselung_tausch_beginnen', { p_schluessel_id: tauschSchluessel.schluesselId, p_pruefwert: pruefwert })
  if (error) throw new SchluesselFehler(fehlertext(error))
  void loggen('Verschlüsselung', `Schlüsseltausch begonnen (neue Schlüssel-ID ${tauschSchluessel.schluesselId})`)
  await pruefen()
}

/**
 * Neuer Schlüssel wird der aktuelle. Der alte bleibt in meta, bis der Gerätespeicher umgeschlüsselt ist (geraetNachziehen
 * beim nächsten pruefen) – bricht das ab, geht es beim nächsten Start weiter.
 */
async function neuenSchluesselUebernehmen() {
  if (!tauschSchluessel || !geraet) return
  await metaSchreiben(META_SCHLUESSEL.alt, geraet)
  await speichern('schluessel', tauschSchluessel)
  await speichern('tausch', null)
  blattSetzen(null)
}

/** Nach verschluesselung_tausch_abschliessen: neuer Schlüssel wird der aktuelle, Gerätespeicher umschlüsseln (umschluesseln.ts). */
export async function tauschUebernehmen(): Promise<void> {
  await laden()
  if (!tauschSchluessel) throw new SchluesselFehler(t('Kein neuer Schlüssel auf diesem Gerät.'))
  await neuenSchluesselUebernehmen()
  await pruefen()
}
