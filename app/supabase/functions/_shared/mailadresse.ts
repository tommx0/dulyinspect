// Prüfungen für den Mailversand ohne Abhängigkeiten (auch in Vitest: mailadresse.test.ts).
// Der Mailserver eines Mandanten darf nicht auf Adressen im Stack zeigen (db, router, edge …): Die Edge-Runtime löst
// Docker-Namen auf, ein eingetragener „SMTP-Server“ würde sonst Verbindungen ins interne Netz öffnen (SSRF).

export type Sicherheit = "tls" | "starttls" | "keine";
export const SICHERHEITEN: Sicherheit[] = ["tls", "starttls", "keine"];

const HOST = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const EMAIL = /^[^@\s"<>,;]+@[^@\s"<>,;]+\.[^@\s"<>,;]+$/;

export const hostGueltig = (h: string) => HOST.test(h);
export const emailGueltig = (e: string) => e.length <= 254 && EMAIL.test(e);
/** Absendername: keine Zeilenumbrüche und Zeichen, die den Kopf der Mail verändern könnten */
export const nameGueltig = (n: string) => n.length <= 100 && !/[\r\n"<>]/.test(n);

function v4Zahl(ip: string): number | null {
  const t = ip.split(".");
  if (t.length !== 4 || !t.every((x) => /^\d{1,3}$/.test(x) && Number(x) <= 255)) return null;
  return t.reduce((n, x) => n * 256 + Number(x), 0);
}

const v4Netz = (ip: number, netz: string, bits: number) => {
  const n = v4Zahl(netz)!;
  const maske = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((ip & maske) >>> 0) === ((n & maske) >>> 0);
};

/** IPv6 in 8 Gruppen à 16 Bit (mit eingebetteter IPv4 am Ende), sonst null */
function v6Gruppen(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0];
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const z = v4Zahl(v4[1]);
    if (z === null) return null;
    s = s.slice(0, -v4[1].length) + `${(z >>> 16).toString(16)}:${(z & 0xffff).toString(16)}`;
  }
  const teile = s.split("::");
  if (teile.length > 2) return null;
  const links = teile[0] ? teile[0].split(":") : [];
  const rechts = teile.length === 2 && teile[1] ? teile[1].split(":") : [];
  const fehlt = 8 - links.length - rechts.length;
  if (teile.length === 1 ? fehlt !== 0 : fehlt < 1) return null;
  const alle = [...links, ...Array(teile.length === 2 ? fehlt : 0).fill("0"), ...rechts];
  if (!alle.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return alle.map((g) => parseInt(g, 16));
}

export type Ziel = "oeffentlich" | "privat" | "gesperrt";

/**
 * Art einer IP-Adresse:
 * gesperrt – nie erlaubt (Loopback, Link-Local, unbestimmt, Multicast, reserviert): dort laufen die Dienste des Stacks bzw. der Einzelinstanz
 * privat – private Netze (10/8, 172.16/12, 192.168/16, 100.64/10, fc00::/7): Docker-Netze des Stacks; nur mit MAIL_INTERNE_ZIELE=ja
 * oeffentlich – alles andere
 */
export function zielArt(ip: string): Ziel {
  const z = v4Zahl(ip);
  if (z !== null) {
    if (v4Netz(z, "0.0.0.0", 8) || v4Netz(z, "127.0.0.0", 8) || v4Netz(z, "169.254.0.0", 16) || v4Netz(z, "192.0.0.0", 24) ||
      v4Netz(z, "198.18.0.0", 15) || v4Netz(z, "224.0.0.0", 3)) return "gesperrt";
    if (v4Netz(z, "10.0.0.0", 8) || v4Netz(z, "172.16.0.0", 12) || v4Netz(z, "192.168.0.0", 16) || v4Netz(z, "100.64.0.0", 10)) {
      return "privat";
    }
    return "oeffentlich";
  }
  const g = v6Gruppen(ip);
  if (!g) return "gesperrt";
  // ::ffff:a.b.c.d und 64:ff9b::a.b.c.d (NAT64) wie die IPv4-Adresse behandeln
  const eingebettet = (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) || (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0));
  if (eingebettet) return zielArt(`${g[6] >>> 8}.${g[6] & 255}.${g[7] >>> 8}.${g[7] & 255}`);
  if (g.every((x) => x === 0) || (g.slice(0, 7).every((x) => x === 0) && g[7] === 1)) return "gesperrt";
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00) return "gesperrt";
  if ((g[0] & 0xfe00) === 0xfc00) return "privat";
  return "oeffentlich";
}

export const zielErlaubt = (ip: string, interneErlaubt: boolean) => {
  const art = zielArt(ip);
  return art === "oeffentlich" || (art === "privat" && interneErlaubt);
};

/** Fehlermeldung des Servers ohne Zugangsdaten, gekürzt */
export function fehlerOhneGeheimnis(text: string, geheim: (string | null | undefined)[]): string {
  let t = text;
  for (const g of geheim) if (g && g.length >= 3) t = t.split(g).join("***");
  return t.replace(/\s+/g, " ").trim().slice(0, 300);
}
