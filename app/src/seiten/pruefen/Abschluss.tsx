// Bausteine für Abschluss, Unterschriften, Wiederöffnen und Doppelprüfung – gemeinsam für die Prüfung einer Anlage
// (AnlagenPruefung) und die Prüfung einer Türanlage (TueranlagePruefung).
import { useEffect, useRef, useState } from 'react'
import { bestaetigenMitHaekchen } from '../../components/Bestaetigung'
import { Unterschrift, type UnterschriftRef } from '../../components/Unterschrift'
import { Fehler } from '../../components/ui'
import { tb } from '../../lib/begriffe'
import { t } from '../../lib/sprache'
import { fehlertext, supabase } from '../../lib/supabase'
import { duplikatAufloesen, mitpruefungFertigMelden, pruefungAbschliessen, wiederOeffnen, type Abschluss } from '../../offline/aktionen'
import type { Pruefung } from '../../offline/db'
import { AMPEL_TEXT } from './ampel'
import { Auswahl } from '../../components/Auswahl'

// Rückfragen beim Unterschreiben: Die App schlägt nur vor, verantwortlich bleibt, wer unterschreibt
const NUR_VORSCHLAEGE = t('Die App macht nur unverbindliche Vorschläge, z. B. Grenzwerte, Mangelstufen und das vorgeschlagene Ergebnis. Die Verantwortung für die Prüfung und ihre Bewertung kann und soll sie nicht übernehmen – sie bleibt bei dem Prüfer, der unterschreibt.')
const PDF_KONTROLLIEREN = t('Kontrollieren Sie nach dem Abschluss das erzeugte Protokoll (PDF). Falsche Angaben korrigieren Sie, indem Sie die Prüfung wieder öffnen und neu unterschreiben.')
const HAEKCHEN_PRUEFER = t('Ich habe alle Eingaben und Messwerte kontrolliert. Die Bewertung – auch der Messwerte und Mängel – habe ich als sachkundige bzw. befähigte Person selbst geprüft und entschieden. Für das Ergebnis dieser Prüfung bin ich verantwortlich.')
const HAEKCHEN_MITPRUEFER = t('Ich habe meine Eingaben und Messwerte kontrolliert und als sachkundige bzw. befähigte Person selbst bewertet. Für meine Einträge bin ich verantwortlich; die App macht nur unverbindliche Vorschläge.')

/** Warum sich (noch) nicht abschließen lässt: Liste unter dem Knopf. Ohne Gründe nichts. */
export function OffeneGruende({ gruende }: { gruende: string[] }) {
  if (!gruende.length) return null
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-offen>
      <p className="font-medium">{t('Noch nicht möglich, weil:')}</p>
      <ul className="list-disc space-y-0.5 pl-5">
        {gruende.map((g, i) => <li key={i}>{g}</li>)}
      </ul>
    </div>
  )
}

/**
 * Unterschrift des Hauptprüfers, optional Kunde, dann abschließen. Jede Prüfung wird einzeln unterschrieben: Die Unterschrift
 * wird nicht gemerkt und bleibt auf dem Server nur, bis das Protokoll erzeugt ist – danach steht sie nur noch im PDF.
 */
export function AbschlussUnterschrift({ pruefung, gruende, pruefen, abschluss, onAbgeschlossen, knopf }: {
  pruefung: Pruefung
  /** Beschriftung des Knopfs (Standard „Tür abschließen“) */
  knopf?: string
  /** Was dem Abschluss noch fehlt; der Knopf ist gesperrt, solange es Gründe gibt, und sie stehen darunter */
  gruende: string[]
  pruefen: () => string | null
  abschluss: Omit<Abschluss, 'unterschrift' | 'kunde'>
  onAbgeschlossen: () => void
}) {
  const sig = useRef<UnterschriftRef>(null)
  const sigKunde = useRef<UnterschriftRef>(null)
  const [mitKunde, setMitKunde] = useState(false)
  const [kundeName, setKundeName] = useState('')
  const [fehler, setFehler] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  const knopfText = knopf ?? tb('Tür abschließen')

  const abschliessen = async () => {
    setFehler('')
    const grund = pruefen()
    if (grund) return setFehler(grund)
    const unterschrift = await sig.current?.alsBlob()
    if (!unterschrift) return setFehler(t('Bitte unterschreiben.'))
    const kundeBlob = mitKunde ? await sigKunde.current?.alsBlob() : null
    if (mitKunde && (!kundeBlob || !kundeName.trim())) return setFehler(t('Bitte Name und Unterschrift des Kunden erfassen oder die Option abwählen.'))
    const { ja } = await bestaetigenMitHaekchen(`${knopfText}?\n\n${NUR_VORSCHLAEGE}\n\n${PDF_KONTROLLIEREN}`, HAEKCHEN_PRUEFER, { ok: knopfText, pflicht: true })
    if (!ja) return
    setLaeuft(true)
    try {
      await pruefungAbschliessen(pruefung.id, {
        ...abschluss, unterschrift, kunde: kundeBlob ? { name: kundeName, unterschrift: kundeBlob } : undefined,
      })
      onAbgeschlossen()
    } catch (e) {
      setFehler(fehlertext(e))
    } finally {
      setLaeuft(false)
    }
  }

  return (
    <div className="space-y-3">
      {pruefung.revision > 0 && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
          {t('Die Prüfung wurde wieder geöffnet. Bitte neu unterschreiben – Unterschriften gelten je Prüfung und Revision.')}
        </p>
      )}
      <Unterschrift ref={sig} label={t('Unterschrift Prüfer')} />
      <label className="flex items-center gap-2 font-normal"><input type="checkbox" checked={mitKunde} onChange={(e) => setMitKunde(e.target.checked)} /> {t('Kunde unterschreibt')}</label>
      {mitKunde && (
        <>
          <div><label htmlFor="kunde-name">{t('Name des Kunden (Druckschrift)')}</label><input id="kunde-name" value={kundeName} onChange={(e) => setKundeName(e.target.value)} /></div>
          <Unterschrift ref={sigKunde} label={t('Unterschrift Kunde')} />
        </>
      )}
      <Fehler text={fehler} />
      <button className="btn-primaer w-full py-3" disabled={gruende.length > 0 || laeuft} onClick={() => void abschliessen()}>{knopfText}</button>
      <OffeneGruende gruende={gruende} />
      <p className="text-xs text-slate-500">{t('Danach ist die Prüfung gesperrt und das Protokoll entsteht. Funktioniert auch offline – übertragen wird, sobald wieder Netz da ist.')}</p>
    </div>
  )
}

