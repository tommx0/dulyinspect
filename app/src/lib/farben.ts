// Farbberechnungen für das Erscheinungsbild (ohne Abhängigkeiten, testbar).
import { t } from './sprache'

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function hexAus([r, g, b]: number[]): string {
  return `#${[r, g, b].map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')).join('')}`
}
/** Mischt zwei Farben (anteil = Anteil der zweiten Farbe). */
export function mischen(a: string, b: string, anteil: number): string {
  const [x, y] = [rgb(a), rgb(b)]
  return hexAus(x.map((v, i) => v + (y[i] - v) * anteil))
}
/** Kontrastverhältnis nach WCAG (1 bis 21). */
export function kontrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = rgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [h, d] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (h + 0.05) / (d + 0.05)
}
export const istFarbe = (s: string | null | undefined): s is string => !!s && /^#[0-9a-f]{6}$/i.test(s)

/** Hinweise, wenn Farben schlecht lesbar sind (Buttons: weiße Schrift auf Hauptfarbe; Akzent: Hauptfarbe auf Akzent). */
export function kontrastHinweise(marke: string, akzent: string): string[] {
  const h: string[] = []
  if (kontrast(marke, '#ffffff') < 4.5) h.push(t('Weiße Schrift auf der Hauptfarbe (Knöpfe) ist schlecht lesbar – bitte eine dunklere Hauptfarbe wählen.'))
  if (kontrast(akzent, marke) < 4.5) h.push(t('Text in der Hauptfarbe auf der Akzentfarbe (aktiver Menüpunkt) ist schlecht lesbar – bitte eine hellere Akzentfarbe wählen.'))
  return h
}

