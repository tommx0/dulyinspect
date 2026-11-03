// Datenpaket für die PDF-Protokolle (vom Server geladen, Bilder bereits als data:-URLs)
import type { Punkt } from '../lib/checkliste'

export type Ampel = 'gruen' | 'gelb' | 'rot'

export interface ProtokollFirma {
  name: string
  strasse: string | null
  plz: string | null
  ort: string | null
  telefon: string | null
  email: string | null
  web: string | null
  zusatz: string | null
  protokoll_hinweis: string | null
  /** Sprache der Protokolle und Etiketten dieser Instanz ('de' | 'en'); fehlt sie, gilt Deutsch */
  protokoll_sprache?: string | null
}

export interface ProtokollPerson {
  id: string
  name: string
  sachkunde: string | null
  unterschrift: string | null // data:-URL
  /** Zeitpunkt der Unterschrift (Protokoll je Prüfung) */
  unterschriebenAm?: string | null
}

export interface ProtokollMangel {
  id: string
  stufe: number
  beschreibung: string
  /** Prüfpunkt, an dem der Mangel festgestellt wurde (für den Verweis auf seine Nummer) */
  punktId?: string | null
  punktText: string | null
  status: string
  festgestelltAm: string
  fotos: string[] // data:-URLs
}

export interface ProtokollAnlage {
  pruefungId: string
  status: 'geprueft' | 'nicht_geprueft'
  nichtGeprueftGrund: string | null
  pruefer: ProtokollPerson
  /** Gemeinsame Prüfung (Mehrpersonenprüfung): zugelassene Mitprüfer */
  mitpruefer?: ProtokollPerson[]
  /** Mitprüfer, die vor dem Abschluss entfernt wurden: beteiligt, ohne Unterschrift */
  beteiligt?: ProtokollPerson[]
  /**
   * Tür einer Türanlage: wer an dieser Tür erfasst hat (Antworten, Mängel, Elemente), mit Unterschrift. Steht als „Geprüft von“
   * mit Unterschriften im Türabschnitt; fehlt sonst.
   */
  geprueftVon?: ProtokollPerson[]
  /** Name der Prüfart, die diese Prüfung mit abdeckt (z. B. Wartung schließt Inspektion ein) */
  schliesstEin?: string | null
  beendetAm: string | null
  ergebnis: Ampel | null
  ergebnisAuto: Ampel | null
  ergebnisBegruendung: string | null
  /** In einer Revision von der Sessionleitung übernommen: ursprünglicher Prüfer */
  urspruenglicherPruefer: ProtokollPerson | null
  anlage: {
    etikett: string | null
    /** QR-Code zum Etikett der Anlage (data:-URL); fehlt, wenn die Anlage kein Etikett hat */
    etikettQr?: string | null
    bezeichnung: string | null
    gebaeude: string | null
    etage: string | null
    raum: string | null
    lage: string | null
    typ: string
    hersteller: string | null
    modell: string | null
    baujahr: number | null
    /** Bezeichnung eines Prüfgegenstands dieser Art, z. B. „Tür“ oder „Anlage“ */
    art: string
    /** Besondere Felder der Art in fester Reihenfolge (leere mit wert '') */
    anlagendaten: { text: string; wert: string }[]
    /** Prüfart, wenn es nicht die Standard-Prüfart ist (z. B. „Monatliche Funktionsprüfung“) */
    pruefart: string | null
    /** Nächste Fälligkeit dieser Prüfart */
    naechstePruefung: string | null
    /** Titel des Einzelprotokolls, z. B. „Tür“ oder „Sicherheitsbeleuchtung“ */
    protokollTitel: string
    /** Bestand je Objekt (Rauchwarnmelder, Geräte): ohne Lage und Hersteller (docs/KONZEPT-BESTAND-JE-OBJEKT.md) */
    bestand?: boolean
  }
  /** Elemente der Anlage (z. B. Leuchten) mit Ergebnis dieser Prüfung; null, wenn die Prüfart keine Elemente prüft */
  elemente: ProtokollElemente | null
  checkliste: { name: string; version: number; punkte: Punkt[] } | null
  antworten: Record<string, { status: 'io' | 'nio' | 'entfaellt' | null; zahl: number | null; text: string | null; bemerkung: string | null }>
  fotosJePunkt: Record<string, string[]>
  neueMaengel: ProtokollMangel[]
  /** Mängel aus früheren Prüfungen: in dieser Prüfung nachgeprüft (behoben) oder weiterhin offen */
  altMaengel: (ProtokollMangel & { behoben: boolean })[]
}

