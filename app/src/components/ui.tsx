import { useEffect, useId, useRef, type ReactNode } from 'react'
import { gebietsschema, t } from '../lib/sprache'
import { ChevronLeft, LayoutGrid, List } from 'lucide-react'
import { Link } from 'react-router'
import type { Ansicht } from '../lib/ansicht'

export function Seite({ titel, zurueck, aktionen, breit, children }: {
  titel: ReactNode
  zurueck?: { zu: string; text: string }
  aktionen?: ReactNode
  /** Nutzt große Bildschirme in voller Breite (Dashboard) */
  breit?: boolean
  children: ReactNode
}) {
  return (
    <div className={`mx-auto space-y-4 p-4 ${breit ? 'max-w-[1920px] xl:px-6' : 'max-w-7xl'}`}>
      {zurueck && (
        <Link to={zurueck.zu} className="group -ml-1 inline-flex items-center gap-0.5 rounded-md py-1 pr-2 text-sm font-semibold text-slate-600 hover:bg-akzent-hell hover:text-marke">
          <ChevronLeft className="size-4 transition group-hover:-translate-x-0.5" strokeWidth={2.25} aria-hidden />{zurueck.text}
        </Link>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{titel}</h1>
        {aktionen && <div className="flex flex-wrap gap-2">{aktionen}</div>}
      </div>
      {children}
    </div>
  )
}

export function Fehler({ text }: { text?: string }) {
  if (!text) return null
  return <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{text}</div>
}

export function Laden() {
  return <p className="p-4 text-slate-500">{t('Laden …')}</p>
}

export function Leer({ children }: { children: ReactNode }) {
  return <div className="karte p-6 text-center text-slate-500">{children}</div>
}

export function Badge({ farbe = 'grau', children }: { farbe?: 'grau' | 'gruen' | 'gelb' | 'rot' | 'blau'; children: ReactNode }) {
  const f = {
    grau: 'bg-slate-100 text-slate-700',
    gruen: 'bg-green-100 text-green-800',
    gelb: 'bg-amber-100 text-amber-800',
    rot: 'bg-red-100 text-red-800',
    blau: 'bg-sky-100 text-sky-800',
  }[farbe]
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${f}`}>{children}</span>
}

/** Modaler Dialog auf Basis von <dialog> (Fokus-Falle und Escape inklusive). */
export function Dialog({ offen, titel, onSchliessen, children, breit }: {
  offen: boolean
  titel: string
  onSchliessen: () => void
  children: ReactNode
  breit?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titelId = useId()
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (offen && !d.open) d.showModal()
    if (!offen && d.open) d.close()
  }, [offen])
  return (
    <dialog
      ref={ref}
      aria-labelledby={titelId}
      // „close“ kommt verzögert: ist der Dialog inzwischen wieder offen (nächste Rückfrage gleich danach), gilt es nicht ihr
      onClose={() => { if (!ref.current?.open) onSchliessen() }}
      className={`m-auto w-[calc(100%-2rem)] ${breit ? 'max-w-5xl' : 'max-w-2xl'} rounded-lg p-0 shadow-xl backdrop:bg-slate-900/40`}
    >
      {offen && (
        <div className="max-h-[85dvh] overflow-y-auto p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 id={titelId} className="text-lg font-semibold">{titel}</h2>
            <button type="button" onClick={onSchliessen} className="text-2xl leading-none text-slate-400 hover:text-slate-700" aria-label={t('Schließen')}>×</button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  )
}

/** Formularfeld mit Label. */
export function Feld({ label, children, hinweis, className = '' }: {
  label: string
  children: ReactNode
  hinweis?: string
  className?: string
}) {
  return (
    <div className={className}>
      <label>
        {label}
        {children}
      </label>
      {hinweis && <p className="mt-1 text-xs text-slate-500">{hinweis}</p>}
    </div>
  )
}

export function Tabelle({ kopf, children }: { kopf: string[]; children: ReactNode }) {
  return (
    <div className="karte overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
          <tr>{kopf.map((k) => <th key={k} className="px-3 py-2 font-medium">{k}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  )
}

/** Umschalter Kacheln / Liste (zusammen mit useAnsicht). */
export function AnsichtWahl({ wert, onWechsel }: { wert: Ansicht; onWechsel: (a: Ansicht) => void }) {
  const knopf = (a: Ansicht, text: string, Bild: typeof List) => (
    <button type="button" onClick={() => onWechsel(a)} aria-pressed={wert === a} title={text} aria-label={text}
      className={`inline-flex items-center rounded px-2 py-1.5 transition ${wert === a ? 'bg-marke text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-marke'}`}>
      <Bild className="size-4" strokeWidth={2} aria-hidden />
    </button>
  )
  return (
    <div role="group" aria-label={t('Ansicht')} className="inline-flex shrink-0 gap-0.5 rounded-md border border-slate-300 bg-white p-0.5 shadow-sm">
      {knopf('kacheln', t('Kacheln'), LayoutGrid)}
      {knopf('liste', t('Liste'), List)}
    </div>
  )
}

/** Raster für Kacheln (Elemente mit Klasse `kachel`). */
export function Kacheln({ children, 'aria-label': label }: { children: ReactNode; 'aria-label'?: string }) {
  return <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 [&>li]:min-w-0" aria-label={label}>{children}</ul>
}

export function datum(d?: string | null): string {
  if (!d) return '–'
  return new Date(d).toLocaleDateString(gebietsschema())
}
