// Layout-Modell des Ablaufplans: Der Prüfablauf läuft als Hauptlinie von oben nach unten. Punkte mit Bedingung hängen an einem Abzweig
// nach rechts, vor dem ein Gatter sitzt; die abgefragten Punkte sind nur Steuerleitungen in dieses Gatter. UND/ODER sind eigene Gatter.
// Wirkungen (Pflicht, Mangelstufe, Grenzwert) sitzen als Gatter am Punkt selbst.
import { bedingungsText, bezugsIds, blaetter, istGruppe, nachAbschnitt, zweigeVon, type Bedingung, type Punkt, type Wirkung } from './checkliste'
import { zweigWert } from './checklisteBaum'
import { t } from './sprache'

export interface AblaufKnoten {
  punkt: Punkt
  /** laufende Nummer wie in der Prüfung */
  nr: number
  /** 0 = Hauptlinie, 1 = Abzweig von der Hauptlinie, 2 = Abzweig eines Abzweigs … */
  spalte: number
  zeile: number
}

/** Ein Eingang eines Gatters: die Antwort eines Punkts, die geprüft wird. */
export interface Eingang {
  von: string
  /** z. B. „Anzahl Türflügel“ = zweiflügelig */
  text: string
  /** Zweig-Schlüssel (ja, nio, mangel …) für die Farbe; null bei Sonderfällen */
  zweig: string | null
}

export interface Gatter {
  id: string
  /** „sichtbar“: lässt die Punkte dahinter nur durch, wenn die Bedingung zutrifft; „wirkung“: ändert Regeln des Punkts */
  art: 'sichtbar' | 'wirkung'
  /** Punkte hinter dem Gatter (bei Wirkungen genau der Punkt) */
  ziel: string[]
  spalte: number
  zeile: number
  verknuepfung: 'einzel' | 'alle' | 'eine'
  /** Bedingung als Text (bei Gruppen mit UND/ODER) */
  text: string
  /** nur bei Wirkungen: Folgen, z. B. „Pflicht + Stufe ≥ 3“ */
  folgen?: string
  eingaenge: Eingang[]
}

/** Linie im Ablauf zwischen Punkten (`von`/`nach` sind Punkt- oder Gatter-IDs). */
export interface FlussKante {
  /** folge: nächster Schritt; abzweig: Abzweig von der Hauptlinie ins Gatter; zurueck: Rückkehr in die Hauptlinie */
  art: 'folge' | 'abzweig' | 'zurueck'
  von: string
  nach: string
}

export interface AblaufKopf {
  name: string
  zeile: number
}

export interface Ablauf {
  knoten: AblaufKnoten[]
  gatter: Gatter[]
  fluss: FlussKante[]
  koepfe: AblaufKopf[]
  spalten: number
  zeilen: number
}

const kurzeFolgen = (w: Wirkung) =>
  [w.pflicht && t('Pflicht'), w.stufe && t('Stufe ≥ {stufe}', { stufe: w.stufe }), (w.soll_min !== undefined || w.soll_max !== undefined) && t('Grenzwert')].filter(Boolean).join(' + ')

