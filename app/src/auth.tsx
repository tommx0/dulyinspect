import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { fehlertext, supabase, type Zeile } from './lib/supabase'
import { t, tMeldung } from './lib/sprache'
import { db, lokaleDatenLoeschen } from './offline/db'
import { kundendatenLoeschungPruefen } from './offline/kundendatenGeloescht'
import { istNetzwerkfehler, syncBisLeer } from './offline/sync'
import { bestaetigen, bestaetigenMitHaekchen } from './components/Bestaetigung'
import { Entwickler } from './components/Entwickler'
import { Ersteinrichtung } from './components/Ersteinrichtung'
import { RechtsLinks } from './components/Rechtstext'
import { Logo } from './components/Logo'
import { PasswortAendern } from './components/PasswortAendern'
import { LizenzHinweis } from './components/LizenzHinweis'
import { VorschauHinweis } from './components/VorschauHinweis'
import { ZweiFaktor } from './components/ZweiFaktor'
import { VerschluesselungHinweis, Verschluesselungssperre } from './components/Verschluesselungssperre'
import { lizenzAkzeptieren, lizenzAkzeptiert, lizenzInDatenbankPruefen, lizenzNachmelden } from './lib/lizenzAkzeptanz'
import { loggen, logAbschliessen } from './lib/log'
import { aktivitaetMerken, aktivitaetVergessen, anmeldedauer, ANMELDEDAUER_TEXT, anmeldedauerMerken, inaktivAbgelaufen, type Anmeldedauer } from './lib/anmeldedauer'
import { eigeneSachkundeVergessen } from './lib/sachkunde'
import { anmeldeEmail } from './lib/support'
import {
  appGesperrt, beiNichtBerechtigt, blattOffenLaden, fristPruefen, geraetLeerenSchluesselBehalten, pruefen as verschluesselungPruefen,
  schluesselAufGeraet, schluesselVergessen, useVerschluesselung,
} from './lib/verschluesselung/schluessel'
import { VORSCHAU, vorschauBestaetigtFuer, vorschauMerken } from './lib/vorschau'
import { DEMO, demoSchreibenErlauben, demoSperreAktiv } from './lib/demo'
import { simulationenVergessen } from './lib/demoCheckliste'
import { LIZENZ_LINK } from './lib/entwickler'
import { profilFehltGrund, zweiFaktorStand, type ZweiFaktorStand } from './lib/zweiFaktor'
import { Auswahl } from './components/Auswahl'

const PROFIL_CACHE = 'tuerpruefung:profil'
const DEAKTIVIERT = t('Ihr Zugang ist deaktiviert. Die Daten auf diesem Gerät wurden gelöscht. Bitte wenden Sie sich an den Administrator.')

/** Lokale Prüfdaten gehören zum Benutzer – nicht für den nächsten auf diesem Gerät liegen lassen. Löscht auch den Schlüssel der Verschlüsselung. */
async function lokalesVergessen() {
  await lokaleDatenLoeschen()
  schluesselVergessen()
  try { localStorage.removeItem(PROFIL_CACHE) } catch { /* egal */ }
  vorschauMerken(null)
  eigeneSachkundeVergessen()
  aktivitaetVergessen()
  simulationenVergessen()
}

/**
 * Abmelden und Sitzungsende: wie lokalesVergessen, der Schlüssel der Verschlüsselung bleibt aber auf dem Gerät – sonst müsste
 * nach jeder Nacht das Schlüsselblatt gescannt werden. Nicht übertragene Änderungen bleiben samt Gerätespeicher für die
 * nächste Anmeldung liegen, außer `auchOutbox` (Abmelden von Hand). Den Schlüssel löschen nur das Häkchen beim Abmelden,
 * Deaktivieren und die Frist ohne Serverkontakt.
 */
async function lokalesVergessenSchluesselBleibt(optionen: { auchOutbox?: boolean } = {}) {
  await geraetLeerenSchluesselBehalten(optionen)
  try { localStorage.removeItem(PROFIL_CACHE) } catch { /* egal */ }
  vorschauMerken(null)
  eigeneSachkundeVergessen()
  aktivitaetVergessen()
  simulationenVergessen()
}

