// Präsentations-/Vorschauversion (Agentur-Vorschau): Wasserzeichen, Hinweis nach der Anmeldung, Fußzeile.
// Für den Echtbetrieb bei einem Kunden abschalten mit der Build-Variable VITE_VORSCHAU=nein.
import { t } from './sprache'
export const VORSCHAU = import.meta.env.VITE_VORSCHAU !== 'nein'

export const VORSCHAU_FUSSZEILE = t('Präsentationsversion für Vorschau und Werbung – keine kommerzielle Nutzung')

const SCHLUESSEL = 'tuerpruefung:vorschau-bestaetigt'

/** Benutzer, der den Hinweis seit seiner Anmeldung auf diesem Gerät bestätigt hat. */
export function vorschauBestaetigtFuer(): string | null {
  try { return localStorage.getItem(SCHLUESSEL) } catch { return null }
}

export function vorschauMerken(userId: string | null) {
  try {
    if (userId) localStorage.setItem(SCHLUESSEL, userId)
    else localStorage.removeItem(SCHLUESSEL)
  } catch { /* Speicher gesperrt: Hinweis kommt beim nächsten Start erneut */ }
}
