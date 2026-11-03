-- Unterschrift je Prüfung (Abstimmung 2026-10-30):
--   1. Hinweistext unter dem Protokoll: „… machen diese Anlage nicht betriebssicher“ statt „die Tür“ (nur, wenn der
--      Vorgabetext noch unverändert ist – ein eigener Text bleibt).
--   2. Unterschriftsdateien bleiben nur, bis das Protokoll der Revision gespeichert ist. Danach löscht die App die
--      Dateien (Hauptprüfer, Mitprüfer, Kunde) aus dem Speicher „unterschriften“ und leert die Pfade; die Zeitpunkte
--      (unterschrift_am, fertig_am, kunde_unterschrift_am) bleiben als Nachweis. Die Unterschrift steht danach nur im PDF.
--   3. Wieder öffnen: alle Unterschriften erlöschen – Hauptprüfer, Mitprüfer und Kunde unterschreiben neu. Die Regel
--      „Unterschriften bleiben gültig, solange die eigenen Einträge unverändert sind“ gilt nur noch innerhalb einer Revision.

-- ---------------------------------------------------------------------------
-- 1. Hinweistext
-- ---------------------------------------------------------------------------
update firma
   set protokoll_hinweis = 'Die Prüfung erfolgte nach bestem Wissen anhand der angegebenen Checkliste. Festgestellte Mängel sind zeitnah zu beseitigen; Mängel der Stufe 3 machen diese Anlage nicht betriebssicher.'
 where protokoll_hinweis = 'Die Prüfung erfolgte nach bestem Wissen anhand der angegebenen Checkliste. Festgestellte Mängel sind zeitnah zu beseitigen; Mängel der Stufe 3 machen die Tür nicht betriebssicher.';

-- ---------------------------------------------------------------------------
-- 2. Unterschriftsdateien löschen, sobald das Protokoll da ist
-- ---------------------------------------------------------------------------
-- Dateien der Prüfung liegen unter <Prüfung>/<Datei>.png. Löschen dürfen Beteiligte (Haupt- und Mitprüfer) und Admins,
-- sobald die Prüfung abgeschlossen und das Protokoll ihrer aktuellen Revision gespeichert ist.
create function unterschrift_loeschbar(p_pfad text) returns boolean
language sql stable security definer set search_path = public as $$
  select ist_aktiv() and exists (
    select 1 from anlagenpruefung ap
     where ap.id::text = split_part(p_pfad, '/', 1) and ap.session_id is null
       and ap.status = 'geprueft' and ap.abgeschlossen_am is not null
       and exists (select 1 from protokoll pr where pr.anlagenpruefung_id = ap.id and pr.session_id is null and pr.revision = ap.revision)
       and (ap.pruefer_id = auth.uid() or ist_admin() or exists (
             select 1 from anlagenpruefung_mitpruefer mp
              where mp.anlagenpruefung_id = ap.id and mp.benutzer_id = auth.uid() and mp.status in ('zugelassen', 'entfernt'))));
$$;
revoke all on function unterschrift_loeschbar(text) from public, anon;
grant execute on function unterschrift_loeschbar(text) to authenticated;

create policy unterschriften_loeschen on storage.objects for delete to authenticated
  using (bucket_id = 'unterschriften' and public.unterschrift_loeschbar(name));

