import { useLiveQuery } from 'dexie-react-hooks'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { demoKnopf } from '../../lib/demo'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { useAuth } from '../../auth'
import { bestaetigen } from '../../components/Bestaetigung'
import { Fotos } from '../../components/Fotos'
import { artFelder, eigenschaftenTrennen, eigenschaftenWerte, type AnlageWerte } from '../../components/anlageFelder'
import { Formular } from '../../components/Formular'
import { altmaengelJeElement, elementeOffen, elementeVorschlag, elementName, mitNachpruefung } from '../../lib/elemente'
import { ElementePruefung } from './ElementePruefung'
import { EtikettZuweisen } from './Etikett'
import { artDefinition, feldText, type Eigenschaften } from '../../lib/anlagenarten'
import { ArtSymbol, PruefartChip } from '../../components/Symbole'
import { Badge, datum, Dialog, Fehler, Laden, Seite } from '../../components/ui'
import { istSichtbar, mangelText, nachAbschnitt, STUFEN, wirksam, type Punkt, type Stufe } from '../../lib/checkliste'
import {
  ampelAus, bedingungsWerte, erlaubteErgebnisse, mangelVorschlag, offeneGruende, pruefstand,
  type Ampel, type AntwortWert,
} from '../../lib/pruefung'
import {
  altmangelEntscheiden, antwortLoeschen, antwortSetzen, mangelAendern, mangelAnlegen, mangelLoeschen,
  mitpruefenBeenden, mitpruefungFertigZuruecknehmen, pruefungAbbrechen, pruefungLaden, pruefungOeffnen, anlageAendern,
  teileVon, tuerFertig, tuerNichtGeprueft, tuerWiederOeffnen,
} from '../../offline/aktionen'
import { gemeinsamAbgleichen, objektAbgleichen, objektBeobachten, pruefungBeobachten } from '../../offline/abgleich'
import { db, metaLesen, metaSchreiben, type Mangel, type Pruefung } from '../../offline/db'
import { useSyncStatus } from '../../offline/sync'
import { MitpruefAnfragen } from './Mitpruefen'
import { satz } from './satz'
import { fehlertext } from '../../lib/supabase'
import { tueranlageName, tuerPflicht } from '../../lib/tueranlage'
import { istBestandArt, nachPruefungAngelegt } from '../../lib/bestand'
import { entschluesseln } from '../../lib/verschluesselung'
import { tb } from '../../lib/begriffe'
import { t, tMeldung } from '../../lib/sprache'
import { ProtokollKnopf } from '../../components/Pruefprotokolle'
import { RevisionStand } from './Revision'
import { AMPEL_FARBE, AMPEL_TEXT } from './ampel'
import { AbschlussUnterschrift, Doppelpruefung, FertigMelden, GrundDialog, OffeneGruende, ProtokollKontrollieren, WiederOeffnen } from './Abschluss'
import { TueranlagePruefung } from './TueranlagePruefung'
import { Auswahl } from '../../components/Auswahl'
import { usePruefAnsicht } from '../../lib/ansicht'
import { ProtokollBlatt, PruefAnsichtWahl } from './ProtokollBlatt'

const heute = () => new Date().toISOString().slice(0, 10)

