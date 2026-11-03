// Türanlage (docs/KONZEPT-TUERANLAGE.md): Jedes Objekt hat genau eine Türanlage, zu der alle seine Türen gehören. Sie ist
// eine Anlage vom festen Typ TUERANLAGE_TYP ohne eigene Stammdaten; die App zeigt sie nur als Klammer der gemeinsamen Prüfung.
import { t } from './sprache'
export type TuerKurz = { id: string; etikett_id: string | null; kunden_bezeichnung: string | null; gebaeude: string | null; etage: string | null
  raum: string | null; status: 'aktiv' | 'stillgelegt'; teil_von_id: string | null }

/** Fester Anlagentyp der Türanlagen (tueranlage_typ() in der Datenbank) */
export const TUERANLAGE_TYP = '00000000-0000-4000-8000-00000000a001'

/** Ist diese Anlage die Türanlage eines Objekts? (Sie erscheint in keiner Anlagenliste.) */
export function istTueranlage(a: { anlagentyp_id: string } | null | undefined): boolean {
  return a?.anlagentyp_id === TUERANLAGE_TYP
}

/** Name der Türanlage: „Türanlage“ und der (entschlüsselte) Objektname */
export function tueranlageName(objektName: string | null | undefined): string {
  return objektName ? t('Türanlage {objekt}', { objekt: objektName }) : t('Türanlage')
}

/** Kurzname einer Tür: Etikett und Bezeichnung beim Kunden */
export function tuerName(tuer: Pick<TuerKurz, 'etikett_id' | 'kunden_bezeichnung'>): string {
  return [tuer.etikett_id, tuer.kunden_bezeichnung].filter(Boolean).join(' · ') || t('ohne Bezeichnung')
}

/**
 * Muss die Tür beim Abschluss der Türanlage fertig oder mit Grund „nicht geprüft“ sein? Ja, wenn sie beim Beginn der
 * Prüfung fällig war: noch nie geprüft oder nächste Prüfung höchstens 30 Tage nach dem Beginn (UTC-Tag wie der Server,
 * tuer_pflicht()). Nicht fällige Türen dürfen mitgeprüft werden, blockieren den Abschluss aber nicht.
 */
export function tuerPflicht(naechstePruefungAm: string | null | undefined, begonnenAm: string): boolean {
  if (!naechstePruefungAm) return true
  const grenze = new Date(new Date(begonnenAm).toISOString().slice(0, 10) + 'T00:00:00Z')
  grenze.setUTCDate(grenze.getUTCDate() + 30)
  return naechstePruefungAm.slice(0, 10) <= grenze.toISOString().slice(0, 10)
}
