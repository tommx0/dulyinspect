-- Logdateien lesbar: deutsche Namen für Tabellen und Felder, Datensätze mit Namen statt IDs
-- (Kunde, Objekt, Anlage, Benutzer, Prüfpunkt …), Werte als ja/nein, Datum, „i.O.“ usw.
--   vorher: DB UPDATE anlage | id=5b6e… | kunden_bezeichnung: "T 0.01" → "T 1.07"
--   jetzt:  Anlage geändert | FT-00001 „T 1.07“ · Objekt „Haupthaus“ · Kunde „Musterklinik GmbH“ | Bezeichnung: „T 0.01“ → „T 1.07“
-- Bereits geschriebene Zeilen bleiben, wie sie sind.

-- Bezeichnungen: tabelle + '' = Name des Datensatzes, tabelle + spalte = Feld, '*' = Feld in allen Tabellen,
-- 'eigenschaften' = Eigenschaften der Anlagenarten (src/lib/anlagenarten.ts), 'wert' = Codes in Auswahlfeldern
create table log_bezeichnung (
  tabelle text not null,
  spalte text not null,
  text text not null,
  primary key (tabelle, spalte)
);
alter table log_bezeichnung enable row level security;
revoke all on log_bezeichnung from public, anon, authenticated;

insert into log_bezeichnung (tabelle, spalte, text) values
  ('anlage', '', 'Anlage'), ('anlage_element', '', 'Element'), ('anlage_faelligkeit', '', 'Fälligkeit'),
  ('anlagenart', '', 'Anlagenart'), ('anlagenpruefung', '', 'Anlagenprüfung'), ('anlagenpruefung_freigabe', '', 'Freigabe'),
  ('anlagentyp', '', 'Anlagentyp'), ('antwort', '', 'Antwort'), ('benutzer', '', 'Benutzer'), ('benutzer_sachkunde', '', 'Sachkunde'),
  ('checkliste', '', 'Checkliste'), ('checkliste_version', '', 'Checklisten-Version'), ('element_ergebnis', '', 'Element-Ergebnis'),
  ('endkunde', '', 'Kunde'), ('erscheinungsbild', '', 'Erscheinungsbild'), ('etikett', '', 'Etikett'), ('firma', '', 'Firmendaten'),
  ('foto', '', 'Foto'), ('mangel', '', 'Mangel'), ('menue_pruefer', '', 'Menü für Prüfer'), ('objekt', '', 'Objekt'),
  ('protokoll', '', 'Protokoll-PDF'), ('protokoll_zaehler', '', 'Protokollzähler'), ('pruefart', '', 'Prüfart'),
  ('session', '', 'Prüfung'), ('session_revision', '', 'Revision'), ('session_teilnehmer', '', 'Teilnehmer'),

  ('*', 'name', 'Name'), ('*', 'strasse', 'Straße'), ('*', 'plz', 'PLZ'), ('*', 'ort', 'Ort'), ('*', 'email', 'E-Mail'),
  ('*', 'telefon', 'Telefon'), ('*', 'aktiv', 'Aktiv'), ('*', 'status', 'Status'), ('*', 'notiz', 'Notiz'),
  ('*', 'bemerkung', 'Bemerkung'), ('*', 'beschreibung', 'Beschreibung'), ('*', 'erstellt_von', 'Erstellt von'),
  ('*', 'erstellt_am', 'Erstellt am'), ('*', 'objekt_id', 'Objekt'), ('*', 'endkunde_id', 'Kunde'), ('*', 'anlage_id', 'Anlage'),
  ('*', 'anlagentyp_id', 'Anlagentyp'), ('*', 'pruefart_id', 'Prüfart'), ('*', 'checkliste_id', 'Checkliste'),
  ('*', 'checkliste_version_id', 'Checklisten-Version'), ('*', 'session_id', 'Prüfung'), ('*', 'anlagenpruefung_id', 'Anlagenprüfung'),
  ('*', 'benutzer_id', 'Benutzer'), ('*', 'pruefer_id', 'Prüfer'), ('*', 'leiter_id', 'Leitung'), ('*', 'etikett_id', 'Etikett'),
  ('*', 'element_id', 'Element'), ('*', 'mangel_id', 'Mangel'), ('*', 'punkt_id', 'Prüfpunkt'),
  ('*', 'intervall_monate', 'Prüfintervall (Monate)'), ('*', 'letzte_pruefung_am', 'Letzte Prüfung'),
  ('*', 'naechste_pruefung_am', 'Nächste Prüfung'), ('*', 'letztes_ergebnis', 'Letztes Ergebnis'), ('*', 'eigenschaften', 'Eigenschaften'),
  ('*', 'anlagenart', 'Anlagenart'), ('*', 'reihenfolge', 'Reihenfolge'), ('*', 'revision', 'Revision'), ('*', 'ergebnis', 'Ergebnis'),
  ('*', 'typ', 'Typ'), ('*', 'nummer', 'Nummer'), ('*', 'gruppe', 'Gruppe'), ('*', 'grund', 'Grund'), ('*', 'am', 'Am'), ('*', 'von', 'Von'),
  ('*', 'begonnen_am', 'Begonnen'),

  ('anlage', 'kunden_bezeichnung', 'Bezeichnung'), ('anlage', 'gebaeude', 'Gebäude'), ('anlage', 'etage', 'Etage'),
  ('anlage', 'raum', 'Raum'), ('anlage', 'lage_beschreibung', 'Lage'), ('anlage', 'hersteller', 'Hersteller'),
  ('anlage', 'modell', 'Modell'), ('anlage', 'baujahr', 'Baujahr'),
  ('anlage_element', 'elementart', 'Art'), ('anlage_element', 'zuletzt_geprueft_am', 'Zuletzt geprüft'),
  ('anlagenart', 'schluessel', 'Schlüssel'), ('anlagenart', 'sachkunde_pflicht', 'Sachkunde Pflicht'),
  ('anlagenpruefung', 'erfassung', 'Erfassung'), ('anlagenpruefung', 'erfasst_offline', 'Offline erfasst'),
  ('anlagenpruefung', 'nicht_geprueft_grund', 'Grund (nicht geprüft)'), ('anlagenpruefung', 'duplikat_von', 'Doppelt zu'),
  ('anlagenpruefung', 'ergebnis_auto', 'Ergebnis (automatisch)'), ('anlagenpruefung', 'ergebnis_begruendung', 'Begründung'),
  ('anlagenpruefung', 'beendet_am', 'Beendet'), ('anlagenpruefung', 'letzte_aktivitaet', 'Letzte Aktivität'),
  ('anlagenpruefung', 'duplikat_geklaert', 'Doppelprüfung geklärt'), ('anlagenpruefung', 'altmaengel', 'Altmängel'),
  ('anlagenpruefung', 'urspruenglicher_pruefer_id', 'Ursprünglicher Prüfer'), ('anlagenpruefung', 'uebernommen_am', 'Übernommen am'),
  ('anlagenpruefung_freigabe', 'freigegeben_von', 'Freigegeben von'),
  ('anlagentyp', 'kategorie', 'Kategorie'),
  ('antwort', 'zahl', 'Messwert'), ('antwort', 'text', 'Text'),
  ('benutzer', 'rolle', 'Rolle'), ('benutzer', 'sachkunde_hinweis', 'Sachkunde-Hinweis'),
  ('benutzer_sachkunde', 'nachweis', 'Nachweis'), ('benutzer_sachkunde', 'gueltig_bis', 'Gültig bis'),
  ('checkliste_version', 'version', 'Version'), ('checkliste_version', 'punkte', 'Prüfpunkte'),
  ('checkliste_version', 'freigegeben_am', 'Freigegeben am'), ('checkliste_version', 'freigegeben_von', 'Freigegeben von'),
  ('endkunde', 'ansprechpartner', 'Ansprechpartner'),
  ('erscheinungsbild', 'app_name', 'App-Name'), ('erscheinungsbild', 'farbe_marke', 'Markenfarbe'),
  ('erscheinungsbild', 'farbe_akzent', 'Akzentfarbe'), ('erscheinungsbild', 'logo_pfad', 'Logo'), ('erscheinungsbild', 'logo_pdf_pfad', 'Logo (PDF)'),
  ('etikett', 'charge', 'Charge'), ('etikett', 'zugeordnet_am', 'Zugeordnet am'),
  ('firma', 'web', 'Website'), ('firma', 'zusatz', 'Zusatz'), ('firma', 'protokoll_hinweis', 'Hinweis im Protokoll'),
  ('firma', 'impressum', 'Impressum'), ('firma', 'datenschutz', 'Datenschutz'),
  ('foto', 'bezug_typ', 'Bezug'), ('foto', 'bezug_id', 'Zu'), ('foto', 'storage_pfad', 'Datei'), ('foto', 'aufgenommen_am', 'Aufgenommen am'),
  ('mangel', 'entdeckt_in', 'Entdeckt in'), ('mangel', 'stufe', 'Stufe'), ('mangel', 'behoben_am', 'Behoben am'),
  ('mangel', 'behoben_notiz', 'Notiz zur Behebung'), ('mangel', 'nachgeprueft_in', 'Nachgeprüft in'),
  ('menue_pruefer', 'ausgeblendet', 'Ausgeblendet'),
  ('objekt', 'zugangshinweise', 'Zugangshinweise'),
  ('protokoll', 'art', 'Art'), ('protokoll', 'storage_pfad', 'Datei'), ('protokoll', 'sha256', 'Prüfsumme'), ('protokoll', 'erzeugt_am', 'Erzeugt am'),
  ('protokoll_zaehler', 'jahr', 'Jahr'), ('protokoll_zaehler', 'letzte', 'Letzte Nummer'),
  ('pruefart', 'elemente', 'Elemente'), ('pruefart', 'elemente_anteil', 'Anteil Elemente (%)'),
  ('pruefart', 'elemente_zyklus_monate', 'Zyklus Elemente (Monate)'),
  ('session', 'protokoll_nr', 'Protokoll-Nr.'), ('session', 'zusammengefuehrt_in', 'Zusammengeführt in'),
  ('session', 'abgeschlossen_am', 'Abgeschlossen'), ('session', 'unterschrift_leiter', 'Unterschrift Leitung'),
  ('session', 'unterschrift_kunde', 'Unterschrift Kunde'), ('session', 'kunde_name', 'Name des Kunden (Unterschrift)'),
  ('session_teilnehmer', 'bereich', 'Bereich'), ('session_teilnehmer', 'beigetreten_am', 'Beigetreten'),
  ('session_teilnehmer', 'fertig_am', 'Fertig gemeldet'), ('session_teilnehmer', 'unterschrift', 'Unterschrift'),

  ('eigenschaften', 'antrieb_system', 'Antrieb / System'), ('eigenschaften', 'systemart', 'Systemart'),
  ('eigenschaften', 'nennbetriebsdauer', 'Nennbetriebsdauer'), ('eigenschaften', 'batterie', 'Batterie'),
  ('eigenschaften', 'batterie_einbau', 'Batterie eingebaut am'), ('eigenschaften', 'stromkreise', 'Anzahl Endstromkreise'),
  ('eigenschaften', 'leuchten', 'Anzahl Leuchten'), ('eigenschaften', 'pruefeinrichtung', 'Automatische Prüfeinrichtung'),
  ('eigenschaften', 'pruefbuch', 'Standort Prüfbuch'), ('eigenschaften', 'schaltung', 'Schaltungsart'),
  ('eigenschaften', 'akku', 'Akku eingebaut am'), ('eigenschaften', 'meldergruppen', 'Anzahl Meldergruppen'),
  ('eigenschaften', 'ue', 'Aufschaltung Feuerwehr'), ('eigenschaften', 'fsd', 'Feuerwehr-Schlüsseldepot'),
  ('eigenschaften', 'fbf', 'Feuerwehr-Bedienfeld'), ('eigenschaften', 'fat', 'Feuerwehr-Anzeigetableau'),
  ('eigenschaften', 'laufkarten', 'Feuerwehr-Laufkarten'), ('eigenschaften', 'betriebsbuch', 'Standort Betriebsbuch'),
  ('eigenschaften', 'einbau', 'Eingebaut am'), ('eigenschaften', 'verdeckt', 'In Zwischendecke / Doppelboden'),
  ('eigenschaften', 'klasse', 'Klasse / Grad'), ('eigenschaften', 'bereiche', 'Anzahl Sicherungsbereiche'),
  ('eigenschaften', 'nsl', 'Aufschaltung Notruf- und Serviceleitstelle'), ('eigenschaften', 'nsl_name', 'Notruf- und Serviceleitstelle'),
  ('eigenschaften', 'bereich', 'Sicherungsbereich'),

  ('wert', 'gruen', 'grün'), ('wert', 'gelb', 'gelb'), ('wert', 'rot', 'rot'),
  ('wert', 'in_pruefung', 'in Prüfung'), ('wert', 'geprueft', 'geprüft'), ('wert', 'nicht_geprueft', 'nicht geprüft'), ('wert', 'duplikat', 'Doppelprüfung'),
  ('wert', 'io', 'i.O.'), ('wert', 'nio', 'n.i.O.'), ('wert', 'entfaellt', 'entfällt'), ('wert', 'defekt', 'defekt'), ('wert', 'nicht_zugaenglich', 'nicht zugänglich'),
  ('wert', 'offen', 'offen'), ('wert', 'behoben', 'behoben'), ('wert', 'nachgeprueft', 'nachgeprüft'), ('wert', 'verworfen', 'verworfen'),
  ('wert', 'abgeschlossen', 'abgeschlossen'), ('wert', 'entwurf', 'Entwurf'), ('wert', 'freigegeben', 'freigegeben'), ('wert', 'archiviert', 'archiviert'),
  ('wert', 'fluchttuer', 'Fluchttür'), ('wert', 'automatiktuer', 'Automatische Tür'), ('wert', 'sonstige', 'Sonstige'),
  ('wert', 'aktiv', 'aktiv'), ('wert', 'stillgelegt', 'stillgelegt'), ('wert', 'scan', 'Scan'), ('wert', 'manuell', 'manuell'),
  ('wert', 'sammel', 'Sammelprotokoll'), ('wert', 'einzel', 'Einzelprotokoll'),
  ('wert', 'admin', 'Admin'), ('wert', 'planer', 'Planer'), ('wert', 'pruefer', 'Prüfer'),
  ('wert', 'tuer', 'Anlage'), ('wert', 'anlage', 'Anlage'), ('wert', 'antwort', 'Antwort'), ('wert', 'mangel', 'Mangel'),
  ('wert', 'keine', 'keine'), ('wert', 'alle', 'alle'), ('wert', 'anteil', 'Anteil');

