import { createContext, useContext, useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, KeyboardSensor, MeasuringStrategy, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
  type Announcements, type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { ChevronDown, ChevronRight, GitFork, GripVertical } from 'lucide-react'
import { alleBezuege, bedingungsText, PUNKT_TYPEN, STUFEN, wirkungText, zweigeVon, type Punkt } from '../lib/checkliste'
import {
  baue, flach, tauschen, unterbaumIds, verschiebe, verschiebeAbschnitt, zweigWert, type Knoten, type BaumAbschnitt, type Stand, type Ziel,
} from '../lib/checklisteBaum'
import { t } from '../lib/sprache'
import { Badge } from './ui'
import { zweigFarbe } from './zweigFarbe'

type Zieht = { art: 'punkt'; id: string; unter: Set<string> } | { art: 'abschnitt'; name: string }
type Ablage = { art: 'punkt'; ziel: Ziel } | { art: 'abschnitt'; vor: string | null }

interface Kontext {
  punkte: Punkt[]
  editierbar: boolean
  zieht: Zieht | null
  markiert: Set<string>
  nummer: Map<Punkt, number>
  offen: Set<string>
  eingeklappt: Set<string>
  setHover: (id: string | null) => void
  umschaltenOffen: (id: string) => void
  umschaltenEingeklappt: (name: string) => void
  bearbeiten: (p: Punkt) => void
  loeschen: (p: Punkt) => void
  neuUnter: (eltern: Punkt, wert: string) => void
  neuIn: (abschnitt: string) => void
  tauschen: (id: string, richtung: -1 | 1) => void
}

const Ctx = createContext<Kontext>(null as never)

/** Nächstgelegene Ablage zum Mauszeiger; bei Gleichstand gewinnt die Ebene, deren Einrückung links vom Zeiger liegt. */
const naechsteAblage: CollisionDetection = ({ droppableContainers, droppableRects, pointerCoordinates, collisionRect }) => {
  const pt = pointerCoordinates ?? { x: collisionRect.left + collisionRect.width / 2, y: collisionRect.top + collisionRect.height / 2 }
  const kandidaten: { id: string | number; d: number; links: number }[] = []
  for (const c of droppableContainers) {
    const r = c.disabled ? undefined : droppableRects.get(c.id)
    if (!r) continue
    const d = Math.hypot(Math.max(r.left - pt.x, 0, pt.x - r.right), Math.max(r.top - pt.y, 0, pt.y - r.bottom))
    if (d <= 80) kandidaten.push({ id: c.id, d, links: r.left })
  }
  if (kandidaten.length === 0) return []
  const minD = Math.min(...kandidaten.map((k) => k.d))
  const nah = kandidaten.filter((k) => k.d <= minD + 8)
  const links = nah.filter((k) => k.links <= pt.x + 4)
  const wahl = links.length
    ? links.reduce((a, b) => (b.links > a.links || (b.links === a.links && b.d < a.d) ? b : a))
    : nah.reduce((a, b) => (b.links < a.links ? b : a))
  return [{ id: wahl.id }]
}

const hinweise: Announcements = {
  onDragStart: () => t('Aufgenommen.'),
  onDragOver: ({ over }) => (over ? t('Ablageort gewechselt.') : t('Kein Ablageort.')),
  onDragEnd: ({ over }) => (over ? t('Abgelegt.') : t('Nicht abgelegt.')),
  onDragCancel: () => t('Abgebrochen.'),
}

export function ChecklisteBaum({ stand, editierbar, onAendern, onBearbeiten, onLoeschen, onNeuUnter, onNeuIn, onFehler }: {
  stand: Stand
  editierbar: boolean
  onAendern: (neu: Stand) => void
  onBearbeiten: (p: Punkt) => void
  onLoeschen: (p: Punkt) => void
  onNeuUnter: (eltern: Punkt, zweig: string) => void
  onNeuIn: (abschnitt: string) => void
  onFehler: (text: string) => void
}) {
  const { punkte, abschnitte } = stand
  const [zieht, setZieht] = useState<Zieht | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [offen, setOffen] = useState<Set<string>>(new Set())
  const [eingeklappt, setEingeklappt] = useState<Set<string>>(new Set())

  const sensoren = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  )
  const baum = useMemo(() => baue(punkte, abschnitte), [punkte, abschnitte])
  const nummer = useMemo(() => new Map(flach(baum).map((p, i) => [p, i + 1])), [baum])
  const markiert = useMemo(() => {
    const m = new Set<string>()
    if (!hover || zieht) return m
    m.add(hover)
    const eigener = punkte.find((p) => p.id === hover)
    if (eigener) alleBezuege(eigener).forEach((id) => m.add(id))
    for (const p of punkte) if (alleBezuege(p).includes(hover)) m.add(p.id)
    return m
  }, [hover, zieht, punkte])

  const umschalten = (set: Set<string>, wert: string) => {
    const neu = new Set(set)
    if (!neu.delete(wert)) neu.add(wert)
    return neu
  }

  const kontext: Kontext = {
    punkte, editierbar, zieht, markiert, nummer, offen, eingeklappt,
    setHover,
    umschaltenOffen: (id) => setOffen((o) => umschalten(o, id)),
    umschaltenEingeklappt: (name) => setEingeklappt((o) => umschalten(o, name)),
    bearbeiten: onBearbeiten,
    loeschen: onLoeschen,
    neuUnter: (eltern, wert) => onNeuUnter(eltern, wert),
    neuIn: onNeuIn,
    tauschen: (id, richtung) => {
      const neu = tauschen(punkte, id, richtung, abschnitte)
      if (neu) onAendern({ punkte: neu, abschnitte })
    },
  }

  const start = (e: DragStartEvent) => {
    const d = e.active.data.current as { art: 'punkt'; id: string } | { art: 'abschnitt'; name: string } | undefined
    if (d?.art === 'punkt') setZieht({ art: 'punkt', id: d.id, unter: unterbaumIds(punkte, d.id) })
    else if (d?.art === 'abschnitt') setZieht({ art: 'abschnitt', name: d.name })
  }

  const ende = (e: DragEndEvent) => {
    const quelle = zieht
    setZieht(null)
    const ablage = e.over?.data.current as Ablage | undefined
    if (!quelle || !ablage || quelle.art !== ablage.art) return
    if (quelle.art === 'punkt' && ablage.art === 'punkt') {
      const ergebnis = verschiebe(punkte, quelle.id, ablage.ziel, abschnitte)
      if ('fehler' in ergebnis) onFehler(ergebnis.fehler)
      else if (ergebnis.punkte !== punkte) onAendern({ punkte: ergebnis.punkte, abschnitte })
    } else if (quelle.art === 'abschnitt' && ablage.art === 'abschnitt') {
      const ergebnis = verschiebeAbschnitt(stand, quelle.name, ablage.vor)
      if ('fehler' in ergebnis) onFehler(ergebnis.fehler)
      else if (ergebnis !== stand) onAendern(ergebnis)
    }
  }

  const gezogen = zieht?.art === 'punkt' ? punkte.find((p) => p.id === zieht.id) : undefined

  return (
    <Ctx.Provider value={kontext}>
      <DndContext
        sensors={sensoren}
        collisionDetection={naechsteAblage}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={start}
        onDragEnd={ende}
        onDragCancel={() => setZieht(null)}
        accessibility={{
          announcements: hinweise,
          screenReaderInstructions: { draggable: t('Zum Verschieben Leertaste drücken, mit den Pfeiltasten bewegen, mit der Leertaste ablegen, mit Escape abbrechen.') },
        }}
      >
        <div className="space-y-4">
          {baum.map((a) => <AbschnittKarte key={a.name} a={a} />)}
          {editierbar && <AbschnittLuecke vor={null} />}
        </div>
        <DragOverlay dropAnimation={null}>
          {gezogen && zieht?.art === 'punkt' && (
            <div className="max-w-md rounded-md border border-sky-400 bg-white px-3 py-2 text-sm shadow-lg">
              {gezogen.text}
              {zieht.unter.size > 1 && <span className="ml-2 text-xs text-slate-500">{t('+ {anzahl} Unterpunkt(e)', { anzahl: zieht.unter.size - 1 })}</span>}
            </div>
          )}
          {zieht?.art === 'abschnitt' && (
            <div className="rounded-md border border-sky-400 bg-white px-3 py-2 text-sm font-semibold shadow-lg">{zieht.name}</div>
          )}
        </DragOverlay>
      </DndContext>
    </Ctx.Provider>
  )
}

