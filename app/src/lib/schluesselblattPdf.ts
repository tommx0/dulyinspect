// Schlüsselblatt als PDF (docs/KONZEPT-VERSCHLUESSELUNG.md, „Schlüsselblatt“): Name der Instanz, Schlüssel-ID, Datum, QR-Code und
// der Schlüssel als Text zum Abtippen, dazu der Hinweis zur Aufbewahrung. Entsteht im Browser und wird direkt heruntergeladen –
// der Schlüssel verlässt das Gerät nicht (kein Server, kein Log).
import QRCode from 'qrcode'
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces'
import { gebietsschema, t } from './sprache'
import type { Schluesselblatt } from './verschluesselung'

// Das Blatt druckt der Admin für sich: in der Sprache der Oberfläche (die App lädt nach dem Umschalten neu)
export const BLATT_HINWEIS = t('Wer dieses Blatt hat und Zugang zur App, kann Kunden, Objekte, Fotos, Unterschriften und Protokolle lesen. Verschlossen aufbewahren. Ohne dieses Blatt sind diese Daten bei Verlust aller Geräte nicht mehr lesbar.')

export interface BlattOptionen {
  /** Name der Instanz (App-Name) */
  instanz: string
  /** „Schlüsseltausch“: neues Blatt, das das bisherige ersetzt */
  tausch?: boolean
  /** Zeitpunkt (für Tests festlegbar) */
  jetzt?: Date
}

/** „Schlüsselblatt“ als Überschrift (das Wörterbuch hat es klein für Sätze: „key sheet“) */
const titel = () => { const x = t('Schlüsselblatt'); return x.charAt(0).toUpperCase() + x.slice(1) }

/** Schlüssel in vier Zeilen: 13 Gruppen à 4 Zeichen (4 + 3 + 3 + 3) */
export function textZeilen(text: string): string[] {
  const gruppen = text.trim().split(/\s+/).filter(Boolean)
  const zeilen: string[] = []
  for (let i = 0; i < gruppen.length; i += 4) zeilen.push(gruppen.slice(i, i + 4).join('  '))
  return zeilen
}

/** Dokumentdefinition für pdfmake (reine Funktion, testbar ohne Browser). `qrBild` ist der QR-Code als data:-URL. */
export function blattDokument(blatt: Schluesselblatt, qrBild: string, o: BlattOptionen): TDocumentDefinitions {
  const datum = (o.jetzt ?? new Date()).toLocaleDateString(gebietsschema(), { day: '2-digit', month: 'long', year: 'numeric' })
  const inhalt: Content[] = [
    { text: o.tausch ? t('Schlüsselblatt (neuer Schlüssel)') : titel(), fontSize: 22, bold: true, margin: [0, 0, 0, 4] },
    { text: o.instanz, fontSize: 13, color: '#334155', margin: [0, 0, 0, 14] },
    {
      table: {
        widths: ['auto', '*'],
        body: [
          [{ text: t('Schlüssel-ID'), color: '#64748b' }, { text: blatt.schluesselId, font: 'Roboto', bold: true }],
          [{ text: t('Erstellt am'), color: '#64748b' }, datum],
        ],
      },
      layout: 'noBorders', margin: [0, 0, 0, 16],
    },
    {
      table: {
        widths: ['*'],
        body: [[{ text: BLATT_HINWEIS, bold: true, fontSize: 12, color: '#7f1d1d', margin: [8, 8, 8, 8] }]],
      },
      layout: { hLineColor: () => '#b91c1c', vLineColor: () => '#b91c1c', hLineWidth: () => 1.5, vLineWidth: () => 1.5, fillColor: () => '#fef2f2' },
      margin: [0, 0, 0, 18],
    },
    { text: t('1. QR-Code scannen'), bold: true, fontSize: 12, margin: [0, 0, 0, 6] },
    { text: t('Auf jedem Gerät einmal: nach der Anmeldung „Schlüsselblatt scannen“ wählen und den QR-Code in den Rahmen halten.'), margin: [0, 0, 0, 10] },
    { image: qrBild, width: 190, alignment: 'center', margin: [0, 0, 0, 14] },
    { text: t('2. Oder den Schlüssel abtippen'), bold: true, fontSize: 12, margin: [0, 0, 0, 6] },
    { text: t('Falls die Kamera fehlt. Groß- und Kleinschreibung sind egal, die Abstände auch.'), margin: [0, 0, 0, 6] },
    ...textZeilen(blatt.text).map((z): Content => ({ text: z, font: 'Roboto', fontSize: 15, bold: true, margin: [0, 2, 0, 2] })),
    { text: t('Nicht fotografieren und nicht per E-Mail oder Nachrichtendienst weitergeben.'), color: '#64748b', fontSize: 9, margin: [0, 22, 0, 0] },
  ]
  return { pageSize: 'A4', pageMargins: [56, 56, 56, 56], content: inhalt, defaultStyle: { fontSize: 11 }, info: { title: titel() } }
}

/** PDF erzeugen (pdfmake und Schriften erst jetzt laden) und als Blob zurückgeben. */
export async function blattPdf(blatt: Schluesselblatt, o: BlattOptionen): Promise<Blob> {
  const qrBild = await QRCode.toDataURL(blatt.qr, { margin: 1, errorCorrectionLevel: 'M', width: 600 })
  const [{ default: pdfMake }, { default: vfs }] = await Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')])
  pdfMake.addVirtualFileSystem(vfs)
  return pdfMake.createPdf(blattDokument(blatt, qrBild, o)).getBlob()
}

/** Dateiname des Schlüsselblatts */
export function blattDateiname(blatt: Schluesselblatt): string {
  return `Schluesselblatt_${blatt.schluesselId}.pdf`
}
