-- Türanlage je Objekt (docs/KONZEPT-TUERANLAGE.md, „Türanlage je Objekt“, Version 2.50.0): Alle Türen eines Objekts gehören
-- automatisch zu seiner Türanlage. Türanlagen werden nicht mehr angelegt, gepflegt oder zugeordnet.
--
-- - Je Objekt genau eine Türanlage (Anlage vom festen Typ „Türanlage“, ID aus der Objekt-ID abgeleitet: tueranlage_id()).
--   Sie hat keine Stammdaten, kein Etikett, keinen Hersteller und keine eigene Checkliste; sie dient nur als Klammer für
--   die gemeinsame Prüfung. Ihren Namen („Türanlage <Objektname>“) bildet die App, weil der Objektname verschlüsselt sein kann.
-- - Die Türanlage entsteht mit dem Objekt (Trigger) und bei Bedarf mit der ersten Tür (falls sie fehlt, z. B. nach einer
--   Wiederherstellung aus einer älteren Sicherung). anlage.teil_von_id jeder Tür setzt der Server.
-- - Abschluss: Pflicht sind nur die beim Beginn der Prüfung fälligen Türen (nächste Prüfung höchstens 30 Tage nach dem
--   Beginn oder noch nie geprüft). Nicht fällige Türen dürfen mitgeprüft werden, blockieren den Abschluss aber nicht.
-- - Die Art „tueranlage“ bleibt ausgeschaltet (sie erscheint nirgends zur Auswahl); ihre Sachkunde ist die für Türen.
-- - Bestehende, von Hand angelegte Türanlagen (2.46.0) werden aufgelöst; ihre Prüfungen (mit Nummer und Protokoll) gehen an
--   die Türanlage ihres Objekts über.

-- ---------------------------------------------------------------------------
-- 1. Art und fester Typ „Türanlage“
-- ---------------------------------------------------------------------------
create function tueranlage_typ() returns uuid
language sql immutable set search_path = public as $$ select '00000000-0000-4000-8000-00000000a001'::uuid $$;
comment on function tueranlage_typ() is 'Fester Anlagentyp der Türanlagen (je Objekt eine, docs/KONZEPT-TUERANLAGE.md)';

-- ID der Türanlage eines Objekts: aus der Objekt-ID abgeleitet, damit eine Wiederherstellung dieselbe Zeile trifft
create function tueranlage_id(p_objekt_id uuid) returns uuid
language sql immutable set search_path = public as $$ select md5('tueranlage:' || p_objekt_id::text)::uuid $$;
grant execute on function tueranlage_typ() to authenticated;
grant execute on function tueranlage_id(uuid) to authenticated;

-- Die Art bleibt ausgeschaltet und übernimmt die Sachkunde-Pflicht der Türen
create function anlagenart_tueranlage() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.schluessel = 'tueranlage' then
    new.aktiv := false;
    new.name := 'Türen';
    new.sachkunde_pflicht := coalesce((select sachkunde_pflicht from anlagenart where schluessel = 'tuer'), false);
  end if;
  return new;
end $$;
create trigger anlagenart_tueranlage before insert or update on anlagenart
  for each row execute function anlagenart_tueranlage();

create function anlagenart_tuer_folgen() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.schluessel = 'tuer' then
    update anlagenart set sachkunde_pflicht = new.sachkunde_pflicht
     where schluessel = 'tueranlage' and sachkunde_pflicht is distinct from new.sachkunde_pflicht;
  end if;
  return null;
end $$;
create trigger anlagenart_tuer_folgen after insert or update on anlagenart
  for each row execute function anlagenart_tuer_folgen();

update anlagenart set aktiv = false where schluessel = 'tueranlage';

-- Sachkunde für die Prüfung einer Türanlage ist die für Türen
create or replace function hat_sachkunde(p_benutzer uuid, p_art text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from benutzer_sachkunde
                  where benutzer_id = p_benutzer and anlagenart = case when p_art = 'tueranlage' then 'tuer' else p_art end
                    and (gueltig_bis is null or gueltig_bis >= current_date));
$$;

