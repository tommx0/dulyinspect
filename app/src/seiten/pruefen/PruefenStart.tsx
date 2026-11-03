import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../../auth'
import { bestaetigen } from '../../components/Bestaetigung'
import { ArtSymbol, EtikettText, ObjektSymbol, Weiter } from '../../components/Symbole'
import { AnsichtWahl, Badge, datum, Fehler, Kacheln, Leer, Seite } from '../../components/ui'
import { fehlertext, supabase } from '../../lib/supabase'
import { TUERANLAGE_TYP, tueranlageName, tuerPflicht } from '../../lib/tueranlage'
import { arbeitsliste, VORAUS_TAGE, ZURUECK_TAGE, type AnlageKurz, type PruefungKurz } from '../../lib/arbeitsliste'
import { Arbeitsliste } from './Arbeitsliste'
import { laeuft } from '../../offline/aktionen'
import { artDefinition } from '../../lib/anlagenarten'
import { OBJEKT_FRIST_TAGE, objektEntfernen } from '../../offline/aufraeumen'
import { db } from '../../offline/db'
import { useSyncStatus } from '../../offline/sync'
import { tb } from '../../lib/begriffe'
import { t } from '../../lib/sprache'
import { useAnsicht } from '../../lib/ansicht'
import { entschluesselt } from '../../lib/entschluesselt'
import { ausAbgeschlossenerPruefung } from '../../lib/maengel'
import { nachName } from '../../lib/sortierung'
import { entschluesseln } from '../../lib/verschluesselung'

type Typ = { name: string; art: string; anzahl: number }
type ObjektZeile = { id: string; name: string; ort: string | null; kunde: string; typen: Typ[]; laufend?: { anzahl: number; pruefer: string[] }
  /** Anlagen mit offenem Mangel aus einer abgeschlossenen Prüfung */
  nachpruefen?: number }

/** Aktive Anlagen eines Objekts je Anlagentyp zählen, häufigste zuerst (ohne die Türanlage des Objekts). */
function typenZaehlen(typen: ({ name: string; anlagenart: string } | null | undefined)[]): Typ[] {
  const je = new Map<string, Typ>()
  for (const t of typen) {
    if (!t || t.anlagenart === 'tueranlage') continue
    const x = je.get(t.name) ?? { name: t.name, art: t.anlagenart, anzahl: 0 }
    x.anzahl++
    je.set(t.name, x)
  }
  return [...je.values()].sort((a, b) => b.anzahl - a.anzahl || a.name.localeCompare(b.name))
}

/** Anlagen je Typ für die Kacheln: Symbol, Typname und Anzahl, ab fünf Typen zusammengefasst. */
function TypenListe({ typen }: { typen: Typ[] }) {
  if (typen.length === 0) return <p className="text-sm text-slate-400">{tb('Keine Türen angelegt.')}</p>
  const gezeigt = typen.length > 4 ? typen.slice(0, 3) : typen
  const rest = typen.slice(gezeigt.length).reduce((n, t) => n + t.anzahl, 0)
  return (
    <ul className="space-y-1 text-sm" aria-label={tb('Türen')} data-typen>
      {gezeigt.map((t) => (
        <li key={t.name} className="flex items-center gap-2">
          <ArtSymbol art={t.art} groesse="sm" />
          <span className="min-w-0 flex-1 truncate" title={t.name}>{t.name}</span>
          <span className="tabular-nums text-slate-500">{t.anzahl}</span>
        </li>
      ))}
      {rest > 0 && <li className="pl-9 text-slate-500">{rest === 1
        ? tb('+ {typen} weitere Typen · 1 Tür', { typen: typen.length - gezeigt.length })
        : tb('+ {typen} weitere Typen · {n} Türen', { typen: typen.length - gezeigt.length, n: rest })}</li>}
    </ul>
  )
}

/** Kurzform für die Listenansicht, z. B. „8× Drehflügeltür · 2× RWA“. */
const typenText = (typen: Typ[]) => typen.map((t) => `${t.anzahl}× ${t.name}`).join(' · ')

