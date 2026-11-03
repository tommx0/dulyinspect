// Gerät aufräumen (Datensparsamkeit): Was der Server bestätigt hat und nicht mehr gebraucht wird, verschwindet vom Gerät.
// - Abgeschlossene Prüfungen: sobald der Abschluss bestätigt (Protokollnummer), alles übertragen und das Protokoll erzeugt ist –
//   am Folgetag, damit „heute geprüft“ in der Anlagenliste und das Vorzeigen beim Kunden offline weiter gehen.
// - Objekte: auf Wunsch des Prüfers („Vom Gerät entfernen“) oder nach OBJEKT_FRIST_TAGE ohne Nutzung, sofern keine eigene
//   Prüfung darin läuft und nichts mehr zu übertragen ist. Beim nächsten Öffnen mit Netz lädt die App das Objekt neu.
// Läuft nach jedem erfolgreichen Sync (also nur online). Abmelden und Sperre räumen wie bisher den Rest.
import { loggen } from '../lib/log'
import { t } from '../lib/sprache'
import { heuteBeginn, meineId } from './abgleich'
import { db, metaLesen, metaSchreiben, type Pruefung } from './db'

/** Objekte ohne laufende Prüfung bleiben so lange nach der letzten Nutzung auf dem Gerät */
export const OBJEKT_FRIST_TAGE = 7
/** So lange holt das Gerät das Protokoll einer eigenen Prüfung selbst nach; ältere erzeugt, wer das Protokoll aufruft */
export const PROTOKOLL_NACHHOLEN_TAGE = 7
/** Meta-Schlüssel: Protokoll dieser Revision ist erzeugt */
export const protokollSchluessel = (pruefungId: string, revision: number) => `protokoll:${pruefungId}:r${revision}`
/** Meta-Schlüssel: letzte Nutzung (Download oder Öffnen) eines Objekts auf diesem Gerät */
export const objektSchluessel = (objektId: string) => `objekt:${objektId}`

export type EntfernenErgebnis = { ok: true } | { ok: false; grund: string }

/** Abschluss vom Server bestätigt und auch lokal nicht wieder geöffnet (Revision) oder als Duplikat markiert */
function abschlussBestaetigt(p: Pruefung): boolean {
  return !p.session_id && p.status === 'geprueft' && p.server_status === 'geprueft' && !!p.protokoll_nr && !!p.abgeschlossen_am
}

/** Alle Zeilen einer Prüfung auf dem Gerät (ohne Mängel – die gehören zur Anlage) */
async function pruefungsZeilen(pid: string) {
  const [antworten, ergebnisse, maengel] = await Promise.all([
    db.antworten.where('anlagenpruefung_id').equals(pid).primaryKeys(),
    db.elementErgebnisse.where('anlagenpruefung_id').equals(pid).primaryKeys(),
    db.maengel.where('entdeckt_in').equals(pid).primaryKeys(),
  ])
  const antwortFotos = antworten.length ? await db.fotos.where('bezug_id').anyOf(antworten).primaryKeys() : []
  const mangelFotos = maengel.length ? await db.fotos.where('bezug_id').anyOf(maengel).primaryKeys() : []
  // Dateien liegen im Ordner der Prüfung (Fotos, Unterschriften)
  const dateien = await db.dateien.filter((d) => d.pfad.startsWith(`${pid}/`)).primaryKeys()
  return { antworten, ergebnisse, antwortFotos, mangelFotos, dateien }
}

/** Steht zu einer dieser Zeilen noch eine Übertragung aus? (Mitprüfer-Einträge heißen `<Prüfung>:<Benutzer>`) */
async function uebertragungOffen(ids: Set<string>, pids: string[]): Promise<boolean> {
  const eintraege = await db.outbox.toArray()
  return eintraege.some((e) => ids.has(e.id) || pids.some((pid) => e.id.startsWith(`${pid}:`))
    || (e.art === 'update' && (e.nach ?? []).some((id) => ids.has(id))))
}

