import { useState } from 'react'
import { bestaetigen } from '../components/Bestaetigung'
import { RestoreBerichtAnzeige } from '../components/RestoreBericht'
import { Fehler, Seite, Tabelle } from '../components/ui'
import { restoreStandSetzen, useRestoreStand } from '../datensicherung/restoreStand'
import { backupDateiname, backupErstellen, backupLesen, SCHEMA_STAND, wiederherstellen, type GeleseneSicherung } from '../datensicherung/sicherung'
import { herunterladen } from '../lib/csv'
import { loggen } from '../lib/log'
import { DIREKTE_ADRESSE, imFremdenRahmen } from '../lib/etikett'
import { fehlertext } from '../lib/supabase'
import { tb } from '../lib/begriffe'
import { gebietsschema, t } from '../lib/sprache'

/** Zeitpunkt der letzten Sicherung von diesem Gerät (auch als Hinweis vor dem Löschen aller Kundendaten) */
export const LETZTES_BACKUP = 'tuerpruefung:letztes-backup'
const zeit = (d: string) => new Date(d).toLocaleString(gebietsschema(), { dateStyle: 'medium', timeStyle: 'short' })

/** Backup (ZIP) und Restore (nur ergänzend) für Admins. */
export default function Datensicherung() {
  const [mitDateien, setMitDateien] = useState(true)
  const [fortschritt, setFortschritt] = useState('')
  const [fehler, setFehler] = useState('')
  const [meldung, setMeldung] = useState('')
  const [gelesen, setGelesen] = useState<GeleseneSicherung | null>(null)
  // Bericht der Wiederherstellung außerhalb der Seite: sperrt die Verschlüsselung währenddessen das Gerät, bleibt er sichtbar
  const restore = useRestoreStand()
  const bericht = restore.bericht
  const [letztes] = useState(() => { try { return localStorage.getItem(LETZTES_BACKUP) } catch { return null } })

  const sichern = async () => {
    setFehler(''); setMeldung('')
    try {
      const { zip, backup, fehlendeDateien } = await backupErstellen(mitDateien, setFortschritt)
      const name = backupDateiname('Backup_Tuerpruefung', backup)
      herunterladen(zip as BlobPart, name, 'application/zip')
      try { localStorage.setItem(LETZTES_BACKUP, backup.erstellt_am) } catch { /* egal */ }
      const summe = Object.entries(backup.anzahl).filter(([t]) => t !== 'audit_log').reduce((a, [, n]) => a + n, 0)
      void loggen('Backup erstellt', `${name}: ${summe} Datensätze${mitDateien ? `, ${backup.dateien} Dateien` : ', ohne Dateien'}`)
      setMeldung((mitDateien
        ? t('Backup „{name}“ erstellt: {n} Datensätze, {m} Dateien.', { name, n: summe, m: backup.dateien })
        : t('Backup „{name}“ erstellt: {n} Datensätze.', { name, n: summe }))
        + (fehlendeDateien.length ? ` ${t('{n} Datei(en) waren im Speicher nicht vorhanden.', { n: fehlendeDateien.length })}` : '')
        + ` ${t('Bitte an einem sicheren Ort außerhalb dieses Geräts ablegen.')}`)
    } catch (e) {
      setFehler(fehlertext(e))
    } finally {
      setFortschritt('')
    }
  }

  const einlesen = async (datei: File | undefined) => {
    setFehler(''); restoreStandSetzen(null); setGelesen(null)
    if (!datei) return
    try {
      setGelesen(backupLesen(new Uint8Array(await datei.arrayBuffer())))
    } catch (e) {
      setFehler(fehlertext(e))
    }
  }

  const zurueckspielen = async () => {
    if (!gelesen) return
    if (!await bestaetigen(t('Fehlende Daten aus dem Backup vom {zeit} ergänzen?\n\nVorhandene Daten werden NICHT verändert oder gelöscht. Wiederhergestellte Zugänge haben kein Passwort – bitte danach unter „Benutzer“ neu setzen.', { zeit: zeit(gelesen.backup.erstellt_am) }), { ok: t('Wiederherstellen') })) return
    setFehler('')
    restoreStandSetzen({ laeuft: true, fortschritt: '', bericht: null, fehler: '' })
    const fortschrittMelden = (t: string) => { setFortschritt(t); restoreStandSetzen({ fortschritt: t }) }
    try {
      const b = await wiederherstellen(gelesen, fortschrittMelden)
      restoreStandSetzen({ laeuft: false, bericht: b })
      void loggen('Wiederherstellung abgeschlossen', `Backup vom ${gelesen.backup.erstellt_am}: `
        + (Object.entries(b.tabellen).filter(([, n]) => n.eingefuegt || n.fehlgeschlagen)
          .map(([t, n]) => `${t} ${n.eingefuegt} ergänzt${n.fehlgeschlagen ? `, ${n.fehlgeschlagen} fehlgeschlagen` : ''}`).join(', ') || 'nichts ergänzt')
        + `; Dateien ${b.dateienHochgeladen} hochgeladen, ${b.dateienVorhanden} vorhanden; ${b.fehler.length} Fehler`)
    } catch (e) {
      setFehler(fehlertext(e))
      restoreStandSetzen({ laeuft: false, fehler: fehlertext(e) })
    } finally {
      setFortschritt('')
      restoreStandSetzen({ fortschritt: '' })
    }
  }

  const laeuft = !!fortschritt || restore.laeuft
  const neueresSchema = gelesen && gelesen.backup.schema > SCHEMA_STAND

  return (
    <Seite titel={t('Datensicherung')}>
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <strong>{t('Wichtig:')}</strong> {t('Dieses Backup ergänzt die automatischen Datenbank-Backups von Supabase, ersetzt sie aber nicht.')}
        {' '}{t('Im kostenlosen Supabase-Tarif gibt es keine automatischen Backups – für den Betrieb den Pro-Tarif nutzen.')}
      </div>
      {imFremdenRahmen() && <Fehler text={t('Im Share-Link sind Downloads gesperrt. Bitte die App direkt öffnen: {adresse}', { adresse: DIREKTE_ADRESSE })} />}

      <section className="karte space-y-3 p-4">
        <h2 className="font-semibold">{t('Backup erstellen')}</h2>
        <p className="text-sm text-slate-600">
          {tb('Lädt alle Daten (Kunden, Objekte, Türen, Checklisten, Prüfungen, Mängel, Benutzer, Änderungsprotokoll) als ZIP-Datei herunter.')}
          {letztes && <> {t('Letztes Backup von diesem Gerät:')} <strong>{zeit(letztes)}</strong>.</>}
        </p>
        <p className="text-sm text-slate-600" data-backup-verschluesselung>
          {t('Mit aktiver Verschlüsselung enthält das Backup Kunden, Objekte, Fotos, Unterschriften und Protokolle so, wie sie auf dem Server liegen: verschlüsselt.')}
          {' '}{t('Lesbar sind sie nur mit dem Schlüsselblatt der Instanz – bitte beides getrennt aufbewahren. Zurückspielen geht nur in dieselbe Instanz oder in eine neu aufgesetzte.')}
        </p>
        <label className="flex items-center gap-2 font-normal">
          <input type="checkbox" checked={mitDateien} onChange={(e) => setMitDateien(e.target.checked)} />
          {t('Fotos, Unterschriften, Sachkundenachweise und PDF-Protokolle einschließen (größer, aber vollständig)')}
        </label>
        <button className="btn-primaer" disabled={laeuft} onClick={() => void sichern()}>{t('Backup herunterladen')}</button>
      </section>

      <section className="karte space-y-3 p-4">
        <h2 className="font-semibold">{t('Aus Backup wiederherstellen')}</h2>
        <p className="text-sm text-slate-600">
          {tb('Ergänzt Datensätze und Dateien, die im Backup enthalten sind, aber heute fehlen – z. B. versehentlich gelöschte Türen oder nach einem Totalverlust alles.')} <strong>{t('Vorhandene Daten werden nie überschrieben oder gelöscht.')}</strong>
        </p>
        <div>
          <label htmlFor="backup-datei">{t('Backup-Datei (.zip)')}</label>
          <input id="backup-datei" type="file" accept=".zip,application/zip" disabled={laeuft} onChange={(e) => void einlesen(e.target.files?.[0])} />
        </div>
        {gelesen && (
          <div className="space-y-2 text-sm">
            <p>{t('Backup vom')} <strong>{zeit(gelesen.backup.erstellt_am)}</strong> ({gelesen.backup.erstellt_von}) · {t('{n} Dateien', { n: gelesen.dateien.length })} · {t('Datenbank {stand}', { stand: gelesen.backup.datenbank ?? gelesen.backup.schema })}</p>
            {neueresSchema && <Fehler text={t('Das Backup stammt von einer neueren App-Version. Bitte erst die App aktualisieren.')} />}
            <Tabelle kopf={[t('Tabelle'), t('Datensätze im Backup')]}>
              {Object.entries(gelesen.backup.anzahl).map(([tabelle, n]) => (
                <tr key={tabelle}><td className="px-3 py-1 font-mono text-xs">{tabelle}</td><td className="px-3 py-1">{n}{tabelle === 'audit_log' ? ` (${t('nur Archiv, wird nicht zurückgespielt')})` : ''}</td></tr>
              ))}
            </Tabelle>
            <button className="btn-primaer" disabled={laeuft || !!neueresSchema} onClick={() => void zurueckspielen()}>{t('Fehlende Daten wiederherstellen')}</button>
          </div>
        )}
        {bericht && <RestoreBerichtAnzeige bericht={bericht} />}
      </section>

      {(fortschritt || restore.fortschritt) && <p role="status" aria-live="polite" className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">{fortschritt || restore.fortschritt}</p>}
      {meldung && <div role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">{meldung}</div>}
      <Fehler text={fehler} />
    </Seite>
  )
}
