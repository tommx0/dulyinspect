import type { KeyObject } from 'node:crypto'

export interface Migration { datei: string; version: string; name: string; sql: string }
export interface SignierteMigration { version: string; name: string; sql: string; signatur: string }

export const REPO: string
export const MIGRATIONEN: string
export const SIGNATUREN: string
export const SCHLUESSEL_DATEI: string
export function migrationenLesen(): Migration[]
export function nachricht(m: Pick<Migration, 'version' | 'name' | 'sql'>): Buffer
export function oeffentlicherSchluessel(): KeyObject | null
export function signaturenLesen(): Record<string, string>
export function signaturenPruefen(): { fehlend: string[]; ungueltig: string[] }
export function signierteMigrationen(): SignierteMigration[]
