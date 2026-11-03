// Gesamtliste (System → Gesamtliste): Kunden, Objekte, Anlagen und ihre Elemente (Melder, Leuchten …) gestaffelt in
// einer Tabelle für Anzeige und Export. Jede gewählte Ebene bekommt eigene Zeilen, immer in der Reihenfolge
// Kunde → Objekt → Anlage → Element; die Spalten Kunde, Objekt, Anlage nennen in jeder Zeile, wozu sie gehört.
import { ART_SCHLUESSEL, artDefinition, eigenschaftenListe, feldText, type ArtSchluessel, type Eigenschaften } from './anlagenarten'
import { nurTueren, tb } from './begriffe'
import { elementNaechste, istBestandArt } from './bestand'
import { elementEinzahl, elementName, elementVergleich } from './elemente'
import { qrInhalt } from './etikett'
import { melderQrInhalt } from './melderCode'
import { anlageVergleich, nameVergleich } from './sortierung'
import { t } from './sprache'
import type { Wert } from './xlsx'

export type Ebene = 'kunde' | 'objekt' | 'anlage' | 'element'
export const EBENEN: readonly Ebene[] = ['kunde', 'objekt', 'anlage', 'element']

export type Kunde = {
  id: string; name: string; strasse: string | null; plz: string | null; ort: string | null
  ansprechpartner: string | null; email: string | null; telefon: string | null; notiz: string | null; aktiv: boolean
}
export type Objekt = {
  id: string; endkunde_id: string; name: string; strasse: string | null; plz: string | null; ort: string | null
  zugangshinweise: string | null; aktiv: boolean
}
export type Pruefart = { id: string; name: string; intervall_monate: number; reihenfolge: number; aktiv: boolean; elemente: string }
export type Anlage = {
  id: string; objekt_id: string; etikett_id: string | null; kunden_bezeichnung: string | null; gebaeude: string | null
  etage: string | null; raum: string | null; lage_beschreibung: string | null; hersteller: string | null; modell: string | null
  baujahr: number | null; eigenschaften: unknown; letzte_pruefung_am: string | null; letztes_ergebnis: Ergebnis | null
  naechste_pruefung_am: string | null; status: 'aktiv' | 'stillgelegt'; erstellt_am: string
  anlagentyp: { name: string; kategorie: string | null; anlagenart: string; pruefart: Pruefart[] } | null
  anlage_faelligkeit: { pruefart_id: string; intervall_monate: number | null; letzte_pruefung_am: string | null }[]
}
export type Element = {
  id: string; anlage_id: string; gruppe: string | null; nummer: string; elementart: string | null; ort: string | null
  typ: string | null; code: string | null; eigenschaften: unknown; aktiv: boolean; zuletzt_geprueft_am: string | null
  geprueft_je_pruefart: unknown
}
type Ergebnis = 'gruen' | 'gelb' | 'rot'

export interface Daten {
  kunden: Kunde[]
  objekte: Objekt[]
  anlagen: Anlage[]
  elemente: Element[]
  /** offene (und behobene, noch nicht nachgeprüfte) Mängel je Anlage */
  offeneMaengel?: ReadonlyMap<string, number>
}

export interface Filter {
  ebenen: readonly Ebene[]
  /** IDs; leer = alle */
  kunden: readonly string[]
  objekte: readonly string[]
  /** Anlagenarten; leer = alle */
  arten: readonly string[]
  /** auch inaktive Kunden und Objekte, stillgelegte Anlagen und Elemente */
  inaktive: boolean
}

/** Für die QR-Codes: App-Adresse und Mandantencode der Instanz (wie auf den Etiketten). */
export interface Umgebung { adresse: string; mandantencode: string | null }

export interface Zeile {
  ebene: Ebene
  id: string
  /** „Kunde“, „Objekt“, „Tür“, „Anlage“, „Melder“, „Leuchte“ … */
  ebeneText: string
  kunde: string
  objekt: string
  anlage: string
  element: string
  /** Anlagenart (Symbol), bei Kunden und Objekten null */
  art: string | null
  objektId: string | null
  anlageId: string | null
  /** Etikett der Anlage bzw. Code des Elements */
  code: string
  /** Inhalt des QR-Codes (Adresse, die die App öffnet) */
  qr: string
  letzte: string | null
  ergebnis: Ergebnis | null
  naechste: string | null
  /** aktiv und noch nie geprüft: sofort fällig */
  nieGeprueft: boolean
  aktiv: boolean
  status: string
  /** Spalten der Ebene (Schlüssel wie in `spalten`) */
  details: Record<string, Wert>
}

