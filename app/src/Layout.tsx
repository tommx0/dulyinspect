import { useEffect, useId, useRef, useState } from 'react'
import {
  Building2, CalendarClock, ChevronDown, CircleHelp, ClipboardCheck, Contact, DatabaseBackup, DoorOpen, EyeOff, FileText, House,
  ListChecks, Menu, QrCode, ScrollText, Settings, Shapes, Table, TriangleAlert, UserCog, Users, X, type LucideIcon,
} from 'lucide-react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useAuth } from './auth'
import { DemoAbgleich, DemoBanner } from './components/Demo'
import { Logo } from './components/Logo'
import { RechtsLinks } from './components/Rechtstext'
import { SyncAnzeige } from './components/SyncAnzeige'
import { ENTWICKLER, ENTWICKLER_ZEIGEN } from './lib/entwickler'
import { VORSCHAU, VORSCHAU_FUSSZEILE } from './lib/vorschau'
import { useAusgeblendet, type Bereich } from './lib/menue'
import { anlagenartenLaden, tb, useAnlagenarten } from './lib/begriffe'
import { t } from './lib/sprache'
import { mandantencodeLaden } from './lib/mandantencode'
import { eigeneSachkundeLaden } from './lib/sachkunde'
import { syncStarten } from './offline/sync'
import { useSchemaStand } from './lib/schemaStand'

// Bedienungsanleitung (statische Seite in public/anleitung/, nicht im Offline-Cache)
const HILFE = './anleitung/index.html'

type Punkt = { zu: string; text: string; info: string; symbol: LucideIcon; ende?: boolean; extern?: boolean; bereich?: Bereich }
type Gruppe = { gruppe: string; punkte: Punkt[] }
type Eintrag = Punkt | Gruppe

/** Menü je Rolle: Prüfer sehen nie „Verwaltung“ und „System“; Admin/Planer können Punkte für Prüfer ausblenden. */
function menue(istAdmin: boolean, systemSichtbar: boolean, ausgeblendet: Bereich[]): Eintrag[] {
  const alle: Eintrag[] = [
    { zu: '/', text: t('Start'), info: t('Fällige Prüfungen und Überblick'), symbol: House, ende: true },
    { zu: '/pruefen', text: t('Prüfen'), info: tb('Tür prüfen, Arbeitsliste'), symbol: ClipboardCheck },
    { gruppe: t('Übersicht'), punkte: [
      { zu: '/faelligkeiten', text: t('Fälligkeiten'), info: tb('Fällige und überfällige Türen'), symbol: CalendarClock, bereich: 'faelligkeiten' },
      { zu: '/maengel', text: t('Mängel'), info: t('Offene Mängel über alle Kunden'), symbol: TriangleAlert, bereich: 'maengel' },
      { zu: '/protokolle', text: t('Protokolle'), info: t('Prüfprotokolle ansehen und laden'), symbol: FileText },
      { zu: '/kunden', text: t('Kunden'), info: t('Kunden, Objekte, Ansprechpartner'), symbol: Users, bereich: 'kunden' },
    ] },
    ...(istAdmin ? [{ gruppe: t('Verwaltung'), punkte: [
      { zu: '/kundenliste', text: t('Kundenliste'), info: t('Kunden anlegen und bearbeiten'), symbol: Contact },
      { zu: '/objektliste', text: t('Objekte'), info: t('Gebäude und Standorte'), symbol: Building2 },
      { zu: '/anlagen', text: tb('Türen'), info: tb('Türen anlegen und importieren'), symbol: DoorOpen },
      { zu: '/anlagentypen', text: tb('Türtypen'), info: t('Bauarten und ihre Checklisten'), symbol: Shapes },
      { zu: '/checklisten', text: t('Checklisten'), info: t('Prüfpunkte zusammenstellen'), symbol: ListChecks },
      { zu: '/etiketten', text: t('Etiketten'), info: t('QR-Etiketten erzeugen und drucken'), symbol: QrCode },
      { zu: '/menue-pruefer', text: t('Menü für Prüfer'), info: t('Bereiche für Prüfer ausblenden'), symbol: EyeOff },
    ] }] : []),
    ...(systemSichtbar ? [{ gruppe: t('System'), punkte: [
      { zu: '/benutzer', text: t('Benutzer'), info: t('Konten und Rollen'), symbol: UserCog },
      { zu: '/gesamtliste', text: t('Gesamtliste'), info: t('Alle Daten in einer Tabelle'), symbol: Table },
      { zu: '/einstellungen', text: t('Einstellungen'), info: t('Erscheinungsbild, Arten, Lizenz'), symbol: Settings },
      { zu: '/datensicherung', text: t('Datensicherung'), info: t('Sichern und wiederherstellen'), symbol: DatabaseBackup },
      { zu: '/logdateien', text: t('Logdateien'), info: t('Ereignisse des Servers'), symbol: ScrollText },
    ] }] : []),
    { zu: HILFE, text: t('Hilfe'), info: t('Bedienungsanleitung (neues Fenster)'), symbol: CircleHelp, extern: true, bereich: 'hilfe' },
  ]
  const sichtbar = (p: Punkt) => !p.bereich || !ausgeblendet.includes(p.bereich)
  return alle.flatMap((e): Eintrag[] => {
    if (!('gruppe' in e)) return sichtbar(e) ? [e] : []
    const punkte = e.punkte.filter(sichtbar)
    // Gruppe mit nur einem Eintrag direkt anzeigen, leere weglassen
    return punkte.length > 1 ? [{ ...e, punkte }] : punkte
  })
}

