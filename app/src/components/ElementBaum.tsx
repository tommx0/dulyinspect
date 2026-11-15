// Baumdiagramm der Elemente einer Anlage: Anlage → Gruppen (Meldergruppen / Linien, Stromkreise …) → Elemente (Melder …).
// Schnell erfassen: Art wählen, bei einer Gruppe auf „+“ tippen (oder Taste N) – die Nummern zählen von selbst hoch.
// Elemente lassen sich per Ziehen in eine andere Gruppe verschieben und mit Entf entfernen; jede Änderung lässt sich
// rückgängig machen. Logik: src/lib/elementBaum.ts.
import { createElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import {
  DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors,
  type Announcements, type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Pencil, Plus, Trash2, Undo2, X } from 'lucide-react'
import type { ElementDefinition } from '../lib/anlagenarten'
import { baumAeste, naechsterGruppenName, nummerBeimVerschieben, nummernZumAnhaengen, type Ast } from '../lib/elementBaum'
import { nummernText, schreibweiseAngleichen } from '../lib/elemente'
import { demoKnopf } from '../lib/demo'
import { t } from '../lib/sprache'
import { fehlertext, supabase, type Zeile } from '../lib/supabase'
import { elementFamilie, elementSymbol, OHNE_SYMBOL } from './elementSymbole'
import { ArtSymbol } from './Symbole'
import { datum } from './ui'

type Element = Zeile<'anlage_element'>
type Gruppe = Zeile<'anlage_gruppe'>
type Auswahl = { art: 'element'; id: string } | { art: 'gruppe'; name: string | null } | null
type Aenderung = { nummer?: string; ort?: string | null; elementart?: string | null }
type Aktion = { text: string; rueckgaengig?: () => Promise<unknown> }

// Farben je Art des Elements (Reihenfolge der Arten der Anlagenart): Ring, Fläche beim Auswählen, Punkt in der Legende
// Reihenfolge = Farbfamilien in elementSymbole.ts (Rauch, Wärme, Gas, Multi, Hand, Alarmierung, Steuerung, Löschanlage, Bewegung, Öffnung, Durchbruch)
const FARBEN = [
  { ring: 'border-red-500 text-red-800', voll: 'bg-red-500', hell: 'bg-red-50' },
  { ring: 'border-orange-500 text-orange-800', voll: 'bg-orange-500', hell: 'bg-orange-50' },
  { ring: 'border-amber-500 text-amber-800', voll: 'bg-amber-500', hell: 'bg-amber-50' },
  { ring: 'border-violet-500 text-violet-800', voll: 'bg-violet-500', hell: 'bg-violet-50' },
  { ring: 'border-sky-500 text-sky-800', voll: 'bg-sky-500', hell: 'bg-sky-50' },
  { ring: 'border-pink-500 text-pink-800', voll: 'bg-pink-500', hell: 'bg-pink-50' },
  { ring: 'border-slate-500 text-slate-800', voll: 'bg-slate-500', hell: 'bg-slate-100' },
  { ring: 'border-emerald-500 text-emerald-800', voll: 'bg-emerald-500', hell: 'bg-emerald-50' },
  { ring: 'border-indigo-500 text-indigo-800', voll: 'bg-indigo-500', hell: 'bg-indigo-50' },
  { ring: 'border-teal-500 text-teal-800', voll: 'bg-teal-500', hell: 'bg-teal-50' },
  { ring: 'border-amber-800 text-amber-900', voll: 'bg-amber-800', hell: 'bg-amber-50' },
]
const OHNE_ART = { ring: 'border-slate-400 text-slate-700', voll: 'bg-slate-400', hell: 'bg-slate-50' }
const ANZAHLEN = [1, 2, 5, 10]
const OHNE = '\u0000ohne'
const astSchluessel = (name: string | null) => name ?? OHNE

/** Ablage unter dem Zeiger; mit der Tastatur (ohne Zeiger) die überlappende Zeile. */
const zeigerOderFlaeche: CollisionDetection = (a) => (a.pointerCoordinates ? pointerWithin(a) : rectIntersection(a))

const hinweise: Announcements = {
  onDragStart: () => t('Aufgenommen.'),
  onDragOver: ({ over }) => (over ? t('Ablageort gewechselt.') : t('Kein Ablageort.')),
  onDragEnd: ({ over }) => (over ? t('Abgelegt.') : t('Nicht abgelegt.')),
  onDragCancel: () => t('Abgebrochen.'),
}

export function ElementBaum({ def, anlageId, anlagenart, titel, elemente, gruppen, mangelJe, stillgelegte, istAdmin, onBearbeiten, onGeaendert }: {
  def: ElementDefinition
  anlageId: string
  anlagenart: string | null | undefined
  /** Beschriftung der Wurzel, z. B. „BMA-01 · Hauptgebäude“ */
  titel: string
  elemente: Element[]
  gruppen: Gruppe[]
  mangelJe: Map<string, { stufe: number; status: string; beschreibung: string }>
  stillgelegte: boolean
  istAdmin: boolean
  /** Alle Felder im Dialog der Seite bearbeiten */
  onBearbeiten: (e: Element) => void
  /** Nach jeder Änderung: Elemente und Gruppen neu laden */
  onGeaendert: () => void
}) {
  const einzahl = t(def.einzahl)
  const mehrzahl = t(def.mehrzahl)
  const gruppeName = t(def.gruppe)
  const gruppenMehrzahl = t(def.gruppeMehrzahl)
  const gesperrt = !!demoKnopf().disabled

  const [auswahl, setAuswahl] = useState<Auswahl>(null)
  const [eingeklappt, setEingeklappt] = useState<Set<string>>(new Set())
  const [art, setArt] = useState<string | null>(() => {
    const gemerkt = localStorage.getItem(`elementBaum.art.${anlagenart}`)
    return def.arten.some((a) => a.schluessel === gemerkt) ? gemerkt : def.arten[0]?.schluessel ?? null
  })
  const [anzahl, setAnzahl] = useState(1)
  const [aktion, setAktion] = useState<Aktion | null>(null)
  const [fehler, setFehler] = useState('')
  const [beschaeftigt, setBeschaeftigt] = useState(false)
  const [zieht, setZieht] = useState<Element | null>(null)
  const [umbenennen, setUmbenennen] = useState<string | null>(null)
  const baumRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (art) localStorage.setItem(`elementBaum.art.${anlagenart}`, art) }, [art, anlagenart])
  // Hinweis „… entfernt · Rückgängig“ verschwindet nach einer Weile
  useEffect(() => {
    if (!aktion) return
    const z = setTimeout(() => setAktion(null), aktion.rueckgaengig ? 10000 : 4000)
    return () => clearTimeout(z)
  }, [aktion])

  const aeste = useMemo(() => baumAeste(gruppen.map((g) => g.name), elemente, stillgelegte), [gruppen, elemente, stillgelegte])
  const aktive = useMemo(() => elemente.filter((e) => e.aktiv), [elemente])
  const artIndex = useMemo(() => new Map(def.arten.map((a, i) => [a.schluessel, i])), [def.arten])
  const farbe = (schluessel: string | null) => {
    const familie = elementFamilie(schluessel)
    if (familie !== null) return FARBEN[familie]
    return schluessel != null && artIndex.has(schluessel) ? FARBEN[artIndex.get(schluessel)! % FARBEN.length] : OHNE_ART
  }
  const artName = (schluessel: string | null) => t(def.arten.find((a) => a.schluessel === schluessel)?.name ?? '–')
  const astText = (name: string | null) => (name === null ? t('ohne {gruppe}', { gruppe: gruppeName }) : `${gruppeName} ${name}`)
  const elementText = (e: Pick<Element, 'nummer' | 'gruppe'>) => `${einzahl} ${e.nummer}${e.gruppe ? ` · ${gruppeName} ${e.gruppe}` : ''}`
  const gewaehlt = auswahl?.art === 'element' ? elemente.find((e) => e.id === auswahl.id) ?? null : null
  const gewaehlterAst = auswahl?.art === 'gruppe' ? auswahl.name : gewaehlt ? gewaehlt.gruppe ?? null : undefined
  const darfAnhaengen = (name: string | null) => !(name === null && def.nummerMitGruppe)

  // Jede Änderung: Fehler zurücksetzen, ausführen, neu laden; der Text erscheint unten mit „Rückgängig“
  const ausfuehren = useCallback(async (f: () => Promise<Aktion | string | void>) => {
    if (beschaeftigt || gesperrt) return
    setBeschaeftigt(true)
    setFehler('')
    try {
      const ergebnis = await f()
      if (typeof ergebnis === 'string') setFehler(ergebnis)
      else if (ergebnis) setAktion(ergebnis)
    } catch (e) {
      setFehler(fehlertext(e))
    } finally {
      setBeschaeftigt(false)
      onGeaendert()
    }
  }, [beschaeftigt, gesperrt, onGeaendert])

  const rueckgaengig = () => {
    const a = aktion
    if (!a?.rueckgaengig) return
    setAktion(null)
    void ausfuehren(async () => {
      await a.rueckgaengig!()
      return { text: t('Rückgängig gemacht.') }
    })
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Elemente
  // ---------------------------------------------------------------------------------------------------------------
  const hinzufuegen = (gruppe: string | null, n = anzahl) => ausfuehren(async () => {
    const nummern = nummernZumAnhaengen(aktive, gruppe, n)
    const typ = def.typ?.optionen[0] ?? null
    const { data, error } = await supabase.from('anlage_element')
      .insert(nummern.map((nummer) => ({ anlage_id: anlageId, gruppe, nummer, elementart: art, typ, eigenschaften: {} })))
      .select('id')
    if (error) return error.code === '23505' ? t('Eine der Nummern wurde inzwischen vergeben. Bitte erneut versuchen.') : fehlertext(error)
    const ids = (data ?? []).map((d) => d.id)
    if (ids.length) setAuswahl({ art: 'element', id: ids[ids.length - 1] })
    return {
      text: t('{elemente} {nummern} hinzugefügt ({gruppe}).', { elemente: ids.length === 1 ? einzahl : mehrzahl, nummern: nummernText(nummern), gruppe: astText(gruppe) }),
      rueckgaengig: async () => { const r = await supabase.from('anlage_element').delete().in('id', ids); if (r.error) throw r.error },
    }
  })

  const entfernen = (e: Element) => ausfuehren(async () => {
    // Der Knoten verschwindet gleich: Fokus auf den Baum, damit Entf und N danach weiter wirken
    if (baumRef.current?.contains(document.activeElement)) baumRef.current.focus({ preventScroll: true })
    // Nachbar auswählen, damit Entf mehrmals hintereinander funktioniert
    const ast = aeste.find((a) => a.name === (e.gruppe ?? null))
    const i = ast?.elemente.findIndex((x) => x.id === e.id) ?? -1
    const nachbar = ast?.elemente[i + 1] ?? ast?.elemente[i - 1]
    if (!e.aktiv) return t('{element} ist schon stillgelegt.', { element: elementText(e) })
    const geloescht = istAdmin ? await supabase.from('anlage_element').delete().eq('id', e.id) : null
    setAuswahl(nachbar && nachbar.id !== e.id ? { art: 'element', id: nachbar.id } : { art: 'gruppe', name: e.gruppe ?? null })
    if (geloescht && !geloescht.error) {
      const { id, anlage_id, gruppe, nummer, elementart, ort, typ, code, eigenschaften, aktiv } = e
      return {
        text: t('{element} gelöscht.', { element: elementText(e) }),
        rueckgaengig: async () => {
          const r = await supabase.from('anlage_element').insert({ id, anlage_id, gruppe, nummer, elementart, ort, typ, code, eigenschaften, aktiv })
          if (r.error) throw r.error
        },
      }
    }
    // Schon geprüft (Ergebnisse verweisen darauf) oder kein Löschrecht: stilllegen, die Prüfgeschichte bleibt
    if (geloescht?.error && geloescht.error.code !== '23503') return fehlertext(geloescht.error)
    const { error } = await supabase.from('anlage_element').update({ aktiv: false }).eq('id', e.id)
    if (error) return fehlertext(error)
    return {
      text: t('{element} wurde schon geprüft und ist jetzt stillgelegt.', { element: elementText(e) }),
      rueckgaengig: async () => { const r = await supabase.from('anlage_element').update({ aktiv: true }).eq('id', e.id); if (r.error) throw r.error },
    }
  })

  const verschieben = (e: Element, ziel: string | null) => ausfuehren(async () => {
    if ((e.gruppe ?? null) === ziel) return
    const nummer = nummerBeimVerschieben(aktive, e, ziel)
    const { error } = await supabase.from('anlage_element').update({ gruppe: ziel, nummer }).eq('id', e.id)
    if (error) return error.code === '23505' ? t('{element} {nummer} gibt es in diesem {gruppe} schon.', { element: einzahl, nummer, gruppe: gruppeName }) : fehlertext(error)
    const alt = { gruppe: e.gruppe, nummer: e.nummer }
    return {
      text: t('{element} nach {ziel} verschoben{nummer}.', { element: elementText(e), ziel: astText(ziel), nummer: nummer !== e.nummer ? ` (${t('neue Nummer {nummer}', { nummer })})` : '' }),
      rueckgaengig: async () => { const r = await supabase.from('anlage_element').update(alt).eq('id', e.id); if (r.error) throw r.error },
    }
  })

  const aendern = (e: Element, feld: 'nummer' | 'ort' | 'elementart', wert: string) => {
    const neu = wert.trim() || null
    if (feld === 'nummer' && !neu) return
    if ((e[feld] ?? null) === neu) return
    void ausfuehren(async () => {
      const { error } = await supabase.from('anlage_element').update({ [feld]: neu } as Aenderung).eq('id', e.id)
      if (error) return error.code === '23505' ? t('{element} {nummer} gibt es in diesem {gruppe} schon.', { element: einzahl, nummer: neu ?? '', gruppe: gruppeName }) : fehlertext(error)
      const alt = e[feld]
      return {
        text: t('{element} gespeichert.', { element: elementText(feld === 'nummer' ? { ...e, nummer: neu! } : e) }),
        rueckgaengig: async () => { const r = await supabase.from('anlage_element').update({ [feld]: alt } as Aenderung).eq('id', e.id); if (r.error) throw r.error },
      }
    })
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Gruppen
  // ---------------------------------------------------------------------------------------------------------------
  const namen = aeste.map((a) => a.name).filter((n): n is string => n !== null)
  const gruppeAnlegen = (eingabe: string) => ausfuehren(async () => {
    const name = schreibweiseAngleichen(eingabe, namen)
    if (!name) return t('Bitte einen Namen angeben.')
    if (name.length > 40) return t('Höchstens 40 Zeichen.')
    if (namen.includes(name)) { setAuswahl({ art: 'gruppe', name }); return t('{gruppe} „{name}“ gibt es schon.', { gruppe: gruppeName, name }) }
    const { data, error } = await supabase.from('anlage_gruppe').insert({ anlage_id: anlageId, name }).select('id').single()
    if (error) return fehlertext(error)
    setAuswahl({ art: 'gruppe', name })
    return {
      text: t('{gruppe} „{name}“ angelegt.', { gruppe: gruppeName, name }),
      rueckgaengig: async () => { const r = await supabase.from('anlage_gruppe').delete().eq('id', data.id); if (r.error) throw r.error },
    }
  })

  const gruppeUmbenennen = (alt: string, eingabe: string) => {
    setUmbenennen(null)
    baumRef.current?.focus({ preventScroll: true })
    const name = eingabe.trim()
    if (!name || name === alt) return
    void ausfuehren(async () => {
      if (name.length > 40) return t('Höchstens 40 Zeichen.')
      const g = gruppen.find((x) => x.name === alt)
      if (!g) return t('{gruppe} „{name}“ gibt es nicht mehr.', { gruppe: gruppeName, name: alt })
      const { error } = await supabase.from('anlage_gruppe').update({ name }).eq('id', g.id)
      if (error) return error.code === '23505' ? t('{gruppe} „{name}“ gibt es schon.', { gruppe: gruppeName, name }) : fehlertext(error)
      setAuswahl({ art: 'gruppe', name })
      return {
        text: t('{gruppe} „{alt}“ heißt jetzt „{name}“.', { gruppe: gruppeName, alt, name }),
        rueckgaengig: async () => { const r = await supabase.from('anlage_gruppe').update({ name: alt }).eq('id', g.id); if (r.error) throw r.error },
      }
    })
  }

  const gruppeLoeschen = (name: string) => ausfuehren(async () => {
    const g = gruppen.find((x) => x.name === name)
    if (!g) return
    const { error } = await supabase.from('anlage_gruppe').delete().eq('id', g.id)
    if (error) return error.code === '23503' ? t('Löschen lässt sich {gruppe} erst, wenn keine aktiven {elemente} mehr darin sind.', { gruppe: gruppeName, elemente: mehrzahl }) : fehlertext(error)
    setAuswahl(null)
    return {
      text: t('{gruppe} „{name}“ gelöscht.', { gruppe: gruppeName, name }),
      rueckgaengig: async () => { const r = await supabase.from('anlage_gruppe').insert({ anlage_id: anlageId, name, gebaeude: g.gebaeude, etage: g.etage }); if (r.error) throw r.error },
    }
  })

  // ---------------------------------------------------------------------------------------------------------------
  // Tastatur: Pfeile wandern, N fügt hinzu, Entf entfernt, F2 benennt um, Ziffern wählen die Art
  // ---------------------------------------------------------------------------------------------------------------
  const tasten = (ev: ReactKeyboardEvent) => {
    const ziel = ev.target as HTMLElement
    if (ziel.closest('input, select, textarea') || ev.metaKey || ev.ctrlKey || ev.altKey) return
    const sichtbare = aeste.filter((a) => !eingeklappt.has(astSchluessel(a.name)))
    const astIndex = aeste.findIndex((a) => a.name === gewaehlterAst)
    const ast = astIndex >= 0 ? aeste[astIndex] : undefined
    const k = ev.key
    if (/^[1-9]$/.test(k) && def.arten[Number(k) - 1]) { setArt(def.arten[Number(k) - 1].schluessel); ev.preventDefault(); return }
    if (k === 'Escape') { setAuswahl(null); return }
    if ((k === 'n' || k === 'N' || k === '+') && gewaehlterAst !== undefined && darfAnhaengen(gewaehlterAst)) {
      ev.preventDefault(); void hinzufuegen(gewaehlterAst); return
    }
    if ((k === 'Delete' || k === 'Backspace') && gewaehlt) { ev.preventDefault(); void entfernen(gewaehlt); return }
    if (k === 'F2' && auswahl?.art === 'gruppe' && auswahl.name !== null) { ev.preventDefault(); setUmbenennen(auswahl.name); return }
    if (k === 'Enter' && gewaehlt) { ev.preventDefault(); onBearbeiten(gewaehlt); return }
    if (k === 'ArrowRight' || k === 'ArrowLeft') {
      ev.preventDefault()
      if (!ast) return
      const liste = ast.elemente
      if (auswahl?.art === 'gruppe') {
        if (k === 'ArrowRight' && liste.length) { setEingeklappt((s) => { const n = new Set(s); n.delete(astSchluessel(ast.name)); return n }); setAuswahl({ art: 'element', id: liste[0].id }) }
        return
      }
      const i = liste.findIndex((e) => e.id === gewaehlt?.id)
      const j = i + (k === 'ArrowRight' ? 1 : -1)
      setAuswahl(j < 0 ? { art: 'gruppe', name: ast.name } : liste[j] ? { art: 'element', id: liste[j].id } : auswahl)
      return
    }
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      ev.preventDefault()
      if (!sichtbare.length && !aeste.length) return
      if (!ast) { setAuswahl({ art: 'gruppe', name: aeste[k === 'ArrowDown' ? 0 : aeste.length - 1].name }); return }
      const naechster = aeste[astIndex + (k === 'ArrowDown' ? 1 : -1)]
      if (!naechster) return
      // Im Element bleiben: gleiche Stelle im nächsten Ast, sonst dessen Gruppe
      const i = gewaehlt ? ast.elemente.findIndex((e) => e.id === gewaehlt.id) : -1
      const dort = i >= 0 && !eingeklappt.has(astSchluessel(naechster.name)) ? naechster.elemente[Math.min(i, naechster.elemente.length - 1)] : undefined
      setAuswahl(dort ? { art: 'element', id: dort.id } : { art: 'gruppe', name: naechster.name })
    }
  }

  // Ausgewähltes Element sichtbar halten (Pfeiltasten, neu hinzugefügt)
  useEffect(() => {
    const knoten = baumRef.current?.querySelector('[data-gewaehlt="ja"]') as HTMLElement | null
    knoten?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [auswahl, elemente])

  // ---------------------------------------------------------------------------------------------------------------
  // Ziehen und Ablegen
  // ---------------------------------------------------------------------------------------------------------------
  const sensoren = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  )
  const ziehenStart = (ev: DragStartEvent) => setZieht(elemente.find((e) => e.id === ev.active.id) ?? null)
  const ziehenEnde = (ev: DragEndEvent) => {
    setZieht(null)
    const e = elemente.find((x) => x.id === ev.active.id)
    const ziel = ev.over?.data.current as { name: string | null } | undefined
    if (e && ziel && darfAnhaengen(ziel.name)) void verschieben(e, ziel.name)
  }

  const umschalten = (name: string | null) => setEingeklappt((s) => {
    const n = new Set(s)
    const k = astSchluessel(name)
    if (n.has(k)) n.delete(k)
    else n.add(k)
    return n
  })
  const alleEingeklappt = aeste.length > 0 && aeste.every((a) => eingeklappt.has(astSchluessel(a.name)))

  const zustand: BaumKontext = {
    auswahl, setAuswahl, farbe, artName, mangelJe, eingeklappt, umschalten, hinzufuegen, darfAnhaengen, gesperrt, beschaeftigt,
    einzahl, mehrzahl, gruppeName, astText, zieht, umbenennen, setUmbenennen, gruppeUmbenennen, anzahl, art, entfernen,
  }

  return (
    <section className="karte overflow-hidden" data-element-baum>
      {/* Werkzeugleiste: Art und Anzahl der neuen Elemente (zugleich Legende der Farben) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-slate-50/70 px-4 py-3">
        {def.arten.length > 0 && (
          <div role="radiogroup" aria-label={t('Art neuer {elemente}', { elemente: mehrzahl })} className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-medium uppercase tracking-wide text-slate-500">{t('Neu als')}</span>
            {def.arten.map((a, i) => {
              const f = farbe(a.schluessel)
              const an = art === a.schluessel
              const Bild = elementSymbol(a.schluessel) ?? OHNE_SYMBOL
              return (
                <button key={a.schluessel} type="button" role="radio" aria-checked={an} onClick={() => setArt(a.schluessel)}
                  title={i < 9 ? t('Taste {n}', { n: i + 1 }) : undefined}
                  className={`inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-xs font-medium transition ${an ? 'border-marke bg-marke text-white shadow-sm' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'}`}>
                  <span className={`inline-flex size-5 items-center justify-center rounded-full text-white ${f.voll} ${an ? 'ring-2 ring-white/70' : ''}`} aria-hidden>
                    {createElement(Bild, { className: 'size-3', strokeWidth: 2.25 })}
                  </span>
                  {t(a.name)}
                </button>
              )
            })}
          </div>
        )}
        <div role="radiogroup" aria-label={t('Anzahl je Klick')} className="flex items-center gap-1">
          <span className="mr-1 text-xs font-medium uppercase tracking-wide text-slate-500">{t('je Klick')}</span>
          {ANZAHLEN.map((n) => (
            <button key={n} type="button" role="radio" aria-checked={anzahl === n} onClick={() => setAnzahl(n)}
              className={`min-w-8 rounded-md border px-2 py-1 text-xs font-semibold tabular-nums transition ${anzahl === n ? 'border-marke bg-marke text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'}`}>
              {n}
            </button>
          ))}
        </div>
        <button type="button" className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200/60"
          onClick={() => setEingeklappt(alleEingeklappt ? new Set() : new Set(aeste.map((a) => astSchluessel(a.name))))}>
          {alleEingeklappt ? <ChevronsUpDown className="size-4" aria-hidden /> : <ChevronsDownUp className="size-4" aria-hidden />}
          {alleEingeklappt ? t('alle aufklappen') : t('alle einklappen')}
        </button>
      </div>

      {fehler && <p role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{fehler}</p>}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_19rem]">
        <DndContext sensors={sensoren} collisionDetection={zeigerOderFlaeche} onDragStart={ziehenStart} onDragEnd={ziehenEnde} onDragCancel={() => setZieht(null)} accessibility={{ announcements: hinweise }}>
          <div ref={baumRef} tabIndex={0} onKeyDown={tasten} aria-label={t('Baum der {elemente}', { elemente: mehrzahl })}
            className={`min-w-0 overflow-x-auto p-4 outline-none focus-visible:ring-2 focus-visible:ring-akzent focus-visible:ring-inset sm:p-5 ${auswahl ? 'max-lg:pb-[50vh]' : ''}`}>
            {/* Wurzel: die Anlage */}
            <button type="button" onClick={() => setAuswahl(null)}
              className="inline-flex items-center gap-3 rounded-xl border border-slate-300 bg-white py-2 pl-2 pr-4 text-left shadow-sm">
              <ArtSymbol art={anlagenart} groesse="md" />
              <span>
                <span className="block font-semibold leading-tight">{titel}</span>
                <span className="block text-xs text-slate-500">
                  {namen.length} {namen.length === 1 ? gruppeName : gruppenMehrzahl} · {aktive.length} {aktive.length === 1 ? einzahl : mehrzahl}
                </span>
              </span>
            </button>

            <ul className="baum-aeste">
              {aeste.map((a) => <AstZeile key={astSchluessel(a.name)} ast={a} k={zustand} />)}
              <li className="baum-ast">
                <NeueGruppe vorschlag={naechsterGruppenName(namen)} gruppeName={gruppeName} gesperrt={gesperrt} onAnlegen={(n) => void gruppeAnlegen(n)} />
              </li>
            </ul>
          </div>
          <DragOverlay dropAnimation={null}>
            {zieht && <span className={`baum-melder pointer-events-none scale-110 bg-white shadow-lg ${farbe(zieht.elementart).ring}`}><KnotenInhalt art={zieht.elementart} nummer={zieht.nummer} /></span>}
          </DragOverlay>
        </DndContext>

        {/* Seitenleiste: das Gewählte bearbeiten */}
        {/* Auf dem Handy liegt das Gewählte als Leiste unten über dem Baum */}
        <aside aria-label={t('Auswahl')} className={`border-slate-200 bg-slate-50/50 p-4 lg:border-l lg:border-t-0 ${auswahl
          ? 'max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-30 max-lg:max-h-[55vh] max-lg:overflow-y-auto max-lg:rounded-t-2xl max-lg:border-t max-lg:bg-white max-lg:shadow-[0_-8px_30px_rgb(0_0_0/0.15)]'
          : 'border-t'}`}>
          {auswahl && (
            <button type="button" onClick={() => setAuswahl(null)} aria-label={t('Schließen')}
              className="float-right -mr-1 -mt-1 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden"><X className="size-5" aria-hidden /></button>
          )}
          {gewaehlt ? (
            <ElementTafel key={gewaehlt.id + gewaehlt.nummer + (gewaehlt.ort ?? '') + (gewaehlt.elementart ?? '')} e={gewaehlt} def={def} k={zustand}
              mangel={mangelJe.get(gewaehlt.id)} elementText={elementText(gewaehlt)}
              onAendern={(feld, wert) => aendern(gewaehlt, feld, wert)} onBearbeiten={() => onBearbeiten(gewaehlt)} onEntfernen={() => void entfernen(gewaehlt)} />
          ) : auswahl?.art === 'gruppe' && aeste.some((a) => a.name === auswahl.name) ? (
            <GruppeTafel ast={aeste.find((a) => a.name === auswahl.name)!} k={zustand} istAdmin={istAdmin}
              onLoeschen={() => auswahl.name !== null && void gruppeLoeschen(auswahl.name)} />
          ) : (
            <Hilfe gruppenMehrzahl={gruppenMehrzahl} />
          )}
        </aside>
      </div>

      {aktion && (
        <div role="status" className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 max-lg:top-3 max-lg:bottom-auto">
          <div className="flex max-w-xl items-center gap-3 rounded-lg bg-marke py-2 pl-4 pr-2 text-sm text-white shadow-xl">
            <span>{aktion.text}</span>
            {aktion.rueckgaengig && (
              <button type="button" onClick={rueckgaengig} className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold text-akzent hover:bg-white/10">
                <Undo2 className="size-4" aria-hidden />{t('Rückgängig')}
              </button>
            )}
            <button type="button" onClick={() => setAktion(null)} aria-label={t('Schließen')} className="rounded-md p-1 text-white/70 hover:bg-white/10 hover:text-white">
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

interface BaumKontext {
  auswahl: Auswahl
  setAuswahl: (a: Auswahl) => void
  farbe: (art: string | null) => (typeof FARBEN)[number]
  artName: (art: string | null) => string
  mangelJe: Map<string, { stufe: number; status: string; beschreibung: string }>
  eingeklappt: Set<string>
  umschalten: (name: string | null) => void
  hinzufuegen: (gruppe: string | null, n?: number) => Promise<void>
  entfernen: (e: Element) => Promise<void>
  darfAnhaengen: (name: string | null) => boolean
  gesperrt: boolean
  beschaeftigt: boolean
  einzahl: string
  mehrzahl: string
  gruppeName: string
  astText: (name: string | null) => string
  zieht: Element | null
  umbenennen: string | null
  setUmbenennen: (name: string | null) => void
  gruppeUmbenennen: (alt: string, neu: string) => void
  anzahl: number
  art: string | null
}

/** Ein Ast: Gruppe als Knoten, daneben ihre Elemente auf einer Linie, am Ende „+“. Ablageort beim Ziehen. */
function AstZeile({ ast, k }: { ast: Ast<Element>; k: BaumKontext }) {
  const schluessel = astSchluessel(ast.name)
  const zu = k.eingeklappt.has(schluessel)
  const gewaehlt = k.auswahl?.art === 'gruppe' && k.auswahl.name === ast.name
  const imAst = k.auswahl?.art === 'element' && ast.elemente.some((e) => e.id === (k.auswahl as { id: string }).id)
  const ablage = k.zieht !== null && (k.zieht.gruppe ?? null) !== ast.name && k.darfAnhaengen(ast.name)
  // Immer als Ablage angemeldet (sonst misst dnd-kit sie beim Start des Ziehens nicht mit); ungültige Ziele prüft ziehenEnde
  const { setNodeRef, isOver: ueber } = useDroppable({ id: `ast:${schluessel}`, data: { name: ast.name } })
  const isOver = ueber && ablage
  const Pfeil = zu ? ChevronRight : ChevronDown
  const bennenen = k.umbenennen !== null && k.umbenennen === ast.name

  return (
    <li ref={setNodeRef} className={`baum-ast ${isOver ? 'baum-ast-ablage' : ''}`} data-ast={ast.name ?? ''}>
      {/* Auf schmalen Bildschirmen stehen die Elemente unter der Gruppe, sonst rechts daneben */}
      <div className="flex min-w-0 flex-col sm:flex-row sm:items-start">
        {/* Gruppenknoten */}
        <div data-gewaehlt={gewaehlt ? 'ja' : undefined}
          className={`relative flex shrink-0 items-center self-start rounded-lg border bg-white shadow-sm transition ${gewaehlt ? 'border-marke ring-3 ring-akzent' : imAst ? 'border-slate-400' : 'border-slate-300'} ${ablage && !isOver ? 'border-dashed' : ''}`}>
          <button type="button" onClick={() => k.umschalten(ast.name)} aria-expanded={!zu}
            aria-label={zu ? t('{gruppe} aufklappen', { gruppe: k.astText(ast.name) }) : t('{gruppe} einklappen', { gruppe: k.astText(ast.name) })}
            className="self-stretch rounded-l-lg px-1 text-slate-400 hover:bg-slate-100 hover:text-marke">
            <Pfeil className="size-4" aria-hidden />
          </button>
          {bennenen ? (
            <input autoFocus defaultValue={ast.name ?? ''} aria-label={t('Neuer Name')} maxLength={40} onFocus={(e) => e.currentTarget.select()}
              className="!mt-0 !w-32 !rounded-md !px-2 !py-1 !text-sm"
              onBlur={(e) => k.gruppeUmbenennen(ast.name!, e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = ast.name ?? ''; e.currentTarget.blur() } }} />
          ) : (
            <button type="button" onClick={() => k.setAuswahl({ art: 'gruppe', name: ast.name })} aria-label={k.astText(ast.name)} aria-pressed={gewaehlt}
              onDoubleClick={() => ast.name !== null && !k.gesperrt && k.setUmbenennen(ast.name)}
              title={ast.name !== null ? t('Doppelklick benennt um') : undefined}
              className="py-1.5 pl-1 pr-3 text-left">
              <span className="block text-[0.68rem] font-medium uppercase leading-none tracking-wide text-slate-500">{k.gruppeName}</span>
              <span className="block max-w-40 truncate font-semibold leading-tight">{ast.name ?? t('nicht zugeordnet')}</span>
            </button>
          )}
          <span className="mr-2 rounded-full bg-slate-100 px-1.5 text-xs font-semibold tabular-nums text-slate-600" title={t('{n} aktive {elemente}', { n: ast.aktiv, elemente: k.mehrzahl })}>{ast.aktiv}</span>
        </div>

        {/* Elemente auf der Linie */}
        {!zu && (
          <MelderZeilen label={t('{elemente} in {gruppe}', { elemente: k.mehrzahl, gruppe: k.astText(ast.name) })}>
            {ast.elemente.map((e) => <MelderKnoten key={e.id} e={e} k={k} />)}
            {k.darfAnhaengen(ast.name) && (
              <li>
                <button type="button" disabled={k.gesperrt || k.beschaeftigt} onClick={() => void k.hinzufuegen(ast.name)}
                  aria-label={t('{n} × {art} zu {gruppe} hinzufügen', { n: k.anzahl, art: k.artName(k.art), gruppe: k.astText(ast.name) })}
                  title={t('{n} × {art} hinzufügen (Taste N)', { n: k.anzahl, art: k.artName(k.art) })}
                  className={`baum-melder baum-plus ${k.farbe(k.art).ring}`}>
                  <Plus className="size-4" strokeWidth={2.5} aria-hidden />
                  {k.anzahl > 1 && <span className="absolute -right-1 -top-1 rounded-full bg-marke px-1 text-[0.6rem] font-bold leading-4 text-white">{k.anzahl}</span>}
                </button>
              </li>
            )}
          </MelderZeilen>
        )}
        {zu && ast.elemente.length > 0 && (
          <button type="button" onClick={() => k.umschalten(ast.name)} className="baum-zu">
            {ast.elemente.length} {ast.elemente.length === 1 ? k.einzahl : k.mehrzahl} …
          </button>
        )}
      </div>
    </li>
  )
}

/**
 * Elemente einer Gruppe als Raster: Passen nicht alle in eine Zeile, bricht die Linie um. Jede Spalte steht unter der
 * darüber, und eine Leitung führt vom letzten Element einer Zeile hinunter und zurück zum ersten der nächsten.
 * Die Zeilenumbrüche werden aus der tatsächlichen Lage der Einträge gemessen (Fensterbreite, Schriftgröße).
 */
function MelderZeilen({ label, children }: { label: string; children: ReactNode }) {
  const liste = useRef<HTMLOListElement>(null)
  const [pfade, setPfade] = useState<string[]>([])
  const messen = useCallback(() => {
    const ol = liste.current
    if (!ol) return
    const li = [...ol.children] as HTMLElement[]
    const neu: string[] = []
    for (let i = 1; i < li.length; i++) {
      const a = li[i - 1], b = li[i]
      // Erster Eintrag einer umgebrochenen Zeile: ohne eigenen Anschlussstrich (CSS), die Leitung führt bis an den Knoten
      const umbruch = b.offsetTop > a.offsetTop + 2
      if (umbruch) b.dataset.umbruch = 'ja'
      else delete b.dataset.umbruch
      if (!umbruch) continue
      // Vom rechten Rand des letzten Knotens kurz nach rechts, hinunter in die Lücke, zurück nach links, hinunter zur nächsten Zeile
      const ax = a.offsetLeft + a.offsetWidth, ay = a.offsetTop + a.offsetHeight / 2
      const luecke = (a.offsetTop + a.offsetHeight + b.offsetTop) / 2
      const bx = b.offsetLeft + 1, by = b.offsetTop + b.offsetHeight / 2
      const knoten = (b.firstElementChild as HTMLElement | null)?.offsetLeft ?? 12
      const r = 6
      neu.push(`M${ax} ${ay}H${ax + 8 - r}Q${ax + 8} ${ay} ${ax + 8} ${ay + r}V${luecke - r}Q${ax + 8} ${luecke} ${ax + 8 - r} ${luecke}`
        + `H${bx + r}Q${bx} ${luecke} ${bx} ${luecke + r}V${by - r}Q${bx} ${by} ${bx + r} ${by}H${b.offsetLeft + knoten}`)
    }
    setPfade((alt) => (alt.join() === neu.join() ? alt : neu))
  }, [])
  // Nach jeder Darstellung (neue, entfernte, verschobene Elemente) und bei jeder Größenänderung neu messen
  useLayoutEffect(messen)
  useLayoutEffect(() => {
    const ol = liste.current
    if (!ol) return
    const beobachter = new ResizeObserver(messen)
    beobachter.observe(ol)
    return () => beobachter.disconnect()
  }, [messen])
  return (
    <div className="baum-zeilen relative min-w-0 flex-1">
      {pfade.length > 0 && (
        <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden>
          {pfade.map((d, i) => <path key={i} d={d} fill="none" className="stroke-slate-300" strokeWidth={2} />)}
        </svg>
      )}
      <ol ref={liste} className="baum-linie" aria-label={label}>{children}</ol>
    </div>
  )
}

/** Inhalt eines Knotens: Symbol der Art über der Nummer; ohne Symbol nur die Nummer. */
function KnotenInhalt({ art, nummer }: { art: string | null; nummer: string }) {
  const Bild = elementSymbol(art)
  if (!Bild) return <span className="max-w-full truncate px-0.5 text-xs">{nummer}</span>
  return (
    <>
      {createElement(Bild, { className: 'size-[1.05rem] shrink-0', strokeWidth: 2, 'aria-hidden': true })}
      <span className="max-w-full truncate px-0.5 text-[0.62rem] leading-none">{nummer}</span>
    </>
  )
}

/** Ein Element als runder Knoten: Nummer, Farbe der Art, Punkt bei offenem Mangel. Ziehen verschiebt es. */
function MelderKnoten({ e, k }: { e: Element; k: BaumKontext }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: e.id, disabled: k.gesperrt || !e.aktiv })
  const gewaehlt = k.auswahl?.art === 'element' && k.auswahl.id === e.id
  const f = k.farbe(e.elementart)
  const mangel = k.mangelJe.get(e.id)
  const titel = [`${k.einzahl} ${e.nummer}`, k.artName(e.elementart), e.ort, !e.aktiv ? t('stillgelegt') : null, mangel ? mangel.beschreibung : null].filter(Boolean).join(' · ')
  return (
    <li>
      <button ref={setNodeRef} type="button" {...attributes} {...listeners} role="button" title={titel} aria-label={titel} aria-pressed={gewaehlt}
        data-gewaehlt={gewaehlt ? 'ja' : undefined} data-element={e.nummer}
        onClick={() => k.setAuswahl({ art: 'element', id: e.id })}
        className={`baum-melder ${f.ring} ${gewaehlt ? `${f.hell} ring-3 ring-akzent ring-offset-1` : 'bg-white'} ${e.aktiv ? '' : 'border-dashed opacity-50'} ${isDragging ? 'opacity-30' : ''}`}>
        <KnotenInhalt art={e.elementart} nummer={e.nummer} />
        {mangel && <span className={`absolute -right-0.5 -top-0.5 size-3 rounded-full ring-2 ring-white ${mangel.stufe >= 3 ? 'bg-red-600' : 'bg-amber-400'}`} aria-hidden />}
      </button>
    </li>
  )
}

/** Letzte Zeile des Baums: neue Gruppe anlegen. Der Name ist vorbelegt (nächste Nummer), Enter legt an und schlägt die nächste vor. */
function NeueGruppe({ vorschlag, gruppeName, gesperrt, onAnlegen }: { vorschlag: string; gruppeName: string; gesperrt: boolean; onAnlegen: (name: string) => void }) {
  const [offen, setOffen] = useState(false)
  // Eigene Eingabe, bis angelegt; sonst gilt der Vorschlag (nach dem Anlegen der nächste)
  const [eingabe, setEingabe] = useState<string | null>(null)
  const name = eingabe ?? vorschlag
  if (!offen) {
    return (
      <button type="button" disabled={gesperrt} onClick={() => setOffen(true)}
        className="relative inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-400 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:border-marke hover:text-marke disabled:opacity-50">
        <Plus className="size-4" aria-hidden />{t('{gruppe} anlegen', { gruppe: gruppeName })}
      </button>
    )
  }
  return (
    <form className="relative inline-flex items-center gap-2 rounded-lg border border-marke bg-white p-1.5 shadow-sm"
      onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onAnlegen(name.trim()); setEingabe(null) } }}>
      <label className="sr-only" htmlFor="baum-neue-gruppe">{t('Name ({gruppe})', { gruppe: gruppeName })}</label>
      <span className="pl-1.5 text-xs font-medium uppercase tracking-wide text-slate-500" aria-hidden>{gruppeName}</span>
      <input id="baum-neue-gruppe" autoFocus value={name} maxLength={40} onChange={(e) => setEingabe(e.target.value)} onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => { if (e.key === 'Escape') setOffen(false) }} className="!mt-0 !w-28 !px-2 !py-1 !text-sm" />
      <button type="submit" className="btn-primaer !px-3 !py-1">{t('Anlegen')}</button>
      <button type="button" onClick={() => setOffen(false)} aria-label={t('Schließen')} className="rounded-md p-1 text-slate-500 hover:bg-slate-100"><X className="size-4" aria-hidden /></button>
    </form>
  )
}

