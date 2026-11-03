// Lokale Datenbank auf dem Gerät (IndexedDB via Dexie) – Grundlage für den Offline-Betrieb.
// Stammdaten werden je Objekt heruntergeladen; Prüfdaten entstehen lokal und gehen über die Outbox an den Server.
import Dexie, { type EntityTable } from 'dexie'
import type { Zeile } from '../lib/supabase'
import { felderUmbenennen, nameUmbenennen } from '../lib/umbenennung'

export type Objekt = Zeile<'objekt'>
export type Kunde = Zeile<'endkunde'>
export type Anlagentyp = Zeile<'anlagentyp'>
export type Pruefart = Zeile<'pruefart'>
export type Element = Zeile<'anlage_element'>
export type Gruppe = Zeile<'anlage_gruppe'>
export type ElementErgebnis = Zeile<'element_ergebnis'>
export type Version = Zeile<'checkliste_version'>
export type Anlage = Zeile<'anlage'>
export type Mangel = Zeile<'mangel'>
export type Antwort = Zeile<'antwort'>
export type Mitpruefer = Zeile<'anlagenpruefung_mitpruefer'>
export type FotoZeile = Zeile<'foto'>
export type BenutzerKurz = Pick<Zeile<'benutzer'>, 'id' | 'name' | 'email' | 'sachkunde_hinweis'>

export type Pruefung = Omit<Zeile<'anlagenpruefung'>, 'altmaengel'> & {
  /** Prüfung eines Kollegen (nur Anzeige, nicht bearbeitbar) */
  fremd?: boolean
  /** Status laut Server (z. B. 'duplikat', wenn ein Kollege die Tür offline ebenfalls geprüft hat) */
  server_status?: Zeile<'anlagenpruefung'>['status']
  /** Entscheidung zu offenen Mängeln aus früheren Prüfungen (Mangel-ID → besteht/behoben, wird mit der Prüfung übertragen) */
  altmaengel?: Record<string, 'besteht' | 'behoben'>
}

export interface Datei {
  id: string
  bucket: 'fotos' | 'unterschriften'
  pfad: string
  blob: Blob
  hochgeladen: boolean
}

export type OutboxEintrag =
  | { nr?: number; art: 'upsert'; tabelle: SyncTabelle; id: string; daten: Record<string, unknown>; versuche: number; fehler?: string; erstellt: number }
  /** `nach`: Dateien (Unterschriften), die vorher beim Server sein müssen */
  | { nr?: number; art: 'update'; tabelle: SyncTabelle; id: string; wo: Record<string, string>; daten: Record<string, unknown>; nach?: string[]; versuche: number; fehler?: string; erstellt: number }
  | { nr?: number; art: 'delete'; tabelle: SyncTabelle; id: string; daten?: undefined; versuche: number; fehler?: string; erstellt: number }
  | { nr?: number; art: 'rpc'; tabelle?: undefined; id: string; rpc: string; daten: Record<string, unknown>; versuche: number; fehler?: string; erstellt: number }
  | { nr?: number; art: 'datei'; tabelle?: undefined; id: string; daten?: undefined; versuche: number; fehler?: string; erstellt: number }
  /** Datei eines gelöschten Fotos beim Server entfernen (nach dem Löschen des Datensatzes) */
  | { nr?: number; art: 'datei_loeschen'; tabelle?: undefined; id: string; daten: { bucket: Datei['bucket']; pfad: string }; versuche: number; fehler?: string; erstellt: number }

export type SyncTabelle = 'anlagenpruefung' | 'antwort' | 'mangel' | 'foto' | 'anlage' | 'session_teilnehmer' | 'anlage_element' | 'element_ergebnis'
  | 'anlagenpruefung_mitpruefer'

export interface Meta {
  schluessel: string
  wert: unknown
}

