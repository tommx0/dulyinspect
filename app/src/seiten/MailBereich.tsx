import { useState } from 'react'
import { Dialog, Fehler, Laden } from '../components/ui'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'
import { useAbfrage } from '../lib/useAbfrage'
import { gebietsschema, t, tMeldung } from '../lib/sprache'

// Mailserver der Instanz (Einstellungen → System → Mail). Gespeichert und getestet wird über die Edge Function „mail“:
// Sie prüft den Server (keine internen Adressen) und verschlüsselt das Passwort, das danach nie wieder angezeigt wird.
// Grundlage für Statusmails, Fehlermeldungen und „Passwort vergessen“ (docs/KONZEPT-MAIL.md).

type Quelle = 'aus' | 'zentral' | 'eigen'
type Sicherheit = 'tls' | 'starttls' | 'keine'
type Einstellung = {
  quelle: Quelle
  smtp_host: string | null
  smtp_port: number | null
  smtp_sicherheit: Sicherheit
  smtp_benutzer: string | null
  absender_adresse: string | null
  absender_name: string | null
  zuletzt_getestet_am: string | null
  zuletzt_test_ok: boolean | null
  passwort_vergessen: boolean
  status_aktiv: boolean
  status_empfaenger: string[]
  status_intervall: Intervall
  status_wochentag: number
  status_monatstag: number
  status_uhrzeit: string
  fehler_aktiv: boolean
  meldung_empfaenger: string[]
  sofort_schwelle: 'aus' | 'stufe3' | 'stufe2'
  sofort_ueberfaellig: boolean
}
type Intervall = 'taeglich' | 'woechentlich' | 'monatlich'
type Stand = {
  einstellung: Einstellung
  passwort_gesetzt: boolean
  zentral: { verfuegbar: boolean; absender: string | null }
  schluessel: boolean
  demo: boolean
  status: { status_gesendet_am: string | null; status_fehler: number; status_letzter_fehler: string | null; naechster: string | null }
}

const datumZeit = (iso: string) => new Date(iso).toLocaleString(gebietsschema(), { dateStyle: 'medium', timeStyle: 'short' })

const STANDARD_PORT: Record<Sicherheit, number> = { tls: 465, starttls: 587, keine: 25 }

async function mailFunktion<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<{ daten?: T; fehler?: string }> {
  const { data, error } = await supabase.functions.invoke('mail', { body })
  if (error) {
    const ctx = (error as { context?: Response }).context
    try {
      const j = await ctx?.json()
      if (j?.fehler) return { fehler: tMeldung(j.fehler) }
    } catch { /* keine JSON-Antwort */ }
    return { fehler: tMeldung(error.message) }
  }
  if (data?.fehler) return { fehler: tMeldung(data.fehler) }
  return { daten: data as T }
}

export function MailBereich() {
  const stand = useAbfrage(async () => {
    const r = await mailFunktion<Stand>({ aktion: 'stand' })
    return { data: r.daten ?? null, error: r.fehler ? new Error(r.fehler) : null }
  })
  // Hier statt im Formular: Das Formular wird nach jedem Speichern und Testen mit dem neuen Stand neu aufgebaut
  const [meldung, setMeldung] = useState('')

  if (stand.fehler && !stand.daten) return <Fehler text={stand.fehler} />
  if (!stand.daten) return <Laden />
  return <>
    <MailFormular key={JSON.stringify(stand.daten)} stand={stand.daten} neuLaden={stand.neuLaden} meldung={meldung} setMeldung={setMeldung} />
    {stand.daten.einstellung.quelle !== 'aus' && <Statusmail key={`s${JSON.stringify(stand.daten)}`} stand={stand.daten} neuLaden={stand.neuLaden} />}
    {stand.daten.einstellung.quelle !== 'aus' && <Meldungen key={`m${JSON.stringify(stand.daten)}`} stand={stand.daten} neuLaden={stand.neuLaden} />}
  </>
}

