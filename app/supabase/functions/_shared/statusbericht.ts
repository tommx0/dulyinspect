// Statusmail aus dem Ergebnis von statusbericht() (Migration 20261204090000): Betreff, Text, HTML und CSV in Deutsch oder
// Englisch (firma.protokoll_sprache). Ohne Abhängigkeiten (Vitest: statusbericht.test.ts).
// Kunde und Objekt liefert die Datenbank nur im Klartext; bei eingeschalteter Verschlüsselung fehlen sie, dann verweist
// die Mail auf die App.

export type Pruefung = {
  am: string; ergebnis: "gruen" | "gelb" | "rot" | null; protokoll: string | null; pruefart: string | null; pruefer: string | null;
  maengel: number; stufe: number | null; etikett: string | null; bezeichnung: string | null; typ: string;
  objekt: string | null; ort: string | null; kunde: string | null;
};
export type Faellig = {
  faellig: string; letzte: string | null; pruefart: string; etikett: string | null; bezeichnung: string | null; typ: string;
  objekt: string | null; ort: string | null; kunde: string | null;
};
export type Bericht = {
  pruefungen: Pruefung[];
  ueberfaellig: Faellig[];
  demnaechst: Faellig[];
  kennzahlen: {
    pruefungen: number; gruen: number; gelb: number; rot: number; maengel_neu: Record<"1" | "2" | "3", number>;
    maengel_offen: number; ueberfaellig: number; demnaechst: number; nie_geprueft: number; verschluesselt: boolean;
  };
};
export type Rahmen = {
  app: string;
  sprache: "de" | "en";
  /** Erster Tag des Zeitraums, letzter Tag des Zeitraums, letzter Tag der Vorschau (JJJJ-MM-TT, deutsche Zeit) */
  von: string; bis: string; vorschauBis: string;
  /** Adresse der App (für Links), ohne # */
  adresse: string | null;
};

/** Höchstens so viele Zeilen je Tabelle in der Mail; alle stehen in der CSV */
export const MAX_ZEILEN = 200;

