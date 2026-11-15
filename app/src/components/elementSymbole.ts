// Symbole je Art eines Elements (Melder, Leuchten, Komponenten …) für den Baum der Elemente (src/components/ElementBaum.tsx).
// Schlüssel wie in src/lib/anlagenarten.ts; gleiche Schlüssel in verschiedenen Anlagenarten (z. B. „rauchmelder“ bei BMA und RWA)
// meinen dasselbe Gerät. Arten ohne Eintrag zeigen nur ihre Nummer.
import {
  AlarmSmoke, AudioWaveform, BellRing, Blinds, BrickWallShield, Cable, CircleDot, CloudFog, CloudRain, Cog, Combine, Cpu, DoorOpen, Droplets,
  Fan, FireExtinguisher, Flame, Footprints, Gauge, Grid2x2X, Keyboard, KeyRound, Lightbulb, LockKeyhole, Magnet, MoveHorizontal, Pointer,
  Radar, Radio, ScanLine, ShieldAlert, Siren, Thermometer, ToggleRight, Wind, WindArrowDown, type LucideIcon,
} from 'lucide-react'

const SYMBOLE: Record<string, LucideIcon> = {
  // Brandmeldeanlage
  rauchmelder: AlarmSmoke,
  waermemelder: Thermometer,
  multisensor: Combine,
  handfeuermelder: Pointer,
  linienmelder: MoveHorizontal,
  ansaugrauchmelder: Fan,
  signalgeber: Siren,
  steuerung: Cpu,
  flammenmelder: Flame,
  linienwaermemelder: Cable,
  kanalrauchmelder: WindArrowDown,
  brandgasmelder: CloudFog,
  loeschanlage: Gauge,
  ein_ausgang: ToggleRight,
  // Einbruchmeldeanlage
  bewegungsmelder: Radar,
  oeffnungsmelder: Magnet,
  glasbruchmelder: Grid2x2X,
  riegelkontakt: LockKeyhole,
  koerperschall: AudioWaveform,
  ueberfallmelder: BellRing,
  bedienteil: Keyboard,
  lichtschranke: ScanLine,
  vorhangmelder: Blinds,
  flaechenueberwachung: BrickWallShield,
  trittmatte: Footprints,
  sabotagekontakt: ShieldAlert,
  schalteinrichtung: KeyRound,
  technischer_melder: Droplets,
  // Rauch- und Wärmeabzug
  antrieb: Cog,
  rwa_taster: Pointer,
  lueftungstaster: Wind,
  wind_regen: CloudRain,
  zuluft: DoorOpen,
  ventilator: Fan,
  // Rauchwarnmelder
  rauchwarnmelder: AlarmSmoke,
  waermewarnmelder: Thermometer,
  kombimelder: Combine,
  co_melder: CloudFog,
  funkmodul: Radio,
  // Sicherheitsbeleuchtung
  sicherheitsleuchte: Lightbulb,
  rettungszeichenleuchte: DoorOpen,
  // Feuerlöscher
  pulver: FireExtinguisher,
  schaum: FireExtinguisher,
  wasser: FireExtinguisher,
  fettbrand: FireExtinguisher,
  metallbrand: FireExtinguisher,
}

/** Symbol einer Elementart, z. B. Rauchmelder → Rauch, Bewegungsmelder → Radar; ohne Eintrag null. */
export function elementSymbol(art: string | null | undefined): LucideIcon | null {
  return (art && SYMBOLE[art]) || null
}

/**
 * Farbfamilie je Art, damit Verwandtes gleich aussieht: Rauch rot, Wärme/Flamme orange, Gas gelb, mehrere Prinzipien violett,
 * von Hand ausgelöst blau, Alarmierung pink, Steuerung und Bedienung grau, Löschanlage und technische Melder grün,
 * Bewegung und Strahl indigo, Öffnung und Verschluss türkis, Durchbruch und Erschütterung braun. Index in FARBEN (ElementBaum).
 */
const FAMILIE: Record<string, number> = {
  rauchmelder: 0, ansaugrauchmelder: 0, kanalrauchmelder: 0, rauchwarnmelder: 0, linienmelder: 0,
  waermemelder: 1, linienwaermemelder: 1, flammenmelder: 1, waermewarnmelder: 1,
  brandgasmelder: 2, co_melder: 2,
  multisensor: 3, kombimelder: 3,
  handfeuermelder: 4, rwa_taster: 4, ueberfallmelder: 4, lueftungstaster: 4,
  signalgeber: 5,
  steuerung: 6, ein_ausgang: 6, bedienteil: 6, schalteinrichtung: 6, funkmodul: 6, antrieb: 6,
  loeschanlage: 7, technischer_melder: 7, wind_regen: 7,
  bewegungsmelder: 8, lichtschranke: 8, vorhangmelder: 8, trittmatte: 8,
  oeffnungsmelder: 9, riegelkontakt: 9, sabotagekontakt: 9, zuluft: 9,
  glasbruchmelder: 10, flaechenueberwachung: 10, koerperschall: 10,
}

/** Farbfamilie einer Art (Index in FARBEN), ohne Eintrag null: dann zählt die Reihenfolge der Arten. */
export function elementFamilie(art: string | null | undefined): number | null {
  return art != null && art in FAMILIE ? FAMILIE[art] : null
}

/** Ersatz in der Legende, wenn eine Art kein eigenes Symbol hat */
export const OHNE_SYMBOL = CircleDot
