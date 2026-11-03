// Aktionen des Prüfablaufs: lokal speichern + für den Server vormerken. Funktionieren online wie offline.
import { artDefinition, STANDARD_PRUEFART } from '../lib/anlagenarten'
import { etikettTippfehler } from '../lib/etikett'
import { eigeneSachkundeGueltig } from '../lib/sachkunde'
import { mangelText, type Punkt } from '../lib/checkliste'
import type { Messwerte } from '../lib/messwerte'
import type { Ampel, AntwortWert } from '../lib/pruefung'
import { demoSperreAktiv } from '../lib/demo'
import { supabase } from '../lib/supabase'
import { dateiVerschluesseln, speicherPfad, verschluesseln } from '../lib/verschluesselung'
import { gemeinsamAbgleichen, meineId, objektAbgleichen, objektHerunterladen } from './abgleich'
import { db, type Element, type ElementErgebnis, type FotoZeile, type Mangel, type Pruefung, type Anlage, type Pruefart, type Version } from './db'
import { istNetzwerkfehler, syncBisLeer, vormerken } from './sync'
import { sachkundePflicht, tb } from '../lib/begriffe'
import { t } from '../lib/sprache'
import { istTueranlage, tuerName, tuerPflicht } from '../lib/tueranlage'
import { bestandId, istBestandArt } from '../lib/bestand'
import { altmaengelJeElement } from '../lib/elemente'

const jetzt = () => new Date().toISOString()
const uuid = () => crypto.randomUUID()

// ---------------------------------------------------------------------------
// Tür öffnen / reservieren
// ---------------------------------------------------------------------------

export type OeffnenErgebnis =
  | { ok: true; pruefungId: string }
  | { ok: false; grund: string }
  /** Der Typ hat mehrere Prüfarten: Prüfer wählt, dann erneut öffnen */
  | { ok: false; auswahl: Pruefart[] }
  /** Die Anlage wird gerade geprüft, der Typ erlaubt aber Mehrpersonenprüfung: Mitprüfen anfragen */
  | { ok: false; mitpruefen: MitpruefAngebot }

export interface MitpruefAngebot {
  pruefungId: string
  hauptpruefer: string
  /** 'keine' = noch nicht angefragt */
  status: 'keine' | 'angefragt' | 'abgelehnt'
}

/** Aktive Prüfarten des Typs einer Anlage, in der festgelegten Reihenfolge. */
export async function pruefartenFuer(anlage: Pick<Anlage, 'anlagentyp_id'>): Promise<Pruefart[]> {
  const liste = await db.pruefarten.where('anlagentyp_id').equals(anlage.anlagentyp_id).filter((p) => p.aktiv).toArray()
  return liste.sort((a, b) => a.reihenfolge - b.reihenfolge || a.name.localeCompare(b.name, 'de'))
}

async function ohneChecklisteGrund(anlage: Anlage, pruefart: Pruefart | undefined): Promise<string> {
  const typ = await db.anlagentypen.get(anlage.anlagentyp_id)
  if (!typ) return tb('Der Türtyp dieser Tür ist auf diesem Gerät unbekannt. Bitte die Prüfung einmal online neu öffnen.')
  if (!pruefart) return tb('Für den Türtyp „{typ}“ ist keine Prüfart angelegt. Admin: unter „Türtypen“ eine Prüfart ergänzen.', { typ: typ.name })
  const name = pruefart.name === STANDARD_PRUEFART ? typ.name : `${typ.name} – ${pruefart.name}`
  if (!pruefart.checkliste_id) return tb('Dem Türtyp „{name}“ ist keine Checkliste zugeordnet. Admin: unter „Türtypen“ eine Checkliste auswählen.', { name })
  return t('Die Checkliste für „{name}“ ist noch nicht freigegeben. Admin: unter „Checklisten“ die Checkliste öffnen und „Freigeben“ wählen.', { name })
    + (navigator.onLine ? '' : t(' (Offline – nach der Freigabe einmal mit Netz erneut versuchen.)'))
}

export async function freigegebeneVersion(pruefart: Pruefart | undefined): Promise<Version | undefined> {
  if (!pruefart?.checkliste_id) return undefined
  return db.versionen.where('checkliste_id').equals(pruefart.checkliste_id).filter((v) => v.status === 'freigegeben').first()
}

/** Sachkunde (wenn für die Art eingeschaltet) – der Server prüft beim Speichern noch einmal */
async function sachkundeFehlt(anlage: Anlage): Promise<string | null> {
  const typ = await db.anlagentypen.get(anlage.anlagentyp_id)
  // Die Türanlage eines Objekts verlangt die Sachkunde für Türen (wie der Server, hat_sachkunde)
  const art = typ?.anlagenart === 'tueranlage' ? 'tuer' : typ?.anlagenart
  if (art && sachkundePflicht(art) && !eigeneSachkundeGueltig(art, jetzt().slice(0, 10))) {
    return t('Für {art} ist bei Ihnen keine gültige Sachkunde hinterlegt. Admin: unter „Benutzer“ eintragen.', { art: artDefinition(art).name })
  }
  return null
}

/** Sachkunde, Prüfart und freigegebene Checkliste für eine neue Prüfung – oder der Grund, warum es nicht geht. */
async function pruefungVorbereiten(anlage: Anlage, pruefartId?: string): Promise<{ pruefart: Pruefart; version: Version } | Extract<OeffnenErgebnis, { ok: false }>> {
  const sachkunde = await sachkundeFehlt(anlage)
  if (sachkunde) return { ok: false, grund: sachkunde }
  let arten = await pruefartenFuer(anlage)
  if (!arten.length && navigator.onLine) {
    try { await objektHerunterladen(anlage.objekt_id) } catch { /* offline oder Fehler: alte Daten behalten */ }
    arten = await pruefartenFuer(anlage)
  }
  if (!pruefartId && arten.length > 1) return { ok: false, auswahl: arten }
  let pruefart = pruefartId ? arten.find((p) => p.id === pruefartId) : arten[0]
  let version = await freigegebeneVersion(pruefart)
  if (!version && navigator.onLine) {
    // Vielleicht wurde die Checkliste erst nach dem Start der Prüfung freigegeben → Daten neu laden
    try { await objektHerunterladen(anlage.objekt_id) } catch { /* offline oder Fehler: alte Daten behalten */ }
    pruefart = (await pruefartenFuer(anlage)).find((p) => p.id === (pruefart?.id ?? pruefartId)) ?? pruefart
    version = await freigegebeneVersion(pruefart)
  }
  if (!pruefart || !version) return { ok: false, grund: await ohneChecklisteGrund(anlage, pruefart) }
  return { pruefart, version }
}

/** Türanlagen prüfen ohne eigene Checkliste (`version` null); ihre Türen werden als Teilprüfungen mit ihren Checklisten geprüft. */
function neuePruefung(id: string, sessionId: string | null, anlage: Anlage, ich: string, pruefart: Pruefart, version: Version | null, erfassung: 'scan' | 'manuell'): Pruefung {
  return {
    id, session_id: sessionId, anlage_id: anlage.id, pruefer_id: ich, checkliste_version_id: version?.id ?? null, pruefart_id: pruefart.id, erfassung,
    erfasst_offline: false, status: 'in_pruefung', nicht_geprueft_grund: null, duplikat_von: null, duplikat_geklaert: false,
    ergebnis_auto: null, ergebnis: null, ergebnis_begruendung: null, begonnen_am: jetzt(), beendet_am: null,
    letzte_aktivitaet: jetzt(), erstellt_am: jetzt(), geaendert_am: jetzt(), urspruenglicher_pruefer_id: null, uebernommen_am: null,
    abgeschlossen_am: null, revision: 0, protokoll_nr: null, unterschrift: null, unterschrift_am: null,
    kunde_name: null, kunde_unterschrift: null, kunde_unterschrift_am: null, teil_von_id: null,
  }
}

/** Hauptprüfung der Türanlage, zu der eine Teilprüfung gehört – sonst die Prüfung selbst */
async function hauptpruefung(p: Pruefung): Promise<Pruefung> {
  if (!p.teil_von_id) return p
  return (await db.pruefungen.get(p.teil_von_id)) ?? p
}

/** Teilprüfungen (Türen) einer Hauptprüfung auf diesem Gerät */
export async function teileVon(hauptId: string): Promise<Pruefung[]> {
  return db.pruefungen.where('teil_von_id').equals(hauptId).toArray()
}