-- Spalten mit Codes, die übersetzt werden
create function log_ist_code(p_spalte text) returns boolean
language sql immutable as $$
  select p_spalte in ('status', 'ergebnis', 'ergebnis_auto', 'letztes_ergebnis', 'rolle', 'kategorie', 'erfassung', 'art', 'bezug_typ', 'elemente');
$$;

-- Lesbarer Name eines Feldes (sonst Spaltenname mit Leerzeichen)
create function log_feld(p_tabelle text, p_spalte text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select text from log_bezeichnung where tabelle = p_tabelle and spalte = p_spalte),
    (select text from log_bezeichnung where tabelle = '*' and spalte = p_spalte),
    initcap(replace(regexp_replace(p_spalte, '_id$', ''), '_', ' ')));
$$;

create function log_tabellenname(p_tabelle text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select text from log_bezeichnung where tabelle = p_tabelle and spalte = ''), p_tabelle);
$$;

-- Text in deutschen Anführungszeichen, gekürzt
create function log_zitat(p_text text, p_max int default 120) returns text
language sql immutable as $$
  select '„' || log_kurz(p_text, p_max) || '“';
$$;

-- Datensatz einer Tabelle über den Primärschlüssel (erste Spalte) als jsonb
create function log_datensatz(p_tabelle text, p_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  pk text;
  zeile jsonb;
begin
  if p_id is null then return null; end if;
  select a.attname into pk from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
   where i.indrelid = format('public.%I', p_tabelle)::regclass and i.indisprimary;
  execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1 limit 1', p_tabelle, pk) into zeile using p_id;
  return zeile;
end $$;

-- Text eines Prüfpunkts aus der Checkliste der Anlagenprüfung
create function log_punkt(p_anlagenpruefung_id text, p_punkt_id text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p ->> 'text' from anlagenpruefung ap join checkliste_version v on v.id = ap.checkliste_version_id,
            jsonb_array_elements(v.punkte) p
      where ap.id::text = p_anlagenpruefung_id and p ->> 'id' = p_punkt_id limit 1),
    p_punkt_id);
