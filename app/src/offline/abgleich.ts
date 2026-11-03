// Daten vom Server holen: Objekt-Paket für den Offline-Betrieb und Live-Stand der Prüfungen eines Objekts.
// Vor jedem Abgleich prüft instanzPruefen(), dass der Server zum Schlüssel des Geräts gehört (docs/KONZEPT-VERSCHLUESSELUNG.md,
// Bedingung 3) – sonst wird nichts in den Gerätespeicher übernommen.
import { supabase } from '../lib/supabase'
import { instanzPruefen } from '../lib/verschluesselung/schluessel'
import { entschluesseln } from '../lib/verschluesselung'
import { istTueranlage, tueranlageName } from '../lib/tueranlage'
import { db, metaLesen, metaSchreiben, type Mitpruefer, type Pruefung } from './db'
import { kundendatenLoeschungPruefen } from './kundendatenGeloescht'
import { begriff } from '../lib/begriffe'
import { t } from '../lib/sprache'

export async function meineId(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const id = data.session?.user.id
  if (!id) throw new Error(t('Nicht angemeldet'))
  return id
}

function pruefe<R extends { data: unknown; error: unknown }>(r: R): NonNullable<R['data']> {
  if (r.error) throw r.error
  if (r.data == null) throw new Error(t('Daten nicht gefunden'))
  return r.data as NonNullable<R['data']>
}

/** Alles laden, was für die Prüfung eines Objekts offline gebraucht wird. */
export async function objektHerunterladen(objektId: string) {
  await instanzPruefen()
  await kundendatenLoeschungPruefen()
  const objekt = pruefe(await supabase.from('objekt').select('*').eq('id', objektId).single())
  const [kunde, anlagen, typen, pruefarten, versionen, benutzer, etiketten] = await Promise.all([
    supabase.from('endkunde').select('*').eq('id', objekt.endkunde_id).single().then(pruefe),
    supabase.from('anlage').select('*').eq('objekt_id', objektId).then(pruefe),
    supabase.from('anlagentyp').select('*').then(pruefe),
    supabase.from('pruefart').select('*').then(pruefe),
    supabase.from('checkliste_version').select('*').eq('status', 'freigegeben').then(pruefe),
    supabase.from('benutzer').select('id, name, email, sachkunde_hinweis').then(pruefe),
    supabase.from('etikett').select('id').is('anlage_id', null).limit(2000).then(pruefe),
  ])
  const anlageIds = anlagen.map((t) => t.id)
  const [maengel, elemente, gruppen] = anlageIds.length ? await Promise.all([
    supabase.from('mangel').select('*').in('anlage_id', anlageIds).in('status', ['offen', 'behoben']).then(pruefe),
    supabase.from('anlage_element').select('*').in('anlage_id', anlageIds).limit(20000).then(pruefe),
    supabase.from('anlage_gruppe').select('*').in('anlage_id', anlageIds).limit(20000).then(pruefe),
  ]) : [[], [], []]

  await db.transaction('rw', [db.objekte, db.kunden, db.anlagen, db.anlagentypen, db.pruefarten, db.versionen, db.benutzer, db.freieEtiketten, db.maengel, db.elemente, db.gruppen, db.outbox], async () => {
    // Lokal geänderte, noch nicht übertragene Türen nicht überschreiben
    const ausstehend = new Set((await db.outbox.where('art').equals('upsert').toArray())
      .filter((e) => e.tabelle === 'anlage' || e.tabelle === 'mangel' || e.tabelle === 'anlage_element').map((e) => e.id))
    await db.objekte.put(objekt)
    await db.kunden.put(kunde)
    await db.anlagen.bulkPut(anlagen.filter((t) => !ausstehend.has(t.id)))
    // Vom Admin gelöschte Türen auch auf dem Gerät entfernen (außer noch nicht übertragene, vor Ort angelegte)
    const aufServer = new Set(anlagen.map((t) => t.id))
    const geloescht = await db.anlagen.where('objekt_id').equals(objektId).filter((t) => !aufServer.has(t.id) && !ausstehend.has(t.id)).primaryKeys()
    await db.anlagen.bulkDelete(geloescht)
    await db.anlagentypen.bulkPut(typen)
    // Prüfarten vollständig ersetzen (gelöschte sollen auf dem Gerät nicht mehr angeboten werden)
    await db.pruefarten.clear()
    await db.pruefarten.bulkPut(pruefarten)
    // Versionen: freigegebene ersetzen (archivierte bleiben für laufende Prüfungen lokal erhalten)
    await db.versionen.bulkPut(versionen)
    await db.benutzer.bulkPut(benutzer)
    await db.freieEtiketten.clear()
    await db.freieEtiketten.bulkPut(etiketten)
    await db.maengel.bulkPut(maengel.filter((m) => !ausstehend.has(m.id)))
    await db.elemente.bulkPut(elemente.filter((e) => !ausstehend.has(e.id)))
    // Gruppen schreibt nur der Server: vollständig ersetzen (umbenannte und gelöschte verschwinden)
    if (anlageIds.length) await db.gruppen.where('anlage_id').anyOf(anlageIds).delete()
    await db.gruppen.bulkPut(gruppen)
  })
  await metaSchreiben(`objekt:${objektId}`, Date.now())
}

