import { useEffect, useMemo, useState } from 'react'
import { Redo2, Undo2 } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'
import { bestaetigen, bestaetigenMitHaekchen, hinweisen } from '../components/Bestaetigung'
import { AbschnitteVerwalten } from '../components/AbschnitteVerwalten'
import { Ablaufplan } from '../components/Ablaufplan'
import { ChecklisteBaum } from '../components/ChecklisteBaum'
import { ChecklisteKopieren } from '../components/ChecklisteKopieren'
import { Formular } from '../components/Formular'
import { PunktDialogInhalt } from '../components/PunktDialog'
import { Pfadanalyse } from '../components/Pfadanalyse'
import { Badge, datum, Dialog, Fehler, Laden, Seite } from '../components/ui'
import { VersionsVergleich } from '../components/VersionsVergleich'
import { ExportKnopf } from '../components/VorlagenAustausch'
import {
  abhaengigeVon, aktiveWirkungen, istSichtbar, nachAbschnitt, ohneBezugAuf, pruefePunkte, wirkungFolgen, wirksam, zweigBedingung,
  type AntwortWert, type Punkt,
} from '../lib/checkliste'
import { analysiere } from '../lib/checklisteAnalyse'
import { abschnittsListe, normalisiere, type Stand } from '../lib/checklisteBaum'
import { diffZusammenfassung, versionsDiff } from '../lib/versionsDiff'
import { fehlertext, supabase, type Aenderung, type Zeile } from '../lib/supabase'
import { useAbfrage } from '../lib/useAbfrage'
import { demoSperreAktiv } from '../lib/demo'
import {
  entwurfVerwerfen, neuerEntwurf as simNeuerEntwurf, SIMULATION_TEXT, simKopfSetzen, simVersionenSetzen, useSimulationen,
  versionFreigeben, versionSpeichern,
} from '../lib/demoCheckliste'
import { Auswahl } from '../components/Auswahl'
import { t, tMeldung } from '../lib/sprache'
import { austauschDateiname, checklistenExportieren } from '../lib/vorlagenAustausch'

type Version = Zeile<'checkliste_version'>

const VERLAUF_MAX = 50
const ANSICHTEN = [['bearbeiten', t('Punkte')], ['ablauf', t('Ablaufplan')], ['aenderungen', t('Änderungen')], ['vorschau', t('Vorschau')]] as const
/** Status einer Version (Wert in der Datenbank) für die Anzeige */
const statusText = (s: string) => ({ entwurf: t('entwurf'), freigegeben: t('freigegeben'), archiviert: t('archiviert') } as Record<string, string>)[s] ?? s

