import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react'
import { Formular } from '../../components/Formular'
import { useGruppeAuswahl } from '../../components/GruppeAuswahl'
import { ersteFreieKnopf, typAusWerten, typFelder, typStart } from '../../components/elementFelder'
import { datum, Dialog, Fehler } from '../../components/ui'
import type { Eigenschaften, ElementDefinition } from '../../lib/anlagenarten'
import { austauschStatus, austauschText } from '../../lib/austausch'
import { STUFEN, type Stufe } from '../../lib/checkliste'
import { altmaengelJeElement, elementEinzahl, elementName, elementVergleich, gebaeudeListe, gebaeudeVon, gruppenListe, lageText, typenVorhanden, type GruppeLage, type Vorschlag } from '../../lib/elemente'
import { etagenRang } from '../../lib/sortierung'
import { messungenFuer, messwerteKurz, messwerteLesen } from '../../lib/messwerte'
import { scanAuswerten, type CodeErgebnis } from '../../lib/herstellercode'
import { codeAnzeige } from '../../lib/melderCode'
import { fehlertext } from '../../lib/supabase'
import { t } from '../../lib/sprache'
import { codeSuchen, elementAnlegen, elementErgebnisLoeschen, elementErgebnisSetzen, elementeIo } from '../../offline/aktionen'
import type { Element, ElementErgebnis, Mangel, Pruefung } from '../../offline/db'
import { ElementMessung } from './ElementMessung'
import { MelderDauerscan } from './MelderDauerscan'
import { MelderZuordnen } from './MelderZuordnen'
import { Auswahl } from '../../components/Auswahl'

const QrScanner = lazy(() => import('../../components/QrScanner'))

type Anzeige = 'vorschlag' | 'alle' | 'offen'
const FARBE: Record<ElementErgebnis['status'], string> = {
  io: 'bg-green-600 text-white', defekt: 'bg-red-600 text-white', nicht_zugaenglich: 'bg-slate-500 text-white',
}