export function ablaufLayout(punkte: Punkt[]): Ablauf {
  const knoten: AblaufKnoten[] = []
  const koepfe: AblaufKopf[] = []
  let zeile = 0
  let nr = 0
  for (const [name, ps] of nachAbschnitt(punkte)) {
    koepfe.push({ name, zeile: zeile++ })
    for (const punkt of ps) knoten.push({ punkt, nr: ++nr, spalte: 0, zeile: zeile++ })
  }

  const ersterMitId = new Map<string, AblaufKnoten>()
  for (const k of knoten) if (!ersterMitId.has(k.punkt.id)) ersterMitId.set(k.punkt.id, k)

  // Spalte = 1 + tiefste Spalte der Bezugspunkte; Zyklen und Bezüge auf Unbekanntes zählen als Spalte 0
  const fertig = new Map<AblaufKnoten, number>()
  const laeuft = new Set<AblaufKnoten>()
  const spalteVon = (k: AblaufKnoten): number => {
    const bekannt = fertig.get(k)
    if (bekannt !== undefined) return bekannt
    if (laeuft.has(k)) return 0
    laeuft.add(k)
    const refs = bezugsIds(k.punkt.nur_wenn).map((id) => ersterMitId.get(id)).filter((r): r is AblaufKnoten => !!r && r !== k)
    const s = refs.length === 0 ? (k.punkt.nur_wenn ? 1 : 0) : 1 + Math.max(...refs.map(spalteVon))
    laeuft.delete(k)
    fertig.set(k, s)
    return s
  }
  for (const k of knoten) k.spalte = spalteVon(k)

  const eingaengeVon = (b: Bedingung): Eingang[] =>
    blaetter(b).flatMap((blatt) => {
      const ref = ersterMitId.get(blatt.punkt)?.punkt
      if (!ref) return []
      const zweig = zweigWert({ id: '', abschnitt: '', text: '', typ: 'text', nur_wenn: blatt }, ref)
      const def = zweig === null ? undefined : zweigeVon(ref).find((z) => z.schluessel === zweig)
      return [{ von: ref.id, text: def ? `„${ref.text}“ = ${def.label}` : bedingungsText(blatt, punkte), zweig }]
    })
  const verknuepfungVon = (b: Bedingung): Gatter['verknuepfung'] => (istGruppe(b) ? (b.alle ? 'alle' : 'eine') : 'einzel')

  // --- Ablauf: Hauptlinie, Abzweige mit Gatter und Rückkehr
  const gatter: Gatter[] = []
  const fluss: FlussKante[] = []
  let letzterHaupt: string | undefined
  const offen = new Map<number, { schluessel: string; gatter: Gatter; letzter: string }>()
  let ausstehend: { von: string; spalte: number }[] = []

  const schliessen = (spalte: number) => {
    const o = offen.get(spalte)
    if (!o) return
    ausstehend.push({ von: o.letzter, spalte })
    offen.delete(spalte)
  }

  for (const k of knoten) {
    const id = k.punkt.id
    const lane = k.spalte
    // tiefere Abzweige enden vor diesem Punkt
    for (const s of [...offen.keys()]) if (s > lane) schliessen(s)
    // Rückkehr in den Fluss: Abzweige, die tiefer lagen als dieser Punkt, münden hier
    for (const a of ausstehend.filter((x) => x.spalte > lane)) fluss.push({ art: 'zurueck', von: a.von, nach: id })
    ausstehend = ausstehend.filter((x) => x.spalte <= lane)

    if (lane === 0) {
      if (letzterHaupt) fluss.push({ art: 'folge', von: letzterHaupt, nach: id })
      letzterHaupt = id
      continue
    }

    const b = k.punkt.nur_wenn!
    const schluessel = JSON.stringify(b)
    const aktuell = offen.get(lane)
    if (aktuell && aktuell.schluessel === schluessel) {
      // gleiche Bedingung wie der Punkt davor: er liegt hinter demselben Gatter
      fluss.push({ art: 'folge', von: aktuell.letzter, nach: id })
      aktuell.letzter = id
      aktuell.gatter.ziel.push(id)
      continue
    }
    schliessen(lane)
    const g: Gatter = {
      id: `g:${id}`, art: 'sichtbar', ziel: [id], spalte: lane, zeile: k.zeile,
      verknuepfung: verknuepfungVon(b), text: bedingungsText(b, punkte), eingaenge: eingaengeVon(b),
    }
    gatter.push(g)
    // Abzweig von der nächsttieferen offenen Linie (zuletzt dort gezeigter Punkt)
    const elternLane = Math.max(0, ...[...offen.keys()].filter((s) => s < lane))
    const quelle = elternLane === 0 ? letzterHaupt : offen.get(elternLane)?.letzter
    if (quelle) fluss.push({ art: 'abzweig', von: quelle, nach: g.id })
    fluss.push({ art: 'folge', von: g.id, nach: id })
    offen.set(lane, { schluessel, gatter: g, letzter: id })
  }

  // --- Wirkungen: ein Gatter je Wirkung direkt am Punkt
  for (const k of knoten) {
    k.punkt.wirkungen?.forEach((w, i) => {
      gatter.push({
        id: `w:${k.punkt.id}:${i}`, art: 'wirkung', ziel: [k.punkt.id], spalte: k.spalte, zeile: k.zeile,
        verknuepfung: verknuepfungVon(w.wenn), text: bedingungsText(w.wenn, punkte), folgen: kurzeFolgen(w), eingaenge: eingaengeVon(w.wenn),
      })
    })
  }

  return { knoten, gatter, fluss, koepfe, spalten: Math.max(0, ...knoten.map((k) => k.spalte)) + 1, zeilen: zeile }
}
