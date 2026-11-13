// Termine der Statusmail in deutscher Zeit (Europe/Berlin), ohne Abhängigkeiten (auch in Vitest: termin.test.ts).
// Ein Termin ist ein Zeitpunkt: täglich zur Uhrzeit, wöchentlich am Wochentag (1 = Montag … 7 = Sonntag) zur Uhrzeit oder
// monatlich am Tag (1–28) zur Uhrzeit. Fällt die Uhrzeit in die Lücke der Zeitumstellung (März, 02:00–03:00), gilt die
// erste gültige Minute danach; in der doppelten Stunde (Oktober) die erste.

export type Intervall = "taeglich" | "woechentlich" | "monatlich";
export type Plan = { intervall: Intervall; wochentag: number; monatstag: number; uhrzeit: string };
type Tag = { jahr: number; monat: number; tag: number };

const ZONE = "Europe/Berlin";
const FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

/** Datum und Uhrzeit eines Zeitpunkts in deutscher Zeit */
export function berlin(d: Date) {
  const t = Object.fromEntries(FORMAT.formatToParts(d).map((p) => [p.type, p.value]));
  const jahr = Number(t.year), monat = Number(t.month), tag = Number(t.day);
  const wt = new Date(Date.UTC(jahr, monat - 1, tag)).getUTCDay();
  return { jahr, monat, tag, stunde: Number(t.hour), minute: Number(t.minute), sekunde: Number(t.second), wochentag: wt === 0 ? 7 : wt };
}

/** Zeitpunkt zu einer Uhrzeit in deutscher Zeit (Lücke im März: erste gültige Minute danach) */
export function zeitpunkt(t: Tag, stunde: number, minute: number): Date {
  const lokal = Date.UTC(t.jahr, t.monat - 1, t.tag, stunde, minute);
  // Beide möglichen Versätze probieren (Winter +1 h, Sommer +2 h), den passenden nehmen
  const kandidaten = [lokal - 3600_000, lokal - 7200_000].map((ms) => new Date(ms))
    .filter((d) => { const b = berlin(d); return b.tag === t.tag && b.stunde === stunde && b.minute === minute; })
    .sort((a, b) => a.getTime() - b.getTime());
  if (kandidaten.length) return kandidaten[0];
  // Uhrzeit gibt es an diesem Tag nicht (Umstellung auf Sommerzeit): mit dem Winterversatz gerechnet liegt sie eine Stunde
  // später, also 02:30 → 03:30
  return new Date(lokal - 3600_000);
}

const verschieben = (t: Tag, tage: number): Tag => {
  const d = new Date(Date.UTC(t.jahr, t.monat - 1, t.tag + tage));
  return { jahr: d.getUTCFullYear(), monat: d.getUTCMonth() + 1, tag: d.getUTCDate() };
};
const wochentagVon = (t: Tag) => { const w = new Date(Date.UTC(t.jahr, t.monat - 1, t.tag)).getUTCDay(); return w === 0 ? 7 : w; };
const monatVerschieben = (t: Tag, monate: number): Tag => {
  const d = new Date(Date.UTC(t.jahr, t.monat - 1 + monate, 1));
  return { jahr: d.getUTCFullYear(), monat: d.getUTCMonth() + 1, tag: t.tag };
};

function uhr(p: Plan): [number, number] {
  const m = /^(\d{1,2}):(\d{2})/.exec(p.uhrzeit);
  if (!m) throw new Error(`Ungültige Uhrzeit ${p.uhrzeit}`);
  return [Number(m[1]), Number(m[2])];
}

/** Termin am Kalendertag t, falls der Plan an diesem Tag einen hat */
function terminAm(t: Tag, p: Plan): Date | null {
  if (p.intervall === "woechentlich" && wochentagVon(t) !== p.wochentag) return null;
  if (p.intervall === "monatlich" && t.tag !== p.monatstag) return null;
  const [h, m] = uhr(p);
  return zeitpunkt(t, h, m);
}

/** Letzter Termin, der nicht nach `jetzt` liegt */
export function letzterTermin(jetzt: Date, p: Plan): Date {
  const b = berlin(jetzt);
  let t: Tag = { jahr: b.jahr, monat: b.monat, tag: b.tag };
  if (p.intervall === "monatlich") {
    t = { ...t, tag: p.monatstag };
    if (terminAm(t, p)!.getTime() > jetzt.getTime()) t = monatVerschieben(t, -1);
    return terminAm(t, p)!;
  }
  for (let i = 0; i < 8; i++, t = verschieben(t, -1)) {
    const x = terminAm(t, p);
    if (x && x.getTime() <= jetzt.getTime()) return x;
  }
  throw new Error("Kein Termin gefunden");
}

/** Erster Termin nach `nach` */
export function naechsterTermin(nach: Date, p: Plan): Date {
  const l = letzterTermin(nach, p);
  const b = berlin(l);
  const t: Tag = { jahr: b.jahr, monat: b.monat, tag: b.tag };
  if (p.intervall === "monatlich") return terminAm(monatVerschieben({ ...t, tag: p.monatstag }, 1), p)!;
  return terminAm(verschieben(t, p.intervall === "taeglich" ? 1 : 7), p)!;
}

/** Termin vor dem Termin `termin` (Beginn des ersten Zeitraums) */
export function vorherigerTermin(termin: Date, p: Plan): Date {
  return letzterTermin(new Date(termin.getTime() - 1000), p);
}

/** Kalendertag in deutscher Zeit als JJJJ-MM-TT */
export function tagText(d: Date): string {
  const b = berlin(d);
  return `${b.jahr}-${String(b.monat).padStart(2, "0")}-${String(b.tag).padStart(2, "0")}`;
}
