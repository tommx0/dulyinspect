// Gruppe der Elemente (Wohnung / Bereich, Stromkreis, Meldergruppe …) als Auswahl der vorab angelegten Gruppen,
// mit einem Eintrag „+ … anlegen …“, der einen kleinen Dialog für den Namen öffnet.
import { useState } from 'react'
import { gruppenListe, schreibweiseAngleichen } from '../lib/elemente'
import { Auswahl } from './Auswahl'
import { Formular, type FeldDef } from './Formular'
import { t } from '../lib/sprache'
import { Dialog } from './ui'

type Setze = (wert: string) => void

const NEU = '__neue_gruppe__'

/**
 * Auswahl der Gruppen eines Formulars. `bezeichnung` ist die Gruppe der Art („Wohnung / Bereich“), `gruppen` die angelegten
 * und verwendeten Gruppen. `anlegen` legt eine neue Gruppe an (Verwaltung: auf dem Server) und liefert bei Fehlern den Text;
 * ohne `anlegen` gilt sie nur hier, bis ein Element darin gespeichert ist (Prüfung, auch offline – die Datenbank trägt die
 * Gruppe des Elements dann in die Liste ein).
 */
export function useGruppeAuswahl(bezeichnung: string, gruppen: string[], anlegen?: (name: string) => Promise<string | void>) {
  const [neue, setNeue] = useState<string[]>([])
  const [ziel, setZiel] = useState<{ setze: Setze } | null>(null)
  const liste = gruppenListe([...gruppen, ...neue])
  const oeffnen = (setze: Setze) => setZiel({ setze })

  /** Formularfeld `gruppe`; `aktuell` (der eingetragene Wert) bleibt wählbar, auch wenn es die Gruppe nicht mehr gibt. */
  const feld = (aktuell: unknown, extra?: Partial<FeldDef>): FeldDef => ({
    name: 'gruppe', label: bezeichnung, typ: 'select',
    optionen: gruppenListe([...liste, ...(typeof aktuell === 'string' && aktuell ? [aktuell] : [])]).map((g) => ({ wert: g, text: g })),
    neu: { text: t('+ {gruppe} anlegen …', { gruppe: bezeichnung }), onWahl: oeffnen },
    ...extra,
  })

  const dialog = (
    <Dialog offen={ziel !== null} titel={t('{gruppe} anlegen', { gruppe: bezeichnung })} onSchliessen={() => setZiel(null)}>
      {ziel && (
        <Formular simulation={!anlegen} felder={[{ name: 'name', label: bezeichnung, pflicht: true }]} start={{}} speichernText={t('Anlegen')} onAbbrechen={() => setZiel(null)}
          onSpeichern={async (w) => {
            const name = schreibweiseAngleichen(String(w.name ?? ''), liste)
            if (!name) return t('Bitte einen Namen angeben.')
            if (name.length > 40) return t('Höchstens 40 Zeichen.')
            if (!liste.includes(name)) {
              const fehler = await anlegen?.(name)
              if (fehler) return fehler
              setNeue((n) => [...n, name])
            }
            ziel.setze(name)
            setZiel(null)
          }} />
      )}
    </Dialog>
  )

  /** Auswahl außerhalb eines Formulars (z. B. Wohnung der neuen Melder im Dauerscan) */
  const wahl = (id: string, wert: string, onWahl: Setze) => (
    <Auswahl id={id} value={wert} titel={bezeichnung} className="mt-0"
      onChange={(e) => (e.target.value === NEU ? oeffnen(onWahl) : onWahl(e.target.value))}>
      <option value="">–</option>
      {gruppenListe([...liste, ...(wert ? [wert] : [])]).map((g) => <option key={g} value={g}>{g}</option>)}
      <option value={NEU}>{t('+ {gruppe} anlegen …', { gruppe: bezeichnung })}</option>
    </Auswahl>
  )

  return { liste, feld, oeffnen, wahl, dialog }
}
