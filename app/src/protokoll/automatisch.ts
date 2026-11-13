// Protokolle der eigenen Prüfungen im Hintergrund erzeugen, sobald der Server den Abschluss bestätigt hat.
// Läuft nach jedem Abgleich; was schon erzeugt ist, merkt sich das Gerät unter `protokoll:<Prüfung>:r<Revision>`.
import { fehlerMelden } from '../lib/fehlerMelden'
import { loggen } from '../lib/log'
import { fehlertext } from '../lib/supabase'
import { meineId } from '../offline/abgleich'
import { PROTOKOLL_NACHHOLEN_TAGE as TAGE, protokollSchluessel } from '../offline/aufraeumen'
import { db } from '../offline/db'
import { pruefprotokollErzeugen } from './erzeugen'

export { protokollSchluessel }

/** Nach einem Fehler erst später wieder versuchen */
const WARTEN = 5 * 60_000

let laeuft = false
const fehlgeschlagen = new Map<string, number>()

export async function protokolleNachholen(): Promise<void> {
  if (laeuft || !navigator.onLine) return
  laeuft = true
  try {
    const ich = await meineId().catch(() => null)
    if (!ich) return
    const grenze = new Date(Date.now() - TAGE * 86_400_000).toISOString()
    const kandidaten = await db.pruefungen.filter((p) => !p.session_id && p.pruefer_id === ich && p.status === 'geprueft'
      && !!p.protokoll_nr && !!p.abgeschlossen_am && p.abgeschlossen_am >= grenze).toArray()
    for (const p of kandidaten) {
      // (Türanlage: erzeugt ihr Protokoll und die ihrer Türen; die Türen selbst tragen keine Nummer und sind keine Kandidaten)
      const schluessel = protokollSchluessel(p.id, p.revision)
      if (await db.meta.get(schluessel)) continue
      if (Date.now() - (fehlgeschlagen.get(schluessel) ?? 0) < WARTEN) continue
      // Abschluss (z. B. einer Revision) noch nicht beim Server: dann später
      if (await db.outbox.filter((e) => e.tabelle === 'anlagenpruefung' && e.id === p.id).count()) continue
      try {
        await pruefprotokollErzeugen(p.id)
        await db.meta.put({ schluessel, wert: new Date().toISOString() })
        fehlgeschlagen.delete(schluessel)
      } catch (e) {
        if (!fehlgeschlagen.has(schluessel)) {
          void loggen('Protokoll nicht erzeugt', `Prüfung ${p.id}, Revision ${p.revision}: ${fehlertext(e)}`)
          void fehlerMelden(e, 'protokoll', 'Protokoll im Hintergrund')
        }
        fehlgeschlagen.set(schluessel, Date.now())
      }
    }
  } finally {
    laeuft = false
  }
}
