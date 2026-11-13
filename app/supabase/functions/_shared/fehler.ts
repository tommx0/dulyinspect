// Fehler einer Edge Function ins Fehlerprotokoll der Instanz (fehler_melden, Art edge). Wirft nie; fehlt die Funktion
// (Datenbank vor 2.92.0), bleibt es beim Eintrag im Container-Log.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export async function fehlerMeldenServer(service: SupabaseClient, ort: string, fehler: unknown): Promise<void> {
  try {
    const e = fehler instanceof Error ? fehler : null;
    const text = (e ? `${e.name}: ${e.message}` : String(fehler)).replace(/[^\s@"'<>]+@[^\s@"'<>]+\.[A-Za-z]{2,}/g, "<E-Mail>");
    const { error } = await service.rpc("fehler_melden", { p_art: "edge", p_text: text, p_stack: e?.stack ?? null, p_ort: ort });
    if (error) console.error(`Fehlerprotokoll (${ort}):`, error.message);
  } catch (x) {
    console.error(`Fehlerprotokoll (${ort}):`, x);
  }
}
