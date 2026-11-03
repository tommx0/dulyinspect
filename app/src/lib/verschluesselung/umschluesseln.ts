// Bestand umschlüsseln: Umstellung einer bestehenden Instanz und Schlüsseltausch (docs/KONZEPT-VERSCHLUESSELUNG.md,
// „Umstellung einer bestehenden Instanz“ Schritt 4, „Abgang eines Mitarbeiters“ 3). Läuft im Browser eines Admins,
// ohne Oberfläche: Fortschritt über onFortschritt, abbrechen über signal. Fortsetzbar – jeder Lauf nimmt nur, was noch
// fehlt, und setzt nur Werte, die sich seit dem Lesen nicht geändert haben (umschluesseln auf dem Server).
//
// Umstellung (verschluesselung.aktiv = false): Klartext → Geheimtext; Dateien unter „<pfad>.k<Schlüssel>.enc“ verschlüsselt
//   hochladen, Pfad umsetzen, alte Datei löschen. Danach umstellungAbschliessen().
// Tausch (eigener Tausch läuft): Geheimtext alt → neu; Dateien unter „<basis>.k<neue ID>.enc“, alte löschen. Danach
//   tauschAbschliessen() – prüft erneut alles und schließt erst ab, wenn nichts mehr umzuschlüsseln ist. Andere Geräte
//   übertragen währenddessen nichts (instanzPruefen); der Server prüft beim Abschluss an der Schlüssel-ID in Werten und
//   Pfaden, dass nichts mehr mit dem alten Schlüssel verschlüsselt ist.
// Abbruch eines Tauschs (tauschAbbrechen): derselbe Lauf rückwärts (neu → bisheriger Schlüssel), dann gibt der Server die
//   anderen Geräte wieder frei.
// Abschaltung (abschaltungBeginnen, abschalten): Geheimtext → Klartext; Dateien entschlüsselt unter dem Pfad ohne Kennung
//   hochladen, Pfad umsetzen, „.enc“ löschen; wiederholt, bis nichts mehr übrig ist (andere Geräte arbeiten weiter). Danach
//   schaltet der Server ab, und jedes Gerät entschlüsselt seinen Gerätespeicher. abschaltungAbbrechen macht daraus wieder
//   eine Umstellung.
// Verwaiste Dateien (ohne Datensatz, noch nicht mit dem Zielschlüssel verschlüsselt) löscht jeder Durchlauf, sobald sie älter
//   als die Mindestfrist der Datenbank sind (verschluesselung_verwaiste: Datei, deren Datensatz noch in einer Outbox wartet,
//   ist nur scheinbar verwaist). Solange welche da sind, lehnt der Server Aktivieren und Abschluss ab.
// Protokolle bleiben unveränderlich: der Inhalt muss zur gespeicherten Prüfsumme (sha256 der unverschlüsselten PDF) passen,
//   und eine schon vorhandene Datei unter dem neuen Pfad muss denselben Inhalt haben.
import { db, metaLesen, metaSchreiben } from '../../offline/db'
import { loggen } from '../log'
import { fehlertext, supabase } from '../supabase'
import { t } from '../sprache'
import { PFAD_FELDER, SCHLUESSEL_SPALTEN, WERT_FELDER, type VerschluesselterBucket } from './felder'
import { GEHEIM_TYP, istVerschluesselterPfad, pfadBasis, pfadFuer, ursprungsTyp } from './dateien'
import { wertNeuVerschluesseln } from './geraet'
import { bytesEntschluesseln, bytesVerschluesseln, dateiAad, hatDateiKopf, istGeheimtext, wertAad, wertEntschluesseln, wertVerschluesseln } from './krypto'
import { STICHTAG, abschaltnachweis, blattOffen, eigeneAbschaltungUebernehmen, pruefen, schluesselFuerTausch, tauschUebernehmen, tauschVerwerfen } from './schluessel'
import { merkspeicherLeeren } from './werte'

export interface Fortschritt {
  phase: 'werte' | 'dateien' | 'aufraeumen'
  /** z. B. „endkunde.name“ */
  feld: string
  erledigt: number
  gesamt: number
  fehler: number
}

export interface UmschluesselnFehler {
  tabelle: string
  spalte: string
  schluessel: Record<string, string>
  meldung: string
}

export interface UmschluesselnErgebnis {
  art: 'umstellung' | 'tausch' | 'rueckweg' | 'abschaltung'
  /** auf dem Server geänderte Werte und Pfade */
  geaendert: number
  /** geprüfte Werte und Dateien (auch schon erledigte) */
  geprueft: number
  fehler: UmschluesselnFehler[]
  /** Dateien ohne Datensatz: gelöscht bzw. noch zu jung (ihr Datensatz wartet womöglich in einer Outbox) */
  verwaist: { geloescht: number; wartend: number }
}

