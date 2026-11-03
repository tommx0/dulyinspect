import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useAuth } from '../auth'
import { Formular, type FeldDef } from '../components/Formular'
import { Pruefungsverlauf } from '../components/Pruefungsverlauf'
import { Lesbar } from '../components/Lesbar'
import { ObjektSymbol, Weiter } from '../components/Symbole'
import { AnsichtWahl, Badge, Dialog, Fehler, Kacheln, Laden, Leer, Seite } from '../components/ui'
import { useAnsicht } from '../lib/ansicht'
import { fehlertext, supabase, type Aenderung } from '../lib/supabase'
import { demoKnopf } from '../lib/demo'
import { TUERANLAGE_TYP } from '../lib/tueranlage'
import { entschluesselt } from '../lib/entschluesselt'
import { nachName } from '../lib/sortierung'
import { useAbfrage } from '../lib/useAbfrage'
import { verschluesseln } from '../lib/verschluesselung'
import { KUNDE_FELDER } from './Kunden'
import { tb } from '../lib/begriffe'
import { t } from '../lib/sprache'

export const OBJEKT_FELDER: FeldDef[] = [
  { name: 'name', label: t('Name des Objekts'), pflicht: true, breit: true, hinweis: t('z. B. „Haupthaus“, „Werk 2“') },
  { name: 'strasse', label: t('Straße'), breit: true },
  { name: 'plz', label: t('PLZ') },
  { name: 'ort', label: t('Ort') },
  { name: 'zugangshinweise', label: t('Zugangshinweise'), typ: 'textarea', hinweis: t('Schlüssel, Ansprechpartner vor Ort, Parken …') },
]

