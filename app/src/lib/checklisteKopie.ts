// Checkliste duplizieren: neue Checkliste mit den Prüfpunkten und Abschnitten der freigegebenen (sonst der neuesten) Version als Entwurf v1.
import { demoSperreAktiv } from './demo'
import { simNeu, simulation } from './demoCheckliste'
import { supabase } from './supabase'

/** Legt die Kopie an und gibt ihre ID zurück. Mit `versionId` wird genau diese Version kopiert. */
export async function checklisteDuplizieren(quelleId: string, name: string, versionId?: string): Promise<string> {
  // Demomodus: Quelle darf selbst simuliert sein, die Kopie entsteht nur im Arbeitsspeicher
  const sim = demoSperreAktiv() ? simulation(quelleId) : undefined
  const { data: quelle, error } = sim?.neu
    ? { data: { beschreibung: sim.kopf?.beschreibung ?? null, checkliste_version: sim.versionen ?? [] }, error: null }
    : await supabase.from('checkliste')
      .select('beschreibung, checkliste_version(id, version, status, punkte, abschnitte)').eq('id', quelleId).single()
  if (error) throw error
  const versionen = [...(sim?.versionen ?? quelle.checkliste_version)].sort((a, b) => b.version - a.version)
  const vorlage = versionen.find((v) => v.id === versionId)
    ?? versionen.find((v) => v.status === 'freigegeben') ?? versionen[0]
  if (demoSperreAktiv()) return simNeu(name, sim?.kopf?.beschreibung ?? quelle.beschreibung, vorlage?.punkte ?? [], vorlage?.abschnitte ?? [])

  const { data: neu, error: e1 } = await supabase.from('checkliste')
    .insert({ name: name.trim(), beschreibung: quelle.beschreibung }).select('id').single()
  if (e1) throw e1
  const { error: e2 } = await supabase.from('checkliste_version').insert({
    checkliste_id: neu.id, version: 1, punkte: vorlage?.punkte ?? [], abschnitte: vorlage?.abschnitte ?? [],
  })
  if (e2) {
    await supabase.from('checkliste').delete().eq('id', neu.id)
    throw e2
  }
  return neu.id
}
