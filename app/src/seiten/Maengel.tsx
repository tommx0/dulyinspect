import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth'
import { Formular } from '../components/Formular'
import { AnsichtWahl, Badge, datum, Dialog, Fehler, Kacheln, Laden, Leer, Seite } from '../components/ui'
import { STUFEN, type Stufe } from '../lib/checkliste'
import { fehlertext, supabase } from '../lib/supabase'
import { entschluesselt } from '../lib/entschluesselt'
import { useAbfrage } from '../lib/useAbfrage'
import { useAnsicht } from '../lib/ansicht'
import { tb } from '../lib/begriffe'
import { t } from '../lib/sprache'
import { Auswahl } from '../components/Auswahl'

type MangelZeile = {
  id: string
  stufe: number
  beschreibung: string
  status: 'offen' | 'behoben' | 'nachgeprueft' | 'verworfen'
  erstellt_am: string
  behoben_am: string | null
  behoben_notiz: string | null
  anlage: { id: string; etikett_id: string | null; kunden_bezeichnung: string | null; gebaeude: string | null; etage: string | null;
    objekt: { id: string; name: string; endkunde: { name: string } | null } | null } | null
}

const STATUS_TEXT = { offen: t('offen'), behoben: t('behoben (Nachprüfung ausstehend)'), nachgeprueft: t('nachgeprüft'), verworfen: t('verworfen') }

