// PDFs erzeugen (im Browser), verschlüsselt und unveränderlich speichern und Prüfsumme festhalten.
// Die Prüfsumme (sha256) gilt der unverschlüsselten PDF – so lässt sich weiter belegen, dass eine an den Kunden übergebene PDF
// unverändert ist (docs/KONZEPT-VERSCHLUESSELUNG.md, „Protokoll“). Ins Server-Log gehören keine Kunden- und Objektnamen.
import type { TDocumentDefinitions } from 'pdfmake/interfaces'
import { loggen } from '../lib/log'
import { t, tIn } from '../lib/sprache'
import { supabase } from '../lib/supabase'
import { holen, holenUrl, hochladen, istVerschluesselterPfad, speicherPfad } from '../lib/verschluesselung'
import { db } from '../offline/db'
import { protokollDatenLaden, pruefprotokollDatenLaden, pruefprotokollDatenLokal } from './daten'
import { anlageName, einzelprotokoll, protokollSprache, pruefprotokoll, sammelprotokoll, tuerprotokoll, tueranlagenprotokoll } from './pdfDoc'

async function pdfBlob(doc: TDocumentDefinitions): Promise<Blob> {
  // pdfmake samt Schriften (~1 MB) erst laden, wenn wirklich ein Protokoll entsteht
  const [{ default: pdfMake }, { default: vfs }] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ])
  pdfMake.addVirtualFileSystem(vfs)
  return pdfMake.createPdf(doc).getBlob()
}

async function sha256(b: Blob): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', await b.arrayBuffer())
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

const dateiname = (s: string) => s.replace(/[^\w.-]+/g, '_')

/** PDF hochladen und eintragen; ein paralleler Versuch (Datei oder Eintrag schon da) gilt als Erfolg. */
async function pdfSpeichern(pfad: string, doc: TDocumentDefinitions, zeile: { session_id: string | null; anlagenpruefung_id: string | null; art: 'sammel' | 'einzel'; revision: number }) {
  let blob = await pdfBlob(doc)
  // Der Speicherpfad (mit „.enc“) gehört zu den Zusatzdaten der Verschlüsselung: zuerst bestimmen, dann hochladen und eintragen
  const ziel = speicherPfad(pfad)
  try {
    await hochladen('protokolle', ziel, blob)
  } catch (e) {
    if (!/exists|duplicate/i.test((e as { message?: string })?.message ?? '')) throw e
    // Ein anderer Versuch war schneller: die Prüfsumme gehört zu der Datei, die gespeichert ist (entschlüsselt)
    blob = await holen('protokolle', ziel)
  }
  const ins = await supabase.from('protokoll').insert({ ...zeile, storage_pfad: ziel, sha256: await sha256(blob) })
  if (ins.error && ins.error.code !== '23505') throw ins.error
}

/**
 * Demomodus: Protokoll einer simulierten Prüfung nur auf dem Gerät erzeugen – nicht hochladen, nicht eintragen, mit
 * Wasserzeichen. Bei einer Tür einer Türanlage das Protokoll der Türanlage. Liefert eine Blob-URL zum Öffnen.
 */
export async function demoProtokollUrl(pruefungId: string): Promise<string> {
  const id = (await db.pruefungen.get(pruefungId))?.teil_von_id ?? pruefungId
  const d = await pruefprotokollDatenLokal(id)
  const doc = d.tueranlage ? tueranlagenprotokoll(d) : pruefprotokoll(d)
  const blob = await pdfBlob({ ...doc, watermark: { text: tIn(protokollSprache(d.firma), 'DEMO – kein Prüfnachweis'), opacity: 0.12, bold: true } })
  return URL.createObjectURL(blob)
}

/** Erzeugt Sammel- und Einzelprotokolle der aktuellen Revision, sofern noch nicht vorhanden. */
export async function protokolleErzeugen(sessionId: string, fortschritt?: (text: string) => void): Promise<void> {
  fortschritt?.(t('Daten, Fotos und Unterschriften laden …'))
  const d = await protokollDatenLaden(sessionId)
  const { data: vorhanden, error } = await supabase.from('protokoll').select('art, anlagenpruefung_id')
    .eq('session_id', sessionId).eq('revision', d.revision)
  if (error) throw error
  const hat = new Set((vorhanden ?? []).map((p) => `${p.art}:${p.anlagenpruefung_id ?? ''}`))
  const basis = `${sessionId}/r${d.revision}`
  let erzeugt = 0

  const speichern = async (art: 'sammel' | 'einzel', anlagenpruefungId: string | null, name: string, doc: TDocumentDefinitions) => {
    if (hat.has(`${art}:${anlagenpruefungId ?? ''}`)) return
    await pdfSpeichern(`${basis}/${dateiname(name)}.pdf`, doc, { session_id: sessionId, anlagenpruefung_id: anlagenpruefungId, art, revision: d.revision })
    erzeugt++
  }

  fortschritt?.(t('Sammelprotokoll erstellen …'))
  await speichern('sammel', null, `Sammelprotokoll_${d.protokollNr}`, sammelprotokoll(d))
  let i = 0
  for (const a of d.anlagen) {
    fortschritt?.(t('Einzelprotokolle erstellen … ({n}/{gesamt})', { n: ++i, gesamt: d.anlagen.length }))
    await speichern('einzel', a.pruefungId, `Einzelprotokoll_${d.protokollNr}_${a.anlage.etikett ?? a.pruefungId.slice(0, 8)}`, einzelprotokoll(d, a))
  }
  if (erzeugt) void loggen('Protokolle erzeugt', `Protokoll Nr. ${d.protokollNr}, Revision ${d.revision}: ${erzeugt} PDF(s)`)
  fortschritt?.('')
}

