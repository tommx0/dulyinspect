import { useCallback, useEffect, useState } from 'react'
import { fehlertext } from './supabase'

/** Lädt Daten beim Mounten bzw. bei Änderung der Abhängigkeiten; `neuLaden` für Aktualisierung nach Änderungen. */
export function useAbfrage<R extends { data: unknown; error: unknown }>(laden: () => PromiseLike<R>, abh: unknown[] = []) {
  const [daten, setDaten] = useState<R['data'] | null>(null)
  const [fehler, setFehler] = useState('')
  const [laedt, setLaedt] = useState(true)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ausfuehren = useCallback(laden, abh)

  const neuLaden = useCallback(async () => {
    setLaedt(true)
    try {
      const { data, error } = await ausfuehren()
      setFehler(fehlertext(error))
      setDaten(data)
    } catch (e) {
      // z. B. gesperrt, weil der Schlüssel fehlt (Verschlüsselung): kein ungefangener Fehler
      setFehler(fehlertext(e))
      setDaten(null)
    }
    setLaedt(false)
  }, [ausfuehren])

  useEffect(() => {
    neuLaden()
  }, [neuLaden])

  return { daten, fehler, laedt, neuLaden }
}
