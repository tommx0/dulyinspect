// Protokollansicht der Prüfung: die Prüfpunkte auf einem Blatt im Aufbau des PDF-Protokolls (protokoll/pdfDoc.ts) – angekreuzt
// und eingetragen wird direkt im Protokoll. Die Wahl zwischen Liste und Protokoll gilt je Gerät (usePruefAnsicht).
import { useLiveQuery } from 'dexie-react-hooks'
import { Camera, Check, FileText, List, Minus, X } from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Auswahl } from '../../components/Auswahl'
import { bestaetigen } from '../../components/Bestaetigung'
import { Fotos } from '../../components/Fotos'
import { datum } from '../../components/ui'
import { BLATT_BESCHRIFTUNG_BREITE, BLATT_ERGEBNIS_BREITE, type PruefAnsicht } from '../../lib/ansicht'
import { artDefinition, feldText, type Eigenschaften, type ElementDefinition } from '../../lib/anlagenarten'
import { istBestandArt } from '../../lib/bestand'
import { STUFEN, type Punkt, type Stufe } from '../../lib/checkliste'
import { elementName } from '../../lib/elemente'
import { appName, logoPdfUrl, useErscheinungsbild } from '../../lib/erscheinungsbild'
import { DIREKTE_ADRESSE, etikettAnzeige, qrInhalt } from '../../lib/etikett'
import { eigenerMandantencode } from '../../lib/mandantencode'
import type { Ampel, AntwortWert } from '../../lib/pruefung'
import { gebietsschema, t } from '../../lib/sprache'
import { supabase } from '../../lib/supabase'
import { entschluesseln } from '../../lib/verschluesselung'
import { altmangelEntscheiden, antwortSetzen, mangelAendern, mangelAnlegen, mangelLoeschen } from '../../offline/aktionen'
import { db, type Anlage, type Antwort, type Element, type Mangel, type Pruefart, type Pruefung } from '../../offline/db'
import { antwortText } from '../../protokoll/pdfDoc'
import { AMPEL_TEXT } from './ampel'