export interface UmschluesselnOptionen {
  onFortschritt?: (f: Fortschritt) => void
  signal?: AbortSignal
  /** Zeilen je Abfrage (Standard 500) */
  seite?: number
  /** Dateien gleichzeitig (Standard 3) */
  parallel?: number
}

/** Abschaltung: nicht lesbare Werte durch „(nicht lesbar)“ ersetzen, nicht lesbare Dateien verwerfen (abschalten mit trotzFehlern) */
const NICHT_LESBAR_TEXT = '(nicht lesbar)'

const MAX_JE_AUFRUF = 200
const LOESCHEN = 'verschluesselung:loeschen'

type Aenderung = { tabelle: string; spalte: string; schluessel: Record<string, string>; alt: string; neu: string; fehlt?: boolean; verwerfen?: boolean }
type Zeile = Record<string, unknown>

interface Lauf {
  art: 'umstellung' | 'tausch' | 'rueckweg' | 'abschaltung'
  instanzId: string
  /** Rückweg: der neue Schlüssel des abgebrochenen Tauschs */
  alt: CryptoKey
  /** Umstellung und Abschaltung: derselbe wie alt; Rückweg: der bisherige */
  neu: CryptoKey
  /** Abschaltung: leer (Ziel ist Klartext) */
  neuId: string
  /** Abschaltung: Unlesbares verwerfen statt nur zu melden */
  verwerfen: boolean
  ergebnis: UmschluesselnErgebnis
  gesamt: number
  optionen: UmschluesselnOptionen
}

function fortschritt(l: Lauf, phase: Fortschritt['phase'], feld: string) {
  l.optionen.onFortschritt?.({ phase, feld, erledigt: l.ergebnis.geprueft, gesamt: Math.max(l.gesamt, l.ergebnis.geprueft), fehler: l.ergebnis.fehler.length })
}

function schluesselVon(tabelle: string, z: Zeile): Record<string, string> {
  return Object.fromEntries(SCHLUESSEL_SPALTEN[tabelle].map((s) => [s, String(z[s])]))
}

async function senden(l: Lauf, aenderungen: Aenderung[]) {
  for (let i = 0; i < aenderungen.length; i += MAX_JE_AUFRUF) {
    const { data, error } = await supabase.rpc('umschluesseln', { p_aenderungen: aenderungen.slice(i, i + MAX_JE_AUFRUF) as never })
    if (error) throw new Error(t('Umschlüsseln abgelehnt: {fehler}', { fehler: fehlertext(error) }))
    l.ergebnis.geaendert += data ?? 0
  }
}

/** Alle Zeilen einer Tabelle seitenweise (stabil nach Schlüssel sortiert) */
async function* zeilen(tabelle: string, auswahl: string, nichtNull: string, seite: number): AsyncGenerator<Zeile[]> {
  for (let von = 0; ; von += seite) {
    let q = supabase.from(tabelle as 'endkunde').select(auswahl).not(nichtNull as 'name', 'is', null)
    for (const s of SCHLUESSEL_SPALTEN[tabelle]) q = q.order(s as 'id')
    const { data, error } = await q.range(von, von + seite - 1)
    if (error) throw new Error(`${tabelle}: ${fehlertext(error)}`)
    const liste = (data ?? []) as unknown as Zeile[]
    if (liste.length) yield liste
    if (liste.length < seite) return
  }
}

