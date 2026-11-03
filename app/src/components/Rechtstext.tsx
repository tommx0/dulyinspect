import { useEffect, useState, type ReactNode } from 'react'
import { SpracheUmschalter } from './SpracheUmschalter'
import { t } from '../lib/sprache'
import { Logo } from './Logo'
import { bloecke, linkZiel, RECHTSTEXT_TITEL, verlinken, type Rechtstext, type RechtstextArt } from '../lib/rechtstext'
import { ausCache, rechtsLinksBeobachten, rechtstextLaden, webadressenLaden } from '../lib/rechtstextLaden'
import { RechtstextHtml } from './RechtstextHtml'
import { LIZENZBEDINGUNGEN, LIZENZBEDINGUNGEN_STAND } from '../lib/lizenzbedingungen'
import { LIZENZ_LINK, LIZENZ_NAME } from '../lib/entwickler'
import { fehlertext } from '../lib/supabase'

/** Impressum/Datenschutz als formatierter Text (ohne HTML aus der Datenbank). */
export function RechtstextInhalt({ text }: { text: string }) {
  return (
    <div className="space-y-3 leading-relaxed">
      {bloecke(text).map((b, i) => {
        if (b.typ === 'ueberschrift') {
          return b.ebene === 2
            ? <h2 key={i} className="pt-2 text-lg font-semibold">{b.text}</h2>
            : <h3 key={i} className="pt-1 font-semibold">{b.text}</h3>
        }
        if (b.typ === 'liste') return <ul key={i} className="list-disc space-y-1 pl-6">{b.punkte.map((p, j) => <li key={j}><Zeile text={p} /></li>)}</ul>
        return <p key={i}>{b.zeilen.map((z, j) => <span key={j}>{j > 0 && <br />}<Zeile text={z} /></span>)}</p>
      })}
    </div>
  )
}

function Zeile({ text }: { text: string }) {
  return <>{verlinken(text).map((t, i) => t.link
    ? <a key={i} className="link break-all" href={t.link} target={t.link.startsWith('mailto:') ? undefined : '_blank'} rel="noopener noreferrer">{t.text}</a>
    : <span key={i}>{t.text}</span>)}</>
}

type Seite = RechtstextArt | 'lizenzbedingungen' | 'lizenzen'

function seiteAusHash(): Seite | null {
  const h = window.location.hash
  return h === '#/impressum' ? 'impressum' : h === '#/datenschutz' ? 'datenschutz'
    : h === '#/lizenzbedingungen' ? 'lizenzbedingungen' : h === '#/lizenzen' ? 'lizenzen' : null
}

/**
 * Impressum/Datenschutz/Lizenzbedingungen/Open-Source-Lizenzen über #/impressum, #/datenschutz, #/lizenzbedingungen bzw. #/lizenzen
 * – auch ohne Anmeldung und im Wartungsmodus.
 * Liegt als Vollbild über der App, damit eine laufende Prüfung dahinter nicht neu geladen wird.
 */
export function RechtstextHost() {
  const [seite, setSeite] = useState(seiteAusHash)
  // Direkt aufgerufen (z. B. Link aus einer E-Mail) → „Zurück“ führt zur App, nicht auf die vorige Website
  const [vonInnen, setVonInnen] = useState(false)
  useEffect(() => {
    const h = () => { setSeite(seiteAusHash()); setVonInnen(true) }
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])
  if (!seite) return null
  if (seite === 'lizenzen') return <LizenzSeite vonInnen={vonInnen} />
  if (seite === 'lizenzbedingungen') return <LizenzbedingungenSeite vonInnen={vonInnen} />
  return <RechtstextSeite key={seite} art={seite} vonInnen={vonInnen} />
}

