// Mandantencode der Instanz (firma.mandantencode, z. B. K7Q3X): steht in jedem neuen QR-Code als k=…, damit ein
// Etikett einer anderen Instanz (gleiche Nummer PK-0000001, andere Anlage) hier nicht die falsche Anlage öffnet.
// Ältere Codes ohne k gelten weiter. Offline aus dem Gerätespeicher; ohne bekannten eigenen Code wird nichts gesperrt.
// Ohne festen Import von supabase, damit etikett.ts und melderCode.ts in Node testbar bleiben.
import { t } from './sprache'

const CACHE = 'tuerpruefung:mandantencode'
export const MANDANTENCODE_MUSTER = /^[0-9A-HJKMNP-TV-Y]{5}$/

let eigener: string | null = (() => {
  try {
    const c = localStorage.getItem(CACHE)
    return c && MANDANTENCODE_MUSTER.test(c) ? c : null
  } catch { return null }
})()

/** Eigenen Code vom Server holen (nach der Anmeldung, online). */
export async function mandantencodeLaden() {
  const { supabase } = await import('./supabase')
  const { data, error } = await supabase.from('firma').select('mandantencode').maybeSingle()
  if (error || !data?.mandantencode) return // offline: zuletzt bekannter Stand
  mandantencodeSetzen(data.mandantencode)
}

export function mandantencodeSetzen(code: string | null) {
  eigener = code
  try {
    if (code) localStorage.setItem(CACHE, code)
    else localStorage.removeItem(CACHE)
  } catch { /* Speicher gesperrt */ }
}

export function eigenerMandantencode(): string | null {
  return eigener
}

/** k=… aus einer gescannten Adresse (auch im Hash: #/…?k=…); null bei reinem Code oder ohne k. */
export function mandantencodeAusScan(inhalt: string): string | null {
  try {
    const url = new URL(inhalt.trim())
    const k = url.searchParams.get('k') ?? new URLSearchParams(url.hash.split('?')[1] ?? '').get('k')
    return k ? k.trim().toUpperCase() : null
  } catch {
    return null
  }
}

/** Gehört der Code zu einer anderen Instanz? Dann deren Code, sonst null (auch ohne k oder ohne eigenen Code). */
export function fremderMandantencode(k: string | null | undefined, eigen: string | null = eigener): string | null {
  const code = k?.trim().toUpperCase()
  return code && eigen && code !== eigen ? code : null
}

/** Fremder Mandantencode in einem gescannten Inhalt (Adresse aus dem QR-Code)? */
export function fremderMandantImScan(inhalt: string, eigen: string | null = eigener): string | null {
  return fremderMandantencode(mandantencodeAusScan(inhalt), eigen)
}

export const fremdesEtikettText = (code: string) =>
  t('Dieses Etikett gehört zu einer anderen Instanz der App (Mandantencode {code}) und wird hier nicht verwendet.', { code })

/** Adresse aus dem QR-Code um &k=<Code> ergänzen (ohne Code unverändert). */
export function mitMandantencode(adresse: string, code: string | null | undefined): string {
  return code ? `${adresse}&k=${encodeURIComponent(code)}` : adresse
}
