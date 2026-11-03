import { ENTWICKLER, ENTWICKLER_ZEIGEN } from '../lib/entwickler'
import { VORSCHAU, VORSCHAU_FUSSZEILE } from '../lib/vorschau'
import { t } from '../lib/sprache'

/** Hinweis auf den Entwickler der Software (Anmelde- und Wartungsseite). */

export function Entwickler({ className = '' }: { className?: string }) {
  if (!ENTWICKLER_ZEIGEN && !VORSCHAU) return null
  return (
    <p className={`text-center text-[11px] text-slate-400 ${className}`}>
      {ENTWICKLER_ZEIGEN && <>{t('Entwickelt von')} <a className="hover:underline" href={ENTWICKLER.url} target="_blank" rel="noopener">{ENTWICKLER.name}</a></>}
      {ENTWICKLER_ZEIGEN && VORSCHAU && <br />}
      {VORSCHAU && VORSCHAU_FUSSZEILE}
    </p>
  )
}
