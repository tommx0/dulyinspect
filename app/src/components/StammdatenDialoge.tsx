// Dialoge zum Anlegen von Kunde, Objekt und Anlage aus der Verwaltung. Die Zuordnung (Anlage → Objekt → Kunde) ist immer
// Pflicht und wird aus einem Auswahlfeld gewählt; fehlt der Eintrag, lässt er sich direkt aus dem Auswahlfeld neu anlegen.
import { useMemo, useState } from 'react'
import { artFelder, eigenschaftenTrennen, lageFelder, type AnlageWerte } from './anlageFelder'
import { Formular, type FeldDef } from './Formular'
import { ObjektSymbol, typOptionen } from './Symbole'
import { Dialog } from './ui'
import { aktiveArten, tb } from '../lib/begriffe'
import { etikettTippfehler, normalisiereEtikett } from '../lib/etikett'
import { fehlertext, supabase } from '../lib/supabase'
import { TUERANLAGE_TYP } from '../lib/tueranlage'
import { bestandId, istBestandArt } from '../lib/bestand'
import { artDefinition } from '../lib/anlagenarten'
import { entschluesselt } from '../lib/entschluesselt'
import { nachName } from '../lib/sortierung'
import { t } from '../lib/sprache'
import { useAbfrage } from '../lib/useAbfrage'
import { verschluesseln } from '../lib/verschluesselung'
import { KUNDE_FELDER } from '../seiten/Kunden'
import { OBJEKT_FELDER } from '../seiten/KundeDetail'

type Setze = (wert: string) => void

/** Zustand eines Unterdialogs, der aus einem Auswahlfeld geöffnet wird; `setze` trägt den neuen Eintrag ins Feld ein. */
function useDialogZiel() {
  const [ziel, setZiel] = useState<{ offen: boolean; setze?: Setze }>({ offen: false })
  return [ziel, (setze: Setze | null) => setZiel(setze ? { offen: true, setze } : { offen: false })] as const
}

export function KundeNeuDialog({ offen, onFertig, onSchliessen }: {
  offen: boolean
  onFertig: (kundeId: string) => void | Promise<void>
  onSchliessen: () => void
}) {
  return (
    <Dialog offen={offen} titel={t('Neuer Kunde')} onSchliessen={onSchliessen}>
      <Formular felder={KUNDE_FELDER} start={{}} onAbbrechen={onSchliessen}
        onSpeichern={async (w) => {
          // Die ID gehört zu den Zusatzdaten der Verschlüsselung: schon vor dem Anlegen festlegen
          const id = crypto.randomUUID()
          const { error } = await supabase.from('endkunde').insert(await verschluesseln('endkunde', { ...w, id }) as { id: string; name: string })
          if (error) return fehlertext(error)
          await onFertig(id)
        }} />
    </Dialog>
  )
}

const ADRESSE = ['strasse', 'plz', 'ort'] as const
type Adresse = Record<(typeof ADRESSE)[number], string>

/** Neues Objekt: Kunde ist Pflicht (Auswahl oder direkt neu anlegen). `kundeId` belegt den Kunden vor.
 *  Die Adresse des gewählten Kunden wird ins Objekt übernommen – auch wenn der Kunde erst nach dem Öffnen gewählt wird. */