/** Eigene Mitprüfer-Daten einer Prüfung entfernen, die ich nicht mehr bearbeiten darf (nur wenn sie schon beim Server sind). */
async function fremdeDatenEntfernen(pruefungId: string) {
  const p = await db.pruefungen.get(pruefungId)
  if (!p?.fremd) return
  const [antworten, ergebnisse] = await Promise.all([
    db.antworten.where('anlagenpruefung_id').equals(pruefungId).toArray(),
    db.elementErgebnisse.where('anlagenpruefung_id').equals(pruefungId).toArray(),
  ])
  if (!antworten.length && !ergebnisse.length) return
  const ausstehend = new Set((await db.outbox.toArray()).map((e) => e.id))
  await db.antworten.bulkDelete(antworten.filter((a) => !ausstehend.has(a.id)).map((a) => a.id))
  await db.elementErgebnisse.bulkDelete(ergebnisse.filter((a) => !ausstehend.has(a.id)).map((a) => a.id))
}

/**
 * Prüfdaten einer gemeinsam bearbeiteten Prüfung (Antworten, Elementergebnisse, Mängel, Fotos) vom Server angleichen.
 * Noch nicht übertragene eigene Änderungen und Zeilen, die lokal neuer sind als der Serverstand, bleiben unangetastet.
 */
