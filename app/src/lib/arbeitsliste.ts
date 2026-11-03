// Arbeitsliste auf der Startseite von Prüfen: was läuft, was ist nachzuprüfen, was steht an, wie gingen die letzten
// Prüfungen aus – je Tür bzw. Anlage über alle Objekte (online vom Server, offline aus dem Gerätespeicher)
import type { Ampel } from './pruefung'
import { t } from './sprache'

export type Bereich = 'laufend' | 'nachpruefen' | 'anstehend' | 'geprueft'
export const BEREICHE: { schluessel: Bereich; text: string }[] = [
  { schluessel: 'laufend', text: t('In Prüfung') },
  { schluessel: 'nachpruefen', text: t('Nachprüfen') },
  { schluessel: 'anstehend', text: t('Anstehend') },
  { schluessel: 'geprueft', text: t('Geprüft') },
]
/** Anstehend: fällig bis so viele Tage voraus; Geprüft: Ergebnisse der letzten so vielen Tage */
export const VORAUS_TAGE = 30
export const ZURUECK_TAGE = 30

export interface AnlageKurz {
  id: string; objekt_id: string; etikett_id: string | null; kunden_bezeichnung: string | null; art?: string
  teil_von_id: string | null; naechste_pruefung_am: string | null; letzte_pruefung_am: string | null
}
export interface PruefungKurz {
  id: string; status: string; ergebnis: string | null; nicht_geprueft_grund: string | null
  begonnen_am: string; beendet_am: string | null; teil_von_id: string | null; pruefer_id: string; pruefer: string; anlage: AnlageKurz
}
/** Anlage mit offenen Mängeln aus abgeschlossenen Prüfungen (höchste Stufe zuerst) */
export interface NachpruefAnlage {
  anlage_id: string; objekt_id: string; etikett: string | null; bezeichnung: string | null; art?: string; tuer: boolean
  maengel: { stufe: number; beschreibung: string; erstellt_am: string }[]
}

export type Farbe = 'grau' | 'gruen' | 'gelb' | 'rot' | 'blau'
export interface Eintrag {
  schluessel: string
  zu: string
  objekt_id: string
  art?: string
  etikett: string | null
  /** Bezeichnung; bei der Türanlage leer (die Ansicht nennt sie nach dem Objekt) */
  titel: string | null
  tueranlage?: boolean
  tuer?: boolean
  badge: { farbe: Farbe; text: string }
  /** zweite Zeile, z. B. Stand der Türen oder der wichtigste Mangel */
  hinweis?: { text: string; farbe?: 'rot' }
}

const ERGEBNIS: Record<Ampel, { farbe: Farbe; text: string }> = {
  gruen: { farbe: 'gruen', text: t('✓ ohne Mängel') }, gelb: { farbe: 'gelb', text: t('mit Mängeln') }, rot: { farbe: 'rot', text: t('nicht betriebssicher') },
}

function tageVerschieben(heute: string, tage: number): string {
  const [j, m, t] = heute.split('-').map(Number)
  return new Date(Date.UTC(j, m - 1, t + tage)).toISOString().slice(0, 10)
}

const tag = (iso: string) => { const [j, m, d] = iso.slice(0, 10).split('-'); return `${d}.${m}.${j}` }

/**
 * Die vier Listen. `pruefungen`: laufende und in den letzten ZURUECK_TAGE beendete (ohne alte Sessions und Doppelprüfungen);
 * `anlagen`: aktive Anlagen und Türen ohne die Türanlagen selbst.
 */
