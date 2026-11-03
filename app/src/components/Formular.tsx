import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { DEMO_KNOPF_TEXT, demoSperreAktiv } from '../lib/demo'
import { schreibweiseAngleichen } from '../lib/elemente'
import { t } from '../lib/sprache'
import { fehlertext } from '../lib/supabase'
import { Auswahl } from './Auswahl'
import { Fehler } from './ui'

export interface FeldDef {
  name: string
  label: string
  typ?: 'text' | 'email' | 'tel' | 'url' | 'number' | 'date' | 'month' | 'textarea' | 'select' | 'checkbox'
  pflicht?: boolean
  breit?: boolean
  /** Auswahlfeld: Einträge; symbol und zusatz erscheinen in der Kachel des Auswahl-Popups */
  optionen?: { wert: string; text: string; symbol?: ReactNode; zusatz?: ReactNode }[]
  hinweis?: ReactNode
  /** Textfeld: Auswahl aus diesen Werten (z. B. Gebäude der Anlagen im Objekt) mit einem Eintrag für einen neuen Wert, der
   *  dann ins Textfeld kommt. Ohne Werte gleich das Textfeld. Ein neuer Wert in anderer Schreibweise wird angeglichen. */
  vorschlaege?: string[]
  /** Text des Eintrags für einen neuen Wert (Standard „+ Neuer Eintrag …“) */
  vorschlaegeNeu?: string
  max?: string
  zeilen?: number
  /** Textfeld für Dezimalzahlen mit Komma oder Punkt (Zifferntastatur am Handy); der Wert bleibt Text */
  dezimal?: boolean
  /** Auswahlfeld: zusätzlicher Eintrag zum Neuanlegen. Der Aufrufer öffnet seinen Dialog und ruft nach dem Anlegen setze(id) auf. */
  neu?: { text: string; onWahl: (setze: (wert: string) => void) => void }
  /** Textfeld: Knopf daneben, der den Wert aus den aktuellen Werten setzt (z. B. „Erste freie“ Nummer).
   *  vorbelegen: der Wert steht schon beim Öffnen im Feld und folgt Änderungen anderer Felder, solange er nicht von Hand geändert wurde. */
  knopf?: { text: string; wert: (werte: Record<string, unknown>) => unknown; vorbelegen?: boolean }
}

const NEU = '__neu__'
const FREI = '__frei__'

type Werte = Record<string, unknown>

const leer = (w: unknown) => w == null || w === ''

/** Vorbelegte Knopf-Felder (knopf.vorbelegen) nachführen: leere oder noch unveränderte (= Knopfwert der bisherigen Werte)
 *  bekommen den Knopfwert der neuen Werte. Das gerade geänderte Feld bleibt, wie es eingegeben wurde. */
function vorbelegen(felderDef: FeldDef[] | ((werte: Werte) => FeldDef[]), neu: Werte, bisher: Werte | null, geaendert?: string): Werte {
  const felder = typeof felderDef === 'function' ? felderDef(neu) : felderDef
  let w = neu
  for (const f of felder) {
    if (!f.knopf?.vorbelegen || f.name === geaendert) continue
    const alt = w[f.name]
    if (leer(alt) || (bisher && alt === f.knopf.wert(bisher))) {
      const v = f.knopf.wert(w)
      if (v !== alt) w = { ...w, [f.name]: v }
    }
  }
  return w
}

/** Einfaches Formular für Stammdaten. Leere Texte werden als null gespeichert.
 *  felder kann von den aktuellen Werten abhängen (z. B. Felder je nach gewähltem Typ). */
