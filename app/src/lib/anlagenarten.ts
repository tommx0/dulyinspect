// Anlagenarten und ihre besonderen Stammdatenfelder (gespeichert in anlage.eigenschaften).
// Welche Arten eine Instanz nutzt, steht in der Tabelle anlagenart (Admin: Einstellungen).
// Fachliche Angaben sind Vorschläge und müssen abgenommen werden (docs/KONZEPT-ANLAGEN.md).
import { gebietsschema, t } from './sprache'

export type ArtSchluessel = 'tuer' | 'tueranlage' | 'sicherheitsbeleuchtung' | 'bma' | 'ema' | 'rwa' | 'rauchwarnmelder' | 'elektro' | 'geraete' | 'pv' | 'brandschutz' | 'feuerloescher'

/** Name der Prüfart, die beim Umstieg auf Version 2.1 jeder Typ bekam (wird nicht eigens angezeigt). */
export const STANDARD_PRUEFART = 'Wiederkehrende Prüfung'

export interface ArtFeld {
  schluessel: string
  text: string
  typ: 'text' | 'zahl' | 'datum' | 'monat' | 'auswahl' | 'ja_nein'
  optionen?: string[]
  einheit?: string
  hinweis?: string
  breit?: boolean
  /** Weitere Spaltenüberschriften für den Import (neben Bezeichnung und Schlüssel) */
  spalten?: string[]
  /** Je Element verschieden (z. B. Seriennummer): beim Anlegen mehrerer Elemente nicht für alle vorgeben */
  einzeln?: boolean
  /** Textfeld der Anlage: Auswahl aus den Werten der Anlagen derselben Art im Objekt, dazu „+ Neuer Eintrag …“ */
  vorhanden?: boolean
}

/** Element, wie es die Grenzwerte einer Messung sehen (Art und besondere Felder). */
export interface MessElement {
  elementart: string | null
  eigenschaften?: unknown
}

/**
 * Messgröße, die in der Prüfung je Element erfasst wird (z. B. Isolationswiderstand eines Stromkreises).
 * Grenzwerte hängen oft vom Element ab (Schutzklasse, Schutzorgan) und stehen deshalb als Funktion hier.
 */
export interface Messgroesse {
  schluessel: string
  text: string
  /** Spaltenkopf im Protokoll, z. B. „Riso“ */
  kurz: string
  einheit: string
  /** Gilt die Messung für dieses Element? Ohne Angabe für alle. */
  gilt?: (e: MessElement) => boolean
  /** Grenzwerte; null = nur erfassen, keine Bewertung */
  grenze?: (e: MessElement) => { min?: number; max?: number } | null
  /** Erwartungswert zur Orientierung ohne Bewertung, z. B. „612 V bei STC“ (PV-Leerlaufspannung hängt von der Temperatur ab) */
  richtwert?: (e: MessElement) => string | null
  hinweis?: string
}

/** Elemente einer Anlage, z. B. Leuchten einer Sicherheitsbeleuchtung (Phase 3). */
export interface ElementDefinition {
  einzahl: string
  mehrzahl: string
  /** Bezeichnung der Gruppe, z. B. „Stromkreis“ oder „Meldergruppe“ */
  gruppe: string
  /** Mehrzahl der Gruppe, z. B. „Wohnungen / Bereiche“ (Liste der Gruppen in der Verwaltung) */
  gruppeMehrzahl: string
  /** kuerzel: Wörter/Abkürzungen, an denen der Import die Art erkennt (z. B. „RZL“, „OM“) */
  arten: { schluessel: string; name: string; kuerzel?: string[]; /** Bezeichnung statt `einzahl`, wenn eine Liste verschiedene Dinge enthält (Stromkreis, Verbraucher) */ einzahl?: string
    /** Deutscher Name, wenn `name` übersetzt ist: der Import erkennt beide */
    nameDe?: string }[]
  /** Nummern wie „12/3“ enthalten die Gruppe (Meldergruppe 12, Melder 3) */
  nummerMitGruppe?: boolean
  /** Bezeichnung des Felds „Ort“, z. B. „Installationsort“ bei Meldern; ohne Angabe „Ort“ */
  ort?: string
  /** Auswahl bei „defekt“ */
  gruende: string[]
  /** Besondere Felder je Element (anlage_element.eigenschaften) */
  felder: ArtFeld[]
  /** Elemente tragen einen scanbaren Code (Aufkleber), z. B. Rauchwarnmelder: „Melder scannen“ in der Prüfung */
  codes?: boolean
  /** Messwerte je Element in der Prüfung (Elektroprüfungen); außerhalb der Grenzwerte ist das Element defekt */
  messungen?: Messgroesse[]
  /** Spaltenüberschriften für den Import, die vor den allgemeinen gelten (z. B. „Verteiler“ → Gruppe, „Stromkreis“ → Nummer) */
  spalten?: Partial<Record<'gruppe' | 'nummer' | 'elementart' | 'ort' | 'typ' | 'code', string[]>>
  /** Feld „Typ“ als Auswahl (erste Option = Standard für neue Elemente) mit „Eigener Name …“; ohne Angabe Freitext „Typ / Hersteller“ */
  typ?: { text: string; optionen: string[] }
}

export interface ArtDefinition {
  schluessel: ArtSchluessel
  /** Name der Art, z. B. in Einstellungen und Filtern */
  name: string
  /** Bezeichnung eines Prüfgegenstands dieser Art */
  einzahl: string
  /** Im Titel des Einzelprotokolls: „Prüfprotokoll Tür …“, „Prüfprotokoll Sicherheitsbeleuchtung …“ */
  protokoll: string
  mehrzahl: string
  /** Beschriftung der allgemeinen Felder Hersteller und Modell */
  hersteller: string
  modell: string
  /** Türkategorie (Fluchttür, Automatiktür …) nur bei Türen */
  mitKategorie: boolean
  felder: ArtFeld[]
  /** Hat die Art Elemente (Leuchten, Melder …)? */
  elemente?: ElementDefinition
  /** Fasst Türen zusammen (Türanlage): Die Türen bleiben eigene Anlagen (anlage.teil_von_id); geprüft, unterschrieben und
   *  abgeschlossen wird die Türanlage als Ganzes (docs/KONZEPT-TUERANLAGE.md). */
  tueren?: boolean
  /** Von der App verwaltet (Türanlage je Objekt): weder einschaltbar noch als Typ wählbar */
  intern?: boolean
  /** Keine zentralen Bauteile: je Objekt ein Bestand ohne Stammdaten, Fälligkeit je Element (docs/KONZEPT-BESTAND-JE-OBJEKT.md) */
  bestand?: boolean
}

const feld = (e: MessElement, schluessel: string) => ((e.eigenschaften ?? {}) as Eigenschaften)[schluessel]
const zahl = (w: unknown) => (typeof w === 'number' ? w : typeof w === 'string' && w.trim() ? Number(w.replace(',', '.')) : NaN)

/** Nennspannung gegen Erde in TN-Systemen (230/400 V) */
const U0 = 230

/**
 * Abschaltstrom Ia eines Leitungsschutzschalters aus der Bezeichnung des Schutzorgans („B16“, „C 20“, „D10“):
 * oberer Ansprechwert des Kurzschlussauslösers (B 5 × In, C 10 × In, D 20 × In, K 14 × In). Schmelzsicherungen (gG) → null,
 * dort gilt die Kennlinie des Herstellers.
 */
export function abschaltstrom(schutzorgan: unknown): number | null {
  const m = String(schutzorgan ?? '').trim().toUpperCase().match(/^([BCDK])\s*(\d+(?:[.,]\d+)?)\s*A?$/)
  if (!m) return null
  return { B: 5, C: 10, D: 20, K: 14 }[m[1] as 'B']! * Number(m[2].replace(',', '.'))
}

