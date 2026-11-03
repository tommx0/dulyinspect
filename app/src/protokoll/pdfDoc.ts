// Aufbau der PDF-Protokolle (Spezifikation Abschnitt 5) als reine Funktionen → testbar ohne Browser.
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces'
import { istSichtbar, nachAbschnitt, wirksam, type Punkt } from '../lib/checkliste'
import { bedingungsWerte } from '../lib/pruefung'
import { etikettAnzeige } from '../lib/etikett'
import { codeAnzeige } from '../lib/melderCode'
import { gebietsschema, sprache, tIn, type Sprache } from '../lib/sprache'
import type { Ampel, ProtokollDaten, ProtokollMangel, ProtokollPerson, ProtokollAnlage, ProtokollElemente, ProtokollMesswert } from './typen'

// Die eingebettete Schrift (Roboto) hat u. a. keine Pfeile, ≤/≥ und Emojis → ersetzen bzw. entfernen
const ERSATZ: [RegExp, string][] = [[/→/g, '->'], [/←/g, '<-'], [/≤/g, '<='], [/≥/g, '>='], [/[✓✔]/g, 'ok'], [/[✗✘]/g, 'x']]
export function pdfSicher(text: string): string {
  let t = text
  for (const [a, b] of ERSATZ) t = t.replace(a, b)
  // Emojis und sonstige Symbole außerhalb der Schrift entfernen (Buchstaben, Ziffern, Satzzeichen, €, °, ², ³ bleiben)
  return t.replace(/(?:[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]|\u{FE0F}|\u{200D})/gu, '')
}
function bereinigt<T>(x: T): T {
  if (typeof x === 'string') return (x.startsWith('data:') ? x : pdfSicher(x)) as T
  if (Array.isArray(x)) return x.map(bereinigt) as T
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, bereinigt(v)])) as T
  return x
}

/**
 * Sprache der Protokolle: Einstellung der Instanz (firma.protokoll_sprache), nicht die Sprache der Oberfläche. Fehlt sie (ältere
 * Daten, Gerätespeicher), gilt Deutsch. Die Bausteine unten lesen sie aus `sp`; jede exportierte Protokollfunktion setzt sie zuerst.
 */
export function protokollSprache(firma: { protokoll_sprache?: string | null } | null | undefined): Sprache {
  return firma?.protokoll_sprache === 'en' ? 'en' : 'de'
}
let sp: Sprache = 'de'
/**
 * Fest definierte Begriffe der Anlagenarten (src/lib/anlagenarten.ts, deutsche Fassung ARTEN_DE aus daten.ts) in der Sprache des
 * Protokolls; Inhalte aus der Datenbank (Typen, Prüfarten, Checklisten, Mängel) bleiben, wie sie gespeichert sind.
 */
const begriffIn = (text: string) => tIn(sp, text)

const FARBE: Record<Ampel, string> = { gruen: '#15803d', gelb: '#b45309', rot: '#b91c1c' }
export const AMPEL_TEXT: Record<Ampel, string> = {
  gruen: 'ohne Mängel',
  gelb: 'mit Mängeln, betriebsbereit',
  rot: 'nicht betriebssicher',
}
const ampelText = (a: Ampel) =>
  a === 'gruen' ? tIn(sp, 'ohne Mängel') : a === 'gelb' ? tIn(sp, 'mit Mängeln, betriebsbereit') : tIn(sp, 'nicht betriebssicher')
// Mangelstufen wie STUFEN in src/lib/checkliste.ts (dort in der Sprache der Oberfläche)
const stufeText = (stufe: number) =>
  stufe === 1 ? tIn(sp, 'geringfügig') : stufe === 2 ? tIn(sp, 'erheblich') : stufe === 3 ? tIn(sp, 'gefährlich') : ''
/** Zahl im Format der Protokollsprache (Deutsch mit Komma), wie zahlText in src/lib/messwerte.ts */
const zahl = (n: number) => n.toLocaleString(gebietsschema(sp), { maximumFractionDigits: 3 })
const GRAU = '#64748b'
const LINIE = '#cbd5e1'

export const datumDe = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString(gebietsschema(sp)) : '–')
const zeitDe = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString(gebietsschema(sp), { dateStyle: 'medium', timeStyle: 'short' }) : '–'
const adresse = (x: { strasse: string | null; plz: string | null; ort: string | null }) =>
  [x.strasse, [x.plz, x.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')
export const anlageName = (t: ProtokollAnlage) =>
  [t.anlage.etikett ?? (t.anlage.bestand ? null : tIn(sp, 'ohne Etikett')), t.anlage.bezeichnung].filter(Boolean).join(' · ')
const lage = (t: ProtokollAnlage) =>
  [[t.anlage.gebaeude, t.anlage.etage, t.anlage.raum].filter(Boolean).join(' / '), t.anlage.lage].filter(Boolean).join(' · ') || '–'

const tabelle = (koerper: TableCell[][], breiten: (string | number)[], kopf = true): Content => ({
  table: { headerRows: kopf ? 1 : 0, widths: breiten, body: koerper, dontBreakRows: true },
  layout: {
    hLineWidth: () => 0.5, vLineWidth: () => 0, hLineColor: () => LINIE,
    paddingTop: () => 3, paddingBottom: () => 3,
    fillColor: (zeile: number) => (kopf && zeile === 0 ? '#f1f5f9' : null),
  },
  fontSize: 8.5,
  margin: [0, 2, 0, 8],
})
const kopfZelle = (t: string): TableCell => ({ text: t, bold: true, color: '#334155' })
const ueberschrift = (t: string, oben = 10): Content => ({ text: t, fontSize: 11, bold: true, margin: [0, oben, 0, 4] })

function kopfbereich(d: ProtokollDaten, titel: string): Content[] {
  const f = d.firma
  return [
    {
      columns: [
        d.logo ? { image: d.logo, width: 150 } : { text: f.name, bold: true, fontSize: 14 },
        {
          stack: [
            { text: f.name, bold: true },
            adresse(f),
            [f.telefon && `${tIn(sp, 'Tel.')} ${f.telefon}`, f.email].filter(Boolean).join(' · '),
            f.web ?? '',
          ].filter(Boolean) as Content[],
          alignment: 'right', fontSize: 8, color: GRAU,
        },
      ],
      margin: [0, 0, 0, 8],
    },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 2, lineColor: '#fce400' }], margin: [0, 0, 0, 8] },
    { text: titel, fontSize: 16, bold: true },
    {
      text: `${tIn(sp, 'Protokoll-Nr.')} ${d.protokollNr}${d.revision > 0 ? ` · ${tIn(sp, 'Revision')} ${d.revision}` : ''}`,
      fontSize: 10, color: GRAU, margin: [0, 2, 0, 8],
    },
  ]
}

