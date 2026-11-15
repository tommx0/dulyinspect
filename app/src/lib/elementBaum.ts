// Baumansicht der Elemente einer Anlage: Anlage → Gruppen (Meldergruppen / Linien, Stromkreise …) → Elemente (Melder …).
// Reine Logik ohne Oberfläche, damit sie sich testen lässt (src/components/ElementBaum.tsx zeichnet den Baum).
import { elementVergleich, freieNummern, gruppenListe, naechsteNummer, nummernReihe, type ElementKurz } from './elemente'

type Kurz = Pick<ElementKurz, 'id' | 'gruppe' | 'nummer' | 'aktiv'>

export interface Ast<E extends Kurz> {
  /** null = Elemente ohne Gruppe */
  name: string | null
  elemente: E[]
  /** aktive Elemente im Ast (auch wenn stillgelegte nicht gezeigt werden) */
  aktiv: number
}

/**
 * Äste des Baums: jede angelegte oder verwendete Gruppe der Reihe nach (Linie 2 vor Linie 10), darin die Elemente nach
 * Nummer. Elemente ohne Gruppe bilden einen eigenen Ast am Ende, aber nur, wenn es solche gibt.
 */
export function baumAeste<E extends Kurz>(gruppen: string[], elemente: E[], stillgelegte: boolean): Ast<E>[] {
  const sichtbar = elemente.filter((e) => stillgelegte || e.aktiv)
  const namen = gruppenListe(gruppen, sichtbar)
  const aeste: Ast<E>[] = namen.map((name) => ({ name, elemente: [], aktiv: 0 }))
  const je = new Map(aeste.map((a) => [a.name, a]))
  let ohne: Ast<E> | null = null
  for (const e of elemente) {
    const ast = e.gruppe ? je.get(e.gruppe) : (ohne ??= { name: null, elemente: [], aktiv: 0 })
    if (!ast) continue
    if (e.aktiv) ast.aktiv++
    if (stillgelegte || e.aktiv) ast.elemente.push(e)
  }
  for (const a of aeste) a.elemente.sort(elementVergleich)
  if (ohne && ohne.elemente.length) {
    ohne.elemente.sort(elementVergleich)
    aeste.push(ohne)
  }
  return aeste
}

/**
 * Vorschlag für den Namen der nächsten Gruppe: der höchste Name mit Zahl am Ende zählt hoch („Linie 9“ → „Linie 10“,
 * „03“ → „04“); ohne Gruppen „1“. Liefert nie einen vorhandenen Namen.
 */
export function naechsterGruppenName(namen: string[]): string {
  let hoechste: { zahl: number; text: string } | null = null
  for (const n of namen) {
    const m = n.trim().match(/^(.*?)(\d+)$/)
    if (m && (!hoechste || Number(m[2]) > hoechste.zahl)) hoechste = { zahl: Number(m[2]), text: n.trim() }
  }
  const belegt = new Set(namen.map((n) => n.trim().toLowerCase()))
  let vorschlag = hoechste ? nummernReihe(hoechste.text, 2)![1] : '1'
  while (belegt.has(vorschlag.toLowerCase())) vorschlag = nummernReihe(vorschlag, 2)![1]
  return vorschlag
}

/** Nummern für `anzahl` neue Elemente am Ende einer Gruppe: ab der höchsten Nummer + 1, belegte werden übersprungen. */
export function nummernZumAnhaengen(elemente: Kurz[], gruppe: string | null, anzahl: number): string[] {
  return freieNummern(elemente, gruppe, naechsteNummer(elemente, gruppe), anzahl) ?? []
}

/**
 * Nummer eines Elements, das in eine andere Gruppe gezogen wird: es behält seine Nummer, wenn sie dort frei ist,
 * sonst bekommt es die nächste am Ende der Gruppe.
 */
export function nummerBeimVerschieben(elemente: Kurz[], element: Kurz, ziel: string | null): string {
  const andere = elemente.filter((e) => e.id !== element.id)
  const belegt = andere.some((e) => e.aktiv && (e.gruppe ?? null) === ziel && e.nummer.trim().toLowerCase() === element.nummer.trim().toLowerCase())
  return belegt ? naechsteNummer(andere, ziel) : element.nummer
}