export interface Spalte { schluessel: string; titel: string }

export const ERGEBNIS: Record<Ergebnis, string> = { gruen: t('ohne Mängel'), gelb: t('mit Mängeln'), rot: t('nicht betriebssicher') }
const KATEGORIE: Record<string, string> = { fluchttuer: t('Fluchttür'), automatiktuer: t('Automatiktür'), sonstige: t('sonstige') }

/** Wie die eingeschalteten Arten ihre Elemente nennen: „Melder“, „Leuchten / Melder“; bei mehr als drei „Elemente“. */
export function elementBegriff(arten: readonly string[]): { einzahl: string; mehrzahl: string } | null {
  const defs = [...new Map(arten.map((a) => artDefinition(a).elemente).filter((d) => !!d).map((d) => [d.mehrzahl, d])).values()]
  if (!defs.length) return null
  if (defs.length > 3) return { einzahl: t('Element'), mehrzahl: t('Elemente') }
  return { einzahl: [...new Set(defs.map((d) => d.einzahl))].join(' / '), mehrzahl: defs.map((d) => d.mehrzahl).join(' / ') }
}

/** Datum für die Tabelle: „31.10.2026“ (ohne Umweg über die Zeitzone), leer ohne Datum. */
export function tag(d: string | null | undefined): string {
  const m = d?.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}

function aktivePruefarten(a: Anlage): Pruefart[] {
  return (a.anlagentyp?.pruefart ?? []).filter((p) => p.aktiv).sort((x, y) => x.reihenfolge - y.reihenfolge)
}

/** Intervall je Prüfart: abweichend an der Anlage oder Standard der Prüfart. */
function intervall(a: Anlage, p: Pruefart): number {
  return a.anlage_faelligkeit.find((f) => f.pruefart_id === p.id)?.intervall_monate ?? p.intervall_monate
}

/** „12“ bei einer Prüfart, sonst „Wiederkehrende Prüfung: 12; Instandhaltung: 6“. */
function intervallText(a: Anlage): string {
  const arten = aktivePruefarten(a)
  return arten.length === 1 ? String(intervall(a, arten[0])) : arten.map((p) => `${p.name}: ${intervall(a, p)}`).join('; ')
}

/**
 * Nächste Prüfung eines Elements. Im Bestand (Rauchwarnmelder, Geräte) hat jedes Element seine eigene Fälligkeit je Prüfart
 * mit „alle Elemente“, die am Bestand schon stattgefunden hat (wie faelligkeit_naechste() in der Datenbank); die früheste
 * zählt, ein darin noch nie geprüftes Element ist sofort fällig. Sonst wird es mit seiner Anlage geprüft.
 */
export function elementFaelligkeit(e: Element, a: Anlage): { naechste: string | null; nie: boolean } {
  if (!e.aktiv || a.status !== 'aktiv') return { naechste: null, nie: false }
  const alle = aktivePruefarten(a).filter((p) => p.elemente === 'alle')
  if (!istBestandArt(a.anlagentyp?.anlagenart) || !alle.length) {
    return { naechste: a.naechste_pruefung_am, nie: !a.naechste_pruefung_am && !a.letzte_pruefung_am }
  }
  const stattgefunden = alle.filter((p) => a.anlage_faelligkeit.some((f) => f.pruefart_id === p.id && f.letzte_pruefung_am))
  if (!stattgefunden.length) return { naechste: null, nie: true }
  let frueheste: string | null = null
  for (const p of stattgefunden) {
    const n = elementNaechste(e, p.id, intervall(a, p))
    if (!n) return { naechste: null, nie: true }
    if (!frueheste || n < frueheste) frueheste = n
  }
  return { naechste: frueheste, nie: false }
}