function personZeile(p: ProtokollPerson) {
  return p.sachkunde ? `${p.name} (${p.sachkunde})` : p.name
}

function unterschriftBlock(titel: string, name: string | null, bild: string | null, ort: string): Content {
  return {
    stack: [
      bild ? { image: bild, width: 150, height: 55, fit: [150, 55] } : { text: ' ', margin: [0, 25, 0, 25] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.5, lineColor: GRAU }] },
      { text: `${titel}${name ? `: ${name}` : ''}`, fontSize: 8, color: GRAU, margin: [0, 2, 0, 0] },
      { text: ort, fontSize: 8, color: GRAU },
    ],
    unbreakable: true,
  }
}

/** Ergebnis eines Prüfpunkts als Text (auch für das Protokollblatt der laufenden Prüfung). */
export function antwortText(p: Punkt, a: ProtokollAnlage['antworten'][string] | undefined, s: Sprache = sprache()): { text: string; mangel: boolean } {
  if (!a) return { text: '–', mangel: false }
  if (a.status === 'entfaellt') return { text: tIn(s, 'entfällt'), mangel: false }
  switch (p.typ) {
    case 'status':
      return { text: a.status === 'io' ? tIn(s, 'i.O.') : a.status === 'nio' ? tIn(s, 'n.i.O.') : '–', mangel: a.status === 'nio' }
    case 'messwert': {
      if (a.zahl == null) return { text: '–', mangel: false }
      const aus = (p.soll_min != null && a.zahl < p.soll_min) || (p.soll_max != null && a.zahl > p.soll_max)
      const soll = p.soll_min != null || p.soll_max != null ? ` ${tIn(s, '(Soll {min} bis {max})', { min: p.soll_min ?? '–', max: p.soll_max ?? '–' })}` : ''
      return { text: `${s === 'de' ? String(a.zahl).replace('.', ',') : String(a.zahl)} ${p.einheit ?? ''}${soll}`, mangel: aus }
    }
    case 'ja_nein':
      return { text: a.text === 'ja' ? tIn(s, 'Ja') : a.text === 'nein' ? tIn(s, 'Nein') : '–', mangel: !!p.gut && !!a.text && a.text !== p.gut }
    case 'auswahl':
      return { text: a.text ?? '–', mangel: !!p.optionen?.find((o) => o.wert === a.text)?.mangel }
    case 'text':
      return { text: a.text?.trim() || '–', mangel: false }
    case 'foto':
      return { text: tIn(s, 'kein Foto'), mangel: false }
  }
}

/** Sichtbare Prüfpunkte je Abschnitt (ausgeblendete Bedingungspunkte entfallen), mit den Wirkungen, die in dieser Prüfung galten. */
function sichtbarePunkte(t: ProtokollAnlage): [string, Punkt[]][] {
  if (!t.checkliste) return []
  const werte = bedingungsWerte(t.antworten)
  const alle = t.checkliste.punkte
  return nachAbschnitt(alle.filter((p) => istSichtbar(p, werte, alle)).map((p) => wirksam(p, werte, alle)))
}

/** Foto der Fotoanlage mit fortlaufender Nummer und Bezug (Prüfpunkt bzw. Mangel). */
interface FotoEintrag { nr: number; bild: string; bezug: string }

/**
 * Fotoanlage eines Einzelprotokolls bzw. Türabschnitts: alle Fotos fortlaufend nummeriert – erst die der Prüfpunkte in ihrer
 * Reihenfolge, dann die der neuen Mängel (nach Stufe) und der Mängel aus früheren Prüfungen –, jedes mit Verweis auf seinen
 * Prüfpunkt. Prüfpunkte, Mängel und Mängelliste verweisen über die Nummern darauf.
 */
export function fotoverzeichnis(t: ProtokollAnlage) {
  const punktNr = new Map<string, number>()
  const punktText = new Map<string, string>()
  let n = 0
  for (const [, ps] of sichtbarePunkte(t)) for (const p of ps) { punktNr.set(p.id, ++n); punktText.set(p.id, p.text) }
  const fotos: FotoEintrag[] = []
  const nummern = (bilder: string[], bezug: string) => bilder.map((bild) => { fotos.push({ nr: fotos.length + 1, bild, bezug }); return fotos.length })
  const punktBezug = (id: string | null | undefined, text: string | null) => {
    const nr = id ? punktNr.get(id) : undefined
    return nr ? `${tIn(sp, 'Prüfpunkt')} ${nr}: ${punktText.get(id!)}` : text ? `${tIn(sp, 'Prüfpunkt')}: ${text}` : null
  }
  const jePunkt = new Map<string, number[]>()
  if (t.status === 'geprueft') {
    for (const [id] of punktNr) {
      const f = t.fotosJePunkt[id] ?? []
      if (f.length) jePunkt.set(id, nummern(f, punktBezug(id, null)!))
    }
  }
  const jeMangel = new Map<string, number[]>()
  const mangelBezug = (m: ProtokollMangel, frueher: boolean) => [punktBezug(m.punktId, m.punktText),
    frueher
      ? tIn(sp, 'Mangel aus früherer Prüfung ({datum}), Stufe {stufe}: {text}', { datum: datumDe(m.festgestelltAm), stufe: m.stufe, text: m.beschreibung || '–' })
      : `${tIn(sp, 'Mangel')} ${tIn(sp, 'Stufe')} ${m.stufe}: ${m.beschreibung || '–'}`].filter(Boolean).join(' · ')
  if (t.status === 'geprueft') {
    for (const m of neueMaengelSortiert(t)) if (m.fotos.length) jeMangel.set(m.id, nummern(m.fotos, mangelBezug(m, false)))
    for (const m of t.altMaengel) if (m.fotos.length) jeMangel.set(m.id, nummern(m.fotos, mangelBezug(m, true)))
  }
  return { fotos, punktNr, jePunkt, jeMangel, punktBezug }
}
type Fotoverzeichnis = ReturnType<typeof fotoverzeichnis>

const neueMaengelSortiert = (t: ProtokollAnlage) => [...t.neueMaengel].sort((a, b) => b.stufe - a.stufe)
/** „Foto 3“ bzw. „Fotos 3, 4“ */
export const fotoText = (nummern: number[]) =>
  `${nummern.length === 1 ? tIn(sp, 'Foto') : tIn(sp, 'Fotos')} ${nummern.join(', ')}`

