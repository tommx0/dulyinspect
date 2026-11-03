// Darstellung der Listen (Startseite, Prüfen, Fälligkeiten, Mängel, Kunden, Objekte, Anlagen, Typen, Checklisten, Benutzer): Kacheln (Standard) oder Liste.
// Die Wahl gilt je Liste und liegt im localStorage dieses Geräts.
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export type Ansicht = 'kacheln' | 'liste'
export type AnsichtListe = 'start' | 'pruefen' | 'faelligkeiten' | 'maengel' | 'kunden' | 'kundenliste' | 'kunde.objekte' | 'objektliste' | 'objekt.anlagen' | 'anlagen'
  | 'anlagentypen' | 'checklisten' | 'benutzer'

const SPEICHER = 'ansicht'

function gespeichert(): Partial<Record<AnsichtListe, Ansicht>> {
  try { return JSON.parse(localStorage.getItem(SPEICHER) ?? '{}') ?? {} } catch { return {} }
}

export function useAnsicht(liste: AnsichtListe): [Ansicht, (a: Ansicht) => void] {
  const [ansicht, setAnsicht] = useState<Ansicht>(() => gespeichert()[liste] === 'liste' ? 'liste' : 'kacheln')
  const setzen = (a: Ansicht) => {
    setAnsicht(a)
    try { localStorage.setItem(SPEICHER, JSON.stringify({ ...gespeichert(), [liste]: a })) } catch { /* Speicher gesperrt: gilt bis zum Neuladen */ }
  }
  return [ansicht, setzen]
}

/**
 * Laufende Prüfung: Prüfpunkte als Protokollblatt im Aufbau des PDF oder als Liste. Den Standard legt der Admin
 * für die Firma fest (firma.pruef_ansicht, Einstellungen → Prüfungen); wer in der Prüfung umschaltet, behält
 * seine Wahl auf diesem Gerät. Den Firmenstandard merkt sich das Gerät für offline.
 */
export type PruefAnsicht = 'liste' | 'protokoll'
const SPEICHER_PRUEFUNG = 'ansicht:pruefung'
const SPEICHER_PRUEFUNG_FIRMA = 'ansicht:pruefung:firma'

function lesen(schluessel: string): PruefAnsicht | null {
  try {
    const wert = localStorage.getItem(schluessel)
    return wert === 'liste' || wert === 'protokoll' ? wert : null
  } catch { return null }
}

export function usePruefAnsicht(): [PruefAnsicht, (a: PruefAnsicht) => void] {
  const [ansicht, setAnsicht] = useState<PruefAnsicht>(() => lesen(SPEICHER_PRUEFUNG) ?? lesen(SPEICHER_PRUEFUNG_FIRMA) ?? 'protokoll')
  useEffect(() => {
    let aktiv = true
    void supabase.from('firma').select('pruef_ansicht').maybeSingle().then(({ data }) => {
      const firma = data?.pruef_ansicht
      if (!aktiv || (firma !== 'liste' && firma !== 'protokoll')) return
      try { localStorage.setItem(SPEICHER_PRUEFUNG_FIRMA, firma) } catch { /* Speicher gesperrt */ }
      if (!lesen(SPEICHER_PRUEFUNG)) setAnsicht(firma)
    })
    return () => { aktiv = false }
  }, [])
  const setzen = (a: PruefAnsicht) => {
    setAnsicht(a)
    try { localStorage.setItem(SPEICHER_PRUEFUNG, a) } catch { /* Speicher gesperrt: gilt bis zum Neuladen */ }
  }
  return [ansicht, setzen]
}

/** Spaltenbreiten des Protokollblatts in Prozent, wie in der Datenbank voreingestellt (firma.blatt_*_breite, Einstellungen → Prüfungen). */
export const BLATT_BESCHRIFTUNG_BREITE = 20
export const BLATT_ERGEBNIS_BREITE = 42
/** Erlaubte Bereiche (Check-Constraints der Migration 20261126090000) */
export const BLATT_BREITEN = { beschriftung: { min: 10, max: 35 }, ergebnis: { min: 25, max: 60 } } as const
