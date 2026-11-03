// Anlagensuche mit verschlüsselten Kunden und Objekten (docs/KONZEPT-VERSCHLUESSELUNG.md, „Suche und Sortierung“).
// Der Server kann nicht in Namen und Adressen von Kunden und Objekten suchen. Der Browser lädt sie einmal, entschlüsselt sie, hält
// sie im Speicher und ermittelt je Suchwort die passenden Objekte. Ein Wort, das dort vorkommt, geht nicht an den Server (es wäre ein
// Kunden- oder Objektname im Klartext, sichtbar in Anfragen und Logs): `anlage_suche` bekommt nur die Liste der passenden Objekte, ohne
// das Wort, und die übrigen Wörter als Text. Jedes Wort muss weiter irgendwo vorkommen – ein solches Wort zählt dann aber nur noch über
// die Objekte, nicht zusätzlich in den Anlagenfeldern. Ausnahme: kurze Wörter (unter 3 Zeichen, z. B. „EG“) verraten keinen Namen und
// gehen weiter als Text mit, damit sie auch in den Anlagenfeldern zählen.
// Nach dem Ansprechpartner einer Anlage lässt sich nicht mehr suchen (er ist verschlüsselt).
import { entschluesselt } from './entschluesselt'
import { supabase } from './supabase'
import { QUELLEN_ANLAGE_SUCHE, aktuellerZustand, beiSchluesselwechsel, entschluesseln } from './verschluesselung'

interface Index {
  /** Stand der Tabellen (Anzahl und jüngste Änderung), neu geladen wird bei Abweichung */
  stand: string
  /** Objekt-ID → Suchtext (klein geschrieben): Name und Adresse des Objekts, Name, Adresse und Ansprechpartner des Kunden */
  objekte: { id: string; text: string }[]
}

let index: Promise<Index> | null = null
beiSchluesselwechsel(() => { index = null })

/** Index verwerfen (z. B. nach dem Ändern von Kunden oder Objekten) */
export function suchindexVerwerfen() { index = null }

async function stand(tabelle: 'objekt' | 'endkunde'): Promise<string> {
  const { data, count, error } = await supabase.from(tabelle).select('geaendert_am', { count: 'exact' }).order('geaendert_am', { ascending: false }).limit(1)
  if (error) throw error
  return `${count ?? 0}@${data?.[0]?.geaendert_am ?? ''}`
}

async function indexBauen(stnd: string): Promise<Index> {
  const [objekte, kunden] = await Promise.all([
    entschluesselt('objekt', supabase.from('objekt').select('id, endkunde_id, name, strasse, plz, ort').limit(20000)),
    entschluesselt('endkunde', supabase.from('endkunde').select('id, name, strasse, plz, ort, ansprechpartner').limit(20000)),
  ])
  if (objekte.error) throw objekte.error
  if (kunden.error) throw kunden.error
  const kundeText = new Map((kunden.data ?? []).map((k) => [k.id, [k.name, k.strasse, k.plz, k.ort, k.ansprechpartner]]))
  return {
    stand: stnd,
    objekte: (objekte.data ?? []).map((o) => ({
      id: o.id,
      text: [o.name, o.strasse, o.plz, o.ort, ...(kundeText.get(o.endkunde_id) ?? [])].filter(Boolean).join(' ').toLowerCase(),
    })),
  }
}

async function aktuellerIndex(): Promise<Index> {
  const stnd = (await Promise.all([stand('objekt'), stand('endkunde')])).join('|')
  const vorhanden = index ? await index.catch(() => null) : null
  if (vorhanden && vorhanden.stand === stnd) return vorhanden
  const neu = indexBauen(stnd)
  index = neu
  neu.catch(() => { if (index === neu) index = null })
  return neu
}

