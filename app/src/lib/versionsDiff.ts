// Vergleich zweier Checklisten-Versionen (Punktlisten) anhand der Punkt-IDs.
import { bedingungsText, PUNKT_TYPEN, STUFEN, wirkungText, type Punkt } from './checkliste'
import { t } from './sprache'

export interface Aenderung {
  feld: string
  alt: string
  neu: string
}

export interface DiffEintrag {
  art: 'neu' | 'entfernt' | 'geaendert' | 'verschoben'
  /** bei „entfernt“ der alte, sonst der neue Stand */
  punkt: Punkt
  aenderungen: Aenderung[]
  /** steht an anderer Stelle der Reihenfolge (zusätzlich zu geänderten Feldern) */
  verschoben: boolean
}

export interface Diff {
  eintraege: DiffEintrag[]
  unveraendert: number
}

const ja = (b: boolean | undefined) => (b ? t('Ja') : t('Nein'))
const nichts = '–'

/** Felder, die verglichen werden, jeweils als lesbarer Text (leer = nicht gesetzt). */
function felder(p: Punkt, alle: Punkt[]): [string, string][] {
  return [
    [t('Text'), p.text],
    [t('Abschnitt'), p.abschnitt],
    [t('Antworttyp'), PUNKT_TYPEN[p.typ] ?? p.typ],
    [t('Pflichtangabe'), ja(p.pflicht)],
    [t('Hinweis'), p.hinweis ?? ''],
    [t('Einheit'), p.einheit ?? ''],
    [t('Soll min'), p.soll_min?.toString() ?? ''],
    [t('Soll max'), p.soll_max?.toString() ?? ''],
    [t('Grenzwert unbestätigt'), p.verifizieren ? t('Ja') : ''],
    [t('In Ordnung ist'), p.gut ? (p.gut === 'ja' ? t('Ja') : t('Nein')) : ''],
    [t('Mangelstufe'), p.vorschlag_stufe ? `${p.vorschlag_stufe} ${STUFEN[p.vorschlag_stufe]}` : ''],
    [t('Foto bei Mangel'), p.foto_bei_nok ? t('Ja') : ''],
    [t('Optionen'), (p.optionen ?? []).map((o) => o.wert + (!o.mangel ? '' : o.vorschlag_stufe ? t(' (Mangel, Stufe {stufe})', { stufe: o.vorschlag_stufe }) : t(' (Mangel)'))).join(', ')],
    [t('Bedingung'), p.nur_wenn ? bedingungsText(p.nur_wenn, alle) : ''],
    [t('Wirkungen'), (p.wirkungen ?? []).map((w) => wirkungText(w, p, alle)).join('; ')],
  ]
}

/** Indizes (in `folge`) der längsten aufsteigenden Teilfolge – diese Punkte behalten ihre relative Reihenfolge. */
function laengsteAufsteigende(folge: number[]): Set<number> {
  const laenge: number[] = []
  const vorgaenger: number[] = []
  let besterEnde = -1
  folge.forEach((x, i) => {
    laenge[i] = 1
    vorgaenger[i] = -1
    for (let j = 0; j < i; j++) {
      if (folge[j] < x && laenge[j] + 1 > laenge[i]) {
        laenge[i] = laenge[j] + 1
        vorgaenger[i] = j
      }
    }
    if (besterEnde < 0 || laenge[i] > laenge[besterEnde]) besterEnde = i
  })
  const menge = new Set<number>()
  for (let i = besterEnde; i >= 0; i = vorgaenger[i]) menge.add(i)
  return menge
}

export function versionsDiff(alt: Punkt[], neu: Punkt[]): Diff {
  const altNachId = new Map<string, Punkt>()
  for (const p of alt) if (!altNachId.has(p.id)) altNachId.set(p.id, p)
  const neuNachId = new Map<string, Punkt>()
  for (const p of neu) if (!neuNachId.has(p.id)) neuNachId.set(p.id, p)

  // Reihenfolge nur unter den gemeinsamen Punkten vergleichen
  const gemeinsam = neu.filter((p) => altNachId.has(p.id) && neuNachId.get(p.id) === p)
  const altPosition = new Map(alt.filter((p) => neuNachId.has(p.id) && altNachId.get(p.id) === p).map((p, i) => [p.id, i]))
  const stabil = laengsteAufsteigende(gemeinsam.map((p) => altPosition.get(p.id)!))
  const verschoben = new Set(gemeinsam.filter((_, i) => !stabil.has(i)).map((p) => p.id))

  const eintraege: DiffEintrag[] = []
  let unveraendert = 0
  for (const p of neu) {
    const vorher = altNachId.get(p.id)
    if (!vorher) {
      eintraege.push({ art: 'neu', punkt: p, aenderungen: [], verschoben: false })
      continue
    }
    const a = felder(vorher, alt)
    const b = felder(p, neu)
    const aenderungen = a.flatMap(([feld, wert], i) => (wert === b[i][1] ? [] : [{ feld, alt: wert || nichts, neu: b[i][1] || nichts }]))
    const istVerschoben = verschoben.has(p.id)
    if (aenderungen.length === 0 && !istVerschoben) unveraendert++
    else eintraege.push({ art: aenderungen.length > 0 ? 'geaendert' : 'verschoben', punkt: p, aenderungen, verschoben: istVerschoben })
  }
  for (const p of alt) {
    if (!neuNachId.has(p.id)) eintraege.push({ art: 'entfernt', punkt: p, aenderungen: [], verschoben: false })
  }
  return { eintraege, unveraendert }
}

/** z. B. „2 neu, 1 geändert, 1 entfernt“ */
export function diffZusammenfassung(d: Diff): string {
  const n = (art: DiffEintrag['art']) => d.eintraege.filter((e) => e.art === art).length
  const teile = [
    [n('neu'), t('{n} neu', { n: n('neu') })], [n('geaendert'), t('{n} geändert', { n: n('geaendert') })],
    [n('entfernt'), t('{n} entfernt', { n: n('entfernt') })], [n('verschoben'), t('{n} verschoben', { n: n('verschoben') })],
  ].flatMap(([zahl, text]) => (zahl ? [text] : []))
  return teile.length ? teile.join(', ') : t('keine Änderungen')
}