/** Bemessungsdifferenzstrom des RCD in mA aus der Auswahl („30 mA“), sonst null (kein RCD). */
export function rcdStrom(e: MessElement): number | null {
  const n = Number.parseInt(String(feld(e, 'rcd') ?? ''), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

const STROMKREIS = ['stromkreis', 'drehstromkreis']
const istStromkreis = (e: MessElement) => STROMKREIS.includes(e.elementart ?? '')
const mitRcd = (e: MessElement) => istStromkreis(e) && rcdStrom(e) != null

/** Leitungen und Steckdosenleisten: kein Geräteschutzleiterstrom, aber Schutzleiter wie Schutzklasse I */
const LEITUNG = ['verlaengerung', 'mehrfachsteckdose', 'leitungsroller']
const schutzklasse = (e: MessElement) => (LEITUNG.includes(e.elementart ?? '') ? 'I' : String(feld(e, 'schutzklasse') ?? '').replace(/^SK\s*/i, ''))

/**
 * Höchstwert des Schutzleiterwiderstands nach DIN EN 50678 / 50699: 0,3 Ω bis 5 m Leitungslänge,
 * je weitere 7,5 m + 0,1 Ω, höchstens 1 Ω. Ohne Längenangabe 0,3 Ω.
 */
export function schutzleiterGrenze(laenge: unknown): number {
  const l = zahl(laenge)
  if (!(l > 5)) return 0.3
  return Math.min(1, Math.round((0.3 + Math.ceil((l - 5) / 7.5) * 0.1) * 10) / 10)
}

/** Modulanzahl × Modulwert eines PV-Strangs (STC), wenn beides erfasst ist */
const strangwert = (e: MessElement, modulwert: string) => {
  const n = zahl(feld(e, 'module_anzahl')), w = zahl(feld(e, modulwert))
  return n > 0 && w > 0 ? n * w : null
}
const deZahl = (n: number) => n.toLocaleString(gebietsschema(), { maximumFractionDigits: 1 })

/** Deutsche Fassung; angezeigt wird ARTEN (übersetzt). */
export const ARTEN_DE: Record<ArtSchluessel, ArtDefinition> = {
  tuer: {
    schluessel: 'tuer', name: 'Türen', einzahl: 'Tür', mehrzahl: 'Türen', protokoll: 'Tür',
    hersteller: 'Hersteller (Tür)', modell: 'Modell (Tür)', mitKategorie: true,
    felder: [
      { schluessel: 'antrieb_system', text: 'Antrieb / System', typ: 'text', breit: true, vorhanden: true,
        hinweis: 'Hersteller und Typ von Antrieb, Steuerung oder Feststellanlage, z. B. „dormakaba ES 200“' },
    ],
  },
  tueranlage: {
    // Die Türanlage eines Objekts (docs/KONZEPT-TUERANLAGE.md): Klammer für die gemeinsame Prüfung aller Türen des Objekts.
    // Die App legt sie selbst an; sie hat keine Stammdaten und keine eigene Checkliste und erscheint in keiner Auswahl.
    schluessel: 'tueranlage', name: 'Türanlagen', einzahl: 'Türanlage', mehrzahl: 'Türanlagen', protokoll: 'Türanlage',
    hersteller: 'Hersteller', modell: 'Modell', mitKategorie: false, tueren: true, intern: true,
    felder: [],
  },
  sicherheitsbeleuchtung: {
    schluessel: 'sicherheitsbeleuchtung', name: 'Sicherheitsbeleuchtung', einzahl: 'Anlage', mehrzahl: 'Anlagen', protokoll: 'Sicherheitsbeleuchtung',
    hersteller: 'Hersteller (Anlage)', modell: 'Typ der Zentrale / Anlage', mitKategorie: false,
    felder: [
      { schluessel: 'systemart', text: 'Systemart', typ: 'auswahl',
        optionen: ['Zentralbatterieanlage (CPS)', 'Gruppenbatterieanlage (LPS)', 'Einzelbatterieleuchten'] },
      { schluessel: 'nennbetriebsdauer', text: 'Nennbetriebsdauer', typ: 'auswahl', optionen: ['1 h', '3 h', '8 h'] },
      { schluessel: 'batterie', text: 'Batterie (Typ, Kapazität)', typ: 'text', hinweis: 'z. B. „OGiV 12 V 65 Ah“' },
      { schluessel: 'batterie_einbau', text: 'Batterie eingebaut am', typ: 'datum' },
      { schluessel: 'stromkreise', text: 'Anzahl Endstromkreise', typ: 'zahl' },
      { schluessel: 'leuchten', text: 'Anzahl Leuchten', typ: 'zahl' },
      { schluessel: 'pruefeinrichtung', text: 'Automatische Prüfeinrichtung', typ: 'ja_nein' },
      { schluessel: 'pruefbuch', text: 'Standort Prüfbuch', typ: 'text' },
    ],
    elemente: {
      einzahl: 'Leuchte', mehrzahl: 'Leuchten', gruppe: 'Stromkreis', gruppeMehrzahl: 'Stromkreise',
      arten: [
        { schluessel: 'sicherheitsleuchte', name: 'Sicherheitsleuchte', kuerzel: ['sl', 'sicherheit', 'notlicht', 'antipanik'] },
        { schluessel: 'rettungszeichenleuchte', name: 'Rettungszeichenleuchte', kuerzel: ['rzl', 'rettung', 'zeichen', 'piktogramm', 'hinweis'] },
      ],
      gruende: ['Leuchtmittel defekt', 'Batterie/Akku defekt', 'Ladekontrolle aus', 'Piktogramm fehlt oder falsch', 'Leuchte beschädigt', 'sonstiger Defekt'],
      felder: [
        { schluessel: 'schaltung', text: 'Schaltungsart', typ: 'auswahl', optionen: ['Dauerschaltung', 'Bereitschaftsschaltung'] },
        { schluessel: 'akku', text: 'Akku eingebaut am', typ: 'datum', hinweis: 'Nur bei Einzelbatterieleuchten' },
      ],
    },
  },
  bma: {
    schluessel: 'bma', name: 'Brandmeldeanlagen', einzahl: 'Anlage', mehrzahl: 'Anlagen', protokoll: 'Brandmeldeanlage',
    hersteller: 'Hersteller (Zentrale)', modell: 'Typ der Zentrale', mitKategorie: false,
    felder: [
      { schluessel: 'meldergruppen', text: 'Anzahl Meldergruppen', typ: 'zahl' },
      { schluessel: 'ue', text: 'Aufschaltung zur Feuerwehr (Übertragungseinrichtung)', typ: 'ja_nein' },
      { schluessel: 'fsd', text: 'Feuerwehr-Schlüsseldepot', typ: 'ja_nein' },
      { schluessel: 'fbf', text: 'Feuerwehr-Bedienfeld', typ: 'ja_nein' },
      { schluessel: 'fat', text: 'Feuerwehr-Anzeigetableau', typ: 'ja_nein' },
      { schluessel: 'laufkarten', text: 'Feuerwehr-Laufkarten', typ: 'ja_nein' },
      { schluessel: 'betriebsbuch', text: 'Standort Betriebsbuch', typ: 'text' },
    ],
    elemente: {
      einzahl: 'Melder', mehrzahl: 'Melder', gruppe: 'Meldergruppe', gruppeMehrzahl: 'Meldergruppen', nummerMitGruppe: true, ort: 'Installationsort',
      arten: [
        { schluessel: 'rauchmelder', name: 'Rauchmelder (optisch)', kuerzel: ['om', 'orm', 'rm', 'rauch', 'optisch'] },
        { schluessel: 'waermemelder', name: 'Wärmemelder', kuerzel: ['wm', 'wärme', 'waerme', 'thermo'] },
        { schluessel: 'multisensor', name: 'Multisensormelder', kuerzel: ['ms', 'multi', 'otm', 'kombi'] },
        { schluessel: 'handfeuermelder', name: 'Handfeuermelder', kuerzel: ['hfm', 'hand', 'druckknopf', 'dkm'] },
        { schluessel: 'linienmelder', name: 'Linienmelder', kuerzel: ['linien', 'lrm', 'strahl'] },
        { schluessel: 'ansaugrauchmelder', name: 'Ansaugrauchmelder', kuerzel: ['ras', 'ansaug'] },
        { schluessel: 'signalgeber', name: 'Signalgeber', kuerzel: ['sg', 'signal', 'sirene', 'blitz', 'akustisch'] },
        { schluessel: 'steuerung', name: 'Brandfallsteuerung', kuerzel: ['bfs', 'steuer', 'ansteuerung', 'koppler'] },
      ],
      gruende: ['löst nicht aus', 'Prüfgas/Prüfwärme nicht erkannt', 'verschmutzt', 'beschädigt', 'Melder fehlt', 'Parallelanzeige defekt', 'sonstiger Defekt'],
      felder: [
        { schluessel: 'einbau', text: 'Eingebaut am', typ: 'datum' },
        { schluessel: 'verdeckt', text: 'In Zwischendecke / Doppelboden', typ: 'ja_nein' },
      ],
    },
  },
  ema: {
    schluessel: 'ema', name: 'Alarmanlagen', einzahl: 'Anlage', mehrzahl: 'Anlagen', protokoll: 'Alarmanlage',
    hersteller: 'Hersteller (Zentrale)', modell: 'Typ der Zentrale', mitKategorie: false,
    felder: [
      { schluessel: 'klasse', text: 'Klasse / Grad', typ: 'auswahl', optionen: ['VdS Klasse A', 'VdS Klasse B', 'VdS Klasse C', 'Grad 1', 'Grad 2', 'Grad 3', 'Grad 4'] },
      { schluessel: 'bereiche', text: 'Anzahl Sicherungsbereiche', typ: 'zahl' },
      { schluessel: 'nsl', text: 'Aufschaltung auf Notruf- und Serviceleitstelle', typ: 'ja_nein' },
      { schluessel: 'nsl_name', text: 'Notruf- und Serviceleitstelle', typ: 'text' },
      { schluessel: 'betriebsbuch', text: 'Standort Betriebsbuch', typ: 'text' },
    ],
    elemente: {
      einzahl: 'Melder', mehrzahl: 'Melder', gruppe: 'Meldergruppe', gruppeMehrzahl: 'Meldergruppen', nummerMitGruppe: true, ort: 'Installationsort',
      arten: [
        { schluessel: 'bewegungsmelder', name: 'Bewegungsmelder', kuerzel: ['bm', 'pir', 'bewegung', 'dual'] },
        { schluessel: 'oeffnungsmelder', name: 'Öffnungsmelder (Magnetkontakt)', kuerzel: ['mk', 'öm', 'oem', 'magnet', 'öffnung', 'oeffnung', 'reed'] },
        { schluessel: 'glasbruchmelder', name: 'Glasbruchmelder', kuerzel: ['gbm', 'glas'] },
        { schluessel: 'riegelkontakt', name: 'Riegelschaltkontakt', kuerzel: ['rsk', 'riegel'] },
        { schluessel: 'koerperschall', name: 'Körperschallmelder', kuerzel: ['ksm', 'körperschall', 'koerperschall'] },
        { schluessel: 'ueberfallmelder', name: 'Überfallmelder', kuerzel: ['üm', 'uem', 'überfall', 'ueberfall', 'notruf'] },
        { schluessel: 'signalgeber', name: 'Signalgeber', kuerzel: ['sg', 'signal', 'sirene', 'blitz'] },
        { schluessel: 'bedienteil', name: 'Bedienteil', kuerzel: ['bt', 'bedien', 'tastatur', 'leser'] },
      ],
      gruende: ['löst nicht aus', 'Sabotageüberwachung defekt', 'Erfassungsbereich verstellt', 'beschädigt', 'Batterie schwach (Funk)', 'sonstiger Defekt'],
      felder: [{ schluessel: 'bereich', text: 'Sicherungsbereich', typ: 'text' }],
    },
  },
  rwa: {
    schluessel: 'rwa', name: 'Rauch- und Wärmeabzugsanlagen', einzahl: 'Anlage', mehrzahl: 'Anlagen', protokoll: 'Rauch- und Wärmeabzugsanlage',
    hersteller: 'Hersteller (Steuerung)', modell: 'Typ der Steuerzentrale', mitKategorie: false,
    felder: [
      { schluessel: 'bauart', text: 'Bauart', typ: 'auswahl',
        optionen: ['Natürliche RWA (NRA, DIN 18232-2)', 'Maschinelle RWA (MRA, DIN 18232-5)', 'Rauchabzug im Treppenraum'] },
      { schluessel: 'energie', text: 'Energieversorgung', typ: 'auswahl', optionen: ['elektrisch (24 V DC)', 'pneumatisch (CO₂)', 'elektrisch und pneumatisch'] },
      { schluessel: 'rauchabschnitte', text: 'Anzahl Rauchabschnitte / Gruppen', typ: 'zahl' },
      { schluessel: 'geraete', text: 'Anzahl Rauchabzugsgeräte', typ: 'zahl' },
      { schluessel: 'volumenstrom', text: 'Auslegungsvolumenstrom (gesamt)', typ: 'zahl', einheit: 'm³/h', hinweis: 'Nur bei maschineller RWA' },
      { schluessel: 'temperaturklasse', text: 'Temperaturklasse der Ventilatoren', typ: 'auswahl',
        optionen: ['F200 (200 °C, 120 min)', 'F300 (300 °C, 60 min)', 'F400 (400 °C, 120 min)', 'F600 (600 °C, 60 min)', 'F842 (842 °C, 30 min)'],
        hinweis: 'Nur bei maschineller RWA, nach DIN EN 12101-3' },
      { schluessel: 'batterie', text: 'Notstromakkus (Typ, Kapazität)', typ: 'text', hinweis: 'z. B. „2 × 12 V 7,2 Ah“' },
      { schluessel: 'batterie_einbau', text: 'Akkus eingebaut am', typ: 'datum' },
      { schluessel: 'automatisch', text: 'Automatische Auslösung (Rauchmelder)', typ: 'ja_nein' },
      { schluessel: 'bma_ansteuerung', text: 'Ansteuerung durch Brandmeldeanlage', typ: 'ja_nein' },
      { schluessel: 'lueftung', text: 'Lüftungsfunktion / Wind-Regen-Automatik', typ: 'ja_nein' },
      { schluessel: 'pruefbuch', text: 'Standort Prüfbuch', typ: 'text' },
    ],
    elemente: {
      einzahl: 'Komponente', mehrzahl: 'Komponenten', gruppe: 'Rauchabschnitt', gruppeMehrzahl: 'Rauchabschnitte',
      arten: [
        // Name nicht mit „Rauchabz…“ beginnen lassen, sonst erkennt der Import „Rauchabzugsventilator“ als Gerät
        { schluessel: 'rauchabzugsgeraet', name: 'Natürliches Rauchabzugsgerät (NRWG, Fenster, Klappe)',
          kuerzel: ['nrwg', 'rwg', 'rauchabzugsgerät', 'rauchabzugsgeraet', 'rauchabzugsfenster', 'rauchabzugsklappe', 'lichtkuppel', 'lamellenfenster', 'jalousie'] },
        { schluessel: 'antrieb', name: 'Antrieb', kuerzel: ['antrieb', 'motor', 'kette', 'kettenantrieb', 'spindel', 'zylinder', 'hubzylinder'] },
        { schluessel: 'rwa_taster', name: 'RWA-Taster (Bedienstelle)', kuerzel: ['taster', 'rt', 'bedienstelle', 'hauptbedienstelle', 'auslösung', 'ausloesung', 'handauslösung'] },
        { schluessel: 'rauchmelder', name: 'Rauchmelder', kuerzel: ['rm', 'om', 'orm', 'rauchmelder', 'optisch'] },
        { schluessel: 'lueftungstaster', name: 'Lüftungstaster', kuerzel: ['lt', 'lüftung', 'lueftung'] },
        { schluessel: 'wind_regen', name: 'Wind-/Regenmelder', kuerzel: ['wrm', 'wind', 'regen'] },
        { schluessel: 'zuluft', name: 'Zuluftöffnung', kuerzel: ['zuluft', 'nachström', 'nachstroem'] },
        { schluessel: 'ventilator', name: 'Rauchabzugsventilator (MRA)', kuerzel: ['ventilator', 'rauchabzugsventilator', 'entrauchungsventilator', 'mra', 'lüfter', 'luefter'] },
        { schluessel: 'co2', name: 'CO₂-Auslöseeinrichtung', kuerzel: ['co2', 'co', 'pneumatik', 'flasche', 'kartusche'] },
        // Name nicht mit „Entrauch…“ beginnen lassen, sonst erkennt der Import „Entrauchungsventilator“ als Klappe
        { schluessel: 'entrauchungsklappe', name: 'Klappe (Entrauchungsklappe)', kuerzel: ['ek', 'entrauchungsklappe', 'klappe'] },
        { schluessel: 'rauchschuerze', name: 'Rauchschürze', kuerzel: ['rauchschürze', 'rauchschuerze', 'schürze', 'schuerze'] },
      ],
      gruende: ['öffnet nicht', 'öffnet nicht vollständig oder zu langsam', 'schließt nicht', 'Antrieb defekt', 'Auslösung defekt (Taster/Melder)',
        'Öffnungsweg verstellt', 'beschädigt oder undicht', 'CO₂-Flasche unter Mindestgewicht', 'Volumenstrom zu gering', 'Stellungsmeldung falsch', 'sonstiger Defekt'],
      felder: [
        { schluessel: 'flaeche', text: 'Aerodynamisch wirksame Fläche', typ: 'zahl', einheit: 'm²', hinweis: 'Nur bei Rauchabzugsgeräten' },
        { schluessel: 'volumenstrom', text: 'Auslegungsvolumenstrom', typ: 'zahl', einheit: 'm³/h', hinweis: 'Nur bei Ventilatoren' },
        { schluessel: 'einbau', text: 'Eingebaut am', typ: 'datum' },
      ],
    },
  },
  rauchwarnmelder: {
    // Bestand je Objekt (docs/KONZEPT-BESTAND-JE-OBJEKT.md): eine Anlage ohne Stammdaten je Objekt, geprüft werden die Melder
    // darin, gruppiert nach Wohnung. Zugang und Schlüssel stehen in den Zugangshinweisen des Objekts.
    schluessel: 'rauchwarnmelder', name: 'Rauchwarnmelder', einzahl: 'Anlage', mehrzahl: 'Anlagen', protokoll: 'Rauchwarnmelder',
    hersteller: 'Hersteller (Melder)', modell: 'Modell (Melder)', mitKategorie: false, bestand: true,
    felder: [],
    elemente: {
      einzahl: 'Melder', mehrzahl: 'Melder', gruppe: 'Wohnung / Bereich', gruppeMehrzahl: 'Wohnungen / Bereiche', ort: 'Installationsort',
      arten: [
        { schluessel: 'rauchwarnmelder', name: 'Rauchwarnmelder', kuerzel: ['rwm', 'rm', 'rauch'] },
        { schluessel: 'waermewarnmelder', name: 'Wärmewarnmelder', kuerzel: ['wwm', 'wm', 'wärme', 'waerme', 'hitze'] },
        { schluessel: 'kombimelder', name: 'Kombimelder (Rauch/Wärme)', kuerzel: ['kombi', 'multi'] },
        { schluessel: 'co_melder', name: 'CO-Warnmelder', kuerzel: ['co', 'kohlenmonoxid'] },
        { schluessel: 'funkmodul', name: 'Funkmodul / Handtaster', kuerzel: ['funk', 'modul', 'handtaster', 'taster'] },
      ],
      codes: true,
      gruende: ['kein Alarmton beim Test', 'Warnsignal (Batterie schwach / Störung)', 'Austauschdatum erreicht oder überschritten',
        'verschmutzt', 'überstrichen oder abgedeckt', 'beschädigt', 'Melder fehlt', 'Montageort ungeeignet',
        'Funkvernetzung gestört (löst andere Melder nicht aus)', 'sonstiger Defekt'],
      felder: [
        { schluessel: 'seriennummer', text: 'Seriennummer', typ: 'text', einzeln: true },
        { schluessel: 'einbau', text: 'Eingebaut am', typ: 'datum' },
        { schluessel: 'austausch', text: 'Austauschdatum (laut Aufkleber)', typ: 'monat', hinweis: 'Monat und Jahr vom Aufkleber (Sanduhr), z. B. 06-2037; gespeichert wird der Monatsletzte' },
        { schluessel: 'funk', text: 'Funkvernetzt', typ: 'ja_nein' },
      ],
    },
  },

  elektro: {
    // Die Anlage ist die elektrische Anlage eines Objekts (Hausanschluss, Hauptverteilung, Erdung);
    // Stromkreise und fest angeschlossene Verbraucher sind die Elemente, gruppiert nach Verteiler.
    schluessel: 'elektro', name: 'Elektrische Anlagen', einzahl: 'Anlage', mehrzahl: 'Anlagen', protokoll: 'Elektrische Anlage',
    hersteller: 'Errichter', modell: 'Hauptverteilung (Bezeichnung)', mitKategorie: false,
    felder: [
      { schluessel: 'netzform', text: 'Netzform', typ: 'auswahl', optionen: ['TN-C', 'TN-S', 'TN-C-S', 'TT', 'IT'] },
      { schluessel: 'nennspannung', text: 'Nennspannung', typ: 'auswahl', optionen: ['230/400 V', '230 V', '400/690 V'] },
      { schluessel: 'hausanschluss', text: 'Hausanschlusssicherung', typ: 'text', hinweis: 'z. B. „3 × 63 A NH gG“' },
      { schluessel: 'erder', text: 'Erder', typ: 'auswahl', optionen: ['Fundamenterder', 'Ringerder', 'Tiefenerder', 'Staberder', 'nicht bekannt'] },
      { schluessel: 'verteiler', text: 'Anzahl Verteiler', typ: 'zahl' },
      { schluessel: 'ueberspannungsschutz', text: 'Überspannungsschutz (SPD)', typ: 'ja_nein' },
      { schluessel: 'umfang', text: 'Umfang der Prüfung', typ: 'text', breit: true, hinweis: 'z. B. „gesamte Anlage EG–2. OG“ oder „Neubau Werkstatt, UV-3“' },
      { schluessel: 'unterlagen', text: 'Standort Schaltpläne / Anlagenbuch', typ: 'text' },
    ],
    elemente: {
      einzahl: 'Stromkreis / Verbraucher', mehrzahl: 'Stromkreise und Verbraucher', gruppe: 'Verteiler', gruppeMehrzahl: 'Verteiler',
      typ: { text: 'Typ', optionen: ['Stromkreis'] },
      spalten: { gruppe: ['verteiler', 'unterverteilung', 'verteilung', 'uv', 'hv'], nummer: ['stromkreis', 'stromkreis nr', 'sk', 'bmk', 'betriebsmittelkennzeichen', 'kennzeichen'] },
      arten: [
        { schluessel: 'stromkreis', name: 'Stromkreis 230 V', einzahl: 'Stromkreis', kuerzel: ['stromkreis', 'sk', 'wechselstrom', '230', '1p', 'licht', 'steckdose'] },
        { schluessel: 'drehstromkreis', name: 'Drehstromkreis 400 V', einzahl: 'Stromkreis', kuerzel: ['drehstrom', '400', '3p', 'cee', 'kraft'] },
        { schluessel: 'verbraucher', name: 'Verbraucher (fest angeschlossen)', einzahl: 'Verbraucher',
          kuerzel: ['verbraucher', 'betriebsmittel', 'herd', 'boiler', 'durchlauferhitzer', 'motor', 'pumpe', 'heizung', 'wallbox'] },
      ],
      gruende: ['Schutzorgan falsch bemessen', 'RCD fehlt oder löst nicht aus', 'Isolation beschädigt', 'Schutzleiter fehlt oder unterbrochen',
        'Klemmstelle lose oder überhitzt', 'Kennzeichnung fehlt', 'Abdeckung / Berührungsschutz fehlt', 'sonstiger Mangel'],
      felder: [
        { schluessel: 'schutzorgan', text: 'Schutzorgan', typ: 'text', spalten: ['sicherung', 'absicherung', 'lss', 'leitungsschutzschalter'], hinweis: 'z. B. „B16“, „C20“, „gG 35 A“ – bei B/C/D/K wird der Grenzwert für Zs berechnet' },
        { schluessel: 'rcd', text: 'RCD (Bemessungsdifferenzstrom)', typ: 'auswahl', spalten: ['fi', 'fehlerstromschutzschalter', 'idn'], optionen: ['10 mA', '30 mA', '100 mA', '300 mA', '500 mA'], hinweis: 'Leer, wenn der Stromkreis nicht über einen RCD geschützt ist' },
        { schluessel: 'rcd_typ', text: 'RCD-Typ', typ: 'auswahl', spalten: ['fi typ'], optionen: ['Typ AC', 'Typ A', 'Typ F', 'Typ B', 'Typ A, selektiv (S)', 'Typ B, selektiv (S)'] },
        { schluessel: 'leitung', text: 'Leitung', typ: 'text', spalten: ['kabel', 'leitungstyp', 'querschnitt'], hinweis: 'z. B. „NYM-J 3 × 1,5 mm²“' },
        { schluessel: 'stromkreis', text: 'Stromkreis', typ: 'text', hinweis: 'Nur bei Verbrauchern: Stromkreis, an dem der Verbraucher angeschlossen ist' },
        { schluessel: 'leistung', text: 'Bemessungsleistung', typ: 'zahl', einheit: 'kW', hinweis: 'Nur bei Verbrauchern' },
      ],
      // Grenzwerte nach DIN VDE 0100-600 bzw. 0105-100 als Vorschlag – fachlich prüfen (docs/KONZEPT-ANLAGEN.md)
      messungen: [
        { schluessel: 'rpe', text: 'Schutzleiterwiderstand (Durchgängigkeit)', kurz: 'RPE', einheit: 'Ω',
          hinweis: 'Kein fester Grenzwert: Der Wert muss zur Leitungslänge und zum Querschnitt passen.' },
        { schluessel: 'riso', text: 'Isolationswiderstand', kurz: 'Riso', einheit: 'MΩ', grenze: () => ({ min: 1 }),
          hinweis: 'Messspannung 500 V DC (bei SELV/PELV 250 V DC, Mindestwert dann 0,5 MΩ)' },
        { schluessel: 'zs', text: 'Schleifenimpedanz', kurz: 'Zs', einheit: 'Ω', gilt: istStromkreis,
          grenze: (e) => { const ia = abschaltstrom(feld(e, 'schutzorgan')); return ia ? { max: Math.floor((U0 / ia) * 100) / 100 } : null },
          hinweis: 'U0 / Ia aus dem Schutzorgan (z. B. B16: 2,87 Ω)' },
        { schluessel: 'ik', text: 'Kurzschlussstrom', kurz: 'Ik', einheit: 'A', gilt: istStromkreis,
          grenze: (e) => { const ia = abschaltstrom(feld(e, 'schutzorgan')); return ia ? { min: ia } : null },
          hinweis: 'Abschaltstrom Ia des Schutzorgans (z. B. B16: 80 A)' },
        { schluessel: 'rcd_ia', text: 'Auslösestrom RCD', kurz: 'IΔ', einheit: 'mA', gilt: mitRcd,
          grenze: (e) => { const n = rcdStrom(e)!; return { min: n / 2, max: n } }, hinweis: 'Zwischen 50 % und 100 % des Bemessungsdifferenzstroms' },
        { schluessel: 'rcd_ta', text: 'Auslösezeit RCD bei IΔN', kurz: 'tA', einheit: 'ms', gilt: mitRcd,
          grenze: (e) => ({ max: /selektiv/.test(String(feld(e, 'rcd_typ') ?? '')) ? 500 : 300 }), hinweis: 'Höchstens 300 ms (selektive RCD 500 ms)' },
        { schluessel: 'ub', text: 'Berührungsspannung bei IΔN', kurz: 'UB', einheit: 'V', gilt: mitRcd, grenze: () => ({ max: 50 }) },
      ],
    },
  },
  geraete: {
    // Wie Rauchwarnmelder ein Bestand je Objekt ohne Stammdaten; geprüft werden die Geräte, gruppiert nach Raum / Bereich.
    schluessel: 'geraete', name: 'Ortsveränderliche Geräte', einzahl: 'Anlage', mehrzahl: 'Anlagen', protokoll: 'Ortsveränderliche elektrische Geräte',
    hersteller: 'Hersteller', modell: 'Modell', mitKategorie: false, bestand: true,
    felder: [],
    elemente: {
      einzahl: 'Gerät', mehrzahl: 'Geräte', gruppe: 'Raum / Bereich', gruppeMehrzahl: 'Räume / Bereiche', codes: true,
      spalten: { gruppe: ['raum', 'bereich', 'raum bereich', 'abteilung', 'kostenstelle'], nummer: ['inventarnummer', 'inventar nr', 'inv nr', 'gerätenummer', 'geraetenummer', 'id nr', 'id'],
        ort: ['standort', 'arbeitsplatz'], typ: ['gerät', 'geraet', 'bezeichnung', 'typ', 'hersteller', 'modell', 'fabrikat'] },
      arten: [
        { schluessel: 'handgeraet', name: 'Elektrowerkzeug / Handgerät', kuerzel: ['werkzeug', 'bohr', 'säge', 'saege', 'schleif', 'flex', 'handgerät', 'handgeraet'] },
        { schluessel: 'buerogeraet', name: 'Büro- und IT-Gerät', kuerzel: ['pc', 'monitor', 'drucker', 'büro', 'buero', 'it', 'laptop', 'netzteil'] },
        { schluessel: 'haushaltsgeraet', name: 'Küchen- und Haushaltsgerät', kuerzel: ['kaffee', 'wasserkocher', 'mikrowelle', 'kühlschrank', 'kuehlschrank', 'küche', 'kueche', 'toaster'] },
        { schluessel: 'leuchte', name: 'Leuchte', kuerzel: ['leuchte', 'lampe', 'strahler'] },
        { schluessel: 'heizgeraet', name: 'Heiz- und Wärmegerät', kuerzel: ['heiz', 'lüfter', 'luefter', 'radiator', 'heißluft', 'heissluft'] },
        { schluessel: 'verlaengerung', name: 'Verlängerungsleitung', kuerzel: ['verlängerung', 'verlaengerung', 'kabel', 'leitung'] },
        { schluessel: 'mehrfachsteckdose', name: 'Mehrfachsteckdose', kuerzel: ['mehrfach', 'steckdosenleiste', 'leiste', 'verteiler'] },
        { schluessel: 'leitungsroller', name: 'Leitungsroller (Kabeltrommel)', kuerzel: ['roller', 'trommel', 'kabeltrommel'] },
        { schluessel: 'sonstiges', name: 'sonstiges Gerät', kuerzel: ['sonstig'] },
      ],
      gruende: ['Gehäuse beschädigt', 'Anschlussleitung beschädigt', 'Stecker beschädigt', 'Zugentlastung / Knickschutz mangelhaft',
        'Funktion gestört', 'Aufschriften / Kennzeichnung fehlen', 'unzulässig repariert oder verändert', 'sonstiger Mangel'],
      felder: [
        { schluessel: 'schutzklasse', text: 'Schutzklasse', typ: 'auswahl', optionen: ['SK I', 'SK II', 'SK III'], hinweis: 'Bestimmt die Messungen und Grenzwerte; Leitungen und Steckdosenleisten wie SK I' },
        { schluessel: 'seriennummer', text: 'Seriennummer', typ: 'text', einzeln: true },
        { schluessel: 'laenge', text: 'Länge der Anschluss- bzw. Verlängerungsleitung', typ: 'zahl', spalten: ['länge', 'leitungslänge', 'kabellänge'], einheit: 'm', hinweis: 'Für den Grenzwert des Schutzleiterwiderstands' },
        { schluessel: 'heizung', text: 'Mit Heizelementen', typ: 'ja_nein', spalten: ['heizelemente', 'heizelement', 'heizung'], hinweis: 'Schutzklasse I mit Heizelementen: Isolationswiderstand mindestens 0,3 MΩ' },
        { schluessel: 'leistung', text: 'Bemessungsleistung', typ: 'zahl', einheit: 'kW' },
      ],
      // Grenzwerte nach DIN EN 50678 (VDE 0701) / DIN EN 50699 (VDE 0702) als Vorschlag – fachlich prüfen
      messungen: [
        { schluessel: 'rpe', text: 'Schutzleiterwiderstand', kurz: 'RPE', einheit: 'Ω', gilt: (e) => schutzklasse(e) === 'I',
          grenze: (e) => ({ max: schutzleiterGrenze(feld(e, 'laenge')) }), hinweis: '0,3 Ω bis 5 m, je weitere 7,5 m + 0,1 Ω, höchstens 1 Ω' },
        { schluessel: 'riso', text: 'Isolationswiderstand', kurz: 'Riso', einheit: 'MΩ',
          grenze: (e) => {
            const sk = schutzklasse(e)
            if (sk === 'II') return { min: 2 }
            if (sk === 'III') return { min: 0.25 }
            return { min: feld(e, 'heizung') === true || feld(e, 'heizung') === 'ja' ? 0.3 : 1 }
          },
          hinweis: 'SK I 1 MΩ (mit Heizelementen 0,3 MΩ), SK II 2 MΩ, SK III 0,25 MΩ' },
        { schluessel: 'ipe', text: 'Schutzleiterstrom', kurz: 'IPE', einheit: 'mA', gilt: (e) => schutzklasse(e) === 'I' && !LEITUNG.includes(e.elementart ?? ''),
          grenze: (e) => { const kw = zahl(feld(e, 'leistung')); return { max: kw > 3.5 ? Math.min(10, kw) : 3.5 } },
          hinweis: '3,5 mA; Heizgeräte über 3,5 kW 1 mA je kW, höchstens 10 mA' },
        { schluessel: 'ib', text: 'Berührungsstrom', kurz: 'IB', einheit: 'mA', gilt: (e) => schutzklasse(e) === 'II', grenze: () => ({ max: 0.5 }),
          hinweis: 'An berührbaren leitfähigen Teilen' },
      ],
    },
  },

  pv: {
    // Die Anlage ist die PV-Anlage (Generator, Wechselrichter, AC-Anschluss, ggf. Batteriespeicher – diese prüft die Checkliste);
    // die Stränge sind die Elemente mit ihren Messwerten nach DIN EN 62446-1 (VDE 0126-23-1), gruppiert nach Wechselrichter / MPP-Eingang.
    schluessel: 'pv', name: 'Photovoltaikanlagen', einzahl: 'Anlage', mehrzahl: 'Anlagen', protokoll: 'Photovoltaikanlage',
    hersteller: 'Errichter', modell: 'Wechselrichter (Hersteller, Typ)', mitKategorie: false,
    felder: [
      { schluessel: 'kwp', text: 'Anlagenleistung', typ: 'zahl', einheit: 'kWp' },
      { schluessel: 'montage', text: 'Montage', typ: 'auswahl', optionen: ['Schrägdach', 'Flachdach', 'Fassade', 'Carport', 'Freifläche'] },
      { schluessel: 'einspeisung', text: 'Betriebsweise', typ: 'auswahl', optionen: ['Überschusseinspeisung', 'Volleinspeisung', 'Nulleinspeisung / Eigenverbrauch'] },
      { schluessel: 'na_schutz', text: 'NA-Schutz (VDE-AR-N 4105)', typ: 'auswahl', optionen: ['im Wechselrichter integriert', 'zentraler NA-Schutz'] },
      { schluessel: 'speicher', text: 'Batteriespeicher (Hersteller, Typ)', typ: 'text', hinweis: 'Leer, wenn die Anlage keinen Speicher hat' },
      { schluessel: 'speicher_kwh', text: 'Speicherkapazität', typ: 'zahl', einheit: 'kWh' },
      { schluessel: 'speicher_kopplung', text: 'Kopplung des Speichers', typ: 'auswahl', optionen: ['AC-gekoppelt', 'DC-gekoppelt'] },
      { schluessel: 'ersatzstrom', text: 'Not- / Ersatzstrom', typ: 'auswahl', optionen: ['keine', 'Notstrom (einzelne Steckdose)', 'Ersatzstrom (Hausnetz, automatische Umschaltung)'] },
      { schluessel: 'feuerwehrschalter', text: 'DC-Freischaltstelle (Feuerwehrschalter)', typ: 'ja_nein' },
      { schluessel: 'blitzschutz', text: 'Äußerer Blitzschutz am Gebäude', typ: 'ja_nein' },
      { schluessel: 'mastr', text: 'Marktstammdatenregister-Nr.', typ: 'text', hinweis: 'z. B. „SEE912345678901“' },
      { schluessel: 'netzbetreiber', text: 'Netzbetreiber', typ: 'text' },
    ],
    elemente: {
      einzahl: 'Strang', mehrzahl: 'Stränge', gruppe: 'Wechselrichter / MPP-Eingang', gruppeMehrzahl: 'Wechselrichter / MPP-Eingänge',
      spalten: { gruppe: ['wechselrichter', 'wr', 'mpp', 'mpp tracker', 'mppt', 'eingang'], nummer: ['strang', 'string', 'strang nr', 'string nr', 'strangnummer'] },
      arten: [
        { schluessel: 'strang', name: 'Strang', kuerzel: ['strang', 'string'] },
        { schluessel: 'strang_optimierer', name: 'Strang mit Leistungsoptimierern', einzahl: 'Strang', kuerzel: ['optimierer', 'optimizer', 'solaredge', 'tigo'] },
      ],
      gruende: ['Polarität vertauscht', 'Steckverbinder beschädigt oder Fremdpaarung', 'Leitung beschädigt (Scheuerstelle, Tierverbiss)',
        'Modul beschädigt (Glasbruch, Hotspot, Delamination)', 'Strangsicherung defekt', 'Verschattung oder starke Verschmutzung', 'Befestigung lose', 'sonstiger Mangel'],
      felder: [
        { schluessel: 'module_anzahl', text: 'Anzahl Module', typ: 'zahl', spalten: ['module', 'anzahl module', 'modulanzahl'] },
        { schluessel: 'modul', text: 'Modul (Hersteller, Typ)', typ: 'text', spalten: ['modultyp'] },
        { schluessel: 'uoc_modul', text: 'Leerlaufspannung Modul (STC)', typ: 'zahl', einheit: 'V', spalten: ['uoc modul', 'voc modul', 'uoc', 'voc'], hinweis: 'Aus dem Datenblatt, für den Richtwert der Strangspannung' },
        { schluessel: 'isc_modul', text: 'Kurzschlussstrom Modul (STC)', typ: 'zahl', einheit: 'A', spalten: ['isc modul', 'isc'] },
        { schluessel: 'ausrichtung', text: 'Ausrichtung / Neigung', typ: 'text', hinweis: 'z. B. „Süd, 30°“' },
        { schluessel: 'strangsicherung', text: 'Strangsicherung', typ: 'text', hinweis: 'z. B. „gPV 15 A“; leer, wenn keine' },
      ],
      // Prüfungen der Kategorie 1 nach DIN EN 62446-1 als Vorschlag – fachlich prüfen
      messungen: [
        { schluessel: 'uoc', text: 'Leerlaufspannung', kurz: 'Uoc', einheit: 'V',
          richtwert: (e) => { const u = e.elementart === 'strang' ? strangwert(e, 'uoc_modul') : null; return u ? t('{wert} V bei STC', { wert: deZahl(u) }) : null },
          hinweis: 'Mit dem Richtwert und gleichen Strängen vergleichen (Abweichung über 5 % prüfen); kalte Module liefern mehr, warme weniger Spannung' },
        { schluessel: 'isc', text: 'Kurzschlussstrom', kurz: 'Isc', einheit: 'A',
          richtwert: (e) => { const i = zahl(feld(e, 'isc_modul')); return i > 0 ? t('{wert} A bei STC, umrechnen mit Einstrahlung / 1000 W/m²', { wert: deZahl(i) }) : null },
          hinweis: 'Oder Betriebsstrom; bei stabiler Einstrahlung messen' },
        { schluessel: 'imp', text: 'Betriebsstrom', kurz: 'Ib', einheit: 'A', hinweis: 'Wenn statt des Kurzschlussstroms gemessen' },
        { schluessel: 'riso', text: 'Isolationswiderstand', kurz: 'Riso', einheit: 'MΩ',
          grenze: (e) => { const u = strangwert(e, 'uoc_modul'); return { min: u != null && u * 1.25 < 120 ? 0.5 : 1 } },
          hinweis: 'Systemspannung (Uoc × 1,25) unter 120 V: 250 V DC, mindestens 0,5 MΩ; sonst 500 V bzw. 1000 V DC, mindestens 1 MΩ' },
      ],
    },
  },
  brandschutz: {
    // Brandschutzbegehung: die Anlage ist das begangene Gebäude bzw. der Bereich (baulicher und organisatorischer Brandschutz);
    // keine Elemente, geprüft wird nur die Checkliste. Feuerlöscher, BMA, RWA usw. bleiben eigene Arten mit eigener Prüfung.
    schluessel: 'brandschutz', name: 'Brandschutzbegehungen', einzahl: 'Bereich', mehrzahl: 'Bereiche', protokoll: 'Brandschutzbegehung',
    hersteller: 'Brandschutzbeauftragte(r)', modell: 'Nutzung', mitKategorie: false,
    felder: [
      { schluessel: 'gebaeudeklasse', text: 'Gebäudeklasse', typ: 'auswahl', optionen: ['GK 1', 'GK 2', 'GK 3', 'GK 4', 'GK 5'] },
      { schluessel: 'sonderbau', text: 'Sonderbau', typ: 'auswahl',
        optionen: ['kein Sonderbau', 'Versammlungsstätte', 'Verkaufsstätte', 'Beherbergungsstätte', 'Krankenhaus / Pflegeeinrichtung',
          'Schule / Kita', 'Hochhaus', 'Industriebau', 'Garage', 'sonstiger Sonderbau'] },
      { schluessel: 'geschosse', text: 'Anzahl Geschosse', typ: 'zahl' },
      { schluessel: 'brandschutzkonzept', text: 'Brandschutzkonzept / -nachweis vorhanden', typ: 'ja_nein' },
      { schluessel: 'brandschutzordnung', text: 'Brandschutzordnung (DIN 14096) vorhanden', typ: 'ja_nein' },
      { schluessel: 'rettungsplaene', text: 'Flucht- und Rettungspläne (DIN ISO 23601)', typ: 'ja_nein' },
      { schluessel: 'feuerwehrplaene', text: 'Feuerwehrpläne (DIN 14095)', typ: 'ja_nein' },
      { schluessel: 'brandschutzhelfer', text: 'Anzahl Brandschutzhelfer', typ: 'zahl', hinweis: 'ASR A2.2: in der Regel 5 % der Beschäftigten' },
      { schluessel: 'unterlagen', text: 'Standort der Brandschutzunterlagen', typ: 'text' },
    ],
  },
  feuerloescher: {
    // Bestand je Objekt (docs/KONZEPT-BESTAND-JE-OBJEKT.md) wie Rauchwarnmelder: geprüft werden die Feuerlöscher darin,
    // gruppiert nach Etage / Bereich; die Fälligkeit (DIN 14406-4: höchstens alle 2 Jahre) gilt je Löscher.
    schluessel: 'feuerloescher', name: 'Feuerlöscher', einzahl: 'Anlage', mehrzahl: 'Anlagen', protokoll: 'Feuerlöscher',
    hersteller: 'Hersteller', modell: 'Modell', mitKategorie: false, bestand: true,
    felder: [],
    elemente: {
      einzahl: 'Feuerlöscher', mehrzahl: 'Feuerlöscher', gruppe: 'Etage / Bereich', gruppeMehrzahl: 'Etagen / Bereiche', ort: 'Standort', codes: true,
      spalten: { gruppe: ['etage', 'geschoss', 'bereich', 'etage bereich'], nummer: ['löschernummer', 'loeschernummer', 'standortnummer', 'nr'],
        ort: ['standort', 'aufstellort'], typ: ['hersteller', 'fabrikat', 'modell', 'typ'] },
      arten: [
        { schluessel: 'pulver', name: 'Pulverlöscher (ABC)', kuerzel: ['pg', 'pulver', 'abc', 'glutbrandpulver'] },
        { schluessel: 'schaum', name: 'Schaumlöscher (AB)', kuerzel: ['schaum', 'af', 'ab'] },
        { schluessel: 'wasser', name: 'Wasserlöscher (A)', kuerzel: ['wasser', 'wassernebel'] },
        { schluessel: 'co2', name: 'Kohlendioxidlöscher (B, CO₂)', kuerzel: ['co2', 'kd', 'kohlendioxid', 'kohlensäure', 'kohlensaeure'] },
        { schluessel: 'fettbrand', name: 'Fettbrandlöscher (F)', kuerzel: ['fett', 'fettbrand'] },
        { schluessel: 'metallbrand', name: 'Metallbrandlöscher (D)', kuerzel: ['metall', 'metallbrand'] },
        { schluessel: 'loeschdecke', name: 'Löschdecke', kuerzel: ['decke', 'löschdecke', 'loeschdecke'] },
      ],
      gruende: ['Plombe / Sicherung fehlt oder beschädigt', 'Druck außerhalb des Sollbereichs', 'Löschmittel fehlt oder zu wenig (Gewicht)',
        'Behälter beschädigt oder korrodiert', 'Schlauch / Löschpistole beschädigt oder verstopft', 'Aufschrift unleserlich',
        'Halterung fehlt oder lose', 'verstellt oder nicht erreichbar', 'Kennzeichnung (Brandschutzzeichen) fehlt',
        'Druckbehälterprüfung / Instandsetzung fällig', 'Austausch nötig (Alter, keine Ersatzteile)', 'Feuerlöscher fehlt', 'sonstiger Mangel'],
      felder: [
        { schluessel: 'seriennummer', text: 'Seriennummer', typ: 'text', einzeln: true },
        { schluessel: 'fuellmenge', text: 'Füllmenge', typ: 'zahl', einheit: 'kg bzw. l', spalten: ['füllmenge', 'fuellmenge', 'inhalt', 'kg'] },
        { schluessel: 'loescheinheiten', text: 'Löschmitteleinheiten (LE)', typ: 'zahl', spalten: ['le', 'löschmitteleinheiten', 'loeschmitteleinheiten'],
          hinweis: 'Nach ASR A2.2, Tabelle 3 (Löschvermögen laut Aufschrift); für die Bemessung der Grundausstattung' },
        { schluessel: 'bauart', text: 'Bauart', typ: 'auswahl', optionen: ['Aufladelöscher', 'Dauerdrucklöscher'] },
        { schluessel: 'baujahr', text: 'Herstelljahr', typ: 'zahl', spalten: ['baujahr', 'herstelljahr'] },
        { schluessel: 'druckpruefung', text: 'Nächste Druckbehälterprüfung / Instandsetzung', typ: 'monat',
          hinweis: 'Laut Behälter bzw. Herstellerangabe (Dauerdrucklöscher, CO₂-Flaschen); gespeichert wird der Monatsletzte' },
      ],
    },
  },
}

// Anzeigetexte in der Sprache der Oberfläche. Auswahlwerte, Gründe bei „defekt“, Typ-Optionen und Importkürzel bleiben deutsch:
// Sie werden gespeichert bzw. mit Dateien verglichen (Anzeige mit t(wert) an der Stelle der Anzeige).
function feldUebersetzt(f: ArtFeld): ArtFeld {
  const text = t(f.text)
  return { ...f, text, ...(f.hinweis ? { hinweis: t(f.hinweis) } : {}),
    // deutsche Bezeichnung bleibt als Spaltenüberschrift im Import erkennbar
    ...(text !== f.text ? { spalten: [...(f.spalten ?? []), f.text] } : {}) }
}

// „Melder“, „Verteiler“: Einzahl gleich Mehrzahl – das Wörterbuch braucht für die Mehrzahl einen eigenen Eintrag
function mehrzahl(einzahl: string, mehr: string): string {
  if (mehr !== einzahl) return t(mehr)
  const eintrag = `${mehr} (Mehrzahl)`
  return t(eintrag) === eintrag ? mehr : t(eintrag)
}

function elementeUebersetzt(e: ElementDefinition): ElementDefinition {
  return {
    ...e, einzahl: t(e.einzahl), mehrzahl: mehrzahl(e.einzahl, e.mehrzahl), gruppe: t(e.gruppe), gruppeMehrzahl: mehrzahl(e.gruppe, e.gruppeMehrzahl),
    ...(e.ort ? { ort: t(e.ort) } : {}),
    arten: e.arten.map((a) => ({ ...a, name: t(a.name), ...(t(a.name) !== a.name ? { nameDe: a.name } : {}), ...(a.einzahl ? { einzahl: t(a.einzahl) } : {}) })),
    felder: e.felder.map(feldUebersetzt),
    ...(e.typ ? { typ: { ...e.typ, text: t(e.typ.text) } } : {}),
    ...(e.messungen ? { messungen: e.messungen.map((m) => ({ ...m, text: t(m.text), ...(m.hinweis ? { hinweis: t(m.hinweis) } : {}) })) } : {}),
  }
}

export const ARTEN = Object.fromEntries(Object.entries(ARTEN_DE).map(([k, a]) => [k, {
  ...a, name: t(a.name), einzahl: t(a.einzahl), protokoll: t(a.protokoll), mehrzahl: t(a.mehrzahl), hersteller: t(a.hersteller), modell: t(a.modell),
  felder: a.felder.map(feldUebersetzt), ...(a.elemente ? { elemente: elementeUebersetzt(a.elemente) } : {}),
}])) as Record<ArtSchluessel, ArtDefinition>

export const ART_SCHLUESSEL = Object.keys(ARTEN) as ArtSchluessel[]

/** Definition zu einem Schlüssel aus der Datenbank (unbekannte Arten wie Türen behandeln). */
export function artDefinition(schluessel: string | null | undefined): ArtDefinition {
  return ARTEN[schluessel as ArtSchluessel] ?? ARTEN.tuer
}

export type Eigenschaften = Record<string, string | number | boolean | null>

/**
 * Monatsangabe wie auf dem Aufkleber („06-2037“, „06/2037“) oder aus einem Monatsfeld („2037-06“) → letzter Tag des Monats
 * („2037-06-30“). Ein volles Datum wird auf das Ende seines Monats gesetzt. Ungültiges → null.
 */
export function monatsende(eingabe: string): string | null {
  const t = eingabe.trim()
  const a = t.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/)
  const b = t.match(/^(\d{1,2})[-/.](\d{4})$/)
  const jahr = a ? Number(a[1]) : b ? Number(b[2]) : NaN
  const monat = a ? Number(a[2]) : b ? Number(b[1]) : NaN
  if (!(jahr >= 1900 && jahr <= 2200) || !(monat >= 1 && monat <= 12)) return null
  const tag = new Date(Date.UTC(jahr, monat, 0)).getUTCDate()
  return `${jahr}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`
}

/** Gespeichertes Datum → Wert für ein Monatsfeld („2037-06-30“ → „2037-06“). */
export const monatEingabe = (datum: unknown): string => (typeof datum === 'string' && /^\d{4}-\d{2}/.test(datum) ? datum.slice(0, 7) : '')

/** Wert eines Feldes für die Anzeige, z. B. „3 h“, „ja“, „12.03.2024“. */
export function feldText(feld: ArtFeld, wert: unknown): string {
  if (wert == null || wert === '') return ''
  if (feld.typ === 'ja_nein') return wert === true || wert === 'ja' ? t('ja') : t('nein')
  if (feld.typ === 'auswahl' && typeof wert === 'string') return t(wert)
  if (feld.typ === 'monat' && typeof wert === 'string' && /^\d{4}-\d{2}/.test(wert)) return `${wert.slice(5, 7)}-${wert.slice(0, 4)}`
  if (feld.typ === 'datum' && typeof wert === 'string' && /^\d{4}-\d{2}-\d{2}/.test(wert)) {
    const [j, m, tag] = wert.slice(0, 10).split('-')
    return `${tag}.${m}.${j}`
  }
  return `${wert}${feld.einheit ? ` ${feld.einheit}` : ''}`
}

/** Ausgefüllte Felder als Liste „Bezeichnung: Wert“ (Protokoll, Prüfansicht). */
export function eigenschaftenListe(art: string | null | undefined, eigenschaften: unknown): { text: string; wert: string }[] {
  const e = (eigenschaften ?? {}) as Eigenschaften
  return artDefinition(art).felder
    .map((f) => ({ text: f.text, wert: feldText(f, e[f.schluessel]) }))
    .filter((x) => x.wert)
}

/** Kurzfassung für Listen, z. B. „dormakaba ES 200“ oder „Zentralbatterieanlage (CPS) · 3 h“. */
export function eigenschaftenKurz(art: string | null | undefined, eigenschaften: unknown): string {
  return eigenschaftenListe(art, eigenschaften).slice(0, 2).map((x) => x.wert).join(' · ')
}
