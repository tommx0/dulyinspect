import { useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth'
import { t } from '../lib/sprache'
import { useVerschluesselung } from '../lib/verschluesselung'

const WEGGEKLICKT = 'tuerpruefung:verschluesselung-hinweis-weg'

/**
 * Startseite für Admins: Hinweis, solange die Instanz noch nicht verschlüsselt ist (docs/KONZEPT-VERSCHLUESSELUNG.md, „Pflicht“).
 * Weggeklickt bleibt er auf diesem Gerät aus (localStorage).
 * (Der Hinweis mit Stichtag steht in Verschluesselungssperre.tsx und erscheint erst, wenn ein Stichtag festgelegt ist.)
 */
export function VerschluesselungEinrichten() {
  const { istSystemadmin } = useAuth()
  const z = useVerschluesselung()
  const [weg, setWeg] = useState(() => { try { return localStorage.getItem(WEGGEKLICKT) === '1' } catch { return false } })
  if (!istSystemadmin || z.art !== 'aus' || weg) return null
  const wegklicken = () => {
    setWeg(true)
    try { localStorage.setItem(WEGGEKLICKT, '1') } catch { /* Speicher gesperrt: gilt bis zum Neuladen */ }
  }
  return (
    <section role="status" className="space-y-1 rounded-md border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900" data-verschluesselung-einrichten>
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-semibold">{t('Verschlüsselung einrichten')}</h2>
        <button type="button" onClick={wegklicken} className="-mt-1 text-2xl leading-none text-sky-700 hover:text-sky-950" aria-label={t('Hinweis ausblenden')}>×</button>
      </div>
      <p>
        {t('Kunden, Objekte, Fotos, Unterschriften und Protokolle liegen noch unverschlüsselt auf dem Server. Mit der Verschlüsselung sieht der Hoster nicht mehr, für wen und wo geprüft wird.')}
      </p>
      <Link className="link" to="/einstellungen/verschluesselung">{t('Zur Verschlüsselung')}</Link>
    </section>
  )
}
