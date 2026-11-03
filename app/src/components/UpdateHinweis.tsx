import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { automatischAktualisieren, OHNE_NACHFRAGE, stillAktualisieren } from '../lib/update'
import { db } from '../offline/db'
import { t } from '../lib/sprache'

const START = Date.now()

const offeneAnlagen = () => db.pruefungen.filter((p) => p.status === 'in_pruefung' && !p.fremd).count().catch(() => 1)

/**
 * Neue App-Version: beim Start automatisch laden, wenn gerade keine Tür in Prüfung ist;
 * sonst bzw. im laufenden Betrieb erst nach Bestätigung (nie mitten in einer Prüfung).
 * Mit VITE_UPDATE=automatisch kein Balken: dann beim nächsten Seitenwechsel oder wenn die App in den Hintergrund geht.
 */
export function UpdateHinweis() {
  const { needRefresh: [neu, setNeu], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // stündlich nach Updates schauen
      if (reg) setInterval(() => { void reg.update() }, 60 * 60 * 1000)
    },
  })

  useEffect(() => {
    if (!neu) return
    void (async () => {
      if (automatischAktualisieren({ msSeitStart: Date.now() - START, pfad: window.location.hash, offeneAnlagen: await offeneAnlagen() })) await updateServiceWorker(true)
    })()
  }, [neu, updateServiceWorker])

  useEffect(() => {
    if (!neu || !OHNE_NACHFRAGE) return
    let laedt = false
    const versuchen = async () => {
      if (laedt || !stillAktualisieren({ pfad: window.location.hash, offeneAnlagen: await offeneAnlagen() })) return
      laedt = true
      await updateServiceWorker(true)
    }
    const seitenwechsel = () => { void versuchen() }
    const hintergrund = () => { if (document.visibilityState === 'hidden') void versuchen() }
    window.addEventListener('hashchange', seitenwechsel)
    document.addEventListener('visibilitychange', hintergrund)
    return () => {
      window.removeEventListener('hashchange', seitenwechsel)
      document.removeEventListener('visibilitychange', hintergrund)
    }
  }, [neu, updateServiceWorker])

  if (!neu || OHNE_NACHFRAGE) return null
  return (
    <div role="status" className="fixed inset-x-0 bottom-0 z-30 flex flex-wrap items-center justify-center gap-3 bg-marke px-4 py-3 text-sm text-white">
      {t('Eine neue Version der App ist verfügbar.')}
      <button className="rounded-md bg-akzent px-3 py-1.5 font-semibold text-marke" onClick={() => updateServiceWorker(true)}>{t('Jetzt aktualisieren')}</button>
      <button className="underline" onClick={() => setNeu(false)}>{t('Später')}</button>
    </div>
  )
}
