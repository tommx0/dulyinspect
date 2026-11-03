-- Version 2.60.0: Alle Kundendaten löschen (Einstellungen → System, nur Admin).
-- Leert eine Instanz von Kundendaten: Kunden, Objekte, Anlagen mit Elementen und Fälligkeiten, Prüfungen samt Antworten,
-- Mängeln, Fotos und Protokollen, auf Wunsch auch die Checklisten. Erhalten bleiben Benutzer, Einstellungen, Anlagentypen,
-- Prüfarten und Etiketten (die Zuordnung zur Anlage wird gelöst, die Etiketten sind danach wieder frei).
-- Die Dateien im Storage löscht die App danach über die Storage-API (Policy kundendaten_dateien_loeschen).
-- Geräte erkennen die Löschung an firma.kundendaten_geloescht_am und leeren ihren Offline-Speicher.

alter table firma add column kundendaten_geloescht_am timestamptz;
comment on column firma.kundendaten_geloescht_am is
  'Zeitpunkt der letzten Löschung aller Kundendaten – Geräte mit älterem Stand leeren ihren Offline-Speicher';

-- ---------------------------------------------------------------------------
-- Schutzregeln: Ausnahme nur innerhalb von kundendaten_loeschen (kundendaten.loeschen = 'ja').
-- Freigegebene Checklisten-Versionen: kundendaten_loeschen schaltet checkliste_version_schutz kurz ab (version_schutz bleibt unverändert).
-- ---------------------------------------------------------------------------
create or replace function protokoll_unveraenderlich() returns trigger
language plpgsql as $$
begin
  -- Einzige Ausnahme: Wartung mit Service-Role (z. B. Testdaten aufräumen), nie aus der App
  if tg_op = 'DELETE' and auth.role() = 'service_role' then return old; end if;
  -- Alle Kundendaten löschen (nur Admin, aus kundendaten_loeschen)
  if tg_op = 'DELETE' and coalesce(current_setting('kundendaten.loeschen', true), '') = 'ja' and ist_systemadmin() then return old; end if;
  -- Umschlüsseln: nur der Pfad der Datei wechselt (Inhalt und sha256 der unverschlüsselten PDF bleiben)
  if tg_op = 'UPDATE' and coalesce(current_setting('verschluesselung.umschluesseln', true), '') = 'ja'
     and (to_jsonb(new) - 'storage_pfad') = (to_jsonb(old) - 'storage_pfad')
     and verschluesselung_pfad_basis(new.storage_pfad) = verschluesselung_pfad_basis(old.storage_pfad) then
    return new;
  end if;
  raise exception 'Gespeicherte Protokolle sind unveränderlich';
end $$;

