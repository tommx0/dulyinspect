import { tabelleHerunterladen, type Auswahl, type Wert } from '../lib/tabellenDatei'
import { t } from '../lib/sprache'

/**
 * Zwei Knöpfe „… Excel“ und „… CSV“: Export einer Liste oder leere Vorlage zum Ausfüllen und Einlesen.
 * `zeilen` wird erst beim Klick berechnet; erste Zeile = Überschriften.
 */
export function DateiKnoepfe({ art, name, zeilen, auswahl, blattName, disabled }: {
  art: 'export' | 'vorlage'
  name: string
  zeilen: () => Wert[][]
  auswahl?: () => Auswahl[]
  blattName?: string
  disabled?: boolean
}) {
    const laden = (format: 'xlsx' | 'csv') => tabelleHerunterladen(zeilen(), name, format, { blattName, auswahl: auswahl?.() })
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn-sekundaer" disabled={disabled} onClick={() => laden('xlsx')}>{art === 'export' ? t('Export Excel') : t('Vorlage Excel')}</button>
      <button type="button" className="btn-sekundaer" disabled={disabled} onClick={() => laden('csv')}>{art === 'export' ? t('Export CSV') : t('Vorlage CSV')}</button>
    </div>
  )
}
