import { useState } from 'react'
import { LIZENZBEDINGUNGEN, LIZENZBEDINGUNGEN_STAND } from '../lib/lizenzbedingungen'
import { t } from '../lib/sprache'
import { Entwickler } from './Entwickler'
import { RechtstextInhalt } from './Rechtstext'

/** Pflichtabfrage nach der Anmeldung (Erstinstallation und jedes Update): ohne Akzeptieren keine Nutzung der App. */
export function LizenzHinweis({ onAkzeptiert, onAbmelden }: { onAkzeptiert: () => void; onAbmelden: () => void }) {
  const [gelesen, setGelesen] = useState(false)
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="lizenz-titel" className="karte flex max-h-[95dvh] w-full max-w-3xl flex-col gap-4 p-6">
        <div>
          <h1 id="lizenz-titel" className="text-lg font-bold text-marke">{t('Lizenzbedingungen akzeptieren')}</h1>
          <p className="text-sm text-slate-600">
            {t('Version {version} · Stand der Lizenzbedingungen: {stand}. Bitte lesen Sie die Bedingungen und akzeptieren Sie sie, um die App zu nutzen.', { version: __APP_VERSION__, stand: LIZENZBEDINGUNGEN_STAND })}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-slate-200 p-4 text-sm" tabIndex={0} aria-label={t('Text der Lizenzbedingungen')}>
          <RechtstextInhalt text={LIZENZBEDINGUNGEN} />
        </div>
        <label className="flex items-start gap-2 text-sm font-normal text-slate-800">
          <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={gelesen} onChange={(e) => setGelesen(e.target.checked)} />
          {t('Ich habe die Lizenzbedingungen gelesen und akzeptiere sie.')}
        </label>
        <div className="flex flex-wrap gap-3">
          <button className="btn-primaer" disabled={!gelesen} onClick={onAkzeptiert}>{t('Akzeptieren und fortfahren')}</button>
          <button className="btn-sekundaer" onClick={onAbmelden}>{t('Abmelden')}</button>
        </div>
        <Entwickler className="border-t border-slate-100 pt-3" />
      </div>
    </div>
  )
}