export default function KundeDetail() {
  const { id = '' } = useParams()
  const { istAdmin } = useAuth()
  const navigate = useNavigate()
  const [bearbeiten, setBearbeiten] = useState(false)
  const [neuesObjekt, setNeuesObjekt] = useState(false)
  const [ansicht, setAnsicht] = useAnsicht('kunde.objekte')

  const kunde = useAbfrage(() => entschluesselt('endkunde', supabase.from('endkunde').select('*').eq('id', id).single()), [id])
  const objekte = useAbfrage(async () => {
    const r = await entschluesselt('objekt', supabase.from('objekt').select('*, anlage(count)').eq('endkunde_id', id).neq('anlage.anlagentyp_id', TUERANLAGE_TYP))
    return r.data ? { ...r, data: nachName(r.data) } : r
  }, [id])

  if (kunde.laedt && !kunde.daten) return <Laden />
  const k = kunde.daten
  if (!k) return <Seite titel={t('Kunde')}><Fehler text={kunde.fehler || t('Nicht gefunden')} /></Seite>

  return (
    <Seite
      titel={<><Lesbar>{k.name}</Lesbar> {!k.aktiv && <Badge>{t('inaktiv')}</Badge>}</>}
      zurueck={{ zu: '/kunden', text: t('Kunden') }}
      aktionen={istAdmin && <button className="btn-sekundaer" onClick={() => setBearbeiten(true)}>{t('Bearbeiten')}</button>}
    >
      <div className="karte grid gap-x-6 gap-y-1 p-4 text-sm sm:grid-cols-2">
        <div><span className="text-slate-500">{t('Adresse:')}</span> {[k.strasse, [k.plz, k.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '–'}</div>
        <div><span className="text-slate-500">{t('Ansprechpartner:')}</span> {k.ansprechpartner || '–'}</div>
        <div><span className="text-slate-500">{t('Telefon:')}</span> {k.telefon ? <a className="link" href={`tel:${k.telefon}`}>{k.telefon}</a> : '–'}</div>
        <div><span className="text-slate-500">{t('E-Mail:')}</span> {k.email ? <a className="link" href={`mailto:${k.email}`}>{k.email}</a> : '–'}</div>
        {k.notiz && <div className="sm:col-span-2"><span className="text-slate-500">{t('Notiz:')}</span> {k.notiz}</div>}
      </div>

      <div className="flex items-center justify-between pt-2">
        <h2 className="text-lg font-semibold">{t('Objekte')}</h2>
        <div className="flex items-center gap-2">
          <AnsichtWahl wert={ansicht} onWechsel={setAnsicht} />
          {istAdmin && <button className="btn-primaer" {...demoKnopf()} onClick={() => setNeuesObjekt(true)}>{t('+ Objekt')}</button>}
        </div>
      </div>
      <Fehler text={objekte.fehler} />
      {objekte.daten?.length === 0 ? <Leer>{t('Noch keine Objekte angelegt.')}</Leer> : ansicht === 'kacheln' ? (
        <Kacheln>
          {objekte.daten?.map((o) => (
            <li key={o.id} data-objekt={o.name}>
              <Link to={`/objekte/${o.id}`} className={`kachel group ${o.aktiv ? '' : 'text-slate-400'}`}>
                <div className="flex items-start gap-3">
                  <ObjektSymbol />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium"><Lesbar>{o.name}</Lesbar> {!o.aktiv && <Badge>{t('inaktiv')}</Badge>}</div>
                    <div className="text-sm text-slate-500">{[o.strasse, [o.plz, o.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '–'}</div>
                  </div>
                </div>
                <div className="mt-auto flex items-center justify-between pt-1 text-sm text-slate-500">
                  {o.anlage[0]?.count ?? 0} {tb('Türen')} <Weiter />
                </div>
              </Link>
            </li>
          ))}
        </Kacheln>
      ) : (
        <ul className="karte divide-y divide-slate-100">
          {objekte.daten?.map((o) => (
            <li key={o.id}>
              <Link to={`/objekte/${o.id}`} className="zeile group">
                <ObjektSymbol />
                <div className="min-w-0 flex-1">
                  <div className="font-medium"><Lesbar>{o.name}</Lesbar> {!o.aktiv && <Badge>{t('inaktiv')}</Badge>}</div>
                  <div className="text-sm text-slate-500">{[o.strasse, o.ort].filter(Boolean).join(', ') || '–'}</div>
                </div>
                <span className="text-sm text-slate-500">{o.anlage[0]?.count ?? 0} {tb('Türen')}</span>
                <Weiter />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section className="space-y-2 pt-2">
        <h2 className="text-lg font-semibold">{t('Letzte Protokolle')}</h2>
        <Pruefungsverlauf kundeId={id} leer={t('Noch keine abgeschlossenen Prüfungen.')} />
      </section>

      <Dialog offen={bearbeiten} titel={t('Kunde bearbeiten')} onSchliessen={() => setBearbeiten(false)}>
        <Formular
          felder={[...KUNDE_FELDER, { name: 'aktiv', label: t('aktiv'), typ: 'checkbox' }]}
          start={k}
          onAbbrechen={() => setBearbeiten(false)}
          onSpeichern={async (w) => {
            const { error } = await supabase.from('endkunde').update(await verschluesseln('endkunde', w, id) as Aenderung<'endkunde'>).eq('id', id)
            if (error) return fehlertext(error)
            setBearbeiten(false)
            kunde.neuLaden()
          }}
        />
      </Dialog>

      <Dialog offen={neuesObjekt} titel={t('Neues Objekt')} onSchliessen={() => setNeuesObjekt(false)}>
        <Formular
          felder={OBJEKT_FELDER}
          start={{ strasse: k.strasse, plz: k.plz, ort: k.ort }}
          onAbbrechen={() => setNeuesObjekt(false)}
          onSpeichern={async (w) => {
            const neueId = crypto.randomUUID()
            const { error } = await supabase.from('objekt')
              .insert(await verschluesseln('objekt', { ...(w as { name: string }), id: neueId, endkunde_id: id }))
            if (error) return fehlertext(error)
            navigate(`/objekte/${neueId}`)
          }}
        />
      </Dialog>
    </Seite>
  )
}
