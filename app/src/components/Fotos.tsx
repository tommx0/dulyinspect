import { useLiveQuery } from 'dexie-react-hooks'
import { Camera, FolderOpen } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { t, tMeldung } from '../lib/sprache'
import { dateiEntschluesseln, holenUrl } from '../lib/verschluesselung'
import { fotoHinzufuegen, fotoLoeschen } from '../offline/aktionen'
import { db, type FotoZeile } from '../offline/db'
import { bestaetigen } from './Bestaetigung'
import { Dialog } from './ui'

/**
 * Vorschaubild: lokal gespeichertes Foto (Blob) oder – falls nicht lokal – vom Server. Die Fotos liegen verschlüsselt auf dem
 * Gerät und im Speicher des Servers und werden hier entschlüsselt; was sich nicht entschlüsseln lässt, wird nicht angezeigt.
 */
function Vorschau({ foto, onOeffnen }: { foto: FotoZeile; onOeffnen: (url: string) => void }) {
  const [url, setUrl] = useState<string>()
  const [nichtLesbar, setNichtLesbar] = useState(false)
  useEffect(() => {
    let objektUrl: string | undefined
    let aktiv = true
    setNichtLesbar(false)
    void (async () => {
      try {
        const d = await db.dateien.get(foto.id)
        if (d) {
          objektUrl = URL.createObjectURL(await dateiEntschluesseln('fotos', d.pfad, d.blob))
          if (aktiv) setUrl(objektUrl)
          else URL.revokeObjectURL(objektUrl)
        } else if (navigator.onLine) {
          const u = await holenUrl('fotos', foto.storage_pfad)
          if (aktiv) setUrl(u)
        }
      } catch {
        if (aktiv) setNichtLesbar(true)
      }
    })()
    return () => { aktiv = false; if (objektUrl) URL.revokeObjectURL(objektUrl) }
  }, [foto.id, foto.storage_pfad])
  return (
    <button type="button" onClick={() => url && onOeffnen(url)} disabled={nichtLesbar} className="h-16 w-16 overflow-hidden rounded-md border border-slate-200 bg-slate-100">
      {url ? <img src={url} alt={t('Foto')} className="h-full w-full object-cover" />
        : nichtLesbar ? <span className="px-1 text-[10px] leading-tight text-red-700" title={t('Das Foto lässt sich nicht entschlüsseln')}>{t('Bild nicht lesbar')}</span>
        : <span className="text-xs text-slate-400">📷</span>}
    </button>
  )
}

/** Am Handy und Tablet öffnet „Kamera“ die Kamera des Geräts; am PC (ohne Touch) nimmt die App selbst ein Bild der Webcam auf. */
const mitKameraApp = () => window.matchMedia('(pointer: coarse)').matches || !navigator.mediaDevices?.getUserMedia

/** Kamerabild in der App (PC, Laptop): jedes Auslösen fügt ein Foto hinzu, bis „Fertig“. */
function KameraAufnahme({ onFoto, onFertig }: { onFoto: (bild: Blob) => Promise<void>; onFertig: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [bereit, setBereit] = useState(false)
  const [fehler, setFehler] = useState('')
  const [anzahl, setAnzahl] = useState(0)
  const [laeuft, setLaeuft] = useState(false)
  useEffect(() => {
    let strom: MediaStream | undefined
    let aktiv = true
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } })
      .then((s) => {
        if (!aktiv) return s.getTracks().forEach((t) => t.stop())
        strom = s
        video.current!.srcObject = s
        void video.current!.play().then(() => setBereit(true)).catch(() => undefined)
      })
      .catch((e: Error) => {
        if (e.name === 'NotAllowedError') setFehler(t('Kamerazugriff wurde verweigert. Bitte in den Browser-Einstellungen erlauben oder „Datei“ verwenden.'))
        else if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') setFehler(t('Keine Kamera gefunden. Bitte „Datei“ verwenden.'))
        else setFehler(t('Kamera konnte nicht gestartet werden: {fehler}', { fehler: e.message }))
      })
    return () => { aktiv = false; strom?.getTracks().forEach((t) => t.stop()) }
  }, [])
  const ausloesen = async () => {
    const v = video.current!
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    c.getContext('2d')!.drawImage(v, 0, 0)
    const bild = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.92))
    if (!bild) return setFehler(t('Das Bild ließ sich nicht aufnehmen.'))
    setLaeuft(true)
    try { await onFoto(bild); setAnzahl((n) => n + 1) } catch (e) { setFehler(e instanceof Error ? tMeldung(e.message) : String(e)) } finally { setLaeuft(false) }
  }
  return (
    <div className="space-y-3">
      {fehler ? <p className="text-sm text-red-700">{fehler}</p>
        : <video ref={video} playsInline muted className="max-h-[60dvh] w-full rounded-md bg-slate-900 object-contain" aria-label={t('Kamerabild')} />}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {anzahl > 0 && <span className="mr-auto text-sm text-slate-600">{anzahl === 1 ? t('1 Foto hinzugefügt') : t('{anzahl} Fotos hinzugefügt', { anzahl })}</span>}
        <button type="button" className="btn-sekundaer" onClick={onFertig}>{anzahl ? t('Fertig') : t('Abbrechen')}</button>
        {!fehler && <button type="button" className="btn-primaer" disabled={!bereit || laeuft} onClick={() => void ausloesen()}>
          <Camera className="size-4" aria-hidden />{t('Auslösen')}</button>}
      </div>
    </div>
  )
}

