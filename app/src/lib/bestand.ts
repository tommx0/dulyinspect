// Bestand je Objekt (docs/KONZEPT-BESTAND-JE-OBJEKT.md): Rauchwarnmelder und ortsveränderliche Geräte haben keine zentralen
// Bauteile. Je Objekt und Art gibt es eine Anlage ohne Stammdaten; fällig ist sie, sobald eines ihrer Elemente fällig ist.
import { ARTEN, type ArtSchluessel } from './anlagenarten'
import { md5 } from './md5'
import { tuerPflicht } from './tueranlage'

/** Hat die Art einen Bestand je Objekt statt einzelner Anlagen? */
export function istBestandArt(art: string | null | undefined): boolean {
  return !!art && !!ARTEN[art as ArtSchluessel]?.bestand
}

/** ID des Bestands eines Objekts (wie bestand_id() in der Datenbank) */
export function bestandId(objektId: string, art: string): string {
  const h = md5(`bestand:${art}:${objektId}`)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export type ElementStand = { geprueft_je_pruefart?: unknown; erstellt_am?: string | null }

/** Tag der letzten Prüfung des Elements in dieser Prüfart (ohne „nicht zugänglich“), sonst null */
export function elementGeprueftAm(e: ElementStand, pruefartId: string): string | null {
  const stand = e.geprueft_je_pruefart
  const wert = stand && typeof stand === 'object' ? (stand as Record<string, unknown>)[pruefartId] : null
  return typeof wert === 'string' ? wert.slice(0, 10) : null
}

/** Nächste Prüfung des Elements in dieser Prüfart; null = noch nie geprüft (sofort fällig) */
export function elementNaechste(e: ElementStand, pruefartId: string, monate: number): string | null {
  const am = elementGeprueftAm(e, pruefartId)
  if (!am) return null
  const d = new Date(`${am}T00:00:00Z`)
  const tag = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + monate)
  // wie Postgres: 31.01. + 1 Monat = 28./29.02.
  d.setUTCDate(Math.min(tag, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()))
  return d.toISOString().slice(0, 10)
}

/** Ist das Element bei einer Prüfung, die am `begonnenAm` begann, fällig (Pflicht)? Wie die Türen der Türanlage. */
export function elementFaellig(e: ElementStand, pruefartId: string, monate: number, begonnenAm: string): boolean {
  return tuerPflicht(elementNaechste(e, pruefartId, monate), begonnenAm)
}

/**
 * Aktive Elemente, die nach dem Ende einer Prüfung angelegt wurden und in ihrer Prüfart noch nie geprüft sind: fällig,
 * obwohl der Bestand heute schon geprüft ist (z. B. Melder, die nach der Erstinstallation dazukamen). `mitErgebnis`: in
 * dieser Prüfung erfasste Elemente – offline angelegte erhalten ihr `erstellt_am` erst beim Hochladen vom Server.
 */
export function nachPruefungAngelegt<E extends ElementStand & { id: string; aktiv: boolean; erstellt_am: string }>(
  elemente: E[], p: { pruefart_id: string | null; abgeschlossen_am: string | null; beendet_am: string | null },
  mitErgebnis: ReadonlySet<string> = new Set(),
): E[] {
  // Ende der Prüfung auf dem Gerät (der Abschluss beim Server kann bei offline Arbeit später liegen)
  const ende = Date.parse(p.beendet_am ?? p.abgeschlossen_am ?? '')
  if (Number.isNaN(ende)) return []
  // Zeitstempel als Zeitpunkte vergleichen: der Server liefert „+00:00“ und Mikrosekunden, das Gerät „Z“
  return elemente.filter((e) => e.aktiv && Date.parse(e.erstellt_am) > ende && !mitErgebnis.has(e.id)
    && !(p.pruefart_id && elementGeprueftAm(e, p.pruefart_id)))
}
