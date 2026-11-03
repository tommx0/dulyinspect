import { useEffect, useId, useRef, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, Plus, Search } from 'lucide-react'
import { t } from '../lib/sprache'

/** Zusätzliche Darstellung einer Kachel: Symbol links, Zusatzzeile unter dem Text. */
export type KachelDarstellung = { symbol?: ReactNode; zusatz?: ReactNode }

type Eintrag = { wert: string; text: string; gewaehlt: boolean }

// Tasten, mit denen sich die Systemliste öffnen würde (macOS öffnet sie auch mit den Pfeiltasten)
const OEFFNEN = new Set(['Enter', ' ', 'ArrowDown', 'ArrowUp', 'F4'])
// Ab so vielen Einträgen gibt es ein Suchfeld
const MIT_SUCHE = 8

/** Auswahlfeld wie <select>, das statt der Systemliste ein Popup mit Kacheln öffnet.
 *  Das native <select> bleibt erhalten: Wert, Pflichtprüfung im Formular, Bedienung per Tests (selectOption) und
 *  Tippen von Anfangsbuchstaben funktionieren wie gewohnt. Die Kacheln entstehen aus den <option>-Einträgen. */
export function Auswahl({ kachel, titel, onMouseDown, onKeyDown, onTouchStart, onTouchEnd, ...rest }: ComponentProps<'select'> & {
  /** Symbol und Zusatzzeile je Wert */
  kachel?: (wert: string) => KachelDarstellung | undefined
  /** Überschrift des Popups; sonst Beschriftung des Felds */
  titel?: string
}) {
  const ref = useRef<HTMLSelectElement>(null)
  const [popup, setPopup] = useState<{ titel: string; eintraege: Eintrag[] } | null>(null)
  const beruehrt = useRef<{ x: number; y: number } | null>(null)

  const oeffnen = () => {
    const s = ref.current
    if (!s || s.disabled) return
    // Platzhalter wie „Bitte wählen“ sind gesperrt und erscheinen nicht als Kachel
    setPopup({
      titel: titel ?? beschriftung(s),
      eintraege: [...s.options].filter((o) => !o.disabled).map((o) => ({ wert: o.value, text: o.text, gewaehlt: o.selected })),
    })
  }

  const waehlen = (wert: string) => {
    const s = ref.current!
    setPopup(null)
    s.focus({ preventScroll: true })
    if (wert === s.value) return
    // Wie eine Auswahl in der Systemliste: Wert setzen und „change“ auslösen (React reagiert darauf mit onChange)
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(s, wert)
    s.dispatchEvent(new Event('change', { bubbles: true }))
  }

  return (
    <>
      <select ref={ref} {...rest}
        onMouseDown={(e) => { onMouseDown?.(e); if (e.button === 0) { e.preventDefault(); oeffnen() } }}
        onKeyDown={(e) => { onKeyDown?.(e); if (OEFFNEN.has(e.key)) { e.preventDefault(); oeffnen() } }}
        onTouchStart={(e) => { onTouchStart?.(e); beruehrt.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }}
        onTouchEnd={(e) => {
          onTouchEnd?.(e)
          // Nur Antippen öffnet, nicht Scrollen über das Feld hinweg; preventDefault verhindert die Systemliste
          const start = beruehrt.current, punkt = e.changedTouches[0]
          if (start && Math.hypot(punkt.clientX - start.x, punkt.clientY - start.y) < 10) { e.preventDefault(); oeffnen() }
          beruehrt.current = null
        }} />
      {popup && createPortal(
        <KachelPopup {...popup} kachel={kachel}
          onWahl={waehlen} onSchliessen={() => { setPopup(null); ref.current?.focus({ preventScroll: true }) }} />,
        document.body,
      )}
    </>
  )
}

/** Beschriftung des Felds: aria-label oder Text des zugehörigen <label> (ohne die Optionen und das Pflicht-Sternchen). */
function beschriftung(s: HTMLSelectElement): string {
  const aria = s.getAttribute('aria-label')
  if (aria) return aria
  const label = s.labels?.[0]?.cloneNode(true) as HTMLLabelElement | undefined
  label?.querySelectorAll('select, p').forEach((x) => x.remove())
  return label?.textContent?.replace(/\s*\*\s*$/, '').trim() || t('Auswählen')
}

