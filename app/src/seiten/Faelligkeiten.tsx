import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { AnsichtWahl, Badge, datum, Fehler, Kacheln, Laden, Leer, Seite } from '../components/ui'
import { AustauschBadges } from '../components/AustauschHinweis'
import { DateiKnoepfe } from '../components/DateiKnoepfe'
import { ArtSymbol, EtikettText, ObjektSymbol, PruefartChip, Weiter } from '../components/Symbole'
import { anlageVergleich } from '../lib/sortierung'
import { entschluesselt } from '../lib/entschluesselt'
import { supabase } from '../lib/supabase'
import { TUERANLAGE_TYP } from '../lib/tueranlage'
import { tb } from '../lib/begriffe'
import { t } from '../lib/sprache'
import { AUSTAUSCH_VORLAUF_MONATE, austauschMonat, austauschText } from '../lib/austausch'
import { useAbfrage } from '../lib/useAbfrage'
import { useAnsicht } from '../lib/ansicht'
import { useAustausch } from '../lib/useAustausch'
import { Auswahl } from '../components/Auswahl'

type AnlageRoh = {
  id: string; etikett_id: string | null; kunden_bezeichnung: string | null; gebaeude: string | null; etage: string | null
  anlagentyp: { name: string; anlagenart: string; pruefart: { id: string; name: string; reihenfolge: number; aktiv: boolean }[] } | null
  anlage_faelligkeit: { pruefart_id: string; letzte_pruefung_am: string | null; naechste_pruefung_am: string | null }[]
  objekt: { id: string; name: string; ort: string | null; endkunde: { name: string } | null } | null
}
/** Eine Zeile je Anlage und Prüfart (bei Türen meist eine Prüfart je Tür). */
type AnlageZeile = Omit<AnlageRoh, 'anlage_faelligkeit'> & {
  schluessel: string; pruefart: string | null; letzte_pruefung_am: string | null; naechste_pruefung_am: string | null
}

function zeilenJePruefart(roh: AnlageRoh[]): AnlageZeile[] {
  return roh.flatMap((an) => {
    const arten = (an.anlagentyp?.pruefart ?? []).filter((p) => p.aktiv).sort((a, b) => a.reihenfolge - b.reihenfolge)
    return arten.map((p) => {
      const f = an.anlage_faelligkeit.find((x) => x.pruefart_id === p.id)
      return { ...an, schluessel: `${an.id}:${p.id}`, pruefart: arten.length > 1 ? p.name : null,
        letzte_pruefung_am: f?.letzte_pruefung_am ?? null, naechste_pruefung_am: f?.naechste_pruefung_am ?? null }
    })
  })
}

export type Faelligkeit = 'ueberfaellig' | 'bald' | 'nie' | 'spaeter'

/** Einordnung einer Tür: überfällig, in den nächsten `tage` Tagen fällig, noch nie geprüft oder später. */
export function faelligkeit(naechste: string | null, letzte: string | null, heute: string, grenze: string): Faelligkeit {
  if (!letzte && !naechste) return 'nie'
  if (naechste && naechste < heute) return 'ueberfaellig'
  if (naechste && naechste <= grenze) return 'bald'
  return 'spaeter'
}

const RANG: Record<Faelligkeit, number> = { ueberfaellig: 0, bald: 1, nie: 2, spaeter: 3 }
const TEXT: Record<Faelligkeit, string> = { ueberfaellig: t('überfällig'), bald: t('bald fällig'), nie: t('noch nie geprüft'), spaeter: t('später') }

