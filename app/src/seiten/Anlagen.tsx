import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { AustauschBadges } from '../components/AustauschHinweis'
import { ArtSymbol, Weiter } from '../components/Symbole'
import { AnsichtWahl, Badge, datum, Fehler, Kacheln, Laden, Leer, Seite } from '../components/ui'
import { useAnsicht } from '../lib/ansicht'
import { artDefinition, eigenschaftenKurz, eigenschaftenListe, type Eigenschaften } from '../lib/anlagenarten'
import { nurTueren, tb } from '../lib/begriffe'
import { gebietsschema, t } from '../lib/sprache'
import { DateiKnoepfe } from '../components/DateiKnoepfe'
import { AnlageNeuDialog } from '../components/StammdatenDialoge'
import { etagenRang } from '../lib/sortierung'
import { supabase } from '../lib/supabase'
import { demoKnopf } from '../lib/demo'
import { TUERANLAGE_TYP } from '../lib/tueranlage'
import { istBestandArt } from '../lib/bestand'
import { entschluesselt } from '../lib/entschluesselt'
import { useAbfrage } from '../lib/useAbfrage'
import { useAustausch } from '../lib/useAustausch'
import { Auswahl } from '../components/Auswahl'

type Zeile = {
  id: string; etikett_id: string | null; kunden_bezeichnung: string | null; gebaeude: string | null; etage: string | null; raum: string | null
  lage_beschreibung: string | null; hersteller: string | null; modell: string | null; baujahr: number | null; eigenschaften: Eigenschaften
  letzte_pruefung_am: string | null; letztes_ergebnis: 'gruen' | 'gelb' | 'rot' | null
  naechste_pruefung_am: string | null; status: 'aktiv' | 'stillgelegt'; erstellt_am: string
  anlagentyp: { name: string; kategorie: string | null; anlagenart: string
    pruefart: { id: string; name: string; intervall_monate: number; reihenfolge: number; aktiv: boolean }[] } | null
  anlage_faelligkeit: { pruefart_id: string; intervall_monate: number | null }[]
  anlage_element: { count: number }[]
  objekt: { id: string; name: string; strasse: string | null; plz: string | null; ort: string | null; endkunde: { name: string } | null } | null
}

/** Intervall in Monaten: abweichend an der Anlage oder Standard der Prüfart; bei mehreren Prüfarten mit Namen. */
function intervallText(z: Zeile): string {
  const arten = (z.anlagentyp?.pruefart ?? []).filter((p) => p.aktiv).sort((a, b) => a.reihenfolge - b.reihenfolge)
  const wert = (p: (typeof arten)[number]) => z.anlage_faelligkeit.find((f) => f.pruefart_id === p.id)?.intervall_monate ?? p.intervall_monate
  return arten.length === 1 ? String(wert(arten[0])) : arten.map((p) => `${p.name}: ${wert(p)}`).join('; ')
}

const ERGEBNIS = { gruen: t('ohne Mängel'), gelb: t('mit Mängeln'), rot: t('nicht betriebssicher') }
const FARBE = { gruen: 'gruen', gelb: 'gelb', rot: 'rot' } as const
type Spalte = 'etikett' | 'kunde' | 'lage' | 'typ' | 'letzte' | 'naechste'