/** Die Anlage ist schon in Prüfung: Absage – oder Angebot zum Mitprüfen, wenn der Typ das erlaubt. */
async function fremdeSperre(fremd: Pruefung, anlage: Anlage, ich: string): Promise<OeffnenErgebnis> {
  const name = (await db.benutzer.get(fremd.pruefer_id))?.name ?? t('einem Kollegen')
  if (fremd.status === 'nicht_geprueft') return { ok: false, grund: tb('Die Tür wurde als „nicht geprüft“ markiert ({grund}).', { grund: fremd.nicht_geprueft_grund }) }
  if (fremd.status === 'in_pruefung' && (await db.anlagentypen.get(anlage.anlagentyp_id))?.mehrpersonenpruefung) {
    const m = await db.mitpruefer.get([fremd.id, ich])
    if (m?.status === 'zugelassen') return { ok: true, pruefungId: fremd.id }
    return { ok: false, mitpruefen: { pruefungId: fremd.id, hauptpruefer: name, status: (m?.status as MitpruefAngebot['status'] | undefined) ?? 'keine' } }
  }
  return { ok: false, grund: fremd.status === 'geprueft' ? t('Bereits geprüft von {name}.', { name }) : t('Wird gerade von {name} geprüft.', { name }) }
}

async function eigenePruefungLaden(id: string) {
  const ich = await meineId()
  const [p, antworten, maengel, ergebnisse, mitpruefer] = await Promise.all([
    supabase.from('anlagenpruefung').select('*').eq('id', id).single(),
    supabase.from('antwort').select('*').eq('anlagenpruefung_id', id),
    // eigene neue Mängel und frühere Mängel, die in dieser Prüfung als behoben bestätigt wurden
    supabase.from('mangel').select('*').or(`entdeckt_in.eq.${id},nachgeprueft_in.eq.${id}`),
    supabase.from('element_ergebnis').select('*').eq('anlagenpruefung_id', id),
    supabase.from('anlagenpruefung_mitpruefer').select('*').eq('anlagenpruefung_id', id),
  ])
  if (p.error) throw p.error
  // Nach dem Wiederöffnen durch einen Admin kann die Prüfung einem anderen gehören
  await db.pruefungen.put({ ...p.data, server_status: p.data.status, fremd: p.data.pruefer_id !== ich } as Pruefung)
  // Türanlage: die Teilprüfungen ihrer Türen gehören dazu
  if (!p.data.teil_von_id) {
    const teile = await supabase.from('anlagenpruefung').select('id').eq('teil_von_id', id)
    if (teile.error) throw teile.error
    for (const t of teile.data ?? []) await eigenePruefungLaden(t.id)
  }
  await db.mitpruefer.where('anlagenpruefung_id').equals(id).delete()
  await db.mitpruefer.bulkPut(mitpruefer.data ?? [])
  await db.antworten.bulkPut(antworten.data ?? [])
  await db.maengel.bulkPut(maengel.data ?? [])
  await db.elementErgebnisse.bulkPut(ergebnisse.data ?? [])
  // Foto-Einträge (Bilder selbst lädt die Vorschau bei Bedarf vom Server) – nötig u. a. für „Foto erforderlich“
  const bezuege = [...(antworten.data ?? []).map((x) => x.id), ...(maengel.data ?? []).map((x) => x.id)]
  if (bezuege.length) {
    const fotos = await supabase.from('foto').select('*').in('bezug_id', bezuege)
    if (fotos.error) throw fotos.error
    await db.fotos.bulkPut(fotos.data)
  }
}

// ---------------------------------------------------------------------------
// Mehrpersonenprüfung (nur online): anfragen, zulassen, beenden
// ---------------------------------------------------------------------------

/** Beim Hauptprüfer anfragen, ob man mitprüfen darf. */
export async function mitpruefenAnfragen(pruefungId: string): Promise<'angefragt' | 'zugelassen' | 'abgelehnt'> {
  const ich = await meineId()
  const p = await db.pruefungen.get(pruefungId)
  const { data, error } = await supabase.rpc('mitpruefung_anfragen', { p_anlagenpruefung_id: pruefungId })
  if (error) throw error
  const status = data as 'angefragt' | 'zugelassen' | 'abgelehnt'
  if (p) await db.mitpruefer.put({ anlagenpruefung_id: pruefungId, session_id: p.session_id, benutzer_id: ich, status, angefragt_am: jetzt(), entschieden_am: null, unterschrift: null, fertig_am: null })
  return status
}

/** Hauptprüfer: Anfrage eines Kollegen zulassen oder ablehnen. */
export async function mitpruefenEntscheiden(pruefungId: string, benutzerId: string, zulassen: boolean) {
  const { error } = await supabase.rpc('mitpruefung_entscheiden', { p_anlagenpruefung_id: pruefungId, p_benutzer_id: benutzerId, p_zulassen: zulassen })
  if (error) throw error
  await db.mitpruefer.update([pruefungId, benutzerId], { status: zulassen ? 'zugelassen' : 'abgelehnt', entschieden_am: jetzt() })
}

/** Hauptprüfer entfernt einen Mitprüfer – oder (ohne `benutzerId`) man zieht die eigene Anfrage zurück bzw. verlässt die Prüfung. */
export async function mitpruefenBeenden(pruefungId: string, benutzerId?: string) {
  const ich = await meineId()
  const wer = benutzerId ?? ich
  // Eigene noch nicht übertragene Eingaben zuerst loswerden, damit sie nicht an der gesperrten Prüfung scheitern
  if (wer === ich) await syncBisLeer(10_000)
  const { error } = await supabase.rpc('mitpruefung_beenden', { p_anlagenpruefung_id: pruefungId, p_benutzer_id: wer })
  if (error) throw error
  const p = await db.pruefungen.get(pruefungId)
  if (p && !p.session_id) await db.mitpruefer.update([pruefungId, wer], { status: 'entfernt', unterschrift: null, fertig_am: null })
  else await db.mitpruefer.delete([pruefungId, wer])
  if (wer === ich && p?.fremd) {
    const antworten = await db.antworten.where('anlagenpruefung_id').equals(pruefungId).primaryKeys()
    await db.antworten.bulkDelete(antworten)
    await db.elementErgebnisse.where('anlagenpruefung_id').equals(pruefungId).delete()
  }
}

/** Nach der Zulassung: Prüfung samt Eingaben des Hauptprüfers auf dieses Gerät holen – bei einer Türanlage auch die Türen. */
export async function mitpruefungLaden(pruefungId: string) {
  await gemeinsamAbgleichen(pruefungId)
  const p = await db.pruefungen.get(pruefungId)
  const objekt = p ? (await db.anlagen.get(p.anlage_id))?.objekt_id : undefined
  // Der Abgleich des Objekts holt die Teilprüfungen der Türen samt Einträgen (Mitprüfer stehen an der Türanlage)
  if (objekt && (await db.anlagen.where('teil_von_id').equals(p!.anlage_id).count())) await objektAbgleichen(objekt)
}

// ---------------------------------------------------------------------------
// Unterschriften erlöschen (Prüfung ohne Session) – Spiegel der Regel auf dem Server
// ---------------------------------------------------------------------------

/**
 * Ein Eintrag wurde erfasst, geändert oder entfernt: Die Unterschrift des Ändernden und die des bisherigen Verfassers
 * erlöschen, ebenso die des Kunden. Der Server tut dasselbe; lokal, damit die App sofort um eine neue Unterschrift bittet.
 */
async function eintragGeaendert(pruefungId: string | null | undefined, verfasser?: string | null) {
  const t = pruefungId ? await db.pruefungen.get(pruefungId) : undefined
  if (!t || t.session_id) return
  // Einträge einer Tür lassen die Unterschriften an der Türanlage erlöschen
  const p = await hauptpruefung(t)
  const ich = await meineId()
  for (const wer of new Set([ich, verfasser].filter((x): x is string => !!x))) {
    if (p.pruefer_id === wer) await db.pruefungen.update(p.id, { unterschrift_am: null })
    else await db.mitpruefer.update([p.id, wer], { fertig_am: null })
  }
  if (p.kunde_unterschrift_am) await db.pruefungen.update(p.id, { kunde_unterschrift_am: null })
}

async function fotoPruefung(bezugTyp: string, bezugId: string): Promise<string | undefined> {
  if (bezugTyp === 'antwort') return (await db.antworten.get(bezugId))?.anlagenpruefung_id
  if (bezugTyp === 'mangel') return (await db.maengel.get(bezugId))?.entdeckt_in
  return undefined
}

// ---------------------------------------------------------------------------
// Antworten
// ---------------------------------------------------------------------------