/** Fotoanlage: je Zeile zwei Fotos mit Nummer und Bezug; eine Zeile bleibt zusammen. */
function fotoanlage(fotos: FotoEintrag[]): Content[] {
  if (fotos.length === 0) return []
  const bild = (f: FotoEintrag): Content => ({ stack: [
    { image: f.bild, fit: [245, 180] as [number, number] },
    { text: [{ text: `${tIn(sp, 'Foto')} ${f.nr}`, bold: true }, ` – ${f.bezug}`], fontSize: 8, color: '#334155', margin: [0, 2, 0, 0] },
  ] })
  const zeilen = paare(fotos).map(([a, b]): Content => ({ columns: [bild(a), b ? bild(b) : { text: '' }], columnGap: 15, margin: [0, 2, 0, 8], unbreakable: true }))
  // Überschrift nicht allein am Seitenende: zusammen mit der ersten Fotozeile
  return [
    { stack: [ueberschrift(tIn(sp, 'Fotoanlage')), { text: tIn(sp, 'Fotos dieser Prüfung mit Verweis auf den Prüfpunkt bzw. Mangel.'), fontSize: 8, color: GRAU, margin: [0, 0, 0, 4] }, zeilen[0]],
      unbreakable: true },
    ...zeilen.slice(1),
  ]
}

function mangelBlock(m: ProtokollMangel, v: Fotoverzeichnis, zusatz?: string): Content {
  const bezug = v.punktBezug(m.punktId, m.punktText)
  const fotos = v.jeMangel.get(m.id)
  return {
    stack: [
      {
        text: [
          { text: `${tIn(sp, 'Stufe')} ${m.stufe} – ${stufeText(m.stufe)}`, bold: true, color: m.stufe >= 3 ? FARBE.rot : FARBE.gelb },
          zusatz ? { text: `  ${zusatz}`, color: GRAU } : '',
        ],
      },
      { text: m.beschreibung || '–' },
      bezug || fotos ? { text: [bezug, fotos && `${tIn(sp, 'siehe')} ${fotoText(fotos)} (${tIn(sp, 'Fotoanlage')})`].filter(Boolean).join(' · '), fontSize: 8, color: GRAU } : '',
    ],
    margin: [0, 2, 0, 6], fontSize: 9, unbreakable: true,
  }
}

const ELEMENT_ERGEBNIS = { io: 'i.O.', defekt: 'defekt', nicht_zugaenglich: 'nicht zugänglich' } as const
const elementErgebnis = (s: keyof typeof ELEMENT_ERGEBNIS) =>
  s === 'io' ? tIn(sp, 'i.O.') : s === 'defekt' ? tIn(sp, 'defekt') : tIn(sp, 'nicht zugänglich')

/** Code des Melders: QR-Code links, die Nummer (Code) rechts; ohne Code ein Strich. */
function codeZelle(z: ProtokollElemente['zeilen'][number]): TableCell {
  if (!z.code) return { text: '–', fontSize: 7.5 }
  const text: Content = { text: codeAnzeige(z.code), fontSize: 7, margin: [3, 12, 0, 0] }
  return z.codeQr ? { columns: [{ image: z.codeQr, width: 38 }, text], columnGap: 0 } : { text: codeAnzeige(z.code), fontSize: 7 }
}

function elementeInhalt(e: ProtokollElemente): Content[] {
  const anzahl = (s: keyof typeof ELEMENT_ERGEBNIS) => e.zeilen.filter((z) => z.status === s).length
  const mehrzahl = begriffIn(e.mehrzahl)
  const inhalt: Content[] = [
    ueberschrift(mehrzahl),
    { text: tIn(sp, '{n} {name} geprüft: {io} i.O., {defekt} defekt, {nz} nicht zugänglich', {
      n: e.zeilen.length, name: e.zeilen.length === 1 ? begriffIn(e.einzahl) : mehrzahl, io: anzahl('io'), defekt: anzahl('defekt'), nz: anzahl('nicht_zugaenglich') })
      + (e.teilpruefung ? ` ${tIn(sp, '(Teilprüfung: {n} von {gesamt})', { n: e.zeilen.length, gesamt: e.gesamt })}` : '') + '.', fontSize: 9 },
  ]
  if (e.teilpruefung || e.zeilen.length < e.gesamt) {
    inhalt.push({ text: tIn(sp, 'Stand aller {name}: {n} von {gesamt} in den letzten {monate} Monaten geprüft.', { name: mehrzahl, n: e.imZyklus, gesamt: e.gesamt, monate: e.zyklusMonate }), fontSize: 9,
      bold: e.imZyklus < e.gesamt, color: e.imZyklus < e.gesamt ? FARBE.gelb : undefined })
  }
  if (e.zeilen.length) {
    // Spalte „Code“ (Aufkleber des Melders) nur, wenn die Art Codes kennt
    const mitCode = e.zeilen.some((z) => z.code !== undefined)
    inhalt.push(tabelle([
      [kopfZelle(begriffIn(e.gruppe)), kopfZelle(tIn(sp, 'Nr.')), kopfZelle(tIn(sp, 'Art')), kopfZelle(begriffIn(e.ort)), ...(mitCode ? [kopfZelle(tIn(sp, 'Code'))] : []), kopfZelle(tIn(sp, 'Ergebnis'))],
      ...e.zeilen.map((z): TableCell[] => [
        z.gruppe ?? '–', z.nummer, z.art ? begriffIn(z.art) : '–', z.ort ?? '–',
        ...(mitCode ? [codeZelle(z)] : []),
        { stack: [
          { text: z.status === 'defekt' && z.grund ? `${tIn(sp, 'defekt')}: ${z.grund}` : elementErgebnis(z.status), bold: z.status === 'defekt', color: z.status === 'defekt' ? FARBE.rot : undefined },
          z.bemerkung ? { text: z.bemerkung, fontSize: 7.5, color: GRAU } : '',
        ] },
      ]),
    ], mitCode ? [36, 22, 80, '*', 128, 75] : [55, 40, 95, '*', 120]))
  }
  if (e.messungen?.length && e.zeilen.some((z) => z.messwerte)) inhalt.push(...messwerteInhalt(e))
  return inhalt
}

/** Messwerte je Element (Elektroprüfungen): Wert, darunter der Grenzwert; außerhalb rot, „/“ = Messung entfällt, „–“ = nicht gemessen. */
function messwerteInhalt(e: ProtokollElemente): Content[] {
  const spalten = e.messungen!
  const zelle = (w: ProtokollMesswert | null): TableCell => {
    if (!w) return { text: '/', color: GRAU, alignment: 'center' }
    return { stack: [
      { text: w.wert == null ? '–' : zahl(w.wert), bold: w.ausserhalb, color: w.ausserhalb ? FARBE.rot : undefined },
      w.grenze ? { text: w.grenze, fontSize: 6.5, color: GRAU } : '',
    ], alignment: 'center' }
  }
  const zeilen = e.zeilen.filter((z) => z.messwerte)
  // Überschrift nicht allein am Seitenende; kurze Tabellen ganz auf einer Seite
  return [{ unbreakable: zeilen.length <= 15, stack: [
    { text: tIn(sp, 'Messwerte'), bold: true, fontSize: 9, margin: [0, 6, 0, 2] },
    tabelle([
      [kopfZelle(begriffIn(e.gruppe)), kopfZelle(tIn(sp, 'Nr.')), ...spalten.map((m): TableCell => ({ text: `${m.kurz} [${m.einheit}]`, bold: true, color: '#334155', alignment: 'center' }))],
      ...zeilen.map((z): TableCell[] => [z.gruppe ?? '–', z.nummer, ...spalten.map((m) => zelle(z.messwerte![m.schluessel] ?? null))]),
    ], [55, 40, ...spalten.map(() => '*')]),
    { text: tIn(sp, 'Unter dem Messwert der Grenzwert; „/“ Messung entfällt für dieses Element, „–“ nicht gemessen.'), fontSize: 7, color: GRAU, margin: [0, 2, 0, 0] },
  ] }]
}

