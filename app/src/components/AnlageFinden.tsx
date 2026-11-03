import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { anlagenSuchen, type AnlageTreffer } from '../lib/anlageSuche'
import { etikettAusScan } from '../lib/etikett'
import { mandantencodeAusScan } from '../lib/mandantencode'
import { fehlertext } from '../lib/supabase'
import { Lesbar } from './Lesbar'
import { Badge, datum, Dialog, Fehler } from './ui'
import { tb } from '../lib/begriffe'
import { t } from '../lib/sprache'

const QrScanner = lazy(() => import('./QrScanner'))

type Treffer = AnlageTreffer

/** Tür finden: QR-Code scannen oder Freitextsuche (Etikett, Bezeichnung, Lage, Objekt, Kunde, Ort, Typ …). */
export function AnlageFinden() {
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [treffer, setTreffer] = useState<Treffer[] | null>(null)
  const [fehler, setFehler] = useState('')
  const [laedt, setLaedt] = useState(false)
  const [scannen, setScannen] = useState(false)
  const anfrageNr = useRef(0)
  const [heute] = useState(() => new Date().toISOString().slice(0, 10))

  // Live-Suche mit kurzer Verzögerung; veraltete Antworten werden verworfen
  useEffect(() => {
    const q = text.trim()
    const nr = ++anfrageNr.current
    if (q.length < 2) {
      setTreffer(null)
      return
    }
    const timer = setTimeout(async () => {
      setLaedt(true)
      // Kunden und Objekte sind verschlüsselt: der Browser ermittelt die passenden Objekte, der Server sucht in den Anlagen
      const { data, error } = await anlagenSuchen(q, 50)
      if (nr !== anfrageNr.current) return
      setLaedt(false)
      setFehler(fehlertext(error))
      setTreffer(data)
    }, 250)
    return () => clearTimeout(timer)
  }, [text])

  const absenden = (e: FormEvent) => {
    e.preventDefault()
    const q = text.trim()
    if (!q) return
    // Eindeutiger Treffer oder Etikett-ID → direkt zur Tür
    if (treffer?.length === 1) return zuAnlage(treffer[0])
    const etikett = etikettAusScan(q)
    // Eingefügte Adresse aus einem QR-Code: Mandantencode mitgeben, die Zielseite lehnt fremde Etiketten ab
    const k = mandantencodeAusScan(q)
    if (etikett) navigate(`/anlage/${encodeURIComponent(etikett)}${k ? `?k=${encodeURIComponent(k)}` : ''}`)
  }

  const zuAnlage = (a: Treffer) => navigate(`/objekte/${a.objekt_id}?anlage=${a.id}`)

  const erkannt = useCallback((etikett: string) => {
    setScannen(false)
    navigate(`/anlage/${encodeURIComponent(etikett)}`)
  }, [navigate])

  return (
    <section className="karte space-y-3 p-4">
      <form onSubmit={absenden} className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <label htmlFor="anlage-suche">{tb('Tür finden')}</label>
          <input id="anlage-suche" type="search" autoComplete="off" enterKeyHint="search" value={text}
            placeholder={t('Etikett, Bezeichnung, Lage, Kunde, Ort …')} onChange={(e) => setText(e.target.value)} />
        </div>
        <button type="button" className="btn-primaer w-full py-3 sm:w-auto sm:py-2" onClick={() => setScannen(true)}>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10" strokeLinecap="round" />
          </svg>
          {t('QR scannen')}
        </button>
      </form>

      <Fehler text={fehler} />
      {laedt && !treffer && <p className="text-sm text-slate-500">{t('Suchen …')}</p>}
      {treffer && (
        treffer.length === 0 ? (
          <p className="text-sm text-slate-500">{tb('Keine Tür gefunden.')}</p>
        ) : (
          <>
            <p className="text-xs text-slate-500">{treffer.length === 50 ? t('Die ersten 50 Treffer – bitte genauer suchen.') : t('{n} Treffer', { n: treffer.length })}</p>
            <ul className="-mx-4 divide-y divide-slate-100 border-t border-slate-100">
              {treffer.map((a) => (
                <li key={a.id}>
                  <Link to={`/objekte/${a.objekt_id}?anlage=${a.id}`} className={`block px-4 py-2.5 hover:bg-akzent-hell ${a.status !== 'aktiv' ? 'text-slate-400' : ''}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span>
                        <span className="whitespace-nowrap font-mono font-semibold">{a.etikett_id ?? t('ohne Etikett')}</span>
                        {a.kunden_bezeichnung && <span className="ml-2">{a.kunden_bezeichnung}</span>}
                      </span>
                      <span className="text-sm text-slate-600"><Lesbar>{a.kunde}</Lesbar> · <Lesbar>{a.objekt}</Lesbar>{a.objekt_ort ? <>, <Lesbar>{a.objekt_ort}</Lesbar></> : ''}</span>
                    </div>
                    <div className="text-sm text-slate-600">
                      {[a.gebaeude, a.etage, a.raum].filter(Boolean).join(' / ')}{a.lage_beschreibung && ` · ${a.lage_beschreibung}`}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      {a.anlagentyp}
                      {a.status !== 'aktiv' && <Badge>{t('stillgelegt')}</Badge>}
                      {a.naechste_pruefung_am && (
                        <Badge farbe={a.naechste_pruefung_am < heute ? 'rot' : 'grau'}>{t('fällig {datum}', { datum: datum(a.naechste_pruefung_am) })}</Badge>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )
      )}

      <Dialog offen={scannen} titel={t('Etikett scannen')} onSchliessen={() => setScannen(false)}>
        {scannen && (
          <Suspense fallback={<p className="text-sm text-slate-500">{t('Kamera wird vorbereitet …')}</p>}>
            <QrScanner onErkannt={erkannt} />
          </Suspense>
        )}
      </Dialog>
    </section>
  )
}
