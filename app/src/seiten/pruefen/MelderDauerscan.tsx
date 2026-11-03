import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { typStart, vorgabeAusWerten, vorgabeFelder, vorgabeText } from '../../components/elementFelder'
import { Formular } from '../../components/Formular'
import type { useGruppeAuswahl } from '../../components/GruppeAuswahl'
import { Badge } from '../../components/ui'
import type { Eigenschaften, ElementDefinition } from '../../lib/anlagenarten'
import { elementName, letzteGruppe, typenVorhanden, type ElementVorgabe } from '../../lib/elemente'
import type { CodeErgebnis } from '../../lib/herstellercode'
import { codeAnzeige } from '../../lib/melderCode'
import { fehlertext } from '../../lib/supabase'
import { t } from '../../lib/sprache'
import { elementAendern } from '../../offline/aktionen'
import { dauerscanVerarbeiten, type DauerEintrag } from '../../offline/dauerscan'
import type { Element, ElementErgebnis, Pruefung } from '../../offline/db'

const QrScanner = lazy(() => import('../../components/QrScanner'))

const STATUS: Record<ElementErgebnis['status'], string> = { io: t('i.O.'), defekt: t('defekt'), nicht_zugaenglich: t('nicht zugänglich') }
/** Nach „Weiter“ denselben Code so lange ignorieren – das Handy zeigt meist noch auf den eben erledigten Melder */
const SPERRE_MS = 4000

/** Vorgaben für neue Melder zu Beginn: erste Art, eingebaut heute */
function startVorgabe(def: ElementDefinition): { werte: Record<string, unknown>; vorgabe: ElementVorgabe } {
  const werte = { elementart: def.arten[0]?.schluessel, ...typStart(def, null, true), 'eig.einbau': new Date().toISOString().slice(0, 10) }
  // Ohne Monatsangabe gibt es keinen Fehler
  return { werte, vorgabe: vorgabeAusWerten(def, werte) as ElementVorgabe }
}

/**
 * Dauerscan: Melder nacheinander scannen. Nach jedem gelesenen Code hält die Kamera an und zeigt den Melder mit den Knöpfen
 * i.O. / defekt / n. zug. (war er heute schon geprüft, steht das dabei). Sobald das Ergebnis steht – oder der Prüfer auf
 * „Weiter“ tippt –, geht die Kamera für den nächsten Melder wieder an. Unbekannte Codes lassen sich sofort als neue Melder
 * anlegen (Erstinstallation) oder einzeln zuordnen.
 */