function paare<T>(liste: T[]): [T, T | undefined][] {
  const r: [T, T | undefined][] = []
  for (let i = 0; i < liste.length; i += 2) r.push([liste[i], liste[i + 1]])
  return r
}

/** Inhalt eines Einzelprotokolls (für die Einzel-PDF und als Anhang im Sammelprotokoll). */
export function einzelInhalt(d: ProtokollDaten, t: ProtokollAnlage, mitUnterschrift = true): Content[] {
  const anlagenTabelle = tabelle([
      [kopfZelle(begriffIn(t.anlage.art)), anlageName(t), kopfZelle(t.anlage.art === 'Tür' ? tIn(sp, 'Türtyp') : tIn(sp, 'Typ')), t.anlage.typ],
      // Bestand (Rauchwarnmelder, Geräte): keine Lage, kein Hersteller – die Angaben stehen je Element
      ...(t.anlage.bestand ? [[kopfZelle(tIn(sp, 'Objekt')), { text: `${d.objekt.name}, ${adresse(d.objekt)}`, colSpan: 3 }, '', '']] : [
      [kopfZelle(tIn(sp, 'Lage')), lage(t), kopfZelle(tIn(sp, 'Objekt')), `${d.objekt.name}, ${adresse(d.objekt)}`],
      [kopfZelle(tIn(sp, 'Hersteller / Modell')), [t.anlage.hersteller, t.anlage.modell, t.anlage.baujahr && `${tIn(sp, 'Bj.')} ${t.anlage.baujahr}`].filter(Boolean).join(' · ') || '–',
        ...(t.anlage.anlagendaten[0] ? [kopfZelle(begriffIn(t.anlage.anlagendaten[0].text)), t.anlage.anlagendaten[0].wert || '–'] : ['', ''])]] as TableCell[][]),
      // Weitere Anlagendaten paarweise (nur ausgefüllte)
      ...paare(t.anlage.anlagendaten.slice(1).filter((x) => x.wert)).map(([a, b]): TableCell[] =>
        [kopfZelle(begriffIn(a.text)), a.wert, b ? kopfZelle(begriffIn(b.text)) : '', b ? b.wert : '']),
      t.status === 'nicht_geprueft'
        ? [kopfZelle(tIn(sp, 'Vermerkt von')), personZeile(t.pruefer), kopfZelle(tIn(sp, 'Vermerkt am')), zeitDe(t.beendetAm)]
        // Tür einer Türanlage: wer an ihr erfasst hat (die Teilprüfung trägt den Hauptprüfer)
        : [kopfZelle(tIn(sp, 'Prüfer')), (t.geprueftVon?.length ? t.geprueftVon : [t.pruefer]).map(personZeile).join('; '), kopfZelle(tIn(sp, 'Geprüft am')), zeitDe(t.beendetAm)],
      [kopfZelle(tIn(sp, 'Prüfgrundlage')), [t.anlage.pruefart, t.checkliste ? `${t.checkliste.name}, ${tIn(sp, 'Version')} ${t.checkliste.version}` : '–'].filter(Boolean).join(': '),
        kopfZelle(tIn(sp, 'Nächste Prüfung')), datumDe(t.anlage.naechstePruefung)],
    ], [80, '*', 80, '*'], false)
  // QR-Code und Nummer des Etiketts der Anlage rechts neben den Anlagendaten (Papier scannen → Anlage in der App öffnen)
  const inhalt: Content[] = [t.anlage.etikettQr && t.anlage.etikett
    ? { columns: [{ width: '*', stack: [anlagenTabelle] },
      { width: 64, stack: [{ image: t.anlage.etikettQr, width: 52, alignment: 'center' }, { text: etikettAnzeige(t.anlage.etikett), fontSize: 7.5, bold: true, alignment: 'center' }], margin: [6, 2, 0, 0] }] }
    : anlagenTabelle]
  if (t.schliesstEin) {
    inhalt.push({ text: tIn(sp, 'Diese Prüfung schließt die Prüfart „{name}“ ein.', { name: t.schliesstEin }), fontSize: 8, color: GRAU, margin: [0, 2, 0, 4] })
  }
  if (t.mitpruefer?.length) {
    inhalt.push({ text: tIn(sp, 'Gemeinsam geprüft mit: {namen}.', { namen: t.mitpruefer.map((m) => m.sachkunde ? `${m.name} (${m.sachkunde})` : m.name).join(', ') }),
      fontSize: 8, color: GRAU, margin: [0, 2, 0, 4] })
  }
  if (t.urspruenglicherPruefer) {
    inhalt.push({ text: tIn(sp, 'In der Revision von {neu} übernommen und korrigiert; ursprünglich geprüft von {alt}.', { neu: t.pruefer.name, alt: t.urspruenglicherPruefer.name }),
      fontSize: 8, color: GRAU, margin: [0, 2, 0, 4] })
  }

  if (t.status === 'nicht_geprueft') {
    inhalt.push({ text: `${tIn(sp, 'Nicht geprüft')}: ${t.nichtGeprueftGrund ?? ''}`, bold: true, color: FARBE.gelb, margin: [0, 6, 0, 6] })
    return inhalt
  }

  // Ergebnis
  if (t.ergebnis) {
    inhalt.push({
      table: { widths: ['*'], body: [[{
        text: [{ text: `${tIn(sp, 'Ergebnis')}: `, bold: true }, { text: ampelText(t.ergebnis), bold: true, color: FARBE[t.ergebnis] }],
        fillColor: '#f8fafc', margin: [6, 4, 6, 4],
      }]] },
      layout: { hLineWidth: () => 1, vLineWidth: () => 1, hLineColor: () => FARBE[t.ergebnis!], vLineColor: () => FARBE[t.ergebnis!] },
      margin: [0, 2, 0, 4],
    })
    if (t.ergebnis !== t.ergebnisAuto && t.ergebnisBegruendung) {
      inhalt.push({ text: tIn(sp, 'Ergebnis vom Prüfer verschärft (automatisch: {auto}). Begründung: {grund}', { auto: ampelText(t.ergebnisAuto ?? 'gruen'), grund: t.ergebnisBegruendung }), fontSize: 8, color: GRAU, margin: [0, 0, 0, 4] })
    }
  }

  // Prüfpunkte (nur die sichtbaren); Fotos stehen nummeriert in der Fotoanlage, Prüfpunkt und Mangel verweisen darauf
  const v = fotoverzeichnis(t)
  // Fotos der neuen Mängel je Prüfpunkt (Verweis in der Zeile des Prüfpunkts)
  const mangelFotos = new Map<string, number[]>()
  for (const m of t.neueMaengel) {
    const f = v.jeMangel.get(m.id)
    if (f && m.punktId) mangelFotos.set(m.punktId, [...(mangelFotos.get(m.punktId) ?? []), ...f].sort((a, b) => a - b))
  }
  for (const [abschnitt, ps] of sichtbarePunkte(t)) {
    inhalt.push(ueberschrift(abschnitt, 6))
    const zeilen: TableCell[][] = [[kopfZelle(tIn(sp, 'Nr.')), kopfZelle(tIn(sp, 'Prüfpunkt')), kopfZelle(tIn(sp, 'Ergebnis'))]]
    for (const p of ps) {
      const a = t.antworten[p.id]
      const e = antwortText(p, a, sp)
      const fotos = v.jePunkt.get(p.id)
      const zuMangel = mangelFotos.get(p.id)
      zeilen.push([
        String(v.punktNr.get(p.id)),
        { stack: [p.text, ...(a?.bemerkung ? [{ text: a.bemerkung, fontSize: 7.5, color: GRAU }] : []),
          ...(zuMangel ? [{ text: `${tIn(sp, 'Mangel')}: ${tIn(sp, 'siehe')} ${fotoText(zuMangel)}`, fontSize: 7.5, color: GRAU }] : [])] },
        p.typ === 'foto' && fotos && a?.status !== 'entfaellt'
          ? { text: `${tIn(sp, 'siehe')} ${fotoText(fotos)}` }
          : { text: e.text, bold: e.mangel, color: e.mangel ? FARBE.rot : undefined },
      ])
    }
    inhalt.push(tabelle(zeilen, [20, '*', 130]))
  }

  // Elemente (z. B. Leuchten) mit Ergebnis dieser Prüfung
  if (t.elemente) inhalt.push(...elementeInhalt(t.elemente))

  // Mängel
  inhalt.push(ueberschrift(tIn(sp, 'Festgestellte Mängel')))
  if (t.neueMaengel.length === 0) inhalt.push({ text: tIn(sp, 'Keine neuen Mängel.'), fontSize: 9 })
  for (const m of neueMaengelSortiert(t)) inhalt.push(mangelBlock(m, v))

  if (t.altMaengel.length > 0) {
    inhalt.push(ueberschrift(tIn(sp, 'Mängel aus früheren Prüfungen')))
    for (const m of t.altMaengel) {
      const datum = datumDe(m.festgestelltAm)
      inhalt.push(mangelBlock(m, v, m.behoben ? tIn(sp, '· festgestellt {datum} · bei dieser Prüfung als behoben bestätigt', { datum })
        : tIn(sp, '· festgestellt {datum} · besteht weiterhin', { datum })))
    }
  }

  inhalt.push(...fotoanlage(v.fotos))

  if (mitUnterschrift) inhalt.push({ columns: [unterschriftBlock(tIn(sp, 'Prüfer'), t.pruefer.name, t.pruefer.unterschrift, zeitDe(t.beendetAm)), ''], margin: [0, 14, 0, 0] })
  return inhalt
}

