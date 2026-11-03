import type { ReactNode } from 'react'
import { useAusgeblendet, type Bereich } from '../lib/menue'
import { t } from '../lib/sprache'

/** Bereich, den Admin/Planer für Prüfer ausgeblendet haben, ist auch über die Adresse gesperrt. */
export function NurSichtbar({ bereich, children }: { bereich: Bereich; children: ReactNode }) {
  const ausgeblendet = useAusgeblendet()
  if (ausgeblendet.includes(bereich)) return <p className="p-6 text-slate-600">{t('Dieser Bereich ist für Prüfer nicht freigegeben.')}</p>
  return <>{children}</>
}
