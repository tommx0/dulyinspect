// Datensicherung: Backup aller Daten (+ optional Dateien) als ZIP; Restore ergänzt fehlende Datensätze.
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { supabase } from '../lib/supabase'
import { STANDARD_PRUEFART } from '../lib/anlagenarten'
import { PFAD_FELDER, WERT_FELDER, feldLesen } from '../lib/verschluesselung/felder'
import { geheimtextSchluesselId } from '../lib/verschluesselung/krypto'
import { pruefen, schluesselEntfernen, type ServerKennung } from '../lib/verschluesselung/schluessel'
import { felderUmbenennen, nameUmbenennen } from '../lib/umbenennung'
import { eigenerMandantencode, mandantencodeSetzen } from '../lib/mandantencode'
import { t } from '../lib/sprache'
import { schemaStandLaden } from '../lib/schemaStand'

/** Stand des Datenbankschemas, zu dem dieses Backup-Format passt (letzte Migration). */
export const SCHEMA_STAND = __SCHEMA_STAND__
export const FORMAT = 'tuerpruefung-backup'

/** Reihenfolge = Abhängigkeiten (Eltern vor Kindern). audit_log wird gesichert, aber nicht zurückgespielt. */
export const TABELLEN = ['benutzer', 'firma', 'verschluesselung', 'erscheinungsbild', 'anlagenart', 'benutzer_sachkunde', 'endkunde', 'objekt', 'checkliste', 'checkliste_version',
  'anlagentyp', 'pruefart', 'etikett', 'anlage', 'anlage_faelligkeit', 'anlage_gruppe', 'anlage_element',
  'session', 'session_revision', 'session_teilnehmer', 'anlagenpruefung', 'anlagenpruefung_mitpruefer', 'anlagenpruefung_revision', 'anlagenpruefung_aenderung', 'antwort', 'mangel',
  'element_ergebnis', 'foto', 'protokoll', 'protokoll_zaehler',
  'audit_log'] as const
export type Tabelle = (typeof TABELLEN)[number]
// verschluesselung: nur Kennung und Prüfwert (nie der Schlüssel). Sie wird gesichert, beim Zurückspielen aber gesondert behandelt (restoreVoraussetzung).
const NICHT_WIEDERHERSTELLEN: Tabelle[] = ['audit_log', 'verschluesselung']

const SORTIERUNG: Partial<Record<Tabelle, string[]>> = {
  session_teilnehmer: ['session_id', 'benutzer_id'],
  session_revision: ['session_id', 'revision'],
  anlagenpruefung_mitpruefer: ['anlagenpruefung_id', 'benutzer_id'],
  anlagenpruefung_revision: ['anlagenpruefung_id', 'revision'],
  protokoll_zaehler: ['jahr'],
  anlagenart: ['schluessel'],
  benutzer_sachkunde: ['benutzer_id', 'anlagenart'],
  anlage_faelligkeit: ['anlage_id', 'pruefart_id'],
}

type Zeile = Record<string, unknown>

export interface Backup {
  format: typeof FORMAT
  version: 1
  schema: string
  /** Stand der Datenbank, aus der das Backup stammt (fehlt in älteren Backups) */
  datenbank?: string
  erstellt_am: string
  erstellt_von: string
  anzahl: Record<string, number>
  dateien: number
  tabellen: Record<string, Zeile[]>
}

async function alleZeilen(t: Tabelle): Promise<Zeile[]> {
  const ergebnis: Zeile[] = []
  const seite = 1000
  for (let von = 0; ; von += seite) {
    let q = supabase.from(t as 'anlage').select('*')
    for (const s of SORTIERUNG[t] ?? ['id']) q = q.order(s as 'id')
    const { data, error } = await q.range(von, von + seite - 1)
    if (error) throw new Error(`${t}: ${error.message}`)
    ergebnis.push(...((data ?? []) as Zeile[]))
    if (!data || data.length < seite) return ergebnis
  }
}

const BUCKETS = ['fotos', 'unterschriften', 'protokolle', 'branding', 'nachweise'] as const
type Bucket = (typeof BUCKETS)[number]

