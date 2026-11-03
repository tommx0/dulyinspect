import { useMemo, useState } from 'react'
import { PUNKT_TYPEN, type Punkt } from '../lib/checkliste'
import { ablaufLayout, type Gatter } from '../lib/checklisteAblauf'
import { t } from '../lib/sprache'
import { zweigFarbe } from './zweigFarbe'

const RAND = 20
const KNOTEN_B = 220
const KNOTEN_H = 50
const ZEILE_MIN = 80
const KOPF_H = 46
const GATTER_B = 196
const WIRKUNG_B = 210
const TAP = 64 // Platz zwischen Punkt und Gatter für Steuerleitungen
const GATTER_ABST = 30
const SPUR = KNOTEN_B + TAP + GATTER_B + GATTER_ABST
const WIRKUNG = '#b45309'
const FLUSS = '#64748b'
const STEUER_STRICH = '6 4' // Steuerleitungen gestrichelt, Wirkungsleitungen gepunktet, Ablauf durchgezogen
const R = 9

const VERKNUEPFUNG = { einzel: t('NUR WENN'), alle: t('UND'), eine: t('ODER') }

/** Grob geschätzte Höhe eines Gatters (Zeilen à ~32 Zeichen). */
function gatterHoehe(g: Gatter): number {
  const zeilen = g.eingaenge.reduce((n, e) => n + Math.max(1, Math.ceil(e.text.length / 30)), 0) || 1
  const folgen = g.folgen ? Math.ceil(g.folgen.length / 30) : 0
  return 30 + zeilen * 15 + folgen * 15
}

/** Abstand der senkrechten Steuerleitung einer Quelle rechts neben dem Punkt. */
const steuerVersatz = (quellenNr: number) => 12 + (quellenNr % 8) * 6

/**
 * Ablaufplan: Der Prüfablauf läuft als Hauptlinie von oben nach unten. Punkte mit Bedingung hängen an einem Abzweig nach rechts, vor dem ein
 * Gatter sitzt. Die abgefragten Punkte sind nur Steuerleitungen in dieses Gatter. UND/ODER sind Gatter mit mehreren Eingängen.
 */
