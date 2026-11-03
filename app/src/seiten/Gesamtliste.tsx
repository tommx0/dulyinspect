import QRCode from 'qrcode'
import { QrCode } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { DateiKnoepfe } from '../components/DateiKnoepfe'
import { ArtSymbol, ObjektSymbol } from '../components/Symbole'
import { Badge, Dialog, Fehler, Laden, Leer, Seite } from '../components/ui'
import { artDefinition } from '../lib/anlagenarten'
import { tb, useAnlagenarten } from '../lib/begriffe'
import { gebietsschema, t, tMeldung } from '../lib/sprache'
import { entschluesselt } from '../lib/entschluesselt'
import { DIREKTE_ADRESSE } from '../lib/etikett'
import {
  EBENEN, ERGEBNIS, elementBegriff, naechsteText, spalten, tabelle, tag, zeilenBauen,
  type Anlage, type Daten, type Ebene, type Element, type Kunde, type Objekt, type Zeile,
} from '../lib/gesamtliste'
import { eigenerMandantencode } from '../lib/mandantencode'
import { nameVergleich } from '../lib/sortierung'
import { supabase } from '../lib/supabase'
import { TUERANLAGE_TYP } from '../lib/tueranlage'
import { useAbfrage } from '../lib/useAbfrage'

const SPEICHER = 'tuerpruefung:gesamtliste'
/** So viele Zeilen zeigt die Seite zunächst (der Export enthält immer alle). */
const ANZEIGE = 500
const SEITE = 1000

type Einstellung = { ebenen: Ebene[]; inaktive: boolean }

function geladen(): Einstellung {
  try {
    const x = JSON.parse(localStorage.getItem(SPEICHER) ?? 'null') as Einstellung | null
    const ebenen = (x?.ebenen ?? []).filter((e) => EBENEN.includes(e))
    if (ebenen.length) return { ebenen, inaktive: !!x?.inaktive }
  } catch { /* nicht verfügbar */ }
  return { ebenen: [...EBENEN], inaktive: false }
}

