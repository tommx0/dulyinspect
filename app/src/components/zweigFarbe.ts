import { zweigeVon, type Punkt } from '../lib/checkliste'

const AUSWAHL = ['#0284c7', '#7c3aed', '#0d9488', '#db2777', '#65a30d', '#ca8a04']
export const GUT = '#16a34a'
export const SCHLECHT = '#ea580c'
export const NEUTRAL = '#64748b'

/** Farbe eines Zweigs: grün für Ja/i.O./im Soll, orange für Nein/n.i.O./außerhalb Soll, bei Auswahl je Option, grau für Sonderfälle. */
export function zweigFarbe(eltern: Punkt, schluessel: string | null): string {
  if (schluessel === null) return NEUTRAL
  if (eltern.typ === 'auswahl') {
    const i = zweigeVon(eltern).findIndex((z) => z.schluessel === schluessel)
    return AUSWAHL[Math.max(i, 0) % AUSWAHL.length]
  }
  return ({ ja: GUT, nein: SCHLECHT, io: GUT, nio: SCHLECHT, kein_mangel: GUT, mangel: SCHLECHT } as Record<string, string>)[schluessel] ?? NEUTRAL
}
