// Beispiel-Checklisten und Typen in die Datenbank übernehmen (als Entwurf – vor der Freigabe fachlich prüfen).
// Übernommen werden nur Typen der eingeschalteten Anlagenarten und die Checklisten, die sie brauchen.
import beispiele from '../../docs/checklisten/beispiel-checklisten.json'
import { STANDARD_PRUEFART } from './anlagenarten'
import { aktiveArten, tb } from './begriffe'
import type { Punkt } from './checkliste'
import { supabase } from './supabase'

type BeispielTyp = {
  id: string
  name: string
  anlagenart?: string
  kategorie?: 'fluchttuer' | 'automatiktuer' | 'sonstige'
  // Türen: eine Prüfart
  checkliste?: string
  intervall_monate?: number
  // andere Arten: mehrere Prüfarten
  pruefarten?: BeispielPruefart[]
}
// schliesst_ein: Name der Prüfart desselben Typs, die mit dieser als durchgeführt gilt (z. B. Erstinstallation → Wartung)
type BeispielPruefart = { name: string; checkliste: string; intervall_monate: number; elemente?: string; elemente_anteil?: number; elemente_zyklus_monate?: number; schliesst_ein?: string }
type Beispiele = {
  anlagentypen: BeispielTyp[]
  checklisten: { id: string; name: string; beschreibung: string; punkte: Punkt[] }[]
}

function pruefartenVon(t: BeispielTyp): BeispielPruefart[] {
  return t.pruefarten ?? [{ name: STANDARD_PRUEFART, checkliste: t.checkliste ?? '', intervall_monate: t.intervall_monate ?? 12 }]
}

export async function beispieleImportieren(): Promise<string> {
  const b = beispiele as unknown as Beispiele
  const arten = aktiveArten() as string[]
  const typen = b.anlagentypen.filter((t) => arten.includes(t.anlagenart ?? 'tuer'))
  const gebraucht = new Set(typen.flatMap((t) => pruefartenVon(t).map((p) => p.checkliste)))

  const [{ data: vorhandeneListen, error: e1 }, { data: vorhandeneTypen, error: e2 }] = await Promise.all([
    supabase.from('checkliste').select('id, name'),
    supabase.from('anlagentyp').select('name'),
  ])
  if (e1 || e2) throw e1 ?? e2
  const listenId = new Map((vorhandeneListen ?? []).map((c) => [c.name, c.id]))
  const zuordnung = new Map<string, string>()
  let listen = 0
  let neueTypen = 0

  for (const c of b.checklisten.filter((c) => gebraucht.has(c.id))) {
    const vorhanden = listenId.get(c.name)
    if (vorhanden) { zuordnung.set(c.id, vorhanden); continue }
    const { data, error } = await supabase.from('checkliste').insert({ name: c.name, beschreibung: c.beschreibung }).select('id').single()
    if (error) throw error
    const { error: ev } = await supabase.from('checkliste_version').insert({ checkliste_id: data.id, version: 1, punkte: c.punkte as never })
    if (ev) throw ev
    zuordnung.set(c.id, data.id)
    listen++
  }
  const typNamen = new Set((vorhandeneTypen ?? []).map((t) => t.name))
  for (const t of typen) {
    if (typNamen.has(t.name)) continue
    const { data, error } = await supabase.from('anlagentyp')
      .insert({ name: t.name, anlagenart: t.anlagenart ?? 'tuer', kategorie: t.kategorie ?? null }).select('id').single()
    if (error) throw error
    const pruefarten = pruefartenVon(t)
    const ids = new Map(pruefarten.map((p) => [p.name, crypto.randomUUID()]))
    const { error: ep } = await supabase.from('pruefart').insert(pruefarten.map((p, i) => ({
      id: ids.get(p.name), anlagentyp_id: data.id, name: p.name, intervall_monate: p.intervall_monate, checkliste_id: zuordnung.get(p.checkliste) ?? null, reihenfolge: i + 1,
      elemente: p.elemente ?? 'keine', elemente_anteil: p.elemente_anteil ?? null, elemente_zyklus_monate: p.elemente_zyklus_monate ?? 12,
      schliesst_ein_id: (p.schliesst_ein && ids.get(p.schliesst_ein)) || null,
    })))
    if (ep) throw ep
    neueTypen++
  }
  return listen + neueTypen === 0 ? tb('{listen} Checkliste(n) und {typen} Türtyp(en) importiert – alles war bereits vorhanden.', { listen, typen: neueTypen })
    : tb('{listen} Checkliste(n) und {typen} Türtyp(en) importiert.', { listen, typen: neueTypen })
}
