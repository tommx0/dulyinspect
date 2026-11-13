import { useState, type ReactNode } from 'react'
import { Bug, Building2, ClipboardCheck, FileText, KeyRound, ListChecks, Mail, Palette, Scale, Signature, Tag, Trash2, type LucideIcon } from 'lucide-react'
import { Link, Navigate, NavLink, Outlet, useLocation, type RouteObject } from 'react-router'
import { Formular, type FeldDef } from '../components/Formular'
import { Weiter } from '../components/Symbole'
import { alsWebadresse, RECHTSTEXT_FORMATE, RECHTSTEXT_TITEL } from '../lib/rechtstext'
import { rechtsLinksZuruecksetzen } from '../lib/rechtstextLaden'
import { Fehler, Laden, Seite } from '../components/ui'
import { fehlertext, supabase, type Aenderung } from '../lib/supabase'
import { useAbfrage } from '../lib/useAbfrage'
import { AnlagenartenBereich } from './AnlagenartenBereich'
import { ErscheinungsbildBereich } from './ErscheinungsbildBereich'
import { EtikettPraefixBereich } from './EtikettPraefixBereich'
import { KundendatenLoeschenBereich } from './KundendatenLoeschenBereich'
import { LizenzNachweisBereich } from './LizenzNachweisBereich'
import { MailBereich } from './MailBereich'
import { FehlerprotokollBereich } from './FehlerprotokollBereich'
import { VerschluesselungBereich } from './VerschluesselungBereich'
import { BLATT_BESCHRIFTUNG_BREITE, BLATT_BREITEN, BLATT_ERGEBNIS_BREITE } from '../lib/ansicht'
import { t } from '../lib/sprache'

const HINWEIS_TEXT = <>
  {t('Leerzeile = neuer Absatz,')} <code># </code> {t('bzw.')} <code>## </code> {t('am Zeilenanfang = Überschrift,')} <code>- </code> {t('= Aufzählung.')}
  {' '}{t('Web- und E-Mail-Adressen werden automatisch verlinkt.')}
</>
const HINWEIS_HTML = t('Angezeigt werden Überschriften, Absätze, Listen, Tabellen, Hervorhebungen und Links. Skripte, Bilder, Formulare und eigene Formatierungen (style, class) werden entfernt.')

/** Je Rechtstext die Art und passend dazu ein Textfeld bzw. die Webadresse. */
function rechtstextFelder(w: Record<string, unknown>): FeldDef[] {
  return (['impressum', 'datenschutz'] as const).flatMap((art): FeldDef[] => {
    const titel = t(RECHTSTEXT_TITEL[art])
    const format = w[`${art}_format`]
    return [
      { name: `${art}_format`, label: t('{titel} als', { titel }), typ: 'select', pflicht: true, optionen: RECHTSTEXT_FORMATE },
      format === 'link'
        ? { name: art, label: t('{titel} – Webadresse', { titel }), typ: 'url', breit: true, hinweis: t('Vollständige Adresse mit https://, z. B. die Seite „{titel}“ Ihrer Website.', { titel }) }
        : { name: art, label: titel, typ: 'textarea', zeilen: art === 'impressum' ? 14 : 20, hinweis: format === 'html' ? HINWEIS_HTML : HINWEIS_TEXT },
    ]
  })
}

function Gespeichert({ text }: { text: string }) {
  return text ? <div role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">{text}</div> : null
}

/** Firmendaten des Dienstleisters für Protokollkopf und Hinweistext. */
export function FirmendatenBereich() {
  const firma = useAbfrage(() => supabase.from('firma').select('*').single())
  const [meldung, setMeldung] = useState('')
  if (firma.laedt && !firma.daten) return <Laden />
  return (
    <section className="karte space-y-3 p-4">
      <h2 className="font-semibold">{t('Firmendaten im Prüfprotokoll')}</h2>
      <Fehler text={firma.fehler} />
      <Gespeichert text={meldung} />
      <Formular
        key={firma.daten?.geaendert_am}
        felder={[
          { name: 'name', label: t('Firmenname'), pflicht: true, breit: true },
          { name: 'strasse', label: t('Straße'), breit: true },
          { name: 'plz', label: t('PLZ') },
          { name: 'ort', label: t('Ort') },
          { name: 'telefon', label: t('Telefon'), typ: 'tel' },
          { name: 'email', label: t('E-Mail'), typ: 'email' },
          { name: 'web', label: t('Website'), breit: true },
          { name: 'zusatz', label: t('Zusatz (z. B. Leistungsbereiche)'), breit: true },
          { name: 'protokoll_hinweis', label: t('Hinweistext unter jedem Protokoll'), typ: 'textarea' },
          { name: 'protokoll_sprache', label: t('Sprache der Prüfprotokolle'), typ: 'select', pflicht: true, optionen: [
            { wert: 'de', text: 'Deutsch' }, { wert: 'en', text: 'English' },
          ], hinweis: t('Gilt für alle künftig erstellten Protokolle und Etiketten, unabhängig von der Sprache der Oberfläche.') },
        ]}
        start={firma.daten ?? {}}
        onSpeichern={async (w) => {
          const { error } = await supabase.from('firma').update(w as Aenderung<'firma'>).eq('id', 1)
          if (error) return fehlertext(error)
          setMeldung(t('Gespeichert. Gilt für alle künftig erstellten Protokolle; bestehende PDFs bleiben unverändert.'))
          firma.neuLaden()
        }}
      />
    </section>
  )
}