export async function gemeinsamAbgleichen(pruefungId: string) {
  await instanzPruefen()
  const vor = Date.now()
  const [p, antworten, ergebnisse, maengel] = await Promise.all([
    supabase.from('anlagenpruefung').select('*').eq('id', pruefungId).maybeSingle().then((r) => { if (r.error) throw r.error; return r.data }),
    supabase.from('antwort').select('*').eq('anlagenpruefung_id', pruefungId).then(pruefe),
    supabase.from('element_ergebnis').select('*').eq('anlagenpruefung_id', pruefungId).then(pruefe),
    supabase.from('mangel').select('*').eq('entdeckt_in', pruefungId).then(pruefe),
  ])
  if (!p) return
  const bezuege = [...antworten.map((a) => a.id), ...maengel.map((m) => m.id)]
  const fotos = bezuege.length ? await supabase.from('foto').select('*').in('bezug_id', bezuege).then(pruefe) : []
  // Die Checkliste der Prüfung muss auf dem Gerät sein (sie kann inzwischen archiviert sein)
  if (p.checkliste_version_id && !(await db.versionen.get(p.checkliste_version_id))) {
    const v = await supabase.from('checkliste_version').select('*').eq('id', p.checkliste_version_id).maybeSingle()
    if (v.data) await db.versionen.put(v.data)
  }

  await db.transaction('rw', [db.antworten, db.elementErgebnisse, db.maengel, db.fotos, db.outbox], async () => {
    const ausstehend = new Set((await db.outbox.toArray()).map((e) => e.id))
    await zeilenAbgleichen({ put: (z) => db.antworten.bulkPut(z), loeschen: (ids) => db.antworten.bulkDelete(ids) }, antworten, await db.antworten.where('anlagenpruefung_id').equals(pruefungId).toArray(), ausstehend, vor)
    await zeilenAbgleichen({ put: (z) => db.elementErgebnisse.bulkPut(z), loeschen: (ids) => db.elementErgebnisse.bulkDelete(ids) }, ergebnisse, await db.elementErgebnisse.where('anlagenpruefung_id').equals(pruefungId).toArray(), ausstehend, vor)
    await zeilenAbgleichen({ put: (z) => db.maengel.bulkPut(z), loeschen: (ids) => db.maengel.bulkDelete(ids) }, maengel, await db.maengel.where('entdeckt_in').equals(pruefungId).toArray(), ausstehend, vor)
    const lokaleBezuege = [...(await db.antworten.where('anlagenpruefung_id').equals(pruefungId).primaryKeys()), ...(await db.maengel.where('entdeckt_in').equals(pruefungId).primaryKeys())]
    const lokaleFotos = lokaleBezuege.length ? await db.fotos.where('bezug_id').anyOf(lokaleBezuege).toArray() : []
    await zeilenAbgleichen({ put: (z) => db.fotos.bulkPut(z), loeschen: (ids) => db.fotos.bulkDelete(ids) }, fotos, lokaleFotos, ausstehend, vor)
  })
}

type MitZeit = { id: string; geaendert_am?: string; erstellt_am?: string; aufgenommen_am?: string }

/** Serverzeilen übernehmen (außer ausstehende oder lokal neuere), lokal fehlende Zeilen entfernen (außer ausstehende und ganz frische). */
async function zeilenAbgleichen<T extends MitZeit>(tabelle: Werkzeug<T>, server: T[], lokal: T[], ausstehend: Set<string>, vor: number) {
  const lokalJe = new Map(lokal.map((l) => [l.id, l]))
  await tabelle.put(server.filter((s) => {
    if (ausstehend.has(s.id)) return false
    const l = lokalJe.get(s.id)
    return !l || !l.geaendert_am || !s.geaendert_am || Date.parse(s.geaendert_am) > Date.parse(l.geaendert_am)
  }))
  const aufServer = new Set(server.map((s) => s.id))
  const weg = lokal.filter((l) => !aufServer.has(l.id) && !ausstehend.has(l.id)
    && Date.parse(l.erstellt_am ?? l.aufgenommen_am ?? '1970-01-01') < vor - 30_000).map((l) => l.id)
  await tabelle.loeschen(weg)
}

type Werkzeug<T> = { put: (zeilen: T[]) => Promise<unknown>; loeschen: (ids: string[]) => Promise<unknown> }

