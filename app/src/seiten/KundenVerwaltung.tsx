import { useState } from 'react'
import { Link } from 'react-router'
import { DateiKnoepfe } from '../components/DateiKnoepfe'
import { Formular } from '../components/Formular'
import { Lesbar } from '../components/Lesbar'
import { ObjektSymbol } from '../components/Symbole'
import { AnsichtWahl, Badge, Dialog, Fehler, Kacheln, Laden, Leer, Seite, Tabelle } from '../components/ui'
import { useAnsicht } from '../lib/ansicht'
import { fehlertext, supabase, type Aenderung, type Zeile } from '../lib/supabase'
import { demoKnopf } from '../lib/demo'
import { entschluesselt } from '../lib/entschluesselt'
import { nachName } from '../lib/sortierung'
import { useAbfrage } from '../lib/useAbfrage'
import { verschluesseln } from '../lib/verschluesselung'
import { KUNDE_FELDER } from './Kunden'
import { t } from '../lib/sprache'

type Kunde = Zeile<'endkunde'> & { objekt: { count: number }[] }

/** Kundenliste (Verwaltung): alle Kunden als Tabelle, anlegen, bearbeiten, exportieren. */
export default function KundenVerwaltung() {
  const [suche, setSuche] = useState('')
  const [nurAktive, setNurAktive] = useState(true)
  const [ansicht, setAnsicht] = useAnsicht('kundenliste')
  const [dialog, setDialog] = useState<Kunde | 'neu' | null>(null)
  const [meldung, setMeldung] = useState<{ text: string; kunde?: string } | null>(null)
  const [heute] = useState(() => new Date().toISOString().slice(0, 10))
  const kunden = useAbfrage(async () => {
    const r = await entschluesselt('endkunde', supabase.from('endkunde').select('*, objekt(count)'))
    return r.data ? { ...r, data: nachName(r.data) } : r
  })

  const alle = (kunden.daten ?? []) as Kunde[]
  const gefiltert = alle.filter((k) => (!nurAktive || k.aktiv)
    && [k.name, k.strasse, k.plz, k.ort, k.ansprechpartner, k.telefon, k.email, k.notiz].join(' ').toLowerCase().includes(suche.toLowerCase()))
  const adresse = (k: Kunde) => [k.strasse, [k.plz, k.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')

  const exportZeilen = () => [
    [t('Name'), t('Straße'), t('PLZ'), t('Ort'), t('Ansprechpartner'), t('Telefon'), t('E-Mail'), t('Notiz'), t('Objekte'), t('Status')],
    ...gefiltert.map((k) => [k.name, k.strasse, k.plz, k.ort, k.ansprechpartner, k.telefon, k.email, k.notiz, k.objekt[0]?.count ?? 0, k.aktiv ? t('aktiv') : t('inaktiv')]),
  ]

  const speichern = async (w: Record<string, unknown>) => {
    if (dialog === 'neu') {
      const id = crypto.randomUUID()
      const { error } = await supabase.from('endkunde').insert(await verschluesseln('endkunde', { ...w, id }) as { id: string; name: string })
      if (error) return fehlertext(error)
      setMeldung({ text: t('Kunde „{name}“ angelegt.', { name: String(w.name) }), kunde: id })
    } else {
      const { error } = await supabase.from('endkunde').update(await verschluesseln('endkunde', w, dialog!.id) as Aenderung<'endkunde'>).eq('id', dialog!.id)
      if (error) return fehlertext(error)
      setMeldung({ text: t('Kunde „{name}“ gespeichert.', { name: String(w.name) }) })
    }
    setDialog(null)
    kunden.neuLaden()
  }

  const knoepfe = (k: Kunde) => (
    <div className="flex flex-wrap gap-2">
      <button className="btn-sekundaer px-2.5 py-1 text-xs" onClick={() => setDialog(k)}>{t('Bearbeiten')}</button>
      <Link className="btn-sekundaer px-2.5 py-1 text-xs" to={`/kunden/${k.id}`}>{t('Objekte ({n})', { n: k.objekt[0]?.count ?? 0 })}</Link>
    </div>
  )

  return (
    <Seite titel={t('Kundenliste')} aktionen={<>
      <DateiKnoepfe art="export" name={`${t('Kunden')}_${heute}`} blattName={t('Kunden')} zeilen={exportZeilen} disabled={gefiltert.length === 0} />
      <button className="btn-primaer" {...demoKnopf()} onClick={() => { setMeldung(null); setDialog('neu') }}>{t('+ Kunde')}</button>
    </>}>
      {meldung && (
        <div role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          {meldung.text}{meldung.kunde && <> <Link className="link" to={`/kunden/${meldung.kunde}`}>{t('Objekte anlegen →')}</Link></>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <input type="search" placeholder={t('Suchen …')} value={suche} onChange={(e) => setSuche(e.target.value)} className="mt-0 max-w-xs" aria-label={t('Kunden suchen')} />
        <label className="flex items-center gap-2 font-normal">
          <input type="checkbox" checked={nurAktive} onChange={(e) => setNurAktive(e.target.checked)} /> {t('nur aktive')}
        </label>
        <span className="ml-auto"><AnsichtWahl wert={ansicht} onWechsel={setAnsicht} /></span>
      </div>
      <p className="text-sm text-slate-500">{t('{n} von {m} Kunden · Der Export enthält die gefilterten Kunden.', { n: gefiltert.length, m: alle.length })}</p>
      <Fehler text={kunden.fehler} />
      {kunden.laedt && !kunden.daten ? <Laden /> : gefiltert.length === 0 ? <Leer>{t('Keine Kunden gefunden.')}</Leer> : ansicht === 'kacheln' ? (
        <Kacheln>
          {gefiltert.map((k) => (
            <li key={k.id} className={`karte flex flex-col gap-2 p-4 ${k.aktiv ? '' : 'text-slate-400'}`} data-kunde={k.name}>
              <div className="flex items-start gap-3">
                <ObjektSymbol />
                <div className="min-w-0 flex-1">
                  <div className="font-medium"><Lesbar>{k.name}</Lesbar> {!k.aktiv && <Badge>{t('inaktiv')}</Badge>}</div>
                  <div className="text-sm text-slate-500">{adresse(k) || '–'}</div>
                </div>
              </div>
              {k.ansprechpartner && <div className="text-sm text-slate-600">{k.ansprechpartner}</div>}
              {(k.telefon || k.email) && (
                <div className="min-w-0 text-sm">
                  {k.telefon && <div><a className="link" href={`tel:${k.telefon}`}>{k.telefon}</a></div>}
                  {k.email && <div className="truncate"><a className="link" href={`mailto:${k.email}`}>{k.email}</a></div>}
                </div>
              )}
              <div className="mt-auto pt-1">{knoepfe(k)}</div>
            </li>
          ))}
        </Kacheln>
      ) : (
        <>
          {/* Handy: Karten */}
          <ul className="karte divide-y divide-slate-100 md:hidden">
            {gefiltert.map((k) => (
              <li key={k.id} className="space-y-1 px-4 py-3" data-kunde={k.name}>
                <div className="font-medium"><Lesbar>{k.name}</Lesbar> {!k.aktiv && <Badge>{t('inaktiv')}</Badge>}</div>
                <div className="text-sm text-slate-600">{adresse(k) || '–'}</div>
                <div className="text-sm text-slate-600">{[k.ansprechpartner, k.telefon, k.email].filter(Boolean).join(' · ')}</div>
                {knoepfe(k)}
              </li>
            ))}
          </ul>
          {/* Desktop: Tabelle */}
          <div className="hidden md:block">
            <Tabelle kopf={[t('Kunde'), t('Adresse'), t('Ansprechpartner'), t('Kontakt'), '']}>
              {gefiltert.map((k) => (
                <tr key={k.id} className={k.aktiv ? '' : 'text-slate-400'} data-kunde={k.name}>
                  <td className="px-3 py-2 font-medium"><Lesbar>{k.name}</Lesbar> {!k.aktiv && <Badge>{t('inaktiv')}</Badge>}</td>
                  <td className="px-3 py-2">{adresse(k) || '–'}</td>
                  <td className="px-3 py-2">{k.ansprechpartner ?? '–'}</td>
                  <td className="px-3 py-2">
                    {k.telefon && <div><a className="link" href={`tel:${k.telefon}`}>{k.telefon}</a></div>}
                    {k.email && <div><a className="link" href={`mailto:${k.email}`}>{k.email}</a></div>}
                    {!k.telefon && !k.email && '–'}
                  </td>
                  <td className="px-3 py-2">{knoepfe(k)}</td>
                </tr>
              ))}
            </Tabelle>
          </div>
        </>
      )}

      <Dialog offen={dialog !== null} titel={dialog === 'neu' ? t('Neuer Kunde') : t('Kunde bearbeiten')} onSchliessen={() => setDialog(null)}>
        {dialog && (
          <Formular key={dialog === 'neu' ? 'neu' : dialog.id}
            felder={dialog === 'neu' ? KUNDE_FELDER : [...KUNDE_FELDER, { name: 'aktiv', label: t('aktiv'), typ: 'checkbox' }]}
            start={dialog === 'neu' ? {} : dialog} onAbbrechen={() => setDialog(null)} onSpeichern={speichern} />
        )}
      </Dialog>
    </Seite>
  )
}
