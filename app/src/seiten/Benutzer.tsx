import { Copy, FileText, Headset, Image as BildIcon, Paperclip, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth'
import { bestaetigen } from '../components/Bestaetigung'
import { Formular, type FeldDef } from '../components/Formular'
import { AnsichtWahl, Badge, Dialog, Fehler, Kacheln, Seite, Tabelle } from '../components/ui'
import { ARTEN } from '../lib/anlagenarten'
import { useAnlagenarten } from '../lib/begriffe'
import { nachweisArt, nachweisHochladen, nachweisLinks, nachweisLoeschen } from '../lib/nachweis'
import { sachkundeStatus } from '../lib/sachkunde'
import { SUPPORT_BENUTZERNAME, SUPPORT_MINUTEN, supportBis, uhrzeit } from '../lib/support'
import { fehlertext, supabase, type Zeile } from '../lib/supabase'
import { demoSperreAktiv } from '../lib/demo'
import { entschluesselt } from '../lib/entschluesselt'
import { useAbfrage } from '../lib/useAbfrage'
import { istNichtLesbar, verschluesseln } from '../lib/verschluesselung'
import { useAnsicht } from '../lib/ansicht'
import { gebietsschema, t, tMeldung } from '../lib/sprache'

/** Sachkunde je Art im Dialog: Text, Ablauf und Datei (vorhandene, neu gewählte oder zum Entfernen markierte). */
type Entwurf = { nachweis: string; gueltig_bis: string; datei_pfad: string | null; datei_name: string | null; neu?: File; entfernen?: boolean }

const ROLLEN = [{ wert: 'pruefer', text: t('Prüfer') }, { wert: 'planer', text: t('Planer') }, { wert: 'admin', text: t('Admin') }]

async function adminFunktion(body: Record<string, unknown>, ergebnis?: (data: Record<string, unknown>) => void): Promise<string | void> {
  const { data, error } = await supabase.functions.invoke('admin-benutzer', { body })
  if (error) {
    // Fehlertext aus der Antwort der Funktion lesen, falls vorhanden
    const ctx = (error as { context?: Response }).context
    try {
      const j = await ctx?.json()
      if (j?.fehler) return j.fehler
    } catch { /* ignorieren */ }
    return error.message
  }
  if (data?.fehler) return data.fehler
  ergebnis?.(data)
}

const ZWEI_FAKTOR_FELD: FeldDef = {
  name: 'zwei_faktor', label: t('Zwei-Faktor-Anmeldung erforderlich (Authenticator-App, ab der nächsten Anmeldung)'), typ: 'checkbox', breit: true,
}
const PASSWORT_AENDERN_FELD: FeldDef = {
  name: 'passwort_aendern', label: t('Passwort bei der nächsten Anmeldung ändern'), typ: 'checkbox', breit: true,
}

export default function Benutzer() {
  const { benutzer: ich, zweiFaktorPruefen } = useAuth()
  const [dialog, setDialog] = useState<Zeile<'benutzer'> | 'neu' | null>(null)
  const [passwortFuer, setPasswortFuer] = useState<Zeile<'benutzer'> | null>(null)
  const [ansicht, setAnsicht] = useAnsicht('benutzer')
  const alle = useAbfrage(() => supabase.from('benutzer').select('*').order('name'))
  // Der Supportzugang hat einen eigenen Bereich (Freischalten/Sperren statt Bearbeiten)
  const support = alle.daten?.find((b) => b.support)
  const liste = { ...alle, daten: alle.daten?.filter((b) => !b.support) }
  const sachkunden = useAbfrage(() => entschluesselt('benutzer_sachkunde', supabase.from('benutzer_sachkunde').select('*')))
  const arten = useAnlagenarten()
  const [heute] = useState(() => new Date().toISOString().slice(0, 10))
  const [sachkundeEntwurf, setSachkundeEntwurf] = useState<Record<string, Entwurf>>({})
  const [links, setLinks] = useState<Record<string, string>>({})
  // Wer hat eine Authenticator-App bestätigt?
  const [eingerichtet, setEingerichtet] = useState<Set<string> | null>(null)
  const [zfFehler, setZfFehler] = useState('')
  // Höchstzahl aktiver Benutzer (Umgebungsvariable MAX_AKTIVE_BENUTZER der Edge Functions) und wie viele es schon sind
  const [limit, setLimit] = useState<{ max: number; aktiv: number } | null>(null)
  // Demomodus (Planer, nur Ansicht): die Edge Function ist gesperrt – ohne Anzeige der Höchstzahl
  const limitLaden = () => { if (!demoSperreAktiv()) void adminFunktion({ aktion: 'limit' }, (d) => setLimit({ max: Number(d.max), aktiv: Number(d.aktiv) })) }
  useEffect(limitLaden, [])
  const zweiFaktorLaden = () => void supabase.rpc('zwei_faktor_eingerichtet').then(({ data, error }) => {
    setZfFehler(error ? fehlertext(error) : '')
    setEingerichtet(new Set(data ?? []))
  })
  useEffect(zweiFaktorLaden, [])
  const zweiFaktorZuruecksetzen = async (b: Zeile<'benutzer'>) => {
    if (!await bestaetigen(t('Zwei-Faktor-Anmeldung von {name} zurücksetzen?', { name: b.name || b.email }) + '\n\n'
      + (b.zwei_faktor ? t('Bei der nächsten Anmeldung richtet der Benutzer die Authenticator-App neu ein.') : t('Die Authenticator-App wird entfernt.')),
    { ok: t('Zurücksetzen'), gefahr: true })) return
    const f = await adminFunktion({ aktion: 'zwei_faktor_zuruecksetzen', id: b.id })
    setZfFehler(tMeldung(f ?? ''))
    zweiFaktorLaden()
    if (!f && b.id === ich?.id) zweiFaktorPruefen()
  }
  const entwurfAendern = (art: string, teil: Partial<Entwurf>) => setSachkundeEntwurf((s) => ({ ...s, [art]: { ...s[art], ...teil } }))

  const stammFelder: FeldDef[] = [
    { name: 'name', label: t('Name'), pflicht: true },
    { name: 'rolle', label: t('Rolle'), typ: 'select', pflicht: true, optionen: ROLLEN },
  ]
  const vonBenutzer = (id: string) => (sachkunden.daten ?? []).filter((x) => x.benutzer_id === id)

  const bearbeitenOeffnen = (b: Zeile<'benutzer'>) => {
    setSachkundeEntwurf(Object.fromEntries(arten.map((a) => {
      const x = vonBenutzer(b.id).find((y) => y.anlagenart === a)
      // Bisheriger allgemeiner Hinweis als Vorschlag für Türen
      return [a, { nachweis: x?.nachweis ?? (a === 'tuer' ? b.sachkunde_hinweis ?? '' : ''), gueltig_bis: x?.gueltig_bis ?? '',
        datei_pfad: x?.datei_pfad ?? null, datei_name: x?.datei_name ?? null }]
    })))
    setLinks({})
    void nachweisLinks(vonBenutzer(b.id).map((x) => x.datei_pfad).filter((p): p is string => !!p)).then(setLinks)
    setDialog(b)
  }

  /** Sachkunde je Art speichern: ausgefüllte anlegen/ändern, geleerte entfernen; Datei hochladen, ersetzte bzw. entfernte löschen. */
  const sachkundeSpeichern = async (benutzerId: string): Promise<string | void> => {
    for (const [art, e] of Object.entries(sachkundeEntwurf)) {
      const name = t(ARTEN[art as keyof typeof ARTEN]?.name ?? art)
      const alt = vonBenutzer(benutzerId).find((x) => x.anlagenart === art)?.datei_pfad ?? null
      if (!e.nachweis.trim()) {
        if (e.neu) return t('Sachkunde {art}: Bitte zur Datei auch den Nachweis eintragen, z. B. „Zertifikat Fachkraft“.', { art: name })
        const r = await supabase.from('benutzer_sachkunde').delete().eq('benutzer_id', benutzerId).eq('anlagenart', art)
        if (r.error) return fehlertext(r.error)
        if (alt) await nachweisLoeschen(alt)
        continue
      }
      let datei = e.entfernen ? { pfad: null as string | null, name: null as string | null } : { pfad: e.datei_pfad, name: e.datei_name }
      if (e.neu) {
        try {
          datei = await nachweisHochladen(benutzerId, art, e.neu)
        } catch (f) {
          return t('Sachkunde {art}: {fehler}', { art: name, fehler: fehlertext(f) })
        }
      }
      // Dateiname verschlüsselt speichern (Zusatzdaten: Benutzer und Art)
      const r = await supabase.from('benutzer_sachkunde').upsert(await verschluesseln('benutzer_sachkunde', { benutzer_id: benutzerId, anlagenart: art,
        nachweis: e.nachweis.trim(), gueltig_bis: e.gueltig_bis || null, datei_pfad: datei.pfad, datei_name: datei.name }))
      if (r.error) {
        if (e.neu && datei.pfad) await nachweisLoeschen(datei.pfad)
        return fehlertext(r.error)
      }
      if (alt && alt !== datei.pfad) await nachweisLoeschen(alt)
    }
  }

  const sachkundeFelder = (
    <fieldset className="space-y-3 rounded-md border border-slate-200 p-3">
      <legend className="px-1 text-sm font-semibold">{t('Sachkunde (erscheint im Protokoll)')}</legend>
      {/* Je Art: Überschrift, darunter eine Zeile Nachweis · gültig bis · Datei/Foto.
          Feldnamen nebeneinander nur über der ersten Zeile, untereinander (Handy) bei jeder Art. */}
      {arten.map((a, i) => (
        <div key={a} className="space-y-1 border-t border-slate-100 pt-3 first-of-type:border-t-0 first-of-type:pt-0">
          {arten.length > 1 && <h3 className="text-sm font-semibold text-marke">{t(ARTEN[a].name)}</h3>}
          <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
            <label className="block"><span className={i > 0 ? 'sm:sr-only' : ''}>{t('Nachweis')}</span>
              <input value={sachkundeEntwurf[a]?.nachweis ?? ''} placeholder={a === 'tuer' ? t('z. B. Sachkunde Türen/Tore') : t('z. B. Schulung, Zertifikat')}
                aria-label={arten.length > 1 ? t('Nachweis {art}', { art: t(ARTEN[a].name) }) : undefined}
                onChange={(e) => entwurfAendern(a, { nachweis: e.target.value })} />
            </label>
            <label className="block"><span className={i > 0 ? 'sm:sr-only' : ''}>{t('gültig bis')}</span>
              <input type="date" value={sachkundeEntwurf[a]?.gueltig_bis ?? ''}
                aria-label={arten.length > 1 ? t('Sachkunde {art} gültig bis', { art: t(ARTEN[a].name) }) : t('Sachkunde gültig bis')}
                onChange={(e) => entwurfAendern(a, { gueltig_bis: e.target.value })} />
            </label>
            {sachkundeEntwurf[a] && (
              <NachweisDatei art={arten.length > 1 ? t(ARTEN[a].name) : ''} entwurf={sachkundeEntwurf[a]} url={links[sachkundeEntwurf[a].datei_pfad ?? '']}
                onNeu={(neu) => entwurfAendern(a, { neu, entfernen: false })}
                onEntfernen={() => entwurfAendern(a, sachkundeEntwurf[a].neu ? { neu: undefined } : { entfernen: true })} />
            )}
          </div>
        </div>
      ))}
      <p className="text-xs text-slate-500">
        {t('Leer lassen, wenn keine Sachkunde vorliegt. „gültig bis“ leer = unbefristet. Vor Ablauf weist die Startseite darauf hin. Den Nachweis als PDF oder Foto sehen nur Admins und der Benutzer selbst.')}
      </p>
    </fieldset>
  )

  // Inhalte je Benutzer, gleich in Tabelle und Kacheln
  const name = (b: Zeile<'benutzer'>) => <>{b.name || '–'}{b.id === ich?.id && <span className="text-slate-400"> {t('(Sie)')}</span>}</>
  const rolle = (b: Zeile<'benutzer'>) => b.rolle === 'admin' ? <Badge farbe="blau">{t('Admin')}</Badge> : b.rolle === 'planer' ? <Badge farbe="gruen">{t('Planer')}</Badge> : t('Prüfer')
  const status = (b: Zeile<'benutzer'>) => b.aktiv ? t('aktiv') : <Badge farbe="rot">{t('deaktiviert')}</Badge>
  const sachkunde = (b: Zeile<'benutzer'>) => vonBenutzer(b.id).length === 0 ? '–' : vonBenutzer(b.id).map((x) => {
    const st = sachkundeStatus(x.gueltig_bis, heute)
    return <Badge key={x.anlagenart} farbe={st === 'abgelaufen' ? 'rot' : st === 'bald' ? 'gelb' : 'gruen'}>
      {arten.length > 1 || x.anlagenart !== 'tuer' ? `${t(ARTEN[x.anlagenart as keyof typeof ARTEN]?.name ?? x.anlagenart)} ` : ''}
      {st === 'abgelaufen' ? t('abgelaufen') : x.gueltig_bis ? t('bis {datum}', { datum: new Date(`${x.gueltig_bis}T00:00`).toLocaleDateString(gebietsschema(), { day: '2-digit', month: '2-digit', year: 'numeric' }) }) : '✓'}
      {x.datei_pfad && <Paperclip className="ml-1 inline size-3" aria-label={t('mit Nachweis-Datei')} />}
    </Badge>
  })
  const zweiFaktor = (b: Zeile<'benutzer'>) => b.zwei_faktor
    ? (eingerichtet?.has(b.id) ? <Badge farbe="gruen">{t('eingerichtet')}</Badge> : <Badge farbe="gelb">{t('bei nächster Anmeldung')}</Badge>)
    : eingerichtet?.has(b.id) ? <Badge>{t('freiwillig')}</Badge> : '–'
  const knoepfe = (b: Zeile<'benutzer'>) => <>
    <button className="link" onClick={() => bearbeitenOeffnen(b)}>{t('Bearbeiten')}</button>
    <button className="link" onClick={() => setPasswortFuer(b)}>{t('Passwort')}</button>
    {eingerichtet?.has(b.id) && <button className="link" onClick={() => void zweiFaktorZuruecksetzen(b)}>{t('Zwei-Faktor zurücksetzen')}</button>}
  </>

  return (
    <Seite titel={t('Benutzer')} aktionen={<>
      <button className="btn-primaer" onClick={() => setDialog('neu')}>{t('+ Benutzer')}</button>
      <AnsichtWahl wert={ansicht} onWechsel={setAnsicht} />
    </>}>
      <Fehler text={liste.fehler || zfFehler} />
      {alle.daten && <SupportZugang support={support} ichSupport={!!ich?.support} onGeaendert={alle.neuLaden} />}
      {limit && (
        <p className="mb-3 text-sm text-slate-500" data-benutzer-limit>
          {t('Aktive Benutzer:')} <span className={limit.aktiv >= limit.max ? 'font-semibold text-amber-700' : 'font-semibold'}>{t('{n} von {m}', { n: limit.aktiv, m: limit.max })}</span>
          {limit.aktiv >= limit.max && <> – {t('die Grenze ist erreicht. Zum Anlegen oder Aktivieren zuerst einen Benutzer deaktivieren; die Grenze legt der Betreiber der Instanz fest.')}</>}
        </p>
      )}
      {ansicht === 'kacheln' ? (
        <Kacheln aria-label={t('Benutzer')}>
          {liste.daten?.map((b) => (
            <li key={b.id} className={`karte flex flex-col gap-2 p-4 ${b.aktiv ? '' : 'text-slate-400'}`} data-benutzer={b.email}>
              <div className="flex items-start gap-3">
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-600 ring-1 ring-inset ring-stone-200" aria-hidden>
                  <UserRound className="size-5" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{name(b)}</div>
                  <div className="truncate text-sm text-slate-500">{b.email}</div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1">{rolle(b)}{!b.aktiv && status(b)}</div>
              <div className="text-sm"><span className="text-slate-500">{t('Sachkunde')} </span><span className="space-x-1">{sachkunde(b)}</span></div>
              <div className="text-sm" data-zwei-faktor-status><span className="text-slate-500">{t('Zwei-Faktor')} </span>{zweiFaktor(b)}</div>
              <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-sm">{knoepfe(b)}</div>
            </li>
          ))}
        </Kacheln>
      ) : (
      <Tabelle kopf={[t('Name'), t('E-Mail'), t('Rolle'), t('Sachkunde'), t('Zwei-Faktor'), t('Status'), '']}>
        {liste.daten?.map((b) => (
          <tr key={b.id} className={b.aktiv ? '' : 'text-slate-400'}>
            <td className="px-3 py-2 font-medium">{name(b)}</td>
            <td className="px-3 py-2">{b.email}</td>
            <td className="px-3 py-2">{rolle(b)}</td>
            <td className="space-x-1 px-3 py-2">{sachkunde(b)}</td>
            <td className="px-3 py-2" data-zwei-faktor-status>{zweiFaktor(b)}</td>
            <td className="px-3 py-2">{status(b)}</td>
            <td className="space-x-3 whitespace-nowrap px-3 py-2 text-right">{knoepfe(b)}</td>
          </tr>
        ))}
      </Tabelle>
      )}

      <Dialog offen={dialog !== null} titel={dialog === 'neu' ? t('Neuer Benutzer') : t('Benutzer bearbeiten')} onSchliessen={() => setDialog(null)}>
        {dialog === 'neu' ? (
          <Formular
            felder={[
              ...stammFelder.slice(0, 2),
              { name: 'email', label: t('E-Mail (Anmeldename)'), typ: 'email', pflicht: true, breit: true },
              { name: 'passwort', label: t('Start-Passwort'), pflicht: true, breit: true, hinweis: t('Mindestens 10 Zeichen. Bitte sicher übermitteln.') },
              PASSWORT_AENDERN_FELD,
              ZWEI_FAKTOR_FELD,
            ]}
            start={{ rolle: 'pruefer', passwort_aendern: true }}
            onAbbrechen={() => setDialog(null)}
            onSpeichern={async (w) => {
              const f = await adminFunktion({ aktion: 'anlegen', ...w })
              if (f) return f
              setDialog(null)
              liste.neuLaden()
              limitLaden()
            }}
          />
        ) : dialog && (
          <Formular
            key={dialog.id}
            felder={[...stammFelder, { name: 'aktiv', label: t('aktiv (darf sich anmelden)'), typ: 'checkbox' }, ZWEI_FAKTOR_FELD]}
            start={dialog}
            zusatz={sachkundeFelder}
            onAbbrechen={() => setDialog(null)}
            onSpeichern={async (w) => {
              const f = await adminFunktion({ aktion: 'aktualisieren', id: dialog.id, ...w }) ?? await sachkundeSpeichern(dialog.id)
              if (f) return f
              setDialog(null)
              liste.neuLaden()
              sachkunden.neuLaden()
              limitLaden()
              // Pflicht für sich selbst eingeschaltet: sofort einrichten bzw. Code abfragen
              if (dialog.id === ich?.id && w.zwei_faktor !== dialog.zwei_faktor) zweiFaktorPruefen()
            }}
          />
        )}
      </Dialog>

      <Dialog offen={passwortFuer !== null} titel={t('Passwort setzen – {name}', { name: passwortFuer?.name ?? '' })} onSchliessen={() => setPasswortFuer(null)}>
        {passwortFuer && (
          <Formular
            key={passwortFuer.id}
            felder={[{ name: 'passwort', label: t('Neues Passwort'), pflicht: true, breit: true, hinweis: t('Mindestens 10 Zeichen.') }, PASSWORT_AENDERN_FELD]}
            start={{ passwort_aendern: passwortFuer.id !== ich?.id }}
            onAbbrechen={() => setPasswortFuer(null)}
            speichernText={t('Passwort setzen')}
            onSpeichern={async (w) => {
              const f = await adminFunktion({ aktion: 'passwort', id: passwortFuer.id, passwort: w.passwort, passwort_aendern: w.passwort_aendern === true })
              if (f) return f
              setPasswortFuer(null)
            }}
          />
        )}
      </Dialog>
    </Seite>
  )
}

/** Supportzugang (Fernwartung): Adminrechte, nur für 60 oder 120 Minuten freigeschaltet, jederzeit sperrbar. */
function SupportZugang({ support, ichSupport, onGeaendert }: { support?: Zeile<'benutzer'>; ichSupport: boolean; onGeaendert: () => void }) {
  const [jetzt, setJetzt] = useState(() => Date.now())
  const [fehler, setFehler] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  const [zugang, setZugang] = useState<{ passwort: string; bis: Date } | null>(null)
  const [kopiert, setKopiert] = useState(false)
  const bis = supportBis(support, jetzt)
  const abgelaufen = !!support?.aktiv && !bis

  // Restzeit mitzählen; nach Ablauf sperren und neu laden
  useEffect(() => {
    if (!support?.aktiv) return
    const takt = setInterval(() => setJetzt(Date.now()), 15_000)
    return () => clearInterval(takt)
  }, [support?.aktiv])
  useEffect(() => {
    if (abgelaufen) void supabase.rpc('support_ablauf').then(onGeaendert)
  }, [abgelaufen, onGeaendert])

  const freischalten = async (minuten: number) => {
    if (!await bestaetigen(t('Supportzugang für {minuten} Minuten freischalten?\n\nWer Benutzername „{benutzername}“ und das neue Passwort kennt, hat bis dahin volle Adminrechte. Danach wird der Zugang automatisch gesperrt.', { minuten, benutzername: SUPPORT_BENUTZERNAME }), { ok: t('Freischalten') })) return
    setLaeuft(true)
    const f = await adminFunktion({ aktion: 'support_freischalten', minuten },
      (d) => setZugang({ passwort: String(d.passwort), bis: new Date(String(d.bis)) }))
    setLaeuft(false)
    setFehler(tMeldung(f ?? ''))
    setKopiert(false)
    setJetzt(Date.now())
    onGeaendert()
  }
  const sperren = async () => {
    setLaeuft(true)
    const f = await adminFunktion({ aktion: 'support_sperren' })
    setLaeuft(false)
    setFehler(tMeldung(f ?? ''))
    onGeaendert()
  }
  const kopieren = async () => {
    try {
      await navigator.clipboard.writeText(zugang?.passwort ?? '')
      setKopiert(true)
    } catch { /* ohne Zwischenablage: Passwort ist markierbar */ }
  }

  return (
    <section className="karte mb-4 flex flex-wrap items-center gap-x-4 gap-y-3 p-4" aria-label={t('Supportzugang')} data-supportzugang>
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-600 ring-1 ring-inset ring-stone-200" aria-hidden>
        <Headset className="size-5" strokeWidth={1.75} />
      </span>
      <div className="min-w-56 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-medium">{t('Supportzugang (Fernwartung)')}</h2>
          {bis ? <Badge farbe="gelb">{t('freigeschaltet bis {zeit}', { zeit: uhrzeit(bis) })}</Badge> : <Badge>{t('gesperrt')}</Badge>}
        </div>
        <p className="text-sm text-slate-500">
          {bis
            ? t('Benutzername „{benutzername}“ mit Adminrechten, noch {n} Minuten. Danach automatisch gesperrt.', { benutzername: SUPPORT_BENUTZERNAME, n: Math.max(1, Math.ceil((bis.getTime() - jetzt) / 60_000)) })
            : t('Benutzername „{benutzername}“ mit Adminrechten. Nur für die Dauer einer Fernwartung freischalten; jedes Mal mit neuem Passwort.', { benutzername: SUPPORT_BENUTZERNAME })}
        </p>
        <Fehler text={fehler} />
      </div>
      <div className="flex flex-wrap gap-2">
        {bis ? <button className="btn-gefahr" disabled={laeuft} onClick={() => void sperren()}>{t('Jetzt sperren')}</button>
          : !ichSupport && SUPPORT_MINUTEN.map((m) => (
            <button key={m} className="btn-sekundaer" disabled={laeuft} onClick={() => void freischalten(m)}>{t('{n} Minuten freischalten', { n: m })}</button>
          ))}
      </div>

      <Dialog offen={zugang !== null} titel={t('Supportzugang freigeschaltet')} onSchliessen={() => setZugang(null)}>
        {zugang && (
          <div className="space-y-4">
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2">
              <dt className="text-sm text-slate-500">{t('Benutzername')}</dt>
              <dd className="font-mono text-lg">{SUPPORT_BENUTZERNAME}</dd>
              <dt className="text-sm text-slate-500">{t('Passwort')}</dt>
              <dd className="flex flex-wrap items-center gap-2">
                <span className="select-all rounded bg-slate-100 px-2 py-1 font-mono text-lg tracking-wider" data-support-passwort>{zugang.passwort}</span>
                <button type="button" className="link text-sm" onClick={() => void kopieren()}>
                  <Copy className="mr-1 inline size-4" aria-hidden />{kopiert ? t('Kopiert') : t('Kopieren')}
                </button>
              </dd>
              <dt className="text-sm text-slate-500">{t('Gültig bis')}</dt>
              <dd>{uhrzeit(zugang.bis)}</dd>
            </dl>
            <p className="text-sm text-slate-600">
              {t('Das Passwort wird nur jetzt angezeigt und nirgends gespeichert. Bitte nur an den Support weitergeben. Für ein neues Passwort den Zugang sperren und erneut freischalten.')}
            </p>
            <div className="flex justify-end"><button className="btn-primaer" onClick={() => setZugang(null)}>{t('Fertig')}</button></div>
          </div>
        )}
      </Dialog>
    </section>
  )
}

/** Nachweis-Datei einer Art: anzeigen, als PDF/Bild wählen oder mit der Kamera aufnehmen, entfernen. Gespeichert wird mit dem Dialog. */
function NachweisDatei({ art, entwurf, url, onNeu, onEntfernen }: {
  art: string
  entwurf: Entwurf
  url?: string
  onNeu: (datei: File) => void
  onEntfernen: () => void
}) {
  const datei = useRef<HTMLInputElement>(null)
  const kamera = useRef<HTMLInputElement>(null)
  const [fehler, setFehler] = useState('')
  const name = entwurf.neu?.name ?? (!entwurf.entfernen ? entwurf.datei_name : null)
  const pdf = /\.pdf$/i.test(name ?? '')
  const vor = art ? `${art}: ` : ''

  const gewaehlt = (liste: FileList | null) => {
    const f = liste?.[0]
    if (datei.current) datei.current.value = ''
    if (kamera.current) kamera.current.value = ''
    if (!f) return
    const pruefung = nachweisArt(f)
    if (pruefung !== 'pdf' && pruefung !== 'bild') return setFehler(tMeldung(pruefung))
    setFehler('')
    onNeu(f)
  }

  // Zwei Teile im Raster der Sachkunde-Zeile: Knöpfe neben „gültig bis“, Datei und Fehler darunter über die volle Breite
  return (
    <>
      <div className="flex gap-2">
        <button type="button" className="btn-sekundaer h-[42px] px-3" title={name ? t('Andere Datei wählen (PDF oder Bild)') : t('PDF oder Bild wählen')}
          onClick={() => datei.current?.click()}>
          <FileText className="size-4" aria-hidden />{t('Datei')}
        </button>
        <button type="button" className="btn-sekundaer h-[42px] px-3" title={t('Nachweis mit der Kamera fotografieren')} onClick={() => kamera.current?.click()}>
          <BildIcon className="size-4" aria-hidden />{t('Foto')}
        </button>
        <input ref={datei} type="file" accept="application/pdf,image/*" className="hidden" aria-label={vor + t('Nachweis-Datei wählen')}
          onChange={(e) => gewaehlt(e.target.files)} />
        <input ref={kamera} type="file" accept="image/*" capture="environment" className="hidden" aria-label={vor + t('Nachweis fotografieren')}
          onChange={(e) => gewaehlt(e.target.files)} />
      </div>
      <div className="space-y-2 empty:hidden sm:col-span-3" data-nachweis={art || 'tuer'}>
        {name && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            {pdf ? <FileText className="size-4 shrink-0 text-red-700" aria-hidden /> : <BildIcon className="size-4 shrink-0 text-sky-700" aria-hidden />}
            <span className={`min-w-32 flex-1 truncate ${istNichtLesbar(name) ? 'italic text-red-700' : ''}`}>{name}</span>
            {entwurf.neu ? <Badge farbe="gelb">{t('wird beim Speichern hochgeladen')}</Badge>
              : url ? <a className="link text-sm" href={url} target="_blank" rel="noopener noreferrer">{t('Ansehen')}</a>
                : url === '' && <Badge farbe="rot">{t('Datei nicht lesbar')}</Badge>}
            <button type="button" className="link text-sm text-red-700" onClick={onEntfernen}>{entwurf.neu ? t('Verwerfen') : t('Entfernen')}</button>
          </div>
        )}
        {fehler && <p className="text-xs text-red-700">{fehler}</p>}
      </div>
    </>
  )
}
