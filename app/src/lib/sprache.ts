// Sprache der Oberfläche: Deutsch (Quelle) oder Englisch.
// Der deutsche Text ist der Schlüssel: t('Prüfung abschließen') liefert auf Englisch den Eintrag aus src/i18n/en, sonst den
// deutschen Text. Platzhalter in geschweiften Klammern: t('{n} von {m} erledigt', { n, m }).
// Welche Sprache gilt: Wahl auf diesem Gerät (Deutsch, English oder automatisch), automatisch nach der Browsersprache –
// beginnt sie mit „de“, Deutsch, sonst Englisch. Nach dem Umschalten lädt die App neu (wie beim Wechsel der Anlagenarten).
// Inhalte des Betriebs (Checklisten, Anlagentypen, Mängeltexte, Firmendaten, Rechtstexte) bleiben, wie sie eingegeben sind.
import { EN } from '../i18n/en'

export type Sprache = 'de' | 'en'
export type SpracheWahl = Sprache | 'auto'

const SPEICHER = 'tuerpruefung:sprache'

/** Browsersprache(n) → Sprache der App */
export function erkannteSprache(sprachen: readonly string[] = globalThis.navigator?.languages ?? [globalThis.navigator?.language ?? 'de']): Sprache {
  const erste = sprachen.find(Boolean) ?? 'de'
  return erste.toLowerCase().startsWith('de') ? 'de' : 'en'
}

export function spracheWahl(): SpracheWahl {
  try {
    const w = localStorage.getItem(SPEICHER)
    return w === 'de' || w === 'en' ? w : 'auto'
  } catch { return 'auto' }
}

// Unit-Tests laufen in einer englischen Umgebung (jsdom), prüfen aber die deutschen Texte
let aktuell: Sprache = import.meta.env?.MODE === 'test' ? 'de' : (() => { const w = spracheWahl(); return w === 'auto' ? erkannteSprache() : w })()

export function sprache(): Sprache {
  return aktuell
}

/** Sprache für Datum und Zahlen (Intl) */
export function gebietsschema(s: Sprache = aktuell): string {
  return s === 'de' ? 'de-DE' : 'en-GB'
}

/** Wahl auf diesem Gerät speichern und die App neu laden. */
export function spracheSetzen(wahl: SpracheWahl) {
  try {
    if (wahl === 'auto') localStorage.removeItem(SPEICHER)
    else localStorage.setItem(SPEICHER, wahl)
  } catch { /* Speicher gesperrt: gilt bis zum Neuladen */ }
  aktuell = wahl === 'auto' ? erkannteSprache() : wahl
  document.documentElement.lang = aktuell
  window.location.reload()
}

/** Nur für Tests */
export function spracheFestlegen(s: Sprache) {
  aktuell = s
}

export type Werte = Record<string, string | number | null | undefined>

function einsetzen(text: string, werte?: Werte): string {
  if (!werte) return text
  return text.replace(/\{(\w+)\}/g, (ganz, name: string) => (name in werte ? String(werte[name] ?? '') : ganz))
}

/** Text in einer bestimmten Sprache (z. B. Protokolle in der Sprache der Instanz) */
export function tIn(s: Sprache, text: string, werte?: Werte): string {
  return einsetzen(s === 'en' ? EN[text] ?? text : text, werte)
}

/** Text der Oberfläche in der aktuellen Sprache */
export function t(text: string, werte?: Werte): string {
  return tIn(aktuell, text, werte)
}

/** Ganzer Satz aus der Datenbank oder vom Server (feste deutsche Meldung): übersetzen, wenn bekannt */
export function tMeldung(text: string): string {
  if (aktuell === 'de' || !text) return text
  if (EN[text]) return EN[text]
  // Meldungen mit Werten: Muster im Wörterbuch mit {…} (z. B. „Die Tür {x} ist gesperrt“)
  for (const [de, en] of muster()) {
    const m = de.re.exec(text)
    if (m) return einsetzen(en, Object.fromEntries(de.namen.map((n, i) => [n, m[i + 1]])))
  }
  return text
}

type Muster = [{ re: RegExp; namen: string[] }, string]
let musterCache: { anzahl: number; liste: Muster[] } | null = null

/** Einträge mit Platzhaltern als reguläre Ausdrücke (einmal je Stand des Wörterbuchs) */
function muster(): Muster[] {
  const anzahl = Object.keys(EN).length
  if (musterCache?.anzahl === anzahl) return musterCache.liste
  const liste = Object.entries(EN)
    .filter(([de]) => /\{\w+\}/.test(de))
    .map(([de, en]): Muster => {
      const namen: string[] = []
      const quelle = de.split(/(\{\w+\})/).map((teil) => {
        const n = /^\{(\w+)\}$/.exec(teil)
        if (n) { namen.push(n[1]); return '(.+?)' }
        return teil.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      }).join('')
      return [{ re: new RegExp(`^${quelle}$`), namen }, en]
    })
  musterCache = { anzahl, liste }
  return liste
}
