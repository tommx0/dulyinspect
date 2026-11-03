// Änderungen einer Revision als lesbare Liste fürs Protokoll (reine Funktion → testbar ohne Server).
import type { Punkt } from '../lib/checkliste'
import { gebietsschema, tIn, type Sprache } from '../lib/sprache'
import type { Ampel, ProtokollAenderung } from './typen'

/** Eine Zeile aus `anlagenpruefung_aenderung` */
export interface AenderungZeile {
  tabelle: string
  datensatz_id: string
  aktion: string
  alt: unknown
  neu: unknown
  von: string | null
  am: string
}

export interface AenderungKontext {
  punkte: Punkt[]
  /** Elemente der Anlage (z. B. Leuchten) mit Bezeichnung der Art, z. B. „Leuchte“ */
  elemente: Map<string, { gruppe: string | null; nummer: string }>
  elementEinzahl: string
  /** Mängel und Antworten der Anlage, damit Fotos ihrem Bezug zugeordnet werden können */
  maengel: Map<string, { beschreibung: string; entdeckt_in?: string }>
  antworten: Map<string, { punkt_id: string; anlagenpruefung_id?: string }>
  personen: Map<string, string>
  /** Türanlage: Name der Tür je Teilprüfung – jede Änderung nennt ihre Tür */
  tueren?: Map<string, string>
}

// Sprache der Texte: im Protokoll die der Instanz, in der Oberfläche die der App (aenderungenZusammenfassen setzt sie)
let s: Sprache = 'de'
const AMPEL = (a: Ampel): string | undefined => ({
  gruen: tIn(s, 'ohne Mängel'), gelb: tIn(s, 'mit Mängeln, betriebsbereit'), rot: tIn(s, 'nicht betriebssicher'),
} as Record<Ampel, string>)[a]
const ELEMENT = (x: string): string | undefined => ({ io: tIn(s, 'i.O.'), defekt: tIn(s, 'defekt'), nicht_zugaenglich: tIn(s, 'nicht zugänglich') } as Record<string, string>)[x]
const BEWERTUNG = (x: string): string | undefined => ({ besteht: tIn(s, 'besteht weiterhin'), behoben: tIn(s, 'behoben') } as Record<string, string>)[x]
const MANGEL = (x: string): string | undefined => ({
  offen: tIn(s, 'offen'), behoben: tIn(s, 'behoben'), nachgeprueft: tIn(s, 'nachgeprüft'), verworfen: tIn(s, 'verworfen'),
} as Record<string, string>)[x]
const zahl = (n: number) => n.toLocaleString(gebietsschema(s), { maximumFractionDigits: 3 })

type Datensatz = Record<string, unknown> | null
const feld = (d: Datensatz, k: string) => (d ? d[k] ?? null : null)
const gleich = (a: Datensatz, b: Datensatz, felder: string[]) => felder.every((k) => JSON.stringify(feld(a, k)) === JSON.stringify(feld(b, k)))
const zitat = (t: unknown) => (s === 'de' ? `„${String(t ?? '').trim() || '–'}“` : `“${String(t ?? '').trim() || '–'}”`)

function punktText(k: AenderungKontext, punktId: unknown) {
  return k.punkte.find((p) => p.id === punktId)?.text ?? tIn(s, 'Prüfpunkt')
}

function antwortWert(k: AenderungKontext, a: Datensatz): string {
  if (!a) return '–'
  const p = k.punkte.find((x) => x.id === a.punkt_id)
  if (a.status === 'entfaellt') return tIn(s, 'entfällt')
  if (a.zahl != null) return `${zahl(Number(a.zahl))}${p?.einheit ? ` ${p.einheit}` : ''}`
  if (a.text != null && a.text !== '') return p?.typ === 'ja_nein' ? (a.text === 'ja' ? tIn(s, 'Ja') : tIn(s, 'Nein')) : String(a.text)
  if (a.status === 'io') return tIn(s, 'i.O.')
  if (a.status === 'nio') return tIn(s, 'n.i.O.')
  return '–'
}

function elementName(k: AenderungKontext, d: Datensatz) {
  const e = k.elemente.get(String(feld(d, 'element_id')))
  return `${tIn(s, k.elementEinzahl)} ${e ? [e.gruppe, e.nummer].filter(Boolean).join('/') : ''}`.trim()
}

