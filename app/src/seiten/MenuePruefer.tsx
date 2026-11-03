import { useState } from 'react'
import { Fehler, Laden, Seite } from '../components/ui'
import { AUSBLENDBAR, menueNeuLaden, type Bereich } from '../lib/menue'
import { fehlertext, supabase } from '../lib/supabase'
import { useAbfrage } from '../lib/useAbfrage'
import { t } from '../lib/sprache'

/** Admin/Planer: welche Menüpunkte Prüfer sehen. */
export default function MenuePruefer() {
  const daten = useAbfrage(() => supabase.from('menue_pruefer').select('ausgeblendet, geaendert_am').single())
  const [wahl, setWahl] = useState<Bereich[] | null>(null)
  const [fehler, setFehler] = useState('')
  const [meldung, setMeldung] = useState('')
  const [laeuft, setLaeuft] = useState(false)

  if (daten.laedt && !daten.daten) return <Laden />
  const ausgeblendet = wahl ?? ((daten.daten?.ausgeblendet ?? []) as Bereich[])

  const speichern = async () => {
    setLaeuft(true); setFehler(''); setMeldung('')
    const { error } = await supabase.from('menue_pruefer').update({ ausgeblendet }).eq('id', 1)
    setLaeuft(false)
    if (error) return setFehler(fehlertext(error))
    menueNeuLaden()
    setMeldung(t('Gespeichert. Prüfer sehen die Änderung beim nächsten Öffnen der App.'))
    setWahl(null)
    daten.neuLaden()
  }

  return (
    <Seite titel={t('Menü für Prüfer')}>
      <p className="text-sm text-slate-600">
        {t('Legen Sie fest, welche Bereiche Prüfer im Menü sehen.')} <strong>{t('Start')}</strong> {t('und')} <strong>{t('Prüfen')}</strong> {t('sind immer sichtbar,')}
        <strong> {t('Verwaltung')}</strong> {t('und')} <strong>{t('System')}</strong> {t('sehen Prüfer nie.')}
        {' '}{t('Ausgeblendete Bereiche sind für Prüfer auch über die Adresse gesperrt. Für Admins und Planer ändert sich nichts.')}
      </p>
      <section className="karte divide-y divide-slate-100">
        {AUSBLENDBAR.map((a) => (
          <label key={a.bereich} className="flex cursor-pointer items-start gap-3 px-4 py-3 font-normal">
            <input type="checkbox" className="mt-1" checked={!ausgeblendet.includes(a.bereich)}
              onChange={(e) => setWahl(e.target.checked ? ausgeblendet.filter((b) => b !== a.bereich) : [...ausgeblendet, a.bereich])} />
            <span>
              <span className="block font-medium text-slate-800">{a.text}</span>
              <span className="block text-sm text-slate-500">{a.hinweis}</span>
            </span>
          </label>
        ))}
      </section>
      <Fehler text={fehler || daten.fehler} />
      {meldung && <div role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">{meldung}</div>}
      <button className="btn-primaer" disabled={laeuft || wahl === null} onClick={() => void speichern()}>{t('Speichern')}</button>
    </Seite>
  )
}