export class LokaleDb extends Dexie {
  kunden!: EntityTable<Kunde, 'id'>
  objekte!: EntityTable<Objekt, 'id'>
  anlagentypen!: EntityTable<Anlagentyp, 'id'>
  pruefarten!: EntityTable<Pruefart, 'id'>
  elemente!: EntityTable<Element, 'id'>
  gruppen!: EntityTable<Gruppe, 'id'>
  elementErgebnisse!: EntityTable<ElementErgebnis, 'id'>
  mitpruefer!: Dexie.Table<Mitpruefer, [string, string]>
  versionen!: EntityTable<Version, 'id'>
  anlagen!: EntityTable<Anlage, 'id'>
  freieEtiketten!: EntityTable<{ id: string }, 'id'>
  maengel!: EntityTable<Mangel, 'id'>
  benutzer!: EntityTable<BenutzerKurz, 'id'>
  pruefungen!: EntityTable<Pruefung, 'id'>
  antworten!: EntityTable<Antwort, 'id'>
  fotos!: EntityTable<FotoZeile, 'id'>
  dateien!: EntityTable<Datei, 'id'>
  outbox!: EntityTable<OutboxEintrag, 'nr'>
  meta!: EntityTable<Meta, 'schluessel'>

  constructor(name = 'tuerpruefung') {
    super(name)
    // Version 1 (App 1.x): Speicher hieß noch nach Türen
    this.version(1).stores({
      kunden: 'id',
      objekte: 'id, endkunde_id',
      tuertypen: 'id',
      versionen: 'id, checkliste_id',
      tueren: 'id, objekt_id, etikett_id',
      freieEtiketten: 'id',
      maengel: 'id, tuer_id, entdeckt_in',
      benutzer: 'id',
      sessions: 'id, objekt_id, status',
      teilnehmer: '[session_id+benutzer_id], session_id',
      pruefungen: 'id, session_id, tuer_id, [session_id+tuer_id]',
      antworten: 'id, tuerpruefung_id, [tuerpruefung_id+punkt_id]',
      fotos: 'id, bezug_id',
      dateien: 'id, hochgeladen',
      outbox: '++nr, [tabelle+id], art',
      meta: 'schluessel',
    })
    // Version 2 (App 2.0): Tür → Anlage. Vorhandene Daten und noch nicht übertragene Änderungen umschreiben.
    this.version(2).stores({
      anlagentypen: 'id',
      anlagen: 'id, objekt_id, etikett_id',
      maengel: 'id, anlage_id, entdeckt_in',
      pruefungen: 'id, session_id, anlage_id, [session_id+anlage_id]',
      antworten: 'id, anlagenpruefung_id, [anlagenpruefung_id+punkt_id]',
    }).upgrade(async (tx) => {
      await tx.table('anlagentypen').bulkPut((await tx.table('tuertypen').toArray()).map(felderUmbenennen))
      await tx.table('anlagen').bulkPut((await tx.table('tueren').toArray()).map(felderUmbenennen))
      for (const t of ['maengel', 'pruefungen', 'antworten']) {
        await tx.table(t).toCollection().modify((z: Record<string, unknown>) => { ersetzen(z, felderUmbenennen(z)) })
      }
      await tx.table('fotos').toCollection().modify((f: FotoZeile) => { if ((f.bezug_typ as string) === 'tuer') f.bezug_typ = 'anlage' })
      await tx.table('outbox').toCollection().modify((e: OutboxEintrag) => { ersetzen(e, outboxUmbenennen(e)) })
    })
    this.version(3).stores({ tuertypen: null, tueren: null })
    // Version 4 (App 2.1): Prüfarten je Anlagentyp
    this.version(4).stores({ pruefarten: 'id, anlagentyp_id' })
    // Version 5 (App 2.2): Elemente einer Anlage (Leuchten, Melder) und ihre Ergebnisse
    this.version(5).stores({ elemente: 'id, anlage_id', elementErgebnisse: 'id, anlagenpruefung_id, [anlagenpruefung_id+element_id]' })
    // Version 6: Mitprüfer einer Anlagenprüfung (Mehrpersonenprüfung)
    this.version(6).stores({ mitpruefer: '[anlagenpruefung_id+benutzer_id], anlagenpruefung_id, session_id' })
    // Version 7 (App 2.21): Code der Elemente (Aufkleber eines Melders) zum Wiederfinden beim Scannen
    this.version(7).stores({ elemente: 'id, anlage_id, code' })
    // Version 8 (App 3.0): Prüfung je Anlage – keine Sessions mehr. Der Server löst offene Sessions beim Update auf;
    // hier dasselbe auf dem Gerät, damit noch nicht übertragene Arbeit zu den aufgelösten Prüfungen passt.
    this.version(8).stores({ sessions: null, teilnehmer: null }).upgrade(async (tx) => {
      await tx.table('pruefungen').toCollection().modify((p: Record<string, unknown>) => { p.session_id = null })
      await tx.table('mitpruefer').toCollection().modify((m: Record<string, unknown>) => { m.session_id = null })
      await tx.table('outbox').toCollection().modify((e: OutboxEintrag) => {
        const neu = ohneSession(e)
        if (neu !== e) ersetzen(e, neu ?? { ...e, verwerfen: true })
      })
      await tx.table('outbox').filter((e: { verwerfen?: boolean }) => !!e.verwerfen).delete()
    })
    // Version 9: Türanlagen (docs/KONZEPT-TUERANLAGE.md) – Türen gehören über teil_von_id zu einer Türanlage,
    // Teilprüfungen über teil_von_id zur Hauptprüfung der Türanlage
    this.version(9).stores({
      anlagen: 'id, objekt_id, etikett_id, teil_von_id',
      pruefungen: 'id, session_id, anlage_id, [session_id+anlage_id], teil_von_id',
    })
    // Version 10 (App 2.63): Gruppen der Elemente (Wohnung / Bereich …), vorab angelegt; nur gelesen, angelegt werden
    // sie auf dem Server mit dem ersten Element darin
    this.version(10).stores({ gruppen: 'id, anlage_id' })
  }
}

