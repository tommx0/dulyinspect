// Checklisten und Anlagentypen (mit Prüfarten) als JSON-Datei aus- und einlesen, z. B. um sie zwischen Instanzen zu übertragen.
// Verweise laufen über Namen statt IDs: Prüfart → Checkliste, „schließt ein“ → Prüfart desselben Typs.
// Import: Neues wird angelegt (Checklisten als Entwurf v1). Eine vorhandene Checkliste mit anderem Inhalt bekommt eine neue
// Entwurfsversion, freigegeben wird sie erst von Hand. Ein vorhandener Typ bleibt, fehlende Prüfarten kommen dazu.
import { ART_SCHLUESSEL, ARTEN } from './anlagenarten'
import { tb } from './begriffe'
import { pruefePunkte, type Punkt } from './checkliste'
import { t } from './sprache'
import { supabase } from './supabase'
import { TUERANLAGE_TYP } from './tueranlage'

export const AUSTAUSCH_FORMAT = 'anlagenpruefung-vorlagen'
const FORMAT_VERSION = 1

export interface AustauschCheckliste {
  name: string
  beschreibung: string | null
  /** Nummer und Stand der ausgelesenen Version (nur zur Information) */
  version: number
  status: string
  punkte: Punkt[]
  abschnitte: string[]
}
export interface AustauschPruefart {
  name: string
  intervall_monate: number
  /** Name der Checkliste */
  checkliste: string | null
  elemente: 'keine' | 'alle' | 'anteil'
  elemente_anteil: number | null
  elemente_zyklus_monate: number
  /** Name der Prüfart desselben Typs, die mit dieser als durchgeführt gilt */
  schliesst_ein: string | null
  aktiv: boolean
}
export interface AustauschTyp {
  name: string
  anlagenart: string
  kategorie: 'fluchttuer' | 'automatiktuer' | 'sonstige' | null
  mehrpersonenpruefung: boolean
  aktiv: boolean
  pruefarten: AustauschPruefart[]
}
export interface AustauschDatei {
  format: typeof AUSTAUSCH_FORMAT
  version: number
  exportiert_am: string
  app_version: string
  checklisten: AustauschCheckliste[]
  anlagentypen: AustauschTyp[]
}

type Version = { id?: string; version: number; status: string; punkte: unknown; abschnitte: unknown }

/** Version, die ausgelesen wird: die gewählte, sonst die freigegebene, sonst die neueste (wie beim Duplizieren). */
export function vorlageWaehlen<V extends Version>(versionen: V[], versionId?: string): V | undefined {
  const sortiert = [...versionen].sort((a, b) => b.version - a.version)
  return sortiert.find((v) => v.id === versionId) ?? sortiert.find((v) => v.status === 'freigegeben') ?? sortiert[0]
}

