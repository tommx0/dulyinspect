// Messwerte je Element (Elektroprüfungen): welche Messungen für ein Element gelten, ihre Grenzwerte und die Bewertung.
// Die Messgrößen stehen bei der Anlagenart (src/lib/anlagenarten.ts), gespeichert wird element_ergebnis.messwerte.
import type { ElementDefinition, MessElement, Messgroesse } from './anlagenarten'
import { gebietsschema } from './sprache'

/** Gemessene Werte je Messgröße, z. B. { riso: 250, zs: 0.85 } */
export type Messwerte = Record<string, number>

export interface Messung extends Messgroesse {
  min?: number
  max?: number
  /** Erwartungswert dieses Elements (ohne Bewertung) */
  richtwertText?: string | null
}

/** Messungen, die für dieses Element gelten, mit ihren Grenzwerten. */
export function messungenFuer(def: ElementDefinition | undefined, e: MessElement): Messung[] {
  return (def?.messungen ?? []).filter((m) => !m.gilt || m.gilt(e))
    .map((m) => ({ ...m, ...(m.grenze?.(e) ?? {}), richtwertText: m.richtwert?.(e) ?? null }))
}

/** Zahl in deutscher Schreibweise ohne überflüssige Nullen: 0,3 · 2,87 · 250 */
export function zahlText(n: number): string {
  return n.toLocaleString(gebietsschema(), { maximumFractionDigits: 3 })
}

/** „≥ 1 MΩ“, „≤ 2,87 Ω“, „15–30 mA“ oder leer (kein Grenzwert) */
export function grenzeText(m: Pick<Messung, 'min' | 'max' | 'einheit'>): string {
  if (m.min != null && m.max != null) return `${zahlText(m.min)}–${zahlText(m.max)} ${m.einheit}`
  if (m.min != null) return `≥ ${zahlText(m.min)} ${m.einheit}`
  if (m.max != null) return `≤ ${zahlText(m.max)} ${m.einheit}`
  return ''
}

export const imSoll = (m: Pick<Messung, 'min' | 'max'>, wert: number) => (m.min == null || wert >= m.min) && (m.max == null || wert <= m.max)

/** Gespeicherte Messwerte (jsonb) lesen: nur endliche Zahlen. */
export function messwerteLesen(json: unknown): Messwerte {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return {}
  return Object.fromEntries(Object.entries(json).filter(([, w]) => typeof w === 'number' && Number.isFinite(w))) as Messwerte
}

/** Messungen außerhalb der Grenzwerte. */
export function verstoesse(messungen: Messung[], werte: Messwerte): { messung: Messung; wert: number }[] {
  return messungen.filter((m) => werte[m.schluessel] != null && !imSoll(m, werte[m.schluessel])).map((m) => ({ messung: m, wert: werte[m.schluessel] }))
}

/** „Riso 0,4 MΩ (Soll ≥ 1 MΩ)“ – Grund des Defekts und Text des Mangels */
export function verstossText(v: { messung: Messung; wert: number }[]): string {
  return v.map(({ messung: m, wert }) => `${m.kurz} ${zahlText(wert)} ${m.einheit} (Soll ${grenzeText(m)})`).join(', ')
}

/** Kurzfassung für Listen: „Riso 250 MΩ · Zs 0,85 Ω“ */
export function messwerteKurz(messungen: Messung[], werte: Messwerte): string {
  return messungen.filter((m) => werte[m.schluessel] != null).map((m) => `${m.kurz} ${zahlText(werte[m.schluessel])} ${m.einheit}`).join(' · ')
}
