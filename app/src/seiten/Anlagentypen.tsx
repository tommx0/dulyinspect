import { useState } from 'react'
import { Formular, type FeldDef } from '../components/Formular'
import { ArtSymbol, PruefartChip, Weiter } from '../components/Symbole'
import { AnsichtWahl, Badge, Dialog, Fehler, Kacheln, Leer, Seite, Tabelle } from '../components/ui'
import { ARTEN, artDefinition, STANDARD_PRUEFART } from '../lib/anlagenarten'
import { tb, useAnlagenarten } from '../lib/begriffe'
import { t } from '../lib/sprache'
import { fehlertext, supabase, type Zeile } from '../lib/supabase'
import { TUERANLAGE_TYP } from '../lib/tueranlage'
import { useAbfrage } from '../lib/useAbfrage'
import { useAnsicht } from '../lib/ansicht'
import { Auswahl } from '../components/Auswahl'
import { ExportKnopf, ImportKnopf } from '../components/VorlagenAustausch'
import { austauschDateiname, typenExportieren } from '../lib/vorlagenAustausch'

const KATEGORIEN = [
  { wert: 'fluchttuer', text: t('Fluchttür') },
  { wert: 'automatiktuer', text: t('Automatische Tür') },
  { wert: 'sonstige', text: t('Sonstige') },
]

type PruefartZeile = Zeile<'pruefart'> & { checkliste: { name: string } | null }
type Typ = Zeile<'anlagentyp'> & { pruefart: PruefartZeile[] }
type Checkliste = { id: string; name: string }

