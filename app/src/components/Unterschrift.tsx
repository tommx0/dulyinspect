import SignaturePad from 'signature_pad'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { t } from '../lib/sprache'

export interface UnterschriftRef {
  /** PNG der Unterschrift oder null, wenn leer */
  alsBlob: () => Promise<Blob | null>
  istLeer: () => boolean
}

/** Unterschriftenfeld (Finger/Stift/Maus). */
export const Unterschrift = forwardRef<UnterschriftRef, { label: string; onAenderung?: (leer: boolean) => void }>(
  function Unterschrift({ label, onAenderung }, ref) {
    const leinwand = useRef<HTMLCanvasElement>(null)
    const pad = useRef<SignaturePad | null>(null)
    const [leer, setLeer] = useState(true)

    useEffect(() => {
      const c = leinwand.current!
      const p = new SignaturePad(c, { penColor: '#1c1c1c', minWidth: 0.8, maxWidth: 2.5 })
      pad.current = p
      const groesseAnpassen = () => {
        if (!c.offsetWidth) return // noch unsichtbar (z. B. Dialog öffnet erst nach diesem Effect)
        const daten = p.toData()
        const verhaeltnis = Math.max(window.devicePixelRatio || 1, 1)
        c.width = c.offsetWidth * verhaeltnis
        c.height = c.offsetHeight * verhaeltnis
        c.getContext('2d')!.scale(verhaeltnis, verhaeltnis)
        p.clear()
        p.fromData(daten)
      }
      // Bei jeder Größenänderung neu einrichten, auch wenn das Feld erst nach dem Einhängen sichtbar wird:
      // ein Dialog ruft showModal() erst in seinem eigenen Effect auf, sonst bliebe die Leinwand 0 Pixel breit
      const beobachter = new ResizeObserver(groesseAnpassen)
      beobachter.observe(c)
      const aendern = () => { setLeer(p.isEmpty()); onAenderung?.(p.isEmpty()) }
      p.addEventListener('endStroke', aendern)
      return () => { p.off(); beobachter.disconnect() }
    }, [onAenderung])

    useImperativeHandle(ref, () => ({
      istLeer: () => pad.current?.isEmpty() ?? true,
      alsBlob: async () => {
        if (!pad.current || pad.current.isEmpty()) return null
        return new Promise((ok) => leinwand.current!.toBlob((b) => ok(b), 'image/png'))
      },
    }))

    return (
      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-slate-700">{label}</span>
          <button type="button" className="link text-sm" disabled={leer}
            onClick={() => { pad.current?.clear(); setLeer(true); onAenderung?.(true) }}>{t('löschen')}</button>
        </div>
        <div className="relative mt-1 rounded-md border-2 border-dashed border-slate-300 bg-white">
          <canvas ref={leinwand} className="block h-40 w-full touch-none" aria-label={label} />
          {leer && <span className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-sm text-slate-400">{t('Hier unterschreiben')}</span>}
          <div className="pointer-events-none absolute inset-x-6 bottom-9 border-b border-slate-300" />
        </div>
      </div>
    )
  },
)