function elementWert(d: Datensatz) {
  if (!d) return '–'
  const x = ELEMENT(String(d.status)) ?? String(d.status)
  return d.status === 'defekt' && d.grund ? `${x} (${String(d.grund)})` : x
}

function fotoBezug(k: AenderungKontext, d: Datensatz) {
  const id = String(feld(d, 'bezug_id'))
  if (feld(d, 'bezug_typ') === 'mangel') return `: ${tIn(s, 'Mangel')} ${zitat(k.maengel.get(id)?.beschreibung)}`
  const a = k.antworten.get(id)
  return a ? `: ${tIn(s, 'Prüfpunkt')} ${zitat(punktText(k, a.punkt_id))}` : ''
}

/** Text einer Änderung; null, wenn sich nichts geändert hat, was im Protokoll steht. */
function text(k: AenderungKontext, tabelle: string, alt: Datensatz, neu: Datensatz): string | null {
  switch (tabelle) {
    case 'antwort': {
      if (gleich(alt, neu, ['status', 'zahl', 'text', 'bemerkung'])) return null
      const name = `${tIn(s, 'Prüfpunkt')} ${zitat(punktText(k, feld(neu ?? alt, 'punkt_id')))}`
      const vorher = antwortWert(k, alt)
      const nachher = antwortWert(k, neu)
      if (vorher !== nachher) return `${name}: ${vorher} → ${nachher}`
      return `${name}: ${neu?.bemerkung ? `${tIn(s, 'Bemerkung')} ${zitat(neu.bemerkung)}` : tIn(s, 'Bemerkung entfernt')}`
    }
    case 'element_ergebnis': {
      if (gleich(alt, neu, ['status', 'grund', 'bemerkung', 'messwerte'])) return null
      const name = elementName(k, neu ?? alt)
      if (!gleich(alt, neu, ['status', 'grund'])) return `${name}: ${elementWert(alt)} → ${elementWert(neu)}`
      if (!gleich(alt, neu, ['messwerte'])) return `${name}: ${tIn(s, 'Messwerte geändert')}`
      return `${name}: ${neu?.bemerkung ? `${tIn(s, 'Bemerkung')} ${zitat(neu.bemerkung)}` : tIn(s, 'Bemerkung entfernt')}`
    }
    case 'mangel': {
      if (!alt) return tIn(s, 'Mangel erfasst: {text} (Stufe {stufe})', { text: zitat(neu?.beschreibung), stufe: String(neu?.stufe) })
      if (!neu) return `${tIn(s, 'Mangel gelöscht')}: ${zitat(alt.beschreibung)}`
      const teile: string[] = []
      if (alt.beschreibung !== neu.beschreibung) teile.push(`${zitat(alt.beschreibung)} → ${zitat(neu.beschreibung)}`)
      if (alt.stufe !== neu.stufe) teile.push(`${tIn(s, 'Stufe')} ${String(alt.stufe)} → ${String(neu.stufe)}`)
      if (alt.status !== neu.status) teile.push(`${MANGEL(String(alt.status)) ?? String(alt.status)} → ${MANGEL(String(neu.status)) ?? String(neu.status)}`)
      if (!teile.length) return null
      return `${alt.beschreibung !== neu.beschreibung ? tIn(s, 'Mangel geändert') : `${tIn(s, 'Mangel')} ${zitat(neu.beschreibung)}`}: ${teile.join(', ')}`
    }
    case 'foto':
      if (alt && neu) return null // nur umgehängt (Antwort ersetzt)
      return `${neu ? tIn(s, 'Foto hinzugefügt') : tIn(s, 'Foto entfernt')}${fotoBezug(k, neu ?? alt)}`
    case 'anlagenpruefung': {
      const teile: string[] = []
      if (!gleich(alt, neu, ['ergebnis', 'ergebnis_begruendung'])) {
        const a = (x: Datensatz) => AMPEL(feld(x, 'ergebnis') as Ampel) ?? '–'
        const begruendung = neu?.ergebnis_begruendung ? ` (${tIn(s, 'Begründung')}: ${String(neu.ergebnis_begruendung)})` : ''
        teile.push(a(alt) !== a(neu) ? `${tIn(s, 'Ergebnis')}: ${a(alt)} → ${a(neu)}${begruendung}`
          : `${tIn(s, 'Begründung des Ergebnisses')}: ${zitat(neu?.ergebnis_begruendung)}`)
      }
      // Tür einer Türanlage: geprüft bzw. nicht geprüft (mit Grund)
      if (!gleich(alt, neu, ['status', 'nicht_geprueft_grund'])) {
        const stand = (x: Datensatz) => feld(x, 'status') === 'nicht_geprueft' ? `${tIn(s, 'nicht geprüft')} (${String(feld(x, 'nicht_geprueft_grund') ?? '')})`
          : feld(x, 'status') === 'geprueft' ? tIn(s, 'fertig') : tIn(s, 'in Prüfung')
        if (stand(alt) !== stand(neu)) teile.push(tIn(s, 'Stand: {alt} → {neu}', { alt: stand(alt), neu: stand(neu) }))
      }
      // Bewertung früherer Mängel ({ Mangel: 'besteht' | 'behoben' })
      const vorher = (feld(alt, 'altmaengel') ?? {}) as Record<string, string>
      const nachher = (feld(neu, 'altmaengel') ?? {}) as Record<string, string>
      for (const id of [...new Set([...Object.keys(vorher), ...Object.keys(nachher)])]) {
        if (vorher[id] === nachher[id] || !nachher[id]) continue
        teile.push(`${tIn(s, 'Früherer Mangel')} ${zitat(k.maengel.get(id)?.beschreibung)}: ${BEWERTUNG(vorher[id]) ?? tIn(s, 'nicht bewertet')} → ${BEWERTUNG(nachher[id]) ?? nachher[id]}`)
      }
      return teile.length ? teile.join('; ') : null
    }
  }
  return null
}

