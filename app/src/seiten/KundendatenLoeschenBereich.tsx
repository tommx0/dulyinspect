import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router'
import { Fehler } from '../components/ui'
import { tb } from '../lib/begriffe'
import { loggen } from '../lib/log'
import { fehlertext, supabase } from '../lib/supabase'
import { db } from '../offline/db'
import { geraetNachLoeschungLeeren } from '../offline/kundendatenGeloescht'
import { LETZTES_BACKUP } from './Datensicherung'
import { gebietsschema, t } from '../lib/sprache'

const WORT = 'LÖSCHEN'
/** Dateien je Aufruf der Storage-API */
const STUECK = 100
const zeit = (iso: string) => new Date(iso).toLocaleString(gebietsschema(), { dateStyle: 'medium', timeStyle: 'short' })

type Datei = { bucket: string; pfad: string }
/** Antwort von kundendaten_loeschen (Migration 20261114090000) */
interface Ergebnis {
  anzahl: Record<string, number>
  etiketten: number
  pruefarten: number
  dateien: Datei[]
  geloescht_am: string
}
interface Bericht extends Omit<Ergebnis, 'dateien'> {
  checklisten: boolean
  dateien: number
  dateienGeloescht: number
  verworfen: number
}

/** Was im Bericht steht (Tabelle → Bezeichnung); Nebentabellen wie Revisionen zählen nur im Log */
const bezeichnungen = (): [string, string][] => [
  ['endkunde', t('Kunden')], ['objekt', t('Objekte')], ['anlage', tb('Türen')], ['anlage_element', t('Elemente (Melder, Leuchten …)')],
  ['anlage_faelligkeit', t('Fälligkeiten')], ['anlagenpruefung', t('Prüfungen')], ['mangel', t('Mängel')], ['foto', t('Fotos')],
  ['protokoll', t('Protokolle')], ['checkliste', t('Checklisten')],
]

/** Dateien der gelöschten Datensätze über die Storage-API löschen; liefert, wie viele wirklich gelöscht wurden. */
async function dateienLoeschen(dateien: Datei[], fortschritt: (text: string) => void): Promise<number> {
  const jeBucket = new Map<string, string[]>()
  for (const d of dateien) jeBucket.set(d.bucket, [...(jeBucket.get(d.bucket) ?? []), d.pfad])
  let geloescht = 0
  for (const [bucket, pfade] of jeBucket) {
    for (let i = 0; i < pfade.length; i += STUECK) {
      fortschritt(t('Dateien werden gelöscht: {n} von {m} …', { n: geloescht, m: dateien.length }))
      const { data, error } = await supabase.storage.from(bucket).remove(pfade.slice(i, i + STUECK))
      if (error) throw error
      geloescht += data?.length ?? 0
    }
  }
  return geloescht
}

/**
 * Alle Kundendaten löschen (nur Admin, der Server prüft das in kundendaten_loeschen): Kunden, Objekte, Anlagen mit Elementen,
 * Prüfungen, Mängel, Fälligkeiten, Protokolle und alle Dateien dazu, auf Wunsch auch die Checklisten. Benutzer, Einstellungen,
 * Anlagentypen, Prüfarten und Etiketten bleiben. Danach leeren alle Geräte ihren Offline-Speicher.
 */
