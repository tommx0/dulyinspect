import QRCode from 'qrcode'
import { useCallback, useEffect, useRef, useState } from 'react'
import { bestaetigen } from '../components/Bestaetigung'
import { Badge, Fehler } from '../components/ui'
import { herunterladen } from '../lib/csv'
import { appName, useErscheinungsbild } from '../lib/erscheinungsbild'
import { BLATT_HINWEIS, blattDateiname, blattPdf } from '../lib/schluesselblattPdf'
import { t } from '../lib/sprache'
import { fehlertext, supabase } from '../lib/supabase'
import {
  STICHTAG, SchluesselFehler, abschalten, abschaltungAbbrechen, abschaltungBeginnen, bestandUmschluesseln, blattBestaetigen, einrichten, schluesselblatt, tauschAbbrechen, tauschAbschliessen, tauschBeginnen,
  tauschVorbereiten, umstellungAbschliessen, useBlattOffen, useVerschluesselung, verwaistMeldung, type Fortschritt, type Schluesselblatt,
  type UmschluesselnErgebnis,
} from '../lib/verschluesselung'

type Stand = {
  klartext: number; verschluesselt: number; verwaist?: number; verwaist_loeschbar?: number; tausch_offen?: number | null; tausch_neu?: number | null
  abschaltung_offen?: number | null; enc_dateien?: number
}

/** Wort, das der Admin zum Abschalten eintippt */
const ABSCHALTWORT = t('ABSCHALTEN')
/** Ab dem Stichtag ist die Verschlüsselung Pflicht und lässt sich nicht mehr abschalten (beim Laden der Seite bestimmt) */
const PFLICHT = !!STICHTAG && Date.now() >= Date.parse(STICHTAG)

/** Fehlertext für die Oberfläche (SchluesselFehler tragen schon eine fertige Meldung). */
const meldungVon = (e: unknown) => (e instanceof SchluesselFehler ? e.message : fehlertext(e))

/**
 * Verschlüsselung der Instanz (Admin, Einstellungen): einrichten mit Schlüsselblatt, Bestand umschlüsseln mit Fortschritt,
 * aktivieren, Schlüsselblatt neu drucken, Schlüssel tauschen bzw. den Tausch abbrechen und die Verschlüsselung wieder abschalten
 * (docs/KONZEPT-VERSCHLUESSELUNG.md, „Firmenschlüssel“, „Umstellung einer bestehenden Instanz“, „Abgang eines Mitarbeiters“,
 * „Abschalten der Verschlüsselung“). Die Bestätigung, dass das Blatt
 * verwahrt ist, bleibt im Gerätespeicher (blattBestaetigen); bis dahin wird nicht umgeschlüsselt, und nach dem Neuladen
 * erscheint das Blatt wieder zur Bestätigung.
 */
