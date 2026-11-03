// Symbole je Anlagenart und Prüfart (Lucide-Icons) sowie der Pfeil für klickbare Zeilen.
// Farben je Art fest im Code, damit sie neben der einstellbaren Marken- und Akzentfarbe gut unterscheidbar bleiben.
import {
  Activity, AlarmSmoke, BadgeCheck, BatteryCharging, Building2, CalendarCheck, ChevronRight, DoorClosed, DoorOpen, Flame, Lightbulb,
  FireExtinguisher, PackageCheck, Plug, ScanSearch, ShieldCheck, ShieldAlert, SolarPanel, Wind, Wrench, Zap, type LucideIcon,
} from 'lucide-react'
import { createElement } from 'react'
import { artDefinition, STANDARD_PRUEFART, type ArtSchluessel } from '../lib/anlagenarten'
import { istBestandArt } from '../lib/bestand'
import { t } from '../lib/sprache'

// kraeftig/strich: dieselbe Farbe als volle Fläche bzw. SVG-Strich für Diagramme (Dashboard der Startseite)
const ART: Record<ArtSchluessel, { symbol: LucideIcon; farbe: string; kraeftig: string; strich: string }> = {
  tuer: { symbol: DoorOpen, farbe: 'bg-slate-100 text-slate-700 ring-slate-200', kraeftig: 'bg-slate-500', strich: 'stroke-slate-500' },
  tueranlage: { symbol: DoorClosed, farbe: 'bg-teal-50 text-teal-700 ring-teal-200', kraeftig: 'bg-teal-500', strich: 'stroke-teal-500' },
  sicherheitsbeleuchtung: { symbol: Lightbulb, farbe: 'bg-emerald-50 text-emerald-700 ring-emerald-200', kraeftig: 'bg-emerald-500', strich: 'stroke-emerald-500' },
  bma: { symbol: Flame, farbe: 'bg-red-50 text-red-700 ring-red-200', kraeftig: 'bg-red-500', strich: 'stroke-red-500' },
  ema: { symbol: ShieldAlert, farbe: 'bg-indigo-50 text-indigo-700 ring-indigo-200', kraeftig: 'bg-indigo-500', strich: 'stroke-indigo-500' },
  rwa: { symbol: Wind, farbe: 'bg-sky-50 text-sky-700 ring-sky-200', kraeftig: 'bg-sky-500', strich: 'stroke-sky-500' },
  rauchwarnmelder: { symbol: AlarmSmoke, farbe: 'bg-amber-50 text-amber-700 ring-amber-200', kraeftig: 'bg-amber-500', strich: 'stroke-amber-500' },
  elektro: { symbol: Zap, farbe: 'bg-yellow-50 text-yellow-700 ring-yellow-300', kraeftig: 'bg-yellow-400', strich: 'stroke-yellow-400' },
  geraete: { symbol: Plug, farbe: 'bg-violet-50 text-violet-700 ring-violet-200', kraeftig: 'bg-violet-500', strich: 'stroke-violet-500' },
  pv: { symbol: SolarPanel, farbe: 'bg-orange-50 text-orange-700 ring-orange-200', kraeftig: 'bg-orange-500', strich: 'stroke-orange-500' },
  brandschutz: { symbol: ShieldCheck, farbe: 'bg-stone-100 text-stone-700 ring-stone-300', kraeftig: 'bg-stone-500', strich: 'stroke-stone-500' },
  feuerloescher: { symbol: FireExtinguisher, farbe: 'bg-rose-50 text-rose-700 ring-rose-200', kraeftig: 'bg-rose-500', strich: 'stroke-rose-500' },
}

/** Volle Farbe einer Anlagenart für Diagramme: Fläche (`kraeftig`) und SVG-Strich (`strich`). */
export function artFarbe(art: string | null | undefined): { kraeftig: string; strich: string } {
  return ART[artDefinition(art).schluessel]
}

const GROESSE = {
  sm: 'size-7 rounded-md [&>svg]:size-4',
  md: 'size-10 rounded-lg [&>svg]:size-5',
  lg: 'size-12 rounded-xl [&>svg]:size-6',
}

