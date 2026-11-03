// Baumsicht auf die flache Punktliste einer Checkliste (checkliste_version.punkte).
// Gespeichert wird weiterhin die flache Liste mit `nur_wenn`; der Baum ist nur die Darstellung im Editor:
// Abschnitt → Punkte → Zweige je Antwort → Unterpunkte. Ein Unterpunkt steht immer im Abschnitt seines Elternpunkts
// (Punkte mit Bezug auf einen anderen Abschnitt erscheinen als eigene Wurzel mit Bedingungs-Badge).
import { alleBezuege, bezugsIds, istGruppe, ohneBezugAuf, zweigBedingung, zweigeVon, type Bedingung, type Punkt } from './checkliste'
import { t } from './sprache'

export interface Knoten {
  punkt: Punkt
  kinder: Knoten[]
}

export interface BaumAbschnitt {
  name: string
  wurzeln: Knoten[]
}

/** Ablageort: im Abschnitt (oder unter `eltern` im Zweig `wert`), vor dem Punkt `vor` (null = ans Ende). */
export interface Ziel {
  abschnitt: string
  eltern?: { id: string; wert: string | null }
  vor: string | null
}

export type Ergebnis = { punkte: Punkt[] } | { fehler: string }

/** In welchem Zweig des Elternpunkts steht der Unterpunkt? null = Sonderfall (z. B. „ist eines von“, Gruppen, Zahlen). */
export function zweigWert(kind: Punkt, eltern: Punkt): string | null {
  const b = kind.nur_wenn
  if (!b || istGruppe(b)) return null
  const schluessel = zweigeVon(eltern).map((z) => z.schluessel)
  const bekannt = (w: string) => schluessel.includes(w)
  if (b.mangel !== undefined) {
    if (b.in || b.ist !== undefined || b.ist_nicht !== undefined || b.unter !== undefined || b.ueber !== undefined) return null
    const w = b.mangel ? 'mangel' : 'kein_mangel'
    return eltern.typ === 'messwert' ? w : null
  }
  if (b.unter !== undefined || b.ueber !== undefined) return null
  if (b.in) return b.in.length === 1 && bekannt(b.in[0]) && eltern.typ !== 'messwert' ? b.in[0] : null
  if (b.ist_nicht !== undefined) {
    const rest = schluessel.filter((w) => w !== b.ist_nicht)
    return eltern.typ !== 'messwert' && bekannt(b.ist_nicht) && rest.length === 1 ? rest[0] : null
  }
  return b.ist !== undefined && eltern.typ !== 'messwert' && bekannt(b.ist) ? b.ist : null
}

function zweigIndex(kind: Punkt, eltern: Punkt): number {
  const w = zweigWert(kind, eltern)
  const i = w === null ? -1 : zweigeVon(eltern).findIndex((z) => z.schluessel === w)
  return i < 0 ? Number.MAX_SAFE_INTEGER : i
}

/** Abschnitte in Reihenfolge: zuerst die angelegten (checkliste_version.abschnitte), dahinter solche, die nur an Punkten stehen. */
export function abschnittsListe(angelegt: readonly string[], punkte: Punkt[]): string[] {
  return [...new Set([...angelegt, ...punkte.map((p) => p.abschnitt)])]
}

