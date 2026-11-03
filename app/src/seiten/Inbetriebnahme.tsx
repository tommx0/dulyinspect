import { useState, type ReactNode } from 'react'
import { Check, Circle } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { beispieleNachRueckfrage, IMPORT_NACHSATZ } from '../components/BeispieleImport'
import { Fehler, Laden, Seite } from '../components/ui'
import { demoKnopf } from '../lib/demo'
import { bestaetigt, naechsterOffener, SCHRITT_INFO, SCHRITTE, schrittStand, standLesen, type Fakten, type InbetriebnahmeStand, type Schritt } from '../lib/inbetriebnahme'
import { fehlertext, supabase } from '../lib/supabase'
import { useAbfrage } from '../lib/useAbfrage'
import { t } from '../lib/sprache'
import { AnlagenartenBereich } from './AnlagenartenBereich'
import { ErscheinungsbildBereich } from './ErscheinungsbildBereich'
import { EtikettenBereich, FirmendatenBereich, RechtstexteBereich } from './Einstellungen'

type Daten = { fakten: Fakten; stand: InbetriebnahmeStand }

/** Stand der Inbetriebnahme: Firma, Zahl der Checklisten und Benutzer (ohne Supportzugang). */
export async function inbetriebnahmeLaden(): Promise<{ data: Daten | null; error: unknown }> {
  const [firma, listen, benutzer] = await Promise.all([
    supabase.from('firma').select('name, impressum, datenschutz, inbetriebnahme').single(),
    supabase.from('checkliste').select('id', { count: 'exact', head: true }),
    supabase.from('benutzer').select('id', { count: 'exact', head: true }).eq('support', false),
  ])
  const error = firma.error ?? listen.error ?? benutzer.error
  if (error || !firma.data) return { data: null, error }
  return {
    data: {
      fakten: { firmenname: firma.data.name, checklisten: listen.count ?? 0, impressum: firma.data.impressum, datenschutz: firma.data.datenschutz, benutzer: benutzer.count ?? 0 },
      stand: standLesen(firma.data.inbetriebnahme),
    },
    error: null,
  }
}

async function speichern(stand: InbetriebnahmeStand) {
  const { error } = await supabase.from('firma').update({ inbetriebnahme: stand }).eq('id', 1)
  if (error) throw error
}

