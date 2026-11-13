// Statusmail zusammenstellen (Edge Functions mail-takt und mail/vorschau). Zeiträume: docs/KONZEPT-MAIL.md, Abschnitt 5.2.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Einstellung } from "./mail.ts";
import { type Bericht, statusmail } from "./statusbericht.ts";
import { letzterTermin, naechsterTermin, type Plan, tagText, vorherigerTermin } from "./termin.ts";

export type StatusEinstellung = Einstellung & {
  status_aktiv: boolean;
  status_empfaenger: string[];
  status_intervall: Plan["intervall"];
  status_wochentag: number;
  status_monatstag: number;
  status_uhrzeit: string;
  app_adresse: string | null;
};

export const plan = (e: StatusEinstellung): Plan => ({
  intervall: e.status_intervall, wochentag: e.status_wochentag, monatstag: e.status_monatstag, uhrzeit: e.status_uhrzeit,
});

/** Kalendertag davor (JJJJ-MM-TT) */
const tagDavor = (tag: string) => new Date(Date.parse(`${tag}T12:00:00Z`) - 86400_000).toISOString().slice(0, 10);

/**
 * Mail für den Zeitraum [von, bis): Prüfungen darin, überfällig vor dem Tag von `bis`, fällig bis zum nächsten Termin nach `bis`.
 */
export async function statusmailBauen(service: SupabaseClient, e: StatusEinstellung, von: Date, bis: Date) {
  const p = plan(e);
  const naechster = naechsterTermin(bis, p);
  const heute = tagText(bis);
  const { data, error } = await service.rpc("statusbericht", {
    p_von: von.toISOString(), p_bis: bis.toISOString(), p_heute: heute, p_naechster: tagText(naechster),
  });
  if (error || !data) throw new Error(`Statusbericht nicht lesbar: ${error?.message ?? "leer"}`);
  const [{ data: bild }, { data: firma }] = await Promise.all([
    service.from("erscheinungsbild").select("app_name").eq("id", 1).maybeSingle(),
    service.from("firma").select("protokoll_sprache").eq("id", 1).maybeSingle(),
  ]);
  return statusmail(data as Bericht, {
    app: (bild as { app_name?: string } | null)?.app_name || "DulyInspect",
    sprache: (firma as { protokoll_sprache?: string } | null)?.protokoll_sprache === "en" ? "en" : "de",
    von: tagText(von),
    bis: tagDavor(heute),
    vorschauBis: tagDavor(tagText(naechster)),
    adresse: e.app_adresse,
  });
}

/** Zeitraum der Vorschau: der zuletzt abgeschlossene (Termin davor bis letzter Termin) */
export function vorschauZeitraum(e: StatusEinstellung, jetzt = new Date()) {
  const bis = letzterTermin(jetzt, plan(e));
  return { von: vorherigerTermin(bis, plan(e)), bis };
}
