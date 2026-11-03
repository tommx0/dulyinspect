import { t } from './sprache'
export type RechtstextArt = 'impressum' | 'datenschutz'

export const RECHTSTEXT_TITEL: Record<RechtstextArt, string> = { impressum: t('Impressum'), datenschutz: t('Datenschutzerklärung') }

/** text = einfache Formatierung (bloecke), html = HTML (beim Anzeigen bereinigt), link = Webadresse einer externen Seite */
export type RechtstextFormat = 'text' | 'html' | 'link'

export const RECHTSTEXT_FORMATE: { wert: RechtstextFormat; text: string }[] = [
  { wert: 'text', text: t('Text mit einfacher Formatierung') },
  { wert: 'html', text: 'HTML' },
  { wert: 'link', text: t('Link auf eine externe Seite') },
]

export type Rechtstext = { format: RechtstextFormat; inhalt: string | null }

export type Block =
  | { typ: 'ueberschrift'; ebene: 2 | 3; text: string }
  | { typ: 'absatz'; zeilen: string[] }
  | { typ: 'liste'; punkte: string[] }

/**
 * Einfache Textformatierung für Impressum/Datenschutz – bewusst ohne HTML:
 * Leerzeile = neuer Absatz, „# “ / „## “ = Überschrift, „- “ = Aufzählung, Zeilenumbrüche bleiben erhalten.
 */
export function bloecke(text: string): Block[] {
  const ergebnis: Block[] = []
  for (const roh of text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const zeilen = roh.split('\n').map((z) => z.trimEnd()).filter((z) => z.trim() !== '')
    let absatz: string[] = []
    let liste: string[] = []
    const abschliessen = () => {
      if (absatz.length) ergebnis.push({ typ: 'absatz', zeilen: absatz })
      if (liste.length) ergebnis.push({ typ: 'liste', punkte: liste })
      absatz = []
      liste = []
    }
    for (const z of zeilen) {
      const u = z.match(/^\s*(#{1,3})\s+(.*)$/)
      const l = z.match(/^\s*[-*•]\s+(.*)$/)
      if (u) {
        abschliessen()
        ergebnis.push({ typ: 'ueberschrift', ebene: u[1].length === 1 ? 2 : 3, text: u[2].trim() })
      } else if (l) {
        if (absatz.length) abschliessen()
        liste.push(l[1].trim())
      } else {
        if (liste.length) abschliessen()
        absatz.push(z.trim())
      }
    }
    abschliessen()
  }
  return ergebnis
}

export type Teil = { text: string; link?: string }

/** Webadressen und E-Mail-Adressen im Text als Links erkennen. */
export function verlinken(zeile: string): Teil[] {
  const teile: Teil[] = []
  const muster = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)]|www\.[^\s<>"]+[^\s<>".,;:!?)]|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g
  let letzte = 0
  for (const m of zeile.matchAll(muster)) {
    const t = m[0]
    if (m.index > letzte) teile.push({ text: zeile.slice(letzte, m.index) })
    teile.push({ text: t, link: t.includes('@') && !t.includes('/') ? `mailto:${t}` : t.startsWith('www.') ? `https://${t}` : t })
    letzte = m.index + t.length
  }
  if (letzte < zeile.length) teile.push({ text: zeile.slice(letzte) })
  return teile
}

/** Nur eine Webadresse mit http(s):// – sonst null. */
export function alsWebadresse(text: string | null | undefined): string | null {
  const t = text?.trim() ?? ''
  return /^https?:\/\/\S+$/i.test(t) ? t : null
}

/** Ziel der Links „Impressum“/„Datenschutz“: bei Art „link“ die externe Seite, sonst null (eigene Seite in der App). */
export function linkZiel(r: Rechtstext | null | undefined): string | null {
  return r?.format === 'link' ? alsWebadresse(r.inhalt) : null
}
