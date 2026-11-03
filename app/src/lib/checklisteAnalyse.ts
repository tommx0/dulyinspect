// Pfad-Analyse einer Checkliste: Welche Punkte können je nach Antworten erscheinen, wie viele Wege gibt es, wo stimmt etwas nicht?
// Gerechnet wird mit denselben Regeln wie im Prüfablauf (istSichtbar). Gebrannt wird nur über Punkte, auf die sich Bedingungen beziehen.
import {
  alleBezuege, bedingungTrifft, blaetter, istSichtbar, wirksam, type AntwortWert, type Bedingung, type BedingungsWerte, type Punkt,
} from './checkliste'
import { t } from './sprache'

export interface Hinweis {
  art: 'warnung' | 'hinweis'
  /** betroffener Punkt (ID) */
  punkt: string
  text: string
}

export interface Analyse {
  /** false, wenn die Zahl der Wege zu groß war und die Analyse abgebrochen wurde */
  vollstaendig: boolean
  /** Anzahl unterschiedlicher Antwortkombinationen der steuernden Punkte */
  pfade: number
  sichtbarMin: number
  sichtbarMax: number
  pflichtMin: number
  pflichtMax: number
  unerreichbar: Punkt[]
  hinweise: Hinweis[]
}

const MAX_PFADE = 20000

/** Stellvertreter-Werte für einen Messwert: je ein Wert in jedem Bereich zwischen den Grenzen, auf den Grenzen und „entfällt“. */
function messwertKandidaten(p: Punkt, punkte: Punkt[]): AntwortWert[] {
  const grenzen = new Set<number>()
  if (p.soll_min != null) grenzen.add(p.soll_min)
  if (p.soll_max != null) grenzen.add(p.soll_max)
  for (const q of punkte) {
    const bedingungen: Bedingung[] = [...(q.nur_wenn ? [q.nur_wenn] : []), ...(q.wirkungen ?? []).map((w) => w.wenn)]
    for (const bed of bedingungen) {
      for (const b of blaetter(bed)) {
        if (b.punkt !== p.id) continue
        if (b.unter !== undefined) grenzen.add(b.unter)
        if (b.ueber !== undefined) grenzen.add(b.ueber)
      }
      // Wirkungen können Grenzwerte ersetzen: auch diese Grenzen trennen Bereiche
    }
    for (const w of q.wirkungen ?? []) {
      if (q.id !== p.id) continue
      if (w.soll_min !== undefined) grenzen.add(w.soll_min)
      if (w.soll_max !== undefined) grenzen.add(w.soll_max)
    }
  }
  const sortiert = [...grenzen].sort((a, b) => a - b)
  const werte = sortiert.length === 0 ? [0] : [
    sortiert[0] - 1,
    ...sortiert.flatMap((g, i) => [g, i < sortiert.length - 1 ? (g + sortiert[i + 1]) / 2 : g + 1]),
  ]
  return [...werte.map((zahl) => ({ zahl })), { status: 'entfaellt' as const }]
}

function kandidaten(p: Punkt, punkte: Punkt[]): AntwortWert[] {
  switch (p.typ) {
    case 'ja_nein': return [{ text: 'ja' }, { text: 'nein' }]
    case 'auswahl': return (p.optionen ?? []).filter((o) => o.wert).map((o) => ({ text: o.wert }))
    case 'status': return [{ status: 'io' }, { status: 'nio' }, { status: 'entfaellt' }]
    case 'messwert': return messwertKandidaten(p, punkte)
    default: return [{}]
  }
}

const alleBezuegeSichtbarkeit = (p: Punkt) => (p.nur_wenn ? [...new Set(blaetter(p.nur_wenn).map((b) => b.punkt))] : [])

