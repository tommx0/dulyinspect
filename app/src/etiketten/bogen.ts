// Etiketten-Druckbögen in exakten Maßen (A4). Reine Funktionen → in Node testbar.
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces'
import { etikettAnzeige } from '../lib/etikett'
import { t, tIn, type Sprache } from '../lib/sprache'

export interface Bogenformat {
  id: string
  name: string
  breite: number // mm je Etikett
  hoehe: number
  spalten: number
  zeilen: number
  abstandX: number // mm zwischen Spalten
  abstandY: number // mm zwischen Zeilen
}

/**
 * Vorlagen gängiger A4-Bögen. Ränder werden symmetrisch berechnet – bitte vor dem ersten Druck
 * mit dem Probedruck (Normalpapier, Rahmen) gegen den echten Bogen halten.
 */
export const FORMATE: Bogenformat[] = [
  { id: '63x34', name: t('63,5 × 33,9 mm · 24 je Bogen (z. B. Avery Zweckform L4773 wetterfest / L7159)'), breite: 63.5, hoehe: 33.9, spalten: 3, zeilen: 8, abstandX: 2.5, abstandY: 0 },
  { id: '99x42', name: t('99,1 × 42,3 mm · 12 je Bogen (z. B. Avery Zweckform L4776 wetterfest)'), breite: 99.1, hoehe: 42.3, spalten: 2, zeilen: 6, abstandX: 2.5, abstandY: 0 },
  { id: '70x36', name: t('70 × 36 mm · 24 je Bogen (randlos, z. B. Avery Zweckform 3475)'), breite: 70, hoehe: 36, spalten: 3, zeilen: 8, abstandX: 0, abstandY: 0 },
  { id: '48x25', name: t('48,5 × 25,4 mm · 40 je Bogen (klein, für Melder)'), breite: 48.5, hoehe: 25.4, spalten: 4, zeilen: 10, abstandX: 0, abstandY: 0 },
  { id: '38x21', name: t('38,1 × 21,2 mm · 65 je Bogen (klein, für Melder)'), breite: 38.1, hoehe: 21.2, spalten: 5, zeilen: 13, abstandX: 2.5, abstandY: 0 },
  { id: '70x42', name: t('70 × 42,3 mm · 21 je Bogen (randlos, z. B. Avery Zweckform 3652)'), breite: 70, hoehe: 42.3, spalten: 3, zeilen: 7, abstandX: 0, abstandY: 0 },
]

export interface Etikett {
  id: string
  zeile2?: string | null // z. B. Türbezeichnung
  qr: string // data:-URL des QR-Codes
  anzeige?: string // gedruckter Text statt der ID, Zeilenumbruch erlaubt (Melder-Codes)
  hinweis?: string // Zeile unter dem Code statt „Prüfetikett – nicht entfernen“
}

export interface BogenOptionen {
  format: Bogenformat
  startPosition?: number // 1-basiert: erstes freies Feld auf dem ersten Bogen
  versatzX?: number // mm Korrektur für den Drucker
  versatzY?: number
  probedruck?: boolean // Rahmen um jedes Feld, zum Ausrichten auf Normalpapier
  firma: string
  telefon?: string | null
  mandantencode?: string | null // klein in der Firmenzeile, auf sehr kleinen Etiketten in eigener Zeile
  /** Sprache des Aufdrucks: die der Protokolle dieser Instanz (firma.protokoll_sprache), ohne Angabe Deutsch */
  sprache?: Sprache
}

const MM = 72 / 25.4 // pt je mm
const A4 = { breite: 210, hoehe: 297 }

export function raender(f: Bogenformat) {
  return {
    links: (A4.breite - f.spalten * f.breite - (f.spalten - 1) * f.abstandX) / 2,
    oben: (A4.hoehe - f.zeilen * f.hoehe - (f.zeilen - 1) * f.abstandY) / 2,
  }
}

/** Position (mm, linke obere Ecke) des n-ten Feldes (0-basiert) auf einem Bogen. */
export function feldPosition(f: Bogenformat, n: number, versatzX = 0, versatzY = 0) {
  const { links, oben } = raender(f)
  const spalte = n % f.spalten
  const zeile = Math.floor(n / f.spalten)
  return { x: links + spalte * (f.breite + f.abstandX) + versatzX, y: oben + zeile * (f.hoehe + f.abstandY) + versatzY }
}

export function bogenAnzahl(f: Bogenformat, anzahl: number, start = 1) {
  return Math.ceil((anzahl + start - 1) / (f.spalten * f.zeilen))
}