function MailFormular({ stand, neuLaden, meldung, setMeldung }: {
  stand: Stand; neuLaden: () => Promise<void>; meldung: string; setMeldung: (m: string) => void
}) {
  const { benutzer: ich } = useAuth()
  const e = stand.einstellung
  const [quelle, setQuelle] = useState<Quelle>(e.quelle)
  const [host, setHost] = useState(e.smtp_host ?? '')
  const [sicherheit, setSicherheit] = useState<Sicherheit>(e.smtp_sicherheit)
  const [port, setPort] = useState(String(e.smtp_port ?? STANDARD_PORT[e.smtp_sicherheit]))
  const [benutzer, setBenutzer] = useState(e.smtp_benutzer ?? '')
  const [passwort, setPasswort] = useState('')
  const [passwortLoeschen, setPasswortLoeschen] = useState(false)
  const [adresse, setAdresse] = useState(e.absender_adresse ?? '')
  const [name, setName] = useState(e.absender_name ?? '')
  const [vergessen, setVergessen] = useState(e.passwort_vergessen ?? true)
  const [testAn, setTestAn] = useState(ich?.email ?? '')
  const [fehler, setFehler] = useState('')
  const [laeuft, setLaeuft] = useState(false)

  const geaendert = quelle !== e.quelle || host !== (e.smtp_host ?? '') || sicherheit !== e.smtp_sicherheit ||
    port !== String(e.smtp_port ?? STANDARD_PORT[e.smtp_sicherheit]) || benutzer !== (e.smtp_benutzer ?? '') || passwort !== '' ||
    passwortLoeschen || adresse !== (e.absender_adresse ?? '') || name !== (e.absender_name ?? '') || vergessen !== (e.passwort_vergessen ?? true)

  const sicherheitWaehlen = (s: Sicherheit) => {
    // Port mitziehen, solange er noch der Standard der bisherigen Wahl ist
    if (port === String(STANDARD_PORT[sicherheit]) || port === '') setPort(String(STANDARD_PORT[s]))
    setSicherheit(s)
  }

  const speichern = async () => {
    setFehler(''); setMeldung(''); setLaeuft(true)
    const r = await mailFunktion({
      aktion: 'speichern',
      quelle,
      smtp_host: quelle === 'eigen' ? host : null,
      smtp_port: quelle === 'eigen' ? port : null,
      smtp_sicherheit: sicherheit,
      smtp_benutzer: quelle === 'eigen' ? benutzer : null,
      absender_adresse: adresse,
      absender_name: name,
      passwort_vergessen: vergessen,
      ...(passwortLoeschen || quelle !== 'eigen' ? { passwort: '' } : passwort ? { passwort } : {}),
    })
    setLaeuft(false)
    if (r.fehler) return setFehler(r.fehler)
    await neuLaden()
  }

  const testen = async () => {
    setFehler(''); setMeldung(''); setLaeuft(true)
    const r = await mailFunktion({ aktion: 'testen', an: testAn })
    setLaeuft(false)
    if (r.fehler) return setFehler(r.fehler)
    setMeldung(t('Testmail an {adresse} verschickt. Bitte im Postfach (auch im Spam-Ordner) nachsehen.', { adresse: testAn }))
    await neuLaden()
  }

  const optionen: { wert: Quelle; text: string; hinweis: string }[] = [
    { wert: 'aus', text: t('Keine Mails verschicken'), hinweis: t('Statusmails, Fehlermeldungen und „Passwort vergessen“ stehen dann nicht zur Verfügung.') },
    ...(stand.zentral.verfuegbar || e.quelle === 'zentral' ? [{
      wert: 'zentral' as const,
      text: t('Mailserver des Betreibers nutzen'),
      hinweis: stand.zentral.verfuegbar
        ? t('Mails kommen von {absender}; Antworten gehen an Ihre Absenderadresse, falls angegeben.', { absender: stand.zentral.absender ?? '' })
        : t('Der Betreiber hat derzeit keinen Mailserver eingerichtet.'),
    }] : []),
    { wert: 'eigen', text: t('Eigenen Mailserver eintragen'), hinweis: t('SMTP-Zugang Ihres Mailanbieters, z. B. aus dessen Hilfe zu „E-Mail-Programm einrichten“.') },
  ]

  return (
    <section className="karte space-y-4 p-4">
      <h2 className="font-semibold">{t('Mailserver')}</h2>
      <p className="text-sm text-slate-600">
        {t('Über diesen Mailserver verschickt die App Statusmails, Fehlermeldungen und Links zum Zurücksetzen des Passworts.')}
      </p>
      {stand.demo && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{t('Im Demomodus werden keine Mails verschickt.')}</p>}

      <fieldset className="space-y-2">
        <legend className="sr-only">{t('Mailserver')}</legend>
        {optionen.map((o) => (
          <label key={o.wert} className="flex items-start gap-2">
            <input type="radio" name="mail-quelle" className="mt-1 w-auto" checked={quelle === o.wert} onChange={() => setQuelle(o.wert)} />
            <span>
              <span className="font-medium">{o.text}</span>
              <span className="block text-sm text-slate-600">{o.hinweis}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {quelle === 'eigen' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2">
            {t('SMTP-Server')}
            <input value={host} onChange={(x) => setHost(x.target.value.trim())} placeholder="smtp.example.com" spellCheck={false} autoCapitalize="off" />
          </label>
          <label>
            {t('Verschlüsselung')}
            <select value={sicherheit} onChange={(x) => sicherheitWaehlen(x.target.value as Sicherheit)}>
              <option value="starttls">{t('STARTTLS (meist Port 587)')}</option>
              <option value="tls">{t('SSL/TLS (meist Port 465)')}</option>
              <option value="keine">{t('Keine (nicht empfohlen)')}</option>
            </select>
          </label>
          <label>
            {t('Port')}
            <input value={port} inputMode="numeric" onChange={(x) => setPort(x.target.value.replace(/\D/g, '').slice(0, 5))} />
          </label>
          <label>
            {t('Benutzername')}
            <input value={benutzer} onChange={(x) => setBenutzer(x.target.value)} autoComplete="off" spellCheck={false} autoCapitalize="off" />
          </label>
          <div>
            <label>
              {t('Passwort')}
              <input type="password" value={passwort} autoComplete="new-password" disabled={passwortLoeschen || !stand.schluessel}
                placeholder={stand.passwort_gesetzt ? t('gespeichert – leer lassen, um es zu behalten') : ''}
                onChange={(x) => setPasswort(x.target.value)} />
            </label>
            {stand.passwort_gesetzt && (
              <label className="mt-1 flex items-center gap-2 text-sm font-normal">
                <input type="checkbox" className="w-auto" checked={passwortLoeschen} onChange={(x) => setPasswortLoeschen(x.target.checked)} />
                {t('Gespeichertes Passwort löschen')}
              </label>
            )}
          </div>
          {!stand.schluessel && (
            <p className="text-sm text-amber-800 sm:col-span-2">
              {t('Für diese Instanz fehlt der Mail-Schlüssel, deshalb lässt sich kein Passwort speichern. Bitte den Betreiber fragen.')}
            </p>
          )}
          {sicherheit === 'keine' && (
            <p className="text-sm text-amber-800 sm:col-span-2">{t('Ohne Verschlüsselung gehen Passwort und Inhalt der Mails lesbar über das Netz.')}</p>
          )}
        </div>
      )}

      {quelle !== 'aus' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            {quelle === 'eigen' ? t('Absenderadresse') : t('Antwortadresse (optional)')}
            <input type="email" value={adresse} onChange={(x) => setAdresse(x.target.value.trim())} placeholder="pruefung@example.com" />
          </label>
          <label>
            {t('Absendername (optional)')}
            <input value={name} maxLength={100} onChange={(x) => setName(x.target.value)} placeholder={t('z. B. Ihr Firmenname')} />
          </label>
        </div>
      )}

      {quelle !== 'aus' && (
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1 w-auto" checked={vergessen} onChange={(x) => setVergessen(x.target.checked)} />
          <span>
            <span className="font-medium">{t('„Passwort vergessen?“ auf der Anmeldeseite anbieten')}</span>
            <span className="block text-sm text-slate-600">{t('Benutzer bekommen einen Link per Mail, der eine Stunde gilt. Mit zweitem Faktor wird auch dessen Code abgefragt.')}</span>
          </span>
        </label>
      )}

      <Fehler text={fehler} />
      <button className="btn-primaer" disabled={!geaendert || laeuft} onClick={() => void speichern()}>{t('Speichern')}</button>

      {e.quelle !== 'aus' && (
        <div className="space-y-2 border-t border-slate-200 pt-3">
          <h3 className="font-semibold">{t('Testmail')}</h3>
          {e.zuletzt_getestet_am && (
            <p className="text-sm text-slate-600">
              {e.zuletzt_test_ok
                ? t('Zuletzt erfolgreich getestet am {zeit}.', { zeit: datumZeit(e.zuletzt_getestet_am) })
                : t('Letzter Test am {zeit} fehlgeschlagen.', { zeit: datumZeit(e.zuletzt_getestet_am) })}
            </p>
          )}
          {geaendert && <p className="text-sm text-slate-600">{t('Bitte zuerst speichern, getestet wird die gespeicherte Einstellung.')}</p>}
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-64 flex-1">
              {t('Empfänger')}
              <input type="email" value={testAn} onChange={(x) => setTestAn(x.target.value.trim())} />
            </label>
            <button className="btn-sekundaer" disabled={geaendert || laeuft || stand.demo || !testAn} onClick={() => void testen()}>
              {laeuft ? t('Wird gesendet …') : t('Testmail senden')}
            </button>
          </div>
          {meldung && <p role="status" className="text-sm text-green-800">{meldung}</p>}
        </div>
      )}
    </section>
  )
}

const WOCHENTAGE = [t('Montag'), t('Dienstag'), t('Mittwoch'), t('Donnerstag'), t('Freitag'), t('Samstag'), t('Sonntag')]

/** Statusmail: Prüfungen des abgelaufenen Zeitraums und anstehende des nächsten an eine feste Adressliste */
function Statusmail({ stand, neuLaden }: { stand: Stand; neuLaden: () => Promise<void> }) {
  const e = stand.einstellung
  const s = stand.status
  const [aktiv, setAktiv] = useState(e.status_aktiv)
  const [empfaenger, setEmpfaenger] = useState(e.status_empfaenger.join(', '))
  const [intervall, setIntervall] = useState<Intervall>(e.status_intervall)
  const [wochentag, setWochentag] = useState(e.status_wochentag)
  const [monatstag, setMonatstag] = useState(e.status_monatstag)
  const [uhrzeit, setUhrzeit] = useState(e.status_uhrzeit.slice(0, 5))
  const [fehler, setFehler] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  const [vorschau, setVorschau] = useState<{ betreff: string; html: string } | null>(null)

  const geaendert = aktiv !== e.status_aktiv || empfaenger !== e.status_empfaenger.join(', ') || intervall !== e.status_intervall ||
    wochentag !== e.status_wochentag || monatstag !== e.status_monatstag || uhrzeit !== e.status_uhrzeit.slice(0, 5)

  const speichern = async () => {
    setFehler(''); setLaeuft(true)
    const r = await mailFunktion({ aktion: 'status_speichern', status_aktiv: aktiv, status_empfaenger: empfaenger, status_intervall: intervall,
      status_wochentag: wochentag, status_monatstag: monatstag, status_uhrzeit: uhrzeit })
    setLaeuft(false)
    if (r.fehler) return setFehler(r.fehler)
    await neuLaden()
  }
  const vorschauLaden = async () => {
    setFehler(''); setLaeuft(true)
    const r = await mailFunktion<{ betreff: string; html: string }>({ aktion: 'vorschau' })
    setLaeuft(false)
    if (r.fehler) return setFehler(r.fehler)
    setVorschau(r.daten!)
  }

  return (
    <section className="karte mt-4 space-y-4 p-4" data-statusmail>
      <h2 className="font-semibold">{t('Statusmail')}</h2>
      <p className="text-sm text-slate-600">
        {t('Im eingestellten Rhythmus eine Mail mit den Prüfungen des abgelaufenen Zeitraums, den überfälligen und den im nächsten Zeitraum fälligen Prüfungen, dazu alles als CSV-Datei für die Tabellenkalkulation.')}
        {' '}{t('Ist die Verschlüsselung eingeschaltet, stehen Kunden- und Objektnamen nicht in der Mail.')}
      </p>
      <label className="flex items-center gap-2">
        <input type="checkbox" className="w-auto" checked={aktiv} onChange={(x) => setAktiv(x.target.checked)} />
        <span className="font-medium">{t('Statusmail verschicken')}</span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2">
          {t('Empfänger der Statusmail')}
          <input value={empfaenger} onChange={(x) => setEmpfaenger(x.target.value)} placeholder="leitung@example.com, buero@example.com" />
          <span className="mt-1 block text-xs font-normal text-slate-500">{t('Mehrere Adressen mit Komma trennen, höchstens 20.')}</span>
        </label>
        <label>
          {t('Rhythmus')}
          <select value={intervall} onChange={(x) => setIntervall(x.target.value as Intervall)}>
            <option value="taeglich">{t('täglich')}</option>
            <option value="woechentlich">{t('wöchentlich')}</option>
            <option value="monatlich">{t('monatlich')}</option>
          </select>
        </label>
        {intervall === 'woechentlich' && (
          <label>
            {t('Wochentag')}
            <select value={wochentag} onChange={(x) => setWochentag(Number(x.target.value))}>
              {WOCHENTAGE.map((w, i) => <option key={w} value={i + 1}>{w}</option>)}
            </select>
          </label>
        )}
        {intervall === 'monatlich' && (
          <label>
            {t('Tag im Monat')}
            <select value={monatstag} onChange={(x) => setMonatstag(Number(x.target.value))}>
              {Array.from({ length: 28 }, (_, i) => <option key={i} value={i + 1}>{i + 1}.</option>)}
            </select>
          </label>
        )}
        <label>
          {t('Uhrzeit (deutsche Zeit)')}
          <input type="time" value={uhrzeit} step={60} onChange={(x) => setUhrzeit(x.target.value)} />
        </label>
      </div>
      {e.status_aktiv && !geaendert && (
        <p className="text-sm text-slate-600">
          {s.naechster && t('Nächste Statusmail: {zeit}.', { zeit: datumZeit(s.naechster) })}
          {s.status_gesendet_am && <> {t('Zuletzt verschickt: {zeit}.', { zeit: datumZeit(s.status_gesendet_am) })}</>}
        </p>
      )}
      {s.status_fehler > 0 && (
        <p className="text-sm text-red-700">{t('Die letzten {n} Versuche sind fehlgeschlagen: {fehler}', { n: s.status_fehler, fehler: tMeldung(s.status_letzter_fehler ?? '') })}</p>
      )}
      <Fehler text={fehler} />
      <div className="flex flex-wrap gap-2">
        <button className="btn-primaer" disabled={!geaendert || laeuft} onClick={() => void speichern()}>{t('Speichern')}</button>
        <button className="btn-sekundaer" disabled={laeuft || geaendert} onClick={() => void vorschauLaden()}>{t('Vorschau')}</button>
      </div>
      <Dialog offen={!!vorschau} titel={vorschau?.betreff ?? ''} onSchliessen={() => setVorschau(null)} breit>
        <p className="mb-2 text-sm text-slate-600">{t('So sähe die Statusmail für den zuletzt abgeschlossenen Zeitraum aus. Verschickt wird nichts.')}</p>
        {/* sandbox ohne Rechte: der Inhalt kann weder Skripte ausführen noch die App erreichen */}
        {vorschau && <iframe title={t('Vorschau der Statusmail')} sandbox="" srcDoc={vorschau.html} className="h-[65dvh] w-full rounded border border-slate-200 bg-white" />}
      </Dialog>
    </section>
  )
}

/** Meldungen: Fehler der App (stündlich gesammelt), kritische Ergebnisse und neu überfällige Prüfungen */
function Meldungen({ stand, neuLaden }: { stand: Stand; neuLaden: () => Promise<void> }) {
  const e = stand.einstellung
  const [fehlerAn, setFehlerAn] = useState(e.fehler_aktiv)
  const [schwelle, setSchwelle] = useState(e.sofort_schwelle)
  const [ueberfaellig, setUeberfaellig] = useState(e.sofort_ueberfaellig)
  const [empfaenger, setEmpfaenger] = useState(e.meldung_empfaenger.join(', '))
  const [fehler, setFehler] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  const geaendert = fehlerAn !== e.fehler_aktiv || schwelle !== e.sofort_schwelle || ueberfaellig !== e.sofort_ueberfaellig ||
    empfaenger !== e.meldung_empfaenger.join(', ')
  const ohneEmpfaenger = !empfaenger.trim() && !e.status_empfaenger.length

  const speichern = async () => {
    setFehler(''); setLaeuft(true)
    const r = await mailFunktion({ aktion: 'meldungen_speichern', fehler_aktiv: fehlerAn, sofort_schwelle: schwelle, sofort_ueberfaellig: ueberfaellig,
      meldung_empfaenger: empfaenger })
    setLaeuft(false)
    if (r.fehler) return setFehler(r.fehler)
    await neuLaden()
  }

  return (
    <section className="karte mt-4 space-y-4 p-4" data-meldungen>
      <h2 className="font-semibold">{t('Meldungen')}</h2>
      <p className="text-sm text-slate-600">{t('Kurze Mails außerhalb der Statusmail, sobald etwas Aufmerksamkeit braucht. Geprüft wird stündlich.')}</p>
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-1 w-auto" checked={fehlerAn} onChange={(x) => setFehlerAn(x.target.checked)} />
        <span>
          <span className="font-medium">{t('Fehler der App melden')}</span>
          <span className="block text-sm text-slate-600">{t('Höchstens eine Sammelmail pro Stunde mit neuen und wieder aufgetretenen Fehlern, auch fehlgeschlagene Protokoll-PDFs. Alle Einträge unter Einstellungen → Fehlerprotokoll.')}</span>
        </span>
      </label>
      <label className="block">
        {t('Kritische Prüfergebnisse sofort melden')}
        <select value={schwelle} onChange={(x) => setSchwelle(x.target.value as typeof schwelle)}>
          <option value="stufe3">{t('nicht betriebssicher oder Mangel der Stufe 3')}</option>
          <option value="stufe2">{t('auch mit Mängeln oder Mangel der Stufe 2')}</option>
          <option value="aus">{t('nicht sofort melden')}</option>
        </select>
      </label>
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-1 w-auto" checked={ueberfaellig} onChange={(x) => setUeberfaellig(x.target.checked)} />
        <span>
          <span className="font-medium">{t('Neu überfällige Prüfungen melden')}</span>
          <span className="block text-sm text-slate-600">{t('Einmal am Tag zur Uhrzeit der Statusmail, jede Prüfung nur einmal.')}</span>
        </span>
      </label>
      <label className="block">
        {t('Empfänger der Meldungen')}
        <input value={empfaenger} onChange={(x) => setEmpfaenger(x.target.value)} placeholder={e.status_empfaenger.join(', ') || 'technik@example.com'} />
        <span className="mt-1 block text-xs font-normal text-slate-500">{t('Leer: dieselben Empfänger wie die Statusmail.')}</span>
      </label>
      {ohneEmpfaenger && (fehlerAn || ueberfaellig || schwelle !== 'aus') && (
        <p className="text-sm text-amber-800">{t('Es ist noch kein Empfänger eingetragen, hier oder bei der Statusmail. Bis dahin geht keine Meldung hinaus.')}</p>
      )}
      <Fehler text={fehler} />
      <button className="btn-primaer" disabled={!geaendert || laeuft} onClick={() => void speichern()}>{t('Speichern')}</button>
    </section>
  )
}