type Groesse = keyof typeof GROESSE

function Kachel({ symbol: Bild, farbe, groesse, titel }: { symbol: LucideIcon; farbe: string; groesse: Groesse; titel?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center ring-1 ring-inset ${farbe} ${GROESSE[groesse]}`} title={titel} aria-hidden>
      <Bild strokeWidth={1.75} />
    </span>
  )
}

/** Farbige Kachel mit dem Symbol der Anlagenart (Tür, Sicherheitsbeleuchtung, BMA …). */
export function ArtSymbol({ art, groesse = 'md' }: { art: string | null | undefined; groesse?: Groesse }) {
  const a = ART[artDefinition(art).schluessel]
  return <Kachel symbol={a.symbol} farbe={a.farbe} groesse={groesse} titel={artDefinition(art).name} />
}

/** Auswahl-Einträge für Anlagentypen mit dem Symbol der Art; kommen mehrere Arten vor, steht die Art darunter. */
export function typOptionen(typen: { id: string; name: string; anlagenart: string }[]) {
  const mehrere = new Set(typen.map((typ) => artDefinition(typ.anlagenart).schluessel)).size > 1
  return typen.map((typ) => ({
    wert: typ.id, text: typ.name, symbol: <ArtSymbol art={typ.anlagenart} />, zusatz: mehrere ? artDefinition(typ.anlagenart).name : undefined,
  }))
}

/** Neutrale Kachel für Kunden und Objekte. */
export function ObjektSymbol({ groesse = 'md' }: { groesse?: Groesse }) {
  return <Kachel symbol={Building2} farbe="bg-stone-100 text-stone-600 ring-stone-200" groesse={groesse} />
}

/** Symbol einer Prüfart nach ihrem (frei wählbaren) Namen, z. B. „Wartung“ → Schraubenschlüssel. */
function symbolFuerPruefart(name: string): LucideIcon {
  const n = name.toLowerCase()
  if (n.includes('wartung') || n.includes('instandsetzung')) return Wrench
  if (n.includes('installation') || n.includes('inbetriebnahme') || n.includes('erstprüfung')) return PackageCheck
  if (n.includes('inspektion') || n.includes('sicht')) return ScanSearch
  if (n.includes('betriebsdauer') || n.includes('batterie') || n.includes('akku')) return BatteryCharging
  if (n.includes('funktion')) return Activity
  if (n.includes('sachverständig') || n.includes('abnahme')) return BadgeCheck
  return CalendarCheck
}

/** Symbol einer Prüfart als Grafik (ohne Kachel). */
export function PruefartSymbol({ name, className, strokeWidth = 1.75 }: { name: string; className?: string; strokeWidth?: number }) {
  return createElement(symbolFuerPruefart(name), { className, strokeWidth, 'aria-hidden': true })
}

/** Prüfart als kleines Etikett mit Symbol; die Standard-Prüfart von Türen bleibt unsichtbar. */
export function PruefartChip({ name, zusatz }: { name: string | null | undefined; zusatz?: string }) {
  if (!name || name === STANDARD_PRUEFART) return null
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200" data-pruefart>
      <PruefartSymbol name={name} className="size-3.5 text-slate-500" strokeWidth={2} />
      {name}{zusatz && <span className="font-normal text-slate-500">{zusatz}</span>}
    </span>
  )
}

/** Pfeil am Ende einer klickbaren Zeile (Elternelement mit `group`). */
export function Weiter() {
  return <ChevronRight className="size-5 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-marke" strokeWidth={2} aria-hidden />
}

/** Etikett-ID in Listen; fehlt sie, ein zurückhaltender Hinweis statt fetter Schreibmaschinenschrift. */
export function EtikettText({ id, art }: { id: string | null | undefined; /** Bestand (Rauchwarnmelder, Geräte) hat kein Etikett */ art?: string | null }) {
  if (!id && istBestandArt(art)) return null
  return id
    ? <span className="whitespace-nowrap font-mono font-semibold">{id}</span>
    : <span className="whitespace-nowrap text-sm text-slate-400">{t('ohne Etikett')}</span>
}
