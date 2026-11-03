import { Link, Navigate, useParams, useSearchParams } from 'react-router'
import { FremdesEtikett } from '../components/FremdesEtikett'
import { Fehler, Laden, Seite } from '../components/ui'
import { etikettTippfehler, normalisiereEtikett } from '../lib/etikett'
import { fremderMandantencode } from '../lib/mandantencode'
import { supabase } from '../lib/supabase'
import { useAbfrage } from '../lib/useAbfrage'
import { tb } from '../lib/begriffe'
import { t } from '../lib/sprache'

/** Einstieg über QR-Code (?t=PK-0000427&k=K7Q3X) oder manuelle Eingabe: Tür zum Etikett finden. */
export default function AnlageSuche() {
  const { etikett = '' } = useParams()
  const fremd = fremderMandantencode(useSearchParams()[0].get('k'))
  const id = normalisiereEtikett(etikett)
  return fremd ? <FremdesEtikett code={fremd} titel={t('Etikett {id}', { id })} /> : <EtikettSuchen id={id} />
}

function EtikettSuchen({ id }: { id: string }) {
  const { daten, fehler, laedt } = useAbfrage(
    () => supabase.from('etikett').select('id, anlage:anlage!etikett_anlage_fk(id, objekt_id)').eq('id', id).maybeSingle(), [id])

  if (laedt) return <Laden />
  if (daten?.anlage) return <Navigate to={`/objekte/${daten.anlage.objekt_id}?anlage=${daten.anlage.id}&quelle=scan`} replace />

  return (
    <Seite titel={t('Etikett {id}', { id })} zurueck={{ zu: '/', text: t('Start') }}>
      <Fehler text={fehler} />
      <div className="karte space-y-2 p-4">
        {daten ? (
          <>
            <p>{t('Dieses Etikett ist')} <strong>{tb('noch keiner Tür zugeordnet')}</strong>.</p>
            <p className="text-sm text-slate-600">
              {tb('Öffnen Sie das Objekt, legen Sie die Tür an und tragen Sie')} <span className="font-mono">{id}</span> {t('als Etikett-ID ein.')}
              {' '}{t('In Phase 2 geht das direkt beim Scannen vor Ort.')}
            </p>
          </>
        ) : (
          <p>{etikettTippfehler(id) ?? <>{t('Ein Etikett')} <span className="font-mono">{id}</span> {t('ist im System nicht bekannt. Bitte ID prüfen.')}</>}</p>
        )}
        <Link to="/kunden" className="btn-sekundaer">{t('Zu den Kunden')}</Link>
      </div>
    </Seite>
  )
}
