// Stand der Datenbank (neueste eingespielte Migration), für Fußzeile und Dateinamen der Datensicherung
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

let laden: Promise<string | null> | null = null

/** Einmal je Sitzung abfragen; offline oder bei Fehlern null (dann beim nächsten Aufruf erneut). */
export function schemaStandLaden(): Promise<string | null> {
  laden ??= Promise.resolve(supabase.rpc('schema_stand')).then(({ data, error }) => {
    if (error || !data) { laden = null; return null }
    return data
  }, () => { laden = null; return null })
  return laden
}

export function useSchemaStand(): string | null {
  const [stand, setStand] = useState<string | null>(null)
  useEffect(() => {
    let aktiv = true
    void schemaStandLaden().then((s) => { if (aktiv) setStand(s) })
    return () => { aktiv = false }
  }, [])
  return stand
}