const T = {
  de: {
    betreff: (r: Rahmen, k: Bericht["kennzahlen"]) =>
      `${r.app} Statusbericht ${datum(r.von, "de")}–${datum(r.bis, "de")}: ${k.pruefungen} ${k.pruefungen === 1 ? "Prüfung" : "Prüfungen"}` +
      (k.ueberfaellig ? `, ${k.ueberfaellig} überfällig` : ""),
    titel: "Statusbericht",
    zeitraum: (r: Rahmen) => `Zeitraum ${datum(r.von, "de")} bis ${datum(r.bis, "de")}`,
    kennzahlen: "Überblick",
    pruefungenK: "Prüfungen im Zeitraum",
    ergebnisse: (k: Bericht["kennzahlen"]) => `${k.gruen} ohne Mängel, ${k.gelb} mit Mängeln, ${k.rot} nicht betriebssicher`,
    maengelNeu: "Neue Mängel (Stufe 1 / 2 / 3)",
    maengelOffen: "Offene Mängel insgesamt",
    ueberfaelligK: "Überfällige Prüfungen",
    demnaechstK: (r: Rahmen) => `Fällig bis ${datum(r.vorschauBis, "de")}`,
    nie: "Noch nie geprüft",
    abgeschlossen: "Abgeschlossene Prüfungen",
    ueberfaellig: "Überfällig",
    demnaechst: (r: Rahmen) => `Fällig im nächsten Zeitraum (bis ${datum(r.vorschauBis, "de")})`,
    keine: "Keine.",
    weitere: (n: number) => `… und ${n} weitere, siehe CSV-Anhang oder App.`,
    spalten: { datum: "Datum", anlage: "Anlage", pruefart: "Prüfart", ergebnis: "Ergebnis", maengel: "Mängel", pruefer: "Prüfer",
      protokoll: "Protokoll", ort: "Kunde / Objekt", faellig: "Fällig am", letzte: "Zuletzt geprüft", bereich: "Bereich" },
    ergebnis: { gruen: "ohne Mängel", gelb: "mit Mängeln", rot: "nicht betriebssicher" },
    verschluesselt: "Kunden- und Objektnamen sind verschlüsselt und stehen deshalb nicht in dieser Mail. Die Anlage finden Sie in der App über das Etikett.",
    oeffnen: "In der App öffnen",
    fuss: "Diese Mail verschickt die App im eingestellten Intervall. Abbestellen oder Empfänger ändern: Admin unter Einstellungen → Mail.",
    csv: "statusbericht",
  },
  en: {
    betreff: (r: Rahmen, k: Bericht["kennzahlen"]) =>
      `${r.app} status report ${datum(r.von, "en")}–${datum(r.bis, "en")}: ${k.pruefungen} ${k.pruefungen === 1 ? "inspection" : "inspections"}` +
      (k.ueberfaellig ? `, ${k.ueberfaellig} overdue` : ""),
    titel: "Status report",
    zeitraum: (r: Rahmen) => `Period ${datum(r.von, "en")} to ${datum(r.bis, "en")}`,
    kennzahlen: "Overview",
    pruefungenK: "Inspections in the period",
    ergebnisse: (k: Bericht["kennzahlen"]) => `${k.gruen} no defects, ${k.gelb} with defects, ${k.rot} not safe to operate`,
    maengelNeu: "New defects (level 1 / 2 / 3)",
    maengelOffen: "Open defects in total",
    ueberfaelligK: "Overdue inspections",
    demnaechstK: (r: Rahmen) => `Due by ${datum(r.vorschauBis, "en")}`,
    nie: "Never inspected",
    abgeschlossen: "Completed inspections",
    ueberfaellig: "Overdue",
    demnaechst: (r: Rahmen) => `Due in the next period (by ${datum(r.vorschauBis, "en")})`,
    keine: "None.",
    weitere: (n: number) => `… and ${n} more, see the CSV attachment or the app.`,
    spalten: { datum: "Date", anlage: "System", pruefart: "Inspection type", ergebnis: "Result", maengel: "Defects", pruefer: "Inspector",
      protokoll: "Report", ort: "Customer / site", faellig: "Due on", letzte: "Last inspected", bereich: "Section" },
    ergebnis: { gruen: "no defects", gelb: "with defects", rot: "not safe to operate" },
    verschluesselt: "Customer and site names are encrypted and therefore not included in this email. Find the system in the app by its label.",
    oeffnen: "Open in the app",
    fuss: "The app sends this email at the configured interval. To unsubscribe or change recipients: admin under Einstellungen → Mail.",
    csv: "status-report",
  },
};

/** JJJJ-MM-TT oder ISO-Zeitpunkt → 13.11.2026 bzw. 13 Nov 2026 */
export function datum(s: string, sprache: "de" | "en"): string {
  const [j, m, t] = s.slice(0, 10).split("-").map(Number);
  if (sprache === "de") return `${String(t).padStart(2, "0")}.${String(m).padStart(2, "0")}.${j}`;
  return `${t} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${j}`;
}

const html = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const anlage = (z: { etikett: string | null; bezeichnung: string | null; typ: string }) =>
  [z.etikett, z.bezeichnung].filter(Boolean).join(" · ") || z.typ;
const wo = (z: { kunde: string | null; objekt: string | null; ort: string | null }) =>
  [z.kunde, [z.objekt, z.ort].filter(Boolean).join(", ")].filter(Boolean).join(" / ");