export default function Anlagentypen() {
  const arten = useAnlagenarten()
  const [dialog, setDialog] = useState<Typ | 'neu' | { kopie: Typ } | null>(null)
  const [filter, setFilter] = useState<string>('')
  const [fehler, setFehler] = useState('')
  const [ansicht, setAnsicht] = useAnsicht('anlagentypen')
  // Ohne den festen Typ der Türanlagen (je Objekt automatisch, siehe TueranlageMehrpersonen)
  const typen = useAbfrage(() => supabase.from('anlagentyp').select('*, pruefart(*, checkliste(name))').neq('id', TUERANLAGE_TYP).order('name'))
  const checklisten = useAbfrage(() => supabase.from('checkliste').select('id, name').eq('aktiv', true).order('name'))

  const mehrereArten = arten.length > 1
  const liste = ((typen.daten ?? []) as Typ[]).filter((ty) => !filter || ty.anlagenart === filter)
  const aktivePruefarten = (ty: Typ) => ty.pruefart.filter((p) => p.aktiv).sort((a, b) => a.reihenfolge - b.reihenfolge)
  const mitName = (ty: Typ) => aktivePruefarten(ty).length > 1
  const name = (ty: Typ) => <>{ty.name} {!ty.aktiv && <Badge>{t('inaktiv')}</Badge>} {ty.mehrpersonenpruefung && <Badge farbe="blau">{t('mehrere Prüfer')}</Badge>}</>
  const intervalle = (ty: Typ) => aktivePruefarten(ty).map((p) => (
    <div key={p.id} className="py-0.5">{mitName(ty) ? <PruefartChip name={p.name} zusatz={': ' + t('{n} Monate', { n: p.intervall_monate })} /> : t('{n} Monate', { n: p.intervall_monate })}</div>
  ))
  const checklistenText = (ty: Typ) => aktivePruefarten(ty).map((p) => (
    <div key={p.id}>{mitName(ty) && `${p.name}: `}{p.checkliste?.name ?? <Badge farbe="gelb">{t('keine')}</Badge>}</div>
  ))
  const duplizieren = (ty: Typ) => (
    <span className="flex gap-3">
      <button className="link text-sm" aria-label={t('{name} duplizieren', { name: ty.name })} onClick={(e) => { e.stopPropagation(); setDialog({ kopie: ty }) }}>{t('Duplizieren')}</button>
      <ExportKnopf className="link text-sm" label={t('{name} exportieren', { name: ty.name })} onFehler={setFehler}
        laden={() => typenExportieren([ty.id])} dateiname={austauschDateiname('anlagentyp', ty.name)} />
    </span>
  )

  return (
    <Seite titel={tb('Türtypen')} aktionen={<>
      <ImportKnopf onFertig={() => { typen.neuLaden(); checklisten.neuLaden() }} />
      <ExportKnopf text={filter ? t('Auswahl exportieren') : t('Alle exportieren')} onFehler={setFehler} dateiname={austauschDateiname('anlagentypen', filter || undefined)}
        laden={() => typenExportieren(filter ? liste.map((ty) => ty.id) : undefined)} />
      <button className="btn-primaer" onClick={() => setDialog('neu')}>{tb('+ Türtyp')}</button>
      <AnsichtWahl wert={ansicht} onWechsel={setAnsicht} />
    </>}>
      {mehrereArten && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('Nach Art filtern')}>
          {[{ wert: '', text: t('Alle') }, ...arten.map((a) => ({ wert: a, text: t(ARTEN[a].name) }))].map((f) => (
            <button key={f.wert} className={filter === f.wert ? 'btn-primaer' : 'btn-sekundaer'} onClick={() => setFilter(f.wert)}>{f.text}</button>
          ))}
        </div>
      )}
      {arten.includes('tuer') && <TueranlageMehrpersonen />}
      <Fehler text={fehler || typen.fehler} />
      {typen.daten?.length === 0 ? <Leer>{tb('Noch keine Türtypen.')}</Leer> : ansicht === 'kacheln' ? (
        <Kacheln aria-label={tb('Türtypen')}>
          {liste.map((ty) => (
            <li key={ty.id} className={`karte flex flex-col ${ty.aktiv ? '' : 'text-slate-400'}`} data-typ={ty.name}>
              <button type="button" onClick={() => setDialog(ty)} aria-label={t('{name} bearbeiten', { name: ty.name })}
                className="group flex flex-1 flex-col gap-2 rounded-t-lg p-4 text-left transition hover:bg-akzent-hell/40">
                <div className="flex w-full items-start gap-3">
                  <ArtSymbol art={ty.anlagenart} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{name(ty)}</div>
                    <div className="text-sm text-slate-500">
                      {[mehrereArten && t(artDefinition(ty.anlagenart).name), KATEGORIEN.find((k) => k.wert === ty.kategorie)?.text].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <Weiter />
                </div>
                <div className="text-sm"><span className="text-slate-500">{t('Intervall')}</span>{intervalle(ty)}</div>
                <div className="text-sm"><span className="text-slate-500">{t('Checkliste')}</span>{checklistenText(ty)}</div>
              </button>
              <div className="border-t border-slate-100 px-4 py-2">{duplizieren(ty)}</div>
            </li>
          ))}
        </Kacheln>
      ) : (
        <Tabelle kopf={[t('Bezeichnung'), ...(mehrereArten ? [t('Art')] : []), t('Kategorie'), t('Intervall'), t('Checkliste'), '']}>
          {liste.map((ty) => (
            <tr key={ty.id} onClick={() => setDialog(ty)} className={`group cursor-pointer transition-colors hover:bg-akzent-hell/60 ${ty.aktiv ? '' : 'text-slate-400'}`}>
              <td className="px-3 py-2 font-medium">
                <span className="flex items-center gap-2.5"><ArtSymbol art={ty.anlagenart} groesse="sm" /><span>{name(ty)}</span></span>
              </td>
              {mehrereArten && <td className="px-3 py-2">{t(artDefinition(ty.anlagenart).name)}</td>}
              <td className="px-3 py-2">{KATEGORIEN.find((k) => k.wert === ty.kategorie)?.text ?? '–'}</td>
              <td className="px-3 py-2">{intervalle(ty)}</td>
              <td className="px-3 py-2">{checklistenText(ty)}</td>
              <td className="pr-3">
                <span className="flex items-center justify-end gap-3">
                  {duplizieren(ty)}
                  <Weiter />
                </span>
              </td>
            </tr>
          ))}
        </Tabelle>
      )}

      <Dialog offen={dialog !== null} titel={dialog === 'neu' ? tb('Neuer Türtyp') : dialog && 'kopie' in dialog ? tb('Türtyp duplizieren') : tb('Türtyp bearbeiten')} onSchliessen={() => setDialog(null)} breit>
        {dialog && (
          <TypFormular key={dialog === 'neu' ? 'neu' : 'kopie' in dialog ? `kopie-${dialog.kopie.id}` : dialog.id}
            typ={dialog === 'neu' || 'kopie' in dialog ? null : dialog} vorlage={dialog !== 'neu' && 'kopie' in dialog ? dialog.kopie : undefined} arten={arten}
            standardArt={filter || arten[0]} checklisten={checklisten.daten ?? []}
            onAbbrechen={() => setDialog(null)} onGespeichert={() => { setDialog(null); typen.neuLaden() }} />
        )}
      </Dialog>
    </Seite>
  )
}