export function ObjektNeuDialog({ offen, kundeId, onFertig, onSchliessen }: {
  offen: boolean
  kundeId?: string
  onFertig: (objektId: string) => void | Promise<void>
  onSchliessen: () => void
}) {
  const kunden = useAbfrage(async () => {
    const r = await entschluesselt('endkunde', supabase.from('endkunde').select('id, name, strasse, plz, ort').eq('aktiv', true))
    return r.data ? { ...r, data: nachName(r.data) } : r
  })
  const [kundeDialog, setKundeDialog] = useDialogZiel()

  const adresseVon = (id: unknown): Adresse | null => {
    const k = (kunden.daten ?? []).find((k) => k.id === id)
    return k ? { strasse: k.strasse ?? '', plz: k.plz ?? '', ort: k.ort ?? '' } : null
  }
  /** Beim Kundenwechsel die Kundenadresse übernehmen – nur in Felder, die leer sind oder noch die Adresse des vorherigen Kunden
   *  enthalten; eigene Eingaben bleiben stehen. */
  const ableiten = (feld: string, neu: Record<string, unknown>, bisher: Record<string, unknown>) => {
    if (feld !== 'endkunde_id') return
    const adresse = adresseVon(neu.endkunde_id)
    if (!adresse) return
    const vorher = adresseVon(bisher.endkunde_id)
    const uebernahme: Partial<Adresse> = {}
    for (const f of ADRESSE) {
      const wert = String(bisher[f] ?? '').trim()
      if (!wert || wert === vorher?.[f]) uebernahme[f] = adresse[f]
    }
    return uebernahme
  }
  const felder: FeldDef[] = [
    { name: 'endkunde_id', label: t('Kunde'), typ: 'select', pflicht: true, breit: true,
      optionen: (kunden.daten ?? []).map((k) => ({ wert: k.id, text: k.name, symbol: <ObjektSymbol /> })),
      neu: { text: t('+ Neuen Kunden anlegen …'), onWahl: setKundeDialog } },
    ...OBJEKT_FELDER,
  ]
  return (
    <>
      <Dialog offen={offen} titel={t('Neues Objekt')} onSchliessen={onSchliessen}>
        <Formular felder={felder} start={{ endkunde_id: kundeId ?? '', ...adresseVon(kundeId) }} ableiten={ableiten} onAbbrechen={onSchliessen}
          onSpeichern={async (w) => {
            const id = crypto.randomUUID()
            const { error } = await supabase.from('objekt').insert(await verschluesseln('objekt', { ...w, id }) as { id: string; name: string; endkunde_id: string })
            if (error) return fehlertext(error)
            await onFertig(id)
          }} />
      </Dialog>
      <KundeNeuDialog offen={kundeDialog.offen} onSchliessen={() => setKundeDialog(null)}
        onFertig={async (id) => { await kunden.neuLaden(); kundeDialog.setze?.(id); setKundeDialog(null) }} />
    </>
  )
}

/** Neue Anlage: Objekt ist Pflicht (der Kunde ergibt sich daraus), Auswahl oder direkt neu anlegen.
 *  Nach der Wahl zeigt der Dialog Kunde, Adresse und Zugangshinweise des Objekts und schlägt Gebäude und Etagen
 *  aus dessen vorhandenen Anlagen vor. */
