// Takt des Mailversands (Konzept docs/KONZEPT-MAIL.md, Abschnitte 5 und 6). Nur mit dem Service-Key aufrufbar: stündlich von
// der Mandanten-Verwaltung (verwaltung/server/mail.mjs), in der Einzelinstanz vom Dienst mail-takt. Ein doppelter oder
// verpasster Aufruf schadet nicht: Die Function prüft selbst, was fällig ist, und holt Verpasstes nach.
//
// Je Aufruf, unabhängig voneinander:
//   statusmail   – im eingestellten Rhythmus (Schritt 4)
//   fehler       – Sammelmail neuer bzw. wieder aufgetretener Fehler, höchstens einmal in der Stunde
//   kritisch     – Prüfungen mit kritischem Ergebnis seit dem letzten Takt (Schwelle sofort_schwelle)
//   ueberfaellig – neu überfällige Prüfungen, einmal am Tag ab der Uhrzeit der Statusmail
// Meldungen gehen an meldung_empfaenger, sonst an die Empfänger der Statusmail. Ohne Empfänger oder abgeschaltet werden
// kritische und überfällige nur als erledigt vermerkt (kein Schwall, wenn sie später eingeschaltet werden).
//
// POST {} → { statusmail, fehler, kritisch, ueberfaellig: "gesendet" | "nichts" | "aus" | "fehler" …, naechster? }
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { fehlerMeldenServer } from "../_shared/fehler.ts";
import { demoAn, einstellung, MailFehler, type Nachricht, senden, type Server, server } from "../_shared/mail.ts";
import { fehlerMail, type FehlerZeile, kritischMail, type KritischZeile, ueberfaelligMail, type UeberfaelligZeile } from "../_shared/meldungen.ts";
import { plan, type StatusEinstellung, statusmailBauen } from "../_shared/statusmail.ts";
import { berlin, letzterTermin, naechsterTermin, tagText, vorherigerTermin } from "../_shared/termin.ts";

type Einstellung = StatusEinstellung & {
  fehler_aktiv: boolean; meldung_empfaenger: string[]; sofort_schwelle: "aus" | "stufe3" | "stufe2"; sofort_ueberfaellig: boolean;
};

