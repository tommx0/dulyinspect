// Prüfpunkt-Struktur einer Checkliste (checkliste_version.punkte), siehe Spezifikation 4.1.
// Die Validierung spiegelt die SQL-Funktion checkliste_punkte_pruefen – Server bleibt maßgeblich.
import { grenzeText, zahlText } from './messwerte'
import { t } from './sprache'

export const PUNKT_TYPEN = {
  status: t('i.O. / n.i.O. / entfällt'),
  messwert: t('Messwert'),
  ja_nein: t('Ja / Nein'),
  auswahl: t('Auswahl'),
  text: t('Freitext'),
  foto: t('Foto'),
} as const

export type PunktTyp = keyof typeof PUNKT_TYPEN
export type Stufe = 1 | 2 | 3

export const STUFEN: Record<Stufe, string> = {
  1: t('geringfügig'),
  2: t('erheblich'),
  3: t('gefährlich'),
}

export interface Option {
  wert: string
  mangel?: boolean
  vorschlag_stufe?: Stufe
}

/** Einzelbedingung auf die Antwort eines vorherigen Punkts. Genau eine der drei Familien: Wert, Mangel oder Zahl. */
export interface Blatt {
  punkt: string
  // Antwortwert (Ja/Nein, Auswahl, i.O./n.i.O./entfällt)
  ist?: string
  ist_nicht?: string
  in?: string[]
  // Ergibt die Antwort einen Mangel (bei Messwerten: außerhalb Soll)?
  mangel?: boolean
  // Messwert: kleiner als `unter` und/oder größer als `ueber`
  unter?: number
  ueber?: number
}

/** UND (`alle`) bzw. ODER (`eine`) über mehrere Bedingungen. */
export interface Gruppe {
  alle?: Bedingung[]
  eine?: Bedingung[]
}

export type Bedingung = Blatt | Gruppe

export const istGruppe = (b: Bedingung): b is Gruppe => 'alle' in b || 'eine' in b

/**
 * Wirkung: Solange `wenn` zutrifft, gelten für den Punkt strengere oder andere Regeln – der Punkt bleibt sichtbar.
 * Mehrere zutreffende Wirkungen wirken zusammen (Pflicht: eine genügt; Mangelstufe: die höchste; Grenzwert: die spätere gewinnt).
 */
export interface Wirkung {
  wenn: Bedingung
  /** Der Punkt wird zur Pflichtangabe */
  pflicht?: true
  /** Ein Mangel hat mindestens diese Stufe */
  stufe?: Stufe
  /** Grenzwerte eines Messwerts ersetzen die des Punkts */
  soll_min?: number
  soll_max?: number
}

export interface Punkt {
  id: string
  abschnitt: string
  text: string
  typ: PunktTyp
  pflicht?: boolean
  hinweis?: string
  foto_bei_nok?: boolean
  vorschlag_stufe?: Stufe
  // messwert
  einheit?: string
  soll_min?: number
  soll_max?: number
  verifizieren?: boolean
  // ja_nein
  gut?: 'ja' | 'nein'
  // auswahl
  optionen?: Option[]
  nur_wenn?: Bedingung
  wirkungen?: Wirkung[]
  /** Nur abgeleitet (siehe `wirksam`), wird nie gespeichert: Mangelstufe mindestens */
  mindest_stufe?: Stufe
}

export interface AntwortWert {
  status?: 'io' | 'nio' | 'entfaellt' | null
  zahl?: number | null
  text?: string | null
}

/** Antworten für Bedingungen, je Punkt-ID. Ein reiner Text gilt als Antworttext (Ja/Nein, Auswahl). */
export type BedingungsWerte = Record<string, string | AntwortWert | undefined>

/** Bedeutet die Antwort einen Mangel? Liefert die vorgeschlagene Stufe oder null. */
export function mangelVorschlag(punkt: Punkt, a: AntwortWert | undefined): Stufe | null {
  if (!a) return null
  const stufe = (s?: Stufe) => Math.max(s ?? punkt.vorschlag_stufe ?? 2, punkt.mindest_stufe ?? 0) as Stufe
  switch (punkt.typ) {
    case 'status':
      return a.status === 'nio' ? stufe() : null
    case 'messwert': {
      if (a.zahl == null || a.status === 'entfaellt') return null
      const zuKlein = punkt.soll_min != null && a.zahl < punkt.soll_min
      const zuGross = punkt.soll_max != null && a.zahl > punkt.soll_max
      return zuKlein || zuGross ? stufe() : null
    }
    case 'ja_nein':
      return punkt.gut && a.text && a.text !== punkt.gut ? stufe() : null
    case 'auswahl': {
      const o = punkt.optionen?.find((x) => x.wert === a.text)
      return o?.mangel ? stufe(o.vorschlag_stufe) : null
    }
    default:
      return null
  }
}

