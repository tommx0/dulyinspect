// Gruppen der Elemente einer Anlage verwalten (Wohnungen / Bereiche, Stromkreise …): vorab anlegen, umbenennen, löschen.
// Beim Bestand (Rauchwarnmelder, Geräte) außerdem Gebäude und Etage je Gruppe – sie gelten für ihre Elemente.
import { useState } from 'react'
import type { ElementDefinition } from '../lib/anlagenarten'
import { gruppenListe, nummernReihe, nummernText, schreibweiseAngleichen } from '../lib/elemente'
import { t } from '../lib/sprache'
import { fehlertext, supabase, type Zeile } from '../lib/supabase'
import { lageFelder, type AnlageWerte } from './anlageFelder'
import { bestaetigen } from './Bestaetigung'
import { Formular } from './Formular'
import type { useGruppeAuswahl } from './GruppeAuswahl'
import { Dialog, Fehler } from './ui'

type Gruppe = Zeile<'anlage_gruppe'>

export function GruppenVerwalten({ def, anlageId, gruppen, aktive, istAdmin, auswahl, onGeaendert, lage }: {
  def: ElementDefinition
  anlageId: string
  gruppen: Gruppe[]
  /** Bestand: Gebäude und Etage je Gruppe pflegen; Auswahl aus den Anlagen des Objekts (und den übrigen Gruppen) */
  lage?: AnlageWerte[]
  aktive: { gruppe: string | null }[]
  istAdmin: boolean
  /** Auswahl der Formulare: ihr Dialog legt auch hier eine einzelne Gruppe an */
  auswahl: ReturnType<typeof useGruppeAuswahl>
  onGeaendert: (meldung?: string) => void
}) {
  const [bearbeiten, setBearbeiten] = useState<Gruppe | null>(null)
  const [mehrere, setMehrere] = useState(false)
  const [fehler, setFehler] = useState('')
  const namen = gruppen.map((g) => g.name)
  const sortiert = gruppenListe(namen).map((n) => gruppen.find((g) => g.name === n)!)
  const anzahl = (name: string) => aktive.filter((e) => e.gruppe === name).length
  const mitLage = !!lage
  const lageWahl = lageFelder([...(lage ?? []), ...gruppen.map((g) => ({ art: null, gebaeude: g.gebaeude, etage: g.etage }))])
  // Nach Gebäude (ohne Gebäude zuletzt); ohne Lage eine Gruppe ohne Überschrift
  const nachGebaeude = new Map<string, Gruppe[]>()
  for (const g of sortiert) {
    const k = mitLage ? g.gebaeude?.trim() ?? '' : ''
    nachGebaeude.set(k, [...(nachGebaeude.get(k) ?? []), g])
  }
  const bloecke = [...nachGebaeude.entries()].sort(([a], [b]) => (!a ? 1 : !b ? -1 : a.localeCompare(b, 'de', { numeric: true })))

  const speichern = async (g: Gruppe, w: Record<string, unknown>) => {
    const name = String(w.name ?? '').trim()
    const gebaeude = mitLage ? (w.gebaeude as string | null) ?? null : g.gebaeude
    const etage = mitLage ? (w.etage as string | null) ?? null : g.etage
    if (name === g.name && gebaeude === g.gebaeude && etage === g.etage) return setBearbeiten(null)
    if (name.length > 40) return t('Höchstens 40 Zeichen.')
    const { error } = await supabase.from('anlage_gruppe').update({ name, gebaeude, etage }).eq('id', g.id)
    if (error) return error.code === '23505' ? t('{gruppe} „{name}“ gibt es schon.', { gruppe: def.gruppe, name }) : fehlertext(error)
    setBearbeiten(null)
    onGeaendert(name !== g.name ? t('{gruppe} „{alt}“ heißt jetzt „{name}“.', { gruppe: def.gruppe, alt: g.name, name }) : t('{gruppe} „{name}“ gespeichert.', { gruppe: def.gruppe, name }))
  }

  const loeschen = async (g: Gruppe) => {
    if (!await bestaetigen(t('{gruppe} „{name}“ löschen?', { gruppe: def.gruppe, name: g.name }), { ok: t('Löschen'), gefahr: true })) return
    setBearbeiten(null)
    const { error } = await supabase.from('anlage_gruppe').delete().eq('id', g.id)
    if (error) return setFehler(fehlertext(error))
    onGeaendert(t('{gruppe} „{name}“ gelöscht.', { gruppe: def.gruppe, name: g.name }))
  }

  // Mehrere auf einmal: „WE 1“ und Anzahl 12 → WE 1 bis WE 12 (vorhandene werden übersprungen)
  const reihe = (w: Record<string, unknown>) => {
    const alle = nummernReihe(String(w.start ?? ''), Number(w.anzahl))
    if (!alle || alle.length > 200) return null
    const neu = alle.filter((n) => !namen.includes(schreibweiseAngleichen(n, namen)!))
    return { alle, neu, vorhanden: alle.filter((n) => !neu.includes(n)) }
  }

  return (
    <section className="karte space-y-3 p-4" data-gruppen>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{def.gruppeMehrzahl}</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-sekundaer" onClick={() => setMehrere(true)}>{t('Mehrere anlegen …')}</button>
          <button type="button" className="btn-sekundaer" onClick={() => auswahl.oeffnen(() => {})}>+ {def.gruppe}</button>
        </div>
      </div>
      <p className="text-sm text-slate-600">
        {t('Legen Sie die {gruppen} vorab an. Beim Erfassen der {elemente} wählen Sie sie dann aus. Ein Klick benennt um, die {elemente} darin ändern sich mit. Die Zahl nennt die aktiven {elemente}.', {
          gruppen: def.gruppeMehrzahl, elemente: def.mehrzahl,
        })}
        {mitLage && ` ${t('Mit Gebäude und Etage erscheinen die {elemente} in der Prüfliste beim jeweiligen Gebäude.', { elemente: def.mehrzahl })}`}
      </p>
      <Fehler text={fehler} />
      {sortiert.length === 0 ? <p className="text-sm text-slate-500">{t('Noch keine angelegt.')}</p> : bloecke.map(([gebaeude, liste]) => (
        <div key={gebaeude} className="space-y-1.5" data-gebaeude={gebaeude}>
          {mitLage && (bloecke.length > 1 || gebaeude) && <h3 className="text-sm font-medium text-slate-600">{gebaeude || t('Ohne Gebäude')}</h3>}
          <ul className="flex flex-wrap gap-2">
            {liste.map((g) => (
              <li key={g.id}>
                <button type="button" onClick={() => { setFehler(''); setBearbeiten(g) }}
                  className="rounded-md border border-slate-200 px-2.5 py-1 text-sm hover:bg-slate-50">
                  {g.name}{mitLage && g.etage ? <span className="text-slate-500"> ({g.etage})</span> : null} <span className="text-slate-500">· {anzahl(g.name)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <Dialog offen={bearbeiten !== null} titel={mitLage ? t('{gruppe} bearbeiten', { gruppe: def.gruppe }) : t('{gruppe} umbenennen', { gruppe: def.gruppe })} onSchliessen={() => setBearbeiten(null)}>
        {bearbeiten && (
          <Formular key={bearbeiten.id} felder={[{ name: 'name', label: def.gruppe, pflicht: true, breit: mitLage,
            hinweis: anzahl(bearbeiten.name)
              ? t('Enthält {n} aktive {elemente}; sie ändern sich mit.', { n: anzahl(bearbeiten.name), elemente: anzahl(bearbeiten.name) === 1 ? def.einzahl : def.mehrzahl })
              : undefined },
            ...(mitLage ? lageWahl : [])]}
            start={{ name: bearbeiten.name, gebaeude: bearbeiten.gebaeude, etage: bearbeiten.etage }} onAbbrechen={() => setBearbeiten(null)} onSpeichern={(w) => speichern(bearbeiten, w)}
            zusatz={istAdmin && (anzahl(bearbeiten.name) === 0
              ? <button type="button" className="btn-sekundaer text-red-700" onClick={() => void loeschen(bearbeiten)}>{t('{gruppe} löschen', { gruppe: def.gruppe })}</button>
              : <p className="text-sm text-slate-500">{t('Löschen lässt sich {gruppe} erst, wenn keine aktiven {elemente} mehr darin sind.', { gruppe: def.gruppe, elemente: def.mehrzahl })}</p>)} />
        )}
      </Dialog>

      <Dialog offen={mehrere} titel={t('Mehrere {gruppen} anlegen', { gruppen: def.gruppeMehrzahl })} onSchliessen={() => setMehrere(false)}>
        {mehrere && (
          <Formular start={{ start: '', anzahl: 10 }} speichernText={t('Anlegen')} onAbbrechen={() => setMehrere(false)}
            felder={(w) => {
              const r = reihe(w)
              return [
                { name: 'start', label: t('Erster Name'), pflicht: true, hinweis: t('endet mit einer Zahl, z. B. „WE 1“ oder „EG 01“ – die weiteren zählen hoch') },
                { name: 'anzahl', label: t('Anzahl'), typ: 'number', pflicht: true, max: '200',
                  hinweis: !r ? t('Bitte ersten Namen und Anzahl (höchstens 200) angeben.')
                    : t('{erster} bis {letzter}', { erster: r.alle[0], letzter: r.alle[r.alle.length - 1] })
                      + (r.vorhanden.length ? ` · ${t('{namen} gibt es schon', { namen: nummernText(r.vorhanden) })}` : '') },
                ...(mitLage ? lageWahl.map((f) => ({ ...f, hinweis: f.name === 'gebaeude' ? t('gilt für alle neuen; leer lassen, wenn es nur ein Gebäude gibt') : undefined })) : []),
              ]
            }}
            onSpeichern={async (w) => {
              const r = reihe(w)
              if (!r) return t('Der erste Name muss mit einer Zahl enden (z. B. „WE 1“), Anzahl 1 bis 200.')
              if (!r.neu.length) return t('Diese {gruppen} gibt es alle schon.', { gruppen: def.gruppeMehrzahl })
              const { error } = await supabase.from('anlage_gruppe').insert(r.neu.map((name) => ({ anlage_id: anlageId, name,
                ...(mitLage ? { gebaeude: (w.gebaeude as string | null) ?? null, etage: (w.etage as string | null) ?? null } : {}) })))
              if (error) return fehlertext(error)
              setMehrere(false)
              onGeaendert(t('{n} {gruppen} angelegt.', { n: r.neu.length, gruppen: r.neu.length === 1 ? def.gruppe : def.gruppeMehrzahl }))
            }} />
        )}
      </Dialog>
    </section>
  )
}
