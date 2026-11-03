// Supportzugang (Fernwartung): Anmeldename „support“, in Auth unter einer festen Adresse (wie supabase/functions/admin-benutzer)
import { gebietsschema, t } from './sprache'
import type { Zeile } from './supabase'

export const SUPPORT_BENUTZERNAME = 'support'
export const SUPPORT_EMAIL = 'support@fernwartung.invalid'
export const SUPPORT_MINUTEN = [60, 120] as const

/** Eingabe im Anmeldefeld → E-Mail für Supabase: „support“ steht für den Supportzugang, alles andere bleibt. */
export function anmeldeEmail(eingabe: string): string {
  const e = eingabe.trim()
  return e.toLowerCase() === SUPPORT_BENUTZERNAME ? SUPPORT_EMAIL : e
}

/** Freigeschaltet bis (Supportzugang), sonst null – gesperrt oder abgelaufen. */
export function supportBis(b: Pick<Zeile<'benutzer'>, 'aktiv' | 'aktiv_bis'> | null | undefined, jetzt = Date.now()): Date | null {
  if (!b?.aktiv || !b.aktiv_bis) return null
  const bis = new Date(b.aktiv_bis)
  return bis.getTime() > jetzt ? bis : null
}

/** „14:35 Uhr“ bzw. „29.10. 14:35 Uhr“, wenn nicht heute. */
export function uhrzeit(d: Date, jetzt = new Date()): string {
  const zeit = d.toLocaleTimeString(gebietsschema(), { hour: '2-digit', minute: '2-digit' })
  return (d.toDateString() === jetzt.toDateString() ? '' : `${d.toLocaleDateString(gebietsschema(), { day: '2-digit', month: '2-digit' })} `) + t('{zeit} Uhr', { zeit })
}
