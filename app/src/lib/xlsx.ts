// Excel-Dateien (.xlsx) schreiben – ohne zusätzliche Bibliothek (xlsx = ZIP mit XML, fflate ist schon da).
// Gegenstück zum Lesen: import/tabelle.ts
import { strToU8, zipSync } from 'fflate'
import { t } from './sprache'

export type Wert = string | number | null | undefined
/** Auswahlliste (Dropdown) für eine Spalte ab Zeile 2, z. B. die Melderarten. Andere Eingaben bleiben erlaubt. */
export type Auswahl = { spalte: number; werte: string[] }

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const KOPF = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const MAX_ZEILE = 2000

/** "A", "B", … "Z", "AA" … */
function spalte(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

// Steuerzeichen sind in XML nicht erlaubt (außer Tab und Zeilenumbruch)
// eslint-disable-next-line no-control-regex
const xml = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function zelle(wert: Wert, ref: string, fett: boolean): string {
  const stil = fett ? ' s="1"' : ''
  if (typeof wert === 'number' && Number.isFinite(wert)) return `<c r="${ref}"${stil}><v>${wert}</v></c>`
  const text = String(wert ?? '')
  if (text === '') return fett ? `<c r="${ref}"${stil}/>` : ''
  return `<c r="${ref}"${stil} t="inlineStr"><is><t xml:space="preserve">${xml(text.slice(0, 32767))}</t></is></c>`
}

function blatt(zeilen: Wert[][], optionen: { kopfzeile: boolean; auswahl: { spalte: number; bereich: string }[] }): string {
  const spalten = Math.max(1, ...zeilen.map((z) => z.length))
  const breiten = Array.from({ length: spalten }, (_, i) =>
    Math.min(60, Math.max(10, ...zeilen.slice(0, 500).map((z) => String(z[i] ?? '').length + 2))))
  const fixiert = optionen.kopfzeile
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : ''
  const cols = `<cols>${breiten.map((b, i) => `<col min="${i + 1}" max="${i + 1}" width="${b}" customWidth="1"/>`).join('')}</cols>`
  const daten = zeilen.map((z, r) => `<row r="${r + 1}">${z.map((w, c) => zelle(w, `${spalte(c)}${r + 1}`, optionen.kopfzeile && r === 0)).join('')}</row>`).join('')
  const listen = optionen.auswahl.length
    ? `<dataValidations count="${optionen.auswahl.length}">${optionen.auswahl.map((a) => {
      const s = spalte(a.spalte)
      return `<dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="${s}2:${s}${MAX_ZEILE}"><formula1>${a.bereich}</formula1></dataValidation>`
    }).join('')}</dataValidations>`
    : ''
  return `${KOPF}<worksheet ${NS}>${fixiert}${cols}<sheetData>${daten}</sheetData>${listen}</worksheet>`
}

/**
 * Tabelle als .xlsx-Datei. Erste Zeile = Überschriften (fett, fixiert). Zahlen bleiben Zahlen, alles andere wird Text.
 * Auswahllisten stehen auf einem ausgeblendeten zweiten Blatt „Listen“ – beim Einlesen zählt nur das erste Blatt.
 */
export function xlsxErzeugen(zeilen: Wert[][], optionen: { blattName?: string; auswahl?: Auswahl[] } = {}): Uint8Array {
  const name = xml((optionen.blattName ?? t('Tabelle')).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31))
  const auswahl = (optionen.auswahl ?? []).filter((a) => a.werte.length > 0)
  const mitListen = auswahl.length > 0
  const dateien: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`${KOPF}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + (mitListen ? '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' : '')
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '</Types>'),
    '_rels/.rels': strToU8(`${KOPF}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>'),
    'xl/workbook.xml': strToU8(`${KOPF}<workbook ${NS}><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/>`
      + (mitListen ? '<sheet name="Listen" sheetId="2" state="hidden" r:id="rId2"/>' : '')
      + '</sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8(`${KOPF}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      + (mitListen ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' : '')
      + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + '</Relationships>'),
    'xl/styles.xml': strToU8(`${KOPF}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
      + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
      + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
      + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
      + '</styleSheet>'),
    'xl/worksheets/sheet1.xml': strToU8(blatt(zeilen, {
      kopfzeile: true,
      auswahl: auswahl.map((a, i) => ({ spalte: a.spalte, bereich: `Listen!$${spalte(i)}$1:$${spalte(i)}$${a.werte.length}` })),
    })),
  }
  if (mitListen) {
    const hoehe = Math.max(...auswahl.map((a) => a.werte.length))
    const listen = Array.from({ length: hoehe }, (_, r) => auswahl.map((a) => a.werte[r] ?? ''))
    dateien['xl/worksheets/sheet2.xml'] = strToU8(blatt(listen, { kopfzeile: false, auswahl: [] }))
  }
  return zipSync(dateien)
}
