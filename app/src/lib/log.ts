// Logdateien (System → Logdateien): Aktionen der App ins Log auf dem Server.
// Datenbankänderungen schreibt die Datenbank selbst per Trigger, hier nur, was dort nicht ankommt (Anmeldung, Downloads, …).
// Ohne Netz wartet der Eintrag im Gerätespeicher und wird beim nächsten Eintrag mit dem Zeitpunkt auf dem Gerät nachgetragen.
import { supabase } from './supabase'

const WARTESCHLANGE = 'tuerpruefung:log-warteschlange'
const MAX_WARTEND = 200

interface Eintrag { benutzer: string; aktion: string; details: string; zeit: string }

function wartende(): Eintrag[] {
  try { return JSON.parse(localStorage.getItem(WARTESCHLANGE) ?? '[]') as Eintrag[] } catch { return [] }
}

function merken(liste: Eintrag[]) {
  try {
    if (liste.length) localStorage.setItem(WARTESCHLANGE, JSON.stringify(liste.slice(-MAX_WARTEND)))
    else localStorage.removeItem(WARTESCHLANGE)
  } catch { /* Speicher voll/gesperrt */ }
}

let kette: Promise<void> = Promise.resolve()

/** Eintrag ins Log; wirft nie (das Log darf keine Aktion verhindern). */
export function loggen(aktion: string, details = ''): Promise<void> {
  const zeit = new Date().toISOString()
  kette = kette.then(() => abarbeiten({ aktion, details, zeit })).catch(() => {})
  return kette
}

async function abarbeiten(neu: Omit<Eintrag, 'benutzer'>) {
  const { data } = await supabase.auth.getSession()
  const benutzer = data.session?.user.id
  if (!benutzer) return
  // Wartende Einträge anderer Benutzer (vor einem Abmelden ohne Netz) nicht unter falschem Namen nachtragen
  const liste = [...wartende().filter((e) => e.benutzer === benutzer), { ...neu, benutzer }]
  while (liste.length) {
    const e = liste[0]
    const { error } = await supabase.rpc('log_eintragen', { p_aktion: e.aktion, p_details: e.details, p_erfasst_am: e.zeit })
    // Antwort des Servers ohne Fehlercode = keine Verbindung → später erneut
    if (error && (!navigator.onLine || !error.code)) break
    liste.shift()
  }
  merken(liste)
}

/** Vor dem Abmelden: noch wartende Einträge loswerden (danach gibt es keine Anmeldung mehr dafür). */
export async function logAbschliessen(aktion: string): Promise<void> {
  await Promise.race([loggen(aktion), new Promise((r) => setTimeout(r, 3_000))])
  merken([])
}
