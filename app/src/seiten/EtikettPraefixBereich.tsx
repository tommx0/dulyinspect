import { useState } from 'react'
import { Fehler } from '../components/ui'
import { etikettAnzeige, PRAEFIX_MUSTER, pruefziffer } from '../lib/etikett'
import { fehlertext, supabase } from '../lib/supabase'
import { t } from '../lib/sprache'

/** Buchstaben, die man beim Abtippen leicht mit Ziffern verwechselt (O/0, I/1, S/5, B/8, Z/2). */
const VERWECHSELBAR = /[OISBZ]/

/** Präfix der Etiketten dieser Instanz (Admin, Einstellungen). Gilt nur für neu erzeugte Etiketten. */
export function EtikettPraefixBereich({ praefix: gespeichert, mandantencode, onGespeichert }: { praefix: string; mandantencode: string; onGespeichert: () => void }) {
  const [praefix, setPraefix] = useState(gespeichert)
  const [fehler, setFehler] = useState('')
  const [meldung, setMeldung] = useState('')
  const gueltig = PRAEFIX_MUSTER.test(praefix) && praefix !== 'FT'
  const beispiel = `${gueltig ? praefix : 'PK'}-000042${pruefziffer('000042')}`

  const speichern = async () => {
    setFehler(''); setMeldung('')
    const { error } = await supabase.from('firma').update({ etikett_praefix: praefix }).eq('id', 1)
    if (error) return setFehler(fehlertext(error))
    setMeldung(t('Gespeichert. Gilt für alle ab jetzt erzeugten Etiketten; vorhandene Etiketten behalten ihre ID.'))
    onGespeichert()
  }

  return (
    <section className="karte space-y-3 p-4">
      <h2 className="font-semibold">{t('Etiketten')}</h2>
      <p className="text-sm text-slate-600">
        {t('Etikett-IDs bestehen aus dem')} <strong>{t('Präfix')}</strong> {t('Ihrer Firma, 6 Ziffern und einer Prüfziffer, die Tippfehler bei der Eingabe von Hand erkennt.')}
        {' '}{t('Die Nummern laufen fortlaufend weiter, auch wenn Sie das Präfix ändern. Ältere Etiketten (FT-00001) bleiben gültig.')}
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <label className="w-40">
          {t('Präfix')}
          <input value={praefix} maxLength={3} autoCapitalize="characters" spellCheck={false} className="font-mono uppercase"
            onChange={(e) => setPraefix(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} />
        </label>
        <div className="pb-2 text-sm text-slate-600">{t('Beispiel:')} <span className="font-mono font-semibold text-marke">{etikettAnzeige(beispiel)}</span></div>
      </div>
      {!gueltig && <p className="text-sm text-red-700">{praefix === 'FT' ? t('FT ist den alten Etiketten vorbehalten.') : t('2 oder 3 Buchstaben (A–Z).')}</p>}
      {gueltig && VERWECHSELBAR.test(praefix) && (
        <p className="text-sm text-amber-800">{t('Hinweis: O, I, S, B und Z werden beim Abtippen leicht mit 0, 1, 5, 8 und 2 verwechselt.')}</p>
      )}
      <Fehler text={fehler} />
      {meldung && <p role="status" className="text-sm text-green-800">{meldung}</p>}
      <button className="btn-primaer" disabled={!gueltig || praefix === gespeichert} onClick={() => void speichern()}>{t('Speichern')}</button>
      <div className="border-t border-slate-200 pt-3">
        <h3 className="font-semibold">{t('Mandantencode')}</h3>
        <p className="mt-1 font-mono text-lg font-semibold text-marke">{mandantencode}</p>
        <p className="text-sm text-slate-600">
          {t('Zufällig für diese Instanz vergeben und nicht änderbar. Er steht in jedem neu gedruckten QR-Code und klein auf dem Etikett.')}
          {' '}{t('Etiketten mit dem Code einer anderen Instanz öffnet die App nicht – gleiche Nummern führen so nie zur falschen Anlage.')}
          {' '}{t('Ältere Etiketten ohne Code gelten weiter.')}
        </p>
      </div>
    </section>
  )
}
