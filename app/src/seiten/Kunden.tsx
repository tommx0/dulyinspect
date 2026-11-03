import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../auth'
import { Formular, type FeldDef } from '../components/Formular'
import { Lesbar } from '../components/Lesbar'
import { ObjektSymbol, Weiter } from '../components/Symbole'
import { AnsichtWahl, Badge, Dialog, Fehler, Kacheln, Laden, Leer, Seite } from '../components/ui'
import { useAnsicht } from '../lib/ansicht'
import { fehlertext, supabase } from '../lib/supabase'
import { demoKnopf } from '../lib/demo'
import { entschluesselt } from '../lib/entschluesselt'
import { nachName } from '../lib/sortierung'
import { useAbfrage } from '../lib/useAbfrage'
import { verschluesseln } from '../lib/verschluesselung'
import { t } from '../lib/sprache'

export const KUNDE_FELDER: FeldDef[] = [
  { name: 'name', label: t('Name'), pflicht: true, breit: true },
  { name: 'strasse', label: t('Straße'), breit: true },
  { name: 'plz', label: t('PLZ') },
  { name: 'ort', label: t('Ort') },
  { name: 'ansprechpartner', label: t('Ansprechpartner') },
  { name: 'telefon', label: t('Telefon'), typ: 'tel' },
  { name: 'email', label: t('E-Mail'), typ: 'email', breit: true },
  { name: 'notiz', label: t('Notiz'), typ: 'textarea' },
]

const objekteText = (n: number) => (n === 1 ? t('1 Objekt') : t('{n} Objekte', { n }))

export default function Kunden() {
  const { istAdmin } = useAuth()
  const navigate = useNavigate()
  const [suche, setSuche] = useState('')
  const [neu, setNeu] = useState(false)
  const [nurAktive, setNurAktive] = useState(true)
  const [ansicht, setAnsicht] = useAnsicht('kunden')
  // Namen sind verschlüsselt: erst entschlüsseln, dann im Browser sortieren
  const { daten, fehler, laedt } = useAbfrage(async () => {
    const r = await entschluesselt('endkunde', supabase.from('endkunde').select('*, objekt(count)'))
    return r.data ? { ...r, data: nachName(r.data) } : r
  })

  const gefiltert = (daten ?? []).filter((k) =>
    (!nurAktive || k.aktiv) &&
    `${k.name} ${k.ort ?? ''} ${k.ansprechpartner ?? ''}`.toLowerCase().includes(suche.toLowerCase()))

  return (
    <Seite titel={t('Kunden')} aktionen={istAdmin && <button className="btn-primaer" {...demoKnopf()} onClick={() => setNeu(true)}>{t('+ Kunde')}</button>}>
      <div className="flex flex-wrap items-center gap-3">
        <input type="search" placeholder={t('Suchen …')} value={suche} onChange={(e) => setSuche(e.target.value)} className="max-w-xs" />
        <label className="flex items-center gap-2 font-normal">
          <input type="checkbox" checked={nurAktive} onChange={(e) => setNurAktive(e.target.checked)} /> {t('nur aktive')}
        </label>
        <span className="ml-auto"><AnsichtWahl wert={ansicht} onWechsel={setAnsicht} /></span>
      </div>
      <Fehler text={fehler} />
      {laedt ? <Laden /> : gefiltert.length === 0 ? <Leer>{t('Keine Kunden gefunden.')}</Leer> : ansicht === 'kacheln' ? (
        <Kacheln>
          {gefiltert.map((k) => (
            <li key={k.id} data-kunde={k.name}>
              <Link to={`/kunden/${k.id}`} className={`kachel group ${k.aktiv ? '' : 'text-slate-400'}`}>
                <div className="flex items-start gap-3">
                  <ObjektSymbol />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium"><Lesbar>{k.name}</Lesbar> {!k.aktiv && <Badge>{t('inaktiv')}</Badge>}</div>
                    <div className="text-sm text-slate-500">{[k.strasse, [k.plz, k.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '–'}</div>
                  </div>
                </div>
                {k.ansprechpartner && <div className="text-sm text-slate-600">{k.ansprechpartner}</div>}
                <div className="mt-auto flex items-center justify-between pt-1 text-sm text-slate-500">
                  {objekteText(k.objekt[0]?.count ?? 0)} <Weiter />
                </div>
              </Link>
            </li>
          ))}
        </Kacheln>
      ) : (
        <ul className="karte divide-y divide-slate-100">
          {gefiltert.map((k) => (
            <li key={k.id}>
              <Link to={`/kunden/${k.id}`} className="zeile group">
                <ObjektSymbol />
                <div className="min-w-0 flex-1">
                  <div className="font-medium"><Lesbar>{k.name}</Lesbar> {!k.aktiv && <Badge>{t('inaktiv')}</Badge>}</div>
                  <div className="text-sm text-slate-500">{[k.plz, k.ort].filter(Boolean).join(' ') || '–'}</div>
                </div>
                <span className="text-sm text-slate-500">{objekteText(k.objekt[0]?.count ?? 0)}</span>
                <Weiter />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Dialog offen={neu} titel={t('Neuer Kunde')} onSchliessen={() => setNeu(false)}>
        <Formular
          felder={KUNDE_FELDER}
          start={{}}
          onAbbrechen={() => setNeu(false)}
          onSpeichern={async (w) => {
            const id = crypto.randomUUID()
            const { error } = await supabase.from('endkunde').insert(await verschluesseln('endkunde', { ...w, id }) as { id: string; name: string })
            if (error) return fehlertext(error)
            navigate(`/kunden/${id}`)
          }}
        />
      </Dialog>
    </Seite>
  )
}