/**
 * Tür einer Türanlage: die Prüfer, die an dieser Tür erfasst haben, mit ihrer Unterschrift unter der Türanlage (je zwei
 * nebeneinander). Wer beim Abschluss nicht mehr Prüfer war (entfernt, in einer Revision ersetzt), steht ohne Unterschrift da.
 */
function geprueftVonInhalt(t: ProtokollAnlage): Content {
  const bloecke = (t.geprueftVon ?? []).map((p) => unterschriftBlock(tIn(sp, 'Geprüft von'), p.name, p.unterschrift,
    p.unterschrift ? zeitDe(p.unterschriebenAm) : tIn(sp, 'ohne Unterschrift (beim Abschluss nicht mehr Prüfer)')))
  return {
    stack: paare(bloecke).map(([a, b]): Content => ({ columns: [a, b ?? { text: '' }], columnGap: 30, margin: [0, 0, 0, 12] })),
    unbreakable: true, margin: [0, 14, 0, 0],
  }
}

/** Türabschnitt hat Unterschriften seiner Prüfer: nur, wenn sie noch vorliegen (sonst stehen sie nur im Protokoll der Türanlage) */
const mitTuerUnterschrift = (d: ProtokollDaten, t: ProtokollAnlage) =>
  t.status === 'geprueft' && !!t.geprueftVon?.length && !!d.tueranlage?.pruefer.unterschrift

function fusszeile(d: ProtokollDaten) {
  return (seite: number, seiten: number): Content => ({
    columns: [
      { text: `${d.firma.name} · ${tIn(sp, 'Protokoll')} ${d.protokollNr}${d.revision ? ` ${tIn(sp, 'Rev.')} ${d.revision}` : ''}`, fontSize: 7, color: GRAU },
      { text: tIn(sp, 'Seite {seite} von {seiten}', { seite, seiten }), alignment: 'right', fontSize: 7, color: GRAU },
    ],
    margin: [40, 10, 40, 0],
  })
}

const basis = (d: ProtokollDaten, titel: string, inhalt: Content[]): TDocumentDefinitions => ({
  pageSize: 'A4',
  pageMargins: [40, 40, 40, 50],
  info: { title: titel, author: d.firma.name, subject: `${tIn(sp, 'Prüfprotokoll')} ${d.protokollNr}`, creator: 'DulyInspect' },
  language: sp,
  defaultStyle: { fontSize: 9.5, lineHeight: 1.15 },
  footer: fusszeile(d),
  content: inhalt,
})

/** Einzelprotokoll einer Tür bzw. Anlage (für die Türakte). */
export function einzelprotokoll(roh: ProtokollDaten, rohT: ProtokollAnlage): TDocumentDefinitions {
  const d = vorbereiten(roh)
  const t = d.anlagen.find((x) => x.pruefungId === rohT.pruefungId) ?? bereinigt(rohT)
  return basis(d, `${tIn(sp, 'Prüfprotokoll')} ${anlageName(t)}`, [
    ...kopfbereich(d, anlagenTitel(t)),
    { text: `${d.kunde.name} · ${d.objekt.name}`, margin: [0, 0, 0, 6] },
    ...einzelInhalt(d, t),
    d.firma.protokoll_hinweis ? { text: d.firma.protokoll_hinweis, fontSize: 7.5, color: GRAU, margin: [0, 14, 0, 0] } : '',
  ])
}

