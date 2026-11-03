import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { useAuth } from '../../auth'
import { Badge, datum, Fehler, Laden, Seite } from '../../components/ui'
import { fehlertext, supabase } from '../../lib/supabase'
import { t } from '../../lib/sprache'
import { entschluesselt } from '../../lib/entschluesselt'
import { useAbfrage } from '../../lib/useAbfrage'
import { protokolleErzeugen, protokollLinks } from '../../protokoll/erzeugen'

type Protokoll = { id: string; art: 'sammel' | 'einzel'; revision: number; storage_pfad: string; sha256: string; erzeugt_am: string; anlagenpruefung: { anlage: { etikett_id: string | null; kunden_bezeichnung: string | null } | null } | null }

/** Protokolle eines Termins aus der Zeit der Sessions: automatisch erzeugen und herunterladen. */
export default function Protokolle() {
  const { sid = '' } = useParams()
  const { istAdmin, benutzer } = useAuth()
  const [fortschritt, setFortschritt] = useState('')
  const [fehler, setFehler] = useState('')
  const [urls, setUrls] = useState<Record<string, string>>({})
  const laeuft = useRef(false)

  const kopf = useAbfrage(() => entschluesselt('session', supabase.from('session')
    .select('*, objekt(id, name, ort, endkunde(id, name)), leiter:benutzer!session_leiter_id_fkey(name), session_teilnehmer(benutzer_id, benutzer(name)), session_revision(revision, grund, am)')
    .eq('id', sid).single()), [sid])
  const liste = useAbfrage(() => supabase.from('protokoll')
    .select('id, art, revision, storage_pfad, sha256, erzeugt_am, anlagenpruefung(anlage(etikett_id, kunden_bezeichnung))')
    .eq('session_id', sid).order('revision', { ascending: false }).order('art', { ascending: false }), [sid])

  const s = kopf.daten
  const protokolle = (liste.daten ?? []) as unknown as Protokoll[]
  const aktuelleFehlen = !!s && s.status === 'abgeschlossen' && !protokolle.some((p) => p.revision === s.revision && p.art === 'sammel')
  // Erzeugen dürfen nur Teilnehmer der Prüfung, Planer und Admins (RLS)
  const darfErzeugen = istAdmin || !!s?.session_teilnehmer.some((t) => t.benutzer_id === benutzer?.id)

  const erzeugen = useCallback(async () => {
    if (laeuft.current) return
    laeuft.current = true
    setFehler('')
    try {
      await protokolleErzeugen(sid, setFortschritt)
      await liste.neuLaden()
    } catch (e) {
      setFehler(fehlertext(e))
    } finally {
      setFortschritt('')
      laeuft.current = false
    }
  }, [sid, liste])

  // Fehlen die PDFs der aktuellen Revision, werden sie automatisch erzeugt
  useEffect(() => {
    if (aktuelleFehlen && darfErzeugen && !liste.laedt && navigator.onLine) void erzeugen()
  }, [aktuelleFehlen, darfErzeugen, liste.laedt, erzeugen])

  // Download-Adressen vorab holen (ein Klick öffnet sie direkt – funktioniert auch im Share-Link)
  useEffect(() => {
    let aktiv = true
    void protokollLinks(protokolle)
      .then((links) => { if (aktiv) setUrls(links) })
      .catch(() => undefined)
    return () => { aktiv = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [protokolle.map((p) => p.id).join()])

  if (kopf.laedt && !s) return <Laden />
  if (!s) return <Seite titel={t('Protokolle')}><Fehler text={kopf.fehler || t('Prüfung nicht gefunden')} /></Seite>

  const revisionen = [...new Set(protokolle.map((p) => p.revision))]

  return (
    <Seite titel={s.protokoll_nr ? t('Prüfprotokolle {nummer}', { nummer: s.protokoll_nr }) : t('Prüfprotokolle')}
      zurueck={s.objekt ? { zu: `/objekte/${s.objekt.id}`, text: s.objekt.name } : undefined}>
      <div className="karte grid gap-1 p-4 text-sm sm:grid-cols-2">
        <div><span className="text-slate-500">{t('Kunde:')}</span> {s.objekt?.endkunde?.name}</div>
        <div><span className="text-slate-500">{t('Objekt:')}</span> {s.objekt?.name}{s.objekt?.ort ? `, ${s.objekt.ort}` : ''}</div>
        <div><span className="text-slate-500">{t('Leitung:')}</span> {s.leiter?.name}</div>
        <div><span className="text-slate-500">{t('Status:')}</span> {s.status === 'abgeschlossen'
          ? <Badge farbe="gruen">{t('abgeschlossen {datum}', { datum: datum(s.abgeschlossen_am) })}{s.revision ? ` · ${t('Rev. {revision}', { revision: s.revision })}` : ''}</Badge>
          : <Badge farbe="blau">{s.revision ? t('in Revision {revision}', { revision: s.revision }) : t('läuft')}</Badge>}</div>
      </div>

      {s.status !== 'abgeschlossen' && <p className="text-sm text-slate-600">{t('Neue Protokolle entstehen, sobald die Prüfung (erneut) abgeschlossen ist.')}</p>}
      {fortschritt && <p role="status" aria-live="polite" className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">{t('Protokolle werden erstellt: {fortschritt}', { fortschritt })}</p>}
      <Fehler text={fehler || liste.fehler} />
      {aktuelleFehlen && !fortschritt && (darfErzeugen
        ? <button className="btn-primaer" onClick={() => void erzeugen()} disabled={!navigator.onLine}>{t('Protokolle erstellen')}</button>
        : <p className="text-sm text-slate-600">{t('Die Protokolle erstellt ein Teilnehmer der Prüfung, ein Planer oder Admin.')}</p>
      )}

      {revisionen.map((r) => (
        <section key={r} className="karte">
          <h2 className="border-b border-slate-100 px-4 py-2 font-semibold">
            {r === 0 ? t('Original') : t('Revision {r}', { r })} {r === s.revision && s.status === 'abgeschlossen' ? t('(aktuell)') : t('(ersetzt)')}
            {r > 0 && <span className="block text-xs font-normal text-slate-500">{t('Grund:')} {s.session_revision.find((x) => x.revision === r)?.grund}</span>}
          </h2>
          <ul className="divide-y divide-slate-100">
            {protokolle.filter((p) => p.revision === r).map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <div>
                  <div className={p.art === 'sammel' ? 'font-semibold' : ''}>
                    {p.art === 'sammel' ? t('Sammelprotokoll (mit allen Einzelprotokollen)') : t('Einzelprotokoll {etikett} {bezeichnung}', { etikett: p.anlagenpruefung?.anlage?.etikett_id ?? '', bezeichnung: p.anlagenpruefung?.anlage?.kunden_bezeichnung ?? '' })}
                  </div>
                  <div className="font-mono text-[10px] text-slate-400" title={t('SHA-256-Prüfsumme')}>SHA-256 {p.sha256.slice(0, 16)}…</div>
                </div>
                {urls[p.id]
                  ? <a className="btn-sekundaer" href={urls[p.id]} target="_blank" rel="noreferrer">{t('PDF öffnen')}</a>
                  : urls[p.id] === '' ? <Badge farbe="rot">{t('nicht lesbar')}</Badge> : <span className="text-xs text-slate-400">…</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}

    </Seite>
  )
}
