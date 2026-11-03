// Elemente einer Anlage (Leuchten, Melder …): Anzeige, Sortierung und Vorschlag für Teilprüfungen.
import type { Eigenschaften, ElementDefinition } from './anlagenarten'
import { elementFaellig } from './bestand'
import { t } from './sprache'

export type ElementStatus = 'io' | 'defekt' | 'nicht_zugaenglich'
export const ELEMENT_STATUS: Record<ElementStatus, string> = { io: t('i.O.'), defekt: t('defekt'), nicht_zugaenglich: t('nicht zugänglich') }

export interface ElementKurz {
  id: string
  gruppe: string | null
  nummer: string
  aktiv: boolean
  zuletzt_geprueft_am: string | null
  /** Bestand: Tag der letzten Prüfung je Prüfart (src/lib/bestand.ts) */
  geprueft_je_pruefart?: unknown
}

export interface ElementPruefart {
  elemente: string // 'keine' | 'alle' | 'anteil'
  elemente_anteil: number | null
  elemente_zyklus_monate: number
}

const zahlenfolge = (a: string, b: string) => a.localeCompare(b, 'de', { numeric: true })

/** Nach Gruppe, dann Nummer (Zahlen als Zahlen: 2 vor 10). */
export function elementVergleich(a: Pick<ElementKurz, 'gruppe' | 'nummer'>, b: Pick<ElementKurz, 'gruppe' | 'nummer'>): number {
  return zahlenfolge(a.gruppe ?? '', b.gruppe ?? '') || zahlenfolge(a.nummer, b.nummer)
}

/**
 * Fortlaufende Nummern ab einer Startnummer, z. B. für mehrere Melder auf einmal.
 * Führende Nullen und ein Präfix bleiben erhalten: „01“ → 01, 02 … 10; „L8“ → L8, L9, L10. Keine Zahl am Ende → null.
 */
export function nummernReihe(start: string, anzahl: number): string[] | null {
  const m = start.trim().match(/^(.*?)(\d+)$/)
  if (!m || !Number.isInteger(anzahl) || anzahl < 1) return null
  const [, praefix, zahl] = m
  return Array.from({ length: anzahl }, (_, i) => praefix + String(Number(zahl) + i).padStart(zahl.length, '0'))
}

/**
 * Vorschlag für die Nummer des nächsten Elements in einer Gruppe: höchste Zahl am Ende der Nummern + 1
 * („3“ → „4“, „L9“ → „L10“, „07“ → „08“); ohne Vorgänger „1“.
 */
export function naechsteNummer(elemente: Pick<ElementKurz, 'gruppe' | 'nummer' | 'aktiv'>[], gruppe: string | null): string {
  let hoechste: { zahl: number; text: string } | null = null
  for (const e of elemente) {
    if (!e.aktiv || (e.gruppe ?? null) !== (gruppe ?? null)) continue
    const m = e.nummer.trim().match(/^(.*?)(\d+)$/)
    if (m && (!hoechste || Number(m[2]) > hoechste.zahl)) hoechste = { zahl: Number(m[2]), text: e.nummer.trim() }
  }
  return hoechste ? nummernReihe(hoechste.text, 2)![1] : '1'
}

/**
 * Kleinste Nummer einer Gruppe, die kein aktives Element trägt (Lücken zuerst: 1, 2, 4 → „3“).
 * Präfix und führende Nullen kommen von der höchsten Nummer („L1“, „L2“ → „L3“; „01“, „03“ → „02“); ohne Vorgänger „1“.
 */
export function ersteFreieNummer(elemente: Pick<ElementKurz, 'gruppe' | 'nummer' | 'aktiv'>[], gruppe: string | null): string {
  const nummern = elemente.filter((e) => e.aktiv && (e.gruppe ?? null) === (gruppe ?? null))
    .map((e) => e.nummer.trim().match(/^(.*?)(\d+)$/)).filter((m) => m !== null)
  if (!nummern.length) return '1'
  const [, praefix, ziffern] = nummern.reduce((h, m) => (Number(m[2]) > Number(h[2]) ? m : h))
  const belegt = new Set(nummern.filter((m) => m[1].toLowerCase() === praefix.toLowerCase()).map((m) => Number(m[2])))
  let i = 1
  while (belegt.has(i)) i++
  return praefix + String(i).padStart(ziffern.length, '0')
}

/**
 * Die nächsten `anzahl` freien Nummern einer Gruppe ab der Startnummer, z. B. für mehrere Melder auf einmal: Nummern aktiver
 * Elemente werden übersprungen (Start 15, 16 belegt, Anzahl 2 → 15, 17). Präfix und führende Nullen wie bei nummernReihe.
 * Keine Zahl am Ende → null.
 */
