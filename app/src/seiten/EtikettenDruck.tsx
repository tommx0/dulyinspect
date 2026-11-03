import QRCode from 'qrcode'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Fehler, Laden, Seite } from '../components/ui'
import { bogenAnzahl, bogenPdf, FORMATE, type Bogenformat } from '../etiketten/bogen'
import { DIREKTE_ADRESSE, qrInhalt } from '../lib/etikett'
import { loggen } from '../lib/log'
import { melderCodesErzeugen, melderQrInhalt } from '../lib/melderCode'
import { fehlertext, supabase } from '../lib/supabase'
import { entschluesselt } from '../lib/entschluesselt'
import { useAbfrage } from '../lib/useAbfrage'
import { tb } from '../lib/begriffe'
import { t, tIn, type Sprache } from '../lib/sprache'
import { Auswahl } from '../components/Auswahl'

const MAX = 240
const SPEICHER = 'tuerpruefung:etikettendruck'

/** App-Adresse für die QR-Codes – nie der Share-Link (dort ist die Kamera gesperrt). */
function standardAdresse(): string {
  const { origin, pathname } = window.location
  if (origin.includes('deploybase.eu') && !origin.includes('previews') && !origin.includes('sites')) return DIREKTE_ADRESSE
  return origin + pathname.replace(/index\.html$/, '')
}

type Einstellung = { formatId: string; eigen: Bogenformat; versatzX: number; versatzY: number; zeile2: boolean }
const EIGEN: Bogenformat = { id: 'eigen', name: 'Eigenes Format', breite: 63.5, hoehe: 33.9, spalten: 3, zeilen: 8, abstandX: 2.5, abstandY: 0 }

function geladen(): Einstellung {
  try {
    const x = JSON.parse(localStorage.getItem(SPEICHER) ?? 'null') as Einstellung | null
    if (x) return { ...x, eigen: { ...EIGEN, ...x.eigen } }
  } catch { /* nicht verfügbar */ }
  return { formatId: FORMATE[0].id, eigen: EIGEN, versatzX: 0, versatzY: 0, zeile2: true }
}

/** Zwei Zeilen für kleine Etiketten: M4F7K2QXD3 → „M4F7K“ / „2QXD3“ */
const codeZeilen = (code: string) => `${code.slice(0, 5)}\n${code.slice(5)}`

/**
 * Etiketten-Druckbögen (PDF in exakten Maßen). Mit ?art=melder die eigenen Melder-Etiketten: die Codes entstehen hier
 * und gehören erst zu einem Melder, wenn er sie beim ersten Scan zugewiesen bekommt.
 */
