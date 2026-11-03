import type { ReactNode } from 'react'
import { istNichtLesbar } from '../lib/verschluesselung'
import { t } from '../lib/sprache'

/**
 * Anzeige eines entschlüsselten Werts (Name, Adresse …). Was sich nicht entschlüsseln ließ („⚠ nicht lesbar“), erscheint
 * hervorgehoben – damit fällt auf, wenn der Schlüssel nicht zu den Daten passt (docs/KONZEPT-VERSCHLUESSELUNG.md, Bedingung 4).
 */
export function Lesbar({ children }: { children?: ReactNode }) {
  return istNichtLesbar(children)
    ? <span className="italic text-red-700" title={t('Nicht lesbar: falscher Schlüssel oder beschädigte Daten')}>{children}</span>
    : <>{children}</>
}
