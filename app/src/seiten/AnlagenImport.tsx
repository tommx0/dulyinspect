import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Badge, Fehler, Laden, Seite } from '../components/ui'
import { tabelleLesen, type Tabelle } from '../import/tabelle'
import { FELDER, spaltenErraten, typErraten, VORLAGE, zeilenPruefen, type Feld, type Zuordnung } from '../import/anlagen'
import { DateiKnoepfe } from '../components/DateiKnoepfe'
import { normalisiereEtikett } from '../lib/etikett'
import { loggen } from '../lib/log'
import { fehlertext, supabase } from '../lib/supabase'
import { demoKnopf, demoSperreAktiv } from '../lib/demo'
import { TUERANLAGE_TYP } from '../lib/tueranlage'
import { aktiveArten, begriff, nurTueren, tb } from '../lib/begriffe'
import { gebietsschema, t } from '../lib/sprache'
import { istBestandArt } from '../lib/bestand'
import { entschluesselt } from '../lib/entschluesselt'
import { useAbfrage } from '../lib/useAbfrage'
import { verschluesseln } from '../lib/verschluesselung'
import { Auswahl } from '../components/Auswahl'

const STATUS = { neu: ['gruen', t('wird angelegt')], vorhanden: ['grau', t('schon vorhanden')], fehler: ['rot', t('Fehler')] } as const

