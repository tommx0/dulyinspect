import { lazy, Suspense, useCallback, useState } from 'react'
import { Fehler } from '../../components/ui'
import { tb } from '../../lib/begriffe'
import { t } from '../../lib/sprache'
import { fehlertext } from '../../lib/supabase'
import { etikettPruefen, etikettZuweisen } from '../../offline/aktionen'
import type { Anlage } from '../../offline/db'
import { satz } from './satz'

const QrScanner = lazy(() => import('../../components/QrScanner'))

const lage = (a: Anlage) => [[a.gebaeude, a.etage, a.raum].filter(Boolean).join(' / '), a.lage_beschreibung].filter(Boolean).join(' · ')

/**
 * Freies Etikett in der Prüfung gescannt: neue Tür damit erfassen oder einer vorhandenen Tür ohne Etikett zuweisen
 * (z. B. importierte Türen bei der ersten Prüfung).
 */
export function FreiesEtikett({ etikett, ohneEtikett, typen, onNeu, onZugewiesen }: {
  etikett: string
  ohneEtikett: Anlage[]
  typen: Map<string, string>
  onNeu: () => void
  onZugewiesen: (anlage: Anlage) => void
}) {
  const [filter, setFilter] = useState('')
  const [fehler, setFehler] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  const liste = ohneEtikett.filter((a) => `${a.kunden_bezeichnung ?? ''} ${lage(a)} ${typen.get(a.anlagentyp_id) ?? ''}`
    .toLowerCase().includes(filter.toLowerCase()))

  const zuweisen = async (a: Anlage) => {
    setFehler('')
    setLaeuft(true)
    try {
      const grund = await etikettPruefen(etikett)
      if (grund) return setFehler(grund)
      await etikettZuweisen(a.id, etikett)
      onZugewiesen({ ...a, etikett_id: etikett })
    } catch (e) {
      setFehler(fehlertext(e))
    } finally {
      setLaeuft(false)
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <p>{tb('Das Etikett gehört noch zu keiner Tür. Erfassen Sie eine neue Tür damit oder weisen Sie es einer vorhandenen Tür ohne Etikett zu.')}</p>
      <button className="btn-primaer w-full py-3" onClick={onNeu}>{tb('Neue Tür erfassen')}</button>
      <div className="space-y-2">
        <h3 className="font-semibold">{tb('Vorhandener Tür zuweisen')}</h3>
        {ohneEtikett.length > 5 && (
          <input type="search" placeholder={tb('Türen ohne Etikett filtern …')} value={filter} onChange={(e) => setFilter(e.target.value)}
            aria-label={tb('Türen ohne Etikett filtern')} className="mt-0" />
        )}
        <Fehler text={fehler} />
        <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200" data-ohne-etikett>
          {liste.map((a) => (
            <li key={a.id}>
              <button disabled={laeuft} onClick={() => void zuweisen(a)} className="block w-full px-3 py-2 text-left hover:bg-akzent-hell">
                <div className="font-medium">{a.kunden_bezeichnung || tb('Tür ohne Bezeichnung')}</div>
                <div className="text-slate-600">{lage(a)}</div>
                <div className="text-xs text-slate-500">{typen.get(a.anlagentyp_id)}</div>
              </button>
            </li>
          ))}
          {liste.length === 0 && <li className="px-3 py-2 text-slate-500">{t('Kein Treffer.')}</li>}
        </ul>
      </div>
    </div>
  )
}

/** Etikett für eine Tür ohne Etikett scannen (oder eintippen) und nach Rückfrage zuweisen. Geht auch offline. */
export function EtikettZuweisen({ anlage, onFertig }: { anlage: Anlage; onFertig: () => void }) {
  const [etikett, setEtikett] = useState<string | null>(null)
  const [fehler, setFehler] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  const [versuch, setVersuch] = useState(0)

  // stabil halten – der Scanner startet die Kamera bei jeder neuen Funktion neu
  const erkannt = useCallback(async (id: string) => {
    setFehler('')
    try {
      const grund = await etikettPruefen(id)
      if (grund) return setFehler(grund)
      setEtikett(id)
    } catch (e) {
      setFehler(fehlertext(e))
    }
  }, [])
  const nochmal = () => { setEtikett(null); setFehler(''); setVersuch((v) => v + 1) }
  const zuweisen = async () => {
    setLaeuft(true)
    try {
      await etikettZuweisen(anlage.id, etikett!)
      onFertig()
    } catch (e) {
      setFehler(fehlertext(e))
      setLaeuft(false)
    }
  }

  const name = [anlage.kunden_bezeichnung, lage(anlage)].filter(Boolean).join(' · ') || tb('diese Tür')
  if (etikett) {
    return (
      <div className="space-y-4 text-sm">
        <p>{satz(tb('Etikett {etikett} der Tür {name} zuweisen?'), { etikett: <strong className="font-mono">{etikett}</strong>, name: <strong>{name}</strong> })}</p>
        <Fehler text={fehler} />
        <div className="flex justify-end gap-2">
          <button className="btn-sekundaer" onClick={nochmal}>{t('Anderes Etikett')}</button>
          <button className="btn-primaer" disabled={laeuft} onClick={() => void zuweisen()}>{t('Zuweisen')}</button>
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">{tb('Freies Etikett an die Tür kleben und scannen.')}</p>
      {fehler ? (
        <>
          <Fehler text={fehler} />
          <button className="btn-sekundaer w-full" onClick={nochmal}>{t('Erneut scannen')}</button>
        </>
      ) : (
        <Suspense fallback={<p>{t('Kamera wird vorbereitet …')}</p>}>
          <QrScanner key={versuch} onErkannt={erkannt} eingabe />
        </Suspense>
      )}
    </div>
  )
}
