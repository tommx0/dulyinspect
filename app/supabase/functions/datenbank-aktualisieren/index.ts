// Datenbank-Update aus der App (Update-Assistent auf dem Bildschirm „Update wird eingespielt“).
// Führt fehlende Migrationen aus, die die App mitbringt – aber nur, wenn sie vom Entwickler signiert sind
// (Ed25519 über "<version>\n<name>\n<sql>", siehe scripts/migrationen.mjs). Eigenes SQL lässt sich so nicht einschleusen.
//
// POST { migrationen: [{ version, name, sql, signatur }] } → { eingespielt: ["<version>_<name>", …], stand }
// Nur aktive Admins, bei Pflicht zur Zwei-Faktor-Anmeldung mit bestätigtem zweiten Faktor.
// Jede Migration läuft in einer eigenen Transaktion als Rolle postgres (SUPABASE_DB_URL) und wird in
// supabase_migrations.schema_migrations eingetragen – wie bei „supabase db push“ und scripts/ausrollen-coolify.mjs.
import { createClient } from "npm:@supabase/supabase-js@2";
import postgres from "npm:postgres@3.4.5";
import { OEFFENTLICHER_SCHLUESSEL } from "./schluessel.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Migration = { version: string; name: string; sql: string; signatur: string };

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

const gueltig = (m: unknown): m is Migration => {
  const x = m as Partial<Migration>;
  return typeof x?.version === "string" && /^\d{14}$/.test(x.version) && typeof x.name === "string" && /^[a-z0-9_]+$/i.test(x.name)
    && typeof x.sql === "string" && typeof x.signatur === "string";
};

async function signiert(m: Migration): Promise<boolean> {
  const schluessel = await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: OEFFENTLICHER_SCHLUESSEL }, { name: "Ed25519" }, false, ["verify"]);
  try {
    const signatur = Uint8Array.from(atob(m.signatur), (z) => z.charCodeAt(0));
    return await crypto.subtle.verify({ name: "Ed25519" }, schluessel, signatur, new TextEncoder().encode(`${m.version}\n${m.name}\n${m.sql}`));
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return antwort({ fehler: "Nur POST erlaubt" }, 405);

  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Aufrufer prüfen: angemeldet, aktiv, Admin, ggf. mit zweitem Faktor. „*“, weil die Spalten je nach Datenbankstand fehlen können.
  const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  const { data: auth } = await service.auth.getUser(token);
  if (!auth.user) return antwort({ fehler: "Nicht angemeldet" }, 401);
  const { data: aufrufer } = await service.from("benutzer").select("*").eq("id", auth.user.id).single();
  const a = aufrufer as { rolle?: string; aktiv?: boolean; aktiv_bis?: string | null; zwei_faktor?: boolean } | null;
  if (!a?.aktiv || a.rolle !== "admin") return antwort({ fehler: "Nur für Admins" }, 403);
  // Supportzugang: nur innerhalb der Freischaltung
  if (a.aktiv_bis && new Date(a.aktiv_bis) <= new Date()) return antwort({ fehler: "Nur für Admins" }, 403);
  if (a.zwei_faktor && stufe(token) !== "aal2") return antwort({ fehler: "Bitte zuerst mit dem zweiten Faktor anmelden" }, 403);

  let liste: Migration[];
  try {
    const body = await req.json();
    if (!Array.isArray(body?.migrationen) || body.migrationen.length > 500 || !body.migrationen.every(gueltig)) throw new Error();
    liste = [...body.migrationen].sort((x: Migration, y: Migration) => x.version.localeCompare(y.version));
  } catch {
    return antwort({ fehler: "Ungültige Anfrage" }, 400);
  }

  // Erst alle Signaturen prüfen, dann ausführen – eine falsche Signatur bricht ab, bevor etwas geändert wird
  const falsch = [];
  for (const m of liste) if (!await signiert(m)) falsch.push(`${m.version}_${m.name}`);
  if (falsch.length) return antwort({ fehler: `Signatur ungültig: ${falsch.join(", ")}. Es wurde nichts geändert.` }, 400);

  const db = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1, connect_timeout: 15, idle_timeout: 5, onnotice: () => {} });
  const eingespielt: string[] = [];
  let aktuell = "";
  try {
    await db.unsafe(`create schema if not exists supabase_migrations;
      create table if not exists supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text);`);
    for (const m of liste) {
      aktuell = `${m.version}_${m.name}`;
      // Sperre in der Transaktion (auch mit Transaktions-Pooler): zwei gleichzeitige Klicks spielen nichts doppelt ein
      const neu = await db.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtext('datenbank-aktualisieren'))`;
        const vorhanden = await tx`select 1 from supabase_migrations.schema_migrations where version = ${m.version}`;
        if (vorhanden.length) return false;
        await tx.unsafe(m.sql);
        await tx`insert into supabase_migrations.schema_migrations (version, name, statements) values (${m.version}, ${m.name}, ${[m.sql]})`;
        return true;
      });
      if (neu) eingespielt.push(aktuell);
    }
    const [{ stand }] = await db`select max(version) as stand from supabase_migrations.schema_migrations`;
    if (eingespielt.length) {
      const { error } = await service.rpc("log_eintragen_fuer", {
        p_benutzer_id: auth.user.id, p_aktion: "Datenbank aktualisiert", p_details: `${eingespielt.join(", ")} · Stand ${stand}`,
      });
      if (error) console.error("Log fehlgeschlagen:", error.message);
    }
    return antwort({ eingespielt, stand });
  } catch (e) {
    const meldung = e instanceof Error ? e.message : String(e);
    console.error(`Migration ${aktuell} fehlgeschlagen:`, meldung);
    return antwort({ fehler: `Migration ${aktuell} fehlgeschlagen (zurückgerollt): ${meldung}`, eingespielt }, 500);
  } finally {
    await db.end({ timeout: 5 });
  }
});
