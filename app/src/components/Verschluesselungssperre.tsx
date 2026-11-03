// Sperrbildschirm und Hinweise der Verschlüsselung (docs/KONZEPT-VERSCHLUESSELUNG.md, „Trennung der Mandanten“,
// „Abgang eines Mitarbeiters“). Eingebunden in src/auth.tsx: Solange das Gerät keinen passenden Schlüssel hat, die
// Instanz nicht passt, ein anderer Admin den Schlüssel tauscht oder das Gerät nach einer Abschaltung seine Daten
// entschlüsselt, ist sonst nichts von der App zu sehen.
import { lazy, Suspense, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useRestoreStand } from '../datensicherung/restoreStand'
import { gebietsschema, t, tMeldung } from '../lib/sprache'
import {
  STICHTAG, SchluesselFehler, einrichten, entsperrenVersuchen, fristStand, geraetLeerenSchluesselBehalten, neuEinrichtenMoeglich, pruefen,
  schluesselEinlesen, schluesselEntfernen, useBlattOffen, useVerschluesselung, type Zustand,
} from '../lib/verschluesselung/schluessel'
import { bestaetigen } from './Bestaetigung'
import { RestoreBerichtAnzeige } from './RestoreBericht'

const QrScanner = lazy(() => import('./QrScanner'))

const datum = (ms: number) => new Date(ms).toLocaleDateString(gebietsschema(), { day: 'numeric', month: 'long', year: 'numeric' })

function Rahmen({ titel, children }: { titel: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="sperre-titel" className="karte w-full max-w-md space-y-4 p-6" data-verschluesselung-sperre>
        <h1 id="sperre-titel" className="text-lg font-bold text-marke">{titel}</h1>
        {children}
      </div>
    </div>
  )
}

/** Schlüsselblatt scannen oder abtippen. Prüft Instanz und Prüfwert gegen den Server (schluesselEinlesen). */
function SchluesselScannen({ systemadmin, onFertig }: { systemadmin: boolean; onFertig?: () => void }) {
  const [kamera, setKamera] = useState(false)
  const [versuch, setVersuch] = useState(0)
  const [text, setText] = useState('')
  const [fehler, setFehler] = useState('')
  const [laeuft, setLaeuft] = useState(false)

  const einlesen = async (inhalt: string) => {
    setLaeuft(true)
    setFehler('')
    try {
      await schluesselEinlesen(inhalt, { systemadmin })
      onFertig?.()
    } catch (e) {
      setFehler(e instanceof SchluesselFehler ? tMeldung(e.message) : t('Der Schlüssel ließ sich nicht einlesen: {fehler}', { fehler: (e as Error).message }))
      setVersuch((n) => n + 1)  // Kamera neu starten
    } finally {
      setLaeuft(false)
    }
  }

  const absenden = (e: FormEvent) => {
    e.preventDefault()
    if (text.trim()) void einlesen(text)
  }

  return (
    <div className="space-y-3">
      {kamera ? (
        <Suspense fallback={<p className="text-sm text-slate-600">{t('Kamera wird geladen …')}</p>}>
          <QrScanner key={versuch} roh onErkannt={(inhalt) => void einlesen(inhalt)} anleitung={t('QR-Code des Schlüsselblatts in den gelben Rahmen halten.')} />
        </Suspense>
      ) : (
        <button className="btn-primaer w-full" onClick={() => setKamera(true)} disabled={laeuft}>{t('Schlüsselblatt scannen')}</button>
      )}
      <form onSubmit={absenden} className="space-y-2">
        <label htmlFor="schluessel-text">{t('Oder den Schlüssel vom Blatt abtippen')}</label>
        <textarea id="schluessel-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} autoCapitalize="characters"
          autoComplete="off" autoCorrect="off" spellCheck={false} className="font-mono" placeholder="XXXX XXXX XXXX …" />
        <button className="btn-sekundaer w-full" disabled={laeuft || !text.trim()}>{laeuft ? t('Wird geprüft …') : t('Schlüssel übernehmen')}</button>
      </form>
      {fehler && <p role="alert" className="text-sm text-red-700">{fehler}</p>}
    </div>
  )
}