/** Seitenleiste für ein Element: Nummer, Art und Ort direkt ändern (Enter oder Feld verlassen speichert). */
function ElementTafel({ e, def, k, mangel, elementText, onAendern, onBearbeiten, onEntfernen }: {
  e: Element
  def: ElementDefinition
  k: BaumKontext
  mangel?: { stufe: number; status: string; beschreibung: string }
  elementText: string
  onAendern: (feld: 'nummer' | 'ort' | 'elementart', wert: string) => void
  onBearbeiten: () => void
  onEntfernen: () => void
}) {
  const f = k.farbe(e.elementart)
  const enter = (ev: ReactKeyboardEvent<HTMLInputElement>) => { if (ev.key === 'Enter') ev.currentTarget.blur() }
  return (
    <div className="space-y-3" data-tafel="element">
      <div className="flex items-center gap-3">
        <span className={`baum-melder shrink-0 ${f.ring} ${f.hell}`} aria-hidden><KnotenInhalt art={e.elementart} nummer={e.nummer} /></span>
        <div className="min-w-0">
          <h3 className="truncate font-semibold leading-tight">{k.einzahl} {e.nummer}</h3>
          <p className="truncate text-xs text-slate-500">{k.astText(e.gruppe ?? null)}{!e.aktiv && ` · ${t('stillgelegt')}`}</p>
        </div>
      </div>
      {mangel && (
        <p className={`rounded-md px-2.5 py-1.5 text-xs ${mangel.stufe >= 3 ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}`}>
          {mangel.status === 'behoben' ? t('Mangel behoben gemeldet') : t('Mangel offen')}: {mangel.beschreibung}
        </p>
      )}
      <label>{t('Nummer')}
        <input defaultValue={e.nummer} disabled={k.gesperrt} onBlur={(ev) => onAendern('nummer', ev.currentTarget.value)} onKeyDown={enter} />
      </label>
      {def.arten.length > 0 && (
        <label>{t('Art')}
          <select value={e.elementart ?? ''} disabled={k.gesperrt} onChange={(ev) => onAendern('elementart', ev.currentTarget.value)}>
            {!e.elementart && <option value="">–</option>}
            {def.arten.map((a) => <option key={a.schluessel} value={a.schluessel}>{t(a.name)}</option>)}
          </select>
        </label>
      )}
      <label>{t(def.ort ?? 'Ort')}
        <input defaultValue={e.ort ?? ''} disabled={k.gesperrt} placeholder={t('z. B. Flur 1. OG')} onBlur={(ev) => onAendern('ort', ev.currentTarget.value)} onKeyDown={enter} />
      </label>
      <p className="text-xs text-slate-500">{t('Zuletzt geprüft')}: {e.zuletzt_geprueft_am ? datum(e.zuletzt_geprueft_am) : t('noch nie')}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" className="btn-sekundaer !px-3 !py-1.5" onClick={onBearbeiten}><Pencil className="size-4" aria-hidden />{t('Alle Felder …')}</button>
        {e.aktiv && (
          <button type="button" className="btn-sekundaer !px-3 !py-1.5 text-red-700" disabled={k.gesperrt || k.beschaeftigt} onClick={onEntfernen} title={t('Taste Entf')}>
            <Trash2 className="size-4" aria-hidden />{t('Entfernen')}
          </button>
        )}
      </div>
      <p className="sr-only">{elementText}</p>
    </div>
  )
}