/** Unsichtbare Ablagefläche auf der Grenze zwischen zwei Einträgen; zeigt beim Ziehen eine Linie. */
function Luecke({ ablage, gesperrt, hoehe = 'h-5' }: { ablage: Ablage; gesperrt?: boolean; hoehe?: string }) {
  const { zieht } = useContext(Ctx)
  const aktiv = zieht?.art === ablage.art && !gesperrt
  const { setNodeRef, isOver } = useDroppable({ id: JSON.stringify(ablage), data: ablage, disabled: !aktiv })
  if (!aktiv) return null
  return (
    <div className="relative z-10 h-0">
      <div ref={setNodeRef} className={`absolute inset-x-0 top-1/2 ${hoehe} -translate-y-1/2`}>
        <div className={`absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full transition-all ${isOver ? 'h-1 bg-sky-500' : 'h-px bg-sky-200'}`} />
      </div>
    </div>
  )
}

/** Große, sichtbare Ablagefläche für einen noch leeren Zweig. */
function LeererZweig({ ziel }: { ziel: Ziel }) {
  const ablage: Ablage = { art: 'punkt', ziel }
  const { setNodeRef, isOver } = useDroppable({ id: JSON.stringify(ablage), data: ablage })
  return (
    <div ref={setNodeRef}
      className={`rounded-md border-2 border-dashed px-3 py-2 text-center text-xs transition ${isOver ? 'border-sky-500 bg-sky-50 text-sky-800' : 'border-slate-300 text-slate-500'}`}>
      {t('Hier ablegen')}
    </div>
  )
}