/** JSON mit sortierten Schlüsseln: jsonb ordnet Schlüssel anders als die Datei, der Inhalt soll trotzdem als gleich gelten. */
function stabil(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stabil).join(',')}]`
  if (x && typeof x === 'object') {
    return `{${Object.keys(x).sort().filter((k) => (x as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stabil((x as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(x)
}
const gleicherInhalt = (a: { punkte: unknown; abschnitte: unknown }, b: { punkte: unknown; abschnitte: unknown }) =>
  stabil(a.punkte) === stabil(b.punkte) && stabil(a.abschnitte ?? []) === stabil(b.abschnitte ?? [])

// ---------- Export ----------

type DbCheckliste = { id: string; name: string; beschreibung: string | null; checkliste_version: Version[] }
type DbPruefart = {
  id: string; name: string; intervall_monate: number; checkliste_id: string | null; elemente: string; elemente_anteil: number | null
  elemente_zyklus_monate: number; schliesst_ein_id: string | null; aktiv: boolean; reihenfolge: number
}
type DbTyp = { id: string; name: string; anlagenart: string; kategorie: AustauschTyp['kategorie']; mehrpersonenpruefung: boolean; aktiv: boolean; pruefart: DbPruefart[] }

function alsCheckliste(c: DbCheckliste, versionId?: string): AustauschCheckliste {
  const v = vorlageWaehlen(c.checkliste_version, versionId)
  return {
    name: c.name, beschreibung: c.beschreibung, version: v?.version ?? 1, status: v?.status ?? 'entwurf',
    punkte: (v?.punkte ?? []) as Punkt[], abschnitte: (v?.abschnitte ?? []) as string[],
  }
}

function alsTyp(ty: DbTyp, listenName: Map<string, string>): AustauschTyp {
  const pa = [...ty.pruefart].sort((a, b) => a.reihenfolge - b.reihenfolge)
  const paName = new Map(pa.map((p) => [p.id, p.name]))
  return {
    name: ty.name, anlagenart: ty.anlagenart, kategorie: ty.kategorie, mehrpersonenpruefung: ty.mehrpersonenpruefung, aktiv: ty.aktiv,
    pruefarten: pa.map((p) => ({
      name: p.name, intervall_monate: p.intervall_monate, checkliste: (p.checkliste_id && listenName.get(p.checkliste_id)) || null,
      elemente: p.elemente as AustauschPruefart['elemente'], elemente_anteil: p.elemente_anteil, elemente_zyklus_monate: p.elemente_zyklus_monate,
      schliesst_ein: (p.schliesst_ein_id && paName.get(p.schliesst_ein_id)) || null, aktiv: p.aktiv,
    })),
  }
}

const datei = (checklisten: AustauschCheckliste[], anlagentypen: AustauschTyp[]): AustauschDatei => ({
  format: AUSTAUSCH_FORMAT, version: FORMAT_VERSION, exportiert_am: new Date().toISOString(), app_version: __APP_VERSION__,
  checklisten: [...checklisten].sort((a, b) => a.name.localeCompare(b.name, 'de')),
  anlagentypen: [...anlagentypen].sort((a, b) => a.name.localeCompare(b.name, 'de')),
})

async function checklistenLaden(ids?: string[]): Promise<DbCheckliste[]> {
  let abfrage = supabase.from('checkliste').select('id, name, beschreibung, checkliste_version(id, version, status, punkte, abschnitte)')
  if (ids) abfrage = abfrage.in('id', ids)
  const { data, error } = await abfrage
  if (error) throw error
  return data as DbCheckliste[]
}

/** Checklisten auslesen; ohne `ids` alle. Mit `versionId` (nur bei einer Checkliste) genau diese Version. */
export async function checklistenExportieren(ids?: string[], versionId?: string): Promise<AustauschDatei> {
  return datei((await checklistenLaden(ids)).map((c) => alsCheckliste(c, versionId)), [])
}

/** Anlagentypen mit Prüfarten auslesen, die verwendeten Checklisten kommen mit; ohne `ids` alle (ohne den festen Typ der Türanlagen). */
export async function typenExportieren(ids?: string[]): Promise<AustauschDatei> {
  let abfrage = supabase.from('anlagentyp')
    .select('id, name, anlagenart, kategorie, mehrpersonenpruefung, aktiv, pruefart(id, name, intervall_monate, checkliste_id, elemente, elemente_anteil, elemente_zyklus_monate, schliesst_ein_id, aktiv, reihenfolge)')
    .neq('id', TUERANLAGE_TYP)
  if (ids) abfrage = abfrage.in('id', ids)
  const { data, error } = await abfrage
  if (error) throw error
  const typen = data as DbTyp[]
  const listenIds = [...new Set(typen.flatMap((ty) => ty.pruefart.map((p) => p.checkliste_id).filter((id): id is string => !!id)))]
  const listen = listenIds.length ? await checklistenLaden(listenIds) : []
  const listenName = new Map(listen.map((c) => [c.id, c.name]))
  return datei(listen.map((c) => alsCheckliste(c)), typen.map((ty) => alsTyp(ty, listenName)))
}

/** Dateiname wie „checklisten-2026-11-02.json“ oder „checkliste-fluchttuer-mechanisch.json“ */
export function austauschDateiname(art: 'checkliste' | 'checklisten' | 'anlagentyp' | 'anlagentypen', name?: string): string {
  const teil = name?.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
  return `${art}-${teil || new Date().toISOString().slice(0, 10)}.json`
}

// ---------- Datei prüfen ----------

const istText = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0
const ganz = (x: unknown, min: number, max: number) => Number.isInteger(x) && (x as number) >= min && (x as number) <= max
const WAEHLBARE_ARTEN = new Set<string>(ART_SCHLUESSEL.filter((a) => !ARTEN[a].intern))

/** Liest und prüft eine Austauschdatei. Wirft einen Fehler mit lesbarem Text, wenn sie nicht passt. */
export function austauschLesen(text: string): AustauschDatei {
  let roh: unknown
  try { roh = JSON.parse(text) } catch { throw new Error(t('Die Datei ist kein gültiges JSON.')) }
  const d = roh as Partial<AustauschDatei>
  if (!d || typeof d !== 'object' || d.format !== AUSTAUSCH_FORMAT) throw new Error(tb('Die Datei ist kein Export von Checklisten oder Türtypen dieser App.'))
  if (typeof d.version !== 'number' || d.version > FORMAT_VERSION) throw new Error(t('Die Datei stammt aus einer neueren Version der App. Bitte zuerst die App aktualisieren.'))
  const checklisten = Array.isArray(d.checklisten) ? d.checklisten : []
  const anlagentypen = Array.isArray(d.anlagentypen) ? d.anlagentypen : []
  for (const c of checklisten) {
    if (!istText(c?.name) || !Array.isArray(c.punkte)) throw new Error(t('Die Datei enthält eine Checkliste ohne Namen oder Prüfpunkte.'))
    if (c.abschnitte !== undefined && (!Array.isArray(c.abschnitte) || !c.abschnitte.every((a) => typeof a === 'string'))) {
      throw new Error(t('Checkliste „{name}“: Abschnitte sind ungültig.', { name: c.name }))
    }
  }
  for (const ty of anlagentypen) {
    if (!istText(ty?.name) || !Array.isArray(ty.pruefarten)) throw new Error(tb('Die Datei enthält einen Türtyp ohne Namen oder Prüfarten.'))
    for (const p of ty.pruefarten) {
      if (!istText(p?.name) || p.name.trim().length > 80 || !ganz(p.intervall_monate, 1, 120) || !['keine', 'alle', 'anteil'].includes(p.elemente)
        || (p.elemente === 'anteil' && !ganz(p.elemente_anteil, 1, 100)) || !ganz(p.elemente_zyklus_monate ?? 12, 1, 120)) {
        throw new Error(tb('Türtyp „{name}“: Prüfart „{pruefart}“ ist ungültig.', { name: ty.name, pruefart: String(p?.name ?? '') }))
      }
    }
  }
  return { ...d, checklisten, anlagentypen } as AustauschDatei
}

// ---------- Import planen (ohne Datenbank, testbar) ----------

export interface Bestand {
  checklisten: { id: string; name: string; versionen: Version[] }[]
  typen: { id: string; name: string; anlagenart: string; pruefarten: { id: string; name: string }[] }[]
}

export type ListenSchritt =
  | { art: 'neu'; quelle: AustauschCheckliste }
  | { art: 'entwurf'; quelle: AustauschCheckliste; id: string; version: number }
  | { art: 'gleich' | 'uebersprungen'; quelle: AustauschCheckliste; id?: string; grund?: string }
export type TypSchritt =
  | { art: 'neu'; quelle: AustauschTyp }
  | { art: 'ergaenzt'; quelle: AustauschTyp; id: string; neu: AustauschPruefart[]; vorhanden: Map<string, string> }
  | { art: 'gleich' | 'uebersprungen'; quelle: AustauschTyp; grund?: string }

/** Legt fest, was der Import mit jedem Eintrag tut. Verweist ein Typ auf eine Checkliste, die weder in der Datei noch vorhanden ist, bleibt die Prüfart ohne Checkliste. */
export function importPlanen(d: AustauschDatei, bestand: Bestand): { listen: ListenSchritt[]; typen: TypSchritt[] } {
  const vorhandeneListe = new Map(bestand.checklisten.map((c) => [c.name.trim(), c]))
  const listen: ListenSchritt[] = d.checklisten.map((quelle) => {
    const fehler = quelle.punkte.length ? pruefePunkte(quelle.punkte) : []
    if (fehler.length) return { art: 'uebersprungen', quelle, grund: fehler[0] }
    const c = vorhandeneListe.get(quelle.name.trim())
    if (!c) return { art: 'neu', quelle }
    const entwurf = c.versionen.find((v) => v.status === 'entwurf')
    const vergleich = entwurf ?? vorlageWaehlen(c.versionen)
    if (vergleich && gleicherInhalt(vergleich, quelle)) return { art: 'gleich', quelle, id: c.id }
    if (entwurf) return { art: 'uebersprungen', quelle, id: c.id, grund: t('Es gibt schon einen Entwurf (v{version}). Bitte erst freigeben oder verwerfen.', { version: entwurf.version }) }
    return { art: 'entwurf', quelle, id: c.id, version: Math.max(0, ...c.versionen.map((v) => v.version)) + 1 }
  })

  const typen: TypSchritt[] = d.anlagentypen.map((quelle) => {
    if (!WAEHLBARE_ARTEN.has(quelle.anlagenart)) return { art: 'uebersprungen', quelle, grund: t('Unbekannte Anlagenart „{art}“.', { art: quelle.anlagenart }) }
    const ty = bestand.typen.find((x) => x.name.trim() === quelle.name.trim() && x.anlagenart === quelle.anlagenart)
    if (!ty) return { art: 'neu', quelle }
    const vorhanden = new Map(ty.pruefarten.map((p) => [p.name.trim(), p.id]))
    const neu = quelle.pruefarten.filter((p) => !vorhanden.has(p.name.trim()))
    return neu.length ? { art: 'ergaenzt', quelle, id: ty.id, neu, vorhanden } : { art: 'gleich', quelle }
  })
  return { listen, typen }
}

// ---------- Import ausführen ----------

export interface ImportBericht {
  listenNeu: string[]
  listenEntwurf: string[]
  listenGleich: string[]
  typenNeu: string[]
  typenErgaenzt: string[]
  typenGleich: string[]
  /** „Name: Grund“ */
  uebersprungen: string[]
  /** Prüfarten, deren Checkliste nicht gefunden wurde */
  ohneCheckliste: string[]
}

async function bestandLaden(): Promise<Bestand> {
  const [listen, typen] = await Promise.all([
    supabase.from('checkliste').select('id, name, checkliste_version(id, version, status, punkte, abschnitte)'),
    supabase.from('anlagentyp').select('id, name, anlagenart, pruefart(id, name)').neq('id', TUERANLAGE_TYP),
  ])
  if (listen.error || typen.error) throw listen.error ?? typen.error
  return {
    checklisten: listen.data.map((c) => ({ id: c.id, name: c.name, versionen: c.checkliste_version })),
    typen: typen.data.map((ty) => ({ id: ty.id, name: ty.name, anlagenart: ty.anlagenart, pruefarten: ty.pruefart })),
  }
}

/** Führt den Import aus. Einträge werden nacheinander angelegt; bricht er ab, bleibt das bis dahin Angelegte erhalten. */
export async function austauschImportieren(d: AustauschDatei): Promise<ImportBericht> {
  const bestand = await bestandLaden()
  const plan = importPlanen(d, bestand)
  const b: ImportBericht = { listenNeu: [], listenEntwurf: [], listenGleich: [], typenNeu: [], typenErgaenzt: [], typenGleich: [], uebersprungen: [], ohneCheckliste: [] }
  const listenId = new Map(bestand.checklisten.map((c) => [c.name.trim(), c.id]))

  for (const s of plan.listen) {
    const inhalt = { punkte: s.quelle.punkte as never, abschnitte: (s.quelle.abschnitte ?? []) as never }
    if (s.art === 'neu') {
      const { data, error } = await supabase.from('checkliste').insert({ name: s.quelle.name.trim(), beschreibung: s.quelle.beschreibung ?? null }).select('id').single()
      if (error) throw error
      const { error: ev } = await supabase.from('checkliste_version').insert({ checkliste_id: data.id, version: 1, ...inhalt })
      if (ev) {
        await supabase.from('checkliste').delete().eq('id', data.id)
        throw ev
      }
      listenId.set(s.quelle.name.trim(), data.id)
      b.listenNeu.push(s.quelle.name)
    } else if (s.art === 'entwurf') {
      const { error } = await supabase.from('checkliste_version').insert({ checkliste_id: s.id, version: s.version, ...inhalt })
      if (error) throw error
      b.listenEntwurf.push(t('{name} (Entwurf v{version})', { name: s.quelle.name, version: s.version }))
    } else if (s.art === 'gleich') b.listenGleich.push(s.quelle.name)
    else b.uebersprungen.push(`${s.quelle.name}: ${s.grund}`)
  }

  const zeile = (p: AustauschPruefart, typId: string, reihenfolge: number, ids: Map<string, string>, typName: string) => {
    const checkliste = p.checkliste ? listenId.get(p.checkliste.trim()) ?? null : null
    if (p.checkliste && !checkliste) b.ohneCheckliste.push(`${typName} – ${p.name}`)
    return {
      id: ids.get(p.name.trim()), anlagentyp_id: typId, name: p.name.trim(), intervall_monate: p.intervall_monate, checkliste_id: checkliste, reihenfolge,
      elemente: p.elemente, elemente_anteil: p.elemente === 'anteil' ? p.elemente_anteil : null, elemente_zyklus_monate: p.elemente_zyklus_monate ?? 12,
      schliesst_ein_id: (p.schliesst_ein && ids.get(p.schliesst_ein.trim())) || null, aktiv: p.aktiv ?? true,
    }
  }

  for (const s of plan.typen) {
    if (s.art === 'neu') {
      const q = s.quelle
      const { data, error } = await supabase.from('anlagentyp').insert({
        name: q.name.trim(), anlagenart: q.anlagenart, kategorie: q.anlagenart === 'tuer' ? q.kategorie ?? 'sonstige' : null,
        mehrpersonenpruefung: !!q.mehrpersonenpruefung, aktiv: q.aktiv ?? true,
      }).select('id').single()
      if (error) throw error
      const ids = new Map(q.pruefarten.map((p) => [p.name.trim(), crypto.randomUUID()]))
      if (q.pruefarten.length) {
        const { error: ep } = await supabase.from('pruefart').insert(q.pruefarten.map((p, i) => zeile(p, data.id, i + 1, ids, q.name)))
        if (ep) {
          await supabase.from('anlagentyp').delete().eq('id', data.id)
          throw ep
        }
      }
      b.typenNeu.push(q.name)
    } else if (s.art === 'ergaenzt') {
      const ids = new Map([...s.vorhanden, ...s.neu.map((p) => [p.name.trim(), crypto.randomUUID()] as const)])
      const start = s.vorhanden.size
      const { error } = await supabase.from('pruefart').insert(s.neu.map((p, i) => zeile(p, s.id, start + i + 1, ids, s.quelle.name)))
      if (error) throw error
      b.typenErgaenzt.push(t('{name} (+{n} Prüfart(en))', { name: s.quelle.name, n: s.neu.length }))
    } else if (s.art === 'gleich') b.typenGleich.push(s.quelle.name)
    else b.uebersprungen.push(`${s.quelle.name}: ${s.grund}`)
  }
  return b
}