function dateipfade(t: Record<string, Zeile[]>): { bucket: Bucket; pfad: string }[] {
  const liste = [
    ...(t.foto ?? []).map((f) => ({ bucket: 'fotos' as const, pfad: f.storage_pfad as string })),
    ...(t.erscheinungsbild ?? []).flatMap((e) => [e.logo_pfad, e.logo_pdf_pfad]).filter(Boolean).map((p) => ({ bucket: 'branding' as const, pfad: p as string })),
    ...(t.protokoll ?? []).map((p) => ({ bucket: 'protokolle' as const, pfad: p.storage_pfad as string })),
    ...(t.session ?? []).flatMap((s) => [s.unterschrift_leiter, s.unterschrift_kunde]).filter(Boolean).map((p) => ({ bucket: 'unterschriften' as const, pfad: p as string })),
    ...(t.session_teilnehmer ?? []).map((x) => x.unterschrift).filter(Boolean).map((p) => ({ bucket: 'unterschriften' as const, pfad: p as string })),
    ...(t.anlagenpruefung ?? []).flatMap((x) => [x.unterschrift, x.kunde_unterschrift]).filter(Boolean).map((p) => ({ bucket: 'unterschriften' as const, pfad: p as string })),
    ...(t.anlagenpruefung_mitpruefer ?? []).map((x) => x.unterschrift).filter(Boolean).map((p) => ({ bucket: 'unterschriften' as const, pfad: p as string })),
    ...(t.benutzer_sachkunde ?? []).map((x) => x.datei_pfad).filter(Boolean).map((p) => ({ bucket: 'nachweise' as const, pfad: p as string })),
  ]
  const gesehen = new Set<string>()
  return liste.filter((d) => d.pfad && !gesehen.has(`${d.bucket}/${d.pfad}`) && gesehen.add(`${d.bucket}/${d.pfad}`))
}

/** Erstellt das Backup als ZIP (daten.json + dateien/<bucket>/<pfad>). */
export async function backupErstellen(mitDateien: boolean, fortschritt: (t: string) => void): Promise<{ zip: Uint8Array; backup: Backup; fehlendeDateien: string[] }> {
  const tabellen: Record<string, Zeile[]> = {}
  for (const tabelle of TABELLEN) {
    fortschritt(t('Tabelle {tabelle} …', { tabelle }))
    tabellen[tabelle] = await alleZeilen(tabelle)
  }
  const { data: sitzung } = await supabase.auth.getSession()
  const dateien: Zippable = {}
  const fehlendeDateien: string[] = []
  if (mitDateien) {
    const pfade = dateipfade(tabellen)
    let i = 0
    for (const d of pfade) {
      fortschritt(t('Dateien {n}/{gesamt} …', { n: ++i, gesamt: pfade.length }))
      const { data, error } = await supabase.storage.from(d.bucket).download(d.pfad)
      if (error || !data) { fehlendeDateien.push(`${d.bucket}/${d.pfad}`); continue }
      // Bilder/PDFs sind schon komprimiert → nur speichern
      dateien[`dateien/${d.bucket}/${d.pfad}`] = [new Uint8Array(await data.arrayBuffer()), { level: 0 }]
    }
  }
  const backup: Backup = {
    format: FORMAT, version: 1, schema: SCHEMA_STAND, datenbank: (await schemaStandLaden()) ?? undefined, erstellt_am: new Date().toISOString(),
    erstellt_von: sitzung.session?.user.email ?? '', dateien: Object.keys(dateien).length,
    anzahl: Object.fromEntries(Object.entries(tabellen).map(([k, v]) => [k, v.length])), tabellen,
  }
  fortschritt(t('ZIP erstellen …'))
  const zip = zipSync({ 'daten.json': [strToU8(JSON.stringify(backup)), { level: 6 }], ...dateien })
  fortschritt('')
  return { zip, backup, fehlendeDateien }
}

/** Dateiname mit Zeitpunkt und Datenbankstand, z. B. Backup_Tuerpruefung_2026-11-03-14-05_DB-20261130090000.zip */
export function backupDateiname(praefix: string, backup: Pick<Backup, 'erstellt_am' | 'schema' | 'datenbank'>): string {
  return `${praefix}_${backup.erstellt_am.slice(0, 16).replace(/[:T]/g, '-')}_DB-${backup.datenbank ?? backup.schema}.zip`
}

