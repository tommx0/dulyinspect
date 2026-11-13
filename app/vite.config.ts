/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { lizenzDatei } from './scripts/lizenzen.ts'
import { signierteMigrationen } from './scripts/migrationen.mjs'

// Build-Kennung: Version (package.json), Commit, Schemastand (neueste Migration) – für Anzeige, version.json und Startprüfung
const VERSION = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version
const COMMIT = (() => { try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return '' } })()
const SCHEMA = readdirSync('supabase/migrations').filter((d) => d.endsWith('.sql')).map((d) => d.split('_')[0]).sort().at(-1) ?? ''

/** version.json im Build: damit Skripte prüfen können, was bei einem Kunden läuft. */
function versionDatei(): Plugin {
  return {
    name: 'version-json',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: VERSION, commit: COMMIT, schema: SCHEMA, gebaut: new Date().toISOString() }, null, 2) })
    },
  }
}

/**
 * migrationen.json: alle Migrationen mit Signatur für den Update-Assistenten (Bildschirm „Update wird eingespielt“).
 * Nicht im Offline-Cache, lädt nur bei Bedarf. Fehlt eine Signatur, bricht der Build ab („pnpm migrationen:signieren“).
 */
function migrationenDatei(): Plugin {
  const inhalt = () => JSON.stringify({ schema: SCHEMA, migrationen: signierteMigrationen() })
  return {
    name: 'migrationen-json',
    configureServer(server) {
      // Neue Migration → Neustart, damit der Schemastand der App (SCHEMA, Startprüfung) stimmt
      server.watcher.add('supabase/migrations')
      server.watcher.on('add', (pfad) => { if (/supabase[\\/]migrations[\\/]\d+_.+\.sql$/.test(pfad)) void server.restart() })
      server.middlewares.use('/migrationen.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(inhalt())
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'migrationen.json', source: inhalt() })
    },
  }
}

/**
 * Content-Security-Policy: Skripte, Styles und Worker nur von der eigenen Adresse, Daten nur von der eigenen Adresse und Supabase.
 * Als <meta> in index.html (gilt bei jedem Hosting, auch im Share-Link) und als HTTP-Header in _headers, den deploybase
 * am Edge ausliefert (Netlify-Format) – dort mit weiteren Sicherheits-Header.
 * Kein frame-ancestors/X-Frame-Options: deploybase zeigt Share-Links in einem Sandbox-iframe an.
 * Nur im Build – der Entwicklungsserver braucht Inline-Skripte für Hot Reload.
 */