export function freieNummern(elemente: Pick<ElementKurz, 'gruppe' | 'nummer' | 'aktiv'>[], gruppe: string | null, start: string, anzahl: number): string[] | null {
  const m = start.trim().match(/^(.*?)(\d+)$/)
  if (!m || !Number.isInteger(anzahl) || anzahl < 1) return null
  const [, praefix, zahl] = m
  const belegt = new Set(elemente.filter((e) => e.aktiv && (e.gruppe ?? null) === (gruppe ?? null))
    .map((e) => e.nummer.trim().match(/^(.*?)(\d+)$/))
    .filter((n) => n !== null && n[1].toLowerCase() === praefix.toLowerCase()).map((n) => Number(n![2])))
  const nummern: string[] = []
  for (let i = Number(zahl); nummern.length < anzahl; i++) {
    if (!belegt.has(i)) nummern.push(praefix + String(i).padStart(zahl.length, '0'))
  }
  return nummern
}

/** Nummern kurz, zusammenhängende als Bereich: „15, 17 bis 20“. */
export function nummernText(nummern: string[]): string {
  const teile: string[][] = []
  let vorher: number | null = null
  for (const n of nummern) {
    const zahl = Number(n.match(/(\d+)$/)?.[1] ?? NaN)
    if (vorher !== null && zahl === vorher + 1) teile[teile.length - 1].push(n)
    else teile.push([n])
    vorher = zahl
  }
  return teile.map((x) => (x.length > 2 ? t('{von} bis {bis}', { von: x[0], bis: x[x.length - 1] }) : x.join(', '))).join(', ')
}

const typSchluessel = (t: string) => t.trim().replace(/\s+/g, ' ').toLowerCase()

/** Typen / Hersteller, die in den Elementen schon vorkommen (auch stillgelegte), je Schreibweise einmal, sortiert. */
export function typenVorhanden(elemente: { typ: string | null }[]): string[] {
  const typen = new Map<string, string>()
  for (const e of elemente) {
    const t = e.typ?.trim().replace(/\s+/g, ' ')
    if (t && !typen.has(typSchluessel(t))) typen.set(typSchluessel(t), t)
  }
  return [...typen.values()].sort(zahlenfolge)
}

/** Neu eingegebener Name (Typ, Gruppe): gibt es ihn in anderer Schreibweise schon („ei 650“ ↔ „Ei 650“), gilt die vorhandene. */
export function schreibweiseAngleichen(typ: string | null, vorhandene: string[]): string | null {
  const t = typ?.trim().replace(/\s+/g, ' ')
  if (!t) return null
  return vorhandene.find((v) => typSchluessel(v) === typSchluessel(t)) ?? t
}

/** Gruppe mit ihrer Lage (anlage_gruppe): Gebäude und Etage gelten für die Elemente darin. */
export interface GruppeLage { name: string; gebaeude?: string | null; etage?: string | null }

/** Gebäude eines Elements über seine Gruppe; '' = ohne Gebäude (keine Gruppe, Gruppe ohne Gebäude). */
export function gebaeudeVon(gruppe: string | null, gruppen: GruppeLage[]): string {
  return (gruppe && gruppen.find((g) => g.name === gruppe)?.gebaeude?.trim()) || ''
}

/** „Haus A, EG“ der Gruppe, leer ohne Lage. */
export function lageText(g: Pick<GruppeLage, 'gebaeude' | 'etage'> | undefined): string {
  return [g?.gebaeude, g?.etage].map((x) => x?.trim()).filter(Boolean).join(', ')
}

/** Gebäude, die die Gruppen der Elemente nennen, sortiert (Zahlen der Reihe nach); '' (ohne Gebäude) zuletzt, falls vorhanden. */
export function gebaeudeListe(elemente: { gruppe: string | null }[], gruppen: GruppeLage[]): string[] {
  const alle = new Set(elemente.map((e) => gebaeudeVon(e.gruppe, gruppen)))
  const mit = [...alle].filter(Boolean).sort(zahlenfolge)
  return alle.has('') ? [...mit, ''] : mit
}

/** Gruppen zur Auswahl: die angelegten und die, die Elemente verwenden (auch vor Ort neu erfasste), sortiert (WE 2 vor WE 10). */
export function gruppenListe(gruppen: string[], elemente: { gruppe: string | null }[] = []): string[] {
  return [...new Set([...gruppen, ...elemente.map((e) => e.gruppe).filter((g): g is string => !!g)])].sort(zahlenfolge)
}

/** Werte, die beim Anlegen mehrerer Elemente für alle gelten. Gruppe, Nummer, Code und je Element verschiedene Felder gehören nicht dazu. */
export interface ElementVorgabe {
  elementart: string | null
  ort: string | null
  typ: string | null
  eigenschaften: Eigenschaften
}

/** Gruppe (z. B. Wohnung) des zuletzt erfassten aktiven Elements: beim Erfassen vieler Melder meist die richtige. */
export function letzteGruppe(elemente: (Pick<ElementKurz, 'gruppe' | 'aktiv'> & { erstellt_am: string })[]): string | null {
  const neueste = elemente.filter((e) => e.aktiv).sort((a, b) => b.erstellt_am.localeCompare(a.erstellt_am))[0]
  return neueste?.gruppe ?? null
}

/** Bezeichnung eines Elements: die der Art, wenn die Liste Verschiedenes enthält („Stromkreis“, „Verbraucher“), sonst „Leuchte“ usw. */
export function elementEinzahl(e: { elementart?: string | null }, d: ElementDefinition): string {
  return d.arten.find((a) => a.schluessel === e.elementart)?.einzahl ?? d.einzahl
}

