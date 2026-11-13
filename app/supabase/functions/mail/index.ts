// Mailserver der Instanz einstellen und testen (Einstellungen → System → Mail). Nur für den Systemadmin (ist_systemadmin()).
//
// POST { aktion: "stand" } → { einstellung, passwort_gesetzt, zentral: { verfuegbar, absender }, schluessel, demo }
// POST { aktion: "speichern", quelle, smtp_host?, smtp_port?, smtp_sicherheit?, smtp_benutzer?, passwort?, absender_adresse?, absender_name?,
//        passwort_vergessen? }
//      passwort: nicht angegeben = unverändert, "" = löschen
// POST { aktion: "testen", an? } → Testmail an „an“ oder die eigene Adresse; { ok: true } oder { fehler }
// POST { aktion: "status_speichern", status_aktiv, status_empfaenger[], status_intervall, status_wochentag, status_monatstag, status_uhrzeit }
// POST { aktion: "meldungen_speichern", fehler_aktiv, sofort_schwelle, sofort_ueberfaellig, meldung_empfaenger[] }
// POST { aktion: "vorschau" } → { betreff, html } der Statusmail für den zuletzt abgeschlossenen Zeitraum (nichts wird verschickt)
// Die Adresse der App für Links in Mails (app_adresse) kommt beim Speichern aus dem Kopf Origin des Browsers.
//
// Gemeinsamer Code: ../_shared/mail.ts (Versand, Verschlüsselung, Prüfung der Zieladresse).
import { createClient } from "npm:@supabase/supabase-js@2";
import { adressePruefen, demoAn, einstellung, MailFehler, schluesselVorhanden, senden, server, verschluesseln, zentral } from "../_shared/mail.ts";
import { fehlerMeldenServer } from "../_shared/fehler.ts";
import { emailGueltig, hostGueltig, nameGueltig, type Sicherheit, SICHERHEITEN } from "../_shared/mailadresse.ts";
import { plan, type StatusEinstellung, statusmailBauen, vorschauZeitraum } from "../_shared/statusmail.ts";
import { letzterTermin, naechsterTermin } from "../_shared/termin.ts";

