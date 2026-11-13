// Ersteinrichtung: legt den ersten Admin an, solange es noch keinen Zugang gibt (Formular auf der Anmeldeseite).
// Ohne Anmeldung aufrufbar (verify_jwt = false in supabase/config.toml). Sobald ein Zugang existiert, lehnt sie jede Anfrage ab.
// Verlangt den Einrichtungsschlüssel aus intern.einrichtungsschluessel (zeigen die Ausroll-Skripte an) und löscht ihn danach.
//
// POST { schluessel, name, email, passwort, zwei_faktor, verschluesselung?, passwort_aendern? } → { ok: true, verschluesselung: boolean }
// passwort_aendern: Passwort bei der ersten Anmeldung ändern (setzt die Mandanten-Verwaltung, die das Passwort vorgibt).
// `verschluesselung` { instanz_id, schluessel_id, pruefwert }: Kennung der Verschlüsselung (docs/KONZEPT-VERSCHLUESSELUNG.md). Der Browser des
// ersten Admins hat Schlüssel und Instanz-ID erzeugt; hier wird nur die Kennung gespeichert (nie der Schlüssel), aktiv, weil der Bestand leer ist.
// Eine Sperre in der Datenbank (pg_advisory_xact_lock) verhindert, dass zwei gleichzeitige Anfragen zwei Admins anlegen.
import { createClient } from "npm:@supabase/supabase-js@2";
import { fehlerMeldenServer } from "../_shared/fehler.ts";
import postgres from "npm:postgres@3.4.5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MIN_PASSWORT = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SCHLUESSEL_ID = /^[0-9a-f]{16}$/;
// enc1.<Schlüssel-ID>.<IV>.<Geheimtext> (wie ist_geheimtext in der Datenbank)
const GEHEIMTEXT = /^enc1\.([0-9a-f]{16})\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/;

