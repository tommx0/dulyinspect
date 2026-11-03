// Werte in der Datenbank ver- und entschlüsseln (docs/KONZEPT-VERSCHLUESSELUNG.md, „Format“, Bedingungen 2, 4 und 5).
//
// - entschluesseln(tabelle, daten): Zeile oder Liste, rekursiv über eingebettete Zeilen (Joins wie
//   `objekt(id, name, endkunde(id, name))`). Was sich nicht entschlüsseln lässt – Klartext im verschlüsselten Feld,
//   falscher Schlüssel, falsche Instanz, vertauschter Datensatz, manipulierter Geheimtext – wird zu NICHT_LESBAR, nie zum
//   Rohwert. Mehrere davon in einer Antwort sperren die App wie eine falsche Instanz (schluessel.ts, unlesbarMelden).
//   Ausnahme: Während der Umstellung (eingerichtet, noch nicht aktiv) ist Klartext der noch nicht umgeschlüsselte
//   Bestand und wird angezeigt – wie auf einer Instanz ohne Verschlüsselung.
// - verschluesseln(tabelle, daten): vor insert/update. Unveränderte Werte behalten ihren bisherigen Geheimtext
//   (Merkspeicher aus dem Entschlüsseln), damit Schutz-Trigger und das Erlöschen von Unterschriften nicht fälschlich anschlagen.
// - Ohne eingerichtete Verschlüsselung (Zustand „aus“) gehen die Werte unverändert durch – App wie bisher. Ebenso neue
//   Werte, während ein Admin die Verschlüsselung abschaltet (gelesen wird dann beides).
import { t } from '../sprache'
import { WERT_FELDER, feldLesen, feldSetzen, feldVorhanden, istVerschluesselteTabelle, zeilenId, type VerschluesselteTabelle } from './felder'
import { istGeheimtext, wertAad, wertEntschluesseln, wertVerschluesseln } from './krypto'
import { GesperrtFehler, aktuellerZustand, beiSchluesselwechsel, pruefenAnstossen, schluesselStand, unlesbarMelden } from './schluessel'

/**
 * Anzeige für einen Wert, der sich nicht entschlüsseln lässt (Bedingungen 2 und 4). Ein gewöhnlicher Text, damit die
 * Oberfläche ihn ohne Sonderfall anzeigen, sortieren und filtern kann; hervorheben mit istNichtLesbar().
 * verschluesseln() schreibt an seiner Stelle den bisherigen Geheimtext zurück (bzw. lässt die Spalte weg).
 */
export const NICHT_LESBAR = '⚠ nicht lesbar'

export function istNichtLesbar(v: unknown): v is typeof NICHT_LESBAR {
  return v === NICHT_LESBAR
}

export type NichtLesbarGrund =
  /** Klartext in einem verschlüsselten Feld (Bedingung 2) */
  | 'klartext'
  /** falscher Schlüssel, andere Instanz, vertauschter Datensatz oder verändert (Bedingung 4/5) */
  | 'fehler'
  /** Zeile ohne ID (Programmierfehler: `id` mitselektieren) */
  | 'ohne_id'
  /** Geheimtext in einem Feld, das nicht in der Feldliste steht (z. B. umbenannte Einbettung ohne `aliase`) */
  | 'unbekanntes_feld'
  /** Geheimtext, obwohl die Instanz laut letzter Prüfung keine Verschlüsselung hat */
  | 'ohne_schluessel'
  /** Feld aus `quellen` ohne die ID-Spalte in der Zeile */
  | 'ohne_quelle'

export interface LeseFehler {
  tabelle: string | null
  spalte: string
  id: string | null
  grund: NichtLesbarGrund
}

/** Herkunft einer Spalte im Ergebnis einer Funktion oder Sicht (z. B. anlage_suche: `objekt` ist objekt.name zu `objekt_id`) */
export interface Quelle {
  tabelle: VerschluesselteTabelle
  spalte: string
  /** Spalte im Ergebnis mit der ID des Datensatzes */
  id: string
}