-- Pfade leeren, nachdem die App die Dateien gelöscht hat. Die Zeitpunkte bleiben: die Prüfung gilt weiter als unterschrieben.
create function unterschriften_bereinigen(p_anlagenpruefung_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  tp anlagenpruefung;
begin
  select * into tp from anlagenpruefung where id = p_anlagenpruefung_id for update;
  if tp.id is null then raise exception 'Prüfung nicht gefunden'; end if;
  if not ist_aktiv() or not (tp.pruefer_id = auth.uid() or ist_admin() or exists (
       select 1 from anlagenpruefung_mitpruefer mp
        where mp.anlagenpruefung_id = tp.id and mp.benutzer_id = auth.uid() and mp.status in ('zugelassen', 'entfernt'))) then
    raise exception 'Nur Beteiligte oder Admins';
  end if;
  if tp.session_id is not null or tp.status <> 'geprueft' or tp.abgeschlossen_am is null then
    raise exception 'Die Prüfung ist nicht abgeschlossen';
  end if;
  if not exists (select 1 from protokoll pr where pr.anlagenpruefung_id = tp.id and pr.session_id is null and pr.revision = tp.revision) then
    raise exception 'Das Protokoll dieser Revision ist noch nicht gespeichert';
  end if;
  perform set_config('anlagenpruefung.intern', 'ja', true);
  update anlagenpruefung set unterschrift = null, kunde_unterschrift = null
   where id = tp.id and (unterschrift is not null or kunde_unterschrift is not null);
  update anlagenpruefung_mitpruefer set unterschrift = null
   where anlagenpruefung_id = tp.id and unterschrift is not null;
  perform set_config('anlagenpruefung.intern', '', true);
end $$;
revoke execute on function unterschriften_bereinigen(uuid) from public, anon;
grant execute on function unterschriften_bereinigen(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Wieder öffnen: alle unterschreiben neu
-- ---------------------------------------------------------------------------
create or replace function pruefung_wieder_oeffnen(p_anlagenpruefung_id uuid, p_grund text, p_pruefer_id uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  tp anlagenpruefung;
  neu uuid;
  art text;
  art_name text;
  pflicht boolean;
begin
  select * into tp from anlagenpruefung where id = p_anlagenpruefung_id for update;
  if tp.id is null then raise exception 'Prüfung nicht gefunden'; end if;
  if tp.session_id is not null then raise exception 'Prüfungen aus der Zeit der Sessions bleiben abgeschlossen – bitte die Anlage erneut prüfen'; end if;
  if tp.abgeschlossen_am is null or tp.status <> 'geprueft' then raise exception 'Nur abgeschlossene Prüfungen können wieder geöffnet werden'; end if;
  if nullif(trim(p_grund), '') is null then raise exception 'Bitte den Grund angeben'; end if;
  if not ist_admin() then
    if not (tp.pruefer_id = auth.uid() and ist_aktiv()) then raise exception 'Nur der Prüfer oder ein Admin kann die Prüfung wieder öffnen'; end if;
    if (tp.abgeschlossen_am at time zone 'Europe/Berlin')::date <> (now() at time zone 'Europe/Berlin')::date then
      raise exception 'Nach dem Tag des Abschlusses kann nur ein Admin die Prüfung wieder öffnen';
    end if;
  end if;
  if exists (select 1 from anlagenpruefung where session_id is null and anlage_id = tp.anlage_id and status = 'in_pruefung') then
    raise exception 'Diese Anlage wird gerade geprüft. Bitte zuerst diese Prüfung abschließen oder abbrechen.';
  end if;
  neu := coalesce(p_pruefer_id, tp.pruefer_id);
  if neu <> tp.pruefer_id then
    if not ist_admin() then raise exception 'Nur ein Admin kann einen anderen Prüfer einsetzen'; end if;
    if not exists (select 1 from benutzer where id = neu and aktiv and (aktiv_bis is null or aktiv_bis > now())) then
      raise exception 'Der neue Prüfer ist nicht aktiv';
    end if;
    select ty.anlagenart, ar.name, ar.sachkunde_pflicht into art, art_name, pflicht
      from anlage a join anlagentyp ty on ty.id = a.anlagentyp_id join anlagenart ar on ar.schluessel = ty.anlagenart
     where a.id = tp.anlage_id;
    if pflicht and not hat_sachkunde(neu, art) then
      raise exception 'Für % ist beim neuen Prüfer keine gültige Sachkunde hinterlegt', art_name;
    end if;
  end if;

  insert into anlagenpruefung_revision (anlagenpruefung_id, revision, grund) values (tp.id, tp.revision + 1, trim(p_grund));
  perform set_config('anlagenpruefung.intern', 'ja', true);
  -- Alle Unterschriften erlöschen: Mitprüfer melden ihren Teil neu fertig, Hauptprüfer und Kunde unterschreiben neu
  update anlagenpruefung_mitpruefer set unterschrift = null, fertig_am = null
   where anlagenpruefung_id = tp.id and (unterschrift is not null or fertig_am is not null);
  if neu <> tp.pruefer_id then
    -- Der bisherige Prüfer bleibt als Mitprüfer beteiligt (ohne Unterschrift); der neue wird Hauptprüfer
    delete from anlagenpruefung_mitpruefer where anlagenpruefung_id = tp.id and benutzer_id = neu;
    insert into anlagenpruefung_mitpruefer (anlagenpruefung_id, benutzer_id, status, entschieden_am, unterschrift, fertig_am)
      values (tp.id, tp.pruefer_id, 'zugelassen', now(), null, null)
      on conflict (anlagenpruefung_id, benutzer_id) do update
        set status = 'zugelassen', entschieden_am = now(), unterschrift = null, fertig_am = null;
    perform set_config('anlagenpruefung.uebernehmen', 'ja', true);
    update anlagenpruefung
       set pruefer_id = neu, urspruenglicher_pruefer_id = coalesce(urspruenglicher_pruefer_id, tp.pruefer_id), uebernommen_am = now()
     where id = tp.id;
    perform set_config('anlagenpruefung.uebernehmen', '', true);
  end if;
  -- beendet_am bleibt: das Prüfdatum ändert sich durch eine Korrektur nicht
  update anlagenpruefung
     set status = 'in_pruefung', abgeschlossen_am = null, revision = tp.revision + 1, letzte_aktivitaet = now(),
         unterschrift = null, unterschrift_am = null, kunde_name = null, kunde_unterschrift = null, kunde_unterschrift_am = null
   where id = tp.id;
  perform set_config('anlagenpruefung.intern', '', true);
  return tp.revision + 1;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Abschluss-Trigger: ein erneuter Sync desselben Abschlusses bleibt harmlos, auch wenn die Unterschriftsdateien
--    inzwischen entfernt sind (das Gerät schickt den alten Pfad mit)
-- ---------------------------------------------------------------------------
create or replace function anlagenpruefung_abschluss() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  offen text;
begin
  if new.session_id is not null or coalesce(current_setting('anlagenpruefung.intern', true), '') = 'ja'
     or coalesce(current_setting('session.revision', true), '') = 'ja' then
    return new;
  end if;

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

-- PostgREST: Schema neu laden
notify pgrst, 'reload schema';
