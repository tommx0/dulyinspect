// UI check against a running container: app starts from konfig.js, login, Realtime WebSocket under CSP 'self',
// service worker, restart while offline. Usage: TUERPRUEFUNG=<checkout> node test/browser.mjs [url] (uses Playwright from there)
// The app's UI is German: labels like "E-Mail" and "Passwort" are the app's own.
import { createRequire } from 'node:module'
const require = createRequire(`${process.env.TUERPRUEFUNG ?? new URL('../../tuerpruefung', import.meta.url).pathname}/package.json`)
const pw = require('@playwright/test')
const URL_ = process.argv[2] ?? 'http://localhost:8090'

for (const name of ['chromium', 'webkit']) {
  let b
  try { b = await pw[name].launch() } catch (e) { console.log(`${name}: not installed (${String(e).split('\n')[0]})`); continue }
  const ctx = await b.newContext()
  const p = await ctx.newPage()
  const errors = []
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  p.on('pageerror', (e) => errors.push(String(e)))
  await p.goto(URL_)
  await p.getByLabel('E-Mail').fill('admin@einzel.test')
  await p.getByLabel('Passwort').fill('einzel-test-12345')
  await p.keyboard.press('Enter')
  // Logged in as soon as the login form is gone
  await p.getByLabel('Passwort').waitFor({ state: 'detached', timeout: 15000 })
  const preview = await p.getByText(/Vorschauversion/).count()
  const ws = await p.evaluate(async () => {
    const k = window.__KONFIG__
    const url = k.supabaseUrl.replace(/^http/, 'ws') + `/realtime/v1/websocket?apikey=${k.supabaseKey}&vsn=1.0.0`
    return new Promise((ok) => {
      let s
      try { s = new WebSocket(url) } catch (e) { return ok('blocked: ' + e) }
      s.onopen = () => { s.close(); ok('open') }
      s.onerror = () => ok('error')
      setTimeout(() => ok('timeout'), 5000)
    })
  })
  const sw = await p.evaluate(async () => (await navigator.serviceWorker.ready).active?.state)
  // Reload so the service worker controls the page and konfig.js is in the runtime cache, then restart offline
  await p.reload(); await p.waitForTimeout(1500)
  await ctx.setOffline(true)
  await p.reload()
  const offline = await p.evaluate(() => Boolean(window.__KONFIG__?.supabaseUrl))
  const startsOffline = await p.locator('#root').innerText().then((t) => t.trim().length > 0)
  await ctx.setOffline(false)
  const csp = errors.filter((f) => /Content Security Policy|Refused/i.test(f))
  console.log(`${name}: login ok | preview notice ${preview ? 'VISIBLE' : 'none'} | WebSocket ${ws} | service worker ${sw} | offline: konfig ${offline ? 'present' : 'MISSING'}, app ${startsOffline ? 'starts' : 'EMPTY'} | CSP violations ${csp.length ? csp.join(' / ') : 'none'}`)
  await b.close()
}