export function RechtstexteBereich() {
  const firma = useAbfrage(() => supabase.from('firma').select('impressum, impressum_format, datenschutz, datenschutz_format, geaendert_am').single())
  const [meldung, setMeldung] = useState('')
  if (firma.laedt && !firma.daten) return <Laden />
  return (
    <section className="karte space-y-3 p-4">
      <h2 className="font-semibold">{t('Impressum und Datenschutzerklärung')}</h2>
      <p className="text-sm text-slate-600">
        {t('Öffentlich lesbar – auch ohne Anmeldung – über die Links unten auf jeder Seite und auf der Anmeldeseite. Je Text wählbar: eigener Text mit einfacher Formatierung, HTML (z. B. aus einem Generator für Rechtstexte) oder ein Link auf eine externe Seite wie Ihre Website – dann führen die Links direkt dorthin.')}
      </p>
      <Fehler text={firma.fehler} />
      <Gespeichert text={meldung} />
      <Formular
        key={`recht-${firma.daten?.geaendert_am}`}
        felder={rechtstextFelder}
        start={{
          impressum_format: firma.daten?.impressum_format ?? 'text', impressum: firma.daten?.impressum,
          datenschutz_format: firma.daten?.datenschutz_format ?? 'text', datenschutz: firma.daten?.datenschutz,
        }}
        zusatz={<p className="text-sm"><a className="link" href="#/impressum">{t('Impressum ansehen')}</a> · <a className="link" href="#/datenschutz">{t('Datenschutz ansehen')}</a> {t('(gespeicherter Stand)')}</p>}
        onSpeichern={async (w) => {
          for (const art of ['impressum', 'datenschutz'] as const) {
            if (w[`${art}_format`] === 'link' && w[art] && !alsWebadresse(String(w[art]))) {
              return t('{titel}: Bitte eine vollständige Webadresse mit https:// eintragen.', { titel: t(RECHTSTEXT_TITEL[art]) })
            }
          }
          const { error } = await supabase.from('firma').update(w as Aenderung<'firma'>).eq('id', 1)
          if (error) return fehlertext(error)
          rechtsLinksZuruecksetzen()
          setMeldung(t('Impressum und Datenschutzerklärung gespeichert.'))
          firma.neuLaden()
        }}
      />
    </section>
  )
}