// Laufende Erzeugung je Prüfung: Seite und Hintergrund auf demselben Gerät erzeugen nicht doppelt
const inArbeit = new Map<string, Promise<boolean>>()

/** Protokoll einer Prüfung (ohne Session) in ihrer aktuellen Revision erzeugen, sofern noch nicht vorhanden. */
export function pruefprotokollErzeugen(pruefungId: string, fortschritt?: (text: string) => void): Promise<boolean> {
  const laufend = inArbeit.get(pruefungId)
  if (laufend) return laufend
  const neu = pruefprotokollErstellen(pruefungId, fortschritt).finally(() => inArbeit.delete(pruefungId))
  inArbeit.set(pruefungId, neu)
  return neu
}

async function pruefprotokollErstellen(id: string, fortschritt?: (text: string) => void): Promise<boolean> {
  // Tür einer Türanlage: ihr Protokoll entsteht mit dem der Türanlage
  const kopf = await supabase.from('anlagenpruefung').select('teil_von_id').eq('id', id).single()
  if (kopf.error) throw kopf.error
  if (kopf.data.teil_von_id) return tueranlagenprotokolleErstellen(kopf.data.teil_von_id, fortschritt)
  const pruefungId = id
  const tueren = await supabase.from('anlagenpruefung').select('id').eq('teil_von_id', pruefungId).limit(1)
  if (tueren.error) throw tueren.error
  if (tueren.data.length) return tueranlagenprotokolleErstellen(pruefungId, fortschritt)
  fortschritt?.(t('Daten, Fotos und Unterschriften laden …'))
  const d = await pruefprotokollDatenLaden(pruefungId)
  const { data: vorhanden, error } = await supabase.from('protokoll').select('id')
    .eq('anlagenpruefung_id', pruefungId).is('session_id', null).eq('revision', d.revision).limit(1)
  if (error) throw error
  if (vorhanden?.length) {
    await unterschriftenBereinigen(pruefungId)
    return false
  }
  const erste = d.anlagen[0]
  fortschritt?.(t('Protokoll erstellen …'))
  const name = `Pruefprotokoll_${d.protokollNr}${d.revision ? `_Rev${d.revision}` : ''}_${erste.anlage.etikett ?? pruefungId.slice(0, 8)}`
  await pdfSpeichern(`p/${pruefungId}/r${d.revision}/${dateiname(name)}.pdf`, pruefprotokoll(d),
    { session_id: null, anlagenpruefung_id: pruefungId, art: 'einzel', revision: d.revision })
  void loggen('Protokoll erzeugt', `Protokoll Nr. ${d.protokollNr}${d.revision ? `, Revision ${d.revision}` : ''} · ${anlageName(erste)}`)
  fortschritt?.(t('Unterschriften entfernen …'))
  await unterschriftenBereinigen(pruefungId)
  fortschritt?.('')
  return true
}

/**
 * Protokolle einer Türanlage (docs/KONZEPT-TUERANLAGE.md): das Protokoll der Türanlage mit Nummer und Unterschriften und je
 * geprüfter Tür ein Tür-Protokoll (ohne eigene Nummer, mit den Unterschriften ihrer Prüfer) – jeweils für die aktuelle Revision, soweit noch nicht da.
 */