export default function EtikettenDruck() {
  const melder = useSearchParams()[0].get('art') === 'melder'
  const [codes, setCodes] = useState<string[]>([])
  const [codeAnzahl, setCodeAnzahl] = useState(30)
  const [e, setE] = useState<Einstellung>(geladen)
  const [adresse, setAdresse] = useState(standardAdresse)
  const [filter, setFilter] = useState<'frei' | 'zugeordnet' | 'alle'>('frei')
  const [suche, setSuche] = useState('')
  const [auswahl, setAuswahl] = useState<Set<string> | null>(null)
  const [start, setStart] = useState(1)
  const [probedruck, setProbedruck] = useState(false)
  const [pdf, setPdf] = useState<{ url: string; name: string } | null>(null)
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState('')

  useEffect(() => { try { localStorage.setItem(SPEICHER, JSON.stringify(e)) } catch { /* egal */ } }, [e])
  useEffect(() => () => { if (pdf) URL.revokeObjectURL(pdf.url) }, [pdf])

  const format = e.formatId === 'eigen' ? e.eigen : FORMATE.find((f) => f.id === e.formatId) ?? FORMATE[0]
  const jeBogen = format.spalten * format.zeilen

  const firma = useAbfrage(() => supabase.from('firma').select('name, telefon, mandantencode, protokoll_sprache').single())
  const liste = useAbfrage(() => {
    let q = supabase.from('etikett')
      .select('id, anlage:anlage!etikett_anlage_fk(kunden_bezeichnung, objekt(id, name, endkunde(id, name)))')
      .order('erstellt_am').order('id').limit(2000)
    if (filter === 'zugeordnet') q = q.not('anlage_id', 'is', null)
    if (filter === 'frei') q = q.is('anlage_id', null)
    return entschluesselt('etikett', q)
  }, [filter])

  const etiketten = useMemo(() => (liste.daten ?? []).filter((x) =>
    `${x.id} ${x.anlage?.kunden_bezeichnung ?? ''} ${x.anlage?.objekt?.name ?? ''} ${x.anlage?.objekt?.endkunde?.name ?? ''}`.toLowerCase().includes(suche.toLowerCase())), [liste.daten, suche])
  const gewaehlt = auswahl ?? new Set(etiketten.slice(0, jeBogen).map((x) => x.id))
  const zuDrucken = etiketten.filter((x) => gewaehlt.has(x.id)).slice(0, MAX)
  const anzahl = melder ? codes.length : zuDrucken.length

  const setzeEigen = (k: keyof Bogenformat, v: number) => { setE({ ...e, eigen: { ...e.eigen, [k]: v } }); setPdf(null) }
  const umschalten = (id: string) => {
    const neu = new Set(gewaehlt)
    if (neu.has(id)) neu.delete(id)
    else neu.add(id)
    setAuswahl(neu)
    setPdf(null)
  }

  // Aufdruck in der Sprache der Protokolle (Einstellungen › Firmendaten), nicht der Oberfläche
  const druckSprache: Sprache = firma.daten?.protokoll_sprache === 'en' ? 'en' : 'de'

  const erstellen = async () => {
    setLaeuft(true)
    setFehler('')
    try {
      const daten = melder
        ? await Promise.all(codes.map(async (c) => ({
          id: c, anzeige: codeZeilen(c), hinweis: tIn(druckSprache, 'Melder-Code'), zeile2: null,
          qr: await QRCode.toDataURL(melderQrInhalt(adresse, c, firma.daten?.mandantencode), { margin: 1, errorCorrectionLevel: 'M', width: 300 }),
        })))
        : await Promise.all(zuDrucken.map(async (x) => ({
          id: x.id,
          zeile2: e.zeile2 && x.anlage ? [x.anlage.kunden_bezeichnung, x.anlage.objekt?.name].filter(Boolean).join(' · ') : null,
          qr: await QRCode.toDataURL(qrInhalt(adresse, x.id, firma.daten?.mandantencode), { margin: 1, errorCorrectionLevel: 'M', width: 300 }),
        })))
      const doc = bogenPdf(daten, {
        format, startPosition: start, versatzX: e.versatzX, versatzY: e.versatzY, probedruck, sprache: druckSprache,
        firma: firma.daten?.name ?? '', telefon: firma.daten?.telefon, mandantencode: firma.daten?.mandantencode,
      })
      const [{ default: pdfMake }, { default: vfs }] = await Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')])
      pdfMake.addVirtualFileSystem(vfs)
      const blob = await pdfMake.createPdf(doc).getBlob()
      const ids = daten.map((x) => x.id)
      setPdf({ url: URL.createObjectURL(blob), name: `${melder ? 'Melder-Etiketten' : 'Etiketten'}_${ids[0] ?? ''}_${ids.at(-1) ?? ''}${probedruck ? '_Probedruck' : ''}.pdf` })
      void loggen(melder ? 'Melder-Etiketten-PDF erzeugt' : 'Etiketten-PDF erzeugt', `${ids.length} Etikett(en) ${ids[0] ?? ''} bis ${ids.at(-1) ?? ''}, ${format.name}${probedruck ? ', Probedruck' : ''}`)
    } catch (err) {
      setFehler(fehlertext(err))
    } finally {
      setLaeuft(false)
    }
  }

  const zahl = (wert: string) => Number(wert.replace(',', '.')) || 0

  return (
    <Seite titel={melder ? t('Melder-Etiketten drucken') : t('Etiketten drucken')} zurueck={{ zu: '/etiketten', text: t('Etiketten') }}>
      <section className="karte space-y-3 p-4">
        <h2 className="font-semibold">{t('1. Bogen')}</h2>
        <div>
          <label htmlFor="format">{t('Etikettenformat (A4)')}</label>
          <Auswahl id="format" value={e.formatId} onChange={(x) => { setE({ ...e, formatId: x.target.value }); setStart(1); setPdf(null) }}>
            {FORMATE.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            <option value="eigen">{t('Eigenes Format …')}</option>
          </Auswahl>
        </div>
        {e.formatId === 'eigen' && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
            {([['breite', t('Breite mm')], ['hoehe', t('Höhe mm')], ['spalten', t('Spalten')], ['zeilen', t('Zeilen')], ['abstandX', t('Abstand X mm')], ['abstandY', t('Abstand Y mm')]] as const).map(([k, l]) => (
              <div key={k}><label htmlFor={`eigen-${k}`}>{l}</label><input id={`eigen-${k}`} inputMode="decimal" value={String(e.eigen[k])} onChange={(x) => setzeEigen(k, zahl(x.target.value))} /></div>
            ))}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="start">{t('Erstes freies Feld (angebrochener Bogen)')}</label>
            <input id="start" type="number" min={1} max={jeBogen} value={start} onChange={(x) => { setStart(Math.min(jeBogen, Math.max(1, Number(x.target.value) || 1))); setPdf(null) }} />
          </div>
          <div>
            <label htmlFor="versatz-x">{t('Druckerversatz nach rechts (mm)')}</label>
            <input id="versatz-x" inputMode="decimal" value={String(e.versatzX)} onChange={(x) => { setE({ ...e, versatzX: zahl(x.target.value) }); setPdf(null) }} />
          </div>
          <div>
            <label htmlFor="versatz-y">{t('Druckerversatz nach unten (mm)')}</label>
            <input id="versatz-y" inputMode="decimal" value={String(e.versatzY)} onChange={(x) => { setE({ ...e, versatzY: zahl(x.target.value) }); setPdf(null) }} />
          </div>
        </div>
        {/* Bogenvorschau: belegte Felder grau, zu bedruckende gelb – Klick setzt das erste freie Feld */}
        <div className="grid max-w-56 gap-0.5 rounded border border-slate-300 bg-white p-1" style={{ gridTemplateColumns: `repeat(${format.spalten}, 1fr)` }}>
          {Array.from({ length: jeBogen }, (_, i) => (
            <button key={i} type="button" onClick={() => { setStart(i + 1); setPdf(null) }} aria-label={t('Ab Feld {n} drucken', { n: i + 1 })}
              className={`h-3 rounded-sm ${i + 1 < start ? 'bg-slate-300' : i + 1 < start + anzahl ? 'bg-akzent' : 'bg-slate-100'}`} />
          ))}
        </div>
        <p className="text-xs text-slate-500">{t('Die Ränder sind aus den Etikettenmaßen berechnet. Vor dem ersten Druck auf Etiketten: Probedruck auf Normalpapier, gegen den Bogen halten und ggf. den Versatz anpassen. Die Einstellungen merkt sich dieses Gerät.')}</p>
      </section>

      {melder ? (
        <section className="karte space-y-3 p-4" data-melder-codes>
          <h2 className="font-semibold">{t('2. Melder-Codes')}</h2>
          <p className="text-sm text-slate-600">
            {t('Die Codes entstehen hier im Browser und werden nicht gespeichert. Sie gehören erst zu einem Melder, wenn er einen beim ersten Scan („Melder scannen“ in der Prüfung) zugewiesen bekommt. Jeden Bogen nur einmal ausdrucken: Dieselben Codes ein zweites Mal ergäben doppelte Etiketten.')}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-32">
              <label htmlFor="code-anzahl">{t('Anzahl')}</label>
              <input id="code-anzahl" type="number" min={1} max={MAX} value={codeAnzahl}
                onChange={(x) => setCodeAnzahl(Math.min(MAX, Math.max(1, Number(x.target.value) || 1)))} />
            </div>
            <button className="btn-sekundaer" onClick={() => { setCodes(melderCodesErzeugen(codeAnzahl)); setPdf(null) }}>
              {codes.length ? t('Neue Codes erzeugen') : t('Codes erzeugen')}
            </button>
            <span className="text-sm text-slate-500">
              {codes.length ? t('{n} Codes · {bogen} Bogen', { n: codes.length, bogen: bogenAnzahl(format, codes.length, start) }) : t('noch keine Codes')}
            </span>
          </div>
          {codes.length > 0 && <p className="font-mono text-xs text-slate-600" data-code-bereich>{codes[0]} … {codes[codes.length - 1]}</p>}
          <p className="text-xs text-slate-500">
            {t('Für Melder eignen sich die kleinen Formate (38,1 × 21,2 mm oder 48,5 × 25,4 mm). Der Code steht in zwei Zeilen neben dem QR-Code und lässt sich zur Not eintippen.')}
          </p>
          <div>
            <label htmlFor="adresse">{t('App-Adresse im QR-Code')}</label>
            <input id="adresse" value={adresse} onChange={(x) => { setAdresse(x.target.value); setPdf(null) }} className="font-mono text-sm" />
          </div>
        </section>
      ) : (
      <section className="karte space-y-3 p-4">
        <h2 className="font-semibold">{t('2. Etiketten')}</h2>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {(['frei', 'zugeordnet', 'alle'] as const).map((f) => (
            <label key={f} className="flex items-center gap-1 font-normal">
              <input type="radio" name="filter" checked={filter === f} onChange={() => { setFilter(f); setAuswahl(null); setPdf(null) }} />
              {f === 'zugeordnet' ? tb('mit Tür') : f === 'frei' ? t('frei (neu)') : t('alle')}
            </label>
          ))}
          <input type="search" className="mt-0 max-w-56" placeholder={t('Objekt, Kunde, ID …')} value={suche} onChange={(x) => { setSuche(x.target.value); setAuswahl(null); setPdf(null) }} aria-label={t('Etiketten filtern')} />
          <button className="link" onClick={() => { setAuswahl(new Set(etiketten.slice(0, MAX).map((x) => x.id))); setPdf(null) }}>{t('alle wählen')}</button>
          <button className="link" onClick={() => { setAuswahl(new Set()); setPdf(null) }}>{t('keine')}</button>
          <span className="text-slate-500">{t('{n} gewählt · {bogen} Bogen', { n: zuDrucken.length, bogen: bogenAnzahl(format, zuDrucken.length, start) })}</span>
        </div>
        <Fehler text={liste.fehler} />
        {liste.laedt ? <Laden /> : (
          <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
            {etiketten.map((x) => (
              <label key={x.id} title={x.anlage ? `${x.anlage.kunden_bezeichnung ?? ''} ${x.anlage.objekt?.name ?? ''}` : t('frei')}
                className={`flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 font-mono text-xs font-normal ${gewaehlt.has(x.id) ? 'border-marke bg-akzent-hell' : 'border-slate-200 bg-white'}`}>
                <input type="checkbox" checked={gewaehlt.has(x.id)} onChange={() => umschalten(x.id)} />
                {x.id}
              </label>
            ))}
            {etiketten.length === 0 && <p className="text-sm text-slate-500">{t('Keine Etiketten. Neue IDs unter „Etiketten“ erzeugen.')}</p>}
          </div>
        )}
        <label className="flex items-center gap-2 font-normal"><input type="checkbox" checked={e.zeile2} onChange={(x) => { setE({ ...e, zeile2: x.target.checked }); setPdf(null) }} /> {tb('Türbezeichnung und Objekt mitdrucken (bei zugeordneten Etiketten)')}</label>
        <div>
          <label htmlFor="adresse">{t('App-Adresse im QR-Code')}</label>
          <input id="adresse" value={adresse} onChange={(x) => { setAdresse(x.target.value); setPdf(null) }} className="font-mono text-sm" />
        </div>
      </section>
      )}

      <section className="karte space-y-3 p-4">
        <h2 className="font-semibold">{t('3. Drucken')}</h2>
        <label className="flex items-center gap-2 font-normal"><input type="checkbox" checked={probedruck} onChange={(x) => { setProbedruck(x.target.checked); setPdf(null) }} /> {t('Probedruck mit Rahmen (auf Normalpapier)')}</label>
        <Fehler text={fehler} />
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primaer" disabled={laeuft || anzahl === 0 || !firma.daten} onClick={() => void erstellen()}>{laeuft ? t('Erstelle PDF …') : t('PDF erstellen')}</button>
          {pdf && <a className="btn-sekundaer" href={pdf.url} target="_blank" rel="noreferrer" data-etiketten-pdf>{t('PDF öffnen')}</a>}
        </div>
        <p className="text-xs text-slate-500">{t('Im Druckdialog')} <strong>{t('„Tatsächliche Größe“ / 100 %')}</strong> {t('wählen, nicht „An Seite anpassen“ – sonst verschieben sich die Etiketten.')}</p>
      </section>
    </Seite>
  )
}
