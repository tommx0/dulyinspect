import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Badge, datum, Fehler, Seite, Tabelle } from '../components/ui'
import { fehlertext, supabase } from '../lib/supabase'
import { entschluesselt } from '../lib/entschluesselt'
import { useAbfrage } from '../lib/useAbfrage'
import { tb } from '../lib/begriffe'
import { t } from '../lib/sprache'

export default function Etiketten() {
  const [anzahl, setAnzahl] = useState(50)
  const [charge, setCharge] = useState('')
  const [nurFreie, setNurFreie] = useState(true)
  const [meldung, setMeldung] = useState('')
  const [fehler, setFehler] = useState('')

  const praefix = useAbfrage(() => supabase.from('firma').select('etikett_praefix').single())
  const liste = useAbfrage(() => {
    let q = supabase.from('etikett')
      .select('*, anlage:anlage!etikett_anlage_fk(id, kunden_bezeichnung, objekt_id, objekt(id, name))')
      .order('erstellt_am', { ascending: false }).order('id', { ascending: false })
      .limit(500)
    if (nurFreie) q = q.is('anlage_id', null)
    return entschluesselt('etikett', q)
  }, [nurFreie])

  const erzeugen = async (e: FormEvent) => {
    e.preventDefault()
    setFehler('')
    setMeldung('')
    const { data, error } = await supabase.rpc('etiketten_erzeugen', { p_anzahl: anzahl, p_charge: charge })
    if (error) return setFehler(fehlertext(error))
    setMeldung(t('{n} Etiketten erzeugt: {von} bis {bis}', { n: data.length, von: data[0].id, bis: data[data.length - 1].id }))
    setCharge('')
    liste.neuLaden()
  }

  return (
    <Seite titel={t('Etiketten')} aktionen={<>
      <Link to="/etiketten/druck?art=melder" className="btn-sekundaer">{t('Melder-Etiketten drucken')}</Link>
      <Link to="/etiketten/druck" className="btn-primaer">{t('Etiketten drucken')}</Link>
    </>}>
      <form onSubmit={erzeugen} className="karte flex flex-wrap items-end gap-3 p-4">
        <div className="w-28">
          <label htmlFor="anzahl">{t('Anzahl')}</label>
          <input id="anzahl" type="number" min={1} max={1000} value={anzahl} onChange={(e) => setAnzahl(Number(e.target.value))} />
        </div>
        <div className="min-w-48 flex-1">
          <label htmlFor="charge">{t('Charge / Notiz (optional)')}</label>
          <input id="charge" placeholder={t('z. B. Druck Oktober 2026')} value={charge} onChange={(e) => setCharge(e.target.value)} />
        </div>
        <button className="btn-primaer">{t('Etiketten-IDs erzeugen')}</button>
        <p className="w-full text-xs text-slate-500">
          {t('Erzeugt fortlaufende, nie wieder vergebene IDs')}{praefix.daten ? <> {t('mit dem Präfix')} <span className="font-mono font-semibold">{praefix.daten.etikett_praefix}</span></> : ''} {t('und Prüfziffer')}
          {' '}{t('(Präfix ändern: Einstellungen → Etiketten). Gedruckt wird über „Etiketten drucken“ (PDF-Druckbogen in exakten Maßen).')}
        </p>
      </form>
      {meldung && <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">{meldung}</div>}
      <Fehler text={fehler || liste.fehler} />

      <label className="flex items-center gap-2 font-normal">
        <input type="checkbox" checked={nurFreie} onChange={(e) => setNurFreie(e.target.checked)} /> {t('nur freie Etiketten anzeigen')}
      </label>
      <Tabelle kopf={[t('Etikett'), t('Charge'), t('Status'), tb('Tür')]}>
        {liste.daten?.map((e) => (
          <tr key={e.id}>
            <td className="px-3 py-2 font-mono">{e.id}</td>
            <td className="px-3 py-2">{e.charge}</td>
            <td className="px-3 py-2">{e.anlage ? <Badge farbe="gruen">{t('zugeordnet {datum}', { datum: datum(e.zugeordnet_am) })}</Badge> : <Badge>{t('frei')}</Badge>}</td>
            <td className="px-3 py-2">
              {e.anlage && (
                <Link className="link" to={`/objekte/${e.anlage.objekt_id}?anlage=${e.anlage.id}`}>
                  {e.anlage.objekt?.name} – {e.anlage.kunden_bezeichnung ?? t('ohne Bezeichnung')}
                </Link>
              )}
            </td>
          </tr>
        ))}
      </Tabelle>
    </Seite>
  )
}