export async function antwortSetzen(pruefungId: string, punktId: string, wert: AntwortWert & { bemerkung?: string | null }) {
  const vorhanden = await db.antworten.where('[anlagenpruefung_id+punkt_id]').equals([pruefungId, punktId]).first()
  const ich = await meineId()
  const zeile = {
    id: vorhanden?.id ?? uuid(), anlagenpruefung_id: pruefungId, punkt_id: punktId,
    status: wert.status ?? null, zahl: wert.zahl ?? null, text: wert.text ?? null,
    bemerkung: wert.bemerkung !== undefined ? wert.bemerkung : vorhanden?.bemerkung ?? null,
    erstellt_am: vorhanden?.erstellt_am ?? jetzt(), geaendert_am: jetzt(), erfasst_von: ich,
  }
  await db.transaction('rw', [db.antworten, db.pruefungen, db.outbox], async () => {
    await db.antworten.put(zeile)
    await db.pruefungen.update(pruefungId, { letzte_aktivitaet: jetzt() })
    await vormerken({ art: 'upsert', tabelle: 'antwort', id: zeile.id, daten: zeile })
  })
  await eintragGeaendert(pruefungId, vorhanden?.erfasst_von)
}

/** Antwort entfernen (z. B. weil der Punkt durch eine Bedingung ausgeblendet wurde). */
export async function antwortLoeschen(pruefungId: string, punktId: string) {
  const a = await db.antworten.where('[anlagenpruefung_id+punkt_id]').equals([pruefungId, punktId]).first()
  if (!a) return
  await db.transaction('rw', [db.antworten, db.outbox], async () => {
    await db.antworten.delete(a.id)
    await vormerken({ art: 'delete', tabelle: 'antwort', id: a.id })
  })
  await eintragGeaendert(pruefungId, a.erfasst_von)
}

// ---------------------------------------------------------------------------
// Mängel und Fotos
// ---------------------------------------------------------------------------

/** Mangel anlegen; zu einem Prüfpunkt ohne eigene Beschreibung mit dem Vorschlag aus der Antwort (mangelText). */
export async function mangelAnlegen(pruefung: Pruefung, punkt: Punkt | null, stufe: number, beschreibung?: string, elementId?: string, antwort?: AntwortWert): Promise<string> {
  const ich = await meineId()
  const m: Mangel = {
    id: uuid(), anlage_id: pruefung.anlage_id, entdeckt_in: pruefung.id, punkt_id: punkt?.id ?? null, element_id: elementId ?? null,
    beschreibung: beschreibung ?? (punkt ? mangelText(punkt, antwort) : ''), stufe, status: 'offen', behoben_am: null, behoben_notiz: null,
    nachgeprueft_in: null, erstellt_am: jetzt(), geaendert_am: jetzt(), erstellt_von: ich, erfasst_von: ich,
  }
  await db.transaction('rw', [db.maengel, db.outbox], async () => {
    await db.maengel.add(m)
    await vormerken({ art: 'upsert', tabelle: 'mangel', id: m.id, daten: m })
  })
  await eintragGeaendert(pruefung.id)
  return m.id
}

export async function mangelAendern(id: string, felder: Partial<Pick<Mangel, 'beschreibung' | 'stufe'>>) {
  const vorher = await db.maengel.get(id)
  if (vorher) await eintragGeaendert(vorher.entdeckt_in, vorher.erfasst_von)
  await db.transaction('rw', [db.maengel, db.outbox], async () => {
    await db.maengel.update(id, { ...felder, geaendert_am: jetzt() })
    const m = await db.maengel.get(id)
    if (m) await vormerken({ art: 'upsert', tabelle: 'mangel', id, daten: m })
  })
}

export async function mangelLoeschen(id: string) {
  const fotos = await db.fotos.where('bezug_id').equals(id).toArray()
  const vorher = await db.maengel.get(id)
  if (vorher) await eintragGeaendert(vorher.entdeckt_in, vorher.erfasst_von)
  await db.transaction('rw', [db.maengel, db.fotos, db.dateien, db.outbox], async () => {
    for (const f of fotos) await fotoEntfernen(f)
    await db.maengel.delete(id)
    await vormerken({ art: 'delete', tabelle: 'mangel', id })
  })
}

/** Offener Mangel aus früherer Prüfung: besteht weiter oder ist behoben (= nachgeprüft in dieser Prüfung). */
export async function altmangelEntscheiden(pruefung: Pruefung, mangelId: string, entscheidung: 'besteht' | 'behoben') {
  await eintragGeaendert(pruefung.id)
  await db.transaction('rw', [db.pruefungen, db.maengel, db.outbox], async () => {
    const altmaengel = { ...((await db.pruefungen.get(pruefung.id))?.altmaengel ?? {}), [mangelId]: entscheidung }
    await db.pruefungen.update(pruefung.id, { altmaengel, letzte_aktivitaet: jetzt() })
    const p = (await db.pruefungen.get(pruefung.id))!
    await vormerken({ art: 'upsert', tabelle: 'anlagenpruefung', id: p.id, daten: p })
    const daten = entscheidung === 'behoben'
      ? { status: 'nachgeprueft', nachgeprueft_in: pruefung.id }
      : { status: 'offen', nachgeprueft_in: null }
    await db.maengel.update(mangelId, daten as Partial<Mangel>)
    await vormerken({ art: 'update', tabelle: 'mangel', id: mangelId, wo: { id: mangelId }, daten })
  })
}

/** Foto verkleinern (max. 1600 px, JPEG) – spart Speicher und Übertragungszeit. */
export async function bildVerkleinern(datei: Blob, max = 1600, qualitaet = 0.8): Promise<Blob> {
  const bild = await createImageBitmap(datei)
  const faktor = Math.min(1, max / Math.max(bild.width, bild.height))
  const leinwand = document.createElement('canvas')
  leinwand.width = Math.round(bild.width * faktor)
  leinwand.height = Math.round(bild.height * faktor)
  leinwand.getContext('2d')!.drawImage(bild, 0, 0, leinwand.width, leinwand.height)
  bild.close()
  return new Promise((ok, fehler) => leinwand.toBlob((b) => (b ? ok(b) : fehler(new Error(t('Bild konnte nicht verarbeitet werden')))), 'image/jpeg', qualitaet))
}

export async function fotoHinzufuegen(sessionId: string, bezugTyp: 'anlage' | 'antwort' | 'mangel', bezugId: string, datei: Blob) {
  const ich = await meineId()
  const klar = await bildVerkleinern(datei)
  const id = uuid()
  // Verschlüsselt schon auf dem Gerät (docs/KONZEPT-VERSCHLUESSELUNG.md): der Pfad gehört zu den Zusatzdaten, also zuerst bestimmen.
  // (Nicht innerhalb der Dexie-Transaktion: sie verträgt kein Warten auf die Verschlüsselung.)
  const pfad = speicherPfad(`${sessionId}/${id}.jpg`)
  const blob = await dateiVerschluesseln('fotos', pfad, klar)
  await db.transaction('rw', [db.dateien, db.fotos, db.outbox], async () => {
    await db.dateien.add({ id, bucket: 'fotos', pfad, blob, hochgeladen: false })
    const zeile = { id, bezug_typ: bezugTyp, bezug_id: bezugId, storage_pfad: pfad, aufgenommen_am: jetzt(), erstellt_von: ich }
    await db.fotos.add(zeile)
    await vormerken({ art: 'datei', id })
    await vormerken({ art: 'upsert', tabelle: 'foto', id, daten: zeile })
  })
  await eintragGeaendert(await fotoPruefung(bezugTyp, bezugId))
}

/**
 * Foto samt Datei entfernen (innerhalb einer Transaktion über fotos, dateien, outbox). Ist die Datei schon beim Server,
 * geht sie nach dem Datensatz mit (sonst bliebe sie als verwaiste Datei im Speicher – bei Klartext aus der Zeit vor der
 * Verschlüsselung lesbar für den Hoster). Wartet sie noch in der Outbox, entfällt der Upload.
 */
async function fotoEntfernen(foto: FotoZeile) {
  const d = await db.dateien.get(foto.id)
  await db.fotos.delete(foto.id)
  await db.dateien.delete(foto.id)
  const nichtHochgeladen = (await db.outbox.where('art').equals('datei').filter((e) => e.id === foto.id).delete()) > 0 && !d?.hochgeladen
  await vormerken({ art: 'delete', tabelle: 'foto', id: foto.id })
  const pfad = d?.pfad ?? foto.storage_pfad
  if (pfad && !nichtHochgeladen) await vormerken({ art: 'datei_loeschen', id: foto.id, daten: { bucket: 'fotos', pfad } })
}

export async function fotoLoeschen(id: string) {
  const foto = await db.fotos.get(id)
  if (!foto) return
  await eintragGeaendert(await fotoPruefung(foto.bezug_typ, foto.bezug_id), foto.erstellt_von)
  await db.transaction('rw', [db.fotos, db.dateien, db.outbox], () => fotoEntfernen(foto))
}

// ---------------------------------------------------------------------------
// Elemente (Leuchten, Melder …) abhaken
// ---------------------------------------------------------------------------