export const db = new LokaleDb()

// ---------------------------------------------------------------------------
// Umstellung Tür → Anlage (Datenbank-Version 2)
// ---------------------------------------------------------------------------
export function outboxUmbenennen(e: OutboxEintrag): OutboxEintrag {
  const neu = { ...e } as Record<string, unknown>
  if (e.tabelle) neu.tabelle = nameUmbenennen(e.tabelle)
  if (e.art === 'rpc') neu.rpc = nameUmbenennen(e.rpc)
  if (e.daten) neu.daten = felderUmbenennen(e.daten)
  if (e.art === 'update') neu.wo = felderUmbenennen(e.wo)
  // Mit alten Namen fehlgeschlagene Versuche zählen nicht
  if (e.fehler) { neu.versuche = 0; delete neu.fehler }
  return neu as OutboxEintrag
}

// ---------------------------------------------------------------------------
// Umstellung auf Prüfung je Anlage (Datenbank-Version 8)
// ---------------------------------------------------------------------------
const SESSION_RPC = ['session_starten', 'anlage_reservieren', 'anlage_nicht_geprueft', 'session_abschliessen', 'sessionleitung_uebertragen', 'session_verwerfen']

/** Ausstehende Übertragung ohne Session-Bezug – oder null, wenn sie nur die Session betraf und entfällt. */
export function ohneSession(e: OutboxEintrag): OutboxEintrag | null {
  if (e.art === 'rpc' && SESSION_RPC.includes(e.rpc)) return null
  if (e.tabelle === 'session_teilnehmer') return null
  if (e.daten && 'session_id' in e.daten) {
    const { session_id: _weg, ...daten } = e.daten
    return { ...e, daten } as OutboxEintrag
  }
  return e
}

/** Objekt an Ort und Stelle ersetzen (für Dexie modify). */
function ersetzen(ziel: object, quelle: object) {
  for (const k of Object.keys(ziel)) delete (ziel as Record<string, unknown>)[k]
  Object.assign(ziel, quelle)
}

export async function metaLesen<T>(schluessel: string): Promise<T | undefined> {
  return (await db.meta.get(schluessel))?.wert as T | undefined
}

export async function metaSchreiben(schluessel: string, wert: unknown) {
  await db.meta.put({ schluessel, wert })
}

/** Alles Lokale löschen (beim Abmelden, wenn nichts mehr aussteht). */
export async function lokaleDatenLoeschen() {
  await Promise.all(db.tables.map((t) => t.clear()))
}
