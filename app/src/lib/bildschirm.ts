// Bildschirmbreite für Ansichten, die es nur am großen Bildschirm gibt (Dashboard der Startseite).
import { useSyncExternalStore } from 'react'

/** Ab dieser Breite (Tailwind `xl`) zeigt die Startseite das Dashboard. */
const GROSS = '(min-width: 1280px)'

function abonnieren(h: () => void) {
  const m = window.matchMedia(GROSS)
  m.addEventListener('change', h)
  return () => m.removeEventListener('change', h)
}

/** Großer Bildschirm (PC)? Zeichnet beim Über- oder Unterschreiten der Breite neu. */
export function useGrosserBildschirm(): boolean {
  return useSyncExternalStore(abonnieren, () => window.matchMedia(GROSS).matches)
}