/** Mitprüfer: eigenen Teil mit Unterschrift fertig melden. */
export function FertigMelden({ pruefungId, hauptpruefer, onFertig }: { pruefungId: string; hauptpruefer: string; onFertig: () => void }) {
  const sig = useRef<UnterschriftRef>(null)
  const [bestaetigt, setBestaetigt] = useState(false)
  const [fehler, setFehler] = useState('')
  const melden = async () => {
    const blob = await sig.current?.alsBlob()
    if (!blob) return setFehler(t('Bitte unterschreiben.'))
    if (!bestaetigt) return setFehler(t('Bitte bestätigen, dass Sie Ihre Eingaben kontrolliert und bewertet haben.'))
    try { await mitpruefungFertigMelden(pruefungId, blob); onFertig() } catch (e) { setFehler(fehlertext(e)) }
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">{t('Ihre Unterschrift gilt für Ihre Einträge in dieser Prüfung. Danach erfassen Sie nichts mehr; {pruefer} kann abschließen. Ändert jemand einen Ihrer Einträge, erlischt Ihre Unterschrift und Sie werden um eine neue gebeten.', { pruefer: hauptpruefer })}</p>
      <Unterschrift ref={sig} label={t('Unterschrift Mitprüfer')} />
      <label className="flex items-start gap-2 font-normal">
        <input type="checkbox" className="mt-1" checked={bestaetigt} onChange={(e) => setBestaetigt(e.target.checked)} />
        <span>{HAEKCHEN_MITPRUEFER}</span>
      </label>
      <Fehler text={fehler} />
      <div className="flex justify-end gap-2">
        <button className="btn-sekundaer" onClick={onFertig}>{t('Abbrechen')}</button>
        <button className="btn-primaer" onClick={() => void melden()}>{t('Fertig melden')}</button>
      </div>
      <p className="text-xs text-slate-500">{t('Funktioniert auch offline.')}</p>
    </div>
  )
}

/** Nach dem Abschluss: Protokoll kontrollieren, Fehler über „Wieder öffnen“ korrigieren (Rechte wie darfWiederOeffnen). */
export function ProtokollKontrollieren() {
  return (
    <p className="text-sm text-green-900" data-protokoll-kontrollieren>
      {t('Bitte das Protokoll (PDF) kontrollieren. Falsche Angaben lassen sich korrigieren: Prüfung wieder öffnen – am Tag des Abschlusses selbst, danach über einen Admin oder Planer – und neu unterschreiben.')}
    </p>
  )
}