export function Formular({ felder: felderDef, start, onSpeichern, onAbbrechen, onAenderung, ableiten, nurLesen, zusatz, speichernText = t('Speichern'), simulation }: {
  felder: FeldDef[] | ((werte: Werte) => FeldDef[])
  start: Werte
  onSpeichern: (werte: Werte) => Promise<string | void>
  onAbbrechen?: () => void
  /** Nach jeder Eingabe (z. B. um abhängige Teile außerhalb des Formulars anzupassen) */
  onAenderung?: (werte: Werte) => void
  /** Abgeleitete Werte: wird bei jeder Eingabe mit dem geänderten Feld, den neuen und den bisherigen Werten gerufen;
   *  ein zurückgegebenes Objekt ergänzt bzw. überschreibt Felder (z. B. Adresse aus dem gewählten Kunden übernehmen). */
  ableiten?: (feld: string, neu: Werte, bisher: Werte) => Partial<Werte> | void
  nurLesen?: boolean
  zusatz?: ReactNode
  speichernText?: string
  /** Speichert nur auf dem Gerät (Prüfen vor Ort): bleibt im Demomodus bedienbar, übertragen wird ohnehin nichts */
  simulation?: boolean
}) {
  // Demomodus: Formulare, die zum Server speichern, nur ansehen
  const demo = !simulation && demoSperreAktiv()
  const [startWerte] = useState(() => vorbelegen(felderDef, start, null))
  const [werte, setWerte] = useState<Werte>(startWerte)
  const felder = typeof felderDef === 'function' ? felderDef(werte) : felderDef
  const [fehler, setFehler] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  // Felder mit Vorschlägen, in denen gerade ein neuer Wert eingetippt wird
  const [frei, setFrei] = useState<ReadonlySet<string>>(new Set())
  const freiSetzen = (name: string, an: boolean) => setFrei((f) => { const n = new Set(f); if (an) n.add(name); else n.delete(name); return n })

  // Alle Änderungen laufen über setze, daher sind die Refs immer aktuell (auch für verzögerte Aufrufe aus Unterdialogen,
  // etwa wenn ein frisch angelegter Kunde ins Auswahlfeld eingetragen wird)
  const aktuell = useRef(startWerte)
  const ableitenRef = useRef(ableiten)
  ableitenRef.current = ableiten
  const felderRef = useRef(felderDef)
  felderRef.current = felderDef
  const setze = (name: string, wert: unknown) => {
    const bisher = aktuell.current
    let neu: Werte = { ...bisher, [name]: wert }
    const abgeleitet = ableitenRef.current?.(name, neu, bisher)
    if (abgeleitet) neu = { ...neu, ...abgeleitet }
    neu = vorbelegen(felderRef.current, neu, bisher, name)
    aktuell.current = neu
    setWerte(neu)
    onAenderung?.(neu)
  }

  const absenden = async (e: FormEvent) => {
    e.preventDefault()
    setLaeuft(true)
    setFehler('')
    const bereinigt: Werte = {}
    for (const f of felder) {
      const w = werte[f.name]
      if (f.typ === 'number') bereinigt[f.name] = w === '' || w == null ? null : Number(w)
      else if (f.typ === 'checkbox') bereinigt[f.name] = Boolean(w)
      else if (f.vorschlaege?.length && typeof w === 'string') bereinigt[f.name] = schreibweiseAngleichen(w, f.vorschlaege)
      else bereinigt[f.name] = typeof w === 'string' ? (w.trim() === '' ? null : w.trim()) : w ?? null
    }
    let f: string | void
    try {
      f = await onSpeichern(bereinigt)
    } catch (e) {
      f = fehlertext(e)  // z. B. nicht lesbarer Wert, der sich nicht unverändert speichern lässt (Verschlüsselung)
    }
    setLaeuft(false)
    if (f) setFehler(f)
  }

  return (
    <form onSubmit={absenden} className="space-y-4">
      <fieldset disabled={nurLesen || demo || laeuft} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {felder.map((f) => {
          const id = `feld-${f.name}`
          const wert = werte[f.name]
          const gemeinsam = { id, name: f.name, required: f.pflicht }
          let eingabe: ReactNode
          if (f.typ === 'textarea') {
            eingabe = <textarea {...gemeinsam} rows={f.zeilen ?? 3} value={String(wert ?? '')} onChange={(e) => setze(f.name, e.target.value)} />
          } else if (f.typ === 'select') {
            eingabe = (
              <Auswahl {...gemeinsam} value={String(wert ?? '')} onChange={(e) => (e.target.value === NEU ? f.neu?.onWahl((w) => setze(f.name, w)) : setze(f.name, e.target.value))}
                titel={f.label} kachel={(w) => f.optionen?.find((o) => o.wert === w)}>
                {!f.pflicht && <option value="">–</option>}
                {f.pflicht && !wert && <option value="" disabled>{t('Bitte wählen')}</option>}
                {f.optionen?.map((o) => <option key={o.wert} value={o.wert}>{o.text}</option>)}
                {f.neu && <option value={NEU}>{f.neu.text}</option>}
              </Auswahl>
            )
          } else if (f.vorschlaege?.length && (f.typ ?? 'text') === 'text') {
            // Auswahl der vorhandenen Werte; „+ Neu …“ (oder ein Wert außerhalb der Liste) zeigt das Textfeld
            const text = wert == null ? '' : String(wert)
            if (frei.has(f.name) || (text !== '' && !f.vorschlaege.includes(text))) {
              eingabe = (
                <div className="flex items-stretch gap-2">
                  <div className="min-w-0 flex-1">
                    <input {...gemeinsam} type="text" value={text} autoFocus={frei.has(f.name)} onChange={(e) => setze(f.name, e.target.value)} />
                  </div>
                  <button type="button" className="btn-sekundaer mt-1 shrink-0" title={t('Aus den vorhandenen Werten wählen')}
                    onClick={() => { freiSetzen(f.name, false); setze(f.name, '') }}>{t('Liste')}</button>
                </div>
              )
            } else {
              eingabe = (
                <Auswahl {...gemeinsam} value={text} titel={f.label}
                  onChange={(e) => { if (e.target.value === FREI) { freiSetzen(f.name, true); setze(f.name, '') } else setze(f.name, e.target.value) }}>
                  {!f.pflicht && <option value="">–</option>}
                  {f.pflicht && !text && <option value="" disabled>{t('Bitte wählen')}</option>}
                  {f.vorschlaege.map((v) => <option key={v} value={v}>{v}</option>)}
                  <option value={FREI}>{f.vorschlaegeNeu ?? t('+ Neuer Eintrag …')}</option>
                </Auswahl>
              )
            }
          } else if (f.typ === 'checkbox') {
            return (
              <label key={f.name} className={`flex items-center gap-2 ${f.breit ? 'sm:col-span-2' : ''}`}>
                <input type="checkbox" id={id} checked={Boolean(wert)} onChange={(e) => setze(f.name, e.target.checked)} />
                {f.label}
              </label>
            )
          } else {
            eingabe = (
              <input {...gemeinsam} type={f.typ ?? 'text'} max={f.max} value={wert == null ? '' : String(wert)}
                step={f.typ === 'number' ? 'any' : undefined} inputMode={f.typ === 'number' || f.dezimal ? 'decimal' : undefined}
                autoComplete={f.dezimal ? 'off' : undefined} onChange={(e) => setze(f.name, e.target.value)} />
            )
            if (f.knopf) {
              const { text, wert: neuerWert } = f.knopf
              eingabe = (
                <div className="flex items-stretch gap-2">
                  <div className="min-w-0 flex-1">{eingabe}</div>
                  <button type="button" className="btn-sekundaer mt-1 shrink-0 whitespace-nowrap" onClick={() => setze(f.name, neuerWert(werte))}>{text}</button>
                </div>
              )
            }
          }
          return (
            <div key={f.name} className={f.breit || f.typ === 'textarea' ? 'sm:col-span-2' : ''}>
              <label htmlFor={id}>{f.label}{f.pflicht && <span className="text-red-600"> *</span>}</label>
              {eingabe}
              {f.hinweis && <p className="mt-1 text-xs text-slate-500">{f.hinweis}</p>}
            </div>
          )
        })}
      </fieldset>
      {zusatz}
      <Fehler text={fehler} />
      {!nurLesen && (
        <div className="flex flex-wrap justify-end gap-2">
          {demo && <p className="mr-auto self-center text-sm text-amber-800">{t('Demomodus: nur Ansicht, Änderungen lassen sich nicht speichern.')}</p>}
          {onAbbrechen && <button type="button" className="btn-sekundaer" onClick={onAbbrechen}>{demo ? t('Schließen') : t('Abbrechen')}</button>}
          <button className="btn-primaer" disabled={laeuft || demo} title={demo ? DEMO_KNOPF_TEXT : undefined}>{laeuft ? t('Speichern …') : speichernText}</button>
        </div>
      )}
    </form>
  )
}