export interface GeleseneSicherung {
  backup: Backup
  dateien: { bucket: string; pfad: string; inhalt: Uint8Array }[]
}

/** ZIP einlesen und prüfen. */
export function backupLesen(zip: Uint8Array): GeleseneSicherung {
  let inhalt: Record<string, Uint8Array>
  try {
    inhalt = unzipSync(zip)
  } catch {
    throw new Error(t('Die Datei ist kein gültiges ZIP-Archiv.'))
  }
  if (!inhalt['daten.json']) throw new Error(t('Die ZIP-Datei enthält keine daten.json – kein Backup dieser App.'))
  const backup = JSON.parse(strFromU8(inhalt['daten.json'])) as Backup
  if (backup.format !== FORMAT) throw new Error(t('Unbekanntes Backup-Format.'))
  // Backup aus Version 1 (Türen): Tabellen- und Spaltennamen übersetzen
  if (backup.tabellen.tuer || backup.tabellen.tuertyp || backup.tabellen.tuerpruefung) {
    backup.tabellen = Object.fromEntries(Object.entries(backup.tabellen).map(([t, zeilen]) => [nameUmbenennen(t), zeilen.map(felderUmbenennen)]))
    backup.anzahl = Object.fromEntries(Object.entries(backup.anzahl).map(([t, n]) => [nameUmbenennen(t), n]))
  }
  // Backup aus Version 2.0 (vor den Prüfarten): Checkliste/Intervall des Typs → Prüfart, Antrieb → eigenschaften, letzte Prüfung → Fälligkeit
  if (!backup.tabellen.pruefart) backup.tabellen = aufPruefartenUmstellen(backup.tabellen)
  // Nur Buckets, die eine Sicherung dieser App enthält, und Pfade ohne „..“ oder leere Teile: ein untergeschobenes ZIP
  // soll keine Datei in einen anderen Bucket (z. B. den öffentlichen branding) oder an einen unerwarteten Ort legen
  const dateien = Object.entries(inhalt)
    .filter(([name]) => name.startsWith('dateien/') && !name.endsWith('/'))
    .map(([name, daten]) => {
      const [, bucket, ...rest] = name.split('/')
      return { bucket, pfad: rest.join('/'), inhalt: daten }
    })
    .filter((d) => (BUCKETS as readonly string[]).includes(d.bucket) && d.pfad.split('/').every((t) => t !== '' && t !== '.' && t !== '..'))
  return { backup, dateien }
}

/** Datensicherung ohne Prüfarten in das Format ab Version 2.1 übersetzen (wie die Migration 20261022090000). */
export function aufPruefartenUmstellen(t: Record<string, Zeile[]>): Record<string, Zeile[]> {
  const typen = t.anlagentyp ?? []
  const anlagen = t.anlage ?? []
  const typVon = new Map(anlagen.map((a) => [a.id as string, a.anlagentyp_id as string]))
  return {
    ...t,
    anlagentyp: typen.map(({ checkliste_id: _c, intervall_monate: _i, ...rest }) => ({ ...rest, anlagenart: 'tuer' })),
    // Gleiche ID wie der Typ (so legt auch die Migration die erste Prüfart an)
    pruefart: typen.map((x) => ({
      id: x.id, anlagentyp_id: x.id, name: STANDARD_PRUEFART, checkliste_id: x.checkliste_id ?? null,
      intervall_monate: x.intervall_monate ?? 12, reihenfolge: 1, aktiv: true, erstellt_am: x.erstellt_am, erstellt_von: x.erstellt_von ?? null,
    })),
    anlage: anlagen.map(({ antrieb_system, intervall_monate: _i, ...rest }) => ({ ...rest, eigenschaften: antrieb_system ? { antrieb_system } : {} })),
    anlage_faelligkeit: anlagen.filter((a) => a.letzte_pruefung_am || a.intervall_monate).map((a) => ({
      anlage_id: a.id, pruefart_id: a.anlagentyp_id, intervall_monate: a.intervall_monate ?? null,
      letzte_pruefung_am: a.letzte_pruefung_am ?? null, letztes_ergebnis: a.letztes_ergebnis ?? null,
    })),
    anlagenpruefung: (t.anlagenpruefung ?? []).map((p) => ({ ...p, pruefart_id: p.pruefart_id ?? typVon.get(p.anlage_id as string) ?? null })),
  }
}