/**
 * Ergebnis eines Elements setzen. „defekt“ ist ein Mangel (Beschreibung „Leuchte 07 · Stromkreis 4: Grund“).
 * Messwerte ersetzen die bisherigen; ohne Angabe bleiben sie erhalten.
 */
export async function elementErgebnisSetzen(pruefung: Pruefung, element: Element, status: ElementErgebnis['status'],
  angaben: { grund?: string | null; bemerkung?: string | null; stufe?: number; name: string; messwerte?: Messwerte } ) {
  const vorhanden = await db.elementErgebnisse.where('[anlagenpruefung_id+element_id]').equals([pruefung.id, element.id]).first()
  const alt = await altmangelVon(pruefung, element.id)
  // Eigener Mangel dieser Prüfung (bei einem früheren Mangel verweist das Ergebnis auf diesen)
  const eigen = vorhanden?.mangel_id && vorhanden.mangel_id !== alt?.id ? vorhanden.mangel_id : null
  let mangelId: string | null = null
  const beschreibung = [angaben.name, angaben.grund].filter(Boolean).join(': ') + (angaben.bemerkung ? ` (${angaben.bemerkung})` : '')
  // Mangel zuerst anlegen bzw. ändern, damit der Verweis beim Hochladen schon gilt. Ist das Element schon aus einer früheren
  // Prüfung defekt, besteht dieser Mangel weiter – kein zweiter für dasselbe Element
  if (status === 'defekt' && alt) mangelId = alt.id
  else if (status === 'defekt') {
    if (eigen && await db.maengel.get(eigen)) { mangelId = eigen; await mangelAendern(eigen, { beschreibung, stufe: angaben.stufe ?? 2 }) }
    else mangelId = await mangelAnlegen(pruefung, null, angaben.stufe ?? 2, beschreibung, element.id)
  }
  const zeile: ElementErgebnis = {
    id: vorhanden?.id ?? uuid(), anlagenpruefung_id: pruefung.id, element_id: element.id, status,
    grund: status === 'defekt' ? angaben.grund ?? null : null, bemerkung: angaben.bemerkung ?? null,
    mangel_id: status === 'defekt' ? mangelId : null, messwerte: angaben.messwerte ?? vorhanden?.messwerte ?? {},
    erstellt_am: vorhanden?.erstellt_am ?? jetzt(), geaendert_am: jetzt(), erfasst_von: await meineId(),
  }
  await db.transaction('rw', [db.elementErgebnisse, db.pruefungen, db.outbox], async () => {
    await db.elementErgebnisse.put(zeile)
    await db.pruefungen.update(pruefung.id, { letzte_aktivitaet: jetzt() })
    await vormerken({ art: 'upsert', tabelle: 'element_ergebnis', id: zeile.id, daten: zeile })
  })
  await eintragGeaendert(pruefung.id, vorhanden?.erfasst_von)
  // Nicht mehr defekt (oder früherer Mangel besteht weiter) → eigener Mangel entfällt
  if (eigen && eigen !== mangelId) await mangelLoeschen(eigen)
  // Früherer Mangel: i.O. bestätigt die Behebung, sonst besteht er weiter
  if (alt) await altmangelNachpruefen(pruefung, alt.id, status === 'io' ? 'behoben' : 'besteht')
}

/** Mangel an diesem Element aus einer früheren Prüfung, der hier nachzuprüfen ist. */
async function altmangelVon(pruefung: Pruefung, elementId: string): Promise<Mangel | undefined> {
  const maengel = await db.maengel.where('anlage_id').equals(pruefung.anlage_id).filter((m) => m.element_id === elementId).toArray()
  return altmaengelJeElement(maengel, pruefung.id).get(elementId)
}

/** Entscheidung zu einem früheren Mangel aus dem Ergebnis des Elements – das trägt nur der Hauptprüfer ein (wie unter „Offene Mängel“). */
async function altmangelNachpruefen(pruefung: Pruefung, mangelId: string, entscheidung: 'besteht' | 'behoben') {
  const p = await db.pruefungen.get(pruefung.id)
  if (!p || p.fremd || p.altmaengel?.[mangelId] === entscheidung) return
  await altmangelEntscheiden(p, mangelId, entscheidung)
}

/** Ergebnis eines Elements zurücknehmen (z. B. versehentlich getippt). */
export async function elementErgebnisLoeschen(pruefung: Pruefung, elementId: string) {
  const e = await db.elementErgebnisse.where('[anlagenpruefung_id+element_id]').equals([pruefung.id, elementId]).first()
  if (!e) return
  await db.transaction('rw', [db.elementErgebnisse, db.outbox], async () => {
    await db.elementErgebnisse.delete(e.id)
    await vormerken({ art: 'delete', tabelle: 'element_ergebnis', id: e.id })
  })
  await eintragGeaendert(pruefung.id, e.erfasst_von)
  // nur den eigenen Mangel; ein früherer bleibt (die Entscheidung dazu auch)
  if (e.mangel_id && (await db.maengel.get(e.mangel_id))?.entdeckt_in === pruefung.id) await mangelLoeschen(e.mangel_id)
}

/** Mehrere Elemente auf einmal „i.O.“ (z. B. ganzer Stromkreis); vorhandene Ergebnisse bleiben. */
export async function elementeIo(pruefung: Pruefung, elemente: Element[]) {
  const vorhanden = new Set((await db.elementErgebnisse.where('anlagenpruefung_id').equals(pruefung.id).toArray()).map((e) => e.element_id))
  const ich = await meineId()
  const neu = elemente.filter((e) => !vorhanden.has(e.id)).map((e): ElementErgebnis => ({
    id: uuid(), anlagenpruefung_id: pruefung.id, element_id: e.id, status: 'io', grund: null, bemerkung: null, mangel_id: null, messwerte: {},
    erstellt_am: jetzt(), geaendert_am: jetzt(), erfasst_von: ich,
  }))
  await db.transaction('rw', [db.elementErgebnisse, db.pruefungen, db.outbox], async () => {
    await db.elementErgebnisse.bulkPut(neu)
    await db.pruefungen.update(pruefung.id, { letzte_aktivitaet: jetzt() })
    for (const z of neu) await vormerken({ art: 'upsert', tabelle: 'element_ergebnis', id: z.id, daten: z })
  })
  if (neu.length) await eintragGeaendert(pruefung.id)
}

/** Element vor Ort ergänzen (auch offline). */
export async function elementAnlegen(anlageId: string, felder: Pick<Element, 'nummer'> & Partial<Element>): Promise<Element> {
  const ich = await meineId()
  const e: Element = {
    id: uuid(), anlage_id: anlageId, gruppe: null, elementart: null, ort: null, typ: null, code: null, eigenschaften: {}, aktiv: true,
    zuletzt_geprueft_am: null, geprueft_je_pruefart: {}, erstellt_am: jetzt(), geaendert_am: jetzt(), erstellt_von: ich, ...felder,
  }
  await db.transaction('rw', [db.elemente, db.outbox], async () => {
    await db.elemente.add(e)
    await vormerken({ art: 'upsert', tabelle: 'anlage_element', id: e.id, daten: e })
  })
  return e
}

/** Angaben eines Elements vor Ort ändern (auch offline), z. B. Code und Seriennummer beim Zuweisen eines gescannten Melders. */
export async function elementAendern(id: string, felder: Partial<Pick<Element, 'gruppe' | 'nummer' | 'elementart' | 'ort' | 'typ' | 'code' | 'eigenschaften'>>) {
  await db.transaction('rw', [db.elemente, db.outbox], async () => {
    await db.elemente.update(id, { ...felder, geaendert_am: jetzt() })
    const e = await db.elemente.get(id)
    if (e) await vormerken({ art: 'upsert', tabelle: 'anlage_element', id, daten: e })
  })
}

export interface CodeTreffer { elementId: string; anlageId: string; nummer: string; gruppe: string | null; anlage: string }

/**
 * Gehört dieser Code schon zu einem aktiven Element? Zuerst auf dem Gerät (geht auch offline), dann beim Server
 * (Elemente anderer Objekte). Der Server schützt zusätzlich mit einem eindeutigen Index; die Prüfung vorab erspart die Fehlermeldung beim Übertragen.
 */