/** Abgeschlossene Prüfung mit Grund wieder öffnen (neue Revision). */
export function WiederOeffnen({ pruefungId, prueferId, istAdmin, onFertig }: { pruefungId: string; prueferId: string; istAdmin: boolean; onFertig: () => void }) {
  const [grund, setGrund] = useState('')
  const [korrektur, setKorrektur] = useState(prueferId)
  const [pruefer, setPruefer] = useState<{ id: string; name: string }[]>([])
  const [fehler, setFehler] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  // Admin: die Korrektur kann ein anderer Prüfer übernehmen (z. B. wenn der Prüfer nicht verfügbar ist)
  useEffect(() => {
    if (!istAdmin) return
    void supabase.from('benutzer').select('id, name').eq('aktiv', true).order('name')
      .then(({ data }) => setPruefer(data ?? []))
  }, [istAdmin])
  const oeffnen = async () => {
    if (!grund.trim()) return setFehler(t('Bitte den Grund angeben.'))
    setLaeuft(true)
    setFehler('')
    try { await wiederOeffnen(pruefungId, grund.trim(), korrektur !== prueferId ? korrektur : undefined); onFertig() } catch (e) { setFehler(fehlertext(e)) } finally { setLaeuft(false) }
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">{t('Die Prüfung wird als neue Revision geöffnet; das bisherige Protokoll bleibt als „ersetzt“ erhalten. Alle Unterschriften erlöschen – Mitprüfer melden ihren Teil neu fertig, Prüfer und Kunde unterschreiben beim Abschluss neu.')}</p>
      <div><label htmlFor="grund">{t('Grund *')}</label><textarea id="grund" rows={2} value={grund} onChange={(e) => setGrund(e.target.value)} /></div>
      {istAdmin && pruefer.length > 1 && (
        <div>
          <label htmlFor="korrektur">{t('Korrektur durch')}</label>
          <Auswahl id="korrektur" value={korrektur} onChange={(e) => setKorrektur(e.target.value)}>
            {pruefer.map((b) => <option key={b.id} value={b.id}>{b.name}{b.id === prueferId ? ` ${t('(bisheriger Prüfer)')}` : ''}</option>)}
          </Auswahl>
          {korrektur !== prueferId && <p className="mt-1 text-xs text-slate-500">{t('Der bisherige Prüfer bleibt als Mitprüfer beteiligt und meldet seinen Teil neu fertig.')}</p>}
        </div>
      )}
      <Fehler text={fehler} />
      <div className="flex justify-end gap-2">
        <button className="btn-sekundaer" onClick={onFertig}>{t('Abbrechen')}</button>
        <button className="btn-primaer" disabled={laeuft || !navigator.onLine} onClick={() => void oeffnen()}>{t('Wieder öffnen')}</button>
      </div>
    </div>
  )
}

/** Doppelprüfung (offline gleichzeitig geprüft): anzeigen und – für Beteiligte und Admins – klären, welche gilt. */
export function Doppelpruefung({ pruefung, gruppe, name, darf }: { pruefung: Pruefung; gruppe: Pruefung[]; name: (id: string) => string; darf: boolean }) {
  const [fehler, setFehler] = useState('')
  const offen = gruppe.some((p) => (p.server_status ?? p.status) === 'duplikat' && !p.duplikat_geklaert)
  return (
    <div role="alert" className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <p>{tb('Diese Tür wurde gleichzeitig auch von einem Kollegen geprüft (offline). ')}
        {!offen ? t('Geklärt: Diese Prüfung zählt nicht.') : darf ? t('Welche Prüfung gilt?') : t('Die beteiligten Prüfer oder ein Admin klären, welche gilt.')}</p>
      {offen && darf && (
        <div className="flex flex-wrap gap-2">
          {gruppe.map((p) => (
            <button key={p.id} className="btn-sekundaer" disabled={!navigator.onLine} onClick={async () => {
              setFehler('')
              try { await duplikatAufloesen(p.id) } catch (e) { setFehler(fehlertext(e)) }
            }}>
              {p.id === pruefung.id ? t('Diese {name}', { name: name(p.pruefer_id) }) : t('Die von {name}', { name: name(p.pruefer_id) })}{p.ergebnis ? ` · ${AMPEL_TEXT[p.ergebnis]}` : ` · ${t('läuft noch')}`}
            </button>
          ))}
        </div>
      )}
      <Fehler text={fehler} />
    </div>
  )
}

/** Grund erfassen, z. B. warum eine Tür einer Türanlage nicht geprüft werden konnte. */
export function GrundDialog({ titel, text, knopf, onSpeichern, onSchliessen }: {
  titel: string
  text: string
  knopf: string
  onSpeichern: (grund: string) => Promise<void>
  onSchliessen: () => void
}) {
  const [grund, setGrund] = useState('')
  const [fehler, setFehler] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  const speichern = async () => {
    if (!grund.trim()) return setFehler(t('Bitte den Grund angeben.'))
    setLaeuft(true)
    try { await onSpeichern(grund.trim()); onSchliessen() } catch (e) { setFehler(fehlertext(e)) } finally { setLaeuft(false) }
  }
  return (
    <div className="space-y-3" aria-label={titel}>
      <p className="text-sm text-slate-600">{text}</p>
      <div><label htmlFor="grund-nicht-geprueft">{t('Grund *')}</label>
        <textarea id="grund-nicht-geprueft" rows={2} value={grund} placeholder={t('z. B. verschlossen, kein Zugang')} onChange={(e) => setGrund(e.target.value)} /></div>
      <Fehler text={fehler} />
      <div className="flex justify-end gap-2">
        <button className="btn-sekundaer" onClick={onSchliessen}>{t('Abbrechen')}</button>
        <button className="btn-primaer" disabled={laeuft} onClick={() => void speichern()}>{knopf}</button>
      </div>
    </div>
  )
}