function sicherheitsRichtlinie(supabaseUrl: string | undefined): Plugin {
  const api = supabaseUrl ? new URL(supabaseUrl) : null
  const quellen = api ? ` ${api.origin} ${api.protocol === 'https:' ? 'wss:' : 'ws:'}//${api.host}` : ''
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    `img-src 'self' data: blob:${api ? ` ${api.origin}` : ''}`,
    `connect-src 'self'${quellen}`,
    "font-src 'self' data:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
  // CSP-Header nur für die App-Seite: die Bedienungsanleitung unter anleitung/ hat eigene Inline-Styles
  const headers = `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Strict-Transport-Security: max-age=31536000
  Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=()
/
  Content-Security-Policy: ${csp}
/index.html
  Content-Security-Policy: ${csp}
/.well-known/security.txt
  Content-Type: text/plain; charset=utf-8
/sicherheit.txt
  Content-Type: text/plain; charset=utf-8
`
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: (html: string) =>
      html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`),
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: headers })
    },
  }
}

/** Meldeadresse für Sicherheitslücken (Hersteller, CRA Anhang I Teil II Nr. 6), auch in SECURITY.md. */
const SICHERHEIT_KONTAKT = 'mailto:info@mx-smart-tech.de'
// Freie Fassung: eigener Meldeweg (VITE_SICHERHEIT_KONTAKT, z. B. Security Advisories des Repositorys); dann ohne sicherheit.txt,
// denn die ist SECURITY.md des Herstellers.

/**
 * Meldeweg für Sicherheitslücken nach RFC 9116: .well-known/security.txt und die Richtlinie SECURITY.md als sicherheit.txt.
 * Expires läuft ab dem Build, deshalb bei jedem Ausrollen neu. Canonical und Policy brauchen eine absolute Adresse
 * und stehen nur drin, wenn VITE_APP_ADRESSE gesetzt ist.
 */
function sicherheitsKontakt(appAdresse: string | undefined, kontakt: string | undefined): Plugin {
  return {
    name: 'security-txt',
    apply: 'build',
    generateBundle() {
      const ablauf = new Date(Date.now() + 300 * 24 * 3600 * 1000)
      const basis = appAdresse ? appAdresse.replace(/\/?$/, '/') : null
      const zeilen = [
        `Contact: ${kontakt || SICHERHEIT_KONTAKT}`,
        `Expires: ${ablauf.toISOString().replace(/\.\d+Z$/, 'Z')}`,
        'Preferred-Languages: de, en',
        ...(basis ? [`Canonical: ${basis}.well-known/security.txt`] : []),
        ...(basis && !kontakt ? [`Policy: ${basis}sicherheit.txt`] : []),
      ]
      this.emitFile({ type: 'asset', fileName: '.well-known/security.txt', source: `${zeilen.join('\n')}\n` })
      if (!kontakt) this.emitFile({ type: 'asset', fileName: 'sicherheit.txt', source: readFileSync('SECURITY.md', 'utf8') })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  // App-Name je Kunde als Build-Variable (deploybase); Standard „DulyInspect“
  const APP_NAME = env.VITE_APP_NAME || 'DulyInspect'
  return {
  define: {
    __APP_VERSION__: JSON.stringify(VERSION),
    __APP_COMMIT__: JSON.stringify(COMMIT),
    __SCHEMA_STAND__: JSON.stringify(SCHEMA),
    __APP_NAME__: JSON.stringify(APP_NAME),
  },
  plugins: [
    react(),
    tailwindcss(),
    versionDatei(),
    migrationenDatei(),
    // lizenzen.json: Open-Source-Pakete mit Lizenz und Lizenztext (ohne Versionen) für die Seite #/lizenzen; SBOM nur lokal nach sbom/
    lizenzDatei({ name: APP_NAME, version: VERSION }),
    sicherheitsKontakt(env.VITE_APP_ADRESSE, env.VITE_SICHERHEIT_KONTAKT),
    // App-Name auch in index.html (Titel, Name beim Installieren auf dem iPhone)
    { name: 'app-name', transformIndexHtml: (html: string) => html.replaceAll('%APP_NAME%', APP_NAME) },
    sicherheitsRichtlinie(env.VITE_SUPABASE_URL),
    // Installierbare App mit Offline-Cache aller App-Dateien (Spezifikation Abschnitt 7)
    VitePWA({
      registerType: 'prompt', // Update erst nach Bestätigung – nie mitten in einer Prüfung neu laden
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'logo.svg', 'logo.png'],
      manifest: {
        name: APP_NAME,
        // Nicht selbst kürzen: das Handy kürzt bei Bedarf mit „…“ statt mitten im Wort
        short_name: APP_NAME,
        description: 'Prüfung sicherheitstechnischer Anlagen: Checklisten, Mängel, Prüfprotokolle',
        lang: 'de',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,woff2}'],
        // Bedienungsanleitung (viele Bilder + PDF) nur online laden, nicht bei jeder Installation mitschicken
        // konfig.js nicht fest im Offline-Cache: das Einzelinstanz-Image schreibt sie beim Start, ihr Inhalt
        // ändert sich also ohne neuen Build. Stattdessen „Netz zuerst“, offline die zuletzt geladene Fassung.
        globIgnores: ['anleitung/**', 'konfig.js'],
        runtimeCaching: [{
          urlPattern: ({ url }) => url.pathname.endsWith('/konfig.js'),
          handler: 'NetworkFirst',
          options: { cacheName: 'konfig', networkTimeoutSeconds: 3 },
        }],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: 'index.html',
        // Supabase-Anfragen nie aus dem Cache bedienen (Daten laufen über die eigene Outbox)
        // security.txt, Richtlinie und JSON-Dateien direkt aufgerufen: die Datei zeigen, nicht die App
        navigateFallbackDenylist: [/^\/rest\//, /^\/auth\//, /^\/storage\//, /\/anleitung\//, /\/\.well-known\//, /\.(txt|json)$/],
      },
    }),
  ],
  // Relative Pfade: Die App läuft auch unter einem Unterpfad (deploybase Share-Link /draft/{token}/)
  base: './',
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'supabase/functions/_shared/**/*.test.ts'],
  },
}
})