function AbschnittLuecke({ vor }: { vor: string | null }) {
  return <Luecke ablage={{ art: 'abschnitt', vor }} hoehe="h-8" />
}

function AbschnittKarte({ a }: { a: BaumAbschnitt }) {
  const k = useContext(Ctx)
  const { attributes, listeners, setNodeRef, setActivatorNodeRef } = useDraggable({
    id: `abschnitt:${a.name}`, data: { art: 'abschnitt', name: a.name }, disabled: !k.editierbar,
  })
  const zugeklappt = k.zieht?.art === 'abschnitt' || k.eingeklappt.has(a.name)
  const anzahl = flach([a]).length
  const wirdGezogen = k.zieht?.art === 'abschnitt' && k.zieht.name === a.name
  return (
    <div className="relative">
      {k.editierbar && (
        <div className="absolute inset-x-0 -top-4"><AbschnittLuecke vor={a.name} /></div>
      )}
      <section ref={setNodeRef} className={`karte ${wirdGezogen ? 'opacity-40' : ''}`}>
        <div className="flex items-center gap-1 border-b border-slate-100 px-2 py-2">
          {k.editierbar && (
            <button ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={t('Abschnitt „{name}“ verschieben', { name: a.name })}
              className="touch-none cursor-grab rounded p-1 text-slate-400 hover:text-slate-700 active:cursor-grabbing">
              <GripVertical className="size-4" aria-hidden />
            </button>
          )}
          <button type="button" onClick={() => k.umschaltenEingeklappt(a.name)} aria-expanded={!zugeklappt}
            className="flex min-w-0 flex-1 items-center gap-1 text-left font-semibold">
            {zugeklappt ? <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden /> : <ChevronDown className="size-4 shrink-0 text-slate-400" aria-hidden />}
            <h3 className="truncate">{a.name}</h3>
            <span className="ml-1 text-xs font-normal text-slate-500">{anzahl === 1 ? t('1 Punkt') : t('{anzahl} Punkte', { anzahl })}</span>
          </button>
          {k.editierbar && (
            <button type="button" className="shrink-0 px-1 text-sm link" aria-label={t('Punkt in „{name}“ anlegen', { name: a.name })} onClick={() => k.neuIn(a.name)}>
              {t('+ Punkt')}
            </button>
          )}
        </div>
        {!zugeklappt && (
          <div className="p-2">
            {a.wurzeln.length > 0 ? <Liste knoten={a.wurzeln} abschnitt={a.name} gesperrt={false} />
              : k.zieht?.art === 'punkt' ? <LeererZweig ziel={{ abschnitt: a.name, vor: null }} />
                : <p className="px-2 py-1 text-sm text-slate-500">{t('Noch keine Prüfpunkte in diesem Abschnitt.')}</p>}
          </div>
        )}
      </section>
    </div>
  )
}

