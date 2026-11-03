import { ArrowRight, ClipboardCheck } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth'
import { AnlageFinden } from '../components/AnlageFinden'
import { VerschluesselungEinrichten } from '../components/VerschluesselungEinrichten'
import { AustauschBadges } from '../components/AustauschHinweis'
import { Dashboard } from '../components/Dashboard'
import { InbetriebnahmeHinweis } from '../components/InbetriebnahmeHinweis'
import { SachkundeHinweis } from '../components/SachkundeHinweis'
import { ArtSymbol, EtikettText, Weiter } from '../components/Symbole'
import { AnsichtWahl, Badge, datum, Fehler, Kacheln, Seite } from '../components/ui'
import { useAnsicht } from '../lib/ansicht'
import { useGrosserBildschirm } from '../lib/bildschirm'
import { supabase } from '../lib/supabase'
import { entschluesselt } from '../lib/entschluesselt'
import { useAbfrage } from '../lib/useAbfrage'
import { useAustausch } from '../lib/useAustausch'
import { useAusgeblendet } from '../lib/menue'
import { tb } from '../lib/begriffe'
import { t } from '../lib/sprache'

function Pruefen({ className }: { className: string }) {
  return (
    <Link to="/pruefen" className={`btn-primaer text-base ${className}`}>
      <ClipboardCheck className="size-5" strokeWidth={2} aria-hidden />{t('Prüfung starten / fortsetzen')}
    </Link>
  )
}

/** Am großen Bildschirm das Dashboard (Kennzahlen, Kalender, laufende Prüfungen, Statistik, Fristen), sonst Listen wie am Handy. */
export default function Start() {
  const { benutzer } = useAuth()
  const gross = useGrosserBildschirm()
  if (!gross) return <StartEinfach />
  return (
    <Seite titel={t('Hallo {name}', { name: benutzer?.name?.split(' ')[0] || '' }).trim()} breit aktionen={<Pruefen className="px-6 py-3" />}>
      <InbetriebnahmeHinweis />
      <AnlageFinden />
      <VerschluesselungEinrichten />
      <Dashboard />
    </Seite>
  )
}