/** Ansicht, in der eine Prüfung öffnet; jedes Gerät darf in der Prüfung abweichen (usePruefAnsicht). */
function PruefAnsichtBereich() {
  const firma = useAbfrage(() => supabase.from('firma').select('pruef_ansicht, blatt_beschriftung_breite, blatt_ergebnis_breite, geaendert_am').single())
  const [meldung, setMeldung] = useState('')
  if (firma.laedt && !firma.daten) return <Laden />
  return (
    <section className="karte space-y-3 p-4">
      <h2 className="font-semibold">{t('Ansicht der Prüfung')}</h2>
      <p className="text-sm text-slate-600">
        {t('In welcher Ansicht eine Prüfung öffnet: als Protokollblatt im Aufbau des PDF-Protokolls oder als Liste der Prüfpunkte. Wer in der Prüfung oben auf „Liste“ bzw. „Protokoll“ umschaltet, behält seine Wahl auf diesem Gerät.')}
      </p>
      <p className="text-sm text-slate-600">
        {t('Im Protokollblatt brechen lange Beschriftungen und Prüfpunkte in die nächste Zeile um, damit die Werte daneben genug Platz behalten. Wie breit die Spalten dafür sind, legen Sie hier in Prozent der Blattbreite fest. Das PDF-Protokoll ist davon nicht betroffen.')}
      </p>
      <Fehler text={firma.fehler} />
      <Gespeichert text={meldung} />
      <Formular
        key={`ansicht-${firma.daten?.geaendert_am}`}
        felder={[
          { name: 'pruef_ansicht', label: t('Prüfung öffnet als'), typ: 'select', pflicht: true, breit: true, optionen: [
            { wert: 'protokoll', text: t('Protokoll') },
            { wert: 'liste', text: t('Liste') },
          ] },
          { name: 'blatt_beschriftung_breite', label: t('Beschriftung der Anlagendaten höchstens (%)'), typ: 'number', pflicht: true,
            hinweis: t('{min} bis {max}, Standard {standard}. Längere Beschriftungen wie „Aufschaltung auf Notruf- und Serviceleitstelle“ brechen um.', { min: BLATT_BREITEN.beschriftung.min, max: BLATT_BREITEN.beschriftung.max, standard: BLATT_BESCHRIFTUNG_BREITE }) },
          { name: 'blatt_ergebnis_breite', label: t('Ergebnisspalte der Prüfpunkte (%)'), typ: 'number', pflicht: true,
            hinweis: t('{min} bis {max}, Standard {standard}. Hier stehen Ankreuzfelder und Messwerte; der Prüfpunkt links bricht um.', { min: BLATT_BREITEN.ergebnis.min, max: BLATT_BREITEN.ergebnis.max, standard: BLATT_ERGEBNIS_BREITE }) },
        ]}
        start={{
          pruef_ansicht: firma.daten?.pruef_ansicht ?? 'protokoll',
          blatt_beschriftung_breite: firma.daten?.blatt_beschriftung_breite ?? BLATT_BESCHRIFTUNG_BREITE,
          blatt_ergebnis_breite: firma.daten?.blatt_ergebnis_breite ?? BLATT_ERGEBNIS_BREITE,
        }}
        onSpeichern={async (w) => {
          const beschriftung = Number(w.blatt_beschriftung_breite)
          const ergebnis = Number(w.blatt_ergebnis_breite)
          for (const [wert, b, text] of [[beschriftung, BLATT_BREITEN.beschriftung, t('Beschriftung')], [ergebnis, BLATT_BREITEN.ergebnis, t('Ergebnisspalte')]] as const) {
            if (!Number.isInteger(wert) || wert < b.min || wert > b.max) return t('{feld}: bitte eine ganze Zahl von {min} bis {max} eingeben.', { feld: text, min: b.min, max: b.max })
          }
          const { error } = await supabase.from('firma').update({
            pruef_ansicht: String(w.pruef_ansicht), blatt_beschriftung_breite: beschriftung, blatt_ergebnis_breite: ergebnis,
          }).eq('id', 1)
          if (error) return fehlertext(error)
          setMeldung(t('Gespeichert. Die Ansicht gilt auf allen Geräten, auf denen noch niemand selbst umgeschaltet hat; die Spaltenbreiten beim nächsten Öffnen einer Prüfung.'))
          firma.neuLaden()
        }}
      />
    </section>
  )
}

export function EtikettenBereich() {
  const firma = useAbfrage(() => supabase.from('firma').select('etikett_praefix, mandantencode').single())
  if (firma.laedt && !firma.daten) return <Laden />
  return <>
    <Fehler text={firma.fehler} />
    {firma.daten && <EtikettPraefixBereich praefix={firma.daten.etikett_praefix} mandantencode={firma.daten.mandantencode} onGespeichert={firma.neuLaden} />}
  </>
}

type Punkt = { pfad: string; titel: string; text: string; Symbol: LucideIcon; inhalt: ReactNode }

