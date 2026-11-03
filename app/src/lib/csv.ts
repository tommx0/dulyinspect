// CSV für Excel (deutsch): Semikolon, UTF-8 mit BOM, Werte in Anführungszeichen
// Texte, die Excel als Formel läse (= + - @, Tab, CR am Anfang), bekommen ein ' davor: Freitexte von Prüfern wie
// =HYPERLINK(…) würden sonst beim Öffnen ausgewertet. Zahlen bleiben Zahlen; der Import entfernt das ' wieder (tabelle.ts).
export const FORMEL_ANFANG = /^[=+\-@\t\r]/
export function csvText(zeilen: (string | number | null | undefined)[][]): string {
  const text = (x: string | number | null | undefined) => typeof x === 'string' && FORMEL_ANFANG.test(x) ? `'${x}` : String(x ?? '')
  const zelle = (x: string | number | null | undefined) => `"${text(x).replace(/"/g, '""')}"`
  return '﻿' + zeilen.map((z) => z.map(zelle).join(';')).join('\r\n')
}

/** Datei im Browser speichern. */
export function herunterladen(inhalt: BlobPart, name: string, typ: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([inhalt], { type: typ }))
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}
