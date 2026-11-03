import { Languages } from 'lucide-react'
import { spracheSetzen, spracheWahl, t, type SpracheWahl } from '../lib/sprache'

/** Sprache auf diesem Gerät: automatisch nach dem Browser, Deutsch oder English (Fußzeile, Anmeldeseite). */
export function SpracheUmschalter() {
  return (
    <label className="inline-flex items-center gap-1">
      <Languages className="size-3.5" aria-hidden />
      <span className="sr-only">{t('Sprache')}</span>
      <select className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-xs text-slate-500 hover:underline focus:ring-0"
        value={spracheWahl()} onChange={(e) => spracheSetzen(e.target.value as SpracheWahl)} data-sprache>
        <option value="auto">{t('Automatisch')}</option>
        <option value="de">Deutsch</option>
        <option value="en">English</option>
      </select>
    </label>
  )
}
