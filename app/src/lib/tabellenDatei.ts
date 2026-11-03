// Tabellen als Excel- oder CSV-Datei herunterladen (Exporte und leere Vorlagen zum Einlesen).
import { csvText, herunterladen } from './csv'
import { loggen } from './log'
import { xlsxErzeugen, type Auswahl, type Wert } from './xlsx'

export type Format = 'xlsx' | 'csv'
export type { Auswahl, Wert }

/** `name` ohne Endung; Sonderzeichen werden für den Dateinamen ersetzt. */
export function tabelleHerunterladen(zeilen: Wert[][], name: string, format: Format, optionen: { blattName?: string; auswahl?: Auswahl[] } = {}) {
  const datei = name.replace(/[^\wäöüÄÖÜß.-]+/g, '_')
  if (format === 'xlsx') {
    herunterladen(xlsxErzeugen(zeilen, optionen) as BlobPart, `${datei}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  } else {
    herunterladen(csvText(zeilen), `${datei}.csv`, 'text/csv;charset=utf-8')
  }
  void loggen('Datei heruntergeladen', `${datei}.${format} (${Math.max(zeilen.length - 1, 0)} Zeilen)`)
}
