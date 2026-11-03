// Sachkunde je Benutzer und Anlagenart (Tabelle benutzer_sachkunde): Gültigkeit, Anzeige, eigener Stand offline.
import { t } from './sprache'
import { supabase } from './supabase'

export type SachkundeStatus = 'unbefristet' | 'gueltig' | 'bald' | 'abgelaufen'
/** Ab wie vielen Tagen vor Ablauf gewarnt wird */
export const WARNUNG_TAGE = 60

export function sachkundeStatus(gueltigBis: string | null, heute: string): SachkundeStatus {
  if (!gueltigBis) return 'unbefristet'
  if (gueltigBis < heute) return 'abgelaufen'
  const grenze = new Date(new Date(`${heute}T00:00:00Z`).getTime() + WARNUNG_TAGE * 864e5).toISOString().slice(0, 10)
  return gueltigBis <= grenze ? 'bald' : 'gueltig'
}

/** Text fürs Protokoll: „Sachkundiger für … (gültig bis 31.12.2027)“ */
export function sachkundeText(nachweis: string, gueltigBis: string | null): string {
  if (!gueltigBis) return nachweis
  const [j, m, tag] = gueltigBis.split('-')
  return t('{nachweis} (gültig bis {datum})', { nachweis, datum: `${tag}.${m}.${j}` })
}

// ---------------------------------------------------------------------------
// Eigene Sachkunde (für die Prüfung vor Ort, auch offline)
// ---------------------------------------------------------------------------
const CACHE = 'tuerpruefung:sachkunde'
type Eigene = Record<string, string | null> // Art → gültig bis (null = unbefristet)

function ausCache(): Eigene {
  try { return JSON.parse(localStorage.getItem(CACHE) ?? '{}') as Eigene } catch { return {} }
}

export async function eigeneSachkundeLaden(benutzerId: string) {
  const { data, error } = await supabase.from('benutzer_sachkunde').select('anlagenart, gueltig_bis').eq('benutzer_id', benutzerId)
  if (error) return // offline: letzter Stand
  try { localStorage.setItem(CACHE, JSON.stringify(Object.fromEntries(data.map((d) => [d.anlagenart, d.gueltig_bis])))) } catch { /* gesperrt */ }
}

/** Hat der angemeldete Benutzer eine gültige Sachkunde für die Art? (letzter bekannter Stand) */
export function eigeneSachkundeGueltig(art: string, heute: string): boolean {
  const e = ausCache()
  if (!(art in e)) return false
  return sachkundeStatus(e[art], heute) !== 'abgelaufen'
}

export function eigeneSachkundeVergessen() {
  try { localStorage.removeItem(CACHE) } catch { /* egal */ }
}
