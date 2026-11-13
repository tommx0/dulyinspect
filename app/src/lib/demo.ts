// Demomodus: Build-Variable VITE_DEMO=ja (in Coolify als Build-Variable am App-Container). Planer und Prüfer sehen alles,
// ändern aber nichts; nur der Admin schreibt (Demodaten pflegen). Die Datenbank sperrt zusätzlich selbst (intern.demo_modus,
// Trigger demo_schreibsperre) – diese Sperre hier ist das Sicherheitsnetz im Browser, damit keine Stelle durchrutscht.
import { t } from './sprache'
export const DEMO = import.meta.env.VITE_DEMO === 'ja'

export const DEMO_TEXT = 'Im Demomodus nicht möglich – Änderungen werden nicht gespeichert.'

// Schreibt nur in technische Tabellen (Protokoll, Lizenzbestätigung) oder liest bloß; alle anderen Funktionen sperrt der Demomodus
const ERLAUBTE_RPCS = new Set([
  'anlage_suche', 'demo_modus', 'ersteinrichtung_offen', 'fehler_melden', 'lizenz_akzeptieren', 'lizenz_akzeptiert', 'log_dateien',
  'log_eintragen', 'log_lesen', 'log_text', 'protokoll_liste', 'rechtstext_inhalt', 'schema_stand', 'startseite_kennzahlen',
  'verschluesselung_kennung', 'verschluesselung_stand', 'verschluesselung_verwaiste', 'zwei_faktor_eingerichtet',
  'zwei_faktor_pflicht',
])

/** Ob eine Anfrage an Supabase im Demomodus etwas ändern würde. Anmelden und Sitzung erneuern bleiben erlaubt. */
export function demoGesperrt(methode: string, adresse: string): boolean {
  const m = methode.toUpperCase()
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false
  const pfad = new URL(adresse, 'http://x').pathname
  const rpc = /\/rest\/v1\/rpc\/([^/]+)$/.exec(pfad)
  if (rpc) return !ERLAUBTE_RPCS.has(rpc[1])
  if (pfad.includes('/rest/v1/')) return true
  // Signierte Links und Ordnerlisten sind POST, lesen aber nur
  if (pfad.includes('/storage/v1/')) return !/\/storage\/v1\/object\/(sign|list)\//.test(pfad)
  if (pfad.includes('/functions/v1/')) return true
  // Gemeinsame Demozugänge: Passwort und zweiten Faktor nicht ändern lassen (Anmelden mit vorhandenem Faktor geht weiter)
  if (/\/auth\/v1\/user$/.test(pfad)) return true
  if (/\/auth\/v1\/factors(\/[^/]+)?$/.test(pfad)) return true
  return false
}

let schreibenErlaubt = false

/** Vom Anmeldeablauf gesetzt: Der Admin darf im Demomodus schreiben, alle anderen nicht (auch vor dem Laden des Profils). */
export function demoSchreibenErlauben(ja: boolean) {
  schreibenErlaubt = ja
}

/** Im Demomodus gesperrt, gilt für den angemeldeten Benutzer. */
export function demoSperreAktiv(): boolean {
  return DEMO && !schreibenErlaubt
}

export const DEMO_KNOPF_TEXT = t('Im Demomodus nicht verfügbar')

/** Für Knöpfe, die etwas anlegen, importieren oder löschen: sichtbar, im Demomodus aber deaktiviert. */
export function demoKnopf(): { disabled?: boolean; title?: string } {
  return demoSperreAktiv() ? { disabled: true, title: DEMO_KNOPF_TEXT } : {}
}

function antwort(): Response {
  // Felder für PostgREST (message/code), Storage (error/statusCode) und Auth (msg/error_code), damit jeder Client den Text zeigt
  const inhalt = { message: DEMO_TEXT, code: 'DEMO', msg: DEMO_TEXT, error: DEMO_TEXT, error_code: 'demo', statusCode: '403' }
  return new Response(JSON.stringify(inhalt), { status: 403, headers: { 'Content-Type': 'application/json' } })
}

/** fetch für den Supabase-Client: hält im Demomodus jede ändernde Anfrage zurück. */
export function demoFetch(basis: typeof fetch = (...a) => fetch(...a), aktiv: () => boolean = demoSperreAktiv): typeof fetch {
  return (eingabe, init) => {
    const methode = init?.method ?? (eingabe instanceof Request ? eingabe.method : 'GET')
    const adresse = typeof eingabe === 'string' ? eingabe : eingabe instanceof URL ? eingabe.href : eingabe.url
    if (aktiv() && demoGesperrt(methode, adresse)) return Promise.resolve(antwort())
    return basis(eingabe, init)
  }
}