function etikettInhalt(e: Etikett, f: Bogenformat, o: BogenOptionen, x: number, y: number): Content[] {
  const rand = Math.min(2.5, f.hoehe * 0.08) // mm Innenabstand
  const qr = Math.min(f.hoehe - 2 * rand, f.breite * 0.45)
  const textX = x + rand + qr + 2
  const textBreite = f.breite - qr - 2 * rand - 2
  const klein = f.breite < 90
  const sehrKlein = f.breite < 50 // z. B. 38 × 21 mm: nur Code und kurzer Hinweis, keine Firmenzeile
  const id = e.anzeige ?? etikettAnzeige(e.id)
  const laengste = Math.max(...id.split('\n').map((z) => z.length))
  // Längere IDs (PK-000 0427) verkleinern, damit sie neben dem QR-Code in einer Zeile bleiben
  // Melder-Codes bestehen aus breiten Großbuchstaben und Ziffern (WWWWW ist der ungünstigste Fall), daher ein Zeichen = 1 Schrifthöhe
  const gross = Math.min(f.hoehe >= 40 ? 15 : 12, (textBreite * MM) / (laengste * (e.anzeige ? 1 : 0.64)))
  const inhalt: Content[] = [
    { image: e.qr, width: qr * MM, height: qr * MM, absolutePosition: { x: (x + rand) * MM, y: (y + (f.hoehe - qr) / 2) * MM } },
    {
      // feste Spaltenbreite erzwingt den Umbruch innerhalb des Etiketts
      columns: [{
        width: textBreite * MM,
        stack: [
          { text: id, bold: true, fontSize: gross, characterSpacing: e.anzeige ? 0 : 0.3 },
          e.zeile2 ? { text: e.zeile2, fontSize: klein ? 6.5 : 7.5, margin: [0, 1, 0, 0], maxHeight: 9 } : '',
          { text: e.hinweis ?? tIn(o.sprache ?? 'de', 'Prüfetikett – nicht entfernen'), fontSize: klein ? 5.5 : 6, color: '#475569', margin: [0, klein ? 2 : 3, 0, 0] },
          sehrKlein
            ? (o.mandantencode ? { text: o.mandantencode, fontSize: 5.5, color: '#475569' } : '')
            : { text: [...(klein ? [o.telefon ?? o.firma] : [o.firma, o.telefon]), o.mandantencode].filter(Boolean).join(' · '), fontSize: klein ? 5.5 : 6, color: '#475569' },
        ],
      }],
      absolutePosition: { x: textX * MM, y: (y + rand + 0.5) * MM },
    } as Content, // maxHeight kennt die Typdefinition von pdfmake nicht
  ]
  return inhalt
}

/** PDF-Definition der Druckbögen. */
export function bogenPdf(etiketten: Etikett[], o: BogenOptionen): TDocumentDefinitions {
  const f = o.format
  const jeBogen = f.spalten * f.zeilen
  const start = Math.max(1, Math.min(o.startPosition ?? 1, jeBogen))
  const inhalt: Content[] = []
  const seiten = Math.max(1, bogenAnzahl(f, etiketten.length, start))
  for (let s = 0; s < seiten; s++) {
    const seite: Content[] = []
    for (let feld = 0; feld < jeBogen; feld++) {
      const index = s * jeBogen + feld - (start - 1)
      const { x, y } = feldPosition(f, feld, o.versatzX, o.versatzY)
      if (o.probedruck) {
        seite.push({ canvas: [{ type: 'rect', x: 0, y: 0, w: f.breite * MM, h: f.hoehe * MM, lineWidth: 0.3, lineColor: '#94a3b8', dash: { length: 2 } }], absolutePosition: { x: x * MM, y: y * MM } })
      }
      const e = index >= 0 ? etiketten[index] : undefined
      if (e) seite.push(...etikettInhalt(e, f, o, x, y))
    }
    // Ein unsichtbarer Anker trägt den Seitenumbruch
    inhalt.push({ text: ' ', fontSize: 1, pageBreak: s > 0 ? 'before' : undefined }, ...seite)
  }
  return {
    pageSize: 'A4',
    pageMargins: [0, 0, 0, 0],
    info: { title: tIn(o.sprache ?? 'de', 'Etiketten {von}–{bis}', { von: etiketten[0]?.id ?? '', bis: etiketten.at(-1)?.id ?? '' }), creator: 'DulyInspect' },
    content: inhalt,
  }
}