-- Der feste Typ: Mehrpersonenprüfung wie bei den bisherigen Türtypen (einer erlaubt sie → die Türanlage erlaubt sie)
insert into anlagentyp (id, name, anlagenart, aktiv, mehrpersonenpruefung)
  values (tueranlage_typ(), 'Türanlage', 'tueranlage', true,
          coalesce((select bool_or(mehrpersonenpruefung) from anlagentyp where anlagenart in ('tuer', 'tueranlage') and aktiv), false))
  on conflict (id) do nothing;
insert into pruefart (id, anlagentyp_id, name, intervall_monate, reihenfolge, aktiv)
  values ('00000000-0000-4000-8000-00000000a002', tueranlage_typ(), 'Türanlage', 12, 0, true)
  on conflict (id) do nothing;

-- Weitere Typen der Art „Türanlage“ gibt es nicht; am festen Typ lässt sich nur die Mehrpersonenprüfung umschalten
create function anlagentyp_tueranlage_schuetzen() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  wiederherstellung boolean := coalesce(current_setting('session.revision', true), '') = 'ja';
  intern boolean := coalesce(current_setting('anlage.tueranlage', true), '') = 'ja';
begin
  if tg_op = 'DELETE' then
    if old.id = tueranlage_typ() and not intern then raise exception 'Der Typ „Türanlage“ gehört zur App und kann nicht gelöscht werden'; end if;
    return old;
  end if;
  if new.id = tueranlage_typ() then
    if tg_op = 'UPDATE' then
      new.name := old.name; new.anlagenart := old.anlagenart; new.kategorie := old.kategorie; new.aktiv := true;
    end if;
    return new;
  end if;
  if new.anlagenart = 'tueranlage' and not intern then
    if wiederherstellung then return null; end if;  -- Türanlagen-Typ aus einer Sicherung von 2.46: entfällt
    raise exception 'Türanlagen legt die App selbst an: alle Türen eines Objekts gehören zu seiner Türanlage';
  end if;
  if tg_op = 'UPDATE' and old.id = tueranlage_typ() then raise exception 'Der Typ „Türanlage“ gehört zur App'; end if;
  return new;
end $$;
create trigger anlagentyp_tueranlage_schuetzen before insert or update or delete on anlagentyp
  for each row execute function anlagentyp_tueranlage_schuetzen();

create function pruefart_tueranlage_schuetzen() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('session.revision', true), '') = 'ja' or coalesce(current_setting('anlage.tueranlage', true), '') = 'ja' then
    return coalesce(new, old);
  end if;
  if (tg_op <> 'INSERT' and old.anlagentyp_id = tueranlage_typ()) or (tg_op <> 'DELETE' and new.anlagentyp_id = tueranlage_typ()) then
    raise exception 'Die Prüfart der Türanlage gehört zur App und kann nicht geändert werden';
  end if;
  return coalesce(new, old);
end $$;
create trigger pruefart_tueranlage_schuetzen before insert or update or delete on pruefart
  for each row execute function pruefart_tueranlage_schuetzen();

-- ---------------------------------------------------------------------------
-- 2. Je Objekt eine Türanlage
-- ---------------------------------------------------------------------------
create unique index anlage_eine_tueranlage_je_objekt on anlage (objekt_id) where anlagentyp_id = '00000000-0000-4000-8000-00000000a001';

