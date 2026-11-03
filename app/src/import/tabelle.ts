// Tabellen aus CSV- und Excel-Dateien (.xlsx) lesen – ohne zusätzliche Bibliothek (xlsx = ZIP mit XML, fflate ist schon da).
import { strFromU8, unzipSync } from 'fflate'
import { FORMEL_ANFANG } from '../lib/csv'
import { t } from '../lib/sprache'

export type Tabelle = string[][]

/** Datei als Tabelle lesen (Endung entscheidet). Leere Zeilen werden entfernt, Zellen getrimmt. */
export function tabelleLesen(name: string, bytes: Uint8Array): Tabelle {
  const roh = /\.xlsx$/i.test(name) ? xlsxLesen(bytes) : csvLesen(textDekodieren(bytes)).map((z) => z.map(formelSchutzWeg))
  return roh.map((z) => z.map((c) => c.trim())).filter((z) => z.some((c) => c !== ''))
}

/** ' vor Formelzeichen, das csvText beim Export setzt, beim Wiedereinlesen entfernen */
function formelSchutzWeg(c: string): string {
  return c.startsWith("'") && FORMEL_ANFANG.test(c.slice(1)) ? c.slice(1) : c
}

/** UTF-8 (mit/ohne BOM); Excel speichert CSV unter Windows oft als Windows-1252 – dann so lesen. */
export function textDekodieren(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/** CSV mit automatisch erkanntem Trennzeichen (; , oder Tab), Anführungszeichen und Zeilenumbrüchen in Zellen. */
export function csvLesen(text: string): Tabelle {
  const ersteZeile = text.split(/\r?\n/, 1)[0] ?? ''
  const trenner = [';', '\t', ','].map((t) => [t, ersteZeile.split(t).length] as const).sort((a, b) => b[1] - a[1])[0][0]
  const zeilen: Tabelle = []
  let zeile: string[] = []
  let zelle = ''
  let inZitat = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inZitat) {
      if (c === '"' && text[i + 1] === '"') { zelle += '"'; i++ }
      else if (c === '"') inZitat = false
      else zelle += c
    } else if (c === '"' && zelle === '') inZitat = true
    else if (c === trenner) { zeile.push(zelle); zelle = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      zeile.push(zelle); zeilen.push(zeile); zeile = []; zelle = ''
    } else zelle += c
  }
  if (zelle !== '' || zeile.length) { zeile.push(zelle); zeilen.push(zeile) }
  return zeilen
}

/** Erstes Tabellenblatt einer .xlsx-Datei. Datumszellen liefern die Excel-Seriennummer (Umrechnung beim Import). */
export function xlsxLesen(bytes: Uint8Array): Tabelle {
  let dateien: Record<string, Uint8Array>
  try {
    dateien = unzipSync(bytes)
  } catch {
    throw new Error(t('Die Datei ist keine gültige Excel-Datei (.xlsx). Ältere .xls-Dateien bitte in Excel als .xlsx oder CSV speichern.'))
  }
  const lesen = (pfad: string) => (dateien[pfad] ? strFromU8(dateien[pfad]) : '')
  if (!dateien['xl/workbook.xml']) throw new Error(t('Die Datei ist keine gültige Excel-Datei (.xlsx).'))

  // Pfad des ersten Blatts über workbook.xml + Beziehungen ermitteln
  const blatt = lesen('xl/workbook.xml').match(/<(?:\w+:)?sheet\b[^>]*>/)
  if (!blatt) throw new Error(t('Die Excel-Datei enthält kein Tabellenblatt.'))
  const relId = attribute(blatt[0])['r:id']
  let pfad = 'xl/worksheets/sheet1.xml'
  for (const r of lesen('xl/_rels/workbook.xml.rels').match(/<(?:\w+:)?Relationship\b[^>]*>/g) ?? []) {
    const a = attribute(r)
    if (a.Id === relId && a.Target) pfad = a.Target.startsWith('/') ? a.Target.slice(1) : `xl/${a.Target.replace(/^\.\//, '')}`
  }

  const texte = [...lesen('xl/sharedStrings.xml').matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((m) => textInhalt(m[1]))

  const tabelle: Tabelle = []
  for (const row of lesen(pfad).matchAll(/<(?:\w+:)?row\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
    const zeile: string[] = []
    for (const c of (row[1] ?? '').matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const a = attribute(c[1])
      const inhalt = c[2] ?? ''
      const v = entschluesseln(inhalt.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1] ?? '')
      let wert = v
      if (a.t === 's') wert = texte[Number(v)] ?? ''
      else if (a.t === 'inlineStr') wert = textInhalt(inhalt)
      else if (a.t === 'b') wert = v === '1' ? 'WAHR' : 'FALSCH'
      const spalte = spaltenIndex(a.r ?? '') ?? zeile.length
      while (zeile.length < spalte) zeile.push('')
      zeile[spalte] = wert
    }
    tabelle.push(zeile)
  }
  return tabelle
}

function attribute(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1], entschluesseln(m[2])]))
}

/** Text aller <t>-Elemente (Rich-Text-Teile aneinander, Lautschrift <rPh> ignorieren). */
function textInhalt(xml: string): string {
  return [...xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '').matchAll(/<(?:\w+:)?t\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g)]
    .map((m) => entschluesseln(m[1] ?? '')).join('')
}

function entschluesseln(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()]
  })
}

/** "C7" → 2 */
function spaltenIndex(ref: string): number | null {
  const m = ref.match(/^([A-Z]+)\d+$/)
  if (!m) return null
  return [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
}