/**
 * Vorschlag für die Beschreibung des Mangels zu einer Antwort: der Prüfpunkt mit dem, was an ihm nicht stimmt
 * („Tür schließt selbsttätig: nicht in Ordnung“, „Schließkraft: 180 N – zu hoch (Soll ≤ 150 N)“). Der Prüfpunkt allein
 * läse sich wie ein Befund ohne Mangel.
 */
export function mangelText(punkt: Punkt, a: AntwortWert | undefined): string {
  const text = punkt.text.trim().replace(/[?:]$/, '')
  switch (punkt.typ) {
    case 'status':
      return `${text}: nicht in Ordnung`
    case 'messwert': {
      if (a?.zahl == null) return `${text}: Messwert außerhalb des Sollwerts`
      const einheit = punkt.einheit ? ` ${punkt.einheit}` : ''
      const soll = grenzeText({ min: punkt.soll_min, max: punkt.soll_max, einheit: punkt.einheit ?? '' }).trim()
      const richtung = punkt.soll_min != null && a.zahl < punkt.soll_min ? 'zu niedrig' : 'zu hoch'
      return `${text}: ${zahlText(a.zahl)}${einheit} – ${richtung}${soll ? ` (Soll ${soll})` : ''}`
    }
    case 'ja_nein':
      return a?.text ? `${text}: ${a.text}${punkt.gut ? ` (erwartet: ${punkt.gut})` : ''}` : `${text}: nicht in Ordnung`
    case 'auswahl':
      return a?.text ? `${text}: ${a.text}` : `${text}: nicht in Ordnung`
    default:
      return text
  }
}

function hatAntwort(punkt: Punkt, a: AntwortWert): boolean {
  switch (punkt.typ) {
    case 'status': return !!a.status
    case 'messwert': return a.zahl != null || a.status === 'entfaellt'
    case 'ja_nein':
    case 'auswahl':
    case 'text': return !!a.text?.trim()
    default: return false
  }
}

const MAX_TIEFE = 20

function blattErfuellt(b: Blatt, werte: BedingungsWerte, alle: Punkt[] | undefined, tiefe: number): boolean {
  const ref = alle?.find((p) => p.id === b.punkt)
  // Ist der steuernde Punkt selbst ausgeblendet, ist auch der abhängige ausgeblendet
  if (ref && !istSichtbar(ref, werte, alle, tiefe + 1)) return false
  const roh = werte[b.punkt]
  const a: AntwortWert | undefined = typeof roh === 'string' ? { text: roh } : roh
  if (!a) return false
  if (b.mangel !== undefined) {
    return !!ref && hatAntwort(ref, a) && (mangelVorschlag(wirksam(ref, werte, alle, tiefe + 1), a) !== null) === b.mangel
  }
  if (b.unter !== undefined || b.ueber !== undefined) {
    if (a.zahl == null) return false
    return (b.unter === undefined || a.zahl < b.unter) && (b.ueber === undefined || a.zahl > b.ueber)
  }
  const w = (ref?.typ === 'status' ? a.status : a.text) ?? undefined
  if (w === undefined) return false
  if (b.in) return b.in.includes(w)
  if (b.ist_nicht !== undefined) return w !== b.ist_nicht
  return w === b.ist
}

function bedingungErfuellt(b: Bedingung, werte: BedingungsWerte, alle: Punkt[] | undefined, tiefe: number): boolean {
  if (!istGruppe(b)) return blattErfuellt(b, werte, alle, tiefe)
  if (b.alle) return b.alle.every((x) => bedingungErfuellt(x, werte, alle, tiefe))
  return (b.eine ?? []).some((x) => bedingungErfuellt(x, werte, alle, tiefe))
}

/** Trifft die Bedingung bei diesen Antworten zu? Antworten ausgeblendeter Punkte zählen nicht. */
export function bedingungTrifft(b: Bedingung, werte: BedingungsWerte, alle?: Punkt[], tiefe = 0): boolean {
  return tiefe <= MAX_TIEFE && bedingungErfuellt(b, werte, alle, tiefe)
}

