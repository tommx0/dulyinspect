// Eingeschaltete Anlagenarten (Tabelle anlagenart) und die Begriffe der Oberfläche:
// Prüft eine Instanz nur Türen, heißt alles „Tür/Türen“, sonst allgemein „Anlage/Anlagen“.
// Offline aus dem Gerätespeicher; nach dem Umschalten in den Einstellungen lädt die App neu.
import { useSyncExternalStore } from 'react'
import { ART_SCHLUESSEL, type ArtSchluessel } from './anlagenarten'
import { supabase } from './supabase'
import { t, type Werte } from './sprache'

const CACHE = 'tuerpruefung:anlagenarten'
const STANDARD: ArtSchluessel[] = ['tuer']

function ausCache(): ArtSchluessel[] {
  try {
    const liste = JSON.parse(localStorage.getItem(CACHE) ?? 'null') as string[] | null
    const gueltig = (liste ?? []).filter((a): a is ArtSchluessel => ART_SCHLUESSEL.includes(a as ArtSchluessel))
    return gueltig.length ? gueltig : STANDARD
  } catch { return STANDARD }
}

let aktiv: ArtSchluessel[] = ausCache()
const PFLICHT = 'tuerpruefung:sachkunde-pflicht'
let pflicht: string[] = (() => { try { return JSON.parse(localStorage.getItem(PFLICHT) ?? '[]') as string[] } catch { return [] } })()
const hoerer = new Set<() => void>()

function setzen(neu: ArtSchluessel[]) {
  if (neu.join() === aktiv.join()) return
  aktiv = neu
  try { localStorage.setItem(CACHE, JSON.stringify(neu)) } catch { /* Speicher gesperrt */ }
  hoerer.forEach((h) => h())
}

/** Eingeschaltete Arten vom Server holen (nach der Anmeldung, online). */
export async function anlagenartenLaden() {
  const { data, error } = await supabase.from('anlagenart').select('schluessel, aktiv, sachkunde_pflicht').order('reihenfolge')
  if (error || !data?.length) return // offline: zuletzt bekannter Stand
  pflicht = data.filter((d) => d.sachkunde_pflicht).map((d) => d.schluessel)
  try { localStorage.setItem(PFLICHT, JSON.stringify(pflicht)) } catch { /* Speicher gesperrt */ }
  setzen(data.filter((d) => d.aktiv).map((d) => d.schluessel).filter((a): a is ArtSchluessel => ART_SCHLUESSEL.includes(a as ArtSchluessel)))
}

export function aktiveArten(): ArtSchluessel[] {
  return aktiv
}

/** Darf eine Prüfung dieser Art nur mit gültiger Sachkunde beginnen? (Einstellungen) */
export function sachkundePflicht(art: string): boolean {
  return pflicht.includes(art)
}

/** Nur Türen (die Türanlage eines Objekts fasst sie nur zusammen): Die Oberfläche spricht weiter von „Tür“. */
export function nurTueren(): boolean {
  return aktiv.every((a) => a === 'tuer' || a === 'tueranlage')
}

/** Für Komponenten: neu zeichnen, wenn sich die Arten ändern. */
export function useAnlagenarten(): ArtSchluessel[] {
  return useSyncExternalStore((h) => { hoerer.add(h); return () => hoerer.delete(h) }, () => aktiv)
}

const ERSATZ: Record<string, string> = {
  '': 'Anlage', en: 'Anlagen', typ: 'Anlagentyp', typs: 'Anlagentyps', typen: 'Anlagentypen', liste: 'Anlagenliste',
  daten: 'Anlagendaten', nummer: 'Anlagennummer', bezeichnung: 'Anlagenbezeichnung', akte: 'Anlagenakte',
}

/** Text der Oberfläche: „Tür“ → „Anlage“ usw., sobald nicht nur Türen geprüft werden. Türkategorie und Fluchttür bleiben. */
export function begriff(text: string): string {
  if (nurTueren()) return text
  return alsAnlage(text)
}

/** begriff() und dann übersetzen (src/lib/sprache.ts); das Wörterbuch kennt beide Fassungen */
export function tb(text: string, werte?: Werte): string {
  return t(begriff(text), werte)
}

/** Fassung für Instanzen, die nicht nur Türen prüfen (auch für den Test der Übersetzungen) */
export function alsAnlage(text: string): string {
  return text.replace(/(?<![A-Za-zÄÖÜäöüß])Tür\(en\)/g, 'Anlage(n)').replace(/(?<![A-Za-zÄÖÜäöüß])Tür(en|typen|typs|typ|liste|daten|nummer|bezeichnung|akte)?(?![a-zäöüß])/g,
    (_, endung: string | undefined) => ERSATZ[endung ?? ''])
}

/** Nach dem Speichern in den Einstellungen sofort übernehmen. */
export function anlagenartenSetzen(liste: ArtSchluessel[]) {
  setzen(liste.length ? liste : STANDARD)
}
