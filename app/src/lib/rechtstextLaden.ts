// Impressum/Datenschutz vom Server laden (öffentlich), offline aus dem Gerätespeicher.
import { linkZiel, type Rechtstext, type RechtstextArt, type RechtstextFormat } from './rechtstext'
import { SUPABASE_URL } from './konfig'
import { supabase } from './supabase'

// Je Instanz (Supabase-Projekt): Eine neue Instanz unter derselben Adresse (Vorschau-Link, localhost)
// zeigt sonst die Texte einer anderen Instanz. Gemerkt wird nur, was in der eigenen Datenbank steht.
// v2: Art und Inhalt als JSON (vorher nur der Text)
const CACHE = `tuerpruefung:rechtstext:v2:${SUPABASE_URL}:`

// Frühere Caches (ohne Instanz-Bezug bzw. nur Text) – einmalig entfernen
try {
  for (const a of ['impressum', 'datenschutz']) {
    localStorage.removeItem('tuerpruefung:rechtstext:' + a)
    localStorage.removeItem(`tuerpruefung:rechtstext:${SUPABASE_URL}:${a}`)
  }
} catch { /* egal */ }

export function ausCache(art: RechtstextArt): Rechtstext | undefined {
  try {
    const roh = localStorage.getItem(CACHE + art)
    return roh === null ? undefined : JSON.parse(roh) as Rechtstext
  } catch { return undefined }
}

/** Art und Inhalt vom Server holen und für offline merken. */
export async function rechtstextLaden(art: RechtstextArt): Promise<Rechtstext> {
  const { data, error } = await supabase.rpc('rechtstext_inhalt', { p_art: art }).maybeSingle()
  if (error) throw error
  const r: Rechtstext = { format: (data?.format ?? 'text') as RechtstextFormat, inhalt: data?.inhalt ?? null }
  try {
    if (r.inhalt) localStorage.setItem(CACHE + art, JSON.stringify(r))
    else localStorage.removeItem(CACHE + art)
  } catch { /* Speicher gesperrt */ }
  return r
}

// Einmal je Seitenaufruf laden – für die Links (Art „link“ → direkt zur externen Seite)
let linkZiele: Promise<Record<RechtstextArt, string | null>> | null = null
const aenderungen = new EventTarget()
/** Nach dem Speichern in den Einstellungen neu laden – auch die schon angezeigten Links. */
export function rechtsLinksZuruecksetzen() { linkZiele = null; aenderungen.dispatchEvent(new Event('neu')) }
export function rechtsLinksBeobachten(f: () => void) {
  aenderungen.addEventListener('neu', f)
  return () => aenderungen.removeEventListener('neu', f)
}
export function webadressenLaden() {
  linkZiele ??= Promise.all((['impressum', 'datenschutz'] as const).map((a) => rechtstextLaden(a).catch(() => ausCache(a))))
    .then(([i, d]) => ({ impressum: linkZiel(i), datenschutz: linkZiel(d) }))
  return linkZiele
}