/** Ist der Punkt angesichts der bisherigen Antworten sichtbar? */
export function istSichtbar(punkt: Punkt, werte: BedingungsWerte, alle?: Punkt[], tiefe = 0): boolean {
  if (!punkt.nur_wenn) return true
  if (tiefe > MAX_TIEFE) return false
  return bedingungErfuellt(punkt.nur_wenn, werte, alle, tiefe)
}

/** Die Wirkungen des Punkts, die bei diesen Antworten gelten. */
export function aktiveWirkungen(punkt: Punkt, werte: BedingungsWerte, alle?: Punkt[], tiefe = 0): Wirkung[] {
  if (!punkt.wirkungen?.length || tiefe > MAX_TIEFE) return []
  return punkt.wirkungen.filter((w) => bedingungErfuellt(w.wenn, werte, alle, tiefe))
}

/** Der Punkt mit angewendeten Wirkungen (Pflicht, Mindest-Mangelstufe, Grenzwerte); ohne zutreffende Wirkung derselbe Punkt. */
export function wirksam(punkt: Punkt, werte: BedingungsWerte, alle?: Punkt[], tiefe = 0): Punkt {
  const aktiv = aktiveWirkungen(punkt, werte, alle, tiefe)
  if (aktiv.length === 0) return punkt
  const p: Punkt = { ...punkt }
  for (const w of aktiv) {
    if (w.pflicht) p.pflicht = true
    if (w.stufe) p.mindest_stufe = Math.max(p.mindest_stufe ?? 0, w.stufe) as Stufe
    if (w.soll_min !== undefined) p.soll_min = w.soll_min
    if (w.soll_max !== undefined) p.soll_max = w.soll_max
  }
  return p
}

/** Abschnitte in Reihenfolge des ersten Auftretens gruppieren. */
export function nachAbschnitt(punkte: Punkt[]): [string, Punkt[]][] {
  const m = new Map<string, Punkt[]>()
  for (const p of punkte) {
    const liste = m.get(p.abschnitt) ?? []
    liste.push(p)
    m.set(p.abschnitt, liste)
  }
  return [...m.entries()]
}

export function bedingungsWerte(b: Blatt): string[] {
  if (b.in) return b.in
  if (b.ist_nicht !== undefined) return [b.ist_nicht]
  return b.ist !== undefined ? [b.ist] : []
}

/** Antwortwerte, auf die sich `ist` / `ist_nicht` / `in` beziehen können. */
export function erlaubteWerte(p: Punkt): string[] {
  if (p.typ === 'ja_nein') return ['ja', 'nein']
  if (p.typ === 'status') return ['io', 'nio', 'entfaellt']
  if (p.typ === 'auswahl') return (p.optionen ?? []).map((o) => o.wert)
  return []
}

const STATUS_TEXT: Record<string, string> = { io: t('i.O.'), nio: t('n.i.O.'), entfaellt: t('entfällt') }

/** Anzeigetext eines Antwortwerts. */
export function wertText(p: Punkt | undefined, wert: string): string {
  if (p?.typ === 'ja_nein') return wert === 'ja' ? t('Ja') : wert === 'nein' ? t('Nein') : wert
  if (p?.typ === 'status') return STATUS_TEXT[wert] ?? wert
  return wert
}

/** Punkttypen, deren Antwort ein Mangel sein kann. */
export const kannMangel = (p: Punkt) => p.typ === 'status' || p.typ === 'messwert' || p.typ === 'ja_nein' || p.typ === 'auswahl'

/** Punkttypen, die als Quelle einer Bedingung taugen. */
export const istBedingungsQuelle = (p: Punkt) => p.typ !== 'text' && p.typ !== 'foto'

/** Ein Zweig im Editor: eine Antwort, unter der Unterpunkte hängen. */
export interface Zweig {
  schluessel: string
  label: string
  /** Bedingung ohne `punkt` */
  blatt: Omit<Blatt, 'punkt'>
}

