// Türliste eines Objekts importieren: Spalten zuordnen, Türtypen erkennen, Zeilen prüfen (ohne UI, testbar).
import { etikettTippfehler, normalisiereEtikett } from '../lib/etikett'
import type { Tabelle } from './tabelle'
import { tb } from '../lib/begriffe'
import { t } from '../lib/sprache'

export type Feld =
  | 'anlagentyp' | 'etikett_id' | 'kunden_bezeichnung' | 'gebaeude' | 'etage' | 'raum' | 'lage_beschreibung'
  | 'hersteller' | 'modell' | 'antrieb_system' | 'baujahr' | 'letzte_pruefung_am' | 'intervall_monate'

/** Zielfelder in Anzeigereihenfolge; Synonyme für die automatische Spaltenzuordnung (klein, ohne Sonderzeichen). */
export const FELDER: { feld: Feld; titel: string; synonyme: string[] }[] = [
  { feld: 'anlagentyp', titel: tb('Türtyp'), synonyme: ['türtyp', 'anlagentyp', 'typ', 'türart', 'tür art', 'art', 'bauart'] },
  { feld: 'etikett_id', titel: t('Etikett-ID'), synonyme: ['etikett', 'etikett id', 'etikettid', 'etikettnummer', 'qr', 'qr code', 'label'] },
  { feld: 'kunden_bezeichnung', titel: t('Bezeichnung beim Kunden'), synonyme: ['bezeichnung beim kunden', 'bezeichnung', 'türnummer', 'tür nr', 'türnr', 'tür', 'nr', 'nummer', 'kennung', 'pos', 'position'] },
  { feld: 'gebaeude', titel: t('Gebäude'), synonyme: ['gebäude', 'gebaeude', 'haus', 'bauteil', 'block', 'trakt'] },
  { feld: 'etage', titel: t('Etage'), synonyme: ['etage', 'geschoss', 'stockwerk', 'ebene', 'stock'] },
  { feld: 'raum', titel: t('Raum'), synonyme: ['raum', 'raumnummer', 'raum nr', 'raumnr', 'zimmer'] },
  { feld: 'lage_beschreibung', titel: t('Lagebeschreibung'), synonyme: ['lagebeschreibung', 'lage', 'standort', 'beschreibung', 'ort', 'bemerkung'] },
  { feld: 'hersteller', titel: tb('Hersteller (Tür)'), synonyme: ['hersteller', 'fabrikat', 'marke'] },
  { feld: 'modell', titel: tb('Modell (Tür)'), synonyme: ['modell', 'typbezeichnung', 'serie'] },
  { feld: 'antrieb_system', titel: t('Antrieb / System'), synonyme: ['antrieb system', 'antrieb', 'system', 'steuerung', 'feststellanlage'] },
  { feld: 'baujahr', titel: t('Baujahr'), synonyme: ['baujahr', 'bj', 'einbaujahr'] },
  { feld: 'letzte_pruefung_am', titel: t('Letzte Prüfung am'), synonyme: ['letzte prüfung', 'letzte pruefung', 'letzte prüfung am', 'geprüft am', 'prüfdatum', 'letzte wartung'] },
  { feld: 'intervall_monate', titel: t('Prüfintervall (Monate)'), synonyme: ['prüfintervall', 'pruefintervall', 'prüfintervall monate', 'intervall', 'intervall monate'] },
]

export type Zuordnung = Partial<Record<Feld, number>>

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim()
}

/** Spalten automatisch zuordnen: erst exakte Treffer, dann „enthält“ (nur bei längeren Begriffen). */
export function spaltenErraten(kopf: string[]): Zuordnung {
  const k = kopf.map(norm)
  const z: Zuordnung = {}
  const belegt = new Set<number>()
  const setze = (feld: Feld, i: number) => { if (z[feld] === undefined && !belegt.has(i)) { z[feld] = i; belegt.add(i) } }
  // Überschrift der Vorlage (in der Sprache der Oberfläche)
  for (const f of FELDER) { const i = k.indexOf(norm(f.titel)); if (i >= 0) setze(f.feld, i) }
  for (const f of FELDER) for (const s of f.synonyme) { const i = k.indexOf(s); if (i >= 0) setze(f.feld, i) }
  for (const f of FELDER) {
    for (const s of f.synonyme.filter((x) => x.length >= 5)) {
      const i = k.findIndex((h, j) => !belegt.has(j) && h.includes(s))
      if (i >= 0) setze(f.feld, i)
    }
  }
  return z
}

export type Anlagentyp = { id: string; name: string }

