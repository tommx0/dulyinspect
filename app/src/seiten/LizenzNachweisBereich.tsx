import { Fehler } from '../components/ui'
import { supabase } from '../lib/supabase'
import { useAbfrage } from '../lib/useAbfrage'
import { gebietsschema, t } from '../lib/sprache'

const zeit = (iso: string) => new Date(iso).toLocaleString(gebietsschema(), { dateStyle: 'medium', timeStyle: 'medium' })

/** Nachweis, wer die Lizenzbedingungen welcher App-Version wann und von welcher IP-Adresse akzeptiert hat (nur Admin). */
export function LizenzNachweisBereich() {
  const liste = useAbfrage(() => supabase.from('lizenz_akzeptanz').select('*').order('akzeptiert_am', { ascending: false }).limit(200))
  return (
    <section className="karte space-y-3 p-4">
      <h2 className="font-semibold">{t('Lizenzbedingungen: Zustimmungen')}</h2>
      <p className="text-sm text-slate-600">
        {t('Jeder Benutzer akzeptiert die Lizenzbedingungen nach der Erstinstallation und nach jedem Update einmal. Festgehalten werden Zeitpunkt, Benutzer, Version und IP-Adresse.')}
      </p>
      <Fehler text={liste.fehler} />
      {liste.daten && liste.daten.length === 0 && <p className="text-sm text-slate-500">{t('Noch keine Zustimmungen erfasst.')}</p>}
      {!!liste.daten?.length && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-600">
              <tr><th className="py-1 pr-3">{t('Datum und Uhrzeit')}</th><th className="pr-3">{t('Benutzer')}</th><th className="pr-3">{t('Version')}</th><th className="pr-3">{t('Stand')}</th><th>{t('IP-Adresse')}</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {liste.daten.map((z) => (
                <tr key={z.id} title={z.user_agent ?? undefined}>
                  <td className="whitespace-nowrap py-1 pr-3">{zeit(z.akzeptiert_am)}</td>
                  <td className="pr-3">{z.benutzer_name}</td>
                  <td className="pr-3">{z.version}</td>
                  <td className="pr-3">{z.lizenz_stand ?? '–'}</td>
                  <td className="break-all">{z.ip ?? t('unbekannt')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
