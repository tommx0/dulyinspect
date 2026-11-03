import { useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth'
import { ARTEN } from '../lib/anlagenarten'
import { sachkundeStatus, WARNUNG_TAGE } from '../lib/sachkunde'
import { supabase } from '../lib/supabase'
import { t } from '../lib/sprache'
import { useAbfrage } from '../lib/useAbfrage'
import { datum } from './ui'

/** Startseite für Admin und Planer: Sachkunde, die abgelaufen ist oder in den nächsten 60 Tagen abläuft. */
export function SachkundeHinweis() {
  const { systemSichtbar } = useAuth()
  const [{ heute, grenze }] = useState(() => ({
    heute: new Date().toISOString().slice(0, 10),
    grenze: new Date(Date.now() + WARNUNG_TAGE * 864e5).toISOString().slice(0, 10),
  }))
  const liste = useAbfrage(() => supabase.from('benutzer_sachkunde').select('anlagenart, gueltig_bis, benutzer!inner(id, name, aktiv)')
    .lte('gueltig_bis', grenze).eq('benutzer.aktiv', true).order('gueltig_bis'))
  if (!liste.daten?.length) return null
  return (
    <section role="status" className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" data-sachkunde-hinweis>
      <h2 className="font-semibold">{t('Sachkunde läuft ab')}</h2>
      <ul className="list-disc pl-5">
        {liste.daten.map((x) => (
          <li key={`${x.benutzer?.id}-${x.anlagenart}`}>
            {x.benutzer?.name}: {ARTEN[x.anlagenart as keyof typeof ARTEN]?.name ?? x.anlagenart}
            {' – '}{sachkundeStatus(x.gueltig_bis, heute) === 'abgelaufen' ? t('abgelaufen am') : t('gültig bis')} {datum(x.gueltig_bis)}
          </li>
        ))}
      </ul>
      {systemSichtbar && <Link className="link" to="/benutzer">{t('Zu den Benutzern')}</Link>}
    </section>
  )
}
