// Prüfen in einem Objekt: alle Anlagen mit ihrem Stand (fällig, in Prüfung, heute geprüft). Jede Anlage wird für sich
// geprüft und abgeschlossen; die Türen des Objekts gemeinsam in seiner Türanlage (docs/KONZEPT-TUERANLAGE.md).
import { useLiveQuery } from 'dexie-react-hooks'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { useAuth } from '../../auth'
import { bestaetigen } from '../../components/Bestaetigung'
import { artFelder, eigenschaftenTrennen, lageFelder } from '../../components/anlageFelder'
import { Formular } from '../../components/Formular'
import { istBestandArt, nachPruefungAngelegt } from '../../lib/bestand'
import { artDefinition } from '../../lib/anlagenarten'
import { istTueranlage, tueranlageName, tuerPflicht } from '../../lib/tueranlage'
import { ArtSymbol, EtikettText, PruefartSymbol, typOptionen, Weiter } from '../../components/Symbole'
import { Badge, datum, Dialog, Fehler, Laden, Seite } from '../../components/ui'
import { etikettTippfehler, normalisiereEtikett } from '../../lib/etikett'
import { anlageVergleich, etagenRang } from '../../lib/sortierung'
import { gebaeudeListe, gebaeudeVon } from '../../lib/elemente'
import { ausAbgeschlossenerPruefung, maengelSumme, offeneMaengelJe } from '../../lib/maengel'
import { fehlertext } from '../../lib/supabase'
import { entschluesseln } from '../../lib/verschluesselung'
import { heuteBeginn, objektAbgleichen, objektBeobachten, objektHerunterladen, type FreigabeHinweis } from '../../offline/abgleich'
import { objektSchluessel } from '../../offline/aufraeumen'
import { anlageAnlegen, etikettPruefen, laeuft, pruefungFreigeben, pruefungOeffnen, type MitpruefAngebot } from '../../offline/aktionen'
import { db, metaLesen, metaSchreiben, type Anlage, type Element, type Mangel, type Mitpruefer, type Pruefart, type Pruefung } from '../../offline/db'
import { useSyncStatus } from '../../offline/sync'
import { tb } from '../../lib/begriffe'
import { t } from '../../lib/sprache'
import { FreiesEtikett } from './Etikett'
import { MaengelBadge } from './MaengelBadge'
import { MitpruefAnfragen, MitpruefenAnfrage } from './Mitpruefen'
import { satz } from './satz'

const QrScanner = lazy(() => import('../../components/QrScanner'))

