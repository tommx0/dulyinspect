import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser'
import { useEffect, useRef, useState } from 'react'
import { DIREKTE_ADRESSE, etikettAusScan, imFremdenRahmen, normalisiereEtikett } from '../lib/etikett'
import { fremderMandantImScan, fremdesEtikettText } from '../lib/mandantencode'
import { melderCodeLesen } from '../lib/melderCode'
import { t } from '../lib/sprache'

/**
 * Kamera-Scanner für Tür-Etiketten (QR). Ruft onErkannt mit der Etikett-ID auf.
 * Fremde Codes werden ignoriert und kurz gemeldet, ebenso Etiketten mit dem Mandantencode einer anderen Instanz (auch mit `roh`). Wird per lazy() geladen, damit die Startseite schlank bleibt.
 * Mit `eingabe` lässt sich die ID auch eintippen (Kamera gesperrt, Etikett beschädigt).
 * Mit `roh` wird der gelesene Text unverändert geliefert (Herstellercodes, z. B. Aufkleber eines Rauchwarnmelders).
 * Mit `fortlaufend` bleibt die Kamera offen und meldet jeden neuen Code (Dauerscan); derselbe Code bleibt stumm,
 * solange er im Bild ist und noch 2,5 Sekunden danach. `anleitung` ersetzt den Hinweis unter dem Kamerabild
 * (z. B. Schlüsselblatt der Verschlüsselung).
 */
export default function QrScanner({ onErkannt, eingabe = false, roh = false, fortlaufend = false, anleitung }: {
  onErkannt: (inhalt: string) => void; eingabe?: boolean; roh?: boolean; fortlaufend?: boolean; anleitung?: string
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [fehler, setFehler] = useState('')
  const [hinweis, setHinweis] = useState('')
  const [text, setText] = useState('')
  const erledigt = useRef(false)
  // Neueste Funktion merken, damit die Kamera bei neuer Funktion nicht neu startet
  const rueckruf = useRef(onErkannt)
  useEffect(() => { rueckruf.current = onErkannt })
  const letzter = useRef<{ text: string; zeit: number } | null>(null)

  useEffect(() => {
    let controls: IScannerControls | undefined
    let abgebrochen = false
    const leser = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 150 })

    leser
      .decodeFromConstraints({ video: { facingMode: 'environment' } }, video.current!, (ergebnis) => {
        if (!ergebnis || erledigt.current) return
        const fremd = fremderMandantImScan(ergebnis.getText())
        if (fremd) {
          setHinweis(fremdesEtikettText(fremd))
          return
        }
        const etikett = roh ? ergebnis.getText().trim() : etikettAusScan(ergebnis.getText())
        if (!etikett) {
          setHinweis(melderCodeLesen(ergebnis.getText())
            ? t('Das ist ein Melder-Etikett. Melder bitte in der Prüfung der Wohnung mit „Melder scannen“ scannen.')
            : t('Dieser Code ist kein Etikett dieser App.'))
          return
        }
        if (fortlaufend) {
          const jetzt = Date.now()
          const gleich = letzter.current?.text === etikett && jetzt - letzter.current.zeit < 2500
          letzter.current = { text: etikett, zeit: jetzt }
          if (gleich) return
          setHinweis('')
          navigator.vibrate?.(80)
          rueckruf.current(etikett)
          return
        }
        erledigt.current = true
        navigator.vibrate?.(80)
        controls?.stop()
        rueckruf.current(etikett)
      })
      .then((c) => {
        controls = c
        if (abgebrochen) c.stop()
      })
      .catch((e: Error) => {
        if (imFremdenRahmen()) setFehler(t('Im Share-Link ist die Kamera gesperrt. Bitte die App direkt öffnen: {adresse}', { adresse: DIREKTE_ADRESSE }))
        else if (e.name === 'NotAllowedError') setFehler(t('Kamerazugriff wurde verweigert. Bitte in den Browser-Einstellungen erlauben.'))
        else if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') setFehler(t('Keine Kamera gefunden.'))
        else if (!window.isSecureContext) setFehler(t('Die Kamera funktioniert nur über eine sichere Verbindung (https).'))
        else setFehler(t('Kamera konnte nicht gestartet werden: {fehler}', { fehler: e.message }))
      })

    return () => {
      abgebrochen = true
      controls?.stop()
    }
  }, [roh, fortlaufend])

  return (
    <div className="space-y-3">
      {fehler ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{fehler}</p>
      ) : (
        <div className="relative overflow-hidden rounded-lg bg-black">
          <video ref={video} className="aspect-square w-full object-cover" muted playsInline aria-label={t('Kamerabild')} />
          {/* Zielrahmen */}
          <div className="pointer-events-none absolute inset-[18%] rounded-xl border-4 border-akzent shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        </div>
      )}
      <p className="text-center text-sm text-slate-600" aria-live="polite">
        {hinweis || anleitung || (roh ? t('QR-Code des Melders in den gelben Rahmen halten.') : t('QR-Code des Etiketts in den gelben Rahmen halten.'))}
      </p>
      {eingabe && (
        <form className="flex gap-2" onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim() || erledigt.current) return
          const fremd = fremderMandantImScan(text)
          if (fremd) {
            setHinweis(fremdesEtikettText(fremd))
            return
          }
          if (!fortlaufend) erledigt.current = true
          rueckruf.current(roh ? text.trim() : etikettAusScan(text) ?? normalisiereEtikett(text))
          if (fortlaufend) setText('')
        }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={roh ? t('oder Code eintippen') : t('oder ID eintippen')}
            aria-label={roh ? t('Code eingeben') : t('Etikett-ID eingeben')} className="mt-0" autoCapitalize="characters" />
          <button className="btn-sekundaer" disabled={!text.trim()}>{t('Übernehmen')}</button>
        </form>
      )}
    </div>
  )
}