/** Seitenleiste für eine Gruppe: mehrere Elemente auf einmal, umbenennen, leere löschen. */
function GruppeTafel({ ast, k, istAdmin, onLoeschen }: { ast: Ast<Element>; k: BaumKontext; istAdmin: boolean; onLoeschen: () => void }) {
  const [n, setN] = useState(k.anzahl)
  const nachArt = new Map<string | null, number>()
  for (const e of ast.elemente) if (e.aktiv) nachArt.set(e.elementart, (nachArt.get(e.elementart) ?? 0) + 1)
  return (
    <div className="space-y-3" data-tafel="gruppe">
      <div>
        <h3 className="font-semibold leading-tight">{k.astText(ast.name)}</h3>
        <p className="text-xs text-slate-500">{t('{n} aktive {elemente}', { n: ast.aktiv, elemente: ast.aktiv === 1 ? k.einzahl : k.mehrzahl })}</p>
      </div>
      {nachArt.size > 0 && (
        <ul className="space-y-1 text-sm">
          {[...nachArt.entries()].map(([a, zahl]) => (
            <li key={a ?? ''} className="flex items-center gap-2">
              <ArtPunkt art={a} k={k} />
              <span className="flex-1 truncate">{k.artName(a)}</span>
              <span className="tabular-nums text-slate-500">{zahl}</span>
            </li>
          ))}
        </ul>
      )}
      {k.darfAnhaengen(ast.name) && (
        <form className="flex items-end gap-2" onSubmit={(ev) => { ev.preventDefault(); if (n >= 1 && n <= 200) void k.hinzufuegen(ast.name, n) }}>
          <label className="w-20">{t('Anzahl')}
            <input type="number" min={1} max={200} value={n} onChange={(ev) => setN(Number(ev.currentTarget.value))} />
          </label>
          <button type="submit" className="btn-primaer min-w-0 flex-1 !px-3" title={t('{n} × {art} hinzufügen (Taste N)', { n, art: k.artName(k.art) })} disabled={k.gesperrt || k.beschaeftigt || !(n >= 1 && n <= 200)}>
            <Plus className="size-4 shrink-0" aria-hidden /><span className="truncate">{k.artName(k.art)}</span>
          </button>
        </form>
      )}
      {ast.name !== null && (
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" className="btn-sekundaer !px-3 !py-1.5" disabled={k.gesperrt} onClick={() => k.setUmbenennen(ast.name)}>
            <Pencil className="size-4" aria-hidden />{t('Umbenennen')}
          </button>
          {istAdmin && ast.aktiv === 0 && (
            <button type="button" className="btn-sekundaer !px-3 !py-1.5 text-red-700" disabled={k.gesperrt || k.beschaeftigt} onClick={onLoeschen}>
              <Trash2 className="size-4" aria-hidden />{t('{gruppe} löschen', { gruppe: k.gruppeName })}
            </button>
          )}
        </div>
      )}
      {ast.name !== null && ast.aktiv > 0 && (
        <p className="text-xs text-slate-500">{t('Löschen lässt sich {gruppe} erst, wenn keine aktiven {elemente} mehr darin sind.', { gruppe: k.gruppeName, elemente: k.mehrzahl })}</p>
      )}
    </div>
  )
}

