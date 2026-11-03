import { useState } from 'react'
import { Link } from 'react-router'
import { ArtSymbol, EtikettText, Weiter } from '../../components/Symbole'
import { Badge } from '../../components/ui'
import { BEREICHE, startBereich, VORAUS_TAGE, ZURUECK_TAGE, type Bereich, type Eintrag } from '../../lib/arbeitsliste'
import { tb } from '../../lib/begriffe'
import { t } from '../../lib/sprache'
import { tueranlageName } from '../../lib/tueranlage'

const ERKLAERUNG: Record<Bereich, string> = {
  laufend: t('Laufende Prüfungen, auch von Kollegen. Antippen setzt fort bzw. zeigt den Stand.'),
  nachpruefen: t('Offene Mängel aus früheren Prüfungen. Antippen beginnt die Prüfung; darin je Mangel „behoben ✓“ oder „besteht weiter“.'),
  anstehend: tb('Noch nie geprüft, überfällig oder in den nächsten {tage} Tagen fällig. Antippen öffnet das Objekt mit der markierten Tür.', { tage: VORAUS_TAGE }),
  geprueft: tb('Ergebnisse der letzten {tage} Tage, je Tür die letzte Prüfung. Antippen öffnet das Protokoll.', { tage: ZURUECK_TAGE }),
}

/** Arbeitsliste unter Prüfen: Filter mit Anzahl, darunter die Türen bzw. Anlagen über alle Objekte. */
export function Arbeitsliste({ liste, objekte, offline }: {
  liste: Record<Bereich, Eintrag[]>
  objekte: Map<string, { name: string; kunde: string }>
  offline: boolean
}) {
  const [wahl, setWahl] = useState<Bereich | null>(null)
  const bereich = wahl ?? startBereich(liste)
  const eintraege = liste[bereich]
  return (
    <section className="space-y-2" data-arbeitsliste>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('Arbeitsliste')}>
        {BEREICHE.map((b) => (
          <button key={b.schluessel} type="button" aria-pressed={bereich === b.schluessel} onClick={() => setWahl(b.schluessel)}
            data-bereich={b.schluessel}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium ${bereich === b.schluessel ? 'border-marke bg-marke text-white'
              : b.schluessel === 'nachpruefen' && liste.nachpruefen.length ? 'border-red-300 bg-red-50 text-red-800' : 'border-slate-300 bg-white text-slate-700'}`}>
            {b.text} ({liste[b.schluessel].length})
          </button>
        ))}
      </div>
      <p className="text-sm text-slate-600">{ERKLAERUNG[bereich]}{offline ? ` ${t('Offline: nur Objekte auf diesem Gerät.')}` : ''}</p>
      {eintraege.length === 0 ? <p className="text-sm text-slate-500">{t('Keine.')}</p> : (
        <ul className="karte divide-y divide-slate-100" aria-label={BEREICHE.find((b) => b.schluessel === bereich)!.text}>
          {eintraege.slice(0, 200).map((e) => {
            const o = objekte.get(e.objekt_id)
            return (
              <li key={e.schluessel}>
                <Link to={e.zu} className="zeile group" data-eintrag={e.etikett ?? e.schluessel}>
                  <ArtSymbol art={e.art} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">{e.tueranlage ? tueranlageName(o?.name) : <><EtikettText id={e.etikett} art={e.art} /> {e.titel}</>}
                        {e.tuer && <span className="text-sm font-normal text-slate-500"> · {tb('Tür')}</span>}</span>
                      <Badge farbe={e.badge.farbe}>{e.badge.text}</Badge>
                    </div>
                    <div className="text-sm text-slate-500">{o?.name ?? t('Objekt')}{o?.kunde ? ` · ${o.kunde}` : ''}</div>
                    {e.hinweis && <div className={`text-sm ${e.hinweis.farbe === 'rot' ? 'text-red-800' : 'text-slate-600'}`}>{e.hinweis.text}</div>}
                  </div>
                  <Weiter />
                </Link>
              </li>
            )
          })}
          {eintraege.length > 200 && <li className="px-4 py-2 text-sm text-slate-500">{t('+ {n} weitere – über „Objekt wählen“ eingrenzen', { n: eintraege.length - 200 })}</li>}
        </ul>
      )}
    </section>
  )
}
