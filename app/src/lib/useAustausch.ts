import { useMemo, useState } from 'react'
import { austauschGrenze, austauschStatus, austauschZaehlen, type AustauschStatus, type AustauschZaehler } from './austausch'
import { supabase } from './supabase'
import { entschluesselt } from './entschluesselt'
import { useAbfrage } from './useAbfrage'

export interface AustauschMelder {
  id: string
  anlage_id: string
  nummer: string
  gruppe: string | null
  ort: string | null
  /** Austauschdatum (Monatsletzter) */
  austausch: string
  status: Exclude<AustauschStatus, 'ok'>
  anlage: { id: string; kunden_bezeichnung: string | null; etikett_id: string | null; objekt: { id: string; name: string; ort: string | null; endkunde: { name: string } | null } }
}

type Roh = Omit<AustauschMelder, 'austausch' | 'status'> & { eigenschaften: { austausch?: string } | null }

/**
 * Melder, deren Austauschdatum erreicht ist oder innerhalb der nächsten 6 Monate liegt (aktive Melder aktiver Anlagen).
 * Für Hinweise in Listen (`jeAnlage`) und die Fälligkeitsübersicht (`melder`). Fehler werden gemeldet, stören die Listen aber nicht.
 */
export function useAustausch() {
  const [{ heute, grenze }] = useState(() => {
    const h = new Date().toISOString().slice(0, 10)
    return { heute: h, grenze: austauschGrenze(h) }
  })
  const abfrage = useAbfrage(() => entschluesselt('anlage_element', supabase.from('anlage_element')
    .select('id, anlage_id, nummer, gruppe, ort, eigenschaften, anlage!inner(id, kunden_bezeichnung, etikett_id, status, objekt!inner(id, name, ort, aktiv, endkunde!inner(id, name, aktiv)))')
    .eq('aktiv', true).eq('anlage.status', 'aktiv').eq('anlage.objekt.aktiv', true).eq('anlage.objekt.endkunde.aktiv', true)
    .lte('eigenschaften->>austausch', grenze).limit(5000)), [grenze])

  const melder = useMemo(() => ((abfrage.daten ?? []) as unknown as Roh[]).flatMap((r): AustauschMelder[] => {
    const status = austauschStatus(r.eigenschaften?.austausch, heute)
    return status === 'ok' ? [] : [{ id: r.id, anlage_id: r.anlage_id, nummer: r.nummer, gruppe: r.gruppe, ort: r.ort, anlage: r.anlage,
      austausch: r.eigenschaften!.austausch!, status }]
  }).sort((a, b) => a.austausch.localeCompare(b.austausch) || a.nummer.localeCompare(b.nummer, 'de', { numeric: true })), [abfrage.daten, heute])

  const jeAnlage = useMemo(() => {
    const m = new Map<string, AustauschZaehler>()
    for (const x of melder) {
      const z = m.get(x.anlage_id) ?? austauschZaehlen([], heute)
      z[x.status]++
      m.set(x.anlage_id, z)
    }
    return m
  }, [melder, heute])

  /** Je Anlage die betroffenen Melder, die Anlage mit dem frühesten Austauschdatum zuerst. */
  const gruppen = useMemo(() => {
    const m = new Map<string, { anlage: AustauschMelder['anlage']; melder: AustauschMelder[]; zaehler: AustauschZaehler }>()
    for (const x of melder) {
      const g = m.get(x.anlage_id) ?? { anlage: x.anlage, melder: [], zaehler: jeAnlage.get(x.anlage_id)! }
      g.melder.push(x)
      m.set(x.anlage_id, g)
    }
    return [...m.values()]
  }, [melder, jeAnlage])

  return { melder, jeAnlage, gruppen, heute, laedt: abfrage.laedt, fehler: abfrage.fehler }
}
