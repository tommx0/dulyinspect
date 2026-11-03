import { ARTEN } from '../lib/anlagenarten'
import { beispieleImportieren } from '../lib/beispielImport'
import { aktiveArten, nurTueren } from '../lib/begriffe'
import { t } from '../lib/sprache'
import { bestaetigen } from './Bestaetigung'

/** Hinweis nach dem Import: Checklisten kommen als Entwurf */
export const IMPORT_NACHSATZ = t('Importierte Checklisten sind Entwürfe: Prüfpunkte, Grenzwerte und Mangelstufen fachlich prüfen, bei Bedarf anpassen und erst dann freigeben.')

/**
 * Beispiel-Checklisten nach Rückfrage importieren (Checklisten, Inbetriebnahme). Der Admin bestätigt selbst, dass die Beispiele
 * nur Muster sind. Abgebrochen → null, sonst die Meldung des Imports.
 */
export async function beispieleNachRueckfrage(): Promise<string | null> {
  const frage = nurTueren()
    ? t('Die Beispiel-Checklisten (Fluchttüren, automatische Türen, Feststellanlagen) und passende Türtypen als Entwurf importieren? Vorhandene mit gleichem Namen werden übersprungen.')
    : t('Die Beispiel-Checklisten und passende Typen für {arten} als Entwurf importieren? Vorhandene mit gleichem Namen werden übersprungen.',
      { arten: aktiveArten().map((a) => ARTEN[a].name).join(', ') })
  if (!await bestaetigen(`${frage}\n\n`
    + t('Hinweis: Die Beispiel-Checklisten sind nur Muster. Sie zeigen, wie Checklisten aufgebaut sind und funktionieren. Sie sind keine rechts- oder normkonformen Prüfprotokolle.')
    + '\n\n'
    + t('Checklisten darf nur eine sachkundige bzw. befähigte Person erstellen und freigeben. Die Verantwortung für Inhalt und Richtigkeit tragen die Person, die eine Checkliste erstellt, und die Person, die sie freigibt.'),
  { ok: t('Verstanden, importieren') })) return null
  return beispieleImportieren()
}