/** Offener Mangel mit seiner Anlage, für die Liste „Nachprüfen“ */
type NachpruefMangel = { anlage_id: string; objekt_id: string; stufe: number; beschreibung: string; erstellt_am: string
  etikett: string | null; bezeichnung: string | null; art?: string; tuer: boolean; fund?: Parameters<typeof ausAbgeschlossenerPruefung>[0] }
/** Eine Anlage zum Nachprüfen: ihre offenen Mängel (höchste Stufe zuerst) */
type Nachpruefung = Omit<NachpruefMangel, 'stufe' | 'beschreibung' | 'erstellt_am' | 'fund'> & { maengel: Pick<NachpruefMangel, 'stufe' | 'beschreibung' | 'erstellt_am'>[] }

/** Nachzuprüfen sind offene Mängel aus abgeschlossenen Prüfungen; je Anlage zusammengefasst. */
function nachpruefungen(maengel: NachpruefMangel[]): Nachpruefung[] {
  const je = new Map<string, Nachpruefung>()
  for (const m of maengel.filter((x) => ausAbgeschlossenerPruefung(x.fund))) {
    const n = je.get(m.anlage_id) ?? { anlage_id: m.anlage_id, objekt_id: m.objekt_id, etikett: m.etikett, bezeichnung: m.bezeichnung, art: m.art, tuer: m.tuer, maengel: [] }
    n.maengel.push({ stufe: m.stufe, beschreibung: m.beschreibung, erstellt_am: m.erstellt_am })
    je.set(m.anlage_id, n)
  }
  for (const n of je.values()) n.maengel.sort((a, b) => b.stufe - a.stufe || a.erstellt_am.localeCompare(b.erstellt_am))
  return [...je.values()]
}

/** Je Objekt: wie viele Anlagen nachzuprüfen sind. */
function nachpruefenZaehlen(liste: Nachpruefung[]): Map<string, number> {
  const je = new Map<string, number>()
  for (const n of liste) je.set(n.objekt_id, (je.get(n.objekt_id) ?? 0) + 1)
  return je
}

async function nachpruefenLokal(objektIds: string[]): Promise<Nachpruefung[]> {
  const anlagen = new Map((await db.anlagen.where('objekt_id').anyOf(objektIds).toArray()).map((a) => [a.id, a]))
  const arten = new Map((await db.anlagentypen.toArray()).map((t) => [t.id, t.anlagenart]))
  const maengel = await db.maengel.where('anlage_id').anyOf([...anlagen.keys()]).filter((m) => m.status === 'offen' || m.status === 'behoben').toArray()
  const pruefungen = new Map((await db.pruefungen.toArray()).map((p) => [p.id, p]))
  // Gerätespeicher: Anlage (Bezeichnung) und Mangel verschlüsselt – erst nach allen Abfragen an Dexie entschlüsseln
  const [anlagenKlar, maengelKlar] = await Promise.all([entschluesseln('anlage', [...anlagen.values()]), entschluesseln('mangel', maengel)])
  const klar = new Map(anlagenKlar.map((a) => [a.id, a]))
  return nachpruefungen(maengelKlar.map((m) => {
    const a = klar.get(m.anlage_id)!
    const p = pruefungen.get(m.entdeckt_in)
    return { anlage_id: m.anlage_id, objekt_id: a.objekt_id, stufe: m.stufe, beschreibung: m.beschreibung, erstellt_am: m.erstellt_am,
      etikett: a.etikett_id, bezeichnung: a.kunden_bezeichnung, art: arten.get(a.anlagentyp_id), tuer: !!a.teil_von_id,
      fund: p && { status: p.status, haupt: p.teil_von_id ? pruefungen.get(p.teil_von_id) : null } }
  }))
}

const tagVerschoben = (tage: number) => { const d = new Date(); d.setDate(d.getDate() + tage); return d.toISOString().slice(0, 10) }