export function VerschluesselungBereich() {
  const z = useVerschluesselung()
  const offen = useBlattOffen()
  const erscheinung = useErscheinungsbild()
  const [blatt, setBlatt] = useState<{ blatt: Schluesselblatt; tausch: boolean } | null>(null)
  const [schirm, setSchirm] = useState(false)
  const [qrBild, setQrBild] = useState<{ qr: string; bild: string } | null>(null)
  const [stand, setStand] = useState<Stand | null>(null)
  const [fehler, setFehler] = useState('')
  const [meldung, setMeldung] = useState('')
  const [beschaeftigt, setBeschaeftigt] = useState('')
  const [fortschritt, setFortschritt] = useState<Fortschritt | null>(null)
  const [ergebnis, setErgebnis] = useState<UmschluesselnErgebnis | null>(null)
  const abbruch = useRef<AbortController | null>(null)
  const [abschaltFrage, setAbschaltFrage] = useState(false)
  const [abschaltWort, setAbschaltWort] = useState('')
  const [verwerfen, setVerwerfen] = useState(false)

  const bereit = z.art === 'bereit'
  const aktiv = bereit && z.aktiv
  const imTausch = bereit && z.tausch
  const abschaltung = bereit && z.abschaltung
  const umstellung = bereit && !z.aktiv && !z.abschaltung
  // Abschalten: vor dem Stichtag, mit verwahrtem Blatt, ohne Tausch
  const abschaltbar = bereit && !z.tausch && !z.abschaltung && !offen && !blatt && !PFLICHT
  const exportierbar = bereit && z.exportierbar
  const nichtEingerichtet = z.art === 'aus' || z.art === 'pflicht'
  // Tausch: läuft auf dem Server (dieses Gerät tauscht) oder ist auf diesem Gerät vorbereitet
  const tauschBlatt = !!blatt?.tausch
  const istTausch = imTausch || tauschBlatt
  // Ein Blatt, dessen Aufbewahrung noch nicht bestätigt ist (dauerhaft gemerkt), sonst gilt es als verwahrt. `bestaetigt`: gerade
  // angehakt (sofort sichtbar, das Speichern im Gerätespeicher folgt)
  const [bestaetigt, setBestaetigt] = useState('')
  const aufbewahrt = !!blatt && (offen !== (blatt.tausch ? 'tausch' : 'aktuell') || bestaetigt === blatt.blatt.schluesselId)

  // Nach dem Neuladen: ein noch nicht bestätigtes Blatt erneut anbieten
  useEffect(() => {
    if (!offen || !bereit || !exportierbar) return
    if (blatt && blatt.tausch === (offen === 'tausch')) return
    let gueltig = true
    void schluesselblatt(offen).then((b) => { if (gueltig) { setBlatt({ blatt: b, tausch: offen === 'tausch' }); setSchirm(false) } }).catch(() => undefined)
    return () => { gueltig = false }
  }, [offen, bereit, exportierbar, blatt])

  const standLaden = useCallback(async () => {
    const { data, error } = await supabase.rpc('verschluesselung_stand')
    if (!error) setStand(data as unknown as Stand)
  }, [])
  useEffect(() => { if (umstellung || imTausch || abschaltung) void standLaden() }, [umstellung, imTausch, abschaltung, standLaden])

  // QR-Code auf dem Bildschirm (nur wenn gewünscht – der Schlüssel soll nicht ungefragt sichtbar sein)
  useEffect(() => {
    if (!blatt || !schirm) return
    let gueltig = true
    const qr = blatt.blatt.qr
    void QRCode.toDataURL(qr, { margin: 1, errorCorrectionLevel: 'M', width: 320 }).then((bild) => { if (gueltig) setQrBild({ qr, bild }) })
    return () => { gueltig = false }
  }, [blatt, schirm])

  const ausfuehren = async (name: string, f: () => Promise<void>) => {
    setFehler(''); setMeldung(''); setBeschaeftigt(name)
    try {
      await f()
    } catch (e) {
      setFehler(meldungVon(e))
    } finally {
      setBeschaeftigt('')
    }
  }

  const einrichtenStarten = () => ausfuehren('einrichten', async () => {
    if (!await bestaetigen(t('Verschlüsselung einrichten?\n\nBilder und PDFs sowie Kunden, Objekte, Unterzeichner und Ansprechpartner werden verschlüsselt. Sobald der Schlüssel eingerichtet ist, sind alle anderen Geräte gesperrt, bis dort das Schlüsselblatt gescannt wurde. Bitte vorher auf allen Geräten die Sync-Anzeige auf „gespeichert“ bringen.'), { ok: t('Einrichten') })) return
    const b = await einrichten()
    setBlatt({ blatt: b, tausch: false })
    setSchirm(false)
  })

  const blattZeigen = (welcher: 'aktuell' | 'tausch') => ausfuehren('blatt', async () => {
    setBlatt({ blatt: await schluesselblatt(welcher), tausch: welcher === 'tausch' })
    setSchirm(false)
  })

  const verwahrtBestaetigen = (b: { blatt: Schluesselblatt; tausch: boolean }) => {
    setBestaetigt(b.blatt.schluesselId)
    return ausfuehren('bestaetigen', async () => {
      try { await blattBestaetigen(b.tausch ? 'tausch' : 'aktuell') } catch (e) { setBestaetigt(''); throw e }
    })
  }

  const pdfLaden = (b: { blatt: Schluesselblatt; tausch: boolean }) => ausfuehren('pdf', async () => {
    const pdf = await blattPdf(b.blatt, { instanz: appName(erscheinung), tausch: b.tausch })
    herunterladen(pdf, blattDateiname(b.blatt), 'application/pdf')
  })

  const umschluesseln = (art: 'umstellung' | 'tausch') => ausfuehren('umschluesseln', async () => {
    abbruch.current = new AbortController()
    setErgebnis(null); setFortschritt(null)
    try {
      if (art === 'tausch') {
        await tauschBeginnen()
        const r = await tauschAbschliessen({ onFortschritt: setFortschritt, signal: abbruch.current.signal })
        setErgebnis(r)
        setBlatt(null)
        setMeldung(t('Der Schlüssel ist getauscht. Alle anderen Geräte sind gesperrt, bis dort das neue Schlüsselblatt gescannt wurde. Das alte Blatt bitte vernichten.'))
      } else {
        const r = await bestandUmschluesseln({ onFortschritt: setFortschritt, signal: abbruch.current.signal })
        setErgebnis(r)
        setMeldung((r.fehler.length ? t('Durchlauf beendet: {n} Fehler.', { n: r.fehler.length }) : t('Durchlauf beendet: {n} Werte und Dateien verschlüsselt.', { n: r.geaendert }))
          + (r.verwaist.geloescht ? ' ' + t('{n} Dateien ohne Datensatz gelöscht.', { n: r.verwaist.geloescht }) : '')
          + (r.verwaist.wartend ? ` ${verwaistMeldung(r.verwaist.wartend, 'Die Umstellung lässt sich')}` : ''))
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError' || abbruch.current?.signal.aborted) setMeldung(t('Abgebrochen. Mit „Fortsetzen“ geht es dort weiter, wo es aufgehört hat.'))
      else throw e
    } finally {
      abbruch.current = null
      setFortschritt(null)
      await standLaden()
    }
  })

  const aktivieren = () => ausfuehren('aktivieren', async () => {
    if (!await bestaetigen(t('Verschlüsselung jetzt aktivieren?\n\nDanach lehnt der Server unverschlüsselte Kunden, Objekte, Bilder und PDFs ab. Geräte mit einer älteren App-Version müssen vorher aktualisiert werden.'), { ok: t('Aktivieren') })) return
    await umstellungAbschliessen()
    setBlatt(null)
    setErgebnis(null)
    setMeldung(t('Die Verschlüsselung ist aktiv.'))
  })

  const abbrechen = () => ausfuehren('abbrechen', async () => {
    if (!await bestaetigen(imTausch
      ? t('Schlüsseltausch abbrechen?\n\nWas schon mit dem neuen Schlüssel verschlüsselt ist, wird zurückgeschlüsselt (das kann dauern). Danach gilt der bisherige Schlüssel weiter, und die anderen Geräte sind wieder frei. Das neue Schlüsselblatt ist dann ungültig – bitte vernichten.')
      : t('Vorbereiteten Schlüsseltausch verwerfen?\n\nDas neue Schlüsselblatt ist dann ungültig – bitte vernichten.'), { ok: t('Tausch abbrechen'), gefahr: true })) return
    abbruch.current = new AbortController()
    setErgebnis(null); setFortschritt(null)
    try {
      const r = await tauschAbbrechen({ onFortschritt: setFortschritt, signal: abbruch.current.signal })
      if (r) setErgebnis(r)
      setBlatt(null)
      setMeldung(t('Der Schlüsseltausch ist abgebrochen, der bisherige Schlüssel gilt weiter. Das neue Schlüsselblatt bitte vernichten.'))
    } catch (e) {
      if ((e as Error).name === 'AbortError' || abbruch.current?.signal.aborted) setMeldung(t('Angehalten. „Tausch abbrechen“ setzt das Zurückschlüsseln fort.'))
      else throw e
    } finally {
      abbruch.current = null
      setFortschritt(null)
      await standLaden()
    }
  })

  const abschaltungStarten = () => ausfuehren('abschalten', async () => {
    if (abschaltWort.trim() !== ABSCHALTWORT) throw new Error(t('Bitte zur Bestätigung {wort} eingeben.', { wort: ABSCHALTWORT }))
    await abschaltungBeginnen()
    setAbschaltFrage(false)
    setAbschaltWort('')
    await entschluesseln()
  })

  /** Bestand entschlüsseln und abschalten (fortsetzbar); Fehler zeigt das Ergebnis, `verwerfen` gibt Unlesbares auf */
  const entschluesseln = async () => {
    abbruch.current = new AbortController()
    setErgebnis(null); setFortschritt(null)
    try {
      const r = await abschalten({ onFortschritt: setFortschritt, signal: abbruch.current.signal, trotzFehlern: verwerfen })
      setErgebnis(r.fehler.length ? r : null)
      setVerwerfen(false)
      setMeldung(t('Die Verschlüsselung ist abgeschaltet. Alle Geräte entschlüsseln ihre gespeicherten Daten beim nächsten Kontakt mit dem Server. Bewahren Sie das Schlüsselblatt weiter auf – ältere Datensicherungen sind nur damit lesbar.'))
    } catch (e) {
      if ((e as Error).name === 'AbortError' || abbruch.current?.signal.aborted) setMeldung(t('Angehalten. Mit „Fortsetzen“ geht es dort weiter, wo es aufgehört hat.'))
      else throw e
    } finally {
      abbruch.current = null
      setFortschritt(null)
      await standLaden()
    }
  }

  const abschaltungFortsetzen = () => ausfuehren('abschalten', entschluesseln)

  const abschaltungZurueck = () => ausfuehren('abschaltung_abbrechen', async () => {
    if (!await bestaetigen(t('Abschaltung abbrechen?\n\nDie Verschlüsselung bleibt eingerichtet. Was schon entschlüsselt ist, wird danach wieder verschlüsselt („Bestand umschlüsseln“), dann aktivieren Sie die Verschlüsselung erneut.'), { ok: t('Abschaltung abbrechen') })) return
    await abschaltungAbbrechen()
    setErgebnis(null)
    setMeldung(t('Die Abschaltung ist abgebrochen. Bitte den Bestand wieder umschlüsseln und die Verschlüsselung aktivieren.'))
  })

  const tauschStarten = () => ausfuehren('tausch', async () => {
    if (!await bestaetigen(t('Schlüssel tauschen?\n\nGedacht für den Abgang eines Admins oder den Verdacht, dass ein Schlüsselblatt in falsche Hände geraten ist. Alle Werte und Dateien werden neu verschlüsselt (Minuten bis Stunden, je nach Menge an Fotos und PDFs). Währenddessen sind alle anderen Geräte gesperrt und übertragen nichts; danach müssen alle das neue Blatt scannen. Bitte in einer Zeit ohne Prüfungen.'), { ok: t('Tausch vorbereiten') })) return
    const b = await tauschVorbereiten()
    setBlatt({ blatt: b, tausch: true })
    setSchirm(false)
  })

  const status = nichtEingerichtet ? <Badge farbe="gelb">{t('nicht eingerichtet')}</Badge>
    : imTausch ? <Badge farbe="blau">{t('Schlüsseltausch läuft')}</Badge>
      : abschaltung ? <Badge farbe="blau">{t('wird abgeschaltet')}</Badge>
      : umstellung ? <Badge farbe="blau">{t('eingerichtet – Umstellung läuft')}</Badge>
        : aktiv ? <Badge farbe="gruen">{t('aktiv')}</Badge> : null
  const laeuft = !!beschaeftigt
  const prozent = fortschritt && fortschritt.gesamt > 0 ? Math.min(100, Math.round((fortschritt.erledigt / fortschritt.gesamt) * 100)) : 0
  const fortschrittAnzeige = fortschritt && (
    <div role="status" aria-live="polite" className="space-y-1">
      <div className="h-2 overflow-hidden rounded bg-slate-200"><div className="h-full bg-green-600" style={{ width: `${prozent}%` }} /></div>
      <p className="text-xs text-slate-600">{fortschritt.phase === 'werte' ? t('Werte') : t('Dateien')} · {fortschritt.feld} · {t('{n} von {m}', { n: fortschritt.erledigt, m: fortschritt.gesamt })}
        {fortschritt.fehler ? ' · ' + t('{n} Fehler', { n: fortschritt.fehler }) : ''}</p>
    </div>
  )

  return (
    <section className="karte space-y-3 p-4" data-verschluesselung-bereich>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">{t('Verschlüsselung')}</h2>
        {status}
      </div>
      <p className="text-sm text-slate-600">
        {t('Kunden, Objekte, Namen der Unterzeichner, Ansprechpartner sowie alle Fotos, Unterschriften, Protokolle und Sachkundenachweise werden im Browser mit dem Firmenschlüssel dieser Instanz verschlüsselt. Der Server – und damit auch der Hoster – sieht nur Geheimtext. Den Schlüssel gibt es nur auf dem')}
        <strong> {t('Schlüsselblatt')}</strong> {t('und auf den Geräten der Mitarbeiter, die es einmal gescannt haben.')}
      </p>
      <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900" data-blatt-hinweis>
        <strong>{t('Wichtig:')}</strong> {BLATT_HINWEIS}
      </div>

      {nichtEingerichtet && (
        <div className="space-y-2">
          <p className="text-sm text-slate-700">
            {t('Diese Instanz ist noch nicht verschlüsselt. Das Einrichten erzeugt den Schlüssel in diesem Browser; danach drucken Sie das Schlüsselblatt und stellen den Bestand um.')}
          </p>
          <button className="btn-primaer" disabled={laeuft} onClick={() => void einrichtenStarten()}>
            {beschaeftigt === 'einrichten' ? t('Wird eingerichtet …') : t('Verschlüsselung einrichten')}
          </button>
        </div>
      )}

      {bereit && !exportierbar && (
        <p className="text-sm text-amber-800">
          {t('Auf diesem Gerät lässt sich der Schlüssel nicht anzeigen oder tauschen (nur auf Geräten, auf denen ein Admin das Schlüsselblatt gescannt hat). Bitte als Admin abmelden, anmelden und das Schlüsselblatt scannen.')}
        </p>
      )}

      {blatt && (
        <div className="space-y-3 rounded-md border border-slate-300 bg-slate-50 p-3" data-schluesselblatt>
          <h3 className="font-semibold">{blatt.tausch ? t('Neues Schlüsselblatt') : t('Schlüsselblatt')} · {t('Schlüssel-ID')} <span className="font-mono">{blatt.blatt.schluesselId}</span></h3>
          <p className="text-sm text-slate-700">
            {blatt.tausch
              ? t('Das neue Blatt ersetzt das bisherige. Bitte ausdrucken und das alte Blatt vernichten.')
              : t('Bitte jetzt ausdrucken und verschlossen aufbewahren. Auf jedem Gerät wird das Blatt einmal gescannt (QR-Code) oder abgetippt.')}
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primaer" disabled={laeuft} onClick={() => void pdfLaden(blatt)}>{t('Schlüsselblatt als PDF herunterladen')}</button>
            <button className="btn-sekundaer" onClick={() => setSchirm((s) => !s)}>{schirm ? t('Schlüssel ausblenden') : t('QR-Code auf dem Bildschirm zeigen')}</button>
          </div>
          {schirm && (
            <div className="space-y-2" data-schluessel-schirm>
              {qrBild?.qr === blatt.blatt.qr && <img src={qrBild.bild} alt={t('QR-Code des Schlüsselblatts')} className="size-56 rounded border border-slate-200 bg-white p-1" />}
              <p className="break-all font-mono text-sm font-semibold" aria-label={t('Schlüssel zum Abtippen')}>{blatt.blatt.text}</p>
            </div>
          )}
          {aktiv && !tauschBlatt && aufbewahrt ? (
            // Blatt eines bestehenden Schlüssels (neu drucken): schon verwahrt
            <button className="btn-sekundaer" onClick={() => { setBlatt(null); setSchirm(false) }}>{t('Schließen')}</button>
          ) : (
            <label className="flex items-start gap-2 font-normal">
              <input type="checkbox" className="mt-0.5" checked={aufbewahrt} disabled={aufbewahrt || laeuft}
                onChange={(e) => { if (e.target.checked) void verwahrtBestaetigen(blatt) }} />
              <span>{t('Ich habe das Schlüsselblatt ausgedruckt und verwahre es an einem sicheren Ort (nicht fotografiert, nicht weitergegeben).')}</span>
            </label>
          )}
          {!aufbewahrt && (
            <p className="text-sm font-medium text-red-800" data-blatt-offen>
              {t('Noch nicht bestätigt: Bis dahin hat nur dieses Gerät den Schlüssel. Nicht abmelden und den Browserspeicher nicht löschen.')}
            </p>
          )}
        </div>
      )}

      {(umstellung || (istTausch && blatt)) && (
        <div className="space-y-3 rounded-md border border-slate-300 p-3" data-umstellung>
          <h3 className="font-semibold">{istTausch ? t('Schlüsseltausch') : t('Bestand umschlüsseln')}</h3>
          {stand && !istTausch && (
            <p className="text-sm text-slate-700" data-stand>
              {t('Noch unverschlüsselt:')} <strong>{stand.klartext}</strong> {t('Werte und Dateien')} · {t('verschlüsselt:')} <strong>{stand.verschluesselt}</strong>
              {!!stand.verwaist && <> · {t('Dateien ohne Datensatz im Speicher:')} <strong>{stand.verwaist}</strong> {t('(werden beim Umschlüsseln gelöscht, jüngere als 24 Stunden erst danach – ihr Datensatz kann noch auf einem Gerät warten)')}</>}
            </p>
          )}
          {stand && imTausch && stand.tausch_offen != null && (
            <p className="text-sm text-slate-700" data-stand>
              {t('Noch mit dem bisherigen Schlüssel:')} <strong>{stand.tausch_offen}</strong> {t('Werte und Dateien')} · {t('mit dem neuen:')} <strong>{stand.tausch_neu ?? 0}</strong>
              {!!stand.verwaist && <> · {t('Dateien ohne Datensatz:')} <strong>{stand.verwaist}</strong></>}
            </p>
          )}
          {!istTausch && !blatt && (
            <button className="btn-sekundaer" disabled={laeuft || !exportierbar} onClick={() => void blattZeigen('aktuell')}>{t('Schlüsselblatt anzeigen')}</button>
          )}
          {fortschrittAnzeige}
          <div className="flex flex-wrap gap-2">
            {!istTausch && (
              <button className="btn-primaer" disabled={laeuft || (!!blatt && !aufbewahrt)} onClick={() => void umschluesseln('umstellung')}>
                {ergebnis || (stand && stand.verschluesselt > 0) ? t('Umschlüsseln fortsetzen') : t('Bestand jetzt umschlüsseln')}
              </button>
            )}
            {istTausch && (
              <button className="btn-primaer" disabled={laeuft || !aufbewahrt} onClick={() => void umschluesseln('tausch')}>
                {imTausch ? t('Tausch fortsetzen') : t('Tausch jetzt beginnen')}
              </button>
            )}
            {laeuft && (beschaeftigt === 'umschluesseln' || beschaeftigt === 'abbrechen') && (
              <button className="btn-sekundaer" onClick={() => abbruch.current?.abort()}>{t('Anhalten')}</button>
            )}
            {istTausch && (
              <button className="btn-sekundaer" disabled={laeuft} onClick={() => void abbrechen()} data-tausch-abbrechen>
                {beschaeftigt === 'abbrechen' ? t('Wird abgebrochen …') : t('Tausch abbrechen')}
              </button>
            )}
            {umstellung && stand && stand.klartext === 0 && !stand.verwaist && (
              <button className="btn-primaer" disabled={laeuft || (!!blatt && !aufbewahrt)} onClick={() => void aktivieren()}>{t('Verschlüsselung aktivieren')}</button>
            )}
          </div>
          {!aufbewahrt && blatt && <p className="text-xs text-slate-500">{t('Zuerst das Schlüsselblatt drucken und die Aufbewahrung bestätigen.')}</p>}
        </div>
      )}

      {ergebnis && ergebnis.fehler.length > 0 && (
        <details className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm" open data-umschluesseln-fehler>
          <summary>{ergebnis.art === 'abschaltung' ? t('{n} Werte bzw. Dateien ließen sich nicht entschlüsseln', { n: ergebnis.fehler.length }) : t('{n} Werte bzw. Dateien ließen sich nicht umschlüsseln', { n: ergebnis.fehler.length })}</summary>
          <ul className="mt-1 list-disc pl-5 font-mono text-xs">
            {ergebnis.fehler.slice(0, 50).map((f, i) => <li key={i}>{f.tabelle}.{f.spalte} ({Object.values(f.schluessel).join('/')}): {f.meldung}</li>)}
          </ul>
          <p className="mt-1 text-xs text-slate-600">{t('Der Durchlauf lässt sich wiederholen („Fortsetzen“). Fehlt eine Datei im Speicher, wird nur ihr Pfad umgesetzt.')}</p>
        </details>
      )}

      {aktiv && !istTausch && (
        <div className="space-y-2">
          <p className="text-sm text-slate-700">
            {t('Die Verschlüsselung ist aktiv. Neue Geräte und Mitarbeiter scannen nach der Anmeldung das Schlüsselblatt. Wer die Instanz verlässt, wird unter „Benutzer“ deaktiviert; geht ein Admin oder gerät ein Blatt in falsche Hände, tauschen Sie den Schlüssel.')}
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-sekundaer" disabled={laeuft || !exportierbar} onClick={() => void blattZeigen('aktuell')}>{t('Schlüsselblatt neu drucken')}</button>
            <button className="btn-sekundaer" disabled={laeuft || !exportierbar} onClick={() => void tauschStarten()}>{t('Schlüssel tauschen …')}</button>
          </div>
        </div>
      )}

      {abschaltbar && (aktiv || umstellung) && (
        <div className="space-y-2 border-t border-slate-100 pt-3" data-abschalten>
          {!abschaltFrage ? (
            <button className="btn-sekundaer" disabled={laeuft} onClick={() => { setAbschaltFrage(true); setFehler(''); setMeldung('') }}>
              {t('Verschlüsselung abschalten …')}
            </button>
          ) : (
            <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <p>
                <strong>{t('Verschlüsselung abschalten?')}</strong> {t('Kunden, Objekte, Unterzeichner, Ansprechpartner sowie alle Fotos, Unterschriften, Protokolle und Sachkundenachweise werden entschlüsselt und sind danach')}
                {' '}<strong>{t('für den Hoster wieder lesbar')}</strong>. {t('Das dauert je nach Menge an Fotos und PDFs Minuten bis Stunden; die anderen Geräte arbeiten währenddessen weiter und löschen danach ihren Schlüssel.')}
              </p>
              <p>{t('Das Schlüsselblatt bitte weiter aufbewahren: ältere Datensicherungen sind nur damit lesbar.')}</p>
              <label className="block font-normal">
                {t('Zur Bestätigung {wort} eingeben').split('{wort}').map((teil, i) => <span key={i}>{i > 0 && <strong>{ABSCHALTWORT}</strong>}{teil}</span>)}
                <input className="mt-1 w-full" value={abschaltWort} onChange={(e) => setAbschaltWort(e.target.value)} autoComplete="off" data-abschaltwort />
              </label>
              <div className="flex flex-wrap gap-2">
                <button className="btn-gefahr" disabled={laeuft || abschaltWort.trim() !== ABSCHALTWORT} onClick={() => void abschaltungStarten()}>
                  {beschaeftigt === 'abschalten' ? t('Wird abgeschaltet …') : t('Verschlüsselung abschalten')}
                </button>
                <button className="btn-sekundaer" disabled={laeuft} onClick={() => { setAbschaltFrage(false); setAbschaltWort('') }}>{t('Abbrechen')}</button>
              </div>
            </div>
          )}
        </div>
      )}

      {abschaltung && (
        <div className="space-y-3 rounded-md border border-slate-300 p-3" data-abschaltung>
          <h3 className="font-semibold">{t('Verschlüsselung abschalten')}</h3>
          <p className="text-sm text-slate-700">
            {t('Der Bestand wird entschlüsselt. Erst wenn nichts Verschlüsseltes mehr übrig ist, schaltet der Server die Verschlüsselung ab. Bis dahin lässt sich die Abschaltung abbrechen.')}
          </p>
          {stand && (
            <p className="text-sm text-slate-700" data-stand>
              {t('Noch verschlüsselt:')} <strong>{stand.verschluesselt}</strong> {t('Werte und Dateien')}
              {!!stand.verwaist && <> · {t('Dateien ohne Datensatz:')} <strong>{stand.verwaist}</strong> {t('(werden gelöscht, jüngere als 24 Stunden erst danach)')}</>}
            </p>
          )}
          {fortschrittAnzeige}
          {ergebnis?.art === 'abschaltung' && ergebnis.fehler.length > 0 && (
            <label className="flex items-start gap-2 text-sm font-normal text-red-900">
              <input type="checkbox" className="mt-0.5" checked={verwerfen} disabled={laeuft} onChange={(e) => setVerwerfen(e.target.checked)} data-abschalten-verwerfen />
              <span>{t('Nicht lesbare Werte und Dateien verwerfen und trotzdem abschalten (diese Daten sind dann verloren).')}</span>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button className="btn-primaer" disabled={laeuft} onClick={() => void abschaltungFortsetzen()}>
              {beschaeftigt === 'abschalten' ? t('Wird entschlüsselt …') : t('Entschlüsseln fortsetzen und abschalten')}
            </button>
            {laeuft && beschaeftigt === 'abschalten' && (
              <button className="btn-sekundaer" onClick={() => abbruch.current?.abort()}>{t('Anhalten')}</button>
            )}
            <button className="btn-sekundaer" disabled={laeuft} onClick={() => void abschaltungZurueck()} data-abschaltung-abbrechen>{t('Abschaltung abbrechen')}</button>
          </div>
        </div>
      )}

      {imTausch && !blatt && (
        <div className="space-y-2">
          <p className="text-sm text-slate-700">{t('Ein Schlüsseltausch läuft auf diesem Gerät und ist noch nicht abgeschlossen.')}</p>
          <button className="btn-primaer" disabled={laeuft} onClick={() => void blattZeigen('tausch')}>{t('Tausch fortsetzen')}</button>
        </div>
      )}

      <Fehler text={fehler} />
      {meldung && <p role="status" className="text-sm text-green-800" data-verschluesselung-meldung>{meldung}</p>}
    </section>
  )
}