const INTERVALLE = ["taeglich", "woechentlich", "monatlich"];
const INTERVALL_TEXT: Record<string, string> = { taeglich: "täglich", woechentlich: "wöchentlich", monatlich: "monatlich" };
/** Adresse der App aus dem Kopf Origin (nur http/https, ohne Pfad), sonst null */
function appAdresse(req: Request): string | null {
  const o = req.headers.get("origin") ?? "";
  return /^https?:\/\/[A-Za-z0-9.:\[\]-]+$/.test(o) ? o : null;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function antwort(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const QUELLEN = ["aus", "zentral", "eigen"];
const QUELLE_TEXT: Record<string, string> = { aus: "aus", zentral: "zentraler Mailserver", eigen: "eigener Mailserver" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return antwort({ fehler: "Nur POST erlaubt" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Aufrufer: dieselbe Regel wie in der Datenbank (Admin, aktiv, ggf. zweiter Faktor bestätigt)
  const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  const { data: auth } = await service.auth.getUser(token);
  if (!auth.user) return antwort({ fehler: "Nicht angemeldet" }, 401);
  const nutzer = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: darf } = await nutzer.rpc("ist_systemadmin");
  if (darf !== true) return antwort({ fehler: "Nur für Admins (ggf. zuerst mit dem zweiten Faktor anmelden)" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return antwort({ fehler: "Ungültige Anfrage" }, 400);
  }

  const loggen = async (aktion: string, details: string) => {
    const { error } = await service.rpc("log_eintragen_fuer", { p_benutzer_id: auth.user!.id, p_aktion: aktion, p_details: details });
    if (error) console.error("Log fehlgeschlagen:", error.message);
  };

  try {
    if (body.aktion === "stand") {
      const e = await einstellung(service);
      const { data: geheim } = await service.rpc("mail_passwort_lesen");
      const z = zentral();
      return antwort({
        einstellung: e,
        passwort_gesetzt: !!geheim,
        zentral: { verfuegbar: !!z, absender: z?.absender ?? null },
        schluessel: schluesselVorhanden(),
        demo: await demoAn(service),
        status: await (async () => {
          const se = e as StatusEinstellung;
          const { data: st } = await service.rpc("mail_stand");
          return { ...(st as Record<string, unknown> ?? {}), naechster: se.status_aktiv ? naechsterTermin(new Date(), plan(se)).toISOString() : null };
        })(),
      });
    }

    if (body.aktion === "speichern") {
      const quelle = String(body.quelle ?? "");
      if (!QUELLEN.includes(quelle)) return antwort({ fehler: "Ungültige Auswahl des Mailservers" }, 400);
      if (quelle === "zentral" && !zentral()) return antwort({ fehler: "Es ist kein zentraler Mailserver eingerichtet" }, 400);

      const text = (k: string) => {
        const v = body[k];
        return v === undefined || v === null ? null : String(v).trim() || null;
      };
      const host = text("smtp_host"), benutzer = text("smtp_benutzer"), adresse = text("absender_adresse"), name = text("absender_name");
      const sicherheit = (text("smtp_sicherheit") ?? "starttls") as Sicherheit;
      const port = body.smtp_port === undefined || body.smtp_port === null || body.smtp_port === "" ? null : Number(body.smtp_port);

      if (!SICHERHEITEN.includes(sicherheit)) return antwort({ fehler: "Ungültige Verschlüsselung" }, 400);
      if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) return antwort({ fehler: "Port: 1 bis 65535" }, 400);
      if (host && !hostGueltig(host)) return antwort({ fehler: "Ungültiger Name des Mailservers" }, 400);
      if (adresse && !emailGueltig(adresse)) return antwort({ fehler: "Ungültige Absenderadresse" }, 400);
      if (name && !nameGueltig(name)) return antwort({ fehler: "Absendername: höchstens 100 Zeichen, ohne Anführungszeichen und spitze Klammern" }, 400);
      if (benutzer && (benutzer.length > 254 || /[\r\n]/.test(benutzer))) return antwort({ fehler: "Ungültiger Benutzername" }, 400);
      if (quelle === "eigen") {
        if (!host || !port || !adresse) return antwort({ fehler: "Für einen eigenen Mailserver bitte Server, Port und Absenderadresse angeben" }, 400);
        await adressePruefen(host);
      }

      if (body.passwort !== undefined) {
        const pw = String(body.passwort ?? "");
        if (pw.length > 500) return antwort({ fehler: "Passwort zu lang" }, 400);
        const { error } = await service.rpc("mail_passwort_setzen", { p_geheim: pw ? await verschluesseln(pw) : "" });
        if (error) throw new Error(error.message);
      }

      const { error } = await service.from("mail_einstellung").update({
        quelle,
        smtp_host: host,
        smtp_port: port,
        smtp_sicherheit: sicherheit,
        smtp_benutzer: benutzer,
        absender_adresse: adresse,
        absender_name: name,
        ...(appAdresse(req) ? { app_adresse: appAdresse(req) } : {}),
        ...(typeof body.passwort_vergessen === "boolean" ? { passwort_vergessen: body.passwort_vergessen } : {}),
        // Neue Angaben: der letzte Test gilt nicht mehr
        zuletzt_getestet_am: null,
        zuletzt_test_ok: null,
      }).eq("id", 1);
      if (error) throw new Error(error.message);
      await loggen(
        "Mailserver geändert",
        `${QUELLE_TEXT[quelle]}${quelle === "eigen" ? ` ${host}:${port} (${sicherheit})` : ""}` +
          (body.passwort !== undefined ? (body.passwort ? ", Passwort neu gesetzt" : ", Passwort gelöscht") : ""),
      );
      return antwort({ ok: true });
    }

    if (body.aktion === "status_speichern") {
      const aktiv = body.status_aktiv === true;
      const intervall = String(body.status_intervall ?? "");
      const wochentag = Number(body.status_wochentag), monatstag = Number(body.status_monatstag);
      const uhrzeit = String(body.status_uhrzeit ?? "");
      const roh = Array.isArray(body.status_empfaenger) ? body.status_empfaenger : String(body.status_empfaenger ?? "").split(/[\s,;]+/);
      const empfaenger = [...new Set(roh.map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
      if (!INTERVALLE.includes(intervall)) return antwort({ fehler: "Ungültiges Intervall" }, 400);
      if (!Number.isInteger(wochentag) || wochentag < 1 || wochentag > 7) return antwort({ fehler: "Ungültiger Wochentag" }, 400);
      if (!Number.isInteger(monatstag) || monatstag < 1 || monatstag > 28) return antwort({ fehler: "Tag im Monat: 1 bis 28" }, 400);
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(uhrzeit)) return antwort({ fehler: "Ungültige Uhrzeit" }, 400);
      if (empfaenger.length > 20) return antwort({ fehler: "Höchstens 20 Empfänger" }, 400);
      const falsch = empfaenger.find((a) => !emailGueltig(a));
      if (falsch) return antwort({ fehler: `Ungültige Adresse: ${falsch}` }, 400);
      if (aktiv && !empfaenger.length) return antwort({ fehler: "Bitte mindestens einen Empfänger angeben" }, 400);

      const alt = await einstellung(service) as StatusEinstellung;
      const neu = { status_aktiv: aktiv, status_empfaenger: empfaenger, status_intervall: intervall as StatusEinstellung["status_intervall"],
        status_wochentag: wochentag, status_monatstag: monatstag, status_uhrzeit: uhrzeit };
      const { error } = await service.from("mail_einstellung").update({ ...neu, ...(appAdresse(req) ? { app_adresse: appAdresse(req) } : {}) }).eq("id", 1);
      if (error) throw new Error(error.message);
      // Eingeschaltet oder neuer Rhythmus: erste Mail zum nächsten Termin, mit einem vollen Zeitraum (nicht rückwirkend sofort)
      const rhythmus = (x: { status_intervall: string; status_wochentag: number; status_monatstag: number; status_uhrzeit: string }) =>
        `${x.status_intervall}|${x.status_wochentag}|${x.status_monatstag}|${x.status_uhrzeit.slice(0, 5)}`;
      if (aktiv && (!alt.status_aktiv || rhythmus(alt) !== rhythmus(neu))) {
        const ab = letzterTermin(new Date(), plan({ ...alt, ...neu }));
        const { error: e2 } = await service.rpc("mail_status_neu_beginnen", { p_ab: ab.toISOString() });
        if (e2) throw new Error(e2.message);
      }
      await loggen("Statusmail geändert", aktiv ? `${INTERVALL_TEXT[intervall]} um ${uhrzeit}, ${empfaenger.length} Empfänger` : "ausgeschaltet");
      return antwort({ ok: true });
    }

    if (body.aktion === "meldungen_speichern") {
      const schwelle = String(body.sofort_schwelle ?? "");
      if (!["aus", "stufe3", "stufe2"].includes(schwelle)) return antwort({ fehler: "Ungültige Schwelle" }, 400);
      const roh = Array.isArray(body.meldung_empfaenger) ? body.meldung_empfaenger : String(body.meldung_empfaenger ?? "").split(/[\s,;]+/);
      const empfaenger = [...new Set(roh.map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
      if (empfaenger.length > 20) return antwort({ fehler: "Höchstens 20 Empfänger" }, 400);
      const falsch = empfaenger.find((a) => !emailGueltig(a));
      if (falsch) return antwort({ fehler: `Ungültige Adresse: ${falsch}` }, 400);
      const neu = { fehler_aktiv: body.fehler_aktiv === true, sofort_schwelle: schwelle, sofort_ueberfaellig: body.sofort_ueberfaellig === true,
        meldung_empfaenger: empfaenger };
      const { error } = await service.from("mail_einstellung").update({ ...neu, ...(appAdresse(req) ? { app_adresse: appAdresse(req) } : {}) }).eq("id", 1);
      if (error) throw new Error(error.message);
      await loggen("Meldungen per Mail geändert", `Fehler ${neu.fehler_aktiv ? "an" : "aus"}, Sofortmeldung ${schwelle}, ` +
        `neu überfällig ${neu.sofort_ueberfaellig ? "an" : "aus"}, ${empfaenger.length ? `${empfaenger.length} eigene Empfänger` : "Empfänger der Statusmail"}`);
      return antwort({ ok: true });
    }

    if (body.aktion === "vorschau") {
      const e = await einstellung(service) as StatusEinstellung;
      const { von, bis } = vorschauZeitraum(e);
      const m = await statusmailBauen(service, { ...e, app_adresse: e.app_adresse ?? appAdresse(req) }, von, bis);
      return antwort({ betreff: m.betreff, html: m.html });
    }

    if (body.aktion === "testen") {
      if (await demoAn(service)) return antwort({ fehler: "Im Demomodus werden keine Mails verschickt" }, 400);
      const an = body.an ? String(body.an).trim() : auth.user.email ?? "";
      if (!emailGueltig(an)) return antwort({ fehler: "Ungültige Empfängeradresse" }, 400);
      const e = await einstellung(service);
      const s = await server(service, e);
      if (!s) return antwort({ fehler: e.quelle === "aus" ? "Der Mailversand ist ausgeschaltet" : "Kein Mailserver verfügbar" }, 400);
      const { data: bild } = await service.from("erscheinungsbild").select("app_name").eq("id", 1).maybeSingle();
      const app = (bild as { app_name?: string } | null)?.app_name || "DulyInspect";
      let fehler: string | null = null;
      try {
        await senden(s, {
          an: [an],
          betreff: `${app}: Testmail`,
          text: `Diese Testmail bestätigt, dass ${app} Mails über den eingestellten Mailserver (${QUELLE_TEXT[e.quelle]}) verschicken kann.\n\n` +
            `This test message confirms that ${app} can send mail through the configured mail server.`,
        });
      } catch (x) {
        if (!(x instanceof MailFehler)) throw x;
        fehler = x.message;
      }
      await service.from("mail_einstellung").update({ zuletzt_getestet_am: new Date().toISOString(), zuletzt_test_ok: !fehler }).eq("id", 1);
      await loggen("Testmail", fehler ? `an ${an} fehlgeschlagen: ${fehler}` : `an ${an} verschickt`);
      return fehler ? antwort({ fehler }, 502) : antwort({ ok: true });
    }

    return antwort({ fehler: "Unbekannte Aktion" }, 400);
  } catch (x) {
    if (x instanceof MailFehler) return antwort({ fehler: x.message }, 400);
    console.error("mail:", x);
    await fehlerMeldenServer(service, `mail/${String(body.aktion ?? "")}`, x);
    return antwort({ fehler: "Interner Fehler" }, 500);
  }
});
