import { useState, type FormEvent } from 'react'
import { neuePunktId, PUNKT_TYPEN, pruefePunkte, STUFEN, type Punkt, type PunktTyp, type Stufe } from '../lib/checkliste'
import { t } from '../lib/sprache'
import { BedingungsEditor } from './BedingungsEditor'
import { WirkungenEditor } from './WirkungenEditor'
import { Fehler } from './ui'
import { Auswahl } from './Auswahl'

// Wert des Eintrags „Neuer Abschnitt …“ in der Abschnittsauswahl (kann kein Abschnittsname sein)
const NEUER_ABSCHNITT = '\0neu'

/** Bearbeiten eines Prüfpunkts. `vorherige` = Punkte vor diesem (für Bedingungen). */
export function PunktDialogInhalt({ punkt, vorlage, alle, vorherige, abschnitte, onSpeichern, onAbbrechen }: {
  punkt: Punkt | null
  /** Vorbelegung für einen neuen Punkt (z. B. Abschnitt und Bedingung beim Anlegen in einem Zweig). */
  vorlage?: Partial<Punkt>
  alle: Punkt[]
  vorherige: Punkt[]
  /** Angelegte Abschnitte zur Auswahl */
  abschnitte: string[]
  onSpeichern: (p: Punkt) => void
  onAbbrechen: () => void
}) {
  const [p, setP] = useState<Punkt>(punkt ?? { id: '', abschnitt: abschnitte.at(-1) ?? 'Allgemein', text: '', typ: 'status', pflicht: true, ...vorlage })
  const [fehler, setFehler] = useState('')
  const [anfangsAbschnitt] = useState(p.abschnitt)
  const [neuerAbschnitt, setNeuerAbschnitt] = useState(!abschnitte.includes(p.abschnitt))
  // Soll-Grenzen als Text halten, damit Eingaben wie "1," beim Tippen nicht in "1" zurückgerechnet werden
  const [sollText, setSollText] = useState({ soll_min: p.soll_min?.toString().replace('.', ',') ?? '', soll_max: p.soll_max?.toString().replace('.', ',') ?? '' })
  const setze = <K extends keyof Punkt>(k: K, v: Punkt[K]) => setP((x) => ({ ...x, [k]: v }))

  const zahl = (s: string) => {
    const n = s.trim() === '' ? undefined : Number(s.replace(',', '.'))
    return n !== undefined && Number.isFinite(n) ? n : undefined
  }
  const setzeSoll = (k: 'soll_min' | 'soll_max', text: string) => {
    setSollText((t) => ({ ...t, [k]: text }))
    setze(k, zahl(text))
  }

  const speichern = (e: FormEvent) => {
    e.preventDefault()
    // Felder entfernen, die zum Typ nicht passen
    const sauber: Punkt = { ...p, id: p.id || neuePunktId(alle, p.text), text: p.text.trim(), abschnitt: p.abschnitt.trim() || 'Allgemein' }
    if (sauber.typ !== 'messwert') { delete sauber.einheit; delete sauber.soll_min; delete sauber.soll_max; delete sauber.verifizieren }
    if (sauber.typ !== 'ja_nein') delete sauber.gut
    if (sauber.typ !== 'auswahl') delete sauber.optionen
    if (sauber.typ === 'text' || sauber.typ === 'foto') { delete sauber.vorschlag_stufe; delete sauber.foto_bei_nok }
    if (!sauber.hinweis?.trim()) delete sauber.hinweis
    if (!sauber.nur_wenn) delete sauber.nur_wenn
    if (!sauber.wirkungen?.length) delete sauber.wirkungen
    if (sauber.optionen) sauber.optionen = sauber.optionen.filter((o) => o.wert.trim())
    const f = pruefePunkte([...vorherige, sauber])
    if (f.length) return setFehler(f.join(' · '))
    onSpeichern(sauber)
  }

  const kannMangel = p.typ === 'status' || p.typ === 'messwert' || p.typ === 'ja_nein'

  return (
    <form onSubmit={speichern} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="p-text">{t('Prüfpunkt')} <span className="text-red-600">*</span></label>
          <textarea id="p-text" rows={2} required value={p.text} onChange={(e) => setze('text', e.target.value)} />
        </div>
        <div>
          <label htmlFor="p-abschnitt">{t('Abschnitt')}</label>
          {neuerAbschnitt ? (
            <div className="flex gap-2">
              <input id="p-abschnitt" className="min-w-0 flex-1" value={p.abschnitt} placeholder={t('Name des neuen Abschnitts')}
                onChange={(e) => setze('abschnitt', e.target.value)} />
              {abschnitte.length > 0 && (
                <button type="button" className="btn-sekundaer mt-1" onClick={() => {
                  setNeuerAbschnitt(false)
                  setze('abschnitt', abschnitte.includes(anfangsAbschnitt) ? anfangsAbschnitt : abschnitte.at(-1)!)
                }}>{t('Auswählen')}</button>
              )}
            </div>
          ) : (
            <Auswahl id="p-abschnitt" value={p.abschnitt} onChange={(e) => {
              if (e.target.value !== NEUER_ABSCHNITT) return setze('abschnitt', e.target.value)
              setNeuerAbschnitt(true)
              setze('abschnitt', '')
            }}>
              {abschnitte.map((a) => <option key={a} value={a}>{a}</option>)}
              <option value={NEUER_ABSCHNITT}>{t('+ Neuer Abschnitt …')}</option>
            </Auswahl>
          )}
        </div>
        <div>
          <label htmlFor="p-typ">{t('Antworttyp')}</label>
          <Auswahl id="p-typ" value={p.typ} onChange={(e) => setze('typ', e.target.value as PunktTyp)}>
            {Object.entries(PUNKT_TYPEN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Auswahl>
        </div>

        {p.typ === 'messwert' && (
          <>
            <div className="grid grid-cols-3 gap-2 sm:col-span-2">
              <div><label htmlFor="p-einheit">{t('Einheit')}</label><input id="p-einheit" required value={p.einheit ?? ''} onChange={(e) => setze('einheit', e.target.value)} placeholder="N" /></div>
              <div><label htmlFor="p-min">{t('Soll min')}</label><input id="p-min" inputMode="decimal" value={sollText.soll_min} onChange={(e) => setzeSoll('soll_min', e.target.value)} /></div>
              <div><label htmlFor="p-max">{t('Soll max')}</label><input id="p-max" inputMode="decimal" value={sollText.soll_max} onChange={(e) => setzeSoll('soll_max', e.target.value)} /></div>
            </div>
            <label className="flex items-center gap-2 font-normal sm:col-span-2">
              <input type="checkbox" checked={!!p.verifizieren} onChange={(e) => setze('verifizieren', e.target.checked || undefined)} />
              {t('Grenzwert noch nicht fachlich bestätigt (blockiert die Freigabe)')}
            </label>
          </>
        )}

        {p.typ === 'ja_nein' && (
          <div>
            <label htmlFor="p-gut">{t('In Ordnung ist')}</label>
            <Auswahl id="p-gut" value={p.gut ?? ''} onChange={(e) => setze('gut', (e.target.value || undefined) as Punkt['gut'])}>
              <option value="">{t('– (reine Information, kein Mangel)')}</option>
              <option value="ja">{t('Ja')}</option>
              <option value="nein">{t('Nein')}</option>
            </Auswahl>
          </div>
        )}

        {p.typ === 'auswahl' && (
          <div className="space-y-2 sm:col-span-2">
            <span className="text-sm font-medium text-slate-700">{t('Optionen')}</span>
            {(p.optionen ?? []).map((o, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <input className="mt-0 min-w-40 flex-1" value={o.wert} placeholder={t('Option {nummer}', { nummer: i + 1 })}
                  onChange={(e) => setze('optionen', p.optionen!.map((x, j) => j === i ? { ...x, wert: e.target.value } : x))} />
                <label className="flex items-center gap-1 font-normal">
                  <input type="checkbox" checked={!!o.mangel}
                    onChange={(e) => setze('optionen', p.optionen!.map((x, j) => j === i ? { ...x, mangel: e.target.checked || undefined } : x))} />
                  {t('ist Mangel')}
                </label>
                {o.mangel && (
                  <Auswahl className="mt-0 w-36" value={o.vorschlag_stufe ?? ''}
                    onChange={(e) => setze('optionen', p.optionen!.map((x, j) => j === i ? { ...x, vorschlag_stufe: (Number(e.target.value) || undefined) as Stufe } : x))}>
                    <option value="">{t('Stufe –')}</option>
                    {([1, 2, 3] as Stufe[]).map((s) => <option key={s} value={s}>{s} {STUFEN[s]}</option>)}
                  </Auswahl>
                )}
                <button type="button" className="text-red-600" aria-label={t('Option entfernen')}
                  onClick={() => setze('optionen', p.optionen!.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <button type="button" className="btn-sekundaer" onClick={() => setze('optionen', [...(p.optionen ?? []), { wert: '' }])}>{t('+ Option')}</button>
          </div>
        )}

        {kannMangel && (
          <div>
            <label htmlFor="p-stufe">{t('Vorgeschlagene Mangelstufe')}</label>
            <Auswahl id="p-stufe" value={p.vorschlag_stufe ?? ''} onChange={(e) => setze('vorschlag_stufe', (Number(e.target.value) || undefined) as Stufe)}>
              <option value="">–</option>
              {([1, 2, 3] as Stufe[]).map((s) => <option key={s} value={s}>{s} – {STUFEN[s]}</option>)}
            </Auswahl>
          </div>
        )}

        <div className="flex flex-col justify-end gap-2 sm:col-span-2 sm:flex-row sm:gap-6">
          <label className="flex items-center gap-2 font-normal">
            <input type="checkbox" checked={!!p.pflicht} onChange={(e) => setze('pflicht', e.target.checked)} /> {t('Pflichtangabe')}
          </label>
          {kannMangel && (
            <label className="flex items-center gap-2 font-normal">
              <input type="checkbox" checked={!!p.foto_bei_nok} onChange={(e) => setze('foto_bei_nok', e.target.checked || undefined)} /> {t('Foto bei Mangel Pflicht')}
            </label>
          )}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="p-hinweis">{t('Hinweis / Normbezug')}</label>
          <input id="p-hinweis" value={p.hinweis ?? ''} onChange={(e) => setze('hinweis', e.target.value)} placeholder={t('z. B. DIN 18650 / EN 16005')} />
        </div>
      </div>

      <BedingungsEditor wert={p.nur_wenn} vorherige={vorherige} alle={alle} onChange={(b) => setze('nur_wenn', b)} />
      <WirkungenEditor punkt={p} vorherige={vorherige} alle={alle} onChange={(w) => setze('wirkungen', w)} />

      <Fehler text={fehler} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-sekundaer" onClick={onAbbrechen}>{t('Abbrechen')}</button>
        <button className="btn-primaer">{t('Übernehmen')}</button>
      </div>
    </form>
  )
}