export function arbeitsliste({ anlagen, pruefungen, nachpruefen, heute, ich }: {
  anlagen: AnlageKurz[]; pruefungen: PruefungKurz[]; nachpruefen: NachpruefAnlage[]; heute: string; ich: string
}): Record<Bereich, Eintrag[]> {
  const laufendeHaupt = pruefungen.filter((p) => p.status === 'in_pruefung' && !p.teil_von_id)
  const laufendIds = new Set(laufendeHaupt.map((p) => p.id))
  const teileVon = new Map<string, PruefungKurz[]>()
  for (const p of pruefungen) if (p.teil_von_id && laufendIds.has(p.teil_von_id)) teileVon.set(p.teil_von_id, [...(teileVon.get(p.teil_von_id) ?? []), p])
  // In einer laufenden Prüfung: nicht zusätzlich als anstehend zeigen
  const inPruefung = new Set([...laufendeHaupt.map((p) => p.anlage.id), ...[...teileVon.values()].flat().map((t) => t.anlage.id)])

  const laufend: Eintrag[] = laufendeHaupt.map((p) => {
    const wer = p.pruefer_id === ich ? t('Sie') : p.pruefer
    const basis = { schluessel: p.id, zu: `/pruefen/p/${p.id}`, objekt_id: p.anlage.objekt_id, art: p.anlage.art, etikett: p.anlage.etikett_id }
    if (p.anlage.art !== 'tueranlage') return { ...basis, titel: p.anlage.kunden_bezeichnung, badge: { farbe: 'blau', text: t('in Prüfung · {wer}', { wer }) } }
    const teile = teileVon.get(p.id) ?? []
    const fertig = teile.filter((x) => x.status === 'geprueft' && x.ergebnis)
    const mit = fertig.filter((x) => x.ergebnis !== 'gruen').length
    const nicht = teile.filter((x) => x.status === 'nicht_geprueft').length
    const teilText = [fertig.length === 1 ? t('1 Tür fertig') : t('{n} Türen fertig', { n: fertig.length }), mit && t('{n} mit Mängeln', { n: mit }), nicht && t('{n} nicht geprüft', { n: nicht })]
      .filter(Boolean).join(' · ')
    return { ...basis, etikett: null, titel: null, tueranlage: true, badge: { farbe: 'blau', text: t('in Prüfung · {wer}', { wer }) },
      hinweis: { text: t('{stand} – Abschluss mit Unterschrift auf der Seite der Türanlage', { stand: teilText }), farbe: mit ? 'rot' : undefined } }
  })

  const nach: Eintrag[] = [...nachpruefen].sort((a, b) => b.maengel[0].stufe - a.maengel[0].stufe).map((n) => ({
    schluessel: n.anlage_id, zu: `/pruefen/o/${n.objekt_id}?anlage=${n.anlage_id}&nachpruefen=1`, objekt_id: n.objekt_id, art: n.art,
    etikett: n.etikett, titel: n.bezeichnung, tuer: n.tuer,
    badge: { farbe: n.maengel[0].stufe >= 3 ? 'rot' : 'gelb', text: `⚠ ${n.maengel.length === 1 ? t('1 Mangel') : t('{n} Mängel', { n: n.maengel.length })}` },
    hinweis: { text: t('Stufe {stufe}: {mangel}', { stufe: n.maengel[0].stufe, mangel: n.maengel[0].beschreibung })
      + (n.maengel.length > 1 ? t(' (+ {n} weitere)', { n: n.maengel.length - 1 }) : ''), farbe: 'rot' },
  }))

  const grenze = tageVerschieben(heute, VORAUS_TAGE)
  // noch nie geprüfte zuerst, dann nach Fälligkeit
  const rang = (a: AnlageKurz) => (!a.naechste_pruefung_am && !a.letzte_pruefung_am ? 0 : 1)
  const anstehend: Eintrag[] = anlagen
    .filter((a) => a.art !== 'tueranlage' && !inPruefung.has(a.id) && (!a.naechste_pruefung_am || a.naechste_pruefung_am <= grenze))
    .sort((a, b) => rang(a) - rang(b) || (a.naechste_pruefung_am ?? '').localeCompare(b.naechste_pruefung_am ?? ''))
    .map((a): Eintrag => ({
      schluessel: a.id, zu: `/pruefen/o/${a.objekt_id}?anlage=${a.id}`, objekt_id: a.objekt_id, art: a.art, etikett: a.etikett_id,
      titel: a.kunden_bezeichnung, tuer: !!a.teil_von_id,
      badge: !a.naechste_pruefung_am ? { farbe: 'gelb', text: a.letzte_pruefung_am ? t('fällig') : t('noch nie geprüft') }
        : a.naechste_pruefung_am < heute ? { farbe: 'rot', text: t('überfällig seit {datum}', { datum: tag(a.naechste_pruefung_am) }) }
          : { farbe: 'gelb', text: t('fällig {datum}', { datum: tag(a.naechste_pruefung_am) }) },
    }))

  const ab = tageVerschieben(heute, -ZURUECK_TAGE)
  const gesehen = new Set<string>()
  const geprueft: Eintrag[] = pruefungen
    .filter((p) => (p.status === 'geprueft' || p.status === 'nicht_geprueft') && p.anlage.art !== 'tueranlage'
      && !!p.beendet_am && p.beendet_am.slice(0, 10) >= ab && !(p.teil_von_id && laufendIds.has(p.teil_von_id)))
    .sort((a, b) => (b.beendet_am ?? '').localeCompare(a.beendet_am ?? ''))
    // je Anlage nur die letzte
    .filter((p) => !gesehen.has(p.anlage.id) && !!gesehen.add(p.anlage.id))
    .map((p): Eintrag => ({
      schluessel: p.id, objekt_id: p.anlage.objekt_id, art: p.anlage.art, etikett: p.anlage.etikett_id, titel: p.anlage.kunden_bezeichnung,
      tuer: !!p.teil_von_id,
      // Protokoll: der Tür bzw. Anlage; eine nicht geprüfte Tür steht im Protokoll ihrer Türanlage
      zu: p.status === 'geprueft' ? `/protokoll/${p.id}` : p.teil_von_id ? `/protokoll/${p.teil_von_id}` : `/pruefen/p/${p.id}`,
      badge: p.status === 'nicht_geprueft' ? { farbe: 'grau', text: t('nicht geprüft') } : ERGEBNIS[(p.ergebnis ?? 'gruen') as Ampel],
      hinweis: { text: [`${tag(p.beendet_am!)} · ${p.pruefer_id === ich ? t('Sie') : p.pruefer}`, p.nicht_geprueft_grund].filter(Boolean).join(' · ') },
    }))

  return { laufend, nachpruefen: nach, anstehend, geprueft }
}

/** Startfilter: was gerade läuft, sonst was nachzuprüfen ist, sonst was ansteht */
export function startBereich(l: Record<Bereich, Eintrag[]>): Bereich {
  return l.laufend.length ? 'laufend' : l.nachpruefen.length ? 'nachpruefen' : l.anstehend.length ? 'anstehend' : 'geprueft'
}
