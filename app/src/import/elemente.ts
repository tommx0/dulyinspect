// Elementliste (z. B. Leuchtenliste aus der Software der Zentralbatterie) einlesen: Spalten erkennen, Zeilen prüfen.
import { monatsende, type ArtFeld, type Eigenschaften, type ElementDefinition } from '../lib/anlagenarten'
import { herstellercodeNormalisieren } from '../lib/herstellercode'
import { melderCodeLesen } from '../lib/melderCode'
import { t } from '../lib/sprache'
import type { Tabelle } from './tabelle'

export type ElementFeld = 'gruppe' | 'nummer' | 'elementart' | 'ort' | 'typ' | 'code'

const SYNONYME: Record<ElementFeld, string[]> = {
  gruppe: ['stromkreis', 'kreis', 'sk', 'endstromkreis', 'gruppe', 'meldergruppe', 'linie', 'mg', 'rauchabschnitt', 'abschnitt', 'wohnung', 'whg', 'nutzungseinheit', 'einheit'],
  nummer: ['nummer', 'nr', 'leuchte', 'leuchten nr', 'leuchtennummer', 'leuchten nummer', 'melder', 'melder nr', 'adresse', 'teilnehmer', 'komponente nr', 'komponenten nr'],
  elementart: ['art', 'leuchtenart', 'elementart', 'funktion', 'betriebsart', 'komponente', 'komponentenart'],
  ort: ['ort', 'installationsort', 'standort', 'einbauort', 'raum', 'lage', 'montageort', 'bezeichnung'],
  typ: ['typ', 'leuchtentyp', 'hersteller', 'modell', 'fabrikat', 'artikel'],
  // Inhalt des Aufklebers (QR-Code), nicht die Seriennummer als Text
  code: ['code', 'qr code', 'qrcode', 'herstellercode', 'melder code', 'meldercode', 'aufkleber'],
}

