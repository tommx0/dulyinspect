// Wartungsmodus: Build mit VITE_WARTUNG=ja zeigt nur diese Seite (kein Login, kein Datenzugriff).
// Lokale, noch nicht übertragene Prüfdaten auf den Geräten bleiben erhalten und werden nach der Reaktivierung übertragen.
import { useEffect } from 'react'
import { Logo } from './components/Logo'
import { Entwickler } from './components/Entwickler'
import { RechtsLinks } from './components/Rechtstext'
import { appName, useErscheinungsbild } from './lib/erscheinungsbild'
import { t } from './lib/sprache'

export function Wartung() {
  const erscheinungsbild = useErscheinungsbild()
  // Zwischengespeicherte App-Version abmelden, damit installierte Apps nicht weiter die alte Version zeigen.
  // Die lokale Datenbank (IndexedDB) mit eventuell noch nicht übertragenen Prüfdaten bleibt unberührt.
  useEffect(() => {
    void navigator.serviceWorker?.getRegistrations().then((r) => r.forEach((x) => void x.unregister()))
  }, [])
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="karte w-full max-w-md space-y-4 p-6 text-center">
        <Logo className="mx-auto max-h-24 w-full max-w-64 object-contain" />
        <h1 className="text-xl font-semibold">{t('{app} vorübergehend nicht verfügbar', { app: appName(erscheinungsbild) })}</h1>
        <p className="text-slate-600">{t('Die Anwendung ist zurzeit deaktiviert. Bitte versuchen Sie es später erneut.')}</p>
        <p className="text-sm text-slate-500">
          {t('Noch nicht übertragene Prüfdaten auf Ihrem Gerät bleiben erhalten und werden übertragen, sobald die Anwendung wieder verfügbar ist.')}
        </p>
        <RechtsLinks className="border-t border-slate-100 pt-3" />
        <Entwickler />
      </div>
    </div>
  )
}