export interface RestoreBericht {
  tabellen: Record<string, { eingefuegt: number; vorhanden: number; fehlgeschlagen: number }>
  dateienHochgeladen: number
  dateienVorhanden: number
  fehler: string[]
  /** Hinweise zur Verschlüsselung (z. B. Schlüsselblatt scannen) */
  hinweise: string[]
}

export interface BackupVerschluesselung {
  aktiv: boolean
  instanz_id: string
  schluessel_id: string
  pruefwert: string
  tausch_seit?: string | null
  abschaltung_seit?: string | null
  abgeschaltet_am?: string | null
}

export type RestorePlan =
  | { ok: false; grund: string }
  | {
    ok: true
    /** Ziel ohne Verschlüsselung, Backup mit: Kennung des Backups vorher in der Zieldatenbank einrichten */
    einrichten: BackupVerschluesselung | null
    /** Ziel leer, aber schon mit eigener Kennung (frisch eingerichtet): Kennung durch die des Backups ersetzen */
    ersetzen: BackupVerschluesselung | null
    /** danach die Verschlüsselung aktivieren (Backup war aktiv, Bestand ist umgeschlüsselt) */
    aktivieren: boolean
    hinweise: string[]
  }

/**
 * Werte und Pfade der Feldliste im Backup: Klartext und solche mit einer anderen Schlüssel-ID als `schluesselId`
 * (Pfad: Kennung im Dateinamen). Ohne `schluesselId` zählt jeder Geheimtext als fremd.
 */
export function backupInhalt(tabellen: Record<string, Zeile[] | undefined>, schluesselId: string | null): { klartext: number; fremd: number } {
  let klartext = 0
  let fremd = 0
  for (const [t, felder] of Object.entries(WERT_FELDER)) {
    for (const z of tabellen[t] ?? []) for (const f of felder) {
      const w = feldLesen(z, f)
      if (typeof w !== 'string' || w === '') continue
      const id = geheimtextSchluesselId(w)
      if (!id) klartext++
      else if (id !== schluesselId) fremd++
    }
  }
  for (const { tabelle, spalte } of PFAD_FELDER) {
    for (const z of tabellen[tabelle] ?? []) {
      const p = z[spalte]
      if (typeof p !== 'string' || p === '') continue
      const k = /\.k([0-9a-f]{8})\.enc$/.exec(p)?.[1]
      if (!k) klartext++
      else if (k !== schluesselId?.slice(0, 8)) fremd++
    }
  }
  return { klartext, fremd }
}

const KLARTEXT_IN_AKTIV = (n: number) => t('Das Backup enthält {n} unverschlüsselte Werte bzw. Dateien (aus der Zeit vor oder während der Umstellung) und lässt sich nicht in diese Instanz mit aktiver Verschlüsselung zurückspielen – der Server würde jeden davon ablehnen. Möglich ist, es in eine neu aufgesetzte Instanz („aus einem Backup wiederhergestellt“) zurückzuspielen und dort die Umstellung abzuschließen.', { n })

/**
 * Darf das Backup in diese Instanz zurückgespielt werden? (docs/KONZEPT-VERSCHLUESSELUNG.md, „Datensicherung“)
 * - Backup mit Verschlüsselung: nur in dieselbe Instanz (gleiche instanz_id und Schlüssel-ID) oder in eine neu aufgesetzte ohne
 *   Verschlüsselung – dort wird die Kennung des Backups eingerichtet, das Schlüsselblatt der ursprünglichen Instanz öffnet die Daten.
 * - Backup ohne Verschlüsselung (Klartext, aus der Zeit davor oder nach einer Abschaltung): nicht in eine Instanz mit aktiver
 *   Verschlüsselung – ihr Trigger würde Klartext ablehnen, und es wäre Klartext, den man gerade schützen will.
 * - Während einer Abschaltung (Ziel oder Backup) nicht: der Bestand ist dann teils verschlüsselt, teils nicht.
 */
