// Gerätespeicher (Dexie) an den Schlüssel anpassen (docs/KONZEPT-VERSCHLUESSELUNG.md, „Auf dem Gerät“, „Abgang eines
// Mitarbeiters“ 3). Betrifft den Offline-Speicher (Kunden, Objekte, Anlagen, Prüfungen, Fotos, Mitprüfer), noch nicht
// übertragene Änderungen in der Outbox und Fotos/Unterschriften in `dateien`.
//
// - geraetVerschluesseln: Klartext aus der Zeit vor der Verschlüsselung bzw. der Umstellung verschlüsseln (beim Einlesen
//   des Schlüssels, beim Einrichten und nach dem Wechsel auf „aktiv“). Sonst gälte er nach der Umstellung als Fehler
//   (Bedingung 2), und die Outbox scheiterte am Schutz vor Klartext auf dem Server. Dateien ohne „.enc“ werden verschlüsselt
//   und bekommen den Pfad „<pfad>.k<Schlüssel>.enc“; alle Verweise (Fotos, Unterschriften, Outbox) werden umgeschrieben.
// - geraetUmschluesseln: nach einem Schlüsseltausch vom alten auf den neuen Schlüssel (Werte und Dateien, Dateien unter dem
//   Pfad mit der Kennung des neuen Schlüssels) – sonst kämen noch nicht übertragene Änderungen mit dem alten Schlüssel beim
//   Server an, und der lehnt sie ab.
// - geraetEntschluesseln: beim Abschalten der Verschlüsselung Geheimtext und Dateien mit „.enc“ entschlüsseln (Dateien unter
//   dem Pfad ohne Kennung), damit die Outbox Klartext schickt – nach der Abschaltung lehnt der Server Geheimtext ab.
//
// Eine schon hochgeladene Datei, deren Datensatz noch in der Outbox wartet, wird erneut hochgeladen (der Datensatz zeigt
// danach auf den neuen Pfad). Liegt ihr Datensatz schon beim Server, setzt das Umschlüsseln auf dem Server denselben neuen
// Pfad – die Datei bleibt als hochgeladen markiert.
//
// Verschlüsseln braucht WebCrypto, und darauf wartet keine Dexie-Transaktion. Deshalb: lesen, umwandeln, dann in einer
// Transaktion erneut lesen und nur schreiben, wenn sich nichts geändert hat (sonst neuer Durchlauf).
import { db, metaLesen, type Datei, type OutboxEintrag } from '../../offline/db'
import { PFAD_FELDER, WERT_FELDER, feldLesen, feldSetzen, feldVorhanden, istVerschluesselteTabelle, zeilenId } from './felder'
import { pfadBasis, pfadFuer, pfadKennung, ursprungsTyp } from './dateien'
import {
  bytesEntschluesseln, bytesVerschluesseln, dateiAad, geheimtextSchluesselId, hatDateiKopf, istGeheimtext, wertAad, wertEntschluesseln,
  wertVerschluesseln,
} from './krypto'
import { META_SCHLUESSEL, type GespeicherterSchluessel } from './schluessel'

export type Umschluesselung<T> = { art: 'neu' } | { art: 'umgeschluesselt'; wert: T } | { art: 'unlesbar' }

/**
 * Geheimtext gehört schon zum neuen Schlüssel (Schlüssel-ID im Wert), wird umgeschlüsselt oder ist mit keinem lesbar.
 * Auch für das Zurückschlüsseln beim Abbruch eines Tauschs (dann ist „neu“ der bisherige Schlüssel).
 */
export async function wertNeuVerschluesseln(geheimtext: string, aad: string, alt: CryptoKey, neu: CryptoKey, neuId: string): Promise<Umschluesselung<string>> {
  if (geheimtextSchluesselId(geheimtext) === neuId) {
    try {
      await wertEntschluesseln(geheimtext, aad, neu)
      return { art: 'neu' }
    } catch {
      return { art: 'unlesbar' }
    }
  }
  try {
    return { art: 'umgeschluesselt', wert: await wertVerschluesseln(await wertEntschluesseln(geheimtext, aad, alt), aad, neu, neuId) }
  } catch {
    return { art: 'unlesbar' }
  }
}

