import { Badge } from '../../components/ui'
import { maengelText, type MaengelStand } from '../../lib/maengel'

/** Kennzeichen „2 offene Mängel“ an Anlagen und Türen in den Prüflisten (rot ab Stufe 3). */
export function MaengelBadge({ stand }: { stand?: MaengelStand }) {
  if (!stand) return null
  return <span data-maengel={stand.anzahl}><Badge farbe={stand.stufe >= 3 ? 'rot' : 'gelb'}>⚠ {maengelText(stand)}</Badge></span>
}
