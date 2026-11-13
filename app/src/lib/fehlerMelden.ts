// Unerwartete Fehler der App an den Server melden (fehler_melden, Konzept docs/KONZEPT-MAIL.md, Schritt 5). Der Admin sieht
// sie unter Einstellungen → System → Fehlerprotokoll und bekommt sie stündlich gesammelt per Mail, wenn eingeschaltet.
// Übertragen werden nur Meldung, Stack, Route ohne Parameter, App-Version und Browser – nie Formularinhalte oder Daten.
// Wirft nie; ohne Anmeldung oder Netz geht die Meldung verloren (gleiche Fehler kommen ohnehin wieder).
import { supabase } from './supabase'

export type FehlerArt = 'app' | 'protokoll'

// Meldungen, die nichts über die App sagen (Browser, Erweiterungen, Netz weg)
const UNWICHTIG = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i,
  /Failed to fetch|NetworkError|Load failed|network connection was lost/i,
  /AbortError|The operation was aborted/i,
]
const FREMD = /(chrome|moz|safari(-web)?)-extension:\/\//

const gesendet = new Map<string, number>()
const ABSTAND_MS = 5 * 60_000

/** Route ohne IDs und Parameter (#/anlage/PK-0000427 → #/anlage/:id) */
export function ortOhneDaten(hash = location.hash): string {
  return (hash.split('?')[0] || '#/')
    .split('/')
    .map((t, i) => (i > 1 && /[0-9]/.test(t) ? ':id' : t))
    .join('/')
    .slice(0, 200)
}

/** Text und Stack eines beliebigen Fehlerwerts; Daten in Meldungen (E-Mail-Adressen, lange Zahlen) entschärft */
export function fehlerBeschreibung(fehler: unknown): { text: string; stack: string | null } {
  const e = fehler instanceof Error ? fehler : null
  const roh = e ? `${e.name}: ${e.message}` : typeof fehler === 'string' ? fehler : (() => { try { return JSON.stringify(fehler) } catch { return String(fehler) } })()
  const ohne = (s: string) => s.replace(/[^\s@"'<>]+@[^\s@"'<>]+\.[A-Za-z]{2,}/g, '<E-Mail>').replace(/\b\d{6,}\b/g, '<Zahl>')
  return { text: ohne(roh).slice(0, 2000), stack: e?.stack ? ohne(e.stack).slice(0, 4000) : null }
}

export function unwichtig(text: string, stack: string | null): boolean {
  return UNWICHTIG.some((m) => m.test(text)) || (!!stack && FREMD.test(stack) && !stack.includes(location.origin))
}

export async function fehlerMelden(fehler: unknown, art: FehlerArt = 'app', ort = ortOhneDaten()): Promise<void> {
  try {
    const { text, stack } = fehlerBeschreibung(fehler)
    if (unwichtig(text, stack)) return
    const schluessel = `${art}|${text}|${ort}`
    if (Date.now() - (gesendet.get(schluessel) ?? 0) < ABSTAND_MS) return
    gesendet.set(schluessel, Date.now())
    const { data } = await supabase.auth.getSession()
    if (!data.session) return
    await supabase.rpc('fehler_melden', {
      p_art: art, p_text: text, p_stack: stack ?? undefined, p_ort: ort, p_version: __APP_VERSION__, p_geraet: navigator.userAgent.slice(0, 200),
    })
  } catch { /* melden darf nie selbst stören */ }
}

let installiert = false
/** Ungefangene Fehler und abgelehnte Promises melden (einmal beim Start) */
export function fehlerFaengerInstallieren() {
  if (installiert) return
  installiert = true
  window.addEventListener('error', (e) => { void fehlerMelden(e.error ?? e.message) })
  window.addEventListener('unhandledrejection', (e) => { void fehlerMelden(e.reason) })
}