/** Aufbau der Einstellungen: Gruppen mit Unterseiten (#/einstellungen/<pfad>). */
const GRUPPEN: { gruppe: string; punkte: Punkt[] }[] = [
  { gruppe: t('Firma'), punkte: [
    { pfad: 'firmendaten', titel: t('Firmendaten'), text: t('Name, Adresse und Hinweistext im Kopf und Fuß der Prüfprotokolle'), Symbol: Building2, inhalt: <FirmendatenBereich /> },
    { pfad: 'erscheinungsbild', titel: t('Erscheinungsbild'), text: t('Logo, Farben und Name der App'), Symbol: Palette, inhalt: <ErscheinungsbildBereich /> },
  ] },
  { gruppe: t('Prüfungen'), punkte: [
    { pfad: 'anlagen', titel: t('Zu prüfende Anlagen'), text: t('Welche Anlagenarten Ihr Betrieb prüft, Pflicht zur Sachkunde'), Symbol: ClipboardCheck, inhalt: <AnlagenartenBereich /> },
    { pfad: 'pruefansicht', titel: t('Ansicht der Prüfung'), text: t('Prüfung als Protokollblatt oder als Liste öffnen, Spaltenbreiten des Blatts'), Symbol: FileText, inhalt: <PruefAnsichtBereich /> },
    { pfad: 'etiketten', titel: t('Etiketten'), text: t('Präfix der Etikett-IDs'), Symbol: Tag, inhalt: <EtikettenBereich /> },
  ] },
  { gruppe: t('Sicherheit'), punkte: [
    { pfad: 'verschluesselung', titel: t('Verschlüsselung'), text: t('Firmenschlüssel, Schlüsselblatt, Umschlüsseln'), Symbol: KeyRound, inhalt: <VerschluesselungBereich /> },
  ] },
  { gruppe: t('Rechtliches'), punkte: [
    { pfad: 'rechtstexte', titel: t('Impressum und Datenschutz'), text: t('Öffentliche Rechtstexte der App'), Symbol: Scale, inhalt: <RechtstexteBereich /> },
    { pfad: 'lizenzzustimmungen', titel: t('Zustimmungen zur Lizenz'), text: t('Wer den Lizenzbedingungen wann zugestimmt hat'), Symbol: Signature, inhalt: <LizenzNachweisBereich /> },
  ] },
  { gruppe: t('System'), punkte: [
    { pfad: 'inbetriebnahme', titel: t('Inbetriebnahme'), text: t('Schritt für Schritt durch die Einrichtung: Firmendaten, Anlagen, Vorlagen, Rechtstexte, Benutzer'), Symbol: ListChecks, inhalt: <Navigate to="/inbetriebnahme" replace /> },
    { pfad: 'mail', titel: t('Mail'), text: t('Mailserver für Statusmails, Fehlermeldungen und „Passwort vergessen“'), Symbol: Mail, inhalt: <MailBereich /> },
    { pfad: 'fehlerprotokoll', titel: t('Fehlerprotokoll'), text: t('Unerwartete Fehler der App und der Serverfunktionen'), Symbol: Bug, inhalt: <FehlerprotokollBereich /> },
    { pfad: 'kundendaten-loeschen', titel: t('Kundendaten löschen'), text: t('Alle Kunden, Objekte, Prüfungen und Protokolle entfernen – Benutzer und Einstellungen bleiben'), Symbol: Trash2, inhalt: <KundendatenLoeschenBereich /> },
  ] },
]

/** Unterseiten für den Router (unter „einstellungen“). */
export const EINSTELLUNGEN_SEITEN: RouteObject[] = [
  ...GRUPPEN.flatMap((g) => g.punkte.map((p) => ({ path: p.pfad, element: p.inhalt }))),
  { path: '*', element: <Navigate to="/einstellungen" replace /> },
]

/** Übersicht: alle Einstellungen nach Gruppen, je Zeile mit kurzer Beschreibung. */
function EinstellungenUebersicht() {
  return (
    <div className="grid gap-x-6 gap-y-5 lg:grid-cols-2">
      {GRUPPEN.map((g) => (
        <section key={g.gruppe} className="space-y-2">
          <h2 className="px-1 text-xs font-semibold tracking-wider text-slate-500 uppercase">{g.gruppe}</h2>
          <ul className="karte divide-y divide-slate-100 overflow-hidden">
            {g.punkte.map((p) => (
              <li key={p.pfad}>
                <Link to={p.pfad} className="zeile group">
                  <p.Symbol className="size-5 shrink-0 text-slate-500" strokeWidth={1.75} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{p.titel}</div>
                    <div className="text-sm text-slate-500">{p.text}</div>
                  </div>
                  <Weiter />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

const seitenLink = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium ${isActive ? 'bg-akzent text-marke' : 'text-slate-700 hover:bg-akzent-hell'}`

/** Rahmen der Einstellungen: Übersicht, auf Unterseiten links die Gliederung (PC) und zurück zur Übersicht. */
export default function Einstellungen() {
  const { pathname } = useLocation()
  const uebersicht = pathname.replace(/\/$/, '') === '/einstellungen'
  if (uebersicht) return <Seite titel={t('Einstellungen')}><EinstellungenUebersicht /></Seite>
  return (
    <Seite titel={t('Einstellungen')} zurueck={{ zu: '/einstellungen', text: t('Alle Einstellungen') }}>
      <div className="grid gap-6 md:grid-cols-[15rem_1fr]">
        <nav aria-label={t('Einstellungen')} className="hidden space-y-4 md:block">
          {GRUPPEN.map((g) => (
            <div key={g.gruppe} className="space-y-0.5">
              <div className="px-3 pb-1 text-xs font-semibold tracking-wider text-slate-400 uppercase">{g.gruppe}</div>
              {g.punkte.map((p) => (
                <NavLink key={p.pfad} to={p.pfad} className={seitenLink}>
                  <p.Symbol className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />{p.titel}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="min-w-0 space-y-4">
          <Outlet />
        </div>
      </div>
    </Seite>
  )
}
