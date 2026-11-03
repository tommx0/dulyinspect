// Outbox und laufender Sync (Spezifikation Abschnitt 7).
// Jede Änderung wird lokal gespeichert und als Outbox-Eintrag vorgemerkt. Solange Netz da ist, wird die
// Outbox nach ~1,5 s abgearbeitet; Netzaussetzer werden mit steigendem Abstand wiederholt.
import { useLiveQuery } from 'dexie-react-hooks'
import { useSyncExternalStore } from 'react'
import { fehlertext, supabase } from '../lib/supabase'
import { loggen } from '../lib/log'
import { t } from '../lib/sprache'
import { demoSperreAktiv } from '../lib/demo'
import type { Zeile } from '../lib/supabase'
import { FalscheInstanzFehler, GesperrtFehler, NichtPruefbarFehler, instanzPruefen } from '../lib/verschluesselung/schluessel'
import { aufraeumen } from './aufraeumen'
import { db, type OutboxEintrag, type SyncTabelle } from './db'
import { kundendatenLoeschungPruefen } from './kundendatenGeloescht'

const MAX_VERSUCHE = 3
const WARTEZEITEN = [2_000, 5_000, 15_000, 60_000]
/** Felder, die nur der Server setzt – werden beim Hochladen nicht mitgeschickt */
const SERVERFELDER: Record<string, string[]> = {
  anlagenpruefung: ['fremd', 'server_status', 'duplikat_von', 'duplikat_geklaert', 'erstellt_am', 'geaendert_am',
    'abgeschlossen_am', 'protokoll_nr', 'unterschrift_am', 'kunde_unterschrift_am', 'urspruenglicher_pruefer_id', 'uebernommen_am'],
  anlagenpruefung_mitpruefer: ['fertig_am'],
  anlage: ['letzte_pruefung_am', 'letztes_ergebnis', 'naechste_pruefung_am', 'erstellt_am', 'geaendert_am'],
  mangel: ['erstellt_am', 'geaendert_am'],
  antwort: ['erstellt_am', 'geaendert_am'],
  foto: [],
  session_teilnehmer: [],
  anlage_element: ['zuletzt_geprueft_am', 'erstellt_am', 'geaendert_am'],
  element_ergebnis: ['erstellt_am', 'geaendert_am'],
}

// ---------------------------------------------------------------------------
// Status (für die Sync-Anzeige)
// ---------------------------------------------------------------------------
export interface SyncStatus {
  online: boolean
  laeuft: boolean
  fehler: string
  letzterErfolg: number | null
}

let status: SyncStatus = { online: navigator.onLine, laeuft: false, fehler: '', letzterErfolg: null }
const hoerer = new Set<() => void>()
function setze(teil: Partial<SyncStatus>) {
  status = { ...status, ...teil }
  hoerer.forEach((h) => h())
}

export function useSyncStatus() {
  const s = useSyncExternalStore((h) => { hoerer.add(h); return () => hoerer.delete(h) }, () => status)
  const ausstehend = useLiveQuery(() => db.outbox.filter((e) => e.versuche < MAX_VERSUCHE).count(), [], 0)
  const fehlgeschlagen = useLiveQuery(() => db.outbox.filter((e) => e.versuche >= MAX_VERSUCHE).toArray(), [], [])
  const aeltester = useLiveQuery(() => db.outbox.orderBy('nr').first(), [], undefined)
  return { ...s, ausstehend, fehlgeschlagen, aeltesterSeit: aeltester?.erstellt ?? null }
}

// ---------------------------------------------------------------------------
// Vormerken
// ---------------------------------------------------------------------------
type Neu = OutboxEintrag extends infer E ? E extends OutboxEintrag ? Omit<E, 'nr' | 'versuche' | 'erstellt'> : never : never

