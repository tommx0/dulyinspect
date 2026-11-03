// Menüpunkte, die Admin/Planer für Prüfer ausblenden können (Tabelle menue_pruefer). Offline aus dem Gerätespeicher.
import { useEffect, useState } from 'react'
import { useAuth } from '../auth'
import { supabase } from './supabase'
import { tb } from './begriffe'
import { t } from './sprache'

export type Bereich = 'faelligkeiten' | 'maengel' | 'kunden' | 'hilfe'

export const AUSBLENDBAR: { bereich: Bereich; text: string; hinweis: string }[] = [
  { bereich: 'faelligkeiten', text: t('Fälligkeiten'), hinweis: tb('Übersicht aller fälligen Türen. Die fälligen Prüfungen auf der Startseite bleiben sichtbar.') },
  { bereich: 'maengel', text: t('Mängel'), hinweis: t('Mängelliste über alle Kunden, „Als behoben melden“.') },
  { bereich: 'kunden', text: t('Kunden'), hinweis: tb('Kundenliste mit Adressen und Ansprechpartnern. Objekte bleiben über „Tür finden“ und „Prüfen“ erreichbar.') },
  { bereich: 'hilfe', text: t('Hilfe'), hinweis: t('Link zur Bedienungsanleitung im Menü.') },
]

const CACHE = 'tuerpruefung:menue-pruefer'

function ausCache(): Bereich[] {
  try { return JSON.parse(localStorage.getItem(CACHE) ?? '[]') as Bereich[] } catch { return [] }
}

let laden: Promise<Bereich[]> | null = null
/** Nach dem Speichern neu laden. */
export function menueNeuLaden() { laden = null }

export function ausgeblendetLaden(): Promise<Bereich[]> {
  laden ??= (async () => {
    const { data, error } = await supabase.from('menue_pruefer').select('ausgeblendet').single()
    if (error) return ausCache() // offline: zuletzt bekannter Stand
    try { localStorage.setItem(CACHE, JSON.stringify(data.ausgeblendet)) } catch { /* Speicher gesperrt */ }
    return data.ausgeblendet as Bereich[]
  })()
  return laden
}

/** Für Prüfer ausgeblendete Bereiche (für Admin und Planer immer leer). */
export function useAusgeblendet(): Bereich[] {
  const { benutzer } = useAuth()
  const pruefer = benutzer?.rolle === 'pruefer'
  const [liste, setListe] = useState<Bereich[]>(() => (pruefer ? ausCache() : []))
  useEffect(() => {
    if (!pruefer) return
    let aktiv = true
    void ausgeblendetLaden().then((l) => { if (aktiv) setListe(l) })
    return () => { aktiv = false }
  }, [pruefer])
  return pruefer ? liste : []
}
