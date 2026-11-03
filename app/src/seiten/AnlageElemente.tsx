import { useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { useAuth } from '../auth'
import { bestaetigen } from '../components/Bestaetigung'
import { DateiKnoepfe } from '../components/DateiKnoepfe'
import { eigenschaftenAusWerten, eigenschaftenStart, ersteFreieKnopf, eigenschaftFelder, typAusWerten, typFelder, typStart, vorgabeAusWerten, vorgabeFelder } from '../components/elementFelder'
import { Formular, type FeldDef } from '../components/Formular'
import { useGruppeAuswahl } from '../components/GruppeAuswahl'
import { GruppenVerwalten } from '../components/GruppenVerwalten'
import { Badge, datum, Dialog, Fehler, Laden, Leer, Seite } from '../components/ui'
import { istBestandArt } from '../lib/bestand'
import { artDefinition, feldText, type Eigenschaften } from '../lib/anlagenarten'
import { austauschMonat, austauschStatus } from '../lib/austausch'
import { elementVergleich, freieNummern, gruppenListe, nummernReihe, nummernText, typenVorhanden } from '../lib/elemente'
import { herstellercodeNormalisieren } from '../lib/herstellercode'
import { codeAnzeige, melderCodeLesen } from '../lib/melderCode'
import { entschluesselt } from '../lib/entschluesselt'
import { fehlertext, supabase, type Zeile } from '../lib/supabase'
import { demoKnopf } from '../lib/demo'
import { useAbfrage } from '../lib/useAbfrage'
import { elementSpalten, elementZeilen, type ElementZeile } from '../import/elemente'
import { tabelleLesen } from '../import/tabelle'
import { t, tMeldung } from '../lib/sprache'

type Element = Zeile<'anlage_element'>

/** Elemente einer Anlage verwalten (z. B. Leuchten einer Sicherheitsbeleuchtung): erfassen, ändern, stilllegen, importieren. */
export default function AnlageElemente() {
  const { id = '' } = useParams()
  const { istAdmin } = useAuth()
  const [dialog, setDialog] = useState<Element | 'neu' | null>(null)
  const [importDatei, setImportDatei] = useState<{ name: string; zeilen: ElementZeile[] } | null>(null)
  const [meldung, setMeldung] = useState('')
  const [fehler, setFehler] = useState('')
  const [stillgelegte, setStillgelegte] = useState(false)
  const [mehrere, setMehrere] = useState(false)

  const anlage = useAbfrage(() => entschluesselt('anlage', supabase.from('anlage')
    .select('id, etikett_id, kunden_bezeichnung, objekt_id, objekt(id, name), anlagentyp(name, anlagenart)').eq('id', id).single()), [id])
  const elemente = useAbfrage(() => supabase.from('anlage_element').select('*').eq('anlage_id', id).limit(20000), [id])
  // Offene Mängel je Element: bei der nächsten Prüfung nachzuprüfen
  const maengel = useAbfrage(() => entschluesselt('mangel', supabase.from('mangel').select('element_id, stufe, beschreibung, status, erstellt_am')
    .eq('anlage_id', id).not('element_id', 'is', null).in('status', ['offen', 'behoben']).limit(20000)), [id])
  const mangelJe = useMemo(() => new Map((maengel.daten ?? []).map((m) => [m.element_id!, m])), [maengel.daten])
  const def = artDefinition(anlage.daten?.anlagentyp?.anlagenart).elemente
  const liste = useMemo(() => ((elemente.daten ?? []) as Element[]).filter((e) => stillgelegte || e.aktiv).sort(elementVergleich),
    [elemente.daten, stillgelegte])
  // Typen / Hersteller, die in der Anlage schon vorkommen: Auswahl beim Erfassen (bei Rauchwarnmeldern ist die Anlage das Objekt)
  const typen = useMemo(() => typenVorhanden((elemente.daten ?? []) as Element[]), [elemente.daten])
  // Gruppen (Wohnungen / Bereiche …): vorab angelegte und von Elementen verwendete, Auswahl beim Erfassen
  const gruppen = useAbfrage(() => supabase.from('anlage_gruppe').select('*').eq('anlage_id', id).limit(20000), [id])
  const gruppenNamen = useMemo(() => gruppenListe((gruppen.daten ?? []).map((g) => g.name), (elemente.daten ?? []) as Element[]),
    [gruppen.daten, elemente.daten])
  // Bestand: Gebäude und Etage der Wohnungen / Bereiche aus den Anlagen des Objekts wählen
  const objektId = anlage.daten?.objekt_id
  const objektLage = useAbfrage(() => supabase.from('anlage').select('gebaeude, etage').in('objekt_id', objektId ? [objektId] : []).limit(5000), [objektId])
  const gruppeAuswahl = useGruppeAuswahl(t(artDefinition(anlage.daten?.anlagentyp?.anlagenart).elemente?.gruppe ?? 'Gruppe'), gruppenNamen, async (name) => {
    const { error } = await supabase.from('anlage_gruppe').insert({ anlage_id: id, name })
    if (error && error.code !== '23505') return fehlertext(error)
    gruppen.neuLaden()
  })

  if (anlage.laedt && !anlage.daten) return <Laden />
  const a = anlage.daten
  if (!a) return <Seite titel={t('Elemente')}><Fehler text={anlage.fehler || t('Anlage nicht gefunden')} /></Seite>
  const zurueck = { zu: `/objekte/${a.objekt_id}?anlage=${a.id}`, text: a.objekt?.name ?? t('Objekt') }
  if (!def) return <Seite titel={t('Elemente')} zurueck={zurueck}><Leer>{t('Diese Art von Anlage hat keine Elemente.')}</Leer></Seite>

  // Begriffe der Art in der Sprache der Oberfläche; Spaltennamen für Import und Vorlage bleiben deutsch (so erkennt sie der Import)
  const einzahl = t(def.einzahl)
  const mehrzahl = t(def.mehrzahl)
  const gruppeName = t(def.gruppe)
  const titel = `${mehrzahl}: ${[a.etikett_id, a.kunden_bezeichnung].filter(Boolean).join(' · ') || a.anlagentyp?.name}`
  const aktive = ((elemente.daten ?? []) as Element[]).filter((e) => e.aktiv)
  const ortText = def.ort ?? 'Ort'
  const ortName = t(ortText)
  // Neue Elemente tragen ihre Gruppe ein (Datenbank), daher beide neu laden
  const neuLaden = () => { elemente.neuLaden(); gruppen.neuLaden() }

  const felder = (w: Record<string, unknown>): FeldDef[] => [
    gruppeAuswahl.feld(w.gruppe),
    { name: 'nummer', label: t('Nummer'), pflicht: true, ...(dialog === 'neu' ? { knopf: ersteFreieKnopf(aktive) } : {}) },
    { name: 'elementart', label: t('Art'), typ: 'select', optionen: def.arten.map((x) => ({ wert: x.schluessel, text: t(x.name) })) },
    { name: 'ort', label: ortName, breit: true },
    ...typFelder(def, w, typen),
    ...(def.codes ? [{ name: 'code', label: t('Code (Aufkleber)'), breit: true,
      hinweis: t('Inhalt des QR-Codes auf dem Melder. Einfacher: in der Prüfung „Melder scannen“, dann wird er automatisch eingetragen.') } as FeldDef] : []),
    ...eigenschaftFelder(def.felder),
    ...(dialog !== 'neu' ? [{ name: 'aktiv', label: t('aktiv (ausgebaute oder ersetzte stilllegen)'), typ: 'checkbox' } as FeldDef] : []),
  ]

  const speichern = async (w: Record<string, unknown>) => {
    const e = eigenschaftenAusWerten(def.felder, w)
    if ('fehler' in e) return tMeldung(e.fehler)
    const zeile = {
      gruppe: (w.gruppe as string | null) ?? null, nummer: String(w.nummer).trim(), elementart: (w.elementart as string | null) ?? null,
      ort: (w.ort as string | null) ?? null, typ: typAusWerten(def, w, typen), eigenschaften: e.eigenschaften,
      ...(def.codes ? { code: w.code ? melderCodeLesen(String(w.code)) ?? (herstellercodeNormalisieren(String(w.code)) || null) : null } : {}),
      ...(dialog !== 'neu' ? { aktiv: Boolean(w.aktiv) } : {}),
    }
    const { error } = dialog === 'neu'
      ? await supabase.from('anlage_element').insert({ ...zeile, anlage_id: id })
      : await supabase.from('anlage_element').update(zeile).eq('id', (dialog as Element).id)
    if (error) {
      if (error.code !== '23505') return fehlertext(error)
      return error.message.includes('anlage_element_code') ? t('Dieser Code gehört schon zu einem anderen aktiven Element.')
        : t('{element} {nummer} gibt es in diesem {gruppe} schon.', { element: einzahl, nummer: zeile.nummer, gruppe: gruppeName })
    }
    setDialog(null)
    neuLaden()
  }

  const loeschen = async (e: Element) => {
    if (!await bestaetigen(t('{element} {nummer} endgültig löschen?', { element: einzahl, nummer: e.nummer }) + '\n\n' + t('Geprüfte {elemente} lassen sich nicht löschen – dafür „aktiv“ abwählen.', { elemente: mehrzahl }), { ok: t('Löschen'), gefahr: true })) return
    const { error } = await supabase.from('anlage_element').delete().eq('id', e.id)
    if (error) return setFehler(error.code === '23503' ? t('{element} {nummer} wurde schon geprüft und kann nur stillgelegt werden.', { element: einzahl, nummer: e.nummer }) : fehlertext(error))
    setDialog(null)
    neuLaden()
  }

  const einlesen = async (f: File | undefined) => {
    setFehler(''); setMeldung(''); setImportDatei(null)
    if (!f) return
    try {
      const tabelle = tabelleLesen(f.name, new Uint8Array(await f.arrayBuffer()))
      const spalten = elementSpalten(tabelle[0] ?? [], def)
      if (spalten.nummer === undefined) throw new Error(t('Keine Spalte für die Nummer gefunden. Erwartet z. B. „Nr“, „Nummer“ oder „Leuchten-Nr.“, dazu optional „{gruppe}“, „Art“, „{ort}“, „Typ“.', { gruppe: def.gruppe, ort: ortText }))
      setImportDatei({ name: f.name, zeilen: elementZeilen(tabelle, spalten, def, aktive) })
    } catch (e) {
      setFehler(fehlertext(e))
    }
  }

  const importieren = async () => {
    const neu = importDatei!.zeilen.filter((z) => z.status === 'neu').map((z) => ({ ...z.element!, anlage_id: id }))
    const { error } = await supabase.from('anlage_element').insert(neu)
    if (error) {
      const code = error.code === '23505' && error.message.includes('anlage_element_code')
      return setFehler(t('Import abgebrochen, es wurde nichts angelegt: {grund}', { grund: code ? t('Ein Code aus der Datei gehört schon zu einem aktiven Melder (auch in einer anderen Anlage).') : fehlertext(error) }))
    }
    setMeldung(t('{n} {elemente} angelegt.', { n: neu.length, elemente: mehrzahl }))
    setImportDatei(null)
    neuLaden()
  }

  // Mehrere auf einmal: gleiche Gruppe und Vorgaben (alles außer Code und Seriennummer), Nummern ab der Startnummer auf die nächsten freien verteilt
  const reihe = (w: Record<string, unknown>) => {
    const anzahl = Number(w.anzahl)
    if (anzahl > 500) return null
    const gruppe = String(w.gruppe ?? '').trim() || null
    const nummern = freieNummern(aktive, gruppe, String(w.start ?? ''), anzahl)
    if (!nummern) return null
    // Belegte Nummern zwischen der ersten und der letzten, die übersprungen werden
    const zahl = (n: string) => Number(n.match(/(\d+)$/)![1])
    const belegt = nummernReihe(nummern[0], zahl(nummern[nummern.length - 1]) - zahl(nummern[0]) + 1)!.filter((n) => !nummern.includes(n))
    return { gruppe, nummern, text: nummernText(nummern), belegt }
  }
  const mehrereFelder = (w: Record<string, unknown>): FeldDef[] => {
    const r = reihe(w)
    const vorschau = !r ? t('Bitte Startnummer (endet mit einer Zahl, z. B. 1, 01 oder L1) und Anzahl (höchstens 500) angeben.')
      : (r.gruppe ? t('{elemente} {nummern} in {gruppe} {name}', { elemente: r.nummern.length === 1 ? einzahl : mehrzahl, nummern: r.text, gruppe: gruppeName, name: r.gruppe })
        : `${r.nummern.length === 1 ? einzahl : mehrzahl} ${r.text}`)
        + (r.belegt.length ? ' · ' + (r.belegt.length === 1 ? t('{nummern} ist schon belegt', { nummern: nummernText(r.belegt) }) : t('{nummern} sind schon belegt', { nummern: nummernText(r.belegt) })) : '')
    return [
      gruppeAuswahl.feld(w.gruppe, { pflicht: !!def.nummerMitGruppe }),
      ...vorgabeFelder(def, w, typen),
      { name: 'start', label: t('Startnummer'), pflicht: true, knopf: ersteFreieKnopf(aktive),
        hinweis: t('z. B. 1 oder 01 – die weiteren Nummern zählen hoch, belegte werden übersprungen') },
      { name: 'anzahl', label: t('Anzahl'), typ: 'number', pflicht: true, max: '500', hinweis: vorschau },
    ]
  }
  const mehrereAnlegen = async (w: Record<string, unknown>) => {
    if (Number(w.anzahl) > 500) return t('Höchstens 500 auf einmal.')
    const r = reihe(w)
    if (!r) return t('Startnummer muss mit einer Zahl enden (z. B. 1, 01 oder L1), Anzahl mindestens 1.')
    const v = vorgabeAusWerten(def, w, typen)
    if ('fehler' in v) return tMeldung(v.fehler)
    const { error } = await supabase.from('anlage_element').insert(r.nummern.map((nummer) => ({ anlage_id: id, gruppe: r.gruppe, nummer, ...v })))
    if (error?.code === '23505') {
      neuLaden()
      return t('Eine der Nummern wurde inzwischen vergeben. Bitte die Vorschau prüfen und erneut auf „Anlegen“ tippen.')
    }
    if (error) return fehlertext(error)
    setMehrere(false)
    setMeldung(r.gruppe ? t('{elemente} {nummern} angelegt ({gruppe} {name}).', { elemente: r.nummern.length === 1 ? einzahl : mehrzahl, nummern: r.text, gruppe: gruppeName, name: r.gruppe })
      : t('{elemente} {nummern} angelegt.', { elemente: r.nummern.length === 1 ? einzahl : mehrzahl, nummern: r.text }))
    neuLaden()
  }

  const exportZeilen = () => {
    const kopf = [def.gruppe, 'Nummer', 'Art', ortText, def.typ?.text ?? 'Typ / Hersteller', ...(def.codes ? ['Code'] : []), ...def.felder.map((f) => f.text), 'Zuletzt geprüft', 'Aktiv']
    const zeilen = liste.map((e) => [e.gruppe, e.nummer, def.arten.find((x) => x.schluessel === e.elementart)?.name ?? '', e.ort, e.typ,
      ...(def.codes ? [e.code ?? ''] : []), ...def.felder.map((f) => feldText(f, (e.eigenschaften as Eigenschaften)[f.schluessel])), e.zuletzt_geprueft_am ? datum(e.zuletzt_geprueft_am) : '', e.aktiv ? 'ja' : 'nein'])
    return [kopf, ...zeilen]
  }
  const dateiName = `${def.mehrzahl}_${a.etikett_id ?? a.kunden_bezeichnung ?? 'Anlage'}`

  const neuZahl = importDatei?.zeilen.filter((z) => z.status === 'neu').length ?? 0

  return (
    <Seite titel={titel} zurueck={zurueck} aktionen={<>
      <button className="btn-sekundaer" onClick={() => setMehrere(true)}>{t('Mehrere {elemente} anlegen …', { elemente: mehrzahl })}</button>
      <button className="btn-primaer" {...demoKnopf()} onClick={() => setDialog('neu')}>+ {einzahl}</button>
    </>}>
      {meldung && <div role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">{meldung}</div>}
      <Fehler text={fehler || elemente.fehler} />

      <GruppenVerwalten def={def} anlageId={id} gruppen={gruppen.daten ?? []} aktive={aktive} istAdmin={istAdmin} auswahl={gruppeAuswahl}
        lage={istBestandArt(a.anlagentyp?.anlagenart) ? (objektLage.daten ?? []).map((x) => ({ ...x, art: null })) : undefined}
        onGeaendert={(m) => { setFehler(''); setMeldung(m ?? ''); neuLaden() }} />

      <section className="karte space-y-3 p-4">
        <h2 className="font-semibold">{t('{elemente} importieren (Excel/CSV)', { elemente: mehrzahl })}</h2>
        <p className="text-sm text-slate-600">
          {t('Erste Zeile = Überschriften, darunter je {element} eine Zeile.', { element: einzahl })}
          {' '}{t('Erkannt werden u. a. „{gruppe}“, „Nr“, „Art“, „{ort}“ und „Typ“', { gruppe: def.gruppe, ort: ortText })}
          {def.codes && t(', dazu „Code“ (Inhalt des QR-Aufklebers; eigene Melder-Etiketten und Herstellercodes)')}.
          {' '}{t('Vorhandene {elemente} (gleicher {gruppe} und gleiche Nummer) werden übersprungen.', { elemente: mehrzahl, gruppe: gruppeName })}
        </p>
        <input type="file" accept=".xlsx,.csv,.txt" aria-label={t('{elemente}-Liste (.xlsx oder .csv)', { elemente: mehrzahl })} onChange={(e) => void einlesen(e.target.files?.[0])} />
        <div className="space-y-1">
          <p className="text-sm text-slate-600">{t('Leere Vorlage mit den passenden Spalten, im Excel-Format mit Auswahlliste für die Art:')}</p>
          <DateiKnoepfe art="vorlage" name={`Vorlage_${def.mehrzahl}`} blattName={def.mehrzahl}
            zeilen={() => [[def.gruppe, 'Nummer', 'Art', ortText, 'Typ', ...(def.codes ? ['Code'] : [])]]} auswahl={() => [{ spalte: 2, werte: def.arten.map((x) => x.name) }]} />
        </div>
        {importDatei && (
          <div className="space-y-2" data-element-import>
            <p className="text-sm">{importDatei.name}: <strong>{t('{n} werden angelegt', { n: neuZahl })}</strong>
              {importDatei.zeilen.some((z) => z.status !== 'neu') && t(', {n} übersprungen', { n: importDatei.zeilen.filter((z) => z.status !== 'neu').length })}</p>
            <ul className="max-h-40 overflow-auto text-xs text-slate-600">
              {importDatei.zeilen.filter((z) => z.status !== 'neu').map((z) => <li key={z.zeile}>{t('Zeile {n}:', { n: z.zeile })} {z.grund}</li>)}
            </ul>
            <button className="btn-primaer" disabled={neuZahl === 0} onClick={() => void importieren()}>{t('{n} {elemente} anlegen', { n: neuZahl, elemente: mehrzahl })}</button>
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 font-normal">
          <input type="checkbox" checked={stillgelegte} onChange={(e) => setStillgelegte(e.target.checked)} /> {t('stillgelegte zeigen')}
        </label>
        <DateiKnoepfe art="export" name={dateiName} blattName={def.mehrzahl} zeilen={exportZeilen} disabled={liste.length === 0} />
      </div>
      {elemente.laedt && !elemente.daten ? <Laden /> : liste.length === 0 ? <Leer>{t('Noch keine {elemente} erfasst.', { elemente: mehrzahl })}</Leer> : (
        <div className="karte overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>{[gruppeName, t('Nummer'), t('Art'), ortName, t('Typ'), ...(def.codes ? ['Code', t('Austausch')] : []), t('Zuletzt geprüft')].map((k) => <th key={k} className="px-3 py-2 font-medium">{k}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {liste.map((e, i) => {
                const neueGruppe = i > 0 && e.gruppe !== liste[i - 1].gruppe
                return (
                  <tr key={e.id} onClick={() => setDialog(e)} className={`cursor-pointer hover:bg-slate-50 ${e.aktiv ? '' : 'text-slate-400'} ${neueGruppe ? 'border-t-2 border-slate-200' : ''}`}>
                    <td className="px-3 py-2">{e.gruppe ?? '–'}</td>
                    <td className="px-3 py-2 font-medium">{e.nummer} {!e.aktiv && <Badge>{t('stillgelegt')}</Badge>}
                      {mangelJe.has(e.id) && <span title={t('{beschreibung} (seit {datum})', { beschreibung: mangelJe.get(e.id)!.beschreibung, datum: datum(mangelJe.get(e.id)!.erstellt_am) })}>
                        {' '}<Badge farbe={mangelJe.get(e.id)!.stufe >= 3 ? 'rot' : 'gelb'}>{mangelJe.get(e.id)!.status === 'behoben' ? t('Mangel behoben gemeldet') : t('Mangel offen')}</Badge></span>}</td>
                    <td className="px-3 py-2">{t(def.arten.find((x) => x.schluessel === e.elementart)?.name ?? '–')}</td>
                    <td className="px-3 py-2">{e.ort ?? '–'}</td>
                    <td className="px-3 py-2">{e.typ ?? '–'}</td>
                    {def.codes && <td className="px-3 py-2 font-mono text-xs">{e.code ? codeAnzeige(e.code) : <Badge farbe="gelb">{t('ohne Code')}</Badge>}</td>}
                    {def.codes && <td className="whitespace-nowrap px-3 py-2"><AustauschZelle datum={(e.eigenschaften as Eigenschaften).austausch} aktiv={e.aktiv} /></td>}
                    <td className="px-3 py-2">{e.zuletzt_geprueft_am ? datum(e.zuletzt_geprueft_am) : <Badge farbe="gelb">{t('noch nie')}</Badge>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-sm text-slate-500">{t('{n} aktive {elemente}', { n: aktive.length, elemente: mehrzahl })}{mangelJe.size > 0 && ' · ' + t('{n} mit offenem Mangel (werden bei der nächsten Prüfung nachgeprüft)', { n: mangelJe.size })}</p>

      <Dialog offen={mehrere} titel={t('Mehrere {elemente} anlegen', { elemente: mehrzahl })} onSchliessen={() => setMehrere(false)}>
        {mehrere && (
          <Formular felder={mehrereFelder} onAbbrechen={() => setMehrere(false)} onSpeichern={mehrereAnlegen} speichernText={t('Anlegen')}
            start={{ elementart: def.arten[0]?.schluessel, ...typStart(def, null, true, typen), anzahl: 10 }} />
        )}
      </Dialog>

      <Dialog offen={dialog !== null} titel={dialog === 'neu' ? t('{element} erfassen', { element: einzahl }) : t('{element} bearbeiten', { element: einzahl })} onSchliessen={() => setDialog(null)}>
        {dialog && (
          <Formular key={dialog === 'neu' ? 'neu' : dialog.id} felder={felder} onAbbrechen={() => setDialog(null)} onSpeichern={speichern}
            start={dialog === 'neu' ? { elementart: def.arten[0]?.schluessel, ...typStart(def, null, true, typen) } : {
              ...dialog, ...typStart(def, dialog.typ, false, typen), ...eigenschaftenStart(def.felder, dialog.eigenschaften as Eigenschaften),
            }}
            zusatz={dialog !== 'neu' && istAdmin && (
              <button type="button" className="btn-sekundaer text-red-700" {...demoKnopf()} onClick={() => void loeschen(dialog)}>{t('{element} löschen', { element: einzahl })}</button>
            )} />
        )}
      </Dialog>
      {gruppeAuswahl.dialog}
    </Seite>
  )
}

/** Austauschdatum eines Melders: rot ab überschrittenem, gelb innerhalb von 6 Monaten vor dem Datum. */
function AustauschZelle({ datum, aktiv }: { datum: unknown; aktiv: boolean }) {
  const [heute] = useState(() => new Date().toISOString().slice(0, 10))
  if (typeof datum !== 'string') return <span className="text-slate-400">–</span>
  const status = aktiv ? austauschStatus(datum, heute) : 'ok'
  return <Badge farbe={status === 'abgelaufen' ? 'rot' : status === 'bald' ? 'gelb' : 'grau'}>
    {status === 'abgelaufen' ? `${t('überfällig')} ` : ''}{austauschMonat(datum)}
  </Badge>
}
