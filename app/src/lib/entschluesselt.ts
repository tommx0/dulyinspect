// Abfragen an den Server, deren Ergebnis Kunden, Objekte, Unterzeichner oder Ansprechpartner enthält (auch per Join), laufen
// durch entschluesseln() – bevor etwas in State, Sortierung oder Anzeige geht (docs/KONZEPT-VERSCHLUESSELUNG.md, Bedingung 2/4).
import { entschluesseln, type EntschluesselnOptionen } from './verschluesselung'

/**
 * Eine Supabase-Abfrage ausführen und das Ergebnis entschlüsseln. `tabelle` ist die Tabelle der obersten Ebene; in
 * eingebetteten Zeilen (`objekt(id, name, endkunde(id, name))`) muss die `id` mitselektiert sein.
 * Fehler der Abfrage bleiben, wie sie sind.
 */
export async function entschluesselt<R extends { data: unknown; error: unknown }>(
  tabelle: string, anfrage: PromiseLike<R>, optionen?: EntschluesselnOptionen,
): Promise<R> {
  const r = await anfrage
  if (r.error || r.data == null) return r
  return { ...r, data: await entschluesseln(tabelle, r.data, optionen) }
}
