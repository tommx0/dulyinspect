
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "anlage": {
                  Row: {
                    "anlagentyp_id": string,"baujahr": number | null,"eigenschaften": NonNullable<Json>,"erstellt_am": string,"erstellt_von": string | null,"etage": string | null,"etikett_id": string | null,"geaendert_am": string,"gebaeude": string | null,"hersteller": string | null,"id": string,"kunden_bezeichnung": string | null,"lage_beschreibung": string | null,"letzte_pruefung_am": string | null,"letztes_ergebnis": Database["public"]['Enums']["ampel"] | null,"modell": string | null,"naechste_pruefung_am": string | null,"objekt_id": string,"raum": string | null,"status": Database["public"]['Enums']["anlage_status"],"teil_von_id": string | null
                  }
                  Insert: {
                    "anlagentyp_id": string,"baujahr"?: number | null,"eigenschaften"?: NonNullable<Json>,"erstellt_am"?: string,"erstellt_von"?: string | null,"etage"?: string | null,"etikett_id"?: string | null,"geaendert_am"?: string,"gebaeude"?: string | null,"hersteller"?: string | null,"id"?: string,"kunden_bezeichnung"?: string | null,"lage_beschreibung"?: string | null,"letzte_pruefung_am"?: string | null,"letztes_ergebnis"?: Database["public"]['Enums']["ampel"] | null,"modell"?: string | null,"naechste_pruefung_am"?: string | null,"objekt_id": string,"raum"?: string | null,"status"?: Database["public"]['Enums']["anlage_status"],"teil_von_id"?: string | null
                  }
                  Update: {
                    "anlagentyp_id"?: string,"baujahr"?: number | null,"eigenschaften"?: NonNullable<Json>,"erstellt_am"?: string,"erstellt_von"?: string | null,"etage"?: string | null,"etikett_id"?: string | null,"geaendert_am"?: string,"gebaeude"?: string | null,"hersteller"?: string | null,"id"?: string,"kunden_bezeichnung"?: string | null,"lage_beschreibung"?: string | null,"letzte_pruefung_am"?: string | null,"letztes_ergebnis"?: Database["public"]['Enums']["ampel"] | null,"modell"?: string | null,"naechste_pruefung_am"?: string | null,"objekt_id"?: string,"raum"?: string | null,"status"?: Database["public"]['Enums']["anlage_status"],"teil_von_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "anlage_anlagentyp_id_fkey"
      columns: ["anlagentyp_id"]
isOneToOne: false
      referencedRelation: "anlagentyp"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "anlage_erstellt_von_fkey"
      columns: ["erstellt_von"]
isOneToOne: false
      referencedRelation: "benutzer"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "anlage_etikett_id_fkey"
      columns: ["etikett_id"]
isOneToOne: true
      referencedRelation: "etikett"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "anlage_objekt_id_fkey"
      columns: ["objekt_id"]
isOneToOne: false
      referencedRelation: "objekt"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "anlage_teil_von_id_fkey"
      columns: ["teil_von_id"]
isOneToOne: false
      referencedRelation: "anlage"
      referencedColumns: ["id"]
    }
                  ]
                },"anlage_element": {
                  Row: {
                    "aktiv": boolean,"anlage_id": string,"code": string | null,"eigenschaften": NonNullable<Json>,"elementart": string | null,"erstellt_am": string,"erstellt_von": string | null,"geaendert_am": string,"geprueft_je_pruefart": NonNullable<Json>,"gruppe": string | null,"id": string,"nummer": string,"ort": string | null,"typ": string | null,"zuletzt_geprueft_am": string | null
                  }
                  Insert: {
                    "aktiv"?: boolean,"anlage_id": string,"code"?: string | null,"eigenschaften"?: NonNullable<Json>,"elementart"?: string | null,"erstellt_am"?: string,"erstellt_von"?: string | null,"geaendert_am"?: string,"geprueft_je_pruefart"?: NonNullable<Json>,"gruppe"?: string | null,"id"?: string,"nummer": string,"ort"?: string | null,"typ"?: string | null,"zuletzt_geprueft_am"?: string | null
                  }
                  Update: {
                    "aktiv"?: boolean,"anlage_id"?: string,"code"?: string | null,"eigenschaften"?: NonNullable<Json>,"elementart"?: string | null,"erstellt_am"?: string,"erstellt_von"?: string | null,"geaendert_am"?: string,"geprueft_je_pruefart"?: NonNullable<Json>,"gruppe"?: string | null,"id"?: string,"nummer"?: string,"ort"?: string | null,"typ"?: string | null,"zuletzt_geprueft_am"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "anlage_element_anlage_id_fkey"
      columns: ["anlage_id"]
isOneToOne: false
      referencedRelation: "anlage"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "anlage_element_erstellt_von_fkey"
      columns: ["erstellt_von"]
isOneToOne: false
      referencedRelation: "benutzer"
      referencedColumns: ["id"]
    }
                  ]
                },"anlage_faelligkeit": {
                  Row: {
                    "anlage_id": string,"geaendert_am": string,"intervall_monate": number | null,"letzte_pruefung_am": string | null,"letztes_ergebnis": Database["public"]['Enums']["ampel"] | null,"naechste_pruefung_am": string | null,"pruefart_id": string
                  }
                  Insert: {
                    "anlage_id": string,"geaendert_am"?: string,"intervall_monate"?: number | null,"letzte_pruefung_am"?: string | null,"letztes_ergebnis"?: Database["public"]['Enums']["ampel"] | null,"naechste_pruefung_am"?: string | null,"pruefart_id": string
                  }
                  Update: {
                    "anlage_id"?: string,"geaendert_am"?: string,"intervall_monate"?: number | null,"letzte_pruefung_am"?: string | null,"letztes_ergebnis"?: Database["public"]['Enums']["ampel"] | null,"naechste_pruefung_am"?: string | null,"pruefart_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "anlage_faelligkeit_anlage_id_fkey"
      columns: ["anlage_id"]
isOneToOne: false
      referencedRelation: "anlage"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "anlage_faelligkeit_pruefart_id_fkey"
      columns: ["pruefart_id"]
isOneToOne: false
      referencedRelation: "pruefart"
      referencedColumns: ["id"]
    }
                  ]
                },"anlage_gruppe": {
                  Row: {
                    "anlage_id": string,"erstellt_am": string,"erstellt_von": string | null,"etage": string | null,"geaendert_am": string,"gebaeude": string | null,"id": string,"name": string
                  }
                  Insert: {
                    "anlage_id": string,"erstellt_am"?: string,"erstellt_von"?: string | null,"etage"?: string | null,"geaendert_am"?: string,"gebaeude"?: string | null,"id"?: string,"name": string
                  }
                  Update: {
                    "anlage_id"?: string,"erstellt_am"?: string,"erstellt_von"?: string | null,"etage"?: string | null,"geaendert_am"?: string,"gebaeude"?: string | null,"id"?: string,"name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "anlage_gruppe_anlage_id_fkey"
      columns: ["anlage_id"]
isOneToOne: false
      referencedRelation: "anlage"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "anlage_gruppe_erstellt_von_fkey"
      columns: ["erstellt_von"]
isOneToOne: false
      referencedRelation: "benutzer"
      referencedColumns: ["id"]
    }
                  ]
                },"anlagenart": {
                  Row: {
                    "aktiv": boolean,"geaendert_am": string,"name": string,"reihenfolge": number,"sachkunde_pflicht": boolean,"schluessel": string
                  }
                  Insert: {
                    "aktiv"?: boolean,"geaendert_am"?: string,"name": string,"reihenfolge"?: number,"sachkunde_pflicht"?: boolean,"schluessel": string
                  }
                  Update: {
                    "aktiv"?: boolean,"geaendert_am"?: string,"name"?: string,"reihenfolge"?: number,"sachkunde_pflicht"?: boolean,"schluessel"?: string
                  }
                  Relationships: [
                    
                  ]
                },"anlagenpruefung": {
                  Row: {
                    "abgeschlossen_am": string | null,"altmaengel": NonNullable<Json>,"anlage_id": string,"beendet_am": string | null,"begonnen_am": string,"checkliste_version_id": string | null,"duplikat_geklaert": boolean,"duplikat_von": string | null,"erfasst_offline": boolean,"erfassung": Database["public"]['Enums']["erfassung"],"ergebnis": Database["public"]['Enums']["ampel"] | null,"ergebnis_auto": Database["public"]['Enums']["ampel"] | null,"ergebnis_begruendung": string | null,"erstellt_am": string,"geaendert_am": string,"id": string,"kunde_name": string | null,"kunde_unterschrift": string | null,"kunde_unterschrift_am": string | null,"letzte_aktivitaet": string,"nicht_geprueft_grund": string | null,"protokoll_nr": string | null,"pruefart_id": string,"pruefer_id": string,"revision": number,"session_id": string | null,"status": Database["public"]['Enums']["pruefung_status"],"teil_von_id": string | null,"uebernommen_am": string | null,"unterschrift": string | null,"unterschrift_am": string | null,"urspruenglicher_pruefer_id": string | null
                  }
                  Insert: {
                    "abgeschlossen_am"?: string | null,"altmaengel"?: NonNullable<Json>,"anlage_id": string,"beendet_am"?: string | null,"begonnen_am"?: string,"checkliste_version_id"?: string | null,"duplikat_geklaert"?: boolean,"duplikat_von"?: string | null,"erfasst_offline"?: boolean,"erfassung": Database["public"]['Enums']["erfassung"],"ergebnis"?: Database["public"]['Enums']["ampel"] | null,"ergebnis_auto"?: Database["public"]['Enums']["ampel"] | null,"ergebnis_begruendung"?: string | null,"erstellt_am"?: string,"geaendert_am"?: string,"id"?: string,"kunde_name"?: string | null,"kunde_unterschrift"?: string | null,"kunde_unterschrift_am"?: string | null,"letzte_aktivitaet"?: string,"nicht_geprueft_grund"?: string | null,"protokoll_nr"?: string | null,"pruefart_id": string,"pruefer_id": string,"revision"?: number,"session_id"?: string | null,"status"?: Database["public"]['Enums']["pruefung_status"],"teil_von_id"?: string | null,"uebernommen_am"?: string | null,"unterschrift"?: string | null,"unterschrift_am"?: string | null,"urspruenglicher_pruefer_id"?: string | null
                  }
                  Update: {
                    "abgeschlossen_am"?: string | null,"altmaengel"?: NonNullable<Json>,"anlage_id"?: string,"beendet_am"?: string | null,"begonnen_am"?: string,"checkliste_version_id"?: string | null,"duplikat_geklaert"?: boolean,"duplikat_von"?: string | null,"erfasst_offline"?: boolean,"erfassung"?: Database["public"]['Enums']["erfassung"],"ergebnis"?: Database["public"]['Enums']["ampel"] | null,"ergebnis_auto"?: Database["public"]['Enums']["ampel"] | null,"ergebnis_begruendung"?: string | null,"erstellt_am"?: string,"geaendert_am"?: string,"id"?: string,"kunde_name"?: string | null,"kunde_unterschrift"?: string | null,"kunde_unterschrift_am"?: string | null,"letzte_aktivitaet"?: string,"nicht_geprueft_grund"?: string | null,"protokoll_nr"?: string | null,"pruefart_id"?: string,"pruefer_id"?: string,"revision"?: number,"session_id"?: string | null,"status"?: Database["public"]['Enums']["pruefung_status"],"teil_von_id"?: string | null,"uebernommen_am"?: string | null,"unterschrift"?: string | null,"unterschrift_am"?: string | null,"urspruenglicher_pruefer_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "anlagenpruefung_anlage_id_fkey"
      columns: ["anlage_id"]
isOneToOne: false
      referencedRelation: "anlage"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "anlagenpruefung_checkliste_version_id_fkey"
      columns: ["checkliste_version_id"]
isOneToOne: false
      referencedRelation: "checkliste_version"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "anlagenpruefung_duplikat_von_fkey"
      columns: ["duplikat_von"]
isOneToOne: false
      referencedRelation: "anlagenpruefung"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "anlagenpruefung_pruefart_id_fkey"
      columns: ["pruefart_id"]
isOneToOne: false
      referencedRelation: "pruefart"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "anlagenpruefung_pruefer_id_fkey"
      columns: ["pruefer_id"]
isOneToOne: false
      referencedRelation: "benutzer"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "anlagenpruefung_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "session"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "anlagenpruefung_teil_von_id_fkey"
      columns: ["teil_von_id"]
isOneToOne: false
      referencedRelation: "anlagenpruefung"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "anlagenpruefung_urspruenglicher_pruefer_id_fkey"
      columns: ["urspruenglicher_pruefer_id"]
isOneToOne: false
      referencedRelation: "benutzer"
      referencedColumns: ["id"]
    }
                  ]
                },"anlagenpruefung_aenderung": {
                  Row: {
                    "aktion": string,"alt": Json | null,"am": string,"anlagenpruefung_id": string,"datensatz_id": string,"id": string,"neu": Json | null,"revision": number,"tabelle": string,"von": string | null
                  }
                  Insert: {
                    "aktion": string,"alt"?: Json | null,"am"?: string,"anlagenpruefung_id": string,"datensatz_id": string,"id"?: string,"neu"?: Json | null,"revision": number,"tabelle": string,"von"?: string | null
                  }
                  Update: {
                    "aktion"?: string,"alt"?: Json | null,"am"?: string,"anlagenpruefung_id"?: string,"datensatz_id"?: string,"id"?: string,"neu"?: Json | null,"revision"?: number,"tabelle"?: string,"von"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "anlagenpruefung_aenderung_anlagenpruefung_id_fkey"
      columns: ["anlagenpruefung_id"]
isOneToOne: false
      referencedRelation: "anlagenpruefung"
      referencedColumns: ["id"]
    }
                  ]
                },"anlagenpruefung_freigabe": {
                  Row: {
                    "am": string,"anlage_id": string,"freigegeben_von": string,"id": string,"pruefer_id": string,"session_id": string | null
                  }
                  Insert: {
                    "am"?: string,"anlage_id": string,"freigegeben_von"?: string,"id": string,"pruefer_id": string,"session_id"?: string | null
                  }
                  Update: {
                    "am"?: string,"anlage_id"?: string,"freigegeben_von"?: string,"id"?: string,"pruefer_id"?: string,"session_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "anlagenpruefung_freigabe_anlage_id_fkey"
      columns: ["anlage_id"]
isOneToOne: false
      referencedRelation: "anlage"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "anlagenpruefung_freigabe_freigegeben_von_fkey"
      columns: ["freigegeben_von"]
isOneToOne: false
      referencedRelation: "benutzer"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "anlagenpruefung_freigabe_pruefer_id_fkey"
      columns: ["pruefer_id"]
isOneToOne: false
      referencedRelation: "benutzer"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "anlagenpruefung_freigabe_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "session"
      referencedColumns: ["id"]
    }
                  ]
                },"anlagenpruefung_mitpruefer": {
                  Row: {
                    "angefragt_am": string,"anlagenpruefung_id": string,"benutzer_id": string,"entschieden_am": string | null,"fertig_am": string | null,"session_id": string | null,"status": string,"unterschrift": string | null
                  }
                  Insert: {
                    "angefragt_am"?: string,"anlagenpruefung_id": string,"benutzer_id": string,"entschieden_am"?: string | null,"fertig_am"?: string | null,"session_id"?: string | null,"status"?: string,"unterschrift"?: string | null
                  }
                  Update: {
                    "angefragt_am"?: string,"anlagenpruefung_id"?: string,"benutzer_id"?: string,"entschieden_am"?: string | null,"fertig_am"?: string | null,"session_id"?: string | null,"status"?: string,"unterschrift"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "anlagenpruefung_mitpruefer_anlagenpruefung_id_fkey"
      columns: ["anlagenpruefung_id"]
isOneToOne: false
      referencedRelation: "anlagenpruefung"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "anlagenpruefung_mitpruefer_benutzer_id_fkey"
      columns: ["benutzer_id"]
isOneToOne: false
      referencedRelation: "benutzer"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "anlagenpruefung_mitpruefer_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "session"
      referencedColumns: ["id"]
    }
                  ]
                },"anlagenpruefung_revision": {
                  Row: {
                    "am": string,"anlagenpruefung_id": string,"grund": string,"revision": number,"von": string
                  }
                  Insert: {
                    "am"?: string,"anlagenpruefung_id": string,"grund": string,"revision": number,"von"?: string
                  }
                  Update: {
                    "am"?: string,"anlagenpruefung_id"?: string,"grund"?: string,"revision"?: number,"von"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "anlagenpruefung_revision_anlagenpruefung_id_fkey"
      columns: ["anlagenpruefung_id"]
isOneToOne: false
      referencedRelation: "anlagenpruefung"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "anlagenpruefung_revision_von_fkey"
      columns: ["von"]
isOneToOne: false
      referencedRelation: "benutzer"
      referencedColumns: ["id"]
    }
                  ]
                },"anlagentyp": {
                  Row: {
                    "aktiv": boolean,"anlagenart": string,"erstellt_am": string,"erstellt_von": string | null,"geaendert_am": string,"id": string,"kategorie": Database["public"]['Enums']["tuer_kategorie"] | null,"mehrpersonenpruefung": boolean,"name": string
                  }
                  Insert: {
                    "aktiv"?: boolean,"anlagenart"?: string,"erstellt_am"?: string,"erstellt_von"?: string | null,"geaendert_am"?: string,"id"?: string,"kategorie"?: Database["public"]['Enums']["tuer_kategorie"] | null,"mehrpersonenpruefung"?: boolean,"name": string
                  }
                  Update: {
                    "aktiv"?: boolean,"anlagenart"?: string,"erstellt_am"?: string,"erstellt_von"?: string | null,"geaendert_am"?: string,"id"?: string,"kategorie"?: Database["public"]['Enums']["tuer_kategorie"] | null,"mehrpersonenpruefung"?: boolean,"name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "anlagentyp_anlagenart_fkey"
      columns: ["anlagenart"]
isOneToOne: false
      referencedRelation: "anlagenart"
      referencedColumns: ["schluessel"]
    },{
      foreignKeyName: "anlagentyp_erstellt_von_fkey"
      columns: ["erstellt_von"]
isOneToOne: false
      referencedRelation: "benutzer"
      referencedColumns: ["id"]
    }
                  ]
                },"antwort": {
                  Row: {
                    "anlagenpruefung_id": string,"bemerkung": string | null,"erfasst_von": string | null,"erstellt_am": string,"geaendert_am": string,"id": string,"punkt_id": string,"status": Database["public"]['Enums']["antwort_status"] | null,"text": string | null,"zahl": number | null
                  }
                  Insert: {
                    "anlagenpruefung_id": string,"bemerkung"?: string | null,"erfasst_von"?: string | null,"erstellt_am"?: string,"geaendert_am"?: string,"id"?: string,"punkt_id": string,"status"?: Database["public"]['Enums']["antwort_status"] | null,"text"?: string | null,"zahl"?: number | null
                  }
                  Update: {
                    "anlagenpruefung_id"?: string,"bemerkung"?: string | null,"erfasst_von"?: string | null,"erstellt_am"?: string,"geaendert_am"?: string,"id"?: string,"punkt_id"?: string,"status"?: Database["public"]['Enums']["antwort_status"] | null,"text"?: string | null,"zahl"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "antwort_anlagenpruefung_id_fkey"
      columns: ["anlagenpruefung_id"]
isOneToOne: false
      referencedRelation: "anlagenpruefung"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "antwort_erfasst_von_fkey"
      columns: ["erfasst_von"]
isOneToOne: false
      referencedRelation: "benutzer"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_log": {
                  Row: {
                    "aktion": string,"alt": Json | null,"benutzer_id": string | null,"datensatz_id": string,"id": number,"neu": Json | null,"tabelle": string,"zeitpunkt": string
                  }
                  Insert: {
                    "aktion": string,"alt"?: Json | null,"benutzer_id"?: string | null,"datensatz_id": string,"id"?: never,"neu"?: Json | null,"tabelle": string,"zeitpunkt"?: string
                  }
                  Update: {
                    "aktion"?: string,"alt"?: Json | null,"benutzer_id"?: string | null,"datensatz_id"?: string,"id"?: never,"neu"?: Json | null,"tabelle"?: string,"zeitpunkt"?: string
                  }
                  Relationships: [
                    
                  ]
                },"benutzer": {
                  Row: {
                    "aktiv": boolean,"aktiv_bis": string | null,"email": string,"erstellt_am": string,"geaendert_am": string,"id": string,"name": string,"rolle": Database["public"]['Enums']["rolle"],"sachkunde_hinweis": string | null,"support": boolean,"zwei_faktor": boolean
                  }
                  Insert: {
                    "aktiv"?: boolean,"aktiv_bis"?: string | null,"email": string,"erstellt_am"?: string,"geaendert_am"?: string,"id": string,"name"?: string,"rolle"?: Database["public"]['Enums']["rolle"],"sachkunde_hinweis"?: string | null,"support"?: boolean,"zwei_faktor"?: boolean
                  }
                  Update: {
                    "aktiv"?: boolean,"aktiv_bis"?: string | null,"email"?: string,"erstellt_am"?: string,"geaendert_am"?: string,"id"?: string,"name"?: string,"rolle"?: Database["public"]['Enums']["rolle"],"sachkunde_hinweis"?: string | null,"support"?: boolean,"zwei_faktor"?: boolean
                  }
                  Relationships: [
                    
                  ]
                },"benutzer_sachkunde": {
                  Row: {
                    "anlagenart": string,"benutzer_id": string,"datei_name": string | null,"datei_pfad": string | null,"geaendert_am": string,"gueltig_bis": string | null,"nachweis": string
                  }
                  Insert: {
                    "anlagenart": string,"benutzer_id": string,"datei_name"?: string | null,"datei_pfad"?: string | null,"geaendert_am"?: string,"gueltig_bis"?: string | null,"nachweis": string
                  }
                  Update: {
                    "anlagenart"?: string,"benutzer_id"?: string,"datei_name"?: string | null,"datei_pfad"?: string | null,"geaendert_am"?: string,"gueltig_bis"?: string | null,"nachweis"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "benutzer_sachkunde_anlagenart_fkey"
      columns: ["anlagenart"]
isOneToOne: false
      referencedRelation: "anlagenart"
      referencedColumns: ["schluessel"]
    },{
      foreignKeyName: "benutzer_sachkunde_benutzer_id_fkey"
      columns: ["benutzer_id"]
isOneToOne: false
      referencedRelation: "benutzer"
      referencedColumns: ["id"]
    }
                  ]
                },"checkliste": {
                  Row: {
                    "aktiv": boolean,"beschreibung": string | null,"erstellt_am": string,"erstellt_von": string | null,"geaendert_am": string,"id": string,"name": string
                  }
                  Insert: {
                    "aktiv"?: boolean,"beschreibung"?: string | null,"erstellt_am"?: string,"erstellt_von"?: string | null,"geaendert_am"?: string,"id"?: string,"name": string
                  }
                  Update: {
                    "aktiv"?: boolean,"beschreibung"?: string | null,"erstellt_am"?: string,"erstellt_von"?: string | null,"geaendert_am"?: string,"id"?: string,"name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "checkliste_erstellt_von_fkey"
      columns: ["erstellt_von"]
isOneToOne: false
      referencedRelation: "benutzer"
      referencedColumns: ["id"]
    }
                  ]
                },"checkliste_version": {
                  Row: {
                    "abschnitte": NonNullable<Json>,"checkliste_id": string,"erstellt_am": string,"erstellt_von": string | null,"freigegeben_am": string | null,"freigegeben_von": string | null,"geaendert_am": string,"id": string,"punkte": NonNullable<Json>,"status": Database["public"]['Enums']["version_status"],"version": number
                  }
                  Insert: {
                    "abschnitte"?: NonNullable<Json>,"checkliste_id": string,"erstellt_am"?: string,"erstellt_von"?: string | null,"freigegeben_am"?: string | null,"freigegeben_von"?: string | null,"geaendert_am"?: string,"id"?: string,"punkte"?: NonNullable<Json>,"status"?: Database["public"]['Enums']["version_status"],"version": number
                  }
                  Update: {
                    "abschnitte"?: NonNullable<Json>,"checkliste_id"?: string,"erstellt_am"?: string,"erstellt_von"?: string | null,"freigegeben_am"?: string | null,"freigegeben_von"?: string | null,"geaendert_am"?: string,"id"?: string,"punkte"?: NonNullable<Json>,"status"?: Database["public"]['Enums']["version_status"],"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "checkliste_version_checkliste_id_fkey"
      columns: ["checkliste_id"]
isOneToOne: false
      referencedRelation: "checkliste"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checkliste_version_erstellt_von_fkey"
      columns: ["erstellt_von"]
isOneToOne: false
      referencedRelation: "benutzer"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checkliste_version_freigegeben_von_fkey"
      columns: ["freigegeben_von"]
isOneToOne: false
      referencedRelation: "benutzer"
      referencedColumns: ["id"]
    }
                  ]
                },"element_ergebnis": {
                  Row: {
                    "anlagenpruefung_id": string,"bemerkung": string | null,"element_id": string,"erfasst_von": string | null,"erstellt_am": string,"geaendert_am": string,"grund": string | null,"id": string,"mangel_id": string | null,"messwerte": NonNullable<Json>,"status": string
                  }
                  Insert: {
                    "anlagenpruefung_id": string,"bemerkung"?: string | null,"element_id": string,"erfasst_von"?: string | null,"erstellt_am"?: string,"geaendert_am"?: string,"grund"?: string | null,"id"?: string,"mangel_id"?: string | null,"messwerte"?: NonNullable<Json>,"status": string
                  }
                  Update: {
                    "anlagenpruefung_id"?: string,"bemerkung"?: string | null,"element_id"?: string,"erfasst_von"?: string | null,"erstellt_am"?: string,"geaendert_am"?: string,"grund"?: string | null,"id"?: string,"mangel_id"?: string | null,"messwerte"?: NonNullable<Json>,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "element_ergebnis_anlagenpruefung_id_fkey"
      columns: ["anlagenpruefung_id"]
isOneToOne: false
      referencedRelation: "anlagenpruefung"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "element_ergebnis_element_id_fkey"
      columns: ["element_id"]
isOneToOne: false
      referencedRelation: "anlage_element"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "element_ergebnis_erfasst_von_fkey"
      columns: ["erfasst_von"]
isOneToOne: false
      referencedRelation: "benutzer"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "element_ergebnis_mangel_id_fkey"
      columns: ["mangel_id"]
isOneToOne: false
      referencedRelation: "mangel"
      referencedColumns: ["id"]
    }
                  ]
                },"endkunde": {
                  Row: {
                    "aktiv": boolean,"ansprechpartner": string | null,"email": string | null,"erstellt_am": string,"erstellt_von": string | null,"geaendert_am": string,"id": string,"name": string,"notiz": string | null,"ort": string | null,"plz": string | null,"strasse": string | null,"telefon": string | null
                  }
                  Insert: {
                    "aktiv"?: boolean,"ansprechpartner"?: string | null,"email"?: string | null,"erstellt_am"?: string,"erstellt_von"?: string | null,"geaendert_am"?: string,"id"?: string,"name": string,"notiz"?: string | null,"ort"?: string | null,"plz"?: string | null,"strasse"?: string | null,"telefon"?: string | null
                  }
                  Update: {
                    "aktiv"?: boolean,"ansprechpartner"?: string | null,"email"?: string | null,"erstellt_am"?: string,"erstellt_von"?: string | null,"geaendert_am"?: string,"id"?: string,"name"?: string,"notiz"?: string | null,"ort"?: string | null,"plz"?: string | null,"strasse"?: string | null,"telefon"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "endkunde_erstellt_von_fkey"
      columns: ["erstellt_von"]
isOneToOne: false
      referencedRelation: "benutzer"
      referencedColumns: ["id"]
    }
                  ]
                },"erscheinungsbild": {
                  Row: {
                    "app_name": string | null,"farbe_akzent": string | null,"farbe_marke": string | null,"geaendert_am": string,"id": number,"logo_pdf_pfad": string | null,"logo_pfad": string | null
                  }
                  Insert: {
                    "app_name"?: string | null,"farbe_akzent"?: string | null,"farbe_marke"?: string | null,"geaendert_am"?: string,"id"?: number,"logo_pdf_pfad"?: string | null,"logo_pfad"?: string | null
                  }
                  Update: {
                    "app_name"?: string | null,"farbe_akzent"?: string | null,"farbe_marke"?: string | null,"geaendert_am"?: string,"id"?: number,"logo_pdf_pfad"?: string | null,"logo_pfad"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"etikett": {
                  Row: {
                    "anlage_id": string | null,"charge": string,"erstellt_am": string,"id": string,"zugeordnet_am": string | null
                  }
                  Insert: {
                    "anlage_id"?: string | null,"charge": string,"erstellt_am"?: string,"id": string,"zugeordnet_am"?: string | null
                  }
                  Update: {
                    "anlage_id"?: string | null,"charge"?: string,"erstellt_am"?: string,"id"?: string,"zugeordnet_am"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "etikett_anlage_fk"
      columns: ["anlage_id"]
isOneToOne: true
      referencedRelation: "anlage"
      referencedColumns: ["id"]
    }
                  ]
                },"firma": {
                  Row: {
                    "blatt_beschriftung_breite": number,"blatt_ergebnis_breite": number,"datenschutz": string | null,"datenschutz_format": string,"email": string | null,"etikett_praefix": string,"geaendert_am": string,"id": number,"impressum": string | null,"impressum_format": string,"inbetriebnahme": NonNullable<Json>,"kundendaten_geloescht_am": string | null,"mandantencode": string,"name": string,"ort": string | null,"plz": string | null,"protokoll_hinweis": string | null,"protokoll_sprache": string,"pruef_ansicht": string,"strasse": string | null,"telefon": string | null,"web": string | null,"zusatz": string | null
                  }
                  Insert: {
                    "blatt_beschriftung_breite"?: number,"blatt_ergebnis_breite"?: number,"datenschutz"?: string | null,"datenschutz_format"?: string,"email"?: string | null,"etikett_praefix"?: string,"geaendert_am"?: string,"id"?: number,"impressum"?: string | null,"impressum_format"?: string,"inbetriebnahme"?: NonNullable<Json>,"kundendaten_geloescht_am"?: string | null,"mandantencode"?: string,"name": string,"ort"?: string | null,"plz"?: string | null,"protokoll_hinweis"?: string | null,"protokoll_sprache"?: string,"pruef_ansicht"?: string,"strasse"?: string | null,"telefon"?: string | null,"web"?: string | null,"zusatz"?: string | null
                  }
                  Update: {
                    "blatt_beschriftung_breite"?: number,"blatt_ergebnis_breite"?: number,"datenschutz"?: string | null,"datenschutz_format"?: string,"email"?: string | null,"etikett_praefix"?: string,"geaendert_am"?: string,"id"?: number,"impressum"?: string | null,"impressum_format"?: string,"inbetriebnahme"?: NonNullable<Json>,"kundendaten_geloescht_am"?: string | null,"mandantencode"?: string,"name"?: string,"ort"?: string | null,"plz"?: string | null,"protokoll_hinweis"?: string | null,"protokoll_sprache"?: string,"pruef_ansicht"?: string,"strasse"?: string | null,"telefon"?: string | null,"web"?: string | null,"zusatz"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"foto": {
                  Row: {
                    "aufgenommen_am": string,"bezug_id": string,"bezug_typ": Database["public"]['Enums']["foto_bezug"],"erstellt_von": string | null,"id": string,"storage_pfad": string
                  }
                  Insert: {
                    "aufgenommen_am"?: string,"bezug_id": string,"bezug_typ": Database["public"]['Enums']["foto_bezug"],"erstellt_von"?: string | null,"id"?: string,"storage_pfad": string
                  }
                  Update: {
                    "aufgenommen_am"?: string,"bezug_id"?: string,"bezug_typ"?: Database["public"]['Enums']["foto_bezug"],"erstellt_von"?: string | null,"id"?: string,"storage_pfad"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "foto_erstellt_von_fkey"
      columns: ["erstellt_von"]
isOneToOne: false
      referencedRelation: "benutzer"
      referencedColumns: ["id"]
    }
                  ]
                },"lizenz_akzeptanz": {
                  Row: {
                    "akzeptiert_am": string,"benutzer_id": string,"benutzer_name": string,"id": string,"lizenz_stand": string | null,"version": string
                  }
                  Insert: {
                    "akzeptiert_am"?: string,"benutzer_id": string,"benutzer_name": string,"id"?: string,"lizenz_stand"?: string | null,"version": string
                  }
                  Update: {
                    "akzeptiert_am"?: string,"benutzer_id"?: string,"benutzer_name"?: string,"id"?: string,"lizenz_stand"?: string | null,"version"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lizenz_akzeptanz_benutzer_id_fkey"
      columns: ["benutzer_id"]
isOneToOne: false
      referencedRelation: "benutzer"
      referencedColumns: ["id"]
    }
                  ]
                },"log_bezeichnung": {
                  Row: {
                    "spalte": string,"tabelle": string,"text": string
                  }
                  Insert: {
                    "spalte": string,"tabelle": string,"text": string
                  }
                  Update: {
                    "spalte"?: string,"tabelle"?: string,"text"?: string
                  }
                  Relationships: [
                    
                  ]
                },"log_datei": {
                  Row: {
                    "angelegt_am": string,"archiviert_am": string | null,"nr": number
                  }
                  Insert: {
                    "angelegt_am"?: string,"archiviert_am"?: string | null,"nr": number
                  }
                  Update: {
                    "angelegt_am"?: string,"archiviert_am"?: string | null,"nr"?: number
                  }
                  Relationships: [
                    
                  ]
                },"log_zeile": {
                  Row: {
                    "bytes": number | null,"datei": number,"id": number,"zeile": string
                  }
                  Insert: {
                    "bytes"?: never,"datei": number,"id"?: never,"zeile": string
                  }
                  Update: {
                    "bytes"?: never,"datei"?: number,"id"?: never,"zeile"?: string
                  }
                  Relationships: [
                    
                  ]
                },"mail_einstellung": {
                  Row: {
                    "absender_adresse": string | null,"absender_name": string | null,"app_adresse": string | null,"fehler_aktiv": boolean,"geaendert_am": string,"id": number,"meldung_empfaenger": (string)[],"passwort_vergessen": boolean,"quelle": string,"smtp_benutzer": string | null,"smtp_host": string | null,"smtp_port": number | null,"smtp_sicherheit": string,"sofort_schwelle": string,"sofort_ueberfaellig": boolean,"status_aktiv": boolean,"status_empfaenger": (string)[],"status_intervall": string,"status_monatstag": number,"status_uhrzeit": string,"status_wochentag": number,"zuletzt_getestet_am": string | null,"zuletzt_test_ok": boolean | null
                  }
                  Insert: {
                    "absender_adresse"?: string | null,"absender_name"?: string | null,"app_adresse"?: string | null,"fehler_aktiv"?: boolean,"geaendert_am"?: string,"id"?: number,"meldung_empfaenger"?: (string)[],"passwort_vergessen"?: boolean,"quelle"?: string,"smtp_benutzer"?: string | null,"smtp_host"?: string | null,"smtp_port"?: number | null,"smtp_sicherheit"?: string,"sofort_schwelle"?: string,"sofort_ueberfaellig"?: boolean,"status_aktiv"?: boolean,"status_empfaenger"?: (string)[],"status_intervall"?: string,"status_monatstag"?: number,"status_uhrzeit"?: string,"status_wochentag"?: number,"zuletzt_getestet_am"?: string | null,"zuletzt_test_ok"?: boolean | null
                  }
                  Update: {
                    "absender_adresse"?: string | null,"absender_name"?: string | null,"app_adresse"?: string | null,"fehler_aktiv"?: boolean,"geaendert_am"?: string,"id"?: number,"meldung_empfaenger"?: (string)[],"passwort_vergessen"?: boolean,"quelle"?: string,"smtp_benutzer"?: string | null,"smtp_host"?: string | null,"smtp_port"?: number | null,"smtp_sicherheit"?: string,"sofort_schwelle"?: string,"sofort_ueberfaellig"?: boolean,"status_aktiv"?: boolean,"status_empfaenger"?: (string)[],"status_intervall"?: string,"status_monatstag"?: number,"status_uhrzeit"?: string,"status_wochentag"?: number,"zuletzt_getestet_am"?: string | null,"zuletzt_test_ok"?: boolean | null
                  }
                  Relationships: [
                    
                  ]
                },"mangel": {
                  Row: {
                    "anlage_id": string,"behoben_am": string | null,"behoben_notiz": string | null,"beschreibung": string,"element_id": string | null,"entdeckt_in": string,"erfasst_von": string | null,"erstellt_am": string,"erstellt_von": string | null,"geaendert_am": string,"id": string,"nachgeprueft_in": string | null,"punkt_id": string | null,"status": Database["public"]['Enums']["mangel_status"],"stufe": number
                  }
                  Insert: {
                    "anlage_id": string,"behoben_am"?: string | null,"behoben_notiz"?: string | null,"beschreibung": string,"element_id"?: string | null,"entdeckt_in": string,"erfasst_von"?: string | null,"erstellt_am"?: string,"erstellt_von"?: string | null,"geaendert_am"?: string,"id"?: string,"nachgeprueft_in"?: string | null,"punkt_id"?: string | null,"status"?: Database["public"]['Enums']["mangel_status"],"stufe": number
                  }
                  Update: {
                    "anlage_id"?: string,"behoben_am"?: string | null,"behoben_notiz"?: string | null,"beschreibung"?: string,"element_id"?: string | null,"entdeckt_in"?: string,"erfasst_von"?: string | null,"erstellt_am"?: string,"erstellt_von"?: string | null,"geaendert_am"?: string,"id"?: string,"nachgeprueft_in"?: string | null,"punkt_id"?: string | null,"status"?: Database["public"]['Enums']["mangel_status"],"stufe"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "mangel_anlage_id_fkey"
      columns: ["anlage_id"]
isOneToOne: false
      referencedRelation: "anlage"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "mangel_element_id_fkey"
      columns: ["element_id"]
isOneToOne: false
      referencedRelation: "anlage_element"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "mangel_entdeckt_in_fkey"
      columns: ["entdeckt_in"]
isOneToOne: false
      referencedRelation: "anlagenpruefung"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "mangel_erfasst_von_fkey"
      columns: ["erfasst_von"]
isOneToOne: false
      referencedRelation: "benutzer"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "mangel_erstellt_von_fkey"
      columns: ["erstellt_von"]
isOneToOne: false
      referencedRelation: "benutzer"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "mangel_nachgeprueft_in_fkey"
      columns: ["nachgeprueft_in"]
isOneToOne: false
      referencedRelation: "anlagenpruefung"
      referencedColumns: ["id"]
    }
                  ]
                },"menue_pruefer": {
                  Row: {
                    "ausgeblendet": (string)[],"geaendert_am": string,"id": number
                  }
                  Insert: {
                    "ausgeblendet"?: (string)[],"geaendert_am"?: string,"id"?: number
                  }
                  Update: {
                    "ausgeblendet"?: (string)[],"geaendert_am"?: string,"id"?: number
                  }
                  Relationships: [
                    
                  ]
                },"objekt": {
                  Row: {
                    "aktiv": boolean,"endkunde_id": string,"erstellt_am": string,"erstellt_von": string | null,"geaendert_am": string,"id": string,"name": string,"ort": string | null,"plz": string | null,"strasse": string | null,"zugangshinweise": string | null
                  }
                  Insert: {
                    "aktiv"?: boolean,"endkunde_id": string,"erstellt_am"?: string,"erstellt_von"?: string | null,"geaendert_am"?: string,"id"?: string,"name": string,"ort"?: string | null,"plz"?: string | null,"strasse"?: string | null,"zugangshinweise"?: string | null
                  }
                  Update: {
                    "aktiv"?: boolean,"endkunde_id"?: string,"erstellt_am"?: string,"erstellt_von"?: string | null,"geaendert_am"?: string,"id"?: string,"name"?: string,"ort"?: string | null,"plz"?: string | null,"strasse"?: string | null,"zugangshinweise"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "objekt_endkunde_id_fkey"
      columns: ["endkunde_id"]
isOneToOne: false
      referencedRelation: "endkunde"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "objekt_erstellt_von_fkey"
      columns: ["erstellt_von"]
isOneToOne: false
      referencedRelation: "benutzer"
      referencedColumns: ["id"]
    }
                  ]
                },"protokoll": {
                  Row: {
                    "anlagenpruefung_id": string | null,"art": Database["public"]['Enums']["protokoll_art"],"ergebnis": Database["public"]['Enums']["ampel"] | null,"erzeugt_am": string,"id": string,"revision": number,"session_id": string | null,"sha256": string,"storage_pfad": string,"unterzeichner": (string)[]
                  }
                  Insert: {
                    "anlagenpruefung_id"?: string | null,"art": Database["public"]['Enums']["protokoll_art"],"ergebnis"?: Database["public"]['Enums']["ampel"] | null,"erzeugt_am"?: string,"id"?: string,"revision"?: number,"session_id"?: string | null,"sha256": string,"storage_pfad": string,"unterzeichner"?: (string)[]
                  }
                  Update: {
                    "anlagenpruefung_id"?: string | null,"art"?: Database["public"]['Enums']["protokoll_art"],"ergebnis"?: Database["public"]['Enums']["ampel"] | null,"erzeugt_am"?: string,"id"?: string,"revision"?: number,"session_id"?: string | null,"sha256"?: string,"storage_pfad"?: string,"unterzeichner"?: (string)[]
                  }
                  Relationships: [
                    {
      foreignKeyName: "protokoll_anlagenpruefung_id_fkey"
      columns: ["anlagenpruefung_id"]
isOneToOne: false
      referencedRelation: "anlagenpruefung"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "protokoll_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "session"
      referencedColumns: ["id"]
    }
                  ]
                },"protokoll_zaehler": {
                  Row: {
                    "jahr": number,"letzte": number
                  }
                  Insert: {
                    "jahr": number,"letzte": number
                  }
                  Update: {
                    "jahr"?: number,"letzte"?: number
                  }
                  Relationships: [
                    
                  ]
                },"pruefart": {
                  Row: {
                    "aktiv": boolean,"anlagentyp_id": string,"checkliste_id": string | null,"elemente": string,"elemente_anteil": number | null,"elemente_zyklus_monate": number,"erstellt_am": string,"erstellt_von": string | null,"geaendert_am": string,"id": string,"intervall_monate": number,"name": string,"reihenfolge": number,"schliesst_ein_id": string | null
                  }
                  Insert: {
                    "aktiv"?: boolean,"anlagentyp_id": string,"checkliste_id"?: string | null,"elemente"?: string,"elemente_anteil"?: number | null,"elemente_zyklus_monate"?: number,"erstellt_am"?: string,"erstellt_von"?: string | null,"geaendert_am"?: string,"id"?: string,"intervall_monate"?: number,"name": string,"reihenfolge"?: number,"schliesst_ein_id"?: string | null
                  }
                  Update: {
                    "aktiv"?: boolean,"anlagentyp_id"?: string,"checkliste_id"?: string | null,"elemente"?: string,"elemente_anteil"?: number | null,"elemente_zyklus_monate"?: number,"erstellt_am"?: string,"erstellt_von"?: string | null,"geaendert_am"?: string,"id"?: string,"intervall_monate"?: number,"name"?: string,"reihenfolge"?: number,"schliesst_ein_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "pruefart_anlagentyp_id_fkey"
      columns: ["anlagentyp_id"]
isOneToOne: false
      referencedRelation: "anlagentyp"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pruefart_checkliste_id_fkey"
      columns: ["checkliste_id"]
isOneToOne: false
      referencedRelation: "checkliste"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pruefart_erstellt_von_fkey"
      columns: ["erstellt_von"]
isOneToOne: false
      referencedRelation: "benutzer"
      referencedColumns: ["id"]
    }
                  ]
                },"session": {
                  Row: {
                    "abgeschlossen_am": string | null,"begonnen_am": string,"bemerkung": string | null,"erstellt_am": string,"geaendert_am": string,"id": string,"kunde_name": string | null,"leiter_id": string,"objekt_id": string,"protokoll_nr": string | null,"revision": number,"status": Database["public"]['Enums']["session_status"],"unterschrift_kunde": string | null,"unterschrift_leiter": string | null,"zusammengefuehrt_in": string | null
                  }
                  Insert: {
                    "abgeschlossen_am"?: string | null,"begonnen_am"?: string,"bemerkung"?: string | null,"erstellt_am"?: string,"geaendert_am"?: string,"id"?: string,"kunde_name"?: string | null,"leiter_id": string,"objekt_id": string,"protokoll_nr"?: string | null,"revision"?: number,"status"?: Database["public"]['Enums']["session_status"],"unterschrift_kunde"?: string | null,"unterschrift_leiter"?: string | null,"zusammengefuehrt_in"?: string | null
                  }
                  Update: {
                    "abgeschlossen_am"?: string | null,"begonnen_am"?: string,"bemerkung"?: string | null,"erstellt_am"?: string,"geaendert_am"?: string,"id"?: string,"kunde_name"?: string | null,"leiter_id"?: string,"objekt_id"?: string,"protokoll_nr"?: string | null,"revision"?: number,"status"?: Database["public"]['Enums']["session_status"],"unterschrift_kunde"?: string | null,"unterschrift_leiter"?: string | null,"zusammengefuehrt_in"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "session_leiter_id_fkey"
      columns: ["leiter_id"]
isOneToOne: false
      referencedRelation: "benutzer"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "session_objekt_id_fkey"
      columns: ["objekt_id"]
isOneToOne: false
      referencedRelation: "objekt"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "session_zusammengefuehrt_in_fkey"
      columns: ["zusammengefuehrt_in"]
isOneToOne: false
      referencedRelation: "session"
      referencedColumns: ["id"]
    }
                  ]
                },"session_revision": {
                  Row: {
                    "am": string,"grund": string,"revision": number,"session_id": string,"von": string
                  }
                  Insert: {
                    "am"?: string,"grund": string,"revision": number,"session_id": string,"von"?: string
                  }
                  Update: {
                    "am"?: string,"grund"?: string,"revision"?: number,"session_id"?: string,"von"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "session_revision_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "session"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "session_revision_von_fkey"
      columns: ["von"]
isOneToOne: false
      referencedRelation: "benutzer"
      referencedColumns: ["id"]
    }
                  ]
                },"session_teilnehmer": {
                  Row: {
                    "beigetreten_am": string,"benutzer_id": string,"bereich": Json | null,"fertig_am": string | null,"session_id": string,"unterschrift": string | null
                  }
                  Insert: {
                    "beigetreten_am"?: string,"benutzer_id": string,"bereich"?: Json | null,"fertig_am"?: string | null,"session_id": string,"unterschrift"?: string | null
                  }
                  Update: {
                    "beigetreten_am"?: string,"benutzer_id"?: string,"bereich"?: Json | null,"fertig_am"?: string | null,"session_id"?: string,"unterschrift"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "session_teilnehmer_benutzer_id_fkey"
      columns: ["benutzer_id"]
isOneToOne: false
      referencedRelation: "benutzer"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "session_teilnehmer_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "session"
      referencedColumns: ["id"]
    }
                  ]
                },"verschluesselung": {
                  Row: {
                    "abgeschaltet_am": string | null,"abschaltnachweis": string | null,"abschaltung_seit": string | null,"abschaltung_von": string | null,"aktiv": boolean,"aktiv_seit": string | null,"eingerichtet_am": string,"eingerichtet_von": string | null,"id": number,"instanz_id": string,"pruefwert": string,"schluessel_id": string,"tausch_pruefwert": string | null,"tausch_schluessel_id": string | null,"tausch_seit": string | null,"tausch_von": string | null
                  }
                  Insert: {
                    "abgeschaltet_am"?: string | null,"abschaltnachweis"?: string | null,"abschaltung_seit"?: string | null,"abschaltung_von"?: string | null,"aktiv"?: boolean,"aktiv_seit"?: string | null,"eingerichtet_am"?: string,"eingerichtet_von"?: string | null,"id"?: number,"instanz_id": string,"pruefwert": string,"schluessel_id": string,"tausch_pruefwert"?: string | null,"tausch_schluessel_id"?: string | null,"tausch_seit"?: string | null,"tausch_von"?: string | null
                  }
                  Update: {
                    "abgeschaltet_am"?: string | null,"abschaltnachweis"?: string | null,"abschaltung_seit"?: string | null,"abschaltung_von"?: string | null,"aktiv"?: boolean,"aktiv_seit"?: string | null,"eingerichtet_am"?: string,"eingerichtet_von"?: string | null,"id"?: number,"instanz_id"?: string,"pruefwert"?: string,"schluessel_id"?: string,"tausch_pruefwert"?: string | null,"tausch_schluessel_id"?: string | null,"tausch_seit"?: string | null,"tausch_von"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "verschluesselung_abschaltung_von_fkey"
      columns: ["abschaltung_von"]
isOneToOne: false
      referencedRelation: "benutzer"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "verschluesselung_eingerichtet_von_fkey"
      columns: ["eingerichtet_von"]
isOneToOne: false
      referencedRelation: "benutzer"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "verschluesselung_tausch_von_fkey"
      columns: ["tausch_von"]
isOneToOne: false
      referencedRelation: "benutzer"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "admin_wiederherstellen":
{ Args: { "p_tabelle": string,"p_zeilen": Json }; Returns: Json
                           },
"anlage_suche":
{ Args: { "p_limit"?: number,"p_objekte"?: Json,"p_text": string }; Returns: {
              "anlagentyp": string,"endkunde_id": string,"etage": string,"etikett_id": string,"gebaeude": string,"id": string,"kunde": string,"kunden_bezeichnung": string,"lage_beschreibung": string,"naechste_pruefung_am": string,"objekt": string,"objekt_id": string,"objekt_ort": string,"raum": string,"status": Database["public"]['Enums']["anlage_status"]
            }[]
                           },
"anlage_zusammenfassen":
{ Args: { "p_anlage_id": string }; Returns: undefined
                           },
"bestand_anlage":
{ Args: { "p_anlage_id": string }; Returns: boolean
                           },
"bestand_art":
{ Args: { "p_art": string }; Returns: boolean
                           },
"bestand_faelligkeit_neu":
{ Args: { "p_anlage_ids": (string)[] }; Returns: undefined
                           },
"bestand_id":
{ Args: { "p_art": string,"p_objekt_id": string }; Returns: string
                           },
"bestand_zusammenfuehren":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"checkliste_bedingung_pruefen":
{ Args: { "p_bedingung": Json,"p_id": string,"p_tiefe"?: number,"p_vorher": Json }; Returns: (string)[]
                           },
"checkliste_neuer_entwurf":
{ Args: { "p_checkliste_id": string }; Returns: string
                           },
"checkliste_punkte_pruefen":
{ Args: { "p_punkte": Json }; Returns: (string)[]
                           },
"checkliste_version_freigeben":
{ Args: { "p_version_id": string }; Returns: undefined
                           },
"checkliste_wirkungen_pruefen":
{ Args: { "p_punkt": Json,"p_vorher": Json }; Returns: (string)[]
                           },
"darf_teilpruefung_anlegen":
{ Args: { "p_haupt_id": string,"p_pruefer_id": string }; Returns: boolean
                           },
"darf_vor_ort":
{ Args: { "p_objekt_id": string }; Returns: boolean
                           },
"demo_modus":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"duplikat_aufloesen":
{ Args: { "p_gueltig": string }; Returns: undefined
                           },
"element_stand_nachtragen":
{ Args: { "p_anlage_id"?: string }; Returns: undefined
                           },
"ersteinrichtung_offen":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"etikett_damm":
{ Args: { "p_ziffern": string }; Returns: number
                           },
"etikett_nummer":
{ Args: { "p_id": string }; Returns: number
                           },
"etiketten_erzeugen":
{ Args: { "p_anzahl": number,"p_charge"?: string }; Returns: {
              "anlage_id": string | null,
"charge": string,
"erstellt_am": string,
"id": string,
"zugeordnet_am": string | null
            }[]
                          SetofOptions: {
        from: "*"
        to: "etikett"
        isOneToOne: false
        isSetofReturn: true
      } },
"faelligkeit_naechste":
{ Args: { "p_anlage_id": string,"p_intervall": number,"p_letzte": string,"p_pruefart_id": string }; Returns: string
                           },
"fehler_leeren":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"fehler_liste":
{ Args: Record<PropertyKey, never>; Returns: {
              "anzahl": number,"art": string,"benutzer": string,"erstmals_am": string,"gemeldet": boolean,"geraet": string,"id": number,"ort": string,"stack": string,"text": string,"version": string,"zuletzt_am": string
            }[]
                           },
"fehler_melden":
{ Args: { "p_art": string,"p_geraet"?: string,"p_ort"?: string,"p_stack"?: string,"p_text": string,"p_version"?: string }; Returns: undefined
                           },
"foto_bezug_beschreibbar":
{ Args: { "p_id": string,"p_typ": Database["public"]['Enums']["foto_bezug"] }; Returns: boolean
                           },
"foto_datei_loeschbar":
{ Args: { "p_pfad": string }; Returns: boolean
                           },
"foto_pruefung":
{ Args: { "p_id": string,"p_typ": Database["public"]['Enums']["foto_bezug"] }; Returns: string
                           },
"geheimtext_schluessel":
{ Args: { "p_wert": string }; Returns: string
                           },
"hat_sachkunde":
{ Args: { "p_art": string,"p_benutzer": string }; Returns: boolean
                           },
"hauptpruefung":
{ Args: { "p_id": string }; Returns: string
                           },
"ist_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"ist_aktiv":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"ist_eigene_offene_pruefung":
{ Args: { "p_anlagenpruefung_id": string }; Returns: boolean
                           },
"ist_geheimtext":
{ Args: { "p_wert": string }; Returns: boolean
                           },
"ist_systemadmin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"ist_systemleser":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"ist_teilnehmer":
{ Args: { "p_session_id": string }; Returns: boolean
                           },
"ist_zugelassener_mitpruefer":
{ Args: { "p_anlagenpruefung_id": string }; Returns: boolean
                           },
"klartext_oder_null":
{ Args: { "p_wert": string }; Returns: string
                           },
"kundendatei_loeschbar":
{ Args: { "p_bucket": string,"p_pfad": string }; Returns: boolean
                           },
"kundendaten_loeschen":
{ Args: { "p_bestaetigung": string,"p_checklisten"?: boolean }; Returns: Json
                           },
"lizenz_akzeptieren":
{ Args: { "p_stand"?: string,"p_version": string,"p_zeitpunkt"?: string }; Returns: undefined
                           },
"lizenz_akzeptiert":
{ Args: { "p_version": string }; Returns: boolean
                           },
"log_benutzer":
{ Args: { "p_id"?: string }; Returns: string
                           },
"log_dateien":
{ Args: Record<PropertyKey, never>; Returns: {
              "aktuell": boolean,"angelegt_am": string,"archiviert_am": string,"groesse": number,"nr": number,"zeilen": number
            }[]
                           },
"log_datensatz":
{ Args: { "p_id": string,"p_tabelle": string }; Returns: Json
                           },
"log_eintragen":
{ Args: { "p_aktion": string,"p_details"?: string,"p_erfasst_am"?: string }; Returns: undefined
                           },
"log_eintragen_fuer":
{ Args: { "p_aktion": string,"p_benutzer_id": string,"p_details"?: string }; Returns: undefined
                           },
"log_feld":
{ Args: { "p_spalte": string,"p_tabelle": string }; Returns: string
                           },
"log_feldwert":
{ Args: { "p_spalte": string,"p_tabelle": string,"p_wert": Json,"p_ziel"?: string }; Returns: string
                           },
"log_grenze":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"log_ist_code":
{ Args: { "p_spalte": string }; Returns: boolean
                           },
"log_kurz":
{ Args: { "p_max": number,"p_text": string }; Returns: string
                           },
"log_lesen":
{ Args: { "p_anzahl"?: number,"p_nr": number,"p_suche"?: string,"p_vor_id"?: number }; Returns: {
              "id": number,"zeile": string
            }[]
                           },
"log_punkt":
{ Args: { "p_anlagenpruefung_id": string,"p_punkt_id": string }; Returns: string
                           },
"log_rotieren":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"log_schreiben":
{ Args: { "p_aktion": string,"p_benutzer": string,"p_details"?: string }; Returns: undefined
                           },
"log_tabellenname":
{ Args: { "p_tabelle": string }; Returns: string
                           },
"log_technisch":
{ Args: { "p_spalte": string }; Returns: boolean
                           },
"log_text":
{ Args: { "p_nr": number }; Returns: string
                           },
"log_titel":
{ Args: { "p_tabelle": string,"z": Json }; Returns: string
                           },
"log_ueberwachen":
{ Args: { "p_tabelle": string }; Returns: undefined
                           },
"log_verweis":
{ Args: { "p_id": string,"p_tabelle": string }; Returns: string
                           },
"log_wert_text":
{ Args: { "p_bereich": string,"p_code": string }; Returns: string
                           },
"log_zitat":
{ Args: { "p_max"?: number,"p_text": string }; Returns: string
                           },
"mail_fehler_beanspruchen":
{ Args: { "p_abstand": string }; Returns: boolean
                           },
"mail_fehler_freigeben":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"mail_fehler_gemeldet":
{ Args: { "p_stand": Json }; Returns: undefined
                           },
"mail_fehler_offen":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"mail_passwort_lesen":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"mail_passwort_setzen":
{ Args: { "p_geheim": string }; Returns: undefined
                           },
"mail_sofort_gemeldet":
{ Args: { "p_bis": string }; Returns: undefined
                           },
"mail_sofort_pruefungen":
{ Args: { "p_schwelle": string }; Returns: Json
                           },
"mail_stand":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"mail_status_beanspruchen":
{ Args: { "p_termin": string }; Returns: string
                           },
"mail_status_ergebnis":
{ Args: { "p_alt": string,"p_fehler"?: string,"p_ok": boolean }; Returns: undefined
                           },
"mail_status_neu_beginnen":
{ Args: { "p_ab": string }; Returns: undefined
                           },
"mail_ueberfaellig_gemeldet":
{ Args: { "p_heute": string,"p_liste": Json }; Returns: undefined
                           },
"mail_ueberfaellig_neu":
{ Args: { "p_heute": string }; Returns: Json
                           },
"mandantencode_erzeugen":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"mandantencode_uebernehmen":
{ Args: { "p_code": string }; Returns: boolean
                           },
"mitpruefung_anfragen":
{ Args: { "p_anlagenpruefung_id": string }; Returns: string
                           },
"mitpruefung_beenden":
{ Args: { "p_anlagenpruefung_id": string,"p_benutzer_id"?: string }; Returns: undefined
                           },
"mitpruefung_entscheiden":
{ Args: { "p_anlagenpruefung_id": string,"p_benutzer_id": string,"p_zulassen": boolean }; Returns: undefined
                           },
"naechste_protokoll_nr":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"passwort_aendern_noetig":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"passwort_aendern_setzen":
{ Args: { "p_benutzer": string }; Returns: undefined
                           },
"passwort_vergessen_zulassen":
{ Args: { "p_email_hash": string,"p_ip_hash": string }; Returns: boolean
                           },
"protokoll_liste":
{ Args: Record<PropertyKey, never>; Returns: {
              "anlagenpruefung_id": string | null,
"art": Database["public"]['Enums']["protokoll_art"],
"ergebnis": Database["public"]['Enums']["ampel"] | null,
"erzeugt_am": string,
"id": string,
"revision": number,
"session_id": string | null,
"sha256": string,
"storage_pfad": string,
"unterzeichner": (string)[]
            }[]
                          SetofOptions: {
        from: "*"
        to: "protokoll"
        isOneToOne: false
        isSetofReturn: true
      } },
"protokoll_pfad_erlaubt":
{ Args: { "p_pfad": string }; Returns: boolean
                           },
"protokoll_unterzeichner_von":
{ Args: { "p_anlagenpruefung_id": string,"p_session_id": string }; Returns: (string)[]
                           },
"pruefart_einschluss_nachtragen":
{ Args: { "p_pruefart_id": string }; Returns: undefined
                           },
"pruefung_beginnen":
{ Args: { "p_anlage_id": string,"p_checkliste_version_id": string,"p_erfassung": Database["public"]['Enums']["erfassung"],"p_id": string,"p_pruefart_id"?: string }; Returns: Json
                           },
"pruefung_faelligkeit_fortschreiben":
{ Args: { "p_id": string }; Returns: undefined
                           },
"pruefung_gesperrt":
{ Args: { "p_anlagenpruefung_id": string }; Returns: boolean
                           },
"pruefung_wieder_oeffnen":
{ Args: { "p_anlagenpruefung_id": string,"p_grund": string,"p_pruefer_id"?: string }; Returns: number
                           },
"rechtstext":
{ Args: { "p_art": string }; Returns: string
                           },
"rechtstext_inhalt":
{ Args: { "p_art": string }; Returns: {
              "format": string,"inhalt": string
            }[]
                           },
"reservierung_aufheben":
{ Args: { "p_anlagenpruefung_id": string }; Returns: undefined
                           },
"schema_stand":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"startseite_kennzahlen":
{ Args: { "p_heute"?: string }; Returns: Json
                           },
"statusbericht":
{ Args: { "p_bis": string,"p_heute": string,"p_naechster": string,"p_von": string }; Returns: Json
                           },
"support_ablauf":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"support_freischalten":
{ Args: { "p_admin": string,"p_minuten": number }; Returns: string
                           },
"support_sperren":
{ Args: { "p_admin": string,"p_details": string }; Returns: undefined
                           },
"teil_geaendert":
{ Args: { "p_benutzer_id": string,"p_haupt_id": string }; Returns: undefined
                           },
"teilpruefung_beginnen":
{ Args: { "p_anlage_id": string,"p_checkliste_version_id": string,"p_erfassung": Database["public"]['Enums']["erfassung"],"p_haupt_id": string,"p_id": string,"p_pruefart_id"?: string }; Returns: Json
                           },
"tuer_pflicht":
{ Args: { "p_begonnen": string,"p_naechste": string }; Returns: boolean
                           },
"tueranlage_id":
{ Args: { "p_objekt_id": string }; Returns: string
                           },
"tueranlage_sicherstellen":
{ Args: { "p_objekt_id": string }; Returns: string
                           },
"tueranlage_typ":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"umschluesseln":
{ Args: { "p_aenderungen": Json }; Returns: number
                           },
"unterschrift_erloeschen":
{ Args: { "p_anlagenpruefung_id": string,"p_benutzer_id": string }; Returns: undefined
                           },
"unterschrift_loeschbar":
{ Args: { "p_pfad": string }; Returns: boolean
                           },
"unterschriften_bereinigen":
{ Args: { "p_anlagenpruefung_id": string }; Returns: undefined
                           },
"verschluesselung_abschalten":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"verschluesselung_abschaltung_abbrechen":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"verschluesselung_abschaltung_beginnen":
{ Args: { "p_nachweis": string }; Returns: undefined
                           },
"verschluesselung_aktiv":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"verschluesselung_aktivieren":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"verschluesselung_anzahl":
{ Args: { "p_schluessel_id": string }; Returns: Json
                           },
"verschluesselung_datei_hochladbar":
{ Args: { "p_bucket": string,"p_pfad": string }; Returns: boolean
                           },
"verschluesselung_datei_loeschbar":
{ Args: { "p_bucket": string,"p_pfad": string }; Returns: boolean
                           },
"verschluesselung_dateipfad_erlaubt":
{ Args: { "p_pfad": string }; Returns: boolean
                           },
"verschluesselung_einrichten":
{ Args: { "p_instanz_id": string,"p_pruefwert": string,"p_schluessel_id": string }; Returns: undefined
                           },
"verschluesselung_ersetzen":
{ Args: { "p_instanz_id": string,"p_pruefwert": string,"p_schluessel_id": string }; Returns: undefined
                           },
"verschluesselung_felder":
{ Args: Record<PropertyKey, never>; Returns: {
              "art": string,"bucket": string,"spalte": string,"tabelle": string
            }[]
                           },
"verschluesselung_kennung":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"verschluesselung_logs_bereinigen":
{ Args: { "p_alle": boolean }; Returns: undefined
                           },
"verschluesselung_mindestalter":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"verschluesselung_pfad_basis":
{ Args: { "p_pfad": string }; Returns: string
                           },
"verschluesselung_pfad_kennung":
{ Args: { "p_pfad": string }; Returns: string
                           },
"verschluesselung_schluesselspalten":
{ Args: { "p_tabelle": string }; Returns: (string)[]
                           },
"verschluesselung_schreibschluessel":
{ Args: { "p_schluessel_id": string,"p_tausch_schluessel_id": string,"p_tausch_von": string }; Returns: (string)[]
                           },
"verschluesselung_stand":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"verschluesselung_tausch_abbrechen":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"verschluesselung_tausch_abschliessen":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"verschluesselung_tausch_beginnen":
{ Args: { "p_pruefwert": string,"p_schluessel_id": string }; Returns: undefined
                           },
"verschluesselung_verwaiste":
{ Args: { "p_ziel": string }; Returns: {
              "bucket": string,"erstellt_am": string,"loeschbar": boolean,"name": string
            }[]
                           },
"verschluesselung_verwaiste_intern":
{ Args: { "p_ziel": string }; Returns: {
              "bucket": string,"erstellt_am": string,"loeschbar": boolean,"name": string
            }[]
                           },
"verschluesselung_verweise":
{ Args: Record<PropertyKey, never>; Returns: {
              "bucket": string,"pfad": string
            }[]
                           },
"zwei_faktor_eingerichtet":
{ Args: Record<PropertyKey, never>; Returns: string[]
                           },
"zwei_faktor_erfuellt":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"zwei_faktor_pflicht":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           }
          }
          Enums: {
            "ampel": "gruen"|"gelb"|"rot","anlage_status": "aktiv"|"stillgelegt","antwort_status": "io"|"nio"|"entfaellt","erfassung": "scan"|"manuell","foto_bezug": "anlage"|"antwort"|"mangel","mangel_status": "offen"|"behoben"|"nachgeprueft"|"verworfen","protokoll_art": "sammel"|"einzel","pruefung_status": "in_pruefung"|"geprueft"|"nicht_geprueft"|"duplikat","rolle": "admin"|"pruefer"|"planer","session_status": "offen"|"abgeschlossen","tuer_kategorie": "fluchttuer"|"automatiktuer"|"sonstige","version_status": "entwurf"|"freigegeben"|"archiviert"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "ampel": ["gruen", "gelb", "rot"],"anlage_status": ["aktiv", "stillgelegt"],"antwort_status": ["io", "nio", "entfaellt"],"erfassung": ["scan", "manuell"],"foto_bezug": ["anlage", "antwort", "mangel"],"mangel_status": ["offen", "behoben", "nachgeprueft", "verworfen"],"protokoll_art": ["sammel", "einzel"],"pruefung_status": ["in_pruefung", "geprueft", "nicht_geprueft", "duplikat"],"rolle": ["admin", "pruefer", "planer"],"session_status": ["offen", "abgeschlossen"],"tuer_kategorie": ["fluchttuer", "automatiktuer", "sonstige"],"version_status": ["entwurf", "freigegeben", "archiviert"]
          }
        }
} as const

