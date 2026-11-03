// Texte und Farben des Prüfergebnisses (Ampel) für die Prüfseiten
import type { Ampel } from '../../lib/pruefung'
import { t } from '../../lib/sprache'

export const AMPEL_TEXT: Record<Ampel, string> = {
  gruen: t('ohne Mängel'), gelb: t('mit Mängeln, betriebsbereit'), rot: t('nicht betriebssicher'),
}
export const AMPEL_FARBE: Record<Ampel, 'gruen' | 'gelb' | 'rot'> = { gruen: 'gruen', gelb: 'gelb', rot: 'rot' }