$$;

-- Lesbarer Titel eines Datensatzes (mit Namen der übergeordneten Datensätze)
create function log_titel(p_tabelle text, z jsonb) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  t text;
begin
  if z is null then return null; end if;
  t := case p_tabelle
    when 'endkunde' then log_zitat(z ->> 'name')
    when 'objekt' then concat_ws(' · ', log_zitat(z ->> 'name'), 'Kunde ' || log_verweis('endkunde', z ->> 'endkunde_id'))
    when 'anlage' then concat_ws(' · ',
        nullif(concat_ws(' ', z ->> 'etikett_id', case when coalesce(z ->> 'kunden_bezeichnung', '') <> '' then log_zitat(z ->> 'kunden_bezeichnung') end), ''),
        'Objekt ' || log_verweis('objekt', z ->> 'objekt_id'))
    when 'anlagentyp' then log_zitat(z ->> 'name')
    when 'pruefart' then concat_ws(' · ', log_zitat(z ->> 'name'), 'Typ ' || log_zitat((log_datensatz('anlagentyp', z ->> 'anlagentyp_id')) ->> 'name'))
    when 'checkliste' then log_zitat(z ->> 'name')
    when 'checkliste_version' then concat_ws(' ', log_verweis('checkliste', z ->> 'checkliste_id'), 'Version ' || (z ->> 'version'))
    when 'anlagenart' then log_zitat(z ->> 'name')
    when 'benutzer' then case when trim(coalesce(z ->> 'name', '')) = '' then z ->> 'email' else trim(z ->> 'name') || ' <' || (z ->> 'email') || '>' end
    when 'benutzer_sachkunde' then concat_ws(' · ', log_verweis('benutzer', z ->> 'benutzer_id'), log_verweis('anlagenart', z ->> 'anlagenart'))
    when 'etikett' then z ->> 'id'
    when 'session' then concat_ws(' · ',
        coalesce('Nr. ' || (z ->> 'protokoll_nr'), 'vom ' || to_char((z ->> 'begonnen_am')::timestamptz at time zone 'UTC', 'DD.MM.YYYY')),
        'Objekt ' || log_verweis('objekt', z ->> 'objekt_id'))
    when 'session_revision' then concat_ws(' · ', 'Revision ' || (z ->> 'revision'), 'Prüfung ' || log_verweis('session', z ->> 'session_id'))
    when 'session_teilnehmer' then concat_ws(' · ', log_verweis('benutzer', z ->> 'benutzer_id'), 'Prüfung ' || log_verweis('session', z ->> 'session_id'))
    when 'anlagenpruefung' then concat_ws(' · ', 'Anlage ' || log_verweis('anlage', z ->> 'anlage_id'),
        'Prüfart ' || log_zitat((log_datensatz('pruefart', z ->> 'pruefart_id')) ->> 'name'))
    when 'anlagenpruefung_freigabe' then concat_ws(' · ', 'Anlage ' || log_verweis('anlage', z ->> 'anlage_id'), 'Prüfer ' || log_verweis('benutzer', z ->> 'pruefer_id'))
    when 'antwort' then concat_ws(' · ', 'Prüfpunkt ' || log_zitat(log_punkt(z ->> 'anlagenpruefung_id', z ->> 'punkt_id'), 80),
        log_verweis('anlagenpruefung', z ->> 'anlagenpruefung_id'))
    when 'mangel' then concat_ws(' · ', log_zitat(coalesce(nullif(z ->> 'beschreibung', ''), log_punkt(z ->> 'entdeckt_in', z ->> 'punkt_id')), 80),
        'Anlage ' || log_verweis('anlage', z ->> 'anlage_id'))
    when 'anlage_faelligkeit' then concat_ws(' · ', 'Anlage ' || log_verweis('anlage', z ->> 'anlage_id'),
        'Prüfart ' || log_zitat((log_datensatz('pruefart', z ->> 'pruefart_id')) ->> 'name'))
    when 'anlage_element' then concat_ws(' · ', concat_ws(' ', z ->> 'nummer', case when coalesce(z ->> 'elementart', '') <> '' then '(' || (z ->> 'elementart') || ')' end),
        'Anlage ' || log_verweis('anlage', z ->> 'anlage_id'))
    when 'element_ergebnis' then 'Element ' || log_verweis('anlage_element', z ->> 'element_id')
    when 'foto' then 'zu ' || coalesce(log_wert_text('wert', z ->> 'bezug_typ'), '') || ' ' ||
        coalesce(log_verweis(case z ->> 'bezug_typ' when 'tuer' then 'anlage' else z ->> 'bezug_typ' end, z ->> 'bezug_id'), '')
    when 'protokoll' then concat_ws(' · ', log_wert_text('wert', z ->> 'art'), 'Revision ' || (z ->> 'revision'), 'Prüfung ' || log_verweis('session', z ->> 'session_id'))
    when 'protokoll_zaehler' then 'Jahr ' || (z ->> 'jahr')
    when 'firma' then log_zitat(z ->> 'name')
    else null
  end;
  return nullif(t, '');
