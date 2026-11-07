// Lizenzbedingungen müssen je Benutzer nach der Erstinstallation und nach jedem Update (neue App-Version) einmal akzeptiert werden.
// Der Nachweis (Benutzer, Zeitpunkt, Version) liegt in der Datenbank (lizenz_akzeptanz). Zusätzlich merkt sich das Gerät die akzeptierte
// Version, damit die Abfrage offline nicht wiederkommt; eine ohne Netz erteilte Zustimmung wird später nachgemeldet.
import { LIZENZBEDINGUNGEN_STAND } from './lizenzbedingungen'
import { supabase } from './supabase'

const schluessel = (userId: string) => `tuerpruefung:lizenz-akzeptiert:${userId}`
const offenSchluessel = (userId: string) => `tuerpruefung:lizenz-offen:${userId}`

export function lizenzAkzeptiert(userId: string): boolean {
  try { return localStorage.getItem(schluessel(userId)) === __APP_VERSION__ } catch { return false }
}

function lizenzMerken(userId: string) {
  try { localStorage.setItem(schluessel(userId), __APP_VERSION__) } catch { /* Speicher gesperrt: Abfrage kommt beim nächsten Start erneut */ }
}

/** Gerät ohne Merker (neues Gerät, geleerter Speicher): Hat der Benutzer diese Version laut Datenbank schon akzeptiert? */
export async function lizenzInDatenbankPruefen(userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('lizenz_akzeptiert', { p_version: __APP_VERSION__ })
  if (error || !data) return false
  lizenzMerken(userId)
  return true
}

/** Zustimmung festhalten: sofort auf dem Gerät, in der Datenbank sobald erreichbar (Zeitpunkt = Klick, nicht Übertragung). */
export async function lizenzAkzeptieren(userId: string) {
  lizenzMerken(userId)
  try { localStorage.setItem(offenSchluessel(userId), new Date().toISOString()) } catch { /* ohne Speicher nur ein Versuch */ }
  await lizenzNachmelden(userId)
}

/** Noch nicht übertragene Zustimmung an die Datenbank melden (beim Start und nach dem Akzeptieren). */
export async function lizenzNachmelden(userId: string) {
  let zeit: string | null = null
  try { zeit = localStorage.getItem(offenSchluessel(userId)) } catch { /* egal */ }
  if (!zeit) return
  const { error } = await supabase.rpc('lizenz_akzeptieren', { p_version: __APP_VERSION__, p_stand: LIZENZBEDINGUNGEN_STAND, p_zeitpunkt: zeit })
  if (!error) try { localStorage.removeItem(offenSchluessel(userId)) } catch { /* egal */ }
}