const antwort = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function gleich(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

async function rpc<T>(service: SupabaseClient, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await service.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data as T;
}

async function rahmen(service: SupabaseClient) {
  const [{ data: bild }, { data: firma }] = await Promise.all([
    service.from("erscheinungsbild").select("app_name").eq("id", 1).maybeSingle(),
    service.from("firma").select("protokoll_sprache").eq("id", 1).maybeSingle(),
  ]);
  return {
    app: (bild as { app_name?: string } | null)?.app_name || "DulyInspect",
    sprache: ((firma as { protokoll_sprache?: string } | null)?.protokoll_sprache === "en" ? "en" : "de") as "de" | "en",
  };
}

async function statusmail(service: SupabaseClient, e: Einstellung, s: Server) {
  if (!e.status_aktiv || !e.status_empfaenger?.length) return { statusmail: "aus" };
  const jetzt = new Date();
  const termin = letzterTermin(jetzt, plan(e));
  const naechster = naechsterTermin(jetzt, plan(e)).toISOString();
  // Zeitraum beanspruchen, dann senden: ein gleichzeitiger zweiter Aufruf bekommt null
  const alt = await rpc<string | null>(service, "mail_status_beanspruchen", { p_termin: termin.toISOString() });
  if (alt === null) return { statusmail: "aktuell", naechster };
  // Beim ersten Mal ein Zeitraum zurück; sonst ab dem zuletzt gemeldeten Termin (holt Verpasstes in einer Mail nach)
  const von = String(alt).includes("infinity") ? vorherigerTermin(termin, plan(e)) : new Date(String(alt));
  try {
    const m = await statusmailBauen(service, e, von, termin);
    await senden(s, {
      an: e.status_empfaenger, betreff: m.betreff, text: m.text, html: m.html,
      anhaenge: [{ dateiname: m.csvName, inhalt: m.csv, typ: "text/csv; charset=utf-8" }],
    });
    await rpc(service, "mail_status_ergebnis", { p_ok: true, p_alt: alt });
    await service.rpc("log_eintragen_fuer", { p_benutzer_id: null, p_aktion: "Statusmail", p_details: `${m.betreff} an ${e.status_empfaenger.length} Empfänger` });
    return { statusmail: "gesendet", naechster };
  } catch (x) {
    const fehler = x instanceof MailFehler ? x.message : "interner Fehler";
    if (!(x instanceof MailFehler)) await fehlerMeldenServer(service, "mail-takt/statusmail", x);
    // Zeitraum wieder freigeben: der nächste Takt versucht es erneut
    await rpc(service, "mail_status_ergebnis", { p_ok: false, p_alt: alt, p_fehler: fehler });
    return { statusmail: "fehler", statusmail_fehler: fehler, naechster };
  }
}

/** Mail an die Empfänger der Meldungen; Fehler beim Versand als MailFehler weiter */
const meldungSenden = (s: Server, an: string[], n: Pick<Nachricht, "betreff" | "text">) => senden(s, { an, ...n });

async function fehlerSammelmail(service: SupabaseClient, e: Einstellung, s: Server | null, an: string[], link: string | null) {
  if (!e.fehler_aktiv || !s || !an.length) return "aus";
  const offen = await rpc<(FehlerZeile & { id: number })[]>(service, "mail_fehler_offen");
  if (!offen.length) return "nichts";
  if (!await rpc<boolean>(service, "mail_fehler_beanspruchen", { p_abstand: "1 hour" })) return "spaeter";
  const { app, sprache } = await rahmen(service);
  try {
    await meldungSenden(s, an, fehlerMail(offen, app, sprache, link));
    await rpc(service, "mail_fehler_gemeldet", { p_stand: offen.map((f) => ({ id: f.id, anzahl: f.anzahl })) });
    return "gesendet";
  } catch (x) {
    await rpc(service, "mail_fehler_freigeben");
    if (!(x instanceof MailFehler)) throw x;
    return "fehler";
  }
}

async function kritisch(service: SupabaseClient, e: Einstellung, s: Server | null, an: string[], link: string | null) {
  // Auch abgeschaltet den Stand mitführen, sonst kämen beim Einschalten alle alten Prüfungen auf einmal
  const r = await rpc<{ bis: string; pruefungen: KritischZeile[] }>(service, "mail_sofort_pruefungen", { p_schwelle: e.sofort_schwelle });
  const aus = e.sofort_schwelle === "aus" || !s || !an.length;
  if (aus || !r.pruefungen.length) {
    await rpc(service, "mail_sofort_gemeldet", { p_bis: r.bis });
    return aus ? "aus" : "nichts";
  }
  const { app, sprache } = await rahmen(service);
  try {
    await meldungSenden(s!, an, kritischMail(r.pruefungen, app, sprache, link));
  } catch (x) {
    if (!(x instanceof MailFehler)) throw x;
    return "fehler"; // Stand bleibt: der nächste Takt versucht es erneut
  }
  await rpc(service, "mail_sofort_gemeldet", { p_bis: r.bis });
  return "gesendet";
}

async function ueberfaellig(service: SupabaseClient, e: Einstellung, s: Server | null, an: string[], link: string | null) {
  // Einmal am Tag, ab der Uhrzeit der Statusmail (deutsche Zeit)
  const jetzt = new Date();
  const b = berlin(jetzt);
  const [h, m] = e.status_uhrzeit.split(":").map(Number);
  if (b.stunde * 60 + b.minute < h * 60 + m) return "spaeter";
  const heute = tagText(jetzt);
  const liste = await rpc<UeberfaelligZeile[]>(service, "mail_ueberfaellig_neu", { p_heute: heute });
  const aus = !e.sofort_ueberfaellig || !s || !an.length;
  if (aus || !liste.length) {
    await rpc(service, "mail_ueberfaellig_gemeldet", { p_liste: liste, p_heute: heute });
    return aus ? "aus" : "nichts";
  }
  const { app, sprache } = await rahmen(service);
  try {
    await meldungSenden(s!, an, ueberfaelligMail(liste, app, sprache, link));
  } catch (x) {
    if (!(x instanceof MailFehler)) throw x;
    return "fehler";
  }
  await rpc(service, "mail_ueberfaellig_gemeldet", { p_liste: liste, p_heute: heute });
  return "gesendet";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return antwort({ fehler: "Nur POST erlaubt" }, 405);
  const schluessel = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  if (!gleich(token, schluessel)) return antwort({ fehler: "Nicht erlaubt" }, 403);
  const service = createClient(Deno.env.get("SUPABASE_URL")!, schluessel);

  try {
    if (await demoAn(service)) return antwort({ statusmail: "demo", fehler: "demo", kritisch: "demo", ueberfaellig: "demo" });
    const e = await einstellung(service) as Einstellung;
    const s = e.quelle === "aus" ? null : await server(service, e);
    const an = e.meldung_empfaenger?.length ? e.meldung_empfaenger : e.status_empfaenger ?? [];
    const ergebnis: Record<string, unknown> = {};
    const teil = async (name: string, f: () => Promise<unknown>) => {
      try {
        const r = await f();
        if (typeof r === "object" && r) Object.assign(ergebnis, r);
        else ergebnis[name] = r;
      } catch (x) {
        console.error(`mail-takt/${name}:`, x);
        await fehlerMeldenServer(service, `mail-takt/${name}`, x);
        ergebnis[name] = "fehler";
      }
    };
    await teil("statusmail", () => s ? statusmail(service, e, s) : Promise.resolve({ statusmail: e.quelle === "aus" ? "aus" : "kein-server" }));
    await teil("fehler", () => fehlerSammelmail(service, e, s, an, e.app_adresse));
    await teil("kritisch", () => kritisch(service, e, s, an, e.app_adresse));
    await teil("ueberfaellig", () => ueberfaellig(service, e, s, an, e.app_adresse));
    return antwort(ergebnis);
  } catch (x) {
    console.error("mail-takt:", x);
    await fehlerMeldenServer(service, "mail-takt", x);
    return antwort({ statusmail: "fehler", fehler: "interner Fehler" }, 500);
  }
});
