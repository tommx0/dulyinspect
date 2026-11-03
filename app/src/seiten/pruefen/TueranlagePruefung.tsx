// Prüfung der Türanlage eines Objekts (docs/KONZEPT-TUERANLAGE.md): Türliste mit Stand, Mitprüfer, Gesamtergebnis,
// Unterschriften und Abschluss. Pflicht sind die beim Beginn fälligen Türen; die übrigen lassen sich mitprüfen.
// Die Türen selbst werden als Teilprüfungen auf der normalen Prüfseite erfasst (AnlagenPruefung).
import { useLiveQuery } from 'dexie-react-hooks'
import { demoKnopf } from '../../lib/demo'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../../auth'
import { bestaetigen } from '../../components/Bestaetigung'
import { ProtokollKnopf } from '../../components/Pruefprotokolle'
import { ArtSymbol, EtikettText, Weiter } from '../../components/Symbole'
import { Badge, datum, Dialog, Fehler, Seite } from '../../components/ui'
import { nachzupruefen, offeneMaengelJe } from '../../lib/maengel'
import { erlaubteErgebnisse, type Ampel } from '../../lib/pruefung'
import { tb } from '../../lib/begriffe'
import { t, tMeldung } from '../../lib/sprache'
import { fehlertext } from '../../lib/supabase'
import { anlageVergleich } from '../../lib/sortierung'
import { tueranlageName, tuerName, tuerPflicht } from '../../lib/tueranlage'
import { objektAbgleichen, objektBeobachten } from '../../offline/abgleich'
import {
  mitpruefenBeenden, mitpruefungFertigZuruecknehmen, pruefungAbbrechen, pruefungOeffnen, teileVon, tuerenNichtGeprueft, tuerWiederOeffnen,
} from '../../offline/aktionen'
import { db, metaLesen, metaSchreiben, type Anlage, type Pruefart, type Pruefung } from '../../offline/db'
import { useSyncStatus } from '../../offline/sync'
import { AMPEL_FARBE, AMPEL_TEXT } from './ampel'
import { MaengelBadge } from './MaengelBadge'
import { AbschlussUnterschrift, Doppelpruefung, FertigMelden, GrundDialog, ProtokollKontrollieren, WiederOeffnen } from './Abschluss'
import { MitpruefAnfragen } from './Mitpruefen'
import { satz } from './satz'
import { RevisionStand } from './Revision'
import { entschluesseln } from '../../lib/verschluesselung'
import { Auswahl } from '../../components/Auswahl'

const RANG: Record<Ampel, number> = { gruen: 0, gelb: 1, rot: 2 }
const heute = () => new Date().toISOString().slice(0, 10)

