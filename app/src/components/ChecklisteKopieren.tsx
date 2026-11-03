import { Formular } from './Formular'
import { Dialog } from './ui'
import { checklisteDuplizieren } from '../lib/checklisteKopie'
import { fehlertext } from '../lib/supabase'
import { t } from '../lib/sprache'

/** Dialog „Checkliste duplizieren“: fragt den Namen der Kopie und legt sie als Entwurf an. */
export function ChecklisteKopieren({ quelle, onSchliessen, onFertig }: {
  quelle: { id: string; name: string; versionId?: string } | null
  onSchliessen: () => void
  onFertig: (neueId: string) => void
}) {
  return (
    <Dialog offen={!!quelle} titel={t('Checkliste duplizieren')} onSchliessen={onSchliessen}>
      {quelle && (
        <>
          <p className="mb-3 text-sm text-slate-600">
            {t('Die Kopie enthält alle Prüfpunkte von „{name}“ und startet als Entwurf. Sie wird erst nach der Freigabe zum Prüfen verwendet.', { name: quelle.name })}
          </p>
          <Formular
            simulation
            felder={[{ name: 'name', label: t('Name der Kopie'), pflicht: true, breit: true }]}
            start={{ name: t('{name} (Kopie)', { name: quelle.name }) }}
            onAbbrechen={onSchliessen}
            onSpeichern={async (w) => {
              try {
                onFertig(await checklisteDuplizieren(quelle.id, String(w.name), quelle.versionId))
              } catch (e) {
                return fehlertext(e)
              }
            }}
          />
        </>
      )}
    </Dialog>
  )
}