/** Alle Türen über alle Kunden (Admin) mit Filter, Sortierung und Export. */
export default function Anlagen() {
  const navigate = useNavigate()
  const [suche, setSuche] = useState('')
  const [kunde, setKunde] = useState('')
  const [typ, setTyp] = useState('')
  const [status, setStatus] = useState<'aktiv' | 'stillgelegt' | 'alle'>('aktiv')
  const [sort, setSort] = useState<{ spalte: Spalte; ab: boolean }>({ spalte: 'kunde', ab: false })
  const [neu, setNeu] = useState(false)
  const [ansicht, setAnsicht] = useAnsicht('anlagen')
  const [heute] = useState(() => new Date().toISOString().slice(0, 10))

  const liste = useAbfrage(() => entschluesselt('anlage', supabase.from('anlage')
    .select('*, anlagentyp(name, kategorie, anlagenart, pruefart(id, name, intervall_monate, reihenfolge, aktiv)), anlage_faelligkeit(pruefart_id, intervall_monate), anlage_element(count), objekt(id, name, strasse, plz, ort, endkunde(id, name))')
    .neq('anlagentyp_id', TUERANLAGE_TYP).order('etikett_id').limit(10000)))
  const austausch = useAustausch()
  const maengel = useAbfrage(() => supabase.from('mangel').select('anlage_id').in('status', ['offen', 'behoben']).limit(20000))

  const offeneMaengel = useMemo(() => {
    const m = new Map<string, number>()
    for (const x of maengel.daten ?? []) m.set(x.anlage_id, (m.get(x.anlage_id) ?? 0) + 1)
    return m
  }, [maengel.daten])

  const alle = useMemo(() => (liste.daten ?? []) as unknown as Zeile[], [liste.daten])
  const kunden = useMemo(() => [...new Set(alle.map((z) => z.objekt?.endkunde?.name).filter(Boolean))].sort() as string[], [alle])
  const typen = useMemo(() => [...new Set(alle.map((z) => z.anlagentyp?.name).filter(Boolean))].sort() as string[], [alle])

  const gefiltert = useMemo(() => {
    const s = suche.toLowerCase()
    const schluessel: Record<Spalte, (z: Zeile) => string | number> = {
      etikett: (z) => z.etikett_id ?? '~',
      kunde: (z) => `${z.objekt?.endkunde?.name ?? ''}|${z.objekt?.name ?? ''}|${z.gebaeude ?? ''}|${String(etagenRang(z.etage) + 1000).padStart(5, '0')}|${z.kunden_bezeichnung ?? ''}`,
      lage: (z) => `${z.gebaeude ?? ''}|${String(etagenRang(z.etage) + 1000).padStart(5, '0')}|${z.raum ?? ''}`,
      typ: (z) => z.anlagentyp?.name ?? '',
      letzte: (z) => z.letzte_pruefung_am ?? '0000',
      naechste: (z) => z.naechste_pruefung_am ?? '9999',
    }
    return alle
      .filter((z) => status === 'alle' || z.status === status)
      .filter((z) => !kunde || z.objekt?.endkunde?.name === kunde)
      .filter((z) => !typ || z.anlagentyp?.name === typ)
      .filter((z) => !s || [z.etikett_id, z.kunden_bezeichnung, z.gebaeude, z.etage, z.raum, z.lage_beschreibung, z.hersteller, z.modell,
        ...Object.values(z.eigenschaften ?? {}), z.anlagentyp?.name, z.objekt?.name, z.objekt?.ort, z.objekt?.endkunde?.name].join(' ').toLowerCase().includes(s))
      .sort((a, b) => {
        const x = schluessel[sort.spalte](a), y = schluessel[sort.spalte](b)
        const r = String(x).localeCompare(String(y), 'de', { numeric: true })
        return sort.ab ? -r : r
      })
  }, [alle, suche, kunde, typ, status, sort])

  const exportZeilen = () => {
    const kopf = [t('Etikett'), t('Bezeichnung beim Kunden'), t('Kunde'), t('Objekt'), t('Objekt-Adresse'), t('Gebäude'), t('Etage'), t('Raum'), t('Lagebeschreibung'),
      tb('Türtyp'), t('Kategorie'), tb('Hersteller (Tür)'), tb('Modell (Tür)'), t('Baujahr'), t('Antrieb / System'), t('Prüfintervall (Monate)'),
      t('Letzte Prüfung'), t('Letztes Ergebnis'), t('Nächste Prüfung'), t('Offene Mängel'), t('Status'), t('Angelegt am'), tb('Tür-ID (intern)'),
      ...(nurTueren() ? [] : [t('Art'), t('Anlagendaten')])]
    const zeilen = gefiltert.map((z) => [
      z.etikett_id, z.kunden_bezeichnung, z.objekt?.endkunde?.name, z.objekt?.name,
      [z.objekt?.strasse, [z.objekt?.plz, z.objekt?.ort].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      z.gebaeude, z.etage, z.raum, z.lage_beschreibung, z.anlagentyp?.name, z.anlagentyp?.kategorie, z.hersteller, z.modell, z.baujahr,
      String(z.eigenschaften?.antrieb_system ?? ''), intervallText(z), datumOderLeer(z.letzte_pruefung_am),
      z.letztes_ergebnis ? ERGEBNIS[z.letztes_ergebnis] : '', datumOderLeer(z.naechste_pruefung_am), offeneMaengel.get(z.id) ?? 0,
      z.status === 'aktiv' ? t('aktiv') : t('stillgelegt'), datumOderLeer(z.erstellt_am), z.id,
      ...(nurTueren() ? [] : [artDefinition(z.anlagentyp?.anlagenart).name, eigenschaftenListe(z.anlagentyp?.anlagenart, z.eigenschaften).map((x) => `${x.text}: ${x.wert}`).join('; ')]),
    ])
    return [kopf, ...zeilen]
  }

  const kopfZelle = (spalte: Spalte, text: string) => (
    <th className="px-3 py-2 font-medium">
      <button className="inline-flex items-center gap-1 uppercase" onClick={() => setSort({ spalte, ab: sort.spalte === spalte ? !sort.ab : false })}>
        {text}{sort.spalte === spalte ? (sort.ab ? ' ▼' : ' ▲') : ''}
      </button>
    </th>
  )

  return (
    <Seite titel={tb('Türen')} aktionen={<>
      <DateiKnoepfe art="export" name={`${nurTueren() ? 'Tueren' : 'Anlagen'}_${heute}`} blattName={tb('Türen')} zeilen={exportZeilen} disabled={gefiltert.length === 0} />
      <button className="btn-primaer" {...demoKnopf()} onClick={() => setNeu(true)}>{tb('+ Tür')}</button>
    </>}>
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" placeholder={t('Suchen …')} value={suche} onChange={(e) => setSuche(e.target.value)} className="mt-0 max-w-xs" aria-label={tb('Türen suchen')} />
        <Auswahl aria-label={t('Kunde')} className="mt-0 w-auto" value={kunde} onChange={(e) => setKunde(e.target.value)}>
          <option value="">{t('alle Kunden')}</option>
          {kunden.map((k) => <option key={k}>{k}</option>)}
        </Auswahl>
        <Auswahl aria-label={tb('Türtyp')} className="mt-0 w-auto max-w-64" value={typ} onChange={(e) => setTyp(e.target.value)}>
          <option value="">{tb('alle Türtypen')}</option>
          {typen.map((k) => <option key={k}>{k}</option>)}
        </Auswahl>
        <Auswahl aria-label={t('Status')} className="mt-0 w-auto" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="aktiv">{t('aktiv')}</option>
          <option value="stillgelegt">{t('stillgelegt')}</option>
          <option value="alle">{t('alle')}</option>
        </Auswahl>
        <span className="ml-auto"><AnsichtWahl wert={ansicht} onWechsel={setAnsicht} /></span>
      </div>
      <p className="text-sm text-slate-500">{tb('{n} von {m} Türen · Der Export enthält die gefilterten Türen mit allen Daten.', { n: gefiltert.length, m: alle.length })}</p>
      <Fehler text={liste.fehler || maengel.fehler} />
      {liste.laedt ? <Laden /> : gefiltert.length === 0 ? <Leer>{tb('Keine Türen gefunden.')}</Leer> : ansicht === 'kacheln' ? (
        <Kacheln>
          {gefiltert.map((z) => {
            const elemente = artDefinition(z.anlagentyp?.anlagenart).elemente
            return (
              <li key={z.id} data-anlage={z.etikett_id ?? z.id} className={`karte flex flex-col ${z.status === 'stillgelegt' ? 'text-slate-400' : ''}`}>
                <Link to={`/objekte/${z.objekt?.id}?anlage=${z.id}`} className="group flex flex-1 items-start gap-3 rounded-lg p-4 transition-colors hover:bg-akzent-hell/40">
                  <ArtSymbol art={z.anlagentyp?.anlagenart} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="whitespace-nowrap font-mono font-semibold">{z.etikett_id ?? (istBestandArt(z.anlagentyp?.anlagenart) ? null : <Badge farbe="gelb">{t('ohne Etikett')}</Badge>)}</span>
                      <span className="font-medium">{z.kunden_bezeichnung}</span>
                    </div>
                    <div className="text-sm">{z.objekt?.endkunde?.name}<span className="text-slate-500"> · {z.objekt?.name}{z.objekt?.ort ? `, ${z.objekt.ort}` : ''}</span></div>
                    <div className="text-sm">{[z.gebaeude, z.etage, z.raum].filter(Boolean).join(' / ') || '–'}{z.lage_beschreibung && <span className="text-slate-500"> · {z.lage_beschreibung}</span>}</div>
                    <div className="text-xs text-slate-500">{[z.anlagentyp?.name, z.hersteller, eigenschaftenKurz(z.anlagentyp?.anlagenart, z.eigenschaften)].filter(Boolean).join(' · ')}</div>
                    <div className="flex flex-wrap gap-1 pt-1">
                      {z.letztes_ergebnis
                        ? <Badge farbe={FARBE[z.letztes_ergebnis]}>{datum(z.letzte_pruefung_am)} {ERGEBNIS[z.letztes_ergebnis]}</Badge>
                        : z.letzte_pruefung_am && <Badge>{t('geprüft {datum}', { datum: datum(z.letzte_pruefung_am) })}</Badge>}
                      {z.status === 'stillgelegt' ? <Badge>{t('stillgelegt')}</Badge> : z.naechste_pruefung_am
                        ? <Badge farbe={z.naechste_pruefung_am < heute ? 'rot' : 'grau'}>{t('fällig {datum}', { datum: datum(z.naechste_pruefung_am) })}</Badge>
                        : <Badge>{t('nie geprüft')}</Badge>}
                      {z.status !== 'stillgelegt' && <AustauschBadges z={austausch.jeAnlage.get(z.id)} />}
                    </div>
                    {(offeneMaengel.get(z.id) ?? 0) > 0 && <div className="text-xs text-red-700">{t('{n} offene Mängel', { n: offeneMaengel.get(z.id) })}</div>}
                  </div>
                  <Weiter />
                </Link>
                {elemente && (
                  <Link to={`/anlagen/${z.id}/elemente`} className="btn-sekundaer -mt-1 mb-3 ml-[4.25rem] mr-4 w-fit px-2.5 py-1 text-xs">
                    {t('{elemente} verwalten ({n})', { elemente: elemente.mehrzahl, n: z.anlage_element[0]?.count ?? 0 })}
                  </Link>
                )}
              </li>
            )
          })}
        </Kacheln>
      ) : (
        <div className="karte overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>{kopfZelle('etikett', t('Etikett'))}{kopfZelle('kunde', t('Kunde / Objekt'))}{kopfZelle('lage', t('Lage'))}{kopfZelle('typ', t('Typ'))}{kopfZelle('letzte', t('Letzte Prüfung'))}{kopfZelle('naechste', t('Fällig'))}<th className="w-8" /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {gefiltert.map((z) => (
                <tr key={z.id} onClick={() => navigate(`/objekte/${z.objekt?.id}?anlage=${z.id}`)} data-anlage={z.etikett_id ?? z.id}
                  className={`group cursor-pointer transition-colors hover:bg-akzent-hell/60 ${z.status === 'stillgelegt' ? 'text-slate-400' : ''}`}>
                  <td className="whitespace-nowrap px-3 py-2 font-mono">
                    <div className="flex items-center gap-2.5">
                      <ArtSymbol art={z.anlagentyp?.anlagenart} groesse="sm" />
                      <div>
                        <Link className="link" to={`/objekte/${z.objekt?.id}?anlage=${z.id}`} onClick={(e) => e.stopPropagation()}>{z.etikett_id ?? t('ohne')}</Link>
                        <div className="font-sans text-xs text-slate-500">{z.kunden_bezeichnung}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">{z.objekt?.endkunde?.name}<div className="text-xs text-slate-500">{z.objekt?.name}{z.objekt?.ort ? `, ${z.objekt.ort}` : ''}</div></td>
                  <td className="px-3 py-2">{[z.gebaeude, z.etage, z.raum].filter(Boolean).join(' / ') || '–'}{z.lage_beschreibung && <div className="text-xs text-slate-500">{z.lage_beschreibung}</div>}</td>
                  <td className="px-3 py-2">{z.anlagentyp?.name}{(z.hersteller || eigenschaftenKurz(z.anlagentyp?.anlagenart, z.eigenschaften)) && <div className="text-xs text-slate-500">{[z.hersteller, eigenschaftenKurz(z.anlagentyp?.anlagenart, z.eigenschaften)].filter(Boolean).join(' · ')}</div>}
                    {artDefinition(z.anlagentyp?.anlagenart).elemente && (
                      <Link to={`/anlagen/${z.id}/elemente`} onClick={(e) => e.stopPropagation()} className="btn-sekundaer mt-1 flex w-fit px-2.5 py-1 text-xs">
                        {t('{elemente} verwalten ({n})', { elemente: artDefinition(z.anlagentyp?.anlagenart).elemente!.mehrzahl, n: z.anlage_element[0]?.count ?? 0 })}
                      </Link>
                    )}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {datum(z.letzte_pruefung_am)}{' '}
                    {z.letztes_ergebnis && <Badge farbe={FARBE[z.letztes_ergebnis]}>{ERGEBNIS[z.letztes_ergebnis]}</Badge>}
                    {(offeneMaengel.get(z.id) ?? 0) > 0 && <div className="text-xs text-red-700">{t('{n} offene Mängel', { n: offeneMaengel.get(z.id) })}</div>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {z.status === 'stillgelegt' ? t('stillgelegt') : z.naechste_pruefung_am
                      ? <Badge farbe={z.naechste_pruefung_am < heute ? 'rot' : 'grau'}>{datum(z.naechste_pruefung_am)}</Badge>
                      : <Badge>{t('nie geprüft')}</Badge>}
                    {z.status !== 'stillgelegt' && <div className="mt-1 flex flex-wrap gap-1"><AustauschBadges z={austausch.jeAnlage.get(z.id)} /></div>}
                  </td>
                  <td className="pr-3"><Weiter /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AnlageNeuDialog offen={neu} onSchliessen={() => setNeu(false)}
        onFertig={() => { setNeu(false); void liste.neuLaden() }} />
    </Seite>
  )
}

function datumOderLeer(d: string | null | undefined) {
  return d ? new Date(d).toLocaleDateString(gebietsschema()) : ''
}