/** Vollbild mit Logo, „Zurück“ und den Rechtslinks unten. */
function Vollbild({ titel, vonInnen, children }: { titel: string; vonInnen: boolean; children: ReactNode }) {
  const zurueck = () => {
    if (vonInnen) window.history.back()
    else window.location.hash = '#/'
  }
  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-stone-50" role="dialog" aria-modal="true" aria-labelledby="rechtstext-titel">
      <div className="mx-auto max-w-3xl space-y-4 p-4 pb-12">
        <div className="flex items-center justify-between gap-4 border-b-4 border-akzent pb-3">
          <Logo className="h-10 w-auto max-w-56 object-contain" />
          <button className="btn-sekundaer" onClick={zurueck}>{t('← Zurück')}</button>
        </div>
        <h1 id="rechtstext-titel" className="text-2xl font-bold">{titel}</h1>
        {children}
        <RechtsLinks />
      </div>
    </div>
  )
}

function RechtstextSeite({ art, vonInnen }: { art: RechtstextArt; vonInnen: boolean }) {
  const [text, setText] = useState<Rechtstext | undefined>(() => ausCache(art))
  const [fehler, setFehler] = useState('')

  useEffect(() => {
    let aktiv = true
    rechtstextLaden(art).then((t) => { if (aktiv) setText(t) }, (e) => { if (aktiv) setFehler(fehlertext(e)) })
    return () => { aktiv = false }
  }, [art])
  const adresse = linkZiel(text)

  return (
    <Vollbild titel={RECHTSTEXT_TITEL[art]} vonInnen={vonInnen}>
      {adresse ? (
        <p className="karte p-5">
          {t('{titel} finden Sie unter', { titel: RECHTSTEXT_TITEL[art] })}{' '}
          <a className="link break-all" href={adresse} target="_blank" rel="noopener noreferrer">{adresse}</a>
        </p>
      ) : text?.inhalt ? (
        <div className="karte p-5">
          {text.format === 'html' ? <RechtstextHtml html={text.inhalt} /> : <RechtstextInhalt text={text.inhalt} />}
        </div>
      ) : text === undefined && !fehler ? <p className="text-slate-500">{t('Laden …')}</p>
        : <p className="karte p-5 text-slate-600">{fehler ? t('Der Text konnte nicht geladen werden ({fehler}).', { fehler }) : t('Noch nicht hinterlegt.')}</p>}
    </Vollbild>
  )
}

/** Lizenzbedingungen des Entwicklers (für alle Instanzen gleich, siehe lib/lizenzbedingungen.ts). */
function LizenzbedingungenSeite({ vonInnen }: { vonInnen: boolean }) {
  // Freie Fassung (VITE_LIZENZ_LINK): Verweis auf die Lizenz im Repository statt der Bedingungen des Entwicklers
  if (LIZENZ_LINK) {
    const [vorName, nachName] = t('Diese Fassung von DulyInspect ist freie Software unter der {lizenz}.').split('{lizenz}')
    return (
      <Vollbild titel={t('Lizenz')} vonInnen={vonInnen}>
        <div className="karte space-y-3 p-5 text-sm">
          <p>{vorName}<b>{LIZENZ_NAME}</b>{nachName}</p>
          <p><a className="link" href={LIZENZ_LINK} target="_blank" rel="noopener noreferrer">{t('Lizenztext und Quellcode')}</a></p>
          <p className="border-t border-slate-100 pt-3 text-slate-500"><a className="link" href="#/lizenzen">{t('Verwendete Open-Source-Software')}</a></p>
        </div>
      </Vollbild>
    )
  }
  return (
    <Vollbild titel={t('Lizenzbedingungen')} vonInnen={vonInnen}>
      <div className="karte p-5">
        <RechtstextInhalt text={LIZENZBEDINGUNGEN} />
        <p className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-500">
          {t('Stand: {stand}', { stand: LIZENZBEDINGUNGEN_STAND })} · <a className="link" href="#/lizenzen">{t('Verwendete Open-Source-Software')}</a>
        </p>
      </div>
    </Vollbild>
  )
}

/** Eintrag aus lizenzen.json (beim Build erzeugt, scripts/lizenzen.ts) – bewusst ohne Versionsnummer. */
type Lizenz = { name: string; lizenz: string; link: string; text: string | null }

