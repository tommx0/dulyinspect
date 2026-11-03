// Natürliche Reihenfolge von Etagen: KG/UG vor EG vor 1. OG … vor DG
export function etagenRang(etage: string | null | undefined): number {
  const e = (etage ?? '').trim().toUpperCase()
  if (!e) return 500
  const zahl = Number(e.match(/-?\d+/)?.[0] ?? NaN)
  if (/^(TG|TIEFGARAGE)/.test(e)) return -20 - (Number.isFinite(zahl) ? zahl : 0)
  if (/^(KG|UG|KELLER)/.test(e)) return -10 - (Number.isFinite(zahl) ? zahl : 0)
  if (/^(EG|ERDGESCHOSS|E$)/.test(e)) return 0
  if (/OG|OBERGESCHOSS|ETAGE/.test(e) && Number.isFinite(zahl)) return zahl
  if (/^(DG|DACH)/.test(e)) return 100
  return Number.isFinite(zahl) ? zahl : 200
}

/** Sortierschlüssel für Türen: Gebäude, Etage (natürlich), Bezeichnung. */
export function anlageVergleich(
  a: { gebaeude?: string | null; etage?: string | null; bezeichnung?: string | null },
  b: { gebaeude?: string | null; etage?: string | null; bezeichnung?: string | null },
): number {
  return (a.gebaeude ?? '').localeCompare(b.gebaeude ?? '', 'de', { numeric: true })
    || etagenRang(a.etage) - etagenRang(b.etage)
    || (a.bezeichnung ?? '').localeCompare(b.bezeichnung ?? '', 'de', { numeric: true })
}

/**
 * Vergleich nach Name für Kunden und Objekte. Ihre Namen sind in der Datenbank verschlüsselt (docs/KONZEPT-VERSCHLUESSELUNG.md,
 * „Suche und Sortierung“), der Server kann nicht danach sortieren: der Browser sortiert nach dem Entschlüsseln.
 */
export function nameVergleich(a: { name?: string | null }, b: { name?: string | null }): number {
  return (a.name ?? '').localeCompare(b.name ?? '', 'de', { sensitivity: 'base', numeric: true })
}

/** Kopie der Liste, nach Name sortiert (siehe nameVergleich). */
export function nachName<T extends { name?: string | null }>(liste: readonly T[]): T[] {
  return [...liste].sort(nameVergleich)
}
