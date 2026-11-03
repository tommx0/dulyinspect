// Rahmen der App: Menü, Kopf- und Fußzeile, Sprache, Datum, allgemeine Knöpfe und Fehlermeldungen
export const ALLGEMEIN: Record<string, string> = {
  'Abmelden': 'Log out',
  'Startseite': 'Home',
  'Menü': 'Menu',
  'Hauptmenü': 'Main menu',
  'Sprache': 'Language',
  'Automatisch': 'Automatic',
  'Impressum': 'Legal notice',
  'Datenschutz': 'Privacy',
  'Lizenz': 'Licence',
  'Lizenzbedingungen': 'Licence terms',
  'Bedienungsanleitung': 'User guide',
  // Hinweis des Einzel-Images in konfig.js (anlagenpruefung-einzel: common.sh)
  'Steht im Datenordner des Containers in der Datei SETUP_KEY.txt und im Protokoll des Containers.': 'Found in the file SETUP_KEY.txt in the container\'s data folder and in the container log.',
  'Keine Berechtigung für diese Aktion.': 'You are not allowed to do this.',
  'Dieser Eintrag existiert bereits.': 'This entry already exists.',
  'Der Eintrag wird noch verwendet und kann nicht gelöscht werden.': 'This entry is still in use and cannot be deleted.',
}
