// Offene Mängel je Anlage für die Prüfseiten: Kennzeichen in den Listen und Türen zum Nachprüfen
import { t } from './sprache'

export interface MangelKurz { anlage_id: string; stufe: number; status: string; entdeckt_in: string; nachgeprueft_in: string | null }
export interface MaengelStand { anzahl: number; stufe: number }

const offen = (m: Pick<MangelKurz, 'status'>) => m.status === 'offen' || m.status === 'behoben'

/** Offene (auch als behoben gemeldete, noch nicht nachgeprüfte) Mängel je Anlage mit der höchsten Stufe. */
export function offeneMaengelJe(maengel: MangelKurz[]): Map<string, MaengelStand> {
  const je = new Map<string, MaengelStand>()
  for (const m of maengel.filter(offen)) {
    const s = je.get(m.anlage_id)
    je.set(m.anlage_id, { anzahl: (s?.anzahl ?? 0) + 1, stufe: Math.max(s?.stufe ?? 0, m.stufe) })
  }
  return je
}

/** Mehrere Anlagen zusammen (z. B. die Türen einer Türanlage). */
export function maengelSumme(staende: (MaengelStand | undefined)[]): MaengelStand | undefined {
  const da = staende.filter((s): s is MaengelStand => !!s)
  return da.length ? { anzahl: da.reduce((n, s) => n + s.anzahl, 0), stufe: Math.max(...da.map((s) => s.stufe)) } : undefined
}

export function maengelText(s: MaengelStand): string {
  return s.anzahl === 1 ? t('1 offener Mangel') : t('{n} offene Mängel', { n: s.anzahl })
}

/**
 * Anlagen mit einem Mangel aus einer früheren Prüfung, die in dieser Prüfung (Prüfungen `hier`, bei einer Türanlage
 * ihre Teilprüfungen) nachzuprüfen sind – auch wenn er hier schon als behoben bestätigt wurde, damit die Anlage nicht
 * aus der Liste springt.
 */
export function nachzupruefen(maengel: MangelKurz[], hier: Set<string>): Set<string> {
  return new Set(maengel.filter((m) => !hier.has(m.entdeckt_in) && (offen(m) || (!!m.nachgeprueft_in && hier.has(m.nachgeprueft_in))))
    .map((m) => m.anlage_id))
}

/** Prüfung, in der ein Mangel festgestellt wurde, mit der Prüfung ihrer Türanlage (bei einer Tür) */
export interface FundPruefung { status: string; haupt?: { status: string } | null }

/**
 * Nachzuprüfen ist ein offener Mangel erst, wenn die Prüfung, die ihn festgestellt hat, abgeschlossen ist – bei einer Tür
 * auch die ihrer Türanlage. Solange sie läuft, ist er dort ein neuer Mangel. Unbekannte (ältere) Prüfung: abgeschlossen.
 */
export function ausAbgeschlossenerPruefung(fund: FundPruefung | undefined): boolean {
  return fund?.status !== 'in_pruefung' && fund?.haupt?.status !== 'in_pruefung'
}