export function zweigeVon(p: Punkt): Zweig[] {
  switch (p.typ) {
    case 'ja_nein':
    case 'status':
      return erlaubteWerte(p).map((w) => ({ schluessel: w, label: wertText(p, w), blatt: { ist: w } }))
    case 'auswahl':
      return erlaubteWerte(p).filter(Boolean).map((w) => ({ schluessel: w, label: w, blatt: { ist: w } }))
    case 'messwert':
      return [
        { schluessel: 'mangel', label: t('außerhalb Soll'), blatt: { mangel: true } },
        { schluessel: 'kein_mangel', label: t('im Soll'), blatt: { mangel: false } },
      ]
    default:
      return []
  }
}

export function zweigBedingung(eltern: Punkt, schluessel: string): Blatt | undefined {
  const z = zweigeVon(eltern).find((x) => x.schluessel === schluessel)
  return z && { punkt: eltern.id, ...z.blatt }
}

/** Alle Blätter einer Bedingung. */
export function blaetter(b: Bedingung): Blatt[] {
  return istGruppe(b) ? [...(b.alle ?? []), ...(b.eine ?? [])].flatMap(blaetter) : [b]
}

/** IDs aller Punkte, auf die sich die Bedingung bezieht. */
export function bezugsIds(b: Bedingung | undefined): string[] {
  return b ? [...new Set(blaetter(b).map((x) => x.punkt))] : []
}

/** Entfernt alle Bezüge auf `id`; null, wenn nichts übrig bleibt. */
export function ohneBezug(b: Bedingung, id: string): Bedingung | undefined {
  if (!istGruppe(b)) return b.punkt === id ? undefined : b
  const art = b.alle ? 'alle' : 'eine'
  const rest = (b[art] ?? []).map((x) => ohneBezug(x, id)).filter((x): x is Bedingung => !!x)
  if (rest.length === 0) return undefined
  return rest.length === 1 ? rest[0] : { [art]: rest }
}

/** Lesbare Fassung, z. B. „Fluchtweg frei“ = Ja. Mit `ohnePunkt` entfällt der Bezug auf diesen Punkt („= Ja“). */
export function bedingungsText(b: Bedingung, punkte: Punkt[], ohnePunkt?: string): string {
  if (istGruppe(b)) {
    const art = b.alle ? 'alle' : 'eine'
    const teile = (b[art] ?? []).map((x) => (istGruppe(x) ? `(${bedingungsText(x, punkte, ohnePunkt)})` : bedingungsText(x, punkte, ohnePunkt)))
    return teile.join(art === 'alle' ? t(' UND ') : t(' ODER '))
  }
  const ref = punkte.find((x) => x.id === b.punkt)
  const wer = b.punkt === ohnePunkt ? '' : `„${ref?.text ?? b.punkt}“ `
  const einheit = ref?.einheit ? ` ${ref.einheit}` : ''
  const teile: string[] = []
  if (b.mangel !== undefined) {
    teile.push(ref?.typ === 'messwert' ? (b.mangel ? t('außerhalb Soll') : t('im Soll')) : (b.mangel ? t('ergibt Mangel') : t('ergibt keinen Mangel')))
  }
  if (b.ueber !== undefined) teile.push(`> ${b.ueber}${einheit}`)
  if (b.unter !== undefined) teile.push(`< ${b.unter}${einheit}`)
  if (b.in || b.ist !== undefined || b.ist_nicht !== undefined) {
    const werte = (b.in ?? [b.ist ?? b.ist_nicht ?? '']).map((w) => wertText(ref, w)).join(' / ')
    teile.push(`${b.ist_nicht !== undefined ? '≠' : '='} ${werte}`)
  }
  return (wer + teile.join(t(' und '))).trim()
}

/** Kurztext der Folgen einer Wirkung, z. B. „Pflicht, Mangelstufe mindestens 3“. */
export function wirkungFolgen(w: Wirkung, einheit?: string): string {
  const teile: string[] = []
  if (w.pflicht) teile.push(t('Pflicht'))
  if (w.stufe) teile.push(t('Mangelstufe mindestens {stufe}', { stufe: w.stufe }))
  if (w.soll_min !== undefined || w.soll_max !== undefined) {
    teile.push(t('Soll {min} bis {max}', { min: w.soll_min ?? '–', max: w.soll_max ?? '–' }) + (einheit ? ` ${einheit}` : ''))
  }
  return teile.join(', ')
}