/** Revisionen mit Grund (Tabelle) – im Sammelprotokoll und im Protokoll je Prüfung. */
function revisionenInhalt(d: ProtokollDaten): Content[] {
  return [ueberschrift(tIn(sp, 'Revisionen')), tabelle([[kopfZelle(tIn(sp, 'Rev.')), kopfZelle(tIn(sp, 'Datum')), kopfZelle(tIn(sp, 'Von')), kopfZelle(tIn(sp, 'Grund'))],
    ...d.revisionen.map((r) => [String(r.revision), zeitDe(r.am), r.von, r.grund])], [25, 80, 90, '*'])]
}

/**
 * Protokoll einer Prüfung (eine Anlage, eigene Nummer): Kunde, Objekt, Prüfung, bei einer Revision Grund und Änderungen,
 * dann die gültigen Unterschriften von Hauptprüfer, Mitprüfern und Kunde.
 */
export function pruefprotokoll(roh: ProtokollDaten): TDocumentDefinitions {
  const d = vorbereiten(roh)
  const t = d.anlagen[0]
  const inhalt: Content[] = [
    ...kopfbereich(d, anlagenTitel(t)),
    // Das Objekt steht in den Anlagendaten
    tabelle([[kopfZelle(tIn(sp, 'Kunde')), [d.kunde.name, adresse(d.kunde)].filter(Boolean).join(', ')]], [80, '*'], false),
    ...einzelInhalt(d, t, false),
  ]
  inhalt.push(...revisionAenderungenInhalt(d))
  if (d.firma.protokoll_hinweis) inhalt.push({ text: d.firma.protokoll_hinweis, fontSize: 7.5, color: GRAU, margin: [0, 10, 0, 0] })
  inhalt.push(unterschriftenInhalt(d, t.pruefer, t.mitpruefer ?? [], t.beteiligt ?? []))
  return basis(d, `${tIn(sp, 'Prüfprotokoll')} ${d.protokollNr} ${anlageName(t)}`, inhalt)
}

/** Bei einer Revision: Revisionen mit Grund und die Änderungen der aktuellen Revision. */
function revisionAenderungenInhalt(d: ProtokollDaten): Content[] {
  if (d.revision === 0) return []
  const aenderungen = d.aenderungen ?? []
  // Überschriften nicht allein am Seitenende; kurze Listen ganz auf einer Seite
  return [
    { stack: revisionenInhalt(d), unbreakable: d.revisionen.length <= 10 },
    { unbreakable: aenderungen.length <= 15, stack: [
      ueberschrift(`${tIn(sp, 'Änderungen in Revision')} ${d.revision}`),
      aenderungen.length
        ? tabelle([[kopfZelle(tIn(sp, 'Zeit')), kopfZelle(tIn(sp, 'Von')), kopfZelle(tIn(sp, 'Änderung'))], ...aenderungen.map((a) => [zeitDe(a.am), a.von, a.text])], [80, 90, '*'])
        : { text: tIn(sp, 'Keine Änderungen an Prüfpunkten, Elementen, Mängeln oder Fotos.'), fontSize: 9 },
    ] },
  ]
}

/** Unterschriften: Hauptprüfer, Mitprüfer, Kunde – je zwei nebeneinander, zusammen auf einer Seite. */
function unterschriftenInhalt(d: ProtokollDaten, pruefer: ProtokollPerson, mitpruefer: ProtokollPerson[], beteiligt: ProtokollPerson[]): Content {
  const bloecke: Content[] = [
    unterschriftBlock(tIn(sp, 'Prüfer'), pruefer.name, pruefer.unterschrift, zeitDe(pruefer.unterschriebenAm ?? d.abgeschlossenAm)),
    ...mitpruefer.map((m) => unterschriftBlock(tIn(sp, 'Mitprüfer'), m.name, m.unterschrift, zeitDe(m.unterschriebenAm))),
    ...(d.unterschriftKunde ? [unterschriftBlock(tIn(sp, 'Kunde'), d.kundeName, d.unterschriftKunde, zeitDe(d.abgeschlossenAm))] : []),
  ]
  // Unterschriften zusammen auf einer Seite (nicht einzeln am Seitenende abgeschnitten)
  return {
    stack: [
      ...paare(bloecke).map(([a, b]): Content => ({ columns: [a, b ?? { text: '' }], columnGap: 30, margin: [0, 0, 0, 12] })),
      beteiligt.length ? { text: tIn(sp, 'Ebenfalls beteiligt, ohne Unterschrift: {namen}.', { namen: beteiligt.map(personZeile).join(', ') }), fontSize: 8, color: GRAU } : '',
    ],
    unbreakable: true, margin: [0, 18, 0, 0],
  }
}

/** Ergebnis als farbig umrandeter Kasten; bei verschärftem Ergebnis mit Begründung. */
function ergebnisKasten(titel: string, ergebnis: Ampel, auto: Ampel | null, begruendung: string | null): Content[] {
  return [
    {
      table: { widths: ['*'], body: [[{
        text: [{ text: `${titel}: `, bold: true }, { text: ampelText(ergebnis), bold: true, color: FARBE[ergebnis] }],
        fillColor: '#f8fafc', margin: [6, 4, 6, 4],
      }]] },
      layout: { hLineWidth: () => 1, vLineWidth: () => 1, hLineColor: () => FARBE[ergebnis], vLineColor: () => FARBE[ergebnis] },
      margin: [0, 2, 0, 4],
    },
    ergebnis !== auto && begruendung
      ? { text: tIn(sp, 'Ergebnis vom Prüfer verschärft (aus den Türen: {auto}). Begründung: {grund}', { auto: ampelText(auto ?? 'gruen'), grund: begruendung }), fontSize: 8, color: GRAU, margin: [0, 0, 0, 4] }
      : '',
  ]
}

