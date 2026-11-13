import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createHashRouter, Navigate, RouterProvider } from 'react-router'
import { AuthProvider, NurAdmin, NurSystemadmin } from './auth'
import { AltePruefung, AlteAdresse } from './components/AlteAdresse'
import { BestaetigungsHost } from './components/Bestaetigung'
import { FehlerSeite } from './components/FehlerSeite'
import { fehlerFaengerInstallieren } from './lib/fehlerMelden'
import { NurSichtbar } from './components/NurSichtbar'
import { SchemaPruefung } from './components/SchemaPruefung'
import { anwenden, ausCache } from './lib/erscheinungsbild'
import { RechtstextHost } from './components/Rechtstext'
import { UpdateHinweis } from './components/UpdateHinweis'
import { Wartung } from './Wartung'
import './index.css'
import { sprache } from './lib/sprache'
import { Layout } from './Layout'
import Benutzer from './seiten/Benutzer'
import ChecklisteEditor from './seiten/ChecklisteEditor'
import Checklisten from './seiten/Checklisten'
import KundeDetail from './seiten/KundeDetail'
import Kunden from './seiten/Kunden'
import KundenVerwaltung from './seiten/KundenVerwaltung'
import ObjekteVerwaltung from './seiten/ObjekteVerwaltung'
import Etiketten from './seiten/Etiketten'
import EtikettenDruck from './seiten/EtikettenDruck'
import ObjektDetail from './seiten/ObjektDetail'
import Start from './seiten/Start'
import Datensicherung from './seiten/Datensicherung'
import Inbetriebnahme from './seiten/Inbetriebnahme'
import Einstellungen, { EINSTELLUNGEN_SEITEN } from './seiten/Einstellungen'
import Logdateien from './seiten/Logdateien'
import Gesamtliste from './seiten/Gesamtliste'
import Faelligkeiten from './seiten/Faelligkeiten'
import Anlagen from './seiten/Anlagen'
import Maengel from './seiten/Maengel'
import ProtokollListe from './seiten/ProtokollListe'
import MenuePruefer from './seiten/MenuePruefer'
import Protokolle from './seiten/pruefen/Protokolle'
import Pruefprotokoll from './seiten/pruefen/Pruefprotokoll'
import PruefenStart from './seiten/pruefen/PruefenStart'
import ObjektPruefen from './seiten/pruefen/ObjektPruefen'
import AnlagenPruefung from './seiten/pruefen/AnlagenPruefung'
import AnlageElemente from './seiten/AnlageElemente'
import AnlagenImport from './seiten/AnlagenImport'
import AnlageSuche from './seiten/AnlageSuche'
import MelderSuche from './seiten/MelderSuche'
import Anlagentypen from './seiten/Anlagentypen'

document.documentElement.lang = sprache()
fehlerFaengerInstallieren()