type Zeile = Record<string, unknown>
type WertUmwandeln = (wert: unknown, aad: string) => Promise<string | null>
type DateiUmwandeln = (d: Datei) => Promise<{ pfad: string; blob: Blob } | null>

/** Dexie-Tabelle → Tabelle der Feldliste (Werte und Pfade) */
const GERAETE_TABELLEN: [string, string][] = [
  ['kunden', 'endkunde'], ['objekte', 'objekt'], ['anlagen', 'anlage'], ['pruefungen', 'anlagenpruefung'],
  ['fotos', 'foto'], ['mitpruefer', 'anlagenpruefung_mitpruefer'],
]

function pfadSpalten(tabelle: string): string[] {
  return PFAD_FELDER.filter((f) => f.tabelle === tabelle).map((f) => f.spalte)
}

/** Werte (über `umwandeln`) und Pfade (über `pfade`) einer Zeile; null: nichts geändert. */
async function zeileUmwandeln<T extends Zeile>(tabelle: string, zeile: T, id: string | null, instanzId: string, umwandeln: WertUmwandeln,
  pfade: Map<string, string>): Promise<T | null> {
  let ergebnis: T | null = null
  if (id && istVerschluesselteTabelle(tabelle)) {
    for (const spalte of WERT_FELDER[tabelle]) {
      if (!feldVorhanden(zeile, spalte)) continue
      const neu = await umwandeln(feldLesen(zeile, spalte), wertAad(instanzId, tabelle, spalte, id))
      if (neu !== null) ergebnis = feldSetzen(ergebnis ?? zeile, spalte, neu)
    }
  }
  for (const spalte of pfadSpalten(tabelle)) {
    const v = zeile[spalte]
    if (typeof v === 'string' && pfade.has(v)) ergebnis = feldSetzen(ergebnis ?? zeile, spalte, pfade.get(v))
  }
  return ergebnis
}

/** Pfade, auf die ein noch nicht übertragener Datensatz in der Outbox verweist */
function wartendePfade(outbox: OutboxEintrag[]): Set<string> {
  const s = new Set<string>()
  for (const e of outbox) {
    if (!e.daten || !e.tabelle) continue
    for (const spalte of pfadSpalten(e.tabelle)) {
      const v = e.daten[spalte]
      if (typeof v === 'string') s.add(v)
    }
  }
  return s
}

const gleich = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const dateiStand = (d: Datei | undefined) => d && [d.pfad, d.bucket, d.hochgeladen, d.blob.size, d.blob.type].join('|')

class Geaendert extends Error {}

/**
 * Ein Durchlauf über Gerätespeicher und Outbox. Ergebnis: Anzahl geänderter Einträge. Ändert sich währenddessen etwas
 * (Benutzer arbeitet weiter), wird alles verworfen und neu gelesen.
 */
async function speicherUmwandeln(instanzId: string, umwandeln: WertUmwandeln, datei: DateiUmwandeln): Promise<number> {
  for (let versuch = 0; ; versuch++) {
    try {
      return await durchlauf(instanzId, umwandeln, datei)
    } catch (e) {
      if (!(e instanceof Geaendert) || versuch >= 4) throw e
    }
  }
}

