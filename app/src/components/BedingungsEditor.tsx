import { useState } from 'react'
import {
  bedingungsText, bedingungsWerte, blaetter, erlaubteWerte, istBedingungsQuelle, istGruppe, wertText, type Bedingung, type Blatt, type Punkt,
} from '../lib/checkliste'
import { t } from '../lib/sprache'
import { Auswahl } from './Auswahl'

type Op = 'ist' | 'ist_nicht' | 'in' | 'unter' | 'ueber' | 'zwischen' | 'mangel' | 'kein_mangel'
type Verknuepfung = 'alle' | 'eine'

interface Zeile {
  punkt: string
  op: Op
  werte: string[]
  unter: string
  ueber: string
}

const zuText = (n: number | undefined) => n?.toString().replace('.', ',') ?? ''
const zuZahl = (s: string) => {
  const n = s.trim() === '' ? undefined : Number(s.replace(',', '.'))
  return n !== undefined && Number.isFinite(n) ? n : undefined
}

function zeileAus(b: Blatt): Zeile {
  const op: Op = b.mangel !== undefined ? (b.mangel ? 'mangel' : 'kein_mangel')
    : b.unter !== undefined && b.ueber !== undefined ? 'zwischen'
      : b.unter !== undefined ? 'unter'
        : b.ueber !== undefined ? 'ueber'
          : b.in ? 'in' : b.ist_nicht !== undefined ? 'ist_nicht' : 'ist'
  return { punkt: b.punkt, op, werte: bedingungsWerte(b), unter: zuText(b.unter), ueber: zuText(b.ueber) }
}

function blattAus(z: Zeile): Blatt {
  const b: Blatt = { punkt: z.punkt }
  switch (z.op) {
    case 'ist': b.ist = z.werte[0] ?? ''; break
    case 'ist_nicht': b.ist_nicht = z.werte[0] ?? ''; break
    case 'in': b.in = z.werte; break
    case 'mangel': b.mangel = true; break
    case 'kein_mangel': b.mangel = false; break
    case 'unter': case 'ueber': case 'zwischen': {
      const unter = zuZahl(z.unter)
      const ueber = zuZahl(z.ueber)
      if ((z.op === 'unter' || z.op === 'zwischen') && unter !== undefined) b.unter = unter
      if ((z.op === 'ueber' || z.op === 'zwischen') && ueber !== undefined) b.ueber = ueber
    }
  }
  return b
}

/** Welche Vergleiche passen zur Antwort des Punkts? */
function operatoren(ref: Punkt | undefined): { op: Op; label: string }[] {
  const mangel = [{ op: 'mangel' as const, label: t('ergibt Mangel') }, { op: 'kein_mangel' as const, label: t('ergibt keinen Mangel') }]
  switch (ref?.typ) {
    case 'ja_nein': return [{ op: 'ist', label: t('ist') }, { op: 'ist_nicht', label: t('ist nicht') }, ...(ref.gut ? mangel : [])]
    case 'auswahl': return [
      { op: 'ist', label: t('ist') }, { op: 'ist_nicht', label: t('ist nicht') }, { op: 'in', label: t('ist eines von') },
      ...(ref.optionen?.some((o) => o.mangel) ? mangel : []),
    ]
    case 'status': return [{ op: 'ist', label: t('ist') }, { op: 'ist_nicht', label: t('ist nicht') }, { op: 'in', label: t('ist eines von') }]
    case 'messwert': return [
      { op: 'unter', label: t('ist kleiner als') }, { op: 'ueber', label: t('ist größer als') }, { op: 'zwischen', label: t('liegt zwischen') },
      { op: 'mangel', label: t('liegt außerhalb Soll') }, { op: 'kein_mangel', label: t('liegt im Soll') },
    ]
    default: return []
  }
}

/** Alle Zeilen aus einer gespeicherten Bedingung; null = Aufbau lässt sich hier nicht bearbeiten (verschachtelte Gruppen). */
function zeilenAus(b: Bedingung | undefined): { zeilen: Zeile[]; verknuepfung: Verknuepfung } | null {
  if (!b) return { zeilen: [], verknuepfung: 'alle' }
  if (!istGruppe(b)) return { zeilen: [zeileAus(b)], verknuepfung: 'alle' }
  const art: Verknuepfung = b.alle ? 'alle' : 'eine'
  const liste = b[art] ?? []
  if (liste.some(istGruppe)) return null
  return { zeilen: (liste as Blatt[]).map(zeileAus), verknuepfung: art }
}