/**
 * Admin ohne Blatt, solange noch nichts verschlüsselt ist (z. B. Browserspeicher gelöscht, bevor das Blatt gedruckt war): neuen
 * Schlüssel einrichten. Danach erscheint unter Einstellungen das neue Blatt zur Bestätigung.
 */
function NeuEinrichten() {
  const [moeglich, setMoeglich] = useState<{ ersetzen: boolean } | null>(null)
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState('')
  useEffect(() => {
    let aktiv = true
    void neuEinrichtenMoeglich().then((m) => { if (aktiv) setMoeglich(m) }).catch(() => undefined)
    return () => { aktiv = false }
  }, [])
  if (!moeglich) return null
  const los = async () => {
    setLaeuft(true); setFehler('')
    try { await einrichten(moeglich) } catch (e) { setFehler(e instanceof SchluesselFehler ? tMeldung(e.message) : (e as Error).message) } finally { setLaeuft(false) }
  }
  return (
    <div className="space-y-2 border-t border-slate-100 pt-3" data-neu-einrichten>
      <p className="text-sm text-slate-700">
        {t('Kein Schlüsselblatt zur Hand? Solange noch nichts verschlüsselt ist, lässt sich die Verschlüsselung neu einrichten. Ein altes Blatt gilt dann nicht mehr.')}
      </p>
      <button className="btn-sekundaer" disabled={laeuft} onClick={() => void los()}>{laeuft ? t('Wird eingerichtet …') : t('Neu einrichten')}</button>
      {fehler && <p role="alert" className="text-sm text-red-700">{fehler}</p>}
    </div>
  )
}

/** Laufende bzw. gerade beendete Wiederherstellung (sie hat die Kennung eingerichtet und das Gerät damit gesperrt). */
function Wiederherstellung() {
  const r = useRestoreStand()
  if (!r.laeuft && !r.bericht && !r.fehler) return null
  return (
    <div className="space-y-2 border-t border-slate-100 pt-3" data-sperre-restore>
      <h2 className="font-semibold">{t('Wiederherstellung')}</h2>
      {r.laeuft && <p role="status" aria-live="polite" className="text-sm text-sky-900">{r.fortschritt || t('Läuft …')}</p>}
      {r.bericht && <RestoreBerichtAnzeige bericht={r.bericht} />}
      {r.fehler && <p role="alert" className="text-sm text-red-700">{r.fehler}</p>}
    </div>
  )
}

/** Abgeschaltet, Schlüssel fehlt: noch nicht übertragene (verschlüsselte) Änderungen verwerfen statt das alte Blatt zu scannen */
function GespeichertesVerwerfen() {
  const [laeuft, setLaeuft] = useState(false)
  const verwerfen = async () => {
    if (!await bestaetigen(t('Gespeicherte Änderungen verwerfen?\n\nWas auf diesem Gerät noch nicht übertragen ist (Prüfungen, Fotos, Unterschriften), geht verloren. Mit dem bisherigen Schlüsselblatt lässt es sich stattdessen noch übertragen.'),
      { ok: t('Verwerfen'), gefahr: true })) return
    setLaeuft(true)
    try {
      await geraetLeerenSchluesselBehalten({ auchOutbox: true })
      // auch ein alter Schlüssel, der nicht mehr gilt
      await schluesselEntfernen({ auchUnbestaetigt: true })
      await pruefen()
    } finally {
      setLaeuft(false)
    }
  }
  return <button className="btn-sekundaer" disabled={laeuft} onClick={() => void verwerfen()} data-gespeichertes-verwerfen>{t('Gespeicherte Änderungen verwerfen')}</button>
}