/** Umschalter Liste / Protokoll über der Prüfung (zusammen mit usePruefAnsicht). */
export function PruefAnsichtWahl({ wert, onWechsel }: { wert: PruefAnsicht; onWechsel: (a: PruefAnsicht) => void }) {
  const knopf = (a: PruefAnsicht, text: string, titel: string, Bild: typeof List) => (
    <button type="button" onClick={() => onWechsel(a)} aria-pressed={wert === a} title={titel}
      className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm font-semibold transition ${wert === a ? 'bg-marke text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-marke'}`}>
      <Bild className="size-4" strokeWidth={2} aria-hidden />{text}
    </button>
  )
  return (
    <div role="group" aria-label={t('Ansicht der Prüfung')} className="inline-flex shrink-0 gap-0.5 rounded-md border border-slate-300 bg-white p-0.5 shadow-sm">
      {knopf('liste', t('Liste'), t('Prüfpunkte als Liste zeigen'), List)}
      {knopf('protokoll', t('Protokoll'), t('Prüfpunkte als Protokoll zeigen'), FileText)}
    </div>
  )
}

type Firma = {
  name: string; strasse: string | null; plz: string | null; ort: string | null; telefon: string | null; email: string | null; web: string | null
  /** Spaltenbreiten des Blatts in Prozent (Einstellungen → Prüfungen → Ansicht der Prüfung); fehlen im alten Zwischenspeicher */
  blatt_beschriftung_breite?: number; blatt_ergebnis_breite?: number
}
const FIRMA_CACHE = 'tuerpruefung:firma'

/** Briefkopf wie im PDF; offline der zuletzt geladene Stand. */
function useFirma(): Firma | null {
  const [firma, setFirma] = useState<Firma | null>(() => {
    try { return JSON.parse(localStorage.getItem(FIRMA_CACHE) ?? 'null') } catch { return null }
  })
  useEffect(() => {
    let aktiv = true
    void supabase.from('firma').select('name, strasse, plz, ort, telefon, email, web, blatt_beschriftung_breite, blatt_ergebnis_breite').maybeSingle().then(({ data }) => {
      if (!aktiv || !data) return
      setFirma(data)
      try { localStorage.setItem(FIRMA_CACHE, JSON.stringify(data)) } catch { /* Speicher gesperrt */ }
    })
    return () => { aktiv = false }
  }, [])
  return firma
}

const adresse = (x: { strasse: string | null; plz: string | null; ort: string | null }) =>
  [x.strasse, [x.plz, x.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')
const zeit = (d: string) => new Date(d).toLocaleString(gebietsschema(), { dateStyle: 'medium', timeStyle: 'short' })
// Farben wie im PDF (FARBE in pdfDoc.ts)
const ERGEBNIS_FARBE: Record<Ampel, string> = { gruen: 'border-green-700 text-green-700', gelb: 'border-amber-700 text-amber-700', rot: 'border-red-700 text-red-700' }

export function ProtokollBlatt({
  pruefung, anlage, typName, typArt, pruefart, version, abschnitte, antworten, neueMaengel, altMaengel, altEntscheidungen, ergebnis,
  pruefer, nummer, abgeschlossen, teilVon, elemente, elementDef, elementListe = [], nurLesen, darfAltmaengel, onSetze, onAnlagendaten, children,
}: {
  pruefung: Pruefung
  anlage: Anlage
  typName?: string
  typArt?: string | null
  pruefart?: Pruefart
  /** Version der Checkliste */
  version: number
  /** Sichtbare Prüfpunkte je Abschnitt, mit den Wirkungen dieser Prüfung */
  abschnitte: [string, Punkt[]][]
  antworten: Record<string, Antwort>
  neueMaengel: Mangel[]
  altMaengel: Mangel[]
  altEntscheidungen: NonNullable<Pruefung['altmaengel']>
  /** Laufend: wie es abgeschlossen würde (automatisch bzw. verschärft); sonst das Ergebnis der Prüfung */
  ergebnis: Ampel
  /** Prüfer mit Mitprüfern, wie im Protokoll */
  pruefer: string
  /** Protokollnummer (bei einer Tür die der Türanlage), sobald vergeben */
  nummer?: string | null
  /** Protokoll ist abgeschlossen (bei einer Tür: die Türanlage) */
  abgeschlossen: boolean
  /** Tür einer Türanlage: deren Name */
  teilVon?: string
  /** Abhak-Ansicht der Elemente (Leuchten, Melder …) */
  elemente?: ReactNode
  elementDef?: ElementDefinition
  elementListe?: Element[]
  nurLesen: boolean
  /** Mängel aus früheren Prüfungen entscheidet nur der Hauptprüfer */
  darfAltmaengel: boolean
  onSetze: (p: Punkt, w: AntwortWert) => void
  /** Anlagendaten ergänzen (Dialog der Prüfseite) */
  onAnlagendaten?: () => void
  /** Ergebnis, Unterschrift und Abschluss am Ende des Blatts */
  children?: ReactNode
}) {
  const bild = useErscheinungsbild()
  const firma = useFirma()
  const blatt = useRef<HTMLElement>(null)
  const art = artDefinition(typArt)
  const bestand = istBestandArt(typArt)
  const ort = useLiveQuery(async () => {
    try {
      const objekt = await entschluesseln('objekt', await db.objekte.get(anlage.objekt_id))
      const kunde = objekt?.endkunde_id ? await entschluesseln('endkunde', await db.kunden.get(objekt.endkunde_id)) : undefined
      return { objekt, kunde }
    } catch { return {} }
  }, [anlage.objekt_id])

  // QR-Code des Etiketts wie im PDF (Papier scannen → Anlage in der App öffnen)
  const etikett = anlage.etikett_id
  const [qr, setQr] = useState<{ fuer: string; url: string } | null>(null)
  useEffect(() => {
    if (!etikett) return
    let aktiv = true
    QRCode.toDataURL(qrInhalt(DIREKTE_ADRESSE, etikett, eigenerMandantencode()), { margin: 1, width: 160 })
      .then((url) => { if (aktiv) setQr({ fuer: etikett, url }) }).catch(() => undefined)
    return () => { aktiv = false }
  }, [etikett])
  const qrBild = qr && qr.fuer === etikett ? qr.url : null

  const laufend = pruefung.status === 'in_pruefung'
  const nichtGeprueft = pruefung.status === 'nicht_geprueft'
  const fehlt = <span className="text-amber-700">{t('nicht erfasst')}</span>
  const eigenschaften = (anlage.eigenschaften ?? {}) as Eigenschaften
  const lage = [[anlage.gebaeude, anlage.etage, anlage.raum].filter(Boolean).join(' / '), anlage.lage_beschreibung].filter(Boolean).join(' · ')
  const hersteller = [anlage.hersteller, anlage.modell, anlage.baujahr && t('Bj. {jahr}', { jahr: anlage.baujahr })].filter(Boolean).join(' · ')
  const objekt = ort?.objekt
  const daten: [string, ReactNode][] = [
    [t('Kunde'), ort?.kunde ? [ort.kunde.name, adresse(ort.kunde)].filter(Boolean).join(', ') : '–'],
    [art.einzahl, [etikett ?? (bestand ? null : t('ohne Etikett')), anlage.kunden_bezeichnung].filter(Boolean).join(' · ') || '–'],
    [art.schluessel === 'tuer' ? t('Türtyp') : t('Typ'), typName ?? '–'],
    ...(bestand ? [] : [[t('Lage'), lage || '–'] as [string, ReactNode]]),
    [t('Objekt'), objekt ? [objekt.name, adresse(objekt)].filter(Boolean).join(', ') : '–'],
    // Bestand (Rauchwarnmelder, Geräte): kein Hersteller, die Angaben stehen je Element
    ...(bestand ? [] : [
      [t('Hersteller / Modell'), hersteller || fehlt] as [string, ReactNode],
      ...art.felder.map((f): [string, ReactNode] => [f.text, feldText(f, eigenschaften[f.schluessel]) || fehlt]),
    ]),
    [nichtGeprueft ? t('Vermerkt von') : t('Prüfer'), pruefer],
    [nichtGeprueft ? t('Vermerkt am') : t('Geprüft am'), pruefung.beendet_am ? zeit(pruefung.beendet_am) : t('läuft seit {zeit}', { zeit: zeit(pruefung.begonnen_am) })],
    [t('Prüfgrundlage'), [pruefart?.name, t('Checkliste Version {version}', { version })].filter(Boolean).join(': ')],
    [t('Nächste Prüfung'), abgeschlossen ? datum(anlage.naechste_pruefung_am) : t('wird beim Abschluss berechnet')],
  ]

  // Fortlaufende Nummern der Prüfpunkte (wie im PDF), für die Verweise der Mängelliste
  const punktNr = new Map<string, number>()
  for (const [, ps] of abschnitte) for (const p of ps) punktNr.set(p.id, punktNr.size + 1)
  const zuPunkt = (id: string) => blatt.current?.querySelector(`[data-punkt="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const sortiert = [...neueMaengel].sort((a, b) => b.stufe - a.stufe)

  return (
    <article ref={blatt} aria-label={t('Protokollblatt')} data-protokollblatt style={{
      '--blatt-beschriftung': `${firma?.blatt_beschriftung_breite ?? BLATT_BESCHRIFTUNG_BREITE}%`,
      '--blatt-ergebnis': `${firma?.blatt_ergebnis_breite ?? BLATT_ERGEBNIS_BREITE}%`,
    } as CSSProperties}
      className="mx-auto w-full max-w-4xl bg-white px-4 py-6 text-marke shadow-[0_1px_2px_rgb(0_0_0/0.06),0_14px_36px_-14px_rgb(0_0_0/0.3)] ring-1 ring-slate-900/5 sm:px-10 sm:py-10 lg:px-14">
      {/* Briefkopf */}
      <header className="flex items-start justify-between gap-4">
        <img src={logoPdfUrl(bild)} alt={appName(bild)} className="h-10 w-auto max-w-[45%] object-contain object-left sm:h-12"
          onError={(ev) => { ev.currentTarget.style.visibility = 'hidden' }} />
        {firma && (
          <div className="text-right text-[11px] leading-snug text-slate-500">
            <div className="font-semibold text-slate-700">{firma.name}</div>
            <div>{adresse(firma)}</div>
            <div className="hidden sm:block">{[firma.telefon && t('Tel. {nummer}', { nummer: firma.telefon }), firma.email].filter(Boolean).join(' · ')}</div>
            {firma.web && <div className="hidden sm:block">{firma.web}</div>}
          </div>
        )}
      </header>
      <div className="mt-3 h-[3px] bg-akzent" aria-hidden />

      <div className="mt-4 flex items-start justify-between gap-3">
        <h2 className="text-xl font-bold sm:text-2xl">{t('Prüfprotokoll {art}', { art: art.protokoll })} <span className="whitespace-nowrap">{etikett ?? ''}</span></h2>
        {/* Stempel: bis zum Abschluss ein Entwurf */}
        <div aria-hidden className={`mt-1 shrink-0 rotate-[-7deg] rounded border-[2.5px] px-2 py-0.5 text-xs font-black tracking-[0.25em] uppercase select-none sm:text-sm ${abgeschlossen ? 'border-green-700/60 text-green-700/70' : 'border-red-600/50 text-red-600/60'}`}>
          {abgeschlossen ? t('Abgeschlossen') : t('Entwurf')}
        </div>
      </div>
      <p className="mt-0.5 text-sm text-slate-500">
        {nummer ? `${t('Protokoll-Nr. {nummer}', { nummer })}${pruefung.revision ? ` · ${t('Revision {r}', { r: pruefung.revision })}` : ''}` : t('Protokoll-Nr. wird beim Abschluss vergeben')}
        {teilVon && ` · ${t('Teil des Prüfprotokolls der {tueranlage}', { tueranlage: teilVon })}`}
      </p>

      {/* Anlagendaten, rechts der QR-Code des Etiketts. Eine Beschriftung ist höchstens --blatt-beschriftung breit
          (auf dem Telefon das Doppelte) und bricht darüber um – die Werte behalten ihren Platz. */}
      <div className="mt-4 flex items-start gap-4">
        <dl className="grid min-w-0 flex-1 grid-cols-[fit-content(calc(var(--blatt-beschriftung)*2))_1fr] border-t border-slate-300 text-[13px] sm:grid-cols-[fit-content(var(--blatt-beschriftung))_1fr_fit-content(var(--blatt-beschriftung))_1fr]">
          {daten.map(([k, v]) => (
            <div key={k} className="col-span-2 grid grid-cols-subgrid border-b border-slate-200">
              <dt className="min-w-0 py-1.5 pr-3 font-semibold hyphens-auto break-words text-slate-700">{k}</dt>
              <dd className="min-w-0 py-1.5 pr-3 break-words">{v}</dd>
            </div>
          ))}
        </dl>
        {qrBild && etikett && (
          <figure className="hidden w-20 shrink-0 text-center sm:block">
            <img src={qrBild} alt={t('QR-Code des Etiketts {etikett}', { etikett })} className="w-full" />
            <figcaption className="text-[10px] font-bold">{etikettAnzeige(etikett)}</figcaption>
          </figure>
        )}
      </div>
      {onAnlagendaten && <button type="button" className="link mt-2 text-sm" onClick={onAnlagendaten}>{art.schluessel === 'tuer' ? t('Türdaten ergänzen') : t('Anlagendaten ergänzen')}</button>}

      {/* Ergebnis */}
      {nichtGeprueft ? (
        <p className="mt-5 font-bold text-amber-700">{t('Nicht geprüft: {tuer}', { tuer: pruefung.nicht_geprueft_grund })}</p>
      ) : (
        <div className={`mt-5 border-2 bg-slate-50 px-3 py-2 ${ERGEBNIS_FARBE[ergebnis]}`} data-blatt-ergebnis={ergebnis}>
          <span className="font-bold text-marke">{t('Ergebnis:')} </span><span className="font-bold">{AMPEL_TEXT[ergebnis]}</span>
          {laufend && <span className="ml-2 text-xs text-slate-500">{t('vorläufig – folgt aus den erfassten Mängeln')}</span>}
        </div>
      )}
      {!laufend && pruefung.ergebnis_auto && pruefung.ergebnis !== pruefung.ergebnis_auto && pruefung.ergebnis_begruendung && (
        <p className="mt-1 text-xs text-slate-500">
          {t('Ergebnis vom Prüfer verschärft (automatisch: {auto}). Begründung: {begruendung}', { auto: AMPEL_TEXT[pruefung.ergebnis_auto as Ampel], begruendung: pruefung.ergebnis_begruendung })}
        </p>
      )}

      {/* Prüfpunkte je Abschnitt: Nr. | Prüfpunkt | Ergebnis (Breite --blatt-ergebnis, der Prüfpunkt bricht um);
          auf dem Telefon steht das Ergebnis unter dem Prüfpunkt */}
      {abschnitte.map(([abschnitt, ps]) => (
        <section key={abschnitt} className="mt-7" aria-label={abschnitt}>
          <Ueberschrift>{abschnitt}</Ueberschrift>
          <div aria-hidden className="hidden grid-cols-[2rem_minmax(0,1fr)_minmax(16rem,var(--blatt-ergebnis))] gap-x-3 bg-slate-100 text-xs font-semibold text-slate-700 sm:grid">
            <div className="px-1 py-1.5">{t('Nr.')}</div><div className="py-1.5">{t('Prüfpunkt')}</div><div className="py-1.5">{t('Ergebnis')}</div>
          </div>
          <div className="divide-y divide-slate-200 border-b border-slate-200">
            {ps.map((p) => {
              const a = antworten[p.id]
              return (
                <div key={p.id} data-punkt={p.id} className="grid scroll-mt-24 grid-cols-[2rem_minmax(0,1fr)] gap-x-3 gap-y-1 py-1.5 sm:grid-cols-[2rem_minmax(0,1fr)_minmax(16rem,var(--blatt-ergebnis))]">
                  <div className="px-1 pt-2 text-sm text-slate-500 tabular-nums">{punktNr.get(p.id)}</div>
                  <div className="min-w-0 pt-2 text-sm hyphens-auto break-words">
                    {p.text}{p.pflicht && <span className="text-red-600" title={t('Pflichtangabe')}> *</span>}
                    {p.hinweis && <div className="text-xs text-slate-500">{p.hinweis}</div>}
                    {a?.bemerkung && <div className="text-xs text-slate-500">{a.bemerkung}</div>}
                  </div>
                  <div className="col-start-2 sm:col-start-3 sm:pt-0.5">
                    <BlattEingabe punkt={p} antwort={a} nurLesen={nurLesen} pruefungId={pruefung.id} onSetze={(w) => onSetze(p, w)} />
                  </div>
                  {neueMaengel.filter((m) => m.punkt_id === p.id).map((m) => (
                    <div key={m.id} className="col-[2/-1] pb-1.5">
                      <BlattMangel mangel={m} pruefungId={pruefung.id} nurLesen={nurLesen} fotoPflicht={!!p.foto_bei_nok} />
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </section>
      ))}

      {elemente && <div className="mt-7 [&>section]:rounded-none [&>section]:shadow-none">{elemente}</div>}

      {/* Mängel wie im PDF: nach Stufe; die zu einem Prüfpunkt stehen bearbeitbar an ihm, hier mit Verweis */}
      <section className="mt-7" aria-label={t('Festgestellte Mängel')}>
        <Ueberschrift>{t('Festgestellte Mängel')}</Ueberschrift>
        {sortiert.length === 0 && <p className="text-sm">{t('Keine neuen Mängel.')}</p>}
        <ul className="space-y-2">
          {sortiert.map((m) => m.punkt_id ? (
            <li key={m.id}>
              <button type="button" className="w-full rounded-sm py-1 text-left text-sm transition hover:bg-akzent-hell/60" onClick={() => zuPunkt(m.punkt_id!)}>
                <StufeText stufe={m.stufe} />
                <span className="block">{m.beschreibung || '–'}</span>
                <span className="block text-xs text-slate-500">{punktNr.has(m.punkt_id) ? t('Prüfpunkt {nr}', { nr: punktNr.get(m.punkt_id) }) : t('zum Prüfpunkt')} ↑</span>
              </button>
            </li>
          ) : (
            <li key={m.id}>
              <BlattMangel mangel={m} pruefungId={pruefung.id} nurLesen={nurLesen} loeschbar={!m.element_id}
                bezug={m.element_id && elementDef ? elementName(elementListe.find((e) => e.id === m.element_id) ?? { gruppe: null, nummer: '?' }, elementDef) : undefined} />
            </li>
          ))}
        </ul>
        {!nurLesen && <button type="button" className="btn-sekundaer mt-3" onClick={() => void mangelAnlegen(pruefung, null, 2, '')}>+ {t('Mangel erfassen')}</button>}
      </section>

      {altMaengel.length > 0 && (
        <section className="mt-7" aria-label={t('Mängel aus früheren Prüfungen')}>
          <Ueberschrift>{t('Mängel aus früheren Prüfungen')}</Ueberschrift>
          <div className="divide-y divide-slate-200 border-y border-slate-200">
            {altMaengel.map((m) => {
              const e = altEntscheidungen[m.id]
              return (
                <div key={m.id} className="space-y-1.5 py-2.5 text-sm" data-altmangel-blatt={m.id}>
                  <div><StufeText stufe={m.stufe} /><span className="block">{m.beschreibung}</span></div>
                  <div className="text-xs text-slate-500">{t('festgestellt am {datum}', { datum: datum(m.erstellt_am) })}{m.status === 'behoben' ? ` · ${t('als behoben gemeldet {datum}', { datum: datum(m.behoben_am) })}` : ''}</div>
                  {m.element_id && elementDef && (
                    <div className="text-xs text-slate-600">
                      {elementName(elementListe.find((x) => x.id === m.element_id) ?? { gruppe: null, nummer: '?' }, elementDef)} – {t('das Ergebnis in der Liste der {mehrzahl} entscheidet mit (i.O. = behoben).', { mehrzahl: elementDef.mehrzahl })}
                    </div>
                  )}
                  <Fotos sessionId={pruefung.id} bezugTyp="mangel" bezugId={m.id} nurLesen />
                  {nurLesen || !darfAltmaengel ? (
                    <p className={e === 'besteht' ? 'font-bold text-red-700' : e === 'behoben' ? 'font-bold text-green-800' : 'text-slate-500'}>
                      {e === 'besteht' ? t('besteht weiterhin') : e === 'behoben' ? t('bei dieser Prüfung als behoben bestätigt') : t('noch nicht entschieden')}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-x-2">
                      <Kreuz an={e === 'besteht'} art="mangel" onClick={() => void altmangelEntscheiden(pruefung, m.id, 'besteht')}>{t('besteht weiter')}</Kreuz>
                      <Kreuz an={e === 'behoben'} art="gut" onClick={() => void altmangelEntscheiden(pruefung, m.id, 'behoben')}>{t('behoben')}</Kreuz>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Ergebnis, Unterschrift und Abschluss; danach die Unterschriften wie im PDF */}
      <div className="mt-9 border-t-2 border-marke pt-4 empty:hidden">{children}</div>
      {abgeschlossen && !teilVon && (
        <div className="mt-12 grid gap-8 sm:grid-cols-2">
          <Unterschriftzeile titel={t('Prüfer')} name={pruefer} am={pruefung.unterschrift_am} />
          {pruefung.kunde_unterschrift_am && <Unterschriftzeile titel={t('Kunde')} name={pruefung.kunde_name} am={pruefung.kunde_unterschrift_am} />}
        </div>
      )}

      <footer className="mt-10 flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-slate-200 pt-2 text-[10px] text-slate-400">
        <span>{firma?.name ?? appName(bild)} · {t('Protokoll {nummer}', { nummer: nummer ?? t('(Entwurf)') })}{nummer && pruefung.revision ? ` ${t('Rev. {revision}', { revision: pruefung.revision })}` : ''}</span>
        <span>{t('Ansicht in der App – maßgeblich ist das PDF-Protokoll nach dem Abschluss')}</span>
      </footer>
    </article>
  )
}

function Ueberschrift({ children }: { children: ReactNode }) {
  return <h3 className="mb-1.5 text-[15px] font-bold">{children}</h3>
}

function StufeText({ stufe }: { stufe: number }) {
  return <span className={`font-bold ${stufe >= 3 ? 'text-red-700' : 'text-amber-700'}`}>{t('Stufe {stufe} – {text}', { stufe, text: STUFEN[stufe as Stufe] })}</span>
}

function Unterschriftzeile({ titel, name, am }: { titel: string; name: string | null; am: string | null }) {
  return (
    <div>
      <p className="text-sm text-slate-500 italic">{am ? t('elektronisch unterschrieben') : t('ohne Unterschrift')}</p>
      <div className="mt-1 border-t border-slate-500 pt-1 text-xs text-slate-500">{titel}{name ? `: ${name}` : ''}{am ? ` · ${zeit(am)}` : ''}</div>
    </div>
  )
}

type KreuzArt = 'gut' | 'mangel' | 'neutral' | 'entfaellt'
const KREUZ: Record<KreuzArt, { box: string; text: string; Zeichen: typeof Check }> = {
  gut: { box: 'border-green-700 bg-green-700', text: 'text-green-800', Zeichen: Check },
  mangel: { box: 'border-red-700 bg-red-700', text: 'text-red-700', Zeichen: X },
  neutral: { box: 'border-marke bg-marke', text: 'text-marke', Zeichen: Check },
  entfaellt: { box: 'border-slate-500 bg-slate-500', text: 'text-slate-600', Zeichen: Minus },
}

/** Ankreuzfeld auf dem Blatt – ein Knopf, sein Text ist sein Name (wie die Knöpfe der Liste). */
function Kreuz({ an, art, deaktiviert, onClick, children }: { an: boolean; art: KreuzArt; deaktiviert?: boolean; onClick: () => void; children: ReactNode }) {
  const k = KREUZ[art]
  return (
    <button type="button" aria-pressed={an} disabled={deaktiviert} onClick={onClick}
      className="inline-flex min-h-11 items-center gap-2 rounded-md py-1 pr-2 pl-1 text-sm transition hover:bg-akzent-hell disabled:cursor-default disabled:hover:bg-transparent">
      <span aria-hidden className={`grid size-5 shrink-0 place-items-center rounded-[3px] border-2 text-white transition ${an ? k.box : 'border-slate-400 bg-white'}`}>
        {an && <k.Zeichen className="size-3.5" strokeWidth={3.5} />}
      </span>
      <span className={an ? `font-bold ${k.text}` : 'text-slate-700'}>{children}</span>
    </button>
  )
}

/** Ergebnisspalte eines Prüfpunkts: ankreuzen bzw. eintragen; nur zum Lesen steht dort der Text wie im PDF. */
function BlattEingabe({ punkt, antwort, nurLesen, pruefungId, onSetze }: {
  punkt: Punkt
  antwort?: Antwort
  nurLesen: boolean
  pruefungId: string
  onSetze: (w: AntwortWert) => void
}) {
  const [zahl, setZahl] = useState(antwort?.zahl?.toString().replace('.', ',') ?? '')
  const [text, setText] = useState(antwort?.text ?? '')
  const entfaellt = antwort?.status === 'entfaellt'

  if (punkt.typ === 'foto') {
    return antwort ? <Fotos sessionId={pruefungId} bezugTyp="antwort" bezugId={antwort.id} nurLesen={nurLesen} />
      : nurLesen ? <span className="text-sm text-slate-400">{t('kein Foto')}</span>
      : <button type="button" className="btn-sekundaer" onClick={() => void antwortSetzen(pruefungId, punkt.id, { text: 'foto' })}><Camera className="size-4" aria-hidden />{t('Foto hinzufügen')}</button>
  }
  if (nurLesen) {
    const e = antwortText(punkt, antwort && { status: antwort.status as AntwortWert['status'] ?? null, zahl: antwort.zahl, text: antwort.text, bemerkung: antwort.bemerkung })
    return <span className={`inline-block pt-2 text-sm ${e.mangel ? 'font-bold text-red-700' : 'font-semibold'}`}>{e.text}</span>
  }
  const kreuz = (an: boolean, art: KreuzArt, wert: AntwortWert, beschriftung: string) => (
    <Kreuz key={beschriftung} an={an} art={art} onClick={() => onSetze(wert)}>{beschriftung}</Kreuz>
  )

  switch (punkt.typ) {
    case 'status':
      return (
        <div className="flex flex-wrap gap-x-1">
          {kreuz(antwort?.status === 'io', 'gut', { status: 'io' }, t('i.O.'))}
          {kreuz(antwort?.status === 'nio', 'mangel', { status: 'nio' }, t('n.i.O.'))}
          {kreuz(entfaellt, 'entfaellt', { status: 'entfaellt' }, t('entfällt'))}
        </div>
      )
    case 'ja_nein':
      return (
        <div className="flex flex-wrap gap-x-1">
          {(['ja', 'nein'] as const).map((w) => kreuz(antwort?.text === w, punkt.gut ? (punkt.gut === w ? 'gut' : 'mangel') : 'neutral', { text: w }, w === 'ja' ? t('Ja') : t('Nein')))}
        </div>
      )
    case 'auswahl':
      return (
        <div className="flex flex-wrap gap-x-1">
          {punkt.optionen?.map((o) => kreuz(antwort?.text === o.wert, o.mangel ? 'mangel' : 'neutral', { text: o.wert }, o.wert))}
        </div>
      )
    case 'messwert': {
      const wert = antwort?.zahl
      const ausserhalb = wert != null && ((punkt.soll_min != null && wert < punkt.soll_min) || (punkt.soll_max != null && wert > punkt.soll_max))
      const speichern = () => {
        const n = Number(zahl.replace(',', '.'))
        if (zahl.trim() === '' || !Number.isFinite(n) || n === wert) return
        onSetze({ zahl: n })
      }
      return (
        <div className="flex flex-wrap items-center gap-x-3">
          <span className="inline-flex items-baseline gap-1.5">
            <input inputMode="decimal" aria-label={`${punkt.text} (${punkt.einheit})`} disabled={entfaellt} value={entfaellt ? '' : zahl}
              onChange={(e) => setZahl(e.target.value)} onBlur={speichern} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
              placeholder="…" className={`mt-0 w-24 rounded-none border-0 border-b-2 bg-transparent px-1 py-1.5 text-right font-semibold tabular-nums shadow-none disabled:bg-transparent ${ausserhalb ? 'border-red-600 text-red-700' : 'border-slate-400'}`} />
            <span className="text-sm">{punkt.einheit}</span>
          </span>
          {(punkt.soll_min != null || punkt.soll_max != null) && (
            <span className={`text-xs ${ausserhalb ? 'font-bold text-red-700' : 'text-slate-500'}`}>
              {t('Soll {min} bis {max} {einheit}', { min: punkt.soll_min ?? '–', max: punkt.soll_max ?? '–', einheit: punkt.einheit })}{ausserhalb ? ` – ${t('außerhalb')}` : ''}
            </span>
          )}
          {/* Noch einmal angekreuzt: „entfällt“ zurücknehmen und doch messen */}
          <Kreuz an={entfaellt} art="entfaellt" onClick={() => { setZahl(''); onSetze(entfaellt ? {} : { status: 'entfaellt' }) }}>{t('entfällt')}</Kreuz>
        </div>
      )
    }
    case 'text':
      return (
        <textarea rows={2} aria-label={punkt.text} value={text} placeholder={t('Eintragen …')} onChange={(e) => setText(e.target.value)}
          onBlur={() => { if ((antwort?.text ?? '') !== text) onSetze({ text }) }}
          className="mt-0 field-sizing-content min-h-14 rounded-none border-0 border-b-2 border-dotted border-slate-400 bg-transparent px-1 py-1 text-sm shadow-none" />
      )
  }
}

/** Mangel auf dem Blatt: Stufe und Beschreibung wie im PDF, hier bearbeitbar, mit Fotos. */
function BlattMangel({ mangel, pruefungId, nurLesen, fotoPflicht, loeschbar, bezug }: {
  mangel: Mangel
  pruefungId: string
  nurLesen: boolean
  fotoPflicht?: boolean
  loeschbar?: boolean
  /** z. B. das Element, an dem der Mangel festgestellt wurde */
  bezug?: string
}) {
  const [beschreibung, setBeschreibung] = useState(mangel.beschreibung)
  // Beschreibung von außen geändert (folgt der Antwort, Abgleich): übernehmen
  const [gespeichert, setGespeichert] = useState(mangel.beschreibung)
  if (gespeichert !== mangel.beschreibung) { setGespeichert(mangel.beschreibung); setBeschreibung(mangel.beschreibung) }
  const farbe = mangel.stufe >= 3 ? 'text-red-700' : 'text-amber-700'
  return (
    <div className="space-y-1.5 border-l-[3px] border-red-600 bg-red-50/70 py-2 pr-2 pl-3" data-mangel={mangel.id}>
      <div className="flex flex-wrap items-center gap-x-2 text-sm">
        <span className={`font-bold ${farbe}`}>{t('Mangel')}</span>
        {nurLesen ? <StufeText stufe={mangel.stufe} /> : (
          <Auswahl aria-label={t('Mangelstufe')} className={`mt-0 w-auto border-0 bg-transparent py-1 pl-1 text-sm font-bold shadow-none ${farbe}`} value={mangel.stufe}
            onChange={(e) => void mangelAendern(mangel.id, { stufe: Number(e.target.value) })}>
            {([1, 2, 3] as Stufe[]).map((s) => <option key={s} value={s}>{t('Stufe {stufe} – {text}', { stufe: s, text: STUFEN[s] })}</option>)}
          </Auswahl>
        )}
        {bezug && <span className="text-xs text-slate-500">{bezug}</span>}
      </div>
      {nurLesen ? <p className="text-sm">{mangel.beschreibung || '–'}</p> : (
        <textarea rows={2} aria-label={t('Mangelbeschreibung')} value={beschreibung} placeholder={t('Was genau ist mangelhaft?')}
          onChange={(e) => setBeschreibung(e.target.value)} onBlur={() => { if (beschreibung !== mangel.beschreibung) void mangelAendern(mangel.id, { beschreibung }) }}
          className="mt-0 field-sizing-content min-h-14 rounded-none border-0 border-b-2 border-dotted border-red-300 bg-transparent px-1 py-1 text-sm shadow-none" />
      )}
      <Fotos sessionId={pruefungId} bezugTyp="mangel" bezugId={mangel.id} nurLesen={nurLesen} hinweis={fotoPflicht ? t('Foto erforderlich') : undefined} />
      {loeschbar && !nurLesen && (
        <button type="button" className="link text-sm text-red-700" onClick={async () => { if (await bestaetigen(t('Mangel löschen?'), { ok: t('Löschen'), gefahr: true })) void mangelLoeschen(mangel.id) }}>{t('Mangel löschen')}</button>
      )}
    </div>
  )
}