/** Änderung für den Server vormerken. Mehrere Upserts desselben Datensatzes werden zusammengefasst. */
export async function vormerken(e: Neu) {
  await db.transaction('rw', db.outbox, async () => {
    if (e.art === 'upsert') {
      const alt = await db.outbox.where('[tabelle+id]').equals([e.tabelle, e.id])
        .filter((x) => x.art === 'upsert' && x.versuche === 0).first()
      if (alt && alt.art === 'upsert') {
        await db.outbox.update(alt.nr!, { daten: { ...alt.daten, ...e.daten } })
        return
      }
    }
    await db.outbox.add({ ...e, versuche: 0, erstellt: Date.now() } as OutboxEintrag)
  })
  syncAnstossen()
}

/** Was der Server nach dem Speichern einer Prüfung zurückmeldet (Duplikat, Abschluss, gültige Unterschriften) */
export const PRUEFUNG_SERVERSTAND = 'id, status, duplikat_von, duplikat_geklaert, abgeschlossen_am, protokoll_nr, revision, unterschrift_am, kunde_unterschrift_am'
type Serverstand = Pick<Zeile<'anlagenpruefung'>, 'id' | 'status' | 'duplikat_von' | 'duplikat_geklaert' | 'abgeschlossen_am' | 'protokoll_nr'
  | 'revision' | 'unterschrift_am' | 'kunde_unterschrift_am'>

async function serverstandUebernehmen(s: Serverstand) {
  const { status, ...rest } = s
  await db.pruefungen.update(s.id, { ...rest, server_status: status })
}

class WartetAufDatei extends Error {
  constructor() { super('Die Unterschrift ist noch nicht übertragen. Bitte zuerst die Datei erneut senden.') }
}

/** Abgelehnten Abschluss zurücknehmen: Prüfung wieder offen, Hinweis unter `abschluss:<Prüfung>`. */
async function abschlussAbgelehnt(pruefungId: string, nr: number, grund: string) {
  await db.transaction('rw', [db.pruefungen, db.outbox, db.meta], async () => {
    await db.outbox.delete(nr)
    const unterschrift = /unterschreiben/i.test(grund) ? { unterschrift_am: null } : {}
    await db.pruefungen.update(pruefungId, { status: 'in_pruefung', ...unterschrift })
    await db.meta.put({ schluessel: `abschluss:${pruefungId}`, wert: grund })
  })
  void loggen('Abschluss abgelehnt', `Prüfung ${pruefungId}: ${grund}`)
}

function bereinigen(tabelle: SyncTabelle, daten: Record<string, unknown>) {
  const raus = SERVERFELDER[tabelle] ?? []
  return Object.fromEntries(Object.entries(daten).filter(([k]) => !raus.includes(k)))
}

// ---------------------------------------------------------------------------
// Abarbeiten
// ---------------------------------------------------------------------------
let laeuft = false
let nochmal = false
let timer: ReturnType<typeof setTimeout> | undefined
let fehlerFolge = 0

export function syncAnstossen(verzoegerung = 1_500) {
  clearTimeout(timer)
  timer = setTimeout(() => { void syncJetzt() }, verzoegerung)
}

export function istNetzwerkfehler(e: unknown): boolean {
  if (!navigator.onLine) return true
  const m = fehlertext(e)
  const s = (e as { status?: number; statusCode?: string })?.status ?? Number((e as { statusCode?: string })?.statusCode)
  return /failed to fetch|networkerror|load failed|network request failed|timeout|fetch/i.test(m) || [0, 502, 503, 504].includes(s)
}

/** Datei-Eintrag der Outbox sofort hochladen (wenn ein Datensatz auf die Datei wartet und sie später in der Outbox steht). */
async function dateiVorziehen(id: string): Promise<boolean> {
  const eintrag = await db.outbox.where('art').equals('datei').filter((x) => x.id === id && x.versuche < MAX_VERSUCHE).first()
  if (!eintrag) return false
  await ausfuehren(eintrag)
  await db.outbox.delete(eintrag.nr!)
  return true
}