/** `reihenfolge` = angelegte Abschnitte; sie erscheinen auch ohne Punkte. */
export function baue(punkte: Punkt[], reihenfolge: readonly string[] = []): BaumAbschnitt[] {
  const knoten = new Map<Punkt, Knoten>(punkte.map((p) => [p, { punkt: p, kinder: [] }]))
  const ersterMitId = new Map<string, Punkt>()
  for (const p of punkte) if (!ersterMitId.has(p.id)) ersterMitId.set(p.id, p)
  const abschnitte = new Map<string, BaumAbschnitt>()
  for (const name of reihenfolge) if (!abschnitte.has(name)) abschnitte.set(name, { name, wurzeln: [] })
  for (const p of punkte) if (!abschnitte.has(p.abschnitt)) abschnitte.set(p.abschnitt, { name: p.abschnitt, wurzeln: [] })

  const position = new Map<Punkt, number>(punkte.map((p, i) => [p, i]))
  const elternVon = new Map<Knoten, Knoten>()
  for (const p of punkte) {
    const k = knoten.get(p)!
    // Bei Gruppen ist der zuletzt stehende Bezugspunkt im selben Abschnitt der Elternpunkt
    const kandidaten = bezugsIds(p.nur_wenn)
      .map((id) => ersterMitId.get(id))
      .filter((e): e is Punkt => !!e && e !== p && e.abschnitt === p.abschnitt)
    const e = kandidaten.sort((x, y) => position.get(y)! - position.get(x)!)[0]
    if (e) {
      const ek = knoten.get(e)!
      ek.kinder.push(k)
      elternVon.set(k, ek)
    } else {
      abschnitte.get(p.abschnitt)!.wurzeln.push(k)
    }
  }

  // Zyklen (A hängt von B ab, B von A) hätten keine Wurzel und würden verschwinden: aufbrechen und als Wurzel zeigen
  const erreicht = new Set<Knoten>()
  const besuche = (k: Knoten) => { erreicht.add(k); k.kinder.forEach(besuche) }
  for (const a of abschnitte.values()) a.wurzeln.forEach(besuche)
  for (const p of punkte) {
    const k = knoten.get(p)!
    if (erreicht.has(k)) continue
    const e = elternVon.get(k)
    if (e) e.kinder.splice(e.kinder.indexOf(k), 1)
    abschnitte.get(p.abschnitt)!.wurzeln.push(k)
    besuche(k)
  }
  return [...abschnitte.values()]
}

/** Baum zurück in die flache Liste: Eltern vor Kindern, Kinder nach Zweig geordnet. */
export function flach(baum: BaumAbschnitt[]): Punkt[] {
  const aus: Punkt[] = []
  const raus = (k: Knoten) => {
    aus.push(k.punkt)
    ;[...k.kinder].sort((a, b) => zweigIndex(a.punkt, k.punkt) - zweigIndex(b.punkt, k.punkt)).forEach(raus)
  }
  baum.forEach((a) => a.wurzeln.forEach(raus))
  return aus
}

/** Bringt die Liste in die Reihenfolge, die der Editor zeigt (und der Prüfer später sieht). */
export function normalisiere(punkte: Punkt[], reihenfolge: readonly string[] = []): Punkt[] {
  return flach(baue(punkte, reihenfolge))
}

interface Fundstelle {
  knoten: Knoten
  liste: Knoten[]
  eltern?: Knoten
  abschnitt: BaumAbschnitt
}

function suche(baum: BaumAbschnitt[], id: string): Fundstelle | undefined {
  let fund: Fundstelle | undefined
  const durch = (liste: Knoten[], abschnitt: BaumAbschnitt, eltern?: Knoten) => {
    for (const k of liste) {
      if (!fund && k.punkt.id === id) fund = { knoten: k, liste, eltern, abschnitt }
      durch(k.kinder, abschnitt, k)
    }
  }
  for (const a of baum) durch(a.wurzeln, a)
  return fund
}

function idsImUnterbaum(k: Knoten): Set<string> {
  const ids = new Set<string>()
  const durch = (n: Knoten) => { ids.add(n.punkt.id); n.kinder.forEach(durch) }
  durch(k)
  return ids
}

/** Punkt-IDs des Punkts und aller seiner Unterpunkte. */
export function unterbaumIds(punkte: Punkt[], id: string): Set<string> {
  const f = suche(baue(punkte), id)
  return f ? idsImUnterbaum(f.knoten) : new Set()
}

function ungueltigeVerweise(punkte: Punkt[]): number {
  const gesehen = new Set<string>()
  let n = 0
  for (const p of punkte) {
    if (alleBezuege(p).some((id) => !gesehen.has(id))) n++
    gesehen.add(p.id)
  }
  return n
}

const REIHENFOLGE_FEHLER = t('Das geht nicht: Ein Punkt muss hinter dem Punkt stehen, von dem er abhängt (Bedingung).')

function pruefeReihenfolge(alt: Punkt[], neu: Punkt[]): Ergebnis {
  return ungueltigeVerweise(neu) > ungueltigeVerweise(alt) ? { fehler: REIHENFOLGE_FEHLER } : { punkte: neu }
}

