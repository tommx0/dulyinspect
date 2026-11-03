// Open-Source-Lizenzen der Pakete, die in der App landen – für lizenzen.json, die Seite #/lizenzen und die Stückliste (SBOM).
// Genutzt vom Vite-Plugin in vite.config.ts.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Plugin } from 'vite'

export type Lizenz = { name: string; version: string; lizenz: string; link: string; text: string | null }

type PaketJson = {
  name?: string; version?: string; license?: string | { type?: string }; licenses?: { type?: string }[]; homepage?: string
  author?: string | { name?: string }
  repository?: string | { url?: string }; dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>
}

// Nicht über npm-Abhängigkeiten erfasst: mit pdfmake eingebettete Schrift und die Workbox-Teile im Service Worker
const ROBOTO: Lizenz = {
  name: 'Roboto (Schrift in den PDF-Protokollen)', version: '3.014', lizenz: 'OFL-1.1', link: 'https://github.com/googlefonts/roboto-classic',
  text: 'Copyright 2011 The Roboto Project Authors (https://github.com/googlefonts/roboto-classic)\n\n'
    + 'This Font Software is licensed under the SIL Open Font License, Version 1.1. This license is available with a FAQ at: https://openfontlicense.org',
}
const SERVICE_WORKER = ['workbox-core', 'workbox-precaching', 'workbox-routing', 'workbox-strategies']

// Für MIT-Pakete ohne eigene Lizenzdatei (z. B. fontkit, brotli): Standardtext mit dem Autor aus package.json
const MIT = `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`

const lesen = (ordner: string) => JSON.parse(readFileSync(join(ordner, 'package.json'), 'utf8')) as PaketJson

/** Ordner eines Pakets, wie Node es von `von` aus findet (node_modules der Elternordner, auch im pnpm-Speicher). */
function finden(von: string, name: string): string | null {
  for (let d = realpathSync(von); ; d = dirname(d)) {
    const ordner = join(d, 'node_modules', name)
    if (existsSync(join(ordner, 'package.json'))) return realpathSync(ordner)
    if (dirname(d) === d) return null
  }
}

/** Paketordner zu einer gebündelten Datei: nächste package.json mit Name und Version. */
function paketZuDatei(datei: string): string | null {
  for (let d = dirname(datei); d.includes('node_modules'); d = dirname(d)) {
    if (existsSync(join(d, 'package.json'))) {
      const p = lesen(d)
      if (p.name && p.version) return d
    }
  }
  return null
}

