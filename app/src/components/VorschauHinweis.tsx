import { useState } from 'react'
import { t } from '../lib/sprache'
import { Entwickler } from './Entwickler'

/** Pflichthinweis nach der Anmeldung: ohne Bestätigung keine Nutzung der App. */
export function VorschauHinweis({ onBestaetigt, onAbmelden }: { onBestaetigt: () => void; onAbmelden: () => void }) {
  const [gelesen, setGelesen] = useState(false)
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="vorschau-titel" className="karte w-full max-w-2xl space-y-4 p-6">
        <h1 id="vorschau-titel" className="text-lg font-bold text-marke">{t('Hinweis: Vorschauversion (Beta)')}</h1>
        <p className="text-sm text-slate-700">
          {t('Diese App ist eine')} <strong>{t('Präsentationsversion für Vorschau und Werbung')}</strong>. {t('Sie befindet sich in der Entwicklung (Betaversion).')}
        </p>
        <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
          <li><strong>{t('Keine kommerzielle Nutzung.')}</strong> {t('Die App darf nur zur Ansicht und Erprobung verwendet werden.')}</li>
          <li>
            <strong>{t('Keine realen Daten eingeben')}</strong> – {t('keine echten Kunden, Objekte, Adressen, Personen oder Fotos, sondern nur erfundene Testdaten.')}
          </li>
          <li>{t('Prüfungen und Protokolle aus dieser Version sind')} <strong>{t('keine gültigen Prüfnachweise')}</strong>.</li>
          <li>{t('Funktionen können sich ändern; eingegebene Daten können jederzeit ohne Ankündigung gelöscht werden.')}</li>
        </ul>
        <label className="flex items-start gap-2 text-sm font-normal text-slate-800">
          <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={gelesen} onChange={(e) => setGelesen(e.target.checked)} />
          {t('Ich habe die Hinweise gelesen und nutze die App nur zur Vorschau, ohne reale Daten und nicht kommerziell.')}
        </label>
        <div className="flex flex-wrap gap-3">
          <button className="btn-primaer" disabled={!gelesen} onClick={onBestaetigt}>{t('Bestätigen und fortfahren')}</button>
          <button className="btn-sekundaer" onClick={onAbmelden}>{t('Abmelden')}</button>
        </div>
        <Entwickler className="border-t border-slate-100 pt-3" />
      </div>
    </div>
  )
}
