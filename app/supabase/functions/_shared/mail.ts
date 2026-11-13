// Gemeinsamer Mailversand der Edge Functions (Konzept docs/KONZEPT-MAIL.md).
//
// Mailserver: mail_einstellung.quelle = "eigen" (in der App eingetragen, Passwort verschlüsselt in intern.mail_geheim)
// oder "zentral" (Mailserver des Betreibers aus der Umgebung). Umgebung der Edge Functions:
//   MAIL_SCHLUESSEL        32 Byte Base64, verschlüsselt das Passwort des eigenen Mailservers (AES-GCM)
//   MAIL_ZENTRAL_HOST, MAIL_ZENTRAL_PORT, MAIL_ZENTRAL_SICHERHEIT (tls | starttls | keine), MAIL_ZENTRAL_BENUTZER,
//   MAIL_ZENTRAL_PASSWORT, MAIL_ZENTRAL_ABSENDER (Adresse; Name kommt vom Mandanten)
//   MAIL_INTERNE_ZIELE=ja  private Netze als Mailserver erlauben (nur lokal/Einzelinstanz im eigenen LAN), Loopback nie
//
// Verbunden wird mit der geprüften IP-Adresse, der Name dient nur der Zertifikatsprüfung: So kann der Name zwischen
// Prüfung und Verbindung nicht auf eine interne Adresse umgebogen werden.
import nodemailer from "npm:nodemailer@10.5.0";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { fehlerOhneGeheimnis, type Sicherheit, SICHERHEITEN, zielErlaubt } from "./mailadresse.ts";

export type Server = {
  host: string;
  port: number;
  sicherheit: Sicherheit;
  benutzer: string | null;
  passwort: string | null;
  absender: string;
  absenderName: string | null;
  antwortAn: string | null;
};

export type Einstellung = {
  quelle: "aus" | "zentral" | "eigen";
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_sicherheit: Sicherheit;
  smtp_benutzer: string | null;
  absender_adresse: string | null;
  absender_name: string | null;
  zuletzt_getestet_am: string | null;
  zuletzt_test_ok: boolean | null;
};

export class MailFehler extends Error {}

const env = (k: string) => Deno.env.get(k)?.trim() || null;
export const interneErlaubt = () => env("MAIL_INTERNE_ZIELE") === "ja";

/** Zentraler Mailserver des Betreibers, falls vollständig eingetragen */
export function zentral(): Omit<Server, "absenderName" | "antwortAn"> | null {
  const host = env("MAIL_ZENTRAL_HOST"), absender = env("MAIL_ZENTRAL_ABSENDER");
  if (!host || !absender) return null;
  const sicherheit = (env("MAIL_ZENTRAL_SICHERHEIT") ?? "starttls") as Sicherheit;
  const port = Number(env("MAIL_ZENTRAL_PORT") ?? (sicherheit === "tls" ? 465 : 587));
  if (!SICHERHEITEN.includes(sicherheit) || !Number.isInteger(port)) return null;
  return { host, port, sicherheit, benutzer: env("MAIL_ZENTRAL_BENUTZER"), passwort: env("MAIL_ZENTRAL_PASSWORT"), absender };
}

// --- Passwort des eigenen Mailservers (AES-GCM, Format mail1.<iv>.<geheimtext>) ---

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const schluesselVorhanden = () => {
  try {
    return unb64(env("MAIL_SCHLUESSEL") ?? "").length === 32;
  } catch {
    return false;
  }
};

async function schluessel(): Promise<CryptoKey> {
  if (!schluesselVorhanden()) throw new MailFehler("Mail-Schlüssel fehlt in der Umgebung (MAIL_SCHLUESSEL), bitte den Betreiber fragen");
  return crypto.subtle.importKey("raw", unb64(env("MAIL_SCHLUESSEL")!), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function verschluesseln(klartext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await schluessel(), new TextEncoder().encode(klartext)));
  return `mail1.${b64(iv)}.${b64(ct)}`;
}

export async function entschluesseln(geheim: string): Promise<string> {
  const [art, iv, ct] = geheim.split(".");
  if (art !== "mail1" || !iv || !ct) throw new MailFehler("Gespeichertes Passwort hat ein unbekanntes Format");
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await schluessel(), unb64(ct));
    return new TextDecoder().decode(pt);
  } catch {
    throw new MailFehler("Gespeichertes Passwort lässt sich nicht entschlüsseln (Mail-Schlüssel geändert?), bitte neu eingeben");
  }
}

// --- Einstellung und Server ---

