import { appName, logoUrl, useErscheinungsbild } from '../lib/erscheinungsbild'

/** Logo der Instanz (vom Admin hochgeladen, sonst Standardlogo). */
export function Logo({ className = '' }: { className?: string }) {
  const e = useErscheinungsbild()
  return <img src={logoUrl(e)} alt={appName(e)} className={className} onError={(ev) => { ev.currentTarget.src = './logo.svg' }} />
}