/** Türtyp zu einem Wert aus der Datei raten (Name, Teilwörter, typische Begriffe). Nur eindeutige Treffer. */
export function typErraten(wert: string, typen: Anlagentyp[]): string | null {
  const w = norm(wert)
  if (!w) return null
  const exakt = typen.filter((t) => norm(t.name) === w || norm(t.name).startsWith(`${w} `))
  if (exakt.length === 1) return exakt[0].id
  const stichworte: [RegExp, RegExp][] = [
    [/schiebe/, /schiebe/],
    [/dreh/, /drehflügel/],
    [/feststell|rauchschutz|brandschutz|feuerschutz|\bt ?30\b|\bt ?90\b|\bfsa\b|\brs\b/, /feststell/],
    [/eltvtr|elektr|verriegel|fluchtwegsicherung/, /elektrisch/],
    [/panik|notausgang|179|1125/, /notausgang|panik/],
  ]
  for (const [wertMuster, typMuster] of stichworte) {
    if (!wertMuster.test(w)) continue
    const t = typen.filter((x) => typMuster.test(norm(x.name)))
    if (t.length === 1) return t[0].id
  }
  // Wortteile: mindestens ein längeres Wort des Werts steckt im Typnamen
  const woerter = w.split(' ').filter((x) => x.length >= 4)
  const treffer = typen.filter((t) => woerter.some((x) => norm(t.name).includes(x)))
  return treffer.length === 1 ? treffer[0].id : null
}

/** Datum aus „31.12.2025“, „31.12.25“, „2025-12-31“, „12/2025“, „12.2025“ oder Excel-Seriennummer. */
export function datumLesen(s: string): string | null {
  const t = s.trim()
  let j: number, m: number, d: number
  let r: RegExpMatchArray | null
  if ((r = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/))) [d, m, j] = [Number(r[1]), Number(r[2]), Number(r[3].length === 2 ? `20${r[3]}` : r[3])]
  else if ((r = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/))) [j, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])]
  else if ((r = t.match(/^(\d{1,2})[./](\d{4})$/))) [j, m, d] = [Number(r[2]), Number(r[1]), 1]
  else if (/^\d{5}(\.\d+)?$/.test(t)) {
    // Excel-Seriennummer (Tage seit 30.12.1899)
    const datum = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 864e5)
    return datum.toISOString().slice(0, 10)
  } else return null
  const datum = new Date(Date.UTC(j, m - 1, d))
  if (datum.getUTCFullYear() !== j || datum.getUTCMonth() !== m - 1 || datum.getUTCDate() !== d) return null
  return datum.toISOString().slice(0, 10)
}

export type NeueAnlage = {
  anlagentyp_id: string; etikett_id: string | null; kunden_bezeichnung: string | null; gebaeude: string | null; etage: string | null
  raum: string | null; lage_beschreibung: string | null; hersteller: string | null; modell: string | null; antrieb_system: string | null
  baujahr: number | null; letzte_pruefung_am: string | null; intervall_monate: number | null
}

export type ZeilenErgebnis = {
  zeile: number // Zeilennummer in der Datei (1 = Kopfzeile)
  status: 'neu' | 'vorhanden' | 'fehler'
  gruende: string[]
  anlage: NeueAnlage | null
  /** Rohwerte für die Vorschau */
  werte: Partial<Record<Feld, string>>
}

export type PruefDaten = {
  tabelle: Tabelle // inkl. Kopfzeile
  zuordnung: Zuordnung
  typZuordnung: Record<string, string | null> // Wert der Türtyp-Spalte → Türtyp-ID
  standardTyp: string | null // gilt, wenn keine Türtyp-Spalte zugeordnet oder Zelle leer
  vorhandene: { etikett_id: string | null; kunden_bezeichnung: string | null }[] // Türen des Objekts
  etiketten: Map<string, { frei: boolean }> // Etiketten aus der Datei, die es im System gibt
  heute: string
}