/** Abhak-Ansicht der Elemente einer Anlage (Leuchten, Melder …) in der Prüfung, auch offline. */
export function ElementePruefung({ pruefung, def, elemente, gruppen: lagen = [], gebaeude: startGebaeude, ergebnisse, maengel, vorschlag, teilpruefung, bestand = false, zyklus, nurLesen }: {
  pruefung: Pruefung
  def: ElementDefinition
  elemente: Element[]
  /** Vorab angelegte Gruppen (Wohnungen / Bereiche …) mit Gebäude und Etage */
  gruppen?: GruppeLage[]
  /** Nur die Elemente dieses Gebäudes zeigen ('' = ohne Gebäude), z. B. aus der Prüfliste eines Gebäudes */
  gebaeude?: string
  ergebnisse: ElementErgebnis[]
  maengel: Mangel[]
  vorschlag: Vorschlag
  /** Prüfart prüft nur einen Anteil je Termin */
  teilpruefung: boolean
  /** Bestand je Objekt: Pflicht sind nur die fälligen Elemente (der Vorschlag), z. B. beim Nachtermin */
  bestand?: boolean
  zyklus: number
  nurLesen: boolean
}) {
  // Bestand, in dem nicht alle Elemente fällig sind: zuerst nur die fälligen zeigen
  const nurFaellige = bestand && vorschlag.ids.size < vorschlag.gesamt
  const [wahl, setAnzeige] = useState<Anzeige | null>(null)
  const anzeige = wahl ?? (teilpruefung || nurFaellige ? 'vorschlag' : 'alle')
  const [suche, setSuche] = useState('')
  const angelegt = useMemo(() => lagen.map((g) => g.name), [lagen])
  // Gebäude aus der Lage der Gruppen; der Filter erscheint, sobald eine Gruppe ein Gebäude hat
  const gebaeudeAlle = useMemo(() => gebaeudeListe(elemente.filter((e) => e.aktiv), lagen), [elemente, lagen])
  const mitGebaeude = gebaeudeAlle.some(Boolean)
  const [gebaeudeWahl, setGebaeude] = useState<string | null>(null)
  const gebaeude = gebaeudeWahl ?? (startGebaeude !== undefined && gebaeudeAlle.includes(startGebaeude) ? startGebaeude : '*')
  const imGebaeude = (e: Element) => gebaeude === '*' || gebaeudeVon(e.gruppe, lagen) === gebaeude
  const lageVon = (gruppe: string) => lagen.find((g) => g.name === gruppe)
  const [defekt, setDefekt] = useState<Element | null>(null)
  const [messen, setMessen] = useState<{ element: Element; defekt: boolean } | null>(null)
  const [neu, setNeu] = useState(false)
  const [fehler, setFehler] = useState('')
  const [scannen, setScannen] = useState(false)
  const [dauer, setDauer] = useState(false)
  const [fokusId, setFokusId] = useState<string | null>(null)
  const [hinweis, setHinweis] = useState('')
  const [neuerCode, setNeuerCode] = useState<CodeErgebnis | null>(null)
  const [heute] = useState(() => new Date().toISOString().slice(0, 10))
  const ergebnisVon = useMemo(() => new Map(ergebnisse.map((e) => [e.element_id, e])), [ergebnisse])
  // Offene Mängel aus früheren Prüfungen: diese Elemente sind nachzuprüfen
  const altmangel = useMemo(() => altmaengelJeElement(maengel, pruefung.id), [maengel, pruefung.id])

  const aktiv = useMemo(() => elemente.filter((e) => e.aktiv).sort(elementVergleich), [elemente])
  const typen = useMemo(() => typenVorhanden(elemente), [elemente])
  // Eine hier neu angelegte Gruppe gilt bis zum ersten Element darin; die Datenbank trägt sie dann in die Liste ein (auch offline)
  const gruppeAuswahl = useGruppeAuswahl(def.gruppe, useMemo(() => gruppenListe(angelegt, elemente), [angelegt, elemente]))
  const sichtbar = aktiv.filter((e) => imGebaeude(e) &&
    (anzeige === 'alle' || (anzeige === 'vorschlag' ? vorschlag.ids.has(e.id) || ergebnisVon.has(e.id) : !ergebnisVon.has(e.id))) &&
    (!suche.trim() || `${e.gruppe ?? ''} ${e.nummer} ${e.ort ?? ''} ${e.code ?? ''}`.toLowerCase().includes(suche.trim().toLowerCase())))
  const gruppen = useMemo(() => {
    const m = new Map<string, Element[]>()
    for (const e of sichtbar) m.set(e.gruppe ?? '', [...(m.get(e.gruppe ?? '') ?? []), e])
    const liste = [...m.entries()]
    if (!mitGebaeude) return liste
    // Nach Gebäude, Etage (von unten nach oben) und Name; ohne Gebäude zuletzt
    const schluessel = (g: string) => { const l = lagen.find((x) => x.name === g); return { geb: l?.gebaeude?.trim() ?? '', etage: l?.etage ?? null } }
    return liste.sort(([a], [b]) => {
      const x = schluessel(a), y = schluessel(b)
      if (x.geb !== y.geb) return !x.geb ? 1 : !y.geb ? -1 : x.geb.localeCompare(y.geb, 'de', { numeric: true })
      return etagenRang(x.etage) - etagenRang(y.etage) || a.localeCompare(b, 'de', { numeric: true })
    })
  }, [sichtbar, mitGebaeude, lagen])
  // Stand im gewählten Gebäude
  const imFilter = gebaeude === '*' ? null : aktiv.filter(imGebaeude).filter((e) => !nurFaellige || vorschlag.ids.has(e.id))
  const erledigt = aktiv.filter((e) => ergebnisVon.has(e.id) && (!nurFaellige || vorschlag.ids.has(e.id))).length
  const nochUeberfaellig = [...vorschlag.ueberfaelligIds].filter((id) => !ergebnisVon.has(id)).length
  const nochNachzupruefen = aktiv.filter((e) => altmangel.has(e.id) && !ergebnisVon.has(e.id)).length
  const soll = teilpruefung || nurFaellige ? vorschlag.ids.size : aktiv.length

  const ausfuehren = async (f: () => Promise<void>) => {
    setFehler('')
    try { await f() } catch (e) { setFehler(e instanceof Error ? e.message : String(e)) }
  }
  // Elemente mit Messungen (Stromkreise, Geräte): i.O. und defekt öffnen die Messwerte, ein erneutes Tippen auf i.O. auch
  const mitMessung = (e: Element) => messungenFuer(def, e).length > 0
  // Nach einem Dialog (defekt, Messung) weitermachen – der Dauerscan schaltet dann die Kamera wieder ein
  const nachDialog = useRef<(() => void) | null>(null)
  const dialogZu = () => { const f = nachDialog.current; nachDialog.current = null; f?.() }
  /**
   * Ergebnis eines Elements setzen. In der Liste schaltet ein erneutes Tippen auf denselben Status das Ergebnis wieder aus;
   * im Dauerscan nicht (`umschalten` false). `danach` läuft, sobald das Ergebnis steht bzw. der Dialog zu ist.
   */
  const setzen = (e: Element, status: ElementErgebnis['status'], o: { umschalten?: boolean; danach?: () => void } = {}) => {
    const umschalten = o.umschalten ?? true
    if (status !== 'nicht_zugaenglich' && mitMessung(e)) { nachDialog.current = o.danach ?? null; return setMessen({ element: e, defekt: status === 'defekt' }) }
    if (status === 'defekt') { nachDialog.current = o.danach ?? null; return setDefekt(e) }
    const bisher = ergebnisVon.get(e.id)
    void ausfuehren(() => umschalten && bisher?.status === status
      ? elementErgebnisLoeschen(pruefung, e.id)
      : elementErgebnisSetzen(pruefung, e, status, { name: elementName(e, def) })).then(() => o.danach?.())
  }

  // stabil halten – der Scanner startet die Kamera bei jeder neuen Funktion neu
  const erkannt = useCallback(async (inhalt: string) => {
    setScannen(false)
    setHinweis('')
    const r = scanAuswerten(inhalt)
    if (r.art === 'leer') return
    if (r.art === 'etikett') return setHinweis(t('{etikett} ist ein Etikett einer Anlage, kein Code eines {einzahl}s.', { etikett: r.etikett, einzahl: def.einzahl }))
    try {
      const treffer = await codeSuchen(r.code)
      if (!treffer) return setNeuerCode(r)
      if (treffer.anlageId !== pruefung.anlage_id) {
        const werte = { einzahl: def.einzahl, nummer: treffer.nummer, gruppe: def.gruppe, name: treffer.gruppe, anlage: treffer.anlage || t('andere Anlage') }
        return setHinweis(treffer.gruppe
          ? t('Dieser Code gehört zu {einzahl} {nummer} ({gruppe} {name}) in der Anlage „{anlage}“, nicht zu dieser.', werte)
          : t('Dieser Code gehört zu {einzahl} {nummer} in der Anlage „{anlage}“, nicht zu dieser.', werte))
      }
      setFokusId(treffer.elementId)
    } catch (e) {
      setHinweis(fehlertext(e))
    }
  }, [def, pruefung.anlage_id])
  const beiScan = useCallback((inhalt: string) => { void erkannt(inhalt) }, [erkannt])

  const fokus = fokusId ? aktiv.find((e) => e.id === fokusId) : undefined
  const austausch = (e: Element) => ((e.eigenschaften ?? {}) as Eigenschaften).austausch
  const austauschHinweis = (e: Element) => {
    const datum = austausch(e)
    const status = austauschStatus(datum, heute)
    return status === 'ok' ? null : { status, text: austauschText(datum as string, status) }
  }
  /** Mangel aus einer früheren Prüfung: was war, und was das Ergebnis heute damit macht */
  const mangelHinweis = (e: Element) => {
    const m = altmangel.get(e.id)
    if (!m) return null
    const r = ergebnisVon.get(e.id)
    return (
      <div className="text-xs font-medium text-red-700" data-altmangel={m.id}>
        {t('Mangel seit {datum}:', { datum: datum(m.erstellt_am) })} {m.beschreibung}
        {m.status === 'behoben' && ` · ${t('als behoben gemeldet')}`}
        {' – '}{!r ? t('bitte nachprüfen') : r.status === 'io' ? t('behoben ✓') : t('besteht weiter')}
      </div>
    )
  }
  const statusKnoepfe = (e: Element, o: { umschalten?: boolean; danach?: () => void } = {}) => {
    const r = ergebnisVon.get(e.id)
    return (
      <div className="flex gap-1">
        {(['io', 'defekt', 'nicht_zugaenglich'] as const).map((s) => (
          <button key={s} type="button" disabled={nurLesen} aria-pressed={r?.status === s} onClick={() => setzen(e, s, o)}
            className={`btn px-3 py-2 text-sm ${r?.status === s ? FARBE[s] : 'border border-slate-300 bg-white text-slate-700'}`}>
            {s === 'io' ? t('i.O.') : s === 'defekt' ? t('defekt') : t('n. zug.')}
          </button>
        ))}
      </div>
    )
  }

  return (
    <section className="karte" data-elemente>
      <div className="space-y-2 border-b border-slate-100 px-4 py-3">
        <h2 className="font-semibold">{def.mehrzahl}</h2>
        <p className="text-sm text-slate-600" data-elemente-stand>
          {nurFaellige ? t('{n} von {m} fälligen geprüft', { n: erledigt, m: soll }) : t('{n} von {m} geprüft', { n: erledigt, m: soll })}
          {teilpruefung && ` · ${t('heute {n} von {m} vorgeschlagen', { n: vorschlag.ids.size, m: vorschlag.gesamt })}`}
          {nurFaellige && ` · ${t('{n} nicht fällig (dürfen mitgeprüft werden)', { n: vorschlag.gesamt - vorschlag.ids.size })}`}
          {!bestand && nochUeberfaellig > 0 && ` · ${t('{n} seit über {monate} Monaten nicht geprüft', { n: nochUeberfaellig, monate: zyklus })}`}
          {nochNachzupruefen > 0 && <span className="font-medium text-red-700" data-nachpruefen-stand>{` · ${t('{n} mit offenem Mangel nachprüfen', { n: nochNachzupruefen })}`}</span>}
          {imFilter && ` · ${gebaeude || t('ohne Gebäude')}: ${t('{n} von {m}', { n: imFilter.filter((e) => ergebnisVon.has(e.id)).length, m: imFilter.length })}`}
        </p>
        {def.codes && !nurLesen && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primaer w-full py-3 sm:w-auto" onClick={() => { setHinweis(''); setScannen(true) }}>
              {t('{einzahl} scannen', { einzahl: def.einzahl })}
            </button>
            <button type="button" className="btn-sekundaer w-full py-3 sm:w-auto" onClick={() => { setHinweis(''); setDauer(true) }} data-dauerscan-start>
              {t('Dauerscan')}
            </button>
          </div>
        )}
        {hinweis && <p role="status" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-scan-hinweis>{hinweis}</p>}
        {aktiv.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <input type="search" className="mt-0 max-w-48" placeholder={t('Nummer suchen …')} value={suche} onChange={(e) => setSuche(e.target.value)}
              aria-label={t('{einzahl} suchen', { einzahl: def.einzahl })} />
            <Auswahl className="mt-0 w-auto" value={anzeige} onChange={(e) => setAnzeige(e.target.value as Anzeige)} aria-label={t('Anzeige')}>
              {teilpruefung && <option value="vorschlag">{t('Vorschlag für heute')}</option>}
              {nurFaellige && <option value="vorschlag">{t('fällige {mehrzahl}', { mehrzahl: def.mehrzahl })}</option>}
              <option value="alle">{t('alle {mehrzahl}', { mehrzahl: def.mehrzahl })}</option>
              <option value="offen">{t('ohne Ergebnis')}</option>
            </Auswahl>
            {mitGebaeude && (
              <Auswahl className="mt-0 w-auto" value={gebaeude} onChange={(e) => setGebaeude(e.target.value)} aria-label={t('Gebäude')}>
                <option value="*">{t('alle Gebäude')}</option>
                {gebaeudeAlle.map((g) => <option key={g} value={g}>{g || t('ohne Gebäude')}</option>)}
              </Auswahl>
            )}
          </div>
        )}
        {aktiv.length === 0 && <p className="text-sm text-amber-800">{t('Für diese Anlage sind noch keine {mehrzahl} erfasst.', { mehrzahl: def.mehrzahl })}</p>}
        <Fehler text={fehler} />
      </div>

      {fokus && (
        <div className="space-y-2 border-b border-amber-200 bg-amber-50 px-4 py-3" data-gescannt>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-medium uppercase text-amber-800">{t('Gescannt')}</div>
              <div className="font-semibold">{elementName(fokus, def)}</div>
              <div className="text-sm text-slate-700">{[def.arten.find((a) => a.schluessel === fokus.elementart)?.name, fokus.ort].filter(Boolean).join(' · ')}</div>
              <div className="text-xs text-slate-600">
                {[fokus.code && t('Code {code}', { code: codeAnzeige(fokus.code) }), austausch(fokus) && t('Austausch {datum}', { datum: `${String(austausch(fokus)).slice(5, 7)}-${String(austausch(fokus)).slice(0, 4)}` })].filter(Boolean).join(' · ')}
              </div>
              {mangelHinweis(fokus)}
              {austauschHinweis(fokus) && (
                <div className={`text-sm font-medium ${austauschHinweis(fokus)!.status === 'abgelaufen' ? 'text-red-700' : 'text-amber-800'}`}>
                  {austauschHinweis(fokus)!.text} – {austauschHinweis(fokus)!.status === 'abgelaufen' ? t('{einzahl} jetzt ersetzen.', { einzahl: def.einzahl }) : t('{einzahl} zum Austausch vormerken.', { einzahl: def.einzahl })}
                </div>
              )}
            </div>
            <button type="button" className="btn-sekundaer px-2 py-1 text-sm" onClick={() => setFokusId(null)} aria-label={t('Schließen')}>✕</button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {statusKnoepfe(fokus)}
            {!nurLesen && <button type="button" className="btn-sekundaer" onClick={() => { setHinweis(''); setScannen(true) }}>{t('Nächsten scannen')}</button>}
          </div>
        </div>
      )}

      {gruppen.map(([gruppe, liste]) => {
        const offen = liste.filter((e) => !ergebnisVon.has(e.id))
        // „Alle i.O.“ nur für Elemente ohne Messungen – gemessen wird einzeln; mit offenem Mangel wird einzeln nachgeprüft
        const ohneMessung = offen.filter((e) => !mitMessung(e) && !altmangel.has(e.id))
        return (
          <div key={gruppe} data-gruppe={gruppe}>
            <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-4 py-2 text-sm">
              <span className="font-medium">{gruppe ? `${def.gruppe} ${gruppe}` : t('Ohne {gruppe}', { gruppe: def.gruppe })}
                {lageText(lageVon(gruppe)) && <span className="font-normal text-slate-500"> · {lageText(lageVon(gruppe))}</span>}</span>
              <span className="flex items-center gap-2">
                <span className="text-slate-500">{liste.length - offen.length}/{liste.length}</span>
                {!nurLesen && ohneMessung.length > 0 && (
                  <button className="btn-sekundaer px-2 py-1 text-sm" onClick={() => void ausfuehren(() => elementeIo(pruefung, ohneMessung))}>
                    {t('Alle i.O. ({n})', { n: ohneMessung.length })}
                  </button>
                )}
              </span>
            </div>
            <ul className="divide-y divide-slate-100">
              {liste.map((e) => {
                const r = ergebnisVon.get(e.id)
                const art = def.arten.find((a) => a.schluessel === e.elementart)?.name
                return (
                  <li key={e.id} className={`flex flex-wrap items-center gap-2 px-4 py-2 ${e.id === fokusId ? 'bg-amber-50' : altmangel.has(e.id) && !r ? 'bg-red-50' : ''}`} data-element={e.nummer}>
                    <div className="min-w-32 flex-1">
                      <div className="font-medium">{elementEinzahl(e, def)} {e.nummer}</div>
                      <div className="text-xs text-slate-500">{[art, e.ort].filter(Boolean).join(' · ')}</div>
                      {def.codes && !e.code && <div className="text-xs text-slate-400">{t('noch ohne Code')}</div>}
                      {austauschHinweis(e) && (
                        <div className={`text-xs font-medium ${austauschHinweis(e)!.status === 'abgelaufen' ? 'text-red-700' : 'text-amber-800'}`}>{austauschHinweis(e)!.text}</div>
                      )}
                      {r && messwerteKurz(messungenFuer(def, e), messwerteLesen(r.messwerte)) && (
                        <div className="text-xs text-slate-600" data-messwerte>{messwerteKurz(messungenFuer(def, e), messwerteLesen(r.messwerte))}</div>
                      )}
                      {mangelHinweis(e)}
                      {r?.status === 'defekt' && <div className="text-xs text-red-700">{r.grund}{r.bemerkung ? ` – ${r.bemerkung}` : ''}</div>}
                    </div>
                    {statusKnoepfe(e)}
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}

      {!nurLesen && (
        <div className="px-4 py-3">
          <button className="btn-sekundaer" onClick={() => setNeu(true)}>+ {t('{einzahl} erfassen', { einzahl: def.einzahl })}</button>
        </div>
      )}

      <Dialog offen={scannen} titel={t('{einzahl} scannen', { einzahl: def.einzahl })} onSchliessen={() => setScannen(false)}>
        {scannen && (
          <Suspense fallback={<p className="text-sm text-slate-500">{t('Kamera wird vorbereitet …')}</p>}>
            <QrScanner roh eingabe onErkannt={beiScan} />
          </Suspense>
        )}
      </Dialog>

      <Dialog offen={dauer} titel={t('Dauerscan')} onSchliessen={() => setDauer(false)}>
        {dauer && (
          <MelderDauerscan pruefung={pruefung} def={def} elemente={elemente} gruppeAuswahl={gruppeAuswahl} ergebnisVon={ergebnisVon} nurLesen={nurLesen} statusKnoepfe={statusKnoepfe}
            onZuordnen={(scan) => { setDauer(false); setNeuerCode(scan) }} />
        )}
      </Dialog>

      <Dialog offen={neuerCode !== null} titel={t('Neuer Code')} onSchliessen={() => setNeuerCode(null)}>
        {neuerCode && (
          <MelderZuordnen scan={neuerCode} def={def} anlageId={pruefung.anlage_id} elemente={elemente} gruppeAuswahl={gruppeAuswahl}
            onFertig={(e) => { setNeuerCode(null); setFokusId(e.id) }} />
        )}
      </Dialog>

      <Dialog offen={messen !== null} titel={messen ? t('{name} – Messung', { name: elementName(messen.element, def) }) : ''} onSchliessen={() => { setMessen(null); dialogZu() }} breit>
        {messen && (
          <ElementMessung key={messen.element.id} pruefung={pruefung} def={def} element={messen.element} ergebnis={ergebnisVon.get(messen.element.id)}
            maengel={maengel} defekt={messen.defekt} onFertig={(f) => { setMessen(null); if (f) setFehler(f); dialogZu() }} />
        )}
      </Dialog>

      <Dialog offen={defekt !== null} titel={defekt ? t('{name} defekt', { name: elementName(defekt, def) }) : ''} onSchliessen={() => { setDefekt(null); dialogZu() }}>
        {defekt && (
          <Formular simulation
            felder={[
              { name: 'grund', label: t('Grund'), typ: 'select', pflicht: true, optionen: def.gruende.map((g) => ({ wert: g, text: t(g) })) },
              { name: 'stufe', label: t('Mangelstufe'), typ: 'select', pflicht: true,
                optionen: ([1, 2, 3] as Stufe[]).map((s) => ({ wert: String(s), text: `${s} – ${STUFEN[s]}` })) },
              { name: 'bemerkung', label: t('Bemerkung'), breit: true },
            ]}
            start={{
              grund: ergebnisVon.get(defekt.id)?.grund ?? '',
              stufe: String(maengel.find((m) => m.id === (ergebnisVon.get(defekt.id)?.mangel_id ?? altmangel.get(defekt.id)?.id))?.stufe ?? 2),
              bemerkung: ergebnisVon.get(defekt.id)?.bemerkung ?? '',
            }}
            zusatz={<p className="text-sm text-slate-600">{t('Der Defekt wird als Mangel erfasst. Fotos ergänzen Sie unten unter „Weitere Mängel“.')}</p>}
            onAbbrechen={() => { setDefekt(null); dialogZu() }}
            onSpeichern={async (w) => {
              const e = defekt
              setDefekt(null)
              await ausfuehren(() => elementErgebnisSetzen(pruefung, e, 'defekt', {
                name: elementName(e, def), grund: w.grund as string, bemerkung: w.bemerkung as string | null, stufe: Number(w.stufe),
              }))
              dialogZu()
            }}
          />
        )}
      </Dialog>

      <Dialog offen={neu} titel={t('{einzahl} erfassen', { einzahl: def.einzahl })} onSchliessen={() => setNeu(false)}>
        {neu && (
          <Formular simulation
            felder={(w) => [
              gruppeAuswahl.feld(w.gruppe),
              { name: 'nummer', label: t('Nummer'), pflicht: true, knopf: ersteFreieKnopf(aktiv) },
              { name: 'elementart', label: t('Art'), typ: 'select', optionen: def.arten.map((a) => ({ wert: a.schluessel, text: a.name })) },
              { name: 'ort', label: def.ort ?? t('Ort'), breit: true },
              ...typFelder(def, w, typen),
            ]}
            start={{ elementart: def.arten[0]?.schluessel, ...typStart(def, null, true, typen) }}
            onAbbrechen={() => setNeu(false)}
            onSpeichern={async (w) => {
              const nummer = String(w.nummer).trim()
              const gruppe = (w.gruppe as string | null) ?? null
              if (elemente.some((e) => e.aktiv && e.nummer === nummer && (e.gruppe ?? null) === gruppe)) return t('{einzahl} {nummer} gibt es schon.', { einzahl: def.einzahl, nummer })
              await elementAnlegen(pruefung.anlage_id, { nummer, gruppe, elementart: (w.elementart as string | null) ?? null, ort: (w.ort as string | null) ?? null,
                typ: typAusWerten(def, w, typen) })
              setNeu(false)
            }}
          />
        )}
      </Dialog>
      {gruppeAuswahl.dialog}
    </section>
  )
}
