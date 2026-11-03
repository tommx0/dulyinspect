import { useMemo, useState } from 'react'
import { FileText } from 'lucide-react'
import { Link } from 'react-router'
import { useAuth } from '../auth'
import { Badge, datum, Fehler, Laden, Leer, Seite, Tabelle } from '../components/ui'
import { artDefinition } from '../lib/anlagenarten'
import { tb } from '../lib/begriffe'
import { t } from '../lib/sprache'
import { entschluesselt } from '../lib/entschluesselt'
import type { Ampel } from '../lib/pruefung'
import { supabase } from '../lib/supabase'
import { tueranlageName } from '../lib/tueranlage'
import { useAbfrage } from '../lib/useAbfrage'
import { protokollLinks } from '../protokoll/erzeugen'
import { AMPEL_TEXT } from './pruefen/ampel'

type Objekt = { id: string; name: string; ort: string | null; endkunde: { id: string; name: string } | null } | null
type Zeile = {
  id: string; art: 'sammel' | 'einzel'; revision: number; storage_pfad: string; sha256: string; erzeugt_am: string
  ergebnis: Ampel | null; unterzeichner: string[]
  session: { id: string; protokoll_nr: string | null; abgeschlossen_am: string | null; revision: number; leiter_id: string; objekt: Objekt } | null
  anlagenpruefung: { id: string; protokoll_nr: string | null; beendet_am: string | null; revision: number; pruefer_id: string
    anlage: { id: string; etikett_id: string | null; kunden_bezeichnung: string | null; anlagentyp: { anlagenart: string } | null; objekt: Objekt } | null } | null
}

/**
 * Alle gespeicherten PDF-Prüfprotokolle (je Prüfung und Revision, Termine aus der Zeit der Sessions mit dem Sammelprotokoll).
 * Welche Zeilen kommen, entscheidet der Server (protokoll_liste): Admins und Planer alle, Prüfer nur selbst unterschriebene.
 */