function KachelPopup({ titel, eintraege, kachel, onWahl, onSchliessen }: {
  titel: string
  eintraege: Eintrag[]
  kachel?: (wert: string) => KachelDarstellung | undefined
  onWahl: (wert: string) => void
  onSchliessen: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const liste = useRef<HTMLDivElement>(null)
  const titelId = useId()
  const [suche, setSuche] = useState('')
  const mitSuche = eintraege.length > MIT_SUCHE

  useEffect(() => {
    // Kein close() beim Aufräumen: das „close“-Ereignis käme verzögert und schlösse das Popup wieder (StrictMode ruft den Effekt
    // zweimal auf); beim Entfernen aus dem Dokument verlässt der Dialog die oberste Ebene ohnehin
    if (!ref.current!.open) ref.current!.showModal()
    // Mit Suchfeld steht der Fokus dort, sonst auf der gewählten Kachel
    if (!mitSuche) (liste.current?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? liste.current?.querySelector('button'))?.focus()
    liste.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [mitSuche])

  const s = suche.trim().toLowerCase()
  const sichtbar = eintraege.filter((e) => !s || text(e).toLowerCase().includes(s))
  // Kurze Texte passen zu dritt in eine Zeile
  const spalten = eintraege.length >= 6 && eintraege.every((e) => text(e).length <= 24) ? 'sm:grid-cols-3' : 'sm:grid-cols-2'

  // Pfeiltasten wandern durch die Kacheln
  const pfeile = (e: KeyboardEvent<HTMLDivElement>) => {
    const schritt = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
    if (!schritt) return
    const knoepfe = [...liste.current!.querySelectorAll<HTMLButtonElement>('button')]
    const i = knoepfe.indexOf(document.activeElement as HTMLButtonElement)
    e.preventDefault()
    knoepfe[Math.min(Math.max(i + schritt, 0), knoepfe.length - 1)]?.focus()
  }

  return (
    <dialog ref={ref} aria-labelledby={titelId}
      // Ereignisse nicht an die Elemente rund um das Feld weiterreichen (React leitet sie durch das Portal)
      onClick={(e) => { e.stopPropagation(); if (e.target === ref.current) onSchliessen() }}
      onKeyDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
      onClose={(e) => { e.stopPropagation(); onSchliessen() }}
      className="m-auto w-[calc(100%-2rem)] max-w-2xl rounded-xl bg-stone-50 p-0 shadow-xl backdrop:bg-slate-900/40">
      <div className="flex max-h-[85dvh] flex-col">
        <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
          <h2 id={titelId} className="text-lg font-semibold">{titel}</h2>
          <button type="button" onClick={onSchliessen} className="text-2xl leading-none text-slate-400 hover:text-slate-700" aria-label={t('Schließen')}>×</button>
        </div>
        {mitSuche && (
          <div className="relative px-5 pb-3">
            <Search className="pointer-events-none absolute top-1/2 left-8 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input type="search" autoFocus placeholder={t('Suchen …')} aria-label={t('Auswahl durchsuchen')} className="mt-0 pl-9" value={suche}
              onChange={(e) => setSuche(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && sichtbar.length > 0) { e.preventDefault(); onWahl(sichtbar[0].wert) } }} />
          </div>
        )}
        {/* Eigener Scrollbereich um das Raster: als Scrollbereich selbst würde das Raster seine Zeilen stauchen */}
        <div className="min-h-0 overflow-y-auto px-5 pt-1 pb-5">
          <div ref={liste} onKeyDown={pfeile} className={`grid gap-2 ${spalten}`}>
            {sichtbar.map((e) => {
              const d = kachel?.(e.wert)
              const neu = e.text.startsWith('+')
              return (
                <button key={e.wert} type="button" aria-pressed={e.gewaehlt} onClick={() => onWahl(e.wert)}
                  className={`flex min-h-14 items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition hover:shadow-md active:bg-akzent-hell
                    ${e.gewaehlt ? 'border-marke bg-akzent-hell font-semibold ring-1 ring-marke'
                      : neu ? 'border-dashed border-slate-400 bg-white text-slate-700 hover:bg-akzent-hell/40'
                        : 'border-slate-200 bg-white shadow-sm hover:border-slate-300 hover:bg-akzent-hell/40'}`}>
                  {neu ? (
                    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600" aria-hidden><Plus className="size-5" /></span>
                  ) : d?.symbol}
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{neu ? e.text.replace(/^\+\s*/, '') : text(e)}</span>
                    {d?.zusatz && <span className="block text-xs font-normal text-slate-500">{d.zusatz}</span>}
                  </span>
                  {e.gewaehlt && <Check className="size-5 shrink-0" strokeWidth={2.5} aria-hidden />}
                </button>
              )
            })}
            {sichtbar.length === 0 && <p className="col-span-full py-6 text-center text-sm text-slate-500">{t('Nichts gefunden.')}</p>}
          </div>
        </div>
      </div>
    </dialog>
  )
}

/** Leere Einträge („–“) heißen in der Kachel ausdrücklich „keine Angabe“. */
function text(e: Eintrag): string {
  return e.wert === '' && /^[\s–-]*$/.test(e.text) ? t('keine Angabe') : e.text
}