/** Geschwisterliste: Punkte mit Ablageflächen davor und am Ende. */
function Liste({ knoten, abschnitt, gesperrt }: { knoten: Knoten[]; abschnitt: string; gesperrt: boolean }) {
  return (
    <>
      {knoten.map((n, i) => (
        <div key={n.punkt.id}>
          <Luecke ablage={{ art: 'punkt', ziel: { abschnitt, vor: n.punkt.id } }} gesperrt={gesperrt} />
          <PunktZeile k={n} abschnitt={abschnitt} wurzel gesperrt={gesperrt} erster={i === 0} letzter={i === knoten.length - 1} />
        </div>
      ))}
      <Luecke ablage={{ art: 'punkt', ziel: { abschnitt, vor: null } }} gesperrt={gesperrt} />
    </>
  )
}

function PunktZeile({ k, abschnitt, wurzel, gesperrt, erster, letzter }: {
  k: Knoten
  abschnitt: string
  wurzel: boolean
  gesperrt: boolean
  erster: boolean
  letzter: boolean
}) {
  const c = useContext(Ctx)
  const p = k.punkt
  const { attributes, listeners, setNodeRef, setActivatorNodeRef } = useDraggable({
    id: `punkt:${p.id}`, data: { art: 'punkt', id: p.id }, disabled: !c.editierbar,
  })
  const wirdGezogen = c.zieht?.art === 'punkt' && c.zieht.id === p.id
  const verzweigbar = zweigeVon(p).length > 0
  return (
    <div className={wirdGezogen ? 'opacity-40' : ''}>
      <div ref={setNodeRef}
        onMouseEnter={() => c.setHover(p.id)} onMouseLeave={() => c.setHover(null)}
        className={`flex gap-1 rounded-md px-1 py-1.5 transition ${c.markiert.has(p.id) ? 'bg-sky-50 ring-2 ring-sky-200' : 'hover:bg-slate-50'}`}>
        {c.editierbar && (
          <button ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={t('„{text}“ verschieben', { text: p.text })}
            className="h-fit touch-none cursor-grab rounded p-1 text-slate-400 hover:text-slate-700 active:cursor-grabbing">
            <GripVertical className="size-4" aria-hidden />
          </button>
        )}
        <span className="w-6 shrink-0 pt-0.5 text-right text-sm text-slate-400">{c.nummer.get(p)}</span>
        <div className="min-w-0 flex-1 pl-1">
          <div>{p.text}</div>
          <div className="mt-1 flex flex-wrap gap-1 text-xs">
            <Badge>{PUNKT_TYPEN[p.typ]}{p.typ === 'messwert' && ` ${p.soll_min ?? ''}–${p.soll_max ?? ''} ${p.einheit ?? ''}`}</Badge>
            {p.pflicht && <Badge farbe="blau">{t('Pflicht')}</Badge>}
            {p.foto_bei_nok && <Badge>{t('📷 bei Mangel')}</Badge>}
            {p.vorschlag_stufe && <Badge farbe={p.vorschlag_stufe === 3 ? 'rot' : 'gelb'}>{t('Stufe {stufe}', { stufe: p.vorschlag_stufe })} {STUFEN[p.vorschlag_stufe]}</Badge>}
            {p.verifizieren && <Badge farbe="rot">{t('⚠️ Grenzwert bestätigen')}</Badge>}
            {/* Unterpunkte zeigen ihre Bedingung über den Zweig; nur Bezüge auf andere Abschnitte brauchen ein Badge */}
            {wurzel && p.nur_wenn && <Badge farbe="blau">{t('↳ nur wenn {bedingung}', { bedingung: bedingungsText(p.nur_wenn, c.punkte) })}</Badge>}
            {p.wirkungen?.map((w, i) => <Badge key={i} farbe="gelb">⚡ {wirkungText(w, p, c.punkte)}</Badge>)}
          </div>
          {p.hinweis && <div className="mt-1 text-xs text-slate-500">{p.hinweis}</div>}
        </div>
        {c.editierbar && (
          <div className="flex shrink-0 items-start gap-1 text-slate-500">
            {verzweigbar && (
              <button type="button" aria-pressed={c.offen.has(p.id)} title={t('Zweige anzeigen und Unterpunkt anlegen')}
                className={`flex items-center gap-1 rounded px-1 hover:text-slate-900 ${c.offen.has(p.id) ? 'bg-sky-100 text-sky-800' : ''}`}
                onClick={() => c.umschaltenOffen(p.id)}>
                <GitFork className="size-3.5" aria-hidden /><span className="text-sm">{t('Zweige')}</span>
              </button>
            )}
            <button aria-label={t('nach oben')} className="px-1 hover:text-slate-900 disabled:opacity-30" disabled={erster} onClick={() => c.tauschen(p.id, -1)}>▲</button>
            <button aria-label={t('nach unten')} className="px-1 hover:text-slate-900 disabled:opacity-30" disabled={letzter} onClick={() => c.tauschen(p.id, 1)}>▼</button>
            <button className="px-1 link" onClick={() => c.bearbeiten(p)}>{t('Bearbeiten')}</button>
            <button aria-label={t('löschen')} className="px-1 text-red-600" onClick={() => c.loeschen(p)}>✕</button>
          </div>
        )}
      </div>
      <Zweige k={k} abschnitt={abschnitt} gesperrt={gesperrt || wirdGezogen} />
    </div>
  )
}