export function restoreVoraussetzung(backup: Pick<Backup, 'tabellen'>, ziel: ServerKennung, optionen: { leer?: boolean } = {}): RestorePlan {
  const zeile = (backup.tabellen.verschluesselung?.[0] ?? null) as Partial<BackupVerschluesselung> | null
  // Nach einer Abschaltung ist das Backup Klartext; die verbliebene Kennung gilt nicht mehr
  const v = zeile?.abgeschaltet_am ? null : zeile
  if (ziel.tausch_seit) return { ok: false, grund: t('Während eines Schlüsseltauschs lässt sich kein Backup zurückspielen. Bitte erst den Tausch abschließen.') }
  if (ziel.abschaltung_seit) return { ok: false, grund: t('Während die Verschlüsselung abgeschaltet wird, lässt sich kein Backup zurückspielen. Bitte erst die Abschaltung abschließen oder abbrechen.') }
  if (v?.abschaltung_seit) {
    return { ok: false, grund: t('Das Backup entstand, während die Verschlüsselung abgeschaltet wurde. Seine Daten sind teils verschlüsselt, teils nicht, und lassen sich so nicht zurückspielen. Bitte ein Backup von vor oder nach der Abschaltung nehmen.') }
  }
  if (v?.tausch_seit) {
    return { ok: false, grund: t('Das Backup entstand während eines Schlüsseltauschs. Seine Daten sind teils mit dem alten, teils mit dem neuen Schlüssel verschlüsselt und lassen sich so nicht zurückspielen. Bitte ein Backup von vor oder nach dem Tausch nehmen.') }
  }
  const SCANNEN = t('Die Daten sind verschlüsselt. Bitte auf jedem Gerät das Schlüsselblatt der ursprünglichen Instanz scannen – ohne dieses Blatt sind sie nicht lesbar.')
  if (v?.instanz_id && v.schluessel_id && v.pruefwert) {
    const kennung = { aktiv: !!v.aktiv, instanz_id: v.instanz_id, schluessel_id: v.schluessel_id, pruefwert: v.pruefwert }
    const inhalt = backupInhalt(backup.tabellen, kennung.schluessel_id)
    if (inhalt.fremd) {
      return { ok: false, grund: t('Das Backup enthält {n} Werte bzw. Dateien, die mit einem anderen Schlüssel verschlüsselt sind als dem der Instanz im Backup. So lässt es sich nicht zurückspielen.', { n: inhalt.fremd }) }
    }
    if (ziel.eingerichtet && (ziel.instanz_id !== kennung.instanz_id || ziel.schluessel_id !== kennung.schluessel_id)) {
      // Frisch eingerichtete, noch leere Instanz: ihre Kennung durch die des Backups ersetzen (verschluesselung_ersetzen)
      if (optionen.leer) return { ok: true, einrichten: null, ersetzen: kennung, aktivieren: kennung.aktiv, hinweise: [SCANNEN] }
      if (ziel.instanz_id !== kennung.instanz_id) {
        return { ok: false, grund: t('Das Backup gehört zu einer anderen Instanz als diese. Es lässt sich nur in dieselbe oder in eine neu aufgesetzte, noch leere Instanz zurückspielen – sonst entstünden Daten, die hier niemand lesen kann.') }
      }
      return { ok: false, grund: t('Das Backup stammt aus der Zeit vor einem Schlüsseltausch. Seine Daten sind mit dem alten Schlüssel verschlüsselt und wären mit dem aktuellen nicht lesbar.') }
    }
    if (ziel.eingerichtet) {
      if (ziel.aktiv && inhalt.klartext) return { ok: false, grund: KLARTEXT_IN_AKTIV(inhalt.klartext) }
      return { ok: true, einrichten: null, ersetzen: null, aktivieren: false, hinweise: [] }
    }
    return { ok: true, einrichten: kennung, ersetzen: null, aktivieren: kennung.aktiv, hinweise: [SCANNEN] }
  }
  const inhalt = backupInhalt(backup.tabellen, null)
  if (inhalt.fremd) {
    return { ok: false, grund: t('Das Backup enthält {n} verschlüsselte Werte bzw. Dateien, aber keine Kennung der Verschlüsselung. So lässt es sich nicht zurückspielen.', { n: inhalt.fremd }) }
  }
  if (ziel.aktiv) return { ok: false, grund: KLARTEXT_IN_AKTIV(inhalt.klartext) }
  return {
    ok: true, einrichten: null, ersetzen: null, aktivieren: false,
    hinweise: ziel.eingerichtet ? [t('Die Verschlüsselung dieser Instanz ist noch nicht abgeschlossen. Bitte danach unter Einstellungen → Verschlüsselung den Bestand umschlüsseln, damit auch die wiederhergestellten Daten verschlüsselt werden.')] : [],
  }
}

