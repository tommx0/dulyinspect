// Zwei-Faktor-Anmeldung (TOTP): Pflicht setzt der Admin je Benutzer, die Datenbank lässt ohne bestätigten Faktor nichts zu.
import { supabase } from './supabase'

/** ok = weiter in die App; einrichten = Pflicht, aber noch keine Authenticator-App; code = Code der App eingeben. */
export type ZweiFaktorStand = 'ok' | 'einrichten' | 'code'

export async function zweiFaktorStand(): Promise<ZweiFaktorStand> {
  const { data: stufe } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (stufe?.currentLevel === 'aal2') return 'ok'
  const { data: pflicht, error } = await supabase.rpc('zwei_faktor_pflicht')
  // Ohne Netz offline weiterarbeiten; ohne zweiten Faktor überträgt der Server ohnehin nichts
  if (error || !pflicht) return 'ok'
  return stufe?.nextLevel === 'aal2' ? 'code' : 'einrichten'
}

/**
 * Das eigene Profil ist nicht lesbar (PGRST116): deaktiviert, zweiter Faktor fehlt – oder unklar (z. B. eine Störung)?
 * Den Gerätespeicher löscht src/auth.tsx nur bei einer klaren Aussage des Servers („deaktiviert“).
 */
export async function profilFehltGrund(): Promise<'deaktiviert' | 'zwei_faktor' | 'unklar'> {
  const { data: stufe } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (stufe?.currentLevel !== 'aal2') {
    const { data: pflicht, error } = await supabase.rpc('zwei_faktor_pflicht')
    if (error) return 'unklar'
    if (pflicht) return 'zwei_faktor'
  }
  // berechtigt: false heißt: nicht aktiv (deaktiviert, Supportzugang abgelaufen) bei erfülltem zweitem Faktor
  const { data, error } = await supabase.rpc('verschluesselung_kennung')
  if (error || !data || typeof data !== 'object') return 'unklar'
  return (data as { berechtigt?: unknown }).berechtigt === false ? 'deaktiviert' : 'unklar'
}