-- Beim Löschen aller Kundendaten keine Kopie jeder gelöschten Zeile im Audit (die Daten sollen ja weg sein);
-- kundendaten_loeschen schreibt stattdessen einen Eintrag mit den Anzahlen
create or replace function audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  zeile jsonb := to_jsonb(coalesce(new, old));
begin
  if coalesce(current_setting('kundendaten.loeschen', true), '') = 'ja' then return coalesce(new, old); end if;
  insert into audit_log (tabelle, datensatz_id, aktion, alt, neu)
  values (
    tg_table_name,
    coalesce(zeile ->> 'id', concat_ws(':', zeile ->> 'session_id', zeile ->> 'anlagenpruefung_id', zeile ->> 'revision', zeile ->> 'benutzer_id')),
    tg_op,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

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
  -- Alle Kundendaten löschen: eine Zeile mit den Anzahlen schreibt kundendaten_loeschen
  if coalesce(current_setting('kundendaten.loeschen', true), '') = 'ja' then return null; end if;

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

-- ---------------------------------------------------------------------------
-- Löschen
-- ---------------------------------------------------------------------------
-- p_bestaetigung muss „LÖSCHEN“ lauten (wie in der App abgetippt) – schützt vor versehentlichen Aufrufen.
-- Rückgabe: Anzahl je Tabelle, freigegebene Etiketten und die Dateien, die die App danach über die Storage-API löscht.
create or replace function kundendaten_loeschen(p_bestaetigung text, p_checklisten boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  -- Tabelle und Bezeichnung im Log, Kinder vor Eltern nur zur Lesbarkeit (gelöscht wird unten in eigener Reihenfolge)
  tabellen text[][] := array[
    ['endkunde', 'Kunden'], ['objekt', 'Objekte'], ['anlage', 'Anlagen'], ['anlage_element', 'Elemente'],
    ['anlage_faelligkeit', 'Fälligkeiten'], ['anlagenpruefung', 'Prüfungen'], ['antwort', 'Antworten'],
    ['element_ergebnis', 'Element-Ergebnisse'], ['mangel', 'Mängel'], ['foto', 'Fotos'], ['protokoll', 'Protokolle'],
    ['anlagenpruefung_mitpruefer', 'Mitprüfer'], ['anlagenpruefung_freigabe', 'Freigaben'],
    ['anlagenpruefung_revision', 'Wiederöffnungen'], ['anlagenpruefung_aenderung', 'Änderungen in Revisionen'],
    ['session', 'Sessions'], ['session_teilnehmer', 'Session-Teilnehmer'], ['session_revision', 'Session-Revisionen']];
  checklisten text[][] := array[['checkliste', 'Checklisten'], ['checkliste_version', 'Checklisten-Versionen']];
  i int;
  n bigint;
  anzahl jsonb := '{}';
  teile text[] := '{}';
  etiketten int;
  pruefarten int := 0;
  dateien jsonb;
  revision_vorher text := current_setting('session.revision', true);
begin
  if not ist_systemadmin() then
    raise exception 'Nur der Administrator darf alle Kundendaten löschen' using errcode = '42501';
  end if;
  if p_bestaetigung is distinct from 'LÖSCHEN' then
    raise exception 'Zur Bestätigung bitte LÖSCHEN eingeben';
  end if;
  if p_checklisten then tabellen := tabellen || checklisten; end if;

  for i in 1 .. array_length(tabellen, 1) loop
    execute format('select count(*) from %I', tabellen[i][1]) into n;
    anzahl := anzahl || jsonb_build_object(tabellen[i][1], n);
    if n > 0 then teile := teile || format('%s: %s', tabellen[i][2], n); end if;
  end loop;

  -- Schutzregeln (Protokolle, abgeschlossene Prüfungen, Türanlagen, Unterschriften) und Log je Zeile nur in dieser Transaktion aus
  perform set_config('kundendaten.loeschen', 'ja', true);
  perform set_config('session.revision', 'ja', true);
  perform set_config('anlage.tueranlage', 'ja', true);
  perform set_config('app.element_stand', 'ja', true);

  -- PostgREST lädt safeupdate: delete/update ohne where bricht ab, deshalb „where true“
  -- anlage.etikett_id ↔ etikett.anlage_id: Etiketten zuerst lösen, sie bleiben als freie Etiketten erhalten
  update etikett set anlage_id = null, zugeordnet_am = null where anlage_id is not null;
  get diagnostics etiketten = row_count;

  delete from element_ergebnis where true;
  delete from antwort where true;
  delete from foto where true;
  delete from mangel where true;
  delete from protokoll where true;
  delete from anlagenpruefung_aenderung where true;
  delete from anlagenpruefung_revision where true;
  delete from anlagenpruefung_mitpruefer where true;
  delete from anlagenpruefung_freigabe where true;
  delete from anlagenpruefung where true;
  delete from session_teilnehmer where true;
  delete from session_revision where true;
  delete from session where true;
  -- Türen vor ihrer Türanlage (Elemente und Fälligkeiten gehen per Kaskade mit)
  loop
    delete from anlage a where not exists (select 1 from anlage t where t.teil_von_id = a.id);
    exit when not found;
  end loop;
  delete from objekt where true;
  delete from endkunde where true;
  if p_checklisten then
    update pruefart set checkliste_id = null where checkliste_id is not null;
    get diagnostics pruefarten = row_count;
    -- Freigegebene Versionen schützt checkliste_version_schutz: nur hier und nur bis zum Ende dieser Transaktion aus
    alter table checkliste_version disable trigger checkliste_version_schutz;
    delete from checkliste_version where true;
    alter table checkliste_version enable trigger checkliste_version_schutz;
    delete from checkliste where true;
  end if;

  update firma set kundendaten_geloescht_am = now() where id = 1;

  perform set_config('kundendaten.loeschen', '', true);
  perform set_config('session.revision', coalesce(revision_vorher, ''), true);
  perform set_config('anlage.tueranlage', '', true);
  perform set_config('app.element_stand', '', true);

  -- Dateien der gelöschten Datensätze (Nachweise der Sachkunde gehören zu den Benutzern und bleiben)
  select coalesce(jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'pfad', o.name) order by o.bucket_id, o.name), '[]') into dateien
    from storage.objects o where o.bucket_id in ('fotos', 'unterschriften', 'protokolle');

  perform log_schreiben(log_benutzer(), 'Alle Kundendaten gelöscht', concat_ws(' | ',
    coalesce(nullif(array_to_string(teile, ', '), ''), 'keine Datensätze vorhanden'),
    format('%s Etiketten wieder frei', etiketten),
    case when p_checklisten then format('Checklisten mitgelöscht, bei %s Prüfarten entfernt', pruefarten) else 'Checklisten bleiben' end,
    format('%s Dateien zum Löschen', jsonb_array_length(dateien))));
  insert into audit_log (tabelle, datensatz_id, aktion, neu)
  values ('kundendaten', 'alle', 'LOESCHEN', jsonb_build_object('anzahl', anzahl, 'etiketten_frei', etiketten,
    'checklisten', p_checklisten, 'pruefarten_ohne_checkliste', pruefarten, 'dateien', jsonb_array_length(dateien)));

  return jsonb_build_object('anzahl', anzahl, 'etiketten', etiketten, 'pruefarten', pruefarten, 'dateien', dateien,
    'geloescht_am', (select kundendaten_geloescht_am from firma where id = 1));
