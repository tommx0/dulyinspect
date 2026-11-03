// Simulierter Supabase-Server für die Tests der Verschlüsselung (nur Tests):
//   vi.mock('../supabase', async () => (await import('./testserver')).supabaseModul)
// Bildet nur ab, was schluessel.ts, werte.ts, dateien.ts und umschluesseln.ts brauchen – samt der Regeln von
// umschluesseln, verschluesselung_aktivieren, dem Schlüsseltausch und der Abschaltung aus den Migrationen, soweit sie für
// die Abläufe zählen.
// Die Regeln selbst prüft supabase/tests/verschluesselung_test.sql gegen die echte Datenbank.
import { PFAD_FELDER, SCHLUESSEL_SPALTEN, WERT_FELDER, feldLesen, feldSetzen } from './felder'
import { geheimtextSchluesselId, istGeheimtext } from './krypto'

type Zeile = Record<string, unknown>

export const server = {
  ich: 'admin-1',
  systemadmin: true,
  offline: false,
  berechtigt: true,
  /** null = keine Verschlüsselung eingerichtet */
  v: null as null | {
    aktiv: boolean; instanz_id: string; schluessel_id: string; pruefwert: string
    tausch_seit: string | null; tausch_von: string | null; tausch_schluessel_id: string | null; tausch_pruefwert: string | null
    abschaltung_seit?: string | null; abschaltnachweis?: string | null; abgeschaltet_am?: string | null
  },
  tabellen: {} as Record<string, Zeile[]>,
  dateien: new Map<string, Blob>(),
  aufrufe: [] as string[],
  /** Störung vor einer RPC (z. B. Abbruch zwischen Hochladen und Umsetzen des Pfads): Fehler zurückgeben */
  vorRpc: null as null | ((name: string, a: Record<string, unknown>) => { message: string } | undefined),
  /** Dateien („bucket/pfad“), die jünger als die Mindestfrist für verwaiste Dateien sind */
  jung: new Set<string>(),
}

export function serverZuruecksetzen() {
  server.ich = 'admin-1'
  server.systemadmin = true
  server.offline = false
  server.berechtigt = true
  server.v = null
  server.tabellen = {}
  server.dateien = new Map()
  server.aufrufe = []
  server.vorRpc = null
  server.jung = new Set()
}

const netz = { message: 'TypeError: Failed to fetch' }

function zeileFinden(tabelle: string, schluessel: Record<string, string>): Zeile | undefined {
  return (server.tabellen[tabelle] ?? []).find((z) => SCHLUESSEL_SPALTEN[tabelle].every((s) => String(z[s]) === schluessel[s]))
}

function klartextAnzahl(): number {
  let n = 0
  for (const [t, felder] of Object.entries(WERT_FELDER)) {
    for (const z of server.tabellen[t] ?? []) for (const f of felder) {
      const v = feldLesen(z, f)
      if (typeof v === 'string' && v !== '' && !istGeheimtext(v)) n++
    }
  }
  for (const { tabelle, spalte } of PFAD_FELDER) {
    for (const z of server.tabellen[tabelle] ?? []) if (typeof z[spalte] === 'string' && !(z[spalte] as string).endsWith('.enc')) n++
  }
  return n
}

function verschluesseltAnzahl(): number {
  let n = 0
  for (const [t, felder] of Object.entries(WERT_FELDER)) {
    for (const z of server.tabellen[t] ?? []) for (const f of felder) if (istGeheimtext(feldLesen(z, f))) n++
  }
  for (const { tabelle, spalte } of PFAD_FELDER) {
    for (const z of server.tabellen[tabelle] ?? []) if (typeof z[spalte] === 'string' && (z[spalte] as string).endsWith('.enc')) n++
  }
  return n
}

type Aenderung = { tabelle: string; spalte: string; schluessel: Record<string, string>; alt: string; neu: string; fehlt?: boolean; verwerfen?: boolean }

const NUR_ADMIN = new Set(['verschluesselung_einrichten', 'verschluesselung_stand', 'verschluesselung_aktivieren',
  'verschluesselung_tausch_beginnen', 'verschluesselung_tausch_abschliessen', 'verschluesselung_tausch_abbrechen', 'umschluesseln',
  'verschluesselung_verwaiste', 'verschluesselung_ersetzen', 'verschluesselung_abschaltung_beginnen', 'verschluesselung_abschaltung_abbrechen',
  'verschluesselung_abschalten'])

