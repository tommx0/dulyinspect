import { useState } from 'react'
import { kannMangel, STUFEN, type Punkt, type Stufe, type Wirkung } from '../lib/checkliste'
import { BedingungsEditor } from './BedingungsEditor'
import { Auswahl } from './Auswahl'
import { t } from '../lib/sprache'

interface Eintrag {
  id: number
  wirkung: Wirkung
  min: string
  max: string
}

const zuText = (n: number | undefined) => n?.toString().replace('.', ',') ?? ''
const zuZahl = (s: string) => {
  const n = s.trim() === '' ? undefined : Number(s.replace(',', '.'))
  return n !== undefined && Number.isFinite(n) ? n : undefined
}
const LEER: Wirkung['wenn'] = { punkt: '', ist: '' }
let naechsteId = 0

/** Wirkungen eines Prüfpunkts: „Wenn …, dann Pflicht / Mangelstufe mindestens … / anderer Grenzwert“. Der Punkt bleibt dabei sichtbar. */
export function WirkungenEditor({ punkt, vorherige, alle, onChange }: {
  punkt: Punkt
  vorherige: Punkt[]
  alle: Punkt[]
  onChange: (w: Wirkung[] | undefined) => void
}) {
  const neuerEintrag = (w: Wirkung): Eintrag => ({ id: naechsteId++, wirkung: w, min: zuText(w.soll_min), max: zuText(w.soll_max) })
  const [liste, setListe] = useState<Eintrag[]>(() => (punkt.wirkungen ?? []).map(neuerEintrag))
  const melde = (l: Eintrag[]) => {
    setListe(l)
    onChange(l.length ? l.map((e) => e.wirkung) : undefined)
  }
  const aendere = (id: number, f: (e: Eintrag) => Eintrag) => melde(liste.map((e) => (e.id === id ? f(e) : e)))
  const mitFeld = <K extends keyof Wirkung>(w: Wirkung, k: K, v: Wirkung[K] | undefined): Wirkung => {
    const neu = { ...w, [k]: v }
    if (v === undefined) delete neu[k]
    return neu
  }
  const messwert = punkt.typ === 'messwert'
  const mangel = kannMangel(punkt)
  const hatQuellen = vorherige.length > 0

  return (
    <fieldset className="space-y-3 rounded-md border border-slate-200 p-3">
      <legend className="px-1 text-sm font-medium text-slate-700">{t('Wirkungen (strengere Regeln, wenn …)')}</legend>
      <p className="text-xs text-slate-500">
        {messwert
          ? t('Der Punkt bleibt sichtbar. Trifft die Bedingung zu, wird er zur Pflichtangabe, ein Mangel bekommt mindestens eine Stufe oder es gelten andere Grenzwerte.')
          : t('Der Punkt bleibt sichtbar. Trifft die Bedingung zu, wird er zur Pflichtangabe, ein Mangel bekommt mindestens eine Stufe.')}
      </p>

      {liste.map((e, i) => (
        <div key={e.id} className="space-y-2 rounded-md bg-amber-50/60 p-3">
          <BedingungsEditor titel={t('Wirkung {n} gilt, wenn …', { n: i + 1 })} leerText={t('Bitte eine Bedingung wählen.')} vorspann={t('Gilt, wenn')}
            wert={e.wirkung.wenn} vorherige={vorherige} alle={alle}
            onChange={(b) => aendere(e.id, (x) => ({ ...x, wirkung: { ...x.wirkung, wenn: b ?? LEER } }))} />
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <label className="flex items-center gap-2 font-normal">
              <input type="checkbox" checked={!!e.wirkung.pflicht}
                onChange={(ev) => aendere(e.id, (x) => ({ ...x, wirkung: mitFeld(x.wirkung, 'pflicht', ev.target.checked ? true : undefined) }))} />
              {t('wird Pflichtangabe')}
            </label>
            {mangel && (
              <label className="flex items-center gap-2 font-normal">
                {t('Mangelstufe mindestens')}
                <Auswahl aria-label={t('Mangelstufe mindestens (Wirkung {n})', { n: i + 1 })} className="mt-0 w-auto" value={e.wirkung.stufe ?? ''}
                  onChange={(ev) => aendere(e.id, (x) => ({ ...x, wirkung: mitFeld(x.wirkung, 'stufe', (Number(ev.target.value) || undefined) as Stufe | undefined) }))}>
                  <option value="">–</option>
                  {([1, 2, 3] as Stufe[]).map((s) => <option key={s} value={s}>{s} – {STUFEN[s]}</option>)}
                </Auswahl>
              </label>
            )}
            {messwert && (
              <>
                <label className="flex items-center gap-2 font-normal">
                  {t('Soll min')}
                  <input inputMode="decimal" aria-label={t('Soll min (Wirkung {n})', { n: i + 1 })} className="mt-0 w-24" value={e.min}
                    onChange={(ev) => aendere(e.id, (x) => ({ ...x, min: ev.target.value, wirkung: mitFeld(x.wirkung, 'soll_min', zuZahl(ev.target.value)) }))} />
                </label>
                <label className="flex items-center gap-2 font-normal">
                  {t('Soll max')}
                  <input inputMode="decimal" aria-label={t('Soll max (Wirkung {n})', { n: i + 1 })} className="mt-0 w-24" value={e.max}
                    onChange={(ev) => aendere(e.id, (x) => ({ ...x, max: ev.target.value, wirkung: mitFeld(x.wirkung, 'soll_max', zuZahl(ev.target.value)) }))} />
                  {punkt.einheit}
                </label>
              </>
            )}
            <button type="button" className="ml-auto text-sm text-red-600" onClick={() => melde(liste.filter((x) => x.id !== e.id))}>{t('Wirkung entfernen')}</button>
          </div>
        </div>
      ))}

      {hatQuellen ? (
        <button type="button" className="btn-sekundaer" onClick={() => melde([...liste, neuerEintrag({ wenn: LEER })])}>{t('+ Wirkung')}</button>
      ) : (
        <p className="text-sm text-slate-500">{t('Wirkungen sind nur auf vorherige Punkte möglich.')}</p>
      )}
    </fieldset>
  )
}