export function zeilenPruefen(d: PruefDaten): ZeilenErgebnis[] {
  const vorhEtikett = new Set(d.vorhandene.map((t) => t.etikett_id).filter(Boolean))
  const vorhBez = new Set(d.vorhandene.map((t) => t.kunden_bezeichnung?.trim().toLowerCase()).filter(Boolean))
  const inDatei = new Map<string, number>()
  const jahr = Number(d.heute.slice(0, 4))

  return d.tabelle.slice(1).map((zeile, i) => {
    const nr = i + 2
    const werte: Partial<Record<Feld, string>> = {}
    for (const f of FELDER) {
      const s = d.zuordnung[f.feld]
      if (s !== undefined) werte[f.feld] = (zeile[s] ?? '').trim()
    }
    const text = (f: Feld) => werte[f] || null
    const gruende: string[] = []

    const typWert = werte.anlagentyp ?? ''
    const anlagentyp = typWert ? d.typZuordnung[typWert] ?? null : d.standardTyp
    if (!anlagentyp) gruende.push(typWert ? tb('Türtyp „{wert}“ nicht zugeordnet', { wert: typWert }) : tb('Türtyp fehlt'))

    const etikett = werte.etikett_id ? normalisiereEtikett(werte.etikett_id) : null
    const bez = text('kunden_bezeichnung')
    if (!etikett && !bez && !text('raum') && !text('lage_beschreibung')) gruende.push(t('Weder Bezeichnung, Etikett noch Lage angegeben'))

    let baujahr: number | null = null
    if (werte.baujahr) {
      const b = werte.baujahr.match(/^\d{4}$/) ? Number(werte.baujahr) : NaN
      if (!(b >= 1900 && b <= jahr + 1)) gruende.push(t('Baujahr „{wert}“ ungültig', { wert: werte.baujahr }))
      else baujahr = b
    }
    let letzte: string | null = null
    if (werte.letzte_pruefung_am) {
      letzte = datumLesen(werte.letzte_pruefung_am)
      if (!letzte) gruende.push(t('Datum „{wert}“ nicht lesbar', { wert: werte.letzte_pruefung_am }))
      else if (letzte > d.heute) { gruende.push(t('Letzte Prüfung {datum} liegt in der Zukunft', { datum: letzte.split('-').reverse().join('.') })); letzte = null }
    }
    let intervall: number | null = null
    if (werte.intervall_monate) {
      const n = Number(werte.intervall_monate.replace(',', '.'))
      if (!(Number.isInteger(n) && n >= 1 && n <= 120)) gruende.push(t('Prüfintervall „{wert}“ ungültig (1–120 Monate)', { wert: werte.intervall_monate }))
      else intervall = n
    }

    // Schon im Objekt vorhanden → überspringen
    const schonDa = (etikett && vorhEtikett.has(etikett)) || (bez && vorhBez.has(bez.toLowerCase()))
    if (schonDa) {
      return { zeile: nr, status: 'vorhanden', gruende: [etikett && vorhEtikett.has(etikett) ? t('Etikett {etikett} ist schon im Objekt', { etikett }) : t('„{bezeichnung}“ ist schon im Objekt', { bezeichnung: bez })], anlage: null, werte }
    }

    if (etikett) {
      const e = d.etiketten.get(etikett)
      if (!e) gruende.push(etikettTippfehler(etikett) ? t('Etikett {etikett}: Prüfziffer passt nicht (Tippfehler?)', { etikett }) : t('Etikett {etikett} gibt es nicht', { etikett }))
      else if (!e.frei) gruende.push(tb('Etikett {etikett} gehört schon zu einer anderen Tür', { etikett }))
    }
    for (const [art, schluessel] of [['Etikett', etikett], ['Bezeichnung', bez?.toLowerCase()]] as const) {
      if (!schluessel) continue
      const k = `${art}:${schluessel}`
      if (inDatei.has(k)) gruende.push(art === 'Etikett' ? t('Etikett doppelt in der Datei (wie Zeile {zeile})', { zeile: inDatei.get(k) })
        : t('Bezeichnung doppelt in der Datei (wie Zeile {zeile})', { zeile: inDatei.get(k) }))
      else inDatei.set(k, nr)
    }

    if (gruende.length) return { zeile: nr, status: 'fehler', gruende, anlage: null, werte }
    return {
      zeile: nr, status: 'neu', gruende: [], werte,
      anlage: {
        anlagentyp_id: anlagentyp!, etikett_id: etikett, kunden_bezeichnung: bez, gebaeude: text('gebaeude'), etage: text('etage'), raum: text('raum'),
        lage_beschreibung: text('lage_beschreibung'), hersteller: text('hersteller'), modell: text('modell'), antrieb_system: text('antrieb_system'),
        baujahr, letzte_pruefung_am: letzte, intervall_monate: intervall,
      },
    }
  })
}

/** Vorlage zum Ausfüllen (Kopfzeile + Beispiel). */
export const VORLAGE: string[][] = [
  FELDER.map((f) => f.titel),
  ['Automatische Schiebetür', '', 'T 0.01', t('Haupthaus'), t('EG'), '0.12', t('Haupteingang'), 'Hörmann', '', 'dormakaba ES 200', '2015', '15.03.2025', ''],
]