/** Übersicht der Türen bzw. Anlagen, nicht geprüfte mit Grund und Mängelliste (Sammel- und Türanlagen-Protokoll). */
function uebersichtInhalt(d: ProtokollDaten): Content[] {
  const nicht = d.anlagen.filter((t) => t.status === 'nicht_geprueft')
  const alleMaengel = d.anlagen.flatMap((t) => [
    ...t.neueMaengel.map((m) => ({ t, m, alt: false })),
    ...t.altMaengel.filter((m) => !m.behoben).map((m) => ({ t, m, alt: true })),
  ]).sort((a, b) => b.m.stufe - a.m.stufe)
  const inhalt: Content[] = [ueberschrift(tIn(sp, 'Übersicht')), tabelle([
    [kopfZelle(begriffIn(d.begriffe.einzahl)), kopfZelle(tIn(sp, 'Lage')), kopfZelle(tIn(sp, 'Typ')), kopfZelle(tIn(sp, 'Ergebnis')), kopfZelle(tIn(sp, 'Mängel')), kopfZelle(tIn(sp, 'Nächste Prüfung'))],
    ...d.anlagen.map((t): TableCell[] => [
      anlageName(t), lage(t), [t.anlage.typ, t.anlage.pruefart].filter(Boolean).join(' – '),
      t.status === 'nicht_geprueft'
        ? { text: tIn(sp, 'nicht geprüft'), color: GRAU }
        : { text: t.ergebnis ? ampelText(t.ergebnis) : '–', color: t.ergebnis ? FARBE[t.ergebnis] : undefined, bold: true },
      String(t.neueMaengel.length + t.altMaengel.filter((m) => !m.behoben).length),
      t.status === 'nicht_geprueft' ? '–' : datumDe(t.anlage.naechstePruefung),
    ]),
  ], [85, '*', 95, 70, 35, 55])]
  if (nicht.length) {
    inhalt.push(ueberschrift(d.begriffe.mehrzahl === 'Türen' ? tIn(sp, 'Nicht geprüfte Türen') : tIn(sp, 'Nicht geprüfte Anlagen')))
    inhalt.push(tabelle([[kopfZelle(begriffIn(d.begriffe.einzahl)), kopfZelle(tIn(sp, 'Grund'))], ...nicht.map((t) => [anlageName(t), t.nichtGeprueftGrund ?? '–'])], [150, '*']))
  }
  inhalt.push(ueberschrift(tIn(sp, 'Mängelliste')))
  if (alleMaengel.length === 0) inhalt.push({ text: tIn(sp, 'Es wurden keine Mängel festgestellt.') })
  else {
    // Fotos stehen in der Fotoanlage des Tür- bzw. Einzelabschnitts
    const verzeichnis = new Map(d.anlagen.map((t) => [t.pruefungId, fotoverzeichnis(t)]))
    const wo = d.tueranlage ? tIn(sp, 'im Abschnitt der Tür') : tIn(sp, 'im Einzelprotokoll')
    inhalt.push(tabelle([
      [kopfZelle(tIn(sp, 'Stufe')), kopfZelle(begriffIn(d.begriffe.einzahl)), kopfZelle(tIn(sp, 'Mangel'))],
      ...alleMaengel.map(({ t, m, alt }): TableCell[] => {
        const fotos = verzeichnis.get(t.pruefungId)!.jeMangel.get(m.id)
        return [
          { text: `${m.stufe} – ${stufeText(m.stufe)}`, color: m.stufe >= 3 ? FARBE.rot : FARBE.gelb, bold: true },
          anlageName(t),
          { stack: [m.beschreibung || '–', alt ? { text: tIn(sp, 'aus früherer Prüfung ({datum}), weiterhin offen', { datum: datumDe(m.festgestelltAm) }), fontSize: 7.5, color: GRAU } : '',
            fotos ? { text: `${fotoText(fotos)} ${wo}`, fontSize: 7.5, color: GRAU } : ''] },
        ]
      }),
    ], [70, 120, '*']))
  }
  return inhalt
}

/** Name der Türanlage („Türanlage <Objekt>“, aus src/lib/tueranlage.ts): auf Englisch mit übersetztem Wort */
const tueranlageName = (d: ProtokollDaten) => {
  const name = d.tueranlage?.name ?? 'Türanlage'
  return sp === 'de' ? name : name.replace(/^Türanlage(?= |$)/, tIn(sp, 'Türanlage'))
}

/** Titel des Einzelprotokolls: „Prüfprotokoll Tür FT-00012“ */
const anlagenTitel = (t: ProtokollAnlage) =>
  `${tIn(sp, 'Prüfprotokoll')} ${begriffIn(t.anlage.protokollTitel)} ${t.anlage.etikett ?? ''}`.trim()

/** Sprache des Protokolls festlegen und Texte für die PDF-Schrift bereinigen */
function vorbereiten(roh: ProtokollDaten): ProtokollDaten {
  sp = protokollSprache(roh.firma)
  return bereinigt(roh)
}

/**
 * Protokoll einer Türanlage (docs/KONZEPT-TUERANLAGE.md): eine Nummer und eine Unterschrift für alle Türen. Kunde, Objekt,
 * Türanlage, Gesamtergebnis, Übersicht der Türen, Mängelliste, bei einer Revision Grund und Änderungen, Unterschriften –
 * danach je Tür ihr Prüfabschnitt mit voller Checkliste.
 */
export function tueranlagenprotokoll(roh: ProtokollDaten): TDocumentDefinitions {
  const d = vorbereiten(roh)
  const ta = d.tueranlage!
  const geprueft = d.anlagen.filter((t) => t.status === 'geprueft')
  const zaehle = (a: Ampel) => geprueft.filter((t) => t.ergebnis === a).length
  const prueferText = [personZeile(ta.pruefer), ...ta.mitpruefer.map(personZeile)].join('; ')
  const daten = tabelle([
    [kopfZelle(tIn(sp, 'Prüfer')), prueferText, kopfZelle(tIn(sp, 'Geprüft')), `${zeitDe(d.begonnenAm)} ${tIn(sp, 'bis')} ${zeitDe(d.abgeschlossenAm)}`],
    ...(ta.pruefart ? [[kopfZelle(tIn(sp, 'Prüfart')), ta.pruefart, '', ''] as TableCell[]] : []),
  ], [80, '*', 80, '*'], false)
  const inhalt: Content[] = [
    ...kopfbereich(d, `${tIn(sp, 'Prüfprotokoll')} ${tueranlageName(d)}`),
    tabelle([
      [kopfZelle(tIn(sp, 'Kunde')), [d.kunde.name, adresse(d.kunde)].filter(Boolean).join(', ')],
      [kopfZelle(tIn(sp, 'Objekt')), [d.objekt.name, adresse(d.objekt)].filter(Boolean).join(', ')],
    ], [80, '*'], false),
    daten,
    ...(ta.ergebnis ? ergebnisKasten(tIn(sp, 'Gesamtergebnis'), ta.ergebnis, ta.ergebnisAuto, ta.ergebnisBegruendung) : []),
    { text: tIn(sp, '{n} {name} · {geprueft} geprüft ({gruen} ohne Mängel, {gelb} mit Mängeln, {rot} nicht betriebssicher) · {nicht} nicht geprüft.', {
      n: d.anlagen.length, name: d.anlagen.length === 1 ? tIn(sp, 'Tür') : tIn(sp, 'Türen'), geprueft: geprueft.length,
      gruen: zaehle('gruen'), gelb: zaehle('gelb'), rot: zaehle('rot'), nicht: d.anlagen.length - geprueft.length })
      + ' ' + tIn(sp, 'Die Türen wurden gemeinsam geprüft; die Unterschriften gelten für alle aufgeführten Türen. Nicht fällige Türen, die nicht mitgeprüft wurden, sind nicht aufgeführt.'),
      fontSize: 9, margin: [0, 2, 0, 4] },
    ...uebersichtInhalt(d),
    ...revisionAenderungenInhalt(d),
  ]
  if (d.firma.protokoll_hinweis) inhalt.push({ text: d.firma.protokoll_hinweis, fontSize: 7.5, color: GRAU, margin: [0, 10, 0, 0] })
  inhalt.push(unterschriftenInhalt(d, ta.pruefer, ta.mitpruefer, ta.beteiligt))
  // Je Tür ihr Prüfabschnitt mit Fotoanlage und den Unterschriften der Prüfer, die an ihr erfasst haben
  d.anlagen.forEach((t, i) => {
    inhalt.push({ text: tIn(sp, 'Tür {nr} von {n}: {name}', { nr: i + 1, n: d.anlagen.length, name: anlageName(t) }), fontSize: 13, bold: true, pageBreak: 'before', margin: [0, 0, 0, 6] })
    inhalt.push(...einzelInhalt(d, t, false))
    if (mitTuerUnterschrift(d, t)) inhalt.push(geprueftVonInhalt(t))
  })
  return basis(d, `${tIn(sp, 'Prüfprotokoll')} ${d.protokollNr} ${tueranlageName(d)}`, inhalt)
}

