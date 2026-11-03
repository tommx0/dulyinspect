// Render the guides to PDF (Chromium via Playwright from a tuerpruefung checkout):
//   TUERPRUEFUNG=<checkout> node docs/guide/render-pdf.mjs   (default: sibling folder tuerpruefung)
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(process.env.TUERPRUEFUNG ?? join(here, '../../../tuerpruefung'), 'package.json'))
const { chromium } = require('@playwright/test')

const GUIDES = [
  { html: 'docker-synology.en.html', pdf: 'Docker-Synology-Guide.pdf', title: 'DulyInspect single instance – Docker and Synology' },
  { html: 'docker-synology.de.html', pdf: 'Anleitung-Docker-Synology.pdf', title: 'DulyInspect als Einzelinstanz – Docker und Synology' },
]
const browser = await chromium.launch()
for (const g of GUIDES) {
  const page = await browser.newPage()
  await page.goto(pathToFileURL(join(here, g.html)).href)
  const target = join(here, '..', g.pdf)
  await page.pdf({
    path: target, format: 'A4', printBackground: true, displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: '<div style="width:100%;font-family:-apple-system,Helvetica Neue,Arial,sans-serif;font-size:7.5pt;color:#5b6573;padding:0 18mm;display:flex;justify-content:space-between">'
      + `<span>${g.title}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    margin: { top: '20mm', bottom: '20mm', left: '18mm', right: '18mm' },
  })
  console.log(`${target} written`)
}
await browser.close()