export default function AnlagenPruefung() {
  const { pid = '' } = useParams()
  // Aus der Prüfliste eines Gebäudes geöffnet (Bestand): Elemente zuerst dieses Gebäudes zeigen
  const [suche] = useSearchParams()
  const navigate = useNavigate()
  const { benutzer, istAdmin } = useAuth()
  const { online } = useSyncStatus()
  const [fehler, setFehler] = useState('')
  const [ergebnisWahl, setErgebnisWahl] = useState<Ampel | null>(null)
  const [begruendung, setBegruendung] = useState('')
  const [anlagendaten, setAnlagendaten] = useState(false)
  const [etikettOffen, setEtikettOffen] = useState(false)
  const [fertigOffen, setFertigOffen] = useState(false)
  const [oeffnenOffen, setOeffnenOffen] = useState(false)
  const [nichtOffen, setNichtOffen] = useState(false)
  // Prüfpunkte als Liste oder als Protokollblatt (je Gerät)
  const [ansicht, setAnsicht] = usePruefAnsicht()

  const d = useLiveQuery(async () => {
    const pruefung = await db.pruefungen.get(pid)
    if (!pruefung) return { pruefung: undefined }
    const [anlage, version, antworten, maengel] = await Promise.all([
      db.anlagen.get(pruefung.anlage_id),
      pruefung.checkliste_version_id ? db.versionen.get(pruefung.checkliste_version_id) : undefined,
      db.antworten.where('anlagenpruefung_id').equals(pid).toArray(),
      db.maengel.where('anlage_id').equals(pruefung.anlage_id).toArray(),
    ])
    const typ = anlage ? await db.anlagentypen.get(anlage.anlagentyp_id) : undefined
    // Tür einer Türanlage: Mitprüfer, Mehrpersonenprüfung und Abschluss gehören zur Prüfung der Türanlage (Hauptprüfung)
    const haupt = pruefung.teil_von_id ? await db.pruefungen.get(pruefung.teil_von_id) : undefined
    const tueranlage = haupt ? await db.anlagen.get(haupt.anlage_id) : undefined
    const typTa = tueranlage ? await db.anlagentypen.get(tueranlage.anlagentyp_id) : undefined
    const objektTa = tueranlage ? await db.objekte.get(tueranlage.objekt_id) : undefined
    // Fortschritt: erledigte unter den beim Beginn fälligen Türen (die Pflicht beim Abschluss)
    const faellige = haupt && tueranlage ? await db.anlagen.where('teil_von_id').equals(tueranlage.id)
      .filter((a) => a.status === 'aktiv' && tuerPflicht(a.naechste_pruefung_am, haupt.begonnen_am)).toArray() : []
    const erledigt = haupt ? (await teileVon(haupt.id)).filter((t) => t.status === 'geprueft' || t.status === 'nicht_geprueft') : []
    const teilStand = haupt && tueranlage ? {
      tueren: faellige.length,
      fertig: faellige.filter((a) => erledigt.some((t) => t.anlage_id === a.id)).length,
    } : undefined
    const mitpruefer = await db.mitpruefer.where('anlagenpruefung_id').equals(haupt?.id ?? pid).toArray()
    // Doppelprüfung: alle Prüfungen derselben Anlage, die zu dieser Gruppe gehören
    const erste = pruefung.duplikat_von ?? pruefung.id
    const gruppe = (await db.pruefungen.where('anlage_id').equals(pruefung.anlage_id).toArray())
      .filter((p) => !p.session_id && (p.id === erste || p.duplikat_von === erste))
    const namen = new Map((await db.benutzer.bulkGet([pruefung.pruefer_id, pruefung.urspruenglicher_pruefer_id ?? pruefung.pruefer_id,
      ...mitpruefer.map((m) => m.benutzer_id), ...gruppe.map((p) => p.pruefer_id)]))
      .filter((b) => !!b).map((b) => [b!.id, b!.name]))
    const fotos = await db.fotos.toArray()
    const fotosJe = new Map<string, number>()
    for (const f of fotos) fotosJe.set(f.bezug_id, (fotosJe.get(f.bezug_id) ?? 0) + 1)
    const pruefart = await db.pruefarten.get(pruefung.pruefart_id)
    const [elemente, elementErgebnisse, gruppen] = await Promise.all([
      db.elemente.where('anlage_id').equals(pruefung.anlage_id).toArray(),
      db.elementErgebnisse.where('anlagenpruefung_id').equals(pid).toArray(),
      db.gruppen.where('anlage_id').equals(pruefung.anlage_id).toArray(),
    ])
    const abgelehnt = await metaLesen<string>(`abschluss:${pid}`)
    // Auswahl in Hersteller, Modell und Antrieb (Türdaten ergänzen): Werte der Anlagen im Objekt
    const typArten = new Map((await db.anlagentypen.toArray()).map((t) => [t.id, t.anlagenart]))
    const vorhandene: AnlageWerte[] = anlage ? (await db.anlagen.where('objekt_id').equals(anlage.objekt_id).toArray())
      .map((a) => ({ ...a, art: typArten.get(a.anlagentyp_id) })) : []
    // Der Gerätespeicher hält Prüfung (Name des Unterzeichners) und Anlage (Ansprechpartner) verschlüsselt: nach allen Abfragen
    // an Dexie entschlüsseln
    const [pruefungKlar, anlageKlar, objektTaKlar] = await Promise.all([
      entschluesseln('anlagenpruefung', pruefung), entschluesseln('anlage', anlage), entschluesseln('objekt', objektTa)])
    return { pruefung: pruefungKlar, anlage: anlageKlar, tueranlageText: tueranlage ? tueranlageName(objektTaKlar?.name) : undefined, version, antworten, maengel, mitpruefer, gruppe, abgelehnt, typMehr: !!(typTa ?? typ)?.mehrpersonenpruefung, typName: typ?.name, typArt: typ?.anlagenart, vorhandene, pruefart, fotosJe, namen, elemente, elementErgebnisse, gruppen, haupt, teilStand }
  }, [pid])

  // Nicht auf dem Gerät oder Prüfung eines Kollegen: vollständigen Stand vom Server holen (nur ansehen)
  // (als Mitprüfer nicht: dort gleicht gemeinsamAbgleichen ab, ohne noch nicht übertragene eigene Einträge zu überschreiben)
  const fehlt = d !== undefined && (!d.pruefung || (!!d.pruefung.fremd
    && !(d.mitpruefer ?? []).some((m) => m.benutzer_id === benutzer!.id && m.status === 'zugelassen')))
  useEffect(() => {
    if (!online || !fehlt) return
    void pruefungLaden(pid).catch(() => undefined)
  }, [online, fehlt, pid])

  // Mehrpersonenprüfung: Anfragen und Fertigmeldungen live empfangen; bei gemeinsamer Prüfung auch die Eingaben der anderen
  const objektId = d?.anlage?.objekt_id
  const typMehr = !!d?.typMehr
  const gemeinsam = (d?.mitpruefer ?? []).some((m) => m.status === 'zugelassen')
  // (auch ohne Mehrpersonenprüfung, wenn es Mitprüfer gibt: nach dem Wiederöffnen mit anderem Prüfer ist der bisherige Mitprüfer)
  // (Türanlage: das übernimmt ihre eigene Seite)
  const istTueranlage = !!artDefinition(d?.typArt).tueren
  useEffect(() => {
    if (!online || !objektId || istTueranlage || !(typMehr || gemeinsam || d?.pruefung?.duplikat_von || d?.pruefung?.server_status === 'duplikat')) return
    void objektAbgleichen(objektId).catch(() => undefined)
    const t = setInterval(() => void objektAbgleichen(objektId).catch(() => undefined), 15_000)
    const ende = objektBeobachten(objektId)
    return () => { clearInterval(t); ende() }
  }, [online, typMehr, gemeinsam, objektId, istTueranlage, d?.pruefung?.duplikat_von, d?.pruefung?.server_status])
  useEffect(() => {
    if (!online || !gemeinsam) return
    void gemeinsamAbgleichen(pid).catch(() => undefined)
    const t = setInterval(() => void gemeinsamAbgleichen(pid).catch(() => undefined), 15_000)
    const ende = pruefungBeobachten(pid)
    return () => { clearInterval(t); ende() }
  }, [online, gemeinsam, pid])

  const punkte = useMemo(() => ((d?.version?.punkte ?? []) as unknown as Punkt[]), [d?.version])
  const antwortJe = useMemo(() => Object.fromEntries((d?.antworten ?? []).map((a) => [a.punkt_id, a])), [d?.antworten])

  if (!d) return <Laden />
  // Türanlage: eigene Seite mit Türliste und Abschluss (die Türen sind Teilprüfungen)
  if (artDefinition(d.typArt).tueren) return <TueranlagePruefung pid={pid} />
  const { pruefung, anlage, version, maengel = [], fotosJe, haupt, tueranlageText, teilStand } = d
  // Tür einer Türanlage: zurück zur Türanlage, deren Prüfung Mitprüfer und Abschluss trägt
  const teil = !!pruefung?.teil_von_id
  const objektListe = anlage ? `/pruefen/o/${anlage.objekt_id}` : '/pruefen'
  const liste = teil && haupt ? `/pruefen/p/${haupt.id}` : objektListe
  if (!pruefung || !anlage) return <Seite titel={t('Prüfung')} zurueck={{ zu: liste, text: t('Zur Übersicht') }}><Fehler text={t('Prüfung nicht gefunden.')} /></Seite>
  if (!version) return <Seite titel={t('Prüfung')} zurueck={{ zu: liste, text: t('Zur Übersicht') }}><Fehler text={t('Die Checkliste dieser Prüfung ist auf diesem Gerät nicht vorhanden. Bitte online die Prüfung neu öffnen.')} /></Seite>

  const ich = benutzer!.id
  const istHaupt = (haupt ?? pruefung).pruefer_id === ich && !(haupt ?? pruefung).fremd
  const zugelassene = (d.mitpruefer ?? []).filter((m) => m.status === 'zugelassen')
  const ichMit = zugelassene.find((m) => m.benutzer_id === ich)
  const istMit = !!ichMit
  const laeuftNoch = pruefung.status === 'in_pruefung' && !(teil && haupt?.abgeschlossen_am)
  const tuerAbschliessbar = teil && !haupt?.abgeschlossen_am && (istHaupt || (istMit && !ichMit.fertig_am))
  const nurLesen = !laeuftNoch || !(istHaupt || (istMit && !ichMit.fertig_am))
  const werte = bedingungsWerte(antwortJe)
  const neueMaengel = maengel.filter((m) => m.entdeckt_in === pid)
  const altMaengel = maengel.filter((m) => m.entdeckt_in !== pid && (m.status === 'offen' || m.status === 'behoben' || m.nachgeprueft_in === pid))
  const altEntscheidungen = pruefung.altmaengel ?? {}
  // In dieser Prüfung festgestellt und noch offen: nach dem Abschluss nachzuprüfen
  const offeneHier = neueMaengel.filter((m) => m.status === 'offen' || m.status === 'behoben')
  const geltend = [...neueMaengel, ...altMaengel.filter((m) => altEntscheidungen[m.id] === 'besteht')]
  const auto = ampelAus(geltend)
  const ergebnis = ergebnisWahl && erlaubteErgebnisse(auto).includes(ergebnisWahl) ? ergebnisWahl : auto
  const stand = pruefstand({
    punkte, antworten: antwortJe,
    fotosJePunkt: Object.fromEntries(punkte.map((p) => [p.id, antwortJe[p.id] ? fotosJe.get(antwortJe[p.id].id) ?? 0 : 0])),
    maengel: neueMaengel.map((m) => ({ ...m, fotos: fotosJe.get(m.id) ?? 0 })),
    altmaengel: altMaengel.map((m) => m.id), altEntscheidungen,
  })
  // Elemente (Leuchten …): bei „alle“ muss jedes ein Ergebnis haben, bei „anteil“ ist der Vorschlag ein Hinweis
  const elementDef = artDefinition(d.typArt).elemente
  const elementePruefen = !!elementDef && !!d.pruefart && d.pruefart.elemente !== 'keine'
  // Bestand (Rauchwarnmelder, Geräte): Pflicht sind die beim Beginn fälligen Elemente. Nur solange die Prüfung läuft – danach
  // ist der Stand der Elemente fortgeschrieben und die abgeschlossene Prüfung zeigt alle Elemente
  const bestand = istBestandArt(d.typArt) && pruefung.status === 'in_pruefung'
  // Elemente mit offenem Mangel aus einer früheren Prüfung sind immer nachzuprüfen, auch wenn sie sonst nicht dran wären
  const vorschlag = elementePruefen ? mitNachpruefung(elementeVorschlag(d.elemente ?? [], d.pruefart!, heute(),
    bestand ? { pruefartId: d.pruefart!.id, monate: d.pruefart!.intervall_monate, begonnenAm: pruefung.begonnen_am } : undefined),
  d.elemente ?? [], altmaengelJeElement(maengel, pid)) : null
  const elementeFehlen = vorschlag ? elementeOffen(vorschlag, d.elementErgebnisse ?? []) : 0
  const elementePflicht = elementePruefen && d.pruefart!.elemente === 'alle'
  // Bestand: nach dieser Prüfung angelegte Elemente sind noch nicht geprüft („Erneut prüfen“ prüft sie)
  const nachher = elementDef && istBestandArt(d.typArt) && pruefung.status === 'geprueft'
    ? nachPruefungAngelegt(d.elemente ?? [], pruefung, new Set((d.elementErgebnisse ?? []).map((r) => r.element_id))).length : 0
  const nochNichtFertig = zugelassene.filter((m) => !m.fertig_am)
  // Gründe unter dem Knopf „Tür fertig“ bzw. „abschließen“
  const gruendeTuer = [...(elementePflicht && elementeFehlen > 0 ? [t('{n} {mehrzahl} ohne Ergebnis', { n: elementeFehlen, mehrzahl: elementDef!.mehrzahl })] : []), ...offeneGruende(stand)]
  const gruendeAbschluss = [...gruendeTuer,
    ...nochNichtFertig.map((m) => t('{name} hat noch nicht fertig gemeldet', { name: d.namen?.get(m.benutzer_id) ?? t('Ein Mitprüfer') }))]
  const duplikat = (pruefung.server_status ?? pruefung.status) === 'duplikat'
  const name = (id: string) => (id === ich ? t('Sie') : d.namen?.get(id) ?? t('ein Kollege'))
  const prueferName = d.namen?.get(pruefung.pruefer_id) ?? t('ein Kollege')
  const abgeschlossenHeute = !!pruefung.abgeschlossen_am && pruefung.abgeschlossen_am.slice(0, 10) === heute()
    || (!pruefung.abgeschlossen_am && !!pruefung.beendet_am)
  const darfWiederOeffnen = pruefung.status === 'geprueft' && !!pruefung.abgeschlossen_am && ((istHaupt && abgeschlossenHeute) || istAdmin)

  /**
   * Mangel zum Punkt anlegen (Beschreibung aus der Antwort), bei angehobener Mindest-Stufe (Wirkung) nachziehen oder
   * entfernen, wenn er nicht mehr zutrifft. Eine noch nicht von Hand geänderte Beschreibung folgt der neuen Antwort
   * (z. B. anderer Messwert); `bisher` ist die Antwort vor der Änderung.
   */
  const mangelAbgleichen = async (punkt: Punkt, wert: AntwortWert | undefined, bisher: AntwortWert | undefined) => {
    const vorschlag = mangelVorschlag(punkt, wert)
    const vorhanden = neueMaengel.filter((m) => m.punkt_id === punkt.id)
    if (vorschlag !== null && vorhanden.length === 0) await mangelAnlegen(pruefung, punkt, vorschlag, undefined, undefined, wert)
    if (vorschlag !== null) {
      for (const m of vorhanden) if (m.stufe < (punkt.mindest_stufe ?? 0)) await mangelAendern(m.id, { stufe: punkt.mindest_stufe })
      const neu = mangelText(punkt, wert)
      for (const m of vorhanden) {
        const automatisch = m.beschreibung === punkt.text || m.beschreibung === mangelText(punkt, bisher)
        if (automatisch && m.beschreibung !== neu) await mangelAendern(m.id, { beschreibung: neu })
      }
    }
    if (vorschlag === null && vorhanden.length > 0) {
      const mitFotos = vorhanden.some((m) => (fotosJe.get(m.id) ?? 0) > 0)
      if (!mitFotos || await bestaetigen(t('Der Mangel zu diesem Punkt hat Fotos. Mangel samt Fotos entfernen?'), { ok: t('Entfernen'), gefahr: true })) {
        for (const m of vorhanden) await mangelLoeschen(m.id)
      }
    }
  }

  /** Antwort setzen, Mangel automatisch anlegen/entfernen, ausgeblendete Folgepunkte bereinigen. */
  const setze = async (punkt: Punkt, wert: AntwortWert) => {
    setFehler('')
    try {
      await antwortSetzen(pid, punkt.id, wert)
      await mangelAbgleichen(punkt, wert, antwortJe[punkt.id])
      const neueWerte = { ...werte, [punkt.id]: wert }
      // Punkte, die durch diese Antwort ausgeblendet werden, verlieren ihre Antworten und Mängel
      if (punkte.some((p) => p.nur_wenn)) {
        for (const p of punkte) {
          if (!istSichtbar(p, neueWerte, punkte) && antwortJe[p.id]) {
            await antwortLoeschen(pid, p.id)
            for (const m of neueMaengel.filter((x) => x.punkt_id === p.id)) await mangelLoeschen(m.id)
          }
        }
      }
      // Wirkungen anderer Punkte können sich durch diese Antwort ändern (Grenzwert, Mindest-Mangelstufe): Mängel angleichen
      for (const p of punkte) {
        if (p.id === punkt.id || !p.wirkungen?.length || !antwortJe[p.id] || !istSichtbar(p, neueWerte, punkte)) continue
        const eff = wirksam(p, neueWerte, punkte)
        await mangelAbgleichen(eff, antwortJe[p.id], antwortJe[p.id])
      }
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    }
  }

  const neuPruefen = async () => {
    setFehler('')
    try {
      const r = await pruefungOeffnen(anlage, 'manuell', pruefung.pruefart_id)
      if (r.ok) navigate(`/pruefen/p/${r.pruefungId}`)
      else if ('grund' in r) setFehler(r.grund)
      else navigate(liste)
    } catch (e) {
      setFehler(fehlertext(e))
    }
  }

  const protokoll = ansicht === 'protokoll'
  // Auf dem Protokollblatt ohne eigene Karte: Ergebnis, Unterschrift und Abschluss stehen am Ende des Blatts
  const teilKlasse = protokoll ? 'space-y-3' : 'karte space-y-3 p-4'
  const elementeTeil = elementePruefen && elementDef && vorschlag && (
    <ElementePruefung pruefung={pruefung} def={elementDef} elemente={d.elemente ?? []} gruppen={d.gruppen ?? []} gebaeude={suche.get('gebaeude') ?? undefined} ergebnisse={d.elementErgebnisse ?? []}
      maengel={maengel} vorschlag={vorschlag} teilpruefung={d.pruefart!.elemente === 'anteil'} bestand={bestand}
      zyklus={d.pruefart!.elemente_zyklus_monate} nurLesen={nurLesen} />
  )
  // Ergebnis, Unterschrift und Abschluss der Anlage bzw. Ergebnis der Tür
  const ende = (
    <>
      {!teil && laeuftNoch && istMit && !nurLesen && (
        <p className="text-sm text-slate-600">{t('Ergebnis und Abschluss dieser Anlage erfasst {pruefer}. Wenn Sie fertig sind, melden Sie Ihren Teil oben mit Unterschrift fertig.', { pruefer: prueferName })}</p>
      )}
      {teil && laeuftNoch && tuerAbschliessbar && (
        <section className={teilKlasse} aria-label={t('Tür fertig')}>
          <h2 className="font-semibold">{t('Ergebnis der Tür')}</h2>
          <p className="text-sm">{t('Automatisch:')} <Badge farbe={AMPEL_FARBE[auto]}>{AMPEL_TEXT[auto]}</Badge></p>
          {erlaubteErgebnisse(auto).length > 1 && (
            <div className="space-y-2">
              <label htmlFor="ergebnis">{t('Ergebnis (nur verschärfen möglich)')}</label>
              <Auswahl id="ergebnis" value={ergebnis} onChange={(e) => setErgebnisWahl(e.target.value as Ampel)}>
                {erlaubteErgebnisse(auto).map((a) => <option key={a} value={a}>{AMPEL_TEXT[a]}</option>)}
              </Auswahl>
              {ergebnis !== auto && (
                <div><label htmlFor="begruendung">{t('Begründung *')}</label><textarea id="begruendung" rows={2} value={begruendung} onChange={(e) => setBegruendung(e.target.value)} /></div>
              )}
            </div>
          )}
          <Fehler text={fehler} />
          <div className="flex flex-wrap gap-2">
            <button className="btn-primaer flex-1 py-3" disabled={gruendeTuer.length > 0} onClick={async () => {
              if (ergebnis !== auto && !begruendung.trim()) return setFehler(t('Bitte begründen, warum das Ergebnis verschärft wird.'))
              setFehler('')
              try { await tuerFertig(pid, { auto, ergebnis, begruendung: begruendung.trim() || null }); window.scrollTo({ top: 0 }) } catch (e) { setFehler(fehlertext(e)) }
            }}>{t('Tür fertig')}</button>
            <button className="btn-sekundaer py-3" onClick={() => setNichtOffen(true)}>{t('Nicht geprüft …')}</button>
          </div>
          <OffeneGruende gruende={gruendeTuer} />
          <p className="text-xs text-slate-500">{t('Unterschrieben und abgeschlossen wird die Türanlage als Ganzes. Funktioniert auch offline.')}</p>
        </section>
      )}
      {!teil && laeuftNoch && istHaupt && (
        <section className={teilKlasse} aria-label={t('Abschluss')}>
          <h2 className="font-semibold">{t('Ergebnis und Abschluss')}</h2>
          <p className="text-sm">{t('Automatisch:')} <Badge farbe={AMPEL_FARBE[auto]}>{AMPEL_TEXT[auto]}</Badge></p>
          {erlaubteErgebnisse(auto).length > 1 && (
            <div className="space-y-2">
              <label htmlFor="ergebnis">{t('Ergebnis (nur verschärfen möglich)')}</label>
              <Auswahl id="ergebnis" value={ergebnis} onChange={(e) => setErgebnisWahl(e.target.value as Ampel)}>
                {erlaubteErgebnisse(auto).map((a) => <option key={a} value={a}>{AMPEL_TEXT[a]}</option>)}
              </Auswahl>
              {ergebnis !== auto && (
                <div><label htmlFor="begruendung">{t('Begründung *')}</label><textarea id="begruendung" rows={2} value={begruendung} onChange={(e) => setBegruendung(e.target.value)} /></div>
              )}
            </div>
          )}
          {elementePruefen && elementDef && elementeFehlen > 0 && !elementePflicht && (
            <p className="text-sm text-slate-600">{t('Noch {n} der heute vorgeschlagenen {mehrzahl} ohne Ergebnis.', { n: elementeFehlen, mehrzahl: elementDef.mehrzahl })}</p>
          )}
          <AbschlussUnterschrift pruefung={pruefung} gruende={gruendeAbschluss}
            pruefen={() => (ergebnis !== auto && !begruendung.trim() ? t('Bitte begründen, warum das Ergebnis verschärft wird.') : null)}
            abschluss={{ auto, ergebnis, begruendung: begruendung.trim() || null }}
            onAbgeschlossen={() => window.scrollTo({ top: 0 })} />
          <Fehler text={fehler} />
          {pruefung.revision === 0 && (
            <button className="link text-sm text-red-700" onClick={async () => {
              if (await bestaetigen(tb('Prüfung dieser Tür abbrechen? Alle Eingaben zu dieser Tür werden verworfen und die Tür wird für Kollegen freigegeben.'), { ok: t('Prüfung abbrechen'), gefahr: true })) {
                void pruefungAbbrechen(pid).then(() => navigate(liste))
              }
            }}>{t('Prüfung abbrechen')}</button>
          )}
        </section>
      )}
    </>
  )

  let nr = 0
  return (
    <Seite titel={istBestandArt(d.typArt) ? anlage.kunden_bezeichnung : <span className="font-mono">{anlage.etikett_id ?? tb('Tür ohne Etikett')}</span>} zurueck={{ zu: liste, text: teil ? t('Zur Türanlage') : tb('Zur Türliste') }}
      aktionen={<PruefAnsichtWahl wert={ansicht} onWechsel={setAnsicht} />}>
      {teil && haupt && (
        <button className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md border border-teal-200 bg-teal-50 px-4 py-2 text-left text-sm text-teal-900"
          onClick={() => navigate(liste)} data-teil-von>
          <span>{satz(t('Tür der {tueranlage}'), { tueranlage: <strong>{tueranlageText ?? t('Türanlage')}</strong> })}</span>
          {teilStand && <span>{t('{fertig} von {n} fälligen Türen erledigt', { fertig: teilStand.fertig, n: teilStand.tueren })}</span>}
        </button>
      )}
      {!anlage.etikett_id && !nurLesen && !istBestandArt(d.typArt) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>{tb('Diese Tür hat noch kein Etikett.')}</span>
          <button className="btn-sekundaer py-1" onClick={() => setEtikettOffen(true)}>{t('Etikett zuweisen')}</button>
        </div>
      )}
      <Dialog offen={etikettOffen} titel={t('Etikett zuweisen')} onSchliessen={() => setEtikettOffen(false)}>
        {etikettOffen && <EtikettZuweisen anlage={anlage} onFertig={() => setEtikettOffen(false)} />}
      </Dialog>
      {/* Auf dem Protokollblatt stehen diese Angaben im Kopf des Blatts */}
      {!protokoll && <div className="karte space-y-1 p-4 text-sm">
        <div className="flex items-start gap-3">
          <ArtSymbol art={d.typArt} groesse="lg" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="text-base font-medium">{anlage.kunden_bezeichnung ?? '–'}</div>
            <div>{[anlage.gebaeude, anlage.etage, anlage.raum].filter(Boolean).join(' / ')}{anlage.lage_beschreibung ? ` · ${anlage.lage_beschreibung}` : ''}</div>
            <PruefartChip name={d.pruefart?.name} />
          </div>
        </div>
        <div className="text-slate-500">{d.typName} · {t('Checkliste v{version}', { version: version.version })}{anlage.letzte_pruefung_am ? ` · ${t('zuletzt geprüft {datum}', { datum: datum(anlage.letzte_pruefung_am) })}` : ''}</div>
        {/* Bestand (Rauchwarnmelder, Geräte): keine Stammdaten, nur die Elemente */}
        {!istBestandArt(d.typArt) && <>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 pt-1" data-anlagendaten>
          <dt className="text-slate-500">{artDefinition(d.typArt).einzahl}</dt>
          <dd>{[anlage.hersteller, anlage.modell, anlage.baujahr && t('Bj. {jahr}', { jahr: anlage.baujahr })].filter(Boolean).join(' · ') || <span className="text-amber-700">{t('nicht erfasst')}</span>}</dd>
          {artDefinition(d.typArt).felder.map((f) => (
            <Fragment key={f.schluessel}>
              <dt className="text-slate-500">{f.text}</dt>
              <dd>{feldText(f, (anlage.eigenschaften as Eigenschaften)[f.schluessel]) || <span className="text-amber-700">{t('nicht erfasst')}</span>}</dd>
            </Fragment>
          ))}
        </dl>
        {!nurLesen && <button className="link text-sm" onClick={() => setAnlagendaten(true)}>{tb('Türdaten ergänzen')}</button>}
        </>}
      </div>}
      <Dialog offen={anlagendaten} titel={tb('Türdaten')} onSchliessen={() => setAnlagendaten(false)}>
        {anlagendaten && (
          <Formular simulation
            felder={(w) => [
              ...artFelder(d.typArt, false, d.vorhandene, w).slice(0, 2),
              { name: 'baujahr', label: t('Baujahr'), typ: 'number' },
              ...artFelder(d.typArt, true, d.vorhandene),
            ]}
            start={{ ...anlage, ...eigenschaftenWerte(anlage.eigenschaften) }}
            onAbbrechen={() => setAnlagendaten(false)}
            onSpeichern={async (w) => {
              const { eigenschaften, rest } = eigenschaftenTrennen(d.typArt, w, anlage.eigenschaften)
              await anlageAendern(anlage.id, { ...(rest as Parameters<typeof anlageAendern>[1]), eigenschaften })
              setAnlagendaten(false)
            }}
          />
        )}
      </Dialog>

      {duplikat && <Doppelpruefung pruefung={pruefung} gruppe={d.gruppe ?? []} name={name} darf={istAdmin || (d.gruppe ?? []).some((p) => p.pruefer_id === ich)} />}
      {teil && pruefung.status === 'geprueft' && (
        <section className="space-y-3 rounded-md border border-green-200 bg-green-50 p-4" aria-label={t('Tür fertig')}>
          <div className="flex flex-wrap items-center gap-2 font-medium text-green-900">
            {t('Tür fertig:')} <Badge farbe={AMPEL_FARBE[pruefung.ergebnis ?? 'gruen']}>{AMPEL_TEXT[pruefung.ergebnis ?? 'gruen']}</Badge>
          </div>
          <p className="text-sm text-green-900">
            {haupt?.abgeschlossen_am
              ? (haupt.protokoll_nr ? t('Mit der Türanlage abgeschlossen · Protokoll Nr. {nummer}.', { nummer: haupt.protokoll_nr }) : t('Mit der Türanlage abgeschlossen.'))
              : t('Unterschrift und Abschluss erfolgen mit der Türanlage. Bis dahin lässt sich die Tür weiter bearbeiten.')}
          </p>
          <Fehler text={fehler} />
          <div className="flex flex-wrap gap-2">
            {!haupt?.abgeschlossen_am && <button className="btn-primaer" onClick={() => navigate(objektListe, { state: { scannen: true } })}>{t('Nächste Tür scannen')}</button>}
            <button className="btn-sekundaer" onClick={() => navigate(liste)}>{t('Zur Türanlage')}</button>
            {tuerAbschliessbar && <button className="btn-sekundaer" onClick={() => void tuerWiederOeffnen(pid).catch((e) => setFehler(fehlertext(e)))}>{t('Weiter bearbeiten')}</button>}
            {haupt?.abgeschlossen_am && !istMit && !offeneHier.length && <button className="btn-sekundaer" onClick={() => void neuPruefen()}>{t('Erneut prüfen')}</button>}
          </div>
          <NachpruefenHinweis anzahl={offeneHier.length} moeglich={!!haupt?.abgeschlossen_am && !istMit} onNachpruefen={() => void neuPruefen()}
            spaeter={t('Nachprüfen lässt sie sich, sobald die Türanlage abgeschlossen ist (Unterschrift auf ihrer Seite).')} />
          {haupt?.abgeschlossen_am && (
            <ProtokollKnopf pruefungId={pid} revision={pruefung.revision} abgeschlossen={!!haupt.protokoll_nr}
              darf={istAdmin || istHaupt || (d.mitpruefer ?? []).some((m) => m.benutzer_id === ich && (m.status === 'zugelassen' || m.status === 'entfernt'))} />
          )}
        </section>
      )}
      {teil && pruefung.status === 'nicht_geprueft' && (
        <section className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-900" aria-label={t('Nicht geprüft')}>
          <p className="font-medium">{t('Nicht geprüft: {tuer}', { tuer: pruefung.nicht_geprueft_grund })}</p>
          <p className="text-sm">{t('Die Tür bleibt fällig und steht mit dem Grund im Protokoll der Türanlage.')}</p>
          <Fehler text={fehler} />
          <div className="flex flex-wrap gap-2">
            <button className="btn-sekundaer" onClick={() => navigate(liste)}>{t('Zur Türanlage')}</button>
            {tuerAbschliessbar && <button className="btn-sekundaer" onClick={() => void tuerWiederOeffnen(pid).catch((e) => setFehler(fehlertext(e)))}>{t('Doch prüfen')}</button>}
          </div>
        </section>
      )}
      {!teil && pruefung.status === 'geprueft' && (
        <section className="space-y-3 rounded-md border border-green-200 bg-green-50 p-4" aria-label={t('Abgeschlossen')}>
          <div className="flex flex-wrap items-center gap-2 font-medium text-green-900">
            {tb('Tür abgeschlossen: ')}<Badge farbe={AMPEL_FARBE[pruefung.ergebnis ?? 'gruen']}>{AMPEL_TEXT[pruefung.ergebnis ?? 'gruen']}</Badge>
          </div>
          <p className="text-sm text-green-900">
            {t('Geprüft von {name}', { name: prueferName })}{zugelassene.length ? ` ${t('mit {namen}', { namen: zugelassene.map((m) => d.namen?.get(m.benutzer_id) ?? t('Mitprüfer')).join(', ') })}` : ''}
            {pruefung.beendet_am ? ` ${t('am {datum}', { datum: datum(pruefung.beendet_am) })}` : ''}
            {' · '}{pruefung.protokoll_nr
              ? `${t('Protokoll Nr. {nummer}', { nummer: pruefung.protokoll_nr })}${pruefung.revision ? ` ${t('(Revision {revision})', { revision: pruefung.revision })}` : ''}`
              : t('wird übertragen – die Protokollnummer folgt')}
          </p>
          <Fehler text={fehler} />
          <div className="flex flex-wrap gap-2">
            <button className="btn-primaer" onClick={() => navigate(liste, { state: { scannen: true } })}>{tb('Nächste Tür scannen')}</button>
            <button className="btn-sekundaer" onClick={() => navigate(liste)}>{tb('Zur Türliste')}</button>
            {darfWiederOeffnen && <button className="btn-sekundaer" disabled={!online} {...demoKnopf()} onClick={() => setOeffnenOffen(true)}>{t('Wieder öffnen …')}</button>}
            {!istMit && !offeneHier.length && <button className="btn-sekundaer" onClick={() => void neuPruefen()}>{t('Erneut prüfen')}</button>}
          </div>
          <NachpruefenHinweis anzahl={offeneHier.length} moeglich={!istMit} onNachpruefen={() => void neuPruefen()} />
          {nachher > 0 && elementDef && (
            <p className="text-sm text-amber-900" data-nachher>
              {t('{n} {elemente} nach dieser Prüfung angelegt und noch nicht geprüft', { n: nachher, elemente: nachher === 1 ? elementDef.einzahl : elementDef.mehrzahl })}
              {istMit ? '.' : ` – ${t('„Erneut prüfen“ prüft sie.')}`}
            </p>
          )}
          {darfWiederOeffnen && !online && <p className="text-xs text-green-900">{t('Wieder öffnen geht nur mit Internetverbindung.')}</p>}
          <ProtokollKontrollieren />
          <ProtokollKnopf pruefungId={pid} revision={pruefung.revision} abgeschlossen={!!pruefung.abgeschlossen_am && !!pruefung.protokoll_nr}
            darf={istAdmin || pruefung.pruefer_id === ich || (d.mitpruefer ?? []).some((m) => m.benutzer_id === ich && (m.status === 'zugelassen' || m.status === 'entfernt'))} />
        </section>
      )}
      <Dialog offen={oeffnenOffen} titel={t('Prüfung wieder öffnen')} onSchliessen={() => setOeffnenOffen(false)}>
        {oeffnenOffen && <WiederOeffnen pruefungId={pid} prueferId={pruefung.pruefer_id} istAdmin={istAdmin} onFertig={() => setOeffnenOffen(false)} />}
      </Dialog>
      {d.abgelehnt && laeuftNoch && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span>{t('Der Abschluss wurde nicht angenommen:')} {tMeldung(d.abgelehnt)}</span>
          <button className="btn-sekundaer py-1" onClick={() => void metaSchreiben(`abschluss:${pid}`, undefined)}>{t('Verstanden')}</button>
        </div>
      )}
      {pruefung.revision > 0 && laeuftNoch && !pruefung.session_id && !teil && (
        <RevisionStand pruefung={pruefung} mitpruefer={d.mitpruefer ?? []} namen={d.namen ?? new Map()} />
      )}

      {teil && laeuftNoch && (istMit || (istHaupt && zugelassene.length > 0)) && (
        <p className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          {t('Gemeinsame Prüfung der Türanlage mit {namen}. Fertigmelden und Abschluss auf der Seite der Türanlage.', { namen: istMit ? prueferName : zugelassene.map((m) => d.namen?.get(m.benutzer_id) ?? t('Mitprüfer')).join(', ') })}
        </p>
      )}
      {!teil && laeuftNoch && (istMit || (istHaupt && zugelassene.length > 0)) && (
        <section className="karte space-y-3 border-sky-200 bg-sky-50 p-4 text-sm text-sky-900" aria-label={t('Gemeinsame Prüfung')}>
          {istMit ? (
            <>
              <p>{satz(t('Gemeinsame Prüfung mit {name} (Hauptprüfer). Ergebnis und Abschluss erfolgen durch {pruefer}.', { pruefer: prueferName }), { name: <strong>{prueferName}</strong> })}</p>
              {ichMit.fertig_am ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-green-900">
                  <span>{t('Sie haben Ihren Teil fertig gemeldet ✓')}</span>
                  <button className="btn-sekundaer py-1" onClick={() => void mitpruefungFertigZuruecknehmen(pid)}>{t('Zurücknehmen (weiter erfassen)')}</button>
                </div>
              ) : (
                <>
                  {ichMit.unterschrift ? (
                    <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900">
                      {t('Ihre Unterschrift ist erloschen, weil einer Ihrer Einträge geändert wurde. Bitte prüfen und erneut fertig melden.')}
                    </p>
                  ) : pruefung.revision > 0 && (
                    <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900">
                      {t('Ihre Unterschrift ist erloschen, weil die Prüfung wieder geöffnet wurde. Bitte prüfen und erneut fertig melden.')}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button className="btn-primaer py-2" onClick={() => setFertigOffen(true)}>{t('Meinen Teil fertig melden …')}</button>
                    <button className="btn-sekundaer py-2" disabled={!online} onClick={async () => {
                      if (await bestaetigen(t('Mitprüfung verlassen? Ihre bisherigen Eingaben bleiben in der Prüfung erhalten.'), { ok: t('Verlassen') })) {
                        try { await mitpruefenBeenden(pid); navigate(liste) } catch (e) { setFehler(fehlertext(e)) }
                      }
                    }}>{t('Mitprüfung verlassen')}</button>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <p>{t('Gemeinsame Prüfung mit:')}</p>
              <ul className="space-y-1">
                {zugelassene.map((m) => (
                  <li key={m.benutzer_id} className="flex flex-wrap items-center justify-between gap-2" data-mitpruefer={m.benutzer_id}>
                    <span><strong>{d.namen?.get(m.benutzer_id) ?? t('Prüfer')}</strong> · {m.fertig_am ? <Badge farbe="gruen">✓ {t('fertig')}</Badge> : <Badge farbe="gelb">{t('arbeitet noch')}</Badge>}</span>
                    <button className="btn-sekundaer py-1" disabled={!online} onClick={async () => {
                      if (await bestaetigen(t('{name} aus dieser Prüfung entfernen? Bereits erfasste Eingaben bleiben erhalten; im Protokoll steht er als beteiligt, ohne Unterschrift.', { name: d.namen?.get(m.benutzer_id) ?? t('Der Prüfer') }), { ok: t('Entfernen'), gefahr: true })) {
                        try { await mitpruefenBeenden(pid, m.benutzer_id) } catch (e) { setFehler(fehlertext(e)) }
                      }
                    }}>{t('Entfernen')}</button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <Fehler text={fehler} />
        </section>
      )}
      <Dialog offen={fertigOffen} titel={t('Meinen Teil fertig melden')} onSchliessen={() => setFertigOffen(false)}>
        {fertigOffen && <FertigMelden pruefungId={pid} hauptpruefer={prueferName} onFertig={() => setFertigOffen(false)} />}
      </Dialog>
      <MitpruefAnfragen />
      {nurLesen && laeuftNoch && !istMit && !istHaupt && (
        <p className="text-sm text-slate-600">{tb('Diese Tür wird von einem Kollegen geprüft – nur Ansicht.')}</p>
      )}

      {protokoll ? (
        <ProtokollBlatt pruefung={pruefung} anlage={anlage} typName={d.typName} typArt={d.typArt} pruefart={d.pruefart} version={version.version}
          abschnitte={nachAbschnitt(punkte.filter((p) => istSichtbar(p, werte, punkte)).map((p) => wirksam(p, werte, punkte)))}
          antworten={antwortJe} neueMaengel={neueMaengel} altMaengel={altMaengel} altEntscheidungen={altEntscheidungen}
          ergebnis={pruefung.status === 'in_pruefung' ? ergebnis : pruefung.ergebnis ?? 'gruen'}
          pruefer={[prueferName, ...zugelassene.map((m) => d.namen?.get(m.benutzer_id) ?? t('Mitprüfer'))].join('; ')}
          nummer={teil ? haupt?.protokoll_nr : pruefung.protokoll_nr}
          abgeschlossen={pruefung.status === 'geprueft' && !!(teil ? haupt?.abgeschlossen_am : pruefung.abgeschlossen_am)}
          teilVon={teil ? tueranlageText ?? t('Türanlage') : undefined}
          elemente={elementeTeil} elementDef={elementDef} elementListe={d.elemente}
          nurLesen={nurLesen} darfAltmaengel={istHaupt} onSetze={(p, w) => void setze(p, w)}
          onAnlagendaten={!nurLesen && !istBestandArt(d.typArt) ? () => setAnlagendaten(true) : undefined}>
          {ende}
        </ProtokollBlatt>
      ) : <>
      {altMaengel.length > 0 && (
        <section className="karte space-y-3 p-4">
          <h2 className="font-semibold">{t('Offene Mängel aus früheren Prüfungen')}</h2>
          {altMaengel.map((m) => (
            <div key={m.id} className="space-y-2 rounded-md border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2"><StufeBadge stufe={m.stufe} /><span>{m.beschreibung}</span></div>
              {m.element_id && elementDef && (
                <div className="text-xs text-slate-600">
                  {elementName(d.elemente?.find((e) => e.id === m.element_id) ?? { gruppe: null, nummer: '?' }, elementDef)} – {t('das Ergebnis in der Liste der {mehrzahl} entscheidet mit (i.O. = behoben).', { mehrzahl: elementDef.mehrzahl })}
                </div>
              )}
              <div className="text-xs text-slate-500">{t('festgestellt am {datum}', { datum: datum(m.erstellt_am) })}{m.status === 'behoben' ? ` · ${t('als behoben gemeldet {datum}', { datum: datum(m.behoben_am) })}` : ''}</div>
              <Fotos sessionId={pid} bezugTyp="mangel" bezugId={m.id} nurLesen />
              <div className="flex gap-2">
                {(['besteht', 'behoben'] as const).map((e) => (
                  <button key={e} disabled={nurLesen || !istHaupt} onClick={() => void altmangelEntscheiden(pruefung, m.id, e)}
                    className={`btn flex-1 ${altEntscheidungen[m.id] === e ? (e === 'besteht' ? 'bg-amber-500 text-white' : 'bg-green-600 text-white') : 'border border-slate-300 bg-white'}`}>
                    {e === 'besteht' ? t('besteht weiter') : t('behoben ✓')}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {nachAbschnitt(punkte.filter((p) => istSichtbar(p, werte, punkte)).map((p) => wirksam(p, werte, punkte))).map(([abschnitt, ps]) => (
        <section key={abschnitt} className="karte">
          <h2 className="border-b border-slate-100 px-4 py-2 font-semibold">{abschnitt}</h2>
          <div className="divide-y divide-slate-100">
            {ps.map((p) => {
              nr++
              const a = antwortJe[p.id]
              const maengelHier = neueMaengel.filter((m) => m.punkt_id === p.id)
              return (
                <div key={p.id} className="space-y-2 px-4 py-3" data-punkt={p.id}>
                  <div className="flex gap-2">
                    <span className="w-6 shrink-0 text-right text-sm text-slate-400">{nr}</span>
                    <div className="flex-1">
                      <div>{p.text}{p.pflicht && <span className="text-red-600"> *</span>}</div>
                      {p.hinweis && <div className="text-xs text-slate-500">{p.hinweis}</div>}
                    </div>
                  </div>
                  <div className="pl-8">
                    <PunktEingabe punkt={p} antwort={a} nurLesen={nurLesen} onSetze={(w) => void setze(p, w)} sessionId={pid}
                      antwortId={a?.id} onFotoAntwort={async () => { if (!a) await antwortSetzen(pid, p.id, { text: 'foto' }) }} />
                    {maengelHier.map((m) => (
                      <MangelKarte key={m.id} mangel={m} sessionId={pid} nurLesen={nurLesen}
                        fotoPflicht={!!p.foto_bei_nok} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}

      {elementeTeil}

      {/* Weitere Mängel ohne Bezug zu einem Prüfpunkt */}
      <section className="karte space-y-3 p-4">
        <h2 className="font-semibold">{t('Weitere Mängel')}</h2>
        {neueMaengel.filter((m) => !m.punkt_id).map((m) => (
          <MangelKarte key={m.id} mangel={m} sessionId={pid} nurLesen={nurLesen} loeschbar={!m.element_id} />
        ))}
        {!nurLesen && <button className="btn-sekundaer" onClick={() => void mangelAnlegen(pruefung, null, 2, '')}>+ {t('Mangel erfassen')}</button>}
      </section>

      {ende}
      </>}
      <Dialog offen={nichtOffen} titel={t('Tür nicht geprüft')} onSchliessen={() => setNichtOffen(false)}>
        {nichtOffen && (
          <GrundDialog titel={t('Nicht geprüft')} knopf={t('Als nicht geprüft markieren')} onSchliessen={() => setNichtOffen(false)}
            text={t('Die Tür bleibt fällig und steht mit dem Grund im Protokoll der Türanlage. Bisherige Eingaben bleiben erhalten.')}
            onSpeichern={async (grund) => { await tuerNichtGeprueft(pid, grund); window.scrollTo({ top: 0 }) }} />
        )}
      </Dialog>
    </Seite>
  )
}

function StufeBadge({ stufe }: { stufe: number }) {
  return <Badge farbe={stufe >= 3 ? 'rot' : 'gelb'}>{t('Stufe {stufe} – {text}', { stufe, text: STUFEN[stufe as Stufe] })}</Badge>
}

function Knopf({ aktiv, farbe, onClick, children, deaktiviert }: { aktiv: boolean; farbe: string; onClick: () => void; children: React.ReactNode; deaktiviert?: boolean }) {
  return (
    <button type="button" disabled={deaktiviert} onClick={onClick} aria-pressed={aktiv}
      className={`btn min-w-20 flex-1 py-3 ${aktiv ? farbe : 'border border-slate-300 bg-white text-slate-700'}`}>{children}</button>
  )
}

function PunktEingabe({ punkt, antwort, nurLesen, onSetze, sessionId, antwortId, onFotoAntwort }: {
  punkt: Punkt
  antwort?: { status: string | null; zahl: number | null; text: string | null }
  nurLesen: boolean
  onSetze: (w: AntwortWert) => void
  sessionId: string
  antwortId?: string
  onFotoAntwort: () => Promise<void>
}) {
  const [zahl, setZahl] = useState(antwort?.zahl?.toString().replace('.', ',') ?? '')
  const [text, setText] = useState(antwort?.text ?? '')
  const entfaellt = antwort?.status === 'entfaellt'
  const entfaelltKnopf = (
    <Knopf aktiv={entfaellt} farbe="bg-slate-500 text-white" deaktiviert={nurLesen} onClick={() => onSetze({ status: 'entfaellt' })}>{t('entfällt')}</Knopf>
  )

  switch (punkt.typ) {
    case 'status':
      return (
        <div className="flex gap-2">
          <Knopf aktiv={antwort?.status === 'io'} farbe="bg-green-600 text-white" deaktiviert={nurLesen} onClick={() => onSetze({ status: 'io' })}>{t('i.O.')}</Knopf>
          <Knopf aktiv={antwort?.status === 'nio'} farbe="bg-red-600 text-white" deaktiviert={nurLesen} onClick={() => onSetze({ status: 'nio' })}>{t('n.i.O.')}</Knopf>
          {entfaelltKnopf}
        </div>
      )
    case 'ja_nein':
      return (
        <div className="flex gap-2">
          {(['ja', 'nein'] as const).map((w) => (
            <Knopf key={w} aktiv={antwort?.text === w} farbe={punkt.gut && punkt.gut !== w ? 'bg-red-600 text-white' : 'bg-marke text-white'}
              deaktiviert={nurLesen} onClick={() => onSetze({ text: w })}>{w === 'ja' ? t('Ja') : t('Nein')}</Knopf>
          ))}
        </div>
      )
    case 'auswahl':
      return (
        <div className="flex flex-wrap gap-2">
          {punkt.optionen?.map((o) => (
            <Knopf key={o.wert} aktiv={antwort?.text === o.wert} farbe={o.mangel ? 'bg-red-600 text-white' : 'bg-marke text-white'}
              deaktiviert={nurLesen} onClick={() => onSetze({ text: o.wert })}>{o.wert}</Knopf>
          ))}
        </div>
      )
    case 'messwert': {
      const wert = antwort?.zahl
      const ausserhalb = wert != null && ((punkt.soll_min != null && wert < punkt.soll_min) || (punkt.soll_max != null && wert > punkt.soll_max))
      return (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <input inputMode="decimal" aria-label={`${punkt.text} (${punkt.einheit})`} disabled={nurLesen || entfaellt}
              className={`mt-0 w-28 ${ausserhalb ? 'border-red-500 bg-red-50' : ''}`} value={zahl}
              onChange={(e) => setZahl(e.target.value)}
              onBlur={() => {
                const n = Number(zahl.replace(',', '.'))
                if (zahl.trim() === '') return
                if (Number.isFinite(n)) onSetze({ zahl: n })
              }} />
            <span className="text-sm">{punkt.einheit}</span>
          </div>
          {(punkt.soll_min != null || punkt.soll_max != null) && (
            <span className={`text-xs ${ausserhalb ? 'font-semibold text-red-700' : 'text-slate-500'}`}>
              {t('Soll {min} bis {max} {einheit}', { min: punkt.soll_min ?? '–', max: punkt.soll_max ?? '–', einheit: punkt.einheit })}{ausserhalb ? ` – ${t('außerhalb!')}` : ''}
            </span>
          )}
          <div className="w-28">{entfaelltKnopf}</div>
        </div>
      )
    }
    case 'text':
      return (
        <textarea rows={2} aria-label={punkt.text} disabled={nurLesen} value={text} onChange={(e) => setText(e.target.value)}
          onBlur={() => { if ((antwort?.text ?? '') !== text) onSetze({ text }) }} />
      )
    case 'foto':
      return antwortId ? <Fotos sessionId={sessionId} bezugTyp="antwort" bezugId={antwortId} nurLesen={nurLesen} />
        : nurLesen ? <span className="text-sm text-slate-400">{t('kein Foto')}</span>
        : <button className="btn-sekundaer" onClick={() => void onFotoAntwort()}>📷 {t('Foto hinzufügen')}</button>
  }
}

/** Abgeschlossene Prüfung mit offenen Mängeln: Knopf „Nachprüfen“ (beginnt eine neue Prüfung) bzw. wann es geht. */
function NachpruefenHinweis({ anzahl, moeglich, onNachpruefen, spaeter }: { anzahl: number; moeglich: boolean; onNachpruefen: () => void; spaeter?: string }) {
  if (!anzahl) return null
  const text = anzahl === 1 ? t('1 Mangel ist noch offen.') : t('{n} Mängel sind noch offen.', { n: anzahl })
  return (
    <div className="space-y-2 rounded-md border border-red-200 bg-white p-3 text-sm text-red-900" data-nachpruefen-knopf>
      {moeglich ? <>
        <p>{text} {t('Nach der Behebung: neue Prüfung beginnen und je Mangel „behoben ✓“ oder „besteht weiter“ wählen.')}</p>
        <button className="btn-primaer" onClick={onNachpruefen}>{t('Nachprüfen')}</button>
      </> : <p>{text} {spaeter ?? ''}</p>}
    </div>
  )
}

function MangelKarte({ mangel, sessionId, nurLesen, fotoPflicht, loeschbar }: {
  mangel: Mangel
  sessionId: string
  nurLesen: boolean
  fotoPflicht?: boolean
  loeschbar?: boolean
}) {
  const [beschreibung, setBeschreibung] = useState(mangel.beschreibung)
  // Beschreibung von außen geändert (folgt der Antwort, Abgleich): übernehmen
  const [gespeichert, setGespeichert] = useState(mangel.beschreibung)
  if (gespeichert !== mangel.beschreibung) { setGespeichert(mangel.beschreibung); setBeschreibung(mangel.beschreibung) }
  return (
    <div className="mt-2 space-y-2 rounded-md border-l-4 border-red-500 bg-red-50 p-3" data-mangel={mangel.id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-red-800">{t('Mangel')}</span>
        <Auswahl aria-label={t('Mangelstufe')} className="mt-0 w-auto py-1 text-sm" disabled={nurLesen} value={mangel.stufe}
          onChange={(e) => void mangelAendern(mangel.id, { stufe: Number(e.target.value) })}>
          {([1, 2, 3] as Stufe[]).map((s) => <option key={s} value={s}>{t('Stufe {stufe} – {text}', { stufe: s, text: STUFEN[s] })}</option>)}
        </Auswahl>
      </div>
      <textarea rows={2} aria-label={t('Mangelbeschreibung')} disabled={nurLesen} value={beschreibung}
        placeholder={t('Was genau ist mangelhaft?')} onChange={(e) => setBeschreibung(e.target.value)}
        onBlur={() => { if (beschreibung !== mangel.beschreibung) void mangelAendern(mangel.id, { beschreibung }) }} />
      <Fotos sessionId={sessionId} bezugTyp="mangel" bezugId={mangel.id} nurLesen={nurLesen}
        hinweis={fotoPflicht ? t('Foto erforderlich') : undefined} />
      {loeschbar && !nurLesen && (
        <button className="link text-sm text-red-700" onClick={async () => { if (await bestaetigen(t('Mangel löschen?'), { ok: t('Löschen'), gefahr: true })) void mangelLoeschen(mangel.id) }}>{t('Mangel löschen')}</button>
      )}
    </div>
  )
}

export type { Pruefung }
