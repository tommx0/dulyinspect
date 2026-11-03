// Signierte Migrationen für den Update-Assistenten in der App (Edge Function „datenbank-aktualisieren“).
// Jede Migration wird mit einem privaten Ed25519-Schlüssel signiert, der nur beim Entwickler liegt; die Signaturen stehen in
// supabase/signaturen.json (im Repository), der öffentliche Schlüssel in der Edge Function. Die Function führt nur
// Migrationen aus, deren Signatur passt – auch ein gekaperter Admin-Zugang kann so kein eigenes SQL einschleusen.
//
// Signiert wird „<version>\n<name>\n<Inhalt der Datei>“ (UTF-8) – identisch in supabase/functions/datenbank-aktualisieren/index.ts.

import { createPublicKey, verify } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const MIGRATIONEN = join(REPO, 'supabase', 'migrations')
export const SIGNATUREN = join(REPO, 'supabase', 'signaturen.json')
export const SCHLUESSEL_DATEI = join(REPO, 'supabase', 'functions', 'datenbank-aktualisieren', 'schluessel.ts')

/** Alle Migrationen aufsteigend: { datei, version, name, sql } */
export function migrationenLesen() {
  return readdirSync(MIGRATIONEN).filter((d) => /^\d+_.+\.sql$/.test(d)).sort().map((datei) => {
    const [version, ...rest] = datei.replace(/\.sql$/, '').split('_')
    return { datei, version, name: rest.join('_'), sql: readFileSync(join(MIGRATIONEN, datei), 'utf8') }
  })
}

export const nachricht = (m) => Buffer.from(`${m.version}\n${m.name}\n${m.sql}`, 'utf8')

/** Öffentlicher Schlüssel (Ed25519, JWK-„x“) aus der Edge Function; null, solange keiner erzeugt ist. */
export function oeffentlicherSchluessel() {
  if (!existsSync(SCHLUESSEL_DATEI)) return null
  const x = readFileSync(SCHLUESSEL_DATEI, 'utf8').match(/OEFFENTLICHER_SCHLUESSEL\s*=\s*['"]([A-Za-z0-9_-]{43})['"]/)?.[1]
  return x ? createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' }) : null
}

export function signaturenLesen() {
  return existsSync(SIGNATUREN) ? JSON.parse(readFileSync(SIGNATUREN, 'utf8')) : {}
}

/** Prüft alle Migrationen gegen supabase/signaturen.json: { fehlend: [datei], ungueltig: [datei] } */
export function signaturenPruefen() {
  const schluessel = oeffentlicherSchluessel()
  const signaturen = signaturenLesen()
  const fehlend = [], ungueltig = []
  for (const m of migrationenLesen()) {
    const s = signaturen[m.version]
    if (!s) fehlend.push(m.datei)
    else if (!schluessel || !verify(null, nachricht(m), schluessel, Buffer.from(s, 'base64'))) ungueltig.push(m.datei)
  }
  return { fehlend, ungueltig }
}

/** Für den Build: Migrationen mit Signatur; wirft, wenn eine fehlt oder nicht passt. */
export function signierteMigrationen() {
  const { fehlend, ungueltig } = signaturenPruefen()
  if (fehlend.length || ungueltig.length) {
    throw new Error(`Migrationen ohne gültige Signatur: ${[...fehlend, ...ungueltig].join(', ')} – bitte „pnpm migrationen:signieren“ ausführen.`)
  }
  const signaturen = signaturenLesen()
  return migrationenLesen().map((m) => ({ version: m.version, name: m.name, sql: m.sql, signatur: signaturen[m.version] }))
}
