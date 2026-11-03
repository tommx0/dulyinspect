// Laufzeit-Konfiguration: konfig.js (neben index.html, vor der App geladen) setzt window.__KONFIG__.
// Ausgeliefert wird eine leere Datei, dann gelten die Build-Variablen (deploybase, Coolify). Das Einzelinstanz-Image
// schreibt sie beim Start mit Adresse und öffentlichem Schlüssel der Instanz – ein Image für jede Instanz.
// Offline: konfig.js kommt aus dem Laufzeit-Cache des Service Workers (vite.config.ts), sonst aus dem Gerätespeicher.

export type Konfig = {
  supabaseUrl?: string; supabaseKey?: string; appAdresse?: string
  /** Ersteinrichtung: wo der Einrichtungsschlüssel steht (Einzelinstanz: Datei im Datenordner) */
  einrichtungHinweis?: string
  /** Ersteinrichtung ohne Eingabe des Schlüssels (Einzelinstanz mit EINRICHTUNG_OHNE_SCHLUESSEL=ja, nur für Tests) */
  einrichtungsschluessel?: string
}

const SPEICHER = 'tuerpruefung:konfig'

function laden(): Konfig {
  const k = (globalThis as { __KONFIG__?: Konfig }).__KONFIG__
  try {
    if (k?.supabaseUrl) localStorage.setItem(SPEICHER, JSON.stringify(k))
    else return JSON.parse(localStorage.getItem(SPEICHER) ?? '{}') as Konfig
  } catch { /* kein localStorage (Tests, privater Modus) */ }
  return k ?? {}
}

const laufzeit = laden()

export const SUPABASE_URL: string | undefined = laufzeit.supabaseUrl || import.meta.env?.VITE_SUPABASE_URL
export const SUPABASE_KEY: string | undefined = laufzeit.supabaseKey || import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY
export const APP_ADRESSE: string | undefined = laufzeit.appAdresse || import.meta.env?.VITE_APP_ADRESSE
export const EINRICHTUNG_HINWEIS: string | undefined = laufzeit.einrichtungHinweis
export const EINRICHTUNGSSCHLUESSEL: string | undefined = laufzeit.einrichtungsschluessel