export interface ProtokollElemente {
  einzahl: string
  mehrzahl: string
  gruppe: string
  /** Überschrift der Spalte „Ort“, z. B. „Installationsort“ bei Meldern */
  ort: string
  /** Prüfart prüft nur einen Anteil je Termin */
  teilpruefung: boolean
  zyklusMonate: number
  /** aktive Elemente der Anlage */
  gesamt: number
  /** davon innerhalb des Zyklus geprüft (Stand beim Erstellen des Protokolls) */
  imZyklus: number
  zeilen: { gruppe: string | null; nummer: string; art: string | null; ort: string | null; /** Code des Aufklebers (nur Arten mit Codes) und sein QR-Code (data:-URL) */ code?: string | null; codeQr?: string | null; status: 'io' | 'defekt' | 'nicht_zugaenglich'; grund: string | null; bemerkung: string | null
    /** Nur Arten mit Messungen: je Spalte aus `messungen` der Wert, null = Messung gilt für dieses Element nicht */
    messwerte?: Record<string, ProtokollMesswert | null> }[]
  /** Spalten der Messwert-Tabelle (Messungen, die für mindestens ein geprüftes Element gelten); fehlt bei Arten ohne Messungen */
  messungen?: { schluessel: string; kurz: string; einheit: string }[]
}

export interface ProtokollMesswert {
  /** null = nicht gemessen */
  wert: number | null
  /** z. B. „≥ 1 MΩ“, leer ohne Grenzwert */
  grenze: string
  ausserhalb: boolean
}

/** Änderung in einer Revision (Protokoll je Prüfung) */
export interface ProtokollAenderung {
  am: string
  von: string
  text: string
}

/** Türanlage des Objekts (docs/KONZEPT-TUERANLAGE.md): die geprüften Türen stehen in `anlagen`, hier die Türanlage selbst */
export interface ProtokollTueranlage {
  /** „Türanlage <Objektname>“ */
  name: string
  pruefart: string | null
  ergebnis: Ampel | null
  ergebnisAuto: Ampel | null
  ergebnisBegruendung: string | null
  pruefer: ProtokollPerson
  mitpruefer: ProtokollPerson[]
  /** Mitprüfer, die vor dem Abschluss entfernt wurden: beteiligt, ohne Unterschrift */
  beteiligt: ProtokollPerson[]
}

export interface ProtokollDaten {
  firma: ProtokollFirma
  logo: string | null // data:-URL
  protokollNr: string
  revision: number
  revisionen: { revision: number; grund: string; am: string; von: string }[]
  kunde: { name: string; strasse: string | null; plz: string | null; ort: string | null; ansprechpartner: string | null }
  objekt: { name: string; strasse: string | null; plz: string | null; ort: string | null }
  begonnenAm: string
  abgeschlossenAm: string
  leiter: ProtokollPerson
  teilnehmer: ProtokollPerson[]
  bemerkung: string | null
  kundeName: string | null
  unterschriftLeiter: string | null
  unterschriftKunde: string | null
  anlagen: ProtokollAnlage[]
  /** Protokoll je Prüfung: Änderungen der aktuellen Revision */
  aenderungen?: ProtokollAenderung[]
  /** „Tür/Türen“, wenn nur Türen geprüft wurden, sonst „Anlage/Anlagen“ */
  begriffe: { einzahl: string; mehrzahl: string }
  /** Protokoll einer Türanlage: Türanlage, Gesamtergebnis und Unterschriften; `anlagen` sind ihre Türen */
  tueranlage?: ProtokollTueranlage
}
