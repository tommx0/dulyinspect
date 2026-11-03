// Entwickler der Software (nicht der Betreiber – der steht im Impressum der jeweiligen Instanz)
import { t } from './sprache'
export const ENTWICKLER = { name: 'Thomas Marx, MX-Smart-Tech', url: 'https://mx-smart-tech.de' }

/** „Entwickelt von …“ anzeigen; Build-Variable VITE_ENTWICKLER=nein lässt es weg (freie Fassung, Einzelinstanz-Image). */
export const ENTWICKLER_ZEIGEN = import.meta.env?.VITE_ENTWICKLER !== 'nein'

/**
 * Freie Fassung (Einzelinstanz-Image): VITE_LIZENZ_LINK = Adresse des Lizenztexts (LICENSE im Repository).
 * Dann gelten nicht die Lizenzbedingungen des Entwicklers: keine Bestätigung nach der Anmeldung, die Seite #/lizenzbedingungen
 * verweist auf den Link. VITE_LIZENZ_NAME benennt die Lizenz dort (z. B. „GNU AGPL-3.0“).
 */
export const LIZENZ_LINK: string = import.meta.env?.VITE_LIZENZ_LINK || ''
export const LIZENZ_NAME: string = import.meta.env?.VITE_LIZENZ_NAME || t('Lizenz')
