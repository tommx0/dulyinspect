// Alle Daten einer abgeschlossenen Prüfung vom Server laden (inkl. Fotos und Unterschriften als data:-URLs). Im Demomodus
// kommen sie aus dem Gerätespeicher (simulierte Prüfung, pruefprotokollDatenLokal).
import { ARTEN_DE, feldText, STANDARD_PRUEFART, type ArtFeld, type ArtSchluessel, type Eigenschaften } from '../lib/anlagenarten'
import type { Punkt } from '../lib/checkliste'
import { elementVergleich, lageText, type GruppeLage } from '../lib/elemente'
import { etagenRang } from '../lib/sortierung'
import { imSoll, messungenFuer, messwerteLesen, type Messung } from '../lib/messwerte'
import { DIREKTE_ADRESSE, qrInhalt } from '../lib/etikett'
import { eigenerMandantencode } from '../lib/mandantencode'
import { melderQrInhalt } from '../lib/melderCode'
import QRCode from 'qrcode'
import { erscheinungsbildLaden, logoPdfUrl } from '../lib/erscheinungsbild'
import { anlageVergleich } from '../lib/sortierung'
import { entschluesselt } from '../lib/entschluesselt'
import { supabase, type Zeile } from '../lib/supabase'
import { dateiEntschluesseln, entschluesseln, GesperrtFehler, holen, istDateiNichtLesbar, istNichtLesbar } from '../lib/verschluesselung'
import { gebietsschema, sprache, t, tIn, type Sprache } from '../lib/sprache'
import { db, type Pruefung } from '../offline/db'
import { aenderungenZusammenfassen, type AenderungKontext } from './aenderungen'
import { protokollSprache } from './pdfDoc'
import type { Ampel, ProtokollAenderung, ProtokollDaten, ProtokollMangel, ProtokollPerson, ProtokollAnlage, ProtokollElemente, ProtokollTueranlage } from './typen'

/**
 * Anlagenarten in der deutschen Fassung: Begriffe und Feldnamen übersetzt erst das PDF in die Sprache der Protokolle
 * (src/protokoll/pdfDoc.ts); artDefinition() lieferte sie schon in der Sprache der Oberfläche.
 */
const artDefinition = (art: string | null | undefined) => ARTEN_DE[art as ArtSchluessel] ?? ARTEN_DE.tuer

