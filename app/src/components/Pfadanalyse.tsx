import type { Analyse } from '../lib/checklisteAnalyse'
import { t } from '../lib/sprache'

/** Ergebnis der Pfad-Analyse: Kennzahlen, Warnungen (unerreichbare Punkte) und Hinweise. */
export function Pfadanalyse({ analyse }: { analyse: Analyse }) {
  const warnungen = analyse.hinweise.filter((h) => h.art === 'warnung')
  const hinweise = analyse.hinweise.filter((h) => h.art === 'hinweis')
  const bereich = (min: number, max: number) => (min === max ? `${max}` : `${min}–${max}`)
  return (
    <details className="karte text-sm" open={warnungen.length > 0}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
        <span className="font-semibold">{t('Pfad-Analyse')}</span>
        {analyse.vollstaendig ? (
          <span className="text-slate-600">
            {analyse.pfade === 1 ? t('1 Weg') : t('{n} Wege', { n: analyse.pfade })} · {t('{punkte} Punkte je Prüfung (davon Pflicht {pflicht})', {
              punkte: bereich(analyse.sichtbarMin, analyse.sichtbarMax), pflicht: bereich(analyse.pflichtMin, analyse.pflichtMax),
            })}
          </span>
        ) : (
          <span className="text-slate-600">{t('zu viele Verzweigungen für eine vollständige Analyse')}</span>
        )}
        {warnungen.length > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">{warnungen.length === 1 ? t('1 Warnung') : t('{n} Warnungen', { n: warnungen.length })}</span>}
        {hinweise.length > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{hinweise.length === 1 ? t('1 Hinweis') : t('{n} Hinweise', { n: hinweise.length })}</span>}
        {analyse.vollstaendig && analyse.hinweise.length === 0 && <span className="text-green-700">{t('keine Auffälligkeiten')}</span>}
      </summary>
      {analyse.hinweise.length > 0 && (
        <ul className="space-y-1 border-t border-slate-100 px-4 py-3">
          {[...warnungen, ...hinweise].map((h, i) => (
            <li key={`${h.punkt}-${i}`} className={`flex gap-2 ${h.art === 'warnung' ? 'text-amber-900' : 'text-slate-600'}`}>
              <span aria-hidden>{h.art === 'warnung' ? '⚠️' : 'ℹ️'}</span>
              <span>{h.text}</span>
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}
