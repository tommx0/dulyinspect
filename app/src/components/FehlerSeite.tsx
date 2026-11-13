import { useEffect } from 'react'
import { isRouteErrorResponse, useRouteError } from 'react-router'
import { fehlerMelden } from '../lib/fehlerMelden'
import { t } from '../lib/sprache'

/** Statt eines weißen Bildschirms: freundliche Seite bei einem Absturz einer Seite; der Fehler geht ans Fehlerprotokoll. */
export function FehlerSeite() {
  const fehler = useRouteError()
  useEffect(() => {
    // 404 einer Route ist kein Absturz
    if (!(isRouteErrorResponse(fehler) && fehler.status === 404)) void fehlerMelden(fehler)
  }, [fehler])
  return (
    <div className="flex min-h-dvh items-center justify-center p-4" data-fehlerseite>
      <div className="karte w-full max-w-md space-y-4 p-6 text-center">
        <h1 className="text-lg font-semibold">{t('Hier ist etwas schiefgegangen')}</h1>
        <p className="text-sm text-slate-700">
          {t('Die Seite ließ sich nicht anzeigen. Der Fehler wurde ohne Ihre Daten an den Administrator gemeldet. Nicht übertragene Prüfungen bleiben auf dem Gerät.')}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <button className="btn-primaer" onClick={() => location.reload()}>{t('Neu laden')}</button>
          <a className="btn-sekundaer" href="#/">{t('Zur Startseite')}</a>
        </div>
      </div>
    </div>
  )
}
