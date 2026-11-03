import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useAuth } from '../auth'
import { bestaetigen } from '../components/Bestaetigung'
import { artFelder, eigenschaftenTrennen, eigenschaftenWerte, lageFelder, type AnlageWerte } from '../components/anlageFelder'
import { AustauschBadges } from '../components/AustauschHinweis'
import { Pruefungsverlauf } from '../components/Pruefungsverlauf'
import { TUERANLAGE_TYP } from '../lib/tueranlage'
import { bestandId, istBestandArt } from '../lib/bestand'
import { Formular, type FeldDef } from '../components/Formular'
import { etikettTippfehler, normalisiereEtikett } from '../lib/etikett'
import { Lesbar } from '../components/Lesbar'
import { ArtSymbol, typOptionen, Weiter } from '../components/Symbole'
import { AnsichtWahl, Badge, datum, Dialog, Fehler, Kacheln, Laden, Leer, Seite, Tabelle } from '../components/ui'
import { useAnsicht } from '../lib/ansicht'
import { fehlertext, supabase, type Aenderung, type Zeile } from '../lib/supabase'
import { demoKnopf, demoSperreAktiv } from '../lib/demo'
import { artDefinition, eigenschaftenKurz } from '../lib/anlagenarten'
import { type AustauschZaehler } from '../lib/austausch'
import { aktiveArten, tb } from '../lib/begriffe'
import { t, tMeldung } from '../lib/sprache'
import { anlageVergleich } from '../lib/sortierung'
import { ausAbgeschlossenerPruefung, offeneMaengelJe, type MaengelStand } from '../lib/maengel'
import { MaengelBadge } from './pruefen/MaengelBadge'
import { entschluesselt } from '../lib/entschluesselt'
import { useAbfrage } from '../lib/useAbfrage'
import { verschluesseln } from '../lib/verschluesselung'
import { useAustausch } from '../lib/useAustausch'
import { OBJEKT_FELDER } from './KundeDetail'

type Faelligkeit = Pick<Zeile<'anlage_faelligkeit'>, 'pruefart_id' | 'intervall_monate' | 'letzte_pruefung_am' | 'naechste_pruefung_am'>
type Anlage = Zeile<'anlage'> & { anlagentyp: { name: string; anlagenart: string } | null; anlage_faelligkeit: Faelligkeit[]
  anlage_element: { count: number }[] }
type TypMitPruefarten = { id: string; name: string; anlagenart: string; aktiv: boolean
  pruefart: { id: string; name: string; intervall_monate: number; reihenfolge: number; aktiv: boolean }[] }

const AMPEL = { gruen: ['gruen', t('ohne Mängel')], gelb: ['gelb', t('mit Mängeln')], rot: ['rot', t('nicht betriebssicher')] } as const
/** Bis zu so vielen Anlagen steht die markierte ohnehin im Blick, eine eigene Karte oben wäre doppelt */
const KURZE_LISTE = 3