/** Unterschriften bleiben auf dem Gerät, bis der Datensatz übertragen ist, der auf sie zeigt (sonst ließen sie sich nicht mehr umschlüsseln). */
async function unterschriftenWeg(ids: string[]) {
  for (const id of ids) {
    const d = await db.dateien.get(id)
    if (d?.bucket === 'unterschriften' && d.hochgeladen) await db.dateien.delete(id)
  }
}

async function ausfuehren(e: OutboxEintrag) {
  switch (e.art) {
    case 'upsert': {
      const daten = bereinigen(e.tabelle, e.daten)
      if (e.tabelle === 'anlagenpruefung') {
        const { data, error } = await supabase.from('anlagenpruefung').upsert(daten as never).select(PRUEFUNG_SERVERSTAND).single()
        if (error) throw error
        await serverstandUebernehmen(data as Serverstand)
        return
      }
      const { error } = await supabase.from(e.tabelle).upsert(daten as never)
      if (error) throw error
      return
    }
    case 'update': {
      for (const id of e.nach ?? []) {
        const d = await db.dateien.get(id)
        // Die Datei steht (z. B. nach dem Umschlüsseln des Gerätespeichers) erst später in der Outbox: vorziehen
        if (d && !d.hochgeladen && !await dateiVorziehen(id)) throw new WartetAufDatei()
      }
      let q = supabase.from(e.tabelle).update(bereinigen(e.tabelle, e.daten) as never)
      for (const [k, v] of Object.entries(e.wo)) q = q.eq(k, v as string)
      if (e.tabelle === 'anlagenpruefung' || e.tabelle === 'anlagenpruefung_mitpruefer') {
        // Abschluss und Fertigmeldung dürfen nicht still an fehlenden Rechten scheitern
        const { data, error } = await q.select(e.tabelle === 'anlagenpruefung' ? PRUEFUNG_SERVERSTAND : '*')
        if (error) throw error
        if (!data?.length) throw new Error('Die Änderung wurde vom Server nicht angenommen (keine Berechtigung oder Prüfung nicht mehr vorhanden).')
        if (e.tabelle === 'anlagenpruefung') await serverstandUebernehmen(data[0] as unknown as Serverstand)
        else {
          const m = data[0] as unknown as Zeile<'anlagenpruefung_mitpruefer'>
          await db.mitpruefer.update([m.anlagenpruefung_id, m.benutzer_id], { fertig_am: m.fertig_am })
        }
        await unterschriftenWeg(e.nach ?? [])
        return
      }
      const { error } = await q
      if (error) throw error
      await unterschriftenWeg(e.nach ?? [])
      return
    }
    case 'delete': {
      const { error } = await supabase.from(e.tabelle as 'mangel').delete().eq('id', e.id)
      if (error) throw error
      return
    }
    case 'rpc': {
      const { error } = await supabase.rpc(e.rpc as never, e.daten as never)
      if (error) throw error
      return
    }
    case 'datei': {
      const d = await db.dateien.get(e.id)
      if (!d || d.hochgeladen) return
      // Verschlüsselte Dateien (Pfad auf „.enc“, schon auf dem Gerät verschlüsselt) gehen als application/octet-stream hoch
      const typ = d.pfad.endsWith('.enc') ? 'application/octet-stream' : d.blob.type
      const { error } = await supabase.storage.from(d.bucket).upload(d.pfad, d.blob, { contentType: typ, upsert: false })
      // Bereits vorhanden (z. B. nach Verbindungsabbruch während des Uploads) gilt als Erfolg
      if (error && !/exists|duplicate/i.test(error.message)) throw error
      // Unterschriften bleiben nur, bis ihr Datensatz übertragen ist (unterschriftenWeg), danach sind sie nur noch beim
      // Server (bis das Protokoll da ist)
      await db.dateien.update(d.id, { hochgeladen: true })
      return
    }
    case 'datei_loeschen': {
      // Storage meldet fehlende Rechte nicht als Fehler – bleibt die Datei liegen, räumt sie das Umschlüsseln als verwaist auf
      const { error } = await supabase.storage.from(e.daten.bucket).remove([e.daten.pfad])
      if (error) throw error
      return
    }
  }
}