/** Lesbare Fassung einer Wirkung, z. B. „Pflicht, wenn „Zustand“ = n.i.O.“. */
export function wirkungText(w: Wirkung, punkt: Punkt, punkte: Punkt[]): string {
  return t('{folgen}, wenn {bedingung}', { folgen: wirkungFolgen(w, punkt.einheit), bedingung: bedingungsText(w.wenn, punkte) })
}

const MAX_GRUPPENTIEFE = 3

function pruefeBedingung(b: Bedingung, id: string, vorher: Map<string, Punkt>, fehler: string[], tiefe: number) {
  if (istGruppe(b)) {
    if (b.alle && b.eine) return void fehler.push(t('{id}: Bedingung darf UND und ODER nicht mischen', { id }))
    if (tiefe >= MAX_GRUPPENTIEFE) return void fehler.push(t('{id}: Bedingung zu tief verschachtelt', { id }))
    const liste = b.alle ?? b.eine
    if (!Array.isArray(liste) || liste.length === 0) return void fehler.push(t('{id}: Bedingungsgruppe ohne Bedingung', { id }))
    for (const x of liste) pruefeBedingung(x, id, vorher, fehler, tiefe + 1)
    return
  }
  const ref = vorher.get(b.punkt)
  if (!ref) return void fehler.push(t('{id}: Bedingung verweist nicht auf einen vorherigen Punkt', { id }))
  if (!istBedingungsQuelle(ref)) {
    return void fehler.push(t('{id}: Bedingung muss auf einen Punkt mit auswertbarer Antwort verweisen (nicht Freitext oder Foto)', { id }))
  }
  const wertOp = b.ist !== undefined || b.ist_nicht !== undefined || b.in !== undefined
  const mangelOp = b.mangel !== undefined
  const zahlOp = b.unter !== undefined || b.ueber !== undefined
  const anzahl = [wertOp, mangelOp, zahlOp].filter(Boolean).length
  if (anzahl === 0) return void fehler.push(t('{id}: Bedingung ohne Wert', { id }))
  if (anzahl > 1) return void fehler.push(t('{id}: Bedingung mischt Antwortwert, Mangel und Zahl', { id }))
  if (wertOp) {
    const erlaubt = erlaubteWerte(ref)
    if (erlaubt.length === 0) return void fehler.push(t('{id}: Bedingung auf einen Messwert braucht „unter“, „über“ oder „Mangel“', { id }))
    const werte = bedingungsWerte(b)
    if (werte.length === 0) fehler.push(t('{id}: Bedingung ohne Wert', { id }))
    for (const w of werte) if (!erlaubt.includes(w)) fehler.push(t('{id}: ungültiger Bedingungswert „{wert}“', { id, wert: w }))
  } else if (mangelOp) {
    if (typeof b.mangel !== 'boolean' || !kannMangel(ref)) fehler.push(t('{id}: Bedingung „Mangel“ passt nicht zum Punkt „{punkt}“', { id, punkt: ref.id }))
  } else {
    const zahlen = [b.unter, b.ueber].filter((x) => x !== undefined)
    if (ref.typ !== 'messwert') fehler.push(t('{id}: Bedingung „unter/über“ braucht einen Messwert-Punkt', { id }))
    else if (zahlen.some((x) => typeof x !== 'number' || !Number.isFinite(x))) fehler.push(t('{id}: Bedingung braucht eine Zahl', { id }))
  }
}

function pruefeWirkungen(p: Punkt, vorher: Map<string, Punkt>, fehler: string[]) {
  if (!Array.isArray(p.wirkungen) || p.wirkungen.length === 0) return void fehler.push(t('{id}: Wirkungen ungültig', { id: p.id }))
  for (const w of p.wirkungen) {
    if (!w.wenn) fehler.push(t('{id}: Wirkung ohne Bedingung', { id: p.id }))
    else pruefeBedingung(w.wenn, p.id, vorher, fehler, 0)
    const grenze = w.soll_min !== undefined || w.soll_max !== undefined
    if (w.pflicht === undefined && w.stufe === undefined && !grenze) fehler.push(t('{id}: Wirkung ohne Folge', { id: p.id }))
    if (w.pflicht !== undefined && w.pflicht !== true) fehler.push(t('{id}: Wirkung „Pflicht“ muss „ja“ sein', { id: p.id }))
    if (w.stufe !== undefined) {
      if (![1, 2, 3].includes(w.stufe)) fehler.push(t('{id}: Wirkung hat eine ungültige Mangelstufe', { id: p.id }))
      else if (!kannMangel(p)) fehler.push(t('{id}: Wirkung „Mangelstufe“ passt nicht zum Antworttyp', { id: p.id }))
    }
    if (grenze) {
      if (p.typ !== 'messwert') fehler.push(t('{id}: Wirkung „Grenzwert“ gilt nur für Messwerte', { id: p.id }))
      else if ([w.soll_min, w.soll_max].some((x) => x !== undefined && !Number.isFinite(x))) fehler.push(t('{id}: Wirkung hat einen ungültigen Grenzwert', { id: p.id }))
      else if (w.soll_min !== undefined && w.soll_max !== undefined && w.soll_min > w.soll_max) fehler.push(t('{id}: Wirkung: Soll-Minimum ist größer als Soll-Maximum', { id: p.id }))
    }
  }
}

