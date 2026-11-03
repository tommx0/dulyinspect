import { useState } from 'react'
import { Formular, type FeldDef } from '../../components/Formular'
import type { ElementDefinition } from '../../lib/anlagenarten'
import { STUFEN, type Stufe } from '../../lib/checkliste'
import { elementEinzahl, elementName } from '../../lib/elemente'
import { grenzeText, messungenFuer, messwerteLesen, verstoesse, verstossText, type Messwerte } from '../../lib/messwerte'
import { elementErgebnisLoeschen, elementErgebnisSetzen } from '../../offline/aktionen'
import type { Element, ElementErgebnis, Mangel, Pruefung } from '../../offline/db'
import { t } from '../../lib/sprache'

/** „0,85“ oder „0.85“ → 0.85; leer oder unlesbar → null */
function zahlLesen(w: unknown): number | null {
  if (typeof w === 'number') return Number.isFinite(w) ? w : null
  const t = String(w ?? '').trim().replace(/\s/g, '').replace(',', '.')
  return t && /^-?\d*\.?\d+$/.test(t) ? Number(t) : null
}

/**
 * Messwerte und Sicht-/Funktionsprüfung eines Elements (Stromkreis, Gerät …) erfassen.
 * Liegt ein Wert außerhalb der Grenzwerte oder ist die Sichtprüfung nicht i.O., wird das Element „defekt“ mit Mangel.
 */
export function ElementMessung({ pruefung, def, element, ergebnis, maengel, defekt, onFertig }: {
  pruefung: Pruefung
  def: ElementDefinition
  element: Element
  ergebnis: ElementErgebnis | undefined
  maengel: Mangel[]
  /** über „defekt“ geöffnet: Sichtprüfung nicht vorbelegen */
  defekt: boolean
  onFertig: (fehler?: string) => void
}) {
  const messungen = messungenFuer(def, element)
  const bisher = messwerteLesen(ergebnis?.messwerte)
  const sichtBisher = ergebnis?.status === 'defekt' && ergebnis.grund && !ergebnis.grund.startsWith('Grenzwert') ? ergebnis.grund.split('; ')[0] : 'io'
  const start: Record<string, unknown> = {
    ...Object.fromEntries(messungen.map((m) => [`m.${m.schluessel}`, bisher[m.schluessel] != null ? String(bisher[m.schluessel]).replace('.', ',') : ''])),
    sicht: defekt && ergebnis?.status !== 'defekt' ? '' : sichtBisher,
    stufe: String(maengel.find((m) => m.id === ergebnis?.mangel_id)?.stufe ?? 2),
    bemerkung: ergebnis?.bemerkung ?? '',
  }
  const [werte, setWerte] = useState(start)

  const lesen = (w: Record<string, unknown>): Messwerte => Object.fromEntries(messungen
    .map((m) => [m.schluessel, zahlLesen(w[`m.${m.schluessel}`])] as const).filter(([, z]) => z != null)) as Messwerte
  const ausserhalb = verstoesse(messungen, lesen(werte))
  const unlesbar = messungen.filter((m) => String(werte[`m.${m.schluessel}`] ?? '').trim() && zahlLesen(werte[`m.${m.schluessel}`]) == null)
  const mangel = ausserhalb.length > 0 || (!!werte.sicht && werte.sicht !== 'io')

  const felder = (w: Record<string, unknown>): FeldDef[] => [
    ...messungen.map((m): FeldDef => ({
      name: `m.${m.schluessel}`, label: t('{text} ({kurz}) in {einheit}', { text: m.text, kurz: m.kurz, einheit: m.einheit }), dezimal: true,
      hinweis: [grenzeText(m) ? t('Grenzwert {wert}', { wert: grenzeText(m) }) : !m.hinweis && !m.richtwertText && t('ohne Grenzwert'),
        m.richtwertText && t('Richtwert {wert}', { wert: m.richtwertText }), m.hinweis].filter(Boolean).join(' · '),
    })),
    { name: 'sicht', label: t('Sicht- und Funktionsprüfung'), typ: 'select', pflicht: true, breit: true,
      optionen: [{ wert: 'io', text: t('i.O.') }, ...def.gruende.map((g) => ({ wert: g, text: t(g) }))] },
    ...(verstoesse(messungen, lesen(w)).length > 0 || (!!w.sicht && w.sicht !== 'io')
      ? [{ name: 'stufe', label: t('Mangelstufe'), typ: 'select', pflicht: true,
          optionen: ([1, 2, 3] as Stufe[]).map((s) => ({ wert: String(s), text: `${s} – ${STUFEN[s]}` })) } as FeldDef]
      : []),
    { name: 'bemerkung', label: t('Bemerkung'), breit: true },
  ]

  return (
    <Formular simulation
      felder={felder}
      start={start}
      onAenderung={setWerte}
      speichernText={mangel ? t('Als defekt speichern') : t('Als i.O. speichern')}
      zusatz={
        <div className="space-y-2">
          {unlesbar.length > 0 ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{t('Keine Zahl: {werte}', { werte: unlesbar.map((m) => m.kurz).join(', ') })}</p>
          ) : ausserhalb.length > 0 ? (
            <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" data-messung-ausserhalb>
              {t('Außerhalb Grenzwert: {werte}. {element} wird als defekt mit Mangel erfasst.', { werte: verstossText(ausserhalb), element: elementEinzahl(element, def) })}
            </p>
          ) : Object.keys(lesen(werte)).length > 0 && (
            <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">{t('Alle Messwerte im Grenzwert.')}</p>
          )}
          {ergebnis && (
            <button type="button" className="btn-sekundaer text-sm" onClick={() => void elementErgebnisLoeschen(pruefung, element.id)
              .then(() => onFertig(), (e: unknown) => onFertig(e instanceof Error ? e.message : String(e)))}>
              {t('Ergebnis zurücknehmen')}
            </button>
          )}
        </div>
      }
      onAbbrechen={() => onFertig()}
      onSpeichern={async (w) => {
        const nichtLesbar = messungen.filter((m) => w[`m.${m.schluessel}`] != null && zahlLesen(w[`m.${m.schluessel}`]) == null)
        if (nichtLesbar.length) return t('Bitte als Zahl eintragen: {werte}', { werte: nichtLesbar.map((m) => m.kurz).join(', ') })
        const messwerte = lesen(w)
        const v = verstoesse(messungen, messwerte)
        const sicht = String(w.sicht ?? 'io')
        const istDefekt = v.length > 0 || sicht !== 'io'
        const grund = [sicht !== 'io' && sicht, v.length > 0 && `Grenzwert nicht eingehalten: ${verstossText(v)}`].filter(Boolean).join('; ')
        await elementErgebnisSetzen(pruefung, element, istDefekt ? 'defekt' : 'io', {
          name: elementName(element, def), grund: istDefekt ? grund : null, bemerkung: (w.bemerkung as string | null) ?? null,
          stufe: Number(w.stufe ?? 2), messwerte,
        })
        onFertig()
      }}
    />
  )
}