export async function codeSuchen(code: string, ausser?: string): Promise<CodeTreffer | null> {
  const lokal = await db.elemente.where('code').equalsIgnoreCase(code).filter((e) => e.aktiv && e.id !== ausser).first()
  if (lokal) {
    const a = await db.anlagen.get(lokal.anlage_id)
    return { elementId: lokal.id, anlageId: lokal.anlage_id, nummer: lokal.nummer, gruppe: lokal.gruppe, anlage: a?.kunden_bezeichnung || a?.etikett_id || '' }
  }
  if (!navigator.onLine) return null
  // Gescannte Codes sind immer gleich geschrieben; Abweichungen in der Groß-/Kleinschreibung fängt der eindeutige Index beim Speichern ab
  const { data, error } = await supabase.from('anlage_element')
    .select('id, anlage_id, nummer, gruppe, anlage(kunden_bezeichnung, etikett_id)').eq('code', code).eq('aktiv', true).limit(5)
  if (error) {
    if (istNetzwerkfehler(error)) return null
    throw error
  }
  const t = (data ?? []).find((z) => z.id !== ausser)
  if (!t) return null
  return { elementId: t.id, anlageId: t.anlage_id, nummer: t.nummer, gruppe: t.gruppe, anlage: t.anlage?.kunden_bezeichnung || t.anlage?.etikett_id || '' }
}

// ---------------------------------------------------------------------------
// Prüfung abbrechen
// ---------------------------------------------------------------------------

/** Prüfung verwerfen und die Tür für Kollegen freigeben. Bei einer Türanlage gehen die Teilprüfungen ihrer Türen mit. */
export async function pruefungAbbrechen(pruefungId: string) {
  const p = await db.pruefungen.get(pruefungId)
  if (p?.teil_von_id) throw new Error(t('Eine einzelne Tür kann nicht verworfen werden – bitte die Prüfung der Türanlage abbrechen'))
  const ids = [pruefungId, ...(await teileVon(pruefungId)).map((t) => t.id)]
  const maengel = await db.maengel.where('entdeckt_in').anyOf(ids).primaryKeys()
  await db.transaction('rw', [db.pruefungen, db.antworten, db.elementErgebnisse, db.maengel, db.fotos, db.outbox], async () => {
    await db.antworten.where('anlagenpruefung_id').anyOf(ids).delete()
    await db.elementErgebnisse.where('anlagenpruefung_id').anyOf(ids).delete()
    for (const m of maengel) await db.fotos.where('bezug_id').equals(m).delete()
    await db.maengel.bulkDelete(maengel)
    await db.pruefungen.bulkDelete(ids)
    await vormerken({ art: 'rpc', id: pruefungId, rpc: 'reservierung_aufheben', daten: { p_anlagenpruefung_id: pruefungId } })
  })
}

// ---------------------------------------------------------------------------
// Tür vor Ort anlegen
// ---------------------------------------------------------------------------

export async function anlageAnlegen(objektId: string, felder: Partial<Anlage> & { anlagentyp_id: string }): Promise<Anlage> {
  const ich = await meineId()
  // Rauchwarnmelder, Geräte: je Objekt ein Bestand ohne Stammdaten (gibt es ihn schon, gilt er; docs/KONZEPT-BESTAND-JE-OBJEKT.md)
  const art = (await db.anlagentypen.get(felder.anlagentyp_id))?.anlagenart
  if (istBestandArt(art)) {
    const id = bestandId(objektId, art!)
    const vorhanden = await db.anlagen.get(id)
    if (vorhanden) return vorhanden
    felder = { id, anlagentyp_id: felder.anlagentyp_id, kunden_bezeichnung: artDefinition(art).name }
  }
  const anlage: Anlage = {
    id: uuid(), objekt_id: objektId, etikett_id: null, kunden_bezeichnung: null, gebaeude: null, etage: null, raum: null,
    lage_beschreibung: null, hersteller: null, modell: null, baujahr: null, eigenschaften: {},
    letzte_pruefung_am: null, letztes_ergebnis: null, naechste_pruefung_am: null, status: 'aktiv', teil_von_id: null,
    erstellt_am: jetzt(), geaendert_am: jetzt(), erstellt_von: ich, ...felder,
  }
  // Eine Tür gehört zur Türanlage ihres Objekts (der Server setzt das ebenso)
  if ((await db.anlagentypen.get(anlage.anlagentyp_id))?.anlagenart === 'tuer') {
    anlage.teil_von_id = (await db.anlagen.where('objekt_id').equals(objektId).filter(istTueranlage).first())?.id ?? null
  }
  // Der Gerätespeicher und die Outbox halten den Ansprechpartner verschlüsselt (docs/KONZEPT-VERSCHLUESSELUNG.md)
  const geheim = await verschluesseln('anlage', anlage, anlage.id)
  await db.transaction('rw', [db.anlagen, db.freieEtiketten, db.outbox], async () => {
    await db.anlagen.add(geheim)
    if (anlage.etikett_id) await db.freieEtiketten.delete(anlage.etikett_id)
    await vormerken({ art: 'upsert', tabelle: 'anlage', id: anlage.id, daten: geheim })
  })
  return anlage
}

/**
 * Darf dieses Etikett vergeben werden? Online fragt der Server, offline zählt die Liste freier Etiketten auf dem Gerät.
 * Liefert eine Fehlermeldung oder null.
 */
export async function etikettPruefen(etikettId: string): Promise<string | null> {
  const tippfehler = etikettTippfehler(etikettId)
  if (tippfehler) return tippfehler
  if (await db.anlagen.where('etikett_id').equals(etikettId).first()) return tb('Etikett {etikett} ist bereits einer Tür zugeordnet.', { etikett: etikettId })
  if (navigator.onLine) {
    const { data, error } = await supabase.from('etikett').select('id, anlage_id').eq('id', etikettId).maybeSingle()
    if (!error) {
      if (!data) return t('Etikett {etikett} existiert nicht.', { etikett: etikettId })
      if (data.anlage_id) return tb('Etikett {etikett} ist bereits einer anderen Tür zugeordnet.', { etikett: etikettId })
      return null
    }
    if (!istNetzwerkfehler(error)) throw error
  }
  return (await db.freieEtiketten.get(etikettId)) ? null : t('Etikett {etikett} ist auf diesem Gerät nicht als frei bekannt. Bitte ID prüfen.', { etikett: etikettId })
}

/** Etikett einer vorhandenen Tür ohne Etikett zuweisen (vor Ort, auch offline). */
export async function etikettZuweisen(anlageId: string, etikettId: string) {
  await db.transaction('rw', [db.anlagen, db.freieEtiketten, db.outbox], async () => {
    await db.anlagen.update(anlageId, { etikett_id: etikettId, geaendert_am: jetzt() })
    await db.freieEtiketten.delete(etikettId)
    const t = await db.anlagen.get(anlageId)
    if (t) await vormerken({ art: 'upsert', tabelle: 'anlage', id: anlageId, daten: t })
  })
}

/** Stammdaten der Tür vor Ort ergänzen/korrigieren (z. B. Hersteller, Antrieb). */
export async function anlageAendern(id: string, felder: Partial<Pick<Anlage, 'hersteller' | 'modell' | 'baujahr' | 'eigenschaften'>>) {
  // Ansprechpartner (in den Eigenschaften) verschlüsselt speichern; unveränderte Werte behalten ihren Geheimtext
  const geheim = await verschluesseln('anlage', felder, id)
  await db.transaction('rw', [db.anlagen, db.outbox], async () => {
    await db.anlagen.update(id, { ...geheim, geaendert_am: jetzt() })
    const t = await db.anlagen.get(id)
    if (t) await vormerken({ art: 'upsert', tabelle: 'anlage', id, daten: t })
  })
}

// ---------------------------------------------------------------------------
// Unterschriften
// ---------------------------------------------------------------------------

/** Unterschrift auf dem Gerät ablegen und zum Hochladen vormerken (Ordner: die Prüfung). */
async function unterschriftAblegen(ordner: string, blob: Blob): Promise<{ id: string; pfad: string }> {
  const id = uuid()
  // Verschlüsselt schon auf dem Gerät; der Pfad (mit „.enc“) gehört zu den Zusatzdaten
  const pfad = speicherPfad(`${ordner}/${id}.png`)
  const geheim = await dateiVerschluesseln('unterschriften', pfad, blob)
  await db.transaction('rw', [db.dateien, db.outbox], async () => {
    await db.dateien.add({ id, bucket: 'unterschriften', pfad, blob: geheim, hochgeladen: false })
    await vormerken({ art: 'datei', id })
  })
  return { id, pfad }
}

// ---------------------------------------------------------------------------
// Prüfung je Anlage (ohne Session): beginnen, fertig melden, abschließen, wieder öffnen
// ---------------------------------------------------------------------------

/** Läuft die Prüfung noch? Eigene: lokaler Stand; fremde: Serverstand (auch eine noch offene Doppelprüfung). */
export function laeuft(p: Pruefung): boolean {
  if (!p.fremd) return p.status === 'in_pruefung'
  return p.status === 'in_pruefung' || (p.status === 'duplikat' && !p.abgeschlossen_am)
}