/** Verwendete Open-Source-Software mit Lizenz, Projektseite und Lizenztext. */
function LizenzSeite({ vonInnen }: { vonInnen: boolean }) {
  const [liste, setListe] = useState<Lizenz[] | null>(null)
  const [fehler, setFehler] = useState(false)
  useEffect(() => {
    let aktiv = true
    fetch('./lizenzen.json')
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<Lizenz[]> })
      .then((l) => { if (aktiv) setListe(l) }, () => { if (aktiv) setFehler(true) })
    return () => { aktiv = false }
  }, [])

  return (
    <Vollbild titel={t('Open-Source-Lizenzen')} vonInnen={vonInnen}>
      <p className="text-slate-600">
        {t('Diese Anwendung verwendet die folgende Open-Source-Software. Vielen Dank an alle, die daran mitarbeiten. Die Lizenztexte stehen jeweils unter dem Eintrag.')}
      </p>
      <p className="text-sm text-slate-600">
        {t('Sicherheitslücken melden:')} <a className="link" href="./sicherheit.txt" target="_blank" rel="noopener noreferrer">{t('Richtlinie')}</a>
      </p>
      {liste ? (
        <ul className="karte divide-y divide-slate-100">
          {liste.map((p, i) => (
            <li key={`${p.name}-${i}`} className="space-y-1 px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <a className="link font-medium break-all" href={p.link} target="_blank" rel="noopener noreferrer">{p.name}</a>
                <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">{p.lizenz}</span>
              </div>
              {p.text ? (
                <details>
                  <summary className="cursor-pointer text-sm text-slate-500 hover:text-slate-700">{t('Lizenztext')}</summary>
                  <pre className="mt-2 max-h-80 overflow-auto rounded bg-slate-50 p-3 text-xs whitespace-pre-wrap text-slate-700">{p.text}</pre>
                </details>
              ) : <p className="text-sm text-slate-500">{t('Lizenztext auf der Projektseite')}</p>}
            </li>
          ))}
        </ul>
      ) : fehler ? <p className="karte p-5 text-slate-600">{t('Die Liste konnte nicht geladen werden. Sie ist nur mit Internetverbindung verfügbar.')}</p>
        : <p className="text-slate-500">{t('Laden …')}</p>}
    </Vollbild>
  )
}

/** Kleine Fußzeile mit Links auf Impressum, Datenschutz, Lizenzbedingungen, Open-Source-Lizenzen und optional die Anleitung. */
export function RechtsLinks({ mitHilfe = false, className = '' }: { mitHilfe?: boolean; className?: string }) {
  const [ziele, setZiele] = useState<Record<RechtstextArt, string | null>>(() =>
    ({ impressum: linkZiel(ausCache('impressum')), datenschutz: linkZiel(ausCache('datenschutz')) }))
  useEffect(() => {
    let aktiv = true
    const laden = () => void webadressenLaden().then((z) => { if (aktiv) setZiele(z) })
    laden()
    const beenden = rechtsLinksBeobachten(laden)
    return () => { aktiv = false; beenden() }
  }, [])
  const link = (art: RechtstextArt, text: string) => ziele[art]
    ? <a className="hover:underline" href={ziele[art]!} target="_blank" rel="noopener noreferrer">{text}</a>
    : <a className="hover:underline" href={`#/${art}`}>{text}</a>
  return (
    <p className={`flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-slate-500 ${className}`}>
      {link('impressum', t('Impressum'))}
      {link('datenschutz', t('Datenschutz'))}
      <a className="hover:underline" href="#/lizenzbedingungen">{LIZENZ_LINK ? t('Lizenz') : t('Lizenzbedingungen')}</a>
      <a className="hover:underline" href="#/lizenzen">{t('Open Source')}</a>
      {mitHilfe && <a className="hover:underline" href="./anleitung/index.html" target="_blank" rel="noopener">{t('Bedienungsanleitung')}</a>}
      <SpracheUmschalter />
    </p>
  )
}