const AMPEL = { gruen: ['gruen', t('ohne Mängel')], gelb: ['gelb', t('mit Mängeln')], rot: ['rot', t('nicht betriebssicher')] } as const
const tag = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function ObjektPruefen() {
  const { oid = '' } = useParams()
  const navigate = useNavigate()
  const ort = useLocation()
  const { benutzer, istAdmin } = useAuth()
  const ich = benutzer!.id
  const { online } = useSyncStatus()

  const [scannen, setScannen] = useState(Boolean((ort.state as { scannen?: boolean } | null)?.scannen))
  const [filter, setFilter] = useState('')
  const [nurFaellige, setNurFaellige] = useState(false)
  const [meldung, setMeldung] = useState('')
  // Zuletzt angetippte Anlage, die ein Kollege gerade prüft (Admin/Planer kann sie freigeben)
  const [belegt, setBelegt] = useState<{ id: string; wer: string; tueranlage: boolean } | null>(null)
  const meldungRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (meldung) meldungRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [meldung])
  const [laden, setLaden] = useState(() => (navigator.onLine ? t('Daten werden geladen …') : ''))
  const [jetzt] = useState(() => Date.now())
  const [neueAnlage, setNeueAnlage] = useState<{ etikett?: string } | null>(null)
  const [freiesEtikett, setFreiesEtikett] = useState<string | null>(null)
  const [mitpruefWahl, setMitpruefWahl] = useState<{ angebot: MitpruefAngebot; text: string } | null>(null)
  const [pruefartWahl, setPruefartWahl] = useState<{ anlage: Anlage; erfassung: 'scan' | 'manuell'; auswahl: Pruefart[] } | null>(null)
  const freigaben = useLiveQuery(() => metaLesen<FreigabeHinweis[]>(`freigabe:objekt:${oid}`), [oid])
  // Von der Mängelseite („Nachprüfen“): diese Anlage markieren
  const [suche, setSuche] = useSearchParams()
  const ziel = suche.get('anlage')

  const daten = useLiveQuery(async () => {
    const objekt = await db.objekte.get(oid)
    if (!objekt) return { objekt: undefined }
    const [kunde, anlagen, typen, benutzerListe] = await Promise.all([
      db.kunden.get(objekt.endkunde_id),
      db.anlagen.where('objekt_id').equals(oid).filter((a) => a.status === 'aktiv').toArray(),
      db.anlagentypen.toArray(),
      db.benutzer.toArray(),
    ])
    const pruefungen = (await db.pruefungen.where('anlage_id').anyOf(anlagen.map((a) => a.id)).toArray()).filter((p) => !p.session_id)
    const mitpruefer = await db.mitpruefer.where('anlagenpruefung_id').anyOf(pruefungen.map((p) => p.id)).toArray()
    const maengel = await db.maengel.where('anlage_id').anyOf(anlagen.map((a) => a.id)).toArray()
    // Nachprüfen: offene Mängel aus abgeschlossenen Prüfungen (aus einer laufenden sind sie dort neu), je Anlage, höchste Stufe zuerst
    const pruefungVon = new Map(pruefungen.map((p) => [p.id, p]))
    const nachpruefen = new Map<string, Mangel[]>()
    for (const m of maengel) {
      const fund = pruefungVon.get(m.entdeckt_in)
      if ((m.status !== 'offen' && m.status !== 'behoben') || !ausAbgeschlossenerPruefung(fund && { status: fund.status, haupt: fund.teil_von_id ? pruefungVon.get(fund.teil_von_id) : null })) continue
      nachpruefen.set(m.anlage_id, [...(nachpruefen.get(m.anlage_id) ?? []), m].sort((a, b) => b.stufe - a.stufe))
    }
    // Elemente der Bestände (Melder, Geräte): nach der heutigen Prüfung angelegte sind wieder fällig
    const typArten = new Map(typen.map((t) => [t.id, t.anlagenart]))
    const bestaende = anlagen.filter((a) => istBestandArt(typArten.get(a.anlagentyp_id))).map((a) => a.id)
    const elemente = bestaende.length ? await db.elemente.where('anlage_id').anyOf(bestaende).filter((e) => e.aktiv).toArray() : []
    // Wohnungen / Bereiche mit Gebäude: der Bestand erscheint bei jedem seiner Gebäude
    const gruppen = bestaende.length ? await db.gruppen.where('anlage_id').anyOf(bestaende).toArray() : []
    const ergebnisse = bestaende.length ? await db.elementErgebnisse.where('anlagenpruefung_id')
      .anyOf(pruefungen.filter((p) => bestaende.includes(p.anlage_id)).map((p) => p.id)).toArray() : []
    const mitErgebnis = new Map<string, Set<string>>()
    for (const r of ergebnisse) mitErgebnis.set(r.anlagenpruefung_id, (mitErgebnis.get(r.anlagenpruefung_id) ?? new Set()).add(r.element_id))
    // Der Gerätespeicher hält Kunde, Objekt und Ansprechpartner verschlüsselt: nach allen Abfragen an Dexie entschlüsseln
    const [objektKlar, kundeKlar, anlagenKlar] = await Promise.all([
      entschluesseln('objekt', objekt), entschluesseln('endkunde', kunde), entschluesseln('anlage', anlagen)])
    return {
      objekt: objektKlar, kunde: kundeKlar, anlagen: anlagenKlar, pruefungen, mitpruefer, elemente, gruppen, mitErgebnis, maengel: offeneMaengelJe(maengel), nachpruefen,
      namen: new Map(benutzerListe.map((b) => [b.id, b.name])),
      typen: new Map(typen.map((t) => [t.id, t.name])), typArten,
    }
  }, [oid])

  // Letzte Nutzung merken (auch offline): danach bleibt das Objekt noch OBJEKT_FRIST_TAGE auf dem Gerät
  useEffect(() => { void metaSchreiben(objektSchluessel(oid), Date.now()) }, [oid])
  // Markierte Anlage in den Blick holen, sobald die Liste steht
  const zielDa = !!daten?.anlagen?.some((a) => a.id === ziel)
  useEffect(() => { if (zielDa) document.querySelector('[data-ziel]')?.scrollIntoView({ block: 'center' }) }, [zielDa])

  // Objekt aufs Gerät holen und den Stand der Kollegen live halten
  useEffect(() => {
    if (!online) return
    let aktiv = true
    void objektHerunterladen(oid).then(() => objektAbgleichen(oid))
      .catch((e) => { if (aktiv) setMeldung(fehlertext(e)) })
      .finally(() => { if (aktiv) setLaden('') })
    const t = setInterval(() => void objektAbgleichen(oid).catch(() => undefined), 30_000)
    const ende = objektBeobachten(oid)
    return () => { aktiv = false; clearInterval(t); ende() }
  }, [oid, online])

  // Bestand aus der Gruppe eines Gebäudes angetippt: die Prüfung zeigt zuerst dessen Elemente
  const zielGebaeude = useRef<string | undefined>(undefined)
  const zu = useCallback((pid: string) => navigate(`/pruefen/p/${pid}${zielGebaeude.current !== undefined
    ? `?gebaeude=${encodeURIComponent(zielGebaeude.current)}` : ''}`), [navigate])

  const oeffnen = useCallback(async (anlage: Anlage, erfassung: 'scan' | 'manuell', pruefartId?: string) => {
    setMeldung('')
    try {
      const r = await pruefungOeffnen(anlage, erfassung, pruefartId)
      if (r.ok) zu(r.pruefungId)
      else if ('auswahl' in r) setPruefartWahl({ anlage, erfassung, auswahl: r.auswahl })
      // Mitprüfen gilt bei Türen der Türanlage des Objekts
      else if ('mitpruefen' in r) setMitpruefWahl({ angebot: r.mitpruefen, text: anlage.teil_von_id || istTueranlage(anlage) ? tueranlageName(daten?.objekt?.name)
        : [anlage.etikett_id, anlage.kunden_bezeichnung].filter(Boolean).join(' · ') || tb('Diese Tür') })
      else setMeldung(r.grund)
    } catch (e) {
      setMeldung(fehlertext(e))
    }
  }, [zu, daten?.objekt?.name])

  /** Antippen bzw. Scannen: laufende Prüfung öffnen, heute abgeschlossene ansehen (außer seitdem kamen Elemente dazu), sonst neu prüfen.
   *  `gebaeude`: Bestand aus der Gruppe dieses Gebäudes angetippt. */
  const waehlen = useCallback((anlage: Anlage, erfassung: 'scan' | 'manuell', gebaeude?: string, nachpruefen = false) => {
    zielGebaeude.current = gebaeude
    const s = daten?.objekt ? stand(anlage, daten.pruefungen, daten.mitpruefer, daten.elemente, daten.mitErgebnis, ich) : undefined
    const offen = s?.mitMir ?? s?.laufend
    if (offen && (offen.pruefer_id === ich || s?.mitMir)) return zu(offen.id)
    // Bei einer Tür ist die Prüfung ihrer Türanlage belegt: die gibt der Admin frei
    setBelegt(offen ? { id: offen.teil_von_id ?? offen.id, wer: daten?.namen?.get(offen.pruefer_id) ?? t('einem Kollegen'),
      tueranlage: !!offen.teil_von_id || istTueranlage(anlage) } : null)
    // Zum Nachprüfen eine neue Prüfung beginnen, auch wenn heute schon eine abgeschlossen ist
    if (!offen && s?.heute && !s.neu.length && !nachpruefen) return zu(s.heute.id)
    void oeffnen(anlage, erfassung)
  }, [daten, ich, zu, oeffnen])

  // „Nachprüfen →“ von der Mängelseite: nach dem Laden des Objekts die Prüfung gleich beginnen (einmal; zurück führt zur Liste)
  const direkt = suche.get('nachpruefen') === '1'
  const zielNachpruefen = !!ziel && !!daten?.nachpruefen?.has(ziel)
  useEffect(() => {
    if (!direkt || !zielDa || laden) return
    setSuche({ anlage: ziel! }, { replace: true })
    const a = daten?.anlagen?.find((x) => x.id === ziel)
    if (a && zielNachpruefen) waehlen(a, 'manuell', undefined, true)
  }, [direkt, zielDa, laden, zielNachpruefen, ziel, daten?.anlagen, setSuche, waehlen])

  const erkannt = useCallback(async (etikett: string) => {
    setScannen(false)
    const id = normalisiereEtikett(etikett)
    const anlage = daten?.anlagen?.find((t) => t.etikett_id === id)
    if (anlage) return waehlen(anlage, 'scan')
    if (await db.freieEtiketten.get(id)) {
      // Gibt es Anlagen ohne Etikett (z. B. importiert), fragen: neue Anlage oder vorhandener zuweisen?
      return daten?.anlagen?.some((t) => !t.etikett_id && !istTueranlage(t) && !istBestandArt(daten?.typArten.get(t.anlagentyp_id)))
        ? setFreiesEtikett(id) : setNeueAnlage({ etikett: id })
    }
    setMeldung(etikettTippfehler(id) ?? tb('Etikett {id} gehört zu keiner Tür dieses Objekts.', { id }))
  }, [daten?.anlagen, daten?.typArten, waehlen])

  if (!daten) return <Laden />
  if (!daten.objekt) {
    return (
      <Seite titel={t('Prüfen')} zurueck={{ zu: '/pruefen', text: t('Prüfen') }}>
        {laden ? <p className="text-sm text-slate-600">{laden}</p>
          : <Fehler text={t('Dieses Objekt ist auf diesem Gerät nicht gespeichert. Bitte einmal mit Internetverbindung öffnen.')} />}
      </Seite>
    )
  }
  const { objekt, kunde, anlagen, pruefungen, mitpruefer, elemente, gruppen: lagen, mitErgebnis, maengel, nachpruefen, namen, typen, typArten } = daten
  const heute = tag(new Date(jetzt))
  const grenze = tag(new Date(jetzt + 30 * 86400_000))
  const staende = new Map(anlagen.map((a) => [a.id, stand(a, pruefungen, mitpruefer, elemente, mitErgebnis, ich)]))
  const faellig = (a: Anlage) => !a.naechste_pruefung_am || a.naechste_pruefung_am <= grenze
  /** Fällig und noch nicht erledigt: nicht heute geprüft – oder seit der heutigen Prüfung kamen Elemente dazu */
  const offenFaellig = (a: Anlage) => { const s = staende.get(a.id)!; return (faellig(a) && !s.heute) || s.neu.length > 0 }
  // Die Türanlage selbst zählt nicht mit (keine eigene Fälligkeit, ihre Türen zählen)
  const ohneTa = anlagen.filter((a) => !istTueranlage(a))
  const zaehler = {
    laufend: ohneTa.filter((a) => staende.get(a.id)!.laufend).length,
    heute: ohneTa.filter((a) => staende.get(a.id)!.heute && !staende.get(a.id)!.laufend).length,
    faellig: ohneTa.filter(offenFaellig).length,
  }
  const doppelt = anlagen.filter((a) => staende.get(a.id)!.doppelt)

  const sichtbar = anlagen
    .filter((t) => !nurFaellige || artDefinition(typArten.get(t.anlagentyp_id)).tueren || offenFaellig(t) || staende.get(t.id)!.laufend)
    .filter((t) => `${t.etikett_id ?? ''} ${t.kunden_bezeichnung ?? ''} ${t.gebaeude ?? ''} ${t.etage ?? ''} ${t.raum ?? ''} ${t.lage_beschreibung ?? ''}`
      .toLowerCase().includes(filter.toLowerCase()))
  // Die Türanlage des Objekts (docs/KONZEPT-TUERANLAGE.md): eigene Gruppe mit allen Türen, darin nach Gebäude/Etage;
  // die übrigen Anlagen in Gebäude-Gruppen. Ohne Türen erscheint die Türanlage nicht.
  const tueranlage = anlagen.find(istTueranlage)
  const zuTueranlage = (a: Anlage) => !!tueranlage && a.teil_von_id === tueranlage.id
  const alleTueren = anlagen.filter(zuTueranlage)
  const sortiert0 = [...anlagen].sort((a, b) => anlageVergleich({ ...a, bezeichnung: a.kunden_bezeichnung }, { ...b, bezeichnung: b.kunden_bezeichnung }))
  const sortiert = [...sichtbar].sort((a, b) => anlageVergleich({ ...a, bezeichnung: a.kunden_bezeichnung }, { ...b, bezeichnung: b.kunden_bezeichnung }))
  // Bestände (Rauchwarnmelder, Geräte) haben keine eigene Lage. Haben ihre Wohnungen / Bereiche ein Gebäude, erscheint der
  // Bestand bei jedem dieser Gebäude (mit den Elementen dort); die übrigen und Bestände ohne Gebäude stehen oben unter
  // „Ganzes Objekt“ statt unter „ohne Gebäude/Etage“.
  const GANZES_OBJEKT = t('Ganzes Objekt')
  const OHNE_LAGE = t('ohne Gebäude/Etage')
  type Eintrag = { t: Anlage; gebaeude?: string; imKasten?: boolean }
  const nachLage = (liste: Anlage[]) => {
    const m = new Map<string, Eintrag[]>()
    const dazu = (k: string, e: Eintrag) => m.set(k, [...(m.get(k) ?? []), e])
    for (const t of liste) {
      if (!istBestandArt(typArten.get(t.anlagentyp_id))) { dazu([t.gebaeude, t.etage].filter(Boolean).join(' · ') || OHNE_LAGE, { t }); continue }
      const eigene = lagen.filter((g) => g.anlage_id === t.id)
      const gebaeude = gebaeudeListe(elemente.filter((e) => e.anlage_id === t.id), eigene)
      if (!gebaeude.some(Boolean)) { dazu(GANZES_OBJEKT, { t }); continue }
      for (const g of gebaeude) dazu(g || GANZES_OBJEKT, { t, gebaeude: g })
    }
    // Reihenfolge: Ganzes Objekt, dann nach Gebäude und Etage (ein Gebäude ohne Etage vor seinen Etagen), ohne Lage zuletzt
    const rang = (k: string): [number, string, number] => {
      if (k === GANZES_OBJEKT) return [0, '', 0]
      if (k === OHNE_LAGE) return [2, '', 0]
      const [geb, etage] = k.split(' · ')
      return [1, geb, etage === undefined ? -1 : etagenRang(etage)]
    }
    return new Map([...m.entries()].sort(([a], [b]) => {
      const x = rang(a), y = rang(b)
      return x[0] - y[0] || x[1].localeCompare(y[1], 'de', { numeric: true }) || x[2] - y[2]
    }))
  }
  /** Bestand: Zahl der Elemente und ihrer Gruppen (im Gebäude), z. B. „12 Melder in 4 Wohnungen / Bereichen“ */
  const bestandText = (an: Anlage, gebaeude?: string) => {
    const def = artDefinition(typArten.get(an.anlagentyp_id)).elemente
    if (!def) return ''
    const eigeneLagen = lagen.filter((g) => g.anlage_id === an.id)
    const eigene = elemente.filter((e) => e.anlage_id === an.id && (gebaeude === undefined || gebaeudeVon(e.gruppe, eigeneLagen) === gebaeude))
    if (!eigene.length) return t('noch keine {mehrzahl} erfasst', { mehrzahl: def.mehrzahl })
    const gruppen = new Set(eigene.map((e) => e.gruppe).filter(Boolean)).size
    const menge = `${eigene.length} ${eigene.length === 1 ? def.einzahl : def.mehrzahl}`
    const text = gruppen ? t('{menge} in {n} {gruppen}', { menge, n: gruppen, gruppen: gruppen === 1 ? def.gruppe : def.gruppeMehrzahl }) : menge
    return `${gebaeude === '' ? t('ohne Gebäude: ') : ''}${text}`
  }
  const tuerGruppen = nachLage(sortiert.filter(zuTueranlage))
  const gruppen = nachLage(sortiert.filter((a) => !istTueranlage(a) && !zuTueranlage(a)))
  const wer = (id: string) => (id === ich ? t('Sie') : namen.get(id) ?? t('Kollege'))
  /** Zeile einer Anlage bzw. Tür in der Liste */
  const zeileFuer = ({ t: an, gebaeude, imKasten = false }: Eintrag) => {
    const s = staende.get(an.id)!
    const p = s.mitMir ?? s.laufend
    const mit = p ? mitpruefer.filter((m) => m.anlagenpruefung_id === p.id && m.status === 'zugelassen') : []
    // Tür einer Türanlage: Stand ihrer Teilprüfung (fertig bzw. nicht geprüft, solange die Türanlage läuft)
    const teilNicht = pruefungen.find((x) => x.anlage_id === an.id && x.teil_von_id && x.status === 'nicht_geprueft' && !x.abgeschlossen_am)
    let badge
    if (s.doppelt) badge = <Badge farbe="rot">{t('doppelt geprüft')}</Badge>
    else if (teilNicht) badge = <Badge farbe="gelb">{t('nicht geprüft: {grund}', { grund: teilNicht.nicht_geprueft_grund })}</Badge>
    else if (p) badge = <Badge farbe="blau">{t('in Prüfung · {wer}', { wer: wer(p.pruefer_id) })}</Badge>
    else if (s.heute?.teil_von_id && !s.heute.abgeschlossen_am && s.heute.ergebnis) badge = <Badge farbe={AMPEL[s.heute.ergebnis][0]}>✓ {t('fertig · {ergebnis}', { ergebnis: AMPEL[s.heute.ergebnis][1] })}</Badge>
    else if (s.heute?.ergebnis) {
      badge = <Badge farbe={AMPEL[s.heute.ergebnis][0]}>✓ {t('heute {ergebnis} · {wer}', { ergebnis: AMPEL[s.heute.ergebnis][1], wer: wer(s.heute.pruefer_id) })}</Badge>
      // Bestand: nach der Prüfung angelegte Melder bzw. Geräte brauchen eine weitere Prüfung (Antippen beginnt sie)
      const def = artDefinition(typArten.get(an.anlagentyp_id)).elemente
      if (s.neu.length && def) {
        badge = <span className="flex flex-wrap justify-end gap-1.5">{badge}
          <Badge farbe="gelb">{t('noch {n} {elemente} fällig', { n: s.neu.length, elemente: s.neu.length === 1 ? def.einzahl : def.mehrzahl })}</Badge></span>
      }
    } else if (!an.naechste_pruefung_am && !an.letzte_pruefung_am) badge = <Badge farbe="gelb">{t('noch nie geprüft')}</Badge>
    else if (an.naechste_pruefung_am && an.naechste_pruefung_am < heute) badge = <Badge farbe="rot">{t('überfällig seit {datum}', { datum: datum(an.naechste_pruefung_am) })}</Badge>
    else if (an.naechste_pruefung_am && an.naechste_pruefung_am <= grenze) badge = <Badge farbe="gelb">{t('fällig {datum}', { datum: datum(an.naechste_pruefung_am) })}</Badge>
    else badge = <Badge>{t('nächste {datum}', { datum: datum(an.naechste_pruefung_am) })}</Badge>
    if (maengel.has(an.id)) badge = <span className="flex flex-wrap justify-end gap-1.5">{badge}<MaengelBadge stand={maengel.get(an.id)} /></span>
    return (
      <li key={an.id}>
        <button onClick={() => waehlen(an, 'manuell', gebaeude, imKasten)} className={`zeile group items-start ${an.id === ziel && !imKasten ? 'bg-amber-50 ring-2 ring-inset ring-amber-300' : ''}`}
          data-anlage={imKasten ? undefined : an.etikett_id ?? an.id} data-nachpruefen-anlage={imKasten ? an.etikett_id ?? an.id : undefined}
          data-ziel={(an.id === ziel && !imKasten) || undefined}>
          <ArtSymbol art={typArten.get(an.anlagentyp_id)} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span>{!istBestandArt(typArten.get(an.anlagentyp_id)) && <><EtikettText id={an.etikett_id} />{' '}</>}<span>{an.kunden_bezeichnung}</span></span>
              {badge}
            </div>
            <div className="text-sm text-slate-600">{istBestandArt(typArten.get(an.anlagentyp_id)) ? bestandText(an, gebaeude)
              : [an.raum, an.lage_beschreibung].filter(Boolean).join(' · ')}</div>
            {mit.length > 0 && (
              <div className="text-xs text-sky-800">
                {t('gemeinsam mit {namen}', { namen: mit.map((m) => `${wer(m.benutzer_id)}${m.fertig_am ? ' ✓' : ` ${t('(arbeitet noch)')}`}`).join(', ') })}
              </div>
            )}
            <div className="text-xs text-slate-500">{zuTueranlage(an) ? `${tb('Tür')} · ${typen.get(an.anlagentyp_id)}` : typen.get(an.anlagentyp_id)}</div>
            {imKasten && (
              <ul className="mt-1 space-y-0.5 text-sm text-red-800">
                {nachpruefen.get(an.id)!.slice(0, 3).map((m) => <li key={m.id}>{t('Stufe {stufe}:', { stufe: m.stufe })} {m.beschreibung} <span className="text-xs text-slate-500">({datum(m.erstellt_am)}{m.status === 'behoben' ? `, ${t('als behoben gemeldet')}` : ''})</span></li>)}
                {nachpruefen.get(an.id)!.length > 3 && <li className="text-xs text-slate-500">{t('+ {n} weitere', { n: nachpruefen.get(an.id)!.length - 3 })}</li>}
              </ul>
            )}
          </div>
          <span className="self-center"><Weiter /></span>
        </button>
      </li>
    )
  }

  return (
    <Seite titel={objekt.name} zurueck={{ zu: '/pruefen', text: t('Prüfen') }}>
      <div className="karte space-y-2 p-4 text-sm">
        <div>{kunde?.name}{objekt.ort ? ` · ${objekt.ort}` : ''}</div>
        {objekt.zugangshinweise && <div className="text-slate-600">{t('Zugang:')} {objekt.zugangshinweise}</div>}
        <div className="flex flex-wrap gap-1.5" data-zaehler>
          <Badge farbe="blau">{t('{n} in Prüfung', { n: zaehler.laufend })}</Badge>
          <Badge farbe="gruen">{t('{n} heute geprüft', { n: zaehler.heute })}</Badge>
          <Badge farbe={zaehler.faellig ? 'gelb' : 'grau'}>{t('{n} fällig', { n: zaehler.faellig })}</Badge>
        </div>
        {laden && <p className="text-xs text-slate-500">{laden}</p>}
      </div>

      {!!freigaben?.length && (
        <div role="alert" className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {freigaben.map((f, i) => (
            <p key={i}>{f.tueranlage
              ? satz(t('{von} hat Ihre laufende Prüfung der {anlage} freigegeben. Ihre Eingaben zu ihren Türen wurden verworfen.'), { von: f.von, anlage: <strong>{f.anlage}</strong> })
              : satz(tb('{von} hat Ihre laufende Prüfung der Tür {anlage} freigegeben. Ihre Eingaben zu dieser Tür wurden verworfen.'), { von: f.von, anlage: <strong>{f.anlage}</strong> })}</p>
          ))}
          <button className="btn-sekundaer py-1" onClick={() => void metaSchreiben(`freigabe:objekt:${oid}`, [])}>{t('Verstanden')}</button>
        </div>
      )}
      {doppelt.length > 0 && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {tb('{n} Tür(en) wurden gleichzeitig doppelt geprüft (offline). In der Prüfung lässt sich klären, welche gilt.', { n: doppelt.length })}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <button className="btn-primaer py-4 text-base" onClick={() => setScannen(true)}>{tb('Tür scannen')}</button>
        <button className="btn-sekundaer py-4" onClick={() => setNeueAnlage({})}>{tb('Neue Tür erfassen')}</button>
      </div>
      {meldung && (
        <div ref={meldungRef} role="status" className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p>{meldung}</p>
          {istAdmin && belegt && online && (
            <button className="btn-sekundaer py-1 text-red-700" onClick={async () => {
              const folge = belegt.tueranlage ? t('Die Eingaben zu allen Türen der Türanlage werden verworfen, auch auf dem Gerät des Kollegen.')
                : tb('Die Eingaben zu dieser Tür werden verworfen, auch auf dem Gerät des Kollegen.')
              if (!await bestaetigen(t('Laufende Prüfung von {wer} freigeben? {folge}', { wer: belegt.wer, folge }), { ok: t('Freigeben'), gefahr: true })) return
              try {
                await pruefungFreigeben(belegt.id)
                setBelegt(null)
                setMeldung(belegt.tueranlage ? t('Freigegeben – die Türen können jetzt neu geprüft werden.') : tb('Freigegeben – die Tür kann jetzt neu geprüft werden.'))
              } catch (e) { setMeldung(fehlertext(e)) }
            }}>{t('Freigeben …')}</button>
          )}
        </div>
      )}

      {ziel && (() => {
        const a = anlagen.find((x) => x.id === ziel)
        if (!a) return null
        const name = [a.etikett_id, a.kunden_bezeichnung].filter(Boolean).join(' · ')
        return (
          <div role="status" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-nachpruefen-hinweis>
            {nachpruefen.has(a.id)
              ? satz(zuTueranlage(a)
                ? t('Mangel an {name} nachprüfen: unter „Nachprüfen“ antippen – die Prüfung beginnt (in der {tueranlage}). Darin je Mangel „behoben ✓“ oder „besteht weiter“ wählen.', { tueranlage: tueranlageName(objekt.name) })
                : t('Mangel an {name} nachprüfen: unter „Nachprüfen“ antippen – die Prüfung beginnt. Darin je Mangel „behoben ✓“ oder „besteht weiter“ wählen.'), { name: <strong>{name}</strong> })
              : satz(t('Der Mangel an {name} stammt aus einer Prüfung, die noch läuft – nachprüfen lässt er sich erst nach deren Abschluss.'), { name: <strong>{name}</strong> })}
          </div>
        )
      })()}

      {nachpruefen.size > 0 && (
        <section className="karte border-red-200" aria-label={t('Nachprüfen')} data-nachpruefen>
          <div className="border-b border-red-100 bg-red-50/70 px-4 py-2">
            <h2 className="font-semibold text-red-900">{t('Nachprüfen ({n})', { n: nachpruefen.size })}</h2>
            <p className="text-sm text-slate-600">{t('Offene Mängel aus früheren Prüfungen. Antippen beginnt die Prüfung; darin je Mangel „behoben ✓“ oder „besteht weiter“.')}</p>
          </div>
          <ul className="divide-y divide-slate-100">
            {sortiert0.filter((t) => nachpruefen.has(t.id)).map((t) => zeileFuer({ t, imKasten: true }))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input type="search" placeholder={tb('Türen filtern …')} value={filter} onChange={(e) => setFilter(e.target.value)} className="mt-0 max-w-xs" aria-label={tb('Türen filtern')} />
        <label className="flex items-center gap-2 font-normal">
          <input type="checkbox" checked={nurFaellige} onChange={(e) => setNurFaellige(e.target.checked)} /> {t('nur fällige')}
        </label>
      </div>

      {tueranlage && alleTueren.length > 0 && (tuerGruppen.size > 0 || !filter) && (() => {
        const s = staende.get(tueranlage.id)!
        const h = s.mitMir ?? s.laufend
        // Pflicht beim Abschluss: die beim Beginn fälligen Türen (vor dem Beginn: die jetzt fälligen)
        const pflicht = alleTueren.filter((a) => tuerPflicht(a.naechste_pruefung_am, h?.begonnen_am ?? new Date(jetzt).toISOString()))
        const erledigt = (a: Anlage) => !!h && pruefungen.some((x) => x.teil_von_id === h.id && x.anlage_id === a.id && (x.status === 'geprueft' || x.status === 'nicht_geprueft'))
        const naechste = alleTueren.map((a) => a.naechste_pruefung_am).filter((x): x is string => !!x).sort()[0]
        let badge
        if (s.doppelt) badge = <Badge farbe="rot">{t('doppelt geprüft')}</Badge>
        else if (h) badge = <Badge farbe="blau">{t('in Prüfung · {wer} · {fertig} von {n} fälligen fertig', { wer: wer(h.pruefer_id), fertig: pflicht.filter(erledigt).length, n: pflicht.length })}</Badge>
        else if (s.heute?.ergebnis) badge = <Badge farbe={AMPEL[s.heute.ergebnis][0]}>✓ {t('heute {ergebnis} · {wer}', { ergebnis: AMPEL[s.heute.ergebnis][1], wer: wer(s.heute.pruefer_id) })}</Badge>
        else if (alleTueren.some((a) => !a.naechste_pruefung_am && !a.letzte_pruefung_am)) badge = <Badge farbe="gelb">{t('noch nie geprüft')}</Badge>
        else if (naechste && naechste < heute) badge = <Badge farbe="rot">{t('überfällig seit {datum}', { datum: datum(naechste) })}</Badge>
        else if (naechste && naechste <= grenze) badge = <Badge farbe="gelb">{t('fällig {datum}', { datum: datum(naechste) })}</Badge>
        else badge = <Badge>{t('nächste {datum}', { datum: datum(naechste) })}</Badge>
        const tuerMaengel = maengelSumme(alleTueren.map((a) => maengel.get(a.id)))
        if (tuerMaengel) badge = <span className="flex flex-wrap justify-end gap-1.5">{badge}<MaengelBadge stand={tuerMaengel} /></span>
        return (
          <section className="karte border-teal-200" data-tueranlage={objekt.name}>
            <button onClick={() => waehlen(tueranlage, 'manuell')} className="zeile group items-start border-b border-teal-100 bg-teal-50/60">
              <ArtSymbol art="tueranlage" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{tueranlageName(objekt.name)}</span>
                  {badge}
                </div>
                <div className="text-sm text-slate-600">
                  {alleTueren.length === 1
                    ? t('1 Tür, davon {faellig} fällig · gemeinsam geprüft und mit einer Unterschrift abgeschlossen', { faellig: pflicht.length })
                    : t('{n} Türen, davon {faellig} fällig · gemeinsam geprüft und mit einer Unterschrift abgeschlossen', { n: alleTueren.length, faellig: pflicht.length })}
                </div>
              </div>
              <span className="self-center"><Weiter /></span>
            </button>
            {[...tuerGruppen.entries()].map(([gruppe, liste]) => (
              <div key={gruppe}>
                <h3 className="border-b border-slate-100 px-4 py-1.5 text-xs font-semibold text-slate-500">{gruppe}</h3>
                <ul className="divide-y divide-slate-100 pl-4">
                  {liste.map(zeileFuer)}
                </ul>
              </div>
            ))}
          </section>
        )
      })()}
      {[...gruppen.entries()].map(([gruppe, liste]) => (
        <section key={gruppe} className="karte">
          <h2 className="border-b border-slate-100 px-4 py-2 text-sm font-semibold text-slate-600">{gruppe}</h2>
          <ul className="divide-y divide-slate-100">
            {liste.map(zeileFuer)}
          </ul>
        </section>
      ))}
      {sichtbar.length === 0 && <p className="text-sm text-slate-500">{nurFaellige ? tb('Keine fälligen Türen.') : tb('Keine Türen.')}</p>}

      <MitpruefAnfragen />
      <MitpruefenAnfrage objektId={oid} angebot={mitpruefWahl?.angebot ?? null} anlageText={mitpruefWahl?.text ?? ''}
        onSchliessen={() => setMitpruefWahl(null)}
        onZugelassen={(pid) => { setMitpruefWahl(null); navigate(`/pruefen/p/${pid}`) }} />

      <Dialog offen={scannen} titel={tb('Tür scannen')} onSchliessen={() => setScannen(false)}>
        {scannen && <Suspense fallback={<p className="text-sm">{t('Kamera wird vorbereitet …')}</p>}><QrScanner onErkannt={erkannt} eingabe /></Suspense>}
      </Dialog>

      <Dialog offen={freiesEtikett !== null} titel={t('Freies Etikett {etikett}', { etikett: freiesEtikett ?? '' })} onSchliessen={() => setFreiesEtikett(null)} breit>
        {freiesEtikett && (
          <FreiesEtikett etikett={freiesEtikett} ohneEtikett={anlagen.filter((t) => !t.etikett_id && !istTueranlage(t) && !istBestandArt(typArten.get(t.anlagentyp_id)))} typen={typen}
            onNeu={() => { setFreiesEtikett(null); setNeueAnlage({ etikett: freiesEtikett }) }}
            onZugewiesen={(t) => { setFreiesEtikett(null); void oeffnen(t, 'scan') }} />
        )}
      </Dialog>

      <Dialog offen={neueAnlage !== null} titel={tb('Neue Tür erfassen')} onSchliessen={() => setNeueAnlage(null)} breit>
        {neueAnlage && (
          <AnlageAnlegenFormular objektId={objekt.id} etikett={neueAnlage.etikett} anlagen={anlagen} onAbbrechen={() => setNeueAnlage(null)}
            onAngelegt={(t) => { setNeueAnlage(null); void oeffnen(t, neueAnlage.etikett ? 'scan' : 'manuell') }} />
        )}
      </Dialog>

      <Dialog offen={pruefartWahl !== null} titel={t('Welche Prüfung?')} onSchliessen={() => setPruefartWahl(null)}>
        {pruefartWahl && (
          <div className="space-y-2">
            <p className="text-sm text-slate-600">{[pruefartWahl.anlage.etikett_id, pruefartWahl.anlage.kunden_bezeichnung].filter(Boolean).join(' · ')}</p>
            {pruefartWahl.auswahl.map((p) => (
              <button key={p.id} className="group flex w-full items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 text-left transition-colors hover:border-marke hover:bg-akzent-hell/60"
                onClick={() => { const w = pruefartWahl; setPruefartWahl(null); void oeffnen(w.anlage, w.erfassung, p.id) }}>
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-akzent-hell text-marke" aria-hidden><PruefartSymbol name={p.name} className="size-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{p.name}</span>
                  <span className="block text-xs text-slate-500">{p.intervall_monate === 1 ? t('alle 1 Monate') : t('alle {n} Monate', { n: p.intervall_monate })}</span>
                </span>
                <Weiter />
              </button>
            ))}
          </div>
        )}
      </Dialog>
    </Seite>
  )
}

/**
 * Stand einer Anlage: laufende Prüfung (eigene zuerst), eine, bei der ich mitprüfe, heute abgeschlossene, ungeklärte
 * Doppelprüfung und die Elemente eines Bestands, die nach der heutigen Prüfung angelegt wurden.
 */
function stand(anlage: Anlage, pruefungen: Pruefung[], mitpruefer: Mitpruefer[], elemente: Element[], mitErgebnis: Map<string, Set<string>>, ich: string) {
  const ps = pruefungen.filter((p) => p.anlage_id === anlage.id)
  const laufende = ps.filter(laeuft).sort((a, b) => Number(b.pruefer_id === ich) - Number(a.pruefer_id === ich))
  const mitMir = laufende.find((p) => mitpruefer.some((m) => m.anlagenpruefung_id === p.id && m.benutzer_id === ich && m.status === 'zugelassen'))
  const ab = heuteBeginn()
  const heute = ps.filter((p) => p.status === 'geprueft' && (p.abgeschlossen_am ?? p.beendet_am ?? '') >= ab)
    .sort((a, b) => (b.beendet_am ?? '').localeCompare(a.beendet_am ?? ''))[0]
  const doppelt = ps.some((p) => (p.server_status ?? p.status) === 'duplikat' && !p.duplikat_geklaert)
  const neu = heute && !laufende.length ? nachPruefungAngelegt(elemente.filter((e) => e.anlage_id === anlage.id), heute, mitErgebnis.get(heute.id)) : []
  return { laufend: laufende[0], mitMir, heute, doppelt, neu }
}

function AnlageAnlegenFormular({ objektId, etikett, anlagen, onAngelegt, onAbbrechen }: {
  objektId: string
  etikett?: string
  anlagen: Anlage[]
  onAngelegt: (t: Anlage) => void
  onAbbrechen: () => void
}) {
  const typen = useLiveQuery(() => db.anlagentypen.filter((t) => t.aktiv && !artDefinition(t.anlagenart).intern).sortBy('name'), [], [])
  const artVon = (typId: unknown) => typen.find((t) => t.id === typId)?.anlagenart
  // Auswahl in Gebäude, Etage, Hersteller, Modell und Antrieb: Werte der Anlagen im Objekt
  const vorhandene = anlagen.map((t) => ({ ...t, art: artVon(t.anlagentyp_id) }))
  return (
    <Formular simulation
      felder={(w) => istBestandArt(artVon(w.anlagentyp_id)) ? [
        // Bestand (Rauchwarnmelder, Geräte): je Objekt einer, ohne Stammdaten
        { name: 'anlagentyp_id', label: tb('Türtyp'), typ: 'select', pflicht: true, breit: true, optionen: typOptionen(typen),
          hinweis: t('Je Objekt gibt es eine Anlage „{name}“; erfasst werden die {elemente} in der Prüfung.', { name: artDefinition(artVon(w.anlagentyp_id)).name, elemente: artDefinition(artVon(w.anlagentyp_id)).elemente?.mehrzahl ?? t('Elemente') }) },
      ] : [
        { name: 'anlagentyp_id', label: tb('Türtyp'), typ: 'select', pflicht: true, breit: true, optionen: typOptionen(typen) },
        { name: 'etikett_id', label: t('Etikett-ID'), hinweis: etikett ? t('gescannt') : t('Leer lassen, wenn noch kein Etikett klebt') },
        { name: 'kunden_bezeichnung', label: t('Bezeichnung beim Kunden') },
        ...lageFelder(vorhandene),
        { name: 'raum', label: t('Raum') },
        { name: 'lage_beschreibung', label: t('Lagebeschreibung'), breit: true },
        ...artFelder(artVon(w.anlagentyp_id), false, vorhandene, w).slice(0, 2),
        { name: 'baujahr', label: t('Baujahr'), typ: 'number' },
        ...artFelder(artVon(w.anlagentyp_id), true, vorhandene),
      ]}
      start={{ etikett_id: etikett ?? '' }}
      speichernText={t('Anlegen und prüfen')}
      onAbbrechen={onAbbrechen}
      onSpeichern={async (w) => {
        if (istBestandArt(artVon(w.anlagentyp_id))) return void onAngelegt(await anlageAnlegen(objektId, { anlagentyp_id: String(w.anlagentyp_id) }))
        const etikettId = w.etikett_id ? normalisiereEtikett(String(w.etikett_id)) : null
        const grund = etikettId ? await etikettPruefen(etikettId) : null
        if (grund) return grund
        const { eigenschaften, rest } = eigenschaftenTrennen(artVon(w.anlagentyp_id), w)
        const neu = await anlageAnlegen(objektId, { ...(rest as { anlagentyp_id: string }), eigenschaften, etikett_id: etikettId })
        onAngelegt(neu)
      }}
    />
  )
}
