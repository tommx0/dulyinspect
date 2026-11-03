import { Link } from 'react-router'
import { fremdesEtikettText } from '../lib/mandantencode'
import { t } from '../lib/sprache'
import { Seite } from './ui'

/** Einstieg über einen QR-Code mit dem Mandantencode einer anderen Instanz: nichts suchen, nur erklären. */
export function FremdesEtikett({ code, titel }: { code: string; titel: string }) {
  return (
    <Seite titel={titel} zurueck={{ zu: '/', text: t('Start') }}>
      <div className="karte space-y-2 p-4">
        <p role="alert">{fremdesEtikettText(code)}</p>
        <p className="text-sm text-slate-600">
          {t('Gleiche Etikett-Nummern kann es in mehreren Instanzen geben. Bitte das Etikett mit der App der Firma öffnen, die es angebracht hat.')}
        </p>
        <Link to="/" className="btn-sekundaer">{t('Zur Startseite')}</Link>
      </div>
    </Seite>
  )
}
