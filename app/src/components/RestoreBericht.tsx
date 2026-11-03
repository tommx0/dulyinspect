import type { RestoreBericht } from '../datensicherung/sicherung'
import { t } from '../lib/sprache'
import { Tabelle } from './ui'

/** Ergebnis einer Wiederherstellung (Seite Datensicherung und Sperrbildschirm der Verschlüsselung). */
export function RestoreBerichtAnzeige({ bericht }: { bericht: RestoreBericht }) {
  return (
    <div className="space-y-2 text-sm" data-restore-bericht>
      <p className="font-medium text-green-800">
        {t('Wiederherstellung abgeschlossen: {datensaetze} Datensätze ergänzt, {dateien} Dateien ergänzt.', {
          datensaetze: Object.values(bericht.tabellen).reduce((a, x) => a + x.eingefuegt, 0), dateien: bericht.dateienHochgeladen,
        })}
      </p>
      <Tabelle kopf={[t('Tabelle'), t('ergänzt'), t('schon vorhanden'), t('nicht möglich')]}>
        {Object.entries(bericht.tabellen).filter(([, x]) => x.eingefuegt + x.vorhanden + x.fehlgeschlagen > 0).map(([tabelle, x]) => (
          <tr key={tabelle}><td className="px-3 py-1 font-mono text-xs">{tabelle}</td><td className="px-3 py-1">{x.eingefuegt}</td><td className="px-3 py-1">{x.vorhanden}</td><td className="px-3 py-1">{x.fehlgeschlagen || ''}</td></tr>
        ))}
      </Tabelle>
      {bericht.hinweise.map((h) => <p key={h} role="status" className="rounded-md border border-sky-200 bg-sky-50 p-2 text-sky-900">{h}</p>)}
      {bericht.fehler.length > 0 && (
        <details className="rounded-md border border-amber-200 bg-amber-50 p-2">
          <summary>{t('{n} Hinweise (z. B. Konflikte mit neueren Daten)', { n: bericht.fehler.length })}</summary>
          <ul className="mt-1 list-disc pl-5 font-mono text-xs">{bericht.fehler.slice(0, 50).map((f) => <li key={f}>{f}</li>)}</ul>
        </details>
      )}
    </div>
  )
}