/** Wie verschluesselung_anzahl(): Werte und Pfade mit bzw. ohne diese Schlüssel-ID */
function anzahl(schluesselId: string): { mit: number; ohne: number } {
  let mit = 0
  let ohne = 0
  for (const [t, felder] of Object.entries(WERT_FELDER)) {
    for (const z of server.tabellen[t] ?? []) for (const f of felder) {
      const v = feldLesen(z, f)
      if (typeof v !== 'string' || v === '') continue
      if (geheimtextSchluesselId(v) === schluesselId) mit++
      else ohne++
    }
  }
  for (const { tabelle, spalte } of PFAD_FELDER) {
    for (const z of server.tabellen[tabelle] ?? []) {
      if (typeof z[spalte] !== 'string') continue
      if ((z[spalte] as string).endsWith(`.k${schluesselId.slice(0, 8)}.enc`)) mit++
      else ohne++
    }
  }
  return { mit, ohne }
}

function verwiesen(bucket: string, pfad: string): boolean {
  return PFAD_FELDER.some((f) => f.bucket === bucket && (server.tabellen[f.tabelle] ?? []).some((z) => z[f.spalte] === pfad))
}

/** Wie verschluesselung_verwaiste(p_ziel): Dateien ohne Datensatz, nicht mit dem Zielschlüssel verschlüsselt (null: Klartext) */
function verwaiste(ziel: string | null): { bucket: string; name: string; loeschbar: boolean }[] {
  const basen = new Set(PFAD_FELDER.flatMap((f) => (server.tabellen[f.tabelle] ?? []).map((z) => z[f.spalte])
    .filter((p): p is string => typeof p === 'string').map((p) => `${f.bucket}/${p.replace(/(\.k[0-9a-f]{8})?\.enc$/, '')}`)))
  return [...server.dateien.keys()].map((k) => { const i = k.indexOf('/'); return { bucket: k.slice(0, i), name: k.slice(i + 1), k } })
    .filter((d) => (ziel === null ? d.name.endsWith('.enc') : !d.name.endsWith(`.k${ziel.slice(0, 8)}.enc`)) && !verwiesen(d.bucket, d.name))
    .map((d) => ({ bucket: d.bucket, name: d.name, loeschbar: !server.jung.has(d.k) || basen.has(`${d.bucket}/${d.name.replace(/(\.k[0-9a-f]{8})?\.enc$/, '')}`) }))
}