interface AuthKontext {
  session: Session | null
  benutzer: Zeile<'benutzer'> | null
  /** Verwaltungsrechte: Admin oder Planer */
  istAdmin: boolean
  /** Systemverwaltung (Einstellungen, Benutzer, Datensicherung): nur Admin */
  istSystemadmin: boolean
  /** System-Bereiche sehen: Admin, im Demomodus auch Planer (nur Ansicht) */
  systemSichtbar: boolean
  abmelden: () => Promise<void>
  /** Zwei-Faktor-Pflicht neu prüfen (z. B. nachdem der Admin sie für sich selbst eingeschaltet hat) */
  zweiFaktorPruefen: () => void
}

const Kontext = createContext<AuthKontext | null>(null)

export function useAuth(): AuthKontext {
  const k = useContext(Kontext)
  if (!k) throw new Error('useAuth außerhalb von AuthProvider')
  return k
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [benutzer, setBenutzer] = useState<Zeile<'benutzer'> | null>(null)
  const [profilFehler, setProfilFehler] = useState('')
  const [hinweisBestaetigt, setHinweisBestaetigt] = useState(vorschauBestaetigtFuer)
  // Lizenzbedingungen dieser App-Version: Benutzer, für den sie akzeptiert sind bzw. noch gefragt werden muss
  const [lizenzOk, setLizenzOk] = useState<string | null>(null)
  const [lizenzFrage, setLizenzFrage] = useState<string | null>(null)
  const [zweiFaktor, setZweiFaktor] = useState<ZweiFaktorStand | null>(null)
  const [pruefRunde, setPruefRunde] = useState(0)
  const zweiFaktorPruefen = () => setPruefRunde((n) => n + 1)
  // Verschlüsselung (docs/KONZEPT-VERSCHLUESSELUNG.md): Schlüssel des Geräts gegen den Server, sonst Sperrbildschirm
  const verschluesselung = useVerschluesselung()
  // Grund einer Abmeldung von außen (Zugang deaktiviert), für die Anmeldeseite
  const [abmeldeHinweis, setAbmeldeHinweis] = useState('')

  useEffect(() => {
    // Frist ohne Serverkontakt (Verschlüsselung): beim Start prüfen, auch ohne Sitzung und ohne Netz
    void fristPruefen().catch(() => undefined)
    supabase.auth.getSession().then(async ({ data }) => {
      // „Nur bis zum Schließen“: Anmeldung ist mit dem Schließen weg – ohne Abmelden liegen die Daten noch da.
      // Nicht übertragene Änderungen und der Schlüssel bleiben für die nächste Anmeldung liegen.
      if (!data.session && anmeldedauer() === 'sitzung') await lokalesVergessenSchluesselBleibt()
      setSession(data.session)
    })
    const { data } = supabase.auth.onAuthStateChange((e, s) => {
      setSession(s)
      // Sitzung anders beendet (abgelaufen, widerrufen): alter Zeitpunkt darf die nächste Anmeldung nicht sofort beenden
      if (!s) aktivitaetVergessen()
      // Beendet (Zugang gesperrt, Anmeldung abgelaufen oder widerrufen, auch beim Abmelden): Gerätedaten löschen, der Schlüssel
      // bleibt. Nicht übertragene Änderungen bleiben für die nächste Anmeldung liegen. Ein gesperrter Zugang löscht den
      // Schlüssel beim nächsten Anmeldeversuch, sonst die Frist ohne Serverkontakt.
      if (e === 'SIGNED_OUT') void lokalesVergessenSchluesselBleibt()
      if (e === 'TOKEN_REFRESHED' || e === 'MFA_CHALLENGE_VERIFIED') zweiFaktorPruefen()
    })
    // Pflicht kann der Admin jederzeit einschalten: beim Zurückkehren in die App erneut prüfen
    const sichtbar = () => { if (document.visibilityState === 'visible') zweiFaktorPruefen() }
    document.addEventListener('visibilitychange', sichtbar)
    return () => {
      data.subscription.unsubscribe()
      document.removeEventListener('visibilitychange', sichtbar)
    }
  }, [])

  const userId = session?.user.id
  useEffect(() => {
    if (!userId) return setZweiFaktor(null)
    let aktiv = true
    void zweiFaktorStand().then((z) => { if (aktiv) setZweiFaktor(z) })
    return () => { aktiv = false }
  }, [userId, pruefRunde])

  const freigegeben = zweiFaktor === 'ok'
  // Der Server verweigert der Verschlüsselung jede Aussage, obwohl eine Sitzung besteht: Profil und zweiten Faktor neu prüfen
  // (deaktiviert → Gerät löschen, siehe unten)
  const [profilRunde, setProfilRunde] = useState(0)
  useEffect(() => beiNichtBerechtigt(() => { setProfilRunde((n) => n + 1); zweiFaktorPruefen() }), [])
  useEffect(() => {
    if (!userId) {
      setBenutzer(null)
      return
    }
    if (!freigegeben) return
    // Abgelaufene Freischaltung des Supportzugangs sperren, wo die Datenbank das nicht selbst jede Minute tut (ohne pg_cron)
    void supabase.rpc('support_ablauf')
    supabase
      .from('benutzer')
      .select('*')
      .eq('id', userId)
      .single()
      .then(({ data, error }) => {
        if (error && istNetzwerkfehler(error)) {
          // Offline: zuletzt bekanntes Profil verwenden, damit vor Ort weitergearbeitet werden kann
          try {
            const cache = JSON.parse(localStorage.getItem(PROFIL_CACHE) ?? 'null') as Zeile<'benutzer'> | null
            if (cache?.id === userId) return setBenutzer(cache)
          } catch { /* kein Cache */ }
          setProfilFehler(t('Keine Verbindung. Bitte einmal online anmelden.'))
        } else if (data && !data.aktiv) {
          // Deaktiviert: Schlüssel und Gerätespeicher löschen und abmelden – auch nicht übertragene Änderungen, ein
          // deaktivierter Benutzer darf nichts mehr schreiben (Konzept „Abgang eines Mitarbeiters“)
          void geraetLoeschenUndAbmelden(DEAKTIVIERT)
        } else if (error?.code === 'PGRST116') {
          // Profil nicht lesbar: nur löschen, wenn der Server klar „nicht aktiv“ sagt – sonst (Störung, zweiter Faktor) nur melden
          void profilFehltGrund().then((grund) => {
            if (grund === 'deaktiviert') void geraetLoeschenUndAbmelden(DEAKTIVIERT)
            else if (grund === 'zwei_faktor') zweiFaktorPruefen()
            else setProfilFehler(t('Das Benutzerprofil ließ sich nicht laden. Bitte später erneut versuchen oder den Administrator informieren.'))
          })
        } else if (error || !data) setProfilFehler(fehlertext(error) || t('Benutzerprofil nicht gefunden'))
        else if (data.aktiv_bis && new Date(data.aktiv_bis) <= new Date()) {
          void geraetLoeschenUndAbmelden(t('Die Freischaltung des Supportzugangs ist abgelaufen. Die Daten auf diesem Gerät wurden gelöscht.'))
        } else {
          setBenutzer(data)
          try { localStorage.setItem(PROFIL_CACHE, JSON.stringify(data)) } catch { /* Speicher voll/gesperrt */ }
        }
      })
  }, [userId, freigegeben, profilRunde])

  const benutzerId = benutzer?.id
  // Vorgegebenes Passwort (Ersteinrichtung durch die Verwaltung, vom Admin gesetzt): erst ein eigenes festlegen.
  // Fehlt die Funktion (ältere Datenbank) oder das Netz, nicht sperren – offline muss weitergearbeitet werden können.
  const [passwortGeprueft, setPasswortGeprueft] = useState<{ id: string; noetig: boolean } | null>(null)
  useEffect(() => {
    if (!benutzerId) return setPasswortGeprueft(null)
    let aktiv = true
    void supabase.rpc('passwort_aendern_noetig').then(({ data }) => { if (aktiv) setPasswortGeprueft({ id: benutzerId, noetig: data === true }) })
    return () => { aktiv = false }
  }, [benutzerId])
  // Schon beim Rendern setzen: Effekte der Kinder laufen vor denen dieser Komponente
  demoSchreibenErlauben(benutzer?.rolle === 'admin')
  // Bedingung 3: beim Start, bei jeder Anmeldung, bei Rückkehr in die App und wenn das Netz zurückkommt (vor jedem Abgleich
  // zusätzlich in src/offline/sync.ts und abgleich.ts)
  useEffect(() => {
    if (!benutzerId) return
    const pruefenJetzt = () => {
      void verschluesselungPruefen().catch(() => undefined)
      // Alle Kundendaten gelöscht? Dann auch hier den Gerätespeicher leeren (src/offline/kundendatenGeloescht.ts)
      void kundendatenLoeschungPruefen().catch(() => undefined)
    }
    const sichtbar = () => { if (document.visibilityState === 'visible') pruefenJetzt() }
    pruefenJetzt()
    document.addEventListener('visibilitychange', sichtbar)
    window.addEventListener('online', pruefenJetzt)
    return () => {
      document.removeEventListener('visibilitychange', sichtbar)
      window.removeEventListener('online', pruefenJetzt)
    }
  }, [benutzerId])

  useEffect(() => {
    if (!benutzerId) return
    let aktiv = true
    if (lizenzAkzeptiert(benutzerId)) {
      setLizenzOk(benutzerId)
      void lizenzNachmelden(benutzerId)
    } else {
      void lizenzInDatenbankPruefen(benutzerId).then((ja) => {
        if (!aktiv) return
        if (ja) setLizenzOk(benutzerId)
        else setLizenzFrage(benutzerId)
      })
    }
    return () => { aktiv = false }
  }, [benutzerId])

  /**
   * Der Schlüssel der Verschlüsselung bleibt auf dem Gerät, außer `schluesselLoeschen` (Häkchen beim Abmelden).
   * `automatisch`: ohne Rückfrage – nicht übertragene Änderungen bleiben liegen.
   */
  const abmeldenAusfuehren = async (logtext: string, optionen: { automatisch?: boolean; schluesselLoeschen?: boolean } = {}) => {
    await logAbschliessen(logtext)
    await supabase.auth.signOut({ scope: 'local' })
    if (optionen.schluesselLoeschen) await lokalesVergessen()
    else await lokalesVergessenSchluesselBleibt({ auchOutbox: !optionen.automatisch })
    setHinweisBestaetigt(null)
    setProfilFehler('')
  }

  /** Zugang deaktiviert oder abgelaufen: alles vom Gerät löschen (auch die Outbox) und abmelden. */
  const geraetLoeschenUndAbmelden = async (hinweis: string) => {
    await lokalesVergessen()
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
    setHinweisBestaetigt(null)
    setProfilFehler('')
    setAbmeldeHinweis(hinweis)
  }

  const abmelden = async () => {
    // Schlüssel auf dem Gerät: er bleibt, außer der Benutzer gibt das Gerät ab (Häkchen)
    let schluesselLoeschen = false
    if (await schluesselAufGeraet()) {
      const a = await bestaetigenMitHaekchen(t('Abmelden? Der Schlüssel der Verschlüsselung bleibt auf diesem Gerät – nach der nächsten Anmeldung ist alles sofort lesbar.'),
        t('Schlüssel von diesem Gerät löschen (z. B. wenn das Gerät abgegeben wird). Danach muss das Schlüsselblatt neu gescannt werden.'), { ok: t('Abmelden') })
      if (!a.ja) return
      schluesselLoeschen = a.haekchen
    }
    // Schlüsselblatt noch nicht bestätigt: dieses Gerät hält womöglich den einzigen Schlüssel der Instanz
    if (schluesselLoeschen && await blattOffenLaden() && !await bestaetigen(t('Das Schlüsselblatt der Verschlüsselung ist noch nicht als verwahrt bestätigt. Dieses Gerät hat womöglich den einzigen Schlüssel – nach dem Abmelden wären alle verschlüsselten Daten verloren.\n\nBitte zuerst unter Einstellungen → Verschlüsselung das Schlüsselblatt drucken und bestätigen. Trotzdem abmelden und den Schlüssel löschen?'),
      { ok: t('Trotzdem abmelden'), gefahr: true })) return
    const ausstehend = await db.outbox.count()
    if (ausstehend > 0 && !await bestaetigen(demoSperreAktiv()
      ? t('Demomodus: Ihre simulierten Prüfungen auf diesem Gerät werden beim Abmelden verworfen.\n\nAbmelden?')
      : t('{n} Änderung(en) sind noch nicht übertragen und gehen beim Abmelden verloren.\n\nTrotzdem abmelden?', { n: ausstehend }), { ok: t('Abmelden'), gefahr: true })) return
    await abmeldenAusfuehren((ausstehend > 0 ? `Abmeldung (${ausstehend} Änderung(en) nicht übertragen und verworfen)` : 'Abmeldung')
      + (schluesselLoeschen ? ', Schlüssel vom Gerät gelöscht' : ''), { schluesselLoeschen })
  }

  // Nach 12 Stunden ohne Bedienung automatisch abmelden (außer bei „dauerhaft“). Nicht übertragene Prüfdaten werden dabei nie verworfen:
  // erst übertragen, ohne Verbindung bei der nächsten Prüfung erneut versuchen.
  useEffect(() => {
    if (!userId) return
    let laeuft = false
    const abgelaufenAbmelden = async () => {
      if (laeuft) return
      laeuft = true
      try {
        // Demomodus: die Outbox wird nie übertragen – die Simulation verfällt mit der Abmeldung
        if (!demoSperreAktiv() && await db.outbox.count() > 0 && (!await syncBisLeer() || await db.outbox.count() > 0)) return
        await abmeldenAusfuehren('Automatische Abmeldung nach 12 Stunden ohne Bedienung', { automatisch: true })
      } finally { laeuft = false }
    }
    const pruefen = () => { if (inaktivAbgelaufen()) void abgelaufenAbmelden() }
    // Abgelaufen bleibt abgelaufen: die erste Berührung nach der Rückkehr setzt die Zeit nicht zurück
    const bedienung = () => { if (inaktivAbgelaufen()) void abgelaufenAbmelden(); else aktivitaetMerken() }
    const sichtbar = () => { if (document.visibilityState === 'visible') pruefen() }
    const ereignisse = ['pointerdown', 'keydown', 'wheel'] as const
    pruefen()
    ereignisse.forEach((e) => window.addEventListener(e, bedienung, { capture: true, passive: true }))
    document.addEventListener('visibilitychange', sichtbar)
    const takt = setInterval(pruefen, 60_000)
    return () => {
      ereignisse.forEach((e) => window.removeEventListener(e, bedienung, { capture: true }))
      document.removeEventListener('visibilitychange', sichtbar)
      clearInterval(takt)
    }
  }, [userId])

  // Supportzugang: mit dem Ende der Freischaltung abmelden (die Datenbank sperrt ab dann ohnehin)
  const aktivBis = benutzer?.aktiv_bis
  useEffect(() => {
    if (!aktivBis) return
    const takt = setTimeout(() => {
      void supabase.rpc('support_ablauf').then(() => abmeldenAusfuehren('Abmeldung: Freischaltung des Supportzugangs abgelaufen', { automatisch: true, schluesselLoeschen: true }))
    }, Math.max(0, Math.min(new Date(aktivBis).getTime() - Date.now(), 2 ** 31 - 1)))
    return () => clearTimeout(takt)
  }, [aktivBis])

  if (session === undefined) return <Vollbild>{t('Laden …')}</Vollbild>
  if (!session) return <Anmeldung hinweis={abmeldeHinweis} />
  if (!zweiFaktor) return <Vollbild>{t('Laden …')}</Vollbild>
  if (zweiFaktor !== 'ok') return <ZweiFaktor key={zweiFaktor} stand={zweiFaktor} onFertig={zweiFaktorPruefen} onAbmelden={abmelden} />
  if (profilFehler) {
    return (
      <Vollbild>
        <p className="text-red-700">{profilFehler}</p>
        <button className="btn-sekundaer mt-4" onClick={abmelden}>{t('Abmelden')}</button>
      </Vollbild>
    )
  }
  if (!benutzer) return <Vollbild>{t('Laden …')}</Vollbild>
  if (VORSCHAU && hinweisBestaetigt !== benutzer.id) {
    return <VorschauHinweis onBestaetigt={() => { vorschauMerken(benutzer.id); setHinweisBestaetigt(benutzer.id) }} onAbmelden={abmelden} />
  }

  // Freie Fassung (VITE_LIZENZ_LINK): keine Lizenzbedingungen des Entwicklers zu bestätigen
  if (!LIZENZ_LINK && lizenzOk !== benutzer.id) {
    if (lizenzFrage !== benutzer.id) return <Vollbild>{t('Laden …')}</Vollbild>
    return <LizenzHinweis onAkzeptiert={() => { void lizenzAkzeptieren(benutzer.id); setLizenzOk(benutzer.id) }} onAbmelden={abmelden} />
  }

  if (passwortGeprueft?.id !== benutzer.id) return <Vollbild>{t('Laden …')}</Vollbild>
  if (passwortGeprueft.noetig) {
    return <PasswortAendern onFertig={() => setPasswortGeprueft({ id: benutzer.id, noetig: false })} onAbmelden={abmelden} />
  }

  const istSystemadmin = benutzer.rolle === 'admin'
  if (appGesperrt(verschluesselung, istSystemadmin)) {
    return <Verschluesselungssperre zustand={verschluesselung} systemadmin={istSystemadmin} onAbmelden={abmelden} />
  }

  return (
    <Kontext.Provider value={{ session, benutzer, istAdmin: benutzer.rolle === 'admin' || benutzer.rolle === 'planer', istSystemadmin,
      systemSichtbar: istSystemadmin || (DEMO && benutzer.rolle === 'planer'), abmelden, zweiFaktorPruefen }}>
      <VerschluesselungHinweis systemadmin={istSystemadmin} />
      {children}
    </Kontext.Provider>
  )
}

