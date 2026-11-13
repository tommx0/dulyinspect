// Mails der Meldungen (Konzept docs/KONZEPT-MAIL.md, Abschnitt 6): Sammelmail der Fehler, kritische Ergebnisse, neu
// überfällige Prüfungen. Nur Text (kurz, gut lesbar auf dem Telefon), Deutsch oder Englisch. Ohne Abhängigkeiten (Vitest).
import { datum } from "./statusbericht.ts";

type Sprache = "de" | "en";
type Ort = { etikett: string | null; bezeichnung: string | null; typ: string; objekt: string | null; ort: string | null; kunde: string | null };
export type FehlerZeile = { art: "app" | "edge" | "protokoll"; text: string; ort: string | null; version: string | null; anzahl: number; neu: number; zuletzt: string };
export type KritischZeile = Ort & { am: string; ergebnis: "gruen" | "gelb" | "rot" | null; pruefart: string | null; pruefer: string | null; protokoll: string | null; stufe: number | null; maengel: number };
export type UeberfaelligZeile = Ort & { faellig: string; letzte: string | null; pruefart: string };

const anlage = (z: Ort) => [z.etikett, z.bezeichnung].filter(Boolean).join(" · ") || z.typ;
const wo = (z: Ort) => {
  const w = [z.kunde, [z.objekt, z.ort].filter(Boolean).join(", ")].filter(Boolean).join(" / ");
  return w ? ` – ${w}` : "";
};
const fuss = (s: Sprache, link: string | null, pfad: string) =>
  [link ? `\n${s === "de" ? "In der App" : "In the app"}: ${link.replace(/\/$/, "")}/#/${pfad}` : "",
    `\n--\n${s === "de" ? "Diese Meldungen stellt der Admin unter Einstellungen → Mail ein." : "The admin configures these notifications under Einstellungen → Mail."}`].join("");

const ART = { de: { app: "App", edge: "Server", protokoll: "Protokoll-PDF" }, en: { app: "App", edge: "Server", protokoll: "Report PDF" } };
const ERGEBNIS = { de: { gruen: "ohne Mängel", gelb: "mit Mängeln", rot: "nicht betriebssicher" }, en: { gruen: "no defects", gelb: "with defects", rot: "not safe to operate" } };

export function fehlerMail(liste: FehlerZeile[], app: string, s: Sprache, link: string | null) {
  const n = liste.length;
  const betreff = s === "de" ? `${app}: ${n} ${n === 1 ? "neuer Fehler" : "neue Fehler"}` : `${app}: ${n} new ${n === 1 ? "error" : "errors"}`;
  const kopf = s === "de"
    ? "Seit der letzten Meldung sind diese Fehler neu oder wieder aufgetreten (je Fehler: wie oft neu / insgesamt):"
    : "These errors are new or occurred again since the last notification (per error: new / total occurrences):";
  const zeilen = liste.map((f) =>
    `- [${ART[s][f.art]}] ${f.text}\n  ${f.neu}/${f.anzahl}×, ${s === "de" ? "zuletzt" : "last"} ${datum(f.zuletzt, s)}${f.ort ? `, ${f.ort}` : ""}${f.version ? `, ${f.version}` : ""}`);
  return { betreff, text: `${kopf}\n\n${zeilen.join("\n")}\n${fuss(s, link, "einstellungen/fehlerprotokoll")}` };
}

export function kritischMail(liste: KritischZeile[], app: string, s: Sprache, link: string | null) {
  const n = liste.length;
  const betreff = s === "de"
    ? `${app}: ${n} ${n === 1 ? "Prüfung" : "Prüfungen"} mit kritischem Ergebnis`
    : `${app}: ${n} ${n === 1 ? "inspection" : "inspections"} with a critical result`;
  const kopf = s === "de" ? "Diese Prüfungen wurden mit kritischem Ergebnis abgeschlossen:" : "These inspections were completed with a critical result:";
  const zeilen = liste.map((z) => {
    const e = z.ergebnis ? ERGEBNIS[s][z.ergebnis] : "–";
    const m = z.maengel ? (s === "de" ? `, ${z.maengel} Mängel (höchste Stufe ${z.stufe})` : `, ${z.maengel} defects (highest level ${z.stufe})`) : "";
    return `- ${datum(z.am, s)} ${anlage(z)}${z.pruefart ? ` (${z.pruefart})` : ""}: ${e}${m}${z.protokoll ? `, ${s === "de" ? "Protokoll" : "report"} ${z.protokoll}` : ""}${wo(z)}`;
  });
  return { betreff, text: `${kopf}\n\n${zeilen.join("\n")}\n${fuss(s, link, "maengel")}` };
}

export function ueberfaelligMail(liste: UeberfaelligZeile[], app: string, s: Sprache, link: string | null) {
  const n = liste.length;
  const betreff = s === "de"
    ? `${app}: ${n} ${n === 1 ? "Prüfung ist" : "Prüfungen sind"} seit heute überfällig`
    : `${app}: ${n} ${n === 1 ? "inspection is" : "inspections are"} now overdue`;
  const kopf = s === "de" ? "Diese Prüfungen sind neu überfällig:" : "These inspections have become overdue:";
  const zeilen = liste.map((z) => `- ${s === "de" ? "fällig" : "due"} ${datum(z.faellig, s)} ${anlage(z)} (${z.pruefart})${wo(z)}`);
  return { betreff, text: `${kopf}\n\n${zeilen.join("\n")}\n${fuss(s, link, "faelligkeiten")}` };
}