function webadresse(p: PaketJson): string {
  const repo = typeof p.repository === 'string' ? p.repository : p.repository?.url
  for (const roh of [p.homepage, repo]) {
    if (!roh) continue
    const url = /^[\w.-]+\/[\w.-]+$/.test(roh) ? `https://github.com/${roh}` : roh
      .replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/^git@github\.com:/, 'https://github.com/')
      .replace(/^github:/, 'https://github.com/').replace(/\.git(#.*)?$/, '')
    if (/^https?:\/\//.test(url)) return url
  }
  return `https://www.npmjs.com/package/${p.name}`
}

/** Lizenz- und NOTICE-Dateien im Paketordner (Apache-2.0 verlangt auch die NOTICE). */
function lizenztext(ordner: string): string | null {
  const dateien = readdirSync(ordner)
    .filter((f) => /^(licen[cs]e|copying|notice)/i.test(f) && statSync(join(ordner, f)).isFile())
    .sort((a, b) => Number(/^notice/i.test(a)) - Number(/^notice/i.test(b)) || a.localeCompare(b))
  return dateien.map((f) => readFileSync(join(ordner, f), 'utf8').trim()).join('\n\n') || null
}

/** Alle Pakete ab den Startordnern samt ihrer Abhängigkeiten, nach Name sortiert. */
export function lizenzenSammeln(wurzel: string, gebuendelt: string[] = []): Lizenz[] {
  const eigen = lesen(wurzel)
  const offen = Object.keys(eigen.dependencies ?? {}).map((n) => finden(wurzel, n))
  for (const datei of gebuendelt) if (datei.includes('node_modules')) offen.push(paketZuDatei(datei.split('?')[0]))
  // Service Worker: Workbox wird von workbox-build (vite-plugin-pwa) eingebaut
  const pwa = finden(wurzel, 'vite-plugin-pwa')
  const build = pwa && finden(pwa, 'workbox-build')
  if (build) offen.push(...SERVICE_WORKER.map((n) => finden(build, n)))

  const gefunden = new Map<string, Lizenz>()
  while (offen.length) {
    const ordner = offen.pop()
    if (!ordner) continue
    const p = lesen(ordner)
    const schluessel = `${p.name}@${p.version}`
    if (!p.name || gefunden.has(schluessel)) continue
    let text = lizenztext(ordner)
    const lizenz = (typeof p.license === 'string' ? p.license : p.license?.type) || p.licenses?.[0]?.type
      || (text?.startsWith('MIT License') ? 'MIT' : 'unbekannt')
    const autor = typeof p.author === 'string' ? p.author.replace(/\s*[<(].*$/, '') : p.author?.name
    if (!text && lizenz === 'MIT') text = `${autor ? `Copyright (c) ${autor}\n\n` : ''}${MIT}`
    // Reine Typdefinitionen landen nicht in der App
    if (!p.name.startsWith('@types/')) gefunden.set(schluessel, { name: p.name, version: p.version ?? '', lizenz, link: webadresse(p), text })
    for (const n of Object.keys({ ...p.dependencies, ...p.optionalDependencies })) offen.push(finden(ordner, n))
  }
  return [...gefunden.values(), ROBOTO].sort((a, b) => a.name.localeCompare(b.name))
}

/** npm-Pakete der Edge Functions (`npm:name@version` in supabase/functions/*), Version wie angegeben. */
export function funktionsPakete(wurzel: string): { name: string; version: string; funktionen: string[] }[] {
  const ordner = join(wurzel, 'supabase', 'functions')
  const pakete = new Map<string, { name: string; version: string; funktionen: string[] }>()
  for (const funktion of readdirSync(ordner).filter((f) => statSync(join(ordner, f)).isDirectory()).sort()) {
    for (const datei of readdirSync(join(ordner, funktion)).filter((f) => /\.ts$/.test(f))) {
      for (const [, name, version] of readFileSync(join(ordner, funktion, datei), 'utf8').matchAll(/["']npm:((?:@[\w.-]+\/)?[\w.-]+)@([^/"']+)/g)) {
        const p = pakete.get(`${name}@${version}`) ?? { name, version, funktionen: [] }
        if (!p.funktionen.includes(funktion)) p.funktionen.push(funktion)
        pakete.set(`${name}@${version}`, p)
      }
    }
  }
  return [...pakete.values()].sort((a, b) => a.name.localeCompare(b.name))
}

const purl = (name: string, version: string) => `pkg:npm/${name.replace(/^@/, '%40')}@${version}`

/**
 * Stückliste (SBOM) im Format CycloneDX 1.6 für den Cyber Resilience Act (Anhang I Teil II Nr. 1):
 * alle Pakete im Bundle und Service Worker, die Schrift der PDF-Protokolle und die npm-Pakete der Edge Functions.
 * Die Plattform selbst (Supabase, Deno, Hosting) ist Dienst, nicht Bestandteil, und steht nicht drin.
 */
export function sbomErzeugen(wurzel: string, app: { name: string; version: string }, lizenzen: Lizenz[]) {
  const eigen = lesen(wurzel)
  const wurzelRef = `${eigen.name}@${app.version}`
  const lizenzAngabe = (l: string) => (l === 'unbekannt' ? undefined : [{ expression: l.replace(/^\((.*)\)$/, '$1') }])
  const bestandteile = [
    ...lizenzen.map((l) => l === ROBOTO
      ? { type: 'file', 'bom-ref': `roboto@${l.version}`, name: 'Roboto', version: l.version, licenses: lizenzAngabe(l.lizenz),
        externalReferences: [{ type: 'website', url: l.link }] }
      : { type: 'library', 'bom-ref': purl(l.name, l.version), name: l.name, version: l.version, purl: purl(l.name, l.version),
        licenses: lizenzAngabe(l.lizenz), externalReferences: [{ type: 'website', url: l.link }] }),
    ...funktionsPakete(wurzel).map((p) => ({
      type: 'library', 'bom-ref': `edge:${purl(p.name, p.version)}`, name: p.name, version: p.version, purl: purl(p.name, p.version),
      properties: [{ name: 'tuerpruefung:edge-function', value: p.funktionen.join(', ') }],
    })),
  ]
  const direkt = Object.keys(eigen.dependencies ?? {})
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: { components: [{ type: 'application', name: 'scripts/lizenzen.ts' }] },
      manufacturer: { name: 'Thomas Marx Mx-Smart-Tech', address: { streetAddress: 'Egmontstrasse 37', postalCode: '42719', locality: 'Solingen', country: 'DE' },
        contact: [{ email: 'info@mx-smart-tech.de' }] },
      component: { type: 'application', 'bom-ref': wurzelRef, name: app.name, version: app.version },
    },
    components: bestandteile,
    dependencies: [{
      ref: wurzelRef,
      // Direkte Abhängigkeiten der App (package.json), Schrift und Edge-Function-Pakete; der Rest kommt über diese mit
      dependsOn: bestandteile.filter((b) => b.type === 'file' || b['bom-ref'].startsWith('edge:') || direkt.includes(b.name)).map((b) => b['bom-ref']),
    }],
  }
}

/**
 * Öffentliche Fassung für lizenzen.json: ohne Versionsnummern (sonst ließe sich gezielt nach bekannten Lücken einzelner
 * Versionen suchen); gleiche Pakete in mehreren Versionen nur einmal, solange Lizenz und Text gleich sind.
 */
export function ohneVersionen(lizenzen: Lizenz[]): Omit<Lizenz, 'version'>[] {
  const gesehen = new Set<string>()
  return lizenzen.flatMap(({ name, lizenz, link, text }) => {
    const schluessel = JSON.stringify([name, lizenz, text])
    if (gesehen.has(schluessel)) return []
    gesehen.add(schluessel)
    return [{ name, lizenz, link, text }]
  })
}

/** Ablage der SBOM: nur lokal (nicht in dist, nicht in Git), für Behörden auf Anfrage. Je Version eine Datei. */
export const SBOM_ORDNER = 'sbom'

/**
 * lizenzen.json im Build (aus allem, was im Bundle steckt) und im Entwicklungsserver (aus package.json).
 * Die SBOM schreibt der Build nach sbom/<name>-<version>.cdx.json statt in dist – sie wird nicht öffentlich ausgeliefert.
 */
export function lizenzDatei(app: { name: string; version: string }): Plugin {
  return {
    name: 'lizenzen-json',
    configureServer(server) {
      server.middlewares.use('/lizenzen.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(ohneVersionen(lizenzenSammeln(server.config.root))))
      })
    },
    generateBundle(_optionen, bundle) {
      const dateien = Object.values(bundle).flatMap((b) => b.type === 'chunk' ? b.moduleIds : [])
      const lizenzen = lizenzenSammeln(process.cwd(), dateien)
      this.emitFile({ type: 'asset', fileName: 'lizenzen.json', source: JSON.stringify(ohneVersionen(lizenzen)) })
      const ordner = join(process.cwd(), SBOM_ORDNER)
      mkdirSync(ordner, { recursive: true })
      const ziel = join(ordner, `${lesen(process.cwd()).name}-${app.version}.cdx.json`)
      writeFileSync(ziel, JSON.stringify(sbomErzeugen(process.cwd(), app, lizenzen), null, 2))
      this.info(`SBOM (nur lokal): ${ziel}`)
    },
  }
}