/** Alle Zeilen einer Abfrage seitenweise (der Server liefert höchstens 1000 auf einmal). */
async function seitenweise<T>(abfrage: (von: number, bis: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const alle: T[] = []
  for (let von = 0; ; von += SEITE) {
    const { data, error } = await abfrage(von, von + SEITE - 1)
    if (error) throw error
    const liste = (data ?? []) as T[]
    alle.push(...liste)
    if (liste.length < SEITE) return alle
  }
}

async function laden(): Promise<{ data: Daten; error: null }> {
  const [kunden, objekte, anlagen, elemente, maengel] = await Promise.all([
    seitenweise<Kunde>((von, bis) => entschluesselt('endkunde', supabase.from('endkunde')
      .select('id, name, strasse, plz, ort, ansprechpartner, email, telefon, notiz, aktiv').order('id').range(von, bis))),
    seitenweise<Objekt>((von, bis) => entschluesselt('objekt', supabase.from('objekt')
      .select('id, endkunde_id, name, strasse, plz, ort, zugangshinweise, aktiv').order('id').range(von, bis))),
    seitenweise<Anlage>((von, bis) => entschluesselt('anlage', supabase.from('anlage')
      .select('id, objekt_id, etikett_id, kunden_bezeichnung, gebaeude, etage, raum, lage_beschreibung, hersteller, modell, baujahr, eigenschaften, letzte_pruefung_am, letztes_ergebnis, naechste_pruefung_am, status, erstellt_am, anlagentyp(name, kategorie, anlagenart, pruefart(id, name, intervall_monate, reihenfolge, aktiv, elemente)), anlage_faelligkeit(pruefart_id, intervall_monate, letzte_pruefung_am)')
      .neq('anlagentyp_id', TUERANLAGE_TYP).order('id').range(von, bis))),
    seitenweise<Element>((von, bis) => supabase.from('anlage_element')
      .select('id, anlage_id, gruppe, nummer, elementart, ort, typ, code, eigenschaften, aktiv, zuletzt_geprueft_am, geprueft_je_pruefart').order('id').range(von, bis)),
    seitenweise<{ anlage_id: string }>((von, bis) => supabase.from('mangel').select('anlage_id').in('status', ['offen', 'behoben']).order('id').range(von, bis)),
  ])
  const offeneMaengel = new Map<string, number>()
  for (const m of maengel) offeneMaengel.set(m.anlage_id, (offeneMaengel.get(m.anlage_id) ?? 0) + 1)
  return { data: { kunden, objekte, anlagen, elemente, offeneMaengel }, error: null }
}

/**
 * Gesamtliste aller Anlagen und Melder (System): gestaffelt nach den gewählten Ebenen Kunde, Objekt, Anlage, Element,
 * mit Etikett bzw. Code, QR-Inhalt, letzter und nächster Prüfung; Export mit allen Daten als Excel oder CSV.
 */
export default function Gesamtliste() {
  const arten = useAnlagenarten()
  const element = useMemo(() => elementBegriff(arten), [arten])
  const [e, setE] = useState(geladen)
  const [kunden, setKunden] = useState<string[]>([])
  const [objekte, setObjekte] = useState<string[]>([])
  const [artWahl, setArtWahl] = useState<string[]>([])
  const [alleZeigen, setAlleZeigen] = useState(false)
  const [qr, setQr] = useState<Zeile | null>(null)
  const [heute] = useState(() => new Date().toISOString().slice(0, 10))
  const daten = useAbfrage(laden)

  useEffect(() => {
    try { localStorage.setItem(SPEICHER, JSON.stringify(e)) } catch { /* Speicher gesperrt */ }
  }, [e])

  // Ohne Arten mit Elementen gibt es keine Element-Ebene
  const ebenen = useMemo(() => {
    const l = e.ebenen.filter((x) => x !== 'element' || element)
    return l.length ? l : ['anlage' as const]
  }, [e.ebenen, element])
  const ebenenText: Record<Ebene, string> = { kunde: t('Kunden'), objekt: t('Objekte'), anlage: tb('Türen'), element: t(element?.mehrzahl ?? 'Elemente') }
  const umschalten = (x: Ebene) => setE({ ...e, ebenen: ebenen.includes(x) ? ebenen.filter((y) => y !== x) : EBENEN.filter((y) => y === x || ebenen.includes(y)) })

  const d = daten.daten
  const kundeOptionen = useMemo(() => (d?.kunden ?? []).filter((k) => e.inaktive || k.aktiv).sort(nameVergleich)
    .map((k) => ({ wert: k.id, text: k.name, zusatz: k.ort ?? undefined })), [d, e.inaktive])
  const objektOptionen = useMemo(() => {
    const name = new Map((d?.kunden ?? []).map((k) => [k.id, k]))
    return (d?.objekte ?? []).filter((o) => (e.inaktive || o.aktiv) && (!kunden.length || kunden.includes(o.endkunde_id)) && name.has(o.endkunde_id))
      .sort(nameVergleich).map((o) => ({ wert: o.id, text: o.name, zusatz: [name.get(o.endkunde_id)?.name, o.ort].filter(Boolean).join(' · ') }))
  }, [d, e.inaktive, kunden])
  const artOptionen = useMemo(() => [...new Set((d?.anlagen ?? []).map((a) => a.anlagentyp?.anlagenart).filter((a): a is string => !!a))]
    .map((a) => ({ wert: a, text: t(artDefinition(a).name) })).sort((a, b) => a.text.localeCompare(b.text, gebietsschema())), [d])
  // Gewählte Objekte, die nicht mehr zur Kundenauswahl passen, zählen nicht
  const objekteWirksam = useMemo(() => objekte.filter((o) => objektOptionen.some((x) => x.wert === o)), [objekte, objektOptionen])

  const zeilen = useMemo(() => (d ? zeilenBauen(d, { ebenen, kunden, objekte: objekteWirksam, arten: artWahl, inaktive: e.inaktive },
    { adresse: DIREKTE_ADRESSE, mandantencode: eigenerMandantencode() }) : []), [d, ebenen, kunden, objekteWirksam, artWahl, e.inaktive])
  const spaltenListe = useMemo(() => spalten(ebenen, element), [ebenen, element])
  const zaehler = useMemo(() => {
    const z: Record<Ebene, number> = { kunde: 0, objekt: 0, anlage: 0, element: 0 }
    for (const x of zeilen) z[x.ebene]++
    return z
  }, [zeilen])
  const sichtbar = alleZeigen ? zeilen : zeilen.slice(0, ANZEIGE)
  const tiefe = (x: Ebene) => ebenen.indexOf(x)

  return (
    <Seite titel={t('Gesamtliste')} aktionen={
      <DateiKnoepfe art="export" name={`Gesamtliste_${heute}`} blattName={t('Gesamtliste')} zeilen={() => tabelle(zeilen, spaltenListe)} disabled={zeilen.length === 0} />
    }>
      <div className="karte space-y-3 p-4">
        <fieldset>
          <legend className="text-sm font-medium text-slate-700">{t('Gestaffelt nach')}</legend>
          <div className="mt-1 flex flex-wrap gap-x-5 gap-y-2">
            {EBENEN.filter((x) => x !== 'element' || element).map((x) => (
              <label key={x} className="flex items-center gap-2 font-normal">
                <input type="checkbox" checked={ebenen.includes(x)} disabled={ebenen.length === 1 && ebenen.includes(x)} onChange={() => umschalten(x)} />
                {ebenenText[x]}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">{tb('Jede gewählte Ebene bekommt eigene Zeilen, darunter ihre Einträge. Kunde, Objekt und Tür stehen in jeder Zeile mit.')}</p>
        </fieldset>
        <div className="flex flex-wrap items-center gap-2">
          <MehrfachAuswahl text={t('Kunden')} alle={t('alle Kunden')} optionen={kundeOptionen} gewaehlt={kunden} onWechsel={setKunden} />
          <MehrfachAuswahl text={t('Objekte')} alle={t('alle Objekte')} optionen={objektOptionen} gewaehlt={objekteWirksam} onWechsel={setObjekte} />
          {artOptionen.length > 1 && <MehrfachAuswahl text={t('Arten')} alle={t('alle Arten')} optionen={artOptionen} gewaehlt={artWahl} onWechsel={setArtWahl} />}
          <label className="flex items-center gap-2 font-normal">
            <input type="checkbox" checked={e.inaktive} onChange={(x) => setE({ ...e, inaktive: x.target.checked })} /> {t('auch inaktive und stillgelegte')}
          </label>
        </div>
      </div>
      <p className="text-sm text-slate-500" data-zaehler>
        {t('{n} Zeilen', { n: zeilen.length })}{zeilen.length > 0 && `: ${EBENEN.filter((x) => zaehler[x]).map((x) => `${zaehler[x]} ${ebenenText[x]}`).join(', ')}`}
        {' · '}{t('Der Export enthält alle Daten ({n} Spalten), der QR-Code steht als Adresse darin.', { n: spaltenListe.length })}
      </p>
      <Fehler text={daten.fehler} />
      {daten.laedt ? <Laden /> : zeilen.length === 0 ? <Leer>{t('Keine Einträge in dieser Auswahl.')}</Leer> : (
        <div className="karte overflow-x-auto">
          <table className="w-full text-left text-sm" data-gesamtliste>
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">{t('Bezeichnung')}</th>
                <th className="px-3 py-2 font-medium">{t('Etikett / Code')}</th>
                <th className="px-3 py-2 font-medium">{t('Zuletzt geprüft')}</th>
                <th className="px-3 py-2 font-medium">{t('Nächste Prüfung')}</th>
                <th className="px-3 py-2 font-medium">{t('Angaben')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sichtbar.map((z) => (
                <tr key={`${z.ebene}:${z.id}`} data-ebene={z.ebene} className={`${z.ebene === 'kunde' ? 'bg-slate-50' : ''} ${z.aktiv ? '' : 'text-slate-400'}`}>
                  <td className="min-w-72 px-3 py-2" style={{ paddingLeft: `${0.75 + tiefe(z.ebene) * 1.25}rem` }}>
                    <div className="flex items-center gap-2.5">
                      {z.ebene === 'objekt' && <ObjektSymbol groesse="sm" />}
                      {(z.ebene === 'anlage' || z.ebene === 'element') && <ArtSymbol art={z.art} groesse="sm" />}
                      <div className="min-w-0">
                        <div className={z.ebene === 'kunde' ? 'font-semibold' : ''}><Bezeichnung z={z} />{!z.aktiv && <> <Badge>{tMeldung(z.status)}</Badge></>}</div>
                        <div className="text-xs text-slate-500">{[tMeldung(z.ebeneText), ...kontext(z, ebenen)].join(' · ')}</div>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {z.code && (
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono">{z.code}</span>
                        <button type="button" className="rounded p-1 text-slate-500 hover:bg-akzent-hell hover:text-marke" onClick={() => setQr(z)}
                          aria-label={t('QR-Code {code}', { code: z.code })} title={t('QR-Code zeigen')}><QrCode className="size-4" aria-hidden /></button>
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {tag(z.letzte)}{z.ergebnis && <> <Badge farbe={z.ergebnis}>{tMeldung(ERGEBNIS[z.ergebnis])}</Badge></>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {z.nieGeprueft ? <Badge farbe="gelb">{t('noch nie geprüft')}</Badge>
                      : z.naechste ? <Badge farbe={z.naechste < heute ? 'rot' : 'grau'}>{tMeldung(naechsteText(z))}</Badge> : null}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">{angaben(z)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sichtbar.length < zeilen.length && (
            <div className="border-t border-slate-100 p-3 text-center">
              <button type="button" className="btn-sekundaer" onClick={() => setAlleZeigen(true)}>{t('Alle {n} Zeilen anzeigen', { n: zeilen.length })}</button>
            </div>
          )}
        </div>
      )}
      <QrDialog zeile={qr} onSchliessen={() => setQr(null)} />
    </Seite>
  )
}

function Bezeichnung({ z }: { z: Zeile }) {
  const text = { kunde: z.kunde, objekt: z.objekt, anlage: z.anlage, element: z.element }[z.ebene]
  if (z.ebene === 'kunde') return <Link className="link" to={`/kunden/${z.id}`}>{text}</Link>
  if (z.ebene === 'objekt') return <Link className="link" to={`/objekte/${z.id}`}>{text}</Link>
  if (z.ebene === 'anlage') return <Link className="link" to={`/objekte/${z.objektId}?anlage=${z.id}`}>{text}</Link>
  return <Link className="link" to={`/anlagen/${z.anlageId}/elemente`}>{text}</Link>
}

/** Übergeordnete Einträge, die nicht schon als eigene Zeile darüber stehen. */
function kontext(z: Zeile, ebenen: readonly Ebene[]): string[] {
  const oben = EBENEN.slice(0, EBENEN.indexOf(z.ebene))
  return oben.filter((x) => !ebenen.includes(x)).map((x) => ({ kunde: z.kunde, objekt: z.objekt, anlage: z.anlage, element: '' }[x])).filter(Boolean)
}

/** Kurzfassung der Daten der Ebene; vollständig im Export. */
function angaben(z: Zeile): string {
  const teile = (...werte: unknown[]) => werte.filter((w) => w != null && w !== '').map(String)
  const adresse = (p: string) => teile(z.details[`${p}.strasse`], teile(z.details[`${p}.plz`], z.details[`${p}.ort`]).join(' ')).join(', ')
  if (z.ebene === 'kunde') return teile(adresse('k'), z.details['k.ansprechpartner'], z.details['k.telefon']).join(' · ')
  if (z.ebene === 'objekt') return adresse('o')
  if (z.ebene === 'anlage') {
    return teile(z.details['a.typ'], teile(z.details['a.gebaeude'], z.details['a.etage'], z.details['a.raum']).join(' / '),
      Number(z.details['a.maengel']) > 0 ? t('{n} offene Mängel', { n: String(z.details['a.maengel']) }) : '').join(' · ')
  }
  return teile(tMeldung(String(z.details['e.art'] ?? '')), z.details['e.ort'], z.details['e.typ']).join(' · ')
}

/** Auswahl mehrerer Einträge (keiner gewählt = alle) als aufklappbare Liste mit Kästchen. */
function MehrfachAuswahl({ text, alle, optionen, gewaehlt, onWechsel }: {
  text: string
  alle: string
  optionen: { wert: string; text: string; zusatz?: string }[]
  gewaehlt: string[]
  onWechsel: (w: string[]) => void
}) {
  const [offen, setOffen] = useState(false)
  const [suche, setSuche] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!offen) return
    const klick = (x: MouseEvent) => { if (!ref.current?.contains(x.target as Node)) setOffen(false) }
    const taste = (x: KeyboardEvent) => { if (x.key === 'Escape') setOffen(false) }
    document.addEventListener('mousedown', klick)
    document.addEventListener('keydown', taste)
    return () => { document.removeEventListener('mousedown', klick); document.removeEventListener('keydown', taste) }
  }, [offen])

  const anzeige = gewaehlt.length === 0 ? alle
    : gewaehlt.length === 1 ? optionen.find((o) => o.wert === gewaehlt[0])?.text ?? `1 ${text}` : `${gewaehlt.length} ${text}`
  const s = suche.trim().toLowerCase()
  const gefiltert = s ? optionen.filter((o) => `${o.text} ${o.zusatz ?? ''}`.toLowerCase().includes(s)) : optionen
  return (
    <div ref={ref} className="relative">
      <button type="button" className={`btn-sekundaer ${gewaehlt.length ? 'border-marke' : ''}`} aria-haspopup="true" aria-expanded={offen}
        aria-label={`${text}: ${anzeige}`} onClick={() => setOffen(!offen)}>
        <span className="max-w-56 truncate">{anzeige}</span><span aria-hidden="true" className="text-xs">▾</span>
      </button>
      {offen && (
        <div role="group" aria-label={text} className="absolute left-0 top-full z-20 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg">
          {optionen.length > 8 && (
            <input type="search" className="mt-0 mb-1" placeholder={t('Suchen …')} value={suche} onChange={(x) => setSuche(x.target.value)} aria-label={t('{was} suchen', { was: text })} />
          )}
          <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-sm font-medium hover:bg-akzent-hell" onClick={() => onWechsel([])}>
            {alle}{gewaehlt.length ? ` ${t('(Auswahl aufheben)')}` : ' ✓'}
          </button>
          <div className="max-h-72 overflow-y-auto">
            {gefiltert.map((o) => (
              <label key={o.wert} className="flex items-start gap-2 rounded-md px-2 py-1.5 font-normal hover:bg-akzent-hell">
                <input type="checkbox" className="mt-0.5" checked={gewaehlt.includes(o.wert)}
                  onChange={(x) => onWechsel(x.target.checked ? [...gewaehlt, o.wert] : gewaehlt.filter((w) => w !== o.wert))} />
                <span>{o.text}{o.zusatz && <span className="block text-xs text-slate-500">{o.zusatz}</span>}</span>
              </label>
            ))}
            {gefiltert.length === 0 && <p className="px-2 py-1.5 text-sm text-slate-500">{t('Keine Treffer.')}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

/** QR-Code eines Etiketts bzw. Melders wie auf dem Aufkleber, mit der Adresse darin. */
function QrDialog({ zeile, onSchliessen }: { zeile: Zeile | null; onSchliessen: () => void }) {
  const [erzeugt, setErzeugt] = useState<{ fuer: string; bild: string } | null>(null)
  useEffect(() => {
    if (!zeile?.qr) return
    let aktiv = true
    const inhalt = zeile.qr
    void QRCode.toDataURL(inhalt, { margin: 1, errorCorrectionLevel: 'M', width: 300 }).then((bild) => { if (aktiv) setErzeugt({ fuer: inhalt, bild }) })
    return () => { aktiv = false }
  }, [zeile])
  const bild = erzeugt && erzeugt.fuer === zeile?.qr ? erzeugt.bild : ''
  return (
    <Dialog offen={!!zeile} titel={t('QR-Code {code}', { code: zeile?.code ?? '' })} onSchliessen={onSchliessen}>
      {zeile && (
        <div className="space-y-3 text-center">
          <p className="text-sm text-slate-600">{[zeile.kunde, zeile.objekt, zeile.anlage, zeile.element].filter(Boolean).join(' · ')}</p>
          {bild ? <img src={bild} alt={t('QR-Code {code}', { code: zeile.code })} className="mx-auto size-60" /> : <Laden />}
          <p className="break-all font-mono text-xs text-slate-500" data-qr-inhalt>{zeile.qr}</p>
        </div>
      )}
    </Dialog>
  )
}
