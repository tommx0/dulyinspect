import { useMemo, useState } from 'react'
import { eigenschaftenAusWerten, eigenschaftFelder, ersteFreieKnopf, typAusWerten, typFelder, typStart } from '../../components/elementFelder'
import { Formular } from '../../components/Formular'
import type { useGruppeAuswahl } from '../../components/GruppeAuswahl'
import { Fehler } from '../../components/ui'
import type { Eigenschaften, ElementDefinition } from '../../lib/anlagenarten'
import { elementName, elementVergleich, letzteGruppe, schreibweiseAngleichen, typenVorhanden } from '../../lib/elemente'
import type { CodeErgebnis } from '../../lib/herstellercode'
import { codeAnzeige } from '../../lib/melderCode'
import { fehlertext } from '../../lib/supabase'
import { t } from '../../lib/sprache'
import { elementAendern, elementAnlegen } from '../../offline/aktionen'
import type { Element } from '../../offline/db'

type Hersteller = CodeErgebnis

/**
 * Ein gescannter Code kommt in dieser Anlage noch nicht vor: einem Melder ohne Code zuweisen oder einen neuen Melder erfassen
 * (Erstinstallation). Modell und Seriennummer werden aus dem Code übernommen, soweit er sie enthält.
 */
export function MelderZuordnen({ scan, def, anlageId, elemente, gruppeAuswahl, onFertig }: {
  scan: Hersteller
  def: ElementDefinition
  anlageId: string
  elemente: Element[]
  /** Auswahl der Wohnung (Bereich …) mit „+ … anlegen …“ */
  gruppeAuswahl: ReturnType<typeof useGruppeAuswahl>
  onFertig: (element: Element) => void
}) {
  const aktiv = useMemo(() => elemente.filter((e) => e.aktiv), [elemente])
  const ohneCode = useMemo(() => aktiv.filter((e) => !e.code).sort(elementVergleich), [aktiv])
  const [modus, setModus] = useState<'neu' | 'vorhanden'>(ohneCode.length > 0 ? 'vorhanden' : 'neu')
  const [filter, setFilter] = useState('')
  const [auswahl, setAuswahl] = useState<Element | null>(null)
  const [fehler, setFehler] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  const [heute] = useState(() => new Date().toISOString().slice(0, 10))

  const typen = useMemo(() => typenVorhanden(elemente), [elemente])
  // Typ aus dem Code, in der Schreibweise eines schon vorhandenen
  const typ = schreibweiseAngleichen([scan.hersteller, scan.modell].filter(Boolean).join(' '), typen)
  // Die Wohnung des zuletzt erfassten Melders ist meist die richtige
  const letzte = useMemo(() => letzteGruppe(aktiv), [aktiv])

  const zuweisen = async () => {
    if (!auswahl) return
    setLaeuft(true)
    setFehler('')
    try {
      const eig = { ...(auswahl.eigenschaften as Eigenschaften) }
      if (scan.seriennummer && !eig.seriennummer) eig.seriennummer = scan.seriennummer
      await elementAendern(auswahl.id, { code: scan.code, typ: auswahl.typ ?? typ, eigenschaften: eig })
      onFertig({ ...auswahl, code: scan.code, typ: auswahl.typ ?? typ, eigenschaften: eig })
    } catch (e) {
      setFehler(fehlertext(e))
      setLaeuft(false)
    }
  }

  const trefferListe = ohneCode.filter((e) => `${e.gruppe ?? ''} ${e.nummer} ${e.ort ?? ''}`.toLowerCase().includes(filter.trim().toLowerCase()))

  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-md bg-slate-50 p-3">
        <div className="text-xs text-slate-500">{scan.quelle === 'eigen' ? t('Eigenes Melder-Etikett') : t('Code vom Hersteller')}</div>
        <div className="break-all font-mono">{codeAnzeige(scan.code)}</div>
        {(scan.modell || scan.seriennummer) && (
          <div className="mt-1 text-slate-600">{[scan.hersteller, scan.modell, scan.seriennummer && t('Seriennummer {nummer}', { nummer: scan.seriennummer })].filter(Boolean).join(' · ')}</div>
        )}
      </div>
      <p>{t('Dieser Code gehört noch zu keinem {einzahl} dieser Anlage.', { einzahl: def.einzahl })}</p>
      <div className="flex gap-2">
        <button type="button" aria-pressed={modus === 'vorhanden'} disabled={ohneCode.length === 0}
          className={modus === 'vorhanden' ? 'btn-primaer' : 'btn-sekundaer'} onClick={() => setModus('vorhanden')}>
          {t('Vorhandenem {einzahl} zuweisen ({n})', { einzahl: def.einzahl, n: ohneCode.length })}
        </button>
        <button type="button" aria-pressed={modus === 'neu'} className={modus === 'neu' ? 'btn-primaer' : 'btn-sekundaer'} onClick={() => setModus('neu')}>
          {t('Neuer {einzahl}', { einzahl: def.einzahl })}
        </button>
      </div>

      {modus === 'vorhanden' ? (
        <div className="space-y-2">
          {ohneCode.length > 5 && (
            <input type="search" className="mt-0" placeholder={t('{mehrzahl} ohne Code filtern …', { mehrzahl: def.mehrzahl })} value={filter}
              onChange={(e) => setFilter(e.target.value)} aria-label={t('{mehrzahl} ohne Code filtern', { mehrzahl: def.mehrzahl })} />
          )}
          <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200" data-ohne-code>
            {trefferListe.map((e) => (
              <li key={e.id}>
                <button type="button" aria-pressed={auswahl?.id === e.id} onClick={() => setAuswahl(e)}
                  className={`block w-full px-3 py-2 text-left hover:bg-akzent-hell ${auswahl?.id === e.id ? 'bg-akzent-hell' : ''}`}>
                  <div className="font-medium">{elementName(e, def)}</div>
                  <div className="text-xs text-slate-500">{[def.arten.find((a) => a.schluessel === e.elementart)?.name, e.ort].filter(Boolean).join(' · ')}</div>
                </button>
              </li>
            ))}
            {trefferListe.length === 0 && <li className="px-3 py-2 text-slate-500">{t('Kein Treffer.')}</li>}
          </ul>
          <Fehler text={fehler} />
          <div className="flex justify-end">
            <button className="btn-primaer" disabled={!auswahl || laeuft} onClick={() => void zuweisen()}>
              {auswahl ? t('Code {name} zuweisen', { name: elementName(auswahl, def) }) : t('Zuweisen')}
            </button>
          </div>
        </div>
      ) : (
        <Formular simulation
          felder={(w) => [
            gruppeAuswahl.feld(w.gruppe),
            { name: 'nummer', label: t('Nummer'), pflicht: true, hinweis: t('Vorschlag: erste freie Nummer der Wohnung'), knopf: ersteFreieKnopf(aktiv) },
            { name: 'elementart', label: t('Art'), typ: 'select', pflicht: true, optionen: def.arten.map((a) => ({ wert: a.schluessel, text: a.name })) },
            { name: 'ort', label: t('{ort} (Raum)', { ort: def.ort ?? t('Ort') }), breit: true },
            ...typFelder(def, w, typen),
            ...eigenschaftFelder(def.felder),
          ]}
          start={{
            gruppe: letzte, elementart: def.arten[0]?.schluessel,
            ...typStart(def, typ, true, typen), 'eig.seriennummer': scan.seriennummer, 'eig.einbau': heute,
          }}
          speichernText={t('{einzahl} anlegen', { einzahl: def.einzahl })}
          onSpeichern={async (w) => {
            const e = eigenschaftenAusWerten(def.felder, w)
            if ('fehler' in e) return e.fehler
            const gruppe = (w.gruppe as string | null) ?? null
            const nummer = String(w.nummer).trim()
            if (aktiv.some((x) => x.nummer === nummer && (x.gruppe ?? null) === gruppe)) return t('{einzahl} {nummer} gibt es in diesem {gruppe} schon.', { einzahl: def.einzahl, nummer, gruppe: def.gruppe })
            try {
              const neu = await elementAnlegen(anlageId, {
                nummer, gruppe, elementart: (w.elementart as string | null) ?? null, ort: (w.ort as string | null) ?? null,
                typ: typAusWerten(def, w, typen), code: scan.code, eigenschaften: e.eigenschaften,
              })
              onFertig(neu)
            } catch (x) {
              return fehlertext(x)
            }
          }} />
      )}
    </div>
  )
}
