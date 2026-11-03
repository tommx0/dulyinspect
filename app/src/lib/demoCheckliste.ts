// Demomodus: Checklisten anlegen, bearbeiten, freigeben und duplizieren nur als Simulation. Der Stand liegt im Arbeitsspeicher
// des Browsers (nicht im Gerätespeicher) und ist nach dem Neuladen der Seite oder dem Abmelden weg – gespeichert wird nichts.
import { useSyncExternalStore } from 'react'
import type { Zeile } from './supabase'
import { t } from './sprache'

type Kopf = Zeile<'checkliste'>
type Version = Zeile<'checkliste_version'>

export const SIMULATION_TEXT = t('Demomodus: Ihre Änderungen wurden nur simuliert und nicht gespeichert. Sie bleiben sichtbar, bis Sie die Seite neu laden oder sich abmelden.')

/** Überlagert eine vorhandene Checkliste (Kopf und/oder Versionen) oder ist eine im Demo neu angelegte (`neu`). */
export interface Simulation {
  kopf?: Kopf
  versionen?: Version[]
  neu?: boolean
}

let simulationen = new Map<string, Simulation>()
const hoerer = new Set<() => void>()
let warnungAktiv = false

// Beim Verlassen oder Neuladen der Seite ist die Simulation verloren: wie bei ungespeicherten Änderungen nachfragen
const warnen = (e: BeforeUnloadEvent) => e.preventDefault()

function setzen(id: string, aenderung: Simulation) {
  simulationen = new Map(simulationen).set(id, { ...simulationen.get(id), ...aenderung })
  if (!warnungAktiv && typeof window !== 'undefined') {
    window.addEventListener('beforeunload', warnen)
    warnungAktiv = true
  }
  hoerer.forEach((h) => h())
}

const abonnieren = (h: () => void) => { hoerer.add(h); return () => { hoerer.delete(h) } }

/** Alle Simulationen (neu gerendert bei jeder Änderung). */
export function useSimulationen(): ReadonlyMap<string, Simulation> {
  return useSyncExternalStore(abonnieren, () => simulationen)
}

export function simulation(id: string): Simulation | undefined {
  return simulationen.get(id)
}

export function simKopfSetzen(id: string, kopf: Kopf) {
  setzen(id, { kopf })
}

export function simVersionenSetzen(id: string, versionen: Version[]) {
  setzen(id, { versionen })
}

/** Beim Abmelden: nichts für den nächsten Benutzer im Tab liegen lassen. */
export function simulationenVergessen() {
  simulationen = new Map()
  if (warnungAktiv) window.removeEventListener('beforeunload', warnen)
  warnungAktiv = false
  hoerer.forEach((h) => h())
}

const jetzt = () => new Date().toISOString()

/** Neue Checkliste als Entwurf v1 (auch für Kopien); gibt die ID zurück. */
export function simNeu(name: string, beschreibung: string | null, punkte: Version['punkte'] = [], abschnitte: Version['abschnitte'] = []): string {
  const id = crypto.randomUUID()
  const zeit = jetzt()
  setzen(id, {
    neu: true,
    kopf: { id, name: name.trim(), beschreibung, aktiv: true, erstellt_am: zeit, erstellt_von: null, geaendert_am: zeit },
    versionen: [{
      id: crypto.randomUUID(), checkliste_id: id, version: 1, status: 'entwurf', punkte, abschnitte,
      erstellt_am: zeit, erstellt_von: null, geaendert_am: zeit, freigegeben_am: null, freigegeben_von: null,
    }],
  })
  return id
}

// Versionen ändern wie die Datenbank (checkliste_version_freigeben, checkliste_neuer_entwurf), nur ohne sie

export function versionSpeichern(liste: Version[], versionId: string, punkte: Version['punkte'], abschnitte: Version['abschnitte']): Version[] {
  return liste.map((v) => (v.id === versionId ? { ...v, punkte, abschnitte, geaendert_am: jetzt() } : v))
}

/** Freigeben: die bisher freigegebene Version wird archiviert. */
export function versionFreigeben(liste: Version[], versionId: string): Version[] {
  const zeit = jetzt()
  return liste.map((v) => v.id === versionId ? { ...v, status: 'freigegeben', freigegeben_am: zeit, geaendert_am: zeit }
    : v.status === 'freigegeben' ? { ...v, status: 'archiviert' } : v)
}

/** Neuer Entwurf aus der freigegebenen (sonst der neuesten) Version; die neue Version steht vorn. */
export function neuerEntwurf(liste: Version[]): { liste: Version[]; id: string } {
  const sortiert = [...liste].sort((a, b) => b.version - a.version)
  const basis = sortiert.find((v) => v.status === 'freigegeben') ?? sortiert[0]
  const zeit = jetzt()
  const id = crypto.randomUUID()
  const entwurf: Version = {
    ...basis, id, version: (sortiert[0]?.version ?? 0) + 1, status: 'entwurf',
    erstellt_am: zeit, erstellt_von: null, geaendert_am: zeit, freigegeben_am: null, freigegeben_von: null,
  }
  return { liste: [entwurf, ...sortiert], id }
}

export function entwurfVerwerfen(liste: Version[], versionId: string): Version[] {
  return liste.filter((v) => v.id !== versionId)
}
