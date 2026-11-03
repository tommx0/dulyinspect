// Kodierungen für Schlüssel und Geheimtexte (docs/KONZEPT-VERSCHLUESSELUNG.md): base64url ohne Auffüllung (Werte, QR-Code),
// hex (Schlüssel-ID) und Crockford-Base32 (Schlüssel zum Abtippen: ohne Groß-/Kleinschreibung, ohne I, L, O, U).

export function base64urlKodieren(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/** Wirft bei ungültigen Zeichen. */
export function base64urlLesen(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new Error('Ungültige base64url-Kodierung')
  const b64 = text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (text.length % 4)) % 4)
  const s = atob(b64)
  const bytes = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i)
  return bytes
}

export function hexKodieren(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function base32Kodieren(bytes: Uint8Array): string {
  let bits = 0
  let wert = 0
  let s = ''
  for (const b of bytes) {
    wert = (wert << 8) | b
    bits += 8
    while (bits >= 5) {
      s += BASE32[(wert >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) s += BASE32[(wert << (5 - bits)) & 31]
  return s
}

/** Liest Crockford-Base32 (Leerzeichen und Bindestriche erlaubt, I/L → 1, O → 0). Wirft bei ungültigen Zeichen. */
export function base32Lesen(text: string): Uint8Array {
  const rein = text.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0')
  let bits = 0
  let wert = 0
  const bytes: number[] = []
  for (const z of rein) {
    const i = BASE32.indexOf(z)
    if (i < 0) throw new Error('Ungültiges Zeichen im Schlüssel')
    wert = ((wert << 5) | i) & 0xffff
    bits += 5
    if (bits >= 8) {
      bytes.push((wert >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(bytes)
}