export async function einstellung(service: SupabaseClient): Promise<Einstellung> {
  const { data, error } = await service.from("mail_einstellung").select("*").eq("id", 1).single();
  if (error || !data) throw new Error(`Mail-Einstellung nicht lesbar: ${error?.message ?? "fehlt"}`);
  return data as Einstellung;
}

/** Server für den Versand nach der Einstellung; null, wenn Mail aus ist bzw. der zentrale Server fehlt */
export async function server(service: SupabaseClient, e?: Einstellung): Promise<Server | null> {
  const s = e ?? await einstellung(service);
  if (s.quelle === "zentral") {
    const z = zentral();
    return z && { ...z, absenderName: s.absender_name, antwortAn: s.absender_adresse };
  }
  if (s.quelle === "eigen" && s.smtp_host && s.smtp_port && s.absender_adresse) {
    const { data: geheim, error } = await service.rpc("mail_passwort_lesen");
    if (error) throw new Error(`Mail-Passwort nicht lesbar: ${error.message}`);
    return {
      host: s.smtp_host,
      port: s.smtp_port,
      sicherheit: s.smtp_sicherheit,
      benutzer: s.smtp_benutzer,
      passwort: geheim ? await entschluesseln(String(geheim)) : null,
      absender: s.absender_adresse,
      absenderName: s.absender_name,
      antwortAn: null,
    };
  }
  return null;
}

/** Name auflösen und die erste erlaubte Adresse liefern; sonst MailFehler */
export async function adressePruefen(host: string): Promise<string> {
  // Namen ohne Punkt (db, router, edge, inbucket …) gibt es nur im Docker-Netz
  if (!host.includes(".") && !host.includes(":") && !interneErlaubt()) {
    throw new MailFehler(`Mailserver „${host}“ zeigt auf eine interne Adresse, das ist nicht erlaubt`);
  }
  let ips: string[] = [];
  if (/^[\d.]+$/.test(host) || host.includes(":")) ips = [host];
  else {
    for (const art of ["A", "AAAA"] as const) {
      try {
        ips.push(...await Deno.resolveDns(host, art));
      } catch { /* kein Eintrag dieser Art */ }
    }
  }
  if (!ips.length) throw new MailFehler(`Mailserver „${host}“ nicht gefunden`);
  // Alle Adressen prüfen: Ein Name mit einer öffentlichen und einer internen Adresse wird abgewiesen
  if (!ips.every((ip) => zielErlaubt(ip, interneErlaubt()))) {
    throw new MailFehler(`Mailserver „${host}“ zeigt auf eine interne Adresse, das ist nicht erlaubt`);
  }
  return ips[0];
}

export type Nachricht = {
  an: string[];
  betreff: string;
  text: string;
  html?: string;
  anhaenge?: { dateiname: string; inhalt: string; typ?: string }[];
};

/** Mail senden; wirft MailFehler mit lesbarer Meldung (ohne Zugangsdaten) */
export async function senden(s: Server, n: Nachricht): Promise<void> {
  if (/[\r\n]/.test(n.betreff)) throw new MailFehler("Ungültiger Betreff");
  const ip = await adressePruefen(s.host);
  const transport = nodemailer.createTransport({
    host: ip,
    port: s.port,
    secure: s.sicherheit === "tls",
    requireTLS: s.sicherheit === "starttls",
    ignoreTLS: s.sicherheit === "keine",
    tls: { servername: /^[\d.:]+$/.test(s.host) ? undefined : s.host, minVersion: "TLSv1.2" },
    auth: s.benutzer ? { user: s.benutzer, pass: s.passwort ?? "" } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  try {
    await transport.sendMail({
      from: s.absenderName ? { name: s.absenderName, address: s.absender } : s.absender,
      replyTo: s.antwortAn ?? undefined,
      to: n.an,
      subject: n.betreff,
      text: n.text,
      html: n.html,
      attachments: n.anhaenge?.map((a) => ({ filename: a.dateiname, content: a.inhalt, contentType: a.typ })),
    });
  } catch (e) {
    const text = fehlerOhneGeheimnis(e instanceof Error ? e.message : String(e), [s.passwort, s.benutzer]);
    // IP statt Name in Meldungen von nodemailer wieder durch den Namen ersetzen
    throw new MailFehler(`Versand fehlgeschlagen: ${text.split(ip).join(s.host)}`);
  } finally {
    transport.close();
  }
}

/** Ist der Demomodus an, verschickt die Instanz keine Mails */
export async function demoAn(service: SupabaseClient): Promise<boolean> {
  const { data } = await service.rpc("demo_modus");
  return data === true;
}
