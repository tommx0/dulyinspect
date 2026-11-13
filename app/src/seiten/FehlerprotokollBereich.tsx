import { useState } from 'react'
import { bestaetigen } from '../components/Bestaetigung'
import { Fehler, Laden } from '../components/ui'
import { fehlertext, supabase } from '../lib/supabase'
import { gebietsschema, t } from '../lib/sprache'
import { useAbfrage } from '../lib/useAbfrage'

// Fehlerprotokoll (Einstellungen → System): unerwartete Fehler der App und der Serverfunktionen, gleiche nur gezählt.
// Einträge verfallen nach 90 Tagen; neue gehen stündlich gesammelt per Mail an die Empfänger unter Einstellungen → Mail.
type Eintrag = { id: number; art: 'app' | 'edge' | 'protokoll'; text: string; stack: string | null; ort: string | null; version: string | null
  geraet: string | null; benutzer: string | null; anzahl: number; erstmals_am: string; zuletzt_am: string; gemeldet: boolean }

const ART: Record<Eintrag['art'], string> = { app: t('App'), edge: t('Server'), protokoll: t('Protokoll-PDF') }
const zeit = (iso: string) => new Date(iso).toLocaleString(gebietsschema(), { dateStyle: 'short', timeStyle: 'short' })

export function FehlerprotokollBereich() {
  const liste = useAbfrage(() => supabase.rpc('fehler_liste'))
  const [fehler, setFehler] = useState('')
  const eintraege = (liste.daten ?? []) as Eintrag[]

  const leeren = async () => {
    if (!await bestaetigen(t('Alle {n} Einträge des Fehlerprotokolls löschen?', { n: eintraege.length }), { ok: t('Löschen'), gefahr: true })) return
    const { error } = await supabase.rpc('fehler_leeren')
    if (error) return setFehler(fehlertext(error))
    await liste.neuLaden()
  }

  if (liste.laedt && !liste.daten) return <Laden />
  return (
    <section className="karte space-y-3 p-4" data-fehlerprotokoll>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{t('Fehlerprotokoll')}</h2>
        {eintraege.length > 0 && <button className="btn-sekundaer" onClick={() => void leeren()}>{t('Alle löschen')}</button>}
      </div>
      <p className="text-sm text-slate-600">
        {t('Unerwartete Fehler der App und der Serverfunktionen, gleiche Fehler nur gezählt. Gespeichert werden Meldung, Stelle in der App, Version und Browser – keine eingegebenen Daten. Einträge verfallen nach 90 Tagen.')}
      </p>
      <Fehler text={liste.fehler || fehler} />
      {eintraege.length === 0 ? <p className="text-sm text-slate-500">{t('Keine Fehler aufgezeichnet.')}</p> : (
        <ul className="divide-y divide-slate-100">
          {eintraege.map((e) => (
            <li key={e.id} className="py-2">
              <details>
                <summary className="cursor-pointer text-sm">
                  <span className="font-medium">{e.text}</span>
                  <span className="block text-xs text-slate-500">
                    {ART[e.art]} · {t('{n}×', { n: e.anzahl })} · {t('zuletzt {zeit}', { zeit: zeit(e.zuletzt_am) })}{e.ort ? ` · ${e.ort}` : ''}
                    {!e.gemeldet && <> · <span className="text-amber-800">{t('noch nicht gemeldet')}</span></>}
                  </span>
                </summary>
                <div className="mt-2 space-y-1 text-xs text-slate-600">
                  <p>{t('Erstmals {zeit}', { zeit: zeit(e.erstmals_am) })}{e.version ? ` · ${t('Version {v}', { v: e.version })}` : ''}{e.benutzer ? ` · ${e.benutzer}` : ''}</p>
                  {e.geraet && <p className="break-all">{e.geraet}</p>}
                  {e.stack && <pre className="max-h-48 overflow-auto rounded bg-slate-50 p-2 whitespace-pre-wrap">{e.stack}</pre>}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
