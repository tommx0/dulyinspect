import { useEffect, useState } from 'react'
import { ArtSymbol } from '../components/Symbole'
import { Fehler } from '../components/ui'
import { ART_SCHLUESSEL, ARTEN, type ArtSchluessel } from '../lib/anlagenarten'
import { anlagenartenLaden, anlagenartenSetzen, useAnlagenarten } from '../lib/begriffe'
import { fehlertext, supabase } from '../lib/supabase'
import { t } from '../lib/sprache'

// Meldung über den Neuaufbau der Seite hinweg behalten (andere Arten → Layout baut die Seite neu auf)
let gespeichertMeldung = ''

/** Einschaltbare Arten (ohne die Türanlage, die die App je Objekt selbst führt) */
const WAEHLBAR = ART_SCHLUESSEL.filter((a) => !ARTEN[a].intern)

/** Welche Anlagenarten diese Instanz prüft (Admin, Einstellungen). */
export function AnlagenartenBereich() {
  const aktiv = useAnlagenarten()
  const [auswahl, setAuswahl] = useState<Set<ArtSchluessel>>(() => new Set(aktiv))
  const [pflicht, setPflicht] = useState<Set<string>>(new Set())
  const [pflichtVorher, setPflichtVorher] = useState<Set<string>>(new Set())
  useEffect(() => {
    void supabase.from('anlagenart').select('schluessel, sachkunde_pflicht').then(({ data }) => {
      const s = new Set((data ?? []).filter((d) => d.sachkunde_pflicht).map((d) => d.schluessel))
      setPflicht(s); setPflichtVorher(new Set(s))
    })
  }, [])
  const [fehler, setFehler] = useState('')
  const [meldung, setMeldung] = useState(() => { const m = gespeichertMeldung; gespeichertMeldung = ''; return m })
  const [laeuft, setLaeuft] = useState(false)
  const geaendert = [...auswahl].sort().join() !== [...aktiv].sort().join() || [...pflicht].sort().join() !== [...pflichtVorher].sort().join()

  const speichern = async () => {
    setFehler(''); setMeldung('')
    if (!auswahl.size) return setFehler(t('Mindestens eine Anlagenart muss eingeschaltet bleiben.'))
    setLaeuft(true)
    for (const art of WAEHLBAR) {
      const { error } = await supabase.from('anlagenart').update({ aktiv: auswahl.has(art), sachkunde_pflicht: pflicht.has(art) }).eq('schluessel', art)
      if (error) { setLaeuft(false); return setFehler(fehlertext(error)) }
    }
    setLaeuft(false)
    const text = t('Gespeichert. Andere Geräte übernehmen die Änderung beim nächsten Öffnen der App.')
    setMeldung(text)
    // Nur wenn sich die Arten ändern, baut das Layout die Seite neu auf – dann die Meldung dorthin mitnehmen
    if ([...auswahl].sort().join() !== [...aktiv].sort().join()) gespeichertMeldung = text
    setPflichtVorher(new Set(pflicht))
    void anlagenartenLaden() // Pflicht zur Sachkunde für die Prüfung vor Ort übernehmen
    anlagenartenSetzen(WAEHLBAR.filter((a) => auswahl.has(a)))
  }

  return (
    <section className="karte space-y-3 p-4">
      <h2 className="font-semibold">{t('Zu prüfende Anlagen')}</h2>
      <p className="text-sm text-slate-600">
        {t('Welche Arten von Anlagen Ihr Betrieb prüft. Sind nur Türen eingeschaltet, spricht die App überall von „Tür“; sonst allgemein von „Anlage“.')}
        {' '}{t('Ausgeschaltete Arten verschwinden aus den Auswahllisten, vorhandene Anlagen und Prüfungen bleiben erhalten.')}
        {' '}{t('„Nur mit gültiger Sachkunde“: Eine Prüfung dieser Art kann nur beginnen, wer dafür unter „Benutzer“ eine gültige Sachkunde hat.')}
      </p>
      <div className="space-y-2">
        {WAEHLBAR.map((a) => (
          <div key={a} className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <label className="flex w-72 items-center gap-2.5 font-normal">
              <input type="checkbox" checked={auswahl.has(a)}
                onChange={(e) => setAuswahl((s) => { const n = new Set(s); if (e.target.checked) n.add(a); else n.delete(a); return n })} />
              <ArtSymbol art={a} groesse="sm" />
              {ARTEN[a].name}
            </label>
            {auswahl.has(a) && (
              <label className="flex items-center gap-2 text-sm font-normal text-slate-600">
                <input type="checkbox" checked={pflicht.has(a)} aria-label={t('{art}: nur mit gültiger Sachkunde prüfen', { art: ARTEN[a].name })}
                  onChange={(e) => setPflicht((s) => { const n = new Set(s); if (e.target.checked) n.add(a); else n.delete(a); return n })} />
                {t('nur mit gültiger Sachkunde prüfen')}
              </label>
            )}
          </div>
        ))}
      </div>
      <Fehler text={fehler} />
      {meldung && <p role="status" className="text-sm text-green-800">{meldung}</p>}
      <button className="btn-primaer" disabled={!geaendert || laeuft} onClick={() => void speichern()}>{laeuft ? t('Speichern …') : t('Speichern')}</button>
    </section>
  )
}
