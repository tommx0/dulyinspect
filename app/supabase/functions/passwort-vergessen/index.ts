// „Passwort vergessen“ auf der Anmeldeseite (Konzept docs/KONZEPT-MAIL.md, Schritt 3). Aufruf ohne Anmeldung (verify_jwt = false).
//
// POST { aktion: "verfuegbar" } → { verfuegbar } – Link auf der Anmeldeseite zeigen? (Mailserver da, Schalter an, kein Demomodus)
// POST { aktion: "anfordern", email } → immer { ok: true }, gleich schnell, ob die Adresse bekannt ist oder nicht.
//      Für einen aktiven Benutzer (nicht den Supportzugang) erzeugt die Auth-API einen Wiederherstellungs-Link; GoTrue schickt
//      selbst nichts. Der Link führt auf die App (Adresse aus GOTRUE_SITE_URL, nie aus der Anfrage) mit ?wiederherstellen=<token_hash>,
//      die App meldet damit an (verifyOtp) und verlangt ein neues Passwort, bei eingerichtetem zweitem Faktor erst den Code.
//      Drossel: 3 je Adresse und 10 je IP in der Stunde (passwort_vergessen_zulassen).
// POST { aktion: "geaendert" } (angemeldet) → Hinweismail „Passwort geändert“ an den Benutzer und Eintrag in die Logdatei.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { demoAn, einstellung, MailFehler, senden, server } from "../_shared/mail.ts";
import { fehlerMeldenServer } from "../_shared/fehler.ts";
import { emailGueltig } from "../_shared/mailadresse.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const antwort = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Antwortzeit für „anfordern“: der Versand läuft im Hintergrund, die Antwort kommt immer nach dieser Zeit
const ANTWORTZEIT_MS = 1200;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** HMAC-SHA256 mit dem Service-Key: gleiche Eingabe → gleiche Prüfsumme, ohne dass die Datenbank Adressen oder IPs kennt */
async function pruefsumme(text: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(text)));
  return Array.from(s, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function verfuegbar(service: SupabaseClient): Promise<boolean> {
  if (await demoAn(service)) return false;
  const e = await einstellung(service);
  if (!(e as { passwort_vergessen?: boolean }).passwort_vergessen) return false;
  return !!(await server(service, e));
}

type Texte = { betreff: string; text: (name: string, link: string) => string; geaendertBetreff: string; geaendert: (name: string) => string };
const TEXTE: Record<"de" | "en", Texte> = {
  de: {
    betreff: "Passwort zurücksetzen",
    text: (app, link) =>
      `Guten Tag,\n\nfür Ihren Zugang zu ${app} wurde ein neues Passwort angefordert. Über diesen Link legen Sie es fest:\n\n${link}\n\n` +
      `Der Link gilt eine Stunde und nur einmal. Haben Sie nichts angefordert, ignorieren Sie diese Mail einfach – Ihr Passwort bleibt, wie es ist.`,
    geaendertBetreff: "Ihr Passwort wurde geändert",
    geaendert: (app) =>
      `Guten Tag,\n\ndas Passwort Ihres Zugangs zu ${app} wurde soeben über „Passwort vergessen“ neu festgelegt. Andere Anmeldungen wurden beendet.\n\n` +
      `Waren Sie das nicht, informieren Sie bitte sofort Ihren Administrator.`,
  },
  en: {
    betreff: "Reset your password",
    text: (app, link) =>
      `Hello,\n\na new password was requested for your ${app} account. Use this link to set it:\n\n${link}\n\n` +
      `The link is valid for one hour and can be used once. If you did not request this, simply ignore this email – your password stays as it is.`,
    geaendertBetreff: "Your password was changed",
    geaendert: (app) =>
      `Hello,\n\nthe password of your ${app} account was just reset via “Forgot password”. Other sessions were logged out.\n\n` +
      `If this was not you, please inform your administrator immediately.`,
  },
};

async function rahmen(service: SupabaseClient) {
  const [{ data: bild }, { data: firma }] = await Promise.all([
    service.from("erscheinungsbild").select("app_name").eq("id", 1).maybeSingle(),
    service.from("firma").select("protokoll_sprache").eq("id", 1).maybeSingle(),
  ]);
  const app = (bild as { app_name?: string } | null)?.app_name || "DulyInspect";
  const sprache = (firma as { protokoll_sprache?: string } | null)?.protokoll_sprache === "en" ? "en" : "de";
  return { app, t: TEXTE[sprache] };
}

const loggen = async (service: SupabaseClient, id: string, aktion: string, details: string) => {
  const { error } = await service.rpc("log_eintragen_fuer", { p_benutzer_id: id, p_aktion: aktion, p_details: details });
  if (error) console.error("Log fehlgeschlagen:", error.message);
};

/** Link erzeugen und verschicken; Fehler nur ins Protokoll, nie an den Anfragenden */
async function linkSenden(service: SupabaseClient, email: string) {
  // eq statt ilike: % und _ in der Eingabe wären sonst Platzhalter
  const { data: b } = await service.from("benutzer").select("*").eq("email", email).maybeSingle();
  const benutzer = b as { id: string; email: string; aktiv: boolean; aktiv_bis: string | null; support?: boolean } | null;
  if (!benutzer?.aktiv || benutzer.support || (benutzer.aktiv_bis && new Date(benutzer.aktiv_bis) <= new Date())) return;

  const { data, error } = await service.auth.admin.generateLink({ type: "recovery", email: benutzer.email });
  if (error || !data?.properties?.hashed_token) {
    console.error("passwort-vergessen: generateLink", error?.message);
    return;
  }
  // Adresse der App: Ziel des Links von GoTrue (GOTRUE_SITE_URL); der Kopf der Anfrage (Origin) ließe sich fälschen
  const ziel = new URL(data.properties.action_link).searchParams.get("redirect_to");
  if (!ziel) {
    console.error("passwort-vergessen: redirect_to fehlt im Link");
    return;
  }
  const app = new URL(ziel);
  app.hash = "";
  app.search = `?wiederherstellen=${encodeURIComponent(data.properties.hashed_token)}`;

  const s = await server(service);
  if (!s) return;
  const { app: name, t } = await rahmen(service);
  try {
    await senden(s, { an: [benutzer.email], betreff: `${name}: ${t.betreff}`, text: t.text(name, app.toString()) });
    await loggen(service, benutzer.id, "Passwort vergessen", "Link zum Zurücksetzen per Mail verschickt");
  } catch (x) {
    await loggen(service, benutzer.id, "Passwort vergessen", `Mail nicht verschickt: ${x instanceof MailFehler ? x.message : "interner Fehler"}`);
    if (!(x instanceof MailFehler)) console.error("passwort-vergessen:", x);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return antwort({ fehler: "Nur POST erlaubt" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return antwort({ fehler: "Ungültige Anfrage" }, 400);
  }

  try {
    if (body.aktion === "verfuegbar") return antwort({ verfuegbar: await verfuegbar(service) });

    if (body.aktion === "anfordern") {
      const start = Date.now();
      const email = String(body.email ?? "").trim().toLowerCase();
      // Client-IP vom Router (Caddyfile setzt X-Real-IP und überschreibt einen mitgeschickten Wert)
      const ip = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unbekannt";
      if (emailGueltig(email) && await verfuegbar(service)) {
        const { data: zugelassen, error } = await service.rpc("passwort_vergessen_zulassen", {
          p_email_hash: await pruefsumme(`email:${email}`),
          p_ip_hash: await pruefsumme(`ip:${ip}`),
        });
        if (error) console.error("passwort-vergessen: Drossel", error.message);
        else if (zugelassen === true) {
          // Im Hintergrund: Antwortzeit verrät nicht, ob die Adresse bekannt ist
          const arbeit = linkSenden(service, email).catch((x) => console.error("passwort-vergessen:", x));
          const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
          if (rt?.waitUntil) rt.waitUntil(arbeit);
          else await arbeit;
        }
      }
      await pause(Math.max(0, ANTWORTZEIT_MS - (Date.now() - start)));
      return antwort({ ok: true });
    }

    if (body.aktion === "geaendert") {
      const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
      const { data: auth } = await service.auth.getUser(token);
      if (!auth.user?.email) return antwort({ fehler: "Nicht angemeldet" }, 401);
      await loggen(service, auth.user.id, "Passwort geändert", "Über „Passwort vergessen“ neu festgelegt, andere Anmeldungen beendet");
      const s = await server(service);
      if (s && !await demoAn(service)) {
        const { app, t } = await rahmen(service);
        await senden(s, { an: [auth.user.email], betreff: `${app}: ${t.geaendertBetreff}`, text: t.geaendert(app) })
          .catch((x) => console.error("passwort-vergessen: Hinweismail", x instanceof Error ? x.message : x));
      }
      return antwort({ ok: true });
    }

    return antwort({ fehler: "Unbekannte Aktion" }, 400);
  } catch (x) {
    console.error("passwort-vergessen:", x);
    await fehlerMeldenServer(service, `passwort-vergessen/${String(body.aktion ?? "")}`, x);
    // Auch bei Störungen keine Aussage über Adressen
    return body.aktion === "anfordern" ? antwort({ ok: true }) : antwort({ fehler: "Interner Fehler" }, 500);
  }
});