/**
 * Anlage zum Prüfen öffnen: eigene laufende Prüfung fortsetzen, sonst neu beginnen (online beim Server reserviert,
 * offline lokal – eine gleichzeitige Prüfung eines Kollegen wird dann beim Sync zur Doppelprüfung).
 */
export async function pruefungOeffnen(anlage: Anlage, erfassung: 'scan' | 'manuell', pruefartId?: string): Promise<OeffnenErgebnis> {
  // Tür einer Türanlage: als Teilprüfung innerhalb der Prüfung der Türanlage
  if (anlage.teil_von_id) return teilpruefungOeffnen(anlage, erfassung, pruefartId)
  // Türanlage des Objekts selbst (aus der Objektliste): ihre Prüfung ohne Checkliste
  if (istTueranlage(anlage)) return hauptpruefungOeffnen(anlage, erfassung)
  const ich = await meineId()
  const laufende = await laufendeFinden(anlage, ich)
  if (laufende.eigene) return { ok: true, pruefungId: laufende.eigene.id }
  if (laufende.fremd) return fremdeSperre(laufende.fremd, anlage, ich)

  const vorbereitet = await pruefungVorbereiten(anlage, pruefartId)
  if ('ok' in vorbereitet) return vorbereitet
  return neuBeginnen(anlage, ich, vorbereitet.pruefart, vorbereitet.version, erfassung)
}

/** Laufende Prüfungen einer Anlage auf dem Gerät: eigene (fortsetzen) und fremde (Absage oder Mitprüfen). */
async function laufendeFinden(anlage: Anlage, ich: string): Promise<{ eigene?: Pruefung; fremd?: Pruefung }> {
  const lesen = async () => (await db.pruefungen.where('anlage_id').equals(anlage.id).toArray()).filter((p) => !p.session_id && laeuft(p))
  let alle = await lesen()
  // Der Kollege kann inzwischen fertig sein oder freigegeben worden sein: vor der Absage den Stand vom Server holen
  if (navigator.onLine && alle.some((p) => p.pruefer_id !== ich)) {
    try { await objektAbgleichen(anlage.objekt_id); alle = await lesen() } catch { /* offline oder Fehler: lokaler Stand */ }
  }
  return { eigene: alle.find((p) => p.pruefer_id === ich && !p.fremd), fremd: alle.find((p) => p.pruefer_id !== ich) }
}

/** Neue Prüfung beginnen: online beim Server reserviert, offline lokal (eine gleichzeitige Prüfung eines Kollegen wird beim Sync zur Doppelprüfung). */
async function neuBeginnen(anlage: Anlage, ich: string, pruefart: Pruefart, version: Version | null, erfassung: 'scan' | 'manuell'): Promise<OeffnenErgebnis> {
  const lesen = async () => (await db.pruefungen.where('anlage_id').equals(anlage.id).toArray()).filter((p) => !p.session_id && laeuft(p))
  const id = uuid()
  const neu = neuePruefung(id, null, anlage, ich, pruefart, version, erfassung)

  // Demomodus: wie offline nur auf dem Gerät beginnen (die Outbox wird nie übertragen)
  if (navigator.onLine && !demoSperreAktiv()) {
    // Ein noch nicht übertragener Abbruch zuerst: sonst hält der Server die abgebrochene Prüfung für laufend, meldet sie als
    // eigene zurück – und der nachgereichte Abbruch löscht danach genau die Prüfung, in der weitergearbeitet wird
    if (await db.outbox.filter((e) => e.art === 'rpc' && e.rpc === 'reservierung_aufheben').count()) await syncBisLeer()
    try {
      const { data, error } = await supabase.rpc('pruefung_beginnen', {
        // Türanlagen haben keine Checkliste: der Server nimmt dann null an (die erzeugten Typen kennen keine leeren Parameter)
        p_id: id, p_anlage_id: anlage.id, p_checkliste_version_id: (version?.id ?? null) as string, p_erfassung: erfassung, p_pruefart_id: pruefart.id,
      })
      if (error) throw error
      const r = data as { ok: boolean; id?: string; pruefer?: string }
      if (!r.ok) {
        await objektAbgleichen(anlage.objekt_id)
        const fremdJetzt = (await lesen()).find((p) => p.pruefer_id !== ich)
        if (fremdJetzt) return fremdeSperre(fremdJetzt, anlage, ich)
        return { ok: false, grund: t('Wird gerade von {name} geprüft.', { name: r.pruefer }) }
      }
      if (r.id && r.id !== id) {
        // eigene Prüfung von einem anderen Gerät fortsetzen
        await eigenePruefungLaden(r.id)
        return { ok: true, pruefungId: r.id }
      }
      await db.pruefungen.add({ ...neu, server_status: 'in_pruefung' })
      return { ok: true, pruefungId: id }
    } catch (e) {
      if (!istNetzwerkfehler(e)) throw e
    }
  }

  await db.transaction('rw', [db.pruefungen, db.outbox], async () => {
    await db.pruefungen.add({ ...neu, erfasst_offline: true })
    await vormerken({ art: 'upsert', tabelle: 'anlagenpruefung', id, daten: { ...neu, erfasst_offline: true } })
  })
  return { ok: true, pruefungId: id }
}

// ---------------------------------------------------------------------------
// Türanlage (docs/KONZEPT-TUERANLAGE.md): Hauptprüfung der Türanlage, Teilprüfung je Tür
// ---------------------------------------------------------------------------

/** Prüfung der Türanlage öffnen: eigene laufende fortsetzen, bei einem Kollegen mitprüfen, sonst neu beginnen (ohne Checkliste). */
async function hauptpruefungOeffnen(tueranlage: Anlage, erfassung: 'scan' | 'manuell'): Promise<OeffnenErgebnis> {
  const ich = await meineId()
  const laufende = await laufendeFinden(tueranlage, ich)
  if (laufende.eigene) return { ok: true, pruefungId: laufende.eigene.id }
  if (laufende.fremd) return fremdeSperre(laufende.fremd, tueranlage, ich)
  const sachkunde = await sachkundeFehlt(tueranlage)
  if (sachkunde) return { ok: false, grund: sachkunde }
  let pruefart = (await pruefartenFuer(tueranlage))[0]
  if (!pruefart && navigator.onLine) {
    try { await objektHerunterladen(tueranlage.objekt_id) } catch { /* offline oder Fehler: alte Daten behalten */ }
    pruefart = (await pruefartenFuer(tueranlage))[0]
  }
  if (!pruefart) return { ok: false, grund: t('Die Türanlage ist auf diesem Gerät nicht vollständig. Bitte das Objekt einmal mit Netz neu öffnen.') }
  return neuBeginnen(tueranlage, ich, pruefart, null, erfassung)
}

/**
 * Tür einer Türanlage öffnen: Die Prüfung der Türanlage läuft (oder beginnt jetzt), die Tür bekommt darin ihre Teilprüfung.
 * Prüfer der Teilprüfung ist der Hauptprüfer; ein zugelassener Mitprüfer sieht sie als fremde, aber bearbeitbare Prüfung.
 */
async function teilpruefungOeffnen(tuer: Anlage, erfassung: 'scan' | 'manuell', pruefartId?: string): Promise<OeffnenErgebnis> {
  const ich = await meineId()
  const tueranlage = await db.anlagen.get(tuer.teil_von_id!)
  if (!tueranlage) return { ok: false, grund: t('Die Türanlage dieser Tür ist auf diesem Gerät unbekannt. Bitte das Objekt einmal mit Netz neu öffnen.') }
  const haupt = await hauptpruefungOeffnen(tueranlage, erfassung)
  if (!haupt.ok) return haupt
  const h = await db.pruefungen.get(haupt.pruefungId)
  if (!h) return { ok: false, grund: t('Die Prüfung der Türanlage wurde nicht gefunden') }
  const vorhanden = (await teileVon(h.id)).find((t) => t.anlage_id === tuer.id && t.status !== 'duplikat')
  if (vorhanden) return { ok: true, pruefungId: vorhanden.id }

  const vorbereitet = await pruefungVorbereiten(tuer, pruefartId)
  if ('ok' in vorbereitet) return vorbereitet
  const id = uuid()
  const neu: Pruefung = { ...neuePruefung(id, null, tuer, h.pruefer_id, vorbereitet.pruefart, vorbereitet.version, erfassung), teil_von_id: h.id, fremd: h.pruefer_id !== ich }

  if (navigator.onLine && !demoSperreAktiv()) {
    try {
      const { data, error } = await supabase.rpc('teilpruefung_beginnen', {
        p_id: id, p_haupt_id: h.id, p_anlage_id: tuer.id, p_checkliste_version_id: vorbereitet.version.id, p_erfassung: erfassung, p_pruefart_id: vorbereitet.pruefart.id,
      })
      if (error) throw error
      const r = data as { ok: boolean; id?: string; pruefer?: string }
      if (!r.ok) return { ok: false, grund: t('Die Türanlage wird gerade von {name} geprüft.', { name: r.pruefer }) }
      if (r.id && r.id !== id) {
        // Teilprüfung dieser Tür von einem anderen Gerät fortsetzen
        await eigenePruefungLaden(r.id)
        return { ok: true, pruefungId: r.id }
      }
      await db.pruefungen.add({ ...neu, server_status: 'in_pruefung' })
      return { ok: true, pruefungId: id }
    } catch (e) {
      if (!istNetzwerkfehler(e)) throw e
    }
  }

  await db.transaction('rw', [db.pruefungen, db.outbox], async () => {
    await db.pruefungen.add({ ...neu, erfasst_offline: true })
    await vormerken({ art: 'upsert', tabelle: 'anlagenpruefung', id, daten: { ...neu, erfasst_offline: true } })
  })
  return { ok: true, pruefungId: id }
}