/** Setzt eine in sich stimmige Checkliste voraus (pruefePunkte ohne Fehler): Bezüge nur auf vorherige Punkte. */
export function analysiere(punkte: Punkt[]): Analyse {
  const quellen = new Set(punkte.flatMap(alleBezuege))
  const erreichbar = new Set<string>()
  const bedingte = punkte.filter((p) => p.nur_wenn)
  // je bedingtem Punkt: in wie vielen Wegen sind seine Bezugspunkte sichtbar, in wie vielen er selbst
  const zaehler = new Map<string, { bezuege: number; selbst: number }>(bedingte.map((p) => [p.id, { bezuege: 0, selbst: 0 }]))
  const bezugsListe = new Map<string, string[]>(bedingte.map((p) => [p.id, alleBezuegeSichtbarkeit(p)]))
  // Wirkungen, die in mindestens einem Weg zutreffen
  const wirkungAktiv = new Set<string>()

  let pfade = 0
  let sichtbarMin = Infinity
  let sichtbarMax = 0
  let pflichtMin = Infinity
  let pflichtMax = 0
  const werte: BedingungsWerte = {}
  const sichtbar = new Set<string>()

  class ZuViele extends Error {}

  const lauf = (i: number, anzahl: number, pflicht: number) => {
    if (i === punkte.length) {
      if (++pfade > MAX_PFADE) throw new ZuViele()
      sichtbarMin = Math.min(sichtbarMin, anzahl)
      sichtbarMax = Math.max(sichtbarMax, anzahl)
      pflichtMin = Math.min(pflichtMin, pflicht)
      pflichtMax = Math.max(pflichtMax, pflicht)
      for (const p of bedingte) {
        const z = zaehler.get(p.id)!
        if (bezugsListe.get(p.id)!.every((id) => sichtbar.has(id))) {
          z.bezuege++
          if (sichtbar.has(p.id)) z.selbst++
        }
      }
      return
    }
    const p = punkte[i]
    if (!istSichtbar(p, werte, punkte)) return lauf(i + 1, anzahl, pflicht)
    erreichbar.add(p.id)
    sichtbar.add(p.id)
    p.wirkungen?.forEach((w, wi) => { if (bedingungTrifft(w.wenn, werte, punkte)) wirkungAktiv.add(`${p.id}#${wi}`) })
    const naechste = [anzahl + 1, pflicht + (wirksam(p, werte, punkte).pflicht ? 1 : 0)] as const
    if (quellen.has(p.id)) {
      for (const k of kandidaten(p, punkte)) {
        werte[p.id] = k
        lauf(i + 1, ...naechste)
      }
      delete werte[p.id]
    } else {
      lauf(i + 1, ...naechste)
    }
    sichtbar.delete(p.id)
  }

  let vollstaendig = true
  try {
    lauf(0, 0, 0)
  } catch (e) {
    if (!(e instanceof ZuViele)) throw e
    vollstaendig = false
  }

  const hinweise: Hinweis[] = []
  const unerreichbar = vollstaendig ? punkte.filter((p) => !erreichbar.has(p.id)) : []
  for (const p of unerreichbar) {
    hinweise.push({ art: 'warnung', punkt: p.id, text: t('„{punkt}“ wird nie angezeigt: Die Bedingung kann nie zutreffen.', { punkt: p.text }) })
  }
  if (vollstaendig) {
    for (const p of bedingte) {
      const z = zaehler.get(p.id)!
      if (z.bezuege > 0 && z.selbst === z.bezuege) {
        hinweise.push({ art: 'hinweis', punkt: p.id, text: t('Die Bedingung von „{punkt}“ trifft immer zu, sobald der steuernde Punkt angezeigt wird.', { punkt: p.text }) })
      }
    }
  }
  for (const p of punkte) {
    if (!quellen.has(p.id) || p.pflicht) continue
    const abhaengige = bedingte.filter((x) => alleBezuegeSichtbarkeit(x).includes(p.id)).length
    hinweise.push({
      art: 'hinweis',
      punkt: p.id,
      text: abhaengige === 1 ? t('„{punkt}“ ist keine Pflichtangabe: Bleibt sie unbeantwortet, entfallen der abhängige Punkt unbemerkt.', { punkt: p.text })
        : t('„{punkt}“ ist keine Pflichtangabe: Bleibt sie unbeantwortet, entfallen die {n} abhängigen Punkte unbemerkt.', { punkt: p.text, n: abhaengige }),
    })
  }

  if (vollstaendig) {
    for (const p of punkte) {
      if (!erreichbar.has(p.id)) continue
      p.wirkungen?.forEach((w, wi) => {
        if (!wirkungAktiv.has(`${p.id}#${wi}`)) {
          hinweise.push({ art: 'warnung', punkt: p.id, text: t('Eine Wirkung von „{punkt}“ tritt nie ein: Die Bedingung kann nie zutreffen.', { punkt: p.text }) })
        } else if (w.pflicht && !w.stufe && w.soll_min === undefined && w.soll_max === undefined && p.pflicht) {
          hinweise.push({ art: 'hinweis', punkt: p.id, text: t('Die Wirkung „Pflicht“ von „{punkt}“ ändert nichts: Der Punkt ist ohnehin Pflicht.', { punkt: p.text }) })
        }
      })
    }
  }

  const leer = pfade === 0
  return {
    vollstaendig,
    pfade,
    sichtbarMin: leer ? 0 : sichtbarMin,
    sichtbarMax,
    pflichtMin: leer ? 0 : pflichtMin,
    pflichtMax,
    unerreichbar,
    hinweise,
  }
}