/** anlage_suche liefert Objektname, Ort und Kundenname als Geheimtext */
export const QUELLEN_ANLAGE_SUCHE: Record<string, Quelle> = {
  objekt: { tabelle: 'objekt', spalte: 'name', id: 'objekt_id' },
  objekt_ort: { tabelle: 'objekt', spalte: 'ort', id: 'objekt_id' },
  kunde: { tabelle: 'endkunde', spalte: 'name', id: 'endkunde_id' },
}

export interface EntschluesselnOptionen {
  /** Name im Ergebnis → Tabelle, wenn eine Einbettung umbenannt ist, z. B. `kunde:endkunde(id, name)` → `{ kunde: 'endkunde' }` */
  aliase?: Record<string, string>
  /** Spalten der obersten Ebene, die aus einer verschlüsselten Tabelle stammen (Ergebnis von RPCs/Sichten), z. B. QUELLEN_ANLAGE_SUCHE */
  quellen?: Record<string, Quelle>
  /** sammelt, was nicht lesbar war (zusätzlich zur Anzeige als NICHT_LESBAR) */
  fehler?: LeseFehler[]
}

/** Fremdschlüssel in der übergeordneten Zeile: fehlt `id` in einer eingebetteten Zeile, gilt dieser Wert */
const FREMDSCHLUESSEL: Record<string, string> = {
  endkunde: 'endkunde_id', objekt: 'objekt_id', anlage: 'anlage_id', anlagenpruefung: 'anlagenpruefung_id', session: 'session_id',
}

// ---------------------------------------------------------------------------
// Merkspeicher: Geheimtext je Feld und Datensatz, mit dem Klartext (null: war nicht lesbar)
// ---------------------------------------------------------------------------
const MAX_MERK = 50_000
const merk = new Map<string, { klartext: string | null; geheimtext: string }>()
beiSchluesselwechsel(() => merk.clear())

function merkSchluessel(tabelle: string, spalte: string, id: string) {
  return `${tabelle}|${spalte}|${id}`
}

function merken(k: string, klartext: string | null, geheimtext: string) {
  if (merk.size >= MAX_MERK) merk.clear()
  merk.set(k, { klartext, geheimtext })
}

/** Für Tests und nach dem Umschlüsseln */
export function merkspeicherLeeren() {
  merk.clear()
}

// ---------------------------------------------------------------------------
// Entschlüsseln
// ---------------------------------------------------------------------------
type Stand = ReturnType<typeof schluesselStand>

interface Lauf { st: Stand; fehler: LeseFehler[]; aliase: Record<string, string>; quellen: Record<string, Quelle> }

function istZeile(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Blob) && !(v instanceof Date)
}

async function feldEntschluesseln(lauf: Lauf, tabelle: string, spalte: string, id: string | null, roh: unknown): Promise<unknown> {
  if (roh == null || roh === '') return roh
  const nicht = (grund: NichtLesbarGrund) => {
    lauf.fehler.push({ tabelle, spalte, id, grund })
    if (id && typeof roh === 'string') merken(merkSchluessel(tabelle, spalte, id), null, roh)
    return NICHT_LESBAR
  }
  if (!lauf.st) return typeof roh === 'string' && roh.startsWith('enc1.') ? nicht('ohne_schluessel') : roh
  if (!istGeheimtext(roh)) return lauf.st.aktiv ? nicht('klartext') : roh  // Umstellung: noch nicht umgeschlüsselt
  if (!id) return nicht('ohne_id')
  try {
    const klar = await wertEntschluesseln(roh, wertAad(lauf.st.instanzId, tabelle, spalte, id), lauf.st.lesen)
    merken(merkSchluessel(tabelle, spalte, id), klar, roh)
    return klar
  } catch {
    return nicht('fehler')
  }
}