/** Türliste (CSV/Excel) in ein Objekt importieren – nur neue Türen, vorhandene werden übersprungen. */
export default function AnlagenImport() {
  const { id = '' } = useParams()
  const objekt = useAbfrage(() => entschluesselt('objekt', supabase.from('objekt').select('id, name, endkunde(id, name)').eq('id', id).single()), [id])
  const anlagen = useAbfrage(() => supabase.from('anlage').select('etikett_id, kunden_bezeichnung').eq('objekt_id', id).neq('anlagentyp_id', TUERANLAGE_TYP), [id])
  // Rauchwarnmelder und Geräte haben je Objekt einen Bestand: ihre Elemente importiert man in dessen Melder- bzw. Geräteliste
  const typen = useAbfrage(() => supabase.from('anlagentyp').select('id, name, anlagenart, pruefart(id, reihenfolge, aktiv)').eq('aktiv', true)
    .in('anlagenart', aktiveArten().filter((a) => !istBestandArt(a))).order('name'))

  const [datei, setDatei] = useState<{ name: string; tabelle: Tabelle } | null>(null)
  const [zuordnung, setZuordnung] = useState<Zuordnung>({})
  const [typWahl, setTypWahl] = useState<Record<string, string | null>>({}) // vom Admin gewählt
  const [standardTyp, setStandardTyp] = useState<string | null>(null)
  const [etiketten, setEtiketten] = useState<Map<string, { frei: boolean }> | null>(null)
  const [fehler, setFehler] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  const [fertig, setFertig] = useState<number | null>(null)
  const [heute] = useState(() => new Date().toISOString().slice(0, 10))

  const kopf = datei?.tabelle[0] ?? []
  const typWerte = useMemo(() => {
    const s = zuordnung.anlagentyp
    if (!datei || s === undefined) return []
    return [...new Set(datei.tabelle.slice(1).map((z) => (z[s] ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, gebietsschema()))
  }, [datei, zuordnung.anlagentyp])

  // Türtyp je Wert der Datei: Wahl des Admins, sonst automatisch erkannt
  const typZuordnung = useMemo(() => Object.fromEntries(typWerte.map((w) =>
    [w, w in typWahl ? typWahl[w] : typErraten(w, typen.daten ?? [])])), [typWerte, typWahl, typen.daten])

  // Etiketten der Datei im System nachschlagen
  useEffect(() => {
    const s = zuordnung.etikett_id
    if (!datei || s === undefined) return
    const ids = [...new Set(datei.tabelle.slice(1).map((z) => (z[s] ?? '').trim()).filter(Boolean).map(normalisiereEtikett))]
    let aktiv = true
    void (async () => {
      const m = new Map<string, { frei: boolean }>()
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await supabase.from('etikett').select('id, anlage_id').in('id', ids.slice(i, i + 200))
        if (error) { if (aktiv) setFehler(fehlertext(error)); return }
        for (const e of data) m.set(e.id, { frei: !e.anlage_id })
      }
      if (aktiv) setEtiketten(m)
    })()
    return () => { aktiv = false }
  }, [datei, zuordnung.etikett_id])

  const ergebnis = useMemo(() => {
    if (!datei || !anlagen.daten) return null
    if (zuordnung.etikett_id !== undefined && !etiketten) return null
    return zeilenPruefen({
      tabelle: datei.tabelle, zuordnung, typZuordnung, standardTyp, vorhandene: anlagen.daten, etiketten: etiketten ?? new Map(), heute,
    })
  }, [datei, zuordnung, typZuordnung, standardTyp, anlagen.daten, etiketten, heute])

  const neu = ergebnis?.filter((r) => r.status === 'neu') ?? []
  const typName = new Map((typen.daten ?? []).map((typ) => [typ.id, typ.name]))

  const einlesen = async (f: File | undefined) => {
    setFehler(''); setFertig(null); setDatei(null); setEtiketten(null); setTypWahl({})
    if (!f) return
    try {
      const tabelle = tabelleLesen(f.name, new Uint8Array(await f.arrayBuffer()))
      if (tabelle.length < 2) throw new Error(tb('Die Datei enthält keine Türen (erste Zeile = Spaltenüberschriften, darunter je Tür eine Zeile).'))
      setDatei({ name: f.name, tabelle })
      setZuordnung(spaltenErraten(tabelle[0]))
    } catch (e) {
      setFehler(fehlertext(e))
    }
  }

  const importieren = async () => {
    setLaeuft(true); setFehler('')
    // Antrieb/System gehört zu den Türdaten (eigenschaften), letzte Prüfung und Intervall zur ersten Prüfart des Typs
    // (Türen gehören von selbst zur Türanlage des Objekts)
    const zeilen = neu.map((r) => {
      const { antrieb_system, letzte_pruefung_am, intervall_monate, ...rest } = r.anlage!
      return { anlage: { ...rest, id: crypto.randomUUID(), objekt_id: id, eigenschaften: antrieb_system ? { antrieb_system } : {} },
        letzte_pruefung_am, intervall_monate }
    })
    const erstePruefart = (typId: string) => (typen.daten ?? []).find((typ) => typ.id === typId)?.pruefart
      .filter((p) => p.aktiv).sort((a, b) => a.reihenfolge - b.reihenfolge)[0]?.id
    const faelligkeiten = zeilen.filter((z) => z.letzte_pruefung_am || z.intervall_monate).flatMap((z) => {
      const pruefart = erstePruefart(z.anlage.anlagentyp_id)
      return pruefart ? [{ anlage_id: z.anlage.id, pruefart_id: pruefart, letzte_pruefung_am: z.letzte_pruefung_am, intervall_monate: z.intervall_monate }] : []
    })
    const { error } = await supabase.from('anlage').insert(await verschluesseln('anlage', zeilen.map((z) => z.anlage)))
    // Alles oder nichts: angelegte Türen wieder entfernen
    const zurueck = async () => {
      await supabase.from('anlage').delete().in('id', zeilen.map((z) => z.anlage.id))
    }
    if (!error && faelligkeiten.length) {
      const r = await supabase.from('anlage_faelligkeit').insert(faelligkeiten)
      if (r.error) {
        await zurueck()
        setLaeuft(false)
        return setFehler(t('Import abgebrochen, es wurde nichts angelegt: {grund}', { grund: fehlertext(r.error) }))
      }
    }
    setLaeuft(false)
    if (error) { await zurueck(); return setFehler(t('Import abgebrochen, es wurde nichts angelegt: {grund}', { grund: fehlertext(error) })) }
    setFertig(neu.length)
    // Keine Namen von Kunden, Objekten oder Dateien ins Server-Log (verschlüsselte Daten): nur Anzahl und ID
    void loggen('Import', `${neu.length} ${begriff('Tür(en)')} in Objekt ${id}`)
    setDatei(null)
    anlagen.neuLaden()
  }

  if (objekt.laedt && !objekt.daten) return <Laden />
  const o = objekt.daten
  if (!o) return <Seite titel={tb('Türen importieren')}><Fehler text={objekt.fehler || t('Objekt nicht gefunden')} /></Seite>

  return (
    <Seite titel={tb('Türen importieren')} zurueck={{ zu: `/objekte/${id}`, text: o.name }}>
      <p className="text-sm text-slate-600">
        {tb('Türliste als')} <strong>Excel (.xlsx)</strong> {t('oder')} <strong>CSV</strong> {t('in das Objekt')} <strong>{o.name}</strong> ({o.endkunde?.name}{tb(') übernehmen. Erste Zeile = Spaltenüberschriften, darunter eine Zeile je Tür. Türen, die es im Objekt schon gibt (gleiches Etikett oder gleiche Bezeichnung), werden übersprungen.')}
      </p>

      {fertig !== null && (
        <div role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          {tb('{n} Türen angelegt.', { n: fertig })} <Link className="link" to={`/objekte/${id}`}>{t('Zum Objekt')}</Link>
        </div>
      )}

      <section className="karte space-y-3 p-4">
        <h2 className="font-semibold">{t('1. Datei wählen')}</h2>
        <div>
          <label htmlFor="import-datei">{tb('Türliste (.xlsx oder .csv)')}</label>
          <input id="import-datei" type="file" accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => void einlesen(e.target.files?.[0])} />
        </div>
        <div className="space-y-1">
          <p className="text-sm text-slate-600">{tb('Leere Vorlage mit den passenden Spalten, im Excel-Format mit Auswahlliste für den Türtyp:')}</p>
          <DateiKnoepfe art="vorlage" name={nurTueren() ? 'Vorlage_Tuerimport' : 'Vorlage_Anlagenimport'} blattName={begriff('Türen')}
            zeilen={() => [VORLAGE[0]]}
            auswahl={() => [{ spalte: FELDER.findIndex((f) => f.feld === 'anlagentyp'), werte: (typen.daten ?? []).map((typ) => typ.name) }]} />
        </div>
        <Fehler text={fehler || anlagen.fehler || typen.fehler} />
      </section>

      {datei && (
        <>
          <section className="karte space-y-3 p-4">
            <h2 className="font-semibold">{t('2. Spalten zuordnen')}</h2>
            <p className="text-sm text-slate-600">{datei.name}: {t('{n} Zeilen. Die Zuordnung ist vorgeschlagen – bitte prüfen.', { n: datei.tabelle.length - 1 })}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {FELDER.map((f) => (
                <div key={f.feld}>
                  <label htmlFor={`spalte-${f.feld}`}>{f.titel}</label>
                  <Auswahl id={`spalte-${f.feld}`} value={zuordnung[f.feld] ?? ''}
                    onChange={(e) => {
                      const neu: Zuordnung = { ...zuordnung }
                      if (e.target.value === '') delete neu[f.feld]
                      else {
                        const i = Number(e.target.value)
                        for (const k of Object.keys(neu) as Feld[]) if (neu[k] === i) delete neu[k]
                        neu[f.feld] = i
                      }
                      if (f.feld === 'etikett_id') setEtiketten(null)
                      setZuordnung(neu)
                    }}>
                    <option value="">{t('– nicht übernehmen –')}</option>
                    {kopf.map((k, i) => <option key={i} value={i}>{k || t('Spalte {n}', { n: i + 1 })}{datei.tabelle[1]?.[i] ? ` ${t('(z. B. „{wert}“)', { wert: datei.tabelle[1][i] })}` : ''}</option>)}
                  </Auswahl>
                </div>
              ))}
            </div>
          </section>

          <section className="karte space-y-3 p-4">
            <h2 className="font-semibold">{tb('3. Türtypen zuordnen')}</h2>
            {typWerte.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-slate-600">{tb('Jeder Wert aus der Spalte „{spalte}“ braucht einen Türtyp der App.', { spalte: kopf[zuordnung.anlagentyp!] })}</p>
                {typWerte.map((w) => (
                  <div key={w} className="grid items-center gap-2 sm:grid-cols-2">
                    <span className="text-sm font-medium">„{w}“</span>
                    <Auswahl aria-label={tb('Türtyp für „{wert}“', { wert: w })} className="mt-0" value={typZuordnung[w] ?? ''}
                      onChange={(e) => setTypWahl({ ...typWahl, [w]: e.target.value || null })}>
                      <option value="">{t('– bitte wählen –')}</option>
                      {typen.daten?.map((typ) => <option key={typ.id} value={typ.id}>{typ.name}</option>)}
                    </Auswahl>
                  </div>
                ))}
              </div>
            )}
            <div>
              <label htmlFor="standard-typ">{typWerte.length ? tb('Türtyp für Zeilen ohne Angabe') : tb('Türtyp für alle Türen')}</label>
              <Auswahl id="standard-typ" value={standardTyp ?? ''} onChange={(e) => setStandardTyp(e.target.value || null)}>
                <option value="">{t('– keiner –')}</option>
                {typen.daten?.map((typ) => <option key={typ.id} value={typ.id}>{typ.name}</option>)}
              </Auswahl>
            </div>
          </section>

          <section className="karte space-y-3 p-4">
            <h2 className="font-semibold">{t('4. Vorschau und Import')}</h2>
            {!ergebnis ? <Laden /> : (
              <>
                <div className="flex flex-wrap gap-2 text-sm" data-import-zusammenfassung>
                  <Badge farbe="gruen">{t('{n} werden angelegt', { n: neu.length })}</Badge>
                  <Badge>{t('{n} schon vorhanden', { n: ergebnis.filter((r) => r.status === 'vorhanden').length })}</Badge>
                  <Badge farbe="rot">{t('{n} mit Fehlern (werden nicht angelegt)', { n: ergebnis.filter((r) => r.status === 'fehler').length })}</Badge>
                </div>
                <div className="max-h-[28rem] overflow-auto rounded-md border border-slate-200">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500 uppercase">
                      <tr><th className="px-3 py-2">{t('Zeile')}</th><th className="px-3 py-2">{t('Status')}</th><th className="px-3 py-2">{t('Etikett')}</th><th className="px-3 py-2">{t('Bezeichnung')}</th><th className="px-3 py-2">{t('Lage')}</th><th className="px-3 py-2">{tb('Türtyp')}</th><th className="px-3 py-2">{t('Hinweis')}</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {ergebnis.map((r) => (
                        <tr key={r.zeile} data-import-zeile={r.zeile} className={r.status === 'fehler' ? 'bg-red-50/50' : ''}>
                          <td className="px-3 py-1.5 text-slate-500">{r.zeile}</td>
                          <td className="px-3 py-1.5"><Badge farbe={STATUS[r.status][0]}>{STATUS[r.status][1]}</Badge></td>
                          <td className="whitespace-nowrap px-3 py-1.5 font-mono">{r.anlage?.etikett_id ?? r.werte.etikett_id ?? ''}</td>
                          <td className="px-3 py-1.5">{r.werte.kunden_bezeichnung}</td>
                          <td className="px-3 py-1.5">{[r.werte.gebaeude, r.werte.etage, r.werte.raum, r.werte.lage_beschreibung].filter(Boolean).join(' · ')}</td>
                          <td className="px-3 py-1.5">{r.anlage ? typName.get(r.anlage.anlagentyp_id) : r.werte.anlagentyp}</td>
                          <td className="px-3 py-1.5 text-xs text-red-800">{r.status === 'vorhanden' ? <span className="text-slate-500">{r.gruende.join(' · ')}</span> : r.gruende.join(' · ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-slate-500">{tb('Zeilen mit Fehlern korrigieren Sie in der Datei und laden sie erneut – bereits angelegte Türen werden dann übersprungen.')}</p>
                <button className="btn-primaer" {...demoKnopf()} disabled={laeuft || neu.length === 0 || demoSperreAktiv()} onClick={() => void importieren()}>
                  {laeuft ? t('Importiere …') : tb('{n} Türen anlegen', { n: neu.length })}
                </button>
              </>
            )}
          </section>
        </>
      )}
    </Seite>
  )
}