const artRang = (art: string | null | undefined) => {
  const i = ART_SCHLUESSEL.indexOf(art as ArtSchluessel)
  return i < 0 ? 0 : i
}

/** Türen zuerst, dann die Arten in ihrer Reihenfolge; darin nach Gebäude, Etage, Bezeichnung, Etikett. */
function anlagenFolge(a: Anlage, b: Anlage): number {
  return artRang(a.anlagentyp?.anlagenart) - artRang(b.anlagentyp?.anlagenart)
    || anlageVergleich({ ...a, bezeichnung: a.kunden_bezeichnung }, { ...b, bezeichnung: b.kunden_bezeichnung })
    || (a.etikett_id ?? '').localeCompare(b.etikett_id ?? '', 'de', { numeric: true })
}

function gruppieren<T>(liste: readonly T[], schluessel: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const x of liste) {
    const k = schluessel(x)
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(x)
  }
  return m
}

export const anlageText = (a: Pick<Anlage, 'etikett_id' | 'kunden_bezeichnung' | 'anlagentyp'>) =>
  [a.etikett_id, a.kunden_bezeichnung].filter(Boolean).join(' ') || artDefinition(a.anlagentyp?.anlagenart).name

/** Die Zeilen der Liste, gestaffelt nach Kunde, Objekt, Anlage, Element; nur die gewählten Ebenen bekommen Zeilen. */
export function zeilenBauen(d: Daten, f: Filter, u: Umgebung): Zeile[] {
  const hat = (e: Ebene) => f.ebenen.includes(e)
  const kundeWahl = new Set(f.kunden)
  const objektWahl = new Set(f.objekte)
  const artWahl = new Set(f.arten)

  const kunden = d.kunden.filter((k) => (f.inaktive || k.aktiv) && (!kundeWahl.size || kundeWahl.has(k.id))).sort(nameVergleich)
  const objekte = gruppieren(d.objekte.filter((o) => (f.inaktive || o.aktiv) && (!objektWahl.size || objektWahl.has(o.id))).sort(nameVergleich),
    (o) => o.endkunde_id)
  const anlagen = gruppieren(d.anlagen.filter((a) => (f.inaktive || a.status === 'aktiv')
    && (!artWahl.size || artWahl.has(a.anlagentyp?.anlagenart ?? ''))).sort(anlagenFolge), (a) => a.objekt_id)
  const elemente = gruppieren(d.elemente.filter((e) => f.inaktive || e.aktiv).sort(elementVergleich), (e) => e.anlage_id)

  const zeilen: Zeile[] = []
  for (const k of kunden) {
    // Mit Auswahl von Objekten oder Arten fallen Kunden und Objekte ohne Treffer weg
    const ihreObjekte = (objekte.get(k.id) ?? []).filter((o) => !artWahl.size || anlagen.has(o.id))
    if ((objektWahl.size || artWahl.size) && !ihreObjekte.length) continue
    if (hat('kunde')) zeilen.push(kundeZeile(k))
    for (const o of ihreObjekte) {
      if (hat('objekt')) zeilen.push(objektZeile(k, o))
      for (const a of anlagen.get(o.id) ?? []) {
        if (hat('anlage')) zeilen.push(anlageZeile(k, o, a, d.offeneMaengel?.get(a.id) ?? 0, u))
        if (!hat('element')) continue
        for (const e of elemente.get(a.id) ?? []) zeilen.push(elementZeile(k, o, a, e, u))
      }
    }
  }
  return zeilen
}

const leer = { objekt: '', anlage: '', element: '', art: null, objektId: null, anlageId: null, code: '', qr: '', letzte: null,
  ergebnis: null, naechste: null, nieGeprueft: false } as const

function kundeZeile(k: Kunde): Zeile {
  return {
    ...leer, ebene: 'kunde', id: k.id, ebeneText: t('Kunde'), kunde: k.name, aktiv: k.aktiv, status: k.aktiv ? t('aktiv') : t('inaktiv'),
    details: { 'k.strasse': k.strasse, 'k.plz': k.plz, 'k.ort': k.ort, 'k.ansprechpartner': k.ansprechpartner, 'k.email': k.email,
      'k.telefon': k.telefon, 'k.notiz': k.notiz },
  }
}