export function KundendatenLoeschenBereich() {
  const [checklisten, setChecklisten] = useState(false)
  const [frage, setFrage] = useState(false)
  const [wort, setWort] = useState('')
  const [laeuft, setLaeuft] = useState('')
  const [fehler, setFehler] = useState('')
  const [bericht, setBericht] = useState<Bericht | null>(null)
  const [letztesBackup] = useState(() => { try { return localStorage.getItem(LETZTES_BACKUP) } catch { return null } })
  const ausstehend = useLiveQuery(() => db.outbox.count(), [], 0)

  const abbrechen = () => { setFrage(false); setWort('') }

  const loeschen = async () => {
    setFehler(''); setBericht(null)
    setLaeuft(t('Kundendaten werden gelöscht …'))
    try {
      const { data, error } = await supabase.rpc('kundendaten_loeschen', { p_bestaetigung: wort.trim(), p_checklisten: checklisten })
      if (error) throw error
      const e = data as unknown as Ergebnis
      let dateienGeloescht = 0
      let dateiFehler = ''
      try {
        dateienGeloescht = await dateienLoeschen(e.dateien, setLaeuft)
      } catch (err) {
        dateiFehler = fehlertext(err)
      }
      if (e.dateien.length) {
        void loggen('Dateien der Kundendaten gelöscht', `${dateienGeloescht} von ${e.dateien.length} Dateien` + (dateiFehler ? `; Fehler: ${dateiFehler}` : ''))
      }
      // Dieses Gerät sofort leeren, die anderen bei ihrer nächsten Verbindung (src/offline/kundendatenGeloescht.ts)
      const { verworfen } = await geraetNachLoeschungLeeren(e.geloescht_am)
      setBericht({ ...e, checklisten, dateien: e.dateien.length, dateienGeloescht, verworfen })
      abbrechen()
      if (dateienGeloescht < e.dateien.length) {
        setFehler(t('Die Datensätze sind gelöscht, {n} Datei(en) aber noch nicht', { n: e.dateien.length - dateienGeloescht })
          + (dateiFehler ? ` (${dateiFehler})` : '') + `. ${t('Erneutes Löschen räumt die verbliebenen Dateien auf.')}`)
      }
    } catch (err) {
      setFehler(fehlertext(err))
    } finally {
      setLaeuft('')
    }
  }

  return (
    <section className="karte space-y-3 p-4" data-kundendaten-loeschen>
      <h2 className="font-semibold">{t('Alle Kundendaten löschen')}</h2>
      <p className="text-sm text-slate-600">
        {tb('Leert diese Instanz, z. B. nach einer Testphase oder vor der Übergabe an einen neuen Betreiber. Gelöscht werden alle Kunden, Objekte, Türen mit ihren Elementen (Melder, Leuchten …), Prüfungen, Mängel, Fälligkeiten und Protokolle sowie alle Fotos, Unterschriften und Protokoll-PDFs im Speicher.')}
      </p>
      <p className="text-sm text-slate-600">
        <strong>{t('Erhalten bleiben')}</strong> {tb('Benutzer, Einstellungen, Türtypen, Prüfarten und Etiketten. Die Etiketten werden von ihren Türen gelöst und sind danach wieder frei.')}
        {' '}{t('Die Geräte der Prüfer leeren ihren Offline-Speicher bei der nächsten Verbindung; noch nicht übertragene Änderungen von vor der Löschung gehen dabei verloren.')}
      </p>

      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-sicherung-hinweis>
        <strong>{t('Vorher sichern:')}</strong> {t('Bitte zuerst eine')} <Link className="link" to="/datensicherung">{t('Datensicherung mit Dateien')}</Link>
        {' '}{t('erstellen und außerhalb dieses Geräts ablegen.')}{' '}
        {letztesBackup ? t('Letzte Sicherung von diesem Gerät: {zeit}.', { zeit: zeit(letztesBackup) }) : t('Von diesem Gerät wurde noch keine Sicherung erstellt.')}
      </div>

      <Fehler text={fehler} />
      {laeuft && <p role="status" className="text-sm text-slate-600">{laeuft}</p>}

      {bericht && (
        <div role="status" className="space-y-1 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900" data-bericht>
          <p><strong>{t('Kundendaten gelöscht')}</strong> ({zeit(bericht.geloescht_am)})</p>
          <ul className="list-disc pl-5">
            {bezeichnungen().filter(([tabelle]) => tabelle in bericht.anzahl).map(([tabelle, text]) => (
              <li key={tabelle}>{text}: {bericht.anzahl[tabelle]}</li>
            ))}
            <li>{t('Dateien: {n} von {m} gelöscht', { n: bericht.dateienGeloescht, m: bericht.dateien })}</li>
            <li>{t('Etiketten wieder frei: {n}', { n: bericht.etiketten })}</li>
            {!bericht.checklisten && <li>{t('Checklisten bleiben erhalten')}</li>}
            {bericht.checklisten && bericht.pruefarten > 0 && <li>{t('Prüfarten ohne Checkliste: {n} – bitte neue Checklisten zuordnen', { n: bericht.pruefarten })}</li>}
            {bericht.verworfen > 0 && <li>{t('Auf diesem Gerät verworfene Änderungen: {n}', { n: bericht.verworfen })}</li>}
          </ul>
        </div>
      )}

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={checklisten} disabled={!!laeuft} onChange={(e) => setChecklisten(e.target.checked)} data-checklisten />
        <span>{t('Auch alle Checklisten löschen (die Prüfarten bleiben, haben danach aber keine Checkliste mehr)')}</span>
      </label>

      {!frage ? (
        <button className="btn-gefahr" disabled={!!laeuft} onClick={() => { setFrage(true); setFehler(''); setBericht(null) }}>
          {t('Alle Kundendaten löschen …')}
        </button>
      ) : (
        <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900" data-frage>
          <p>
            <strong>{checklisten ? t('Wirklich alle Kundendaten und alle Checklisten löschen?') : t('Wirklich alle Kundendaten löschen?')}</strong>
            {' '}{t('Das lässt sich')} <strong>{t('nicht rückgängig machen')}</strong> {t('– zurück kommen die Daten nur aus einer Datensicherung.')}
          </p>
          {ausstehend > 0 && (
            <p>{t('Auf diesem Gerät sind noch {n} Änderung(en) nicht übertragen. Sie werden verworfen.', { n: ausstehend })}</p>
          )}
          <label className="block font-normal">
            {t('Zur Bestätigung')} <strong>{WORT}</strong> {t('eingeben')}
            <input className="mt-1 w-full" value={wort} onChange={(e) => setWort(e.target.value)} autoComplete="off" disabled={!!laeuft} data-wort />
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="btn-gefahr" disabled={!!laeuft || wort.trim() !== WORT} onClick={() => void loeschen()}>
              {laeuft ? t('Wird gelöscht …') : t('Endgültig löschen')}
            </button>
            <button className="btn-sekundaer" disabled={!!laeuft} onClick={abbrechen}>{t('Abbrechen')}</button>
          </div>
        </div>
      )}
    </section>
  )
}
