// Wie lange die Anmeldung auf diesem Gerät hält – beim Anmelden gewählt:
// - sitzung:   nur bis Browser bzw. App geschlossen werden (Anmeldung liegt im sessionStorage)
// - 12h:       bis 12 Stunden ohne Bedienung vergangen sind, auch wenn die App so lange offen oder im Hintergrund war
// - dauerhaft: bis zur Abmeldung
// Wahl und Zeitpunkt der letzten Bedienung liegen im localStorage, damit sie Neustarts und mehrere Tabs überstehen.

export type Anmeldedauer = 'sitzung' | '12h' | 'dauerhaft'

export const ANMELDEDAUER_TEXT: Record<Anmeldedauer, string> = {
  sitzung: 'Nein, nur bis zum Schließen',
  '12h': '12 Stunden ohne Bedienung',
  dauerhaft: 'Dauerhaft, bis zur Abmeldung',
}

export const INAKTIV_MS = 12 * 60 * 60 * 1000

const DAUER = 'tuerpruefung:anmeldedauer'
const AKTIVITAET = 'tuerpruefung:letzte-aktivitaet'
/** Höchstens einmal pro Minute schreiben – Bedienung feuert sehr häufig. */
const SCHREIBEN_ALLE_MS = 60_000
let zuletztGeschrieben = 0

/** Zuletzt gewählte Dauer auf diesem Gerät; ohne Wahl (auch vor diesem Update angemeldet) gelten 12 Stunden. */
export function anmeldedauer(): Anmeldedauer {
  try {
    const d = localStorage.getItem(DAUER)
    if (d === 'sitzung' || d === 'dauerhaft') return d
  } catch { /* Speicher gesperrt */ }
  return '12h'
}

export function anmeldedauerMerken(d: Anmeldedauer) {
  try { localStorage.setItem(DAUER, d) } catch { /* Speicher gesperrt: es gelten 12 Stunden */ }
}

/**
 * Speicher für die Anmeldung (supabase-js): je nach Dauer im sessionStorage oder localStorage.
 * Die Dauer wird vor `signInWithPassword` gemerkt, daher landet die neue Anmeldung gleich im richtigen Speicher.
 */
export const anmeldungSpeicher = {
  getItem(schluessel: string): string | null {
    try { return sessionStorage.getItem(schluessel) ?? localStorage.getItem(schluessel) } catch { return null }
  },
  setItem(schluessel: string, wert: string) {
    try {
      const [ziel, anderer] = anmeldedauer() === 'sitzung' ? [sessionStorage, localStorage] : [localStorage, sessionStorage]
      ziel.setItem(schluessel, wert)
      anderer.removeItem(schluessel)
    } catch { /* Speicher gesperrt: Anmeldung gilt nur bis zum Neuladen */ }
  },
  removeItem(schluessel: string) {
    try {
      sessionStorage.removeItem(schluessel)
      localStorage.removeItem(schluessel)
    } catch { /* egal */ }
  },
}

/** Ohne gespeicherten Zeitpunkt (erster Start nach dem Update) gilt die Anmeldung nicht als abgelaufen. */
export function istAbgelaufen(dauer: Anmeldedauer, letzte: number | null, jetzt: number): boolean {
  return dauer !== 'dauerhaft' && letzte !== null && jetzt - letzte > INAKTIV_MS
}

function letzteAktivitaet(): number | null {
  try {
    const t = Number(localStorage.getItem(AKTIVITAET))
    return t > 0 ? t : null
  } catch { return null }
}

/** Bedienung vormerken; `sofort` umgeht die Drosselung (z. B. direkt nach der Anmeldung). */
export function aktivitaetMerken(sofort = false, jetzt = Date.now()) {
  if (!sofort && jetzt - zuletztGeschrieben < SCHREIBEN_ALLE_MS) return
  zuletztGeschrieben = jetzt
  try { localStorage.setItem(AKTIVITAET, String(jetzt)) } catch { /* Speicher gesperrt: keine automatische Abmeldung */ }
}

export function inaktivAbgelaufen(jetzt = Date.now()): boolean {
  const letzte = letzteAktivitaet()
  if (letzte === null) aktivitaetMerken(true, jetzt)
  return istAbgelaufen(anmeldedauer(), letzte, jetzt)
}

export function aktivitaetVergessen() {
  zuletztGeschrieben = 0
  try { localStorage.removeItem(AKTIVITAET) } catch { /* egal */ }
}