/** Stand einer Tür geändert (Ergebnis, fertig, nicht geprüft): Unterschriften von Hauptprüfer und Kunde der Türanlage erlöschen,
 *  dazu die eigene Fertigmeldung als Mitprüfer – Spiegel der Regel auf dem Server. */
async function teilGeaendert(hauptId: string) {
  const h = await db.pruefungen.get(hauptId)
  if (!h) return
  const ich = await meineId()
  await db.pruefungen.update(h.id, { unterschrift_am: null, kunde_unterschrift_am: null })
  if (h.pruefer_id !== ich) await db.mitpruefer.update([h.id, ich], { fertig_am: null })
}

async function teilAendern(teilId: string, daten: Partial<Pruefung>) {
  const teil = await db.pruefungen.get(teilId)
  if (!teil?.teil_von_id) throw new Error(t('Das ist keine Tür einer Türanlage'))
  const h = await db.pruefungen.get(teil.teil_von_id)
  if (h?.abgeschlossen_am) throw new Error(t('Die Türanlage ist abgeschlossen. Bitte zuerst wieder öffnen.'))
  const felder = { ...daten, letzte_aktivitaet: jetzt() }
  await db.transaction('rw', [db.pruefungen, db.outbox], async () => {
    await db.pruefungen.update(teilId, felder)
    await vormerken({ art: 'update', tabelle: 'anlagenpruefung', id: teilId, wo: { id: teilId }, daten: felder })
  })
  await teilGeaendert(teil.teil_von_id)
}

export interface TuerErgebnis {
  auto: Ampel
  ergebnis: Ampel
  begruendung: string | null
}

/** Tür fertig: Türergebnis setzen (keine Unterschrift, keine Sperre – das kommt mit dem Abschluss der Türanlage). Bleibt bis dahin änderbar. */
export async function tuerFertig(teilId: string, e: TuerErgebnis) {
  const t = await db.pruefungen.get(teilId)
  await teilAendern(teilId, {
    status: 'geprueft', ergebnis_auto: e.auto, ergebnis: e.ergebnis, ergebnis_begruendung: e.ergebnis !== e.auto ? e.begruendung : null,
    beendet_am: t?.beendet_am ?? jetzt(), nicht_geprueft_grund: null, altmaengel: t?.altmaengel ?? {},
  })
}

/** Tür mit Grund nicht geprüft (verschlossen, nicht zugänglich): bleibt fällig, steht so im Protokoll. */
export async function tuerNichtGeprueft(teilId: string, grund: string) {
  if (!grund.trim()) throw new Error(t('Bitte den Grund angeben.'))
  await teilAendern(teilId, { status: 'nicht_geprueft', nicht_geprueft_grund: grund.trim(), ergebnis: null, ergebnis_auto: null, ergebnis_begruendung: null })
}

/**
 * Mehrere Türen mit demselben Grund als nicht geprüft markieren (z. B. „Übrige fällige Türen nicht geprüft …“). Legt die
 * Teilprüfungen bei Bedarf an (bei mehreren Prüfarten die erste). Liefert die Türen, die das nicht zuließen, mit Grund.
 */
export async function tuerenNichtGeprueft(tueren: Anlage[], grund: string): Promise<{ tuer: Anlage; grund: string }[]> {
  if (!grund.trim()) throw new Error(t('Bitte den Grund angeben.'))
  const fehler: { tuer: Anlage; grund: string }[] = []
  for (const tuer of tueren) {
    let r = await pruefungOeffnen(tuer, 'manuell')
    if (!r.ok && 'auswahl' in r) r = await pruefungOeffnen(tuer, 'manuell', r.auswahl[0].id)
    // Ohne freigegebene Checkliste lässt sich die Tür nicht prüfen, aber als nicht geprüft vermerken
    if (!r.ok && 'grund' in r) r = await teilNichtGeprueftAnlegen(tuer, grund.trim())
    if (!r.ok) { fehler.push({ tuer, grund: 'grund' in r ? r.grund : t('Die Tür kann gerade nicht geöffnet werden.') }); continue }
    await tuerNichtGeprueft(r.pruefungId, grund)
  }
  return fehler
}

/** Teilprüfung einer Tür gleich als „nicht geprüft“ anlegen (ohne Checkliste; der Server lässt das nur für diesen Stand zu). */
async function teilNichtGeprueftAnlegen(tuer: Anlage, grund: string): Promise<OeffnenErgebnis> {
  const tueranlage = tuer.teil_von_id ? await db.anlagen.get(tuer.teil_von_id) : undefined
  if (!tueranlage) return { ok: false, grund: t('Die Türanlage dieser Tür ist auf diesem Gerät unbekannt. Bitte das Objekt einmal mit Netz neu öffnen.') }
  const haupt = await hauptpruefungOeffnen(tueranlage, 'manuell')
  if (!haupt.ok) return haupt
  const h = await db.pruefungen.get(haupt.pruefungId)
  if (!h) return { ok: false, grund: t('Die Prüfung der Türanlage wurde nicht gefunden') }
  const vorhanden = (await teileVon(h.id)).find((t) => t.anlage_id === tuer.id && t.status !== 'duplikat')
  if (vorhanden) return { ok: true, pruefungId: vorhanden.id }
  const pruefart = (await pruefartenFuer(tuer))[0]
  if (!pruefart) return { ok: false, grund: t('Für den Typ dieser Tür ist keine Prüfart angelegt.') }
  const id = uuid()
  const neu: Pruefung = { ...neuePruefung(id, null, tuer, h.pruefer_id, pruefart, null, 'manuell'), teil_von_id: h.id, fremd: h.pruefer_id !== await meineId(),
    status: 'nicht_geprueft', nicht_geprueft_grund: grund }
  await db.transaction('rw', [db.pruefungen, db.outbox], async () => {
    await db.pruefungen.add(neu)
    await vormerken({ art: 'upsert', tabelle: 'anlagenpruefung', id, daten: neu })
  })
  return { ok: true, pruefungId: id }
}

/** Fertige oder nicht geprüfte Tür wieder öffnen (solange die Türanlage nicht abgeschlossen ist). */
export async function tuerWiederOeffnen(teilId: string) {
  await teilAendern(teilId, { status: 'in_pruefung', beendet_am: null, nicht_geprueft_grund: null })
}

const RANG: Record<Ampel, number> = { gruen: 0, gelb: 1, rot: 2 }

/**
 * Abschluss einer Türanlage vorbereiten: Alle beim Beginn fälligen aktiven Türen sind fertig oder nicht geprüft, das
 * Gesamtergebnis ist das schlechteste Türergebnis (verschärfen nur mit Begründung). Liefert das Gesamtergebnis (auto) –
 * der Server rechnet dasselbe nach.
 */
async function tueranlageAbschlussPruefen(p: Pruefung, a: Pick<Abschluss, 'ergebnis' | 'begruendung'>): Promise<Ampel | null> {
  const anlage = await db.anlagen.get(p.anlage_id)
  if (!anlage || !istTueranlage(anlage)) return null
  const tueren = await db.anlagen.where('teil_von_id').equals(anlage.id)
    .filter((t) => t.status === 'aktiv' && tuerPflicht(t.naechste_pruefung_am, p.begonnen_am)).toArray()
  const teile = (await teileVon(p.id)).filter((t) => t.status !== 'duplikat')
  const fertig = (t: Anlage) => teile.some((x) => x.anlage_id === t.id && (x.status === 'geprueft' || x.status === 'nicht_geprueft'))
  const offen = tueren.filter((t) => !fertig(t))
  if (offen.length) throw new Error(t('Noch nicht fertig: {tueren}', { tueren: offen.map(tuerName).join(', ') }))
  const ergebnisse = teile.filter((x) => x.status === 'geprueft' && x.ergebnis).map((x) => x.ergebnis as Ampel)
  if (!ergebnisse.length) throw new Error(t('Keine Tür geprüft – mindestens eine Tür der Türanlage muss geprüft sein'))
  const auto = ergebnisse.sort((x, y) => RANG[y] - RANG[x])[0]
  if (RANG[a.ergebnis] < RANG[auto]) throw new Error(t('Das Ergebnis der Türanlage kann nicht besser sein als das ihrer Türen'))
  if (RANG[a.ergebnis] > RANG[auto] && !a.begruendung?.trim()) throw new Error(t('Bitte begründen, warum das Ergebnis schlechter ist als das der Türen'))
  return auto
}