-- Türanlage eines Objekts anlegen, falls sie fehlt
create function tueranlage_sicherstellen(p_objekt_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  vorher text := coalesce(current_setting('anlage.tueranlage', true), '');
begin
  if not exists (select 1 from anlage where id = tueranlage_id(p_objekt_id)) then
    perform set_config('anlage.tueranlage', 'ja', true);
    insert into anlage (id, objekt_id, anlagentyp_id, erstellt_von)
      values (tueranlage_id(p_objekt_id), p_objekt_id, tueranlage_typ(), null)
      on conflict do nothing;
    perform set_config('anlage.tueranlage', vorher, true);
  end if;
  return tueranlage_id(p_objekt_id);
end $$;
revoke execute on function tueranlage_sicherstellen(uuid) from public, anon, authenticated;

create function objekt_tueranlage() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform tueranlage_sicherstellen(new.id);
  return null;
end $$;
create trigger objekt_tueranlage after insert on objekt
  for each row execute function objekt_tueranlage();

-- Ein Objekt wird mit seiner Türanlage gelöscht (die Türen und Prüfungen müssen vorher weg sein)
create function objekt_vor_loeschen_tueranlage() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('anlage.tueranlage', 'ja', true);
  delete from anlage where id = tueranlage_id(old.id);
  perform set_config('anlage.tueranlage', '', true);
  return old;
end $$;
create trigger objekt_vor_loeschen_tueranlage before delete on objekt
  for each row execute function objekt_vor_loeschen_tueranlage();

-- Zuordnung: Jede Tür gehört zur Türanlage ihres Objekts, andere Anlagen zu keiner. Die Türanlage selbst ändert sich
-- nicht (außer den Feldern, die die Fälligkeit fortschreibt). Läuft nach anlage_vor_ort_schuetzen (zz).
create or replace function anlage_teil_pruefen() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  art text;
  wiederherstellung boolean := coalesce(current_setting('session.revision', true), '') = 'ja';
  intern boolean := coalesce(current_setting('anlage.tueranlage', true), '') = 'ja';
begin
  select anlagenart into art from anlagentyp where id = new.anlagentyp_id;

  -- Die Türanlage eines Objekts
  if new.anlagentyp_id = tueranlage_typ() or (tg_op = 'UPDATE' and old.anlagentyp_id = tueranlage_typ()) then
    if tg_op = 'INSERT' then
      if not (intern or wiederherstellung) then
        raise exception 'Türanlagen legt die App selbst an: alle Türen eines Objekts gehören zu seiner Türanlage';
      end if;
      if new.id <> tueranlage_id(new.objekt_id) then
        if wiederherstellung then return null; end if;
        raise exception 'Die Türanlage passt nicht zum Objekt';
      end if;
      new.teil_von_id := null;
      return new;
    end if;
    if not (intern or wiederherstellung)
       and (new.objekt_id, new.anlagentyp_id, new.status, new.etikett_id, new.teil_von_id, new.kunden_bezeichnung, new.gebaeude,
            new.etage, new.raum, new.lage_beschreibung, new.hersteller, new.modell, new.baujahr, new.eigenschaften)
           is distinct from
           (old.objekt_id, old.anlagentyp_id, old.status, old.etikett_id, old.teil_von_id, old.kunden_bezeichnung, old.gebaeude,
            old.etage, old.raum, old.lage_beschreibung, old.hersteller, old.modell, old.baujahr, old.eigenschaften) then
      raise exception 'Die Türanlage eines Objekts gehört zur App und kann nicht geändert werden';
    end if;
    return new;
  end if;

  -- Von Hand angelegte Türanlagen (2.46.0) gibt es nicht mehr; aus einer alten Sicherung entfallen sie
  if art = 'tueranlage' then
    if wiederherstellung then return null; end if;
    raise exception 'Türanlagen legt die App selbst an: alle Türen eines Objekts gehören zu seiner Türanlage';
  end if;

  if art = 'tuer' then
    new.teil_von_id := tueranlage_sicherstellen(new.objekt_id);
  else
    new.teil_von_id := null;
  end if;
  if wiederherstellung then return new; end if;
  if tg_op = 'UPDATE' and new.teil_von_id is distinct from old.teil_von_id
     and exists (select 1 from anlagenpruefung where anlage_id = new.id and session_id is null and status = 'in_pruefung') then
    raise exception 'Die Tür wird gerade geprüft – Objekt und Typ können erst danach geändert werden';
  end if;
  return new;
end $$;

create or replace function anlage_vor_loeschen() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.anlagentyp_id = tueranlage_typ() and coalesce(current_setting('anlage.tueranlage', true), '') <> 'ja' then
    raise exception 'Die Türanlage eines Objekts gehört zur App und kann nicht gelöscht werden';
  end if;
  if exists (select 1 from anlagenpruefung where anlage_id = old.id) or exists (select 1 from mangel where anlage_id = old.id) then
    raise exception 'Die Tür hat bereits Prüfungen und kann nicht gelöscht werden. Bitte stattdessen stilllegen.';
  end if;
  if exists (select 1 from anlage where teil_von_id = old.id) then
    raise exception 'Zur Türanlage gehören noch Türen – bitte zuerst die Türen löschen';
  end if;
  update etikett set anlage_id = null, zugeordnet_am = null where anlage_id = old.id;
  delete from foto where bezug_typ = 'anlage' and bezug_id = old.id;
  return old;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Bestand: Türanlagen für alle Objekte, Türen zuordnen, alte Türanlagen auflösen
-- ---------------------------------------------------------------------------
-- Prüfungen von Hand angelegter Türanlagen (2.46.0) gehen an die Türanlage ihres Objekts über; je Objekt darf dabei
-- höchstens eine noch laufen (sonst stießen zwei laufende Prüfungen an derselben Anlage zusammen)
do $$
begin
  if exists (select 1 from anlagenpruefung p join anlage a on a.id = p.anlage_id join anlagentyp t on t.id = a.anlagentyp_id
              where t.anlagenart = 'tueranlage' and t.id <> tueranlage_typ() and p.session_id is null and p.status = 'in_pruefung'
              group by a.objekt_id having count(*) > 1) then
    raise exception 'Ein Objekt hat mehrere laufende Prüfungen von Türanlagen – bitte vor dem Update abschließen oder abbrechen';
  end if;
end $$;

select tueranlage_sicherstellen(id) from objekt;

-- Abgeschlossene Prüfungen bleiben, wie sie sind (Nummer, Protokoll); nur Anlage und Prüfart wechseln. Türen zuordnen, auch
-- solche, die gerade einzeln geprüft werden: diese Prüfung lässt sich noch wie bisher abschließen.
-- Die Anlage einer Prüfung ist sonst unveränderlich (anlagenpruefung_vor_aendern): nur für diese Übernahme aus
select set_config('session.revision', 'ja', true);
alter table anlagenpruefung disable trigger anlagenpruefung_vor_aendern;
update anlagenpruefung p set anlage_id = tueranlage_id(a.objekt_id), pruefart_id = '00000000-0000-4000-8000-00000000a002'
  from anlage a join anlagentyp t on t.id = a.anlagentyp_id
 where p.anlage_id = a.id and t.anlagenart = 'tueranlage' and t.id <> tueranlage_typ();
alter table anlagenpruefung enable trigger anlagenpruefung_vor_aendern;
update mangel m set anlage_id = tueranlage_id(a.objekt_id)
  from anlage a join anlagentyp t on t.id = a.anlagentyp_id
 where m.anlage_id = a.id and t.anlagenart = 'tueranlage' and t.id <> tueranlage_typ();
delete from anlage_faelligkeit f using anlage a join anlagentyp t on t.id = a.anlagentyp_id
 where f.anlage_id = a.id and t.anlagenart = 'tueranlage';
update anlage a set teil_von_id = tueranlage_id(a.objekt_id)
  from anlagentyp t where t.id = a.anlagentyp_id and t.anlagenart = 'tuer' and a.teil_von_id is distinct from tueranlage_id(a.objekt_id);
select set_config('session.revision', '', true);

select set_config('anlage.tueranlage', 'ja', true);
delete from anlage a using anlagentyp t where t.id = a.anlagentyp_id and t.anlagenart = 'tueranlage' and t.id <> tueranlage_typ();
delete from anlagentyp where anlagenart = 'tueranlage' and id <> tueranlage_typ();
select set_config('anlage.tueranlage', '', true);

comment on column anlage.teil_von_id is 'Türanlage, zu der diese Tür gehört: immer die ihres Objekts (setzt der Server, tueranlage_id())';

-- ---------------------------------------------------------------------------
-- 4. Prüfung: Fälligkeit nur für Türen fortschreiben, Abschluss mit den fälligen Türen
-- ---------------------------------------------------------------------------
-- Die Türanlage selbst hat keine Fälligkeit (sie ergibt sich aus ihren Türen)
create or replace function anlagenpruefung_nach_aendern() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.teil_von_id is null and new.status = 'geprueft' and new.ergebnis is not null
     and not exists (select 1 from anlage where id = new.anlage_id and anlagentyp_id = tueranlage_typ()) then
    perform pruefung_faelligkeit_fortschreiben(new.id);
  end if;
  return new;
end $$;

-- Pflicht beim Abschluss einer Türanlage: die beim Beginn der Prüfung fälligen Türen (wie die App, src/lib/tueranlage.ts)
create function tuer_pflicht(p_naechste date, p_begonnen timestamptz) returns boolean
language sql immutable set search_path = public as $$
  select p_naechste is null or p_naechste <= (p_begonnen at time zone 'UTC')::date + 30;
$$;

-- Abschluss (wie 2.46.0): bei einer Türanlage müssen nur die fälligen Türen fertig oder mit Grund nicht geprüft sein
create or replace function anlagenpruefung_abschluss() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  offen text;
  art text;
  auto ampel;
begin
  if new.session_id is not null or coalesce(current_setting('anlagenpruefung.intern', true), '') = 'ja'
     or coalesce(current_setting('session.revision', true), '') = 'ja' then
    return new;
  end if;

  -- --- Teilprüfung: Türergebnis, „Tür fertig“ oder „nicht geprüft“ – keine Unterschrift, keine Nummer, keine Sperre
  if new.teil_von_id is not null then
    new.abgeschlossen_am := null;
    new.protokoll_nr := null;
    if tg_op = 'UPDATE' then
      if old.abgeschlossen_am is not null or pruefung_gesperrt(old.id) then
        if (new.status, new.ergebnis, new.ergebnis_auto, new.ergebnis_begruendung, new.beendet_am, new.altmaengel,
            new.checkliste_version_id, new.nicht_geprueft_grund)
           is not distinct from
           (old.status, old.ergebnis, old.ergebnis_auto, old.ergebnis_begruendung, old.beendet_am, old.altmaengel,
            old.checkliste_version_id, old.nicht_geprueft_grund) then
          return old;  -- erneuter Sync desselben Stands
        end if;
        raise exception 'Die Prüfung ist abgeschlossen und kann nicht mehr geändert werden';
      end if;
      if new.revision is distinct from old.revision then
        raise exception 'Die Prüfung wurde inzwischen wieder geöffnet. Bitte den aktuellen Stand laden.';
      end if;
      -- Der Zeitpunkt „Tür fertig“ bleibt der erste, solange die Tür fertig ist
      if old.beendet_am is not null and new.beendet_am is not null then new.beendet_am := old.beendet_am; end if;
      if (new.status, new.ergebnis, new.ergebnis_auto, new.ergebnis_begruendung, new.altmaengel, new.nicht_geprueft_grund)
         is distinct from (old.status, old.ergebnis, old.ergebnis_auto, old.ergebnis_begruendung, old.altmaengel, old.nicht_geprueft_grund) then
        perform teil_geaendert(new.teil_von_id, auth.uid());
      end if;
    end if;
    if new.status = 'geprueft' then
      if new.beendet_am is null then raise exception 'Bitte die Tür fertig melden (Ende fehlt)'; end if;
      if new.ergebnis is null then raise exception 'Bitte ein Ergebnis für die Tür wählen'; end if;
    elsif new.status = 'nicht_geprueft' then
      new.ergebnis := null;
      new.ergebnis_auto := null;
      new.ergebnis_begruendung := null;
    end if;
    if new.status <> 'nicht_geprueft' then new.nicht_geprueft_grund := null; end if;
    return new;
  end if;

  -- --- Prüfung einer Anlage bzw. Hauptprüfung einer Türanlage
  if tg_op = 'INSERT' then
    new.abgeschlossen_am := null;
    new.revision := 0;
    new.protokoll_nr := null;
    new.unterschrift_am := case when new.unterschrift is null then null else now() end;
    new.kunde_unterschrift_am := case when new.kunde_unterschrift is null then null else now() end;
  else
    if old.abgeschlossen_am is not null then
      -- Erneuter Sync desselben Abschlusses ist harmlos, jede andere Änderung braucht pruefung_wieder_oeffnen.
      -- Sind die Unterschriftsdateien schon entfernt (Pfad leer, Zeitpunkt gesetzt), zählt der mitgeschickte Pfad nicht.
      if (new.status, new.ergebnis, new.ergebnis_auto, new.ergebnis_begruendung, new.beendet_am,
          new.kunde_name, new.altmaengel, new.checkliste_version_id)
         is not distinct from
         (old.status, old.ergebnis, old.ergebnis_auto, old.ergebnis_begruendung, old.beendet_am,
          old.kunde_name, old.altmaengel, old.checkliste_version_id)
         and (new.unterschrift is not distinct from old.unterschrift or (old.unterschrift is null and old.unterschrift_am is not null))
         and (new.kunde_unterschrift is not distinct from old.kunde_unterschrift or (old.kunde_unterschrift is null and old.kunde_unterschrift_am is not null)) then
        return old;
      end if;
      raise exception 'Die Prüfung ist abgeschlossen und kann nicht mehr geändert werden';
    end if;
    if new.revision is distinct from old.revision then
      raise exception 'Die Prüfung wurde inzwischen wieder geöffnet. Bitte den aktuellen Stand laden.';
    end if;
    new.abgeschlossen_am := null;
    new.protokoll_nr := old.protokoll_nr;
    -- Das Prüfdatum bleibt beim ersten Abschluss, auch nach einer Korrektur (Fälligkeit)
    if old.beendet_am is not null then new.beendet_am := old.beendet_am; end if;
    new.unterschrift_am := case when new.unterschrift is not distinct from old.unterschrift then old.unterschrift_am
                                when new.unterschrift is null then null else now() end;
    new.kunde_unterschrift_am := case when new.kunde_unterschrift is not distinct from old.kunde_unterschrift then old.kunde_unterschrift_am
                                      when new.kunde_unterschrift is null then null else now() end;
    -- Anderes Ergebnis oder andere Bewertung früherer Mängel: Unterschriften von Hauptprüfer und Kunde erlöschen,
    -- sofern nicht neu unterschrieben (die Bewertung trifft der Hauptprüfer)
    if (new.ergebnis, new.ergebnis_auto, new.ergebnis_begruendung, new.altmaengel)
       is distinct from (old.ergebnis, old.ergebnis_auto, old.ergebnis_begruendung, old.altmaengel) then
      if new.unterschrift is not distinct from old.unterschrift then new.unterschrift_am := null; end if;
      if new.kunde_unterschrift is not distinct from old.kunde_unterschrift then new.kunde_unterschrift_am := null; end if;
    end if;
  end if;

  -- Abschluss: das Gerät meldet die Prüfung beendet (Duplikate bleiben dabei Duplikate)
  if new.beendet_am is not null and new.status <> 'in_pruefung' then
    if new.status = 'nicht_geprueft' then
      raise exception 'Nicht geprüfte Anlagen bleiben einfach fällig – dafür gibt es keinen Eintrag mehr';
    end if;
    select ty.anlagenart into art from anlage a join anlagentyp ty on ty.id = a.anlagentyp_id where a.id = new.anlage_id;
    if art = 'tueranlage' then
      -- Alle fälligen aktiven Türen sind fertig oder mit Grund nicht geprüft; das Gesamtergebnis ist das schlechteste Türergebnis
      select string_agg(coalesce(a.etikett_id, a.kunden_bezeichnung, 'ohne Bezeichnung'), ', ' order by a.etikett_id, a.kunden_bezeichnung) into offen
        from anlage a
       where a.teil_von_id = new.anlage_id and a.status = 'aktiv' and tuer_pflicht(a.naechste_pruefung_am, new.begonnen_am)
         and not exists (select 1 from anlagenpruefung t
                          where t.teil_von_id = new.id and t.anlage_id = a.id and t.status in ('geprueft', 'nicht_geprueft'));
      if offen is not null then raise exception 'Noch nicht fertig: %', offen; end if;
      select max(t.ergebnis) into auto from anlagenpruefung t where t.teil_von_id = new.id and t.status = 'geprueft';
      if auto is null then raise exception 'Keine Tür geprüft – mindestens eine Tür der Türanlage muss geprüft sein'; end if;
      new.ergebnis_auto := auto;
      if new.ergebnis is null then new.ergebnis := auto; end if;
      if new.ergebnis < auto then raise exception 'Das Ergebnis der Türanlage kann nicht besser sein als das ihrer Türen'; end if;
      if new.ergebnis > auto and nullif(trim(new.ergebnis_begruendung), '') is null then
        raise exception 'Bitte begründen, warum das Ergebnis schlechter ist als das der Türen';
      end if;
    end if;
    if new.ergebnis is null then raise exception 'Bitte ein Ergebnis wählen'; end if;
    if new.unterschrift_am is null then
      raise exception 'Bitte unterschreiben – ohne Unterschrift des Prüfers kann die Anlage nicht abgeschlossen werden';
    end if;
    select string_agg(b.name, ', ' order by b.name) into offen
      from anlagenpruefung_mitpruefer m join benutzer b on b.id = m.benutzer_id
     where m.anlagenpruefung_id = new.id and m.status = 'zugelassen' and m.fertig_am is null;
    if offen is not null then raise exception 'Noch nicht fertig gemeldet: %', offen; end if;
    if new.kunde_unterschrift_am is not null and nullif(trim(new.kunde_name), '') is null then
      raise exception 'Bitte den Namen des Kunden angeben';
    end if;
    new.abgeschlossen_am := now();
    if new.status = 'geprueft' and new.protokoll_nr is null then
      new.protokoll_nr := naechste_protokoll_nr();
    end if;
  elsif new.status = 'geprueft' then
    raise exception 'Bitte die Prüfung abschließen (Ende fehlt)';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Kennzahlen und Suche ohne die Türanlagen (Teilprüfungen zählen erst mit dem Abschluss der Türanlage)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.startseite_kennzahlen(p_heute date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with anlagen as (
    select a.id, t.anlagenart, a.naechste_pruefung_am
    from anlage a
    join anlagentyp t on t.id = a.anlagentyp_id
    join objekt o on o.id = a.objekt_id
    join endkunde k on k.id = o.endkunde_id
    where a.status = 'aktiv' and o.aktiv and k.aktiv and t.anlagenart <> 'tueranlage'
  ),
  pruefungen as (
    select p.ergebnis, coalesce(p.beendet_am, p.begonnen_am)::date as am, t.anlagenart
    from anlagenpruefung p
    join anlage a on a.id = p.anlage_id
    join anlagentyp t on t.id = a.anlagentyp_id
    where p.status = 'geprueft' and t.anlagenart <> 'tueranlage' and (p.teil_von_id is null or p.abgeschlossen_am is not null)
  ),
  jahr as (select * from pruefungen where am >= date_trunc('year', p_heute)::date and am <= p_heute),
  monate as (
    select to_char(m, 'YYYY-MM') as monat, m::date as von, (m + interval '1 month')::date as bis
    from generate_series(date_trunc('month', p_heute) - interval '11 months', date_trunc('month', p_heute), interval '1 month') m
  )
  select jsonb_build_object(
    'anlagen', (select count(*) from anlagen),
    'anlagen_je_art', (select coalesce(jsonb_object_agg(anlagenart, n), '{}') from (select anlagenart, count(*) as n from anlagen group by 1) x),
    'elemente', (select count(*) from anlage_element e join anlagen a on a.id = e.anlage_id where e.aktiv),
    'ueberfaellig', (select count(*) from anlagen where naechste_pruefung_am < p_heute),
    'faellig_30', (select count(*) from anlagen where naechste_pruefung_am between p_heute and p_heute + 30),
    'geprueft_gesamt', (select count(*) from pruefungen),
    'geprueft_jahr', (select count(*) from jahr),
    'geprueft_vorjahr', (select count(*) from pruefungen
                         where am >= (date_trunc('year', p_heute) - interval '1 year')::date and am <= (p_heute - interval '1 year')::date),
    'jahr_je_art', (select coalesce(jsonb_object_agg(anlagenart, jsonb_build_object(
                      'gruen', g, 'gelb', y, 'rot', r)), '{}')
                    from (select anlagenart, count(*) filter (where ergebnis = 'gruen') as g, count(*) filter (where ergebnis = 'gelb') as y,
                                 count(*) filter (where ergebnis = 'rot') as r
                          from jahr group by 1) x),
    'monate', (select jsonb_agg(jsonb_build_object('monat', m.monat,
                 'gruen', (select count(*) from pruefungen p where p.am >= m.von and p.am < m.bis and p.ergebnis = 'gruen'),
                 'gelb', (select count(*) from pruefungen p where p.am >= m.von and p.am < m.bis and p.ergebnis = 'gelb'),
                 'rot', (select count(*) from pruefungen p where p.am >= m.von and p.am < m.bis and p.ergebnis = 'rot')) order by m.monat)
               from monate m),
    'maengel', (select jsonb_build_object(
                  '1', count(*) filter (where m.stufe = 1), '2', count(*) filter (where m.stufe = 2), '3', count(*) filter (where m.stufe = 3))
                from mangel m join anlagen a on a.id = m.anlage_id where m.status = 'offen')
  );
$function$;


CREATE OR REPLACE FUNCTION public.anlage_suche(p_text text, p_limit integer DEFAULT 50, p_objekte jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(id uuid, etikett_id text, kunden_bezeichnung text, gebaeude text, etage text, raum text, lage_beschreibung text, status anlage_status, naechste_pruefung_am date, anlagentyp text, objekt_id uuid, objekt text, objekt_ort text, kunde text, endkunde_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with woerter as (
    select w from unnest(regexp_split_to_array(lower(trim(coalesce(p_text, ''))), '\s+')) w where w <> ''
  ),
  listen as (
    select l.e from jsonb_array_elements(case when jsonb_typeof(p_objekte) = 'array' then p_objekte else '[]'::jsonb end) as l (e)
  ),
  kandidaten as (
    select t.*, ty.name as typ_name, o.name as o_name, o.ort as o_ort, k.id as k_id, k.name as k_name,
           lower(concat_ws(' ',
             t.etikett_id, t.kunden_bezeichnung, t.gebaeude, t.etage, t.raum, t.lage_beschreibung,
             t.hersteller, t.modell,
             (select string_agg(e.value, ' ') from jsonb_each_text(t.eigenschaften) e where not coalesce(ist_geheimtext(e.value), false)),
             ty.name,
             (select string_agg(x, ' ') from unnest(array[o.name, o.strasse, o.plz, o.ort, k.name, k.strasse, k.plz, k.ort, k.ansprechpartner]) x
               where not coalesce(ist_geheimtext(x), false)))) as suchtext
    from anlage t
    join anlagentyp ty on ty.id = t.anlagentyp_id
    join objekt o on o.id = t.objekt_id
    join endkunde k on k.id = o.endkunde_id
    where t.anlagentyp_id <> tueranlage_typ()
  )
  select c.id, c.etikett_id, c.kunden_bezeichnung, c.gebaeude, c.etage, c.raum, c.lage_beschreibung,
         c.status, c.naechste_pruefung_am, c.typ_name, c.objekt_id, c.o_name, c.o_ort, c.k_name, c.k_id
  from kandidaten c
  where (exists (select 1 from woerter) or exists (select 1 from listen))
    and not exists (select 1 from woerter
                     where position(w in c.suchtext) = 0
                       and not exists (select 1 from listen l where jsonb_typeof(l.e) = 'object' and l.e ->> 'w' = w
                                         and coalesce((l.e -> 'ids') @> to_jsonb(c.objekt_id::text), false)))
    and not exists (select 1 from listen l where jsonb_typeof(l.e) <> 'object' and not coalesce(jsonb_typeof(l.e) = 'array' and l.e @> to_jsonb(c.objekt_id::text), false))
  order by (lower(c.etikett_id) = lower(trim(p_text))) desc nulls last,
           (c.status = 'aktiv') desc, c.k_name, c.o_name, c.gebaeude, c.etage, c.kunden_bezeichnung
  limit least(greatest(p_limit, 1), 200);
$function$;

