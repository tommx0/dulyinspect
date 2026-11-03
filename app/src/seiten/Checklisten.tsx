import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Formular } from '../components/Formular'
import { ArtSymbol, Weiter } from '../components/Symbole'
import { AnsichtWahl, Badge, Dialog, Fehler, Kacheln, Leer, Seite } from '../components/ui'
import { ChecklisteKopieren } from '../components/ChecklisteKopieren'
import { ExportKnopf, ImportKnopf } from '../components/VorlagenAustausch'
import { beispieleNachRueckfrage, IMPORT_NACHSATZ } from '../components/BeispieleImport'
import { fehlertext, supabase } from '../lib/supabase'
import { demoKnopf, demoSperreAktiv } from '../lib/demo'
import { simNeu, useSimulationen } from '../lib/demoCheckliste'
import { STANDARD_PRUEFART } from '../lib/anlagenarten'
import { useAbfrage } from '../lib/useAbfrage'
import { useAnsicht } from '../lib/ansicht'
import { t } from '../lib/sprache'
import { austauschDateiname, checklistenExportieren } from '../lib/vorlagenAustausch'

export default function Checklisten() {
  const navigate = useNavigate()
  const [neu, setNeu] = useState(false)
  const [kopie, setKopie] = useState<{ id: string; name: string } | null>(null)
  const [importMeldung, setImportMeldung] = useState('')
  const [importFehler, setImportFehler] = useState('')
  const [ansicht, setAnsicht] = useAnsicht('checklisten')
  const liste = useAbfrage(() =>
    supabase.from('checkliste')
      .select('*, checkliste_version(id, version, status, punkte), pruefart(name, aktiv, anlagentyp(name, anlagenart))')
      .order('name'))

  // Demomodus: simulierte Änderungen überlagern die gespeicherten, im Demo angelegte Checklisten kommen dazu
  const simulationen = useSimulationen()
  const neue = [...simulationen.values()].filter((s) => s.neu && s.kopf)
    .map((s) => ({ ...s.kopf!, checkliste_version: s.versionen ?? [], pruefart: [] as NonNullable<typeof liste.daten>[number]['pruefart'] }))
  const alle = [...(liste.daten ?? []).map((c) => {
    const s = simulationen.get(c.id)
    return s ? { ...c, ...s.kopf, checkliste_version: s.versionen ?? c.checkliste_version } : c
  }), ...neue].sort((a, b) => a.name.localeCompare(b.name, 'de'))

  // Je Checkliste: Versionen, Anzahl Prüfpunkte und wo sie verwendet wird (für Liste und Kacheln)
  const zeilen = alle.map((c) => {
    const freigegeben = c.checkliste_version.find((v) => v.status === 'freigegeben')
    const entwurf = c.checkliste_version.find((v) => v.status === 'entwurf')
    const anzahl = ((freigegeben ?? entwurf)?.punkte as unknown[] | undefined)?.length ?? 0
    const aktiv = c.pruefart.filter((p) => p.aktiv)
    const verwendet = aktiv.map((p) => [p.anlagentyp?.name, p.name === STANDARD_PRUEFART ? '' : p.name].filter(Boolean).join(' – ')).join(', ') || '–'
    const badges = <>
      {freigegeben ? <Badge farbe="gruen">{t('v{version} freigegeben', { version: freigegeben.version })}</Badge> : <Badge farbe="gelb">{t('nicht freigegeben')}</Badge>}
      {entwurf && <Badge farbe="blau">{t('Entwurf v{version}', { version: entwurf.version })}</Badge>}
      {!c.aktiv && <Badge>{t('inaktiv')}</Badge>}
      {simulationen.has(c.id) && <Badge farbe="gelb">{t('Simulation')}</Badge>}
    </>
    return { c, anzahl, verwendet, badges, art: aktiv[0]?.anlagentyp?.anlagenart }
  })
  const duplizieren = (c: { id: string; name: string }) => (
    <span className="flex shrink-0 gap-3">
      <button className="link text-sm" aria-label={t('{name} duplizieren', { name: c.name })} onClick={() => setKopie({ id: c.id, name: c.name })}>{t('Duplizieren')}</button>
      {!simulationen.get(c.id)?.neu && (
        <ExportKnopf className="link text-sm" label={t('{name} exportieren', { name: c.name })} onFehler={setImportFehler}
          laden={() => checklistenExportieren([c.id])} dateiname={austauschDateiname('checkliste', c.name)} />
      )}
    </span>
  )

  return (
    <Seite titel={t('Checklisten')} aktionen={<>
      <button className="btn-sekundaer" {...demoKnopf()} onClick={async () => {
        setImportFehler(''); setImportMeldung('')
        try {
          const m = await beispieleNachRueckfrage()
          if (m) { setImportMeldung(m); liste.neuLaden() }
        } catch (e) { setImportFehler(fehlertext(e)) }
      }}>{t('Beispiele importieren')}</button>
      <ImportKnopf onFertig={() => liste.neuLaden()} />
      <ExportKnopf text={t('Alle exportieren')} onFehler={setImportFehler} laden={() => checklistenExportieren()} dateiname={austauschDateiname('checklisten')} />
      <button className="btn-primaer" onClick={() => setNeu(true)}>{t('+ Checkliste')}</button>
      <AnsichtWahl wert={ansicht} onWechsel={setAnsicht} />
    </>}>
      {importMeldung && <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">{importMeldung} {IMPORT_NACHSATZ}</div>}
      <Fehler text={importFehler || liste.fehler} />
      {alle.length === 0 && !liste.laedt ? <Leer>{t('Noch keine Checklisten.')}</Leer> : ansicht === 'kacheln' ? (
        <Kacheln aria-label={t('Checklisten')}>
          {zeilen.map(({ c, anzahl, verwendet, badges, art }) => (
            <li key={c.id} className={`karte flex flex-col ${c.aktiv ? '' : 'text-slate-400'}`} data-checkliste={c.name}>
              <Link to={`/checklisten/${c.id}`} className="group flex flex-1 flex-col gap-2 rounded-t-lg p-4 transition hover:bg-akzent-hell/40">
                <div className="flex items-start gap-3">
                  <ArtSymbol art={art} />
                  <div className="min-w-0 flex-1 font-medium">{c.name}</div>
                  <Weiter />
                </div>
                <div className="flex flex-wrap gap-1">{badges}</div>
                <div className="text-sm text-slate-500">{t('{n} Prüfpunkte', { n: anzahl })}</div>
                <div className="text-sm text-slate-500">{t('verwendet von: {liste}', { liste: verwendet })}</div>
              </Link>
              <div className="border-t border-slate-100 px-4 py-2">{duplizieren(c)}</div>
            </li>
          ))}
        </Kacheln>
      ) : (
        <ul className="karte divide-y divide-slate-100">
          {zeilen.map(({ c, anzahl, verwendet, badges }) => (
            <li key={c.id} className="flex items-center hover:bg-slate-50">
              <Link to={`/checklisten/${c.id}`} className="block min-w-0 flex-1 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 font-medium">{c.name}{badges}</div>
                <div className="text-sm text-slate-500">{t('{n} Prüfpunkte', { n: anzahl })} · {t('verwendet von: {liste}', { liste: verwendet })}</div>
              </Link>
              <span className="mr-4">{duplizieren(c)}</span>
            </li>
          ))}
        </ul>
      )}

      <ChecklisteKopieren quelle={kopie} onSchliessen={() => setKopie(null)} onFertig={(id) => navigate(`/checklisten/${id}`)} />

      <Dialog offen={neu} titel={t('Neue Checkliste')} onSchliessen={() => setNeu(false)}>
        <Formular
          simulation
          felder={[
            { name: 'name', label: t('Name'), pflicht: true, breit: true },
            { name: 'beschreibung', label: t('Beschreibung'), typ: 'textarea' },
          ]}
          start={{}}
          onAbbrechen={() => setNeu(false)}
          onSpeichern={async (w) => {
            if (demoSperreAktiv()) return navigate(`/checklisten/${simNeu(String(w.name), (w.beschreibung as string | null) ?? null)}`)
            const { data, error } = await supabase.from('checkliste').insert(w as { name: string }).select('id').single()
            if (error) return fehlertext(error)
            const { error: e2 } = await supabase.from('checkliste_version').insert({ checkliste_id: data.id, version: 1 })
            if (e2) return fehlertext(e2)
            navigate(`/checklisten/${data.id}`)
          }}
        />
      </Dialog>
    </Seite>
  )
}
