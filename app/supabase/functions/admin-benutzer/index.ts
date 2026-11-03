// Benutzerverwaltung für Admins. Läuft mit Service-Role, weil das Anlegen von Auth-Benutzern
// und das Setzen von app_metadata (Rolle) im Browser nicht erlaubt ist.
//
// POST { aktion: "anlegen", email, name, rolle, passwort, zwei_faktor?, passwort_aendern? }
// POST { aktion: "aktualisieren", id, name?, rolle?, aktiv?, sachkunde_hinweis?, zwei_faktor? }
// POST { aktion: "passwort", id, passwort, passwort_aendern? }
// passwort_aendern: Der Benutzer muss das vorgegebene Passwort bei der nächsten Anmeldung ändern.
// POST { aktion: "zwei_faktor_zuruecksetzen", id } → alle zweiten Faktoren entfernen (z. B. Handy verloren)
// POST { aktion: "support_freischalten", minuten: 60 | 120 } → { benutzername, passwort, bis } (Passwort nur in dieser Antwort)
// POST { aktion: "support_sperren" }
// POST { aktion: "limit" } → { max, aktiv } (Höchstzahl aktiver Benutzer und wie viele es schon sind)
//
// Höchstzahl aktiver Benutzer: Umgebungsvariable MAX_AKTIVE_BENUTZER des Edge-Runtime-Containers (Coolify: Variable am
// Supabase-Dienst; Supabase Cloud: Function-Secret), ohne Angabe 2. Gezählt werden aktive Zugänge aller Rollen ohne den Supportzugang.
import { createClient } from "npm:@supabase/supabase-js@2";
import { supportVerbot } from "./support.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Client = ReturnType<typeof createClient>;

async function emailVon(service: Client, id: string): Promise<string> {
  const { data } = await service.from("benutzer").select("email").eq("id", id).single();
  return (data as { email?: string } | null)?.email ?? id;
}

// Stufe der Sitzung aus dem (von auth.getUser bereits geprüften) Token: aal2 = zweiter Faktor bestätigt
function stufe(token: string): string {
  try {
    const teil = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(teil)).aal ?? "";
  } catch {
    return "";
  }
}

function antwort(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const ROLLEN = ["admin", "planer", "pruefer"];
const MIN_PASSWORT = 10;
const MAX_AKTIVE_STANDARD = 2;

/** Höchstzahl aktiver Benutzer aus MAX_AKTIVE_BENUTZER (ganze Zahl ≥ 1), sonst der Standard. */
function maxAktive(): number {
  const n = Number.parseInt(Deno.env.get("MAX_AKTIVE_BENUTZER") ?? "", 10);
  return Number.isInteger(n) && n >= 1 ? n : MAX_AKTIVE_STANDARD;
}

/** Aktive Benutzer ohne Supportzugang. „*“ und Filter hier, weil die Spalte support vor Migration 2.40.0 fehlt. */
async function aktiveBenutzer(service: Client): Promise<number> {
  const { data, error } = await service.from("benutzer").select("*").eq("aktiv", true);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { support?: boolean }[]).filter((b) => !b.support).length;
}

const limitText = (max: number, aktiv: number) =>
  `Höchstens ${max} aktive Benutzer sind erlaubt, ${aktiv} sind es schon. Bitte zuerst einen Benutzer deaktivieren oder die Grenze vom Betreiber erhöhen lassen.`;

// Supportzugang (Fernwartung): Anmeldename „support“, in Auth unter dieser Adresse (wie src/lib/support.ts)
const SUPPORT_EMAIL = "support@fernwartung.invalid";
const SUPPORT_MINUTEN = [60, 120];
// Ohne leicht verwechselbare Zeichen (0/O, 1/l/I), weil das Passwort oft am Telefon durchgegeben wird
const KLEIN = "abcdefghijkmnopqrstuvwxyz", GROSS = "ABCDEFGHJKLMNPQRSTUVWXYZ", ZIFFERN = "23456789", SONDER = ".-!$%#";

/** Gleichverteilte Zufallszahl 0 … n-1 (ohne Modulo-Verzerrung). */
function zufall(n: number): number {
  const grenze = Math.floor(0x100000000 / n) * n;
  const z = new Uint32Array(1);
  do crypto.getRandomValues(z); while (z[0] >= grenze);
  return z[0] % n;
}