function objektZeile(k: Kunde, o: Objekt): Zeile {
  return {
    ...leer, ebene: 'objekt', id: o.id, ebeneText: t('Objekt'), kunde: k.name, objekt: o.name, objektId: o.id,
    aktiv: o.aktiv, status: o.aktiv ? t('aktiv') : t('inaktiv'),
    details: { 'o.strasse': o.strasse, 'o.plz': o.plz, 'o.ort': o.ort, 'o.zugangshinweise': o.zugangshinweise },
  }
}

function anlageZeile(k: Kunde, o: Objekt, a: Anlage, maengel: number, u: Umgebung): Zeile {
  const art = a.anlagentyp?.anlagenart ?? null
  const aktiv = a.status === 'aktiv'
  return {
    ...leer, ebene: 'anlage', id: a.id, ebeneText: artDefinition(art).einzahl, kunde: k.name, objekt: o.name, anlage: anlageText(a),
    art, objektId: o.id, anlageId: a.id, code: a.etikett_id ?? '', qr: a.etikett_id ? qrInhalt(u.adresse, a.etikett_id, u.mandantencode) : '',
    letzte: a.letzte_pruefung_am, ergebnis: a.letztes_ergebnis, naechste: aktiv ? a.naechste_pruefung_am : null,
    nieGeprueft: aktiv && !a.letzte_pruefung_am && !a.naechste_pruefung_am, aktiv, status: aktiv ? t('aktiv') : t('stillgelegt'),
    details: {
      'a.bezeichnung': a.kunden_bezeichnung, 'a.art': artDefinition(art).protokoll, 'a.typ': a.anlagentyp?.name,
      'a.kategorie': a.anlagentyp?.kategorie ? KATEGORIE[a.anlagentyp.kategorie] ?? a.anlagentyp.kategorie : '',
      'a.gebaeude': a.gebaeude, 'a.etage': a.etage, 'a.raum': a.raum, 'a.lage': a.lage_beschreibung,
      'a.hersteller': a.hersteller, 'a.modell': a.modell, 'a.baujahr': a.baujahr,
      'a.daten': eigenschaftenListe(art, a.eigenschaften).map((x) => `${x.text}: ${x.wert}`).join('; '),
      'a.intervall': intervallText(a), 'a.maengel': maengel, 'a.angelegt': tag(a.erstellt_am), 'a.id': a.id,
    },
  }
}

function elementZeile(k: Kunde, o: Objekt, a: Anlage, e: Element, u: Umgebung): Zeile {
  const art = a.anlagentyp?.anlagenart ?? null
  const def = artDefinition(art).elemente
  const f = elementFaelligkeit(e, a)
  const werte = (e.eigenschaften ?? {}) as Eigenschaften
  return {
    ...leer, ebene: 'element', id: e.id, ebeneText: def ? elementEinzahl(e, def) : t('Element'), kunde: k.name, objekt: o.name,
    anlage: anlageText(a), element: def ? elementName(e, def) : e.nummer, art, objektId: o.id, anlageId: a.id,
    code: e.code ?? '', qr: e.code ? melderQrInhalt(u.adresse, e.code, u.mandantencode) : '',
    letzte: e.zuletzt_geprueft_am, naechste: f.naechste, nieGeprueft: f.nie, aktiv: e.aktiv, status: e.aktiv ? t('aktiv') : t('stillgelegt'),
    details: {
      'e.gruppe': e.gruppe, 'e.nummer': e.nummer, 'e.art': def?.arten.find((x) => x.schluessel === e.elementart)?.name ?? e.elementart,
      'e.ort': e.ort, 'e.typ': e.typ,
      'e.daten': (def?.felder ?? []).map((x) => ({ text: x.text, wert: feldText(x, werte[x.schluessel]) })).filter((x) => x.wert)
        .map((x) => `${x.text}: ${x.wert}`).join('; '),
      'e.id': e.id,
    },
  }
}