export function MelderDauerscan({ pruefung, def, elemente, gruppeAuswahl, ergebnisVon, nurLesen, statusKnoepfe, onZuordnen }: {
  pruefung: Pruefung
  def: ElementDefinition
  elemente: Element[]
  /** Auswahl der Wohnung der neuen Melder mit „+ … anlegen …“ */
  gruppeAuswahl: ReturnType<typeof useGruppeAuswahl>
  ergebnisVon: Map<string, ElementErgebnis>
  nurLesen: boolean
  /** Knöpfe i.O. / defekt / n. zug. für einen Melder (wie in der Liste); `danach` läuft, sobald das Ergebnis steht */
  statusKnoepfe: (e: Element, o?: { umschalten?: boolean; danach?: () => void }) => ReactNode
  /** Unbekannten Code einem Melder zuweisen (der Aufrufer schließt den Dauerscan und öffnet „Neuer Code“) */
  onZuordnen: (scan: CodeErgebnis) => void
}) {
  const aktiv = useMemo(() => elemente.filter((e) => e.aktiv), [elemente])
  const typen = useMemo(() => typenVorhanden(elemente), [elemente])
  const [eintraege, setEintraege] = useState<DauerEintrag[]>([])
  /** Zuletzt gelesener Code, der noch auf das Ergebnis wartet – solange ist die Kamera aus */
  const [aktuell, setAktuell] = useState<DauerEintrag | null>(null)
  const [anlegen, setAnlegen] = useState(() => !nurLesen && !aktiv.some((e) => e.code))
  const [wohnung, setWohnung] = useState(() => letzteGruppe(aktiv) ?? '')
  const [vorgabe, setVorgabe] = useState(() => startVorgabe(def))
  const [vorgabenOffen, setVorgabenOffen] = useState(false)
  const [sofortIo, setSofortIo] = useState(false)
  const [fehler, setFehler] = useState('')
  // In diesem Durchgang angelegte Melder: Die Liste der Anlage zieht erst nach, daher hier mitführen (sonst bekämen zwei schnelle Scans dieselbe Nummer)
  const neu = useRef<Element[]>([])
  const kette = useRef<Promise<void>>(Promise.resolve())
  const gesperrt = useRef<{ schluessel: string; bis: number } | null>(null)
  // Aktuelle Werte für den Rückruf der Kamera (er läuft außerhalb des Renderns und soll immer den neuesten Stand sehen)
  const optionen = useRef({ anlegen, wohnung, vorgabe: vorgabe.vorgabe, sofortIo })
  const stand = useRef({ elemente, pruefung, def, nurLesen })
  useEffect(() => {
    optionen.current = { anlegen, wohnung, vorgabe: vorgabe.vorgabe, sofortIo }
    stand.current = { elemente, pruefung, def, nurLesen }
  })

  // Codes nacheinander verarbeiten, auch wenn die Kamera schneller liest
  const beiScan = (inhalt: string) => {
    kette.current = kette.current.then(async () => {
      const s = stand.current
      const alle = [...s.elemente, ...neu.current.filter((n) => !s.elemente.some((e) => e.id === n.id))]
      try {
        const e = await dauerscanVerarbeiten(inhalt, {
          anlageId: s.pruefung.anlage_id, pruefung: s.pruefung, def: s.def, elemente: alle, nurLesen: s.nurLesen,
          anlegen: optionen.current.anlegen, wohnung: optionen.current.wohnung || null, vorgabe: optionen.current.vorgabe, sofortIo: optionen.current.sofortIo,
        })
        if (!e) return
        if (gesperrt.current && gesperrt.current.schluessel === e.schluessel && Date.now() < gesperrt.current.bis) return
        if (e.art === 'melder' && e.neu) neu.current.push(e.element)
        setFehler('')
        setEintraege((liste) => [e, ...liste.filter((x) => x.schluessel !== e.schluessel)])
        // Mit „gleich als i.O.“ steht das Ergebnis schon – weiterscannen; sonst hält die Kamera an, bis das Ergebnis getippt ist
        if (!(e.art === 'melder' && optionen.current.sofortIo && !s.nurLesen)) setAktuell(e)
      } catch (x) {
        setFehler(fehlertext(x))
      }
    })
  }

  /** Kamera wieder an – den eben erledigten Code kurz ignorieren */
  const weiter = () => {
    setAktuell((a) => {
      if (a) gesperrt.current = { schluessel: a.schluessel, bis: Date.now() + SPERRE_MS }
      return null
    })
  }

  const melder = eintraege.filter((e): e is Extract<DauerEintrag, { art: 'melder' }> => e.art === 'melder')
  const abgehakt = melder.filter((e) => ergebnisVon.has(e.element.id)).length
  const ohneDatum = melder.filter((e) => e.neu && !(e.element.eigenschaften as Eigenschaften).austausch).length
  const live = (e: Element) => elemente.find((x) => x.id === e.id) ?? e
  const artName = (e: Element) => def.arten.find((a) => a.schluessel === e.elementart)?.name

  return (
    <div className="space-y-4 text-sm" data-dauerscan>
      {aktuell ? (
        <div className="mx-auto max-w-sm space-y-3 rounded-lg border-2 border-akzent bg-amber-50 p-3" data-dauerscan-aktuell role="status">
          {aktuell.art === 'hinweis' && <p className="text-amber-900">{aktuell.text}</p>}
          {aktuell.art === 'unbekannt' && (
            <>
              <div className="font-semibold">{t('Unbekannter Code')}</div>
              <div className="break-all font-mono text-xs text-slate-600">{codeAnzeige(aktuell.code)}</div>
              <p className="text-slate-700">{t('Dieser Code gehört noch zu keinem {einzahl}.', { einzahl: def.einzahl })}</p>
            </>
          )}
          {aktuell.art === 'melder' && (() => {
            const e = live(aktuell.element)
            const r = ergebnisVon.get(e.id)
            return (
              <>
                <div>
                  <div className="text-xs font-medium uppercase text-amber-800">{t('Gescannt')}</div>
                  <div className="text-base font-semibold">{elementName(e, def)} {aktuell.neu && <Badge farbe="gruen">{t('neu angelegt')}</Badge>}</div>
                  <div className="text-slate-700">{[artName(e), e.ort].filter(Boolean).join(' · ')}</div>
                  <div className="break-all font-mono text-[11px] text-slate-500">{codeAnzeige(aktuell.code)}</div>
                </div>
                {r && <p className="font-medium text-slate-800" data-schon-geprueft>{t('Heute schon geprüft:')} {STATUS[r.status]}{r.status === 'defekt' && r.grund ? ` (${r.grund})` : ''}</p>}
                {aktuell.neu && !nurLesen && (
                  <input className="mt-0 py-1 text-sm" placeholder={t('Raum')} aria-label={t('Raum von {name}', { name: elementName(e, def) })} defaultValue={e.ort ?? ''}
                    onBlur={(ev) => { void elementAendern(e.id, { ort: ev.target.value.trim() || null }) }} />
                )}
                {!nurLesen && <p className="text-slate-700">{r ? t('Ergebnis ändern oder weiter zum nächsten Melder:') : t('Ergebnis antippen – danach geht die Kamera wieder an:')}</p>}
                {statusKnoepfe(e, { umschalten: false, danach: weiter })}
              </>
            )
          })()}
          <div className="flex flex-wrap gap-2">
            {aktuell.art === 'unbekannt' && !nurLesen && <button type="button" className="btn-primaer" onClick={() => onZuordnen(aktuell.scan)}>{t('Zuordnen …')}</button>}
            <button type="button" className="btn-sekundaer" onClick={weiter} data-dauerscan-weiter>{t('Weiter (nächsten scannen)')}</button>
          </div>
        </div>
      ) : (
        <div className="mx-auto max-w-xs">
          <Suspense fallback={<p className="text-slate-500">{t('Kamera wird vorbereitet …')}</p>}>
            <QrScanner roh eingabe fortlaufend onErkannt={beiScan} />
          </Suspense>
        </div>
      )}

      <fieldset className="space-y-2 rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-xs font-medium text-slate-500">{t('Einstellungen')}</legend>
        <label className="flex items-start gap-2 font-normal">
          <input type="checkbox" checked={anlegen} disabled={nurLesen} onChange={(e) => setAnlegen(e.target.checked)} className="mt-0.5" />
          <span>{t('Unbekannte Codes sofort als neue {mehrzahl} anlegen (Erstinstallation)', { mehrzahl: def.mehrzahl })}</span>
        </label>
        {anlegen && (
          <div className="ml-6">
            <label htmlFor="dauer-wohnung" className="text-xs">{t('{gruppe} der neuen {mehrzahl}', { gruppe: def.gruppe, mehrzahl: def.mehrzahl })}</label>
            {gruppeAuswahl.wahl('dauer-wohnung', wohnung, setWohnung)}
            <div className="mt-2 space-y-2" data-vorgaben>
              <p className="text-xs text-slate-600">{t('Vorgaben für neue {mehrzahl}: {vorgaben}', { mehrzahl: def.mehrzahl, vorgaben: vorgabeText(def, vorgabe.vorgabe) || t('keine') })}</p>
              {vorgabenOffen ? (
                <Formular simulation felder={(w) => vorgabeFelder(def, w, typen)} start={{ ...vorgabe.werte, ...typStart(def, vorgabe.vorgabe.typ, false, typen) }} speichernText={t('Vorgaben übernehmen')} onAbbrechen={() => setVorgabenOffen(false)}
                  zusatz={<p className="text-xs text-slate-500">{t('Code und Seriennummer kommen aus dem Scan, der Typ auch, wenn der Code ihn enthält.')}</p>}
                  onSpeichern={async (w) => {
                    const v = vorgabeAusWerten(def, w, typen)
                    if ('fehler' in v) return v.fehler
                    setVorgabe({ werte: w, vorgabe: v })
                    setVorgabenOffen(false)
                  }} />
              ) : (
                <button type="button" className="btn-sekundaer px-2 py-1 text-xs" onClick={() => setVorgabenOffen(true)}>{t('Vorgaben ändern …')}</button>
              )}
            </div>
          </div>
        )}
        <label className="flex items-start gap-2 font-normal">
          <input type="checkbox" checked={sofortIo} disabled={nurLesen} onChange={(e) => setSofortIo(e.target.checked)} className="mt-0.5" />
          <span>
            {t('Gescannte {mehrzahl} gleich als i.O. setzen (ohne Halt)', { mehrzahl: def.mehrzahl })}
            <span className="block text-xs text-red-700">{t('Nur ankreuzen, wenn der Testalarm bei jedem Melder schon ausgelöst wurde.')}</span>
          </span>
        </label>
      </fieldset>

      {fehler && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-800">{fehler}</p>}

      <div>
        <h3 className="font-semibold">
          {melder.length === 0 && eintraege.length === 0 ? t('Noch nichts gescannt')
            : t('{n} {elemente} gescannt, {abgehakt} abgehakt', { n: melder.length, elemente: melder.length === 1 ? def.einzahl : def.mehrzahl, abgehakt })}
        </h3>
        {ohneDatum > 0 && <p className="mt-1 text-xs text-amber-800">{t('Bei {n} neuen {mehrzahl} fehlt noch das Austauschdatum und der Raum (Melderliste).', { n: ohneDatum, mehrzahl: def.mehrzahl })}</p>}
        <ul className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200" data-dauerliste>
          {eintraege.map((e) => {
            if (e.art === 'hinweis') return <li key={e.schluessel} className="bg-amber-50 px-3 py-2 text-amber-900">{e.text}</li>
            if (e.art === 'unbekannt') {
              return (
                <li key={e.schluessel} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <div className="min-w-32 flex-1">
                    <div className="font-medium">{t('Unbekannter Code')}</div>
                    <div className="break-all font-mono text-xs text-slate-600">{codeAnzeige(e.code)}</div>
                  </div>
                  {!nurLesen && <button className="btn-sekundaer" onClick={() => onZuordnen(e.scan)}>{t('Zuordnen …')}</button>}
                </li>
              )
            }
            const el = live(e.element)
            const r = ergebnisVon.get(el.id)
            return (
              <li key={e.schluessel} className="flex flex-wrap items-center gap-2 px-3 py-2" data-gescannter-melder={el.nummer}>
                <div className="min-w-32 flex-1">
                  <div className="font-medium">{elementName(el, def)} {e.neu && <Badge farbe="gruen">{t('neu angelegt')}</Badge>}</div>
                  <div className="text-xs text-slate-500">{[artName(el), el.ort].filter(Boolean).join(' · ')}</div>
                </div>
                {r ? <Badge farbe={r.status === 'io' ? 'gruen' : r.status === 'defekt' ? 'rot' : 'grau'}>{STATUS[r.status]}</Badge> : <Badge farbe="gelb">{t('ohne Ergebnis')}</Badge>}
              </li>
            )
          })}
          {eintraege.length === 0 && <li className="px-3 py-2 text-slate-500">{t('Halten Sie das Handy vor einen Melder. Nach jedem Scan tippen Sie das Ergebnis, dann geht die Kamera wieder an.')}</li>}
        </ul>
      </div>
    </div>
  )
}
