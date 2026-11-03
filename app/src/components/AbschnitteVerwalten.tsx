import { useState, type FormEvent } from 'react'
import { abschnittAnlegen, abschnittLoeschen, abschnittUmbenennen, verschiebeAbschnitt, type Stand, type StandErgebnis } from '../lib/checklisteBaum'
import { Auswahl } from './Auswahl'
import { t, tMeldung } from '../lib/sprache'
import { Fehler } from './ui'

/** Abschnitte einer Checkliste anlegen, umbenennen, sortieren und löschen. Jede Änderung geht sofort an den Editor (mit Rückgängig). */
export function AbschnitteVerwalten({ stand, onAendern, onFertig }: {
  stand: Stand
  onAendern: (neu: Stand) => void
  onFertig: () => void
}) {
  const [neu, setNeu] = useState('')
  const [umbenennen, setUmbenennen] = useState<{ name: string; text: string } | null>(null)
  const [loeschen, setLoeschen] = useState<{ name: string; ziel: string } | null>(null)
  const [fehler, setFehler] = useState('')
  const { punkte, abschnitte } = stand
  const anzahl = (a: string) => punkte.filter((p) => p.abschnitt === a).length

  const anwenden = (e: StandErgebnis) => {
    if ('fehler' in e) {
      setFehler(tMeldung(e.fehler))
      return false
    }
    setFehler('')
    if (e !== stand) onAendern(e)
    return true
  }

  const anlegen = (e: FormEvent) => {
    e.preventDefault()
    if (anwenden(abschnittAnlegen(stand, neu))) setNeu('')
  }

  const umbenannt = (e: FormEvent) => {
    e.preventDefault()
    if (umbenennen && anwenden(abschnittUmbenennen(stand, umbenennen.name, umbenennen.text))) setUmbenennen(null)
  }

  const entfernen = (name: string) => {
    if (anzahl(name) === 0) anwenden(abschnittLoeschen(stand, name, null))
    else setLoeschen({ name, ziel: abschnitte.find((a) => a !== name) ?? '' })
    setUmbenennen(null)
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        {t('Legen Sie hier die Abschnitte der Checkliste an. Im Prüfpunkt wählen Sie den Abschnitt dann aus der Liste. Die Reihenfolge gilt auch für die Prüfung; Abschnitte ohne Prüfpunkte sieht der Prüfer nicht.')}
      </p>

      {abschnitte.length === 0 ? <p className="text-sm text-slate-500">{t('Noch keine Abschnitte.')}</p> : (
        <ol className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {abschnitte.map((a, i) => (
            <li key={a} className="px-3 py-2">
              {umbenennen?.name === a ? (
                <form onSubmit={umbenannt} className="flex flex-wrap items-center gap-2">
                  <input className="mt-0 min-w-40 flex-1" aria-label={t('Neuer Name für „{abschnitt}“', { abschnitt: a })} autoFocus value={umbenennen.text}
                    onChange={(e) => setUmbenennen({ name: a, text: e.target.value })} />
                  <button className="btn-primaer">{t('Übernehmen')}</button>
                  <button type="button" className="btn-sekundaer" onClick={() => { setUmbenennen(null); setFehler('') }}>{t('Abbrechen')}</button>
                </form>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="w-6 shrink-0 text-right text-sm text-slate-400">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{a}</span>
                  <span className="shrink-0 text-xs text-slate-500">{anzahl(a) === 1 ? t('1 Punkt') : t('{n} Punkte', { n: anzahl(a) })}</span>
                  <div className="flex shrink-0 items-center gap-1 text-slate-500">
                    <button type="button" aria-label={t('„{abschnitt}“ nach oben', { abschnitt: a })} className="px-1 hover:text-slate-900 disabled:opacity-30" disabled={i === 0}
                      onClick={() => anwenden(verschiebeAbschnitt(stand, a, abschnitte[i - 1]))}>▲</button>
                    <button type="button" aria-label={t('„{abschnitt}“ nach unten', { abschnitt: a })} className="px-1 hover:text-slate-900 disabled:opacity-30" disabled={i === abschnitte.length - 1}
                      onClick={() => anwenden(verschiebeAbschnitt(stand, a, abschnitte[i + 2] ?? null))}>▼</button>
                    <button type="button" className="px-1 link" onClick={() => { setUmbenennen({ name: a, text: a }); setLoeschen(null); setFehler('') }}>{t('Umbenennen')}</button>
                    <button type="button" aria-label={t('„{abschnitt}“ löschen', { abschnitt: a })} className="px-1 text-red-600" onClick={() => entfernen(a)}>✕</button>
                  </div>
                </div>
              )}
              {loeschen?.name === a && (
                <div className="mt-2 space-y-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm">
                  <p>{anzahl(a) === 1 ? t('Der Abschnitt enthält 1 Prüfpunkt. Was soll mit ihnen geschehen?') : t('Der Abschnitt enthält {n} Prüfpunkte. Was soll mit ihnen geschehen?', { n: anzahl(a) })}</p>
                  <Auswahl className="mt-0" aria-label={t('Prüfpunkte des Abschnitts')} value={loeschen.ziel} onChange={(e) => setLoeschen({ name: a, ziel: e.target.value })}>
                    {abschnitte.filter((x) => x !== a).map((x) => <option key={x} value={x}>{t('verschieben nach „{abschnitt}“', { abschnitt: x })}</option>)}
                    <option value="">{t('mitlöschen')}</option>
                  </Auswahl>
                  <div className="flex justify-end gap-2">
                    <button type="button" className="btn-sekundaer" onClick={() => { setLoeschen(null); setFehler('') }}>{t('Abbrechen')}</button>
                    <button type="button" className="btn-gefahr"
                      onClick={() => { if (anwenden(abschnittLoeschen(stand, a, loeschen.ziel || null))) setLoeschen(null) }}>
                      {t('Abschnitt löschen')}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      <form onSubmit={anlegen} className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <label htmlFor="abschnitt-neu">{t('Neuer Abschnitt')}</label>
          <input id="abschnitt-neu" value={neu} onChange={(e) => setNeu(e.target.value)} placeholder={t('z. B. Mechanik')} />
        </div>
        <button className="btn-sekundaer" disabled={!neu.trim()}>{t('Hinzufügen')}</button>
      </form>

      <Fehler text={fehler} />
      <div className="flex justify-end">
        <button type="button" className="btn-primaer" onClick={onFertig}>{t('Fertig')}</button>
      </div>
    </div>
  )
}
