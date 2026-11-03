import { Fragment, type ReactNode } from 'react'

/** Übersetzten Satz mit Platzhaltern ({name}) zusammensetzen, wenn an deren Stelle Elemente stehen (z. B. <strong>). */
export function satz(text: string, teile: Record<string, ReactNode>): ReactNode {
  return text.split(/(\{\w+\})/).map((teil, i) => {
    const n = /^\{(\w+)\}$/.exec(teil)
    return <Fragment key={i}>{n && n[1] in teile ? teile[n[1]] : teil}</Fragment>
  })
}