/** Kleines farbiges Symbol einer Art (Legende in der Seitenleiste) */
function ArtPunkt({ art, k }: { art: string | null; k: BaumKontext }) {
  const Bild = elementSymbol(art) ?? OHNE_SYMBOL
  return <span className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full text-white ${k.farbe(art).voll}`} aria-hidden>{createElement(Bild, { className: 'size-3', strokeWidth: 2.25 })}</span>
}

/** Ohne Auswahl: kurze Bedienhilfe. */
function Hilfe({ gruppenMehrzahl }: { gruppenMehrzahl: string }) {
  const taste = (x: string) => <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[0.7rem] text-slate-700 shadow-[0_1px_0_rgb(0_0_0/0.08)]">{x}</kbd>
  return (
    <div className="space-y-3 text-sm text-slate-600" data-tafel="hilfe">
      <h3 className="font-semibold text-marke">{t('So geht es schnell')}</h3>
      <ol className="list-decimal space-y-1.5 pl-5">
        <li>{t('Unten im Baum {gruppen} anlegen – der Name zählt von selbst hoch, Enter legt die nächste an.', { gruppen: gruppenMehrzahl })}</li>
        <li>{t('Oben die Art wählen, dann in der Zeile auf + tippen. Die Nummern zählen hoch.')}</li>
        <li>{t('Antippen: Art und Ort eintragen. In eine andere Zeile ziehen: verschieben.')}</li>
      </ol>
      <ul className="space-y-1 text-xs">
        <li>{taste('← → ↑ ↓')} {t('wandern')}</li>
        <li>{taste('N')} {t('hinzufügen')} · {taste('Entf')} {t('entfernen')} · {taste('F2')} {t('umbenennen')}</li>
        <li>{taste('1')}–{taste('9')} {t('Art wählen')} · {taste('Enter')} {t('alle Felder')}</li>
      </ul>
      <p className="text-xs">{t('Jede Änderung lässt sich unten rückgängig machen.')}</p>
    </div>
  )
}