/** 10 Zeichen, mindestens je ein Klein-, Großbuchstabe, Ziffer und Sonderzeichen. */
function supportPasswort(): string {
  const alle = KLEIN + GROSS + ZIFFERN + SONDER;
  const zeichen = [KLEIN, GROSS, ZIFFERN, SONDER].map((g) => g[zufall(g.length)]);
  while (zeichen.length < 10) zeichen.push(alle[zufall(alle.length)]);
  for (let i = zeichen.length - 1; i > 0; i--) {
    const j = zufall(i + 1);
    [zeichen[i], zeichen[j]] = [zeichen[j], zeichen[i]];
  }
  return zeichen.join("");
}

// Für die Logdatei: Feldnamen und Werte lesbar
const FELDER: Record<string, string> = {
  name: "Name", rolle: "Rolle", aktiv: "Aktiv", sachkunde_hinweis: "Sachkunde-Hinweis", zwei_faktor: "Zwei-Faktor-Anmeldung",
};
const ROLLENNAMEN: Record<string, string> = { admin: "Admin", planer: "Planer", pruefer: "Prüfer" };
const lesbar = (k: string, v: unknown) =>
  `${FELDER[k] ?? k}: ${typeof v === "boolean" ? (v ? "ja" : "nein") : k === "rolle" ? ROLLENNAMEN[String(v)] ?? v : v ? `„${v}“` : "leer"}`;