/** Inhalt nur für Admins; Prüfer sehen einen Hinweis. */
export function NurAdmin({ children }: { children: ReactNode }) {
  const { istAdmin } = useAuth()
  if (!istAdmin) return <p className="p-6 text-slate-600">{t('Dieser Bereich ist Administratoren vorbehalten.')}</p>
  return <>{children}</>
}

/**
 * Systemverwaltung nur für Admins (nicht für Planer). Im Demomodus sehen Planer sie auch: `lesen` (Logdateien, Gesamtliste)
 * wie der Admin, sonst mit gesperrten Knöpfen und Feldern.
 */
export function NurSystemadmin({ children, lesen }: { children: ReactNode; lesen?: boolean }) {
  const { istSystemadmin, systemSichtbar } = useAuth()
  if (!systemSichtbar) return <p className="p-6 text-slate-600">{t('Dieser Bereich ist Administratoren vorbehalten.')}</p>
  if (istSystemadmin || lesen) return <>{children}</>
  return (
    <>
      <p className="mx-auto mt-4 max-w-7xl px-4 text-sm text-amber-800">{t('Demomodus: Diesen Bereich verwaltet der Admin – Sie sehen ihn nur zur Ansicht.')}</p>
      {/* Ein deaktiviertes fieldset sperrt alle Knöpfe und Felder darin; Links bleiben bedienbar */}
      <fieldset disabled className="contents">{children}</fieldset>
    </>
  )
}