/** CSV-Zelle für Tabellenkalkulationen: Formeln entschärfen (=, +, -, @ am Anfang), Trennzeichen und Anführungszeichen */
export function csvZelle(v: unknown): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function statusmail(b: Bericht, r: Rahmen) {
  const t = T[r.sprache];
  const k = b.kennzahlen;
  const erg = (e: Pruefung["ergebnis"]) => (e ? t.ergebnis[e] : "–");
  const mitOrt = !k.verschluesselt || [...b.pruefungen, ...b.ueberfaellig, ...b.demnaechst].some((z) => z.kunde || z.objekt);
  const link = (pfad: string) => (r.adresse ? `${r.adresse.replace(/\/$/, "")}/#/${pfad}` : null);

  // --- Text ---
  const zeilen: string[] = [`${r.app}: ${t.titel}`, t.zeitraum(r), ""];
  zeilen.push(`${t.pruefungenK}: ${k.pruefungen} (${t.ergebnisse(k)})`);
  zeilen.push(`${t.maengelNeu}: ${k.maengel_neu["1"]} / ${k.maengel_neu["2"]} / ${k.maengel_neu["3"]}`);
  zeilen.push(`${t.maengelOffen}: ${k.maengel_offen}`, `${t.ueberfaelligK}: ${k.ueberfaellig}`, `${t.demnaechstK(r)}: ${k.demnaechst}`);
  if (k.nie_geprueft) zeilen.push(`${t.nie}: ${k.nie_geprueft}`);
  if (k.verschluesselt) zeilen.push("", t.verschluesselt);
  const textListe = <Z>(titel: string, liste: Z[], f: (z: Z) => string) => {
    zeilen.push("", `${titel} (${liste.length})`);
    if (!liste.length) zeilen.push(t.keine);
    for (const z of liste.slice(0, MAX_ZEILEN)) zeilen.push(`- ${f(z)}`);
    if (liste.length > MAX_ZEILEN) zeilen.push(t.weitere(liste.length - MAX_ZEILEN));
  };
  const ortText = (z: { kunde: string | null; objekt: string | null; ort: string | null }) => (mitOrt && wo(z) ? ` – ${wo(z)}` : "");
  textListe(t.abgeschlossen, b.pruefungen, (z) =>
    `${datum(z.am, r.sprache)} ${anlage(z)}${z.pruefart ? ` (${z.pruefart})` : ""}: ${erg(z.ergebnis)}${z.maengel ? `, ${t.spalten.maengel} ${z.maengel}` : ""}${ortText(z)}`);
  textListe(t.ueberfaellig, b.ueberfaellig, (z) => `${datum(z.faellig, r.sprache)} ${anlage(z)} (${z.pruefart})${ortText(z)}`);
  textListe(t.demnaechst(r), b.demnaechst, (z) => `${datum(z.faellig, r.sprache)} ${anlage(z)} (${z.pruefart})${ortText(z)}`);
  if (link("faelligkeiten")) zeilen.push("", `${t.oeffnen}: ${link("faelligkeiten")}`);
  zeilen.push("", "--", t.fuss);

  // --- HTML ---
  const zelle = "padding:4px 8px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top";
  const kopf = "padding:4px 8px;border-bottom:2px solid #cbd5e1;text-align:left;font-weight:600;background:#f8fafc";
  const farbe = { gruen: "#047857", gelb: "#b45309", rot: "#b91c1c" };
  const tabelle = (titel: string, spalten: string[], liste: string[][], gesamt: number) =>
    `<h2 style="font-size:16px;margin:24px 0 8px">${html(titel)} (${gesamt})</h2>` +
    (gesamt === 0 ? `<p style="color:#64748b">${html(t.keine)}</p>`
      : `<table style="border-collapse:collapse;font-size:13px;width:100%"><thead><tr>${spalten.map((s) => `<th style="${kopf}">${html(s)}</th>`).join("")}</tr></thead>` +
        `<tbody>${liste.map((z) => `<tr>${z.map((c) => `<td style="${zelle}">${c}</td>`).join("")}</tr>`).join("")}</tbody></table>` +
        (gesamt > MAX_ZEILEN ? `<p style="color:#64748b">${html(t.weitere(gesamt - MAX_ZEILEN))}</p>` : ""));
  const s = t.spalten;
  const ortSp = mitOrt ? [s.ort] : [];
  const ortZ = (z: { kunde: string | null; objekt: string | null; ort: string | null }) => (mitOrt ? [html(wo(z))] : []);
  const kz = (name: string, wert: unknown) => `<tr><td style="${zelle}">${html(name)}</td><td style="${zelle};font-weight:600">${html(wert)}</td></tr>`;
  const html_ = `<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;max-width:900px">` +
    `<h1 style="font-size:20px;margin:0 0 4px">${html(r.app)}: ${html(t.titel)}</h1><p style="margin:0;color:#475569">${html(t.zeitraum(r))}</p>` +
    `<h2 style="font-size:16px;margin:24px 0 8px">${html(t.kennzahlen)}</h2><table style="border-collapse:collapse;font-size:14px">` +
    kz(t.pruefungenK, `${k.pruefungen} (${t.ergebnisse(k)})`) +
    kz(t.maengelNeu, `${k.maengel_neu["1"]} / ${k.maengel_neu["2"]} / ${k.maengel_neu["3"]}`) +
    kz(t.maengelOffen, k.maengel_offen) + kz(t.ueberfaelligK, k.ueberfaellig) + kz(t.demnaechstK(r), k.demnaechst) +
    (k.nie_geprueft ? kz(t.nie, k.nie_geprueft) : "") + `</table>` +
    (k.verschluesselt ? `<p style="margin-top:12px;padding:8px;background:#f1f5f9;border-radius:4px;font-size:13px">${html(t.verschluesselt)}</p>` : "") +
    tabelle(t.abgeschlossen, [s.datum, s.anlage, s.pruefart, s.ergebnis, s.maengel, s.pruefer, s.protokoll, ...ortSp],
      b.pruefungen.slice(0, MAX_ZEILEN).map((z) => [html(datum(z.am, r.sprache)), html(anlage(z)), html(z.pruefart ?? ""),
        `<span style="color:${z.ergebnis ? farbe[z.ergebnis] : "#64748b"};font-weight:600">${html(erg(z.ergebnis))}</span>`,
        html(z.maengel ? `${z.maengel}${z.stufe ? ` (max. ${z.stufe})` : ""}` : "–"), html(z.pruefer ?? ""), html(z.protokoll ?? ""), ...ortZ(z)]),
      b.pruefungen.length) +
    tabelle(t.ueberfaellig, [s.faellig, s.anlage, s.pruefart, s.letzte, ...ortSp],
      b.ueberfaellig.slice(0, MAX_ZEILEN).map((z) => [`<span style="color:#b91c1c;font-weight:600">${html(datum(z.faellig, r.sprache))}</span>`,
        html(anlage(z)), html(z.pruefart), html(z.letzte ? datum(z.letzte, r.sprache) : "–"), ...ortZ(z)]),
      b.ueberfaellig.length) +
    tabelle(t.demnaechst(r), [s.faellig, s.anlage, s.pruefart, s.letzte, ...ortSp],
      b.demnaechst.slice(0, MAX_ZEILEN).map((z) => [html(datum(z.faellig, r.sprache)), html(anlage(z)), html(z.pruefart),
        html(z.letzte ? datum(z.letzte, r.sprache) : "–"), ...ortZ(z)]),
      b.demnaechst.length) +
    (link("faelligkeiten") ? `<p style="margin-top:24px"><a href="${html(link("faelligkeiten"))}" style="color:#0f172a;font-weight:600">${html(t.oeffnen)}</a></p>` : "") +
    `<p style="margin-top:24px;color:#64748b;font-size:12px">${html(t.fuss)}</p></body></html>`;

  // --- CSV (alle Zeilen, Semikolon, mit BOM für Excel) ---
  const csvKopf = [s.bereich, s.datum, "Etikett", s.anlage, s.pruefart, s.ergebnis, s.maengel, s.pruefer, s.protokoll, s.letzte,
    r.sprache === "de" ? "Kunde" : "Customer", r.sprache === "de" ? "Objekt" : "Site", r.sprache === "de" ? "Ort" : "Town"];
  const csvZeilen: unknown[][] = [
    ...b.pruefungen.map((z) => [t.abgeschlossen, z.am.slice(0, 10), z.etikett, z.bezeichnung ?? z.typ, z.pruefart, erg(z.ergebnis), z.maengel,
      z.pruefer, z.protokoll, "", z.kunde, z.objekt, z.ort]),
    ...b.ueberfaellig.map((z) => [t.ueberfaellig, z.faellig, z.etikett, z.bezeichnung ?? z.typ, z.pruefart, "", "", "", "", z.letzte, z.kunde, z.objekt, z.ort]),
    ...b.demnaechst.map((z) => [t.demnaechst(r), z.faellig, z.etikett, z.bezeichnung ?? z.typ, z.pruefart, "", "", "", "", z.letzte, z.kunde, z.objekt, z.ort]),
  ];
  const csv = "﻿" + [csvKopf, ...csvZeilen].map((z) => z.map(csvZelle).join(";")).join("\r\n") + "\r\n";

  return {
    betreff: t.betreff(r, k),
    text: zeilen.join("\n"),
    html: html_,
    csv,
    csvName: `${t.csv}-${r.von}-${r.bis}.csv`,
  };
}
