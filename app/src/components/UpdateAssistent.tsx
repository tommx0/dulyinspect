import { useEffect, useState } from 'react'
import { backupDateiname, backupErstellen } from '../datensicherung/sicherung'
import { herunterladen } from '../lib/csv'
import { t, tMeldung } from '../lib/sprache'
import { fehlertext, supabase } from '../lib/supabase'
import { bestaetigen } from './Bestaetigung'

type Migration = { version: string; name: string; sql: string; signatur: string }

/** Fehlertext aus der Antwort der Edge Function; fehlt die Funktion auf dem Server, ein Hinweis aufs Einrichten. */
async function funktionsfehler(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response }).context
  if (ctx?.status === 404) return t('Die Funktion „datenbank-aktualisieren“ ist auf diesem Server noch nicht eingerichtet. Bitte einmal per Ausroll-Skript aktualisieren.')
  try {
    const j = await ctx?.json()
    if (j?.fehler) return tMeldung(j.fehler)
  } catch { /* ignorieren */ }
  return fehlertext(error)
}

/**
 * Update-Assistent für Admins: spielt die Migrationen ein, die diese App-Version mitbringt und die Datenbank noch nicht hat.
 * Ausgeführt werden sie von der Edge Function „datenbank-aktualisieren“, und nur mit gültiger Signatur des Entwicklers
 * (siehe scripts/migrationen.mjs). Vorher empfiehlt er eine Datensicherung als ZIP.
 */
export function UpdateAssistent({ stand }: { stand: string }) {
  const [ausstehend, setAusstehend] = useState<Migration[] | null>(null)
  const [gesichert, setGesichert] = useState(false)
  const [fortschritt, setFortschritt] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState('')
  const [ergebnis, setErgebnis] = useState<string[] | null>(null)

  useEffect(() => {
    void fetch('./migrationen.json', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error(t('Migrationen nicht abrufbar (HTTP {status}).', { status: r.status })); return r.json() })
      .then((d: { migrationen: Migration[] }) => setAusstehend(d.migrationen.filter((m) => m.version > stand)))
      .catch((e) => setFehler(fehlertext(e)))
  }, [stand])

  const sichern = async () => {
    setFehler('')
    try {
      const { zip, backup } = await backupErstellen(true, setFortschritt)
      herunterladen(zip as BlobPart, backupDateiname('Backup_vor_Update', backup), 'application/zip')
      setGesichert(true)
    } catch (e) {
      setFehler(t('Sicherung nicht möglich: {fehler}. Bitte eine aktuelle Sicherung auf anderem Weg sicherstellen (z. B. Backup des Servers).', { fehler: fehlertext(e) }))
    } finally {
      setFortschritt('')
    }
  }

  const aktualisieren = async () => {
    if (!ausstehend?.length) return
    if (!await bestaetigen(t('{n} Datenbank-Änderung(en) jetzt einspielen? Das lässt sich nicht rückgängig machen.', { n: ausstehend.length }), { ok: t('Jetzt aktualisieren') })) return
    setFehler(''); setLaeuft(true)
    const { data, error } = await supabase.functions.invoke('datenbank-aktualisieren', { body: { migrationen: ausstehend } })
    setLaeuft(false)
    if (error) return setFehler(await funktionsfehler(error))
    setErgebnis((data as { eingespielt: string[] }).eingespielt)
  }

  if (ergebnis) {
    return (
      <div className="space-y-3 text-left text-sm" data-update-ergebnis>
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-green-800">
          {ergebnis.length ? t('{n} Änderung(en) eingespielt. Die Datenbank ist auf dem Stand dieser App.', { n: ergebnis.length }) : t('Alle Änderungen waren bereits eingespielt.')}
        </p>
        <button className="btn-primaer w-full" onClick={() => window.location.reload()}>{t('App neu laden')}</button>
      </div>
    )
  }

  return (
    <div className="space-y-3 text-left text-sm" data-update-assistent>
      {ausstehend === null && !fehler && <p className="text-slate-500">{t('Prüfe ausstehende Änderungen …')}</p>}
      {ausstehend && (
        <details className="rounded-md border border-slate-200 px-3 py-2">
          <summary className="cursor-pointer font-medium">{t('{n} ausstehende Datenbank-Änderung(en)', { n: ausstehend.length })}</summary>
          <ul className="mt-2 space-y-0.5 font-mono text-xs text-slate-600">
            {ausstehend.map((m) => <li key={m.version}>{m.version} {m.name}</li>)}
          </ul>
        </details>
      )}
      {ausstehend && ausstehend.length > 0 && (
        <>
          <div className="space-y-2">
            <button className="btn-sekundaer w-full" disabled={!!fortschritt || laeuft} onClick={() => void sichern()}>
              {fortschritt ? tMeldung(fortschritt) : t('Sicherung herunterladen (empfohlen)')}
            </button>
            <label className="flex items-start gap-2 font-normal">
              <input type="checkbox" className="mt-0.5" checked={gesichert} onChange={(e) => setGesichert(e.target.checked)} />
              {t('Es gibt eine aktuelle Sicherung der Daten.')}
            </label>
          </div>
          <button className="btn-primaer w-full" disabled={!gesichert || laeuft || !!fortschritt} onClick={() => void aktualisieren()}>
            {laeuft ? t('Datenbank wird aktualisiert …') : t('Datenbank jetzt aktualisieren')}
          </button>
        </>
      )}
      {ausstehend?.length === 0 && (
        <p className="text-slate-600">{t('Diese App bringt keine Änderungen mit, die der Datenbank fehlen. Bitte das Datenbank-Update per Ausroll-Skript einspielen.')}</p>
      )}
      {fehler && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-red-800" role="alert">{fehler}</p>}
    </div>
  )
}
