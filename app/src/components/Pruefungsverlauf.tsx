// Abgeschlossene Prüfungen mit Protokoll – für eine Anlage, ein Objekt oder einen Kunden.
// Neue Prüfungen haben je ein Protokoll; aus der Zeit der Sessions gibt es Sammelprotokolle je Termin.
import { FileText } from 'lucide-react'
import { Link } from 'react-router'
import { artDefinition } from '../lib/anlagenarten'
import { tb } from '../lib/begriffe'
import { t } from '../lib/sprache'
import { supabase } from '../lib/supabase'
import { tueranlageName } from '../lib/tueranlage'
import { entschluesselt } from '../lib/entschluesselt'
import { useAbfrage } from '../lib/useAbfrage'
import { Weiter } from './Symbole'
import { Badge, datum, Fehler, Leer } from './ui'

type Ampel = 'gruen' | 'gelb' | 'rot'
const AMPEL: Record<Ampel, string> = { gruen: t('ohne Mängel'), gelb: t('mit Mängeln'), rot: t('nicht betriebssicher') }

type Bezug = { anlageId: string } | { objektId: string } | { kundeId: string }

interface Eintrag {
  schluessel: string
  zu: string
  am: string
  titel: string
  zeile: string
  ergebnis: Ampel | null
}

const ANZAHL = 50

async function laden(b: Bezug): Promise<{ data: Eintrag[]; error: unknown }> {
  // Prüfungen ohne Session (je eine Nummer)
  let neu = supabase.from('anlagenpruefung')
    .select('id, beendet_am, abgeschlossen_am, protokoll_nr, revision, ergebnis, teil_von_id, teil_von:teil_von_id(protokoll_nr, revision), pruefer:benutzer!anlagenpruefung_pruefer_id_fkey(name), pruefart(name), anlage!inner(etikett_id, kunden_bezeichnung, objekt_id, objekt!inner(id, name, endkunde_id), anlagentyp(anlagenart))')
    .is('session_id', null).eq('status', 'geprueft').not('abgeschlossen_am', 'is', null)
  // Türen einer Türanlage (Teilprüfungen) erscheinen bei der Tür; bei Objekt und Kunde steht die Türanlage für sie
  if ('anlageId' in b) neu = neu.eq('anlage_id', b.anlageId)
  else if ('objektId' in b) neu = neu.eq('anlage.objekt_id', b.objektId).is('teil_von_id', null)
  else neu = neu.eq('anlage.objekt.endkunde_id', b.kundeId).is('teil_von_id', null)
  const r1 = await entschluesselt('anlagenpruefung', neu.order('beendet_am', { ascending: false }).limit(ANZAHL))
  if (r1.error) return { data: [], error: r1.error }
  const eintraege: Eintrag[] = (r1.data ?? []).map((p) => {
    // Tür einer Türanlage: Nummer und Revision des Protokolls der Türanlage (die ihres Objekts)
    const ta = p.teil_von_id ? p.teil_von as unknown as { protokoll_nr: string | null; revision: number } | null : null
    const nr = ta?.protokoll_nr ?? p.protokoll_nr ?? ''
    const rev = ta ? ta.revision : p.revision
    const istTa = !!artDefinition((p.anlage as { anlagentyp?: { anlagenart: string } | null }).anlagentyp?.anlagenart).tueren
    return {
      schluessel: p.id, zu: `/protokoll/${p.id}`, am: p.beendet_am ?? p.abgeschlossen_am!,
      titel: rev ? t('Protokoll {nummer} · Rev. {revision}', { nummer: nr, revision: rev }) : t('Protokoll {nummer}', { nummer: nr }),
      zeile: [
        'anlageId' in b ? null : istTa ? tueranlageName(p.anlage.objekt.name)
          : [p.anlage.etikett_id, p.anlage.kunden_bezeichnung].filter(Boolean).join(' · ') || tb('Tür'),
        ta ? tueranlageName(p.anlage.objekt.name) : null,
        'kundeId' in b && !istTa ? p.anlage.objekt.name : null,
        p.pruefart?.name, p.pruefer?.name,
      ].filter(Boolean).join(' · '),
      ergebnis: p.ergebnis as Ampel | null,
    }
  })

  // Aus der Zeit der Sessions: bei der Anlage ihre Prüfung im Termin, sonst der Termin mit Sammelprotokoll
  if ('anlageId' in b) {
    const r2 = await supabase.from('anlagenpruefung')
      .select('id, beendet_am, ergebnis, status, pruefer:benutzer!anlagenpruefung_pruefer_id_fkey(name), pruefart(name), session!anlagenpruefung_session_id_fkey!inner(id, protokoll_nr, revision, status)')
      .eq('anlage_id', b.anlageId).not('session_id', 'is', null).eq('session.status', 'abgeschlossen').in('status', ['geprueft', 'nicht_geprueft'])
      .order('beendet_am', { ascending: false }).limit(ANZAHL)
    if (r2.error) return { data: [], error: r2.error }
    for (const p of r2.data ?? []) {
      eintraege.push({
        schluessel: p.id, zu: `/pruefen/${p.session.id}/protokolle`, am: p.beendet_am ?? '',
        titel: p.session.revision
          ? t('Protokoll {nummer} · Rev. {revision}', { nummer: p.session.protokoll_nr ?? '', revision: p.session.revision })
          : t('Protokoll {nummer}', { nummer: p.session.protokoll_nr ?? '' }),
        zeile: [p.status === 'nicht_geprueft' ? t('nicht geprüft') : null, p.pruefart?.name, p.pruefer?.name, t('Termin mit Sammelprotokoll')].filter(Boolean).join(' · '),
        ergebnis: p.ergebnis as Ampel | null,
      })
    }
  } else {
    let alt = supabase.from('session')
      .select('id, begonnen_am, abgeschlossen_am, protokoll_nr, revision, leiter:benutzer!session_leiter_id_fkey(name), objekt!inner(id, name, endkunde_id), anlagenpruefung!anlagenpruefung_session_id_fkey(count)')
      .eq('status', 'abgeschlossen').is('zusammengefuehrt_in', null)
    alt = 'objektId' in b ? alt.eq('objekt_id', b.objektId) : alt.eq('objekt.endkunde_id', b.kundeId)
    const r2 = await entschluesselt('session', alt.order('abgeschlossen_am', { ascending: false }).limit(ANZAHL))
    if (r2.error) return { data: [], error: r2.error }
    for (const s of r2.data ?? []) {
      const anzahl = s.anlagenpruefung[0]?.count ?? 0
      eintraege.push({
        schluessel: s.id, zu: `/pruefen/${s.id}/protokolle`, am: s.abgeschlossen_am ?? s.begonnen_am,
        titel: s.revision
          ? t('Sammelprotokoll {nummer} · Rev. {revision}', { nummer: s.protokoll_nr ?? '', revision: s.revision })
          : t('Sammelprotokoll {nummer}', { nummer: s.protokoll_nr ?? '' }),
        zeile: ['kundeId' in b ? s.objekt.name : null, anzahl === 1 ? tb('1 Tür') : tb('{anzahl} Türen', { anzahl }), s.leiter ? t('Leitung {name}', { name: s.leiter.name }) : null]
          .filter(Boolean).join(' · '),
        ergebnis: null,
      })
    }
  }
  eintraege.sort((a, b2) => b2.am.localeCompare(a.am))
  return { data: eintraege.slice(0, ANZAHL), error: null }
}

