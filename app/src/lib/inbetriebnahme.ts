// Inbetriebnahme-Assistent (src/seiten/Inbetriebnahme.tsx): Schritte und ihr Stand.
// Ein Schritt gilt als erledigt, wenn die Daten es zeigen (z. B. eigene Firmendaten statt der Mustervorgabe) oder der Admin ihn
// mit „Weiter“ bestätigt bzw. übersprungen hat (firma.inbetriebnahme.schritte). So stimmt der Stand auch, wenn jemand direkt in
// den Einstellungen arbeitet. Mit „abgeschlossen“ verschwindet der Hinweis auf der Startseite; der Assistent bleibt erreichbar.
import { t } from './sprache'

export const SCHRITTE = ['firmendaten', 'anlagen', 'vorlagen', 'rechtstexte', 'erscheinungsbild', 'etiketten', 'benutzer'] as const
export type Schritt = (typeof SCHRITTE)[number]

export const SCHRITT_INFO: Record<Schritt, { titel: string; text: string; optional?: boolean }> = {
  firmendaten: { titel: t('Firmendaten'), text: t('Name und Adresse Ihrer Firma stehen im Kopf jedes Prüfprotokolls, der Hinweistext darunter.') },
  anlagen: { titel: t('Zu prüfende Anlagen'), text: t('Welche Anlagenarten Ihr Betrieb prüft. Die App zeigt nur deren Felder, Begriffe und Vorlagen.') },
  vorlagen: { titel: t('Checklisten und Anlagentypen'), text: t('Beispiel-Checklisten mit passenden Anlagentypen für die gewählten Anlagenarten übernehmen oder eigene anlegen.') },
  rechtstexte: { titel: t('Impressum und Datenschutz'), text: t('Die Rechtstexte sind ohne Anmeldung über die Links unten auf jeder Seite lesbar.') },
  erscheinungsbild: { titel: t('Erscheinungsbild'), text: t('Logo, Farben und Name der App.'), optional: true },
  etiketten: { titel: t('Etiketten'), text: t('Präfix der Etikett-IDs für die QR-Etiketten an den Anlagen.'), optional: true },
  benutzer: { titel: t('Benutzer'), text: t('Prüfer und Planer anlegen, die mit der App arbeiten.') },
}

/** Vorgabe in neuen Instanzen (Migration 20261002160000_protokolle.sql) – gilt nicht als eingetragen */
export const MUSTER_FIRMA = 'Muster Prüfservice GmbH'

export type InbetriebnahmeStand = { schritte?: Partial<Record<Schritt, string>>; abgeschlossen?: string }

/** Was die Daten über die Schritte verraten */
export type Fakten = { firmenname: string; checklisten: number; impressum: string | null; datenschutz: string | null; benutzer: number }

/** firma.inbetriebnahme lesen (unbekannte Inhalte zählen als leer). */
export function standLesen(wert: unknown): InbetriebnahmeStand {
  if (!wert || typeof wert !== 'object' || Array.isArray(wert)) return {}
  const w = wert as Record<string, unknown>
  const schritte: Partial<Record<Schritt, string>> = {}
  if (w.schritte && typeof w.schritte === 'object' && !Array.isArray(w.schritte)) {
    for (const [k, v] of Object.entries(w.schritte)) if ((SCHRITTE as readonly string[]).includes(k) && typeof v === 'string') schritte[k as Schritt] = v
  }
  return { schritte, ...(typeof w.abgeschlossen === 'string' ? { abgeschlossen: w.abgeschlossen } : {}) }
}

function ausDaten(s: Schritt, f: Fakten): boolean {
  switch (s) {
    case 'firmendaten': return !!f.firmenname.trim() && f.firmenname.trim() !== MUSTER_FIRMA
    case 'vorlagen': return f.checklisten > 0
    case 'rechtstexte': return !!f.impressum?.trim() && !!f.datenschutz?.trim()
    case 'benutzer': return f.benutzer > 1
    default: return false
  }
}

/** Je Schritt: erledigt (aus den Daten oder bestätigt) */
export function schrittStand(f: Fakten, stand: InbetriebnahmeStand): Record<Schritt, boolean> {
  return Object.fromEntries(SCHRITTE.map((s) => [s, ausDaten(s, f) || !!stand.schritte?.[s]])) as Record<Schritt, boolean>
}

/** Schritt bestätigen (Zeitpunkt), ohne die übrigen anzufassen */
export function bestaetigt(stand: InbetriebnahmeStand, s: Schritt, jetzt = new Date().toISOString()): InbetriebnahmeStand {
  return { ...stand, schritte: { ...stand.schritte, [s]: stand.schritte?.[s] ?? jetzt } }
}

/** Erster offener Schritt (zum Fortsetzen); alles erledigt → null */
export function naechsterOffener(erledigt: Record<Schritt, boolean>): Schritt | null {
  return SCHRITTE.find((s) => !erledigt[s]) ?? null
}