async function knoten(lauf: Lauf, tabelle: string | null, wert: unknown, eltern: Record<string, unknown> | null, oben: boolean): Promise<unknown> {
  if (Array.isArray(wert)) return Promise.all(wert.map((w) => knoten(lauf, tabelle, w, eltern, oben)))
  if (!istZeile(wert)) return wert
  const felder: readonly string[] = tabelle && istVerschluesselteTabelle(tabelle) ? WERT_FELDER[tabelle] : []
  let id = tabelle ? zeilenId(tabelle, wert) : null
  if (!id && tabelle && eltern && FREMDSCHLUESSEL[tabelle] && typeof eltern[FREMDSCHLUESSEL[tabelle]] === 'string') {
    id = eltern[FREMDSCHLUESSEL[tabelle]] as string
  }
  let neu: Record<string, unknown> = { ...wert }
  for (const [k, v] of Object.entries(wert)) {
    if (felder.some((f) => f === k || f.startsWith(`${k}.`))) continue
    const q = oben ? lauf.quellen[k] : undefined
    if (q) {
      const qid = wert[q.id]
      neu[k] = typeof qid === 'string' && qid ? await feldEntschluesseln(lauf, q.tabelle, q.spalte, qid, v)
        : v == null || v === '' ? v : (lauf.fehler.push({ tabelle: q.tabelle, spalte: q.spalte, id: null, grund: 'ohne_quelle' }), NICHT_LESBAR)
      continue
    }
    if (v && typeof v === 'object') neu[k] = await knoten(lauf, lauf.aliase[k] ?? k, v, wert, false)
    else if (typeof v === 'string' && v.startsWith('enc1.')) {
      // Geheimtext an unerwarteter Stelle: nie roh anzeigen
      lauf.fehler.push({ tabelle, spalte: k, id, grund: 'unbekanntes_feld' })
      neu[k] = NICHT_LESBAR
    }
  }
  for (const spalte of felder) {
    if (!feldVorhanden(wert, spalte)) continue
    neu = feldSetzen(neu, spalte, await feldEntschluesseln(lauf, tabelle!, spalte, id, feldLesen(wert, spalte)))
  }
  return neu
}

/**
 * Antwort des Servers (oder Zeilen aus dem Gerätespeicher) entschlüsseln – eine Zeile oder eine Liste, samt eingebetteter
 * Zeilen. `tabelle` ist die Tabelle der obersten Ebene (z. B. 'anlage' für `from('anlage').select('*, objekt(id, name)')`).
 * Eingebettete Zeilen brauchen `id` (oder den Fremdschlüssel in der übergeordneten Zeile, z. B. `objekt_id`).
 * Wirft GesperrtFehler, solange kein Schlüssel freigegeben ist (Sperrbildschirm) – nie Rohwerte.
 */
export async function entschluesseln<T>(tabelle: string, daten: T, optionen: EntschluesselnOptionen = {}): Promise<T> {
  const z = aktuellerZustand()
  if (z.art !== 'aus' && z.art !== 'bereit') throw new GesperrtFehler()
  const lauf: Lauf = { st: schluesselStand(), fehler: [], aliase: optionen.aliase ?? {}, quellen: optionen.quellen ?? {} }
  const ergebnis = await knoten(lauf, tabelle, daten, null, true) as T
  if (lauf.fehler.length) {
    optionen.fehler?.push(...lauf.fehler)
    if (lauf.fehler.some((f) => f.grund === 'ohne_schluessel')) pruefenAnstossen()
    // Bedingung 4 zählt nur, was auf eine Fehlleitung deutet: nicht entschlüsselbar oder Klartext bei aktiver
    // Verschlüsselung. Fehlende IDs und Geheimtext in unbekannten Feldern sind Programmierfehler (nur „nicht lesbar“).
    const verdaechtig = lauf.fehler.filter((f) => f.grund === 'fehler' || f.grund === 'klartext')
    unlesbarMelden(verdaechtig.length, `${tabelle}: ${[...new Set(verdaechtig.map((f) => `${f.tabelle}.${f.spalte}`))].join(', ')}`)
    const programmierfehler = lauf.fehler.filter((f) => f.grund === 'ohne_id' || f.grund === 'ohne_quelle' || f.grund === 'unbekanntes_feld')
    if (import.meta.env.DEV && programmierfehler.length) {
      console.warn('Verschlüsselung: Zeile ohne id (bitte id bzw. die ID-Spalte der Quelle mitselektieren) oder Geheimtext in einem'
        + ' unbekannten Feld (aliase/quellen angeben)', programmierfehler)
    }
  }
  return ergebnis
}

