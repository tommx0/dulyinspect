// Englisches Wörterbuch: deutscher Text der Oberfläche → englischer Text (src/lib/sprache.ts).
// Je Bereich eine Datei, damit Übersetzungen nicht kollidieren. Fachbegriffe: docs/GLOSSAR-ENGLISCH.md.
// Fehlt ein Eintrag, zeigt die App den deutschen Text; src/i18n/vollstaendig.test.ts meldet fehlende Einträge.
import { ALLGEMEIN } from './allgemein'
import { SEITENA } from './seitenA'
import { SEITENB } from './seitenB'
import { KOMPONENTENA } from './komponentenA'
import { KOMPONENTENB } from './komponentenB'
import { PRUEFEN } from './pruefen'
import { LIB } from './lib'
import { DATEN } from './daten'
import { PROTOKOLL } from './protokoll'
import { SERVER } from './server'
import { EINHEITLICH } from './einheitlich'

export const EN: Record<string, string> = {
  ...ALLGEMEIN,
  ...SEITENA,
  ...SEITENB,
  ...KOMPONENTENA,
  ...KOMPONENTENB,
  ...PRUEFEN,
  ...LIB,
  ...DATEN,
  ...PROTOKOLL,
  ...SERVER,
  ...EINHEITLICH,
}