/** Suchwörter wie auf dem Server: klein geschrieben, an Leerraum getrennt */
export function suchwoerter(text: string): string[] {
  return text.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

/** Je Suchwort die IDs der Objekte, deren Name oder Adresse (oder die ihres Kunden) es enthält. Wörter ohne Treffer fehlen. */
export function objekteJeWort(objekte: Index['objekte'], woerter: string[]): Record<string, string[]> {
  const ergebnis: Record<string, string[]> = {}
  for (const w of woerter) {
    const ids = objekte.filter((o) => o.text.includes(w)).map((o) => o.id)
    if (ids.length) ergebnis[w] = ids
  }
  return ergebnis
}

/** Wörter darunter verraten keinen Namen und gehen als Text an den Server (Etagen wie „EG“, Nummern) */
export const KURZ = 3

export type ObjektListe = string[] | { w: string; ids: string[] }

/**
 * Was an anlage_suche geht: `text` nur mit Wörtern, die kein Kunde und kein Objekt enthält (und kurzen Wörtern), `objekte` je
 * getroffenem Wort die Liste der Objekte – ohne das Wort, außer bei kurzen.
 */
export function suchanfrage(text: string, objekte: Index['objekte']): { text: string; objekte: ObjektListe[] } {
  const woerter = [...new Set(suchwoerter(text))]
  const treffer = objekteJeWort(objekte, woerter)
  const rest: string[] = []
  const listen: ObjektListe[] = []
  for (const w of woerter) {
    const ids = treffer[w]
    if (!ids) rest.push(w)
    else if (w.length < KURZ) { rest.push(w); listen.push({ w, ids }) }
    else listen.push(ids)
  }
  return { text: rest.join(' '), objekte: listen }
}

export type AnlageTreffer = {
  id: string; etikett_id: string | null; kunden_bezeichnung: string | null; gebaeude: string | null; etage: string | null; raum: string | null
  lage_beschreibung: string | null; status: string; naechste_pruefung_am: string | null; anlagentyp: string; objekt_id: string
  objekt: string; objekt_ort: string | null; kunde: string
}

/**
 * Anlagen suchen (RPC `anlage_suche`). Ohne eingerichtete Verschlüsselung sucht der Server allein; sonst bekommt er die Objekte,
 * die zu den Wörtern passen, und das Ergebnis (Objekt, Ort, Kunde) wird entschlüsselt.
 */
export async function anlagenSuchen(text: string, limit = 50): Promise<{ data: AnlageTreffer[]; error: unknown }> {
  const verschluesselt = aktuellerZustand().art === 'bereit'
  let anfrage: { text: string; objekte: ObjektListe[] } = { text, objekte: [] }
  if (verschluesselt) {
    try {
      anfrage = suchanfrage(text, (await aktuellerIndex()).objekte)
    } catch (e) {
      return { data: [], error: e }
    }
  }
  const { data, error } = await supabase.rpc('anlage_suche', { p_text: anfrage.text, p_limit: limit, ...(verschluesselt ? { p_objekte: anfrage.objekte } : {}) })
  if (error) return { data: [], error }
  const treffer = await entschluesseln('anlage_suche', (data ?? []) as unknown as (AnlageTreffer & { endkunde_id?: string })[], { quellen: QUELLEN_ANLAGE_SUCHE })
  // Der Server sortiert nach Geheimtext: im Browser nach Kunde und Objekt ordnen (genaue Etikett-Treffer und aktive zuerst)
  const q = text.trim().toLowerCase()
  const rang = (t: AnlageTreffer) => (t.etikett_id?.toLowerCase() === q ? 0 : 1) * 2 + (t.status === 'aktiv' ? 0 : 1)
  treffer.sort((a, b) => rang(a) - rang(b) || (a.kunde ?? '').localeCompare(b.kunde ?? '', 'de') || (a.objekt ?? '').localeCompare(b.objekt ?? '', 'de')
    || (a.gebaeude ?? '').localeCompare(b.gebaeude ?? '', 'de') || (a.etage ?? '').localeCompare(b.etage ?? '', 'de')
    || (a.kunden_bezeichnung ?? '').localeCompare(b.kunden_bezeichnung ?? '', 'de', { numeric: true }))
  return { data: treffer, error: null }
}