/**
 * Protokoll einer Tür einer Türanlage (für die Türakte): ihr Prüfabschnitt ohne eigene Nummer, mit den Unterschriften der Prüfer,
 * die an ihr erfasst haben. Gesamtergebnis und Kundenunterschrift stehen im Protokoll der Türanlage.
 */
export function tuerprotokoll(roh: ProtokollDaten, rohT: ProtokollAnlage): TDocumentDefinitions {
  const d = vorbereiten(roh)
  const t = d.anlagen.find((x) => x.pruefungId === rohT.pruefungId) ?? bereinigt(rohT)
  return basis(d, `${tIn(sp, 'Prüfprotokoll')} ${anlageName(t)}`, [
    ...kopfbereich(d, anlagenTitel(t)),
    { text: `${d.kunde.name} · ${d.objekt.name}`, margin: [0, 0, 0, 2] },
    { text: `${d.revision
      ? tIn(sp, 'Teil des Prüfprotokolls Nr. {nr} (Revision {rev}) der {name}.', { nr: d.protokollNr, rev: d.revision, name: tueranlageName(d) })
      : tIn(sp, 'Teil des Prüfprotokolls Nr. {nr} der {name}.', { nr: d.protokollNr, name: tueranlageName(d) })} ${mitTuerUnterschrift(d, t)
      ? tIn(sp, 'Gesamtergebnis und Unterschrift des Kunden stehen im Prüfprotokoll der Türanlage.') : tIn(sp, 'Die Unterschriften stehen im Prüfprotokoll der Türanlage.')}`,
      fontSize: 8.5, color: GRAU, margin: [0, 0, 0, 6] },
    ...einzelInhalt(d, t, false),
    mitTuerUnterschrift(d, t) ? geprueftVonInhalt(t) : '',
    d.firma.protokoll_hinweis ? { text: d.firma.protokoll_hinweis, fontSize: 7.5, color: GRAU, margin: [0, 14, 0, 0] } : '',
  ])
}

/** Sammelprotokoll eines Termins mit Übersicht, Mängelliste, Unterschriften und Einzelprotokollen im Anhang. */
export function sammelprotokoll(roh: ProtokollDaten): TDocumentDefinitions {
  const d = vorbereiten(roh)
  const geprueft = d.anlagen.filter((t) => t.status === 'geprueft')
  const nicht = d.anlagen.filter((t) => t.status === 'nicht_geprueft')
  const zaehle = (a: Ampel) => geprueft.filter((t) => t.ergebnis === a).length
  const inhalt: Content[] = [
    ...kopfbereich(d, tIn(sp, 'Prüfprotokoll – Sammelprotokoll')),
    tabelle([
      [kopfZelle(tIn(sp, 'Kunde')), [d.kunde.name, adresse(d.kunde)].filter(Boolean).join(', ')],
      [kopfZelle(tIn(sp, 'Objekt')), [d.objekt.name, adresse(d.objekt)].filter(Boolean).join(', ')],
      [kopfZelle(tIn(sp, 'Prüfung')), `${zeitDe(d.begonnenAm)} ${tIn(sp, 'bis')} ${zeitDe(d.abgeschlossenAm)}`],
      [kopfZelle(tIn(sp, 'Sessionleitung')), personZeile(d.leiter)],
      [kopfZelle(tIn(sp, 'Prüfer')), d.teilnehmer.map(personZeile).join('; ')],
      [kopfZelle(tIn(sp, 'Umfang')), tIn(sp, '{n} {name} · {geprueft} geprüft ({gruen} ohne Mängel, {gelb} mit Mängeln, {rot} nicht betriebssicher) · {nicht} nicht geprüft', {
        n: d.anlagen.length, name: begriffIn(d.begriffe.mehrzahl), geprueft: geprueft.length, gruen: zaehle('gruen'), gelb: zaehle('gelb'), rot: zaehle('rot'), nicht: nicht.length })],
    ], [80, '*'], false),
  ]

  if (d.revision > 0) inhalt.push(...revisionenInhalt(d))

  inhalt.push(...uebersichtInhalt(d))

  if (d.bemerkung) {
    inhalt.push(ueberschrift(tIn(sp, 'Bemerkung')))
    inhalt.push({ text: d.bemerkung })
  }
  if (d.firma.protokoll_hinweis) inhalt.push({ text: d.firma.protokoll_hinweis, fontSize: 7.5, color: GRAU, margin: [0, 10, 0, 0] })

  inhalt.push({
    columns: [
      unterschriftBlock(tIn(sp, 'Sessionleitung'), d.leiter.name, d.unterschriftLeiter, zeitDe(d.abgeschlossenAm)),
      d.unterschriftKunde ? unterschriftBlock(tIn(sp, 'Kunde'), d.kundeName, d.unterschriftKunde, zeitDe(d.abgeschlossenAm)) : { text: '' },
    ],
    columnGap: 30, margin: [0, 18, 0, 0],
  })

  // Anhang: Einzelprotokolle
  d.anlagen.forEach((t, i) => {
    inhalt.push({ text: tIn(sp, 'Anhang {nr}: Einzelprotokoll {name}', { nr: i + 1, name: anlageName(t) }), fontSize: 13, bold: true, pageBreak: 'before', margin: [0, 0, 0, 6] })
    inhalt.push(...einzelInhalt(d, t))
  })

  return basis(d, `${tIn(sp, 'Sammelprotokoll')} ${d.protokollNr}`, inhalt)
}
