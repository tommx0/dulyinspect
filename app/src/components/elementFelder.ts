// Formularfelder für die besonderen Felder eines Elements (anlage_element.eigenschaften), z. B. Seriennummer eines Melders.
import { feldText, monatEingabe, monatsende, type ArtFeld, type Eigenschaften, type ElementDefinition } from '../lib/anlagenarten'
import { ersteFreieNummer, schreibweiseAngleichen, type ElementKurz, type ElementVorgabe } from '../lib/elemente'
import { t } from '../lib/sprache'
import type { FeldDef } from './Formular'

/** Vorsilbe der Formularfelder, damit sie nicht mit den allgemeinen Feldern (Nummer, Ort …) kollidieren. */
export const EIG = 'eig.'

const JA_NEIN = [{ wert: 'ja', text: t('ja') }, { wert: 'nein', text: t('nein') }]

export function eigenschaftFelder(felder: ArtFeld[]): FeldDef[] {
  return felder.map((f): FeldDef => ({
    name: EIG + f.schluessel, label: f.text, hinweis: f.hinweis,
    ...(f.typ === 'datum' ? { typ: 'date' } : f.typ === 'monat' ? { typ: 'month' } : f.typ === 'zahl' ? { typ: 'number' }
      : f.typ === 'ja_nein' ? { typ: 'select', optionen: JA_NEIN }
        : f.typ === 'auswahl' ? { typ: 'select', optionen: (f.optionen ?? []).map((o) => ({ wert: o, text: t(o) })) } : {}),
  }))
}

/** Gespeicherte Eigenschaften → Startwerte des Formulars. */
export function eigenschaftenStart(felder: ArtFeld[], eigenschaften: Eigenschaften): Record<string, unknown> {
  const w: Record<string, unknown> = {}
  for (const f of felder) {
    const v = eigenschaften[f.schluessel]
    if (v == null || v === '') continue
    w[EIG + f.schluessel] = f.typ === 'monat' ? monatEingabe(v) : f.typ === 'ja_nein' ? (v === true || v === 'ja' ? 'ja' : 'nein') : v
  }
  return w
}

/** Formularwerte → Eigenschaften zum Speichern (leere Felder entfallen). Bei ungültigem Monat eine Fehlermeldung. */
export function eigenschaftenAusWerten(felder: ArtFeld[], w: Record<string, unknown>): { eigenschaften: Eigenschaften } | { fehler: string } {
  const eigenschaften: Eigenschaften = {}
  for (const f of felder) {
    const v = w[EIG + f.schluessel]
    if (v == null || v === '') continue
    if (f.typ === 'monat') {
      const ende = monatsende(String(v))
      if (!ende) return { fehler: t('{feld}: bitte Monat und Jahr angeben, z. B. 06-2037.', { feld: f.text }) }
      eigenschaften[f.schluessel] = ende
    } else eigenschaften[f.schluessel] = f.typ === 'zahl' ? Number(v) : String(v)
  }
  return { eigenschaften }
}

/** Auswahl „Eigener Name …“ bzw. „Neuer Typ / Hersteller …“ im Feld Typ; der Name steht dann im Textfeld `typ`. */
export const EIGENER_TYP = '__eigen__'

/** Einträge der Typ-Auswahl: die festen der Art (z. B. „Stromkreis“), dann die in der Anlage schon verwendeten. */
function typOptionen(def: ElementDefinition, vorhandene: string[]): string[] {
  const fest = def.typ?.optionen ?? []
  return [...fest, ...vorhandene.filter((v) => !fest.includes(schreibweiseAngleichen(v, fest)!))]
}

/**
 * Feld Typ: Auswahl aus den festen Typen der Art und den Typen, die in der Anlage schon vorkommen (`vorhandene`, aus
 * typenVorhanden), dazu ein Eintrag für einen neuen Namen. Gibt es nichts zur Auswahl, gleich das Textfeld „Typ / Hersteller“.
 */
