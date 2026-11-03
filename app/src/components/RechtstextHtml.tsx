import { createElement, Fragment, type ReactNode } from 'react'

// Impressum/Datenschutz im Format „HTML“ (z. B. aus einem Generator für Rechtstexte).
// Kein innerHTML: Der Text wird als inertes Dokument gelesen und nur mit erlaubten Elementen nachgebaut.
// Attribute fallen weg (style, class, id, on…), außer Linkziel und Tabellenspannen.

// Mit Inhalt entfernen
const ENTFERNEN = new Set(['script', 'style', 'template', 'noscript', 'iframe', 'frame', 'object', 'embed', 'svg', 'math',
  'head', 'title', 'meta', 'link', 'base', 'input', 'button', 'select', 'option', 'textarea',
  'img', 'picture', 'video', 'audio', 'canvas', 'source', 'track'])

// Erlaubte Elemente mit Darstellung; alle anderen (font, center, label …) werden durch ihren Inhalt ersetzt.
// Überschriften eine Ebene tiefer – h1 ist der Seitentitel.
const ELEMENTE: Record<string, [string, string?]> = {
  h1: ['h2', 'mt-6 mb-2 text-lg font-semibold'], h2: ['h3', 'mt-5 mb-2 font-semibold'], h3: ['h4', 'mt-4 mb-1 font-semibold'],
  h4: ['h5', 'mt-3 mb-1 font-semibold'], h5: ['h6', 'mt-3 mb-1 font-semibold'], h6: ['h6', 'mt-3 mb-1 font-semibold'],
  p: ['p', 'my-3'], br: ['br'], hr: ['hr', 'my-4 border-slate-200'],
  ul: ['ul', 'my-3 list-disc space-y-1 pl-6'], ol: ['ol', 'my-3 list-decimal space-y-1 pl-6'], li: ['li'],
  dl: ['dl', 'my-3'], dt: ['dt', 'font-semibold'], dd: ['dd', 'mb-2 pl-6'],
  strong: ['strong', 'font-semibold'], b: ['b', 'font-semibold'], em: ['em'], i: ['i'], u: ['u'], s: ['s'],
  small: ['small'], sub: ['sub'], sup: ['sup'], mark: ['mark'], abbr: ['abbr'], code: ['code', 'font-mono text-sm'],
  pre: ['pre', 'my-3 font-mono text-sm whitespace-pre-wrap'], blockquote: ['blockquote', 'my-3 border-l-2 border-slate-200 pl-3 text-slate-600'],
  address: ['address', 'my-3 not-italic'], div: ['div'], span: ['span'],
  section: ['section'], article: ['article'], header: ['div'], footer: ['div'], main: ['div'], nav: ['div'],
  table: ['table', 'my-3 w-full border-collapse text-sm'], caption: ['caption', 'mb-1 text-left font-semibold'],
  thead: ['thead'], tbody: ['tbody'], tfoot: ['tfoot'], tr: ['tr'],
  th: ['th', 'border border-slate-200 bg-slate-50 px-2 py-1 text-left align-top font-semibold'],
  td: ['td', 'border border-slate-200 px-2 py-1 text-left align-top'],
  a: ['a', 'link break-all'],
}

// Hier darf kein Text stehen (React warnt sonst bei Leerzeichen zwischen den Zeilen)
const OHNE_TEXT = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'ul', 'ol', 'dl'])

/** Nur Web-, E-Mail- und Telefonlinks – keine javascript:-, relativen oder #-Adressen (die würden die App-Navigation stören). */
function linkAdresse(href: string | null): string | null {
  const h = href?.trim() ?? ''
  return /^(https?:\/\/|mailto:|tel:)/i.test(h) ? h : null
}

function spanne(wert: string | null): number | undefined {
  const n = Number(wert)
  return Number.isInteger(n) && n > 1 && n <= 100 ? n : undefined
}

function knoten(n: Node, schluessel: number, eltern: string): ReactNode {
  if (n.nodeType === Node.TEXT_NODE) {
    const text = n.textContent ?? ''
    return OHNE_TEXT.has(eltern) && !text.trim() ? null : text
  }
  if (n.nodeType !== Node.ELEMENT_NODE) return null // Kommentare u. a.
  const el = n as Element
  const tag = el.localName
  if (ENTFERNEN.has(tag)) return null
  const def = ELEMENTE[tag]
  const href = tag === 'a' ? linkAdresse(el.getAttribute('href')) : null
  // Unbekanntes Element oder Link ohne zulässiges Ziel: nur den Inhalt übernehmen
  if (!def || (tag === 'a' && !href)) {
    return <Fragment key={schluessel}>{Array.from(el.childNodes, (k, i) => knoten(k, i, eltern))}</Fragment>
  }
  const [ziel, className] = def
  if (ziel === 'br' || ziel === 'hr') return createElement(ziel, { key: schluessel, className })
  const props: Record<string, unknown> = { key: schluessel, className }
  if (href) {
    props.href = href
    if (/^https?:/i.test(href)) Object.assign(props, { target: '_blank', rel: 'noopener noreferrer' })
  }
  if (tag === 'th' || tag === 'td') Object.assign(props, { colSpan: spanne(el.getAttribute('colspan')), rowSpan: spanne(el.getAttribute('rowspan')) })
  if (tag === 'abbr') props.title = el.getAttribute('title') ?? undefined
  return createElement(ziel, props, ...Array.from(el.childNodes, (k, i) => knoten(k, i, ziel)))
}

/** Impressum/Datenschutz als bereinigtes HTML. */
export function RechtstextHtml({ html }: { html: string }) {
  const body = new DOMParser().parseFromString(html, 'text/html').body
  return (
    <div className="leading-relaxed [&_:first-child]:mt-0 [&>:last-child]:mb-0">
      {Array.from(body.childNodes, (k, i) => knoten(k, i, 'div'))}
    </div>
  )
}
