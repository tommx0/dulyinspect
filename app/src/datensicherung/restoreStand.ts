// Stand einer laufenden bzw. der letzten Wiederherstellung in dieser Sitzung – außerhalb der Seite gehalten: Richtet das
// Zurückspielen die Kennung der Verschlüsselung ein oder ersetzt sie, sperrt die App dieses Gerät (Schlüsselblatt scannen),
// und die Seite Datensicherung verschwindet. Der Sperrbildschirm zeigt Fortschritt und Bericht dann weiter an
// (src/components/Verschluesselungssperre.tsx). Bewusst klein: der Sperrbildschirm lädt so nicht die Datensicherung mit.
import { useSyncExternalStore } from 'react'
import type { RestoreBericht } from './sicherung'

export interface RestoreStand {
  laeuft: boolean
  fortschritt: string
  bericht: RestoreBericht | null
  fehler: string
}

const LEER: RestoreStand = { laeuft: false, fortschritt: '', bericht: null, fehler: '' }
let stand: RestoreStand = LEER
const hoerer = new Set<() => void>()

export function restoreStand(): RestoreStand {
  return stand
}

export function restoreStandSetzen(teil: Partial<RestoreStand> | null) {
  stand = teil ? { ...stand, ...teil } : LEER
  hoerer.forEach((h) => h())
}

export function useRestoreStand(): RestoreStand {
  return useSyncExternalStore((h) => { hoerer.add(h); return () => { hoerer.delete(h) } }, restoreStand)
}