/** Grundlage der Arbeitsliste aus dem Gerätespeicher (offline): Anlagen und Prüfungen der Objekte auf dem Gerät */
async function arbeitLokal(objektIds: string[]): Promise<{ anlagen: AnlageKurz[]; pruefungen: PruefungKurz[] }> {
  const arten = new Map((await db.anlagentypen.toArray()).map((t) => [t.id, t.anlagenart]))
  const roh = await db.anlagen.where('objekt_id').anyOf(objektIds).filter((a) => a.status === 'aktiv').toArray()
  const namen = new Map((await db.benutzer.toArray()).map((b) => [b.id, b.name]))
  const ids = new Set(roh.map((a) => a.id))
  const ab = tagVerschoben(-ZURUECK_TAGE)
  const pruefungen = await db.pruefungen.filter((p) => !p.session_id && ids.has(p.anlage_id) && p.status !== 'duplikat'
    && (p.status === 'in_pruefung' || (p.beendet_am ?? '') >= ab)).toArray()
  // Anlagen liegen verschlüsselt im Gerätespeicher: erst nach allen Abfragen an Dexie entschlüsseln
  const klar = new Map((await entschluesseln('anlage', roh)).map((a): [string, AnlageKurz] => [a.id, {
    id: a.id, objekt_id: a.objekt_id, etikett_id: a.etikett_id, kunden_bezeichnung: a.kunden_bezeichnung, art: arten.get(a.anlagentyp_id),
    teil_von_id: a.teil_von_id, naechste_pruefung_am: a.naechste_pruefung_am, letzte_pruefung_am: a.letzte_pruefung_am }]))
  return {
    anlagen: [...klar.values()],
    pruefungen: pruefungen.map((p) => ({ id: p.id, status: p.status, ergebnis: p.ergebnis, nicht_geprueft_grund: p.nicht_geprueft_grund,
      begonnen_am: p.begonnen_am, beendet_am: p.beendet_am, teil_von_id: p.teil_von_id, pruefer_id: p.pruefer_id,
      pruefer: namen.get(p.pruefer_id) ?? t('Kollege'), anlage: klar.get(p.anlage_id)! })),
  }
}

async function typenLokal(objektIds: string[]): Promise<Map<string, Typ[]>> {
  const typ = new Map((await db.anlagentypen.toArray()).map((t) => [t.id, t]))
  const anlagen = await db.anlagen.where('objekt_id').anyOf(objektIds).filter((a) => a.status === 'aktiv').toArray()
  return new Map(objektIds.map((id) => [id, typenZaehlen(anlagen.filter((a) => a.objekt_id === id).map((a) => typ.get(a.anlagentyp_id)))]))
}