/** Türanlage je Objekt: Mehrpersonenprüfung für die gemeinsame Prüfung der Türen (am festen Typ der Türanlagen). */
function TueranlageMehrpersonen() {
  const typ = useAbfrage(() => supabase.from('anlagentyp').select('mehrpersonenpruefung').eq('id', TUERANLAGE_TYP).maybeSingle())
  const [fehler, setFehler] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  const umschalten = async (wert: boolean) => {
    setFehler(''); setLaeuft(true)
    const { error } = await supabase.from('anlagentyp').update({ mehrpersonenpruefung: wert }).eq('id', TUERANLAGE_TYP)
    setLaeuft(false)
    if (error) return setFehler(fehlertext(error))
    typ.neuLaden()
  }
  if (!typ.daten) return null
  return (
    <section className="karte space-y-2 p-4" aria-label={t('Türanlage')}>
      <h2 className="font-semibold">{t('Türanlage')}</h2>
      <p className="text-sm text-slate-600">
        {t('Die Türen eines Objekts werden gemeinsam als „Türanlage“ geprüft und mit einer Unterschrift abgeschlossen. Die App legt die Türanlage je Objekt selbst an.')}
      </p>
      <label className="flex items-center gap-2.5 font-normal">
        <input type="checkbox" checked={typ.daten.mehrpersonenpruefung} disabled={laeuft} onChange={(e) => void umschalten(e.target.checked)} />
        {t('Mehrpersonenprüfung erlauben (weitere Prüfer fragen beim Hauptprüfer an und prüfen Türen mit)')}
      </label>
      <Fehler text={fehler} />
    </section>
  )
}

type PruefartEntwurf = {
  id?: string
  /** Bezug für „schließt ein“: ID der gespeicherten Prüfart, bei neuen eine Kennung nur für diesen Dialog */
  schluessel: string
  /** Schlüssel der eingeschlossenen Prüfart ('' = keine) */
  schliesst_ein: string
  name: string; intervall_monate: string; checkliste_id: string
  elemente: string; elemente_anteil: string; elemente_zyklus_monate: string
}
const NEUE_PRUEFART = { schliesst_ein: '', intervall_monate: '12', checkliste_id: '', elemente: 'keine', elemente_anteil: '25', elemente_zyklus_monate: '12' }