/** Die Zweige eines Ja/Nein- oder Auswahl-Punkts mit ihren Unterpunkten. */
function Zweige({ k, abschnitt, gesperrt }: { k: Knoten; abschnitt: string; gesperrt: boolean }) {
  const c = useContext(Ctx)
  const p = k.punkt
  const zweigDefs = zweigeVon(p)
  const zweige: { wert: string | null; label: string; kinder: Knoten[] }[] = zweigDefs.map((z) => ({
    wert: z.schluessel, label: z.label, kinder: k.kinder.filter((x) => zweigWert(x.punkt, p) === z.schluessel),
  }))
  const andere = k.kinder.filter((x) => zweigWert(x.punkt, p) === null)
  if (andere.length) zweige.push({ wert: null, label: '', kinder: andere })

  // Beim Ziehen zeigen alle Verzweigungen auch ihre leeren Zweige als Ablageflächen
  const ziehtPunkt = c.zieht?.art === 'punkt' && !c.zieht.unter.has(p.id)
  const gezogenId = c.zieht?.art === 'punkt' ? c.zieht.id : undefined
  const alleZeigen = c.editierbar && (ziehtPunkt || c.offen.has(p.id))

  return (
    <>
      {zweige.map((z) => {
        if (z.kinder.length === 0 && !alleZeigen) return null
        const farbe = zweigFarbe(p, z.wert)
        const eltern = { id: p.id, wert: z.wert }
        // Sonderfall-Zweige („ist eines von“) sind nur zum Umsortieren der bereits dort liegenden Punkte da
        const zweigGesperrt = gesperrt || (z.wert === null && !z.kinder.some((x) => x.punkt.id === gezogenId))
        return (
          <div key={z.wert ?? '*andere'} className="relative mb-1 ml-5 mt-0.5 rounded-bl-lg border-l-[3px] py-1 pl-4 pr-1"
            style={{ borderColor: farbe, backgroundColor: `color-mix(in srgb, ${farbe} 6%, transparent)` }}>
            <span aria-hidden className="absolute left-0 top-[15px] h-[3px] w-3" style={{ backgroundColor: farbe }} />
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded-full px-2 py-0.5 text-xs font-semibold text-white" style={{ backgroundColor: farbe }}>
                {t('wenn {bedingung}', { bedingung: z.wert === null ? bedingungsText(z.kinder[0].punkt.nur_wenn!, c.punkte, p.id) : z.label })}
              </span>
              {c.editierbar && z.wert !== null && (
                <button type="button" className="text-xs link" onClick={() => c.neuUnter(p, z.wert!)}>{t('+ Unterpunkt')}</button>
              )}
            </div>
            {z.kinder.length === 0
              ? !gesperrt && <LeererZweig ziel={{ abschnitt, eltern, vor: null }} />
              : (
                <>
                  {z.kinder.map((kind, i) => (
                    <div key={kind.punkt.id}>
                      <Luecke ablage={{ art: 'punkt', ziel: { abschnitt, eltern, vor: kind.punkt.id } }} gesperrt={zweigGesperrt} />
                      <PunktZeile k={kind} abschnitt={abschnitt} wurzel={false} gesperrt={gesperrt}
                        erster={i === 0} letzter={i === z.kinder.length - 1} />
                    </div>
                  ))}
                  <Luecke ablage={{ art: 'punkt', ziel: { abschnitt, eltern, vor: null } }} gesperrt={zweigGesperrt} />
                </>
              )}
          </div>
        )
      })}
    </>
  )
}