/** Türanlage: die Tür, zu der eine Änderung gehört (über ihre Teilprüfung) */
function tuerVon(k: AenderungKontext, z: AenderungZeile, d: Datensatz): string | null {
  if (!k.tueren) return null
  let pid: unknown = null
  if (z.tabelle === 'antwort' || z.tabelle === 'element_ergebnis') pid = feld(d, 'anlagenpruefung_id')
  else if (z.tabelle === 'mangel') pid = feld(d, 'entdeckt_in')
  else if (z.tabelle === 'anlagenpruefung') pid = z.datensatz_id
  else if (z.tabelle === 'foto') {
    const id = String(feld(d, 'bezug_id'))
    pid = k.antworten.get(id)?.anlagenpruefung_id ?? k.maengel.get(id)?.entdeckt_in ?? null
  }
  return k.tueren.get(String(pid)) ?? null
}

/**
 * Fasst die Änderungen je Eintrag zusammen: vom Stand vor der ersten bis zum Stand nach der letzten Änderung
 * (mehrfaches Speichern beim Tippen ergibt eine Zeile; angelegt und wieder gelöscht ergibt keine).
 */
export function aenderungenZusammenfassen(zeilen: AenderungZeile[], k: AenderungKontext, sprache: Sprache = 'de'): ProtokollAenderung[] {
  s = sprache
  const je = new Map<string, AenderungZeile[]>()
  for (const z of [...zeilen].sort((a, b) => a.am.localeCompare(b.am))) {
    const schluessel = `${z.tabelle}:${z.datensatz_id}`
    je.set(schluessel, [...(je.get(schluessel) ?? []), z])
  }
  const ergebnis: ProtokollAenderung[] = []
  for (const liste of je.values()) {
    const erste = liste[0]
    const letzte = liste[liste.length - 1]
    const alt = (erste.aktion === 'INSERT' ? null : erste.alt) as Datensatz
    const neu = (letzte.aktion === 'DELETE' ? null : letzte.neu) as Datensatz
    if (!alt && !neu) continue
    const t0 = text(k, erste.tabelle, alt, neu)
    if (!t0) continue
    const tuer = tuerVon(k, erste, neu ?? alt)
    const t = tuer ? `${tuer}: ${t0}` : t0
    const von = [...new Set(liste.map((z) => (z.von ? k.personen.get(z.von) ?? tIn(s, 'Prüfer') : tIn(s, 'Prüfer'))))].join(', ')
    ergebnis.push({ am: letzte.am, von, text: t })
  }
  return ergebnis.sort((a, b) => a.am.localeCompare(b.am))
}