/** Prüfdaten einer Prüfung vom Gerät entfernen; Mangel-Zeilen bleiben, nur ihre Bilddateien gehen. */
async function pruefungEntfernen(p: Pruefung, z: Awaited<ReturnType<typeof pruefungsZeilen>>) {
  await db.transaction('rw', [db.pruefungen, db.mitpruefer, db.antworten, db.elementErgebnisse, db.fotos, db.dateien, db.meta], async () => {
    await db.dateien.bulkDelete([...z.dateien, ...z.antwortFotos, ...z.mangelFotos])
    await db.fotos.bulkDelete(z.antwortFotos)
    await db.antworten.bulkDelete(z.antworten)
    await db.elementErgebnisse.bulkDelete(z.ergebnisse)
    await db.mitpruefer.where('anlagenpruefung_id').equals(p.id).delete()
    await db.meta.delete(`abschluss:${p.id}`)
    await db.meta.where('schluessel').startsWith(`protokoll:${p.id}:`).delete()
    await db.pruefungen.delete(p.id)
  })
}

/**
 * Abgeschlossene Prüfungen vom Gerät räumen. Bedingungen: Abschluss vom Server bestätigt, nicht von heute, nichts mehr
 * zu übertragen, und bei eigenen Prüfungen das Protokoll erzeugt (oder so alt, dass dieses Gerät es nicht mehr nachholt).
 * Liefert die IDs der entfernten Prüfungen.
 */
export async function pruefungenAufraeumen(jetzt = new Date()): Promise<string[]> {
  const heute = heuteBeginn(jetzt)
  const protokollGrenze = new Date(jetzt.getTime() - PROTOKOLL_NACHHOLEN_TAGE * 86_400_000).toISOString()
  // Teilprüfungen (Türen einer Türanlage) tragen keine Nummer und gehen nur mit ihrer Hauptprüfung
  const kandidaten = await db.pruefungen.filter((p) => abschlussBestaetigt(p) && p.abgeschlossen_am! < heute).toArray()
  const entfernt: string[] = []
  for (const p of kandidaten) {
    if (!p.fremd && p.abgeschlossen_am! >= protokollGrenze && !(await metaLesen(protokollSchluessel(p.id, p.revision)))) continue
    const teile = await db.pruefungen.where('teil_von_id').equals(p.id).toArray()
    const alle = [p, ...teile]
    const zeilen = await Promise.all(alle.map((x) => pruefungsZeilen(x.id)))
    const ids = new Set(alle.flatMap((x, i) => [x.id, ...zeilen[i].antworten, ...zeilen[i].ergebnisse, ...zeilen[i].antwortFotos, ...zeilen[i].mangelFotos, ...zeilen[i].dateien]))
    if (await uebertragungOffen(ids, alle.map((x) => x.id))) continue
    for (const [i, x] of alle.entries()) await pruefungEntfernen(x, zeilen[i])
    entfernt.push(p.id)
  }
  return entfernt
}

/**
 * Objekt samt Kunde, Anlagen, Elementen, Mängeln und Prüfungen vom Gerät entfernen. Geht nicht, solange darin eine eigene
 * Prüfung (oder eine, bei der ich mitprüfe) läuft oder noch etwas zu übertragen ist.
 */