/** Verschiebt einen Punkt samt Unterpunkten. Ablage in einem Zweig setzt die Bedingung, Ablage auf Abschnittsebene entfernt sie. */
export function verschiebe(punkte: Punkt[], id: string, ziel: Ziel, reihenfolge: readonly string[] = []): Ergebnis {
  if (ziel.vor === id) return { punkte }
  const baum = baue(punkte, reihenfolge)
  const hier = suche(baum, id)
  if (!hier) return { fehler: t('Prüfpunkt nicht gefunden.') }
  const k = hier.knoten
  const ids = idsImUnterbaum(k)

  let eltern: Knoten | undefined
  if (ziel.eltern) {
    if (ids.has(ziel.eltern.id)) return { fehler: t('Ein Punkt kann nicht unter seinen eigenen Unterpunkt gelegt werden.') }
    eltern = suche(baum, ziel.eltern.id)?.knoten
    if (!eltern) return { fehler: t('Zielpunkt nicht gefunden.') }
    if (ziel.eltern.wert !== null && !zweigBedingung(eltern.punkt, ziel.eltern.wert)) {
      return { fehler: t('Unter diesem Punkt sind keine Verzweigungen möglich.') }
    }
  }

  const alt = k.punkt.nur_wenn
  let bedingung: Bedingung | undefined
  if (eltern && ziel.eltern) {
    if (ziel.eltern.wert !== null) bedingung = zweigBedingung(eltern.punkt, ziel.eltern.wert)
    else if (bezugsIds(alt).includes(eltern.punkt.id)) bedingung = alt // Reihenfolge innerhalb eines Sonderfall-Zweigs ändern
    else return { fehler: t('Bitte in einen Zweig mit konkreter Antwort ablegen.') }
  } else if (alt && !hier.eltern && hier.abschnitt.name === ziel.abschnitt) {
    bedingung = alt // Bezug auf anderen Abschnitt bleibt erhalten, solange der Punkt im Abschnitt bleibt
  }

  hier.liste.splice(hier.liste.indexOf(k), 1)

  let liste: Knoten[]
  if (eltern) liste = eltern.kinder
  else {
    let a = baum.find((x) => x.name === ziel.abschnitt)
    if (!a) baum.push((a = { name: ziel.abschnitt, wurzeln: [] }))
    liste = a.wurzeln
  }
  let pos = liste.length
  if (ziel.vor !== null) {
    pos = liste.findIndex((x) => x.punkt.id === ziel.vor)
    if (pos < 0) return { fehler: t('Ablageort nicht gefunden.') }
  } else if (eltern && ziel.eltern && ziel.eltern.wert !== null) {
    const wert = ziel.eltern.wert
    const letzter = liste.findLastIndex((x) => zweigWert(x.punkt, eltern.punkt) === wert)
    if (letzter >= 0) pos = letzter + 1
  }
  liste.splice(pos, 0, k)

  const setzeAbschnitt = (n: Knoten) => { n.punkt = { ...n.punkt, abschnitt: ziel.abschnitt }; n.kinder.forEach(setzeAbschnitt) }
  setzeAbschnitt(k)
  const verschoben: Punkt = { ...k.punkt }
  if (bedingung) verschoben.nur_wenn = bedingung
  else delete verschoben.nur_wenn
  k.punkt = verschoben

  return pruefeReihenfolge(punkte, flach(baum))
}

/** Punkte und angelegte Abschnitte einer Version, so wie der Editor sie bearbeitet. */
export interface Stand {
  punkte: Punkt[]
  abschnitte: string[]
}

export type StandErgebnis = Stand | { fehler: string }

function ausBaum(alt: Punkt[], baum: BaumAbschnitt[]): StandErgebnis {
  const r = pruefeReihenfolge(alt, flach(baum))
  return 'fehler' in r ? r : { punkte: r.punkte, abschnitte: baum.map((a) => a.name) }
}