function ErneutPruefen() {
  const [laeuft, setLaeuft] = useState(false)
  return (
    <button className="btn-primaer" disabled={laeuft} onClick={() => { setLaeuft(true); void entsperrenVersuchen().finally(() => setLaeuft(false)) }}>
      {laeuft ? t('Wird geprüft …') : t('Erneut prüfen')}
    </button>
  )
}

/**
 * Sperrbildschirm für alle Zustände außer „aus“ und „bereit“ (bei „pflicht“ nur für Prüfer – Admins müssen die
 * Verschlüsselung einrichten können). Zeigt nie Daten der App.
 */
export function Verschluesselungssperre({ zustand, systemadmin, onAbmelden }: { zustand: Zustand; systemadmin: boolean; onAbmelden: () => void }) {
  const [tauschUebernehmen, setTauschUebernehmen] = useState(false)
  const restore = useRestoreStand()
  const abmelden = <button className="btn-sekundaer" onClick={onAbmelden}>{t('Abmelden')}</button>

  switch (zustand.art) {
    case 'scannen':
      return (
        <Rahmen titel={t('Schlüssel scannen')}>
          <p className="text-sm text-slate-700">
            {zustand.grund === 'abgeschaltet' ? t('Die Verschlüsselung dieser Instanz wurde abgeschaltet. Auf diesem Gerät liegen aber noch verschlüsselte, nicht übertragene Änderungen. Bitte einmal das bisherige Schlüsselblatt scannen – dann werden sie entschlüsselt und übertragen.')
              : zustand.grund === 'getauscht' ? t('Der Schlüssel dieser Instanz wurde getauscht. Bitte das neue Schlüsselblatt scannen.')
              : zustand.grund === 'frist' ? t('Dieses Gerät war 14 Tage ohne Verbindung zum Server. Der Schlüssel wurde deshalb vom Gerät gelöscht. Bitte das Schlüsselblatt erneut scannen.')
                : t('Kunden, Objekte, Fotos und Protokolle sind verschlüsselt. Bitte einmal auf diesem Gerät das Schlüsselblatt scannen. Es liegt beim Administrator.')}
          </p>
          <SchluesselScannen systemadmin={systemadmin} />
          {systemadmin && zustand.grund === 'fehlt' && !restore.laeuft && !restore.bericht && <NeuEinrichten />}
          {zustand.grund === 'abgeschaltet' && <GespeichertesVerwerfen />}
          {systemadmin && <Wiederherstellung />}
          <div className="border-t border-slate-100 pt-3">{abmelden}</div>
        </Rahmen>
      )
    case 'falsche_instanz':
      return (
        <Rahmen titel={t('Daten gesperrt')}>
          <p className="text-sm text-slate-700">
            {t('Der Server passt nicht zum Schlüssel dieses Geräts. Zum Schutz der Daten zeigt die App nichts an und überträgt nichts.')}
          </p>
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{tMeldung(zustand.grund)}</p>
          <p className="text-sm text-slate-600">{t('Bitte den Administrator informieren, wenn das wieder auftritt.')}</p>
          <div className="flex flex-wrap gap-3"><ErneutPruefen />{abmelden}</div>
        </Rahmen>
      )
    case 'tausch':
      return (
        <Rahmen titel={t('Schlüssel wird getauscht')}>
          <p className="text-sm text-slate-700">
            {t('Ein Administrator tauscht gerade den Schlüssel. Bis er fertig ist, ist die App gesperrt, und es wird nichts übertragen. Danach bitte das neue Schlüsselblatt scannen.')}
          </p>
          <div className="flex flex-wrap gap-3"><ErneutPruefen />{abmelden}</div>
          {systemadmin && (tauschUebernehmen ? (
            <div className="space-y-2 border-t border-slate-100 pt-3">
              <p className="text-sm text-slate-700">{t('Tausch übernehmen (z. B. wenn das Gerät des anderen Admins ausgefallen ist): das neue Schlüsselblatt scannen.')}</p>
              <SchluesselScannen systemadmin />
            </div>
          ) : (
            <button className="text-sm text-marke underline" onClick={() => setTauschUebernehmen(true)}>{t('Als Admin den Tausch übernehmen …')}</button>
          ))}
        </Rahmen>
      )
    case 'abgeschaltet':
      return (
        <Rahmen titel={t('Verschlüsselung abgeschaltet')}>
          <p role="status" className="text-sm text-slate-700">
            {t('Ein Administrator hat die Verschlüsselung abgeschaltet. Dieses Gerät entschlüsselt gerade seine gespeicherten Daten und löscht danach den Schlüssel.')}
          </p>
          <div className="flex flex-wrap gap-3"><ErneutPruefen />{abmelden}</div>
        </Rahmen>
      )
    case 'pflicht':
      return (
        <Rahmen titel={t('Verschlüsselung fehlt')}>
          <p className="text-sm text-slate-700">
            {t('Auf dieser Instanz ist die Verschlüsselung noch nicht eingerichtet. Seit dem Stichtag lässt sich die App so nicht mehr nutzen. Bitte den Administrator informieren.')}
          </p>
          <div className="flex flex-wrap gap-3"><ErneutPruefen />{abmelden}</div>
        </Rahmen>
      )
    default:
      return <div className="flex min-h-dvh items-center justify-center p-6">{t('Laden …')}</div>
  }
}