/** Fotos zu einem Bezug (Mangel, Antwort, Tür): Liste, Aufnehmen mit der Kamera oder aus einer Datei. */
export function Fotos({ sessionId, bezugTyp, bezugId, nurLesen, hinweis }: {
  sessionId: string
  bezugTyp: 'anlage' | 'antwort' | 'mangel'
  bezugId: string
  nurLesen?: boolean
  hinweis?: string
}) {
  const fotos = useLiveQuery(() => db.fotos.where('bezug_id').equals(bezugId).sortBy('aufgenommen_am'), [bezugId], [])
  const eingabe = useRef<HTMLInputElement>(null)
  const kamera = useRef<HTMLInputElement>(null)
  const [kameraOffen, setKameraOffen] = useState(false)
  const [gross, setGross] = useState<{ url: string; id: string } | null>(null)
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState('')

  const aufnehmen = async (dateien: FileList | null) => {
    if (!dateien?.length) return
    setLaeuft(true)
    setFehler('')
    try {
      for (const d of Array.from(dateien)) await fotoHinzufuegen(sessionId, bezugTyp, bezugId, d)
    } catch (e) {
      setFehler(e instanceof Error ? tMeldung(e.message) : String(e))
    } finally {
      setLaeuft(false)
      if (eingabe.current) eingabe.current.value = ''
      if (kamera.current) kamera.current.value = ''
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        {fotos.map((f) => <Vorschau key={f.id} foto={f} onOeffnen={(url) => setGross({ url, id: f.id })} />)}
        {!nurLesen && (
          <>
            <button type="button" className="btn-sekundaer h-16 flex-col gap-0.5 px-3 text-xs" disabled={laeuft} title={t('Foto mit der Kamera aufnehmen')}
              onClick={() => (mitKameraApp() ? kamera.current?.click() : setKameraOffen(true))}>
              <Camera className="size-5" aria-hidden />{laeuft ? '…' : t('Kamera')}
            </button>
            <button type="button" className="btn-sekundaer h-16 flex-col gap-0.5 px-3 text-xs" disabled={laeuft} title={t('Vorhandene Fotos auswählen')}
              onClick={() => eingabe.current?.click()}>
              <FolderOpen className="size-5" aria-hidden />{t('Datei')}
            </button>
            {/* capture öffnet direkt die Kamera; zusammen mit multiple ignorieren manche Browser (Android) es, daher getrennt */}
            <input ref={kamera} type="file" accept="image/*" capture="environment" className="hidden"
              aria-label={t('Foto aufnehmen')} onChange={(e) => void aufnehmen(e.target.files)} />
            <input ref={eingabe} type="file" accept="image/*" multiple className="hidden"
              aria-label={t('Foto aus Datei')} onChange={(e) => void aufnehmen(e.target.files)} />
          </>
        )}
      </div>
      {hinweis && fotos.length === 0 && <p className="text-xs text-red-700">{hinweis}</p>}
      {fehler && <p className="text-xs text-red-700">{fehler}</p>}
      <Dialog offen={kameraOffen} titel={t('Foto aufnehmen')} onSchliessen={() => setKameraOffen(false)}>
        {kameraOffen && <KameraAufnahme onFoto={(bild) => fotoHinzufuegen(sessionId, bezugTyp, bezugId, bild)} onFertig={() => setKameraOffen(false)} />}
      </Dialog>
      <Dialog offen={gross !== null} titel={t('Foto')} onSchliessen={() => setGross(null)} breit>
        {gross && (
          <div className="space-y-3">
            <img src={gross.url} alt={t('Foto groß')} className="max-h-[70dvh] w-full rounded-md object-contain" />
            {!nurLesen && (
              <button className="btn-gefahr" onClick={async () => { if (await bestaetigen(t('Foto löschen?'), { ok: t('Löschen'), gefahr: true })) { void fotoLoeschen(gross.id); setGross(null) } }}>{t('Foto löschen')}</button>
            )}
          </div>
        )}
      </Dialog>
    </div>
  )
}
