import { useRef, useState } from 'react'
import { Dialog, Fehler } from './ui'
import { herunterladen } from '../lib/csv'
import { demoKnopf } from '../lib/demo'
import { fehlertext } from '../lib/supabase'
import { tb } from '../lib/begriffe'
import { t } from '../lib/sprache'
import { austauschImportieren, austauschLesen, type AustauschDatei, type ImportBericht } from '../lib/vorlagenAustausch'

/** Austauschdatei speichern. */
export function austauschSpeichern(d: AustauschDatei, dateiname: string) {
  herunterladen(JSON.stringify(d, null, 2), dateiname, 'application/json')
}

/** Knopf „Exportieren“: lädt die Daten und speichert die Datei; Fehler gehen an `onFehler`. */
export function ExportKnopf({ laden, dateiname, text = t('Exportieren'), className = 'btn-sekundaer', label, onFehler }: {
  laden: () => Promise<AustauschDatei>
  dateiname: string
  text?: string
  className?: string
  label?: string
  onFehler: (text: string) => void
}) {
  const [laeuft, setLaeuft] = useState(false)
  return (
    <button type="button" className={className} disabled={laeuft} aria-label={label} onClick={async (e) => {
      e.stopPropagation()
      setLaeuft(true); onFehler('')
      try { austauschSpeichern(await laden(), dateiname) } catch (err) { onFehler(fehlertext(err)) }
      setLaeuft(false)
    }}>{text}</button>
  )
}

/** Knopf „Importieren“: Datei wählen, Inhalt zeigen, nach Bestätigung einlesen und das Ergebnis berichten. */
export function ImportKnopf({ onFertig }: { onFertig: () => void }) {
  const datei = useRef<HTMLInputElement>(null)
  const [inhalt, setInhalt] = useState<{ name: string; d: AustauschDatei } | null>(null)
  const [bericht, setBericht] = useState<ImportBericht | null>(null)
  const [fehler, setFehler] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  const offen = !!inhalt || !!bericht || !!fehler
  const schliessen = () => { setInhalt(null); setBericht(null); setFehler('') }

  const einlesen = async (f: File | undefined) => {
    if (datei.current) datei.current.value = ''
    if (!f) return
    schliessen()
    try { setInhalt({ name: f.name, d: austauschLesen(await f.text()) }) } catch (e) { setFehler(fehlertext(e)) }
  }
  const starten = async () => {
    if (!inhalt) return
    setLaeuft(true); setFehler('')
    try {
      setBericht(await austauschImportieren(inhalt.d))
      setInhalt(null)
      onFertig()
    } catch (e) { setFehler(fehlertext(e)) }
    setLaeuft(false)
  }

  return (
    <>
      <button type="button" className="btn-sekundaer" {...demoKnopf()} onClick={() => datei.current?.click()}>{t('Importieren')}</button>
      <input ref={datei} type="file" accept=".json,application/json" className="hidden" aria-label={t('Exportdatei wählen')}
        onChange={(e) => void einlesen(e.target.files?.[0])} />
      <Dialog offen={offen} titel={bericht ? t('Import abgeschlossen') : tb('Checklisten und Türtypen importieren')} onSchliessen={schliessen}>
        <div className="space-y-3 text-sm">
          {inhalt && (
            <>
              <p>{tb('Datei „{datei}“ enthält {listen} Checkliste(n) und {typen} Türtyp(en).', { datei: inhalt.name, listen: inhalt.d.checklisten.length, typen: inhalt.d.anlagentypen.length })}</p>
              <Liste titel={t('Checklisten')} namen={inhalt.d.checklisten.map((c) => c.name)} />
              <Liste titel={tb('Türtypen')} namen={inhalt.d.anlagentypen.map((ty) => ty.name)} />
              <p className="text-slate-600">
                {tb('Neue Checklisten werden als Entwurf angelegt. Gibt es eine Checkliste mit gleichem Namen und anderem Inhalt, kommt der Inhalt als neue Entwurfsversion dazu. Vorhandene Türtypen bleiben, fehlende Prüfarten werden ergänzt. Freigegeben wird nichts automatisch.')}
              </p>
            </>
          )}
          {bericht && <Bericht b={bericht} />}
          <Fehler text={fehler} />
          <div className="flex justify-end gap-2">
            {inhalt ? <>
              <button type="button" className="btn-sekundaer" onClick={schliessen}>{t('Abbrechen')}</button>
              <button type="button" className="btn-primaer" disabled={laeuft} onClick={() => void starten()}>{laeuft ? t('Importiere …') : t('Importieren')}</button>
            </> : <button type="button" className="btn-primaer" onClick={schliessen}>{t('Schließen')}</button>}
          </div>
        </div>
      </Dialog>
    </>
  )
}

function Liste({ titel, namen }: { titel: string; namen: string[] }) {
  if (!namen.length) return null
  return (
    <div>
      <div className="font-medium">{titel}</div>
      <ul className="max-h-40 list-disc overflow-auto pl-5 text-slate-700">{namen.map((n, i) => <li key={i}>{n}</li>)}</ul>
    </div>
  )
}

function Bericht({ b }: { b: ImportBericht }) {
  const gruppen: [string, string[]][] = [
    [t('Neue Checklisten (Entwurf v1)'), b.listenNeu],
    [t('Neue Entwurfsversion'), b.listenEntwurf],
    [t('Checklisten unverändert (gleicher Inhalt)'), b.listenGleich],
    [tb('Neue Türtypen'), b.typenNeu],
    [tb('Türtypen ergänzt'), b.typenErgaenzt],
    [tb('Türtypen unverändert'), b.typenGleich],
    [t('Übersprungen'), b.uebersprungen],
    [t('Prüfarten ohne Checkliste (bitte zuordnen)'), b.ohneCheckliste],
  ]
  const leer = gruppen.every(([, n]) => !n.length)
  return (
    <div role="status" className="space-y-2">
      {leer ? <p>{t('Die Datei enthielt nichts zum Importieren.')}</p> : gruppen.map(([titel, namen]) => <Liste key={titel} titel={titel} namen={namen} />)}
      {b.listenNeu.length + b.listenEntwurf.length > 0 && <p className="text-slate-600">{t('Entwürfe bitte fachlich prüfen und freigeben, bevor mit ihnen geprüft wird.')}</p>}
    </div>
  )
}