/** Abhängigkeiten innerhalb einer Tabelle beachten (Selbstbezüge). */
function ordnen(t: string, zeilen: Zeile[]): Zeile[] {
  if (t === 'anlagenpruefung') return [...zeilen].sort((a, b) => Number(a.status === 'duplikat') - Number(b.status === 'duplikat'))
  if (t === 'session') return [...zeilen].sort((a, b) => Number(!!a.zusammengefuehrt_in) - Number(!!b.zusammengefuehrt_in))
  if (t === 'checkliste_version') return [...zeilen].sort((a, b) => Number(a.version) - Number(b.version))
  return zeilen
}

// Kein svg: im öffentlichen Bucket branding könnte ein SVG Skript enthalten (die App lädt nur PNG, JPEG und WebP hoch)
const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' }

/** Fehlende Datensätze und Dateien aus dem Backup ergänzen. Nichts wird überschrieben oder gelöscht. */
export async function wiederherstellen(s: GeleseneSicherung, fortschritt: (t: string) => void): Promise<RestoreBericht> {
  const bericht: RestoreBericht = { tabellen: {}, dateienHochgeladen: 0, dateienVorhanden: 0, fehler: [], hinweise: [] }
  // Zuerst prüfen, ob das Backup zur Verschlüsselung dieser Instanz passt
  const { data: kennung, error: kennungFehler } = await supabase.rpc('verschluesselung_kennung')
  if (kennungFehler) throw new Error(t('Verschlüsselung: {fehler}', { fehler: kennungFehler.message }))
  const ziel = (kennung ?? { berechtigt: true, eingerichtet: false }) as unknown as ServerKennung
  // Eingerichtete Instanz mit anderer Kennung: leer? (dann lässt sich ihre Kennung durch die des Backups ersetzen)
  let leer = false
  if (ziel.eingerichtet) {
    const { data: stand } = await supabase.rpc('verschluesselung_stand')
    leer = (stand as { leer?: boolean } | null)?.leer === true
  }
  const plan = restoreVoraussetzung(s.backup, ziel, { leer })
  if (!plan.ok) throw new Error(plan.grund)
  if (plan.einrichten) {
    const { error } = await supabase.rpc('verschluesselung_einrichten', {
      p_instanz_id: plan.einrichten.instanz_id, p_schluessel_id: plan.einrichten.schluessel_id, p_pruefwert: plan.einrichten.pruefwert,
    })
    if (error) throw new Error(t('Verschlüsselung einrichten: {fehler}', { fehler: error.message }))
  }
  if (plan.ersetzen) {
    const { error } = await supabase.rpc('verschluesselung_ersetzen', {
      p_instanz_id: plan.ersetzen.instanz_id, p_schluessel_id: plan.ersetzen.schluessel_id, p_pruefwert: plan.ersetzen.pruefwert,
    })
    if (error) throw new Error(t('Verschlüsselung übernehmen: {fehler}', { fehler: error.message }))
    // Der Schlüssel dieses Geräts gehört zur ersetzten Kennung: weg damit, danach das Blatt der ursprünglichen Instanz scannen
    await schluesselEntfernen({ auchUnbestaetigt: true })
  }
  // Die App sperrt dieses Gerät, bis das Blatt gescannt ist; der Bericht erscheint dann auf dem Sperrbildschirm
  if (plan.einrichten || plan.ersetzen) void pruefen().catch(() => undefined)
  bericht.hinweise.push(...plan.hinweise)
  // Mandantencode der gesicherten Instanz übernehmen, solange diese hier noch keine Etiketten hat: gedruckte QR-Codes passen dann weiter
  const code = s.backup.tabellen.firma?.[0]?.mandantencode
  if (typeof code === 'string' && code) {
    const { data: uebernommen, error } = await supabase.rpc('mandantencode_uebernehmen', { p_code: code })
    if (error) bericht.fehler.push(t('Mandantencode: {fehler}', { fehler: error.message }))
    else if (uebernommen) mandantencodeSetzen(code)
    else if (code !== eigenerMandantencode()) {
      bericht.hinweise.push(t('Diese Instanz hat schon Etiketten und behält ihren Mandantencode {eigener}. Gedruckte QR-Codes der gesicherten Instanz (Mandantencode {code}) öffnet sie nicht – diese Etiketten bitte neu drucken.',
        { eigener: eigenerMandantencode() ?? '', code }))
    }
  }
  for (const tabelle of TABELLEN) {
    if (NICHT_WIEDERHERSTELLEN.includes(tabelle)) continue
    const zeilen = ordnen(tabelle, s.backup.tabellen[tabelle] ?? [])
    const summe = { eingefuegt: 0, vorhanden: 0, fehlgeschlagen: 0 }
    for (let i = 0; i < zeilen.length; i += 200) {
      fortschritt(`${tabelle}: ${Math.min(i + 200, zeilen.length)}/${zeilen.length} …`)
      const { data, error } = await supabase.rpc('admin_wiederherstellen', { p_tabelle: tabelle, p_zeilen: zeilen.slice(i, i + 200) as never })
      if (error) throw new Error(`${tabelle}: ${error.message}`)
      const r = data as { eingefuegt: number; vorhanden: number; fehlgeschlagen: number; fehler: string[] }
      summe.eingefuegt += r.eingefuegt
      summe.vorhanden += r.vorhanden
      summe.fehlgeschlagen += r.fehlgeschlagen
      bericht.fehler.push(...r.fehler)
    }
    bericht.tabellen[tabelle] = summe
  }
  // Rauchwarnmelder und Geräte aus Sicherungen vor 2.56: je Objekt zu einem Bestand zusammenführen (docs/KONZEPT-BESTAND-JE-OBJEKT.md)
  const { error: bestandFehler } = await supabase.rpc('bestand_zusammenfuehren')
  if (bestandFehler) bericht.fehler.push(t('Bestände zusammenführen: {fehler}', { fehler: bestandFehler.message }))
  let i = 0
  for (const d of s.dateien) {
    fortschritt(t('Dateien {n}/{gesamt} …', { n: ++i, gesamt: s.dateien.length }))
    const endung = d.pfad.split('.').pop()?.toLowerCase() ?? ''
    const { error } = await supabase.storage.from(d.bucket).upload(d.pfad, new Blob([d.inhalt as BlobPart], { type: MIME[endung] ?? 'application/octet-stream' }), { upsert: false })
    if (!error) bericht.dateienHochgeladen++
    else if (/exists|duplicate/i.test(error.message)) bericht.dateienVorhanden++
    else bericht.fehler.push(t('Datei {pfad}: {fehler}', { pfad: `${d.bucket}/${d.pfad}`, fehler: error.message }))
  }
  if (plan.aktivieren) {
    if (bericht.fehler.length) {
      bericht.hinweise.push(t('Die Verschlüsselung wurde noch nicht aktiviert, weil nicht alles wiederhergestellt werden konnte. Bitte die Hinweise prüfen und die Wiederherstellung wiederholen.'))
    } else {
      fortschritt(t('Verschlüsselung aktivieren …'))
      const { error } = await supabase.rpc('verschluesselung_aktivieren')
      if (error) bericht.fehler.push(t('Verschlüsselung aktivieren: {fehler}', { fehler: error.message }))
    }
  }
  fortschritt('')
  return bericht
}
