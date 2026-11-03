import { useEffect, useState } from 'react'
import { bestaetigen } from '../components/Bestaetigung'
import { Fehler, Laden } from '../components/ui'
import {
  appName, ausCache, erscheinungsbildNeuLaden, istFarbe, kontrastHinweise, logoUrl, STANDARD, type Erscheinungsbild,
} from '../lib/erscheinungsbild'
import { fehlertext, supabase } from '../lib/supabase'
import { t } from '../lib/sprache'

// Kein SVG: Es kann Skripte enthalten und liegt im öffentlichen Bucket
const ERLAUBT = ['image/png', 'image/jpeg', 'image/webp']

/** Bild im Browser in ein PNG umwandeln – für die PDF-Protokolle. */
async function alsPng(datei: Blob, breite = 1200): Promise<Blob> {
  const url = URL.createObjectURL(datei)
  try {
    const bild = new Image()
    bild.src = url
    await bild.decode()
    const w = bild.naturalWidth || breite
    const h = bild.naturalHeight || Math.round(breite / 4)
    const faktor = breite / w
    const c = document.createElement('canvas')
    c.width = breite
    c.height = Math.max(1, Math.round(h * faktor))
    c.getContext('2d')!.drawImage(bild, 0, 0, c.width, c.height)
    return await new Promise<Blob>((ok, fehler) => c.toBlob((b) => (b ? ok(b) : fehler(new Error(t('Logo konnte nicht umgewandelt werden')))), 'image/png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** System → Einstellungen: App-Name, Farben und Logo der Instanz. */
export function ErscheinungsbildBereich() {
  const [gespeichert, setGespeichert] = useState<Erscheinungsbild>(ausCache)
  const [name, setName] = useState('')
  const [marke, setMarke] = useState(STANDARD.marke)
  const [akzent, setAkzent] = useState(STANDARD.akzent)
  const [logo, setLogo] = useState<{ datei: File; vorschau: string } | null>(null)
  const [fehler, setFehler] = useState('')
  const [meldung, setMeldung] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  const [geladen, setGeladen] = useState(false)

  const uebernehmen = (e: Erscheinungsbild) => {
    setGespeichert(e)
    setName(e.app_name ?? '')
    setMarke(istFarbe(e.farbe_marke) ? e.farbe_marke : STANDARD.marke)
    setAkzent(istFarbe(e.farbe_akzent) ? e.farbe_akzent : STANDARD.akzent)
  }
  useEffect(() => {
    // Erst nach dem Laden anzeigen, sonst überschreibt die Antwort schon Eingetipptes
    void supabase.from('erscheinungsbild').select('*').single().then(({ data }) => { if (data) uebernehmen(data); setGeladen(true) })
  }, [])
  useEffect(() => () => { if (logo) URL.revokeObjectURL(logo.vorschau) }, [logo])

  const hinweise = istFarbe(marke) && istFarbe(akzent) ? kontrastHinweise(marke, akzent) : [t('Bitte Farben als #rrggbb angeben.')]

  const logoWaehlen = (datei: File | undefined) => {
    setFehler('')
    if (!datei) return
    if (!ERLAUBT.includes(datei.type)) return setFehler(t('Bitte ein Logo als PNG, JPEG oder WebP wählen.'))
    if (datei.size > 2 * 1024 * 1024) return setFehler(t('Das Logo darf höchstens 2 MB groß sein.'))
    setLogo({ datei, vorschau: URL.createObjectURL(datei) })
  }

  const speichern = async (zuruecksetzen = false) => {
    setFehler(''); setMeldung('')
    if (!zuruecksetzen && !(istFarbe(marke) && istFarbe(akzent))) return setFehler(t('Bitte Farben als #rrggbb angeben.'))
    setLaeuft(true)
    try {
      const aenderung: Partial<Erscheinungsbild> = zuruecksetzen
        ? { app_name: null, farbe_marke: null, farbe_akzent: null, logo_pfad: null, logo_pdf_pfad: null }
        : { app_name: name.trim() || null, farbe_marke: marke.toLowerCase(), farbe_akzent: akzent.toLowerCase() }
      if (logo && !zuruecksetzen) {
        const stempel = Date.now()
        const endung = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[logo.datei.type]
        const pfad = `logo-${stempel}.${endung}`
        const pdfPfad = `logo-pdf-${stempel}.png`
        const png = await alsPng(logo.datei)
        for (const [p, inhalt, typ] of [[pfad, logo.datei, logo.datei.type], [pdfPfad, png, 'image/png']] as const) {
          const { error } = await supabase.storage.from('branding').upload(p, inhalt, { contentType: typ })
          if (error) throw error
        }
        Object.assign(aenderung, { logo_pfad: pfad, logo_pdf_pfad: pdfPfad })
      }
      const { error } = await supabase.from('erscheinungsbild').update(aenderung).eq('id', 1)
      if (error) throw error
      // Alte Logo-Dateien aufräumen (Fehler hier sind unkritisch)
      const alt = [gespeichert.logo_pfad, gespeichert.logo_pdf_pfad].filter((p): p is string => !!p && (zuruecksetzen || !!logo))
      if (alt.length) await supabase.storage.from('branding').remove(alt)
      setLogo(null)
      await erscheinungsbildNeuLaden()
      const { data } = await supabase.from('erscheinungsbild').select('*').single()
      if (data) uebernehmen(data)
      setMeldung(zuruecksetzen ? t('Standard-Erscheinungsbild wiederhergestellt.') : t('Gespeichert. Gilt sofort für alle – auch für die Anmeldeseite und neue Protokolle.'))
    } catch (e) {
      setFehler(fehlertext(e))
    } finally {
      setLaeuft(false)
    }
  }

  const vorschauLogo = logo?.vorschau ?? logoUrl(gespeichert)

  if (!geladen) return <Laden />
  return (
    <section className="karte space-y-4 p-4" data-erscheinungsbild>
      <div>
        <h2 className="font-semibold">{t('Erscheinungsbild')}</h2>
        <p className="text-sm text-slate-600">{t('Logo, Farben und Name der App für alle Benutzer, die Anmeldeseite und die PDF-Protokolle. Leer = Standard.')}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="eb-name">{t('App-Name (Fenstertitel)')}</label>
          <input id="eb-name" maxLength={40} value={name} placeholder={__APP_NAME__} onChange={(e) => setName(e.target.value)} />
        </div>
        {([['eb-marke', t('Hauptfarbe (Knöpfe, Text)'), marke, setMarke], ['eb-akzent', t('Akzentfarbe (Linien, aktiver Menüpunkt)'), akzent, setAkzent]] as const).map(([id, text, wert, setze]) => (
          <div key={id}>
            <label htmlFor={id}>{text}</label>
            <div className="mt-1 flex items-center gap-2">
              <input type="color" aria-label={t('{text} wählen', { text })} className="mt-0 h-10 w-14 cursor-pointer p-1" value={istFarbe(wert) ? wert : '#000000'} onChange={(e) => setze(e.target.value)} />
              <input id={id} className="mt-0 font-mono" value={wert} maxLength={7} onChange={(e) => setze(e.target.value.trim())} />
            </div>
          </div>
        ))}
        <div className="sm:col-span-2">
          <label htmlFor="eb-logo">{t('Logo (PNG, JPEG oder WebP, max. 2 MB; am besten quer, transparenter Hintergrund)')}</label>
          <input id="eb-logo" type="file" accept={ERLAUBT.join(',')} onChange={(e) => logoWaehlen(e.target.files?.[0])} />
        </div>
      </div>

      {hinweise.length > 0 && (
        <ul className="list-disc space-y-1 rounded-md border border-amber-200 bg-amber-50 py-2 pr-3 pl-8 text-sm text-amber-900" data-kontrast-hinweis>
          {hinweise.map((h) => <li key={h}>{h}</li>)}
        </ul>
      )}

      {/* Vorschau mit den gewählten Farben */}
      <div className="overflow-hidden rounded-lg border border-slate-200" aria-label={t('Vorschau')}>
        <div className="flex items-center justify-between gap-3 bg-white px-4 py-3" style={{ borderBottom: `4px solid ${istFarbe(akzent) ? akzent : STANDARD.akzent}` }}>
          <img src={vorschauLogo} alt={t('Logo-Vorschau')} className="h-10 w-auto max-w-48 object-contain" />
          <span className="text-xs text-slate-500">{name.trim() || appName(gespeichert)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 bg-stone-50 px-4 py-3 text-sm">
          <span className="rounded-md px-3 py-1.5 font-medium" style={{ background: istFarbe(akzent) ? akzent : STANDARD.akzent, color: istFarbe(marke) ? marke : STANDARD.marke }}>{t('Aktiver Menüpunkt')}</span>
          <span className="rounded-md px-3 py-1.5 font-semibold text-white" style={{ background: istFarbe(marke) ? marke : STANDARD.marke }}>{t('Knopf')}</span>
          <span className="font-medium underline decoration-2 underline-offset-4" style={{ color: istFarbe(marke) ? marke : STANDARD.marke, textDecorationColor: istFarbe(akzent) ? akzent : STANDARD.akzent }}>{t('Link')}</span>
        </div>
      </div>

      <Fehler text={fehler} />
      {meldung && <div role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">{meldung}</div>}
      <div className="flex flex-wrap justify-between gap-2">
        <button className="btn-sekundaer" disabled={laeuft} onClick={async () => {
          if (await bestaetigen(t('Logo, Farben und Namen auf den Standard zurücksetzen?'), { ok: t('Zurücksetzen') })) void speichern(true)
        }}>{t('Auf Standard zurücksetzen')}</button>
        <button className="btn-primaer" disabled={laeuft} onClick={() => void speichern()}>{laeuft ? t('Speichern …') : t('Erscheinungsbild speichern')}</button>
      </div>
    </section>
  )
}