export default function ObjektDetail() {
  const { id = '' } = useParams()
  const [suchParams] = useSearchParams()
  const markiert = suchParams.get('anlage')
  const { istAdmin } = useAuth()
  const navigate = useNavigate()
  const [bearbeiten, setBearbeiten] = useState(false)
  const [anlageDialog, setAnlageDialog] = useState<Anlage | 'neu' | null>(null)
  const [loeschFehler, setLoeschFehler] = useState('')
  const [filter, setFilter] = useState('')
  const [ansicht, setAnsicht] = useAnsicht('objekt.anlagen')

  const objekt = useAbfrage(
    () => entschluesselt('objekt', supabase.from('objekt').select('*, endkunde(id, name)').eq('id', id).single()), [id])
  const anlagen = useAbfrage(
    () => entschluesselt('anlage', supabase.from('anlage').select('*, anlagentyp(name, anlagenart), anlage_faelligkeit(pruefart_id, intervall_monate, letzte_pruefung_am, naechste_pruefung_am), anlage_element(count)').eq('objekt_id', id)
      .neq('anlagentyp_id', TUERANLAGE_TYP).order('gebaeude').order('etage').order('kunden_bezeichnung')), [id])
  // Offene Mängel der Anlagen (mit der Prüfung, die sie festgestellt hat: nachzuprüfen erst nach deren Abschluss)
  const maengel = useAbfrage(() => entschluesselt('mangel', supabase.from('mangel')
    .select('id, anlage_id, stufe, beschreibung, status, erstellt_am, entdeckt_in, nachgeprueft_in, fund:entdeckt_in(status, haupt:teil_von_id(status)), anlage!inner(objekt_id)')
    .eq('anlage.objekt_id', id).in('status', ['offen', 'behoben']).order('stufe', { ascending: false }).limit(5000)), [id])
  const maengelJe = useMemo(() => offeneMaengelJe(maengel.daten ?? []), [maengel.daten])
  const typen = useAbfrage(() => supabase.from('anlagentyp').select('id, name, anlagenart, aktiv, pruefart(id, name, intervall_monate, reihenfolge, aktiv)').order('name'))

  const liste = useMemo(() => ([...(anlagen.daten ?? [])] as Anlage[])
    .sort((a, b) => anlageVergleich({ ...a, bezeichnung: a.kunden_bezeichnung }, { ...b, bezeichnung: b.kunden_bezeichnung })), [anlagen.daten])
  const [heute] = useState(() => new Date().toISOString().slice(0, 10))
  const austausch = useAustausch()
  // Auswahl in Gebäude, Etage, Hersteller, Modell und Antrieb: Werte der Anlagen im Objekt
  const vorhandene = useMemo((): AnlageWerte[] => liste.map((anl) => ({ ...anl, art: anl.anlagentyp?.anlagenart })), [liste])

  if (objekt.laedt && !objekt.daten) return <Laden />
  const o = objekt.daten
  if (!o) return <Seite titel={t('Objekt')}><Fehler text={objekt.fehler || t('Nicht gefunden')} /></Seite>

  const gefiltert = liste.filter((anl) =>
    `${anl.etikett_id ?? ''} ${anl.kunden_bezeichnung ?? ''} ${anl.gebaeude ?? ''} ${anl.etage ?? ''} ${anl.lage_beschreibung ?? ''} ${anl.anlagentyp?.name ?? ''}`
      .toLowerCase().includes(filter.toLowerCase()))

  // Karte oben nur, wenn sie das Suchen erspart: nicht für den Bestand (eine Anlage je Objekt und Art) und nicht in kurzen
  // Listen, in denen die markierte Kachel ohnehin zu sehen ist (außer der Filter blendet sie aus)
  const markierteAnlage = markiert ? liste.find((anl) => anl.id === markiert) : undefined
  const gewaehlt = markierteAnlage && !istBestandArt(markierteAnlage.anlagentyp?.anlagenart)
    && (gefiltert.length > KURZE_LISTE || !gefiltert.includes(markierteAnlage)) ? markierteAnlage : undefined

  const typListe = (typen.daten ?? []) as TypMitPruefarten[]
  const typVon = (typId: unknown) => typListe.find((anl) => anl.id === typId)
  const pruefartenVon = (typId: unknown) => (typVon(typId)?.pruefart ?? []).filter((p) => p.aktiv).sort((a, b) => a.reihenfolge - b.reihenfolge)
  const bearbeitet = anlageDialog !== 'neu' ? anlageDialog : null
  // Auswahl: aktive Typen der eingeschalteten Arten (und der bisherige Typ der Anlage)
  const typAuswahl = typOptionen(typListe.filter((anl) => (anl.aktiv && aktiveArten().includes(anl.anlagenart as never)) || anl.id === bearbeitet?.anlagentyp_id))

  const anlageFelder = (w: Record<string, unknown>): FeldDef[] => {
    const art = typVon(w.anlagentyp_id)?.anlagenart
    const arten = pruefartenVon(w.anlagentyp_id)
    const einzeln = arten.length <= 1
    // Bestand (Rauchwarnmelder, Geräte): keine Stammdaten, nur Typ (derselben Art), Intervalle und Status
    if (istBestandArt(art)) {
      const optionen = bearbeitet ? typOptionen(typListe.filter((anl) => anl.anlagenart === art && (anl.aktiv || anl.id === bearbeitet.anlagentyp_id))) : typAuswahl
      return [
        { name: 'anlagentyp_id', label: tb('Türtyp'), typ: 'select', pflicht: true, breit: true, optionen,
          hinweis: bearbeitet ? undefined : t('Je Objekt gibt es eine Anlage „{art}“ ohne Stammdaten; erfasst werden die {elemente}.', { art: t(artDefinition(art).name), elemente: t(artDefinition(art).elemente?.mehrzahl ?? 'Elemente') }) },
        ...(bearbeitet ? arten.map((p): FeldDef => ({ name: `f.${p.id}.intervall`, label: einzeln ? t('Prüfintervall (Monate)') : t('Intervall {pruefart} (Monate)', { pruefart: p.name }),
          typ: 'number', hinweis: t('Leer = {n} Monate', { n: p.intervall_monate }) })) : []),
        ...(bearbeitet ? [{ name: 'status', label: t('Status'), typ: 'select', pflicht: true,
          optionen: [{ wert: 'aktiv', text: t('aktiv') }, { wert: 'stillgelegt', text: t('stillgelegt') }] } as FeldDef] : []),
      ]
    }
    return [
      { name: 'anlagentyp_id', label: tb('Türtyp'), typ: 'select', pflicht: true, breit: true, optionen: typAuswahl },
      { name: 'etikett_id', label: t('Etikett-ID'), hinweis: t('z. B. PK-000 0427 – leer lassen, wenn noch kein Etikett klebt') },
      { name: 'kunden_bezeichnung', label: t('Bezeichnung beim Kunden'), hinweis: t('z. B. „T 2.14“ aus dem Brandschutzplan') },
      ...lageFelder(vorhandene),
      { name: 'raum', label: t('Raum') },
      { name: 'lage_beschreibung', label: t('Lagebeschreibung'), breit: true, hinweis: t('z. B. „Treppenhaus Ost, Ausgang Hof“') },
      ...artFelder(art, false, vorhandene, w).slice(0, 2),
      ...artFelder(art, true, vorhandene),
      { name: 'baujahr', label: t('Baujahr'), typ: 'number' },
      // Bestand: letzte Prüfung und abweichendes Intervall je Prüfart
      ...arten.flatMap((p): FeldDef[] => [
        { name: `f.${p.id}.letzte`, label: einzeln ? t('Letzte Prüfung am') : t('Letzte {pruefart}', { pruefart: p.name }), typ: 'date', max: heute,
          hinweis: einzeln ? tb('Für Türen aus dem Bestand. Die nächste Prüfung wird daraus automatisch berechnet.') : undefined },
        { name: `f.${p.id}.intervall`, label: einzeln ? t('Prüfintervall (Monate)') : t('Intervall {pruefart} (Monate)', { pruefart: p.name }), typ: 'number',
          hinweis: einzeln ? tb('Leer = Standard des Türtyps') : t('Leer = {n} Monate', { n: p.intervall_monate }) },
      ]),
      ...(anlageDialog !== 'neu'
        ? [{ name: 'status', label: t('Status'), typ: 'select', pflicht: true,
            optionen: [{ wert: 'aktiv', text: t('aktiv') }, { wert: 'stillgelegt', text: t('stillgelegt') }] } as FeldDef]
        : []),
    ]
  }

  const anlageStart = (anl: Anlage | null): Record<string, unknown> => anl ? {
    ...anl, ...eigenschaftenWerte(anl.eigenschaften),
    ...Object.fromEntries(anl.anlage_faelligkeit.flatMap((f) => [[`f.${f.pruefart_id}.letzte`, f.letzte_pruefung_am], [`f.${f.pruefart_id}.intervall`, f.intervall_monate]])),
  } : {}

  const anlageLoeschen = async (anl: Anlage) => {
    setLoeschFehler('')
    const name = [anl.etikett_id, anl.kunden_bezeichnung].filter(Boolean).join(' · ') || tb('diese Tür')
    if (!await bestaetigen(tb('Tür „{name}“ endgültig löschen?', { name }) + (anl.etikett_id ? '\n\n' + t('Das Etikett {etikett} wird wieder frei.', { etikett: anl.etikett_id }) : '') + '\n\n' + tb('Türen mit Prüfungen können nicht gelöscht werden – dafür „stillgelegt“ verwenden.'), { ok: t('Löschen'), gefahr: true })) return
    const { error } = await supabase.from('anlage').delete().eq('id', anl.id)
    if (error) return setLoeschFehler(fehlertext(error))
    setAnlageDialog(null)
    anlagen.neuLaden()
  }

  const anlageSpeichern = async (w: Record<string, unknown>) => {
    const art = typVon(w.anlagentyp_id)?.anlagenart
    if (istBestandArt(art)) return bestandSpeichern(w, art!)
    if (w.etikett_id) w.etikett_id = normalisiereEtikett(String(w.etikett_id))
    if (w.etikett_id) {
      const tippfehler = etikettTippfehler(w.etikett_id as string)
      if (tippfehler) return tMeldung(tippfehler)
      const { data: e } = await supabase.from('etikett').select('id, anlage_id').eq('id', w.etikett_id as string).maybeSingle()
      if (!e) return t('Etikett {etikett} existiert nicht.', { etikett: String(w.etikett_id) })
      if (e.anlage_id && (anlageDialog === 'neu' || e.anlage_id !== anlageDialog?.id)) return tb('Etikett {etikett} ist bereits einer anderen Tür zugeordnet.', { etikett: String(w.etikett_id) })
    }
    const { eigenschaften, rest } = eigenschaftenTrennen(typVon(w.anlagentyp_id)?.anlagenart, w, bearbeitet?.eigenschaften)
    const spalten = { ...Object.fromEntries(Object.entries(rest).filter(([k]) => !k.startsWith('f.'))), eigenschaften }
    // Die ID gehört zu den Zusatzdaten der Verschlüsselung (Ansprechpartner): bei einer neuen Anlage schon vorher festlegen
    const anlageId = anlageDialog === 'neu' ? crypto.randomUUID() : anlageDialog!.id
    const geheim = await verschluesseln('anlage', spalten, anlageId)
    const { data, error } = anlageDialog === 'neu'
      ? await supabase.from('anlage').insert({ ...(geheim as unknown as { anlagentyp_id: string }), id: anlageId, objekt_id: id }).select('id').single()
      : await supabase.from('anlage').update(geheim as Aenderung<'anlage'>).eq('id', anlageId).select('id').single()
    if (error) return fehlertext(error)
    // Letzte Prüfung / Intervall je Prüfart (nur geänderte oder schon vorhandene Einträge)
    const faelligkeiten = pruefartenVon(w.anlagentyp_id).map((p) => ({
      anlage_id: data.id, pruefart_id: p.id,
      letzte_pruefung_am: (w[`f.${p.id}.letzte`] as string | null) ?? null,
      intervall_monate: (w[`f.${p.id}.intervall`] as number | null) ?? null,
    })).filter((f) => f.letzte_pruefung_am || f.intervall_monate || bearbeitet?.anlage_faelligkeit.some((x) => x.pruefart_id === f.pruefart_id))
    if (faelligkeiten.length) {
      const { error: ef } = await supabase.from('anlage_faelligkeit').upsert(faelligkeiten)
      if (ef) return fehlertext(ef)
    }
    setAnlageDialog(null)
    anlagen.neuLaden()
  }

  // Bestand anlegen (gibt es ihn schon, ihn öffnen) bzw. Typ, Intervalle und Status ändern
  const bestandSpeichern = async (w: Record<string, unknown>, art: string) => {
    if (anlageDialog === 'neu') {
      const vorhanden = liste.find((anl) => anl.anlagentyp?.anlagenart === art)
      if (vorhanden) {
        setAnlageDialog(null)
        return void navigate(`/anlagen/${vorhanden.id}/elemente`)
      }
      const { data, error } = await supabase.from('anlage').insert({ id: bestandId(id, art), objekt_id: id, anlagentyp_id: w.anlagentyp_id as string })
        .select('id').single()
      if (error) return fehlertext(error)
      setAnlageDialog(null)
      return void navigate(`/anlagen/${data.id}/elemente`)
    }
    const { error } = await supabase.from('anlage').update({ anlagentyp_id: w.anlagentyp_id as string, status: w.status as 'aktiv' | 'stillgelegt' })
      .eq('id', anlageDialog!.id)
    if (error) return fehlertext(error)
    const faelligkeiten = pruefartenVon(w.anlagentyp_id).map((p) => ({
      anlage_id: anlageDialog!.id, pruefart_id: p.id, intervall_monate: (w[`f.${p.id}.intervall`] as number | null) ?? null,
      letzte_pruefung_am: anlageDialog!.anlage_faelligkeit.find((f) => f.pruefart_id === p.id)?.letzte_pruefung_am ?? null,
    })).filter((f) => f.intervall_monate || anlageDialog!.anlage_faelligkeit.some((x) => x.pruefart_id === f.pruefart_id))
    if (faelligkeiten.length) {
      const { error: ef } = await supabase.from('anlage_faelligkeit').upsert(faelligkeiten)
      if (ef) return fehlertext(ef)
    }
    setAnlageDialog(null)
    anlagen.neuLaden()
  }

  return (
    <Seite
      titel={<><Lesbar>{o.name}</Lesbar> {!o.aktiv && <Badge>{t('inaktiv')}</Badge>}</>}
      zurueck={o.endkunde ? { zu: `/kunden/${o.endkunde.id}`, text: o.endkunde.name } : undefined}
      aktionen={<>
        <button className="btn-primaer" onClick={() => navigate(`/pruefen/o/${id}`)}>{t('Prüfen')}</button>
        {istAdmin && <button className="btn-sekundaer" onClick={() => setBearbeiten(true)}>{t('Bearbeiten')}</button>}
      </>}
    >
      <div className="karte space-y-1 p-4 text-sm">
        <div><span className="text-slate-500">{t('Adresse:')}</span> {[o.strasse, [o.plz, o.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '–'}</div>
        {o.zugangshinweise && <div><span className="text-slate-500">{t('Zugang:')}</span> {o.zugangshinweise}</div>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <h2 className="text-lg font-semibold">{tb('Türen ({n})', { n: liste.length })}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <AnsichtWahl wert={ansicht} onWechsel={setAnsicht} />
          <input type="search" placeholder={t('Filtern …')} value={filter} onChange={(e) => setFilter(e.target.value)} className="mt-0 w-48" />
          {istAdmin && (demoSperreAktiv()
            ? <button className="btn-sekundaer" {...demoKnopf()}>{t('Importieren …')}</button>
            : <Link to={`/objekte/${id}/import`} className="btn-sekundaer">{t('Importieren …')}</Link>)}
          {istAdmin && <button className="btn-primaer" {...demoKnopf()} onClick={() => setAnlageDialog('neu')}>{tb('+ Tür')}</button>}
        </div>
      </div>
      <Fehler text={anlagen.fehler} />
      {/* Gescannte bzw. gewählte Tür oben, damit sie in langen Listen nicht erst gesucht werden muss (auch bei aktivem Filter) */}
      {gewaehlt && (
        <section className="karte bg-akzent-hell ring-2 ring-akzent" data-gewaehlt={gewaehlt.etikett_id ?? gewaehlt.id}>
          <div className="px-4 pt-3 text-xs font-semibold tracking-wide text-slate-600 uppercase">
            {suchParams.get('quelle') === 'scan' ? t('Gescannt') : tb('Gewählte Tür')}
          </div>
          <button onClick={() => setAnlageDialog(gewaehlt)} className="zeile group items-start">
            <AnlageKurz anl={gewaehlt} heute={heute} austausch={austausch.jeAnlage.get(gewaehlt.id)} maengel={maengelJe.get(gewaehlt.id)} />
            <span className="self-center"><Weiter /></span>
          </button>
          <ElementeKnopf anl={gewaehlt} istAdmin={istAdmin} klasse="mb-3 ml-[4.25rem] mr-4 -mt-1" />
        </section>
      )}
      {liste.length === 0 && !anlagen.laedt ? <Leer>{tb('Noch keine Türen erfasst.')}</Leer> : ansicht === 'kacheln' ? (
        <Kacheln>
          {gefiltert.map((anl) => (
            <li key={anl.id} data-anlage={anl.etikett_id ?? anl.id}
              className={`karte flex flex-col ${markiert === anl.id ? 'bg-akzent-hell ring-2 ring-akzent' : ''} ${anl.status === 'stillgelegt' ? 'text-slate-400' : ''}`}>
              <button onClick={() => setAnlageDialog(anl)} className="group flex flex-1 items-start gap-3 rounded-lg p-4 text-left transition-colors hover:bg-akzent-hell/40">
                <ArtSymbol art={anl.anlagentyp?.anlagenart} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <EtikettKurz anl={anl} />
                    <span className="font-medium">{anl.kunden_bezeichnung}</span>
                  </div>
                  <div className="text-sm">{[anl.gebaeude, anl.etage, anl.raum].filter(Boolean).join(' / ')}{anl.lage_beschreibung && ` · ${anl.lage_beschreibung}`}</div>
                  <div className="text-xs text-slate-500">{[anl.anlagentyp?.name, eigenschaftenKurz(anl.anlagentyp?.anlagenart, anl.eigenschaften)].filter(Boolean).join(' · ')}</div>
                  <div className="mt-2 flex flex-wrap gap-1"><Pruefstatus anl={anl} heute={heute} austausch={austausch.jeAnlage.get(anl.id)} maengel={maengelJe.get(anl.id)} /></div>
                </div>
                <Weiter />
              </button>
              <ElementeKnopf anl={anl} istAdmin={istAdmin} klasse="-mt-1 mb-3 ml-[4.25rem] mr-4" />
            </li>
          ))}
        </Kacheln>
      ) : (
        <>
          {/* Handy: Karten */}
          <ul className="karte divide-y divide-slate-100 md:hidden">
            {gefiltert.map((anl) => (
              <li key={anl.id}>
                <button onClick={() => setAnlageDialog(anl)}
                  className={`zeile group items-start ${markiert === anl.id ? 'bg-akzent-hell' : ''} ${anl.status === 'stillgelegt' ? 'text-slate-400' : ''}`}>
                  <AnlageKurz anl={anl} heute={heute} austausch={austausch.jeAnlage.get(anl.id)} maengel={maengelJe.get(anl.id)} />
                  <span className="self-center"><Weiter /></span>
                </button>
                <ElementeKnopf anl={anl} istAdmin={istAdmin} klasse="mb-3 ml-[4.25rem] mr-4 -mt-1" />
              </li>
            ))}
          </ul>
          {/* Desktop: Tabelle */}
          <div className="hidden md:block">
            <Tabelle kopf={[t('Etikett'), t('Bezeichnung'), t('Lage'), t('Typ'), t('Prüfung'), '']}>
              {gefiltert.map((anl) => (
                <tr key={anl.id} onClick={() => setAnlageDialog(anl)}
                  className={`group cursor-pointer transition-colors hover:bg-akzent-hell/60 ${markiert === anl.id ? 'bg-akzent-hell' : ''} ${anl.status === 'stillgelegt' ? 'text-slate-400' : ''}`}>
                  <td className="whitespace-nowrap px-3 py-2 font-mono">
                    <span className="flex items-center gap-2.5"><ArtSymbol art={anl.anlagentyp?.anlagenart} groesse="sm" />
                      {istBestandArt(anl.anlagentyp?.anlagenart) ? null : anl.etikett_id ?? <Badge farbe="gelb">{t('ohne')}</Badge>}</span>
                  </td>
                  <td className="px-3 py-2">{anl.kunden_bezeichnung ?? '–'}</td>
                  <td className="px-3 py-2">{[anl.gebaeude, anl.etage, anl.raum].filter(Boolean).join(' / ')}{anl.lage_beschreibung && <div className="text-xs text-slate-500">{anl.lage_beschreibung}</div>}</td>
                  <td className="px-3 py-2">{anl.anlagentyp?.name}{eigenschaftenKurz(anl.anlagentyp?.anlagenart, anl.eigenschaften) && <div className="text-xs text-slate-500">{eigenschaftenKurz(anl.anlagentyp?.anlagenart, anl.eigenschaften)}</div>}
                    <ElementeKnopf anl={anl} istAdmin={istAdmin} klasse="mt-1" /></td>
                  <td className="space-y-1 px-3 py-2"><Pruefstatus anl={anl} heute={heute} austausch={austausch.jeAnlage.get(anl.id)} maengel={maengelJe.get(anl.id)} /></td>
                  <td className="w-8 pr-3"><Weiter /></td>
                </tr>
              ))}
            </Tabelle>
          </div>
        </>
      )}

      <section className="space-y-2 pt-2">
        <h2 className="text-lg font-semibold">{t('Prüfungen und Protokolle')}</h2>
        <Pruefungsverlauf objektId={id} leer={t('Noch keine Prüfungen.')} />
      </section>

      <Dialog offen={bearbeiten} titel={t('Objekt bearbeiten')} onSchliessen={() => setBearbeiten(false)}>
        <Formular
          felder={[...OBJEKT_FELDER, { name: 'aktiv', label: t('aktiv'), typ: 'checkbox' }]}
          start={o}
          onAbbrechen={() => setBearbeiten(false)}
          onSpeichern={async (w) => {
            const { error } = await supabase.from('objekt').update(await verschluesseln('objekt', w, id) as Aenderung<'objekt'>).eq('id', id)
            if (error) return fehlertext(error)
            setBearbeiten(false)
            objekt.neuLaden()
          }}
        />
      </Dialog>

      <Dialog offen={anlageDialog !== null} titel={anlageDialog === 'neu' ? tb('Neue Tür') : istAdmin ? tb('Tür bearbeiten') : tb('Tür')}
        onSchliessen={() => setAnlageDialog(null)} breit>
        {anlageDialog && anlageDialog !== 'neu' && istAdmin && artDefinition(anlageDialog.anlagentyp?.anlagenart).elemente && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 p-3" data-elemente-knopf>
            <span className="text-sm">
              <strong>{anlageDialog.anlage_element[0]?.count ?? 0}</strong> {t('{elemente} erfasst', { elemente: t(artDefinition(anlageDialog.anlagentyp?.anlagenart).elemente!.mehrzahl) })}
            </span>
            <Link className="btn-primaer" to={`/anlagen/${anlageDialog.id}/elemente`}>
              {t('{elemente} verwalten', { elemente: t(artDefinition(anlageDialog.anlagentyp?.anlagenart).elemente!.mehrzahl) })}
            </Link>
          </div>
        )}
        <Formular
          key={anlageDialog === 'neu' ? 'neu' : anlageDialog?.id}
          felder={anlageFelder}
          start={anlageStart(bearbeitet)}
          onAbbrechen={() => setAnlageDialog(null)}
          onSpeichern={anlageSpeichern}
          nurLesen={!istAdmin}
          zusatz={anlageDialog && anlageDialog !== 'neu' && (
            <>
              {anlageDialog.naechste_pruefung_am && (
                <p className="text-sm text-slate-600">{t('Nächste Prüfung (berechnet):')} <strong>{datum(anlageDialog.naechste_pruefung_am)}</strong></p>
              )}
              <OffeneMaengel maengel={(maengel.daten ?? []).filter((m) => m.anlage_id === anlageDialog.id)}
                ziel={`/pruefen/o/${id}?anlage=${anlageDialog.id}`} />
              <section className="space-y-2 border-t border-slate-200 pt-3" aria-label={t('Verlauf')}>
                <h3 className="font-semibold">{t('Verlauf')}</h3>
                <Pruefungsverlauf anlageId={anlageDialog.id} leer={t('Noch nicht geprüft.')} />
              </section>
              {istAdmin && (
                <div className="space-y-2 border-t border-slate-200 pt-3">
                  <button type="button" className="btn-sekundaer text-red-700" {...demoKnopf()} onClick={() => void anlageLoeschen(anlageDialog)}>{tb('Tür löschen')}</button>
                  <Fehler text={loeschFehler} />
                </div>
              )}
            </>
          )}
        />
      </Dialog>
    </Seite>
  )
}

/** Tür als Zeile (Handy-Liste und Karte der gewählten Tür): Symbol, Etikett, Bezeichnung, Lage, Typ, Prüfstand. */
function AnlageKurz({ anl, heute, austausch, maengel }: { anl: Anlage; heute: string; austausch?: AustauschZaehler; maengel?: MaengelStand }) {
  return (
    <>
      <ArtSymbol art={anl.anlagentyp?.anlagenart} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <EtikettKurz anl={anl} />
          <span className="font-medium">{anl.kunden_bezeichnung}</span>
        </div>
        <div className="text-sm">{[anl.gebaeude, anl.etage, anl.raum].filter(Boolean).join(' / ')}{anl.lage_beschreibung && ` · ${anl.lage_beschreibung}`}</div>
        <div className="text-xs text-slate-500">{anl.anlagentyp?.name}</div>
        <div className="mt-1 flex flex-wrap gap-1"><Pruefstatus anl={anl} heute={heute} austausch={austausch} maengel={maengel} /></div>
      </div>
    </>
  )
}

/** Etikett der Anlage; ein Bestand (Rauchwarnmelder, Geräte) hat keins */
function EtikettKurz({ anl }: { anl: Anlage }) {
  if (istBestandArt(anl.anlagentyp?.anlagenart)) return null
  return <span className="whitespace-nowrap font-mono font-semibold">{anl.etikett_id ?? <Badge farbe="gelb">{t('ohne Etikett')}</Badge>}</span>
}

function Pruefstatus({ anl, heute, austausch, maengel }: { anl: Anlage; heute: string; austausch?: AustauschZaehler; maengel?: MaengelStand }) {
  if (anl.status === 'stillgelegt') return <Badge>{t('stillgelegt')}</Badge>
  return (
    <>
      <MaengelBadge stand={maengel} />
      {anl.letztes_ergebnis
        ? <Badge farbe={AMPEL[anl.letztes_ergebnis][0]}>{datum(anl.letzte_pruefung_am)} {AMPEL[anl.letztes_ergebnis][1]}</Badge>
        : anl.letzte_pruefung_am ? <Badge>{t('geprüft {datum}', { datum: datum(anl.letzte_pruefung_am) })}</Badge> : <Badge>{t('noch nicht geprüft')}</Badge>}
      {' '}
      {anl.naechste_pruefung_am && (
        <Badge farbe={anl.naechste_pruefung_am < heute ? 'rot' : 'grau'}>{t('fällig {datum}', { datum: datum(anl.naechste_pruefung_am) })}</Badge>
      )}
      <AustauschBadges z={austausch} />
    </>
  )
}

/** Leuchten bzw. Melder einer Anlage: für Admin/Planer ein deutlicher Knopf zur Verwaltung, sonst nur die Anzahl. */
function ElementeKnopf({ anl, istAdmin, klasse = '' }: { anl: Anlage; istAdmin: boolean; klasse?: string }) {
  const def = artDefinition(anl.anlagentyp?.anlagenart).elemente
  if (!def) return null
  const zahl = anl.anlage_element[0]?.count ?? 0
  if (!istAdmin) return <div className={`text-xs text-slate-500 ${klasse}`}>{zahl} {t(def.mehrzahl)}</div>
  return (
    <div className={klasse}>
      <Link to={`/anlagen/${anl.id}/elemente`} onClick={(e) => e.stopPropagation()} className="btn-sekundaer px-2.5 py-1 text-xs">
        {t('{elemente} verwalten ({n})', { elemente: t(def.mehrzahl), n: zahl })}
      </Link>
    </div>
  )
}

/** Offene Mängel einer Anlage im Dialog, mit dem Weg zur Nachprüfung (erst nach Abschluss der Prüfung, die sie festgestellt hat). */
function OffeneMaengel({ maengel, ziel }: {
  maengel: { id: string; stufe: number; beschreibung: string; status: string; erstellt_am: string; fund: Parameters<typeof ausAbgeschlossenerPruefung>[0] | null }[]
  ziel: string
}) {
  if (!maengel.length) return null
  const nachzupruefen = maengel.some((m) => ausAbgeschlossenerPruefung(m.fund ?? undefined))
  return (
    <section className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3" aria-label={t('Offene Mängel')} data-offene-maengel>
      <h3 className="font-semibold text-red-900">{maengel.length === 1 ? t('1 offener Mangel') : t('{n} offene Mängel', { n: maengel.length })}</h3>
      <ul className="space-y-0.5 text-sm text-red-900">
        {maengel.map((m) => <li key={m.id}>{t('Stufe {stufe}:', { stufe: m.stufe })} {m.beschreibung} <span className="text-xs text-slate-500">({datum(m.erstellt_am)}{m.status === 'behoben' ? t(', als behoben gemeldet') : ''})</span></li>)}
      </ul>
      {nachzupruefen
        ? <Link className="btn-primaer inline-block" to={`${ziel}&nachpruefen=1`}>{t('Nachprüfen')}</Link>
        : <p className="text-sm text-slate-700">{t('Festgestellt in einer Prüfung, die noch läuft – nachprüfen lässt sich erst nach deren Abschluss.')} <Link className="link" to={ziel}>{t('Zur Prüfung')}</Link></p>}
    </section>
  )
}

