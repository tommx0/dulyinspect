import { Link, useParams } from 'react-router'
import { useAuth } from '../../auth'
import { usePruefprotokolle } from '../../protokoll/usePruefprotokolle'
import { Badge, datum, Fehler, Laden, Seite } from '../../components/ui'
import { artDefinition } from '../../lib/anlagenarten'
import { tb } from '../../lib/begriffe'
import { t } from '../../lib/sprache'
import { supabase } from '../../lib/supabase'
import { tueranlageName } from '../../lib/tueranlage'
import { entschluesselt } from '../../lib/entschluesselt'
import { useAbfrage } from '../../lib/useAbfrage'
import { aenderungenLaden } from '../../protokoll/daten'
import { AenderungListe } from './Revision'

type Ampel = 'gruen' | 'gelb' | 'rot'
const AMPEL: Record<Ampel, string> = { gruen: t('ohne Mängel'), gelb: t('mit Mängeln, betriebsbereit'), rot: t('nicht betriebssicher') }

/** Protokolle einer Prüfung: aktuelle Revision und frühere Fassungen, mit Grund der Revision. */
export default function Pruefprotokoll() {
  const { pid = '' } = useParams()
  const { benutzer, istAdmin } = useAuth()
  const kopf = useAbfrage(() => entschluesselt('anlagenpruefung', supabase.from('anlagenpruefung')
    .select('id, session_id, pruefer_id, status, beendet_am, abgeschlossen_am, protokoll_nr, revision, ergebnis, kunde_name, kunde_unterschrift_am, teil_von_id, teil_von:teil_von_id(id, protokoll_nr), pruefer:benutzer!anlagenpruefung_pruefer_id_fkey(name), pruefart(name), anlage(id, etikett_id, kunden_bezeichnung, anlagentyp(anlagenart), objekt(id, name, ort, endkunde(id, name))), anlagenpruefung_mitpruefer(benutzer_id, status, fertig_am, benutzer(name)), anlagenpruefung_revision(revision, grund, am, benutzer(name))')
    .eq('id', pid).single()), [pid])
  // Türanlage: ihre Türen mit Stand (je geprüfter Tür gibt es ein Tür-Protokoll)
  const tueren = useAbfrage(() => supabase.from('anlagenpruefung').select('id, status, ergebnis, nicht_geprueft_grund, anlage(etikett_id, kunden_bezeichnung)')
    .eq('teil_von_id', pid).neq('status', 'duplikat'), [pid])
  const aenderungen = useAbfrage(async () => {
    try { return { data: await aenderungenLaden(pid), error: null } } catch (e) { return { data: null, error: e } }
  }, [pid])
  const p = kopf.daten
  const abgeschlossen = !!p && p.status === 'geprueft' && !!p.abgeschlossen_am
  // Ein fehlendes Protokoll erzeugen nur Beteiligte und Admins (so prüft es auch der Server)
  const darf = istAdmin || (!!p && (p.pruefer_id === benutzer?.id
    || p.anlagenpruefung_mitpruefer.some((m) => m.benutzer_id === benutzer?.id && (m.status === 'zugelassen' || m.status === 'entfernt'))))
  const { protokolle, urls, fortschritt, fehler, fehlt, online, erzeugen } = usePruefprotokolle(pid, p && !p.session_id ? { revision: p.revision, abgeschlossen } : null, darf)

  if (kopf.laedt && !p) return <Laden />
  if (!p) return <Seite titel={t('Protokoll')}><Fehler text={kopf.fehler || t('Prüfung nicht gefunden')} /></Seite>

  const istTueranlage = !!artDefinition(p.anlage?.anlagentyp?.anlagenart).tueren
  const anlage = istTueranlage ? tueranlageName(p.anlage?.objekt?.name) : [p.anlage?.etikett_id, p.anlage?.kunden_bezeichnung].filter(Boolean).join(' · ') || tb('Tür')
  // Tür einer Türanlage: Nummer, Unterschriften und Änderungen gehören zum Protokoll der Türanlage
  const ta = p.teil_von_id ? (p.teil_von as unknown as { id: string; protokoll_nr: string | null } | null) : null
  const nummer = ta?.protokoll_nr ?? p.protokoll_nr
  const mit = p.anlagenpruefung_mitpruefer.filter((m) => m.status === 'zugelassen' || m.status === 'entfernt')
  // Auch eine laufende Revision zeigen (mit ihren bisherigen Änderungen, noch ohne PDF)
  const revisionen = [...new Set([...(p.session_id ? [] : [p.revision]), ...protokolle.map((x) => x.revision)])].sort((a, b) => b - a)
  const grund = (r: number) => p.anlagenpruefung_revision.find((x) => x.revision === r)

  return (
    <Seite titel={nummer ? t('Prüfprotokoll {nummer}', { nummer }) : t('Prüfprotokoll')}
      zurueck={p.anlage?.objekt ? { zu: `/objekte/${p.anlage.objekt.id}?anlage=${p.anlage.id}`, text: p.anlage.objekt.name } : undefined}
      aktionen={<Link className="btn-sekundaer" to={`/pruefen/p/${pid}`}>{t('Zur Prüfung')}</Link>}>
      <div className="karte grid gap-1 p-4 text-sm sm:grid-cols-2">
        <div>{istTueranlage ? anlage : <><span className="text-slate-500">{tb('Tür:')}</span> {anlage}</>}</div>
        {ta && (
          <div className="sm:col-span-2" data-teil-von><span className="text-slate-500">{t('Teil der Türanlage:')}</span>{' '}
            <Link className="link" to={`/protokoll/${ta.id}`}>{tueranlageName(p.anlage?.objekt?.name)}</Link>
            <span className="text-slate-500"> – {t('Unterschriften und Änderungen stehen im Protokoll der Türanlage')}</span></div>
        )}
        <div><span className="text-slate-500">{t('Objekt:')}</span> {p.anlage?.objekt?.name}{p.anlage?.objekt?.ort ? `, ${p.anlage.objekt.ort}` : ''} · {p.anlage?.objekt?.endkunde?.name}</div>
        <div><span className="text-slate-500">{t('Prüfart:')}</span> {p.pruefart?.name ?? '–'}</div>
        <div><span className="text-slate-500">{t('Geprüft am:')}</span> {datum(p.beendet_am)}</div>
        <div><span className="text-slate-500">{t('Prüfer:')}</span> {p.pruefer?.name}
          {mit.length > 0 && ` ${t('mit {namen}', { namen: mit.map((m) => `${m.benutzer?.name ?? t('Mitprüfer')}${m.status === 'entfernt' ? ` ${t('(ohne Unterschrift)')}` : ''}`).join(', ') })}`}</div>
        {!ta && <div><span className="text-slate-500">{t('Kunde unterschrieben:')}</span> {p.kunde_unterschrift_am ? p.kunde_name : t('nein')}</div>}
        <div className="sm:col-span-2"><span className="text-slate-500">{t('Stand:')}</span>{' '}
          {abgeschlossen
            ? <Badge farbe={(p.ergebnis as Ampel | null) ?? 'gruen'}>{t('abgeschlossen')}{p.ergebnis ? `: ${AMPEL[p.ergebnis as Ampel]}` : ''}{p.revision ? ` · ${t('Rev. {revision}', { revision: p.revision })}` : ''}</Badge>
            : <Badge farbe="blau">{p.revision ? t('wieder geöffnet (Revision {revision})', { revision: p.revision }) : t('läuft')}</Badge>}
        </div>
      </div>

      {p.session_id && <p className="text-sm text-slate-600">{t('Diese Prüfung gehört zu einem Termin.')} <Link className="link" to={`/pruefen/${p.session_id}/protokolle`}>{t('Zu den Protokollen des Termins')}</Link></p>}
      {!abgeschlossen && !p.session_id && <p className="text-sm text-slate-600">{t('Ein neues Protokoll entsteht, sobald die Prüfung wieder abgeschlossen ist. Die bisherigen bleiben erhalten.')}</p>}
      {fortschritt && <p role="status" aria-live="polite" className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">{t('Protokoll wird erstellt: {fortschritt}', { fortschritt })}</p>}
      <Fehler text={fehler} />
      {fehlt && !fortschritt && fehler && <button className="btn-primaer" disabled={!online} onClick={() => void erzeugen()}>{t('Protokoll erstellen')}</button>}
      {fehlt && !darf && <p className="text-sm text-slate-600">{t('Das Protokoll erstellt ein Beteiligter der Prüfung oder ein Admin.')}</p>}
      {fehlt && !online && <p className="text-sm text-slate-600">{t('Das Protokoll wird erstellt, sobald eine Verbindung besteht.')}</p>}

      {istTueranlage && !!tueren.daten?.length && (
        <section className="karte" aria-label={t('Türen')}>
          <h2 className="border-b border-slate-100 px-4 py-2 font-semibold">{t('Türen ({n})', { n: tueren.daten.length })}</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {tueren.daten.map((tu) => (
              <li key={tu.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span>{[tu.anlage?.etikett_id, tu.anlage?.kunden_bezeichnung].filter(Boolean).join(' · ') || tb('Tür')}</span>
                {tu.status === 'geprueft'
                  ? <span className="flex items-center gap-3">{tu.ergebnis && <Badge farbe={tu.ergebnis as Ampel}>{AMPEL[tu.ergebnis as Ampel]}</Badge>}<Link className="link" to={`/protokoll/${tu.id}`}>{t('Tür-Protokoll')}</Link></span>
                  : <Badge>{tu.status === 'nicht_geprueft' ? t('nicht geprüft: {grund}', { grund: tu.nicht_geprueft_grund ?? '' }) : t('läuft')}</Badge>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {revisionen.map((r) => {
        const pdf = protokolle.find((x) => x.revision === r)
        const g = grund(r)
        return (
          <section key={r} className="karte" aria-label={r === 0 ? t('Original') : t('Revision {r}', { r })}>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div>
                <h2 className="font-semibold">
                  {r === 0 ? t('Original') : t('Revision {r}', { r })}
                  <span className="ml-2 text-sm font-normal text-slate-500">{r === p.revision ? (abgeschlossen ? t('aktuell') : t('läuft')) : t('ersetzt')}</span>
                </h2>
                {g && <p className="text-sm text-slate-600">{t('Grund:')} {g.grund} · {g.benutzer?.name ?? t('Admin')}, {datum(g.am)}</p>}
                {pdf && <p className="font-mono text-[10px] text-slate-400" title={t('SHA-256-Prüfsumme')}>SHA-256 {pdf.sha256.slice(0, 16)}…</p>}
              </div>
              {pdf
                ? urls[pdf.id] ? <a className="btn-sekundaer" href={urls[pdf.id]} target="_blank" rel="noreferrer">{t('PDF öffnen')}</a>
                  : urls[pdf.id] === '' ? <Badge farbe="rot">{t('nicht lesbar')}</Badge> : <span className="text-xs text-slate-400">…</span>
                : <span className="text-sm text-slate-500">{fortschritt ? t('wird erstellt …') : r === p.revision && !abgeschlossen ? t('nach dem Abschluss') : t('noch nicht erstellt')}</span>}
            </div>
            {r > 0 && !ta && (
              <details className="border-t border-slate-100 px-4 py-2" open={r === p.revision}>
                <summary className="cursor-pointer text-sm font-medium">{t('Änderungen')}{aenderungen.daten ? ` (${aenderungen.daten.get(r)?.length ?? 0})` : ''}</summary>
                {aenderungen.fehler ? <Fehler text={aenderungen.fehler} />
                  : aenderungen.daten ? <AenderungListe liste={aenderungen.daten.get(r) ?? []} /> : <p className="text-sm text-slate-500">{t('Lädt …')}</p>}
              </details>
            )}
          </section>
        )
      })}
    </Seite>
  )
}