/** Mängelverfolgung über alle Kunden (Spezifikation 3.6). */
export default function Maengel() {
  const { istAdmin } = useAuth()
  const [status, setStatus] = useState<'offen' | 'behoben' | 'erledigt'>('offen')
  const [stufe, setStufe] = useState<'' | '1' | '2' | '3'>('')
  const [suche, setSuche] = useState('')
  const [ansicht, setAnsicht] = useAnsicht('maengel')
  const [dialog, setDialog] = useState<{ m: MangelZeile; art: 'behoben' | 'verwerfen' } | null>(null)
  const [fehler, setFehler] = useState('')

  const liste = useAbfrage(() => {
    const filter: MangelZeile['status'][] = status === 'offen' ? ['offen'] : status === 'behoben' ? ['behoben'] : ['nachgeprueft', 'verworfen']
    return entschluesselt('mangel', supabase.from('mangel')
      .select('id, stufe, beschreibung, status, erstellt_am, behoben_am, behoben_notiz, anlage(id, etikett_id, kunden_bezeichnung, gebaeude, etage, objekt(id, name, endkunde(id, name)))')
      .in('status', filter)
      .order('stufe', { ascending: false }).order('erstellt_am')
      .limit(1000))
  }, [status])

  const gefiltert = useMemo(() => ((liste.daten ?? []) as unknown as MangelZeile[])
    .filter((m) => !stufe || m.stufe === Number(stufe))
    .filter((m) => `${m.beschreibung} ${m.anlage?.etikett_id ?? ''} ${m.anlage?.kunden_bezeichnung ?? ''} ${m.anlage?.objekt?.name ?? ''} ${m.anlage?.objekt?.endkunde?.name ?? ''}`
      .toLowerCase().includes(suche.toLowerCase())), [liste.daten, stufe, suche])

  // Gruppiert nach Kunde → Objekt
  const gruppen = useMemo(() => {
    const m = new Map<string, { titel: string; objektId: string; maengel: MangelZeile[] }>()
    for (const x of gefiltert) {
      const o = x.anlage?.objekt
      const schluessel = o?.id ?? 'ohne'
      if (!m.has(schluessel)) m.set(schluessel, { titel: `${o?.endkunde?.name ?? '–'} · ${o?.name ?? '–'}`, objektId: o?.id ?? '', maengel: [] })
      m.get(schluessel)!.maengel.push(x)
    }
    return [...m.values()].sort((a, b) => a.titel.localeCompare(b.titel, 'de'))
  }, [gefiltert])

  const wiederOeffnen = async (m: MangelZeile) => {
    setFehler('')
    const { error } = await supabase.from('mangel').update({ status: 'offen', behoben_am: null, behoben_notiz: null }).eq('id', m.id)
    if (error) return setFehler(fehlertext(error))
    liste.neuLaden()
  }

  /** Inhalt eines Mangels, gleich in Liste und Kacheln */
  const inhalt = (m: MangelZeile) => <>
    <div className="flex flex-wrap items-center gap-2">
      <Badge farbe={m.stufe >= 3 ? 'rot' : 'gelb'}>{t('Stufe {n}', { n: m.stufe })} – {STUFEN[m.stufe as Stufe]}</Badge>
      <span className="font-mono text-sm">{m.anlage?.etikett_id ?? t('ohne Etikett')}</span>
      <span className="text-sm">{m.anlage?.kunden_bezeichnung}</span>
      <span className="text-xs text-slate-500">{[m.anlage?.gebaeude, m.anlage?.etage].filter(Boolean).join(' / ')}</span>
    </div>
    <div>{m.beschreibung}</div>
    <div className="text-xs text-slate-500">
      {t('festgestellt {datum}', { datum: datum(m.erstellt_am) })} · {STATUS_TEXT[m.status]}{m.behoben_am ? ` ${datum(m.behoben_am)}` : ''}
      {m.behoben_notiz && <> · „{m.behoben_notiz}“</>}
    </div>
    <div className="mt-auto flex flex-wrap gap-3 pt-1 text-sm">
      {(m.status === 'offen' || m.status === 'behoben') && m.anlage?.objekt && (
        <Link className="link" to={`/pruefen/o/${m.anlage.objekt.id}?anlage=${m.anlage.id}&nachpruefen=1`}>{t('Nachprüfen →')}</Link>
      )}
      {m.status === 'offen' && <button className="link" onClick={() => setDialog({ m, art: 'behoben' })}>{t('Als behoben melden')}</button>}
      {m.status === 'behoben' && <button className="link" onClick={() => void wiederOeffnen(m)}>{t('Doch nicht behoben')}</button>}
      {istAdmin && (m.status === 'offen' || m.status === 'behoben') && (
        <button className="link text-red-700" onClick={() => setDialog({ m, art: 'verwerfen' })}>{t('Verwerfen')}</button>
      )}
    </div>
  </>

  return (
    <Seite titel={t('Mängel')}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-slate-300 text-sm" role="group" aria-label={t('Status')}>
          {(['offen', 'behoben', 'erledigt'] as const).map((s) => (
            <button key={s} onClick={() => setStatus(s)} aria-pressed={status === s}
              className={`px-3 py-1.5 ${status === s ? 'bg-marke text-white' : 'bg-white'}`}>
              {s === 'offen' ? t('Offen') : s === 'behoben' ? t('Behoben gemeldet') : t('Erledigt')}
            </button>
          ))}
        </div>
        <Auswahl aria-label={t('Stufe')} className="mt-0 w-auto" value={stufe} onChange={(e) => setStufe(e.target.value as typeof stufe)}>
          <option value="">{t('alle Stufen')}</option>
          {([3, 2, 1] as Stufe[]).map((s) => <option key={s} value={s}>{t('Stufe {n}', { n: s })} – {STUFEN[s]}</option>)}
        </Auswahl>
        <input type="search" placeholder={tb('Kunde, Objekt, Tür, Beschreibung …')} value={suche} onChange={(e) => setSuche(e.target.value)} className="mt-0 max-w-xs" aria-label={t('Mängel suchen')} />
        <span className="ml-auto"><AnsichtWahl wert={ansicht} onWechsel={setAnsicht} /></span>
      </div>
      <p className="text-sm text-slate-500">
        {status === 'offen' && t('Festgestellte Mängel, die noch nicht beseitigt sind.')}
        {status === 'behoben' && t('Als behoben gemeldet – endgültig erledigt erst nach Bestätigung bei der nächsten Prüfung vor Ort.')}
        {status === 'erledigt' && t('Bei einer Prüfung als behoben bestätigt oder vom Admin verworfen.')}
        {' '}{t('{n} Mängel.', { n: gefiltert.length })}
      </p>
      <Fehler text={fehler || liste.fehler} />
      {liste.laedt ? <Laden /> : gruppen.length === 0 ? <Leer>{t('Keine Mängel in dieser Ansicht.')}</Leer> : gruppen.map((g) => (
        <section key={g.objektId || g.titel} className="karte">
          <h2 className="flex items-center justify-between border-b border-slate-100 px-4 py-2 font-semibold">
            <Link className="link" to={`/objekte/${g.objektId}`}>{g.titel}</Link>
            <span className="text-sm font-normal text-slate-500">{g.maengel.length}</span>
          </h2>
          {ansicht === 'kacheln' ? (
            <div className="p-3">
              <Kacheln aria-label={t('Mängel {titel}', { titel: g.titel })}>
                {g.maengel.map((m) => (
                  <li key={m.id} className="flex h-full flex-col gap-1.5 rounded-lg border border-slate-200 bg-white p-3" data-mangel-zeile={m.id}>{inhalt(m)}</li>
                ))}
              </Kacheln>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {g.maengel.map((m) => <li key={m.id} className="space-y-1 px-4 py-3" data-mangel-zeile={m.id}>{inhalt(m)}</li>)}
            </ul>
          )}
        </section>
      ))}

      <Dialog offen={dialog !== null} titel={dialog?.art === 'verwerfen' ? t('Mangel verwerfen') : t('Mangel als behoben melden')} onSchliessen={() => setDialog(null)}>
        {dialog && (
          <Formular
            key={dialog.m.id + dialog.art}
            felder={[{
              name: 'notiz', typ: 'textarea', pflicht: true,
              label: dialog.art === 'verwerfen' ? t('Begründung (z. B. Fehleintrag)') : t('Wie/wann behoben? (z. B. „Melder getauscht, Rechnung 4711“)'),
            }]}
            start={{}}
            speichernText={dialog.art === 'verwerfen' ? t('Verwerfen') : t('Als behoben melden')}
            onAbbrechen={() => setDialog(null)}
            onSpeichern={async (w) => {
              const notiz = String(w.notiz)
              const { error } = await supabase.from('mangel')
                .update(dialog.art === 'verwerfen'
                  ? { status: 'verworfen', behoben_notiz: `Verworfen: ${notiz}`, behoben_am: new Date().toISOString() }
                  : { status: 'behoben', behoben_notiz: notiz })
                .eq('id', dialog.m.id)
              if (error) return fehlertext(error)
              setDialog(null)
              liste.neuLaden()
            }}
          />
        )}
      </Dialog>
    </Seite>
  )
}