/** Liefert Fehlertexte; leer = gültig. `fuerFreigabe` prüft zusätzlich unbestätigte Grenzwerte. */
export function pruefePunkte(punkte: Punkt[], fuerFreigabe = false): string[] {
  const fehler: string[] = []
  if (punkte.length === 0) return [t('Checkliste enthält keine Prüfpunkte')]
  const vorher = new Map<string, Punkt>()
  for (const p of punkte) {
    if (!p.id?.trim() || !p.text?.trim()) {
      fehler.push(t('Prüfpunkt ohne ID oder Text'))
      continue
    }
    if (vorher.has(p.id)) fehler.push(t('Doppelte Punkt-ID {id}', { id: p.id }))
    if (!(p.typ in PUNKT_TYPEN)) fehler.push(t('{id}: unbekannter Typ {typ}', { id: p.id, typ: p.typ }))
    if (p.typ === 'auswahl' && (p.optionen?.length ?? 0) < 2) fehler.push(t('{id}: Auswahl braucht mindestens 2 Optionen', { id: p.id }))
    if (p.typ === 'messwert' && p.soll_min !== undefined && p.soll_max !== undefined && p.soll_min > p.soll_max) {
      fehler.push(t('{id}: Soll-Minimum ist größer als Soll-Maximum', { id: p.id }))
    }
    if (fuerFreigabe && p.verifizieren) fehler.push(t('{id}: Grenzwert noch nicht fachlich bestätigt', { id: p.id }))
    if (p.nur_wenn) pruefeBedingung(p.nur_wenn, p.id, vorher, fehler, 0)
    if (p.wirkungen !== undefined) pruefeWirkungen(p, vorher, fehler)
    vorher.set(p.id, p)
  }
  return fehler
}

/** IDs aller Punkte, auf die sich Sichtbarkeit oder Wirkungen des Punkts beziehen. */
export function alleBezuege(p: Punkt): string[] {
  return [...new Set([...bezugsIds(p.nur_wenn), ...(p.wirkungen ?? []).flatMap((w) => bezugsIds(w.wenn))])]
}

/** Punkte, deren Bedingung oder Wirkung auf `punktId` verweist (für Warnung beim Löschen/Verschieben). */
export function abhaengigeVon(punkte: Punkt[], punktId: string): Punkt[] {
  return punkte.filter((p) => alleBezuege(p).includes(punktId))
}

/** Der Punkt ohne alle Bezüge auf `id`: Bedingungen verlieren die betroffenen Teile, Wirkungen ohne Bedingung entfallen. */
export function ohneBezugAuf(p: Punkt, id: string): Punkt {
  if (!alleBezuege(p).includes(id)) return p
  const neu: Punkt = { ...p }
  if (p.nur_wenn) {
    const b = ohneBezug(p.nur_wenn, id)
    if (b) neu.nur_wenn = b
    else delete neu.nur_wenn
  }
  if (p.wirkungen) {
    const w = p.wirkungen.flatMap((x) => {
      const wenn = ohneBezug(x.wenn, id)
      return wenn ? [{ ...x, wenn }] : []
    })
    if (w.length) neu.wirkungen = w
    else delete neu.wirkungen
  }
  return neu
}

/** Neue, lesbare und eindeutige Punkt-ID erzeugen. */
export function neuePunktId(punkte: Punkt[], basis = 'punkt'): string {
  const slug = basis
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30) || 'punkt'
  const ids = new Set(punkte.map((p) => p.id))
  let id = slug
  for (let i = 2; ids.has(id); i++) id = `${slug}-${i}`
  return id
}