function TypFormular({ typ, vorlage, arten, standardArt, checklisten, onAbbrechen, onGespeichert }: {
  typ: Typ | null
  /** Duplizieren: neuer Typ mit den Einstellungen und aktiven Prüfarten dieses Typs (Checklisten bleiben dieselben) */
  vorlage?: Typ
  arten: string[]
  standardArt: string
  checklisten: Checkliste[]
  onAbbrechen: () => void
  onGespeichert: () => void
}) {
  const [pruefarten, setPruefarten] = useState<PruefartEntwurf[]>(() => {
    const quelle = typ ?? vorlage
    const aktive = (quelle?.pruefart ?? []).filter((p) => p.aktiv).sort((a, b) => a.reihenfolge - b.reihenfolge)
    if (!quelle || (!typ && !aktive.length)) return [{ ...NEUE_PRUEFART, schluessel: crypto.randomUUID(), name: STANDARD_PRUEFART }]
    // Kopie: neue Kennungen statt IDs, „schließt ein“ zeigt auf die Kennungen der Kopie
    const kennung = new Map(aktive.map((p) => [p.id, typ ? p.id : crypto.randomUUID()]))
    return aktive.map((p) => ({
      id: typ ? p.id : undefined, schluessel: kennung.get(p.id)!, schliesst_ein: (p.schliesst_ein_id && kennung.get(p.schliesst_ein_id)) || '',
      name: p.name, intervall_monate: String(p.intervall_monate), checkliste_id: p.checkliste_id ?? '',
      elemente: p.elemente, elemente_anteil: String(p.elemente_anteil ?? 25), elemente_zyklus_monate: String(p.elemente_zyklus_monate),
    }))
  })
  const [art, setArt] = useState(typ?.anlagenart ?? vorlage?.anlagenart ?? standardArt)
  const elementDef = artDefinition(art).elemente
  const mehrere = pruefarten.length > 1
  const aendern = (i: number, teil: Partial<PruefartEntwurf>) => setPruefarten((l) => l.map((p, j) => (j === i ? { ...p, ...teil } : p)))

  const felder = (w: Record<string, unknown>): FeldDef[] => [
    { name: 'name', label: t('Bezeichnung'), pflicht: true, breit: true },
    // Art nur beim Anlegen wählbar (Prüfarten und Felder hängen daran)
    ...(!typ && arten.length > 1 ? [{ name: 'anlagenart', label: t('Art'), typ: 'select', pflicht: true,
      optionen: arten.map((a) => ({ wert: a, text: t(artDefinition(a).name), symbol: <ArtSymbol art={a} /> })) } as FeldDef] : []),
    ...(artDefinition(String(w.anlagenart)).mitKategorie ? [{ name: 'kategorie', label: t('Kategorie'), typ: 'select', pflicht: true, optionen: KATEGORIEN } as FeldDef] : []),
    // Türen prüft man gemeinsam in der Türanlage des Objekts: dort gilt die Mehrpersonenprüfung (TueranlageMehrpersonen)
    ...(String(w.anlagenart) === 'tuer' ? [] : [{ name: 'mehrpersonenpruefung', label: t('Mehrpersonenprüfung erlauben (weitere Prüfer fragen beim Hauptprüfer an und prüfen mit)'), typ: 'checkbox', breit: true } as FeldDef]),
    { name: 'aktiv', label: t('aktiv'), typ: 'checkbox' },
  ]

  const zusatz = (
    <fieldset className="space-y-3 rounded-md border border-slate-200 p-3">
      <legend className="px-1 text-sm font-semibold">{mehrere ? t('Prüfarten') : t('Prüfung')}</legend>
      {pruefarten.map((p, i) => (
        <div key={p.id ?? `neu-${i}`} className={`grid grid-cols-1 gap-3 sm:items-end ${mehrere ? 'sm:grid-cols-[minmax(0,1.4fr)_7rem_minmax(0,1fr)_auto]' : 'sm:grid-cols-[12rem_1fr]'}`}>
          {mehrere && <label className="block">{t('Prüfart')}<input value={p.name} required onChange={(e) => aendern(i, { name: e.target.value })} aria-label={t('Name der Prüfart {n}', { n: i + 1 })} /></label>}
          <label className="block">{mehrere ? t('Intervall (Monate)') : t('Prüfintervall (Monate)')}
            <input type="number" min={1} max={120} required value={p.intervall_monate} onChange={(e) => aendern(i, { intervall_monate: e.target.value })} />
          </label>
          <label className="block">{t('Checkliste')}
            <Auswahl value={p.checkliste_id} onChange={(e) => aendern(i, { checkliste_id: e.target.value })}>
              <option value="">–</option>
              {checklisten.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Auswahl>
          </label>
          {mehrere && <button type="button" className="btn-sekundaer" onClick={() => setPruefarten((l) => l.filter((_, j) => j !== i).map((x) => (x.schliesst_ein === p.schluessel ? { ...x, schliesst_ein: '' } : x)))}>{t('Entfernen')}</button>}
          {elementDef && (
            <div className="grid grid-cols-1 gap-3 sm:col-span-full sm:grid-cols-[1fr_8rem_10rem] sm:items-end">
              <label className="block">{t('{elemente} prüfen', { elemente: t(elementDef.mehrzahl) })}{mehrere ? ` (${p.name || t('Prüfart {n}', { n: i + 1 })})` : ''}
                <Auswahl value={p.elemente} onChange={(e) => aendern(i, { elemente: e.target.value })}>
                  <option value="keine">{t('keine')}</option>
                  <option value="alle">{t('alle bei jedem Termin')}</option>
                  <option value="anteil">{t('Anteil je Termin')}</option>
                </Auswahl>
              </label>
              {p.elemente === 'anteil' && <>
                <label className="block">{t('Anteil (%)')}
                  <input type="number" min={1} max={100} required value={p.elemente_anteil} onChange={(e) => aendern(i, { elemente_anteil: e.target.value })} />
                </label>
                <label className="block">{t('jede mind. alle (Monate)')}
                  <input type="number" min={1} max={120} required value={p.elemente_zyklus_monate} onChange={(e) => aendern(i, { elemente_zyklus_monate: e.target.value })} />
                </label>
              </>}
            </div>
          )}
          {mehrere && (
            <label className="block sm:col-span-full">{t('Schließt ein')}
              <Auswahl value={p.schliesst_ein} onChange={(e) => aendern(i, { schliesst_ein: e.target.value })}>
                <option value="">{t('keine')}</option>
                {pruefarten.filter((x, j) => j !== i && x.schliesst_ein !== p.schluessel).map((x) => (
                  <option key={x.schluessel} value={x.schluessel}>{x.name || t('Prüfart {n}', { n: pruefarten.indexOf(x) + 1 })}</option>
                ))}
              </Auswahl>
              {p.schliesst_ein && (
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  {t('Eine abgeschlossene Prüfung „{pruefart}“ setzt auch die Fälligkeit von „{eingeschlossen}“ zurück – auch bereits abgeschlossene Prüfungen.', {
                    pruefart: p.name || t('Prüfart {n}', { n: i + 1 }),
                    eingeschlossen: pruefarten.find((x) => x.schluessel === p.schliesst_ein)?.name || t('der eingeschlossenen Prüfart'),
                  })}
                </span>
              )}
            </label>
          )}
        </div>
      ))}
      <p className="text-xs text-slate-500">{t('Geprüft wird immer mit der aktuell freigegebenen Version der Checkliste.')}</p>
      <button type="button" className="link text-sm" onClick={() => setPruefarten((l) => [...l, { ...NEUE_PRUEFART, schluessel: crypto.randomUUID(), name: '' }])}>
        {t('+ weitere Prüfart (z. B. monatliche Funktionsprüfung)')}
      </button>
    </fieldset>
  )

  const speichern = async (w: Record<string, unknown>): Promise<string | void> => {
    if (!pruefarten.length) return t('Bitte mindestens eine Prüfart anlegen.')
    for (const p of pruefarten) {
      const n = Number(p.intervall_monate)
      if (!p.name.trim()) return t('Bitte jeder Prüfart einen Namen geben.')
      if (!(Number.isInteger(n) && n >= 1 && n <= 120)) return t('Intervall „{intervall}“ ungültig (1–120 Monate).', { intervall: p.intervall_monate })
    }
    if (new Set(pruefarten.map((p) => p.name.trim().toLowerCase())).size < pruefarten.length) return t('Jede Prüfart braucht einen eigenen Namen.')
    const daten = { name: w.name as string, aktiv: Boolean(w.aktiv), mehrpersonenpruefung: Boolean(w.mehrpersonenpruefung), anlagenart: art, kategorie: artDefinition(art).mitKategorie ? (w.kategorie as never) : null }
    let id = typ?.id
    if (typ) {
      const { error } = await supabase.from('anlagentyp').update(daten).eq('id', typ.id)
      if (error) return fehlertext(error)
    } else {
      const { data, error } = await supabase.from('anlagentyp').insert(daten).select('id').single()
      if (error) return fehlertext(error)
      id = data.id
    }
    // Prüfarten abgleichen: geänderte speichern, neue anlegen, entfernte löschen (schon benutzte nur deaktivieren)
    const zeilen = pruefarten.map((p, i) => ({
      anlagentyp_id: id!, name: p.name.trim(), intervall_monate: Number(p.intervall_monate),
      checkliste_id: p.checkliste_id || null, reihenfolge: i + 1, aktiv: true,
      elemente: elementDef ? p.elemente : 'keine',
      elemente_anteil: elementDef && p.elemente === 'anteil' ? Number(p.elemente_anteil) : null,
      elemente_zyklus_monate: Number(p.elemente_zyklus_monate) || 12,
    }))
    // Neue Prüfarten erst anlegen: „schließt ein“ kann nur auf gespeicherte Prüfarten zeigen
    const idJeSchluessel = new Map<string, string>()
    for (const [i, p] of pruefarten.entries()) {
      if (p.id) {
        const { error } = await supabase.from('pruefart').update(zeilen[i]).eq('id', p.id)
        if (error) return fehlertext(error)
        idJeSchluessel.set(p.schluessel, p.id)
      } else {
        const { data, error } = await supabase.from('pruefart').insert(zeilen[i]).select('id').single()
        if (error) return fehlertext(error)
        idJeSchluessel.set(p.schluessel, data.id)
      }
    }
    // Erst lösen, dann setzen (sonst stört der Schutz gegen gegenseitiges Einschließen, wenn die Richtung getauscht wird)
    const aenderungen = pruefarten.flatMap((p) => {
      const neu = p.schliesst_ein ? idJeSchluessel.get(p.schliesst_ein) ?? null : null
      const alt = typ?.pruefart.find((x) => x.id === p.id)?.schliesst_ein_id ?? null
      return neu === alt ? [] : [{ id: idJeSchluessel.get(p.schluessel)!, neu }]
    }).sort((a, b) => Number(b.neu === null) - Number(a.neu === null))
    for (const a of aenderungen) {
      const { error } = await supabase.from('pruefart').update({ schliesst_ein_id: a.neu }).eq('id', a.id)
      if (error) return fehlertext(error)
    }
    const behalten = new Set(pruefarten.map((p) => p.id).filter(Boolean))
    for (const alt of (typ?.pruefart ?? []).filter((p) => p.aktiv && !behalten.has(p.id))) {
      const { error } = await supabase.from('pruefart').delete().eq('id', alt.id)
      if (error) {
        const r = await supabase.from('pruefart').update({ aktiv: false }).eq('id', alt.id)
        if (r.error) return fehlertext(r.error)
      }
    }
    onGespeichert()
  }

  return (
    <Formular felder={felder} zusatz={zusatz} onAbbrechen={onAbbrechen} onSpeichern={speichern}
      onAenderung={(w) => { if (!typ && w.anlagenart) setArt(String(w.anlagenart)) }}
      start={typ ?? (vorlage
        ? { name: t('{name} (Kopie)', { name: vorlage.name }), aktiv: true, anlagenart: vorlage.anlagenart, kategorie: vorlage.kategorie, mehrpersonenpruefung: vorlage.mehrpersonenpruefung }
        : { aktiv: true, anlagenart: standardArt })} />
  )
}

