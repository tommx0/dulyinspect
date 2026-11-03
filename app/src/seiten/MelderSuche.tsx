import { Link, Navigate, useParams, useSearchParams } from 'react-router'
import { FremdesEtikett } from '../components/FremdesEtikett'
import { Fehler, Laden, Seite } from '../components/ui'
import { herstellercodeNormalisieren } from '../lib/herstellercode'
import { fremderMandantencode } from '../lib/mandantencode'
import { codeAnzeige, istMelderCodeForm, melderCodeLesen } from '../lib/melderCode'
import { supabase } from '../lib/supabase'
import { useAbfrage } from '../lib/useAbfrage'
import { t } from '../lib/sprache'

/** Einstieg über den QR-Code eines Melder-Etiketts (?m=M4F7K2QXD3&k=K7Q3X): zur Anlage des Melders springen. */
export default function MelderSuche() {
  const { code: roh = '' } = useParams()
  const fremd = fremderMandantencode(useSearchParams()[0].get('k'))
  return fremd ? <FremdesEtikett code={fremd} titel={t('Melder {code}', { code: codeAnzeige(roh) })} /> : <MelderSuchen roh={roh} />
}

function MelderSuchen({ roh }: { roh: string }) {
  const code = melderCodeLesen(roh) ?? herstellercodeNormalisieren(roh)
  const { daten, fehler, laedt } = useAbfrage(
    () => supabase.from('anlage_element').select('id, nummer, anlage:anlage(id, objekt_id)').eq('code', code).eq('aktiv', true).maybeSingle(), [code])

  if (laedt) return <Laden />
  if (daten?.anlage) return <Navigate to={`/objekte/${daten.anlage.objekt_id}?anlage=${daten.anlage.id}&quelle=scan`} replace />

  return (
    <Seite titel={t('Melder {code}', { code: codeAnzeige(code) })} zurueck={{ zu: '/', text: t('Start') }}>
      <Fehler text={fehler} />
      <div className="karte space-y-2 p-4">
        {istMelderCodeForm(roh) && !melderCodeLesen(roh)
          ? <p>{t('Das Prüfzeichen von')} <span className="font-mono">{roh}</span> {t('passt nicht – vermutlich ein Tippfehler. Bitte den Code auf dem Etikett prüfen.')}</p>
          : (
            <>
              <p>{t('Dieser Code ist')} <strong>{t('noch keinem Melder zugeordnet')}</strong>.</p>
              <p className="text-sm text-slate-600">
                {t('Öffnen Sie die Prüfung der Wohnung bzw. Anlage und scannen Sie den Code dort mit „Melder scannen“. Dann können Sie ihn einem Melder zuweisen oder einen neuen Melder anlegen.')}
              </p>
            </>
          )}
        <Link to="/pruefen" className="btn-sekundaer">{t('Zu den Prüfungen')}</Link>
      </div>
    </Seite>
  )
}
