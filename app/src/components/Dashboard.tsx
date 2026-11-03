// Dashboard der Startseite für große Bildschirme (ab Tailwind `xl`): Kennzahlen und vier Quadranten
// (Kalender über drei Monate zum Blättern, laufende Prüfungen, Statistik, Fristen). Am Handy bleibt die einfache Startseite.
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth'
import { ARTEN, artDefinition } from '../lib/anlagenarten'
import { austauschGrenze } from '../lib/austausch'
import { tb } from '../lib/begriffe'
import { STUFEN, type Stufe } from '../lib/checkliste'
import { useAusgeblendet } from '../lib/menue'
import { sachkundeStatus } from '../lib/sachkunde'
import { gebietsschema, t } from '../lib/sprache'
import { supabase } from '../lib/supabase'
import { TUERANLAGE_TYP } from '../lib/tueranlage'
import { useAbfrage } from '../lib/useAbfrage'
import { entschluesselt } from '../lib/entschluesselt'
import { useAustausch, type AustauschMelder } from '../lib/useAustausch'
import { AustauschBadges } from './AustauschHinweis'
import { ArtSymbol, artFarbe, EtikettText } from './Symbole'
import { Badge, datum, Fehler } from './ui'

type Ampel = { gruen: number; gelb: number; rot: number }
/** Rückgabe der Datenbankfunktion startseite_kennzahlen */
interface Kennzahlen {
  anlagen: number
  anlagen_je_art: Record<string, number>
  elemente: number
  ueberfaellig: number
  faellig_30: number
  geprueft_gesamt: number
  geprueft_jahr: number
  geprueft_vorjahr: number
  jahr_je_art: Record<string, Ampel>
  monate: (Ampel & { monat: string })[]
  maengel: Record<'1' | '2' | '3', number>
}

type FaelligeAnlage = {
  id: string; etikett_id: string | null; kunden_bezeichnung: string | null; naechste_pruefung_am: string
  anlagentyp: { anlagenart: string } | null
  objekt: { id: string; name: string; endkunde: { name: string } | null }
}

/** Aktive Anlagen aktiver Objekte mit nächster Prüfung bis `bis` (und ab `ab`), früheste zuerst. */
function faelligeAnlagen(bis: string, ab?: string) {
  const q = supabase.from('anlage')
    .select('id, etikett_id, kunden_bezeichnung, naechste_pruefung_am, anlagentyp(anlagenart), objekt!inner(id, name, aktiv, endkunde!inner(id, name, aktiv))')
    .eq('status', 'aktiv').eq('objekt.aktiv', true).eq('objekt.endkunde.aktiv', true)
    .lte('naechste_pruefung_am', bis)
  return entschluesselt('anlage', (ab ? q.gte('naechste_pruefung_am', ab) : q).order('naechste_pruefung_am').limit(2000))
}

const AMPEL_TEXT: Record<keyof Ampel, string> = { gruen: t('ohne Mängel'), gelb: t('mit Mängeln'), rot: t('nicht betriebssicher') }
const AMPEL_FARBE: Record<keyof Ampel, string> = { gruen: 'bg-emerald-500', gelb: 'bg-amber-400', rot: 'bg-red-600' }

const zahl = (n: number) => n.toLocaleString(gebietsschema())
const prozent = (n: number) => t('{wert} %', { wert: n.toLocaleString(gebietsschema(), { maximumFractionDigits: 1, minimumFractionDigits: 1 }) })
const summe = (a: Ampel) => a.gruen + a.gelb + a.rot
const zweistellig = (n: number) => String(n).padStart(2, '0')
const plusTage = (tag: string, tage: number) => new Date(new Date(`${tag}T00:00:00Z`).getTime() + tage * 864e5).toISOString().slice(0, 10)

/** Zahl zählt beim ersten Anzeigen hoch (ohne Animation, wenn das System Bewegung reduziert). */
function useHochzaehlen(ziel: number): number {
  const [ruhig] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [wert, setWert] = useState(0)
  useEffect(() => {
    if (ruhig) return
    let rahmen = 0
    const start = performance.now()
    const schritt = (t: number) => {
      const p = Math.min(1, (t - start) / 800)
      setWert(ziel * (1 - (1 - p) ** 3))
      if (p < 1) rahmen = requestAnimationFrame(schritt)
    }
    rahmen = requestAnimationFrame(schritt)
    return () => cancelAnimationFrame(rahmen)
  }, [ziel, ruhig])
  return ruhig ? ziel : wert
}

function Hochzaehlen({ wert, format = (n) => zahl(Math.round(n)) }: { wert: number; format?: (n: number) => string }) {
  return <>{format(useHochzaehlen(wert))}</>
}

/** Nach dem ersten Zeichnen true: Balken wachsen dann per CSS-Übergang auf ihre Größe. */
function useBereit() {
  const [bereit, setBereit] = useState(false)
  useEffect(() => { const r = requestAnimationFrame(() => setBereit(true)); return () => cancelAnimationFrame(r) }, [])
  return bereit
}

