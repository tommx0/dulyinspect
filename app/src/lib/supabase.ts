import { createClient } from '@supabase/supabase-js'
import { anmeldungSpeicher } from './anmeldedauer'
import { DEMO, DEMO_TEXT, demoFetch } from './demo'
import { SUPABASE_KEY, SUPABASE_URL } from './konfig'
import { t, tMeldung } from './sprache'
import type { Database } from './datenbank.types'

// Aus konfig.js (Einzelinstanz-Image) oder den Build-Variablen, siehe konfig.ts
const url = SUPABASE_URL
const key = SUPABASE_KEY

if (!url || !key) {
  throw new Error('VITE_SUPABASE_URL und VITE_SUPABASE_PUBLISHABLE_KEY fehlen (siehe .env.example) – oder konfig.js')
}

// Speicherort der Anmeldung hängt von der beim Anmelden gewählten Dauer ab (siehe anmeldedauer.ts)
export const supabase = createClient<Database>(url, key, {
  auth: { storage: anmeldungSpeicher },
  ...(DEMO ? { global: { fetch: demoFetch() } } : {}),
})

export type Tabellen = Database['public']['Tables']
export type Zeile<T extends keyof Tabellen> = Tabellen[T]['Row']
export type Neu<T extends keyof Tabellen> = Tabellen[T]['Insert']
export type Aenderung<T extends keyof Tabellen> = Tabellen[T]['Update']
export type Enums = Database['public']['Enums']

/** Fehlertext aus Supabase/PostgREST verständlich machen. */
export function fehlertext(e: unknown): string {
  if (!e) return ''
  const m = typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e)
  if (m.includes('Demomodus')) return tMeldung(DEMO_TEXT)
  if (m.includes('row-level security')) return t('Keine Berechtigung für diese Aktion.')
  if (m.includes('duplicate key')) return t('Dieser Eintrag existiert bereits.')
  if (m.includes('violates foreign key')) return t('Der Eintrag wird noch verwendet und kann nicht gelöscht werden.')
  // Meldungen der Datenbank (raise exception) und der Serverfunktionen sind deutsch: übersetzen, wenn bekannt
  return tMeldung(m)
}
