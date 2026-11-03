// Erscheinungsbild je Instanz (Tabelle erscheinungsbild): App-Name, Farben, Logo. Ohne Anmeldung lesbar, offline aus dem Cache.
import { useEffect, useState } from 'react'
import { istFarbe, mischen } from './farben'
import { supabase } from './supabase'

export { istFarbe, kontrast, kontrastHinweise } from './farben'

export type Erscheinungsbild = {
  app_name: string | null
  farbe_marke: string | null
  farbe_akzent: string | null
  logo_pfad: string | null
  logo_pdf_pfad: string | null
  geaendert_am?: string
}

export const STANDARD = { marke: '#1c1c1c', akzent: '#fce400' }
const LEER: Erscheinungsbild = { app_name: null, farbe_marke: null, farbe_akzent: null, logo_pfad: null, logo_pdf_pfad: null }
const CACHE = 'tuerpruefung:erscheinungsbild'
const EREIGNIS = 'erscheinungsbild-geaendert'

/** Farben als CSS-Variablen setzen (Tailwind nutzt --color-marke/--color-akzent) und Titel anpassen. */
export function anwenden(e: Erscheinungsbild) {
  const marke = istFarbe(e.farbe_marke) ? e.farbe_marke : STANDARD.marke
  const akzent = istFarbe(e.farbe_akzent) ? e.farbe_akzent : STANDARD.akzent
  const s = document.documentElement.style
  s.setProperty('--color-marke', marke)
  s.setProperty('--color-marke-dunkel', mischen(marke, '#000000', 0.35))
  s.setProperty('--color-akzent', akzent)
  s.setProperty('--color-akzent-hell', mischen(akzent, '#ffffff', 0.8))
  document.title = e.app_name || __APP_NAME__
}

// ---------------------------------------------------------------------------
// Laden und Speichern
// ---------------------------------------------------------------------------
export function ausCache(): Erscheinungsbild {
  try { return { ...LEER, ...(JSON.parse(localStorage.getItem(CACHE) ?? 'null') ?? {}) } } catch { return LEER }
}

let laufend: Promise<Erscheinungsbild> | null = null

/** Vom Server laden (gleichzeitige Aufrufe teilen sich eine Anfrage). */
export function erscheinungsbildLaden(neu = false): Promise<Erscheinungsbild> {
  if (laufend && !neu) return laufend
  laufend = (async () => {
    const { data, error } = await supabase.from('erscheinungsbild').select('app_name, farbe_marke, farbe_akzent, logo_pfad, logo_pdf_pfad, geaendert_am').maybeSingle()
    if (error || !data) return ausCache() // offline oder Datenbank ohne Tabelle: zuletzt bekannter Stand
    try { localStorage.setItem(CACHE, JSON.stringify(data)) } catch { /* Speicher gesperrt */ }
    return data
  })()
  return laufend
}

/** Nach dem Speichern in den Einstellungen: überall neu laden und anwenden. */
export async function erscheinungsbildNeuLaden() {
  const e = await erscheinungsbildLaden(true)
  anwenden(e)
  window.dispatchEvent(new CustomEvent(EREIGNIS, { detail: e }))
}

function oeffentlich(pfad: string, stand?: string): string {
  return `${supabase.storage.from('branding').getPublicUrl(pfad).data.publicUrl}${stand ? `?v=${encodeURIComponent(stand)}` : ''}`
}
export const logoUrl = (e: Erscheinungsbild) => (e.logo_pfad ? oeffentlich(e.logo_pfad, e.geaendert_am) : './logo.svg')
export const logoPdfUrl = (e: Erscheinungsbild) => (e.logo_pdf_pfad ? oeffentlich(e.logo_pdf_pfad, e.geaendert_am) : './logo.png')
export const appName = (e: Erscheinungsbild) => e.app_name || __APP_NAME__

/** Aktuelles Erscheinungsbild für Komponenten (Logo, Name); Farben setzt anwenden() global. */
export function useErscheinungsbild(): Erscheinungsbild {
  const [e, setE] = useState(ausCache)
  useEffect(() => {
    let aktiv = true
    void erscheinungsbildLaden().then((x) => { if (aktiv) { setE(x); anwenden(x) } })
    const h = (ev: Event) => setE((ev as CustomEvent<Erscheinungsbild>).detail)
    window.addEventListener(EREIGNIS, h)
    return () => { aktiv = false; window.removeEventListener(EREIGNIS, h) }
  }, [])
  return e
}