export function Ablaufplan({ punkte, unerreichbar, onOeffnen }: {
  punkte: Punkt[]
  unerreichbar: Set<string>
  /** Klick auf einen Punkt; ohne Angabe sind die Punkte nicht klickbar */
  onOeffnen?: (p: Punkt) => void
}) {
  const ablauf = useMemo(() => ablaufLayout(punkte), [punkte])
  const [hover, setHover] = useState<string | null>(null)

  const geo = useMemo(() => {
    const kopfZeilen = new Set(ablauf.koepfe.map((k) => k.zeile))
    const hoehe = new Map<number, number>()
    for (let z = 0; z < ablauf.zeilen; z++) hoehe.set(z, kopfZeilen.has(z) ? KOPF_H : ZEILE_MIN)
    for (const g of ablauf.gatter) hoehe.set(g.zeile, Math.max(hoehe.get(g.zeile)!, gatterHoehe(g) + 32))
    const oben: number[] = []
    let y = RAND
    for (let z = 0; z < ablauf.zeilen; z++) { oben[z] = y; y += hoehe.get(z)! }

    const knoten = new Map(ablauf.knoten.map((k) => [k.punkt.id, k]))
    const kx = (spalte: number) => RAND + spalte * SPUR
    const knotenGeo = (id: string) => {
      const k = knoten.get(id)!
      const x = kx(k.spalte)
      return { x, y: oben[k.zeile], cx: x + KNOTEN_B / 2, unten: oben[k.zeile] + KNOTEN_H, mitte: oben[k.zeile] + KNOTEN_H / 2, rechts: x + KNOTEN_B }
    }
    // Wirkungs-Gatter stehen rechts vom Punkt, nebeneinander
    const wirkungsNr = new Map<string, number>()
    const gatterGeo = new Map<string, { x: number; y: number; b: number; h: number }>()
    for (const g of ablauf.gatter) {
      if (g.art === 'sichtbar') {
        gatterGeo.set(g.id, { x: kx(g.spalte) - GATTER_ABST - GATTER_B, y: oben[g.zeile], b: GATTER_B, h: gatterHoehe(g) })
      } else {
        const nr = wirkungsNr.get(g.ziel[0]) ?? 0
        wirkungsNr.set(g.ziel[0], nr + 1)
        gatterGeo.set(g.id, { x: kx(g.spalte) + KNOTEN_B + 40 + nr * (WIRKUNG_B + 18), y: oben[g.zeile], b: WIRKUNG_B, h: gatterHoehe(g) })
      }
    }
    // Jede abgefragte Quelle bekommt eine eigene senkrechte Leitung, damit sich Steuerleitungen nicht überlagern
    const quellenNr = new Map<string, number>()
    for (const g of ablauf.gatter) for (const e of g.eingaenge) if (!quellenNr.has(e.von)) quellenNr.set(e.von, quellenNr.size)
    // Breite inkl. der Leitungen rechts neben den Punkten (Steuerleitungen, Rückkehr am rechten Rand), sonst schneidet das SVG sie ab
    const rechts = Math.max(
      ...ablauf.knoten.map((k) => kx(k.spalte) + KNOTEN_B + 18),
      ...[...quellenNr].map(([id, nr]) => knotenGeo(id).rechts + steuerVersatz(nr)),
      ...[...gatterGeo.values()].map((g) => g.x + g.b),
    )
    return { oben, knoten, knotenGeo, gatterGeo, quellenNr, breite: rechts + RAND, hoehe: y + RAND }
  }, [ablauf])

  // Beim Überfahren: Gatter, Ziele und Quellen hervorheben
  const fokus = useMemo(() => {
    if (!hover) return null
    const s = new Set([hover])
    for (const g of ablauf.gatter) {
      if (g.id === hover || g.ziel.includes(hover) || g.eingaenge.some((e) => e.von === hover)) {
        s.add(g.id)
        g.ziel.forEach((z) => s.add(z))
        g.eingaenge.forEach((e) => s.add(e.von))
      }
    }
    return s
  }, [hover, ablauf])

  if (punkte.length === 0) return <p className="text-slate-500">{t('Noch keine Prüfpunkte.')}</p>

  const dimm = (...ids: string[]) => (fokus && !ids.every((i) => fokus.has(i)) ? 0.18 : 1)
  const farbeVon = (id: string, zweig: string | null) => zweigFarbe(geo.knoten.get(id)!.punkt, zweig)

  const flussPfad = (art: 'folge' | 'abzweig' | 'zurueck', von: string, nach: string): string | null => {
    const vonIstGatter = von.startsWith('g:')
    const nachIstGatter = nach.startsWith('g:')
    if (vonIstGatter) {
      // Gatter → Punkt dahinter: waagerecht
      const g = geo.gatterGeo.get(von)!
      const n = geo.knotenGeo(nach)
      return `M${g.x + g.b} ${n.mitte} H${n.x}`
    }
    const a = geo.knotenGeo(von)
    if (nachIstGatter) {
      // Abzweig: von der Hauptlinie nach unten, dann nach rechts ins Gatter
      const g = geo.gatterGeo.get(nach)!
      const gy = g.y + KNOTEN_H / 2
      return `M${a.cx} ${a.unten} V${gy - R} Q${a.cx} ${gy} ${a.cx + R} ${gy} H${g.x}`
    }
    const b = geo.knotenGeo(nach)
    if (art === 'folge') return `M${a.cx} ${a.unten} V${b.y}`
    // zurück in die Hauptlinie: in den Zielpunkt von oben einmünden
    const yj = b.y - 14
    if (a.cx === b.cx) return `M${a.cx} ${a.unten} V${b.y}`
    const richtung = b.cx < a.cx ? -1 : 1
    const einmuenden = `H${b.cx - richtung * R} Q${b.cx} ${yj} ${b.cx} ${yj + R} V${b.y}`
    // Liegen auf dem Weg nach unten weitere Punkte derselben Spur, führt die Linie an deren rechter Seite vorbei
    // (sonst sähe es nach Ablauf durch diese Punkte aus)
    const von_k = geo.knoten.get(von)!
    const im_weg = ablauf.knoten.some((k) => k.spalte === von_k.spalte && k.zeile > von_k.zeile && k.zeile < geo.knoten.get(nach)!.zeile)
    if (im_weg) {
      const xr = a.rechts + 18
      return `M${a.rechts} ${a.mitte} H${xr - R} Q${xr} ${a.mitte} ${xr} ${a.mitte + R} V${yj - R} Q${xr} ${yj} ${xr - R} ${yj} ${einmuenden}`
    }
    return `M${a.cx} ${a.unten} V${yj - R} Q${a.cx} ${yj} ${a.cx + richtung * R} ${yj} ${einmuenden}`
  }

  const steuerPfad = (g: Gatter, i: number): string => {
    const q = geo.knotenGeo(g.eingaenge[i].von)
    const gg = geo.gatterGeo.get(g.id)!
    const trunk = q.rechts + steuerVersatz(geo.quellenNr.get(g.eingaenge[i].von)!)
    const ex = gg.x + 16 + Math.min(i, 6) * 15
    const yh = gg.y - 12
    return `M${q.rechts} ${q.mitte} H${trunk} V${yh} H${ex} V${gg.y}`
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-5 bg-slate-500" />{t('Ablauf (Hauptlinie und Abzweig)')}</span>
        <span className="flex items-center gap-1"><span className="inline-block rounded border-2 border-slate-400 px-1 text-[9px] font-bold leading-tight">{t('GATTER')}</span>{t('lässt nur durch, wenn die Bedingung zutrifft')}</span>
        <span className="flex items-center gap-1"><svg width="20" height="4" aria-hidden><line x1="0" y1="2" x2="20" y2="2" stroke="#16a34a" strokeWidth={1.75} strokeDasharray={STEUER_STRICH} /></svg>{t('Steuerleitung der Abfrage, gestrichelt (grün: Ja, i.O., im Soll; orange: Nein, n.i.O., außerhalb Soll)')}</span>
        <span className="flex items-center gap-1"><span className="inline-block rounded border-2 px-1 text-[9px] font-bold leading-tight" style={{ borderColor: WIRKUNG, color: WIRKUNG }}>{t('⚡ WENN')}</span>{t('Wirkung (Pflicht, Mangelstufe, Grenzwert)')}</span>
        <span className="flex items-center gap-1"><span className="inline-block size-3 rounded-sm border-2 border-dashed border-red-400 bg-red-50" />{t('nie erreichbar')}</span>
      </div>

      <div className="karte max-h-[75vh] overflow-auto" role="group" aria-label={t('Ablaufplan')}>
        <div className="relative" style={{ width: geo.breite, height: geo.hoehe }}>
          <svg className="absolute inset-0" width={geo.breite} height={geo.hoehe} aria-hidden>
            <defs>
              <marker id="ablauf-pfeil" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0 L8 4 L0 8 z" fill={FLUSS} />
              </marker>
              <marker id="ablauf-pfeil-wirkung" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0 L8 4 L0 8 z" fill={WIRKUNG} />
              </marker>
            </defs>

            {/* Fluss: Hauptlinie, Abzweige, Rückkehr */}
            {ablauf.fluss.map((f, i) => {
              const d = flussPfad(f.art, f.von, f.nach)
              if (!d) return null
              const a = geo.knotenGeo
              return (
                <g key={`f${i}`} opacity={dimm(f.von, f.nach)}>
                  <path d={d} fill="none" stroke={FLUSS} strokeWidth={2} strokeLinejoin="round" markerEnd="url(#ablauf-pfeil)" />
                  {f.art === 'abzweig' && <circle cx={a(f.von).cx} cy={geo.gatterGeo.get(f.nach)!.y + KNOTEN_H / 2} r={3.5} fill={FLUSS} />}
                </g>
              )
            })}

            {/* Wirkungs-Gatter hängen per Pfeil am Punkt */}
            {ablauf.gatter.filter((g) => g.art === 'wirkung').map((g) => {
              const n = geo.knotenGeo(g.ziel[0])
              const gg = geo.gatterGeo.get(g.id)!
              return <path key={`wl${g.id}`} d={`M${gg.x} ${n.mitte} H${n.rechts}`} stroke={WIRKUNG} strokeWidth={2} strokeDasharray="3 4" fill="none"
                markerEnd="url(#ablauf-pfeil-wirkung)" opacity={dimm(g.id, g.ziel[0])} />
            })}

            {/* Steuerleitungen: Antwort eines Punkts → Eingang des Gatters */}
            {ablauf.gatter.flatMap((g) => g.eingaenge.map((e, i) => {
              const gg = geo.gatterGeo.get(g.id)!
              const farbe = g.art === 'wirkung' ? WIRKUNG : farbeVon(e.von, e.zweig)
              return (
                <g key={`s${g.id}-${i}`} opacity={dimm(g.id, e.von)}>
                  <path d={steuerPfad(g, i)} fill="none" stroke={farbe} strokeWidth={1.75} strokeLinejoin="round" strokeDasharray={g.art === 'wirkung' ? '2 4' : STEUER_STRICH} />
                  <circle cx={gg.x + 16 + Math.min(i, 6) * 15} cy={gg.y} r={3.5} fill={farbe} />
                </g>
              )
            }))}
          </svg>

          {ablauf.koepfe.map((k) => (
            <div key={k.name} className="absolute flex items-center gap-2 text-sm font-semibold text-slate-700" style={{ left: RAND - 6, top: geo.oben[k.zeile] + 8, width: geo.breite - 2 * RAND + 12 }}>
              <span className="shrink-0 bg-white pr-2">{k.name}</span>
              <span className="h-px flex-1 bg-slate-200" />
            </div>
          ))}

          {ablauf.gatter.map((g) => {
            const gg = geo.gatterGeo.get(g.id)!
            const wirkung = g.art === 'wirkung'
            const tot = g.ziel.every((id) => unerreichbar.has(id))
            return (
              <div key={g.id} onMouseEnter={() => setHover(g.id)} onMouseLeave={() => setHover(null)}
                title={wirkung ? t('Wirkung: {folgen}, wenn {bedingung}', { folgen: g.folgen, bedingung: g.text }) : t('Gatter: {bedingung}', { bedingung: g.text })}
                className={`absolute rounded-lg border-2 bg-white px-2 py-1 text-[11px] leading-snug transition ${
                  wirkung ? 'border-amber-500 bg-amber-50' : tot ? 'border-dashed border-red-400 bg-red-50' : 'border-slate-400'}`}
                style={{ left: gg.x, top: gg.y, width: gg.b, minHeight: gg.h, opacity: dimm(g.id) }}>
                <div className="mb-0.5 flex items-center gap-1">
                  <span className={`rounded px-1.5 text-[9px] font-bold tracking-wide text-white ${wirkung ? 'bg-amber-600' : 'bg-slate-600'}`}>
                    {wirkung ? `⚡ ${g.verknuepfung === 'einzel' ? t('WENN') : VERKNUEPFUNG[g.verknuepfung]}` : VERKNUEPFUNG[g.verknuepfung]}
                  </span>
                  {g.ziel.length > 1 && <span className="text-[10px] text-slate-500">{t('für {anzahl} Punkte', { anzahl: g.ziel.length })}</span>}
                </div>
                {g.eingaenge.length === 0 ? <div className="text-slate-500">{g.text}</div> : g.eingaenge.map((e, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <span className="mt-1 inline-block size-2 shrink-0 rounded-full" style={{ backgroundColor: wirkung ? WIRKUNG : farbeVon(e.von, e.zweig) }} />
                    <span>{e.text}</span>
                  </div>
                ))}
                {wirkung && <div className="mt-0.5 font-semibold" style={{ color: WIRKUNG }}>→ {g.folgen}</div>}
              </div>
            )
          })}

          {ablauf.knoten.map((k) => {
            const p = k.punkt
            const n = geo.knotenGeo(p.id)
            const tot = unerreichbar.has(p.id)
            return (
              <button key={p.id} type="button" disabled={!onOeffnen}
                onClick={() => onOeffnen?.(p)} onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(p.id)} onBlur={() => setHover(null)}
                title={[p.text, p.hinweis, tot ? t('Wird nie angezeigt') : ''].filter(Boolean).join('\n')}
                className={`absolute flex flex-col justify-center rounded-md border-2 bg-white px-2 text-left text-xs leading-tight transition ${
                  tot ? 'border-dashed border-red-400 bg-red-50' : 'border-slate-300'} ${fokus?.has(p.id) && hover === p.id ? 'ring-2 ring-sky-300' : ''} ${onOeffnen ? 'cursor-pointer hover:border-slate-500' : 'cursor-default'}`}
                style={{ left: n.x, top: n.y, width: KNOTEN_B, height: KNOTEN_H, opacity: dimm(p.id) }}>
                <span className="line-clamp-2 font-medium">
                  <span className="mr-1 text-slate-400">{k.nr}</span>{p.text}
                </span>
                <span className="mt-0.5 text-[10px] text-slate-500">{PUNKT_TYPEN[p.typ]}{p.pflicht && t(' · Pflicht')}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