export default function PruefenStart() {
  const navigate = useNavigate()
  const { benutzer } = useAuth()
  const ich = benutzer!.id
  const { online } = useSyncStatus()
  const [suche, setSuche] = useState('')
  const [objekte, setObjekte] = useState<ObjektZeile[] | null>(null)
  const [fehler, setFehler] = useState('')
  const [ansicht, setAnsicht] = useAnsicht('pruefen')
  const [nachpruefListe, setNachpruefListe] = useState<Nachpruefung[]>([])
  const [arbeitBasis, setArbeitBasis] = useState<{ anlagen: AnlageKurz[]; pruefungen: PruefungKurz[] } | null>(null)
  // Objekte auf diesem Gerät (offline nutzbar)
  const lokal = useLiveQuery(() => db.objekte.toArray(), [], undefined)
  const aufGeraet = new Set((lokal ?? []).map((o) => o.id))

  // Laufende Prüfungen auf diesem Gerät: eigene und solche, bei denen ich mitprüfe
  const laufend = useLiveQuery(async () => {
    const mit = new Set((await db.mitpruefer.filter((m) => m.benutzer_id === ich && m.status === 'zugelassen').toArray()).map((m) => m.anlagenpruefung_id))
    // Türen einer Türanlage (Teilprüfungen) laufen unter ihrer Türanlage
    const pruefungen = (await db.pruefungen.filter((p) => !p.session_id && !p.teil_von_id && laeuft(p) && ((p.pruefer_id === ich && !p.fremd) || mit.has(p.id))).toArray())
      .sort((x, y) => y.begonnen_am.localeCompare(x.begonnen_am))
    return Promise.all(pruefungen.map(async (p) => {
      const anlage = await db.anlagen.get(p.anlage_id)
      const [o, typ] = await Promise.all([anlage ? db.objekte.get(anlage.objekt_id) : undefined, anlage ? db.anlagentypen.get(anlage.anlagentyp_id) : undefined])
      const kRoh = o ? await db.kunden.get(o.endkunde_id) : undefined
      // Türanlage: Fortschritt ihrer Türen
      const tueren = anlage && artDefinition(typ?.anlagenart).tueren
        ? { gesamt: await db.anlagen.where('teil_von_id').equals(anlage.id).filter((a) => a.status === 'aktiv' && tuerPflicht(a.naechste_pruefung_am, p.begonnen_am)).count(),
            fertig: await db.pruefungen.where('teil_von_id').equals(p.id).filter((t) => t.status === 'geprueft' || t.status === 'nicht_geprueft').count() }
        : null
      // Kunden und Objekte liegen verschlüsselt im Gerätespeicher: erst nach allen Abfragen an Dexie entschlüsseln
      const [objektKlar, kunde] = await Promise.all([entschluesseln('objekt', o), entschluesseln('endkunde', kRoh)])
      return { p, anlage, objekt: objektKlar?.name ?? t('Objekt'), kunde: kunde?.name ?? '', art: typ?.anlagenart, typ: typ?.name ?? '', mitpruefend: p.pruefer_id !== ich, tueren }
    }))
  }, [ich], [])

  // Objektauswahl: online vom Server (mit Hinweis auf laufende Prüfungen), offline aus dem Gerätespeicher
  useEffect(() => {
    let aktiv = true
    void (async () => {
      if (online) {
        const [o, s, m, an, pr] = await Promise.all([
          entschluesselt('objekt', supabase.from('objekt').select('id, name, ort, endkunde(id, name), anlage(anlagentyp(name, anlagenart))').eq('aktiv', true).eq('anlage.status', 'aktiv')),
          supabase.from('anlagenpruefung').select('pruefer:benutzer!anlagenpruefung_pruefer_id_fkey(name), anlage!inner(objekt_id)')
            .is('session_id', null).is('teil_von_id', null).eq('status', 'in_pruefung'),
          entschluesselt('mangel', supabase.from('mangel')
            .select('anlage_id, stufe, beschreibung, erstellt_am, anlage!inner(objekt_id, etikett_id, kunden_bezeichnung, teil_von_id, status, anlagentyp(anlagenart)), fund:entdeckt_in(status, haupt:teil_von_id(status))')
            .in('status', ['offen', 'behoben']).eq('anlage.status', 'aktiv').limit(5000)),
          // Arbeitsliste: anstehende Anlagen und Türen, laufende und kürzlich beendete Prüfungen
          entschluesselt('anlage', supabase.from('anlage')
            .select('id, objekt_id, etikett_id, kunden_bezeichnung, teil_von_id, naechste_pruefung_am, letzte_pruefung_am, anlagentyp(anlagenart)')
            .eq('status', 'aktiv').neq('anlagentyp_id', TUERANLAGE_TYP)
            .or(`naechste_pruefung_am.is.null,naechste_pruefung_am.lte.${tagVerschoben(VORAUS_TAGE)}`).limit(5000)),
          entschluesselt('anlagenpruefung', supabase.from('anlagenpruefung')
            .select('id, status, ergebnis, nicht_geprueft_grund, begonnen_am, beendet_am, teil_von_id, pruefer_id, pruefer:benutzer!anlagenpruefung_pruefer_id_fkey(name), anlage!inner(id, objekt_id, etikett_id, kunden_bezeichnung, teil_von_id, naechste_pruefung_am, letzte_pruefung_am, anlagentyp(anlagenart))')
            .is('session_id', null).neq('status', 'duplikat').or(`status.eq.in_pruefung,beendet_am.gte.${tagVerschoben(-ZURUECK_TAGE)}`).limit(3000)),
        ])
        if (!aktiv) return
        if (o.error) return setFehler(fehlertext(o.error))
        const laufendJe = new Map<string, { anzahl: number; pruefer: string[] }>()
        for (const x of s.data ?? []) {
          const l = laufendJe.get(x.anlage.objekt_id) ?? { anzahl: 0, pruefer: [] }
          l.anzahl++
          if (x.pruefer?.name && !l.pruefer.includes(x.pruefer.name)) l.pruefer.push(x.pruefer.name)
          laufendJe.set(x.anlage.objekt_id, l)
        }
        const liste = nachpruefungen((m.data ?? []).map((x) => ({ anlage_id: x.anlage_id, objekt_id: x.anlage.objekt_id, stufe: x.stufe, beschreibung: x.beschreibung,
          erstellt_am: x.erstellt_am, etikett: x.anlage.etikett_id, bezeichnung: x.anlage.kunden_bezeichnung, art: x.anlage.anlagentyp?.anlagenart,
          tuer: !!x.anlage.teil_von_id, fund: x.fund ?? undefined })))
        setNachpruefListe(liste)
        const anlageKurz = (a: { id: string; objekt_id: string; etikett_id: string | null; kunden_bezeichnung: string | null; teil_von_id: string | null
          naechste_pruefung_am: string | null; letzte_pruefung_am: string | null; anlagentyp: { anlagenart: string } | null }): AnlageKurz =>
          ({ id: a.id, objekt_id: a.objekt_id, etikett_id: a.etikett_id, kunden_bezeichnung: a.kunden_bezeichnung, art: a.anlagentyp?.anlagenart,
            teil_von_id: a.teil_von_id, naechste_pruefung_am: a.naechste_pruefung_am, letzte_pruefung_am: a.letzte_pruefung_am })
        // Prüfungen auf diesem Gerät sind womöglich noch nicht übertragen (z. B. eben „Tür fertig“): ihr Stand gilt
        const geraet = await arbeitLokal([...(lokal ?? [])].map((x) => x.id))
        if (!aktiv) return
        const pruefungen = new Map((pr.data ?? []).map((p): [string, PruefungKurz] => [p.id, { id: p.id, status: p.status, ergebnis: p.ergebnis,
          nicht_geprueft_grund: p.nicht_geprueft_grund, begonnen_am: p.begonnen_am, beendet_am: p.beendet_am, teil_von_id: p.teil_von_id,
          pruefer_id: p.pruefer_id, pruefer: p.pruefer?.name ?? t('Kollege'), anlage: anlageKurz(p.anlage) }]))
        for (const p of geraet.pruefungen) pruefungen.set(p.id, { ...p, pruefer: pruefungen.get(p.id)?.pruefer ?? p.pruefer })
        setArbeitBasis({ anlagen: (an.data ?? []).map(anlageKurz), pruefungen: [...pruefungen.values()] })
        const nachpruefenJe = nachpruefenZaehlen(liste)
        setObjekte(nachName(o.data).map((x) => ({
          id: x.id, name: x.name, ort: x.ort, kunde: x.endkunde?.name ?? '', typen: typenZaehlen(x.anlage.map((a) => a.anlagentyp)), laufend: laufendJe.get(x.id),
          nachpruefen: nachpruefenJe.get(x.id),
        })))
      } else {
        if (!lokal) return
        const [typen, liste, basis] = await Promise.all([typenLokal(lokal.map((x) => x.id)), nachpruefenLokal(lokal.map((x) => x.id)), arbeitLokal(lokal.map((x) => x.id))])
        const nachpruefenJe = nachpruefenZaehlen(liste)
        const kundenRoh = await db.kunden.toArray()
        // Gerätespeicher: verschlüsselt, hier entschlüsseln
        const [kundenKlar, objekteKlar] = await Promise.all([entschluesseln('endkunde', kundenRoh), entschluesseln('objekt', lokal)])
        const kunden = new Map(kundenKlar.map((k) => [k.id, k.name]))
        if (aktiv) setObjekte(nachName(objekteKlar).map((x) => ({ id: x.id, name: x.name, ort: x.ort, kunde: kunden.get(x.endkunde_id) ?? '', typen: typen.get(x.id) ?? [], nachpruefen: nachpruefenJe.get(x.id) })))
        if (aktiv) { setNachpruefListe(liste); setArbeitBasis(basis) }
      }
    })()
    return () => { aktiv = false }
  }, [online, lokal])

  const entfernen = async (o: ObjektZeile) => {
    setFehler('')
    if (!await bestaetigen(t('Objekt „{name}“ vom Gerät entfernen?\n\nOffline steht es danach nicht mehr zur Verfügung. Beim nächsten Öffnen mit Internet lädt die App es neu.', { name: o.name }), { ok: t('Entfernen'), gefahr: true })) return
    const r = await objektEntfernen(o.id, ich)
    if (!r.ok) setFehler(r.grund)
  }

  const startKnopf = (o: ObjektZeile) => (
    <div className="flex flex-wrap items-center gap-2">
      <button className="btn-primaer" onClick={() => navigate(`/pruefen/o/${o.id}`)}>{t('Prüfen')}</button>
      {aufGeraet.has(o.id) && (
        <button className="btn-sekundaer px-2 py-1 text-sm" onClick={() => void entfernen(o)} data-objekt-entfernen>{t('Vom Gerät entfernen')}</button>
      )}
    </div>
  )
  const nachpruefenBadge = (o: ObjektZeile) => o.nachpruefen
    ? <> <span data-objekt-nachpruefen={o.nachpruefen}><Badge farbe="rot">⚠ {t('{n} nachprüfen', { n: o.nachpruefen })}</Badge></span></> : null
  const laufendText = (l: NonNullable<ObjektZeile['laufend']>) => l.anzahl === 1
    ? tb('1 Tür in Prüfung · {pruefer}', { pruefer: l.pruefer.join(', ') })
    : tb('{n} Türen in Prüfung · {pruefer}', { n: l.anzahl, pruefer: l.pruefer.join(', ') })

  // Arbeitsliste nur über aktive Objekte (die Objektauswahl kennt nur diese)
  const objektInfo = useMemo(() => new Map((objekte ?? []).map((o) => [o.id, { name: o.name, kunde: o.kunde }])), [objekte])
  const arbeit = useMemo(() => {
    if (!arbeitBasis || !objekte) return null
    const imObjekt = (x: { objekt_id: string }) => objektInfo.has(x.objekt_id)
    return arbeitsliste({ anlagen: arbeitBasis.anlagen.filter(imObjekt), pruefungen: arbeitBasis.pruefungen.filter((p) => imObjekt(p.anlage)),
      nachpruefen: nachpruefListe.filter(imObjekt), heute: tagVerschoben(0), ich })
  }, [arbeitBasis, objekte, objektInfo, nachpruefListe, ich])

  const gefiltert = (objekte ?? []).filter((o) => `${o.kunde} ${o.name} ${o.ort ?? ''}`.toLowerCase().includes(suche.toLowerCase()))

  return (
    <Seite titel={t('Prüfen')}>
      {laufend.length > 0 && <section className="space-y-2">
        <h2 className="text-lg font-semibold">{t('Fortsetzen auf diesem Gerät')}</h2>
          <ul className="karte divide-y divide-slate-100" aria-label={t('Laufende Prüfungen')}>
            {laufend.map(({ p, anlage, objekt, kunde, art, typ, mitpruefend, tueren }) => (
              <li key={p.id}>
                <Link to={`/pruefen/p/${p.id}`} className="zeile group">
                  <ArtSymbol art={art} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{tueren ? tueranlageName(objekt) : <><EtikettText id={anlage?.etikett_id ?? null} art={art} /> {anlage?.kunden_bezeichnung}</>}</div>
                    <div className="text-sm text-slate-500">{objekt}{kunde ? ` · ${kunde}` : ''} · {t('seit {datum}', { datum: datum(p.begonnen_am) })}</div>
                    <div className="text-xs text-slate-500">{tueren ? t('{fertig} Türen fertig · {gesamt} fällig', { fertig: tueren.fertig, gesamt: tueren.gesamt }) : typ}</div>
                  </div>
                  {mitpruefend ? <Badge farbe="blau">{t('Mitprüfer')}</Badge> : p.revision > 0 ? <Badge farbe="gelb">{t('wieder geöffnet')}</Badge> : null}
                  <Weiter />
                </Link>
              </li>
            ))}
          </ul>
      </section>}

      {arbeit ? <Arbeitsliste liste={arbeit} objekte={objektInfo} offline={!online} /> : <p className="text-sm text-slate-500">{t('Laden …')}</p>}

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-lg font-semibold">{t('Objekt wählen')}</h2>
          <AnsichtWahl wert={ansicht} onWechsel={setAnsicht} />
        </div>
        {!online && (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {t('Offline: Es werden nur Objekte angezeigt, die schon auf diesem Gerät gespeichert sind.')}
          </p>
        )}
        <input type="search" placeholder={t('Kunde, Objekt oder Ort suchen …')} value={suche} onChange={(e) => setSuche(e.target.value)} aria-label={t('Objekt suchen')} />
        {aufGeraet.size > 0 && (
          <p className="text-xs text-slate-500" data-geraet-hinweis>
            {t('Geöffnete Objekte bleiben für die Arbeit ohne Netz auf dem Gerät. Abgeschlossene Prüfungen werden nach der Übertragung am Folgetag entfernt, Objekte ohne laufende Prüfung nach {tage} Tagen ohne Nutzung oder mit „Vom Gerät entfernen“.', { tage: OBJEKT_FRIST_TAGE })}
          </p>
        )}
        <Fehler text={fehler} />
        {objekte === null ? <p className="text-sm text-slate-500">{t('Laden …')}</p> : gefiltert.length === 0 ? <Leer>{t('Keine Objekte gefunden.')}</Leer> : ansicht === 'kacheln' ? (
          <Kacheln aria-label={t('Objekte')}>
            {gefiltert.slice(0, 100).map((o) => (
              <li key={o.id} className="karte flex flex-col gap-2 p-4">
                <div className="flex items-start gap-3">
                  <ObjektSymbol />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{o.kunde}</div>
                    <div className="font-medium">{o.name} {online && aufGeraet.has(o.id) && <Badge farbe="blau">{t('auf dem Gerät')}</Badge>}{nachpruefenBadge(o)}</div>
                    {o.ort && <div className="text-sm text-slate-500">{o.ort}</div>}
                    {o.laufend && <div className="text-xs text-sky-800">{laufendText(o.laufend)}</div>}
                  </div>
                </div>
                <TypenListe typen={o.typen} />
                <div className="mt-auto pt-1">{startKnopf(o)}</div>
              </li>
            ))}
          </Kacheln>
        ) : (
          <ul className="karte divide-y divide-slate-100">
            {gefiltert.slice(0, 100).map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <ObjektSymbol />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{o.name} {online && aufGeraet.has(o.id) && <Badge farbe="blau">{t('auf dem Gerät')}</Badge>}{nachpruefenBadge(o)}</div>
                  <div className="text-sm text-slate-500">{o.kunde}{o.ort ? ` · ${o.ort}` : ''}</div>
                  {o.typen.length > 0 && <div className="text-xs text-slate-500">{typenText(o.typen)}</div>}
                  {o.laufend && <div className="text-xs text-sky-800">{laufendText(o.laufend)}</div>}
                </div>
                {startKnopf(o)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Seite>
  )
}