// Hash-Routing: funktioniert auf reinem Static Hosting ohne Rewrite-Regeln und unter Unterpfaden.
// QR-Codes zeigen auf ./?t=PK-0000427 – das wird in Layout auf #/anlage/PK-0000427 umgeleitet (Melder-Etiketten: ./?m=<Code> → #/melder/<Code>).
const router = createHashRouter([
  {
    element: <Layout />,
    // Absturz einer Seite: Hinweis statt weißem Bildschirm, Meldung ans Fehlerprotokoll (src/lib/fehlerMelden.ts)
    errorElement: <FehlerSeite />,
    children: [
      { index: true, element: <Start /> },
      { path: 'kunden', element: <NurSichtbar bereich="kunden"><Kunden /></NurSichtbar> },
      { path: 'kunden/:id', element: <NurSichtbar bereich="kunden"><KundeDetail /></NurSichtbar> },
      { path: 'objekte/:id', element: <ObjektDetail /> },
      { path: 'objekte/:id/import', element: <NurAdmin><AnlagenImport /></NurAdmin> },
      { path: 'anlage/:etikett', element: <AnlageSuche /> },
      { path: 'melder/:code', element: <MelderSuche /> },
      // Adressen aus Version 1 (Lesezeichen, ältere Etiketten)
      { path: 'tuer/:etikett', element: <AlteAdresse /> },
      { path: 'tueren', element: <Navigate to="/anlagen" replace /> },
      { path: 'tuertypen', element: <Navigate to="/anlagentypen" replace /> },
      { path: 'pruefen', element: <PruefenStart /> },
      { path: 'faelligkeiten', element: <NurSichtbar bereich="faelligkeiten"><Faelligkeiten /></NurSichtbar> },
      { path: 'maengel', element: <NurSichtbar bereich="maengel"><Maengel /></NurSichtbar> },
      { path: 'pruefen/o/:oid', element: <ObjektPruefen /> },
      { path: 'pruefen/p/:pid', element: <AnlagenPruefung /> },
      { path: 'protokoll/:pid', element: <Pruefprotokoll /> },
      { path: 'protokolle', element: <ProtokollListe /> },
      // Prüfungen aus der Zeit der Sessions: Protokolle bleiben abrufbar, alte Adressen leiten weiter
      { path: 'pruefen/:sid/protokolle', element: <Protokolle /> },
      { path: 'pruefen/:sid/p/:pid', element: <AltePruefung /> },
      { path: 'pruefen/:sid/*', element: <Navigate to="/pruefen" replace /> },
      { path: 'einstellungen', element: <NurSystemadmin><Einstellungen /></NurSystemadmin>, children: EINSTELLUNGEN_SEITEN },
      { path: 'datensicherung', element: <NurSystemadmin><Datensicherung /></NurSystemadmin> },
      { path: 'inbetriebnahme', element: <NurSystemadmin><Inbetriebnahme /></NurSystemadmin> },
      { path: 'logdateien', element: <NurSystemadmin lesen><Logdateien /></NurSystemadmin> },
      { path: 'gesamtliste', element: <NurSystemadmin lesen><Gesamtliste /></NurSystemadmin> },
      { path: 'kundenliste', element: <NurAdmin><KundenVerwaltung /></NurAdmin> },
      { path: 'objektliste', element: <NurAdmin><ObjekteVerwaltung /></NurAdmin> },
      { path: 'anlagen', element: <NurAdmin><Anlagen /></NurAdmin> },
      { path: 'anlagen/:id/elemente', element: <NurAdmin><AnlageElemente /></NurAdmin> },
      { path: 'anlagentypen', element: <NurAdmin><Anlagentypen /></NurAdmin> },
      { path: 'checklisten', element: <NurAdmin><Checklisten /></NurAdmin> },
      { path: 'checklisten/:id', element: <NurAdmin><ChecklisteEditor /></NurAdmin> },
      { path: 'etiketten', element: <NurAdmin><Etiketten /></NurAdmin> },
      { path: 'etiketten/druck', element: <NurAdmin><EtikettenDruck /></NurAdmin> },
      { path: 'menue-pruefer', element: <NurAdmin><MenuePruefer /></NurAdmin> },
      { path: 'benutzer', element: <NurSystemadmin><Benutzer /></NurSystemadmin> },
      // Impressum/Datenschutz/Lizenzen zeigt RechtstextHost als Vollbild darüber
      { path: 'impressum', element: null },
      { path: 'datenschutz', element: null },
      { path: 'lizenzbedingungen', element: null },
      { path: 'lizenzen', element: null },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])

// Wartungsmodus (Build-Variable VITE_WARTUNG=ja bei deploybase): nur Hinweisseite, keine App
const wartung = import.meta.env.VITE_WARTUNG === 'ja'

// Farben und Titel der Instanz sofort aus dem Gerätespeicher (kein Aufblitzen), aktuell lädt useErscheinungsbild nach
anwenden(ausCache())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {wartung ? <Wartung /> : (
      <>
        <AuthProvider>
          <SchemaPruefung>
            <RouterProvider router={router} />
          </SchemaPruefung>
        </AuthProvider>
        {/* außerhalb des Logins: Service Worker wird schon beim ersten Aufruf registriert */}
        <UpdateHinweis />
        <BestaetigungsHost />
      </>
    )}
    <RechtstextHost />
  </StrictMode>,
)
