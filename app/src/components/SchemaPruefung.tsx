import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../auth'
import { t } from '../lib/sprache'
import { supabase } from '../lib/supabase'
import { Logo } from './Logo'
import { UpdateAssistent } from './UpdateAssistent'

/**
 * Passt die Datenbank zu dieser App-Version? Ist sie älter (Update noch nicht eingespielt), wird die App angehalten,
 * statt mit Fehlern zu laufen. Neuere Datenbanken sind in Ordnung (Migrationen sind abwärtskompatibel). Offline keine Prüfung.
 */
export function SchemaPruefung({ children }: { children: ReactNode }) {
  const { istSystemadmin } = useAuth()
  const [stand, setStand] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    if (!navigator.onLine) return
    let aktiv = true
    void supabase.rpc('schema_stand').then(({ data, error }) => {
      if (!aktiv) return
      if (error) {
        // Funktion fehlt → Datenbank älter als diese App; Netzwerkfehler → nicht blockieren
        setStand(error.code === 'PGRST202' || /schema_stand/.test(error.message) ? '' : undefined)
        return
      }
      setStand(data ?? '')
    })
    return () => { aktiv = false }
  }, [])

  if (stand === undefined || stand === null || stand >= __SCHEMA_STAND__) return <>{children}</>

  return (
    <div className="flex min-h-dvh items-center justify-center p-4" data-schema-veraltet>
      <div className="karte w-full max-w-md space-y-4 p-6 text-center">
        <Logo className="mx-auto max-h-24 w-full max-w-64 object-contain" />
        <h1 className="text-xl font-semibold">{t('Update wird eingespielt')}</h1>
        {istSystemadmin ? (
          <div className="space-y-2 text-left text-sm text-slate-600">
            <p>{t('Diese App-Version ({version}) braucht ein neueres Datenbankschema, als installiert ist.', { version: __APP_VERSION__ })}</p>
            <p className="font-mono text-xs">{t('Datenbank: {stand} · benötigt: {benoetigt}', { stand: stand || t('unbekannt'), benoetigt: __SCHEMA_STAND__ })}</p>
            <p>{t('Bis zum Datenbank-Update ist die App für alle angehalten.')}</p>
            <UpdateAssistent stand={stand} />
          </div>
        ) : (
          <p className="text-slate-600">{t('Die App wird gerade aktualisiert. Bitte versuchen Sie es in Kürze erneut.')}</p>
        )}
        <p className="text-sm text-slate-500">{t('Noch nicht übertragene Prüfdaten auf diesem Gerät bleiben erhalten.')}</p>
        <button className="btn-sekundaer" onClick={() => window.location.reload()}>{t('Erneut prüfen')}</button>
      </div>
    </div>
  )
}