end $$;

-- Verweis auf einen anderen Datensatz als Titel; fehlt er (gelöscht), bleibt die ID
create function log_verweis(p_tabelle text, p_id text) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if p_id is null then return null; end if;
  return coalesce(log_titel(p_tabelle, log_datensatz(p_tabelle, p_id)), p_id);
exception when others then
  return p_id;
end $$;

create function log_wert_text(p_bereich text, p_code text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select text from log_bezeichnung where tabelle = p_bereich and spalte = p_code), p_code);
$$;

-- Feldwert lesbar: Verweise mit Namen, ja/nein, Datum, Codes übersetzt, Texte in Anführungszeichen
create function log_feldwert(p_tabelle text, p_spalte text, p_wert jsonb, p_ziel text default null) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  s text;
begin
  if p_wert is null or jsonb_typeof(p_wert) = 'null' then return 'leer'; end if;
  s := p_wert #>> '{}';
  if p_ziel is not null then return log_verweis(p_ziel, s); end if;
  if p_spalte = 'punkt_id' then return log_zitat(s, 80); end if;
  -- Unterschriften und Dateien: nur ob vorhanden bzw. der Dateiname, nicht der Speicherpfad
  if p_spalte like 'unterschrift%' then return 'gespeichert'; end if;
  if p_spalte in ('storage_pfad', 'logo_pfad', 'logo_pdf_pfad') then return log_zitat(regexp_replace(s, '^.*/', '')); end if;
  case jsonb_typeof(p_wert)
    when 'boolean' then return case when p_wert = 'true' then 'ja' else 'nein' end;
    when 'number' then return replace(s, '.', ',');
    when 'array' then
      if jsonb_array_length(p_wert) = 0 then return 'keine'; end if;
      if (select bool_and(jsonb_typeof(e) in ('string', 'number')) from jsonb_array_elements(p_wert) e) then
        return log_kurz((select string_agg(e #>> '{}', ', ') from jsonb_array_elements(p_wert) e), 120);
      end if;
      return jsonb_array_length(p_wert) || ' Einträge';
    when 'object' then
      if p_wert = '{}' then return 'keine'; end if;
      return log_kurz((select string_agg(log_feld('eigenschaften', k) || ': ' || log_feldwert('eigenschaften', k, v), ', ')
                         from jsonb_each(p_wert) as e (k, v)), 200);
    else null;
  end case;
  if s ~ '^\d{4}-\d\d-\d\d[T ]\d\d:\d\d' then
    return to_char(s::timestamptz at time zone 'UTC', 'DD.MM.YYYY HH24:MI:SS "UTC"');
  end if;
  if s ~ '^\d{4}-\d\d-\d\d$' then return to_char(s::date, 'DD.MM.YYYY'); end if;
  if log_ist_code(p_spalte) then return log_wert_text('wert', s); end if;
  return log_zitat(s);
exception when others then
  return log_zitat(s);
end $$;

-- Felder, die im Log nur stören
create function log_technisch(p_spalte text) returns boolean
language sql immutable as $$
  select p_spalte in ('id', 'geaendert_am', 'erstellt_am', 'letzte_aktivitaet', 'sha256');
$$;

create or replace function log_datenbank() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  alt jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  neu jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  zeile jsonb := coalesce(neu, alt);
  pfad text := current_setting('request.path', true);
  ziele jsonb;
  spalten text[];
  titel text;
  teile text[] := '{}';
  k text;
  ek text;
  wert text;
begin
  -- Wiederherstellung: eine Zeile je Tabelle statt je Datensatz (die Zusammenfassung schreibt die App)
  if pfad = '/rpc/admin_wiederherstellen' then
    if current_setting('log.wiederherstellung', true) is distinct from tg_table_name then
      perform set_config('log.wiederherstellung', tg_table_name, true);
      perform log_schreiben(log_benutzer(), 'Wiederherstellung', format('%s: fehlende Datensätze werden ergänzt', log_tabellenname(tg_table_name)));
    end if;
    return null;
  end if;

  -- Fremdschlüssel → Zieltabelle, damit Verweise mit Namen erscheinen
  select coalesce(jsonb_object_agg(a.attname, c.confrelid::regclass::text), '{}') into ziele
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
   where c.contype = 'f' and c.conrelid = tg_relid and array_length(c.conkey, 1) = 1 and c.confrelid::regclass::text not like 'auth.%';
  -- Felder in der Reihenfolge der Tabelle
  select array_agg(attname::text order by attnum) into spalten from pg_attribute where attrelid = tg_relid and attnum > 0 and not attisdropped;
  if tg_table_name = 'foto' then
    ziele := ziele || jsonb_build_object('bezug_id', case zeile ->> 'bezug_typ' when 'tuer' then 'anlage' else zeile ->> 'bezug_typ' end);
  end if;

  begin
    titel := log_titel(tg_table_name, zeile);
  exception when others then
    titel := null;
  end;
  if titel is null then
    select string_agg(format('%s %s', log_feld(tg_table_name, a), coalesce(zeile ->> a, 'leer')), ', ') into titel from unnest(tg_argv) a;
  end if;

  if tg_op = 'UPDATE' then
    for k in select key from unnest(spalten) key where not log_technisch(key) and neu -> key is distinct from alt -> key loop
      if jsonb_typeof(neu -> k) = 'object' and jsonb_typeof(alt -> k) = 'object' then
        -- Eigenschaften: nur die geänderten Einträge
        for ek in select x from (select jsonb_object_keys(neu -> k) x union select jsonb_object_keys(alt -> k)) y
                   where (neu -> k -> x) is distinct from (alt -> k -> x) loop
          teile := teile || format('%s: %s → %s', log_feld('eigenschaften', ek),
            log_feldwert('eigenschaften', ek, alt -> k -> ek), log_feldwert('eigenschaften', ek, neu -> k -> ek));
        end loop;
      else
        teile := teile || format('%s: %s → %s', log_feld(tg_table_name, k),
          log_feldwert(tg_table_name, k, alt -> k, ziele ->> k), log_feldwert(tg_table_name, k, neu -> k, ziele ->> k));
      end if;
    end loop;
    if teile = '{}' then teile := array['ohne inhaltliche Änderung']; end if;
  else
    -- Schlüsselfelder stehen schon im Titel
    for k in select key from unnest(spalten) key
              where not log_technisch(key) and key <> 'erstellt_von' and key <> all (tg_argv) and jsonb_typeof(zeile -> key) <> 'null' and zeile -> key not in ('""', '{}', '[]') loop
      wert := case when k = 'punkt_id' then log_zitat(log_punkt(coalesce(zeile ->> 'anlagenpruefung_id', zeile ->> 'entdeckt_in'), zeile ->> k), 80)
                   else log_feldwert(tg_table_name, k, zeile -> k, ziele ->> k) end;
      -- Was schon im Titel steht (Anlage, Objekt, Kunde …), nicht wiederholen
      if length(wert) > 3 and strpos(titel, wert) > 0 then continue; end if;
      teile := teile || format('%s: %s', log_feld(tg_table_name, k), wert);
    end loop;
  end if;

  perform log_schreiben(log_benutzer(),
    log_tabellenname(tg_table_name) || case tg_op when 'INSERT' then ' angelegt' when 'UPDATE' then ' geändert' else ' gelöscht' end,
    concat_ws(' | ', titel, nullif(array_to_string(teile, '; '), ''),
      case when pfad like '/rpc/%' then 'über Funktion ' || substr(pfad, 6) end));
  return null;
end $$;

drop function log_wert(jsonb);

revoke all on function log_ist_code(text), log_feld(text, text), log_tabellenname(text), log_zitat(text, int), log_datensatz(text, text),
  log_punkt(text, text), log_titel(text, jsonb), log_verweis(text, text), log_wert_text(text, text), log_feldwert(text, text, jsonb, text),
  log_technisch(text) from public, anon, authenticated;