function StartEinfach() {
  const { benutzer, istAdmin } = useAuth()
  const ausgeblendet = useAusgeblendet()
  const [ansicht, setAnsicht] = useAnsicht('start')

  const [{ heute, in30Tagen }] = useState(() => ({
    heute: new Date().toISOString().slice(0, 10),
    in30Tagen: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
  }))
  const austausch = useAustausch()
  const faellig = useAbfrage(() =>
    entschluesselt('anlage', supabase.from('anlage')
      .select('id, etikett_id, kunden_bezeichnung, gebaeude, etage, raum, naechste_pruefung_am, anlagentyp(name, anlagenart), objekt(id, name, endkunde(id, name))')
      .eq('status', 'aktiv')
      .lte('naechste_pruefung_am', in30Tagen)
      .order('naechste_pruefung_am')
      .limit(50)))

  return (
    <Seite titel={t('Hallo {name}', { name: benutzer?.name?.split(' ')[0] || '' }).trim()}>
      <InbetriebnahmeHinweis />
      <Pruefen className="w-full py-4" />
      <AnlageFinden />
      <VerschluesselungEinrichten />
      {istAdmin && <SachkundeHinweis />}

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-lg font-semibold">{t('Fällige Prüfungen (nächste 30 Tage)')}</h2>
          <div className="flex items-center gap-3">
            {!ausgeblendet.includes('faelligkeiten') && (
              <Link className="link inline-flex items-center gap-1 whitespace-nowrap text-sm" to="/faelligkeiten">{t('Alle Fälligkeiten')}<ArrowRight className="size-4" aria-hidden /></Link>
            )}
            <AnsichtWahl wert={ansicht} onWechsel={setAnsicht} />
          </div>
        </div>
        <Fehler text={faellig.fehler} />
        {faellig.daten?.length === 0 ? (
          <p className="text-sm text-slate-500">
            {tb('Keine fälligen Türen in den nächsten 30 Tagen. Türen, die noch nie geprüft wurden, zeigt die Fälligkeitsübersicht.')}
          </p>
        ) : ansicht === 'kacheln' ? (
          <Kacheln aria-label={t('Fällige Prüfungen')}>
            {faellig.daten?.map((a) => {
              const ueberfaellig = a.naechste_pruefung_am! < heute
              return (
                <li key={a.id}>
                  <Link to={`/objekte/${a.objekt?.id}?anlage=${a.id}`} className="kachel group" data-faellig={a.etikett_id ?? a.id}>
                    <div className="flex items-start gap-3">
                      <ArtSymbol art={a.anlagentyp?.anlagenart} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2"><EtikettText id={a.etikett_id} art={a.anlagentyp?.anlagenart} /><span>{a.kunden_bezeichnung}</span></div>
                        <div className="text-sm text-slate-500">{[a.objekt?.name, a.objekt?.endkunde?.name].filter(Boolean).join(' · ')}</div>
                      </div>
                    </div>
                    {[a.gebaeude, a.etage, a.raum].some(Boolean) && <div className="text-sm">{[a.gebaeude, a.etage, a.raum].filter(Boolean).join(' / ')}</div>}
                    <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                      <Badge farbe={ueberfaellig ? 'rot' : 'gelb'}>{ueberfaellig ? t('überfällig seit {datum}', { datum: datum(a.naechste_pruefung_am) }) : t('fällig {datum}', { datum: datum(a.naechste_pruefung_am) })}</Badge>
                      <Weiter />
                    </div>
                  </Link>
                </li>
              )
            })}
          </Kacheln>
        ) : (
          <ul className="karte divide-y divide-slate-100 overflow-hidden" aria-label={t('Fällige Prüfungen')}>
            {faellig.daten?.map((a) => {
              const ueberfaellig = a.naechste_pruefung_am! < heute
              const faellig = <Badge farbe={ueberfaellig ? 'rot' : 'gelb'}>{ueberfaellig ? t('überfällig seit {datum}', { datum: datum(a.naechste_pruefung_am) }) : t('fällig {datum}', { datum: datum(a.naechste_pruefung_am) })}</Badge>
              return (
                <li key={a.id}>
                  <Link to={`/objekte/${a.objekt?.id}?anlage=${a.id}`} className="zeile group" data-faellig={a.etikett_id ?? a.id}>
                    <ArtSymbol art={a.anlagentyp?.anlagenart} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <EtikettText id={a.etikett_id} art={a.anlagentyp?.anlagenart} />
                        <span className="sm:truncate">{a.kunden_bezeichnung}</span>
                      </div>
                      <div className="text-sm text-slate-500 sm:truncate">
                        {[a.objekt?.name, a.objekt?.endkunde?.name].filter(Boolean).join(' · ')}
                        {[a.gebaeude, a.etage, a.raum].some(Boolean) && <> · {[a.gebaeude, a.etage, a.raum].filter(Boolean).join(' / ')}</>}
                      </div>
                      {/* Handy: Datum unter dem Text, damit die Bezeichnung Platz hat */}
                      <div className="mt-1 sm:hidden">{faellig}</div>
                    </div>
                    <span className="hidden sm:block">{faellig}</span>
                    <Weiter />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {austausch.gruppen.length > 0 && (
        <section className="space-y-2" data-austausch>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-lg font-semibold">{t('Melder-Austausch')}</h2>
            {!ausgeblendet.includes('faelligkeiten') && (
              <Link className="link inline-flex items-center gap-1 whitespace-nowrap text-sm" to="/faelligkeiten">{t('Alle Fälligkeiten')}<ArrowRight className="size-4" aria-hidden /></Link>
            )}
          </div>
          {ansicht === 'kacheln' ? (
            <Kacheln aria-label={t('Melder-Austausch')}>
              {austausch.gruppen.slice(0, 5).map((g) => (
                <li key={g.anlage.id}>
                  <Link to={`/objekte/${g.anlage.objekt.id}?anlage=${g.anlage.id}`} className="kachel group">
                    <div className="flex items-start gap-3">
                      <ArtSymbol art="rauchwarnmelder" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">{g.anlage.etikett_id && <EtikettText id={g.anlage.etikett_id} />}<span>{g.anlage.kunden_bezeichnung}</span></div>
                        <div className="text-sm text-slate-500">{[g.anlage.objekt.name, g.anlage.objekt.endkunde?.name].filter(Boolean).join(' · ')}</div>
                      </div>
                    </div>
                    <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                      <div className="flex flex-wrap gap-1"><AustauschBadges z={g.zaehler} /></div>
                      <Weiter />
                    </div>
                  </Link>
                </li>
              ))}
            </Kacheln>
          ) : (
          <ul className="karte divide-y divide-slate-100 overflow-hidden" aria-label={t('Melder-Austausch')}>
            {austausch.gruppen.slice(0, 5).map((g) => (
              <li key={g.anlage.id}>
                <Link to={`/objekte/${g.anlage.objekt.id}?anlage=${g.anlage.id}`} className="zeile group">
                  <ArtSymbol art="rauchwarnmelder" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      {g.anlage.etikett_id && <EtikettText id={g.anlage.etikett_id} />}
                      <span className="sm:truncate">{g.anlage.kunden_bezeichnung}</span>
                    </div>
                    <div className="text-sm text-slate-500 sm:truncate">{[g.anlage.objekt.name, g.anlage.objekt.endkunde?.name].filter(Boolean).join(' · ')}</div>
                    <div className="mt-1 flex flex-wrap gap-1"><AustauschBadges z={g.zaehler} /></div>
                  </div>
                  <Weiter />
                </Link>
              </li>
            ))}
          </ul>
          )}
          {austausch.gruppen.length > 5 && <p className="text-sm text-slate-500">{t('und {n} weitere Anlagen', { n: austausch.gruppen.length - 5 })}</p>}
        </section>
      )}
    </Seite>
  )
}