export interface Abschluss {
  auto: Ampel
  ergebnis: Ampel
  begruendung: string | null
  /** Unterschrift des Hauptprüfers – jede Prüfung (auch jede Revision) wird einzeln unterschrieben */
  unterschrift: Blob
  /** Optional: Kunde unterschreibt diese Prüfung */
  kunde?: { name: string; unterschrift: Blob }
}

/**
 * Anlage abschließen: Ergebnis und Unterschrift(en) speichern. Der Abschluss geht als eigener, letzter Eintrag an den
 * Server (nach allen Antworten und nach den Unterschrift-Dateien) – erst dort wird die Prüfung gesperrt und nummeriert.
 * Die Unterschriftsdateien bleiben beim Server nur, bis das Protokoll erzeugt ist (siehe protokoll/erzeugen.ts).
 */
export async function pruefungAbschliessen(pruefungId: string, a: Abschluss) {
  const p = await db.pruefungen.get(pruefungId)
  if (!p) throw new Error(t('Prüfung nicht gefunden'))
  if (p.session_id) throw new Error(t('Prüfungen aus der Zeit der Sessions sind bereits abgeschlossen'))
  if (p.teil_von_id) throw new Error(t('Türen werden mit ihrer Türanlage abgeschlossen'))
  const auto = (await tueranlageAbschlussPruefen(p, a)) ?? a.auto
  if (!a.unterschrift) throw new Error(t('Bitte unterschreiben.'))
  if (a.kunde && !a.kunde.name.trim()) throw new Error(t('Bitte den Namen des Kunden angeben.'))
  const offen = (await db.mitpruefer.where('anlagenpruefung_id').equals(pruefungId).toArray())
    .filter((m) => m.status === 'zugelassen' && !m.fertig_am)
  if (offen.length) {
    const namen = (await db.benutzer.bulkGet(offen.map((m) => m.benutzer_id))).map((b) => b?.name ?? t('Mitprüfer')).join(', ')
    throw new Error(t('Noch nicht fertig gemeldet: {namen}', { namen }))
  }
  const eigene = await unterschriftAblegen(pruefungId, a.unterschrift)
  const kunde = a.kunde ? await unterschriftAblegen(pruefungId, a.kunde.unterschrift) : null
  const klar = {
    status: 'geprueft' as const, ergebnis_auto: auto, ergebnis: a.ergebnis, ergebnis_begruendung: a.ergebnis !== auto ? a.begruendung : null,
    beendet_am: p.beendet_am ?? jetzt(), letzte_aktivitaet: jetzt(), revision: p.revision, altmaengel: p.altmaengel ?? {},
    unterschrift: eigene.pfad,
    ...(kunde ? { kunde_name: a.kunde!.name.trim(), kunde_unterschrift: kunde.pfad } : {}),
  }
  // Der Name des Unterzeichners geht verschlüsselt in den Gerätespeicher und zum Server
  const daten = await verschluesseln('anlagenpruefung', klar, pruefungId)
  await db.transaction('rw', [db.pruefungen, db.outbox], async () => {
    await db.pruefungen.update(pruefungId, daten)
    await vormerken({
      art: 'update', tabelle: 'anlagenpruefung', id: pruefungId, wo: { id: pruefungId }, daten,
      nach: [eigene.id, ...(kunde ? [kunde.id] : [])],
    })
  })
  // Demomodus: was sonst der Server beim Abschluss setzt (Protokollnummer, Zeitpunkte), hier nur auf dem Gerät
  if (demoSperreAktiv()) {
    const zeit = jetzt()
    await db.pruefungen.update(pruefungId, {
      abgeschlossen_am: zeit, unterschrift_am: zeit, ...(kunde ? { kunde_unterschrift_am: zeit } : {}), server_status: 'geprueft',
      protokoll_nr: `DEMO-${zeit.slice(0, 4)}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`,
    })
  }
}

/** Mitprüfer: eigenen Teil mit Unterschrift fertig melden (auch offline). Danach erfasst er nichts mehr. */
export async function mitpruefungFertigMelden(pruefungId: string, unterschrift: Blob) {
  const ich = await meineId()
  const datei = await unterschriftAblegen(pruefungId, unterschrift)
  await db.transaction('rw', [db.mitpruefer, db.outbox], async () => {
    await db.mitpruefer.update([pruefungId, ich], { unterschrift: datei.pfad, fertig_am: jetzt() })
    await vormerken({
      art: 'update', tabelle: 'anlagenpruefung_mitpruefer', id: `${pruefungId}:${ich}`,
      wo: { anlagenpruefung_id: pruefungId, benutzer_id: ich }, daten: { unterschrift: datei.pfad }, nach: [datei.id],
    })
  })
}

/** Mitprüfer: Fertigmeldung zurücknehmen, um weiter zu erfassen (solange die Anlage nicht abgeschlossen ist). */
export async function mitpruefungFertigZuruecknehmen(pruefungId: string) {
  const ich = await meineId()
  await db.transaction('rw', [db.mitpruefer, db.outbox], async () => {
    await db.mitpruefer.update([pruefungId, ich], { unterschrift: null, fertig_am: null })
    await vormerken({
      art: 'update', tabelle: 'anlagenpruefung_mitpruefer', id: `${pruefungId}:${ich}`,
      wo: { anlagenpruefung_id: pruefungId, benutzer_id: ich }, daten: { unterschrift: null },
    })
  })
}

/**
 * Abgeschlossene Prüfung mit Grund wieder öffnen (nur online): am Tag des Abschlusses der Hauptprüfer, danach ein Admin.
 * Ein Admin kann einen anderen Prüfer einsetzen. Gibt die neue Revision zurück.
 */
export async function wiederOeffnen(pruefungId: string, grund: string, prueferId?: string): Promise<number> {
  if (!(await syncBisLeer())) throw new Error(t('Es sind noch Daten nicht übertragen. Bitte die Verbindung prüfen.'))
  const { data, error } = await supabase.rpc('pruefung_wieder_oeffnen', {
    p_anlagenpruefung_id: pruefungId, p_grund: grund, ...(prueferId ? { p_pruefer_id: prueferId } : {}),
  })
  if (error) throw error
  await eigenePruefungLaden(pruefungId)
  return data as number
}

/** Laufende Prüfung eines Kollegen freigeben (Admin, nur online). Seine Eingaben zu dieser Anlage werden verworfen. */
export async function pruefungFreigeben(pruefungId: string) {
  const p = await db.pruefungen.get(pruefungId)
  const { error } = await supabase.rpc('reservierung_aufheben', { p_anlagenpruefung_id: pruefungId })
  if (error) throw error
  await db.pruefungen.bulkDelete([pruefungId, ...(await teileVon(pruefungId)).map((t) => t.id)])
  const objekt = p ? (await db.anlagen.get(p.anlage_id))?.objekt_id : undefined
  if (objekt) await objektAbgleichen(objekt)
}

/** Doppelprüfung klären: diese Prüfung gilt (beteiligte Prüfer oder Admin, nur online). */
export async function duplikatAufloesen(gueltigId: string) {
  const p = await db.pruefungen.get(gueltigId)
  const { error } = await supabase.rpc('duplikat_aufloesen', { p_gueltig: gueltigId })
  if (error) throw error
  const objekt = p ? (await db.anlagen.get(p.anlage_id))?.objekt_id : undefined
  if (objekt) await objektAbgleichen(objekt)
}

/** Prüfung vom Server auf dieses Gerät holen (z. B. zum Ansehen einer Prüfung eines Kollegen), samt Objekt und Checkliste. */
export async function pruefungLaden(id: string) {
  const { data, error } = await supabase.from('anlagenpruefung').select('checkliste_version_id, anlage(objekt_id)').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) return
  if (data.anlage) await objektHerunterladen(data.anlage.objekt_id)
  if (data.checkliste_version_id && !(await db.versionen.get(data.checkliste_version_id))) {
    const v = await supabase.from('checkliste_version').select('*').eq('id', data.checkliste_version_id).maybeSingle()
    if (v.data) await db.versionen.put(v.data)
  }
  await eigenePruefungLaden(id)
}
