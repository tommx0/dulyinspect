// Fachregeln des Prüfablaufs (Spezifikation 4.1–4.3) als reine Funktionen.
import { istSichtbar, mangelVorschlag, wirksam, type AntwortWert, type BedingungsWerte, type Punkt } from './checkliste'
import { t } from './sprache'

export { mangelVorschlag, type AntwortWert }

export type Ampel = 'gruen' | 'gelb' | 'rot'

export interface MangelKurz {
  id: string
  stufe: number
  status: string
  punkt_id?: string | null
  entdeckt_in?: string
}

/** Ist der Punkt beantwortet? */
export function istBeantwortet(punkt: Punkt, a: AntwortWert | undefined, anzahlFotos = 0): boolean {
  if (punkt.typ === 'foto') return anzahlFotos > 0
  if (!a) return false
  if (a.status === 'entfaellt') return true
  switch (punkt.typ) {
    case 'status': return !!a.status
    case 'messwert': return a.zahl != null
    case 'ja_nein':
    case 'auswahl':
    case 'text': return !!a.text?.trim()
  }
}

/** Antworten in der Form, die Bedingungen auswerten (Status, Zahl und Text). */
export function bedingungsWerte(antworten: Record<string, AntwortWert>): BedingungsWerte {
  return Object.fromEntries(Object.entries(antworten).map(([k, v]) => [k, { status: v.status, zahl: v.zahl, text: v.text }]))
}

/** Ampel aus den für die Tür geltenden Mängeln (neue + weiterbestehende). */
export function ampelAus(maengel: Pick<MangelKurz, 'stufe'>[]): Ampel {
  if (maengel.some((m) => m.stufe >= 3)) return 'rot'
  return maengel.length > 0 ? 'gelb' : 'gruen'
}

const RANG: Record<Ampel, number> = { gruen: 0, gelb: 1, rot: 2 }
/** Manuelles Ergebnis darf nur verschärfen. */
export function erlaubteErgebnisse(auto: Ampel): Ampel[] {
  return (['gruen', 'gelb', 'rot'] as Ampel[]).filter((a) => RANG[a] >= RANG[auto])
}

export interface Pruefstand {
  fehlendePflicht: Punkt[]
  fehlendeFotos: Punkt[]
  offeneAltmaengel: string[]
  maengelOhneBeschreibung: string[]
}

/** Was fehlt noch, bevor die Tür als geprüft abgeschlossen werden kann? */
export function pruefstand(args: {
  punkte: Punkt[]
  antworten: Record<string, AntwortWert>
  fotosJePunkt: Record<string, number>
  maengel: (MangelKurz & { beschreibung: string; fotos: number })[]
  altmaengel: string[]
  altEntscheidungen: Record<string, string>
}): Pruefstand {
  const werte = bedingungsWerte(args.antworten)
  // Wirkungen (Pflicht, Mangelstufe, Grenzwerte) sind schon angewendet
  const sichtbar = args.punkte.filter((p) => istSichtbar(p, werte, args.punkte)).map((p) => wirksam(p, werte, args.punkte))
  return {
    fehlendePflicht: sichtbar.filter((p) => p.pflicht && !istBeantwortet(p, args.antworten[p.id], args.fotosJePunkt[p.id] ?? 0)),
    fehlendeFotos: sichtbar.filter((p) => p.foto_bei_nok && mangelVorschlag(p, args.antworten[p.id]) !== null &&
      !args.maengel.some((m) => m.punkt_id === p.id && m.fotos > 0)),
    offeneAltmaengel: args.altmaengel.filter((id) => !args.altEntscheidungen[id]),
    maengelOhneBeschreibung: args.maengel.filter((m) => !m.beschreibung.trim()).map((m) => m.id),
  }
}

export function istVollstaendig(s: Pruefstand): boolean {
  return s.fehlendePflicht.length + s.fehlendeFotos.length + s.offeneAltmaengel.length + s.maengelOhneBeschreibung.length === 0
}

/** Was dem Stand noch fehlt, als Sätze für die Liste unter dem Knopf (leer = vollständig). */
export function offeneGruende(s: Pruefstand): string[] {
  const alt = s.offeneAltmaengel.length
  const ohne = s.maengelOhneBeschreibung.length
  return [
    ...s.fehlendePflicht.map((p) => t('Pflichtangabe fehlt: {punkt}', { punkt: p.text })),
    ...s.fehlendeFotos.map((p) => t('Foto zum Mangel fehlt: {punkt}', { punkt: p.text })),
    ...(alt ? [alt === 1 ? t('1 früherer Mangel noch nicht bewertet') : t('{n} frühere Mängel noch nicht bewertet', { n: alt })] : []),
    ...(ohne ? [ohne === 1 ? t('Mangel ohne Beschreibung') : t('{n} Mängel ohne Beschreibung', { n: ohne })] : []),
  ]
}

/** Gehört die Tür zum zugewiesenen Bereich? Kein Bereich = alles. */
export function imBereich(
  anlage: { gebaeude: string | null; etage: string | null },
  bereich: { gebaeude?: string; etage?: string }[] | null | undefined,
): boolean {
  if (!bereich || bereich.length === 0) return true
  return bereich.some((b) =>
    (b.gebaeude == null || b.gebaeude === (anlage.gebaeude ?? '')) && (b.etage == null || b.etage === (anlage.etage ?? '')))
}
