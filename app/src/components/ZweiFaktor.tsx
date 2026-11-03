import QRCode from 'qrcode'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { loggen } from '../lib/log'
import { t } from '../lib/sprache'
import { fehlertext, supabase } from '../lib/supabase'
import type { ZweiFaktorStand } from '../lib/zweiFaktor'
import { Logo } from './Logo'

/** Vor der App: Authenticator-App einrichten oder den Code daraus eingeben. */
export function ZweiFaktor({ stand, onFertig, onAbmelden }: {
  stand: Exclude<ZweiFaktorStand, 'ok'>
  onFertig: () => void
  onAbmelden: () => void
}) {
  const [faktorId, setFaktorId] = useState('')
  const [qr, setQr] = useState('')
  const [geheimnis, setGeheimnis] = useState('')
  const [code, setCode] = useState('')
  const [fehler, setFehler] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  const gestartet = useRef(false)

  useEffect(() => {
    if (gestartet.current) return
    gestartet.current = true
    void (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors()
      if (error) return setFehler(fehlertext(error))
      if (stand === 'code') {
        const f = data.totp[0]
        return f ? setFaktorId(f.id) : setFehler(t('Keine Authenticator-App eingerichtet. Bitte an den Administrator wenden.'))
      }
      // Abgebrochene Einrichtungen entfernen, sonst lehnt Supabase eine neue ab
      for (const f of data.all.filter((x) => x.factor_type === 'totp' && x.status === 'unverified')) {
        await supabase.auth.mfa.unenroll({ factorId: f.id })
      }
      const neu = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator-App' })
      if (neu.error) return setFehler(fehlertext(neu.error))
      setFaktorId(neu.data.id)
      setGeheimnis(neu.data.totp.secret)
      setQr(await QRCode.toDataURL(neu.data.totp.uri, { margin: 1, width: 220 }))
    })()
  }, [stand])

  const pruefen = async (e: FormEvent) => {
    e.preventDefault()
    setLaeuft(true)
    setFehler('')
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: faktorId, code: code.replace(/\s/g, '') })
    setLaeuft(false)
    if (error) {
      setCode('')
      return setFehler(/invalid|expired/i.test(error.message) ? t('Der Code stimmt nicht oder ist abgelaufen. Bitte den aktuellen Code eingeben.') : fehlertext(error))
    }
    void loggen(stand === 'einrichten' ? 'Zwei-Faktor-Anmeldung eingerichtet' : 'Zweiter Faktor bestätigt')
    onFertig()
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={pruefen} className="karte w-full max-w-sm space-y-4 p-6" data-zwei-faktor={stand}>
        <h1><Logo className="mx-auto max-h-20 w-full max-w-60 object-contain" /></h1>
        <h2 className="text-center text-lg font-semibold">{t('Zwei-Faktor-Anmeldung')}</h2>
        {stand === 'einrichten' ? (
          <div className="space-y-3 text-sm text-slate-700">
            <p>{t('Ihr Zugang ist zusätzlich mit einer Authenticator-App geschützt (z. B. Google Authenticator, Microsoft Authenticator, 1Password).')}</p>
            <p>{t('1. QR-Code mit der App scannen:')}</p>
            {qr ? <img src={qr} alt={t('QR-Code für die Authenticator-App')} className="mx-auto size-56" /> : <p className="text-center text-slate-500">{t('QR-Code wird erstellt …')}</p>}
            {geheimnis && (
              <p className="text-xs text-slate-500">{t('Ohne Kamera diesen Schlüssel in der App eintragen:')}{' '}
                <code className="break-all font-mono text-slate-800" data-geheimnis>{geheimnis}</code></p>
            )}
            <p>{t('2. Den sechsstelligen Code aus der App eingeben:')}</p>
          </div>
        ) : (
          <p className="text-sm text-slate-700">{t('Bitte den sechsstelligen Code aus Ihrer Authenticator-App eingeben.')}</p>
        )}
        <div>
          <label htmlFor="zf-code">{t('Code')}</label>
          <input id="zf-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus
            value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        {fehler && <p className="text-sm text-red-700" role="alert">{fehler}</p>}
        <button className="btn-primaer w-full" disabled={laeuft || !faktorId}>{laeuft ? t('Prüfen …') : t('Bestätigen')}</button>
        <div className="flex justify-between gap-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
          <span>{t('Handy verloren? Der Administrator kann die Zwei-Faktor-Anmeldung zurücksetzen.')}</span>
          <button type="button" className="link shrink-0" onClick={onAbmelden}>{t('Abmelden')}</button>
        </div>
      </form>
    </div>
  )
}
