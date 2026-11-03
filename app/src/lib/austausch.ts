// Austausch von Meldern: Rauchwarnmelder haben ein Austauschdatum (Aufkleber, gespeichert als Monatsletzter, siehe monatsende()).
// Ab 6 Monaten vorher wird gewarnt, danach ist der Melder überfällig.
import { t } from './sprache'

/** So viele Monate vor dem Austauschdatum erscheint der Hinweis „Austausch bald fällig“. */
export const AUSTAUSCH_VORLAUF_MONATE = 6

export type AustauschStatus = 'abgelaufen' | 'bald' | 'ok'

/** Datum (JJJJ-MM-TT) plus Monate; ein Tag, den der Zielmonat nicht hat, rutscht auf dessen letzten Tag (31.08. + 6 Monate = 28.02.). */
export function datumPlusMonate(datum: string, monate: number): string {
  const [j, m, t] = datum.slice(0, 10).split('-').map(Number)
  const ziel = new Date(Date.UTC(j, m - 1 + monate, 1))
  const letzter = new Date(Date.UTC(ziel.getUTCFullYear(), ziel.getUTCMonth() + 1, 0)).getUTCDate()
  ziel.setUTCDate(Math.min(t, letzter))
  return ziel.toISOString().slice(0, 10)
}

/** Letzter Tag, dessen Austauschdatum noch „bald fällig“ heißt. */
export const austauschGrenze = (heute: string) => datumPlusMonate(heute, AUSTAUSCH_VORLAUF_MONATE)

/** Einordnung eines Austauschdatums (null/unbrauchbar → ok). Das Datum selbst gilt noch als gültig, danach ist der Melder überfällig. */
export function austauschStatus(austausch: unknown, heute: string): AustauschStatus {
  if (typeof austausch !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(austausch)) return 'ok'
  const tag = austausch.slice(0, 10)
  if (tag < heute) return 'abgelaufen'
  return tag <= austauschGrenze(heute) ? 'bald' : 'ok'
}

/** „2037-06-30“ → „06-2037“ (wie auf dem Aufkleber) */
export const austauschMonat = (austausch: string) => `${austausch.slice(5, 7)}-${austausch.slice(0, 4)}`

/** Satz für Hinweise, z. B. „Austauschdatum 06-2037 überschritten“ oder „Austausch bis 06-2037“. */
export function austauschText(austausch: string, status: AustauschStatus): string {
  const monat = austauschMonat(austausch)
  return status === 'abgelaufen' ? t('Austauschdatum {monat} überschritten', { monat }) : status === 'bald' ? t('Austausch bis {monat}', { monat }) : t('Austausch {monat}', { monat })
}

export interface AustauschZaehler { abgelaufen: number; bald: number }

/** Zählt Melder-Austauschdaten nach Status (für Badges in Listen). */
export function austauschZaehlen(daten: unknown[], heute: string): AustauschZaehler {
  const z = { abgelaufen: 0, bald: 0 }
  for (const d of daten) {
    const s = austauschStatus(d, heute)
    if (s !== 'ok') z[s]++
  }
  return z
}
