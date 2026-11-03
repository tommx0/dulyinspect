import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { useAuth } from '../auth'
import { naechsterOffener, SCHRITT_INFO, SCHRITTE, schrittStand } from '../lib/inbetriebnahme'
import { t } from '../lib/sprache'
import { useAbfrage } from '../lib/useAbfrage'
import { inbetriebnahmeLaden } from '../seiten/Inbetriebnahme'

/** Startseite für den Admin, solange die Inbetriebnahme nicht abgeschlossen ist: Stand und Link zum nächsten offenen Schritt. */
export function InbetriebnahmeHinweis() {
  const { istSystemadmin } = useAuth()
  const abfrage = useAbfrage(async () => istSystemadmin ? inbetriebnahmeLaden() : { data: null, error: null }, [istSystemadmin])
  const d = abfrage.daten
  if (!d || d.stand.abgeschlossen) return null
  const erledigt = schrittStand(d.fakten, d.stand)
  const anzahl = SCHRITTE.filter((s) => erledigt[s]).length
  const naechster = naechsterOffener(erledigt)
  return (
    <section role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950" data-inbetriebnahme-hinweis>
      <div className="space-y-0.5">
        <h2 className="font-semibold">{t('Inbetriebnahme: {n} von {m} Schritten erledigt', { n: anzahl, m: SCHRITTE.length })}</h2>
        <p>{naechster ? t('Als Nächstes: {schritt}.', { schritt: t(SCHRITT_INFO[naechster].titel) }) : t('Alle Schritte erledigt – jetzt nur noch abschließen.')}</p>
      </div>
      <Link className="btn-primaer" to={`/inbetriebnahme?schritt=${naechster ?? 'abschluss'}`}>
        {t('Einrichtung fortsetzen')}<ArrowRight className="size-4" aria-hidden />
      </Link>
    </section>
  )
}
