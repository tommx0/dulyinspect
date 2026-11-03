// Sachkundenachweis als Datei je Benutzer und Anlagenart (Bucket „nachweise“, Spalten benutzer_sachkunde.datei_pfad/datei_name).
// Die Datei liegt verschlüsselt im Speicher (Pfad auf „.enc“), der Dateiname verschlüsselt in der Datenbank (benutzer_sachkunde.datei_name:
// beim Speichern der Zeile durch verschluesseln() geben, nicht hier).
import { bildVerkleinern } from '../offline/aktionen'
import { supabase } from './supabase'
import { t } from './sprache'
import { holenUrl, hochladen } from './verschluesselung'

const BUCKET = 'nachweise'
/** Grenze des Buckets (Migration 20261023180000) */
export const MAX_BYTES = 10 * 1024 * 1024

export type NachweisArt = 'pdf' | 'bild'

/** PDF oder Bild? Sonst Fehlermeldung. Fotos werden vor dem Hochladen verkleinert, PDFs bleiben, wie sie sind. */
export function nachweisArt(datei: { name: string; type: string; size: number }): NachweisArt | string {
  const pdf = datei.type === 'application/pdf' || /\.pdf$/i.test(datei.name)
  const bild = datei.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(datei.name)
  if (!pdf && !bild) return t('Bitte ein PDF oder ein Foto (JPEG, PNG, WebP) wählen.')
  if (pdf && datei.size > MAX_BYTES) return t('Das PDF ist größer als 10 MB. Bitte verkleinern oder als Foto aufnehmen.')
  return pdf ? 'pdf' : 'bild'
}

/** Datei verschlüsselt hochladen; liefert den Speicherort (mit „.enc“) und den Anzeigenamen. Wirft bei Fehlern. */
export async function nachweisHochladen(benutzerId: string, anlagenart: string, datei: File): Promise<{ pfad: string; name: string }> {
  const art = nachweisArt(datei)
  if (art !== 'pdf' && art !== 'bild') throw new Error(art)
  // Urkunden sollen lesbar bleiben: größer als normale Prüffotos
  let inhalt: Blob = datei
  if (art === 'bild') {
    try {
      inhalt = await bildVerkleinern(datei, 2400, 0.85)
    } catch {
      throw new Error(t('Das Foto konnte nicht gelesen werden. Bitte als JPEG oder PNG speichern.'))
    }
  }
  if (inhalt.size > MAX_BYTES) throw new Error(t('Die Datei ist größer als 10 MB.'))
  const typ = art === 'pdf' ? 'application/pdf' : 'image/jpeg'
  const pfad = await hochladen(BUCKET, `${benutzerId}/${anlagenart}/${crypto.randomUUID()}.${art === 'pdf' ? 'pdf' : 'jpg'}`,
    inhalt.type === typ ? inhalt : new Blob([inhalt], { type: typ }))
  const name = art === 'pdf' ? datei.name : datei.name.replace(/\.[^.]+$/, '') + '.jpg'
  return { pfad, name: name || `Nachweis.${art === 'pdf' ? 'pdf' : 'jpg'}` }
}

export async function nachweisLoeschen(pfad: string) {
  await supabase.storage.from(BUCKET).remove([pfad])
}

/**
 * Links zum Ansehen je Speicherort (Blob-URL der entschlüsselten Datei, gültig für die Sitzung). Eine Datei, die sich nicht
 * holen oder entschlüsseln lässt, bekommt den leeren Link „“ (Anzeige „nicht lesbar“).
 */
export async function nachweisLinks(pfade: string[]): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(pfade.map(async (p) => [p, await holenUrl(BUCKET, p).catch(() => '')] as const)))
}