async function durchlauf(instanzId: string, umwandeln: WertUmwandeln, datei: DateiUmwandeln): Promise<number> {
  // 1. Lesen
  const dateien = await db.dateien.toArray()
  const outbox = await db.outbox.toArray()
  const zeilen: { name: string; tabelle: string; vorher: Zeile }[] = []
  for (const [name, tabelle] of GERAETE_TABELLEN) {
    for (const vorher of await db.table<Zeile>(name).toArray()) zeilen.push({ name, tabelle, vorher })
  }

  // 2. Umwandeln (außerhalb einer Transaktion)
  const wartend = wartendePfade(outbox)
  const pfade = new Map<string, string>()
  const neueDateien: { vorher: Datei; neu: Datei; hochladen: boolean }[] = []
  for (const d of dateien) {
    const r = await datei(d)
    if (!r) continue
    pfade.set(d.pfad, r.pfad)
    // Schon hochgeladen, aber der Datensatz wartet noch: neu hochladen (er zeigt gleich auf den neuen Pfad)
    const hochladen = !d.hochgeladen || wartend.has(d.pfad)
    neueDateien.push({ vorher: d, neu: { ...d, pfad: r.pfad, blob: r.blob, hochgeladen: !hochladen }, hochladen })
  }
  const neueZeilen: { name: string; vorher: Zeile; neu: Zeile; schluessel: unknown }[] = []
  for (const z of zeilen) {
    const neu = await zeileUmwandeln(z.tabelle, z.vorher, zeilenId(z.tabelle, z.vorher), instanzId, umwandeln, pfade)
    if (neu) neueZeilen.push({ name: z.name, vorher: z.vorher, neu, schluessel: db.table(z.name).schema.primKey.keyPath })
  }
  const neueOutbox: { vorher: OutboxEintrag; daten: Zeile }[] = []
  for (const e of outbox) {
    if (!e.daten || !e.tabelle) continue
    const id = e.art === 'update' ? (e.wo.id ?? e.id) : e.id
    const daten = await zeileUmwandeln(e.tabelle, e.daten, id, instanzId, umwandeln, pfade)
    if (daten) neueOutbox.push({ vorher: e, daten })
  }
  if (!neueDateien.length && !neueZeilen.length && !neueOutbox.length) return 0

  // 3. Schreiben, nur wenn sich seit dem Lesen nichts geändert hat
  const tabellen = [db.dateien, db.outbox, ...GERAETE_TABELLEN.map(([name]) => db.table(name))]
  await db.transaction('rw', tabellen, async () => {
    for (const { vorher, neu, hochladen } of neueDateien) {
      if (dateiStand(await db.dateien.get(vorher.id)) !== dateiStand(vorher)) throw new Geaendert()
      await db.dateien.put(neu)
      const eintrag = await db.outbox.where('art').equals('datei').filter((e) => e.id === vorher.id).first()
      if (hochladen && !eintrag) await db.outbox.add({ art: 'datei', id: vorher.id, versuche: 0, erstellt: Date.now() })
      else if (eintrag && eintrag.versuche > 0) await db.outbox.update(eintrag.nr!, { versuche: 0, fehler: undefined })
    }
    for (const { name, vorher, neu, schluessel } of neueZeilen) {
      const t = db.table<Zeile>(name)
      const k = Array.isArray(schluessel) ? schluessel.map((s) => vorher[s]) : vorher[schluessel as string]
      if (!gleich(await t.get(k as never), vorher)) throw new Geaendert()
      await t.put(neu)
    }
    for (const { vorher, daten } of neueOutbox) {
      const aktuell = await db.outbox.get(vorher.nr!)
      if (!gleich(aktuell, vorher)) throw new Geaendert()
      // Ein früherer Fehlversuch (z. B. vom Server wegen veraltetem Schlüssel abgelehnt) zählt nicht mehr
      await db.outbox.update(vorher.nr!, { daten, versuche: 0, fehler: undefined } as Partial<OutboxEintrag>)
    }
  })
  return neueDateien.length + neueZeilen.length + neueOutbox.length
}

/**
 * Klartext in verschlüsselten Feldern des Gerätespeichers verschlüsseln, Dateien ohne „.enc“ ebenso (neuer Pfad mit der
 * Kennung des Schlüssels). Geheimtext bleibt, wie er ist.
 */
export function geraetVerschluesseln(g: GespeicherterSchluessel): Promise<number> {
  return speicherUmwandeln(g.instanzId,
    async (v, aad) => (typeof v === 'string' && v !== '' && !istGeheimtext(v) ? wertVerschluesseln(v, aad, g.schluessel, g.schluesselId) : null),
    async (d) => {
      if (d.pfad.endsWith('.enc')) return null
      const bytes = new Uint8Array(await d.blob.arrayBuffer())
      if (hatDateiKopf(bytes)) return null  // schon verschlüsselt unter einem Pfad ohne .enc: gibt es nicht, nicht anfassen
      const pfad = pfadFuer(d.pfad, g.schluesselId)
      return { pfad, blob: new Blob([await bytesVerschluesseln(bytes, dateiAad(g.instanzId, d.bucket, pfad), g.schluessel)], { type: 'application/octet-stream' }) }
    })
}

/**
 * Gerätespeicher vom alten auf den neuen Schlüssel umschlüsseln. Ergebnis: Anzahl geänderter Einträge. Unlesbares bleibt,
 * wie es ist (es scheitert dann beim Server bzw. wird „nicht lesbar“ angezeigt).
 */