/** Spalten zu den gewählten Ebenen: gemeinsame Spalten, dann die Daten je Ebene. `element`: Bezeichnung der Elemente. */
export function spalten(ebenen: readonly Ebene[], element: { einzahl: string } | null): Spalte[] {
  const hat = (e: Ebene) => ebenen.includes(e)
  const tiefste = Math.max(-1, ...ebenen.map((e) => EBENEN.indexOf(e)))
  const pruefung = hat('anlage') || hat('element')
  const s = (schluessel: string, titel: string): Spalte => ({ schluessel, titel })
  return [
    s('ebene', t('Ebene')), s('kunde', t('Kunde')),
    ...(tiefste >= 1 ? [s('objekt', t('Objekt'))] : []),
    ...(tiefste >= 2 ? [s('anlage', tb('Tür'))] : []),
    ...(tiefste >= 3 ? [s('element', element?.einzahl ?? t('Element'))] : []),
    ...(pruefung ? [s('code', t('Etikett / Code')), s('qr', t('QR-Code (Inhalt)')), s('letzte', t('Zuletzt geprüft'))] : []),
    ...(hat('anlage') ? [s('ergebnis', t('Letztes Ergebnis'))] : []),
    ...(pruefung ? [s('naechste', t('Nächste Prüfung'))] : []),
    s('status', t('Status')),
    ...(hat('kunde') ? [s('k.strasse', t('Kunde: Straße')), s('k.plz', t('Kunde: PLZ')), s('k.ort', t('Kunde: Ort')), s('k.ansprechpartner', t('Ansprechpartner')),
      s('k.email', t('E-Mail')), s('k.telefon', t('Telefon')), s('k.notiz', t('Notiz'))] : []),
    ...(hat('objekt') ? [s('o.strasse', t('Objekt: Straße')), s('o.plz', t('Objekt: PLZ')), s('o.ort', t('Objekt: Ort')), s('o.zugangshinweise', t('Zugangshinweise'))] : []),
    ...(hat('anlage') ? [s('a.bezeichnung', t('Bezeichnung beim Kunden')), ...(nurTueren() ? [] : [s('a.art', t('Art'))]), s('a.typ', tb('Türtyp')),
      s('a.kategorie', t('Kategorie')), s('a.gebaeude', t('Gebäude')), s('a.etage', t('Etage')), s('a.raum', t('Raum')), s('a.lage', t('Lagebeschreibung')),
      s('a.hersteller', t('Hersteller')), s('a.modell', t('Modell')), s('a.baujahr', t('Baujahr')), s('a.daten', tb('Türdaten')),
      s('a.intervall', t('Prüfintervall (Monate)')), s('a.maengel', t('Offene Mängel')), s('a.angelegt', t('Angelegt am')), s('a.id', tb('Tür-ID (intern)'))] : []),
    ...(hat('element') ? [s('e.gruppe', t('Gruppe / Wohnung')), s('e.nummer', t('Nummer')), s('e.art', t('Elementart')), s('e.ort', t('Ort / Installationsort')),
      s('e.typ', t('Typ / Hersteller (Element)')), s('e.daten', t('Elementdaten')), s('e.id', t('Element-ID (intern)'))] : []),
  ]
}

/** Text für „Nächste Prüfung“: Datum, „noch nie geprüft“ (sofort fällig) oder leer. */
export function naechsteText(z: Pick<Zeile, 'naechste' | 'nieGeprueft'>): string {
  return z.nieGeprueft ? t('noch nie geprüft') : tag(z.naechste)
}

function wert(z: Zeile, schluessel: string): Wert {
  switch (schluessel) {
    case 'ebene': return z.ebeneText
    case 'kunde': return z.kunde
    case 'objekt': return z.objekt
    case 'anlage': return z.anlage
    case 'element': return z.element
    case 'code': return z.code
    case 'qr': return z.qr
    case 'letzte': return tag(z.letzte)
    case 'ergebnis': return z.ergebnis ? ERGEBNIS[z.ergebnis] : ''
    case 'naechste': return naechsteText(z)
    case 'status': return z.status
    default: return z.details[schluessel] ?? ''
  }
}

/** Tabelle für Excel/CSV: Kopfzeile und je Zeile die Werte der Spalten. */
export function tabelle(zeilen: readonly Zeile[], s: readonly Spalte[]): Wert[][] {
  return [s.map((x) => x.titel), ...zeilen.map((z) => s.map((x) => wert(z, x.schluessel)))]
}