/** „Leuchte 07 · Stromkreis 4“ */
export function elementName(e: Pick<ElementKurz, 'gruppe' | 'nummer'> & { elementart?: string | null }, d: ElementDefinition): string {
  return `${elementEinzahl(e, d)} ${e.nummer}${e.gruppe ? ` · ${d.gruppe} ${e.gruppe}` : ''}`
}

function monateZurueck(heute: string, monate: number): string {
  const [j, m, t] = heute.split('-').map(Number)
  const d = new Date(Date.UTC(j, m - 1 - monate, t))
  return d.toISOString().slice(0, 10)
}

export interface Vorschlag {
  /** Elemente, die bei diesem Termin geprüft werden sollen */
  ids: Set<string>
  /** aktive Elemente insgesamt */
  gesamt: number
  /** länger als der Zyklus (z. B. 12 Monate) nicht geprüft oder nie */
  ueberfaellig: number
  ueberfaelligIds: Set<string>
}

/** Bestand je Objekt (Rauchwarnmelder, Geräte): Fälligkeit je Element in der Prüfart der laufenden Prüfung */
export interface BestandPruefung { pruefartId: string; monate: number; begonnenAm: string }

/**
 * Welche Elemente heute prüfen?
 * „alle“: jedes aktive Element, bei einem Bestand nur die fälligen (nicht zugängliche bleiben fällig, docs/KONZEPT-BESTAND-JE-OBJEKT.md).
 * „anteil“: der Anteil je Termin, die am längsten nicht geprüften zuerst; sind mehr Elemente überfällig, werden alle
 * überfälligen vorgeschlagen.
 */
export function elementeVorschlag(elemente: ElementKurz[], pa: ElementPruefart, heute: string, bestand?: BestandPruefung): Vorschlag {
  const aktiv = elemente.filter((e) => e.aktiv)
  const grenze = monateZurueck(heute, pa.elemente_zyklus_monate)
  const ueberfaellig = aktiv.filter((e) => !e.zuletzt_geprueft_am || e.zuletzt_geprueft_am < grenze)
  const basis = { gesamt: aktiv.length, ueberfaellig: ueberfaellig.length, ueberfaelligIds: new Set(ueberfaellig.map((e) => e.id)) }
  if (pa.elemente === 'keine') return { ...basis, ids: new Set() }
  if (pa.elemente === 'alle' && bestand) {
    return { ...basis, ids: new Set(aktiv.filter((e) => elementFaellig(e, bestand.pruefartId, bestand.monate, bestand.begonnenAm)).map((e) => e.id)) }
  }
  if (pa.elemente === 'alle') return { ...basis, ids: new Set(aktiv.map((e) => e.id)) }
  const anzahl = Math.max(Math.ceil((aktiv.length * (pa.elemente_anteil ?? 100)) / 100), ueberfaellig.length)
  const reihe = [...aktiv].sort((a, b) =>
    (a.zuletzt_geprueft_am ?? '').localeCompare(b.zuletzt_geprueft_am ?? '') || elementVergleich(a, b))
  return { ...basis, ids: new Set(reihe.slice(0, anzahl).map((e) => e.id)) }
}

/** Wie viele der vorgeschlagenen Elemente haben noch kein Ergebnis? */
export function elementeOffen(vorschlag: Vorschlag, ergebnisse: { element_id: string }[]): number {
  const erledigt = new Set(ergebnisse.map((e) => e.element_id))
  return [...vorschlag.ids].filter((id) => !erledigt.has(id)).length
}

/** Mangel einer Anlage, soweit für die Nachprüfung von Elementen nötig */
export interface ElementMangel { id: string; element_id: string | null; entdeckt_in: string; status: string; nachgeprueft_in: string | null }

/**
 * Mängel an Elementen aus früheren Prüfungen, die in dieser Prüfung nachzuprüfen sind (offen oder als behoben gemeldet,
 * oder hier schon als behoben bestätigt) – je Element.
 */
export function altmaengelJeElement<M extends ElementMangel>(maengel: M[], pruefungId: string): Map<string, M> {
  const je = new Map<string, M>()
  for (const m of maengel) {
    if (!m.element_id || m.entdeckt_in === pruefungId) continue
    if (m.status === 'offen' || m.status === 'behoben' || m.nachgeprueft_in === pruefungId) je.set(m.element_id, m)
  }
  return je
}

/** Elemente mit einem offenen Mangel gehören immer zum Vorschlag: sie müssen nachgeprüft werden. */
export function mitNachpruefung(vorschlag: Vorschlag, elemente: Pick<ElementKurz, 'id' | 'aktiv'>[], nachpruefen: Map<string, unknown>): Vorschlag {
  const dazu = elemente.filter((e) => e.aktiv && nachpruefen.has(e.id) && !vorschlag.ids.has(e.id))
  return dazu.length ? { ...vorschlag, ids: new Set([...vorschlag.ids, ...dazu.map((e) => e.id)]) } : vorschlag
}
