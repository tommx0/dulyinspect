import { useEffect, useState } from 'react'
import { useAuth } from '../auth'
import { DEMO } from '../lib/demo'
import { t } from '../lib/sprache'
import { supabase } from '../lib/supabase'

/** Dauerhafter Hinweis im Kopf: Demomodus – für den Admin, dass seine Änderungen gelten. */
export function DemoBanner() {
  const { istSystemadmin } = useAuth()
  if (!DEMO) return null
  return (
    <p className="bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-950 sm:text-sm">
      <strong className="font-bold tracking-wide">{t('DEMOMODUS')}</strong>
      {istSystemadmin
        ? ` – ${t('als Admin pflegen Sie die Demodaten, Ihre Änderungen werden gespeichert.')}`
        : ` – ${t('Sie können alles ansehen, Änderungen werden nicht gespeichert.')}`}
    </p>
  )
}

/** Warnung, wenn App (VITE_DEMO) und Datenbank (intern.demo_modus) beim Demomodus nicht übereinstimmen. */
export function DemoAbgleich() {
  const [datenbank, setDatenbank] = useState<boolean | null>(null)
  useEffect(() => {
    // Offline oder ältere Datenbank ohne die Funktion: keine Aussage, keine Warnung
    void supabase.rpc('demo_modus').then(({ data, error }) => { if (!error && typeof data === 'boolean') setDatenbank(data) })
  }, [])
  if (datenbank === null || datenbank === DEMO) return null
  return (
    <p role="alert" className="bg-red-700 px-4 py-2 text-center text-sm font-medium text-white">
      {DEMO
        ? t('Demomodus nur in der App eingeschaltet – die Datenbank ist nicht gesperrt. Bitte den Administrator informieren.')
        : t('Die Datenbank steht im Demomodus, die App nicht – Änderungen werden abgelehnt. Bitte den Administrator informieren.')}
    </p>
  )
}