const linkKlasse = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium [&>svg]:size-4 ${isActive ? 'bg-akzent text-marke' : 'text-slate-700 hover:bg-akzent-hell'}`

/** Punkt in der Menüleiste (PC). */
function MenuePunkt({ p }: { p: Punkt }) {
  const inhalt = <><p.symbol strokeWidth={2} aria-hidden />{p.text}</>
  return p.extern
    ? <a href={p.zu} target="_blank" rel="noopener" className={linkKlasse({ isActive: false })}>{inhalt}</a>
    : <NavLink to={p.zu} end={p.ende} className={linkKlasse}>{inhalt}</NavLink>
}

/** Kachel im Menü: ganze Fläche klickbar (Link über die Kachel gespannt), Kurztext als Beschreibung des Links. */
function MenueKachel({ p }: { p: Punkt }) {
  const id = useId()
  const klasse = "font-semibold text-marke outline-none after:absolute after:inset-0 after:rounded-xl"
  return (
    <li className="group relative flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-slate-300 hover:bg-akzent-hell/40 hover:shadow-md active:bg-akzent-hell sm:items-start has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-akzent has-aria-[current=page]:border-marke has-aria-[current=page]:bg-akzent-hell sm:p-4">
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-akzent-hell text-marke ring-1 ring-akzent ring-inset transition group-hover:bg-akzent group-has-aria-[current=page]:bg-akzent" aria-hidden>
        <p.symbol className="size-5" strokeWidth={1.75} />
      </span>
      <span className="min-w-0 leading-tight sm:pt-0.5">
        {p.extern
          ? <a href={p.zu} target="_blank" rel="noopener" aria-describedby={id} className={klasse}>{p.text}</a>
          : <NavLink to={p.zu} end={p.ende} aria-describedby={id} className={klasse}>{p.text}</NavLink>}
        <span id={id} className="mt-1 hidden text-xs text-slate-500 sm:block">{p.info}</span>
      </span>
    </li>
  )
}

function KachelRaster({ punkte }: { punkte: Punkt[] }) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
      {punkte.map((p) => <MenueKachel key={p.zu} p={p} />)}
    </ul>
  )
}

/** Gruppe in der Menüleiste (PC): öffnet ein Kachelfeld über die ganze Breite unter der Kopfzeile. */
function MenueGruppe({ g, offen, onUmschalten }: { g: Gruppe; offen: boolean; onUmschalten: () => void }) {
  const { pathname } = useLocation()
  const aktiv = g.punkte.some((p) => !p.extern && (pathname === p.zu || pathname.startsWith(`${p.zu}/`)))
  return (
    <div>
      <button type="button" aria-haspopup="true" aria-expanded={offen} onClick={onUmschalten}
        className={`${linkKlasse({ isActive: aktiv || offen })}`}>
        {g.gruppe}<ChevronDown strokeWidth={2} aria-hidden className={`transition ${offen ? 'rotate-180' : ''}`} />
      </button>
      {offen && (
        // absolut zur (sticky positionierten) Kopfzeile: volle Breite, Reihenfolge im Menü bleibt erhalten
        <div onClick={(e) => { if ((e.target as Element).closest('a')) onUmschalten() }}
          className="absolute inset-x-0 top-full border-b border-slate-200 bg-stone-50/95 shadow-lg backdrop-blur-sm">
          <div className="mx-auto max-w-5xl px-4 py-5">
            <div className="mb-3 text-xs font-semibold tracking-wider text-slate-500 uppercase">{g.gruppe}</div>
            <KachelRaster punkte={g.punkte} />
          </div>
        </div>
      )}
    </div>
  )
}

export function Layout() {
  const { benutzer, istAdmin, systemSichtbar, abmelden } = useAuth()
  const navigate = useNavigate()
  const [menueOffen, setMenueOffen] = useState(false)
  const [offeneGruppe, setOffeneGruppe] = useState<string | null>(null)
  const kopf = useRef<HTMLElement>(null)
  const { pathname } = useLocation()
  const ausgeblendet = useAusgeblendet()

  // Kachelfeld schließt bei Seitenwechsel (beim Rendern, ohne Effekt), Klick daneben und Escape
  const [pfad, setPfad] = useState(pathname)
  if (pfad !== pathname) { setPfad(pathname); setOffeneGruppe(null); setMenueOffen(false) }
  useEffect(() => {
    if (!offeneGruppe && !menueOffen) return
    const klick = (e: MouseEvent) => { if (!kopf.current?.contains(e.target as Node)) { setOffeneGruppe(null); setMenueOffen(false) } }
    const taste = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOffeneGruppe(null); setMenueOffen(false) } }
    document.addEventListener('mousedown', klick)
    document.addEventListener('keydown', taste)
    return () => { document.removeEventListener('mousedown', klick); document.removeEventListener('keydown', taste) }
  }, [offeneGruppe, menueOffen])

  useEffect(() => { syncStarten() }, [])
  // Eingeschaltete Anlagenarten (Begriffe Tür/Anlage) vom Server
  useEffect(() => { void anlagenartenLaden() }, [])
  // Eigener Mandantencode für den Scanner (fremde Etiketten ablehnen)
  useEffect(() => { void mandantencodeLaden() }, [])
  useEffect(() => { if (benutzer) void eigeneSachkundeLaden(benutzer.id) }, [benutzer])
  const arten = useAnlagenarten()
  const schemaStand = useSchemaStand()

  // QR-Code-Einstieg: ./?t=PK-0000427 → #/anlage/PK-0000427, Melder-Etikett ./?m=M4F7K2QXD3 → #/melder/M4F7K2QXD3;
  // der Mandantencode (&k=K7Q3X) geht mit, die Zielseite lehnt Etiketten anderer Instanzen ab
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const t = params.get('t')
    const m = params.get('m')
    const k = params.get('k')
    if (t || m) {
      window.history.replaceState(null, '', window.location.pathname + window.location.hash)
      const ziel = t ? `/anlage/${encodeURIComponent(t)}` : `/melder/${encodeURIComponent(m!)}`
      navigate(k ? `${ziel}?k=${encodeURIComponent(k)}` : ziel, { replace: true })
    }
  }, [navigate])

  const eintraege = menue(istAdmin, systemSichtbar, ausgeblendet)

  return (
    <div className="min-h-dvh">
      <header ref={kopf} className="sticky top-0 z-10 border-b-4 border-akzent bg-white shadow-sm">
        {/* Zeile 1: Logo zentriert, rechts Benutzer bzw. Menü-Knopf */}
        <div className="mx-auto grid max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 pt-3 pb-2">
          <div><SyncAnzeige /></div>
          <NavLink to="/" aria-label={t('Startseite')} className="flex flex-col items-center">
            <Logo className="h-9 w-auto max-w-48 object-contain md:h-12 md:max-w-72" />
          </NavLink>
          <div className="flex justify-end">
            <div className="hidden flex-col items-end text-sm md:flex">
              <span className="text-slate-500">{benutzer?.name || benutzer?.email}</span>
              <button onClick={abmelden} className="rounded-md px-2 py-1 text-slate-700 hover:bg-slate-100">{t('Abmelden')}</button>
            </div>
            <button className="rounded-md p-2 text-slate-700 hover:bg-slate-100 md:hidden" aria-label={t('Menü')} aria-expanded={menueOffen}
              onClick={() => setMenueOffen(!menueOffen)}>{menueOffen ? <X className="size-6" aria-hidden /> : <Menu className="size-6" aria-hidden />}</button>
          </div>
        </div>
        {/* Zeile 2: Menü (PC); Gruppen öffnen ein Kachelfeld */}
        <nav className="hidden border-t border-slate-100 md:block" aria-label={t('Hauptmenü')}>
          <div className="mx-auto flex max-w-7xl flex-wrap justify-center gap-1 px-4 py-1.5">
            {eintraege.map((e) => ('gruppe' in e
              ? <MenueGruppe key={e.gruppe} g={e} offen={offeneGruppe === e.gruppe}
                onUmschalten={() => setOffeneGruppe(offeneGruppe === e.gruppe ? null : e.gruppe)} />
              : <MenuePunkt key={e.zu} p={e} />))}
          </div>
        </nav>
        {/* Handy: Kacheln, nach Gruppen gegliedert */}
        {menueOffen && (
          <nav className="max-h-[calc(100dvh-5rem)] space-y-4 overflow-y-auto border-t border-slate-100 bg-stone-50 px-4 py-4 md:hidden" aria-label={t('Hauptmenü')}
            onClick={(e) => { if ((e.target as Element).closest('a')) setMenueOffen(false) }}>
            <KachelRaster punkte={eintraege.filter((e): e is Punkt => !('gruppe' in e))} />
            {eintraege.filter((e): e is Gruppe => 'gruppe' in e).map((g) => (
              <div key={g.gruppe} className="space-y-2">
                <div className="px-1 text-xs font-semibold tracking-wider text-slate-500 uppercase">{g.gruppe}</div>
                <KachelRaster punkte={g.punkte} />
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-sm">
              <span className="text-slate-500">{benutzer?.name || benutzer?.email}</span>
              <button onClick={abmelden} className="rounded-md px-2 py-1 text-slate-700 hover:bg-slate-100">{t('Abmelden')}</button>
            </div>
          </nav>
        )}
        <DemoBanner />
        <DemoAbgleich />
      </header>
      <main className="pb-6">
        {/* Andere Anlagenarten → Seite neu aufbauen, damit alle Texte „Tür“ bzw. „Anlage“ sagen */}
        <Outlet key={arten.join()} />
      </main>
      <footer className="space-y-1 pb-10">
        <RechtsLinks />
        <p className="text-center text-[11px] text-slate-400">
          {t('Version {version}', { version: __APP_VERSION__ })}{__APP_COMMIT__ ? ` (${__APP_COMMIT__})` : ''}
          {schemaStand && <> · {t('Datenbank {stand}', { stand: schemaStand })}</>}
          {ENTWICKLER_ZEIGEN && <> · {t('Entwickelt von')}{' '}
            <a className="hover:underline" href={ENTWICKLER.url} target="_blank" rel="noopener">{ENTWICKLER.name}</a></>}
        </p>
        {VORSCHAU && <p className="text-center text-[11px] font-medium text-slate-500">{VORSCHAU_FUSSZEILE}</p>}
      </footer>
    </div>
  )
}