export default function ChecklisteEditor() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const kopf = useAbfrage(() => supabase.from('checkliste').select('*').eq('id', id).single(), [id])
  const versionen = useAbfrage(
    () => supabase.from('checkliste_version').select('*').eq('checkliste_id', id).order('version', { ascending: false }), [id])

  const [versionId, setVersionId] = useState<string>()
  const [stand, setStand] = useState<Stand>({ punkte: [], abschnitte: [] })
  const [geaendert, setGeaendert] = useState(false)
  const [ansicht, setAnsicht] = useState<'bearbeiten' | 'ablauf' | 'aenderungen' | 'vorschau'>('bearbeiten')
  const [vergleichId, setVergleichId] = useState<string>()
  const [dialog, setDialog] = useState<{ index: number | null; vorlage?: Partial<Punkt> } | null>(null)
  const [verlauf, setVerlauf] = useState<{ zurueck: Stand[]; vor: Stand[] }>({ zurueck: [], vor: [] })
  const [kopfDialog, setKopfDialog] = useState(false)
  const [abschnitteOffen, setAbschnitteOffen] = useState(false)
  const [kopieOffen, setKopieOffen] = useState(false)
  const [fehler, setFehler] = useState('')
  const [meldung, setMeldung] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  // Demomodus: alles nur als Simulation im Arbeitsspeicher (lib/demoCheckliste.ts)
  const demo = demoSperreAktiv()
  const sim = useSimulationen().get(id)
  const kopfDaten = sim?.kopf ?? kopf.daten

  const liste = sim?.versionen ?? versionen.daten ?? []
  const version: Version | undefined = liste.find((v) => v.id === versionId)
    ?? liste.find((v) => v.status === 'entwurf') ?? liste.find((v) => v.status === 'freigegeben') ?? liste[0]
  const editierbar = version?.status === 'entwurf'
  const ansichtJetzt = ansicht === 'aenderungen' && liste.length < 2 ? 'bearbeiten' : ansicht
  const { punkte, abschnitte } = stand

  useEffect(() => {
    if (version) {
      const p = (version.punkte as unknown as Punkt[]) ?? []
      setStand({ punkte: p, abschnitte: abschnittsListe((version.abschnitte as unknown as string[]) ?? [], p) })
      setGeaendert(false)
      setVerlauf({ zurueck: [], vor: [] })
    }
  }, [version?.id, version?.geaendert_am]) // eslint-disable-line react-hooks/exhaustive-deps

  // Warnung beim Verlassen mit ungespeicherten Änderungen
  useEffect(() => {
    if (!geaendert) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [geaendert])

  const rueckgaengig = () => {
    const letzter = verlauf.zurueck.at(-1)
    if (!editierbar || !letzter) return
    setVerlauf({ zurueck: verlauf.zurueck.slice(0, -1), vor: [...verlauf.vor, stand] })
    setStand(letzter)
    setGeaendert(true)
  }

  const wiederholen = () => {
    const naechster = verlauf.vor.at(-1)
    if (!editierbar || !naechster) return
    setVerlauf({ zurueck: [...verlauf.zurueck, stand], vor: verlauf.vor.slice(0, -1) })
    setStand(naechster)
    setGeaendert(true)
  }
  // Strg/Cmd+Z und Strg/Cmd+Umschalt+Z bzw. Strg+Y – nicht in Eingabefeldern und nicht bei offenem Dialog
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      const ziel = e.target as HTMLElement | null
      if (ziel?.closest('input, textarea, select, [contenteditable], dialog')) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); rueckgaengig() }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); wiederholen() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  const strukturFehler = useMemo(() => pruefePunkte(punkte), [punkte])
  const freigabeFehler = useMemo(() => pruefePunkte(punkte, true).filter((f) => !strukturFehler.includes(f)), [punkte, strukturFehler])
  // Die Analyse setzt eine in sich stimmige Liste voraus
  const analyse = useMemo(() => (punkte.length > 0 && strukturFehler.length === 0 ? analysiere(punkte) : null), [punkte, strukturFehler])
  const unerreichbar = useMemo(() => new Set(analyse?.unerreichbar.map((p) => p.id)), [analyse])

  if (!sim?.neu && ((kopf.laedt && !kopf.daten) || (versionen.laedt && !versionen.daten))) return <Laden />
  if (!kopfDaten) return <Seite titel={t('Checkliste')}><Fehler text={kopf.fehler || t('Nicht gefunden')} /></Seite>

  /** Neue Punkte (und Abschnitte); Abschnitte, die neu an Punkten stehen, kommen hinten in die Liste. */
  const aendern = (neu: Stand) => {
    setVerlauf((v) => ({ zurueck: [...v.zurueck, stand].slice(-VERLAUF_MAX), vor: [] }))
    setStand({ punkte: neu.punkte, abschnitte: abschnittsListe(neu.abschnitte, neu.punkte) })
    setGeaendert(true)
    setMeldung('')
    setFehler('')
  }

  const loeschen = async (p: Punkt) => {
    const abh = abhaengigeVon(punkte, p.id)
    const text = abh.length
      ? t('„{text}“ löschen?\n\nAchtung: {n} Punkt(e) hängen per Bedingung oder Wirkung davon ab. Diese Bezüge werden entfernt (Wirkungen ohne Bedingung entfallen), die Punkte bleiben erhalten.', { text: p.text, n: abh.length })
      : t('„{text}“ löschen?', { text: p.text })
    if (!await bestaetigen(text, { ok: t('Löschen'), gefahr: true })) return
    aendern({ punkte: normalisiere(punkte.filter((x) => x !== p).map((x) => (abh.includes(x) ? ohneBezugAuf(x, p.id) : x)), abschnitte), abschnitte })
  }

  const speichern = async () => {
    if (!version) return false
    if (demo) {
      simVersionenSetzen(id, versionSpeichern(liste, version.id, punkte as never, abschnitte))
      setGeaendert(false)
      setMeldung(tMeldung(SIMULATION_TEXT))
      await hinweisen(tMeldung(SIMULATION_TEXT))
      return true
    }
    setLaeuft(true)
    setFehler('')
    const { error } = await supabase.from('checkliste_version').update({ punkte: punkte as never, abschnitte }).eq('id', version.id)
    setLaeuft(false)
    if (error) {
      setFehler(fehlertext(error))
      return false
    }
    setGeaendert(false)
    setMeldung(t('Gespeichert.'))
    await versionen.neuLaden()
    return true
  }

  const freigeben = async () => {
    if (!version) return
    const davor = liste.filter((v) => v.version < version.version).sort((a, b) => b.version - a.version)[0]
    const aenderungen = davor ? '\n\n' + t('Gegenüber v{version}: {aenderungen}.', { version: davor.version, aenderungen: diffZusammenfassung(versionsDiff((davor.punkte as unknown as Punkt[]) ?? [], punkte)) }) : ''
    const { ja } = await bestaetigenMitHaekchen(t('Version {version} freigeben?', { version: version.version }) + aenderungen + '\n\n' + t('Danach ist sie unveränderlich und wird für alle neuen Prüfungen verwendet. Die bisher freigegebene Version wird archiviert.'),
      t('Ich habe die Checkliste fachlich geprüft (Prüfpunkte, Grenzwerte und Mangelstufen) und bin dafür sachkundig bzw. befähigt. Als freigebende Person trage ich die Verantwortung für Inhalt und Richtigkeit dieser Version.'),
      { ok: t('Freigeben'), pflicht: true })
    if (!ja) return
    if (demo) {
      // Mit den aktuellen Punkten: ein vorheriges simuliertes Speichern ist im Stand dieser Darstellung noch nicht enthalten
      simVersionenSetzen(id, versionFreigeben(versionSpeichern(liste, version.id, punkte as never, abschnitte), version.id))
      setGeaendert(false)
      setMeldung(t('Version {version} freigegeben – nur simuliert, nicht gespeichert.', { version: version.version }))
      await hinweisen(t('Demomodus: Die Freigabe von Version {version} wurde nur simuliert und nicht gespeichert. Für Prüfungen gilt weiter der gespeicherte Stand.', { version: version.version }))
      return
    }
    if (geaendert && !(await speichern())) return
    setLaeuft(true)
    const { error } = await supabase.rpc('checkliste_version_freigeben', { p_version_id: version.id })
    setLaeuft(false)
    if (error) return setFehler(fehlertext(error))
    setMeldung(t('Version {version} freigegeben.', { version: version.version }))
    versionen.neuLaden()
  }

  const neuerEntwurf = async () => {
    if (demo) {
      const neu = simNeuerEntwurf(liste)
      simVersionenSetzen(id, neu.liste)
      return setVersionId(neu.id)
    }
    const { data, error } = await supabase.rpc('checkliste_neuer_entwurf', { p_checkliste_id: id })
    if (error) return setFehler(fehlertext(error))
    setVersionId(data)
    versionen.neuLaden()
  }

  const verwerfen = async () => {
    if (!version || !await bestaetigen(t('Entwurf v{version} endgültig löschen?', { version: version.version }), { ok: t('Löschen'), gefahr: true })) return
    if (demo) {
      simVersionenSetzen(id, entwurfVerwerfen(liste, version.id))
      return setVersionId(undefined)
    }
    const { error } = await supabase.from('checkliste_version').delete().eq('id', version.id)
    if (error) return setFehler(fehlertext(error))
    setVersionId(undefined)
    versionen.neuLaden()
  }

  const statusBadge = (v: Version) =>
    v.status === 'freigegeben' ? <Badge farbe="gruen">{t('freigegeben')}</Badge> : v.status === 'entwurf' ? <Badge farbe="blau">{t('Entwurf')}</Badge> : <Badge>{t('archiviert')}</Badge>

  return (
    <Seite
      titel={kopfDaten.name}
      zurueck={{ zu: '/checklisten', text: t('Checklisten') }}
      aktionen={<>
        {editierbar && <button className="btn-sekundaer" onClick={() => setAbschnitteOffen(true)}>{t('Abschnitte')}</button>}
        <button className="btn-sekundaer" onClick={() => (geaendert ? setFehler(t('Bitte zuerst speichern – kopiert wird der gespeicherte Stand.')) : setKopieOffen(true))}>{t('Duplizieren')}</button>
        {!sim && version && (
          <ExportKnopf onFehler={setFehler} dateiname={austauschDateiname('checkliste', kopfDaten.name)}
            laden={() => (geaendert ? Promise.reject(new Error(t('Bitte zuerst speichern – exportiert wird der gespeicherte Stand.'))) : checklistenExportieren([id], version.id))} />
        )}
        <button className="btn-sekundaer" onClick={() => setKopfDialog(true)}>{t('Name/Beschreibung')}</button>
      </>}
    >
      {kopfDaten.beschreibung && <p className="text-sm text-slate-600">{kopfDaten.beschreibung}</p>}
      {demo && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {t('Demomodus: Sie können Prüfpunkte bearbeiten, Versionen freigeben und die Checkliste duplizieren – alles nur als Simulation, gespeichert wird nichts.')}
        </p>
      )}

      <div className="karte flex flex-wrap items-center gap-3 p-3">
        <label className="flex items-center gap-2">
          {t('Version')}
          <Auswahl className="mt-0 w-auto" value={version?.id ?? ''} onChange={async (e) => {
            const ziel = e.target.value
            if (geaendert && !await bestaetigen(t('Ungespeicherte Änderungen verwerfen?'), { ok: t('Verwerfen'), gefahr: true })) return
            setVersionId(ziel)
          }}>
            {liste.map((v) => <option key={v.id} value={v.id}>v{v.version} – {statusText(v.status)}</option>)}
          </Auswahl>
        </label>
        {version && statusBadge(version)}
        {sim && <Badge farbe="gelb">{t('Simulation')}</Badge>}
        {version?.freigegeben_am && <span className="text-sm text-slate-500">{t('freigegeben am {datum}', { datum: datum(version.freigegeben_am) })}</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          <div className="flex overflow-hidden rounded-md border border-slate-300 text-sm">
            {ANSICHTEN.filter(([a]) => a !== 'aenderungen' || liste.length > 1).map(([a, text]) => (
              <button key={a} onClick={() => setAnsicht(a)} className={`px-3 py-1.5 ${ansichtJetzt === a ? 'bg-marke text-white' : 'bg-white'}`}>{text}</button>
            ))}
          </div>
          {editierbar ? (
            <>
              <button className="btn-sekundaer" onClick={rueckgaengig} disabled={verlauf.zurueck.length === 0} aria-label={t('Rückgängig')} title={t('Rückgängig (Strg+Z)')}>
                <Undo2 className="size-4" aria-hidden />
              </button>
              <button className="btn-sekundaer" onClick={wiederholen} disabled={verlauf.vor.length === 0} aria-label={t('Wiederholen')} title={t('Wiederholen (Strg+Umschalt+Z)')}>
                <Redo2 className="size-4" aria-hidden />
              </button>
              <button className="btn-sekundaer" onClick={speichern} disabled={!geaendert || laeuft}>{t('Speichern')}</button>
              <button className="btn-primaer" onClick={freigeben} disabled={laeuft || strukturFehler.length + freigabeFehler.length > 0}>{t('Freigeben')}</button>
              {(version?.version ?? 1) > 1 && <button className="btn-sekundaer text-red-700" onClick={verwerfen}>{t('Entwurf verwerfen')}</button>}
            </>
          ) : !liste.some((v) => v.status === 'entwurf') && (
            <button className="btn-primaer" onClick={neuerEntwurf}>{t('Neue Version bearbeiten')}</button>
          )}
        </div>
      </div>

      {meldung && (
        <div className={`rounded-md border p-3 text-sm ${demo ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-green-200 bg-green-50 text-green-800'}`}>
          {meldung}
        </div>
      )}
      <Fehler text={fehler} />
      {geaendert && <p className="text-sm text-amber-700">{t('Ungespeicherte Änderungen')}</p>}
      {editierbar && (strukturFehler.length > 0 || freigabeFehler.length > 0) && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">{t('Vor der Freigabe zu klären:')}</p>
          <ul className="ml-5 list-disc">{[...strukturFehler, ...freigabeFehler].map((f) => <li key={f}>{tMeldung(f)}</li>)}</ul>
        </div>
      )}
      {!editierbar && version && (
        <p className="text-sm text-slate-500">{t('Diese Version ist {status} und kann nicht geändert werden. Änderungen erfolgen in einer neuen Version.', { status: statusText(version.status) })}</p>
      )}

      {analyse && (ansichtJetzt === 'bearbeiten' || ansichtJetzt === 'ablauf') && <Pfadanalyse analyse={analyse} />}
      {ansichtJetzt === 'vorschau' ? <Vorschau punkte={punkte} />
        : ansichtJetzt === 'ablauf' ? (
          <Ablaufplan punkte={punkte} unerreichbar={unerreichbar} onOeffnen={editierbar ? (p) => setDialog({ index: punkte.indexOf(p) }) : undefined} />
        )
        : ansichtJetzt === 'aenderungen' && version ? (
          <Aenderungen liste={liste} version={version} punkte={punkte} vergleichId={vergleichId} onVergleich={setVergleichId} />
        ) : (
        <div className="space-y-4">
          {editierbar && punkte.length > 0 && (
            <p className="text-sm text-slate-500">
              {t('Punkte und Abschnitte am Griff ziehen, um sie zu sortieren. Legen Sie einen Punkt in den Zweig „wenn Ja / Nein / Option“ eines anderen Punkts, erscheint er nur bei dieser Antwort.')}
            </p>
          )}
          <ChecklisteBaum
            stand={stand}
            editierbar={editierbar}
            onAendern={aendern}
            onFehler={setFehler}
            onBearbeiten={(p) => setDialog({ index: punkte.indexOf(p) })}
            onLoeschen={(p) => void loeschen(p)}
            onNeuUnter={(eltern, zweig) => setDialog({
              index: null,
              vorlage: { abschnitt: eltern.abschnitt, nur_wenn: zweigBedingung(eltern, zweig) },
            })}
            onNeuIn={(abschnitt) => setDialog({ index: null, vorlage: { abschnitt } })}
          />
          {abschnitte.length === 0 && <p className="text-slate-500">{t('Noch keine Prüfpunkte.')}</p>}
          {editierbar && <button className="btn-primaer" onClick={() => setDialog({ index: null })}>{t('+ Prüfpunkt')}</button>}
        </div>
      )}

      <Dialog offen={dialog !== null} titel={dialog?.index == null ? t('Neuer Prüfpunkt') : t('Prüfpunkt bearbeiten')} onSchliessen={() => setDialog(null)} breit>
        {dialog && (
          <PunktDialogInhalt
            key={dialog.index ?? `neu-${JSON.stringify(dialog.vorlage)}`}
            punkt={dialog.index == null ? null : punkte[dialog.index]}
            vorlage={dialog.vorlage}
            alle={punkte}
            vorherige={dialog.index == null ? punkte : punkte.slice(0, dialog.index)}
            abschnitte={abschnitte}
            onAbbrechen={() => setDialog(null)}
            onSpeichern={(p) => {
              const neu = dialog.index == null ? [...punkte, p] : punkte.map((x, j) => (j === dialog.index ? p : x))
              const liste = abschnittsListe(abschnitte, neu)
              aendern({ punkte: normalisiere(neu, liste), abschnitte: liste })
              setDialog(null)
            }}
          />
        )}
      </Dialog>

      <Dialog offen={abschnitteOffen} titel={t('Abschnitte')} onSchliessen={() => setAbschnitteOffen(false)}>
        {abschnitteOffen && <AbschnitteVerwalten stand={stand} onAendern={aendern} onFertig={() => setAbschnitteOffen(false)} />}
      </Dialog>

      <ChecklisteKopieren quelle={kopieOffen ? { id, name: kopfDaten.name, versionId: version?.id } : null}
        onSchliessen={() => setKopieOffen(false)} onFertig={(neueId) => { setKopieOffen(false); setVersionId(undefined); navigate(`/checklisten/${neueId}`) }} />

      <Dialog offen={kopfDialog} titel={t('Checkliste')} onSchliessen={() => setKopfDialog(false)}>
        <Formular
          simulation
          felder={[
            { name: 'name', label: t('Name'), pflicht: true, breit: true },
            { name: 'beschreibung', label: t('Beschreibung'), typ: 'textarea' },
            { name: 'aktiv', label: t('aktiv'), typ: 'checkbox' },
          ]}
          start={kopfDaten}
          onAbbrechen={() => setKopfDialog(false)}
          onSpeichern={async (w) => {
            if (demo) {
              simKopfSetzen(id, { ...kopfDaten, ...(w as Partial<typeof kopfDaten>) })
              setKopfDialog(false)
              return void hinweisen(tMeldung(SIMULATION_TEXT))
            }
            const { error } = await supabase.from('checkliste').update(w as Aenderung<'checkliste'>).eq('id', id)
            if (error) return fehlertext(error)
            setKopfDialog(false)
            kopf.neuLaden()
          }}
        />
      </Dialog>
    </Seite>
  )
}