export function typFelder(def: ElementDefinition, w: Record<string, unknown>, vorhandene: string[] = []): FeldDef[] {
  const optionen = typOptionen(def, vorhandene)
  const label = def.typ?.text ?? t('Typ / Hersteller')
  if (!optionen.length) return [{ name: 'typ', label, breit: true }]
  return [
    { name: 'typ_wahl', label, typ: 'select', breit: !def.typ,
      optionen: [...optionen.map((o) => ({ wert: o, text: t(o) })), { wert: EIGENER_TYP, text: def.typ ? t('Eigener Name …') : t('Neuer Typ / Hersteller …') }] },
    ...(w.typ_wahl === EIGENER_TYP ? [{ name: 'typ', label: def.typ ? t('Eigener Name') : t('Neuer Typ / Hersteller'), pflicht: true, breit: !def.typ } as FeldDef] : []),
  ]
}

/** Gespeicherter Typ → Startwerte. Neue Elemente bekommen die erste feste Option, sonst bleibt die Auswahl leer;
 *  ein Typ außerhalb der Auswahl erscheint als eigener Name. */
export function typStart(def: ElementDefinition, typ: string | null, neu: boolean, vorhandene: string[] = []): Record<string, unknown> {
  const optionen = typOptionen(def, vorhandene)
  if (!optionen.length) return { typ }
  const s = schreibweiseAngleichen(typ, optionen)
  if (!s) return { typ_wahl: neu && def.typ ? def.typ.optionen[0] : '' }
  return optionen.includes(s) ? { typ_wahl: s } : { typ_wahl: EIGENER_TYP, typ: s }
}

/** Formularwerte → Typ zum Speichern. Ein neuer Name, den es in anderer Schreibweise schon gibt, wird angeglichen. */
export function typAusWerten(def: ElementDefinition, w: Record<string, unknown>, vorhandene: string[] = []): string | null {
  const wahl = w.typ_wahl as string | null | undefined
  if (wahl === undefined || wahl === EIGENER_TYP) return schreibweiseAngleichen((w.typ as string | null) ?? null, typOptionen(def, vorhandene))
  return wahl || null
}

const vorgabeEigenschaften = (def: ElementDefinition) => def.felder.filter((f) => !f.einzeln)

/** Felder der Vorgaben: Art, Ort, Typ und die besonderen Felder außer den je Element verschiedenen (Seriennummer). */
export function vorgabeFelder(def: ElementDefinition, w: Record<string, unknown>, vorhandeneTypen: string[] = []): FeldDef[] {
  return [
    { name: 'elementart', label: t('Art'), typ: 'select', pflicht: true, optionen: def.arten.map((x) => ({ wert: x.schluessel, text: x.name })) },
    { name: 'ort', label: def.ort ?? t('Ort'), breit: true },
    ...typFelder(def, w, vorhandeneTypen),
    ...eigenschaftFelder(vorgabeEigenschaften(def)),
  ]
}

/** Formularwerte → Vorgaben. Bei ungültigem Monat eine Fehlermeldung. */
export function vorgabeAusWerten(def: ElementDefinition, w: Record<string, unknown>, vorhandeneTypen: string[] = []): ElementVorgabe | { fehler: string } {
  const e = eigenschaftenAusWerten(vorgabeEigenschaften(def), w)
  if ('fehler' in e) return e
  return { elementart: (w.elementart as string | null) ?? null, ort: (w.ort as string | null) ?? null, typ: typAusWerten(def, w, vorhandeneTypen), eigenschaften: e.eigenschaften }
}

/** Kurzfassung der Vorgaben, z. B. „Rauchwarnmelder · Austauschdatum (laut Aufkleber): 06-2037 · Funkvernetzt: ja“. */
export function vorgabeText(def: ElementDefinition, v: ElementVorgabe): string {
  return [
    def.arten.find((x) => x.schluessel === v.elementart)?.name, v.ort, v.typ,
    ...vorgabeEigenschaften(def).map((f) => { const w = feldText(f, v.eigenschaften[f.schluessel]); return w && `${f.text}: ${w}` }),
  ].filter(Boolean).join(' · ')
}

/** Knopf am Feld Nummer: trägt die erste freie Nummer der eingegebenen Gruppe ein. Sie steht auch schon beim Öffnen im Feld
 *  und wechselt mit der Gruppe, solange die Nummer nicht von Hand geändert wurde. */
export function ersteFreieKnopf(elemente: Pick<ElementKurz, 'gruppe' | 'nummer' | 'aktiv'>[]): FeldDef['knopf'] {
  return { text: t('Erste freie Nr.'), wert: (w) => ersteFreieNummer(elemente, String(w.gruppe ?? '').trim() || null), vorbelegen: true }
}