async function tueranlagenprotokolleErstellen(hauptId: string, fortschritt?: (text: string) => void): Promise<boolean> {
  const [haupt, teile] = await Promise.all([
    supabase.from('anlagenpruefung').select('revision').eq('id', hauptId).single(),
    supabase.from('anlagenpruefung').select('id').eq('teil_von_id', hauptId).eq('status', 'geprueft'),
  ])
  if (haupt.error) throw haupt.error
  if (teile.error) throw teile.error
  const revision = haupt.data.revision
  const ids = [hauptId, ...teile.data.map((t) => t.id)]
  const { data: vorhanden, error } = await supabase.from('protokoll').select('anlagenpruefung_id')
    .in('anlagenpruefung_id', ids).is('session_id', null).eq('revision', revision)
  if (error) throw error
  const hat = new Set((vorhanden ?? []).map((p) => p.anlagenpruefung_id))
  if (ids.every((x) => hat.has(x))) {
    await unterschriftenBereinigen(hauptId)
    return false
  }
  fortschritt?.(t('Daten, Fotos und Unterschriften laden …'))
  const d = await pruefprotokollDatenLaden(hauptId)
  // Ohne Objektnamen: der Dateipfad ist für den Hoster lesbar (docs/KONZEPT-VERSCHLUESSELUNG.md)
  const name = `Pruefprotokoll_${d.protokollNr}${d.revision ? `_Rev${d.revision}` : ''}_Tueranlage`
  if (!hat.has(hauptId)) {
    fortschritt?.(t('Protokoll der Türanlage erstellen …'))
    await pdfSpeichern(`p/${hauptId}/r${d.revision}/${dateiname(name)}.pdf`, tueranlagenprotokoll(d),
      { session_id: null, anlagenpruefung_id: hauptId, art: 'einzel', revision: d.revision })
    void loggen('Protokoll erzeugt', `Protokoll Nr. ${d.protokollNr}${d.revision ? `, Revision ${d.revision}` : ''} · Türanlage mit ${d.anlagen.length} Türen`)
  }
  // Die Tür-Protokolle tragen die Unterschriften ihrer Prüfer: die Unterschriftsdateien erst danach löschen (bricht die
  // Erzeugung ab, holt der nächste Lauf die fehlenden Türen mit Unterschrift nach)
  const geprueft = d.anlagen.filter((a) => a.status === 'geprueft' && !hat.has(a.pruefungId))
  let i = 0
  for (const a of geprueft) {
    fortschritt?.(t('Protokolle der Türen erstellen … ({n}/{gesamt})', { n: ++i, gesamt: geprueft.length }))
    const tuerName = `Pruefprotokoll_${d.protokollNr}${d.revision ? `_Rev${d.revision}` : ''}_${a.anlage.etikett ?? a.pruefungId.slice(0, 8)}`
    await pdfSpeichern(`p/${a.pruefungId}/r${d.revision}/${dateiname(tuerName)}.pdf`, tuerprotokoll(d, a),
      { session_id: null, anlagenpruefung_id: a.pruefungId, art: 'einzel', revision: d.revision })
  }
  fortschritt?.(t('Unterschriften entfernen …'))
  await unterschriftenBereinigen(hauptId)
  fortschritt?.('')
  return true
}

/**
 * Unterschriftsdateien einer Prüfung löschen, sobald das Protokoll ihrer Revision gespeichert ist: Die Unterschrift steht
 * danach nur noch im PDF. Zuerst die Dateien (der Server erlaubt das erst mit gespeichertem Protokoll), dann die Pfade
 * leeren – schlägt der zweite Schritt fehl, holt ein späterer Aufruf beides nach. Ohne Pfade ist nichts zu tun.
 */
export async function unterschriftenBereinigen(pruefungId: string): Promise<void> {
  const [p, mit] = await Promise.all([
    supabase.from('anlagenpruefung').select('unterschrift, kunde_unterschrift').eq('id', pruefungId).single(),
    supabase.from('anlagenpruefung_mitpruefer').select('unterschrift').eq('anlagenpruefung_id', pruefungId),
  ])
  if (p.error) throw p.error
  if (mit.error) throw mit.error
  const pfade = [p.data.unterschrift, p.data.kunde_unterschrift, ...(mit.data ?? []).map((m) => m.unterschrift)].filter((x): x is string => !!x)
  if (!pfade.length) return
  const weg = await supabase.storage.from('unterschriften').remove(pfade)
  if (weg.error) throw weg.error
  const { error } = await supabase.rpc('unterschriften_bereinigen', { p_anlagenpruefung_id: pruefungId })
  if (error) throw error
}

/**
 * Entschlüsseltes Protokoll als Blob-URL. Bei verschlüsselten Protokollen muss der Inhalt zur gespeicherten Prüfsumme passen
 * (sha256 der unverschlüsselten PDF, unveränderlich in der Datenbank): Den Dateipfad kann ein Admin beim Umschlüsseln
 * umsetzen, und den Inhalt prüft der Server nicht – ein ausgetauschtes PDF gilt so als „nicht lesbar“.
 */
async function protokollUrl(p: { id: string; storage_pfad: string; sha256?: string | null }): Promise<string> {
  if (istVerschluesselterPfad(p.storage_pfad) && p.sha256) {
    const blob = await holen('protokolle', p.storage_pfad)
    if (await sha256(blob) !== p.sha256) {
      void loggen('Protokoll nicht lesbar', `Protokoll ${p.id}: Inhalt passt nicht zur gespeicherten Prüfsumme`)
      throw new Error(t('Prüfsumme des Protokolls passt nicht'))
    }
  }
  return holenUrl('protokolle', p.storage_pfad)
}

/**
 * Blob-URLs der entschlüsselten Protokolle (zum Öffnen und Herunterladen), je ID des Protokolls. Ein Protokoll, das sich nicht
 * holen oder entschlüsseln lässt oder nicht zu seiner Prüfsumme passt, bekommt den leeren Link „“ (die Oberfläche zeigt
 * „nicht lesbar“).
 */
export async function protokollLinks(protokolle: { id: string; storage_pfad: string; sha256?: string | null }[]): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(protokolle.map(async (p) => [p.id, await protokollUrl(p).catch(() => '')] as const)))
}
