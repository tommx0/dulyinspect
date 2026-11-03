// Alle Kundendaten gelöscht (Einstellungen → System → Kundendaten löschen): Was vorher auf ein Gerät geladen oder dort erfasst
// wurde, gehört zu gelöschten Datensätzen. Die Geräte erkennen die Löschung an firma.kundendaten_geloescht_am und leeren ihren
// Offline-Speicher, damit nichts davon wieder hochgeladen wird. Geprüft wird beim Start, bei Rückkehr in die App, vor jeder
// Übertragung und vor jedem Herunterladen eines Objekts. Der Schlüssel der Verschlüsselung bleibt auf dem Gerät.
import { loggen } from '../lib/log'
import { supabase } from '../lib/supabase'
import { ALLE_META } from '../lib/verschluesselung/schluessel'
import { db, metaLesen } from './db'

/** Meta-Schlüssel: Stand der letzten Löschung, die dieses Gerät schon nachvollzogen hat */
export const LOESCHUNG_META = 'kundendaten:geloescht_am'
/** Höchstens so oft beim Server nachfragen (außer `frisch`) */
const ABSTAND_MS = 30_000
let zuletzt = 0

/**
 * Gerätespeicher nach der Löschung leeren: Outbox-Einträge von davor verwerfen; steht danach nichts mehr aus, auch alles
 * Geladene. Einträge, die erst nach der Löschung entstanden sind, bleiben samt Gerätespeicher liegen. Liefert, ob etwas auf
 * dem Gerät lag, und die Anzahl der verworfenen Änderungen.
 */
export async function geraetNachLoeschungLeeren(geloeschtAm: string): Promise<{ geleert: boolean; verworfen: number }> {
  const seit = Date.parse(geloeschtAm)
  return db.transaction('rw', db.tables, async () => {
    const daten = db.tables.filter((t) => t.name !== db.meta.name)
    const geleert = (await Promise.all(daten.map((t) => t.count()))).some((n) => n > 0)
    const verworfen = await db.outbox.filter((e) => e.erstellt < seit).delete()
    if (await db.outbox.count() === 0) {
      await Promise.all(daten.map((t) => t.clear()))
      await db.meta.where('schluessel').noneOf(ALLE_META).delete()
    }
    await db.meta.put({ schluessel: LOESCHUNG_META, wert: geloeschtAm })
    return { geleert, verworfen }
  })
}

/**
 * Hat der Admin seit dem letzten Abgleich alle Kundendaten gelöscht? Dann den Gerätespeicher leeren (true).
 * Ohne Verbindung oder Antwort: nichts tun – die nächste Prüfung holt es nach.
 */
export async function kundendatenLoeschungPruefen(optionen: { frisch?: boolean } = {}): Promise<boolean> {
  if (!optionen.frisch && Date.now() - zuletzt < ABSTAND_MS) return false
  let server: string | null
  try {
    const { data, error } = await supabase.from('firma').select('kundendaten_geloescht_am').maybeSingle()
    if (error || !data) return false
    server = data.kundendaten_geloescht_am
  } catch {
    return false
  }
  zuletzt = Date.now()
  if (!server) return false
  const lokal = await metaLesen<string>(LOESCHUNG_META)
  if (lokal && Date.parse(lokal) >= Date.parse(server)) return false
  const { geleert, verworfen } = await geraetNachLoeschungLeeren(server)
  if (!geleert) return false
  void loggen('Gerätespeicher geleert', `alle Kundendaten wurden am ${server} gelöscht`
    + (verworfen ? `; ${verworfen} nicht übertragene Änderung(en) von davor verworfen` : ''))
  return true
}
