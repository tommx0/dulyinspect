import { useState, type FormEvent } from 'react'
import { EINRICHTUNG_HINWEIS, EINRICHTUNGSSCHLUESSEL } from '../lib/konfig'
import { loggen } from '../lib/log'
import { herunterladen } from '../lib/csv'
import { appName, useErscheinungsbild } from '../lib/erscheinungsbild'
import { BLATT_HINWEIS, blattDateiname, blattPdf } from '../lib/schluesselblattPdf'
import { t, tMeldung } from '../lib/sprache'
import { fehlertext, supabase } from '../lib/supabase'
import { ersteinrichtungSchluessel, type NeuerSchluessel } from '../lib/verschluesselung'

/** Fehlertext aus der Antwort der Edge Function lesen, falls vorhanden. */
async function funktionsfehler(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response }).context
  if (ctx?.status === 404) return t('Die Funktion „ersteinrichtung“ ist auf diesem Server noch nicht eingerichtet.')
  try {
    const j = await ctx?.json()
    if (j?.fehler) return tMeldung(j.fehler)
  } catch { /* ignorieren */ }
  return fehlertext(error)
}

/**
 * Erster Zugang einer neuen Instanz: Solange es keinen gibt, zeigt die Anmeldeseite dieses Formular.
 * Der Einrichtungsschlüssel (zeigen die Ausroll-Skripte an) verhindert, dass ein Fremder, der die Adresse zuerst aufruft, Admin wird.
 * Zuerst die Angaben, dann das Schlüsselblatt der Verschlüsselung (der Browser erzeugt den Schlüssel, der Admin druckt das Blatt und
 * bestätigt die Aufbewahrung – docs/KONZEPT-VERSCHLUESSELUNG.md). Die Edge Function „ersteinrichtung“ legt den Admin an und speichert
 * die Kennung der Verschlüsselung; danach meldet die App ihn direkt an (mit Zwei-Faktor-Pflicht folgt sofort die Einrichtung der
 * Authenticator-App). Der Schlüssel bleibt bis zum Abschluss derselbe – auch nach „Zurück“ und nach Fehlern der Edge Function –,
 * damit ein schon gedrucktes Schlüsselblatt gültig bleibt.
 */