// Logdatei: Service-Role gilt in der Datenbank als „System“, deshalb den handelnden Admin ausdrücklich eintragen
async function loggen(service: Client, adminId: string, aktion: string, details: string) {
  const { error } = await service.rpc("log_eintragen_fuer", { p_benutzer_id: adminId, p_aktion: aktion, p_details: details });
  if (error) console.error("Log fehlgeschlagen:", error.message);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return antwort({ fehler: "Nur POST erlaubt" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Aufrufer prüfen: angemeldet, aktiv, Admin, ggf. mit zweitem Faktor
  const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  const { data: auth } = await service.auth.getUser(token);
  if (!auth.user) return antwort({ fehler: "Nicht angemeldet" }, 401);
  // Abgelaufene Freischaltung des Supportzugangs zuerst sperren (falls pg_cron fehlt)
  await service.rpc("support_ablauf");
  // „*“, weil support/aktiv_bis vor der Migration 2.40.0 fehlen
  const { data: aufrufer } = await service.from("benutzer").select("*").eq("id", auth.user.id).single();
  const abgelaufen = !!aufrufer?.aktiv_bis && new Date(aufrufer.aktiv_bis) <= new Date();
  if (!aufrufer?.aktiv || abgelaufen || aufrufer.rolle !== "admin") return antwort({ fehler: "Nur für Admins" }, 403);
  if (aufrufer.zwei_faktor && stufe(token) !== "aal2") return antwort({ fehler: "Bitte zuerst mit dem zweiten Faktor anmelden" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return antwort({ fehler: "Ungültige Anfrage" }, 400);
  }

  if (body.rolle !== undefined && !ROLLEN.includes(String(body.rolle))) {
    return antwort({ fehler: "Ungültige Rolle" }, 400);
  }
  if (body.zwei_faktor !== undefined && typeof body.zwei_faktor !== "boolean") {
    return antwort({ fehler: "Ungültige Angabe zur Zwei-Faktor-Anmeldung" }, 400);
  }
  if (body.passwort_aendern !== undefined && typeof body.passwort_aendern !== "boolean") {
    return antwort({ fehler: "Ungültige Angabe zum Passwortwechsel" }, 400);
  }
  if (body.passwort !== undefined && String(body.passwort).length < MIN_PASSWORT) {
    return antwort({ fehler: `Passwort muss mindestens ${MIN_PASSWORT} Zeichen haben` }, 400);
  }

  // Der Supportzugang wird nur über Freischalten und Sperren verwaltet
  let ziel: { aktiv?: boolean; support?: boolean; rolle?: string } | null = null;
  if (body.id !== undefined) {
    ziel = (await service.from("benutzer").select("*").eq("id", String(body.id)).single()).data as typeof ziel;
    if (ziel?.support) return antwort({ fehler: "Den Supportzugang bitte über Freischalten und Sperren verwalten" }, 400);
  }
  // Supportzugang: nur Planer und Prüfer betreuen, nichts, was das Zeitfenster überdauert (support.ts)
  if (aufrufer.support) {
    const verbot = supportVerbot(body.aktion, ziel, body);
    if (verbot) return antwort({ fehler: verbot }, 403);
  }

  switch (body.aktion) {
    case "anlegen": {
      const { email, name, rolle, passwort } = body as Record<string, string>;
      const zweiFaktor = body.zwei_faktor === true;
      if (!email || !name || !rolle || !passwort) return antwort({ fehler: "E-Mail, Name, Rolle und Passwort sind Pflicht" }, 400);
      if (email.trim().toLowerCase() === SUPPORT_EMAIL) return antwort({ fehler: "Diese Adresse ist für den Supportzugang reserviert" }, 400);
      // Neue Benutzer sind aktiv: Grenze vorher prüfen
      const [max, aktiv] = [maxAktive(), await aktiveBenutzer(service)];
      if (aktiv >= max) return antwort({ fehler: limitText(max, aktiv) }, 409);
      const { data, error } = await service.auth.admin.createUser({
        email,
        password: passwort,
        email_confirm: true,
        user_metadata: { name },
        app_metadata: { rolle },
      });
      if (error) return antwort({ fehler: error.message }, 400);
      // Rolle ausdrücklich ins Profil schreiben: der Trigger beim Anlegen sieht app_metadata noch nicht zuverlässig
      const { error: e2 } = await service.from("benutzer").update({ rolle, name, zwei_faktor: zweiFaktor }).eq("id", data.user.id);
      if (e2) return antwort({ fehler: e2.message }, 400);
      if (body.passwort_aendern === true) {
        const { error: e3 } = await service.rpc("passwort_aendern_setzen", { p_benutzer: data.user.id });
        if (e3) return antwort({ fehler: e3.message }, 400);
      }
      await loggen(service, auth.user.id, "Benutzer angelegt",
        `${name} <${email}> | Rolle: ${ROLLENNAMEN[rolle] ?? rolle}${zweiFaktor ? "; Zwei-Faktor-Anmeldung: ja" : ""}`
          + (body.passwort_aendern === true ? "; Passwort bei der ersten Anmeldung ändern" : ""));
      return antwort({ id: data.user.id });
    }

    case "aktualisieren": {
      const id = String(body.id ?? "");
      if (!id) return antwort({ fehler: "id fehlt" }, 400);
      if (id === auth.user.id && (body.aktiv === false || (body.rolle && body.rolle !== "admin"))) {
        return antwort({ fehler: "Sie können sich nicht selbst deaktivieren oder die Admin-Rolle entziehen" }, 400);
      }
      // Wieder aktivieren zählt wie Anlegen
      if (body.aktiv === true && ziel && !ziel.aktiv) {
        const [max, aktiv] = [maxAktive(), await aktiveBenutzer(service)];
        if (aktiv >= max) return antwort({ fehler: limitText(max, aktiv) }, 409);
      }
      const felder: Record<string, unknown> = {};
      for (const k of ["name", "rolle", "aktiv", "sachkunde_hinweis", "zwei_faktor"]) if (body[k] !== undefined) felder[k] = body[k];
      const { error } = await service.from("benutzer").update(felder).eq("id", id);
      if (error) return antwort({ fehler: error.message }, 400);
      // Rolle auch in app_metadata spiegeln; Deaktivierte werden in Auth gesperrt (keine neuen Sitzungen)
      const authUpdate: Record<string, unknown> = {};
      if (body.rolle !== undefined) authUpdate.app_metadata = { rolle: body.rolle };
      if (body.aktiv !== undefined) authUpdate.ban_duration = body.aktiv ? "none" : "876000h";
      if (Object.keys(authUpdate).length) {
        const { error: e2 } = await service.auth.admin.updateUserById(id, authUpdate);
        if (e2) return antwort({ fehler: e2.message }, 400);
      }
      await loggen(service, auth.user.id, "Benutzer geändert", `${await emailVon(service, id)} | ${Object.entries(felder).map(([k, v]) => lesbar(k, v)).join("; ")}`);
      return antwort({ ok: true });
    }

    case "passwort": {
      const { id, passwort } = body as Record<string, string>;
      if (!id || !passwort) return antwort({ fehler: "id und Passwort sind Pflicht" }, 400);
      const { error } = await service.auth.admin.updateUserById(id, { password: passwort });
      if (error) return antwort({ fehler: error.message }, 400);
      if (body.passwort_aendern === true) {
        const { error: e2 } = await service.rpc("passwort_aendern_setzen", { p_benutzer: id });
        if (e2) return antwort({ fehler: e2.message }, 400);
      }
      await loggen(service, auth.user.id, "Passwort neu gesetzt",
        `${await emailVon(service, id)}${body.passwort_aendern === true ? " (bei der nächsten Anmeldung zu ändern)" : ""}`);
      return antwort({ ok: true });
    }

    case "zwei_faktor_zuruecksetzen": {
      const id = String(body.id ?? "");
      if (!id) return antwort({ fehler: "id fehlt" }, 400);
      const { data, error } = await service.auth.admin.mfa.listFactors({ userId: id });
      if (error) return antwort({ fehler: error.message }, 400);
      for (const f of data.factors) {
        const { error: e2 } = await service.auth.admin.mfa.deleteFactor({ id: f.id, userId: id });
        if (e2) return antwort({ fehler: e2.message }, 400);
      }
      await loggen(service, auth.user.id, "Zwei-Faktor-Anmeldung zurückgesetzt", await emailVon(service, id));
      return antwort({ ok: true });
    }

    case "support_freischalten": {
      const minuten = Number(body.minuten);
      if (!SUPPORT_MINUTEN.includes(minuten)) return antwort({ fehler: "Freischalten nur für 60 oder 120 Minuten" }, 400);
      // Sonst könnte sich der Supportzugang selbst verlängern
      const passwort = supportPasswort();
      const { data: vorhanden } = await service.from("benutzer").select("id, aktiv").eq("support", true).maybeSingle();
      if (vorhanden?.aktiv) return antwort({ fehler: "Der Supportzugang ist bereits freigeschaltet. Zum Neustart erst sperren." }, 409);
      let id = vorhanden?.id as string | undefined;
      if (!id) {
        // Erstes Freischalten: Zugang anlegen (gesperrt, bis die Datenbank die Freischaltung einträgt)
        const { data, error } = await service.auth.admin.createUser({
          email: SUPPORT_EMAIL, password: passwort, email_confirm: true, ban_duration: "876000h",
          user_metadata: { name: "Support (Fernwartung)" }, app_metadata: { rolle: "admin" },
        });
        if (error) return antwort({ fehler: error.message }, 400);
        id = data.user.id;
        const { error: e2 } = await service.from("benutzer")
          .update({ rolle: "admin", name: "Support (Fernwartung)", aktiv: false, zwei_faktor: false, support: true }).eq("id", id);
        if (e2) return antwort({ fehler: e2.message }, 400);
        await loggen(service, auth.user.id, "Supportzugang angelegt", "support");
      }
      const { error } = await service.auth.admin.updateUserById(id, { password: passwort, ban_duration: "none" });
      if (error) return antwort({ fehler: error.message }, 400);
      const { data: bis, error: e2 } = await service.rpc("support_freischalten", { p_admin: auth.user.id, p_minuten: minuten });
      if (e2) {
        // Nicht halb freigeschaltet zurücklassen
        await service.rpc("support_sperren", { p_admin: auth.user.id, p_details: `Freischalten fehlgeschlagen: ${e2.message}` });
        return antwort({ fehler: e2.message }, 400);
      }
      return antwort({ benutzername: "support", passwort, bis });
    }

    case "limit":
      return antwort({ max: maxAktive(), aktiv: await aktiveBenutzer(service) });

    case "support_sperren": {
      const { error } = await service.rpc("support_sperren", { p_admin: auth.user.id, p_details: "manuell" });
      if (error) return antwort({ fehler: error.message }, 400);
      return antwort({ ok: true });
    }

    default:
      return antwort({ fehler: "Unbekannte Aktion" }, 400);
  }
});