/** Hinweise über der App: Frist ohne Serverkontakt läuft ab, Verschlüsselung bis zum Stichtag einrichten (Admins). */
export function VerschluesselungHinweis({ systemadmin }: { systemadmin: boolean }) {
  const z = useVerschluesselung()
  const offen = useBlattOffen()
  const frist = fristStand(z)
  if (offen && systemadmin) {
    const [vorLink, nachLink] = t('Bitte unter {link} drucken und bestätigen.').split('{link}')
    return (
      <div role="alert" className="bg-red-100 px-4 py-2 text-center text-sm font-medium text-red-900" data-verschluesselung-blatt-offen>
        {offen === 'tausch'
          ? t('Das neue Schlüsselblatt ist noch nicht als verwahrt bestätigt – bis dahin hat nur dieses Gerät den Schlüssel.')
          : t('Das Schlüsselblatt ist noch nicht als verwahrt bestätigt – bis dahin hat nur dieses Gerät den Schlüssel.')}
        {' '}{vorLink}<a href="#/einstellungen/verschluesselung" className="underline">{t('Einstellungen → Verschlüsselung')}</a>{nachLink}
      </div>
    )
  }
  if (z.art === 'bereit' && z.abschaltung) {
    return (
      <div role="status" className="bg-sky-100 px-4 py-2 text-center text-sm text-sky-900" data-verschluesselung-abschaltung>
        {t('Ein Administrator schaltet die Verschlüsselung gerade ab. Neue Daten werden schon unverschlüsselt gespeichert.')}
      </div>
    )
  }
  if (frist?.warnen) {
    return (
      <div role="status" className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900" data-verschluesselung-frist>
        {t('Dieses Gerät hatte länger keine Verbindung zum Server. Am {datum} wird der Schlüssel vom Gerät gelöscht – bitte vorher einmal online gehen.', { datum: datum(frist.ablaufAm) })}
      </div>
    )
  }
  if (systemadmin && (z.art === 'pflicht' || (z.art === 'aus' && STICHTAG))) {
    return (
      <div role="status" className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
        {STICHTAG
          ? t('Die Verschlüsselung ist noch nicht eingerichtet (Pflicht ab {datum}). Bitte unter Einstellungen → Verschlüsselung einrichten.', { datum: datum(Date.parse(STICHTAG)) })
          : t('Die Verschlüsselung ist noch nicht eingerichtet. Bitte unter Einstellungen → Verschlüsselung einrichten.')}
      </div>
    )
  }
  return null
}