export function Ersteinrichtung({ onAbgeschlossen }: { onAbgeschlossen: (hinweis: string) => void }) {
  const [schluessel, setSchluessel] = useState(EINRICHTUNGSSCHLUESSEL ?? '')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [passwort, setPasswort] = useState('')
  const [wiederholung, setWiederholung] = useState('')
  const [zweiFaktor, setZweiFaktor] = useState(true)
  const [fehler, setFehler] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  const erscheinung = useErscheinungsbild()
  // Schritt 2: Schlüsselblatt (der Schlüssel entsteht einmal und bleibt, bis die Einrichtung abgeschlossen ist)
  const [neu, setNeu] = useState<NeuerSchluessel | null>(null)
  const [blattSchritt, setBlattSchritt] = useState(false)
  const [aufbewahrt, setAufbewahrt] = useState(false)
  // Neu aufgesetzte Instanz, die gleich aus einem Backup wiederhergestellt wird: die Verschlüsselung kommt mit dem Backup (Datensicherung)
  const [ausBackup, setAusBackup] = useState(false)

  const weiter = async (e: FormEvent) => {
    e.preventDefault()
    if (passwort !== wiederholung) return setFehler(t('Die Passwörter stimmen nicht überein.'))
    setFehler('')
    if (ausBackup) return void absenden(null)
    if (!neu) setNeu(await ersteinrichtungSchluessel())
    setBlattSchritt(true)
  }

  const pdf = async () => {
    if (!neu) return
    setFehler('')
    try {
      herunterladen(await blattPdf(neu.blatt, { instanz: appName(erscheinung) }), blattDateiname(neu.blatt), 'application/pdf')
    } catch (err) {
      setFehler(fehlertext(err))
    }
  }

  const absenden = async (schluesselNeu: NeuerSchluessel | null = neu) => {
    setLaeuft(true)
    setFehler('')
    const { data, error } = await supabase.functions.invoke('ersteinrichtung', {
      body: { schluessel, name: name.trim(), email: email.trim(), passwort, zwei_faktor: zweiFaktor, ...(schluesselNeu ? { verschluesselung: schluesselNeu.kennung } : {}) },
    })
    if (error) {
      const text = await funktionsfehler(error)
      setLaeuft(false)
      // Inzwischen eingerichtet (z. B. in einem anderen Fenster): zur normalen Anmeldung, Hinweis dort anzeigen
      if ((error as { context?: Response }).context?.status === 409) onAbgeschlossen(text)
      // Zurück zu den Angaben (z. B. Einrichtungsschlüssel falsch) – der Schlüssel und ein schon gedrucktes Blatt bleiben gültig
      else { setFehler(text); setBlattSchritt(false) }
      return
    }
    // Der Server hat die Kennung gespeichert: den Schlüssel jetzt auf diesem Gerät ablegen (die Prüfung läuft nach der Anmeldung)
    if (schluesselNeu && (data as { verschluesselung?: boolean } | null)?.verschluesselung) await schluesselNeu.ablegen()
    const { error: anmeldefehler } = await supabase.auth.signInWithPassword({ email: email.trim(), password: passwort })
    setLaeuft(false)
    if (anmeldefehler) { onAbgeschlossen(t('Zugang angelegt, Anmeldung fehlgeschlagen: {fehler}', { fehler: anmeldefehler.message })); return }
    void loggen('Anmeldung')
    // Weiter mit dem Inbetriebnahme-Assistenten (Firmendaten, Anlagen, Vorlagen …)
    window.location.hash = '#/inbetriebnahme'
  }

  return (
    <div className="space-y-4" data-ersteinrichtung>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t('Ersteinrichtung')}</h2>
        <p className="text-sm text-slate-600">{t('Diese Instanz hat noch keinen Zugang. Legen Sie den ersten')} <strong>{t('Administrator')}</strong> {t('an. Weitere Benutzer legt er danach unter „Benutzer“ an.')}</p>
      </div>
      {neu && blattSchritt ? (
        <div className="space-y-4" data-ersteinrichtung-blatt>
          <h3 className="font-semibold">{t('Schlüsselblatt der Verschlüsselung')}</h3>
          <p className="text-sm text-slate-700">
            {t('Kunden, Objekte, Fotos, Unterschriften und Protokolle dieser Instanz werden verschlüsselt. Der Schlüssel ist gerade in diesem Browser entstanden und steht nur auf dem')}
            {' '}<strong>{t('Schlüsselblatt')}</strong>. {t('Bitte jetzt ausdrucken.')}
          </p>
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-900" data-blatt-hinweis>{BLATT_HINWEIS}</p>
          <p className="text-xs text-slate-600">{t('Schlüssel-ID:')} <span className="font-mono">{neu.blatt.schluesselId}</span></p>
          <button type="button" className="btn-primaer w-full" onClick={() => void pdf()}>{t('Schlüsselblatt als PDF herunterladen')}</button>
          <label className="flex items-start gap-2 font-normal">
            <input type="checkbox" className="mt-0.5" checked={aufbewahrt} onChange={(e) => setAufbewahrt(e.target.checked)} />
            <span>{t('Ich habe das Schlüsselblatt ausgedruckt und verwahre es an einem sicheren Ort.')}</span>
          </label>
          {fehler && <p className="text-sm text-red-700" role="alert">{fehler}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn-sekundaer" disabled={laeuft} onClick={() => { setBlattSchritt(false); setFehler('') }}>{t('Zurück')}</button>
            <button type="button" className="btn-primaer flex-1" disabled={laeuft || !aufbewahrt} onClick={() => void absenden(neu)}>
              {laeuft ? t('Wird angelegt …') : t('Administrator anlegen')}
            </button>
          </div>
        </div>
      ) : (
      <form onSubmit={weiter} className="space-y-4">
        {!EINRICHTUNGSSCHLUESSEL && <div>
          <label htmlFor="e-schluessel">{t('Einrichtungsschlüssel')}</label>
          <input id="e-schluessel" required autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
            className="font-mono" value={schluessel} onChange={(e) => setSchluessel(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">{EINRICHTUNG_HINWEIS ? tMeldung(EINRICHTUNG_HINWEIS) : t('Steht in den Zugangsdaten, die Sie bei der Einrichtung der App erhalten haben.')}</p>
        </div>}
        <div>
          <label htmlFor="e-name">{t('Name')}</label>
          <input id="e-name" autoComplete="name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="e-email">{t('E-Mail (Anmeldename)')}</label>
          <input id="e-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label htmlFor="e-passwort">{t('Passwort')}</label>
          <input id="e-passwort" type="password" autoComplete="new-password" required minLength={10} value={passwort} onChange={(e) => setPasswort(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">{t('Mindestens {n} Zeichen.', { n: 10 })}</p>
        </div>
        <div>
          <label htmlFor="e-wiederholung">{t('Passwort wiederholen')}</label>
          <input id="e-wiederholung" type="password" autoComplete="new-password" required minLength={10} value={wiederholung} onChange={(e) => setWiederholung(e.target.value)} />
        </div>
        <label className="flex items-start gap-2 font-normal">
          <input type="checkbox" className="mt-0.5" checked={zweiFaktor} onChange={(e) => setZweiFaktor(e.target.checked)} />
          <span>{t('Zwei-Faktor-Anmeldung jetzt einrichten (empfohlen) – mit einer Authenticator-App, direkt nach dem Anlegen')}</span>
        </label>
        {fehler && <p className="text-sm text-red-700" role="alert">{fehler}</p>}
        {neu && !ausBackup && <p className="text-xs text-slate-600" data-blatt-bleibt>{t('Der Schlüssel (Schlüssel-ID {id}) bleibt derselbe – ein schon gedrucktes Schlüsselblatt gilt weiter.', { id: neu.blatt.schluesselId })}</p>}
        <label className="flex items-start gap-2 font-normal" data-aus-backup>
          <input type="checkbox" className="mt-0.5" checked={ausBackup} onChange={(e) => setAusBackup(e.target.checked)} />
          <span>{t('Diese Instanz wird aus einem Backup wiederhergestellt: kein neues Schlüsselblatt, es gilt das der ursprünglichen Instanz (Datensicherung)')}</span>
        </label>
        <button className="btn-primaer w-full" disabled={laeuft}>{ausBackup ? (laeuft ? t('Wird angelegt …') : t('Administrator anlegen')) : t('Weiter zum Schlüsselblatt')}</button>
      </form>
      )}
    </div>
  )
}