/** Darf weiter übertragen werden? (Bedingung 3; ohne Verbindung: ja – der nächste Netzwerkfehler hält den Lauf ohnehin an) */
async function nochFrei(frisch = false): Promise<boolean> {
  try {
    await instanzPruefen({ frisch })
    return true
  } catch (err) {
    if (err instanceof NichtPruefbarFehler) return true
    setze({ fehler: err instanceof FalscheInstanzFehler ? t('Übertragung gesperrt: falsche Instanz') : t('Übertragung wartet auf den Schlüssel') })
    return false
  }
}

export async function syncJetzt(): Promise<void> {
  if (laeuft) { nochmal = true; return }
  // Demomodus: Prüfungen bleiben als Simulation auf dem Gerät, die Warteschlange wird nie übertragen
  if (demoSperreAktiv()) return
  if (!navigator.onLine) { setze({ online: false }); return }
  laeuft = true
  setze({ online: true, laeuft: true })
  let gesperrt = false
  try {
    // Bedingung 3 (docs/KONZEPT-VERSCHLUESSELUNG.md): nichts an einen Server schicken, der nicht zum Schlüssel des Geräts
    // gehört, und nichts während eines Schlüsseltauschs auf einem anderen Gerät. Die Outbox bleibt liegen.
    try {
      await instanzPruefen()
    } catch (err) {
      gesperrt = true
      if (err instanceof NichtPruefbarFehler) {
        fehlerFolge++
        setze({ fehler: t('Keine Verbindung zum Server') })
        syncAnstossen(WARTEZEITEN[Math.min(fehlerFolge - 1, WARTEZEITEN.length - 1)])
      } else if (err instanceof FalscheInstanzFehler || err instanceof GesperrtFehler) {
        setze({ fehler: err instanceof FalscheInstanzFehler ? t('Übertragung gesperrt: falsche Instanz') : t('Übertragung wartet auf den Schlüssel') })
      } else throw err
      return
    }
    // Hat der Admin inzwischen alle Kundendaten gelöscht, gehen ältere Änderungen nicht mehr hinaus
    await kundendatenLoeschungPruefen()
    for (;;) {
      const e = await db.outbox.orderBy('nr').filter((x) => x.versuche < MAX_VERSUCHE).first()
      if (!e) break
      // Bedingung 3 auch während eines langen Laufs (höchstens alle 3 Sekunden beim Server): Ein Tausch, der inzwischen
      // begonnen oder abgeschlossen wurde, hält die Outbox an, bevor etwas mit dem alten Schlüssel hinausgeht
      if (!await nochFrei()) { gesperrt = true; break }
      try {
        await ausfuehren(e)
        await db.outbox.delete(e.nr!)
        fehlerFolge = 0
        setze({ fehler: '', letzterErfolg: Date.now() })
      } catch (err) {
        if (istNetzwerkfehler(err)) {
          fehlerFolge++
          setze({ fehler: t('Keine Verbindung zum Server') })
          syncAnstossen(WARTEZEITEN[Math.min(fehlerFolge - 1, WARTEZEITEN.length - 1)])
          break
        }
        // Vom Server abgelehnt: zuerst frisch prüfen, ob sich Schlüssel oder Instanz geändert haben (z. B. „veralteter
        // Schlüssel“ nach einem Tausch) – dann wartet der Eintrag, bis das neue Blatt gescannt und die Outbox umgeschlüsselt ist,
        // und zählt nicht als Fehlversuch
        if (!await nochFrei(true)) { gesperrt = true; break }
        // Abschluss vom Server abgelehnt (z. B. Unterschrift inzwischen erloschen): Prüfung läuft auf dem Gerät weiter,
        // der Grund steht in der Prüfung – ein erneuter Versuch mit denselben Daten würde wieder scheitern.
        // „Tür fertig“ einer Türanlage (Teilprüfung) ist kein Abschluss: normal wiederholen bzw. als fehlgeschlagen zeigen.
        if (e.art === 'update' && e.tabelle === 'anlagenpruefung' && e.daten.status === 'geprueft' && !(err instanceof WartetAufDatei)
            && !(await db.pruefungen.get(e.id))?.teil_von_id) {
          await abschlussAbgelehnt(e.id, e.nr!, fehlertext(err))
          setze({ fehler: fehlertext(err) })
          continue
        }
        const versuche = e.versuche + 1
        await db.outbox.update(e.nr!, { versuche, fehler: fehlertext(err) })
        setze({ fehler: fehlertext(err) })
        if (versuche < MAX_VERSUCHE) {
          syncAnstossen(WARTEZEITEN[Math.min(versuche, WARTEZEITEN.length - 1)])
          break
        }
        // endgültig fehlgeschlagen: bleibt zur Anzeige liegen, nächster Eintrag wird versucht
        void loggen('Übertragung fehlgeschlagen', `${{ upsert: 'Speichern', update: 'Ändern', delete: 'Löschen', rpc: 'Funktion', datei: 'Datei hochladen', datei_loeschen: 'Datei löschen' }[e.art]} ${e.art === 'rpc' ? e.rpc : e.tabelle ?? ''} (ID ${e.id}): ${fehlertext(err)}`)
      }
    }
  } finally {
    laeuft = false
    setze({ laeuft: false })
    if (nochmal) { nochmal = false; syncAnstossen(0) }
    else if (!gesperrt && navigator.onLine && import.meta.env.MODE !== 'test') void nachSync()
  }
}

