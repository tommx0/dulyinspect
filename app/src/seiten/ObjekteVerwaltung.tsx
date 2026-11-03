import { useState } from 'react'
import { Link } from 'react-router'
import { DateiKnoepfe } from '../components/DateiKnoepfe'
import { ObjektNeuDialog } from '../components/StammdatenDialoge'
import { Lesbar } from '../components/Lesbar'
import { ObjektSymbol, Weiter } from '../components/Symbole'
import { AnsichtWahl, Badge, Fehler, Kacheln, Laden, Leer, Seite, Tabelle } from '../components/ui'
import { useAnsicht } from '../lib/ansicht'
import { tb } from '../lib/begriffe'
import { t } from '../lib/sprache'
import { supabase, type Zeile } from '../lib/supabase'
import { demoKnopf } from '../lib/demo'
import { TUERANLAGE_TYP } from '../lib/tueranlage'
import { entschluesselt } from '../lib/entschluesselt'
import { useAbfrage } from '../lib/useAbfrage'
import { entschluesseln } from '../lib/verschluesselung'
import { Auswahl } from '../components/Auswahl'

type Objekt = Zeile<'objekt'> & { endkunde: { id: string; name: string } | null; anlage: { count: number }[] }

/** Objektliste (Verwaltung): alle Objekte über alle Kunden, anlegen, exportieren. */
export default function ObjekteVerwaltung() {
  const [suche, setSuche] = useState('')
  const [kunde, setKunde] = useState('')
  const [nurAktive, setNurAktive] = useState(true)
  const [ansicht, setAnsicht] = useAnsicht('objektliste')
  const [neu, setNeu] = useState(false)
  const [meldung, setMeldung] = useState<{ text: string; objekt: string } | null>(null)
  const [heute] = useState(() => new Date().toISOString().slice(0, 10))
  const objekte = useAbfrage(() => entschluesselt('objekt', supabase.from('objekt').select('*, endkunde(id, name), anlage(count)').neq('anlage.anlagentyp_id', TUERANLAGE_TYP)))

  const alle = (objekte.daten ?? []) as unknown as Objekt[]
  const kunden = [...new Map(alle.filter((o) => o.endkunde).map((o) => [o.endkunde!.id, o.endkunde!.name])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'de'))
  const gefiltert = alle.filter((o) => (!nurAktive || o.aktiv) && (!kunde || o.endkunde?.id === kunde)
    && [o.name, o.strasse, o.plz, o.ort, o.zugangshinweise, o.endkunde?.name].join(' ').toLowerCase().includes(suche.toLowerCase()))
    .sort((a, b) => `${a.endkunde?.name}|${a.name}`.localeCompare(`${b.endkunde?.name}|${b.name}`, 'de'))
  const adresse = (o: Objekt) => [o.strasse, [o.plz, o.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')

  const exportZeilen = () => [
    [t('Objekt'), t('Kunde'), t('Straße'), t('PLZ'), t('Ort'), t('Zugangshinweise'), tb('Türen'), t('Status')],
    ...gefiltert.map((o) => [o.name, o.endkunde?.name, o.strasse, o.plz, o.ort, o.zugangshinweise, o.anlage[0]?.count ?? 0, o.aktiv ? t('aktiv') : t('inaktiv')]),
  ]

  return (
    <Seite titel={t('Objekte')} aktionen={<>
      <DateiKnoepfe art="export" name={`${t('Objekte')}_${heute}`} blattName={t('Objekte')} zeilen={exportZeilen} disabled={gefiltert.length === 0} />
      <button className="btn-primaer" {...demoKnopf()} onClick={() => { setMeldung(null); setNeu(true) }}>{t('+ Objekt')}</button>
    </>}>
      {meldung && (
        <div role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          {meldung.text} <Link className="link" to={`/objekte/${meldung.objekt}`}>{tb('Türen anlegen →')}</Link>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <input type="search" placeholder={t('Suchen …')} value={suche} onChange={(e) => setSuche(e.target.value)} className="mt-0 max-w-xs" aria-label={t('Objekte suchen')} />
        <Auswahl aria-label={t('Kunde')} className="mt-0 w-auto" value={kunde} onChange={(e) => setKunde(e.target.value)}>
          <option value="">{t('alle Kunden')}</option>
          {kunden.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </Auswahl>
        <label className="flex items-center gap-2 font-normal">
          <input type="checkbox" checked={nurAktive} onChange={(e) => setNurAktive(e.target.checked)} /> {t('nur aktive')}
        </label>
        <span className="ml-auto"><AnsichtWahl wert={ansicht} onWechsel={setAnsicht} /></span>
      </div>
      <p className="text-sm text-slate-500">{t('{n} von {m} Objekten · Der Export enthält die gefilterten Objekte.', { n: gefiltert.length, m: alle.length })}</p>
      <Fehler text={objekte.fehler} />
      {objekte.laedt && !objekte.daten ? <Laden /> : gefiltert.length === 0 ? <Leer>{t('Keine Objekte gefunden.')}</Leer> : ansicht === 'kacheln' ? (
        <Kacheln>
          {gefiltert.map((o) => (
            <li key={o.id} className={`karte flex flex-col ${o.aktiv ? '' : 'text-slate-400'}`} data-objekt={o.name}>
              <Link to={`/objekte/${o.id}`} className="group flex flex-1 items-start gap-3 rounded-t-lg p-4 transition-colors hover:bg-akzent-hell/40">
                <ObjektSymbol />
                <div className="min-w-0 flex-1">
                  <div className="font-medium"><Lesbar>{o.name}</Lesbar> {!o.aktiv && <Badge>{t('inaktiv')}</Badge>}</div>
                  <div className="text-sm text-slate-500">{adresse(o) || '–'}</div>
                  <div className="mt-1 text-sm text-slate-500">{o.anlage[0]?.count ?? 0} {tb('Türen')}</div>
                </div>
                <Weiter />
              </Link>
              <div className="border-t border-slate-100 px-4 py-2 text-sm">
                {o.endkunde ? <Link className="link" to={`/kunden/${o.endkunde.id}`}><Lesbar>{o.endkunde.name}</Lesbar></Link> : '–'}
              </div>
            </li>
          ))}
        </Kacheln>
      ) : (
        <Tabelle kopf={[t('Objekt'), t('Kunde'), t('Adresse'), tb('Türen'), '']}>
          {gefiltert.map((o) => (
            <tr key={o.id} className={o.aktiv ? '' : 'text-slate-400'} data-objekt={o.name}>
              <td className="px-3 py-2 font-medium"><Lesbar>{o.name}</Lesbar> {!o.aktiv && <Badge>{t('inaktiv')}</Badge>}</td>
              <td className="px-3 py-2">{o.endkunde ? <Link className="link" to={`/kunden/${o.endkunde.id}`}><Lesbar>{o.endkunde.name}</Lesbar></Link> : '–'}</td>
              <td className="px-3 py-2">{adresse(o) || '–'}</td>
              <td className="px-3 py-2">{o.anlage[0]?.count ?? 0}</td>
              <td className="px-3 py-2"><Link className="btn-sekundaer px-2.5 py-1 text-xs" to={`/objekte/${o.id}`}>{t('Öffnen')}</Link></td>
            </tr>
          ))}
        </Tabelle>
      )}

      <ObjektNeuDialog offen={neu} onSchliessen={() => setNeu(false)}
        onFertig={async (id) => {
          const roh = (await supabase.from('objekt').select('id, name').eq('id', id).single()).data
          const name = roh ? (await entschluesseln('objekt', roh)).name : undefined
          setMeldung({ text: t('Objekt „{name}“ angelegt.', { name: name ?? '' }), objekt: id })
          setNeu(false)
          void objekte.neuLaden()
        }} />
    </Seite>
  )
}