export async function objektEntfernen(objektId: string, ich: string): Promise<EntfernenErgebnis> {
  const objekt = await db.objekte.get(objektId)
  if (!objekt) return { ok: true }
  const anlagen = await db.anlagen.where('objekt_id').equals(objektId).primaryKeys()
  const pruefungen = anlagen.length ? await db.pruefungen.where('anlage_id').anyOf(anlagen).toArray() : []
  const pids = pruefungen.map((p) => p.id)
  const mitpruefer = pids.length ? await db.mitpruefer.where('anlagenpruefung_id').anyOf(pids).toArray() : []
  const mitMir = new Set(mitpruefer.filter((m) => m.benutzer_id === ich && m.status === 'zugelassen').map((m) => m.anlagenpruefung_id))
  const laufend = pruefungen.some((p) => p.status === 'in_pruefung' && (!p.fremd || mitMir.has(p.id)))
  if (laufend) return { ok: false, grund: t('In diesem Objekt läuft auf diesem Gerät noch eine Prüfung. Bitte erst abschließen oder abbrechen.') }

  const [elemente, maengel] = await Promise.all([
    anlagen.length ? db.elemente.where('anlage_id').anyOf(anlagen).primaryKeys() : [],
    anlagen.length ? db.maengel.where('anlage_id').anyOf(anlagen).primaryKeys() : [],
  ])
  const zeilen = await Promise.all(pids.map(pruefungsZeilen))
  const ids = new Set<string>([objektId, ...anlagen, ...elemente, ...maengel, ...pids])
  for (const z of zeilen) for (const id of [...z.antworten, ...z.ergebnisse, ...z.antwortFotos, ...z.mangelFotos, ...z.dateien]) ids.add(id)
  if (await uebertragungOffen(ids, pids)) return { ok: false, grund: t('Zu diesem Objekt sind noch Änderungen nicht übertragen. Bitte warten, bis die Sync-Anzeige „gespeichert“ zeigt.') }

  await db.transaction('rw', [db.objekte, db.kunden, db.anlagen, db.elemente, db.gruppen, db.maengel, db.pruefungen, db.mitpruefer, db.antworten,
    db.elementErgebnisse, db.fotos, db.dateien, db.meta], async () => {
    for (const z of zeilen) {
      await db.dateien.bulkDelete([...z.dateien, ...z.antwortFotos, ...z.mangelFotos])
      await db.fotos.bulkDelete([...z.antwortFotos, ...z.mangelFotos])
      await db.antworten.bulkDelete(z.antworten)
      await db.elementErgebnisse.bulkDelete(z.ergebnisse)
    }
    if (pids.length) {
      await db.mitpruefer.where('anlagenpruefung_id').anyOf(pids).delete()
      await db.meta.bulkDelete(pids.map((pid) => `abschluss:${pid}`))
      for (const pid of pids) await db.meta.where('schluessel').startsWith(`protokoll:${pid}:`).delete()
    }
    await db.pruefungen.bulkDelete(pids)
    await db.maengel.bulkDelete(maengel)
    await db.elemente.bulkDelete(elemente)
    if (anlagen.length) await db.gruppen.where('anlage_id').anyOf(anlagen).delete()
    await db.anlagen.bulkDelete(anlagen)
    await db.objekte.delete(objektId)
    // Der Kunde bleibt, solange ein anderes seiner Objekte auf dem Gerät liegt
    if (!(await db.objekte.where('endkunde_id').equals(objekt.endkunde_id).count())) await db.kunden.delete(objekt.endkunde_id)
    await db.meta.bulkDelete([objektSchluessel(objektId), `objektstand:${objektId}`, `freigabe:objekt:${objektId}`])
  })
  return { ok: true }
}

/** Objekte, die länger als OBJEKT_FRIST_TAGE nicht benutzt wurden, vom Gerät entfernen (soweit möglich). Liefert die IDs. */
export async function objekteAufraeumen(ich: string, jetzt = Date.now()): Promise<string[]> {
  const entfernt: string[] = []
  for (const o of await db.objekte.toArray()) {
    const zuletzt = await metaLesen<number>(objektSchluessel(o.id))
    // Ohne Zeitpunkt (vor diesem Update geladen): Frist läuft ab jetzt
    if (!zuletzt) { await metaSchreiben(objektSchluessel(o.id), jetzt); continue }
    if (jetzt - zuletzt < OBJEKT_FRIST_TAGE * 86_400_000) continue
    const r = await objektEntfernen(o.id, ich)
    if (r.ok) entfernt.push(o.id)
  }
  return entfernt
}

/** Nach dem Sync: Prüfungen und Objekte aufräumen. Wirft nie. */
export async function aufraeumen(): Promise<void> {
  const ich = await meineId().catch(() => null)
  if (!ich) return
  try {
    const pruefungen = await pruefungenAufraeumen()
    const objekte = await objekteAufraeumen(ich)
    if (pruefungen.length || objekte.length) {
      void loggen('Gerät aufgeräumt', [pruefungen.length && `${pruefungen.length} abgeschlossene Prüfung(en)`, objekte.length && `${objekte.length} Objekt(e) nach ${OBJEKT_FRIST_TAGE} Tagen ohne Nutzung`].filter(Boolean).join(', '))
    }
  } catch { /* beim nächsten Sync erneut */ }
}
