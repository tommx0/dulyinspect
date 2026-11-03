// Dauerscan: viele Melder nacheinander scannen. Jeder gelesene Code wird hier einem Eintrag der Ergebnisliste zugeordnet.
import type { ElementDefinition } from '../lib/anlagenarten'
import { naechsteNummer, schreibweiseAngleichen, typenVorhanden, type ElementVorgabe } from '../lib/elemente'
import { scanAuswerten, type CodeErgebnis } from '../lib/herstellercode'
import { codeSuchen, elementAnlegen, elementeIo } from './aktionen'
import { db, type Element, type Pruefung } from './db'
import { t } from '../lib/sprache'

export type DauerEintrag =
  | { art: 'melder'; schluessel: string; code: string; element: Element; neu: boolean }
  | { art: 'unbekannt'; schluessel: string; code: string; scan: CodeErgebnis }
  | { art: 'hinweis'; schluessel: string; text: string }

export interface DauerKontext {
  anlageId: string
  pruefung: Pruefung
  def: ElementDefinition
  /** Aktive und stillgelegte Elemente der Anlage inkl. der in diesem Durchgang neu angelegten */
  elemente: Element[]
  /** Unbekannte Codes sofort als neue Melder anlegen (Erstinstallation) */
  anlegen: boolean
  /** Wohnung / Bereich für neu angelegte Melder */
  wohnung: string | null
  /** Art, Ort, Typ und Eigenschaften neu angelegter Melder (z. B. Einbaudatum, Austauschdatum); Typ und Seriennummer aus dem Code gehen vor */
  vorgabe: ElementVorgabe
  /** Gescannte Melder gleich auf „i.O.“ setzen (nur wenn der Testalarm schon ausgelöst wurde) */
  sofortIo: boolean
  nurLesen: boolean
}

/**
 * Einen gelesenen Text verarbeiten. Liefert den Eintrag für die Ergebnisliste oder null (leerer Scan).
 * Ohne Eingaben des Prüfers gilt: Bekannte Melder werden nur angezeigt, nichts wird als geprüft eingetragen.
 */
export async function dauerscanVerarbeiten(inhalt: string, k: DauerKontext): Promise<DauerEintrag | null> {
  const r = scanAuswerten(inhalt)
  if (r.art === 'leer') return null
  const hinweis = (schluessel: string, text: string): DauerEintrag => ({ art: 'hinweis', schluessel, text })
  if (r.art === 'etikett') return hinweis(`e:${r.etikett}`, t('{etikett} ist ein Etikett einer Anlage, kein Code eines {element}s.', { etikett: r.etikett, element: k.def.einzahl }))

  const schluessel = r.code.toLowerCase()
  const treffer = await codeSuchen(r.code)
  if (treffer) {
    if (treffer.anlageId !== k.anlageId) {
      const bezeichnung = `${k.def.einzahl} ${treffer.nummer}${treffer.gruppe ? ` (${k.def.gruppe} ${treffer.gruppe})` : ''}`
      return hinweis(schluessel, t('Dieser Code gehört zu {element} in der Anlage „{anlage}“, nicht zu dieser.', { element: bezeichnung, anlage: treffer.anlage || t('andere Anlage') }))
    }
    const element = k.elemente.find((e) => e.id === treffer.elementId) ?? await db.elemente.get(treffer.elementId)
    if (!element) return hinweis(schluessel, t('Der Melder zu diesem Code wurde auf diesem Gerät nicht gefunden. Bitte die Anlage neu laden.'))
    if (k.sofortIo && !k.nurLesen) await elementeIo(k.pruefung, [element])
    return { art: 'melder', schluessel, code: r.code, element, neu: false }
  }

  if (k.anlegen && !k.nurLesen) {
    const gruppe = k.wohnung?.trim() || null
    const v = k.vorgabe
    const element = await elementAnlegen(k.anlageId, {
      nummer: naechsteNummer(k.elemente, gruppe), gruppe, elementart: v.elementart ?? k.def.arten[0]?.schluessel ?? null, ort: v.ort,
      typ: schreibweiseAngleichen([r.hersteller, r.modell].filter(Boolean).join(' '), typenVorhanden(k.elemente)) ?? v.typ, code: r.code,
      eigenschaften: { ...v.eigenschaften, ...(r.seriennummer ? { seriennummer: r.seriennummer } : {}) },
    })
    if (k.sofortIo) await elementeIo(k.pruefung, [element])
    return { art: 'melder', schluessel, code: r.code, element, neu: true }
  }
  return { art: 'unbekannt', schluessel, code: r.code, scan: r }
}