export default function ProtokollListe() {
  const { istAdmin } = useAuth()
  const [suche, setSuche] = useState('')
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [laedt, setLaedt] = useState('')

  const liste = useAbfrage(() => entschluesselt('protokoll', supabase.rpc('protokoll_liste')
    .select('id, art, revision, storage_pfad, sha256, erzeugt_am, ergebnis, unterzeichner, '
      + 'session(id, protokoll_nr, abgeschlossen_am, revision, leiter_id, objekt(id, name, ort, endkunde(id, name))), '
      + 'anlagenpruefung(id, protokoll_nr, beendet_am, revision, pruefer_id, anlage(id, etikett_id, kunden_bezeichnung, anlagentyp(anlagenart), objekt(id, name, ort, endkunde(id, name))))')
    .limit(5000)))
  const benutzer = useAbfrage(() => supabase.from('benutzer').select('id, name'))
  const namen = useMemo(() => new Map((benutzer.daten ?? []).map((b) => [b.id, b.name])), [benutzer.daten])

  const zeilen = useMemo(() => ((liste.daten ?? []) as unknown as Zeile[]).map((p) => {
    const ap = p.anlagenpruefung
    const objekt = ap?.anlage?.objekt ?? p.session?.objekt ?? null
    const anlage = p.session ? t('Sammelprotokoll')
      : artDefinition(ap?.anlage?.anlagentyp?.anlagenart).tueren ? tueranlageName(objekt?.name)
        : [ap?.anlage?.etikett_id, ap?.anlage?.kunden_bezeichnung].filter(Boolean).join(' · ') || tb('Tür')
    // Hauptprüfer bzw. Leiter zuerst
    const vorn = ap?.pruefer_id ?? p.session?.leiter_id
    const pruefer = [...p.unterzeichner].sort((a, b) => Number(b === vorn) - Number(a === vorn)).map((id) => namen.get(id) ?? t('Prüfer'))
    return {
      p, objekt, anlage, pruefer,
      nr: ap?.protokoll_nr ?? p.session?.protokoll_nr ?? '–',
      geprueft: ap ? ap.beendet_am : p.session?.abgeschlossen_am ?? null,
      ersetzt: p.revision < (ap ?? p.session)!.revision,
      seite: ap ? `/protokoll/${ap.id}` : `/pruefen/${p.session!.id}/protokolle`,
    }
  }), [liste.daten, namen])

  const gefiltert = useMemo(() => {
    const s = suche.trim().toLowerCase()
    return zeilen.filter((z) => !s || [z.nr, z.anlage, z.objekt?.name, z.objekt?.ort, z.objekt?.endkunde?.name, ...z.pruefer]
      .some((w) => w?.toLowerCase().includes(s)))
  }, [zeilen, suche])

  // Erst beim Klick holen und entschlüsseln (alle vorab wäre bei vielen Protokollen zu viel). Das Fenster öffnet sofort,
  // sonst blockiert der Browser es nach dem Warten als Pop-up – dann bleibt der Link zum Anklicken.
  const oeffnen = async (p: Zeile) => {
    const fenster = window.open('', '_blank')
    setLaedt(p.id)
    const url = (await protokollLinks([p]))[p.id]
    setLaedt('')
    setUrls((u) => ({ ...u, [p.id]: url }))
    if (url && fenster) fenster.location.href = url
    else fenster?.close()
  }

  return (
    <Seite titel={t('Prüfprotokolle')}>
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" placeholder={tb('Nr., Kunde, Objekt, Tür, Prüfer …')} value={suche} onChange={(e) => setSuche(e.target.value)}
          className="mt-0 max-w-xs" aria-label={t('Protokolle suchen')} />
      </div>
      <p className="text-sm text-slate-500">
        {istAdmin ? t('Alle gespeicherten Prüfprotokolle.') : t('Die Prüfprotokolle, die Sie allein oder mit anderen unterschrieben haben.')}
        {' '}{t('Nach dem Wiederöffnen bleibt das frühere Protokoll erhalten (ersetzt).')} {gefiltert.length === 1 ? t('1 Protokoll') : t('{n} Protokolle', { n: gefiltert.length })}.
      </p>
      <Fehler text={liste.fehler} />
      {liste.laedt ? <Laden /> : gefiltert.length === 0 ? <Leer>{t('Keine Protokolle.')}</Leer> : (
        <Tabelle kopf={[t('Nr.'), t('Geprüft am'), t('Objekt / Anlage'), t('Ergebnis'), t('Prüfer'), t('PDF')]}>
          {gefiltert.map(({ p, nr, geprueft, objekt, anlage, pruefer, ersetzt, seite }) => (
            <tr key={p.id} data-protokoll={p.id} className={ersetzt ? 'text-slate-500' : ''}>
              <td className="px-3 py-2 whitespace-nowrap">
                <Link className="link font-medium" to={seite}>{nr}</Link>
                {p.revision > 0 && <span className="block text-xs">{t('Rev. {n}', { n: p.revision })}</span>}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {datum(geprueft)}
                {(p.revision > 0 || ersetzt) && <span className="block text-xs">{ersetzt ? `${t('ersetzt')} · ` : ''}{t('erstellt {datum}', { datum: datum(p.erzeugt_am) })}</span>}
              </td>
              <td className="px-3 py-2">
                <div>{anlage}</div>
                <div className="text-xs text-slate-500">{[objekt?.endkunde?.name, objekt?.name, objekt?.ort].filter(Boolean).join(' · ')}</div>
              </td>
              <td className="px-3 py-2">{p.ergebnis ? <Badge farbe={p.ergebnis}>{AMPEL_TEXT[p.ergebnis]}</Badge> : '–'}</td>
              <td className="px-3 py-2">{pruefer.join(', ')}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                {urls[p.id] === '' ? <Badge farbe="rot">{t('nicht lesbar')}</Badge>
                  : urls[p.id] ? <a className="btn-sekundaer inline-flex items-center gap-1.5" href={urls[p.id]} target="_blank" rel="noreferrer"><FileText className="size-4" aria-hidden /> {t('PDF öffnen')}</a>
                    : <button className="btn-sekundaer inline-flex items-center gap-1.5" disabled={laedt === p.id} onClick={() => void oeffnen(p)}>
                      <FileText className="size-4" aria-hidden /> {laedt === p.id ? t('Lädt …') : t('PDF')}</button>}
              </td>
            </tr>
          ))}
        </Tabelle>
      )}
    </Seite>
  )
}
