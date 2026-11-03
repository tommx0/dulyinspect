import { useState } from 'react'
import { eintragVerwerfen, eintragWiederholen, syncJetzt, useSyncStatus } from '../offline/sync'
import { gebietsschema, t, tMeldung } from '../lib/sprache'
import { bestaetigen } from './Bestaetigung'
import { Dialog } from './ui'

const TAG = 24 * 60 * 60 * 1000

/** Dauerhafte Sync-Anzeige in der Kopfzeile: 🟢 gespeichert · 🟡 wird übertragen · 🔴 offline/Fehler */
export function SyncAnzeige() {
  const s = useSyncStatus()
  const [offen, setOffen] = useState(false)
  const [jetzt] = useState(() => Date.now())

  const zuAlt = s.aeltesterSeit !== null && jetzt - s.aeltesterSeit > TAG
  let farbe = 'bg-green-500'
  let text = t('gespeichert')
  if (s.fehlgeschlagen.length > 0) { farbe = 'bg-red-500'; text = t('{n} Fehler', { n: s.fehlgeschlagen.length }) }
  else if (!s.online) { farbe = 'bg-red-500'; text = s.ausstehend ? t('offline – {n} lokal', { n: s.ausstehend }) : t('offline') }
  else if (s.ausstehend > 0) { farbe = 'bg-amber-400'; text = t('überträgt ({n})', { n: s.ausstehend }) }

  return (
    <>
      <button onClick={() => setOffen(true)} className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
        aria-label={t('Synchronisierung: {status}', { status: text })}>
        <span className={`h-2.5 w-2.5 rounded-full ${farbe} ${s.laeuft ? 'animate-pulse' : ''}`} />
        <span className="whitespace-nowrap">{text}</span>
      </button>
      {zuAlt && (
        <div className="fixed inset-x-0 bottom-0 z-20 bg-red-600 px-4 py-2 text-center text-sm text-white">
          {t('Daten sind seit über 24 Stunden nicht übertragen. Bitte mit dem Internet verbinden und die App geöffnet lassen.')}
        </div>
      )}
      <Dialog offen={offen} titel={t('Synchronisierung')} onSchliessen={() => setOffen(false)}>
        <div className="space-y-3 text-sm">
          <p>
            {s.online ? t('Verbunden.') : t('Keine Verbindung – alles wird auf dem Gerät gespeichert und später übertragen.')}
            {' '}{s.ausstehend > 0 ? t('{n} Änderung(en) warten auf Übertragung.', { n: s.ausstehend }) : t('Alles ist übertragen.')}
          </p>
          {s.letzterErfolg && <p className="text-slate-500">{t('Zuletzt übertragen: {zeit}', { zeit: new Date(s.letzterErfolg).toLocaleTimeString(gebietsschema()) })}</p>}
          {s.fehler && s.online && <p className="text-amber-800">{t('Letzte Meldung: {meldung}', { meldung: tMeldung(s.fehler) })}</p>}
          {s.fehlgeschlagen.length > 0 && (
            <div className="space-y-2">
              <p className="font-medium text-red-700">{t('Nicht übertragbar (vom Server abgelehnt):')}</p>
              <ul className="space-y-2">
                {s.fehlgeschlagen.map((e) => (
                  <li key={e.nr} className="rounded-md border border-red-200 bg-red-50 p-2">
                    <div className="font-mono text-xs">{e.art} {e.tabelle ?? (e.art === 'rpc' ? e.rpc : '')}</div>
                    <div className="text-red-800">{e.fehler && tMeldung(e.fehler)}</div>
                    <div className="mt-1 flex gap-3">
                      <button className="link" onClick={() => eintragWiederholen(e.nr!)}>{t('erneut versuchen')}</button>
                      <button className="link text-red-700" onClick={async () => { if (await bestaetigen(t('Diese Änderung endgültig verwerfen? Sie geht damit verloren.'), { ok: t('Verwerfen'), gefahr: true })) void eintragVerwerfen(e.nr!) }}>{t('verwerfen')}</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button className="btn-primaer" onClick={() => void syncJetzt()} disabled={!s.online || s.laeuft}>{t('Jetzt senden')}</button>
        </div>
      </Dialog>
    </>
  )
}
