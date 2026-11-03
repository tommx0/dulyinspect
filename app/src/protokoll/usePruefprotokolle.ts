// Gespeicherte Protokolle einer Prüfung (ohne Session) laden und fehlendes Protokoll der aktuellen Revision erzeugen.
import { useCallback, useEffect, useRef, useState } from 'react'
import { fehlertext, supabase } from '../lib/supabase'
import { useAbfrage } from '../lib/useAbfrage'
import { db } from '../offline/db'
import { useSyncStatus } from '../offline/sync'
import { protokollSchluessel } from './automatisch'
import { protokollLinks, pruefprotokollErzeugen, unterschriftenBereinigen } from './erzeugen'

export type Pruefprotokoll = { id: string; revision: number; storage_pfad: string; sha256: string; erzeugt_am: string }

/**
 * Gespeicherte Protokolle einer Prüfung. Ist sie abgeschlossen und fehlt das Protokoll der aktuellen Revision,
 * erzeugt es dieses Gerät (idempotent – ein paralleler Versuch eines Kollegen schadet nicht). Erzeugen dürfen nur
 * Beteiligte (Haupt- und Mitprüfer) und Admins/Planer (`darf`).
 */
export function usePruefprotokolle(pruefungId: string, stand: { revision: number; abgeschlossen: boolean } | null, darf = true) {
  const { online } = useSyncStatus()
  const [fortschritt, setFortschritt] = useState('')
  const [fehler, setFehler] = useState('')
  const [urls, setUrls] = useState<Record<string, string>>({})
  const laeuft = useRef(false)
  const liste = useAbfrage(() => supabase.from('protokoll').select('id, revision, storage_pfad, sha256, erzeugt_am')
    .eq('anlagenpruefung_id', pruefungId).is('session_id', null).order('revision', { ascending: false }), [pruefungId, online])
  const protokolle = (liste.daten ?? []) as Pruefprotokoll[]
  const revision = stand?.revision ?? 0
  const abgeschlossen = !!stand?.abgeschlossen
  const fehlt = abgeschlossen && !liste.laedt && !liste.fehler && !protokolle.some((p) => p.revision === revision)

  const erzeugen = useCallback(async () => {
    if (laeuft.current || !abgeschlossen || !darf) return
    laeuft.current = true
    setFehler('')
    try {
      await pruefprotokollErzeugen(pruefungId, setFortschritt)
      await db.meta.put({ schluessel: protokollSchluessel(pruefungId, revision), wert: new Date().toISOString() })
      await liste.neuLaden()
    } catch (e) {
      setFehler(fehlertext(e))
    } finally {
      setFortschritt('')
      laeuft.current = false
    }
  }, [pruefungId, revision, abgeschlossen, darf, liste])

  useEffect(() => {
    if (fehlt && online && !fehler) void erzeugen()
  }, [fehlt, online, fehler, erzeugen])

  // Protokoll der aktuellen Revision ist da: Unterschriftsdateien, die noch beim Server liegen, jetzt entfernen (einmal je Revision)
  const vorhanden = abgeschlossen && !liste.laedt && protokolle.some((p) => p.revision === revision)
  const bereinigt = useRef<string>('')
  useEffect(() => {
    const schluessel = `${pruefungId}:${revision}`
    if (!vorhanden || !online || !darf || bereinigt.current === schluessel) return
    bereinigt.current = schluessel
    void unterschriftenBereinigen(pruefungId).catch(() => { bereinigt.current = '' })
  }, [vorhanden, online, darf, pruefungId, revision])

  // Die PDFs vorab holen und entschlüsseln: ein Klick öffnet sie direkt (auch dort, wo Pop-ups nach await blockiert werden).
  // Ein Link „“ heißt: nicht lesbar.
  const schluessel = protokolle.map((p) => p.id).join()
  useEffect(() => {
    let aktiv = true
    void protokollLinks(protokolle)
      .then((links) => { if (aktiv) setUrls(links) })
      .catch(() => undefined)
    return () => { aktiv = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schluessel])

  return { protokolle, urls, fortschritt, fehler: fehler || liste.fehler, fehlt, laedt: liste.laedt, erzeugen, online }
}
