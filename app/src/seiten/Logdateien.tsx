import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Fehler, Laden, Leer, Seite, Tabelle } from '../components/ui'
import { herunterladen } from '../lib/csv'
import { DIREKTE_ADRESSE, imFremdenRahmen } from '../lib/etikett'
import { fehlertext, supabase } from '../lib/supabase'
import { useAbfrage } from '../lib/useAbfrage'
import { gebietsschema, t } from '../lib/sprache'

const MAX_GROESSE = 10 * 1024 * 1024
const SEITE = 200

type Datei = { nr: number; aktuell: boolean; angelegt_am: string; archiviert_am: string | null; groesse: number; zeilen: number }
type Zeile = { id: number; zeile: string }

/** Zeit wie in der Logdatei: UTC */
const utc = (d: string) => `${new Date(d).toISOString().slice(0, 16).replace('T', ' ')} UTC`
const mb = (b: number) => `${(b / 1024 / 1024).toLocaleString(gebietsschema(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MB`

function bezeichnung(d: Datei, alle: Datei[]) {
  return d.aktuell ? t('Aktuelle Datei') : t('Archiv {n}', { n: alle.filter((x) => !x.aktuell && x.nr >= d.nr).length })
}

/** Logdateien ansehen und herunterladen (nur Admin). */
export default function Logdateien() {
  const liste = useAbfrage(() => supabase.rpc('log_dateien'))
  const dateien = (liste.daten ?? []) as Datei[]
  const [gewaehlt, setGewaehlt] = useState<number | null>(null)
  const [eingabe, setEingabe] = useState('')
  const [suche, setSuche] = useState('')
  const [zeilen, setZeilen] = useState<Zeile[]>([])
  const [ende, setEnde] = useState(false)
  const [laedt, setLaedt] = useState(false)
  const [fehler, setFehler] = useState('')

  const nr = gewaehlt ?? dateien.find((d) => d.aktuell)?.nr ?? null

  const laden = useCallback(async (vorId: number | null) => {
    if (nr === null) return
    setLaedt(true); setFehler('')
    const { data, error } = await supabase.rpc('log_lesen', { p_nr: nr, p_suche: suche, p_vor_id: vorId ?? undefined, p_anzahl: SEITE })
    setLaedt(false)
    if (error) return setFehler(fehlertext(error))
    setZeilen((alt) => (vorId === null ? data : [...alt, ...data]))
    setEnde(data.length < SEITE)
  }, [nr, suche])

  useEffect(() => { void laden(null) }, [laden])

  const suchen = (e: FormEvent) => { e.preventDefault(); setSuche(eingabe.trim()) }

  const aktualisieren = () => { void liste.neuLaden(); void laden(null) }

  const speichern = async (d: Datei) => {
    setFehler('')
    const { data, error } = await supabase.rpc('log_text', { p_nr: d.nr })
    if (error) return setFehler(fehlertext(error))
    const von = d.angelegt_am.slice(0, 10)
    const bis = (d.archiviert_am ?? new Date().toISOString()).slice(0, 10)
    const art = d.aktuell ? 'aktuell' : bezeichnung(d, dateien).replace(' ', '-')
    herunterladen(data, `Log_Tuerpruefung_${art}_${von}_bis_${bis}.log`, 'text/plain;charset=utf-8')
    aktualisieren()
  }

  const datei = dateien.find((d) => d.nr === nr)

  return (
    <Seite titel={t('Logdateien')} aktionen={<button className="btn-sekundaer" onClick={aktualisieren}>{t('Aktualisieren')}</button>}>
      <p className="text-sm text-slate-600">
        {t('Jede Änderung in der Datenbank und wichtige Aktionen (Anmeldung, Exporte, Backups, Protokolle …) mit Datum und Uhrzeit in UTC und dem Benutzer, der sie ausgelöst hat – „System“, wenn der Server sie selbst ausführt.')}
        {' '}{t('Eine Datei wird höchstens 10 MB groß, dann archiviert; es bleiben die aktuelle Datei und 2 Archive.')}
      </p>
      {imFremdenRahmen() && <Fehler text={t('Im Share-Link sind Downloads gesperrt. Bitte die App direkt öffnen: {adresse}', { adresse: DIREKTE_ADRESSE })} />}
      <Fehler text={liste.fehler || fehler} />

      {liste.laedt && !liste.daten ? <Laden /> : (
        <Tabelle kopf={[t('Datei'), t('Zeitraum'), t('Größe'), t('Einträge'), '']}>
          {dateien.map((d) => (
            <tr key={d.nr} className={d.nr === nr ? 'bg-akzent-hell' : ''}>
              <td className="px-3 py-2 font-medium">{bezeichnung(d, dateien)}</td>
              <td className="px-3 py-2 whitespace-nowrap">{utc(d.angelegt_am)} –<br />{d.archiviert_am ? utc(d.archiviert_am) : t('jetzt')}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                {mb(d.groesse)}
                {d.aktuell && (
                  <div className="mt-1 h-1.5 w-24 rounded-full bg-slate-200" title={t('{groesse} von 10 MB', { groesse: mb(d.groesse) })}>
                    <div className="h-1.5 rounded-full bg-marke" style={{ width: `${Math.min(100, (d.groesse / MAX_GROESSE) * 100)}%` }} />
                  </div>
                )}
              </td>
              <td className="px-3 py-2">{d.zeilen.toLocaleString(gebietsschema())}</td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap justify-end gap-2">
                  <button className="btn-sekundaer" disabled={d.nr === nr} onClick={() => { setGewaehlt(d.nr); setZeilen([]) }}>{t('Anzeigen')}</button>
                  <button className="btn-sekundaer" onClick={() => void speichern(d)}>{t('Herunterladen')}</button>
                </div>
              </td>
            </tr>
          ))}
        </Tabelle>
      )}

      {datei && (
        <section className="karte space-y-3 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="font-semibold">{bezeichnung(datei, dateien)} <span className="font-normal text-slate-500">· {t('neueste Einträge zuerst')}</span></h2>
            <form onSubmit={suchen} className="flex w-full gap-2 sm:w-auto">
              <input type="search" aria-label={t('Im Log suchen')} placeholder={t('Suchen (Benutzer, Kunde, Anlage, Etikett …)')} value={eingabe}
                onChange={(e) => { setEingabe(e.target.value); if (!e.target.value) setSuche('') }} className="min-w-0 flex-1 sm:w-72" />
              <button className="btn-sekundaer">{t('Suchen')}</button>
            </form>
          </div>
          {zeilen.length === 0 && !laedt ? <Leer>{suche ? t('Keine Einträge zu dieser Suche.') : t('Keine Einträge.')}</Leer> : (
            <ol className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 font-mono text-xs" data-logzeilen>
              {zeilen.map((z) => <li key={z.id} className="px-2 py-1 break-all whitespace-pre-wrap">{z.zeile}</li>)}
            </ol>
          )}
          {laedt && <p className="text-sm text-slate-500">{t('Laden …')}</p>}
          {!ende && !laedt && zeilen.length > 0 && (
            <button className="btn-sekundaer" onClick={() => void laden(zeilen.at(-1)!.id)}>{t('Ältere Einträge laden')}</button>
          )}
        </section>
      )}
    </Seite>
  )
}
