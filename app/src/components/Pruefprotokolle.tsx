// Protokoll der aktuellen Revision auf der Prüfseite nach dem Abschluss.
import { FileText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { demoSperreAktiv } from '../lib/demo'
import { t } from '../lib/sprache'
import { fehlertext } from '../lib/supabase'
import { demoProtokollUrl } from '../protokoll/erzeugen'
import { usePruefprotokolle } from '../protokoll/usePruefprotokolle'

type Props = { pruefungId: string; revision: number; abgeschlossen: boolean; darf: boolean }

/** Knopf bzw. Hinweis zum Protokoll der aktuellen Revision – für die Prüfseite nach dem Abschluss. */
export function ProtokollKnopf(props: Props) {
  // Demomodus: die Prüfung ist nur simuliert, das Protokoll entsteht auf dem Gerät und wird nicht gespeichert
  return demoSperreAktiv() ? <DemoProtokollKnopf {...props} /> : <GespeichertesProtokoll {...props} />
}

function GespeichertesProtokoll({ pruefungId, revision, abgeschlossen, darf }: Props) {
  const stand = abgeschlossen ? { revision, abgeschlossen } : null
  const { protokolle, urls, fortschritt, fehler, fehlt, online, erzeugen } = usePruefprotokolle(pruefungId, stand, darf)
  const aktuell = protokolle.find((p) => p.revision === revision)
  if (!abgeschlossen) return <p className="text-xs text-green-900">{t('Das Protokoll entsteht, sobald der Abschluss übertragen ist.')}</p>
  if (!online && !aktuell) return <p className="text-xs text-green-900">{t('Das Protokoll entsteht, sobald eine Verbindung besteht.')}</p>
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {aktuell && urls[aktuell.id] && (
        <a className="btn-sekundaer inline-flex items-center gap-1.5" href={urls[aktuell.id]} target="_blank" rel="noreferrer">
          <FileText className="size-4" aria-hidden /> {t('Protokoll öffnen')}
        </a>
      )}
      {aktuell && urls[aktuell.id] === '' && <span role="alert" className="text-red-800">{t('Das Protokoll ist nicht lesbar (falscher Schlüssel oder beschädigte Datei).')}</span>}
      {fehlt && !darf && <span className="text-green-900">{t('Das Protokoll erstellt ein Beteiligter oder ein Admin.')}</span>}
      {fortschritt && <span role="status" className="text-green-900">{t('Protokoll wird erstellt: {stand}', { stand: fortschritt })}</span>}
      {fehlt && !fortschritt && fehler && (
        <span role="alert" className="text-red-800">{t('Protokoll nicht erstellt: {fehler}', { fehler })} <button className="link" onClick={() => void erzeugen()}>{t('Erneut versuchen')}</button></span>
      )}
      {protokolle.length > 1 && <Link className="link" to={`/protokoll/${pruefungId}`}>{t('Alle Revisionen')}</Link>}
    </div>
  )
}

/** Demomodus: Protokoll der simulierten Prüfung auf dem Gerät erzeugen (mit Wasserzeichen) und als Datei öffnen. */
function DemoProtokollKnopf({ pruefungId, abgeschlossen }: Props) {
  const [url, setUrl] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState('')
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  if (!abgeschlossen) return null
  const erstellen = async () => {
    setLaeuft(true)
    setFehler('')
    try { setUrl(await demoProtokollUrl(pruefungId)) } catch (e) { setFehler(fehlertext(e)) } finally { setLaeuft(false) }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {url ? (
        <a className="btn-sekundaer inline-flex items-center gap-1.5" href={url} target="_blank" rel="noreferrer">
          <FileText className="size-4" aria-hidden /> {t('Protokoll öffnen (Demo)')}
        </a>
      ) : (
        <button className="btn-sekundaer inline-flex items-center gap-1.5" disabled={laeuft} onClick={() => void erstellen()}>
          <FileText className="size-4" aria-hidden /> {laeuft ? t('Protokoll wird erstellt …') : t('Protokoll erstellen (Demo)')}
        </button>
      )}
      <span className="text-xs text-amber-800">{t('Demomodus: Das Protokoll ist nur simuliert und wird nicht gespeichert.')}</span>
      {fehler && <span role="alert" className="text-red-800">{t('Protokoll nicht erstellt: {fehler}', { fehler })}</span>}
    </div>
  )
}