// ---------------------------------------------------------------------------
// Verschlüsseln
// ---------------------------------------------------------------------------
async function zeileVerschluesseln<T extends Record<string, unknown>>(tabelle: VerschluesselteTabelle, daten: T, id: string | undefined, st: Stand): Promise<T> {
  let neu = { ...daten }
  const zid = id ?? zeilenId(tabelle, daten)
  for (const spalte of WERT_FELDER[tabelle]) {
    if (!feldVorhanden(daten, spalte)) continue
    const v = feldLesen(daten, spalte)
    const eigenschaft = spalte.includes('.')
    if (istNichtLesbar(v)) {
      // Nicht lesbar angezeigt und unverändert zurück: bisherigen Geheimtext behalten (ohne ihn: Spalte nicht ändern)
      const alt = zid ? merk.get(merkSchluessel(tabelle, spalte, zid)) : undefined
      if (alt) neu = feldSetzen(neu, spalte, alt.geheimtext)
      else if (eigenschaft) throw new Error(t('Der Ansprechpartner ist nicht lesbar und kann so nicht gespeichert werden. Bitte neu eingeben.'))
      else neu = feldSetzen(neu, spalte, undefined)
      continue
    }
    if (!st) continue  // Instanz ohne Verschlüsselung: wie bisher
    if (v == null || v === '') { neu = feldSetzen(neu, spalte, eigenschaft ? undefined : null); continue }
    if (!zid) throw new Error(`Zum Verschlüsseln von ${tabelle}.${spalte} fehlt die ID des Datensatzes`)
    const k = merkSchluessel(tabelle, spalte, zid)
    if (istGeheimtext(v)) {
      // Schon verschlüsselt (z. B. aus dem Gerätespeicher weitergereicht): nur, wenn er genau zu diesem Feld gehört.
      // Geheimtext eines anderen Felds (z. B. Kundenadresse ins Objekt kopiert) wäre danach für alle unlesbar.
      if (merk.get(k)?.geheimtext === v) continue
      try {
        merken(k, await wertEntschluesseln(v, wertAad(st.instanzId, tabelle, spalte, zid), st.lesen), v)
      } catch {
        throw new Error(`Geheimtext gehört nicht zu ${tabelle}.${spalte} dieses Datensatzes – bitte den entschlüsselten Wert übergeben`)
      }
      continue
    }
    if (st.abschaltung) continue  // Abschaltung läuft: Klartext schreiben
    const klar = String(v)
    const alt = merk.get(k)
    if (alt && alt.klartext === klar) { neu = feldSetzen(neu, spalte, alt.geheimtext); continue }
    const geheim = await wertVerschluesseln(klar, wertAad(st.instanzId, tabelle, spalte, zid), st.schreiben, st.schreibId)
    merken(k, klar, geheim)
    neu = feldSetzen(neu, spalte, geheim)
  }
  return neu
}

/**
 * Daten vor insert/update/upsert verschlüsseln (nur die Felder der Feldliste, die in `daten` vorkommen). Die ID des
 * Datensatzes gehört zu den Zusatzdaten: steht sie nicht in `daten` (update), als `id` übergeben – bei
 * benutzer_sachkunde `<benutzer_id>/<anlagenart>`. Neue Datensätze brauchen ihre ID also schon vor dem Insert
 * (crypto.randomUUID()). Leere Werte werden null. Wirft GesperrtFehler ohne freigegebenen Schlüssel.
 */
export async function verschluesseln<T extends Record<string, unknown>>(tabelle: VerschluesselteTabelle, daten: T, id?: string): Promise<T>
export async function verschluesseln<T extends Record<string, unknown>>(tabelle: VerschluesselteTabelle, daten: T[]): Promise<T[]>
export async function verschluesseln<T extends Record<string, unknown>>(tabelle: VerschluesselteTabelle, daten: T | T[], id?: string): Promise<T | T[]> {
  const z = aktuellerZustand()
  if (z.art !== 'aus' && z.art !== 'bereit') throw new GesperrtFehler()
  const st = schluesselStand()
  if (Array.isArray(daten)) return Promise.all(daten.map((d) => zeileVerschluesseln(tabelle, d, undefined, st)))
  return zeileVerschluesseln(tabelle, daten, id, st)
}
