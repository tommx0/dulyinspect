import { useState, useSyncExternalStore } from 'react'
import { t } from '../lib/sprache'
import { Dialog } from './ui'

// Eigene Bestätigungsabfrage statt window.confirm(): Im deploybase-Share-Link läuft die App in einem
// Sandbox-iframe ohne „allow-modals“ – dort liefert confirm() stumm false und nichts passiert.

interface Anfrage {
  text: string
  ok: string
  gefahr: boolean
  /** Beschriftung eines Häkchens (bestaetigenMitHaekchen), anfangs nicht gesetzt */
  haekchen?: string
  /** Bestätigen erst mit gesetztem Häkchen möglich */
  haekchenPflicht?: boolean
  /** nur ein Hinweis: ein Knopf, kein „Abbrechen“ */
  nurHinweis?: boolean
  /** jede Anfrage neu (Häkchen beginnt nicht gesetzt) */
  nr: number
  antwort: (ja: boolean, haekchen: boolean) => void
}

let aktuell: Anfrage | null = null
let zaehler = 0
const hoerer = new Set<() => void>()
const melden = () => hoerer.forEach((h) => h())

function fragen(text: string, optionen: { ok?: string; gefahr?: boolean; haekchen?: string; haekchenPflicht?: boolean; nurHinweis?: boolean }): Promise<{ ja: boolean; haekchen: boolean }> {
  aktuell?.antwort(false, false)
  return new Promise((antwort) => {
    aktuell = {
      text, ok: optionen.ok ?? t('OK'), gefahr: optionen.gefahr ?? false, haekchen: optionen.haekchen, haekchenPflicht: optionen.haekchenPflicht,
      nurHinweis: optionen.nurHinweis, nr: ++zaehler,
      antwort: (ja, haekchen) => { aktuell = null; melden(); antwort({ ja, haekchen }) },
    }
    melden()
  })
}

/** Fragt den Benutzer und liefert true bei Bestätigung. */
export async function bestaetigen(text: string, optionen: { ok?: string; gefahr?: boolean } = {}): Promise<boolean> {
  return (await fragen(text, optionen)).ja
}

/** Hinweis mit nur einem Knopf; erfüllt sich, sobald er geschlossen wird. */
export async function hinweisen(text: string, ok = t('Verstanden')): Promise<void> {
  await fragen(text, { ok, nurHinweis: true })
}

/**
 * Wie bestaetigen, mit einem Häkchen (anfangs nicht gesetzt); `haekchen` zählt nur bei Bestätigung.
 * Mit `pflicht` lässt sich erst bestätigen, wenn das Häkchen gesetzt ist.
 */
export async function bestaetigenMitHaekchen(text: string, haekchen: string, optionen: { ok?: string; gefahr?: boolean; pflicht?: boolean } = {}) {
  const { pflicht, ...rest } = optionen
  const a = await fragen(text, { ...rest, haekchen, haekchenPflicht: pflicht })
  return { ja: a.ja, haekchen: a.ja && a.haekchen }
}

function Inhalt({ a }: { a: Anfrage }) {
  const [gesetzt, setGesetzt] = useState(false)
  return (
    <div className="space-y-4">
      <p className="whitespace-pre-line">{a.text}</p>
      {a.haekchen && (
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" autoFocus={a.haekchenPflicht} checked={gesetzt} onChange={(e) => setGesetzt(e.target.checked)} />
          <span>{a.haekchen}</span>
        </label>
      )}
      <div className="flex justify-end gap-2">
        {!a.nurHinweis && <button className="btn-sekundaer" onClick={() => a.antwort(false, false)}>{t('Abbrechen')}</button>}
        <button className={a.gefahr ? 'btn-gefahr' : 'btn-primaer'} autoFocus={!a.haekchenPflicht} disabled={a.haekchenPflicht && !gesetzt}
          onClick={() => a.antwort(true, gesetzt)}>{a.ok}</button>
      </div>
    </div>
  )
}

/** Einmal in der App einbinden (main.tsx). */
export function BestaetigungsHost() {
  const a = useSyncExternalStore((h) => { hoerer.add(h); return () => hoerer.delete(h) }, () => aktuell)
  return (
    <Dialog offen={a !== null} titel={a?.nurHinweis ? t('Hinweis') : t('Bitte bestätigen')} onSchliessen={() => a?.antwort(false, false)}>
      {a && <Inhalt key={a.nr} a={a} />}
    </Dialog>
  )
}
