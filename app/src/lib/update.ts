/** Zeitraum nach dem Start, in dem eine neue Version automatisch geladen werden darf. */
export const START_FENSTER_MS = 60_000

/**
 * Neue Versionen ohne Hinweisbalken laden (Build-Variable VITE_UPDATE=automatisch, z. B. im Einzelinstanz-Image).
 * Dann lädt die App selbst in einem unkritischen Moment neu (siehe stillAktualisieren); ohne Variable fragt der Balken.
 */
export const OHNE_NACHFRAGE = import.meta.env?.VITE_UPDATE === 'automatisch'

/** Kein Neuladen auf einer Prüfseite und solange auf dem Gerät eine eigene Tür in Prüfung ist. */
function sicher(a: { pfad: string; offeneAnlagen: number }): boolean {
  return !/\/pruefen\/[^/]+\/(p\/|abschluss)/.test(a.pfad) && a.offeneAnlagen === 0
}

/**
 * Neue App-Version ohne Rückfrage laden? Nur kurz nach dem Start (der Benutzer arbeitet noch nicht),
 * nicht auf einer Prüfseite und nur, wenn auf dem Gerät keine eigene Tür in Prüfung ist.
 * Sonst bleibt es beim Hinweisbalken – nie ein unbemerktes Neuladen mitten in der Arbeit.
 */
export function automatischAktualisieren(a: { msSeitStart: number; pfad: string; offeneAnlagen: number }): boolean {
  return a.msSeitStart <= START_FENSTER_MS && sicher(a)
}

/**
 * Ohne Nachfrage (OHNE_NACHFRAGE) auch später laden, aber nur in Momenten, in denen nichts verloren geht: beim Wechsel
 * auf eine andere Seite (die vorige ist verlassen) oder wenn die App in den Hintergrund geht – nie während einer Prüfung.
 */
export function stillAktualisieren(a: { pfad: string; offeneAnlagen: number }): boolean {
  return sicher(a)
}
