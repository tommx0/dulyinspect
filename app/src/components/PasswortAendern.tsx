import { useEffect, useState, type FormEvent } from 'react'
import { loggen } from '../lib/log'
import { t } from '../lib/sprache'
import { fehlertext, supabase } from '../lib/supabase'
import { Logo } from './Logo'
import { ZweiFaktor } from './ZweiFaktor'

const MIN_PASSWORT = 10

/**
 * Vor der App ein eigenes Passwort festlegen.
 * art „vorgabe“: Das Passwort hat jemand anderes vergeben (Ersteinrichtung, Admin).
 * art „vergessen“: Angemeldet über den Link aus der Mail (Edge Function passwort-vergessen). Ein eingerichteter zweiter Faktor
 * wird vorher abgefragt (die Auth-API ändert das Passwort sonst nicht), danach enden die Anmeldungen auf anderen Geräten.
 */
export function PasswortAendern({ onFertig, onAbmelden, art = 'vorgabe' }: { onFertig: () => void; onAbmelden: () => void; art?: 'vorgabe' | 'vergessen' }) {
  const vergessen = art === 'vergessen'
  // Zweiter Faktor eingerichtet, aber noch nicht bestätigt (nur bei „vergessen“; ohne Pflicht fragt die App ihn sonst nicht ab)
  const [codeNoetig, setCodeNoetig] = useState<boolean | null>(vergessen ? null : false)
  const [runde, setRunde] = useState(0)
  useEffect(() => {
    if (!vergessen) return
    let aktiv = true
    void supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) => {
      if (aktiv) setCodeNoetig(data?.nextLevel === 'aal2' && data.currentLevel !== 'aal2')
    })
    return () => { aktiv = false }
  }, [vergessen, runde])
  const [neu, setNeu] = useState('')
  const [wiederholung, setWiederholung] = useState('')
  const [fehler, setFehler] = useState('')
  const [laeuft, setLaeuft] = useState(false)

  const speichern = async (e: FormEvent) => {
    e.preventDefault()
    if (neu.length < MIN_PASSWORT) return setFehler(t('Das Passwort braucht mindestens {n} Zeichen.', { n: MIN_PASSWORT }))
    if (neu !== wiederholung) return setFehler(t('Die beiden Eingaben stimmen nicht überein.'))
    setLaeuft(true)
    setFehler('')
    const { error } = await supabase.auth.updateUser({ password: neu })
    if (error) {
      setLaeuft(false)
      if (error.code === 'same_password') return setFehler(vergessen ? t('Bitte ein anderes als das bisherige Passwort wählen.') : t('Bitte ein anderes Passwort als das vorgegebene wählen.'))
      return setFehler(fehlertext(error))
    }
    // Räumt die Vorgabe ab; bleibt sie bestehen, hat der Wechsel nicht gegriffen
    const { data, error: e2 } = await supabase.rpc('passwort_aendern_noetig')
    setLaeuft(false)
    if (e2) return setFehler(fehlertext(e2))
    if (data) return setFehler(t('Das Passwort wurde nicht übernommen. Bitte erneut versuchen.'))
    if (vergessen) {
      // Wer den Link missbraucht hat, fliegt überall raus; Hinweismail und Logdatei über die Function
      await supabase.auth.signOut({ scope: 'others' }).catch(() => undefined)
      await supabase.functions.invoke('passwort-vergessen', { body: { aktion: 'geaendert' } }).catch(() => undefined)
    } else void loggen('Passwort geändert', 'Vorgegebenes Passwort durch ein eigenes ersetzt')
    onFertig()
  }

  if (codeNoetig === null) return <div className="flex min-h-dvh items-center justify-center p-4 text-slate-500">{t('Laden …')}</div>
  if (codeNoetig) return <ZweiFaktor stand="code" onFertig={() => setRunde((n) => n + 1)} onAbmelden={onAbmelden} />

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={speichern} className="karte w-full max-w-sm space-y-4 p-6" data-passwort-aendern>
        <h1><Logo className="mx-auto max-h-20 w-full max-w-60 object-contain" /></h1>
        <h2 className="text-center text-lg font-semibold">{vergessen ? t('Neues Passwort festlegen') : t('Eigenes Passwort festlegen')}</h2>
        <p className="text-sm text-slate-700">
          {vergessen
            ? t('Sie haben sich über den Link aus der Mail angemeldet. Bitte legen Sie jetzt ein neues Passwort fest; Anmeldungen auf anderen Geräten werden dabei beendet.')
            : t('Ihr Passwort wurde Ihnen vorgegeben. Bitte legen Sie vor dem ersten Arbeiten ein eigenes fest, das nur Sie kennen.')}
        </p>
        <div>
          <label htmlFor="pw-neu">{t('Neues Passwort')}</label>
          <input id="pw-neu" type="password" autoComplete="new-password" minLength={MIN_PASSWORT} required autoFocus
            value={neu} onChange={(e) => setNeu(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">{t('Mindestens {n} Zeichen.', { n: MIN_PASSWORT })}</p>
        </div>
        <div>
          <label htmlFor="pw-wiederholung">{t('Neues Passwort wiederholen')}</label>
          <input id="pw-wiederholung" type="password" autoComplete="new-password" minLength={MIN_PASSWORT} required
            value={wiederholung} onChange={(e) => setWiederholung(e.target.value)} />
        </div>
        {fehler && <p className="text-sm text-red-700">{fehler}</p>}
        <button className="btn-primaer w-full" disabled={laeuft}>{laeuft ? t('Speichern …') : t('Passwort speichern')}</button>
        <button type="button" className="btn-sekundaer w-full" onClick={onAbmelden}>{t('Abmelden')}</button>
      </form>
    </div>
  )
}
