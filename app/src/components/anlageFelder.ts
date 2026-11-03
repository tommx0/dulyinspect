// Formularfelder einer Anlage, die von ihrer Art abhängen (Hersteller-Beschriftung, besondere Felder in anlage.eigenschaften).
import { ARTEN, artDefinition, type Eigenschaften } from '../lib/anlagenarten'
import { schreibweiseAngleichen } from '../lib/elemente'
import { etagenRang } from '../lib/sortierung'
import { t } from '../lib/sprache'
import type { FeldDef } from './Formular'

const PRAEFIX = 'eig.'

/** Eine Anlage des Objekts, soweit ihre Werte zur Auswahl in den Feldern der anderen dienen. */
export interface AnlageWerte {
  art: string | null | undefined
  gebaeude?: string | null
  etage?: string | null
  hersteller?: string | null
  modell?: string | null
  eigenschaften?: unknown
}

/** Verschiedene Werte, je Schreibweise einmal, sortiert (Zahlen der Reihe nach). */
export function verschiedene(werte: unknown[], vergleich?: (a: string, b: string) => number): string[] {
  const liste: string[] = []
  for (const w of werte) {
    if (typeof w !== 'string' || !w.trim()) continue
    const s = schreibweiseAngleichen(w, liste)!
    if (!liste.includes(s)) liste.push(s)
  }
  return liste.sort((a, b) => vergleich?.(a, b) || a.localeCompare(b, 'de', { numeric: true }))
}

/** Gebäude und Etage zur Auswahl aus den Anlagen des Objekts (alle Arten). */
export function lageFelder(anlagen: AnlageWerte[]): FeldDef[] {
  return [
    { name: 'gebaeude', label: t('Gebäude'), vorschlaege: verschiedene(anlagen.map((a) => a.gebaeude)), vorschlaegeNeu: t('+ Neues Gebäude …') },
    { name: 'etage', label: t('Etage'), vorschlaege: verschiedene(anlagen.map((a) => a.etage), (a, b) => etagenRang(a) - etagenRang(b)),
      vorschlaegeNeu: t('+ Neue Etage …') },
  ]
}

/**
 * Hersteller, Modell und die besonderen Felder der Art. Mit `anlagen` (die übrigen Anlagen des Objekts) bieten Hersteller,
 * Modell und die Felder mit `vorhanden` die Werte der Anlagen derselben Art zur Auswahl; Modelle des gewählten Herstellers
 * (`werte.hersteller`), solange es welche gibt.
 */
export function artFelder(art: string | null | undefined, ohneHersteller = false, anlagen: AnlageWerte[] = [], werte: Record<string, unknown> = {}): FeldDef[] {
  const d = artDefinition(art)
  const gleiche = anlagen.filter((a) => a.art === art)
  const hersteller = typeof werte.hersteller === 'string' ? werte.hersteller.trim().toLowerCase() : ''
  const vomHersteller = hersteller ? gleiche.filter((a) => a.hersteller?.trim().toLowerCase() === hersteller) : gleiche
  return [
    ...(ohneHersteller ? [] : [
      { name: 'hersteller', label: d.hersteller, vorschlaege: verschiedene(gleiche.map((a) => a.hersteller)), vorschlaegeNeu: t('+ Neuer Hersteller …') },
      { name: 'modell', label: d.modell, vorschlaege: verschiedene(vomHersteller.map((a) => a.modell)), vorschlaegeNeu: t('+ Neues Modell …') },
    ]),
    ...d.felder.map((f): FeldDef => {
      const basis = { name: PRAEFIX + f.schluessel, label: f.einheit ? `${f.text} (${f.einheit})` : f.text, hinweis: f.hinweis, breit: f.breit }
      if (f.typ === 'text' && f.vorhanden) {
        return { ...basis, vorschlaege: verschiedene(gleiche.map((a) => ((a.eigenschaften ?? {}) as Eigenschaften)[f.schluessel])) }
      }
      if (f.typ === 'zahl') return { ...basis, typ: 'number' }
      if (f.typ === 'datum') return { ...basis, typ: 'date' }
      if (f.typ === 'ja_nein') return { ...basis, typ: 'select', optionen: [{ wert: 'ja', text: t('ja') }, { wert: 'nein', text: t('nein') }] }
      if (f.typ === 'auswahl') return { ...basis, typ: 'select', optionen: (f.optionen ?? []).map((o) => ({ wert: o, text: t(o) })) }
      return basis
    }),
  ]
}

/** Startwerte des Formulars aus anlage.eigenschaften. */
export function eigenschaftenWerte(eigenschaften: unknown): Record<string, unknown> {
  const e = (eigenschaften ?? {}) as Eigenschaften
  return Object.fromEntries(Object.entries(e).map(([k, v]) => [PRAEFIX + k, typeof v === 'boolean' ? (v ? 'ja' : 'nein') : v]))
}

/** Formularwerte aufteilen: eigenschaften für die Art, Rest für die Spalten der Anlage.
 *  Werte anderer Arten (nach Typwechsel) fallen weg; vorhandene unbekannte Schlüssel bleiben erhalten. */
export function eigenschaftenTrennen(art: string | null | undefined, werte: Record<string, unknown>, bisher?: unknown):
  { eigenschaften: Eigenschaften; rest: Record<string, unknown> } {
  const d = artDefinition(art)
  const bekannt = new Set(Object.values(ARTEN).flatMap((a) => a.felder.map((f) => f.schluessel)))
  const eigenschaften: Eigenschaften = Object.fromEntries(
    Object.entries((bisher ?? {}) as Eigenschaften).filter(([k]) => !bekannt.has(k)))
  for (const f of d.felder) {
    const w = werte[PRAEFIX + f.schluessel]
    if (w == null || w === '') continue
    eigenschaften[f.schluessel] = f.typ === 'ja_nein' ? w === 'ja' : f.typ === 'zahl' ? Number(w) : String(w)
  }
  const rest = Object.fromEntries(Object.entries(werte).filter(([k]) => !k.startsWith(PRAEFIX)))
  return { eigenschaften, rest }
}