/** Live-Updates der Prüfdaten einer gemeinsamen Prüfung. Gibt eine Funktion zum Abmelden zurück. */
export function pruefungBeobachten(pruefungId: string): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const anstossen = () => { clearTimeout(timer); timer = setTimeout(() => void gemeinsamAbgleichen(pruefungId).catch(() => undefined), 400) }
  // Eigener Name je Abonnement: Supabase gibt bei gleichem Namen den schon abonnierten Kanal zurück, dem sich dann nichts mehr anmelden lässt
  const kanal = supabase.channel(`pruefung:${pruefungId}:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'antwort', filter: `anlagenpruefung_id=eq.${pruefungId}` }, anstossen)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'element_ergebnis', filter: `anlagenpruefung_id=eq.${pruefungId}` }, anstossen)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'mangel', filter: `entdeckt_in=eq.${pruefungId}` }, anstossen)
    .subscribe()
  return () => { clearTimeout(timer); void supabase.removeChannel(kanal) }
}

/** `tueranlage`: freigegeben wurde die Prüfung der Türanlage (`anlage` ist dann „Türanlage <Objekt>“) */
export type FreigabeHinweis = { anlage: string; von: string; tueranlage?: boolean }

/**
 * Eigene Prüfungen, die ein Admin freigegeben hat, auf dem Gerät verwerfen – samt noch nicht
 * übertragener Eingaben (der Server würde sie ablehnen). Hinweis für die Liste unter `schluessel`
 * (`freigabe:<session>` bzw. `freigabe:objekt:<objekt>`).
 */
async function freigegebeneVerwerfen(schluessel: string, freigaben: { id: string; freigegeben_von: string }[]) {
  const betroffen = (await db.pruefungen.bulkGet(freigaben.map((f) => f.id))).filter((p): p is Pruefung => !!p && !p.fremd)
  if (!betroffen.length) return
  const hinweise = (await metaLesen<FreigabeHinweis[]>(schluessel)) ?? []
  for (const p of betroffen) {
    const anlage = await db.anlagen.get(p.anlage_id)
    const von = freigaben.find((f) => f.id === p.id)!.freigegeben_von
    const ta = istTueranlage(anlage)
    hinweise.push({
      anlage: ta ? tueranlageName((await entschluesseln('objekt', await db.objekte.get(anlage!.objekt_id)))?.name)
        : [anlage?.etikett_id, anlage?.kunden_bezeichnung].filter(Boolean).join(' ') || begriff('Tür'),
      tueranlage: ta,
      von: (await db.benutzer.get(von))?.name ?? 'der Sessionleitung',
    })
    await db.transaction('rw', [db.pruefungen, db.antworten, db.elementErgebnisse, db.maengel, db.fotos, db.dateien, db.outbox], async () => {
      const antworten = await db.antworten.where('anlagenpruefung_id').equals(p.id).primaryKeys()
      const ergebnisse = await db.elementErgebnisse.where('anlagenpruefung_id').equals(p.id).primaryKeys()
      const maengel = await db.maengel.where('entdeckt_in').equals(p.id).primaryKeys()
      const fotos = await db.fotos.where('bezug_id').anyOf([...antworten, ...maengel]).primaryKeys()
      const ids = new Set<string>([p.id, ...antworten, ...ergebnisse, ...maengel, ...fotos])
      await db.outbox.filter((e) => ids.has(e.id)).delete()
      await db.dateien.bulkDelete(fotos)
      await db.fotos.bulkDelete(fotos)
      await db.maengel.bulkDelete(maengel)
      await db.antworten.bulkDelete(antworten)
      await db.elementErgebnisse.bulkDelete(ergebnisse)
      await db.pruefungen.delete(p.id)
    })
  }
  await metaSchreiben(schluessel, hinweise)
}

/** Auf diesem Gerät abgebrochene Prüfungen, deren Aufhebung noch nicht beim Server ist. */
async function abgebrocheneIds(): Promise<Set<string>> {
  const offen = await db.outbox.where('art').equals('rpc').filter((e) => e.art === 'rpc' && e.rpc === 'reservierung_aufheben').toArray()
  return new Set(offen.map((e) => e.id))
}

async function pruefungUebernehmen(p: Pruefung, ich: string, abgebrochen: Set<string>, ausstehendVorher: Set<string>) {
  const lokal = await db.pruefungen.get(p.id)
  // Selbst abgebrochen, der Server weiß es nur noch nicht: nicht wieder anlegen (sonst bleibt sie „in Prüfung“ hängen);
  // bei einer Türanlage gilt das auch für die Türen (Teilprüfungen)
  if (!lokal && (abgebrochen.has(p.id) || (!!p.teil_von_id && abgebrochen.has(p.teil_von_id)))) return
  // Fremde Prüfung, eigene von einem anderen Gerät oder eigene ohne offene Übertragung (z. B. vom Admin wieder geöffnet): Serverstand.
  // Auch was beim Laden noch ausstand, zählt als offen: der gelesene Serverstand ist dann älter als der lokale (z. B. Abschluss
  // erst nach dem Lesen übertragen) und darf ihn nicht überschreiben.
  const offen = ausstehendVorher.has(p.id) || !!(await db.outbox.where('[tabelle+id]').equals(['anlagenpruefung', p.id]).count())
  if (p.pruefer_id !== ich || !lokal || !offen) {
    await db.pruefungen.put({ ...p, fremd: p.pruefer_id !== ich, server_status: p.status })
    return
  }
  // Eigene Prüfung mit noch nicht übertragenen Änderungen: lokale Arbeit behalten, nur Server-Felder übernehmen
  await db.pruefungen.update(p.id, {
    server_status: p.status, duplikat_von: p.duplikat_von, duplikat_geklaert: p.duplikat_geklaert,
    abgeschlossen_am: p.abgeschlossen_am, protokoll_nr: p.protokoll_nr, unterschrift_am: p.unterschrift_am,
    kunde_unterschrift_am: p.kunde_unterschrift_am,
  })
}

// ---------------------------------------------------------------------------
// Prüfungen ohne Session: Stand je Objekt
// ---------------------------------------------------------------------------

/** Beginn des heutigen Tages (Ortszeit) – „heute geprüft“ in der Anlagenliste */
export function heuteBeginn(jetzt = new Date()): string {
  return new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate()).toISOString()
}

/**
 * Serverstand der Prüfungen eines Objekts übernehmen: laufende, ungeklärte Doppelprüfungen und heute abgeschlossene –
 * dazu Mitprüfer und Freigaben durch einen Admin. Gemeinsame Prüfungen werden samt Einträgen angeglichen.
 */
export async function objektAbgleichen(objektId: string) {
  await instanzPruefen()
  const ich = await meineId()
  const ausstehendVorher = new Set((await db.outbox.filter((e) => e.tabelle === 'anlagenpruefung').toArray()).map((e) => e.id))
  const roh = await supabase.from('anlagenpruefung').select('*, anlage!inner(objekt_id)')
    .is('session_id', null).eq('anlage.objekt_id', objektId)
    .or(`abgeschlossen_am.is.null,abgeschlossen_am.gte."${heuteBeginn()}",and(status.eq.duplikat,duplikat_geklaert.eq.false)`)
    .then(pruefe)
  // altmaengel kommt als JSON – Inhalt schreibt nur die App selbst (Mangel-ID → besteht/behoben)
  const pruefungen = roh.map(({ anlage: _anlage, ...p }) => p) as unknown as Pruefung[]
  const ids = pruefungen.map((p) => p.id)
  const [mitpruefer, freigaben] = await Promise.all([
    ids.length ? supabase.from('anlagenpruefung_mitpruefer').select('*').in('anlagenpruefung_id', ids).then(pruefe) : Promise.resolve([] as Mitpruefer[]),
    supabase.from('anlagenpruefung_freigabe').select('id, freigegeben_von').is('session_id', null).eq('pruefer_id', ich).then(pruefe),
  ])
  await freigegebeneVerwerfen(`freigabe:objekt:${objektId}`, freigaben)
  const abgebrochen = await abgebrocheneIds()
  const anlagen = new Set(await db.anlagen.where('objekt_id').equals(objektId).primaryKeys())
  await db.transaction('rw', [db.pruefungen, db.mitpruefer, db.outbox], async () => {
    for (const p of pruefungen) await pruefungUebernehmen(p, ich, abgebrochen, ausstehendVorher)
    // Fremde Prüfungen, die nicht mehr laufen bzw. nicht von heute sind (oder freigegeben wurden), verschwinden
    const aufServer = new Set(ids)
    const weg = await db.pruefungen.where('anlage_id').anyOf([...anlagen])
      .filter((p) => !p.session_id && !!p.fremd && !aufServer.has(p.id)).primaryKeys()
    await db.pruefungen.bulkDelete(weg)
    await db.mitpruefer.where('anlagenpruefung_id').anyOf(weg).delete()
    // Türen, deren Türanlagen-Prüfung es auf dem Gerät nicht (mehr) gibt (abgebrochen, freigegeben), ohne offene Übertragung
    const offen = new Set((await db.outbox.toArray()).map((e) => e.id))
    const teile = await db.pruefungen.where('anlage_id').anyOf([...anlagen]).filter((p) => !!p.teil_von_id && !offen.has(p.id)).toArray()
    const verwaist: string[] = []
    for (const t of teile) if (!(await db.pruefungen.get(t.teil_von_id!))) verwaist.push(t.id)
    await db.pruefungen.bulkDelete(verwaist)
    await mitprueferErsetzen(ids, mitpruefer)
  })
  for (const p of pruefungen) {
    if (p.abgeschlossen_am) continue
    // Mitprüfer stehen an der Hauptprüfung der Türanlage; ihre Teilprüfungen (Türen) werden mit angeglichen
    const hauptId = p.teil_von_id ?? p.id
    const mitMir = mitpruefer.some((m) => m.anlagenpruefung_id === hauptId && m.status === 'zugelassen' && (p.pruefer_id === ich || m.benutzer_id === ich))
    if (mitMir) await gemeinsamAbgleichen(p.id).catch(() => undefined)
    // Nicht (mehr) Mitprüfer: lokale Reste gehören nicht mehr mir
    else if (p.pruefer_id !== ich) await fremdeDatenEntfernen(p.id)
  }
  await metaSchreiben(`objektstand:${objektId}`, Date.now())
}

/** Mitprüfer dieser Prüfungen durch den Serverstand ersetzen (noch nicht übertragene eigene Unterschrift bleibt). */
async function mitprueferErsetzen(pruefungIds: string[], server: Mitpruefer[]) {
  const ausstehend = new Set((await db.outbox.where('art').equals('update').toArray())
    .filter((e) => e.tabelle === 'anlagenpruefung_mitpruefer').map((e) => e.id))
  const lokal = await db.mitpruefer.where('anlagenpruefung_id').anyOf(pruefungIds).toArray()
  const schluessel = (m: Mitpruefer) => `${m.anlagenpruefung_id}:${m.benutzer_id}`
  const aufServer = new Set(server.map(schluessel))
  await db.mitpruefer.bulkDelete(lokal.filter((m) => !aufServer.has(schluessel(m))).map((m) => [m.anlagenpruefung_id, m.benutzer_id] as [string, string]))
  await db.mitpruefer.bulkPut(server.filter((m) => !ausstehend.has(schluessel(m))))
}

/**
 * Live-Stand der Prüfungen eines Objekts (Realtime). Prüfungen tragen kein Objekt, daher alle Änderungen
 * empfangen und nur bei Anlagen dieses Objekts neu abgleichen. Gibt eine Funktion zum Abmelden zurück.
 */
export function objektBeobachten(objektId: string): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const anstossen = () => { clearTimeout(timer); timer = setTimeout(() => void objektAbgleichen(objektId).catch(() => undefined), 500) }
  const betrifft = async (anlageId?: string, pruefungId?: string) => {
    if (anlageId) return (await db.anlagen.get(anlageId))?.objekt_id === objektId
    if (!pruefungId) return true  // DELETE ohne Daten: lieber abgleichen
    const p = await db.pruefungen.get(pruefungId)
    return !p || (await db.anlagen.get(p.anlage_id))?.objekt_id === objektId
  }
  // Eigener Name je Abonnement (z. B. Objektliste und Prüfseite gleichzeitig), siehe pruefungBeobachten
  const kanal = supabase.channel(`objekt:${objektId}:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'anlagenpruefung' }, async (ev) => {
      const z = (ev.eventType === 'DELETE' ? ev.old : ev.new) as Partial<Pruefung>
      if (await betrifft(z.anlage_id, z.id)) anstossen()
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'anlagenpruefung_mitpruefer' }, async (ev) => {
      const z = (ev.eventType === 'DELETE' ? ev.old : ev.new) as Partial<Mitpruefer>
      if (!z.anlagenpruefung_id || await db.pruefungen.get(z.anlagenpruefung_id)) anstossen()
    })
    .subscribe()
  return () => { clearTimeout(timer); void supabase.removeChannel(kanal) }
}
