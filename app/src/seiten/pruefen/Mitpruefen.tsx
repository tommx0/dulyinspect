// Mehrpersonenprüfung: Anfrage beim Hauptprüfer (Dialog) und Bestätigung durch den Hauptprüfer (Popup).
import { useLiveQuery } from 'dexie-react-hooks'
import { demoKnopf } from '../../lib/demo'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../auth'
import { Dialog, Fehler } from '../../components/ui'
import { fehlertext } from '../../lib/supabase'
import { mitpruefenAnfragen, mitpruefenBeenden, mitpruefenEntscheiden, mitpruefungLaden, type MitpruefAngebot } from '../../offline/aktionen'
import { objektAbgleichen } from '../../offline/abgleich'
import { db } from '../../offline/db'
import { useSyncStatus } from '../../offline/sync'
import { tb } from '../../lib/begriffe'
import { t } from '../../lib/sprache'
import { satz } from './satz'
import { istTueranlage, tueranlageName } from '../../lib/tueranlage'
import { entschluesseln } from '../../lib/verschluesselung'

/** Hauptprüfer: Popup, sobald ein Kollege bei einer seiner Anlagen mitprüfen möchte. */
export function MitpruefAnfragen() {
  const { benutzer } = useAuth()
  const ich = benutzer!.id
  const { online } = useSyncStatus()
  const [fehler, setFehler] = useState('')
  const [spaeter, setSpaeter] = useState<string[]>([])
  const [laeuft, setLaeuft] = useState(false)

  const offen = useLiveQuery(async () => {
    const anfragen = await db.mitpruefer.filter((m) => m.status === 'angefragt').toArray()
    const zeilen = await Promise.all(anfragen.map(async (m) => {
      const p = await db.pruefungen.get(m.anlagenpruefung_id)
      if (!p || p.pruefer_id !== ich || p.status !== 'in_pruefung') return null
      const [anlage, wer] = await Promise.all([db.anlagen.get(p.anlage_id), db.benutzer.get(m.benutzer_id)])
      // Türanlage: mit dem (entschlüsselten) Namen ihres Objekts
      if (anlage && istTueranlage(anlage)) {
        const objekt = await entschluesseln('objekt', await db.objekte.get(anlage.objekt_id))
        return { m, wer: wer?.name ?? t('Ein Kollege'), anlage: tueranlageName(objekt?.name) }
      }
      return { m, wer: wer?.name ?? t('Ein Kollege'), anlage: [anlage?.etikett_id, anlage?.kunden_bezeichnung].filter(Boolean).join(' · ') || tb('eine Tür') }
    }))
    return zeilen.filter((z) => !!z)
  }, [ich], [])

  const sichtbar = offen.filter((z) => !spaeter.includes(`${z.m.anlagenpruefung_id}:${z.m.benutzer_id}`))
  const erste = sichtbar[0]

  const entscheiden = async (zulassen: boolean) => {
    if (!erste) return
    setFehler('')
    setLaeuft(true)
    try {
      await mitpruefenEntscheiden(erste.m.anlagenpruefung_id, erste.m.benutzer_id, zulassen)
    } catch (e) {
      setFehler(fehlertext(e))
    } finally {
      setLaeuft(false)
    }
  }

  return (
    <Dialog offen={!!erste} titel={t('Mitprüfen?')} onSchliessen={() => erste && setSpaeter((l) => [...l, `${erste.m.anlagenpruefung_id}:${erste.m.benutzer_id}`])}>
      {erste && (
        <div className="space-y-4">
          <p>{satz(t('{wer} möchte bei {anlage} mitprüfen.'), { wer: <strong>{erste.wer}</strong>, anlage: <strong>{erste.anlage}</strong> })}</p>
          <p className="text-sm text-slate-600">
            {t('Wenn Sie zulassen, können Sie beide Antworten, Mängel und Fotos erfassen. Ergebnis und Abschluss der Prüfung bleiben bei Ihnen – abschließen können Sie, sobald der Kollege seinen Teil mit Unterschrift fertig gemeldet hat.')}
            {sichtbar.length > 1 && ` ${t('Weitere Anfragen: {n}.', { n: sichtbar.length - 1 })}`}
          </p>
          {!online && <p className="text-sm text-amber-800">{t('Zum Entscheiden wird eine Verbindung benötigt.')}</p>}
          <Fehler text={fehler} />
          <div className="flex flex-wrap justify-end gap-2">
            <button className="btn-sekundaer" onClick={() => setSpaeter((l) => [...l, `${erste.m.anlagenpruefung_id}:${erste.m.benutzer_id}`])}>{t('Später')}</button>
            <button className="btn-sekundaer text-red-700" disabled={!online || laeuft} onClick={() => void entscheiden(false)}>{t('Ablehnen')}</button>
            <button className="btn-primaer" disabled={!online || laeuft} onClick={() => void entscheiden(true)}>{t('Zulassen')}</button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

/** Mitprüfer: Anfrage stellen und auf die Zulassung des Hauptprüfers warten. Danach geht es in die gemeinsame Prüfung. */
export function MitpruefenAnfrage({ objektId, angebot, anlageText, onSchliessen, onZugelassen }: {
  objektId: string
  angebot: MitpruefAngebot | null
  anlageText: string
  onSchliessen: () => void
  onZugelassen: (pruefungId: string) => void
}) {
  const { benutzer } = useAuth()
  const ich = benutzer!.id
  const { online } = useSyncStatus()
  const [fehler, setFehler] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  const pid = angebot?.pruefungId ?? ''
  const zugelassenRef = useRef(onZugelassen)
  useEffect(() => { zugelassenRef.current = onZugelassen })

  const mein = useLiveQuery(() => (pid ? db.mitpruefer.get([pid, ich]) : undefined), [pid, ich])
  const status = mein?.status ?? angebot?.status ?? 'keine'

  // Zugelassen: Prüfung auf dieses Gerät holen, dann öffnen
  useEffect(() => {
    if (!pid || mein?.status !== 'zugelassen') return
    let aktiv = true
    void mitpruefungLaden(pid).then(() => { if (aktiv) zugelassenRef.current(pid) }).catch((e) => { if (aktiv) setFehler(fehlertext(e)) })
    return () => { aktiv = false }
  }, [pid, mein?.status])

  // Auf die Entscheidung warten: der Live-Abgleich liefert sie, zusätzlich alle 5 s nachsehen
  useEffect(() => {
    if (!pid || status !== 'angefragt' || !online) return
    const t = setInterval(() => void objektAbgleichen(objektId).catch(() => undefined), 5_000)
    return () => clearInterval(t)
  }, [pid, status, online, objektId])

  const anfragen = async () => {
    setFehler('')
    setLaeuft(true)
    try {
      await mitpruefenAnfragen(pid)
    } catch (e) {
      setFehler(fehlertext(e))
    } finally {
      setLaeuft(false)
    }
  }
  const zuruecknehmen = async () => {
    setLaeuft(true)
    try {
      await mitpruefenBeenden(pid)
      onSchliessen()
    } catch (e) {
      setFehler(fehlertext(e))
    } finally {
      setLaeuft(false)
    }
  }

  return (
    <Dialog offen={!!angebot} titel={t('Gemeinsam prüfen')} onSchliessen={onSchliessen}>
      {angebot && (
        <div className="space-y-4">
          <p>{satz(t('{anlage} wird gerade von {pruefer} geprüft.'), { anlage: <strong>{anlageText}</strong>, pruefer: <strong>{angebot.hauptpruefer}</strong> })}</p>
          {status === 'keine' && (
            <>
              <p className="text-sm text-slate-600">{t('Für diese Anlage ist eine Mehrpersonenprüfung erlaubt. {pruefer} muss Ihr Mitprüfen erst bestätigen.', { pruefer: angebot.hauptpruefer })}</p>
              {!online && <p className="text-sm text-amber-800">{t('Zum Anfragen wird eine Verbindung benötigt.')}</p>}
              <Fehler text={fehler} />
              <div className="flex flex-wrap justify-end gap-2">
                <button className="btn-sekundaer" onClick={onSchliessen}>{t('Abbrechen')}</button>
                <button className="btn-primaer" disabled={!online || laeuft} {...demoKnopf()} onClick={() => void anfragen()}>{t('Mitprüfen anfragen')}</button>
              </div>
            </>
          )}
          {status === 'angefragt' && (
            <>
              <p role="status" className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
                {t('Anfrage gesendet. Warte auf die Bestätigung von {pruefer} …', { pruefer: angebot.hauptpruefer })}
              </p>
              <Fehler text={fehler} />
              <div className="flex flex-wrap justify-end gap-2">
                <button className="btn-sekundaer" disabled={laeuft} onClick={() => void zuruecknehmen()}>{t('Anfrage zurückziehen')}</button>
                <button className="btn-sekundaer" onClick={onSchliessen}>{t('Im Hintergrund warten')}</button>
              </div>
            </>
          )}
          {status === 'abgelehnt' && (
            <>
              <p role="status" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                {t('{pruefer} hat das Mitprüfen nicht zugelassen.', { pruefer: angebot.hauptpruefer })}
              </p>
              <Fehler text={fehler} />
              <div className="flex flex-wrap justify-end gap-2">
                <button className="btn-sekundaer" onClick={onSchliessen}>{t('Schließen')}</button>
                <button className="btn-primaer" disabled={!online || laeuft} onClick={() => void anfragen()}>{t('Erneut anfragen')}</button>
              </div>
            </>
          )}
          {status === 'zugelassen' && <p role="status" className="text-sm">{t('Zugelassen – die Prüfung wird geöffnet …')}</p>}
        </div>
      )}
    </Dialog>
  )
}