function VorlagenSchritt({ anzahl, onImportiert }: { anzahl: number; onImportiert: () => void }) {
  const [meldung, setMeldung] = useState('')
  const [fehler, setFehler] = useState('')
  return (
    <section className="karte space-y-3 p-4">
      <p className="text-sm text-slate-700">
        {anzahl ? t('Es gibt schon {n} Checkliste(n).', { n: anzahl }) : t('Noch keine Checklisten.')} {t('Die Beispiele passen zu den gewählten Anlagenarten und kommen als Entwurf.')}
        {' '}{t('Eigene Checklisten und Anlagentypen legen Sie unter')} <Link className="link" to="/checklisten">{t('Checklisten')}</Link> {t('und')} <Link className="link" to="/anlagentypen">{t('Anlagentypen')}</Link>{t(' an.')}
      </p>
      {meldung && <div role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">{meldung} {IMPORT_NACHSATZ}</div>}
      <Fehler text={fehler} />
      <button className="btn-sekundaer" {...demoKnopf()} onClick={async () => {
        setFehler(''); setMeldung('')
        try {
          const m = await beispieleNachRueckfrage()
          if (m) { setMeldung(m); onImportiert() }
        } catch (e) { setFehler(fehlertext(e)) }
      }}>{t('Beispiele importieren')}</button>
    </section>
  )
}

function BenutzerSchritt({ anzahl }: { anzahl: number }) {
  return (
    <section className="karte space-y-3 p-4">
      <p className="text-sm text-slate-700">
        {anzahl > 1 ? t('Es gibt {n} Benutzer.', { n: anzahl }) : t('Bisher gibt es nur Sie.')} {t('Weitere Benutzer legen Sie unter „Benutzer“ an: Prüfer führen Prüfungen durch, Planer pflegen Kunden, Anlagen und Termine. Wer allein arbeitet, überspringt diesen Schritt.')}
      </p>
      <Link className="btn-sekundaer" to="/benutzer">{t('Zu den Benutzern')}</Link>
    </section>
  )
}

/**
 * Inbetriebnahme-Assistent: nach der Ersteinrichtung Schritt für Schritt durch die Einstellungen, die eine neue Instanz braucht.
 * Jeder Schritt zeigt den Bereich aus den Einstellungen; „Weiter“ bestätigt ihn, auch ohne Eingabe (überspringen) – der Stand zählt
 * nur für den Hinweis auf der Startseite. Erledigt ist ein Schritt auch, wenn die Daten es zeigen (src/lib/inbetriebnahme.ts).
 */
export default function Inbetriebnahme() {
  const abfrage = useAbfrage(inbetriebnahmeLaden)
  const [params, setParams] = useSearchParams()
  const [fehler, setFehler] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  if (abfrage.laedt && !abfrage.daten) return <Seite titel={t('Inbetriebnahme')}><Laden /></Seite>
  if (!abfrage.daten) return <Seite titel={t('Inbetriebnahme')}><Fehler text={abfrage.fehler || t('Stand der Inbetriebnahme nicht lesbar.')} /></Seite>

  const { fakten, stand } = abfrage.daten
  const erledigt = schrittStand(fakten, stand)
  const anzahl = SCHRITTE.filter((s) => erledigt[s]).length
  const gewaehlt = params.get('schritt')
  const aktuell: Schritt | 'abschluss' = (SCHRITTE as readonly string[]).includes(gewaehlt ?? '') ? gewaehlt as Schritt
    : gewaehlt === 'abschluss' ? 'abschluss' : naechsterOffener(erledigt) ?? 'abschluss'
  const index = aktuell === 'abschluss' ? SCHRITTE.length : SCHRITTE.indexOf(aktuell)
  const zu = (s: Schritt | 'abschluss') => setParams({ schritt: s })

  const weiter = async (s: Schritt) => {
    setLaeuft(true); setFehler('')
    try {
      await speichern(bestaetigt(stand, s))
      abfrage.neuLaden()
      zu(SCHRITTE[index + 1] ?? 'abschluss')
    } catch (e) { setFehler(fehlertext(e)) }
    setLaeuft(false)
  }
  const abschliessen = async () => {
    setLaeuft(true); setFehler('')
    try {
      await speichern({ ...stand, abgeschlossen: stand.abgeschlossen ?? new Date().toISOString() })
      abfrage.neuLaden()
    } catch (e) { setFehler(fehlertext(e)) }
    setLaeuft(false)
  }

  const inhalt: Record<Schritt, ReactNode> = {
    firmendaten: <FirmendatenBereich />,
    anlagen: <AnlagenartenBereich />,
    vorlagen: <VorlagenSchritt anzahl={fakten.checklisten} onImportiert={abfrage.neuLaden} />,
    rechtstexte: <RechtstexteBereich />,
    erscheinungsbild: <ErscheinungsbildBereich />,
    etiketten: <EtikettenBereich />,
    benutzer: <BenutzerSchritt anzahl={fakten.benutzer} />,
  }

  return (
    <Seite titel={t('Inbetriebnahme')} zurueck={{ zu: '/', text: t('Zur Startseite') }}>
      <p className="text-sm text-slate-600" data-inbetriebnahme-stand>
        {t('{n} von {m} Schritten erledigt.', { n: anzahl, m: SCHRITTE.length })} {t('Jeder Schritt lässt sich überspringen und später hier oder unter „Einstellungen“ nachholen.')}
      </p>
      <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
        {/* Handy: der Schritt zuerst, die Liste darunter */}
        <nav aria-label={t('Schritte der Inbetriebnahme')} className="order-2 md:order-1">
          <ol className="space-y-0.5">
            {SCHRITTE.map((s, i) => (
              <li key={s}>
                <button type="button" onClick={() => zu(s)} aria-current={aktuell === s ? 'step' : undefined} data-schritt={s} data-erledigt={erledigt[s] || undefined}
                  className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium ${aktuell === s ? 'bg-akzent text-marke' : 'text-slate-700 hover:bg-akzent-hell'}`}>
                  {erledigt[s] ? <Check className="size-4 shrink-0 text-green-700" strokeWidth={2.5} aria-label={t('erledigt')} /> : <Circle className="size-4 shrink-0 text-slate-400" aria-label={t('offen')} />}
                  <span>{i + 1}. {SCHRITT_INFO[s].titel}{SCHRITT_INFO[s].optional && <span className="font-normal text-slate-500"> ({t('optional')})</span>}</span>
                </button>
              </li>
            ))}
            <li>
              <button type="button" onClick={() => zu('abschluss')} aria-current={aktuell === 'abschluss' ? 'step' : undefined}
                className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium ${aktuell === 'abschluss' ? 'bg-akzent text-marke' : 'text-slate-700 hover:bg-akzent-hell'}`}>
                {stand.abgeschlossen ? <Check className="size-4 shrink-0 text-green-700" strokeWidth={2.5} aria-label={t('erledigt')} /> : <Circle className="size-4 shrink-0 text-slate-400" aria-label={t('offen')} />}
                <span>{t('Abschluss')}</span>
              </button>
            </li>
          </ol>
        </nav>

        <div className="order-1 min-w-0 space-y-4 md:order-2" data-inbetriebnahme-schritt={aktuell}>
          {aktuell === 'abschluss' ? (
            <section className="karte space-y-3 p-4">
              <h2 className="text-lg font-semibold">{t('Abschluss')}</h2>
              {anzahl < SCHRITTE.length
                ? <p className="text-sm text-slate-700">{t('Noch offen: {liste}.', { liste: SCHRITTE.filter((s) => !erledigt[s]).map((s) => SCHRITT_INFO[s].titel).join(', ') })} {t('Sie können trotzdem abschließen und die Schritte später nachholen.')}</p>
                : <p className="text-sm text-slate-700">{t('Alle Schritte sind erledigt.')}</p>}
              <p className="text-sm text-slate-700">
                {t('Denken Sie an die Datensicherung: Unter')} <Link className="link" to="/datensicherung">{t('Datensicherung')}</Link> {t('erstellen Sie ein Backup aller Daten.')}
                {' '}{t('Das Schlüsselblatt der Verschlüsselung gehört an einen sicheren Ort, ohne es lassen sich verschlüsselte Daten nicht wiederherstellen.')}
              </p>
              <Fehler text={fehler} />
              {stand.abgeschlossen
                ? <p role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">{t('Die Inbetriebnahme ist abgeschlossen.')} <Link className="link" to="/">{t('Zur Startseite')}</Link></p>
                : <button className="btn-primaer" disabled={laeuft} {...demoKnopf()} onClick={() => void abschliessen()}>{t('Inbetriebnahme abschließen')}</button>}
            </section>
          ) : <>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">{index + 1}. {SCHRITT_INFO[aktuell].titel}</h2>
              <p className="text-sm text-slate-600">{SCHRITT_INFO[aktuell].text}</p>
            </div>
            {inhalt[aktuell]}
            <Fehler text={fehler} />
            <div className="flex flex-wrap gap-2">
              {index > 0 && <button type="button" className="btn-sekundaer" onClick={() => zu(SCHRITTE[index - 1])}>{t('Zurück')}</button>}
              <button type="button" className="btn-primaer" disabled={laeuft} {...demoKnopf()} onClick={() => void weiter(aktuell)}>
                {t('Weiter')}
              </button>
            </div>
          </>}
        </div>
      </div>
    </Seite>
  )
}
