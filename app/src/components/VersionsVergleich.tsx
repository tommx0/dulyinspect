import { useMemo } from 'react'
import type { Punkt } from '../lib/checkliste'
import { t } from '../lib/sprache'
import { diffZusammenfassung, versionsDiff, type DiffEintrag } from '../lib/versionsDiff'

const ART: Record<DiffEintrag['art'], { titel: string; farbe: string; rand: string }> = {
  neu: { titel: t('Neu'), farbe: 'bg-green-100 text-green-800', rand: 'border-green-500' },
  geaendert: { titel: t('Geändert'), farbe: 'bg-amber-100 text-amber-800', rand: 'border-amber-500' },
  entfernt: { titel: t('Entfernt'), farbe: 'bg-red-100 text-red-800', rand: 'border-red-500' },
  verschoben: { titel: t('Verschoben'), farbe: 'bg-slate-100 text-slate-700', rand: 'border-slate-400' },
}

/** Änderungen von `alt` zu `neu` Punkt für Punkt. */
export function VersionsVergleich({ alt, neu, labelAlt, labelNeu }: { alt: Punkt[]; neu: Punkt[]; labelAlt: string; labelNeu: string }) {
  const diff = useMemo(() => versionsDiff(alt, neu), [alt, neu])
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        {t('{neu} gegenüber {alt}:', { neu: labelNeu, alt: labelAlt })} <strong>{diffZusammenfassung(diff)}</strong>
        {diff.unveraendert > 0 && ` · ${diff.unveraendert === 1 ? t('1 Punkt unverändert') : t('{n} Punkte unverändert', { n: diff.unveraendert })}`}
      </p>
      {diff.eintraege.length > 0 && (
        <ul className="space-y-2">
          {diff.eintraege.map((e) => {
            const a = ART[e.art]
            return (
              <li key={`${e.art}-${e.punkt.id}`} className={`karte border-l-4 px-4 py-2 ${a.rand}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${a.farbe}`}>{a.titel}</span>
                  {e.verschoben && e.art === 'geaendert' && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{t('an anderer Stelle')}</span>}
                  <span className={e.art === 'entfernt' ? 'line-through' : ''}>{e.punkt.text}</span>
                  <span className="text-xs text-slate-400">{e.punkt.abschnitt}</span>
                </div>
                {e.aenderungen.length > 0 && (
                  <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-sm">
                    {e.aenderungen.map((c) => (
                      <div key={c.feld} className="contents">
                        <dt className="text-slate-500">{c.feld}</dt>
                        <dd><span className="text-red-700 line-through">{c.alt}</span> <span aria-hidden>→</span> <span className="text-green-700">{c.neu}</span></dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