function antwort(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

/** Vergleich in gleicher Laufzeit, egal an welcher Stelle sich die Schlüssel unterscheiden. */
function gleich(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return antwort({ fehler: "Nur POST erlaubt" }, 405);

  let schluessel: string, name: string, email: string, passwort: string, zweiFaktor: boolean, passwortAendern: boolean;
  let kennung: { instanz_id: string; schluessel_id: string; pruefwert: string } | null = null;
  try {
    const b = await req.json();
    // Bindestriche und Leerzeichen beim Abtippen egal, Klein- wie Großbuchstaben
    schluessel = String(b.schluessel ?? "").toUpperCase().replace(/[^0-9A-F]/g, "");
    name = String(b.name ?? "").trim();
    email = String(b.email ?? "").trim().toLowerCase();
    passwort = String(b.passwort ?? "");
    zweiFaktor = b.zwei_faktor === true;
    passwortAendern = b.passwort_aendern === true;
    if (b.verschluesselung != null) {
      const v = b.verschluesselung;
      const k = { instanz_id: String(v.instanz_id ?? "").toLowerCase(), schluessel_id: String(v.schluessel_id ?? ""), pruefwert: String(v.pruefwert ?? "") };
      if (!UUID.test(k.instanz_id) || !SCHLUESSEL_ID.test(k.schluessel_id) || GEHEIMTEXT.exec(k.pruefwert)?.[1] !== k.schluessel_id) return antwort({ fehler: "Ungültige Angaben zur Verschlüsselung." }, 400);
      kennung = k;
    }
  } catch {
    return antwort({ fehler: "Ungültige Anfrage" }, 400);
  }
  if (!name || name.length > 100) return antwort({ fehler: "Bitte einen Namen eintragen." }, 400);
  // Ohne Punkt im Domainteil erlaubt (wie type="email" im Browser), z. B. admin@lokal im Einzel-Image
  if (!/^[^@\s]+@[^@\s.]+(\.[^@\s.]+)*$/.test(email)) return antwort({ fehler: "Bitte eine gültige E-Mail-Adresse eintragen." }, 400);
  if (passwort.length < MIN_PASSWORT) return antwort({ fehler: `Das Passwort braucht mindestens ${MIN_PASSWORT} Zeichen.` }, 400);

  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const db = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1, connect_timeout: 15, idle_timeout: 5, onnotice: () => {} });
  try {
    const ergebnis = await db.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('ersteinrichtung'))`;
      const [{ vorhanden }] = await tx`select exists (select 1 from auth.users) as vorhanden`;
      if (vorhanden) return { fehler: "Die Ersteinrichtung ist bereits abgeschlossen. Bitte anmelden.", status: 409 };
      const [{ tabelle }] = await tx`select to_regclass('intern.einrichtungsschluessel') is not null as tabelle`;
      const [eintrag] = tabelle ? await tx`select schluessel from intern.einrichtungsschluessel limit 1` : [];
      if (!eintrag) return { fehler: "Für diese Instanz ist kein Einrichtungsschlüssel hinterlegt. Bitte beim Betreuer der App melden.", status: 403 };
      if (!gleich(schluessel, eintrag.schluessel)) {
        console.warn("Ersteinrichtung mit falschem Einrichtungsschlüssel abgelehnt");
        return { fehler: "Der Einrichtungsschlüssel stimmt nicht.", status: 403 };
      }

      if (kennung) {
        const [{ vorhanden: tabelleDa }] = await tx`select to_regclass('public.verschluesselung') is not null as vorhanden`;
        if (!tabelleDa) return { fehler: "Diese Datenbank kennt die Verschlüsselung noch nicht. Bitte zuerst die Migrationen einspielen.", status: 400 };
      }
      const { data, error } = await service.auth.admin.createUser({
        email, password: passwort, email_confirm: true, user_metadata: { name }, app_metadata: { rolle: "admin" },
      });
      if (error || !data.user) return { fehler: error?.message ?? "Zugang konnte nicht angelegt werden.", status: 400 };

      // Profil legt ein Trigger an; Rolle, Name und Zwei-Faktor-Pflicht hier setzen (Service-Role darf das)
      const { error: e2 } = await service.from("benutzer").update({ rolle: "admin", name, aktiv: true, zwei_faktor: zweiFaktor }).eq("id", data.user.id);
      if (e2) {
        await service.auth.admin.deleteUser(data.user.id);
        return { fehler: `Zugang konnte nicht eingerichtet werden: ${e2.message}`, status: 500 };
      }
      // Verschlüsselung: nur die Kennung, aktiv (der Bestand ist leer); scheitert das, wird der Zugang wieder entfernt
      if (kennung) {
        try {
          await tx`insert into verschluesselung (id, aktiv, instanz_id, schluessel_id, pruefwert, eingerichtet_von, aktiv_seit)
            values (1, true, ${kennung.instanz_id}::uuid, ${kennung.schluessel_id}, ${kennung.pruefwert}, ${data.user.id}::uuid, now())`;
        } catch (e) {
          console.error("Verschlüsselung konnte nicht eingerichtet werden:", e);
          await service.auth.admin.deleteUser(data.user.id);
          return { fehler: "Die Verschlüsselung konnte nicht eingerichtet werden. Bitte erneut versuchen.", status: 500 };
        }
      }
      if (passwortAendern) {
        const [{ da }] = await tx`select to_regprocedure('public.passwort_aendern_setzen(uuid)') is not null as da`;
        if (!da) {
          await service.auth.admin.deleteUser(data.user.id);
          return { fehler: "Diese Datenbank kennt den Passwortwechsel bei der ersten Anmeldung noch nicht. Bitte zuerst die Migrationen einspielen.", status: 400 };
        }
        await tx`select passwort_aendern_setzen(${data.user.id}::uuid)`;
      }
      // Einmalig: mit dem ersten Admin ist der Schlüssel verbraucht
      await tx`delete from intern.einrichtungsschluessel`;
      return { id: data.user.id };
    });
    if ("fehler" in ergebnis) return antwort({ fehler: ergebnis.fehler }, ergebnis.status);

    const { error } = await service.rpc("log_eintragen_fuer", {
      p_benutzer_id: ergebnis.id, p_aktion: "Ersteinrichtung", p_details: `Erster Admin angelegt: ${email}${zweiFaktor ? " (mit Zwei-Faktor-Anmeldung)" : ""}${kennung ? ", Verschlüsselung eingerichtet" : ""}${passwortAendern ? ", Passwort bei der ersten Anmeldung zu ändern" : ""}`,
    });
    if (error) console.error("Log fehlgeschlagen:", error.message);
    return antwort({ ok: true, verschluesselung: kennung !== null });
  } catch (e) {
    console.error("Ersteinrichtung fehlgeschlagen:", e);
    await fehlerMeldenServer(service, "ersteinrichtung", e);
    return antwort({ fehler: "Die Ersteinrichtung ist fehlgeschlagen. Bitte erneut versuchen." }, 500);
  } finally {
    await db.end({ timeout: 5 });
  }
});