export default function Faelligkeiten() {
  const navigate = useNavigate()
  const austausch = useAustausch()
  const [tage, setTage] = useState(30)
  const [ansicht, setAnsicht] = useAnsicht('faelligkeiten')
  const [zeigen, setZeigen] = useState<Record<Faelligkeit, boolean>>({ ueberfaellig: true, bald: true, nie: true, spaeter: false })
  const [heute] = useState(() => new Date().toISOString().slice(0, 10))
  const grenze = useMemo(() => new Date(new Date(heute).getTime() + tage * 864e5).toISOString().slice(0, 10), [heute, tage])

  const liste = useAbfrage(() => entschluesselt('anlage', supabase.from('anlage')
    .select('id, etikett_id, kunden_bezeichnung, gebaeude, etage, anlagentyp(name, anlagenart, pruefart(id, name, reihenfolge, aktiv)), anlage_faelligkeit(pruefart_id, letzte_pruefung_am, naechste_pruefung_am), objekt!inner(id, name, ort, aktiv, endkunde!inner(id, name, aktiv))')
    .eq('status', 'aktiv').neq('anlagentyp_id', TUERANLAGE_TYP).eq('objekt.aktiv', true).eq('objekt.endkunde.aktiv', true)
    .limit(5000)))
  const zeilen = useMemo(() => zeilenJePruefart((liste.daten ?? []) as unknown as AnlageRoh[]), [liste.daten])

  const objekte = useMemo(() => {
    const m = new Map<string, { objekt: NonNullable<AnlageZeile['objekt']>; anlagen: (AnlageZeile & { f: Faelligkeit })[] }>()
    for (const an of zeilen) {
      if (!an.objekt) continue
      const f = faelligkeit(an.naechste_pruefung_am, an.letzte_pruefung_am, heute, grenze)
      if (!m.has(an.objekt.id)) m.set(an.objekt.id, { objekt: an.objekt, anlagen: [] })
      m.get(an.objekt.id)!.anlagen.push({ ...an, f })
    }
    return [...m.values()]
      .map((o) => ({ ...o, sichtbar: o.anlagen.filter((an) => zeigen[an.f]).sort((a, b) => RANG[a.f] - RANG[b.f] || (a.naechste_pruefung_am ?? '').localeCompare(b.naechste_pruefung_am ?? '') || anlageVergleich({ ...a, bezeichnung: a.kunden_bezeichnung }, { ...b, bezeichnung: b.kunden_bezeichnung })) }))
      .filter((o) => o.sichtbar.length > 0)
      .sort((a, b) => {
        // dringendste zuerst: Objekte mit überfälligen Türen, dann frühestes Datum
        const ue = (o: typeof a) => o.sichtbar.some((an) => an.f === 'ueberfaellig') ? 0 : 1
        const frueh = (o: typeof a) => o.sichtbar.map((an) => an.naechste_pruefung_am ?? '9999').sort()[0]
        return ue(a) - ue(b) || frueh(a).localeCompare(frueh(b))
      })
  }, [zeilen, heute, grenze, zeigen])

  const zaehler = useMemo(() => {
    const z: Record<Faelligkeit, number> = { ueberfaellig: 0, bald: 0, nie: 0, spaeter: 0 }
    for (const an of zeilen) z[faelligkeit(an.naechste_pruefung_am, an.letzte_pruefung_am, heute, grenze)]++
    return z
  }, [zeilen, heute, grenze])

  const starten = (objektId: string) => navigate(`/pruefen/o/${objektId}`)


  const exportZeilen = () => {
    const mitPruefart = zeilen.some((an) => an.pruefart)
    const tabelle = [[t('Kunde'), t('Objekt'), t('Ort'), t('Etikett'), t('Bezeichnung'), t('Gebäude'), t('Etage'), tb('Türtyp'), ...(mitPruefart ? [t('Prüfart')] : []), t('Letzte Prüfung'), t('Nächste Prüfung'), t('Status')]]
    for (const o of objekte) for (const an of o.sichtbar) {
      tabelle.push([o.objekt.endkunde?.name ?? '', o.objekt.name, o.objekt.ort ?? '', an.etikett_id ?? '', an.kunden_bezeichnung ?? '', an.gebaeude ?? '', an.etage ?? '',
        an.anlagentyp?.name ?? '', ...(mitPruefart ? [an.pruefart ?? ''] : []), datum(an.letzte_pruefung_am), datum(an.naechste_pruefung_am), TEXT[an.f]])
    }
    return tabelle
  }

  return (
    <Seite titel={t('Fälligkeiten')} aktionen={<DateiKnoepfe art="export" name={`Faelligkeiten_${heute}`} blattName={t('Fälligkeiten')} zeilen={exportZeilen} disabled={objekte.length === 0} />}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(['ueberfaellig', 'bald', 'nie', 'spaeter'] as Faelligkeit[]).map((f) => (
          <button key={f} onClick={() => setZeigen({ ...zeigen, [f]: !zeigen[f] })} aria-pressed={zeigen[f]}
            className={`karte p-3 text-left ${zeigen[f] ? 'ring-2 ring-marke' : 'opacity-60'}`}>
            <div className={`text-2xl font-bold ${f === 'ueberfaellig' ? 'text-red-700' : f === 'bald' ? 'text-amber-700' : ''}`}>{zaehler[f]}</div>
            <div className="text-sm text-slate-600">{f === 'bald' ? t('fällig in {n} Tagen', { n: tage }) : TEXT[f]}</div>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 font-normal">
          {t('Vorschau')}
          <Auswahl className="mt-0 w-auto" value={tage} onChange={(e) => setTage(Number(e.target.value))} aria-label={t('Zeitraum')}>
            {[14, 30, 60, 90, 180].map((an) => <option key={an} value={an}>{t('{n} Tage', { n: an })}</option>)}
          </Auswahl>
        </label>
        <AnsichtWahl wert={ansicht} onWechsel={setAnsicht} />
      </div>
      <Fehler text={liste.fehler} />
      {austausch.gruppen.length > 0 && <AustauschAbschnitt austausch={austausch} />}
      {liste.laedt ? <Laden /> : objekte.length === 0 ? <Leer>{tb('Keine Türen in dieser Auswahl.')}</Leer> : objekte.map(({ objekt, sichtbar }) => (
        <section key={objekt.id} className="karte" data-objekt={objekt.name}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
            <div className="flex items-center gap-3">
              <ObjektSymbol groesse="sm" />
              <div>
                <Link className="link" to={`/objekte/${objekt.id}`}>{objekt.name}</Link>
                <div className="text-sm text-slate-500">{objekt.endkunde?.name}{objekt.ort ? ` · ${objekt.ort}` : ''}</div>
              </div>
            </div>
            <button className="btn-primaer" onClick={() => starten(objekt.id)}>{t('Prüfen')}</button>
          </div>
          {ansicht === 'kacheln' ? (
            <div className="p-3">
              <Kacheln aria-label={t('Fällig in {objekt}', { objekt: objekt.name })}>
                {sichtbar.map((an) => (
                  <li key={an.schluessel}>
                    <Link to={`/objekte/${objekt.id}?anlage=${an.id}`} className="kachel group p-3 text-sm">
                      <div className="flex items-start gap-3">
                        <ArtSymbol art={an.anlagentyp?.anlagenart} groesse="sm" />
                        <div className="min-w-0 flex-1">
                          <div><EtikettText id={an.etikett_id} art={an.anlagentyp?.anlagenart} /> {an.kunden_bezeichnung}</div>
                          <div className="text-slate-500">{[[an.gebaeude, an.etage].filter(Boolean).join(' / '), an.anlagentyp?.name].filter(Boolean).join(' · ')}</div>
                        </div>
                      </div>
                      <PruefartChip name={an.pruefart} />
                      <div className="mt-auto flex items-center justify-between gap-2 pt-1"><FaelligBadge an={an} /><Weiter /></div>
                    </Link>
                  </li>
                ))}
              </Kacheln>
            </div>
          ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {sichtbar.map((an) => (
              <li key={an.schluessel}>
                <Link to={`/objekte/${objekt.id}?anlage=${an.id}`} className="zeile group py-2.5">
                  <ArtSymbol art={an.anlagentyp?.anlagenart} groesse="sm" />
                  <div className="min-w-0 flex-1">
                    <div><EtikettText id={an.etikett_id} art={an.anlagentyp?.anlagenart} /> {an.kunden_bezeichnung}</div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-slate-500">
                      <span>{[[an.gebaeude, an.etage].filter(Boolean).join(' / '), an.anlagentyp?.name].filter(Boolean).join(' · ')}</span>
                      <PruefartChip name={an.pruefart} />
                    </div>
                    <div className="mt-1 sm:hidden"><FaelligBadge an={an} /></div>
                  </div>
                  <span className="hidden sm:block"><FaelligBadge an={an} /></span>
                  <Weiter />
                </Link>
              </li>
            ))}
          </ul>
          )}
        </section>
      ))}
    </Seite>
  )
}

function FaelligBadge({ an }: { an: { f: Faelligkeit; naechste_pruefung_am: string | null } }) {
  return (
    <Badge farbe={an.f === 'ueberfaellig' ? 'rot' : an.f === 'bald' ? 'gelb' : 'grau'}>
      {an.f === 'nie' ? t('noch nie geprüft') : an.f === 'ueberfaellig' ? t('überfällig seit {datum}', { datum: datum(an.naechste_pruefung_am) }) : t('fällig {datum}', { datum: datum(an.naechste_pruefung_am) })}
    </Badge>
  )
}

/** Melder mit erreichtem Austauschdatum oder Austausch in den nächsten 6 Monaten, je Anlage (Planung des Austauschs). */
function AustauschAbschnitt({ austausch }: { austausch: ReturnType<typeof useAustausch> }) {
  const abgelaufen = austausch.melder.filter((m) => m.status === 'abgelaufen').length
  const bald = austausch.melder.length - abgelaufen
  const exportZeilen = () => [
    [t('Kunde'), t('Objekt'), t('Ort'), t('Anlage'), t('Wohnung / Bereich'), t('Melder'), t('Raum'), t('Austausch (Monat)'), t('Status')],
    ...austausch.melder.map((m) => [m.anlage.objekt.endkunde?.name ?? '', m.anlage.objekt.name, m.anlage.objekt.ort ?? '',
      [m.anlage.etikett_id, m.anlage.kunden_bezeichnung].filter(Boolean).join(' '), m.gruppe ?? '', m.nummer, m.ort ?? '',
      austauschMonat(m.austausch), m.status === 'abgelaufen' ? t('überfällig') : t('in {n} Monaten', { n: AUSTAUSCH_VORLAUF_MONATE })]),
  ]
  return (
    <section className="karte" data-austausch>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
        <div>
          <h2 className="font-semibold">{t('Melder-Austausch')}</h2>
          <p className="text-sm text-slate-500">
            <span className="font-medium text-red-700">{t('{n} überfällig', { n: abgelaufen })}</span>, <span className="font-medium text-amber-700">{t('{n} in den nächsten {m} Monaten', { n: bald, m: AUSTAUSCH_VORLAUF_MONATE })}</span>
          </p>
        </div>
        <DateiKnoepfe art="export" name={`Melder-Austausch_${austausch.heute}`} blattName={t('Melder-Austausch')} zeilen={exportZeilen} />
      </div>
      <ul className="divide-y divide-slate-100 text-sm">
        {austausch.gruppen.map((g) => (
          <li key={g.anlage.id} className="px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <ArtSymbol art="rauchwarnmelder" groesse="sm" />
              <Link className="link" to={`/objekte/${g.anlage.objekt.id}?anlage=${g.anlage.id}`}>
                {g.anlage.etikett_id && <EtikettText id={g.anlage.etikett_id} />} {g.anlage.kunden_bezeichnung}
              </Link>
              <span className="text-slate-500">{[g.anlage.objekt.name, g.anlage.objekt.endkunde?.name].filter(Boolean).join(' · ')}</span>
              <AustauschBadges z={g.zaehler} />
            </div>
            <ul className="ml-9 mt-1 space-y-0.5 text-slate-600">
              {g.melder.map((m) => (
                <li key={m.id} className={m.status === 'abgelaufen' ? 'text-red-700' : 'text-amber-800'}>
                  {t('Melder {code}', { code: m.nummer })}{m.gruppe ? ` · ${m.gruppe}` : ''}{m.ort ? ` · ${m.ort}` : ''}: {austauschText(m.austausch, m.status)}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  )
}