const datumIn = (s: Sprache, iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString(gebietsschema(s), { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })

/** Wert eines Anlagenfelds in der Sprache des Protokolls (wie feldText, aber nicht in der Sprache der Oberfläche) */
function feldWert(s: Sprache, f: ArtFeld, wert: unknown): string {
  if (wert == null || wert === '') return ''
  if (f.typ === 'ja_nein') return wert === true || wert === 'ja' ? tIn(s, 'ja') : tIn(s, 'nein')
  if (f.typ === 'auswahl' && typeof wert === 'string') return tIn(s, wert)
  if (f.typ === 'datum' && typeof wert === 'string' && /^\d{4}-\d{2}-\d{2}/.test(wert)) return datumIn(s, wert)
  return feldText(f, wert)
}

/** Sachkunde mit Gültigkeit: „Nachweis (gültig bis 31.12.2027)“ */
const sachkundeText = (s: Sprache, nachweis: string, gueltigBis: string | null) =>
  gueltigBis ? `${nachweis} (${tIn(s, 'gültig bis')} ${datumIn(s, gueltigBis)})` : nachweis

/** Grenzwert in der Sprache des Protokolls: „≥ 1 MΩ“, „≤ 2,87 Ω“, „15–30 mA“ oder leer */
function grenzeText(s: Sprache, m: Pick<Messung, 'min' | 'max' | 'einheit'>): string {
  const z = (n: number) => n.toLocaleString(gebietsschema(s), { maximumFractionDigits: 3 })
  if (m.min != null && m.max != null) return `${z(m.min)}–${z(m.max)} ${m.einheit}`
  if (m.min != null) return `≥ ${z(m.min)} ${m.einheit}`
  if (m.max != null) return `≤ ${z(m.max)} ${m.einheit}`
  return ''
}

function pruefe<R extends { data: unknown; error: unknown }>(r: R): NonNullable<R['data']> {
  if (r.error) throw r.error
  if (r.data == null) throw new Error(t('Daten nicht gefunden'))
  return r.data as NonNullable<R['data']>
}

const blobZuDataUrl = (b: Blob) => new Promise<string>((ok, fehler) => {
  const r = new FileReader()
  r.onload = () => ok(r.result as string)
  r.onerror = () => fehler(r.error)
  r.readAsDataURL(b)
})

/** Foto für das PDF verkleinern (max. 900 px) – hält die Datei klein. */
async function fotoFuerPdf(b: Blob): Promise<string> {
  const bild = await createImageBitmap(b)
  const faktor = Math.min(1, 900 / Math.max(bild.width, bild.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bild.width * faktor)
  c.height = Math.round(bild.height * faktor)
  c.getContext('2d')!.drawImage(bild, 0, 0, c.width, c.height)
  bild.close()
  return c.toDataURL('image/jpeg', 0.75)
}

/**
 * Foto oder Unterschrift für das PDF (entschlüsselt). Eine fehlende Datei soll das Protokoll nicht verhindern. Eine Datei, die
 * sich nicht entschlüsseln lässt, auch bei Fotos nicht – bei einer Unterschrift aber schon: ein Protokoll, dem still eine
 * Unterschrift fehlt, wäre falsch. Ohne Schlüssel (gesperrt) wird nie ein Protokoll erzeugt.
 */
async function datei(bucket: 'fotos' | 'unterschriften', pfad: string | null | undefined, alsFoto = false): Promise<string | null> {
  if (!pfad) return null
  let blob: Blob
  try {
    blob = await holen(bucket, pfad)
  } catch (e) {
    if (e instanceof GesperrtFehler || (istDateiNichtLesbar(e) && bucket === 'unterschriften')) throw e
    return null
  }
  return alsFoto ? fotoFuerPdf(blob) : blobZuDataUrl(blob)
}

type ElementZeile = Pick<Zeile<'anlage_element'>, 'id' | 'anlage_id' | 'gruppe' | 'nummer' | 'elementart' | 'ort' | 'code' | 'aktiv' | 'zuletzt_geprueft_am' | 'eigenschaften'>

/** Woher Antworten, Mängel, Elemente, Fotos und Dateien einer Prüfung kommen: vom Server oder (Demomodus) vom Gerät. */
interface Quelle {
  antworten(pruefIds: string[]): PromiseLike<Zeile<'antwort'>[]>
  /** Mängel der Anlagen ohne verworfene */
  maengel(anlageIds: string[]): PromiseLike<Zeile<'mangel'>[]>
  elementErgebnisse(pruefIds: string[]): PromiseLike<Zeile<'element_ergebnis'>[]>
  elemente(anlageIds: string[]): PromiseLike<ElementZeile[]>
  gruppen(anlageIds: string[]): PromiseLike<(GruppeLage & { anlage_id: string })[]>
  pruefarten(ids: string[]): PromiseLike<{ id: string; name: string }[]>
  /** nach Aufnahmezeit sortiert */
  fotos(bezugIds: string[]): PromiseLike<Zeile<'foto'>[]>
  datei(bucket: 'fotos' | 'unterschriften', pfad: string | null | undefined, alsFoto?: boolean): PromiseLike<string | null>
}

const serverQuelle: Quelle = {
  antworten: (ids) => supabase.from('antwort').select('*').in('anlagenpruefung_id', ids).then(pruefe),
  maengel: (ids) => supabase.from('mangel').select('*').in('anlage_id', ids).neq('status', 'verworfen').then(pruefe),
  elementErgebnisse: (ids) => supabase.from('element_ergebnis').select('*').in('anlagenpruefung_id', ids).limit(20000).then(pruefe),
  elemente: (ids) => supabase.from('anlage_element').select('id, anlage_id, gruppe, nummer, elementart, ort, code, aktiv, zuletzt_geprueft_am, eigenschaften')
    .in('anlage_id', ids).limit(20000).then(pruefe),
  gruppen: (ids) => supabase.from('anlage_gruppe').select('anlage_id, name, gebaeude, etage').in('anlage_id', ids).limit(20000).then(pruefe),
  pruefarten: (ids) => supabase.from('pruefart').select('id, name').in('id', ids).then(pruefe),
  fotos: (ids) => supabase.from('foto').select('*').in('bezug_id', ids).order('aufgenommen_am').then(pruefe),
  datei,
}

/** Demomodus: die simulierte Prüfung liegt nur auf dem Gerät (Fotos und Unterschriften dort verschlüsselt). */
const geraetQuelle: Quelle = {
  antworten: async (ids) => entschluesseln('antwort', await db.antworten.where('anlagenpruefung_id').anyOf(ids).toArray()),
  maengel: async (ids) => entschluesseln('mangel', (await db.maengel.where('anlage_id').anyOf(ids).toArray()).filter((m) => m.status !== 'verworfen')),
  elementErgebnisse: async (ids) => entschluesseln('element_ergebnis', await db.elementErgebnisse.where('anlagenpruefung_id').anyOf(ids).toArray()),
  elemente: async (ids) => entschluesseln('anlage_element', await db.elemente.where('anlage_id').anyOf(ids).toArray()),
  gruppen: (ids) => db.gruppen.where('anlage_id').anyOf(ids).toArray(),
  pruefarten: async (ids) => (await db.pruefarten.bulkGet(ids)).filter((x) => !!x),
  fotos: (ids) => db.fotos.where('bezug_id').anyOf(ids).sortBy('aufgenommen_am'),
  datei: async (bucket, pfad, alsFoto = false) => {
    if (!pfad) return null
    const lokal = await db.dateien.filter((d) => d.bucket === bucket && d.pfad === pfad).first()
    if (!lokal) return datei(bucket, pfad, alsFoto)
    const blob = await dateiEntschluesseln(bucket, pfad, lokal.blob)
    return alsFoto ? fotoFuerPdf(blob) : blobZuDataUrl(blob)
  },
}

/** Kunden- und Objektdaten, die sich nicht entschlüsseln lassen, gehören nicht in ein Protokoll. */
function lesbarPruefen(werte: Record<string, string | null | undefined>) {
  const schlecht = Object.entries(werte).filter(([, v]) => istNichtLesbar(v)).map(([k]) => k)
  if (schlecht.length) {
    throw new Error(t('Das Protokoll kann nicht erzeugt werden: {felder} ist nicht lesbar (falscher Schlüssel oder beschädigte Daten).', { felder: schlecht.join(', ') }))
  }
}

async function logoLaden(): Promise<string | null> {
  try {
    const r = await fetch(new URL(logoPdfUrl(await erscheinungsbildLaden()), document.baseURI))
    return r.ok ? blobZuDataUrl(await r.blob()) : null
  } catch {
    return null
  }
}

/**
 * Elemente (z. B. Leuchten) einer Prüfung fürs Protokoll; Jahresübersicht bei Teilprüfungen. Mit `gruppen` (Lage der
 * Wohnungen / Bereiche) steht die Lage bei der Gruppe („WE 1 (Haus A, EG)“), sortiert nach Gebäude und Etage.
 */
export function elementeFuerProtokoll(
  art: string | null | undefined,
  pruefart: { elemente: string; elemente_zyklus_monate: number } | null,
  elemente: { id: string; gruppe: string | null; nummer: string; elementart: string | null; ort: string | null; code?: string | null; aktiv: boolean; zuletzt_geprueft_am: string | null; eigenschaften?: unknown }[],
  ergebnisse: { element_id: string; status: string; grund: string | null; bemerkung: string | null; messwerte?: unknown }[],
  stichtag: string,
  gruppen: GruppeLage[] = [],
  /** Sprache des Protokolls (Grenzwerte) */
  sprache: Sprache = 'de',
): ProtokollElemente | null {
  const def = artDefinition(art).elemente
  if (!def || !pruefart || (pruefart.elemente === 'keine' && ergebnisse.length === 0)) return null
  const [j, m, t] = stichtag.split('-').map(Number)
  const grenze = new Date(Date.UTC(j, m - 1 - pruefart.elemente_zyklus_monate, t)).toISOString().slice(0, 10)
  const aktiv = elemente.filter((e) => e.aktiv)
  const ergebnisVon = new Map(ergebnisse.map((r) => [r.element_id, r]))
  const lage = (g: string | null) => (g ? gruppen.find((x) => x.name === g) : undefined)
  const lageVergleich = (a: { gruppe: string | null }, b: { gruppe: string | null }) => {
    const x = lage(a.gruppe), y = lage(b.gruppe)
    const gx = x?.gebaeude?.trim() ?? '', gy = y?.gebaeude?.trim() ?? ''
    if (gx !== gy) return !gx ? 1 : !gy ? -1 : gx.localeCompare(gy, 'de', { numeric: true })
    return etagenRang(x?.etage) - etagenRang(y?.etage)
  }
  const geprueft = elemente.filter((e) => ergebnisVon.has(e.id)).sort((a, b) => lageVergleich(a, b) || elementVergleich(a, b))
  // Spalten der Messwert-Tabelle: Messungen der Art in ihrer Reihenfolge, soweit sie für ein geprüftes Element gelten
  const gelten = new Set(geprueft.flatMap((e) => messungenFuer(def, e).map((m) => m.schluessel)))
  const spalten = (def.messungen ?? []).filter((m) => gelten.has(m.schluessel))
  return {
    einzahl: def.einzahl, mehrzahl: def.mehrzahl, gruppe: def.gruppe, ort: def.ort ?? 'Ort',
    teilpruefung: pruefart.elemente === 'anteil', zyklusMonate: pruefart.elemente_zyklus_monate,
    gesamt: aktiv.length,
    imZyklus: aktiv.filter((e) => e.zuletzt_geprueft_am && e.zuletzt_geprueft_am >= grenze).length,
    zeilen: geprueft.map((e) => {
      const r = ergebnisVon.get(e.id)!
      const werte = messwerteLesen(r.messwerte)
      const fuerElement = new Map(messungenFuer(def, e).map((m) => [m.schluessel, m]))
      const wo = lageText(lage(e.gruppe))
      return { gruppe: e.gruppe && wo ? `${e.gruppe} (${wo})` : e.gruppe, nummer: e.nummer, art: def.arten.find((a) => a.schluessel === e.elementart)?.name ?? null, ort: e.ort,
        ...(def.codes ? { code: e.code ?? null } : {}),
        status: r.status as 'io' | 'defekt' | 'nicht_zugaenglich', grund: r.grund, bemerkung: r.bemerkung,
        ...(def.messungen ? { messwerte: Object.fromEntries(spalten.map((s) => {
          const m = fuerElement.get(s.schluessel)
          const wert = werte[s.schluessel] ?? null
          return [s.schluessel, m ? { wert, grenze: grenzeText(sprache, m), ausserhalb: wert != null && !imSoll(m, wert) } : null]
        })) } : {}) }
    }),
    ...(def.messungen ? { messungen: spalten.map((m) => ({ schluessel: m.schluessel, kurz: m.kurz, einheit: m.einheit })) } : {}),
  }
}

const PRUEFUNG_AUSWAHL = '*, pruefart(name, elemente, elemente_zyklus_monate, schliesst_ein_id), anlage(*, anlagentyp(name, anlagenart), anlage_faelligkeit(pruefart_id, naechste_pruefung_am)), checkliste_version(version, punkte, checkliste(name))'
const pruefungenAbfrage = () => supabase.from('anlagenpruefung').select(PRUEFUNG_AUSWAHL)
type PruefungZeile = NonNullable<Awaited<ReturnType<typeof pruefungenAbfrage>>['data']>[number]

type Sachkunde = (id: string, art: string | null | undefined) => string | null

/** Sachkunde je Anlagenart (sonst der allgemeine Hinweis von früher). */
async function sachkundeLaden(personen: { id: string; hinweis: string | null }[], s: Sprache): Promise<Sachkunde> {
  const sachkunden = personen.length
    ? pruefe(await supabase.from('benutzer_sachkunde').select('benutzer_id, anlagenart, nachweis, gueltig_bis').in('benutzer_id', personen.map((x) => x.id)))
    : []
  const allgemein = new Map(personen.map((x) => [x.id, x.hinweis]))
  return (id, art) => {
    const x = sachkunden.find((k) => k.benutzer_id === id && k.anlagenart === (art ?? 'tuer'))
    return x ? sachkundeText(s, x.nachweis, x.gueltig_bis) : allgemein.get(id) ?? null
  }
}

/** Antworten, Mängel, Elemente und Fotos zu den Prüfungen laden und je Anlage aufbereiten. */
async function anlagenAufbereiten(pruefungen: PruefungZeile[], o: {
  /** Stand der Elemente im Zyklus zu diesem Tag (JJJJ-MM-TT) */
  stichtag: string
  /** Mängel, die vor diesem Zeitpunkt erfasst wurden, stammen aus früheren Prüfungen */
  beginn: (p: PruefungZeile) => number
  person: (id: string, art: string | null | undefined) => ProtokollPerson
  mitpruefer: (p: PruefungZeile) => { zugelassen: string[]; entfernt: string[] }
  /** Türen einer Türanlage: je Tür die Prüfer, die an ihr erfasst haben (`geprueftVon`) */
  geprueftVon?: boolean
  /** Sprache des Protokolls */
  sprache: Sprache
}, q: Quelle = serverQuelle) {
  const pruefIds = pruefungen.map((p) => p.id)
  const anlageIds = pruefungen.map((p) => p.anlage_id)
  const [antworten, maengel, elementErgebnisse, elemente, gruppen] = await Promise.all([
    pruefIds.length ? q.antworten(pruefIds) : [],
    anlageIds.length ? q.maengel(anlageIds) : [],
    pruefIds.length ? q.elementErgebnisse(pruefIds) : [],
    anlageIds.length ? q.elemente(anlageIds) : [],
    anlageIds.length ? q.gruppen(anlageIds) : [],
  ])
  // Prüfarten, die eine Prüfung mit abdeckt (Wartung schließt Inspektion ein)
  const eingeschlossenIds = [...new Set(pruefungen.map((p) => p.pruefart?.schliesst_ein_id).filter((x): x is string => !!x))]
  const eingeschlossen = eingeschlossenIds.length ? await q.pruefarten(eingeschlossenIds) : []
  const bezugIds = [...maengel.map((m) => m.id), ...antworten.map((a) => a.id)]
  const fotos = bezugIds.length ? await q.fotos(bezugIds) : []
  const fotoUrl = new Map<string, string>()
  await Promise.all(fotos.map(async (f) => { const u = await q.datei('fotos', f.storage_pfad, true); if (u) fotoUrl.set(f.id, u) }))
  const fotosVon = (bezug: string) => fotos.filter((f) => f.bezug_id === bezug).map((f) => fotoUrl.get(f.id)).filter(Boolean) as string[]

  const anlagen: ProtokollAnlage[] = pruefungen.map((p) => {
    const t = p.anlage!
    const art = t.anlagentyp?.anlagenart
    const punkte = (p.checkliste_version?.punkte ?? []) as unknown as Punkt[]
    const punktText = (id: string | null) => (id ? punkte.find((x) => x.id === id)?.text ?? null : null)
    const alsMangel = (m: (typeof maengel)[number]): ProtokollMangel => ({
      id: m.id, stufe: m.stufe, beschreibung: m.beschreibung, punktId: m.punkt_id, punktText: punktText(m.punkt_id), status: m.status,
      festgestelltAm: m.erstellt_am, fotos: fotosVon(m.id),
    })
    const eigeneAntworten = antworten.filter((a) => a.anlagenpruefung_id === p.id)
    const mit = o.mitpruefer(p)
    const erfasser = o.geprueftVon
      ? erfasserVon(p, eigeneAntworten, maengel.filter((m) => m.entdeckt_in === p.id), elementErgebnisse.filter((r) => r.anlagenpruefung_id === p.id))
      : null
    return {
      pruefungId: p.id,
      status: p.status === 'nicht_geprueft' ? 'nicht_geprueft' : 'geprueft',
      nichtGeprueftGrund: p.nicht_geprueft_grund,
      pruefer: o.person(p.pruefer_id, art),
      schliesstEin: eingeschlossen.find((x) => x.id === p.pruefart?.schliesst_ein_id)?.name ?? null,
      mitpruefer: mit.zugelassen.map((id) => o.person(id, art)),
      beteiligt: mit.entfernt.map((id) => ({ ...o.person(id, art), unterschrift: null, unterschriebenAm: null })),
      ...(erfasser ? { geprueftVon: erfasser.map((id) => o.person(id, art)) } : {}),
      beendetAm: p.beendet_am,
      ergebnis: p.ergebnis as Ampel | null,
      ergebnisAuto: p.ergebnis_auto as Ampel | null,
      ergebnisBegruendung: p.ergebnis_begruendung,
      urspruenglicherPruefer: p.urspruenglicher_pruefer_id ? o.person(p.urspruenglicher_pruefer_id, art) : null,
      anlage: {
        etikett: t.etikett_id, bezeichnung: t.kunden_bezeichnung, gebaeude: t.gebaeude, etage: t.etage, raum: t.raum,
        lage: t.lage_beschreibung, typ: t.anlagentyp?.name ?? '–', hersteller: t.hersteller, modell: t.modell, baujahr: t.baujahr,
        art: artDefinition(art).einzahl,
        anlagendaten: artDefinition(art).felder
          .map((f) => ({ text: f.text, wert: feldWert(o.sprache, f, (t.eigenschaften as Eigenschaften)[f.schluessel]) })),
        pruefart: p.pruefart && p.pruefart.name !== STANDARD_PRUEFART ? p.pruefart.name : null,
        naechstePruefung: t.anlage_faelligkeit.find((f) => f.pruefart_id === p.pruefart_id)?.naechste_pruefung_am ?? null,
        protokollTitel: artDefinition(art).protokoll,
        bestand: !!artDefinition(art).bestand,
      },
      elemente: elementeFuerProtokoll(art, p.pruefart, elemente.filter((e) => e.anlage_id === t.id),
        elementErgebnisse.filter((r) => r.anlagenpruefung_id === p.id), o.stichtag, gruppen.filter((g) => g.anlage_id === t.id), o.sprache),
      checkliste: p.checkliste_version
        ? { name: p.checkliste_version.checkliste?.name ?? tIn(o.sprache, 'Checkliste'), version: p.checkliste_version.version, punkte }
        : null,
      antworten: Object.fromEntries(eigeneAntworten.map((a) => [a.punkt_id, { status: a.status, zahl: a.zahl, text: a.text, bemerkung: a.bemerkung }])),
      fotosJePunkt: Object.fromEntries(eigeneAntworten.map((a) => [a.punkt_id, fotosVon(a.id)])),
      neueMaengel: maengel.filter((m) => m.entdeckt_in === p.id).map(alsMangel),
      altMaengel: maengel
        .filter((m) => m.anlage_id === p.anlage_id && !pruefIds.includes(m.entdeckt_in) && new Date(m.erstellt_am).getTime() < o.beginn(p))
        .filter((m) => m.nachgeprueft_in === p.id || m.status === 'offen' || m.status === 'behoben')
        .map((m) => ({ ...alsMangel(m), behoben: m.nachgeprueft_in === p.id })),
    }
  })

  // QR-Codes: Etikett der Anlage und Code jedes Melders (führen in der App direkt zur Anlage bzw. zum Melder)
  // Die Melder-QR-Codes sind klein gedruckt: niedrige Fehlerkorrektur (L) hält sie grobkörnig und gut scanbar
  const qr = (inhalt: string, stufe: 'L' | 'M' = 'M') => QRCode.toDataURL(inhalt, { margin: 1, errorCorrectionLevel: stufe, width: 200 })
  await Promise.all(anlagen.flatMap((t) => [
    ...(t.anlage.etikett ? [qr(qrInhalt(DIREKTE_ADRESSE, t.anlage.etikett, eigenerMandantencode())).then((u) => { t.anlage.etikettQr = u })] : []),
    ...(t.elemente?.zeilen ?? []).filter((z) => z.code).map((z) => qr(melderQrInhalt(DIREKTE_ADRESSE, z.code!, eigenerMandantencode()), 'L').then((u) => { z.codeQr = u })),
  ]))

  // Sortierung wie in der Türliste: Gebäude, Etage, Bezeichnung
  anlagen.sort((a, b) => anlageVergleich(a.anlage, b.anlage))
  return { anlagen, antworten, maengel, elemente }
}

/**
 * Wer an einer Tür einer Türanlage erfasst hat (`erfasst_von` an Antworten, Mängeln und Elementergebnissen; seine Unterschrift
 * deckt den Eintrag). Die Teilprüfung trägt immer den Hauptprüfer – er steht vorn, falls er selbst erfasst hat. Ohne Einträge
 * (oder ältere ohne Erfasser) gilt der Prüfer der Teilprüfung.
 */
export function erfasserVon(p: { pruefer_id: string }, ...eintraege: { erfasst_von: string | null }[][]): string[] {
  const ids = [...new Set(eintraege.flat().map((e) => e.erfasst_von ?? p.pruefer_id))]
  if (!ids.length) return [p.pruefer_id]
  return ids.includes(p.pruefer_id) ? [p.pruefer_id, ...ids.filter((x) => x !== p.pruefer_id)] : ids
}

const kundeDaten = (k: { name: string; strasse: string | null; plz: string | null; ort: string | null; ansprechpartner: string | null }) =>
  ({ name: k.name, strasse: k.strasse, plz: k.plz, ort: k.ort, ansprechpartner: k.ansprechpartner })
const begriffeFuer = (anlagen: ProtokollAnlage[]) =>
  anlagen.every((a) => a.anlage.art === 'Tür') ? { einzahl: 'Tür', mehrzahl: 'Türen' } : { einzahl: 'Anlage', mehrzahl: 'Anlagen' }

/** Sammel- und Einzelprotokolle einer Session (Prüfungen aus der Zeit vor „Prüfung je Anlage“). */
export async function protokollDatenLaden(sessionId: string): Promise<ProtokollDaten> {
  const session = pruefe(await entschluesselt('session', supabase.from('session').select('*').eq('id', sessionId).single()))
  if (session.status !== 'abgeschlossen' || !session.protokoll_nr || !session.abgeschlossen_am) {
    throw new Error(t('Protokolle gibt es erst nach dem Abschluss der Prüfung.'))
  }
  const [objekt, firma, teilnehmerZeilen, pruefungen, revisionen, logo] = await Promise.all([
    entschluesselt('objekt', supabase.from('objekt').select('*, endkunde(*)').eq('id', session.objekt_id).single()).then(pruefe),
    supabase.from('firma').select('*').single().then(pruefe),
    supabase.from('session_teilnehmer').select('*, benutzer(id, name, sachkunde_hinweis)').eq('session_id', sessionId).then(pruefe),
    entschluesselt('anlagenpruefung', pruefungenAbfrage().eq('session_id', sessionId).neq('status', 'duplikat')).then(pruefe),
    supabase.from('session_revision').select('revision, grund, am, benutzer(name)').eq('session_id', sessionId).order('revision').then(pruefe),
    logoLaden(),
  ])
  const sp = protokollSprache(firma)
  const pruefIds = pruefungen.map((p) => p.id)
  const [sachkundeFuer, mitpruefer] = await Promise.all([
    sachkundeLaden(teilnehmerZeilen.map((t) => ({ id: t.benutzer_id, hinweis: t.benutzer?.sachkunde_hinweis ?? null })), sp),
    pruefIds.length ? supabase.from('anlagenpruefung_mitpruefer').select('anlagenpruefung_id, benutzer_id').in('anlagenpruefung_id', pruefIds).eq('status', 'zugelassen').then(pruefe) : [],
  ])

  // Personen mit Unterschrift
  const personen = new Map<string, ProtokollPerson>()
  await Promise.all(teilnehmerZeilen.map(async (t) => {
    personen.set(t.benutzer_id, {
      id: t.benutzer_id, name: t.benutzer?.name ?? tIn(sp, 'Prüfer'), sachkunde: t.benutzer?.sachkunde_hinweis ?? null,
      unterschrift: await datei('unterschriften', t.unterschrift),
    })
  }))
  const person = (id: string): ProtokollPerson => personen.get(id) ?? { id, name: tIn(sp, 'Prüfer'), sachkunde: null, unterschrift: null }
  const sessionBeginn = new Date(session.begonnen_am).getTime()
  const { anlagen } = await anlagenAufbereiten(pruefungen, {
    stichtag: session.abgeschlossen_am.slice(0, 10),
    beginn: () => sessionBeginn,
    person: (id, art) => ({ ...person(id), sachkunde: sachkundeFuer(id, art) }),
    mitpruefer: (p) => ({ zugelassen: mitpruefer.filter((m) => m.anlagenpruefung_id === p.id).map((m) => m.benutzer_id), entfernt: [] }),
    sprache: sp,
  })
  // Sachkunde der Teilnehmer für alle Anlagenarten der Session
  const artenDerSession = [...new Set(pruefungen.map((p) => p.anlage?.anlagentyp?.anlagenart ?? 'tuer'))]
  for (const [id, pe] of personen) {
    const texte = [...new Set(artenDerSession.map((a) => sachkundeFuer(id, a)).filter((x): x is string => !!x))]
    personen.set(id, { ...pe, sachkunde: texte.length ? texte.join('; ') : null })
  }

  lesbarPruefen({ [t('Kundenname')]: objekt.endkunde?.name, [t('Objektname')]: objekt.name, [t('Name des Unterzeichners')]: session.kunde_name })
  return {
    firma, logo,
    protokollNr: session.protokoll_nr, revision: session.revision,
    revisionen: revisionen.map((r) => ({ revision: r.revision, grund: r.grund, am: r.am, von: r.benutzer?.name ?? tIn(sp, 'Admin') })),
    kunde: kundeDaten(objekt.endkunde!),
    objekt: { name: objekt.name, strasse: objekt.strasse, plz: objekt.plz, ort: objekt.ort },
    begonnenAm: session.begonnen_am, abgeschlossenAm: session.abgeschlossen_am,
    leiter: person(session.leiter_id),
    teilnehmer: teilnehmerZeilen.map((t) => person(t.benutzer_id)),
    bemerkung: session.bemerkung, kundeName: session.kunde_name,
    unterschriftLeiter: await datei('unterschriften', session.unterschrift_leiter),
    unterschriftKunde: await datei('unterschriften', session.unterschrift_kunde),
    anlagen,
    begriffe: begriffeFuer(anlagen),
  }
}

/**
 * Protokoll einer Prüfung (ohne Session) in ihrer aktuellen Revision – mit allen gültigen Unterschriften.
 * Bei einer Türanlage sind die geprüften und nicht geprüften Türen (Teilprüfungen) die `anlagen`, die Türanlage steht in `tueranlage`.
 */
export async function pruefprotokollDatenLaden(pruefungId: string): Promise<ProtokollDaten> {
  const p = pruefe(await entschluesselt('anlagenpruefung', pruefungenAbfrage().eq('id', pruefungId).single()))
  if (p.session_id || p.status !== 'geprueft' || !p.abgeschlossen_am || !p.protokoll_nr) {
    throw new Error(t('Ein Protokoll gibt es erst nach dem Abschluss der Prüfung.'))
  }
  const istTueranlage = !!artDefinition(p.anlage?.anlagentyp?.anlagenart).tueren
  const teile = istTueranlage
    ? pruefe(await entschluesselt('anlagenpruefung', pruefungenAbfrage().eq('teil_von_id', p.id).neq('status', 'duplikat').in('status', ['geprueft', 'nicht_geprueft'])))
    : []
  const [objekt, firma, mitpruefer, revisionen, aenderungen, logo] = await Promise.all([
    entschluesselt('objekt', supabase.from('objekt').select('*, endkunde(*)').eq('id', p.anlage!.objekt_id).single()).then(pruefe),
    supabase.from('firma').select('*').single().then(pruefe),
    supabase.from('anlagenpruefung_mitpruefer').select('benutzer_id, status, unterschrift, fertig_am')
      .eq('anlagenpruefung_id', p.id).in('status', ['zugelassen', 'entfernt']).order('angefragt_am').then(pruefe),
    supabase.from('anlagenpruefung_revision').select('revision, grund, am, benutzer(name)').eq('anlagenpruefung_id', p.id).order('revision').then(pruefe),
    p.revision > 0
      ? supabase.from('anlagenpruefung_aenderung').select('tabelle, datensatz_id, aktion, alt, neu, von, am')
        .eq('anlagenpruefung_id', p.id).eq('revision', p.revision).order('am').limit(5000).then(pruefe)
      : [],
    logoLaden(),
  ])
  // Türanlage: auch wer an einer Tür erfasst hat, steht mit Namen im Protokoll
  const erfasser = istTueranlage && teile.length ? await erfasserLaden(teile.map((t) => t.id)) : []
  const ids = [...new Set([p.pruefer_id, ...mitpruefer.map((m) => m.benutzer_id), ...aenderungen.map((a) => a.von).filter((x): x is string => !!x), ...erfasser])]
  const benutzer = pruefe(await supabase.from('benutzer').select('id, name, sachkunde_hinweis').in('id', ids))
  return pruefprotokollZusammenstellen({ p: p as typeof p & { abgeschlossen_am: string; protokoll_nr: string }, teile, objekt, firma, mitpruefer, revisionen, aenderungen, logo, benutzer }, serverQuelle)
}

type Mitpruefer = Pick<Zeile<'anlagenpruefung_mitpruefer'>, 'benutzer_id' | 'status' | 'unterschrift' | 'fertig_am'>
type Objekt = Zeile<'objekt'> & { endkunde: Zeile<'endkunde'> | null }

/** Protokolldaten einer Prüfung aus den geladenen Zeilen (Server oder Gerät); Antworten, Mängel usw. kommen aus `q`. */
async function pruefprotokollZusammenstellen(x: {
  p: PruefungZeile & { abgeschlossen_am: string; protokoll_nr: string }
  teile: PruefungZeile[]
  objekt: Objekt
  firma: ProtokollDaten['firma']
  mitpruefer: Mitpruefer[]
  revisionen: { revision: number; grund: string; am: string; benutzer: { name: string } | null }[]
  aenderungen: Parameters<typeof aenderungenZusammenfassen>[0]
  logo: string | null
  benutzer: { id: string; name: string; sachkunde_hinweis: string | null }[]
}, q: Quelle): Promise<ProtokollDaten> {
  const { p, teile, objekt, firma, mitpruefer, revisionen, aenderungen, logo, benutzer } = x
  const sp = protokollSprache(firma)
  const istTueranlage = !!artDefinition(p.anlage?.anlagentyp?.anlagenart).tueren
  const sachkundeFuer = await sachkundeLaden(benutzer.map((b) => ({ id: b.id, hinweis: b.sachkunde_hinweis })), sp)
  // Nur gültige Unterschriften: Hauptprüfer mit unterschrift_am, Mitprüfer mit Fertigmeldung
  const unterschriften = new Map<string, { pfad: string | null; am: string | null }>([
    [p.pruefer_id, { pfad: p.unterschrift_am ? p.unterschrift : null, am: p.unterschrift_am }],
    ...mitpruefer.map((m) => [m.benutzer_id, { pfad: m.status === 'zugelassen' && m.fertig_am ? m.unterschrift : null, am: m.fertig_am }] as const),
  ])
  const bilder = new Map<string, string | null>()
  await Promise.all([...unterschriften].map(async ([id, u]) => { bilder.set(id, await q.datei('unterschriften', u.pfad)) }))
  const name = (id: string) => benutzer.find((b) => b.id === id)?.name ?? tIn(sp, 'Prüfer')
  const person = (id: string, art: string | null | undefined): ProtokollPerson => ({
    id, name: name(id), sachkunde: sachkundeFuer(id, art), unterschrift: bilder.get(id) ?? null, unterschriebenAm: unterschriften.get(id)?.am ?? null,
  })
  const beginn = new Date(p.begonnen_am).getTime()
  const { anlagen, antworten, maengel, elemente } = await anlagenAufbereiten(istTueranlage ? teile : [p], {
    stichtag: p.abgeschlossen_am.slice(0, 10),
    beginn: () => beginn,
    person,
    mitpruefer: () => ({
      zugelassen: mitpruefer.filter((m) => m.status === 'zugelassen').map((m) => m.benutzer_id),
      entfernt: mitpruefer.filter((m) => m.status === 'entfernt').map((m) => m.benutzer_id),
    }),
    geprueftVon: istTueranlage,
    sprache: sp,
  }, q)
  const art = p.anlage?.anlagentyp?.anlagenart
  const kundeGueltig = !!p.kunde_unterschrift_am && !!p.kunde_unterschrift
  lesbarPruefen({ [t('Kundenname')]: objekt.endkunde?.name, [t('Objektname')]: objekt.name, ...(kundeGueltig ? { [t('Name des Unterzeichners')]: p.kunde_name } : {}) })
  const hauptpruefer = person(p.pruefer_id, art)
  const tueranlage = istTueranlage ? tueranlageFuerProtokoll(p, objekt.name, {
    pruefer: hauptpruefer,
    mitpruefer: mitpruefer.filter((m) => m.status === 'zugelassen').map((m) => person(m.benutzer_id, art)),
    beteiligt: mitpruefer.filter((m) => m.status === 'entfernt').map((m) => ({ ...person(m.benutzer_id, art), unterschrift: null, unterschriebenAm: null })),
  }) : undefined
  // Türanlage: Prüfpunkte aller Checklisten der Türen und der Name der Tür je Teilprüfung (für die Änderungen)
  const punkte = istTueranlage ? teile.flatMap((t) => (t.checkliste_version?.punkte ?? []) as unknown as Punkt[]) : p.checkliste_version?.punkte
  const tueren = istTueranlage ? new Map(anlagen.map((a) => [a.pruefungId, [a.anlage.etikett ?? tIn(sp, 'ohne Etikett'), a.anlage.bezeichnung].filter(Boolean).join(' · ')])) : undefined

  return {
    firma, logo,
    protokollNr: p.protokoll_nr, revision: p.revision,
    revisionen: revisionen.map((r) => ({ revision: r.revision, grund: r.grund, am: r.am, von: r.benutzer?.name ?? tIn(sp, 'Admin') })),
    kunde: kundeDaten(objekt.endkunde!),
    objekt: { name: objekt.name, strasse: objekt.strasse, plz: objekt.plz, ort: objekt.ort },
    begonnenAm: p.begonnen_am, abgeschlossenAm: p.abgeschlossen_am,
    leiter: hauptpruefer,
    teilnehmer: [hauptpruefer, ...(tueranlage?.mitpruefer ?? anlagen[0]?.mitpruefer ?? [])],
    bemerkung: null,
    kundeName: kundeGueltig ? p.kunde_name : null,
    unterschriftLeiter: hauptpruefer.unterschrift,
    unterschriftKunde: kundeGueltig ? await q.datei('unterschriften', p.kunde_unterschrift) : null,
    anlagen,
    aenderungen: aenderungenZusammenfassen(aenderungen,
      aenderungKontext({ punkte, art: istTueranlage ? 'tuer' : art, elemente, maengel, antworten, benutzer, tueren }), sp),
    begriffe: begriffeFuer(anlagen),
    tueranlage,
  }
}

/**
 * Demomodus: Protokoll einer simulierten Prüfung, die nur auf dem Gerät liegt (Prüfung, Antworten, Mängel, Fotos und
 * Unterschriften aus dem Gerätespeicher). Firma, Logo, Sachkunde und Checklistenname liest es vom Server – Lesen ist erlaubt.
 */
export async function pruefprotokollDatenLokal(pruefungId: string): Promise<ProtokollDaten> {
  const roh = await db.pruefungen.get(pruefungId)
  if (!roh || roh.session_id || roh.status !== 'geprueft' || !roh.abgeschlossen_am || !roh.protokoll_nr) {
    throw new Error(t('Ein Protokoll gibt es erst nach dem Abschluss der Prüfung.'))
  }
  const checklisten = new Map<string, string>()
  /** Zeile des Geräts in der Form der Serverabfrage (PRUEFUNG_AUSWAHL) */
  const zeile = async (q: Pruefung): Promise<PruefungZeile> => {
    const [p, pruefart, anlage, version] = await Promise.all([
      entschluesseln('anlagenpruefung', q), db.pruefarten.get(q.pruefart_id),
      db.anlagen.get(q.anlage_id).then((a) => entschluesseln('anlage', a!)),
      q.checkliste_version_id ? db.versionen.get(q.checkliste_version_id) : undefined,
    ])
    const typ = await db.anlagentypen.get(anlage.anlagentyp_id)
    if (version && !checklisten.has(version.checkliste_id)) {
      const { data } = await supabase.from('checkliste').select('name').eq('id', version.checkliste_id).maybeSingle()
      checklisten.set(version.checkliste_id, data?.name ?? 'Checkliste')
    }
    return {
      ...p,
      pruefart: pruefart ? { name: pruefart.name, elemente: pruefart.elemente, elemente_zyklus_monate: pruefart.elemente_zyklus_monate, schliesst_ein_id: pruefart.schliesst_ein_id } : null,
      // Die nächste Fälligkeit berechnet erst der Server
      anlage: { ...anlage, anlagentyp: typ ? { name: typ.name, anlagenart: typ.anlagenart } : null, anlage_faelligkeit: [] },
      checkliste_version: version ? { version: version.version, punkte: version.punkte, checkliste: { name: checklisten.get(version.checkliste_id)! } } : null,
    } as unknown as PruefungZeile
  }
  const p = await zeile(roh)
  const teile = artDefinition(p.anlage?.anlagentyp?.anlagenart).tueren
    ? await Promise.all((await db.pruefungen.where('teil_von_id').equals(p.id).filter((t) => t.status === 'geprueft' || t.status === 'nicht_geprueft').toArray()).map(zeile))
    : []
  const objektRoh = await entschluesseln('objekt', (await db.objekte.get(p.anlage!.objekt_id))!)
  const endkunde = objektRoh.endkunde_id ? await entschluesseln('endkunde', (await db.kunden.get(objektRoh.endkunde_id)) ?? null) : null
  const mitpruefer = (await db.mitpruefer.where('anlagenpruefung_id').equals(p.id).toArray()).filter((m) => m.status === 'zugelassen' || m.status === 'entfernt')
  const erfasser = teile.length ? [...await geraetQuelle.antworten(teile.map((t) => t.id)), ...(await geraetQuelle.maengel(teile.map((t) => t.anlage_id))).filter((m) => teile.some((t) => t.id === m.entdeckt_in)),
    ...await geraetQuelle.elementErgebnisse(teile.map((t) => t.id))].map((e) => e.erfasst_von).filter((x): x is string => !!x) : []
  const ids = [...new Set([p.pruefer_id, ...mitpruefer.map((m) => m.benutzer_id), ...erfasser])]
  const benutzer = (await db.benutzer.bulkGet(ids)).map((b, i) => ({ id: ids[i], name: b?.name ?? 'Prüfer', sachkunde_hinweis: b?.sachkunde_hinweis ?? null }))
  const [firma, logo] = await Promise.all([supabase.from('firma').select('*').single().then(pruefe), logoLaden()])
  return pruefprotokollZusammenstellen({
    p: p as typeof p & { abgeschlossen_am: string; protokoll_nr: string }, teile, objekt: { ...objektRoh, endkunde }, firma, mitpruefer,
    revisionen: [], aenderungen: [], logo, benutzer,
  }, geraetQuelle)
}

/** Alle, die an den Teilprüfungen erfasst haben (für ihre Namen). */
async function erfasserLaden(pruefIds: string[]): Promise<string[]> {
  const [a, m, e] = await Promise.all([
    supabase.from('antwort').select('erfasst_von').in('anlagenpruefung_id', pruefIds).not('erfasst_von', 'is', null).then(pruefe),
    supabase.from('mangel').select('erfasst_von').in('entdeckt_in', pruefIds).not('erfasst_von', 'is', null).then(pruefe),
    supabase.from('element_ergebnis').select('erfasst_von').in('anlagenpruefung_id', pruefIds).not('erfasst_von', 'is', null).limit(20000).then(pruefe),
  ])
  return [...new Set([...a, ...m, ...e].map((x) => x.erfasst_von!))]
}

/** Name, Ergebnis und Personen der Türanlage fürs Protokoll (ihre Türen kommen aus `anlagenAufbereiten`). */
function tueranlageFuerProtokoll(p: PruefungZeile, objektName: string, personen: Pick<ProtokollTueranlage, 'pruefer' | 'mitpruefer' | 'beteiligt'>): ProtokollTueranlage {
  return {
    // Deutsch wie in src/lib/tueranlage.ts; das PDF übersetzt das Wort „Türanlage“
    name: objektName ? `Türanlage ${objektName}` : 'Türanlage',
    pruefart: p.pruefart && p.pruefart.name !== STANDARD_PRUEFART ? p.pruefart.name : null,
    ergebnis: p.ergebnis as Ampel | null, ergebnisAuto: p.ergebnis_auto as Ampel | null, ergebnisBegruendung: p.ergebnis_begruendung,
    ...personen,
  }
}

/** Bezüge, mit denen die Änderungen lesbar werden (Prüfpunkte, Elemente, Mängel, Antworten, Namen). */
function aenderungKontext(x: {
  punkte: unknown
  art: string | null | undefined
  elemente: { id: string; gruppe: string | null; nummer: string }[]
  maengel: { id: string; beschreibung: string; entdeckt_in?: string }[]
  antworten: { id: string; punkt_id: string; anlagenpruefung_id?: string }[]
  benutzer: { id: string; name: string }[]
  tueren?: Map<string, string>
}): AenderungKontext {
  return {
    punkte: (x.punkte ?? []) as Punkt[],
    elemente: new Map(x.elemente.map((e) => [e.id, { gruppe: e.gruppe, nummer: e.nummer }])),
    // deutsch; aenderungenZusammenfassen übersetzt in die Sprache des Protokolls bzw. der Oberfläche
    elementEinzahl: artDefinition(x.art).elemente?.einzahl ?? 'Element',
    maengel: new Map(x.maengel.map((m) => [m.id, { beschreibung: m.beschreibung, entdeckt_in: m.entdeckt_in }])),
    antworten: new Map(x.antworten.map((a) => [a.id, { punkt_id: a.punkt_id, anlagenpruefung_id: a.anlagenpruefung_id }])),
    personen: new Map(x.benutzer.map((b) => [b.id, b.name])),
    tueren: x.tueren,
  }
}

/** Änderungen aller Revisionen einer Prüfung (vom Server), je Revision zusammengefasst. */
export async function aenderungenLaden(pruefungId: string): Promise<Map<number, ProtokollAenderung[]>> {
  const zeilen = pruefe(await supabase.from('anlagenpruefung_aenderung').select('revision, tabelle, datensatz_id, aktion, alt, neu, von, am')
    .eq('anlagenpruefung_id', pruefungId).order('am').limit(5000))
  if (!zeilen.length) return new Map()
  const p = pruefe(await supabase.from('anlagenpruefung').select('anlage_id, anlage(anlagentyp(anlagenart)), checkliste_version(punkte)').eq('id', pruefungId).single())
  // Türanlage: die Änderungen betreffen ihre Türen (Teilprüfungen)
  const teile = artDefinition(p.anlage?.anlagentyp?.anlagenart).tueren
    ? pruefe(await supabase.from('anlagenpruefung').select('id, anlage_id, anlage(etikett_id, kunden_bezeichnung), checkliste_version(punkte)').eq('teil_von_id', pruefungId))
    : []
  const anlageIds = teile.length ? teile.map((t) => t.anlage_id) : [p.anlage_id]
  const pruefIds = teile.length ? teile.map((t) => t.id) : [pruefungId]
  const personen = [...new Set(zeilen.map((z) => z.von).filter((x): x is string => !!x))]
  const [elemente, maengel, antworten, benutzer] = await Promise.all([
    supabase.from('anlage_element').select('id, gruppe, nummer').in('anlage_id', anlageIds).limit(20000).then(pruefe),
    supabase.from('mangel').select('id, beschreibung, entdeckt_in').in('anlage_id', anlageIds).then(pruefe),
    supabase.from('antwort').select('id, punkt_id, anlagenpruefung_id').in('anlagenpruefung_id', pruefIds).then(pruefe),
    personen.length ? supabase.from('benutzer').select('id, name').in('id', personen).then(pruefe) : [],
  ])
  const k = aenderungKontext({
    punkte: teile.length ? teile.flatMap((t) => (t.checkliste_version?.punkte ?? []) as unknown as Punkt[]) : p.checkliste_version?.punkte,
    art: teile.length ? 'tuer' : p.anlage?.anlagentyp?.anlagenart, elemente, maengel, antworten, benutzer,
    tueren: teile.length ? new Map(teile.map((x) => [x.id, [x.anlage?.etikett_id ?? t('ohne Etikett'), x.anlage?.kunden_bezeichnung].filter(Boolean).join(' · ')])) : undefined,
  })
  const je = new Map<number, ProtokollAenderung[]>()
  for (const r of [...new Set(zeilen.map((z) => z.revision))]) {
    je.set(r, aenderungenZusammenfassen(zeilen.filter((z) => z.revision === r), k, sprache()))
  }
  return je
}