export function AnlageNeuDialog({ offen, objektId, onFertig, onSchliessen }: {
  offen: boolean
  objektId?: string
  onFertig: (anlageId: string) => void | Promise<void>
  onSchliessen: () => void
}) {
  const objekte = useAbfrage(async () => {
    const r = await entschluesselt('objekt', supabase.from('objekt').select('id, name, strasse, plz, ort, zugangshinweise, endkunde(id, name)').eq('aktiv', true))
    return r.data ? { ...r, data: nachName(r.data) } : r
  })
  const typen = useAbfrage(() => supabase.from('anlagentyp').select('id, name, anlagenart, aktiv').eq('aktiv', true).order('name'))
  const [objektDialog, setObjektDialog] = useDialogZiel()
  // Gewähltes Objekt (für die Vorschläge aus dem Bestand); bei jedem Öffnen wieder die Vorbelegung
  const [wahl, setWahl] = useState({ offen, id: objektId ?? '' })
  if (wahl.offen !== offen) setWahl({ offen, id: objektId ?? '' })
  const objektWahl = wahl.id
  const setObjektWahl = (id: string) => setWahl((w) => ({ ...w, id }))
  const bestand = useAbfrage(() => supabase.from('anlage').select('gebaeude, etage, hersteller, modell, eigenschaften, anlagentyp(anlagenart)')
    .in('objekt_id', objektWahl ? [objektWahl] : []).neq('anlagentyp_id', TUERANLAGE_TYP).limit(5000), [objektWahl])
  // Auswahl in Gebäude, Etage, Hersteller, Modell und Antrieb: Werte der Anlagen im gewählten Objekt
  const vorhandene = useMemo((): AnlageWerte[] => (bestand.daten ?? []).map((a) => ({ ...a, art: a.anlagentyp?.anlagenart })), [bestand.daten])

  const typListe = (typen.daten ?? []).filter((t) => aktiveArten().includes(t.anlagenart as never))
  const kundeVon = (o: { endkunde: unknown }) => (o.endkunde as { name: string } | null)?.name ?? '–'
  const objektListe = [...(objekte.daten ?? [])].map((o) => ({
    id: o.id, text: `${kundeVon(o)} › ${o.name}${o.ort ? `, ${o.ort}` : ''}`,
  })).sort((a, b) => a.text.localeCompare(b.text, 'de'))

  /** Adresse und Zugangshinweise des gewählten Objekts unter dem Auswahlfeld. */
  const objektInfo = (id: unknown) => {
    const o = (objekte.daten ?? []).find((o) => o.id === id)
    if (!o) return undefined
    const adresse = [o.strasse, [o.plz, o.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')
    const anzahl = bestand.daten?.length ?? 0
    return (
      <span data-objekt-info className="block text-slate-600">
        <strong>{kundeVon(o)}</strong> · {adresse || t('keine Adresse hinterlegt')}
        {o.zugangshinweise && <> · {t('Zugang: {hinweise}', { hinweise: o.zugangshinweise })}</>}
        {objektWahl === o.id && anzahl > 0 && <> · {anzahl === 1 ? tb('1 Tür im Bestand') : tb('{anzahl} Türen im Bestand', { anzahl })}</>}
      </span>
    )
  }

  const felder = (w: Record<string, unknown>): FeldDef[] => {
    const art = typListe.find((t) => t.id === w.anlagentyp_id)?.anlagenart
    const kopf: FeldDef[] = [
      { name: 'objekt_id', label: t('Objekt (Kunde › Objekt)'), typ: 'select', pflicht: true, breit: true,
        optionen: objektListe.map((o) => ({ wert: o.id, text: o.text, symbol: <ObjektSymbol /> })),
        neu: { text: t('+ Neues Objekt anlegen …'), onWahl: setObjektDialog },
        hinweis: objektInfo(w.objekt_id) },
      { name: 'anlagentyp_id', label: tb('Türtyp'), typ: 'select', pflicht: true, breit: true, optionen: typOptionen(typListe),
        hinweis: istBestandArt(art)
          ? t('Je Objekt gibt es eine Anlage „{name}“ ohne Stammdaten; erfasst werden die {elemente}.', { name: artDefinition(art).name, elemente: artDefinition(art).elemente?.mehrzahl ?? t('Elemente') })
          : undefined },
    ]
    // Bestand (Rauchwarnmelder, Geräte): keine Stammdaten
    if (istBestandArt(art)) return kopf
    return [
      ...kopf,
      { name: 'etikett_id', label: t('Etikett-ID'), hinweis: t('z. B. PK-000 0427 – leer lassen, wenn noch kein Etikett klebt') },
      { name: 'kunden_bezeichnung', label: t('Bezeichnung beim Kunden'), hinweis: t('z. B. „T 2.14“ aus dem Brandschutzplan') },
      ...lageFelder(vorhandene),
      { name: 'raum', label: t('Raum') },
      { name: 'lage_beschreibung', label: t('Lagebeschreibung'), breit: true },
      ...artFelder(art, false, vorhandene, w),
      { name: 'baujahr', label: t('Baujahr'), typ: 'number' },
    ]
  }

  const speichern = async (w: Record<string, unknown>) => {
    const bestandArt = typListe.find((t) => t.id === w.anlagentyp_id)?.anlagenart
    if (istBestandArt(bestandArt)) {
      // Gibt es den Bestand des Objekts schon, gilt er
      const id = bestandId(String(w.objekt_id), bestandArt!)
      const { data: vorhanden } = await supabase.from('anlage').select('id').eq('id', id).maybeSingle()
      if (!vorhanden) {
        const { error } = await supabase.from('anlage').insert({ id, objekt_id: String(w.objekt_id), anlagentyp_id: String(w.anlagentyp_id) })
        if (error) return fehlertext(error)
      }
      return void await onFertig(id)
    }
    if (w.etikett_id) {
      w.etikett_id = normalisiereEtikett(String(w.etikett_id))
      const tippfehler = etikettTippfehler(w.etikett_id as string)
      if (tippfehler) return tippfehler
      const { data: e } = await supabase.from('etikett').select('id, anlage_id').eq('id', w.etikett_id as string).maybeSingle()
      if (!e) return t('Etikett {id} existiert nicht.', { id: w.etikett_id as string })
      if (e.anlage_id) return tb('Etikett {id} ist bereits einer anderen Tür zugeordnet.', { id: w.etikett_id as string })
    }
    const art = typListe.find((t) => t.id === w.anlagentyp_id)?.anlagenart
    const { eigenschaften, rest } = eigenschaftenTrennen(art, w)
    const id = crypto.randomUUID()
    const { error } = await supabase.from('anlage')
      .insert(await verschluesseln('anlage', { ...(rest as unknown as { anlagentyp_id: string; objekt_id: string }), id, eigenschaften }))
    if (error) return fehlertext(error)
    await onFertig(id)
  }

  return (
    <>
      <Dialog offen={offen} titel={tb('Neue Tür')} onSchliessen={onSchliessen} breit>
        <Formular felder={felder} start={{ objekt_id: objektId ?? '' }} onAbbrechen={onSchliessen} onSpeichern={speichern}
          onAenderung={(w) => setObjektWahl(String(w.objekt_id ?? ''))} />
      </Dialog>
      <ObjektNeuDialog offen={objektDialog.offen} onSchliessen={() => setObjektDialog(null)}
        onFertig={async (id) => { await objekte.neuLaden(); objektDialog.setze?.(id); setObjektDialog(null) }} />
    </>
  )
}