end $$;
revoke all on function kundendaten_loeschen(text, boolean) from public, anon;
grant execute on function kundendaten_loeschen(text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: Dateien gelöschter Kundendaten
-- ---------------------------------------------------------------------------
-- Nur der Admin, nur Dateien, die beim letzten Löschen aller Kundendaten schon da waren, und nur, wenn kein Datensatz
-- mehr auf sie verweist (Spalten aus verschluesselung_felder). Bricht das Löschen der Dateien ab, holt ein erneuter
-- Aufruf von kundendaten_loeschen die verbliebenen.
create or replace function kundendatei_loeschbar(p_bucket text, p_pfad text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  f record;
  verwendet boolean;
begin
  if not ist_systemadmin() or not coalesce((
       select o.created_at <= fi.kundendaten_geloescht_am from storage.objects o, firma fi
        where fi.id = 1 and o.bucket_id = p_bucket and o.name = p_pfad), false) then
    return false;
  end if;
  for f in select * from verschluesselung_felder() x where x.bucket = p_bucket loop
    execute format('select exists (select 1 from %I where %I = $1)', f.tabelle, f.spalte) into verwendet using p_pfad;
    if verwendet then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function kundendatei_loeschbar(text, text) from public, anon;
grant execute on function kundendatei_loeschbar(text, text) to authenticated;

create policy kundendaten_dateien_loeschen on storage.objects for delete to authenticated
  using (bucket_id in ('fotos', 'unterschriften', 'protokolle') and kundendatei_loeschbar(bucket_id, name));
