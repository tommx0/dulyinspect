import { AUSTAUSCH_VORLAUF_MONATE, type AustauschZaehler } from '../lib/austausch'
import { t } from '../lib/sprache'
import { Badge } from './ui'

/** Hinweis in Listen: Melder einer Anlage mit erreichtem oder bald erreichtem Austauschdatum. */
export function AustauschBadges({ z }: { z: AustauschZaehler | undefined }) {
  if (!z || (z.abgelaufen === 0 && z.bald === 0)) return null
  return (
    <>
      {z.abgelaufen > 0 && <Badge farbe="rot">{t('{n} Melder: Austausch überfällig', { n: z.abgelaufen })}</Badge>}
      {z.bald > 0 && <Badge farbe="gelb">{t('{n} Melder: Austausch in {monate} Monaten', { n: z.bald, monate: AUSTAUSCH_VORLAUF_MONATE })}</Badge>}
    </>
  )
}