function leer(): boolean {
  return klartextAnzahl() === 0 && verschluesseltAnzahl() === 0 && ![...server.dateien.keys()].some((k) => /^(fotos|unterschriften|protokolle|nachweise)\//.test(k))
}

function rpc(name: string, a: Record<string, unknown> = {}): { data: unknown; error: unknown } {
  server.aufrufe.push(`rpc:${name}`)
  if (server.offline) return { data: null, error: netz }
  if (NUR_ADMIN.has(name) && !server.systemadmin) return { data: null, error: { code: '42501', message: 'Nur Administratoren' } }
  const stoerung = server.vorRpc?.(name, a)
  if (stoerung) return { data: null, error: stoerung }
  const v = server.v
  switch (name) {
    case 'verschluesselung_kennung':
      if (!server.berechtigt) return { data: { berechtigt: false }, error: null }
      return { data: { berechtigt: true, ...(v ?? {}), eingerichtet: !!v && !v.abgeschaltet_am, aktiv: v?.aktiv ?? false, abgeschaltet: !!v?.abgeschaltet_am }, error: null }
    case 'verschluesselung_einrichten':
      if (v?.aktiv) return { data: null, error: { message: 'Die Verschlüsselung ist schon eingerichtet.' } }
      if (v?.abschaltung_seit) return { data: null, error: { message: 'Die Verschlüsselung wird gerade abgeschaltet.' } }
      server.v = { aktiv: false, instanz_id: a.p_instanz_id as string, schluessel_id: a.p_schluessel_id as string, pruefwert: a.p_pruefwert as string,
        tausch_seit: null, tausch_von: null, tausch_schluessel_id: null, tausch_pruefwert: null }
      return { data: null, error: null }
    case 'verschluesselung_abschaltung_beginnen':
      if (!v || v.abgeschaltet_am) return { data: null, error: { message: 'Die Verschlüsselung ist nicht eingerichtet' } }
      if (v.tausch_seit) return { data: null, error: { message: 'Während eines Schlüsseltauschs lässt sich die Verschlüsselung nicht abschalten' } }
      if (geheimtextSchluesselId(a.p_nachweis) !== v.schluessel_id) return { data: null, error: { message: 'Ungültiger Abschaltnachweis' } }
      Object.assign(v, { aktiv: false, abschaltung_seit: v.abschaltung_seit ?? new Date().toISOString(), abschaltnachweis: v.abschaltnachweis ?? a.p_nachweis })
      return { data: null, error: null }
    case 'verschluesselung_abschaltung_abbrechen':
      if (!v?.abschaltung_seit) return { data: null, error: { message: 'Es läuft keine Abschaltung' } }
      Object.assign(v, { abschaltung_seit: null, abschaltnachweis: null })
      return { data: null, error: null }
    case 'verschluesselung_abschalten': {
      if (!v?.abschaltung_seit) return { data: null, error: { message: 'Es läuft keine Abschaltung' } }
      const n = verschluesseltAnzahl()
      if (n > 0) return { data: null, error: { message: `Noch ${n} Werte bzw. Dateien verschlüsselt` } }
      const enc = [...server.dateien.keys()].filter((k) => k.endsWith('.enc')).length
      if (enc > 0) return { data: null, error: { message: `Noch ${enc} verschlüsselte Dateien im Speicher` } }
      Object.assign(v, { abschaltung_seit: null, abgeschaltet_am: new Date().toISOString() })
      return { data: null, error: null }
    }
    case 'verschluesselung_stand': {
      const ziel = v?.abschaltung_seit ? null : v?.tausch_schluessel_id ?? v?.schluessel_id
      const w = v && !v.abgeschaltet_am && (ziel || v.abschaltung_seit) ? verwaiste(ziel ?? null) : []
      return { data: { klartext: klartextAnzahl(), verschluesselt: verschluesseltAnzahl(), leer: leer(),
        tausch_offen: v?.tausch_schluessel_id ? anzahl(v.tausch_schluessel_id).ohne : null,
        verwaist: w.length, verwaist_loeschbar: w.filter((d) => d.loeschbar).length }, error: null }
    }
    case 'verschluesselung_verwaiste': {
      if (!v || v.abgeschaltet_am) return { data: [], error: null }
      if (v.abschaltung_seit) return a.p_ziel === null ? { data: verwaiste(null), error: null } : { data: null, error: { message: 'Während der Abschaltung ist das Ziel Klartext' } }
      if (a.p_ziel !== v.schluessel_id && a.p_ziel !== v.tausch_schluessel_id) return { data: null, error: { message: 'Unbekannter Zielschlüssel' } }
      return { data: verwaiste(a.p_ziel as string), error: null }
    }
    case 'verschluesselung_aktivieren': {
      const n = klartextAnzahl()
      if (n > 0) return { data: null, error: { message: `Noch ${n} Werte bzw. Dateien unverschlüsselt` } }
      const w = v ? verwaiste(v.schluessel_id).filter((d) => !d.name.endsWith('.enc')).length : 0
      if (w > 0) return { data: null, error: { message: `Noch ${w} Dateien ohne Datensatz unverschlüsselt im Speicher` } }
      v!.aktiv = true
      return { data: null, error: null }
    }
    case 'verschluesselung_ersetzen':
      if (!v) return { data: null, error: { message: 'Die Verschlüsselung ist noch nicht eingerichtet' } }
      if (v.tausch_seit || !leer()) return { data: null, error: { message: 'Die Kennung lässt sich nur in einer leeren Instanz ersetzen' } }
      Object.assign(v, { aktiv: false, instanz_id: a.p_instanz_id, schluessel_id: a.p_schluessel_id, pruefwert: a.p_pruefwert })
      return { data: null, error: null }
    case 'verschluesselung_tausch_beginnen':
      if (!v?.aktiv) return { data: null, error: { message: 'Die Verschlüsselung ist noch nicht aktiv' } }
      if (v.tausch_seit && v.tausch_schluessel_id !== a.p_schluessel_id) return { data: null, error: { message: 'Es läuft schon ein Schlüsseltausch mit einem anderen neuen Schlüssel.' } }
      Object.assign(v, { tausch_seit: v.tausch_seit ?? new Date().toISOString(), tausch_von: server.ich, tausch_schluessel_id: a.p_schluessel_id,
        tausch_pruefwert: v.tausch_pruefwert ?? a.p_pruefwert })
      return { data: null, error: null }
    case 'verschluesselung_tausch_abschliessen': {
      if (!v?.tausch_seit) return { data: null, error: { message: 'Es läuft kein Schlüsseltausch' } }
      if (v.tausch_von !== server.ich) return { data: null, error: { message: 'Den Schlüsseltausch hat ein anderer Admin begonnen.' } }
      const offen = anzahl(v.tausch_schluessel_id!).ohne
      if (offen > 0) return { data: null, error: { message: `Noch ${offen} Werte bzw. Dateien mit dem bisherigen Schlüssel` } }
      if (verwaiste(v.tausch_schluessel_id!).length) return { data: null, error: { message: 'Noch Dateien ohne Datensatz mit dem bisherigen Schlüssel' } }
      Object.assign(v, { schluessel_id: v.tausch_schluessel_id, pruefwert: v.tausch_pruefwert, tausch_seit: null, tausch_von: null, tausch_schluessel_id: null, tausch_pruefwert: null })
      return { data: null, error: null }
    }
    case 'verschluesselung_tausch_abbrechen': {
      if (!v?.tausch_seit) return { data: null, error: { message: 'Es läuft kein Schlüsseltausch' } }
      if (v.tausch_von !== server.ich) return { data: null, error: { message: 'Den Schlüsseltausch hat ein anderer Admin begonnen.' } }
      const neu = anzahl(v.tausch_schluessel_id!).mit
      const dateien = [...server.dateien.keys()].filter((k) => k.endsWith(`.k${v.tausch_schluessel_id!.slice(0, 8)}.enc`)).length
      if (neu > 0 || dateien > 0) return { data: null, error: { message: `Noch ${neu + dateien} Werte bzw. Dateien mit dem neuen Schlüssel` } }
      Object.assign(v, { tausch_seit: null, tausch_von: null, tausch_schluessel_id: null, tausch_pruefwert: null })
      return { data: null, error: null }
    }
    case 'umschluesseln': {
      const tausch = !!v?.tausch_seit
      if (v?.abgeschaltet_am) return { data: null, error: { message: 'Die Verschlüsselung ist abgeschaltet' } }
      if (v?.abschaltung_seit) {
        let n = 0
        for (const e of a.p_aenderungen as Aenderung[]) {
          const z = zeileFinden(e.tabelle, e.schluessel)
          if (!z || feldLesen(z, e.spalte) !== e.alt) continue
          const pfad = PFAD_FELDER.find((p) => p.tabelle === e.tabelle && p.spalte === e.spalte)
          if (pfad) {
            if (!e.alt.endsWith(`.k${v.schluessel_id.slice(0, 8)}.enc`) || e.neu !== e.alt.replace(/(\.k[0-9a-f]{8})?\.enc$/, '')) {
              return { data: null, error: { message: `Unzulässiger neuer Pfad für ${e.tabelle}.${e.spalte}` } }
            }
            if (!e.fehlt && !e.verwerfen && !server.dateien.has(`${pfad.bucket}/${e.neu}`)) return { data: null, error: { message: `Die entschlüsselte Datei ${e.neu} fehlt` } }
          } else if (geheimtextSchluesselId(e.alt) !== v.schluessel_id || !e.neu || istGeheimtext(e.neu)) {
            return { data: null, error: { message: `Unzulässige Änderung von ${e.tabelle}.${e.spalte}` } }
          }
          Object.assign(z, feldSetzen(z, e.spalte, e.neu))
          n++
        }
        return { data: n, error: null }
      }
      if (!v || (v.aktiv && !tausch)) return { data: null, error: { message: 'Umschlüsseln geht nur während der Umstellung oder eines Schlüsseltauschs' } }
      if (tausch && v.tausch_von !== server.ich) return { data: null, error: { message: 'Den Schlüsseltausch hat ein anderer Admin begonnen' } }
      let n = 0
      for (const e of a.p_aenderungen as Aenderung[]) {
        const z = zeileFinden(e.tabelle, e.schluessel)
        if (!z || feldLesen(z, e.spalte) !== e.alt) continue
        const pfad = PFAD_FELDER.find((p) => p.tabelle === e.tabelle && p.spalte === e.spalte)
        const kennungen = tausch ? [v.schluessel_id, v.tausch_schluessel_id!] : [v.schluessel_id]
        if (pfad) {
          const erlaubt = tausch ? e.alt.endsWith('.enc') && e.neu !== e.alt && kennungen.some((k) => e.neu.endsWith(`.k${k.slice(0, 8)}.enc`))
            : e.neu === `${e.alt}.k${v.schluessel_id.slice(0, 8)}.enc`
          if (!erlaubt) return { data: null, error: { message: `Unzulässiger neuer Pfad für ${e.tabelle}.${e.spalte}` } }
          if (!e.fehlt && !server.dateien.has(`${pfad.bucket}/${e.neu}`)) return { data: null, error: { message: `Die verschlüsselte Datei ${e.neu} fehlt` } }
        } else if (!istGeheimtext(e.neu) || (tausch ? !istGeheimtext(e.alt) : istGeheimtext(e.alt)) || !kennungen.includes(geheimtextSchluesselId(e.neu)!)
          || geheimtextSchluesselId(e.neu) === geheimtextSchluesselId(e.alt)) {
          return { data: null, error: { message: `Unzulässige Änderung von ${e.tabelle}.${e.spalte}` } }
        }
        Object.assign(z, feldSetzen(z, e.spalte, e.neu))
        n++
      }
      return { data: n, error: null }
    }
    default:
      return { data: null, error: null }
  }
}

/** Wie der Trigger zzz_verschluesselung: Geheimtext und Pfade nur mit einem Schreibschlüssel, Klartext nur vor „aktiv“ */
function triggerPruefen(tabelle: string, z: Zeile): { message: string; code: string; hint?: string } | null {
  const v = server.v
  if (!v) return null
  const erlaubt = v.abgeschaltet_am ? [] : [v.schluessel_id, ...(v.tausch_seit && v.tausch_von === server.ich ? [v.tausch_schluessel_id!] : [])]
  for (const f of (WERT_FELDER as Record<string, readonly string[]>)[tabelle] ?? []) {
    const w = feldLesen(z, f)
    if (typeof w !== 'string' || w === '') continue
    const id = geheimtextSchluesselId(w)
    if (!id && v.aktiv) return { code: '23514', message: `Unverschlüsselter Wert in ${tabelle}.${f}` }
    if (id && v.abgeschaltet_am) return { code: '23514', message: `Wert in ${tabelle}.${f} ist verschlüsselt, die Verschlüsselung ist aber abgeschaltet`, hint: 'verschluesselung_abgeschaltet' }
    if (id && !erlaubt.includes(id)) return { code: '23514', message: `Wert in ${tabelle}.${f} ist mit einem veralteten Schlüssel verschlüsselt`, hint: 'schluessel_veraltet' }
  }
  for (const { spalte } of PFAD_FELDER.filter((p) => p.tabelle === tabelle)) {
    const w = z[spalte]
    if (typeof w !== 'string' || w === '') continue
    const kennung = /\.k([0-9a-f]{8})\.enc$/.exec(w)?.[1]
    if (!kennung && (v.aktiv || w.endsWith('.enc'))) return { code: '23514', message: `Unverschlüsselter Wert in ${tabelle}.${spalte}` }
    if (kennung && !erlaubt.some((e) => e.slice(0, 8) === kennung)) return { code: '23514', message: `Wert in ${tabelle}.${spalte} ist mit einem veralteten Schlüssel verschlüsselt`, hint: 'schluessel_veraltet' }
  }
  return null
}

function abfrage(tabelle: string) {
  let auswahl: [string, string][] = []
  let schreiben: null | { art: 'upsert' | 'update' | 'delete'; daten?: Zeile } = null
  const nichtNull: string[] = []
  const gleich: [string, unknown][] = []
  let von = 0
  let bis = Infinity
  const wert = (z: Zeile, ausdruck: string) => {
    const [a, b] = ausdruck.split('->>')
    return b === undefined ? z[a] : feldLesen(z, `${a}.${b}`)
  }
  const q = {
    select(s: string) {
      auswahl = s.split(',').map((t) => t.trim()).map((t) => {
        const [alias, ausdruck] = t.includes(':') ? t.split(':') : [t, t]
        return [alias, ausdruck]
      })
      return q
    },
    not(spalte: string) { nichtNull.push(spalte); return q },
    upsert(daten: Zeile) { schreiben = { art: 'upsert', daten }; return q },
    update(daten: Zeile) { schreiben = { art: 'update', daten }; return q },
    delete() { schreiben = { art: 'delete' }; return q },
    single() { return q },
    eq(spalte: string, w: unknown) { gleich.push([spalte, w]); return q },
    order() { return q },
    range(a: number, b: number) { von = a; bis = b; return q },
    then(ok: (r: { data: unknown; error: unknown }) => unknown) {
      server.aufrufe.push(`${schreiben?.art ?? 'select'}:${tabelle}`)
      if (server.offline) return Promise.resolve({ data: null, error: netz }).then(ok)
      if (schreiben) {
        const liste = (server.tabellen[tabelle] ??= [])
        const passt = (z: Zeile) => gleich.every(([sp, w]) => String(z[sp]) === String(w))
        if (schreiben.art === 'delete') {
          server.tabellen[tabelle] = liste.filter((z) => !passt(z))
          return Promise.resolve({ data: null, error: null }).then(ok)
        }
        const ziele = schreiben.art === 'upsert' ? [{ ...(liste.find((z) => z.id === schreiben!.daten!.id) ?? {}), ...schreiben.daten }]
          : liste.filter(passt).map((z) => ({ ...z, ...schreiben!.daten }))
        for (const z of ziele) {
          const fehler = triggerPruefen(tabelle, z)
          if (fehler) return Promise.resolve({ data: null, error: fehler }).then(ok)
        }
        for (const z of ziele) {
          const i = liste.findIndex((x) => schreiben!.art === 'upsert' ? x.id === z.id : passt(x))
          if (i >= 0) liste[i] = z
          else liste.push(z)
        }
        return Promise.resolve({ data: ziele, error: null }).then(ok)
      }
      const zeilen = (server.tabellen[tabelle] ?? []).filter((z) => nichtNull.every((n) => wert(z, n) != null)
        && gleich.every(([sp, w]) => String(z[sp]) === String(w)))
      const data = zeilen.slice(von, bis + 1).map((z) => Object.fromEntries(auswahl.map(([alias, ausdruck]) => [alias, wert(z, ausdruck)])))
      return Promise.resolve({ data, error: null }).then(ok)
    },
  }
  return q
}

function speicher(bucket: string) {
  return {
    async upload(pfad: string, blob: Blob, o: { contentType?: string; upsert?: boolean } = {}) {
      server.aufrufe.push(`upload:${bucket}/${pfad}:${o.contentType}`)
      if (server.offline) return { data: null, error: netz }
      if (server.dateien.has(`${bucket}/${pfad}`) && !o.upsert) return { data: null, error: { message: 'The resource already exists' } }
      server.dateien.set(`${bucket}/${pfad}`, blob)
      return { data: { path: pfad }, error: null }
    },
    async download(pfad: string) {
      server.aufrufe.push(`download:${bucket}/${pfad}`)
      if (server.offline) return { data: null, error: netz }
      const blob = server.dateien.get(`${bucket}/${pfad}`)
      return blob ? { data: blob, error: null } : { data: null, error: { statusCode: '404', message: 'Object not found' } }
    },
    /** Wie die Lösch-Policy: was noch ein Datensatz verwendet, bleibt (ohne Fehler, wie Storage bei RLS); zurück kommt, was gelöscht ist */
    async remove(pfade: string[]) {
      const weg: { name: string }[] = []
      for (const p of pfade) {
        server.aufrufe.push(`remove:${bucket}/${p}`)
        if (!verwiesen(bucket, p) && server.dateien.delete(`${bucket}/${p}`)) weg.push({ name: p })
      }
      return { data: weg, error: null }
    },
  }
}

/** Ersatz für das Modul ../supabase */
export const supabaseModul = {
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: server.ich } } } }) },
    rpc: async (name: string, a?: Record<string, unknown>) => rpc(name, a),
    from: (t: string) => abfrage(t),
    storage: { from: (b: string) => speicher(b) },
  },
  fehlertext: (e: unknown) => (e as { message?: string })?.message ?? String(e),
}