/** Nach einem vollständigen Sync: Protokolle erzeugen, dann Bestätigtes vom Gerät räumen */
async function nachSync() {
  // Abgeschlossene Prüfungen: Protokoll erzeugen (erst hier geladen – PDF-Erzeugung ist groß)
  await import('../protokoll/automatisch').then((m) => m.protokolleNachholen()).catch(() => undefined)
  await aufraeumen()
}

/** Wartet, bis die Outbox leer ist (oder bricht nach `ms` ab). Für Aktionen, die den aktuellen Serverstand brauchen. */
export async function syncBisLeer(ms = 20_000): Promise<boolean> {
  // Demomodus: es wird nie übertragen – nicht warten
  if (demoSperreAktiv()) return false
  const ende = Date.now() + ms
  while (Date.now() < ende) {
    await syncJetzt()
    const rest = await db.outbox.filter((e) => e.versuche < MAX_VERSUCHE).count()
    if (rest === 0) return true
    if (!navigator.onLine) return false
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

/** Endgültig fehlgeschlagenen Eintrag erneut versuchen bzw. verwerfen. */
export async function eintragWiederholen(nr: number) {
  await db.outbox.update(nr, { versuche: 0, fehler: undefined })
  syncAnstossen(0)
}
export async function eintragVerwerfen(nr: number) {
  await db.outbox.delete(nr)
}

// ---------------------------------------------------------------------------
// Auslöser: Netz zurück, App wieder im Vordergrund, regelmäßig
// ---------------------------------------------------------------------------
let gestartet = false
export function syncStarten() {
  if (gestartet) return
  gestartet = true
  window.addEventListener('online', () => { setze({ online: true }); fehlerFolge = 0; syncAnstossen(0) })
  window.addEventListener('offline', () => setze({ online: false }))
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncAnstossen(0) })
  setInterval(() => syncAnstossen(0), 60_000)
  // Browser bitten, die lokalen Daten nicht automatisch zu löschen (wichtig für iOS)
  void navigator.storage?.persist?.()
  syncAnstossen(0)
}