export function geraetUmschluesseln(alt: GespeicherterSchluessel, neu: GespeicherterSchluessel): Promise<number> {
  const neuKennung = neu.schluesselId.slice(0, 8)
  return speicherUmwandeln(neu.instanzId,
    async (v, aad) => {
      if (!istGeheimtext(v)) return null
      const u = await wertNeuVerschluesseln(v, aad, alt.schluessel, neu.schluessel, neu.schluesselId)
      return u.art === 'umgeschluesselt' ? u.wert : null
    },
    async (d) => {
      if (!d.pfad.endsWith('.enc') || pfadKennung(d.pfad) === neuKennung) return null
      let klar: ArrayBuffer
      try {
        klar = await bytesEntschluesseln(new Uint8Array(await d.blob.arrayBuffer()), dateiAad(neu.instanzId, d.bucket, d.pfad), alt.schluessel)
      } catch { return null }
      const pfad = pfadFuer(d.pfad, neu.schluesselId)
      return { pfad, blob: new Blob([await bytesVerschluesseln(klar, dateiAad(neu.instanzId, d.bucket, pfad), neu.schluessel)], { type: 'application/octet-stream' }) }
    })
}

/**
 * Geheimtext im Gerätespeicher entschlüsseln, Dateien mit „.enc“ ebenso (neuer Pfad ohne Kennung, ursprünglicher Typ).
 * Unlesbares bleibt, wie es ist (es scheitert dann beim Server und steht in der Sync-Anzeige).
 */
export function geraetEntschluesseln(g: GespeicherterSchluessel): Promise<number> {
  return speicherUmwandeln(g.instanzId,
    async (v, aad) => {
      if (!istGeheimtext(v)) return null
      try { return await wertEntschluesseln(v, aad, g.schluessel) } catch { return null }
    },
    async (d) => {
      if (!d.pfad.endsWith('.enc')) return null
      let klar: ArrayBuffer
      try {
        klar = await bytesEntschluesseln(new Uint8Array(await d.blob.arrayBuffer()), dateiAad(g.instanzId, d.bucket, d.pfad), g.schluessel)
      } catch { return null }
      const pfad = pfadBasis(d.pfad)
      return { pfad, blob: new Blob([klar], { type: ursprungsTyp(d.pfad) }) }
    })
}

/** Liegt noch Geheimtext oder eine verschlüsselte Datei im Gerätespeicher bzw. in der Outbox? */
export async function geraetHatGeheimtext(): Promise<boolean> {
  if (await db.dateien.filter((d) => d.pfad.endsWith('.enc')).count()) return true
  const geheim = (tabelle: string, z: Zeile) => (istVerschluesselteTabelle(tabelle) && WERT_FELDER[tabelle].some((s) => istGeheimtext(feldLesen(z, s))))
    || pfadSpalten(tabelle).some((s) => typeof z[s] === 'string' && (z[s] as string).endsWith('.enc'))
  for (const e of await db.outbox.toArray()) if (e.daten && e.tabelle && geheim(e.tabelle, e.daten)) return true
  for (const [name, tabelle] of GERAETE_TABELLEN) {
    if (await db.table<Zeile>(name).filter((z) => geheim(tabelle, z)).count()) return true
  }
  return false
}

/**
 * Nach erfolgreicher Prüfung (schluessel.ts, pruefen): liegt noch der alte Schlüssel eines Tauschs in meta, den
 * Gerätespeicher umschlüsseln und ihn dann löschen; `verschluesseln`: Klartext verschlüsseln (nach dem Wechsel auf „aktiv“,
 * Merker in meta bis zum Erfolg). Bricht es ab, bleibt beides stehen und geht bei der nächsten Prüfung weiter.
 */
export async function geraetNachziehen(aktuell: GespeicherterSchluessel, verschluesseln: boolean): Promise<void> {
  const alt = await metaLesen<GespeicherterSchluessel>(META_SCHLUESSEL.alt)
  if (alt) {
    if (alt.instanzId === aktuell.instanzId && alt.schluesselId !== aktuell.schluesselId) await geraetUmschluesseln(alt, aktuell)
    await db.meta.delete(META_SCHLUESSEL.alt)
  }
  if (verschluesseln) await geraetVerschluesseln(aktuell)
}