export function TueranlagePruefung({ pid }: { pid: string }) {
  const navigate = useNavigate()
  const { benutzer, istAdmin } = useAuth()
  const { online } = useSyncStatus()
  const [fehler, setFehler] = useState('')
  const [ergebnisWahl, setErgebnisWahl] = useState<Ampel | null>(null)
  const [begruendung, setBegruendung] = useState('')
  const [fertigOffen, setFertigOffen] = useState(false)
  const [oeffnenOffen, setOeffnenOffen] = useState(false)
  const [nichtGeprueft, setNichtGeprueft] = useState<Anlage | null>(null)
  const [uebrigeNicht, setUebrigeNicht] = useState(false)
  const [pruefartWahl, setPruefartWahl] = useState<{ tuer: Anlage; auswahl: Pruefart[]; danach?: (teilId: string) => Promise<void> } | null>(null)

  const d = useLiveQuery(async () => {
    const pruefung = await db.pruefungen.get(pid)
    if (!pruefung) return { pruefung: undefined }
    const anlage = await db.anlagen.get(pruefung.anlage_id)
    const objekt = anlage ? await db.objekte.get(anlage.objekt_id) : undefined
    const tueren = anlage ? (await db.anlagen.where('teil_von_id').equals(anlage.id).toArray()).filter((a) => a.status === 'aktiv')
      .sort((a, b) => anlageVergleich({ ...a, bezeichnung: a.kunden_bezeichnung }, { ...b, bezeichnung: b.kunden_bezeichnung })) : []
    const teile = (await teileVon(pid)).filter((tu) => tu.status !== 'duplikat')
    const maengel = await db.maengel.where('anlage_id').anyOf(tueren.map((tu) => tu.id)).toArray()
    const mitpruefer = await db.mitpruefer.where('anlagenpruefung_id').equals(pid).toArray()
    const erste = pruefung.duplikat_von ?? pruefung.id
    const gruppe = (await db.pruefungen.where('anlage_id').equals(pruefung.anlage_id).toArray())
      .filter((p) => !p.session_id && (p.id === erste || p.duplikat_von === erste))
    const namen = new Map((await db.benutzer.bulkGet([pruefung.pruefer_id, ...mitpruefer.map((m) => m.benutzer_id), ...gruppe.map((p) => p.pruefer_id)]))
      .filter((b) => !!b).map((b) => [b!.id, b!.name]))
    const pruefart = await db.pruefarten.get(pruefung.pruefart_id)
    const abgelehnt = await metaLesen<string>(`abschluss:${pid}`)
    // Der Gerätespeicher hält Objekt, Name des Unterzeichners und Ansprechpartner verschlüsselt: nach allen Abfragen an Dexie entschlüsseln
    const [pruefungKlar, anlageKlar, objektKlar] = await Promise.all([
      entschluesseln('anlagenpruefung', pruefung), entschluesseln('anlage', anlage), entschluesseln('objekt', objekt)])
    return { pruefung: pruefungKlar, anlage: anlageKlar, objektName: objektKlar?.name, tueren, teile, mitpruefer, gruppe, namen, pruefart, abgelehnt,
      maengel: offeneMaengelJe(maengel), nachpruefen: nachzupruefen(maengel, new Set(teile.map((tu) => tu.id))) }
  }, [pid])

  // Stand der Türen (auch die eines Mitprüfers) live halten
  const objektId = d?.anlage?.objekt_id
  useEffect(() => {
    if (!online || !objektId) return
    void objektAbgleichen(objektId).catch(() => undefined)
    const tu = setInterval(() => void objektAbgleichen(objektId).catch(() => undefined), 15_000)
    const ende = objektBeobachten(objektId)
    return () => { clearInterval(tu); ende() }
  }, [online, objektId])

  if (!d?.pruefung || !d.anlage) {
    return <Seite titel={t('Türanlage')} zurueck={{ zu: '/pruefen', text: t('Prüfen') }}><Fehler text={t('Prüfung nicht gefunden.')} /></Seite>
  }
  const { pruefung, anlage, tueren = [], teile = [], mitpruefer = [], namen = new Map<string, string>(), maengel = new Map(), nachpruefen = new Set<string>() } = d
  const liste = `/pruefen/o/${anlage.objekt_id}`
  const ich = benutzer!.id
  const istHaupt = pruefung.pruefer_id === ich && !pruefung.fremd
  const zugelassene = mitpruefer.filter((m) => m.status === 'zugelassen')
  const ichMit = zugelassene.find((m) => m.benutzer_id === ich)
  const laeuftNoch = pruefung.status === 'in_pruefung'
  const darfErfassen = laeuftNoch && (istHaupt || (!!ichMit && !ichMit.fertig_am))
  const name = (id: string) => (id === ich ? t('Sie') : namen.get(id) ?? t('ein Kollege'))
  const prueferName = namen.get(pruefung.pruefer_id) ?? t('ein Kollege')

  const teilVon = (tu: Anlage): Pruefung | undefined => teile.find((x) => x.anlage_id === tu.id)
  const fertig = teile.filter((tu) => tu.status === 'geprueft' && tu.ergebnis)
  const nicht = teile.filter((tu) => tu.status === 'nicht_geprueft')
  const erledigt = (tu: Anlage) => { const s = teilVon(tu)?.status; return s === 'geprueft' || s === 'nicht_geprueft' }
  // Pflicht beim Abschluss: die beim Beginn fälligen Türen; nicht fällige dürfen mitgeprüft werden
  const pflicht = (tu: Anlage) => tuerPflicht(tu.naechste_pruefung_am, pruefung.begonnen_am)
  const faellige = tueren.filter(pflicht)
  // Nicht fällige Türen mit einem Mangel aus einer früheren Prüfung: eigene Gruppe „Nachprüfen“ (optional, wie die übrigen)
  const nachpruefTueren = tueren.filter((tu) => !pflicht(tu) && nachpruefen.has(tu.id))
  const nichtFaellige = tueren.filter((tu) => !pflicht(tu) && !nachpruefen.has(tu.id))
  const offen = faellige.filter((tu) => !erledigt(tu))
  const auto = fertig.map((tu) => tu.ergebnis as Ampel).sort((a, b) => RANG[b] - RANG[a])[0] ?? null
  const ergebnis = auto && ergebnisWahl && erlaubteErgebnisse(auto).includes(ergebnisWahl) ? ergebnisWahl : auto
  const nochNichtFertig = zugelassene.filter((m) => !m.fertig_am)
  const duplikat = (pruefung.server_status ?? pruefung.status) === 'duplikat'
  const abgeschlossenHeute = !!pruefung.abgeschlossen_am && pruefung.abgeschlossen_am.slice(0, 10) === heute()
  const darfWiederOeffnen = pruefung.status === 'geprueft' && !!pruefung.abgeschlossen_am && ((istHaupt && abgeschlossenHeute) || istAdmin)

  /** Tür öffnen bzw. ihre Teilprüfung anlegen (bei mehreren Prüfarten fragen); `danach` statt Navigieren, z. B. „nicht geprüft“. */
  const tuerOeffnen = async (tu: Anlage, pruefartId?: string, danach?: (teilId: string) => Promise<void>) => {
    setFehler('')
    const vorhanden = teilVon(tu)
    if (vorhanden && !danach) return navigate(`/pruefen/p/${vorhanden.id}`)
    try {
      const r = vorhanden ? { ok: true as const, pruefungId: vorhanden.id } : await pruefungOeffnen(tu, 'manuell', pruefartId)
      if (r.ok) return danach ? await danach(r.pruefungId) : navigate(`/pruefen/p/${r.pruefungId}`)
      if ('auswahl' in r) return setPruefartWahl({ tuer: tu, auswahl: r.auswahl, danach })
      setFehler('grund' in r ? r.grund : t('Die Tür kann gerade nicht geöffnet werden.'))
    } catch (e) {
      setFehler(fehlertext(e))
    }
  }

  const tuerZeile = (tu: Anlage) => {
    const p = teilVon(tu)
    const kannNicht = darfErfassen && pflicht(tu) && p?.status !== 'geprueft' && p?.status !== 'nicht_geprueft'
    return (
      <li key={tu.id} className="flex flex-wrap items-center gap-x-2 pr-3 pb-1" data-tuer={tu.etikett_id ?? tu.id}>
        {/* Mindestbreite: auf dem Handy rutschen die Links unter die Zeile, statt sie zusammenzudrücken */}
        <button className="zeile group min-w-0 flex-1 basis-72 items-start" disabled={!p && !darfErfassen} onClick={() => void tuerOeffnen(tu)}>
          <ArtSymbol art="tuer" groesse="sm" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span><EtikettText id={tu.etikett_id} /> {tu.kunden_bezeichnung}</span>
              <span className="flex flex-wrap justify-end gap-1.5">{tuerBadge(tu)}<MaengelBadge stand={maengel.get(tu.id)} /></span>
            </div>
            <div className="text-sm text-slate-600">{[tu.gebaeude, tu.etage, tu.raum].filter(Boolean).join(' / ')}{tu.lage_beschreibung ? ` · ${tu.lage_beschreibung}` : ''}</div>
          </div>
          <span className="self-center"><Weiter /></span>
        </button>
        {kannNicht && <button className="link ml-16 text-sm sm:ml-0" aria-label={t('{tuer} nicht geprüft', { tuer: tuerName(tu) })} onClick={() => setNichtGeprueft(tu)}>{t('Nicht geprüft …')}</button>}
        {darfErfassen && p?.status === 'nicht_geprueft' && (
          <button className="link ml-16 text-sm sm:ml-0" onClick={async () => {
            try { await tuerWiederOeffnen(p.id); navigate(`/pruefen/p/${p.id}`) } catch (e) { setFehler(fehlertext(e)) }
          }}>{t('Doch prüfen')}</button>
        )}
      </li>
    )
  }

  const tuerBadge = (tu: Anlage) => {
    const p = teilVon(tu)
    if (!p) return pflicht(tu) ? <Badge>{t('offen')}</Badge> : <Badge>{t('nächste {datum}', { datum: datum(tu.naechste_pruefung_am) })}</Badge>
    if (p.status === 'nicht_geprueft') return <Badge farbe="gelb">{t('nicht geprüft: {grund}', { grund: p.nicht_geprueft_grund })}</Badge>
    if (p.status === 'geprueft' && p.ergebnis) return <Badge farbe={AMPEL_FARBE[p.ergebnis]}>✓ {AMPEL_TEXT[p.ergebnis]}</Badge>
    return <Badge farbe="blau">{t('in Prüfung')}</Badge>
  }

  return (
    <Seite titel={tueranlageName(d.objektName)} zurueck={{ zu: liste, text: t('Zur Türliste') }}>
      <div className="karte space-y-1 p-4 text-sm" data-tueranlage>
        <div className="flex items-start gap-3">
          <ArtSymbol art="tueranlage" groesse="lg" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="text-base font-medium">{tueranlageName(d.objektName)}</div>
            <div className="text-slate-600">{t('Alle Türen des Objekts, gemeinsam geprüft und mit einer Unterschrift abgeschlossen')}</div>
          </div>
        </div>
        <p className="font-medium" data-fortschritt>
          {t('{erledigt} von {n} fälligen Türen erledigt · {fertig} fertig', { erledigt: faellige.filter(erledigt).length, n: faellige.length, fertig: fertig.length })}{nicht.length ? ` · ${t('{n} nicht geprüft', { n: nicht.length })}` : ''}
        </p>
      </div>

      {duplikat && <Doppelpruefung pruefung={pruefung} gruppe={d.gruppe ?? []} name={name} darf={istAdmin || (d.gruppe ?? []).some((p) => p.pruefer_id === ich)} />}
      {pruefung.status === 'geprueft' && (
        <section className="space-y-3 rounded-md border border-green-200 bg-green-50 p-4" aria-label={t('Abgeschlossen')}>
          <div className="flex flex-wrap items-center gap-2 font-medium text-green-900">
            {t('Türanlage abgeschlossen:')} <Badge farbe={AMPEL_FARBE[pruefung.ergebnis ?? 'gruen']}>{AMPEL_TEXT[pruefung.ergebnis ?? 'gruen']}</Badge>
          </div>
          <p className="text-sm text-green-900">
            {t('Geprüft von {name}', { name: prueferName })}{zugelassene.length ? ` ${t('mit {namen}', { namen: zugelassene.map((m) => namen.get(m.benutzer_id) ?? t('Mitprüfer')).join(', ') })}` : ''}
            {pruefung.beendet_am ? ` ${t('am {datum}', { datum: datum(pruefung.beendet_am) })}` : ''}
            {' · '}{pruefung.protokoll_nr
              ? `${t('Protokoll Nr. {nummer}', { nummer: pruefung.protokoll_nr })}${pruefung.revision ? ` ${t('(Revision {revision})', { revision: pruefung.revision })}` : ''}`
              : t('wird übertragen – die Protokollnummer folgt')}
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primaer" onClick={() => navigate(liste)}>{t('Zur Türliste')}</button>
            {darfWiederOeffnen && <button className="btn-sekundaer" disabled={!online} {...demoKnopf()} onClick={() => setOeffnenOffen(true)}>{t('Wieder öffnen …')}</button>}
            {!ichMit && <button className="btn-sekundaer" onClick={async () => {
              setFehler('')
              try {
                const r = await pruefungOeffnen(anlage, 'manuell')
                if (r.ok) navigate(`/pruefen/p/${r.pruefungId}`)
                else setFehler('grund' in r ? r.grund : t('Die Türanlage wird gerade von einem Kollegen geprüft.'))
              } catch (e) { setFehler(fehlertext(e)) }
            }}>{t('Erneut prüfen')}</button>}
          </div>
          {darfWiederOeffnen && !online && <p className="text-xs text-green-900">{t('Wieder öffnen geht nur mit Internetverbindung.')}</p>}
          <Fehler text={fehler} />
          <ProtokollKontrollieren />
          <ProtokollKnopf pruefungId={pid} revision={pruefung.revision} abgeschlossen={!!pruefung.abgeschlossen_am && !!pruefung.protokoll_nr}
            darf={istAdmin || pruefung.pruefer_id === ich || mitpruefer.some((m) => m.benutzer_id === ich && (m.status === 'zugelassen' || m.status === 'entfernt'))} />
        </section>
      )}
      {d.abgelehnt && laeuftNoch && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span>{t('Der Abschluss wurde nicht angenommen:')} {tMeldung(d.abgelehnt)}</span>
          <button className="btn-sekundaer py-1" onClick={() => void metaSchreiben(`abschluss:${pid}`, undefined)}>{t('Verstanden')}</button>
        </div>
      )}
      {pruefung.revision > 0 && laeuftNoch && <RevisionStand pruefung={pruefung} mitpruefer={mitpruefer} namen={namen} />}

      {laeuftNoch && (ichMit || (istHaupt && zugelassene.length > 0)) && (
        <section className="karte space-y-3 border-sky-200 bg-sky-50 p-4 text-sm text-sky-900" aria-label={t('Gemeinsame Prüfung')}>
          {ichMit ? (
            <>
              <p>{satz(t('Gemeinsame Prüfung mit {name} (Hauptprüfer). Ergebnis und Abschluss der Türanlage erfolgen durch {pruefer}.', { pruefer: prueferName }), { name: <strong>{prueferName}</strong> })}</p>
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
                    <span><strong>{namen.get(m.benutzer_id) ?? t('Prüfer')}</strong> · {m.fertig_am ? <Badge farbe="gruen">✓ {t('fertig')}</Badge> : <Badge farbe="gelb">{t('arbeitet noch')}</Badge>}</span>
                    <button className="btn-sekundaer py-1" disabled={!online} onClick={async () => {
                      if (await bestaetigen(t('{name} aus dieser Prüfung entfernen? Bereits erfasste Eingaben bleiben erhalten; im Protokoll steht er als beteiligt, ohne Unterschrift.', { name: namen.get(m.benutzer_id) ?? t('Der Prüfer') }), { ok: t('Entfernen'), gefahr: true })) {
                        try { await mitpruefenBeenden(pid, m.benutzer_id) } catch (e) { setFehler(fehlertext(e)) }
                      }
                    }}>{t('Entfernen')}</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      <MitpruefAnfragen />

      <section className="karte" aria-label={t('Türen')}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
          <h2 className="font-semibold">{t('Fällige Türen ({n})', { n: faellige.length })}</h2>
          <div className="flex flex-wrap gap-2">
            {darfErfassen && offen.length > 0 && <button className="btn-sekundaer py-1.5" onClick={() => setUebrigeNicht(true)}>{t('Übrige nicht geprüft …')}</button>}
            {darfErfassen && <button className="btn-primaer py-1.5" onClick={() => navigate(liste, { state: { scannen: true } })}>{t('Tür scannen')}</button>}
          </div>
        </div>
        {tueren.length === 0 && <p className="px-4 py-3 text-sm text-slate-500">{tb('Dieses Objekt hat keine Türen.')}</p>}
        {tueren.length > 0 && faellige.length === 0 && <p className="px-4 py-3 text-sm text-slate-500">{t('Keine Tür ist fällig. Nicht fällige Türen lassen sich unten mitprüfen.')}</p>}
        <ul className="divide-y divide-slate-100">{faellige.map(tuerZeile)}</ul>
        {fehler && <div className="px-4 pb-3"><Fehler text={fehler} /></div>}
      </section>
      {nachpruefTueren.length > 0 && (
        <section className="karte border-amber-200" aria-label={t('Nachprüfen')} data-nachpruefen>
          <div className="border-b border-amber-100 bg-amber-50/60 px-4 py-2">
            <h2 className="font-semibold">{t('Nachprüfen ({n})', { n: nachpruefTueren.length })}</h2>
            <p className="text-sm text-slate-600">{t('Nicht fällig, aber mit offenem Mangel aus einer früheren Prüfung. Nach der Behebung die Tür öffnen und je Mangel „behoben ✓“ oder „besteht weiter“ wählen – optional, der Abschluss wartet nicht darauf.')}</p>
          </div>
          <ul className="divide-y divide-slate-100">{nachpruefTueren.map(tuerZeile)}</ul>
        </section>
      )}
      {nichtFaellige.length > 0 && (
        <details className="karte" open={nichtFaellige.some((tu) => !!teilVon(tu))} data-nicht-faellig>
          <summary className="cursor-pointer px-4 py-2 font-semibold">{t('Nicht fällig ({n})', { n: nichtFaellige.length })} <span className="text-sm font-normal text-slate-500">· {t('optional mitprüfen')}</span></summary>
          <ul className="divide-y divide-slate-100 border-tu border-slate-100">{nichtFaellige.map(tuerZeile)}</ul>
        </details>
      )}

      {laeuftNoch && ichMit && !istHaupt && (
        <p className="text-sm text-slate-600">{t('Ergebnis und Abschluss der Türanlage erfasst {pruefer}. Wenn Sie fertig sind, melden Sie Ihren Teil oben mit Unterschrift fertig.', { pruefer: prueferName })}</p>
      )}
      {laeuftNoch && istHaupt && (
        <section className="karte space-y-3 p-4" aria-label={t('Abschluss')}>
          <h2 className="font-semibold">{t('Ergebnis und Abschluss der Türanlage')}</h2>
          {auto ? <p className="text-sm">{t('Aus den Türen:')} <Badge farbe={AMPEL_FARBE[auto]}>{AMPEL_TEXT[auto]}</Badge></p>
            : <p className="text-sm text-slate-600">{t('Noch keine Tür fertig.')}</p>}
          {auto && erlaubteErgebnisse(auto).length > 1 && (
            <div className="space-y-2">
              <label htmlFor="ergebnis-ta">{t('Ergebnis (nur verschärfen möglich)')}</label>
              <Auswahl id="ergebnis-ta" value={ergebnis ?? auto} onChange={(e) => setErgebnisWahl(e.target.value as Ampel)}>
                {erlaubteErgebnisse(auto).map((a) => <option key={a} value={a}>{AMPEL_TEXT[a]}</option>)}
              </Auswahl>
              {ergebnis !== auto && (
                <div><label htmlFor="begruendung-ta">{t('Begründung *')}</label><textarea id="begruendung-ta" rows={2} value={begruendung} onChange={(e) => setBegruendung(e.target.value)} /></div>
              )}
            </div>
          )}
          <AbschlussUnterschrift pruefung={pruefung} knopf={t('Türanlage abschließen')} gruende={[
            ...(offen.length > 0 ? [t('Noch nicht fertig: {tueren}', { tueren: offen.map(tuerName).join(', ') })] : []),
            ...(!auto && offen.length === 0 ? [t('Mindestens eine Tür muss geprüft sein')] : []),
            ...nochNichtFertig.map((m) => t('{name} hat noch nicht fertig gemeldet', { name: namen.get(m.benutzer_id) ?? t('Ein Mitprüfer') })),
          ]}
            pruefen={() => (ergebnis !== auto && !begruendung.trim() ? t('Bitte begründen, warum das Ergebnis verschärft wird.') : null)}
            abschluss={{ auto: auto ?? 'gruen', ergebnis: ergebnis ?? 'gruen', begruendung: begruendung.trim() || null }}
            onAbgeschlossen={() => window.scrollTo({ top: 0 })} />
          {pruefung.revision === 0 && (
            <button className="link text-sm text-red-700" onClick={async () => {
              if (await bestaetigen(t('Prüfung der Türanlage abbrechen? Alle Eingaben zu ihren Türen werden verworfen und die Türanlage wird für Kollegen freigegeben.'), { ok: t('Prüfung abbrechen'), gefahr: true })) {
                void pruefungAbbrechen(pid).then(() => navigate(liste))
              }
            }}>{t('Prüfung abbrechen')}</button>
          )}
        </section>
      )}

      <Dialog offen={fertigOffen} titel={t('Meinen Teil fertig melden')} onSchliessen={() => setFertigOffen(false)}>
        {fertigOffen && <FertigMelden pruefungId={pid} hauptpruefer={prueferName} onFertig={() => setFertigOffen(false)} />}
      </Dialog>
      <Dialog offen={oeffnenOffen} titel={t('Türanlage wieder öffnen')} onSchliessen={() => setOeffnenOffen(false)}>
        {oeffnenOffen && <WiederOeffnen pruefungId={pid} prueferId={pruefung.pruefer_id} istAdmin={istAdmin} onFertig={() => setOeffnenOffen(false)} />}
      </Dialog>
      <Dialog offen={nichtGeprueft !== null} titel={t('Nicht geprüft: {tuer}', { tuer: nichtGeprueft ? tuerName(nichtGeprueft) : '' })} onSchliessen={() => setNichtGeprueft(null)}>
        {nichtGeprueft && (
          <GrundDialog titel={t('Nicht geprüft')} knopf={t('Als nicht geprüft markieren')} onSchliessen={() => setNichtGeprueft(null)}
            text={t('Die Tür bleibt fällig und steht mit dem Grund im Protokoll der Türanlage.')}
            onSpeichern={async (grund) => {
              const fehlgeschlagen = await tuerenNichtGeprueft([nichtGeprueft], grund)
              if (fehlgeschlagen.length) throw new Error(fehlgeschlagen[0].grund)
            }} />
        )}
      </Dialog>
      <Dialog offen={uebrigeNicht} titel={t('Übrige fällige Türen nicht geprüft ({n})', { n: offen.length })} onSchliessen={() => setUebrigeNicht(false)}>
        {uebrigeNicht && (
          <GrundDialog titel={t('Nicht geprüft')} knopf={offen.length === 1 ? t('1 Tür als nicht geprüft markieren') : t('{n} Türen als nicht geprüft markieren', { n: offen.length })} onSchliessen={() => setUebrigeNicht(false)}
            text={t('{tueren}: Die Türen bleiben fällig und stehen mit dem Grund im Protokoll der Türanlage.', { tueren: offen.map(tuerName).join(', ') })}
            onSpeichern={async (grund) => {
              const fehlgeschlagen = await tuerenNichtGeprueft(offen, grund)
              if (fehlgeschlagen.length) setFehler(fehlgeschlagen.map((f) => `${tuerName(f.tuer)}: ${f.grund}`).join(' · '))
            }} />
        )}
      </Dialog>
      <Dialog offen={pruefartWahl !== null} titel={t('Welche Prüfung?')} onSchliessen={() => setPruefartWahl(null)}>
        {pruefartWahl && (
          <div className="space-y-2">
            <p className="text-sm text-slate-600">{tuerName(pruefartWahl.tuer)}</p>
            {pruefartWahl.auswahl.map((p) => (
              <button key={p.id} className="btn-sekundaer w-full justify-start" onClick={() => { const w = pruefartWahl; setPruefartWahl(null); void tuerOeffnen(w.tuer, p.id, w.danach) }}>
                {p.name} · {p.intervall_monate === 1 ? t('alle 1 Monate') : t('alle {n} Monate', { n: p.intervall_monate })}
              </button>
            ))}
          </div>
        )}
      </Dialog>
    </Seite>
  )
}