/** Bedingung eines Prüfpunkts: eine oder mehrere Zeilen („Punkt – Vergleich – Wert“), verknüpft mit UND oder ODER. */
export function BedingungsEditor({ wert, vorherige, alle, onChange, titel = t('Bedingung (nur anzeigen, wenn …)'), leerText = t('Der Punkt wird immer angezeigt.'), vorspann = t('Erscheint nur, wenn') }: {
  wert: Bedingung | undefined
  vorherige: Punkt[]
  alle: Punkt[]
  onChange: (b: Bedingung | undefined) => void
  titel?: string
  leerText?: string
  vorspann?: string
}) {
  const start = zeilenAus(wert)
  const [zeilen, setZeilen] = useState<Zeile[]>(start?.zeilen ?? [])
  const [verknuepfung, setVerknuepfung] = useState<Verknuepfung>(start?.verknuepfung ?? 'alle')
  const quellen = vorherige.filter(istBedingungsQuelle)

  const melde = (z: Zeile[], v: Verknuepfung) => {
    setZeilen(z)
    setVerknuepfung(v)
    const blaetter = z.map(blattAus)
    onChange(blaetter.length === 0 ? undefined : blaetter.length === 1 ? blaetter[0] : { [v]: blaetter })
  }
  const aendere = (i: number, neu: Zeile) => melde(zeilen.map((z, j) => (j === i ? neu : z)), verknuepfung)

  if (!start) {
    return (
      <fieldset className="space-y-2 rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium text-slate-700">{titel}</legend>
        <p className="text-sm text-slate-600">{wert && bedingungsText(wert, alle)}</p>
        <p className="text-xs text-slate-500">{t('Diese Bedingung ist verschachtelt und lässt sich hier nicht bearbeiten.')}</p>
        <button type="button" className="btn-sekundaer" onClick={() => onChange(undefined)}>{t('Bedingung entfernen')}</button>
      </fieldset>
    )
  }

  return (
    <fieldset className="space-y-3 rounded-md border border-slate-200 p-3">
      <legend className="px-1 text-sm font-medium text-slate-700">{titel}</legend>
      {zeilen.length === 0 && <p className="text-sm text-slate-500">{leerText}</p>}

      {zeilen.map((z, i) => {
        const ref = quellen.find((q) => q.id === z.punkt)
        const ops = operatoren(ref)
        const werte = ref ? erlaubteWerte(ref).filter(Boolean) : []
        return (
          <div key={i} className="space-y-1">
            {i > 0 && (
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{verknuepfung === 'alle' ? t('und') : t('oder')}</div>
            )}
            <div className="flex flex-wrap items-start gap-2">
              <Auswahl aria-label={t('Steuernder Punkt')} className="mt-0 min-w-48 flex-1" value={z.punkt}
                onChange={(e) => {
                  const neu = quellen.find((q) => q.id === e.target.value)
                  aendere(i, { punkt: e.target.value, op: operatoren(neu)[0]?.op ?? 'ist', werte: [], unter: '', ueber: '' })
                }}>
                <option value="" disabled>{t('Punkt wählen')}</option>
                {quellen.map((q) => <option key={q.id} value={q.id}>{q.text}</option>)}
              </Auswahl>
              {ref && (
                <Auswahl aria-label={t('Operator')} className="mt-0 w-auto" value={z.op}
                  onChange={(e) => aendere(i, { ...z, op: e.target.value as Op, werte: e.target.value === 'in' ? z.werte : z.werte.slice(0, 1) })}>
                  {ops.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
                </Auswahl>
              )}
              {ref && (z.op === 'ist' || z.op === 'ist_nicht') && (
                <Auswahl aria-label={t('Wert')} className="mt-0 w-auto" value={z.werte[0] ?? ''} onChange={(e) => aendere(i, { ...z, werte: [e.target.value] })}>
                  <option value="" disabled>{t('Wert wählen')}</option>
                  {werte.map((w) => <option key={w} value={w}>{wertText(ref, w)}</option>)}
                </Auswahl>
              )}
              {ref && z.op === 'in' && (
                <div className="space-y-1 pt-1">
                  {werte.map((w) => (
                    <label key={w} className="flex items-center gap-2 font-normal">
                      <input type="checkbox" checked={z.werte.includes(w)}
                        onChange={(e) => aendere(i, { ...z, werte: e.target.checked ? [...z.werte, w] : z.werte.filter((x) => x !== w) })} />
                      {wertText(ref, w)}
                    </label>
                  ))}
                </div>
              )}
              {ref && (z.op === 'ueber' || z.op === 'zwischen') && (
                <label className="flex items-center gap-1 font-normal">
                  {z.op === 'zwischen' && t('über')}
                  <input inputMode="decimal" aria-label={t('Untergrenze (größer als)')} className="mt-0 w-24" value={z.ueber} onChange={(e) => aendere(i, { ...z, ueber: e.target.value })} />
                  {z.op === 'ueber' && ref.einheit}
                </label>
              )}
              {ref && (z.op === 'unter' || z.op === 'zwischen') && (
                <label className="flex items-center gap-1 font-normal">
                  {z.op === 'zwischen' && t('und unter')}
                  <input inputMode="decimal" aria-label={t('Obergrenze (kleiner als)')} className="mt-0 w-24" value={z.unter} onChange={(e) => aendere(i, { ...z, unter: e.target.value })} />
                  {ref.einheit}
                </label>
              )}
              <button type="button" className="px-1 pt-1 text-red-600" aria-label={t('Bedingung entfernen')} onClick={() => melde(zeilen.filter((_, j) => j !== i), verknuepfung)}>✕</button>
            </div>
          </div>
        )
      })}

      {zeilen.length > 1 && (
        <label className="flex flex-wrap items-center gap-2 text-sm font-normal">
          {t('Verknüpfung')}
          <Auswahl aria-label={t('Verknüpfung')} className="mt-0 w-auto" value={verknuepfung} onChange={(e) => melde(zeilen, e.target.value as Verknuepfung)}>
            <option value="alle">{t('Alle müssen zutreffen (UND)')}</option>
            <option value="eine">{t('Mindestens eine muss zutreffen (ODER)')}</option>
          </Auswahl>
        </label>
      )}

      {quellen.length === 0 ? (
        <p className="text-sm text-slate-500">{t('Bedingungen sind nur auf vorherige Punkte mit Antwort (i.O./n.i.O., Messwert, Ja/Nein, Auswahl) möglich.')}</p>
      ) : (
        <button type="button" className="btn-sekundaer"
          onClick={() => melde([...zeilen, { punkt: '', op: 'ist', werte: [], unter: '', ueber: '' }], verknuepfung)}>
          {t('+ Bedingung')}
        </button>
      )}
      {wert && blaetter(wert).every((b) => b.punkt) && <p className="text-xs text-slate-500">{vorspann} {bedingungsText(wert, alle)}.</p>}
    </fieldset>
  )
}