// ---------------------------------------------------------------------------
// Werte
// ---------------------------------------------------------------------------
async function werteUmschluesseln(l: Lauf) {
  for (const [tabelle, felder] of Object.entries(WERT_FELDER) as [keyof typeof WERT_FELDER, readonly string[]][]) {
    for (const spalte of felder) {
      l.optionen.signal?.throwIfAborted()
      const [a, b] = spalte.split('.')
      const auswahl = [...SCHLUESSEL_SPALTEN[tabelle], b ? `wert:${a}->>${b}` : `wert:${a}`].join(', ')
      for await (const seite of zeilen(tabelle, auswahl, b ? `${a}->>${b}` : a, l.optionen.seite ?? 500)) {
        const aenderungen: Aenderung[] = []
        for (const z of seite) {
          const v = z.wert
          if (typeof v !== 'string' || v === '') continue
          const schluessel = schluesselVon(tabelle, z)
          const aad = wertAad(l.instanzId, tabelle, spalte, SCHLUESSEL_SPALTEN[tabelle].map((s) => schluessel[s]).join('/'))
          const fehler = (meldung: string) => l.ergebnis.fehler.push({ tabelle, spalte, schluessel, meldung })
          l.ergebnis.geprueft++
          if (l.art === 'abschaltung') {
            if (!istGeheimtext(v)) continue
            try {
              aenderungen.push({ tabelle, spalte, schluessel, alt: v, neu: await wertEntschluesseln(v, aad, l.alt) })
            } catch {
              fehler(t('Geheimtext mit diesem Schlüssel nicht lesbar'))
              if (l.verwerfen) aenderungen.push({ tabelle, spalte, schluessel, alt: v, neu: NICHT_LESBAR_TEXT })
            }
          } else if (l.art === 'umstellung') {
            if (!istGeheimtext(v)) aenderungen.push({ tabelle, spalte, schluessel, alt: v, neu: await wertVerschluesseln(v, aad, l.neu, l.neuId) })
            else await wertEntschluesseln(v, aad, l.neu).catch(() => fehler(t('Geheimtext mit diesem Schlüssel nicht lesbar')))
          } else if (!istGeheimtext(v)) {
            fehler(t('Klartext bei aktiver Verschlüsselung'))
          } else {
            const u = await wertNeuVerschluesseln(v, aad, l.alt, l.neu, l.neuId)
            if (u.art === 'umgeschluesselt') aenderungen.push({ tabelle, spalte, schluessel, alt: v, neu: u.wert })
            else if (u.art === 'unlesbar') fehler(t('Mit keinem der beiden Schlüssel lesbar'))
          }
        }
        await senden(l, aenderungen)
        fortschritt(l, 'werte', `${tabelle}.${spalte}`)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Dateien
// ---------------------------------------------------------------------------
function istNichtGefunden(e: unknown): boolean {
  const s = e as { statusCode?: string | number; status?: number; message?: string }
  return String(s?.statusCode ?? s?.status ?? '') === '404' || /not.?found|nicht gefunden/i.test(s?.message ?? '')
}

async function herunterladen(bucket: string, pfad: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const { data, error } = await supabase.storage.from(bucket).download(pfad)
  if (error) {
    if (istNichtGefunden(error)) return null
    throw error
  }
  return new Uint8Array(await data.arrayBuffer())
}

function bytesGleich(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

async function sha256Hex(daten: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', daten))].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/**
 * Hochladen; liegt die Datei schon da (früherer abgebrochener Lauf, gemeinsame Unterschrift), muss sie mit dem neuen
 * Schlüssel lesbar sein und denselben Inhalt haben wie die alte – sonst bleibt der Pfad, wie er ist.
 */
async function ablegen(l: Lauf, bucket: string, ziel: string, bytes: Uint8Array<ArrayBuffer>, klar: Uint8Array) {
  const { error } = await supabase.storage.from(bucket).upload(ziel, new Blob([bytes], { type: GEHEIM_TYP }), { contentType: GEHEIM_TYP, upsert: false })
  if (!error) return
  if (!/exists|duplicate/i.test(error.message)) throw error
  const vorhanden = await herunterladen(bucket, ziel)
  if (!vorhanden) throw error
  const inhalt = new Uint8Array(await bytesEntschluesseln(vorhanden, dateiAad(l.instanzId, bucket, ziel), l.neu))
  if (!bytesGleich(inhalt, klar)) throw new Error(t('Unter dem neuen Pfad liegt schon eine Datei mit anderem Inhalt – nicht umgeschlüsselt'))
}

/** Abschaltung: entschlüsselt mit dem ursprünglichen Typ ablegen; liegt die Datei schon da, muss sie denselben Inhalt haben. */
async function klartextAblegen(bucket: string, ziel: string, klar: Uint8Array<ArrayBuffer>) {
  const typ = ursprungsTyp(ziel)
  const { error } = await supabase.storage.from(bucket).upload(ziel, new Blob([klar], { type: typ }), { contentType: typ, upsert: false })
  if (!error) return
  if (!/exists|duplicate/i.test(error.message)) throw error
  const vorhanden = await herunterladen(bucket, ziel)
  if (!vorhanden) throw error
  if (!bytesGleich(vorhanden, klar)) throw new Error(t('Unter dem Pfad ohne Verschlüsselung liegt schon eine Datei mit anderem Inhalt – nicht entschlüsselt'))
}

async function dateiEntschluesseln(l: Lauf, tabelle: string, spalte: string, bucket: VerschluesselterBucket, z: Zeile) {
  const pfad = z.pfad as string
  const schluessel = schluesselVon(tabelle, z)
  const fehler = (meldung: string) => l.ergebnis.fehler.push({ tabelle, spalte, schluessel, meldung })
  l.ergebnis.geprueft++
  if (!istVerschluesselterPfad(pfad)) return
  const ziel = pfadBasis(pfad)
  const bytes = await herunterladen(bucket, pfad)
  if (!bytes) {
    await senden(l, [{ tabelle, spalte, schluessel, alt: pfad, neu: ziel, fehlt: true }])
    return fehler(t('Datei fehlt im Speicher (Pfad trotzdem umgesetzt)'))
  }
  const verwerfen = async (meldung: string) => {
    fehler(meldung)
    // Pfad ohne Datei umsetzen; die alte Datei bleibt verwaist zurück und wird mit den übrigen gelöscht
    if (l.verwerfen) await senden(l, [{ tabelle, spalte, schluessel, alt: pfad, neu: ziel, verwerfen: true }])
  }
  let klar: Uint8Array<ArrayBuffer>
  try { klar = new Uint8Array(await bytesEntschluesseln(bytes, dateiAad(l.instanzId, bucket, pfad), l.alt)) } catch { return verwerfen(t('Datei mit diesem Schlüssel nicht lesbar')) }
  if (tabelle === 'protokoll' && typeof z.sha256 === 'string' && z.sha256 && await sha256Hex(klar) !== z.sha256) {
    return verwerfen(t('Inhalt passt nicht zur Prüfsumme des Protokolls – nicht entschlüsselt'))
  }
  await klartextAblegen(bucket, ziel, klar)
  const loeschen = await altLoeschen({ bucket, pfad, tabelle, spalte, schluessel })
  await senden(l, [{ tabelle, spalte, schluessel, alt: pfad, neu: ziel }])
  await loeschen()
}

/** Alte Datei, die gelöscht wird, sobald der Datensatz auf den neuen Pfad zeigt */
type Loeschen = { bucket: string; pfad: string; tabelle: string; spalte: string; schluessel: Record<string, string> }[]
let loeschKette: Promise<unknown> = Promise.resolve()

/** Löschliste im Gerätespeicher ändern (nacheinander – mehrere Dateien laufen gleichzeitig) */
function loeschListe(aendern: (l: Loeschen) => Loeschen): Promise<unknown> {
  loeschKette = loeschKette.then(async () => metaSchreiben(LOESCHEN, aendern((await metaLesen<Loeschen>(LOESCHEN)) ?? [])))
  return loeschKette
}

/**
 * Alte Datei zum Löschen vormerken (im Gerätespeicher, falls der Lauf zwischen Pfad und Löschen abbricht); zurück kommt
 * das Löschen selbst, aufzurufen nach dem Umsetzen des Pfads.
 */
async function altLoeschen(eintrag: Loeschen[number]) {
  const gleich = (d: Loeschen[number]) => d.bucket === eintrag.bucket && d.pfad === eintrag.pfad
  await loeschListe((l) => l.some(gleich) ? l : [...l, eintrag])
  return async () => {
    const { error } = await supabase.storage.from(eintrag.bucket).remove([eintrag.pfad])
    if (error && !istNichtGefunden(error)) throw error
    await loeschListe((l) => l.filter((d) => !gleich(d)))
  }
}

/**
 * Ausstehende Löschungen eines früheren Laufs nachholen – nur, wenn der Datensatz inzwischen auf den neuen Pfad zeigt
 * (sonst wurde der Pfad nicht umgesetzt, und der Lauf nimmt die Datei erneut). Storage lehnt zusätzlich ab, solange
 * noch ein Datensatz verweist.
 */
async function ausstehendeLoeschen() {
  const liste = (await metaLesen<Loeschen>(LOESCHEN)) ?? []
  for (const d of liste) {
    let q = supabase.from(d.tabelle as 'foto').select(`pfad:${d.spalte}`)
    for (const [k, v] of Object.entries(d.schluessel)) q = q.eq(k as 'id', v)
    const { data, error } = await q
    if (error) throw new Error(`${d.tabelle}: ${fehlertext(error)}`)
    const verweis = ((data ?? []) as unknown as { pfad: string | null }[]).some((z) => z.pfad === d.pfad)
    if (!verweis) await supabase.storage.from(d.bucket).remove([d.pfad])
  }
  await db.meta.delete(LOESCHEN)
}

async function dateiUmschluesseln(l: Lauf, tabelle: string, spalte: string, bucket: VerschluesselterBucket, z: Zeile) {
  const pfad = z.pfad as string
  const schluessel = schluesselVon(tabelle, z)
  const fehler = (meldung: string) => l.ergebnis.fehler.push({ tabelle, spalte, schluessel, meldung })
  l.ergebnis.geprueft++
  let ziel: string
  if (l.art === 'umstellung') {
    if (istVerschluesselterPfad(pfad)) return
  } else if (!istVerschluesselterPfad(pfad)) return fehler(t('Datei ohne Verschlüsselung bei aktiver Verschlüsselung'))
  ziel = pfadFuer(pfad, l.neuId)
  if (pfad === ziel) return
  const bytes = await herunterladen(bucket, pfad)
  if (!bytes) {
    // Datei fehlt ohnehin: nur den Pfad umsetzen (der Server prüft, dass sie wirklich fehlt)
    await senden(l, [{ tabelle, spalte, schluessel, alt: pfad, neu: ziel, fehlt: true }])
    return fehler(t('Datei fehlt im Speicher (Pfad trotzdem umgesetzt)'))
  }
  let klar: Uint8Array<ArrayBuffer>
  if (l.art === 'umstellung') {
    // schon verschlüsselt unter altem Pfad (sollte es nicht geben): nicht doppelt verschlüsseln
    if (hatDateiKopf(bytes)) return fehler(t('Datei hat schon einen enc1-Kopf, aber einen Pfad ohne .enc'))
    klar = bytes
  } else {
    // Mit dem alten (oder schon dem neuen) Schlüssel lesen und unter dem neuen Pfad mit dem neuen ablegen – der Pfad gehört
    // zu den Zusatzdaten, und erst die Kennung im Pfad zeigt dem Server, dass die Datei umgeschlüsselt ist
    try { klar = new Uint8Array(await bytesEntschluesseln(bytes, dateiAad(l.instanzId, bucket, pfad), [l.alt, l.neu])) } catch { return fehler(t('Datei mit keinem der beiden Schlüssel lesbar')) }
  }
  // Protokolle sind unveränderlich: der Inhalt muss zur Prüfsumme passen, sonst würde ein Austausch hier „legalisiert“
  if (tabelle === 'protokoll' && typeof z.sha256 === 'string' && z.sha256 && await sha256Hex(klar) !== z.sha256) {
    return fehler(t('Inhalt passt nicht zur Prüfsumme des Protokolls – nicht umgeschlüsselt'))
  }
  const geheim = await bytesVerschluesseln(klar, dateiAad(l.instanzId, bucket, ziel), l.neu)
  await ablegen(l, bucket, ziel, geheim, klar)
  const loeschen = await altLoeschen({ bucket, pfad, tabelle, spalte, schluessel })
  await senden(l, [{ tabelle, spalte, schluessel, alt: pfad, neu: ziel }])
  await loeschen()
}

async function dateienUmschluesseln(l: Lauf) {
  const parallel = Math.max(1, l.optionen.parallel ?? 3)
  for (const { tabelle, spalte, bucket } of PFAD_FELDER) {
    const auswahl = [...SCHLUESSEL_SPALTEN[tabelle], `pfad:${spalte}`, ...(tabelle === 'protokoll' ? ['sha256'] : [])].join(', ')
    for await (const seite of zeilen(tabelle, auswahl, spalte, l.optionen.seite ?? 500)) {
      const offen = [...seite]
      const arbeiter = async () => {
        for (let z = offen.shift(); z; z = offen.shift()) {
          l.optionen.signal?.throwIfAborted()
          try {
            await (l.art === 'abschaltung' ? dateiEntschluesseln : dateiUmschluesseln)(l, tabelle, spalte, bucket, z)
          } catch (e) {
            if (l.optionen.signal?.aborted) throw e
            l.ergebnis.fehler.push({ tabelle, spalte, schluessel: schluesselVon(tabelle, z), meldung: fehlertext(e) })
          }
          fortschritt(l, 'dateien', `${tabelle}.${spalte}`)
        }
      }
      await Promise.all(Array.from({ length: parallel }, arbeiter))
    }
  }
}

/**
 * Dateien ohne Datensatz, die noch nicht mit dem Zielschlüssel verschlüsselt sind (Klartext, alter Schlüssel), löschen –
 * soweit die Datenbank sie als löschbar meldet (älter als die Mindestfrist, oder es gibt die Datei schon umgeschlüsselt).
 */
async function verwaisteLoeschen(l: Lauf) {
  for (;;) {
    l.optionen.signal?.throwIfAborted()
    const { data, error } = await supabase.rpc('verschluesselung_verwaiste', { p_ziel: (l.art === 'abschaltung' ? null : l.neuId) as string })
    if (error) throw new Error(t('Verwaiste Dateien: {fehler}', { fehler: fehlertext(error) }))
    const liste = (data ?? []) as { bucket: string; name: string; loeschbar: boolean }[]
    const weg = liste.filter((d) => d.loeschbar)
    l.ergebnis.verwaist.wartend = liste.length - weg.length
    if (!weg.length) return
    let geloescht = 0
    for (const bucket of new Set(weg.map((d) => d.bucket))) {
      const pfade = weg.filter((d) => d.bucket === bucket).map((d) => d.name)
      const { data: r, error: e } = await supabase.storage.from(bucket).remove(pfade)
      if (e) throw new Error(t('Verwaiste Dateien löschen: {fehler}', { fehler: fehlertext(e) }))
      geloescht += (r ?? []).length
    }
    l.ergebnis.verwaist.geloescht += geloescht
    fortschritt(l, 'aufraeumen', t('verwaiste Dateien'))
    // Storage meldet abgelehnte Löschungen nicht als Fehler: nichts mehr gelöscht → nicht endlos wiederholen
    if (geloescht === 0) {
      l.ergebnis.fehler.push(...weg.map((d) => ({ tabelle: 'storage', spalte: d.bucket, schluessel: { name: d.name }, meldung: t('Verwaiste Datei ließ sich nicht löschen') })))
      return
    }
  }
}

// ---------------------------------------------------------------------------
// Ablauf
// ---------------------------------------------------------------------------
async function laufVorbereiten(optionen: UmschluesselnOptionen, rueckweg = false, verwerfen = false): Promise<Lauf> {
  const z = await pruefen(true)
  const schluessel = schluesselFuerTausch()
  if (z.art !== 'bereit' || !schluessel) throw new Error(t('Umschlüsseln braucht den Schlüssel auf diesem Gerät'))
  if (z.abschaltung) {
    const { data, error } = await supabase.rpc('verschluesselung_stand')
    if (error) throw new Error(fehlertext(error))
    const stand = data as { klartext: number; verschluesselt: number }
    return {
      art: 'abschaltung', instanzId: schluessel.alt.instanzId, alt: schluessel.alt.schluessel, neu: schluessel.alt.schluessel, neuId: '', verwerfen,
      ergebnis: { art: 'abschaltung', geaendert: 0, geprueft: 0, fehler: [], verwaist: { geloescht: 0, wartend: 0 } },
      gesamt: stand.klartext + stand.verschluesselt, optionen,
    }
  }
  const art = rueckweg ? 'rueckweg' : z.tausch ? 'tausch' : !z.aktiv ? 'umstellung' : null
  if (!art || (art === 'rueckweg' && !z.tausch)) throw new Error(t('Es gibt nichts umzuschlüsseln: die Verschlüsselung ist aktiv und kein Tausch läuft'))
  if (art !== 'umstellung' && !schluessel.neu) throw new Error(t('Der neue Schlüssel fehlt auf diesem Gerät'))
  // Erst umschlüsseln, wenn das Blatt verwahrt ist: sonst hielte nur dieses Gerät den Schlüssel der Daten
  if (art !== 'rueckweg' && blattOffen()) throw new Error(t('Bitte zuerst das Schlüsselblatt ausdrucken und die Aufbewahrung bestätigen.'))
  const [von, nach] = art === 'tausch' ? [schluessel.alt, schluessel.neu!] : art === 'rueckweg' ? [schluessel.neu!, schluessel.alt] : [schluessel.alt, schluessel.alt]
  const { data: stand, error } = await supabase.rpc('verschluesselung_stand')
  if (error) throw new Error(fehlertext(error))
  const s = stand as { klartext: number; verschluesselt: number }
  return {
    art, instanzId: schluessel.alt.instanzId, alt: von.schluessel, neu: nach.schluessel, neuId: nach.schluesselId, verwerfen: false,
    ergebnis: { art, geaendert: 0, geprueft: 0, fehler: [], verwaist: { geloescht: 0, wartend: 0 } },
    gesamt: art === 'umstellung' ? s.klartext + s.verschluesselt : s.verschluesselt, optionen,
  }
}

async function durchlaufen(l: Lauf): Promise<UmschluesselnErgebnis> {
  void loggen('Verschlüsselung', { umstellung: 'Umstellung: Bestand wird verschlüsselt', tausch: 'Schlüsseltausch: Bestand wird umgeschlüsselt',
    rueckweg: 'Schlüsseltausch abbrechen: Bestand wird zurückgeschlüsselt', abschaltung: 'Abschaltung: Bestand wird entschlüsselt' }[l.art])
  await ausstehendeLoeschen()
  await werteUmschluesseln(l)
  await dateienUmschluesseln(l)
  await verwaisteLoeschen(l)
  merkspeicherLeeren()
  void loggen('Verschlüsselung', `Durchlauf beendet: ${l.ergebnis.geaendert} geändert, ${l.ergebnis.geprueft} geprüft, ${l.ergebnis.fehler.length} Fehler`
    + `, ${l.ergebnis.verwaist.geloescht} verwaiste Dateien gelöscht${l.ergebnis.verwaist.wartend ? `, ${l.ergebnis.verwaist.wartend} noch zu jung` : ''}`)
  return l.ergebnis
}

/**
 * Einen Durchlauf über den ganzen Bestand (Werte, dann Dateien, dann verwaiste Dateien). Fortsetzbar: abbrechen (signal)
 * und später erneut aufrufen. Fehler einzelner Werte/Dateien stehen im Ergebnis, der Lauf geht weiter. Erst nach
 * bestätigtem Schlüsselblatt (blattBestaetigen).
 */
export async function bestandUmschluesseln(optionen: UmschluesselnOptionen = {}): Promise<UmschluesselnErgebnis> {
  return durchlaufen(await laufVorbereiten(optionen))
}

/** Umstellung abschließen: der Server prüft, dass kein Klartext mehr da ist, und schaltet die Sperren scharf. */
export async function umstellungAbschliessen(): Promise<void> {
  if (blattOffen()) throw new Error(t('Bitte zuerst das Schlüsselblatt ausdrucken und die Aufbewahrung bestätigen.'))
  const { error } = await supabase.rpc('verschluesselung_aktivieren')
  if (error) throw new Error(fehlertext(error))
  void loggen('Verschlüsselung', 'Umstellung abgeschlossen, Verschlüsselung aktiv')
  await pruefen()
}

/**
 * Schlüsseltausch abschließen: so lange umschlüsseln, bis ein Durchlauf nichts mehr ändert (auch, was andere Geräte
 * währenddessen mit dem alten Schlüssel übertragen haben). Mit Fehlern nur, wenn `trotzFehlern` (die betroffenen Daten
 * sind dann verloren). Danach wechselt die Schlüssel-ID, alle anderen Geräte müssen das neue Blatt scannen.
 */
export async function tauschAbschliessen(optionen: UmschluesselnOptionen & { trotzFehlern?: boolean } = {}): Promise<UmschluesselnErgebnis> {
  let ergebnis: UmschluesselnErgebnis | null = null
  for (let i = 0; i < 5; i++) {
    ergebnis = await bestandUmschluesseln(optionen)
    if (ergebnis.geaendert === 0) break
  }
  if (!ergebnis || ergebnis.geaendert > 0) throw new Error(t('Es kommen laufend neue Daten mit dem alten Schlüssel an. Bitte später erneut versuchen.'))
  if (ergebnis.fehler.length && !optionen.trotzFehlern) {
    throw new Error(t('{n} Werte bzw. Dateien lassen sich nicht umschlüsseln – Tausch nicht abgeschlossen.', { n: ergebnis.fehler.length }))
  }
  if (ergebnis.verwaist.wartend) throw new Error(verwaistMeldung(ergebnis.verwaist.wartend, 'Der Tausch lässt sich'))
  const schluessel = schluesselFuerTausch()
  if (!schluessel?.neu) throw new Error(t('Der neue Schlüssel fehlt auf diesem Gerät'))
  const { error } = await supabase.rpc('verschluesselung_tausch_abschliessen')
  if (error) throw new Error(fehlertext(error))
  // Neuer Schlüssel wird der aktuelle; der Gerätespeicher wird dabei umgeschlüsselt (fortsetzbar, geraet.ts)
  await tauschUebernehmen()
  void loggen('Verschlüsselung', `Schlüsseltausch abgeschlossen (Schlüssel-ID ${schluessel.neu.schluesselId})`)
  return ergebnis
}

export function verwaistMeldung(anzahl: number, was: string): string {
  // was: Satzanfang wie „Der Tausch lässt sich“ (auch aus VerschluesselungBereich.tsx), im Wörterbuch einzeln übersetzt
  return t('{n} Datei(en) ohne Datensatz sind jünger als 24 Stunden – ihr Datensatz kann noch in der Outbox eines Geräts warten. {was} erst abschließen, wenn sie angekommen oder älter sind. Bitte später fortsetzen.',
    { n: anzahl, was: t(was) })
}

/**
 * Schlüsseltausch abbrechen. Noch nicht begonnen (nur auf diesem Gerät vorbereitet): den neuen Schlüssel verwerfen.
 * Läuft er schon: alles mit dem neuen Schlüssel Verschlüsselte zurückschlüsseln (so lange, bis nichts mehr übrig ist), dann
 * gibt der Server die anderen Geräte wieder frei (verschluesselung_tausch_abbrechen). Das neue Blatt ist danach ungültig.
 */
export async function tauschAbbrechen(optionen: UmschluesselnOptionen & { trotzFehlern?: boolean } = {}): Promise<UmschluesselnErgebnis | null> {
  const z = await pruefen(true)
  if (z.art !== 'bereit') throw new Error(t('Abbrechen braucht den Schlüssel auf diesem Gerät'))
  if (!z.tausch) {
    await tauschVerwerfen()
    return null
  }
  let ergebnis: UmschluesselnErgebnis | null = null
  for (let i = 0; i < 5; i++) {
    ergebnis = await durchlaufen(await laufVorbereiten(optionen, true))
    if (ergebnis.geaendert === 0) break
  }
  if (!ergebnis || ergebnis.geaendert > 0) throw new Error(t('Das Zurückschlüsseln ist noch nicht fertig. Bitte erneut versuchen.'))
  if (ergebnis.fehler.length && !optionen.trotzFehlern) {
    throw new Error(t('{n} Werte bzw. Dateien lassen sich nicht zurückschlüsseln – Tausch nicht abgebrochen.', { n: ergebnis.fehler.length }))
  }
  const { error } = await supabase.rpc('verschluesselung_tausch_abbrechen')
  if (error) throw new Error(fehlertext(error))
  void loggen('Verschlüsselung', 'Schlüsseltausch abgebrochen, der bisherige Schlüssel gilt weiter')
  await tauschVerwerfen()
  return ergebnis
}


// ---------------------------------------------------------------------------
// Abschalten (docs/KONZEPT-VERSCHLUESSELUNG.md, „Abschalten der Verschlüsselung“)
// ---------------------------------------------------------------------------
/**
 * Abschaltung beginnen (nur Admin, Schlüssel auf dem Gerät, Blatt bestätigt, kein Tausch, vor dem Stichtag). Ab dann ist die
 * Verschlüsselung nicht mehr aktiv: alle Geräte zeigen Klartext und schreiben nach ihrer nächsten Prüfung Klartext.
 */
export async function abschaltungBeginnen(): Promise<void> {
  const z = await pruefen(true)
  if (z.art !== 'bereit') throw new Error(t('Abschalten braucht den Schlüssel auf diesem Gerät'))
  if (z.tausch) throw new Error(t('Während eines Schlüsseltauschs lässt sich die Verschlüsselung nicht abschalten'))
  if (STICHTAG && Date.now() >= Date.parse(STICHTAG)) throw new Error(t('Die Verschlüsselung ist Pflicht und lässt sich nicht mehr abschalten'))
  if (blattOffen()) throw new Error(t('Bitte zuerst das Schlüsselblatt ausdrucken und die Aufbewahrung bestätigen.'))
  const { error } = await supabase.rpc('verschluesselung_abschaltung_beginnen', { p_nachweis: await abschaltnachweis() })
  if (error) throw new Error(fehlertext(error))
  void loggen('Verschlüsselung', 'Abschaltung begonnen')
  await pruefen()
}

/**
 * Abschaltung abschließen: so lange entschlüsseln, bis ein Durchlauf nichts mehr ändert (auch, was andere Geräte
 * zwischendurch noch verschlüsselt übertragen haben). Mit `trotzFehlern` werden nicht lesbare Werte durch „(nicht lesbar)“
 * ersetzt und nicht lesbare Dateien verworfen – diese Daten sind dann verloren. Danach schaltet der Server ab, und dieses
 * Gerät entschlüsselt seinen Gerätespeicher und löscht den Schlüssel (pruefen).
 */
export async function abschalten(optionen: UmschluesselnOptionen & { trotzFehlern?: boolean } = {}): Promise<UmschluesselnErgebnis> {
  let ergebnis: UmschluesselnErgebnis | null = null
  // Verworfenes taucht im nächsten Durchlauf nicht mehr auf: Fehler aller Durchläufe sammeln
  const fehler = new Map<string, UmschluesselnFehler>()
  for (let i = 0; i < 5; i++) {
    const l = await laufVorbereiten(optionen, false, !!optionen.trotzFehlern)
    if (l.art !== 'abschaltung') throw new Error(t('Es läuft keine Abschaltung'))
    ergebnis = await durchlaufen(l)
    for (const f of ergebnis.fehler) fehler.set(JSON.stringify([f.tabelle, f.spalte, f.schluessel]), f)
    if (ergebnis.geaendert === 0) break
  }
  if (!ergebnis || ergebnis.geaendert > 0) throw new Error(t('Es kommen laufend neue verschlüsselte Daten an. Bitte später erneut versuchen.'))
  if (optionen.trotzFehlern) ergebnis.fehler = [...fehler.values()]
  if (ergebnis.fehler.length && !optionen.trotzFehlern) {
    throw new Error(t('{n} Werte bzw. Dateien lassen sich nicht entschlüsseln – Verschlüsselung nicht abgeschaltet.', { n: ergebnis.fehler.length }))
  }
  if (ergebnis.verwaist.wartend) throw new Error(verwaistMeldung(ergebnis.verwaist.wartend, 'Die Abschaltung lässt sich'))
  const { error } = await supabase.rpc('verschluesselung_abschalten')
  if (error) throw new Error(fehlertext(error))
  void loggen('Verschlüsselung', `Verschlüsselung abgeschaltet${ergebnis.fehler.length ? ` (${ergebnis.fehler.length} nicht lesbare Werte bzw. Dateien verworfen)` : ''}`)
  await eigeneAbschaltungUebernehmen()
  return ergebnis
}

/** Abschaltung abbrechen: danach läuft wieder eine Umstellung (bestandUmschluesseln, umstellungAbschliessen). */
export async function abschaltungAbbrechen(): Promise<void> {
  const { error } = await supabase.rpc('verschluesselung_abschaltung_abbrechen')
  if (error) throw new Error(fehlertext(error))
  void loggen('Verschlüsselung', 'Abschaltung abgebrochen, Bestand wird wieder verschlüsselt')
  await pruefen()
}
