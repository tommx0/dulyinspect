// Wieder geöffnete Prüfung: Grund, Stand der Unterschriften und bisherige Änderungen dieser Revision.
import { useEffect, useState } from 'react'
import { Badge, datum } from '../../components/ui'
import { fehlertext, supabase } from '../../lib/supabase'
import type { Mitpruefer, Pruefung } from '../../offline/db'
import { useSyncStatus } from '../../offline/sync'
import { aenderungenLaden } from '../../protokoll/daten'
import type { ProtokollAenderung } from '../../protokoll/typen'
import { gebietsschema, t } from '../../lib/sprache'

const zeit = (d: string) => new Date(d).toLocaleString(gebietsschema(), { dateStyle: 'short', timeStyle: 'short' })

/** Liste der Änderungen (Zeit, wer, was). */
export function AenderungListe({ liste }: { liste: ProtokollAenderung[] }) {
  if (!liste.length) return <p className="text-sm text-slate-500">{t('Noch keine Änderungen.')}</p>
  return (
    <ul className="divide-y divide-slate-100 text-sm" aria-label={t('Änderungen')}>
      {liste.map((a, i) => (
        <li key={i} className="py-1.5">
          <div>{a.text}</div>
          <div className="text-xs text-slate-500">{zeit(a.am)} · {a.von}</div>
        </li>
      ))}
    </ul>
  )
}

type Stand = { wer: string; rolle: string; gueltig: boolean }

/**
 * Laufende Revision: warum wieder geöffnet, wer (noch) gültig unterschrieben hat und was bisher geändert wurde.
 * Die Änderungen kommen vom Server – noch nicht übertragene erscheinen nach dem nächsten Abgleich.
 */
export function RevisionStand({ pruefung, mitpruefer, namen }: { pruefung: Pruefung; mitpruefer: Mitpruefer[]; namen: Map<string, string> }) {
  const { online, letzterErfolg } = useSyncStatus()
  const [grund, setGrund] = useState<{ grund: string; am: string; von: string } | null>(null)
  const [aenderungen, setAenderungen] = useState<ProtokollAenderung[] | null>(null)
  const [fehler, setFehler] = useState('')
  const pid = pruefung.id
  const revision = pruefung.revision

  useEffect(() => {
    if (!online) return
    let aktiv = true
    void Promise.all([
      supabase.from('anlagenpruefung_revision').select('grund, am, benutzer(name)').eq('anlagenpruefung_id', pid).eq('revision', revision).maybeSingle(),
      aenderungenLaden(pid),
    ]).then(([g, je]) => {
      if (!aktiv) return
      if (g.data) setGrund({ grund: g.data.grund, am: g.data.am, von: g.data.benutzer?.name ?? t('Admin') })
      setAenderungen(je.get(revision) ?? [])
      setFehler('')
    }).catch((e) => { if (aktiv) setFehler(fehlertext(e)) })
    return () => { aktiv = false }
  }, [online, pid, revision, letzterErfolg])

  const name = (id: string) => namen.get(id) ?? t('Prüfer')
  const unterschriften: Stand[] = [
    { wer: name(pruefung.pruefer_id), rolle: t('Prüfer'), gueltig: !!pruefung.unterschrift_am },
    ...mitpruefer.filter((m) => m.status === 'zugelassen').map((m) => ({ wer: name(m.benutzer_id), rolle: t('Mitprüfer'), gueltig: !!m.fertig_am })),
    ...(pruefung.kunde_unterschrift ? [{ wer: pruefung.kunde_name ?? t('Kunde'), rolle: t('Kunde'), gueltig: !!pruefung.kunde_unterschrift_am }] : []),
  ]

  return (
    <section className="karte space-y-3 border-sky-200 bg-sky-50 p-4 text-sm text-sky-900" aria-label={t('Revision')}>
      <div>
        <p className="font-medium">{t('Wieder geöffnet – Revision {revision}', { revision })}</p>
        {grund && <p>{t('Grund:')} {grund.grund} <span className="text-sky-700">· {grund.von}, {datum(grund.am)}</span></p>}
        {pruefung.urspruenglicher_pruefer_id && <p>{t('Übernommen von {name}.', { name: name(pruefung.urspruenglicher_pruefer_id) })}</p>}
        <p className="text-sky-800">{t('Mit dem Wiederöffnen sind alle Unterschriften erloschen: Mitprüfer melden ihren Teil neu fertig, Prüfer und Kunde unterschreiben beim Abschluss neu.')}</p>
      </div>
      <div>
        <h3 className="font-medium">{t('Unterschriften')}</h3>
        <ul className="mt-1 flex flex-wrap gap-1.5" aria-label={t('Unterschriften')}>
          {unterschriften.map((u, i) => (
            <li key={i}><Badge farbe={u.gueltig ? 'gruen' : 'gelb'}>{u.rolle} {u.wer}: {u.gueltig ? t('gültig') : t('erloschen')}</Badge></li>
          ))}
        </ul>
      </div>
      <div className="rounded-md border border-sky-100 bg-white p-3 text-slate-800">
        <h3 className="font-medium">{t('Änderungen in dieser Revision')}</h3>
        {!online ? <p className="text-sm text-slate-500">{t('Die Liste erscheint mit Internetverbindung.')}</p>
          : fehler ? <p className="text-sm text-red-700">{fehler}</p>
          : aenderungen ? <AenderungListe liste={aenderungen} /> : <p className="text-sm text-slate-500">{t('Lädt …')}</p>}
      </div>
    </section>
  )
}