function Quadrant({ titel, zusatz, children, ...rest }: { titel: ReactNode; zusatz?: ReactNode; children: ReactNode; 'data-quadrant'?: string }) {
  return (
    <section className="karte flex min-w-0 flex-col p-5" {...rest}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-lg font-semibold">{titel}</h2>
        {zusatz && <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">{zusatz}</div>}
      </div>
      {children}
    </section>
  )
}

function Legende({ farbe, children }: { farbe: string; children: ReactNode }) {
  return <span className="inline-flex items-center gap-1.5"><i className={`size-2 rounded-full ${farbe}`} aria-hidden />{children}</span>
}

export function Dashboard() {
  const [heute] = useState(() => new Date().toISOString().slice(0, 10))
  const jahr = +heute.slice(0, 4)
  const monat = +heute.slice(5, 7) - 1
  // Vorgeladen bis Ende des übernächsten Monats (Kalender ohne Blättern, Fristen), davor Liegendes ist überfällig
  const ende = new Date(Date.UTC(jahr, monat + 3, 0)).toISOString().slice(0, 10)

  const kennzahlen = useAbfrage(() => supabase.rpc('startseite_kennzahlen', { p_heute: heute }), [heute])
  const faellig = useAbfrage(() => faelligeAnlagen(ende), [ende])
  const austausch = useAustausch()
  const anlagen = (faellig.daten ?? []) as unknown as FaelligeAnlage[]
  const k = kennzahlen.daten as unknown as Kennzahlen | null

  return (
    <div className="space-y-4 text-sm">
      <Fehler text={kennzahlen.fehler || faellig.fehler} />
      {k && <KennzahlenLeiste k={k} jahr={jahr} />}
      <div className="grid grid-cols-2 gap-4">
        <Kalender anlagen={anlagen} geladenBis={ende} melder={austausch.melder} heute={heute} jahr={jahr} monat={monat} />
        <Laufend />
        <Statistik k={k} jahr={jahr} />
        <Fristen anlagen={anlagen} austausch={austausch.gruppen} heute={heute} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Kennzahlen
// ---------------------------------------------------------------------------
function Kennzahl({ titel, wert, format, akzent, children }: {
  titel: string; wert: number; format?: (n: number) => string; akzent?: boolean; children?: ReactNode
}) {
  const flaeche = akzent ? 'bg-akzent text-marke' : 'karte'
  return (
    <div className={`rounded-lg p-4 ${flaeche}`}>
      <div className={akzent ? 'text-marke/75' : 'text-slate-500'}>{titel}</div>
      <div className="mt-1 text-3xl font-bold tabular-nums"><Hochzaehlen wert={wert} format={format} /></div>
      {children && <div className="mt-1.5">{children}</div>}
    </div>
  )
}

function KennzahlenLeiste({ k, jahr }: { k: Kennzahlen; jahr: number }) {
  const ausgeblendet = useAusgeblendet()
  const arten = Object.entries(k.anlagen_je_art).sort((a, b) => b[1] - a[1])
  const jahrSumme = Object.values(k.jahr_je_art).reduce((s, a) => s + summe(a), 0)
  const jahrRot = Object.values(k.jahr_je_art).reduce((s, a) => s + a.rot, 0)
  const quote = jahrSumme ? jahrRot / jahrSumme * 100 : 0
  const trend = k.geprueft_vorjahr ? Math.round((k.geprueft_jahr / k.geprueft_vorjahr - 1) * 100) : null
  const maengel = k.maengel['1'] + k.maengel['2'] + k.maengel['3']
  // Verlauf der Quote über die letzten 12 Monate (Monate ohne Prüfung: Lücke als 0)
  const verlauf = k.monate.map((m) => summe(m) ? m.rot / summe(m) * 100 : 0)
  const hoch = Math.max(10, ...verlauf)

  return (
    <section className="grid grid-cols-6 gap-3" aria-label={t('Kennzahlen')}>
      <Kennzahl titel={tb('Türen aktiv')} wert={k.anlagen}>
        <div className="flex h-1.5 overflow-hidden rounded-full bg-slate-100" title={arten.map(([a, n]) => `${artDefinition(a).name}: ${n}`).join(', ')}>
          {arten.map(([a, n]) => <span key={a} className={artFarbe(a).kraeftig} style={{ width: `${n / Math.max(1, k.anlagen) * 100}%` }} />)}
        </div>
      </Kennzahl>
      <Kennzahl titel={t('Geräte und Elemente')} wert={k.elemente}>
        <span className="text-slate-500">{t('Leuchten, Melder, Stromkreise, Geräte …')}</span>
      </Kennzahl>
      <Kennzahl titel={t('Geprüft {jahr}', { jahr })} wert={k.geprueft_jahr}>
        {trend !== null && <span className={`font-semibold ${trend >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{trend >= 0 ? '▲' : '▼'} {Math.abs(trend)} % </span>}
        <span className="text-slate-500">{trend !== null && t('ggü. Vorjahr · ')}{t('gesamt {anzahl}', { anzahl: zahl(k.geprueft_gesamt) })}</span>
      </Kennzahl>
      <Kennzahl titel={t('Nicht betriebssicher {jahr}', { jahr })} wert={quote} format={prozent}>
        <svg viewBox="0 0 110 24" className="h-6 w-full" role="img" aria-label={t('Quote der letzten 12 Monate')}>
          <polyline fill="none" className="stroke-red-600" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
            points={verlauf.map((v, i) => `${i * 10},${22 - v / hoch * 20}`).join(' ')} />
        </svg>
      </Kennzahl>
      <Kennzahl titel={t('Offene Mängel')} wert={maengel}>
        <div className="flex flex-wrap gap-1">
          {([3, 2, 1] as Stufe[]).filter((s) => k.maengel[`${s}`] > 0).map((s) =>
            <Badge key={s} farbe={s === 3 ? 'rot' : s === 2 ? 'gelb' : 'grau'}>{k.maengel[`${s}`]} {STUFEN[s]}</Badge>)}
          {maengel === 0 && <span className="text-slate-500">{t('keine')}</span>}
        </div>
      </Kennzahl>
      <Kennzahl titel={t('Überfällig')} wert={k.ueberfaellig} akzent>
        {!ausgeblendet.includes('faelligkeiten')
          ? <Link to="/faelligkeiten" className="font-semibold underline decoration-2 underline-offset-2 hover:decoration-marke">{t('+ {anzahl} fällig in 30 Tagen', { anzahl: zahl(k.faellig_30) })}</Link>
          : <span>{t('+ {anzahl} fällig in 30 Tagen', { anzahl: zahl(k.faellig_30) })}</span>}
      </Kennzahl>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Kalender über drei Monate, monatsweise zu blättern
// ---------------------------------------------------------------------------
function dichte(n: number): string {
  if (n === 0) return 'bg-slate-50 text-slate-400'
  if (n < 2) return 'bg-akzent-hell'
  if (n < 4) return 'bg-akzent/50'
  if (n < 8) return 'bg-akzent font-semibold'
  return 'bg-marke text-akzent font-semibold'
}

function nachObjekt(liste: FaelligeAnlage[]) {
  const m = new Map<string, { name: string; anlagen: FaelligeAnlage[] }>()
  for (const a of liste) {
    const g = m.get(a.objekt.id) ?? { name: a.objekt.name, anlagen: [] }
    g.anlagen.push(a)
    m.set(a.objekt.id, g)
  }
  return [...m.entries()]
}

/**
 * Beim Blättern über das Vorgeladene hinaus (Fälligkeiten bis `geladenBis`, Melder bis zur Austauschgrenze) den sichtbaren
 * Zeitraum `von`–`bis` nachladen, nur den Teil danach, damit sich nichts doppelt.
 */
function useNachladen(von: string, bis: string, geladenBis: string, heute: string) {
  const grenze = austauschGrenze(heute)
  const anlagenNoetig = bis > geladenBis
  const melderNoetig = bis > grenze
  const anlagen = useAbfrage(async () => anlagenNoetig
    ? faelligeAnlagen(bis, von > geladenBis ? von : plusTage(geladenBis, 1))
    : { data: [], error: null }, [anlagenNoetig, von, bis, geladenBis])
  const melder = useAbfrage(async () => melderNoetig
    ? supabase.from('anlage_element')
      .select('austausch:eigenschaften->>austausch, anlage!inner(status, objekt!inner(aktiv, endkunde!inner(aktiv)))')
      .eq('aktiv', true).eq('anlage.status', 'aktiv').eq('anlage.objekt.aktiv', true).eq('anlage.objekt.endkunde.aktiv', true)
      .gte('eigenschaften->>austausch', von > grenze ? von : plusTage(grenze, 1)).lte('eigenschaften->>austausch', bis).limit(5000)
    : { data: [], error: null }, [melderNoetig, von, bis, grenze])
  return {
    anlagen: useMemo(() => (anlagen.daten ?? []) as unknown as FaelligeAnlage[], [anlagen.daten]),
    austausch: useMemo(() => ((melder.daten ?? []) as { austausch: string | null }[]).flatMap((x) => x.austausch ? [x.austausch.slice(0, 10)] : []), [melder.daten]),
    laedt: (anlagenNoetig && anlagen.laedt) || (melderNoetig && melder.laedt),
    fehler: anlagen.fehler || melder.fehler,
  }
}

function Kalender({ anlagen: vorgeladen, geladenBis, melder, heute, jahr, monat }: {
  anlagen: FaelligeAnlage[]; geladenBis: string; melder: AustauschMelder[]; heute: string; jahr: number; monat: number
}) {
  const [gewaehlt, setGewaehlt] = useState<string | null>(null)
  // Erster sichtbarer Monat relativ zum aktuellen
  const [blaettern, setBlaettern] = useState(0)

  const monate = [0, 1, 2].map((v) => {
    const d = new Date(Date.UTC(jahr, monat + blaettern + v, 1))
    const j = d.getUTCFullYear(), m = d.getUTCMonth()
    return { j, m, name: d.toLocaleDateString(gebietsschema(), { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      tage: new Date(Date.UTC(j, m + 1, 0)).getUTCDate(), versatz: (d.getUTCDay() + 6) % 7 }
  })
  const von = `${monate[0].j}-${zweistellig(monate[0].m + 1)}-01`
  const bis = `${monate[2].j}-${zweistellig(monate[2].m + 1)}-${zweistellig(monate[2].tage)}`
  const nachgeladen = useNachladen(von, bis, geladenBis, heute)
  const anlagen = useMemo(() => [...vorgeladen, ...nachgeladen.anlagen], [vorgeladen, nachgeladen.anlagen])

  const jeTag = useMemo(() => {
    const m = new Map<string, FaelligeAnlage[]>()
    for (const a of anlagen) m.set(a.naechste_pruefung_am, [...(m.get(a.naechste_pruefung_am) ?? []), a])
    return m
  }, [anlagen])
  const melderJeTag = useMemo(() => {
    const m = new Map<string, number>()
    for (const tag of [...melder.map((x) => x.austausch.slice(0, 10)), ...nachgeladen.austausch]) m.set(tag, (m.get(tag) ?? 0) + 1)
    return m
  }, [melder, nachgeladen.austausch])
  // Überfällig vor dem sichtbaren Zeitraum; liegt er ganz in der Zukunft, alles Überfällige
  const vorZeitraum = von <= heute
  const frueher = anlagen.filter((a) => a.naechste_pruefung_am < (vorZeitraum ? von : heute))
  // Ohne Auswahl: der nächste Tag ab heute (bzw. ab dem sichtbaren Zeitraum) mit fälligen Anlagen
  const ab = vorZeitraum ? heute : von
  const naechster = anlagen.find((a) => a.naechste_pruefung_am >= ab)?.naechste_pruefung_am ?? null
  const tag = gewaehlt ?? naechster
  const auswahl = tag === 'frueher' ? frueher : tag ? jeTag.get(tag) ?? [] : []
  const blaettereUm = (n: number) => { setBlaettern(n === 0 ? 0 : (b) => b + n); setGewaehlt(null) }
  const pfeil = 'grid size-7 place-items-center rounded-md text-slate-600 transition hover:bg-akzent-hell hover:text-marke'

  return (
    <Quadrant titel={tb('Anstehende Prüfungen')} data-quadrant="kalender" zusatz={<>
      <Legende farbe="bg-red-600">{t('überfällig')}</Legende>
      <Legende farbe="bg-amber-500">{t('Prüfung fällig')}</Legende>
      <Legende farbe="bg-sky-600">{t('Melder-Austausch')}</Legende>
    </>}>
      <Fehler text={nachgeladen.fehler} />
      <div className="mb-3 flex items-center gap-2">
        {frueher.length > 0 && (
          <button type="button" onClick={() => setGewaehlt('frueher')} aria-pressed={tag === 'frueher'}
            className={`inline-flex w-fit items-center gap-2 rounded-md px-2.5 py-1 font-semibold transition ${tag === 'frueher' ? 'bg-red-600 text-white' : 'bg-red-100 text-red-800 hover:bg-red-200'}`}>
            {vorZeitraum ? t('{anzahl} schon vor {monat} überfällig', { anzahl: frueher.length, monat: monate[0].name.split(' ')[0] }) : t('{anzahl} überfällig', { anzahl: frueher.length })}
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          {nachgeladen.laedt && <span className="mr-1 text-xs text-slate-500">{t('Laden …')}</span>}
          {blaettern !== 0 && <button type="button" onClick={() => blaettereUm(0)} className="mr-1 rounded-md px-2 py-1 text-xs font-semibold text-slate-600 transition hover:bg-akzent-hell hover:text-marke">{t('Heute')}</button>}
          <button type="button" onClick={() => blaettereUm(-1)} className={pfeil} aria-label={t('Einen Monat zurück')} title={t('Einen Monat zurück')}>
            <ChevronLeft className="size-4" strokeWidth={2.25} aria-hidden />
          </button>
          <button type="button" onClick={() => blaettereUm(1)} className={pfeil} aria-label={t('Einen Monat weiter')} title={t('Einen Monat weiter')}>
            <ChevronRight className="size-4" strokeWidth={2.25} aria-hidden />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-5" aria-busy={nachgeladen.laedt}>
        {monate.map(({ j, m, name, tage, versatz }) => {
          let anzahl = 0
          const zellen = Array.from({ length: tage }, (_, i) => {
            const iso = `${j}-${zweistellig(m + 1)}-${zweistellig(i + 1)}`
            const liste = jeTag.get(iso) ?? []
            anzahl += liste.length
            return { iso, t: i + 1, liste, melder: melderJeTag.get(iso) ?? 0, spalte: (versatz + i) % 7 }
          })
          return (
            <div key={name}>
              <div className="mb-2 flex items-baseline justify-between">
                <span className="font-semibold">{name}</span>
                <span className="text-xs text-slate-500">{anzahl === 1 ? tb('1 Tür') : tb('{anzahl} Türen', { anzahl })}</span>
              </div>
              <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] text-slate-400" aria-hidden>
                {[t('Mo'), t('Di'), t('Mi'), t('Do'), t('Fr'), t('Sa'), t('So')].map((w) => <div key={w}>{w}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: versatz }, (_, i) => <div key={`v${i}`} />)}
                {zellen.map((z) => {
                  const vorbei = z.iso < heute
                  const ueber = vorbei && z.liste.length > 0
                  const farbe = ueber ? 'bg-red-100 text-red-800 font-semibold' : vorbei ? 'bg-transparent text-slate-300' : dichte(z.liste.length)
                  const leer = z.liste.length === 0 && z.melder === 0
                  return (
                    <div key={z.iso} className="group relative">
                      <button type="button" onClick={() => setGewaehlt(z.iso)} disabled={leer} aria-pressed={tag === z.iso}
                        aria-label={t('{datum}: {anzahl} fällig', { datum: datum(z.iso), anzahl: z.liste.length }) + (z.melder ? t(', {anzahl} Melder-Austausch', { anzahl: z.melder }) : '')}
                        className={`relative grid aspect-square w-full place-items-center rounded-md text-xs tabular-nums transition ${farbe}
                          ${z.iso === heute ? 'ring-2 ring-marke ring-inset' : ''} ${tag === z.iso ? 'outline-2 outline-offset-1 outline-marke' : ''}
                          ${leer ? 'cursor-default' : 'hover:scale-110 hover:shadow-md'}`}>
                        {z.t}
                        <span className="absolute bottom-0.5 left-1/2 flex -translate-x-1/2 gap-0.5" aria-hidden>
                          {ueber && <i className="size-1 rounded-full bg-red-600" />}
                          {!vorbei && z.liste.length > 0 && <i className="size-1 rounded-full bg-amber-600" />}
                          {z.melder > 0 && <i className="size-1 rounded-full bg-sky-600" />}
                        </span>
                      </button>
                      {!leer && (
                        <div role="tooltip" className={`pointer-events-none absolute top-full z-30 mt-1.5 hidden w-72 rounded-lg bg-marke p-3 text-xs text-white shadow-xl group-hover:block
                          ${z.spalte > 3 ? 'right-0' : 'left-0'}`}>
                          <div className="mb-1.5 flex justify-between gap-2 font-semibold">
                            <span>{new Date(`${z.iso}T00:00:00Z`).toLocaleDateString(gebietsschema(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</span>
                            {z.liste.length > 0 && <span className="text-akzent">{z.liste.length === 1 ? tb('1 Tür') : tb('{anzahl} Türen', { anzahl: z.liste.length })}</span>}
                          </div>
                          {ueber && <div className="mb-1.5 w-fit rounded bg-red-600 px-1.5 font-semibold">{t('überfällig')}</div>}
                          {nachObjekt(z.liste.slice(0, 12)).map(([id, g]) => (
                            <div key={id} className="mt-1">
                              <div className="font-semibold">{g.name}</div>
                              {g.anlagen.map((a) => (
                                <div key={a.id} className="flex items-center gap-1.5 text-slate-300">
                                  <i className={`size-2 shrink-0 rounded-full ${artFarbe(a.anlagentyp?.anlagenart).kraeftig}`} />
                                  {a.etikett_id && <span className="font-mono">{a.etikett_id}</span>}
                                  <span className="truncate">{a.kunden_bezeichnung}</span>
                                </div>
                              ))}
                            </div>
                          ))}
                          {z.liste.length > 12 && <div className="mt-1 text-slate-400">{t('und {anzahl} weitere', { anzahl: z.liste.length - 12 })}</div>}
                          {z.melder > 0 && <div className="mt-1.5 text-sky-300">{t('{anzahl} Rauchwarnmelder: Austauschdatum', { anzahl: z.melder })}</div>}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-slate-500" aria-hidden>
        {t('weniger')}
        <span className="flex gap-0.5">{['bg-slate-50 ring-1 ring-slate-200', 'bg-akzent-hell', 'bg-akzent/50', 'bg-akzent', 'bg-marke'].map((f) => <i key={f} className={`size-3 rounded-sm ${f}`} />)}</span>
        {tb('mehr Türen')}
        <span className="ml-auto">{t('Tag anklicken: Liste darunter')}</span>
      </div>

      <div className="mt-4 border-t border-slate-100 pt-3">
        <h3 className="mb-2 font-semibold">
          {tag === 'frueher' ? (vorZeitraum ? t('Überfällig vor {monat}', { monat: monate[0].name }) : t('Überfällig')) : tag ? new Date(`${tag}T00:00:00Z`).toLocaleDateString(gebietsschema(), { weekday: 'long', day: 'numeric', month: 'long', year: tag.slice(0, 4) === heute.slice(0, 4) ? undefined : 'numeric', timeZone: 'UTC' }) : tb('Keine fälligen Türen')}
          {tag && tag !== 'frueher' && tag === naechster && !gewaehlt && <span className="ml-2 font-normal text-slate-500">{vorZeitraum ? t('nächster Termin') : t('erster Termin ab {monat}', { monat: monate[0].name })}</span>}
        </h3>
        {auswahl.length === 0 && tag && tag !== 'frueher' && <p className="text-slate-500">{t('{anzahl} Melder mit Austauschdatum an diesem Tag.', { anzahl: melderJeTag.get(tag) ?? 0 })}</p>}
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
          {auswahl.slice(0, 12).map((a) => (
            <li key={a.id}>
              <Link to={`/objekte/${a.objekt.id}?anlage=${a.id}`} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-akzent-hell/60">
                <ArtSymbol art={a.anlagentyp?.anlagenart} groesse="sm" />
                <span className="min-w-0 flex-1 truncate"><EtikettText id={a.etikett_id} art={a.anlagentyp?.anlagenart} /> {a.kunden_bezeichnung}</span>
                <span className="truncate text-xs text-slate-500">{a.objekt.name}</span>
              </Link>
            </li>
          ))}
        </ul>
        {auswahl.length > 12 && <p className="mt-1 text-xs text-slate-500">{t('und {anzahl} weitere', { anzahl: auswahl.length - 12 })}</p>}
      </div>
    </Quadrant>
  )
}

// ---------------------------------------------------------------------------
// Laufende Prüfungen
// ---------------------------------------------------------------------------
type Laufende = {
  objekt_id: string
  objekt: { name: string; endkunde: { name: string } | null } | null
  pruefer: string[]
  laufend: number
  heute: number
  zuletztAktiv: string
  offline: boolean
}
type Abgeschlossen = {
  id: string; abgeschlossen_am: string | null; protokoll_nr: string | null; ergebnis: keyof Ampel | null
  anlage: { etikett_id: string | null; kunden_bezeichnung: string | null; objekt_id: string; objekt: { name: string } | null } | null
}

const kuerzel = (name: string) => name.split(/[\s.-]+/).filter(Boolean).map((t) => t[0]).slice(0, 2).join('').toUpperCase()

function vorZeit(iso: string, jetzt: number): string {
  const min = Math.round((jetzt - new Date(iso).getTime()) / 60000)
  if (min < 1) return t('gerade eben')
  if (min < 60) return t('vor {min} Min.', { min })
  if (min < 24 * 60) return t('vor {stunden} Std.', { stunden: Math.round(min / 60) })
  const tage = Math.round(min / 1440)
  return tage === 1 ? t('gestern') : t('vor {tage} Tagen', { tage })
}

/** Objekte, in denen gerade geprüft wird oder heute geprüft wurde (Prüfungen je Anlage, ohne Session). */
async function laufendeLaden() {
  const heute = new Date()
  const ab = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate()).toISOString()
  const r = await entschluesselt('anlagenpruefung', supabase.from('anlagenpruefung')
    .select('status, letzte_aktivitaet, erfasst_offline, abgeschlossen_am, pruefer:benutzer!anlagenpruefung_pruefer_id_fkey(name), anlage!inner(objekt_id, objekt(id, name, endkunde(id, name)))')
    // Gezählt werden Anlagen und Türen, nicht die Prüfung der Türanlage, die ihre Türen klammert
    .is('session_id', null).neq('anlage.anlagentyp_id', TUERANLAGE_TYP).or(`status.eq.in_pruefung,abgeschlossen_am.gte."${ab}"`).limit(500))
  if (r.error) return { data: null, error: r.error }
  const je = new Map<string, Laufende>()
  for (const p of r.data) {
    const id = p.anlage.objekt_id
    const z = je.get(id) ?? { objekt_id: id, objekt: p.anlage.objekt, pruefer: [], laufend: 0, heute: 0, zuletztAktiv: p.letzte_aktivitaet, offline: false }
    if (p.status === 'in_pruefung') z.laufend++
    else if (p.abgeschlossen_am) z.heute++
    if (p.pruefer?.name && !z.pruefer.includes(p.pruefer.name)) z.pruefer.push(p.pruefer.name)
    if (p.letzte_aktivitaet > z.zuletztAktiv) z.zuletztAktiv = p.letzte_aktivitaet
    z.offline ||= p.erfasst_offline && p.status === 'in_pruefung'
    je.set(id, z)
  }
  // Objekte mit laufenden Prüfungen oben, heute fertige darunter
  const data = [...je.values()].sort((x, y) => y.laufend - x.laufend || y.zuletztAktiv.localeCompare(x.zuletztAktiv)).slice(0, 8)
  return { data, error: null }
}

function Laufend() {
  const laufend = useAbfrage(laufendeLaden)
  const zuletzt = useAbfrage(() => entschluesselt('anlagenpruefung', supabase.from('anlagenpruefung')
    .select('id, abgeschlossen_am, protokoll_nr, ergebnis, anlage(etikett_id, kunden_bezeichnung, objekt_id, objekt(id, name))')
    .is('session_id', null).is('teil_von_id', null).eq('status', 'geprueft').not('abgeschlossen_am', 'is', null)
    .order('abgeschlossen_am', { ascending: false }).limit(4)))
  const [jetzt] = useState(() => Date.now())
  const liste = laufend.daten ?? []
  const imGang = liste.filter((o) => o.laufend > 0).length

  return (
    <Quadrant data-quadrant="laufend" titel={<>{t('Laufende Prüfungen')} {imGang > 0 && <span className="ml-1 rounded-full bg-marke px-2 py-0.5 align-middle text-xs text-white">{imGang}</span>}</>}
      zusatz={<Link className="link inline-flex items-center gap-1 text-sm" to="/pruefen">{t('Prüfen')}<ArrowRight className="size-4" aria-hidden /></Link>}>
      <Fehler text={laufend.fehler || zuletzt.fehler} />
      {!laufend.laedt && liste.length === 0 && <p className="text-slate-500">{t('Heute wird noch nicht geprüft.')}</p>}
      <ul className="divide-y divide-slate-100">
        {liste.map((o) => {
          const aktiv = o.laufend > 0 && jetzt - new Date(o.zuletztAktiv).getTime() < 15 * 60000
          return (
            <li key={o.objekt_id}>
              <Link to={`/pruefen/o/${o.objekt_id}`} className="-mx-2 flex items-center gap-4 rounded-md px-2 py-3 hover:bg-akzent-hell/50">
                <div className="flex -space-x-2">
                  {o.pruefer.slice(0, 3).map((n) => (
                    <span key={n} title={n} className="grid size-8 place-items-center rounded-full bg-akzent text-xs font-bold ring-2 ring-white">{kuerzel(n)}</span>
                  ))}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2"><span className="truncate font-semibold">{o.objekt?.name}</span><span className="truncate text-slate-500">{o.objekt?.endkunde?.name}</span></div>
                  <div className="mt-1 text-slate-600">{o.laufend > 0 && t('{anzahl} in Prüfung · ', { anzahl: o.laufend })}{t('{anzahl} heute abgeschlossen', { anzahl: o.heute })}</div>
                </div>
                <div className="w-28 text-right text-xs">
                  {aktiv ? <span className="inline-flex items-center gap-1 font-semibold text-emerald-700"><i className="size-2 animate-pulse rounded-full bg-emerald-500" />{t('aktiv')}</span>
                    : o.offline ? <Badge farbe="gelb">{t('offline erfasst')}</Badge> : <span className="text-slate-400">{o.laufend ? t('ruht') : t('fertig')}</span>}
                  <div className="text-slate-500">{vorZeit(o.zuletztAktiv, jetzt)}</div>
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
      {!!zuletzt.daten?.length && (
        <div className="mt-auto pt-4">
          <h3 className="mb-2 font-semibold text-slate-500">{t('Zuletzt abgeschlossen')}</h3>
          <ul className="space-y-1">
            {(zuletzt.daten as unknown as Abgeschlossen[]).map((p) => {
              const e: keyof Ampel = p.ergebnis ?? 'gruen'
              return (
                <li key={p.id}>
                  <Link to={`/pruefen/p/${p.id}`} className="-mx-2 flex items-center gap-3 rounded-md px-2 py-1 hover:bg-akzent-hell/50">
                    <i className={`size-2.5 rounded-full ${AMPEL_FARBE[e]}`} title={AMPEL_TEXT[e]} />
                    <span className="font-medium">{p.anlage?.etikett_id ?? p.anlage?.kunden_bezeichnung ?? t('Türanlage')}</span>
                    <span className="truncate text-slate-500">{p.anlage?.objekt?.name}</span>
                    {p.protokoll_nr && <span className="text-slate-500">{t('Nr. {nummer}', { nummer: p.protokoll_nr })}</span>}
                    <span className="ml-auto text-slate-500">{datum(p.abgeschlossen_am)}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </Quadrant>
  )
}

// ---------------------------------------------------------------------------
// Statistik
// ---------------------------------------------------------------------------
function Statistik({ k, jahr }: { k: Kennzahlen | null; jahr: number }) {
  const bereit = useBereit()
  if (!k) return <Quadrant titel={t('Prüfungen der letzten 12 Monate')}><p className="text-slate-500">{t('Laden …')}</p></Quadrant>
  const max = Math.max(1, ...k.monate.map(summe))
  const arten = Object.entries(k.anlagen_je_art).sort((a, b) => b[1] - a[1])
  const quoten = Object.entries(k.jahr_je_art).filter(([, a]) => summe(a) > 0)
    .map(([art, a]) => ({ art, quote: a.rot / summe(a) * 100, n: summe(a) })).sort((a, b) => b.quote - a.quote)
  // Ring: Anteil und Startpunkt je Art (Prozent des Umfangs)
  const ring = arten.map(([art, n], i) => ({ art, anteil: n / Math.max(1, k.anlagen) * 100,
    start: arten.slice(0, i).reduce((s, [, m]) => s + m / Math.max(1, k.anlagen) * 100, 0) }))
  const luecke = arten.length > 1 ? 0.8 : 0

  return (
    <Quadrant data-quadrant="statistik" titel={t('Prüfungen der letzten 12 Monate')} zusatz={(['gruen', 'gelb', 'rot'] as const).map((a) => <Legende key={a} farbe={AMPEL_FARBE[a]}>{AMPEL_TEXT[a]}</Legende>)}>
      <div className="grid grid-cols-[minmax(0,1fr)_13rem] gap-6">
        <div>
          <div className="flex h-44 items-end gap-1.5 border-b border-slate-200">
            {k.monate.map((m) => (
              <div key={m.monat} className="group relative flex h-full flex-1 flex-col justify-end">
                <div className="flex flex-col-reverse overflow-hidden rounded-t transition-[height] duration-700 ease-out group-hover:opacity-80"
                  style={{ height: bereit ? `${summe(m) / max * 100}%` : 0 }}>
                  {(['gruen', 'gelb', 'rot'] as const).map((a) => <span key={a} className={AMPEL_FARBE[a]} style={{ flexGrow: m[a] }} />)}
                </div>
                <div role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 hidden w-44 -translate-x-1/2 rounded-lg bg-marke p-2.5 text-xs text-white shadow-xl group-hover:block">
                  <div className="mb-1 font-semibold">{new Date(`${m.monat}-01T00:00:00Z`).toLocaleDateString(gebietsschema(), { month: 'long', year: 'numeric', timeZone: 'UTC' })}: {summe(m)}</div>
                  {(['gruen', 'gelb', 'rot'] as const).map((a) => <div key={a}>{AMPEL_TEXT[a]}: {m[a]}</div>)}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-1.5 text-center text-[11px] text-slate-500">
            {k.monate.map((m) => <div key={m.monat} className="flex-1">{new Date(`${m.monat}-01T00:00:00Z`).toLocaleDateString(gebietsschema(), { month: 'short', timeZone: 'UTC' })}</div>)}
          </div>
          {k.monate.every((m) => summe(m) === 0) && <p className="mt-2 text-slate-500">{t('In den letzten 12 Monaten wurde nichts abgeschlossen.')}</p>}
        </div>
        <div>
          <div className="relative mx-auto size-36">
            <svg viewBox="0 0 42 42" className="size-36 -rotate-90" aria-hidden>
              <circle r="15.9" cx="21" cy="21" fill="none" className="stroke-slate-100" strokeWidth="5" />
              {ring.map(({ art, anteil, start }) => (
                <circle key={art} r="15.9" cx="21" cy="21" fill="none" className={artFarbe(art).strich} strokeWidth="5"
                  strokeDasharray={`${Math.max(0, anteil - luecke)} ${100 - anteil + luecke}`} strokeDashoffset={-start} />
              ))}
            </svg>
            <div className="absolute inset-0 grid place-items-center text-center">
              <div><div className="text-2xl font-bold tabular-nums">{zahl(k.anlagen)}</div><div className="text-[11px] text-slate-500">{tb('Türen')}</div></div>
            </div>
          </div>
          <ul className="mt-3 space-y-1 text-xs">
            {arten.map(([art, n]) => (
              <li key={art} className="flex items-center gap-2">
                <i className={`size-2.5 shrink-0 rounded-sm ${artFarbe(art).kraeftig}`} />
                <span className="truncate">{ARTEN[art as keyof typeof ARTEN]?.name ?? art}</span>
                <span className="ml-auto font-semibold tabular-nums">{zahl(n)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <h3 className="mt-4 mb-2 font-semibold text-slate-500">{t('Nicht betriebssicher nach Anlagenart ({jahr})', { jahr })}</h3>
      {quoten.length === 0 ? <p className="text-slate-500">{t('Noch keine Prüfungen in {jahr}.', { jahr })}</p> : (
        <div className="grid grid-cols-3 gap-x-6 gap-y-2">
          {quoten.map(({ art, quote, n }) => (
            <div key={art} title={n === 1 ? t('1 Prüfung') : t('{anzahl} Prüfungen', { anzahl: n })}>
              <div className="flex justify-between gap-2 text-xs">
                <span className="truncate">{artDefinition(art).name}</span>
                <span className={`font-semibold tabular-nums ${quote > 10 ? 'text-red-700' : ''}`}>{prozent(quote)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className={`h-full rounded-full transition-[width] duration-700 ${quote > 10 ? 'bg-red-600' : 'bg-marke'}`} style={{ width: bereit && quote > 0 ? `${Math.max(2, quote)}%` : 0 }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Quadrant>
  )
}

// ---------------------------------------------------------------------------
// Fristen und Hinweise
// ---------------------------------------------------------------------------
type Sachkunde = { anlagenart: string; gueltig_bis: string; benutzer: { id: string; name: string } }
type Mangel = {
  id: string; beschreibung: string; stufe: number; erstellt_am: string
  anlage: { id: string; etikett_id: string | null; kunden_bezeichnung: string | null; objekt: { id: string; name: string } }
}

function Unterbereich({ titel, link, children }: { titel: ReactNode; link?: { zu: string; text: string }; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">{titel}</h3>
        {link && <Link className="link inline-flex items-center gap-1 text-xs" to={link.zu}>{link.text}<ArrowRight className="size-3.5" aria-hidden /></Link>}
      </div>
      {children}
    </div>
  )
}

function Fristen({ anlagen, austausch, heute }: { anlagen: FaelligeAnlage[]; austausch: ReturnType<typeof useAustausch>['gruppen']; heute: string }) {
  const { benutzer, istAdmin, systemSichtbar } = useAuth()
  const ausgeblendet = useAusgeblendet()
  const sachkunde = useAbfrage(() => {
    const q = supabase.from('benutzer_sachkunde').select('anlagenart, gueltig_bis, benutzer!inner(id, name, aktiv)')
      .not('gueltig_bis', 'is', null).eq('benutzer.aktiv', true)
    return (istAdmin ? q : q.eq('benutzer_id', benutzer?.id ?? '')).order('gueltig_bis').limit(5)
  }, [istAdmin, benutzer?.id])
  const maengel = useAbfrage(() => entschluesselt('mangel', supabase.from('mangel')
    .select('id, beschreibung, stufe, erstellt_am, anlage!inner(id, etikett_id, kunden_bezeichnung, status, objekt!inner(id, name, aktiv))')
    .eq('status', 'offen').gte('stufe', 2).eq('anlage.status', 'aktiv').eq('anlage.objekt.aktiv', true)
    .order('stufe', { ascending: false }).order('erstellt_am').limit(5)))
  const in30 = plusTage(heute, 30)
  const faellig = anlagen.filter((a) => a.naechste_pruefung_am <= in30)

  return (
    <Quadrant titel={t('Fristen und Hinweise')} data-quadrant="fristen" zusatz={t('dringendes zuerst')}>
      <Fehler text={sachkunde.fehler || maengel.fehler} />
      <div className="grid grid-cols-2 gap-x-6 gap-y-5">
        <Unterbereich titel={tb('Fällig in 30 Tagen')} link={ausgeblendet.includes('faelligkeiten') ? undefined : { zu: '/faelligkeiten', text: t('Alle Fälligkeiten') }}>
          {faellig.length === 0 ? <p className="text-slate-500">{tb('Keine fälligen Türen.')}</p> : (
            <ul className="max-h-56 space-y-0.5 overflow-y-auto pr-1" aria-label={t('Fällige Prüfungen')}>
              {faellig.map((a) => {
                const ueber = a.naechste_pruefung_am < heute
                return (
                  <li key={a.id}>
                    <Link to={`/objekte/${a.objekt.id}?anlage=${a.id}`} data-faellig={a.etikett_id ?? a.id} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-akzent-hell/60">
                      <i className={`size-2 shrink-0 rounded-full ${artFarbe(a.anlagentyp?.anlagenart).kraeftig}`} title={artDefinition(a.anlagentyp?.anlagenart).name} />
                      <span className="min-w-0 flex-1 truncate"><EtikettText id={a.etikett_id} art={a.anlagentyp?.anlagenart} /> {a.objekt.name} · {a.kunden_bezeichnung}</span>
                      <span className={`shrink-0 rounded px-1.5 text-xs font-semibold ${ueber ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>{datum(a.naechste_pruefung_am)}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Unterbereich>

        <Unterbereich titel={istAdmin ? t('Sachkundenachweise') : t('Meine Sachkunde')} link={systemSichtbar ? { zu: '/benutzer', text: t('Benutzer') } : undefined}>
          {sachkunde.daten?.length === 0 && <p className="text-slate-500">{t('Keine befristeten Nachweise.')}</p>}
          <ul className="space-y-1.5" data-sachkunde-hinweis>
            {(sachkunde.daten as unknown as Sachkunde[] | null)?.map((x) => {
              const status = sachkundeStatus(x.gueltig_bis, heute)
              const tage = Math.round((new Date(x.gueltig_bis).getTime() - new Date(heute).getTime()) / 864e5)
              const farbe = status === 'abgelaufen' ? 'bg-red-600' : status === 'bald' ? 'bg-amber-400' : 'bg-emerald-500'
              return (
                <li key={`${x.benutzer.id}-${x.anlagenart}`} className={`rounded-md px-2 py-1.5 ${status === 'abgelaufen' ? 'bg-red-50 ring-1 ring-red-200' : 'bg-slate-50'}`}>
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold">{x.benutzer.name}</span>: {ARTEN[x.anlagenart as keyof typeof ARTEN]?.name ?? x.anlagenart}
                      {' – '}{status === 'abgelaufen' ? t('abgelaufen am {datum}', { datum: datum(x.gueltig_bis) }) : t('gültig bis {datum}', { datum: datum(x.gueltig_bis) })}
                    </span>
                    <span className={`shrink-0 text-xs font-semibold ${status === 'abgelaufen' ? 'text-red-700' : status === 'bald' ? 'text-amber-700' : 'text-slate-500'}`}>
                      {status === 'abgelaufen' ? t('seit {tage} Tagen', { tage: -tage }) : t('noch {tage} Tage', { tage })}
                    </span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200">
                    <div className={`h-full rounded-full ${farbe}`} style={{ width: `${Math.max(4, Math.min(100, 100 - tage / 3.65))}%` }} />
                  </div>
                </li>
              )
            })}
          </ul>
        </Unterbereich>

        <Unterbereich titel={t('Melder-Austausch')}>
          {austausch.length === 0 ? <p className="text-slate-500">{t('Kein Austausch in den nächsten Monaten.')}</p> : (
            <ul className="space-y-0.5">
              {austausch.slice(0, 4).map((g) => (
                <li key={g.anlage.id}>
                  <Link to={`/objekte/${g.anlage.objekt.id}?anlage=${g.anlage.id}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md px-1.5 py-1 hover:bg-akzent-hell/60">
                    <span className="min-w-0 flex-1 truncate">{g.anlage.etikett_id && <EtikettText id={g.anlage.etikett_id} />} {g.anlage.objekt.name} · {g.anlage.kunden_bezeichnung}</span>
                    <AustauschBadges z={g.zaehler} />
                  </Link>
                </li>
              ))}
              {austausch.length > 4 && <li className="px-1.5 text-xs text-slate-500">{t('und {anzahl} weitere Anlagen', { anzahl: austausch.length - 4 })}</li>}
            </ul>
          )}
        </Unterbereich>

        <Unterbereich titel={t('Offene Mängel')} link={ausgeblendet.includes('maengel') ? undefined : { zu: '/maengel', text: t('Alle Mängel') }}>
          {maengel.daten?.length === 0 && <p className="text-slate-500">{t('Keine erheblichen oder gefährlichen Mängel offen.')}</p>}
          <ul className="space-y-0.5">
            {(maengel.daten as unknown as Mangel[] | null)?.map((m) => (
              <li key={m.id}>
                <Link to={`/objekte/${m.anlage.objekt.id}?anlage=${m.anlage.id}`} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-akzent-hell/60">
                  <Badge farbe={m.stufe === 3 ? 'rot' : 'gelb'}>{STUFEN[m.stufe as Stufe]}</Badge>
                  <span className="min-w-0 flex-1 truncate">{m.beschreibung}</span>
                  <span className="shrink-0 text-xs text-slate-500">{m.anlage.objekt.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Unterbereich>
      </div>
    </Quadrant>
  )
}