/** Verschiebt einen ganzen Abschnitt vor den Abschnitt `vor` (null = ans Ende). */
export function verschiebeAbschnitt(stand: Stand, name: string, vor: string | null): StandErgebnis {
  if (vor === name) return stand
  const baum = baue(stand.punkte, stand.abschnitte)
  const i = baum.findIndex((a) => a.name === name)
  if (i < 0) return { fehler: t('Abschnitt nicht gefunden.') }
  const [a] = baum.splice(i, 1)
  const pos = vor === null ? baum.length : baum.findIndex((x) => x.name === vor)
  if (pos < 0) return { fehler: t('Ablageort nicht gefunden.') }
  baum.splice(pos, 0, a)
  return ausBaum(stand.punkte, baum)
}

/** Legt einen leeren Abschnitt am Ende an. */
export function abschnittAnlegen(stand: Stand, name: string): StandErgebnis {
  const n = name.trim()
  if (!n) return { fehler: t('Bitte einen Namen eingeben.') }
  if (stand.abschnitte.includes(n)) return { fehler: t('Den Abschnitt „{name}“ gibt es schon.', { name: n }) }
  return { punkte: stand.punkte, abschnitte: [...stand.abschnitte, n] }
}

/** Benennt einen Abschnitt samt seinen Punkten um. */
export function abschnittUmbenennen(stand: Stand, alt: string, neu: string): StandErgebnis {
  const n = neu.trim()
  if (!n) return { fehler: t('Bitte einen Namen eingeben.') }
  if (n === alt) return stand
  if (stand.abschnitte.includes(n)) return { fehler: t('Den Abschnitt „{name}“ gibt es schon.', { name: n }) }
  return {
    punkte: stand.punkte.map((p) => (p.abschnitt === alt ? { ...p, abschnitt: n } : p)),
    abschnitte: stand.abschnitte.map((a) => (a === alt ? n : a)),
  }
}

/**
 * Entfernt einen Abschnitt. Seine Punkte wandern ans Ende des Abschnitts `ziel` oder werden mit `ziel` = null gelöscht;
 * Bezüge anderer Punkte auf gelöschte Punkte entfallen dann wie beim Löschen eines einzelnen Punkts.
 */
export function abschnittLoeschen(stand: Stand, name: string, ziel: string | null): StandErgebnis {
  if (ziel === name) return { fehler: t('Bitte einen anderen Abschnitt wählen.') }
  if (ziel !== null && !stand.abschnitte.includes(ziel)) return { fehler: t('Abschnitt nicht gefunden.') }
  const abschnitte = stand.abschnitte.filter((a) => a !== name)
  if (ziel !== null) {
    // Hinter die bisherigen Punkte des Ziels: die übrigen Punkte zuerst in Editor-Reihenfolge, die verschobenen dahinter
    const bleiben = stand.punkte.filter((p) => p.abschnitt !== name)
    const kommen = stand.punkte.filter((p) => p.abschnitt === name).map((p) => ({ ...p, abschnitt: ziel }))
    return ausBaum(stand.punkte, baue([...normalisiere(bleiben, abschnitte), ...kommen], abschnitte))
  }
  const weg = new Set(stand.punkte.filter((p) => p.abschnitt === name).map((p) => p.id))
  const punkte = stand.punkte.filter((p) => p.abschnitt !== name)
    .map((p) => [...weg].reduce(ohneBezugAuf, p))
  return { punkte: normalisiere(punkte, abschnitte), abschnitte }
}

/** Tauscht den Punkt mit seinem Nachbarn im gleichen Zweig. null = nicht möglich. */
export function tauschen(punkte: Punkt[], id: string, richtung: -1 | 1, reihenfolge: readonly string[] = []): Punkt[] | null {
  const baum = baue(punkte, reihenfolge)
  const hier = suche(baum, id)
  if (!hier) return null
  const { knoten: k, liste, eltern } = hier
  const zweig = (x: Knoten) => (eltern ? zweigWert(x.punkt, eltern.punkt) : null)
  const i = liste.indexOf(k)
  let j = i + richtung
  while (j >= 0 && j < liste.length && zweig(liste[j]) !== zweig(k)) j += richtung
  if (j < 0 || j >= liste.length) return null
  ;[liste[i], liste[j]] = [liste[j], liste[i]]
  return flach(baum)
}
