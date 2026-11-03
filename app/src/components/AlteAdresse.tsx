import { Navigate, useParams } from 'react-router'

/** Adresse aus Version 1 (#/tuer/FT-00815, Lesezeichen) auf die neue Adresse umleiten. */
export function AlteAdresse() {
  const { etikett } = useParams()
  return <Navigate to={`/anlage/${encodeURIComponent(etikett ?? '')}`} replace />
}

/** Prüfung aus der Zeit der Sessions (#/pruefen/<Session>/p/<Prüfung>) auf die Adresse der Prüfung umleiten. */
export function AltePruefung() {
  const { pid } = useParams()
  return <Navigate to={`/pruefen/p/${encodeURIComponent(pid ?? '')}`} replace />
}