/** Liste der Prüfungen mit Protokoll; ein Klick öffnet die Protokolle der Prüfung bzw. des Termins. */
export function Pruefungsverlauf(props: Bezug & { leer?: string }) {
  const id = 'anlageId' in props ? props.anlageId : 'objektId' in props ? props.objektId : props.kundeId
  const art = 'anlageId' in props ? 'a' : 'objektId' in props ? 'o' : 'k'
  const { daten, fehler, laedt } = useAbfrage(() => laden(props), [art, id])
  if (fehler) return <Fehler text={fehler} />
  if (laedt && !daten) return <p className="text-sm text-slate-500">{t('Lädt …')}</p>
  if (!daten?.length) return <Leer>{props.leer ?? t('Noch keine abgeschlossenen Prüfungen.')}</Leer>
  return (
    <ul className="karte divide-y divide-slate-100" aria-label={t('Prüfungen')}>
      {daten.map((e) => (
        <li key={e.schluessel}>
          <Link to={e.zu} className="zeile group">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-600 ring-1 ring-inset ring-stone-200" aria-hidden>
              <FileText className="size-5" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-medium">{e.titel}</div>
              <div className="text-sm text-slate-500">{datum(e.am)}{e.zeile ? ` · ${e.zeile}` : ''}</div>
            </div>
            {e.ergebnis && <Badge farbe={e.ergebnis}>{AMPEL[e.ergebnis]}</Badge>}
            <Weiter />
          </Link>
        </li>
      ))}
    </ul>
  )
}