// Englische Überschriften (Vorlagen aus der englischen Oberfläche)
const ENGLISCH: Record<ElementFeld, string[]> = {
  gruppe: ['group', 'zone'], nummer: ['number', 'no'], elementart: ['kind', 'category'], ort: ['location'],
  typ: ['type', 'manufacturer', 'model'], code: [],
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim()

export type ElementSpalten = Partial<Record<ElementFeld, number>> & {
  /** Besondere Felder der Art (Schutzorgan, Schutzklasse …): Schlüssel → Spalte */
  eigenschaften?: Record<string, number>
}

/**
 * Spalten zuordnen: erst exakte Überschrift, dann „beginnt mit“. Eigene Überschriften der Art (`def.spalten`) gehen vor;
 * danach die besonderen Felder der Art über ihre Bezeichnung.
 */
export function elementSpalten(kopf: string[], def?: ElementDefinition): ElementSpalten {
  const k = kopf.map(norm)
  const z: ElementSpalten = {}
  const belegt = new Set<number>()
  const eigene = Object.values(def?.spalten ?? {}).flat().map(norm)
  // Bezeichnung der Gruppe und des Orts in der Sprache der Oberfläche (Überschriften der Vorlage)
  const vorlage: Partial<Record<ElementFeld, string[]>> = def ? { gruppe: [norm(def.gruppe)], ...(def.ort ? { ort: [norm(def.ort)] } : {}) } : {}
  const synonyme = (f: ElementFeld) => [...(def?.spalten?.[f] ?? []).map(norm),
    ...[...SYNONYME[f], ...(vorlage[f] ?? []), ...ENGLISCH[f]].filter((s) => !eigene.includes(s))]
  const setze = (f: ElementFeld, i: number) => { if (z[f] === undefined && i >= 0 && !belegt.has(i)) { z[f] = i; belegt.add(i) } }
  for (const f of Object.keys(SYNONYME) as ElementFeld[]) for (const s of synonyme(f)) setze(f, k.indexOf(s))
  for (const f of Object.keys(SYNONYME) as ElementFeld[]) for (const s of synonyme(f).filter((x) => x.length >= 4)) {
    setze(f, k.findIndex((h, j) => !belegt.has(j) && h.startsWith(s)))
  }
  const felder = def?.felder ?? []
  const namen = (f: ArtFeld) => [norm(f.text), norm(f.schluessel), ...(f.spalten ?? []).map(norm)]
  const eigenschaften: Record<string, number> = {}
  const nimm = (f: ArtFeld, i: number) => { if (eigenschaften[f.schluessel] === undefined && i >= 0 && !belegt.has(i)) { eigenschaften[f.schluessel] = i; belegt.add(i) } }
  for (const f of felder) nimm(f, k.findIndex((h, j) => !belegt.has(j) && namen(f).includes(h)))
  // „Länge“ für „Länge der Anschlussleitung“, „Stromkreis (Verbraucher)“ für „Stromkreis“
  for (const f of felder) nimm(f, k.findIndex((h, j) => !belegt.has(j) && h.length >= 4 && namen(f).some((n) => n.startsWith(h) || h.startsWith(n))))
  if (Object.keys(eigenschaften).length) z.eigenschaften = eigenschaften
  return z
}

/** Wert eines besonderen Felds aus der Tabelle; Unlesbares (z. B. Text in einem Zahlenfeld) → undefined. */
export function eigenschaftLesen(f: ArtFeld, text: string): Eigenschaften[string] | undefined {
  const t = text.trim()
  if (!t) return undefined
  const n = norm(t)
  switch (f.typ) {
    case 'zahl': { const z = Number(t.replace(/\s/g, '').replace(',', '.')); return Number.isFinite(z) ? z : undefined }
    case 'ja_nein': return ['ja', 'j', 'x', '1', 'true', 'yes'].includes(n) ? true : ['nein', 'n', '0', 'false', 'no'].includes(n) ? false : undefined
    case 'auswahl': {
      // „30“ → „30 mA“, „I“ → „SK I“, „Typ A“ → „Typ A“
      const o = f.optionen ?? []
      return o.find((x) => norm(x) === n) ?? o.find((x) => norm(x).startsWith(`${n} `) || norm(x).endsWith(` ${n}`))
    }
    case 'datum': {
      const m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
      return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : undefined
    }
    case 'monat': return monatsende(t) ?? undefined
    default: return t
  }
}

/** Elementart aus einem Text erkennen, z. B. „RZL“ → Rettungszeichenleuchte, „OM“ → Rauchmelder (Kürzel je Art im Code). */
export function elementartErkennen(text: string, def: ElementDefinition): string | null {
  const t = norm(text)
  if (!t) return null
  const woerter = t.split(' ')
  // Kurze Kürzel nur als ganzes Wort („sl“ nicht in „schlüssel“), längere auch als Wortanfang („rettungszeichen…“)
  const passt = (k: string) => woerter.some((w) => w === k || (k.length >= 4 && w.startsWith(k)))
  const namen = (a: ElementDefinition['arten'][number]) => [a.name, ...(a.nameDe ? [a.nameDe] : [])].map(norm)
  const treffer = def.arten.find((a) => namen(a).includes(t) || norm(a.schluessel) === t)
    ?? def.arten.find((a) => namen(a).some((n) => t.includes(n.slice(0, 8))))
    ?? def.arten.find((a) => (a.kuerzel ?? []).some(passt))
  return treffer?.schluessel ?? null
}

export type NeuesElement = { gruppe: string | null; nummer: string; elementart: string | null; ort: string | null; typ: string | null; code?: string | null; eigenschaften?: Eigenschaften }
export type ElementZeile = { zeile: number; status: 'neu' | 'vorhanden' | 'fehler'; grund?: string; element?: NeuesElement }

/** Zeilen prüfen: Nummer nötig, Doppelte (Gruppe + Nummer) in Datei und Anlage erkennen. */
export function elementZeilen(tabelle: Tabelle, spalten: ElementSpalten, def: ElementDefinition,
  vorhanden: { gruppe: string | null; nummer: string; code?: string | null }[]): ElementZeile[] {
  const schluessel = (g: string | null, n: string) => `${(g ?? '').trim().toLowerCase()}|${n.trim().toLowerCase()}`
  const bekannt = new Set(vorhanden.map((v) => schluessel(v.gruppe, v.nummer)))
  const inDatei = new Map<string, number>()
  const codeInDatei = new Map<string, number>()
  const codeVergeben = new Map(vorhanden.filter((v) => v.code).map((v) => [v.code!.toLowerCase(), v.nummer]))
  const wert = (z: string[], f: ElementFeld) => (spalten[f] === undefined ? '' : (z[spalten[f]!] ?? '').trim())
  return tabelle.slice(1).map((z, i): ElementZeile => {
    const nr = i + 2
    let nummer = wert(z, 'nummer')
    if (!z.some((x) => x.trim())) return { zeile: nr, status: 'fehler', grund: t('leere Zeile') }
    if (!nummer) return { zeile: nr, status: 'fehler', grund: t('Nummer fehlt') }
    let gruppe = wert(z, 'gruppe') || null
    // Melder „12/3“ ohne eigene Spalte für die Meldergruppe → Gruppe 12, Melder 3
    const teile = def.nummerMitGruppe && !gruppe ? nummer.match(/^(\d+)\s*\/\s*(\d+)$/) : null
    if (teile) { gruppe = teile[1]; nummer = teile[2] }
    const k = schluessel(gruppe, nummer)
    if (bekannt.has(k)) return { zeile: nr, status: 'vorhanden', grund: t('{element} {nummer} gibt es schon', { element: def.einzahl, nummer }) }
    if (inDatei.has(k)) return { zeile: nr, status: 'fehler', grund: t('doppelt in der Datei (wie Zeile {zeile})', { zeile: inDatei.get(k) }) }
    // Code des Aufklebers (nur bei Arten mit Codes): eigene Melder-Etiketten in einheitlicher Schreibweise, sonst unverändert
    const codeText = def.codes ? wert(z, 'code') : ''
    const code = codeText ? (melderCodeLesen(codeText) ?? (herstellercodeNormalisieren(codeText) || null)) : null
    if (code) {
      const ck = code.toLowerCase()
      if (codeVergeben.has(ck)) return { zeile: nr, status: 'fehler', grund: t('Code gehört schon zu {element} {nummer} dieser Anlage', { element: def.einzahl, nummer: codeVergeben.get(ck) }) }
      if (codeInDatei.has(ck)) return { zeile: nr, status: 'fehler', grund: t('Code doppelt in der Datei (wie Zeile {zeile})', { zeile: codeInDatei.get(ck) }) }
      codeInDatei.set(ck, nr)
    }
    inDatei.set(k, nr)
    // Art aus der Spalte „Art“, sonst aus „Typ“ (z. B. „OM“), sonst die erste Art
    const artText = wert(z, 'elementart')
    const elementart = artText ? elementartErkennen(artText, def) : elementartErkennen(wert(z, 'typ'), def) ?? def.arten[0]?.schluessel ?? null
    const eigenschaften = Object.fromEntries(def.felder.flatMap((f) => {
      const i = spalten.eigenschaften?.[f.schluessel]
      const w = i === undefined ? undefined : eigenschaftLesen(f, z[i] ?? '')
      return w === undefined ? [] : [[f.schluessel, w]]
    }))
    return {
      zeile: nr, status: 'neu',
      element: { gruppe, nummer, elementart,
        ort: wert(z, 'ort') || null, typ: wert(z, 'typ') || null, ...(def.codes ? { code } : {}),
        ...(Object.keys(eigenschaften).length ? { eigenschaften } : {}) },
    }
  })
}