/** Simuliert die Checkliste, um Bedingungen auszuprobieren (Antworten auf Ja/Nein, Auswahl, i.O./n.i.O. und Messwerte sind wählbar). */
function Vorschau({ punkte }: { punkte: Punkt[] }) {
  const [werte, setWerte] = useState<Record<string, AntwortWert>>({})
  const sichtbar = punkte.filter((p) => istSichtbar(p, werte, punkte))
  const setze = (id: string, w: AntwortWert | undefined) => setWerte((alt) => {
    const neu = { ...alt }
    if (w) neu[id] = w
    else delete neu[id]
    return neu
  })
  const knopf = (aktiv: boolean, text: string, onClick: () => void) => (
    <button key={text} type="button" onClick={onClick} className={`btn ${aktiv ? 'bg-marke text-white' : 'border border-slate-300 bg-white'}`}>{text}</button>
  )
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        {t('So sieht der Prüfer die Checkliste. Beantworten Sie Ja/Nein-, Auswahl- und Status-Fragen und tragen Sie Messwerte ein, um bedingte Punkte ein- und auszublenden.')}
        {' '}{t('{n} von {m} Punkten sichtbar.', { n: sichtbar.length, m: punkte.length })}
      </p>
      {nachAbschnitt(sichtbar.map((p) => wirksam(p, werte, punkte))).map(([abschnitt, ps]) => (
        <section key={abschnitt} className="karte p-4">
          <h3 className="mb-3 font-semibold">{abschnitt}</h3>
          <div className="space-y-3">
            {ps.map((p) => (
              <div key={p.id}>
                <div className="text-sm">{p.text}{p.pflicht && <span className="text-red-600"> *</span>}</div>
                {aktiveWirkungen(p, werte, punkte).map((w, i) => (
                  <div key={i} className="text-xs text-amber-700">⚡ {t('gilt jetzt:')} {wirkungFolgen(w, p.einheit)}</div>
                ))}
                {p.typ === 'ja_nein' && (
                  <div className="mt-1 flex gap-2">
                    {['ja', 'nein'].map((w) => knopf(werte[p.id]?.text === w, w === 'ja' ? t('Ja') : t('Nein'), () => setze(p.id, { text: w })))}
                  </div>
                )}
                {p.typ === 'auswahl' && (
                  <Auswahl className="max-w-sm" value={werte[p.id]?.text ?? ''} onChange={(e) => setze(p.id, e.target.value ? { text: e.target.value } : undefined)}>
                    <option value="">–</option>
                    {p.optionen?.map((o) => <option key={o.wert}>{o.wert}</option>)}
                  </Auswahl>
                )}
                {p.typ === 'status' && (
                  <div className="mt-1 flex gap-2">
                    {([['io', t('i.O.')], ['nio', t('n.i.O.')], ['entfaellt', t('entfällt')]] as const).map(([w, text]) => knopf(werte[p.id]?.status === w, text, () => setze(p.id, { status: w })))}
                  </div>
                )}
                {p.typ === 'messwert' && (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                    <input inputMode="decimal" aria-label={`${p.text} (${p.einheit})`} className="mt-0 w-28" defaultValue=""
                      onChange={(e) => {
                        const n = Number(e.target.value.replace(',', '.'))
                        setze(p.id, e.target.value.trim() !== '' && Number.isFinite(n) ? { zahl: n } : undefined)
                      }} />
                    <span>{p.einheit}</span>
                    <span className="text-slate-400">{t('Soll {min} bis {max}', { min: p.soll_min ?? '–', max: p.soll_max ?? '–' })}</span>
                  </div>
                )}
                {p.typ === 'text' && <div className="mt-1 text-sm text-slate-400">[ {t('Freitext')} ]</div>}
                {p.typ === 'foto' && <div className="mt-1 text-sm text-slate-400">[ 📷 {t('Foto')} ]</div>}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

/** Änderungen der angezeigten Version (inklusive ungespeicherter Bearbeitung) gegenüber einer anderen Version. */
function Aenderungen({ liste, version, punkte, vergleichId, onVergleich }: {
  liste: Version[]
  version: Version
  punkte: Punkt[]
  vergleichId: string | undefined
  onVergleich: (id: string) => void
}) {
  const andere = liste.filter((v) => v.id !== version.id)
  const standard = andere.filter((v) => v.version < version.version).sort((a, b) => b.version - a.version)[0] ?? andere[0]
  const alt = andere.find((v) => v.id === vergleichId) ?? standard
  if (!alt) return null
  return (
    <div className="space-y-3">
      <label className="flex flex-wrap items-center gap-2">
        {t('Vergleichen mit')}
        <Auswahl className="mt-0 w-auto" value={alt.id} onChange={(e) => onVergleich(e.target.value)}>
          {andere.map((v) => <option key={v.id} value={v.id}>v{v.version} – {statusText(v.status)}</option>)}
        </Auswahl>
      </label>
      <VersionsVergleich alt={(alt.punkte as unknown as Punkt[]) ?? []} neu={punkte} labelAlt={`v${alt.version}`} labelNeu={`v${version.version}`} />
    </div>
  )
}