function Vollbild({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh flex-col items-center justify-center p-6 text-center">{children}</div>
}

function Anmeldung({ hinweis = '' }: { hinweis?: string }) {
  const [email, setEmail] = useState('')
  const [passwort, setPasswort] = useState('')
  const [fehler, setFehler] = useState(hinweis)
  const [dauer, setDauer] = useState(anmeldedauer)
  const [laeuft, setLaeuft] = useState(false)
  // Neue Instanz ohne Zugang: Ersteinrichtung statt Anmeldung (fehlt die Funktion, ist die Datenbank älter → Anmeldung)
  const [einrichtung, setEinrichtung] = useState(false)
  useEffect(() => {
    let aktiv = true
    void supabase.rpc('ersteinrichtung_offen').then(({ data }) => { if (aktiv) setEinrichtung(data === true) })
    return () => { aktiv = false }
  }, [])

  const absenden = async (e: FormEvent) => {
    e.preventDefault()
    setLaeuft(true)
    setFehler('')
    // Vor der Anmeldung merken: bestimmt, wo supabase-js die neue Anmeldung ablegt
    anmeldedauerMerken(dauer)
    const { error } = await supabase.auth.signInWithPassword({ email: anmeldeEmail(email), password: passwort })
    setLaeuft(false)
    if (error?.message === 'User is banned') {
      // Gesperrter Zugang: Schlüssel und Gerätespeicher löschen (Konzept Verschlüsselung, „Abgang eines Mitarbeiters“)
      await lokalesVergessen()
      setFehler(t('Dieser Zugang ist gesperrt. Die Daten auf diesem Gerät wurden gelöscht.'))
    } else if (error) setFehler(error.message === 'Invalid login credentials' ? t('E-Mail oder Passwort ist falsch.') : tMeldung(error.message))
    else {
      aktivitaetMerken(true)
      void loggen('Anmeldung', `Angemeldet bleiben: ${ANMELDEDAUER_TEXT[dauer]}`)
    }
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden p-4">
      {/* Wasserzeichen: Agentur-Vorschau. Als SVG, damit es auf jeder Bildschirmgröße vollständig passt; fängt keine Klicks ab. */}
      {VORSCHAU && <div className="pointer-events-none fixed inset-0 z-10 select-none" data-wasserzeichen>
        {([['landscape:block portrait:hidden', '0 0 1000 600', -25], ['portrait:block landscape:hidden', '0 0 600 1000', -60]] as const).map(([klasse, box, winkel]) => {
          const [, , b, h] = box.split(' ').map(Number)
          return (
            <svg key={box} viewBox={box} preserveAspectRatio="xMidYMid meet" className={`hidden h-full w-full ${klasse}`} aria-hidden="true">
              <text x={b / 2} y={h / 2} transform={`rotate(${winkel} ${b / 2} ${h / 2})`} textAnchor="middle" dominantBaseline="middle"
                fontSize="120" fontWeight="900" textLength="900" lengthAdjust="spacingAndGlyphs" fill="#0f172a" fillOpacity="0.08"
                fontFamily="'Inter','Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif">{t('VORSCHAUVERSION')}</text>
            </svg>
          )
        })}
        <span className="sr-only">{t('Vorschauversion')}</span>
      </div>}
      <div className="karte w-full max-w-sm space-y-4 p-6">
        <div className="space-y-2 text-center">
          <h1><Logo className="mx-auto max-h-28 w-full max-w-72 object-contain" /></h1>
        </div>
        {einrichtung ? <Ersteinrichtung onAbgeschlossen={(hinweis) => { setEinrichtung(false); setFehler(hinweis) }} /> : (
          <form onSubmit={absenden} className="space-y-4">
            <div>
              <label htmlFor="email">{t('E-Mail')}</label>
              {/* Kein type="email": der Supportzugang meldet sich mit dem Benutzernamen „support“ an */}
              <input id="email" type="text" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username"
                required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label htmlFor="passwort">{t('Passwort')}</label>
              <input id="passwort" type="password" autoComplete="current-password" required value={passwort}
                onChange={(e) => setPasswort(e.target.value)} />
            </div>
            <div>
              <label htmlFor="dauer">{t('Angemeldet bleiben?')}</label>
              <Auswahl id="dauer" value={dauer} onChange={(e) => setDauer(e.target.value as Anmeldedauer)}>
                {(Object.keys(ANMELDEDAUER_TEXT) as Anmeldedauer[]).map((d) => <option key={d} value={d}>{t(ANMELDEDAUER_TEXT[d])}</option>)}
              </Auswahl>
              {dauer === '12h' ? (
                <p className="mt-1 text-xs text-slate-500">
                  {t('Abmeldung nach 12 Stunden ohne Bedienung. Bis dahin kann jeder mit dem entsperrten Gerät in Ihrem Namen arbeiten: Bildschirmsperre nutzen.')}
                </p>
              ) : (
                <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <p className="font-medium">{t('Sicherheitsrisiko')}</p>
                  {dauer === 'dauerhaft' ? <>
                    <p>{t('Wer das Gerät entsperrt in die Hand bekommt, arbeitet ohne Passwort in Ihrem Namen und sieht alle Kunden-, Objekt- und Prüfdaten, zeitlich unbegrenzt.')}</p>
                    <p className="mt-1">{t('Nur auf Ihrem eigenen Gerät mit Bildschirmsperre wählen. Bei Verlust sofort den Administrator informieren, damit er den Zugang sperrt.')}</p>
                  </> : <>
                    <p>{t('Browser, die beim Start die letzten Tabs wiederherstellen, behalten die Anmeldung womöglich. Melden Sie sich auf fremden Geräten deshalb immer selbst ab.')}</p>
                    <p className="mt-1">{t('Ohne Netz ist nach dem Schließen keine neue Anmeldung möglich – für die Prüfung vor Ort ungeeignet.')}</p>
                  </>}
                </div>
              )}
            </div>
            {fehler &&<p className="text-sm text-red-700">{fehler}</p>}
            <button className="btn-primaer w-full" disabled={laeuft}>{laeuft ? t('Anmelden …') : t('Anmelden')}</button>
            <p className="text-xs text-slate-500">
              {t('Zugänge werden vom Administrator vergeben.')}
            </p>
          </form>
        )}
        <RechtsLinks mitHilfe className="border-t border-slate-100 pt-3" />
        <Entwickler />
      </div>
    </div>
  )
}
