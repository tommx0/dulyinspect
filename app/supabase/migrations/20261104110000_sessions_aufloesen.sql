-- Abschluss des Umstiegs auf „Prüfung je Anlage“: offene Sessions auflösen, Sessions nur noch lesen,
-- alte Session-Funktionen entfernen. Abgeschlossene Sessions bleiben mit ihren Protokollen unverändert abrufbar.
--
-- Offene Sessions:
--   * laufende Prüfungen laufen ohne Session weiter (beim selben Prüfer)
--   * in der Session schon beendete Prüfungen: Hat der Prüfer (und jeder zugelassene Mitprüfer) mit „fertig melden“
--     unterschrieben, gilt diese Unterschrift – die Prüfung wird abgeschlossen und bekommt ihre Protokollnummer.
--     Sonst läuft sie weiter (Prüfdatum bleibt) und braucht noch Unterschrift und Abschluss.
--   * „nicht geprüft“-Vermerke entfallen (die Anlage bleibt einfach fällig)
--   * Sessions in Revision (wieder geöffnet): unveränderte Prüfungen bleiben in der Session, die damit wieder im
--     Stand vor der Revision abgeschlossen ist; seit dem Wiederöffnen geänderte laufen einzeln weiter.
--   * Leere Sessions werden gelöscht.

select set_config('session.revision', 'ja', true);  -- Wartung: Sperren abgeschlossener Prüfungen gelten hier nicht

-- ---------------------------------------------------------------------------
-- 1. Prüfungen gehören zu keiner Session mehr (vor dem Auflösen: Session darf beim Auflösen wegfallen)
-- ---------------------------------------------------------------------------
create or replace function anlagenpruefung_vor_einfuegen() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  vorhanden uuid;
  art text;
  art_name text;
  pflicht boolean;
  wiederherstellung boolean := coalesce(current_setting('session.revision', true), '') = 'ja';
begin
  if not wiederherstellung then
    if new.session_id is not null then raise exception 'Prüfungen gehören zu keiner Session mehr'; end if;
    if new.status = 'nicht_geprueft' then
      raise exception 'Nicht geprüfte Anlagen bleiben einfach fällig – dafür gibt es keinen Eintrag mehr';
    end if;
  end if;
  -- Übernahme-Vermerk entsteht nur in pruefung_uebernehmen/pruefung_wieder_oeffnen (bzw. kommt aus einer Wiederherstellung)
  if not wiederherstellung and coalesce(current_setting('anlagenpruefung.uebernehmen', true), '') <> 'ja' then
    new.urspruenglicher_pruefer_id := null;
    new.uebernommen_am := null;
  end if;
  if new.pruefart_id is null then
    select p.id into new.pruefart_id from pruefart p join anlage a on a.anlagentyp_id = p.anlagentyp_id
     where a.id = new.anlage_id and p.aktiv order by p.reihenfolge, p.name limit 1;
    if new.pruefart_id is null then
      raise exception 'Für diesen Typ ist keine Prüfart angelegt. Admin: unter „Typen“ eine Prüfart ergänzen.';
    end if;
  elsif not wiederherstellung and not exists (
      select 1 from pruefart p join anlage a on a.anlagentyp_id = p.anlagentyp_id where a.id = new.anlage_id and p.id = new.pruefart_id) then
    raise exception 'Die Prüfart passt nicht zum Typ der Anlage';
  end if;
  -- Sachkunde: nur wenn für die Art eingeschaltet
  if not wiederherstellung then
    select ty.anlagenart, ar.name, ar.sachkunde_pflicht into art, art_name, pflicht
      from anlage a join anlagentyp ty on ty.id = a.anlagentyp_id join anlagenart ar on ar.schluessel = ty.anlagenart
     where a.id = new.anlage_id;
    if pflicht and not hat_sachkunde(new.pruefer_id, art) then
      raise exception 'Für % ist bei Ihnen keine gültige Sachkunde hinterlegt. Admin: unter „Benutzer“ eintragen.', art_name;
    end if;
  end if;
  if new.status <> 'duplikat' and new.session_id is null then
    -- Doppelt ist eine Prüfung, die zeitlich mit einer anderen derselben Anlage zusammenfällt (offline begonnen);
    -- eine spätere Prüfung nach dem Abschluss der ersten ist eine neue Prüfung
    select p.id into vorhanden from anlagenpruefung p
     where p.session_id is null and p.anlage_id = new.anlage_id and p.status <> 'duplikat' and p.id <> new.id
       and p.begonnen_am < coalesce(new.beendet_am, 'infinity')
       and new.begonnen_am < case when p.abgeschlossen_am is null then 'infinity' else p.beendet_am end
     order by p.begonnen_am limit 1;
    if vorhanden is not null then
      new.status := 'duplikat';
      new.duplikat_von := vorhanden;
      new.duplikat_geklaert := false;
    end if;
  end if;
  return new;
end $$;

create or replace function anlagenpruefung_vor_aendern() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Einzige Ausnahme: beim Auflösen der letzten Sessions (Wartung, session.revision) verlässt die Prüfung ihre Session
  if (new.session_id is distinct from old.session_id
      and not (new.session_id is null and coalesce(current_setting('session.revision', true), '') = 'ja'))
     or new.anlage_id <> old.anlage_id
     or (new.pruefer_id <> old.pruefer_id and coalesce(current_setting('anlagenpruefung.uebernehmen', true), '') <> 'ja') then
    raise exception 'Anlage und Prüfer einer Prüfung sind unveränderlich';
  end if;
  -- Ein Duplikat bleibt Duplikat, bis es geklärt wird (Sync des Geräts darf das nicht überschreiben)
  if old.status = 'duplikat' and new.status <> 'duplikat'
     and coalesce(current_setting('anlagenpruefung.aufloesen', true), '') <> 'ja' then
    new.status := 'duplikat';
    new.duplikat_von := old.duplikat_von;
    new.duplikat_geklaert := old.duplikat_geklaert;
  end if;
  -- Übernahme-Vermerk kann das Gerät nicht verändern
  if coalesce(current_setting('anlagenpruefung.uebernehmen', true), '') <> 'ja' then
    new.urspruenglicher_pruefer_id := old.urspruenglicher_pruefer_id;
    new.uebernommen_am := old.uebernommen_am;
  end if;
  -- Prüfart wird beim Anlegen geprüft und bleibt dann (still, damit ein veralteter Sync nicht scheitert)
  if not ist_admin() and coalesce(current_setting('session.revision', true), '') <> 'ja' then
    new.pruefart_id := old.pruefart_id;
  end if;
  return new;
end $$;


-- ---------------------------------------------------------------------------
-- 2. Offene Sessions auflösen
-- ---------------------------------------------------------------------------
do $$
declare
  s record;
  p record;
  rev_am timestamptz;
  sig record;
  ohne_unterschrift boolean;
  laufend uuid;
begin
  for s in select * from session where status = 'offen' order by begonnen_am loop
    rev_am := (select am from session_revision where session_id = s.id and revision = s.revision);
    for p in select * from anlagenpruefung where session_id = s.id order by begonnen_am, id loop
      -- Revision einer abgeschlossenen Session: Unverändertes bleibt im alten (abgeschlossenen) Stand
      if s.revision > 0 and p.status <> 'in_pruefung' and not (
           p.geaendert_am > rev_am
           or exists (select 1 from antwort a where a.anlagenpruefung_id = p.id and a.geaendert_am > rev_am)
           or exists (select 1 from element_ergebnis e where e.anlagenpruefung_id = p.id and e.geaendert_am > rev_am)
           or exists (select 1 from mangel m where (m.entdeckt_in = p.id or m.nachgeprueft_in = p.id) and m.geaendert_am > rev_am)) then
        continue;
      end if;

      if p.status = 'nicht_geprueft' then
        if not exists (select 1 from mangel where entdeckt_in = p.id) then
          delete from foto where bezug_typ = 'antwort' and bezug_id in (select id from antwort where anlagenpruefung_id = p.id);
          delete from antwort where anlagenpruefung_id = p.id;
          delete from element_ergebnis where anlagenpruefung_id = p.id;
          delete from anlagenpruefung_mitpruefer where anlagenpruefung_id = p.id;
          delete from anlagenpruefung where id = p.id;
        end if;
        continue;
      end if;

      update anlagenpruefung_mitpruefer set session_id = null where anlagenpruefung_id = p.id;

      if p.status = 'duplikat' then
        update anlagenpruefung set session_id = null where id = p.id;
        continue;
      end if;

      -- In der Session beendet (nicht in einer Revision): Unterschrift aus „fertig melden“, wenn alle unterschrieben haben
      if p.status = 'geprueft' and s.revision = 0 then
        select t.unterschrift, t.fertig_am into sig from session_teilnehmer t
         where t.session_id = s.id and t.benutzer_id = p.pruefer_id and t.fertig_am is not null and t.unterschrift is not null;
        ohne_unterschrift := sig.unterschrift is null or exists (
          select 1 from anlagenpruefung_mitpruefer m
           where m.anlagenpruefung_id = p.id and m.status = 'zugelassen' and not exists (
             select 1 from session_teilnehmer t where t.session_id = s.id and t.benutzer_id = m.benutzer_id
                and t.fertig_am is not null and t.unterschrift is not null));
        if not ohne_unterschrift then
          update anlagenpruefung_mitpruefer m set unterschrift = t.unterschrift, fertig_am = t.fertig_am
            from session_teilnehmer t
           where m.anlagenpruefung_id = p.id and m.status = 'zugelassen' and t.session_id = s.id and t.benutzer_id = m.benutzer_id;
          update anlagenpruefung
             set session_id = null, unterschrift = sig.unterschrift, unterschrift_am = sig.fertig_am,
                 abgeschlossen_am = now(), protokoll_nr = naechste_protokoll_nr()
           where id = p.id;
          continue;
        end if;
      end if;

      -- Läuft (weiter): höchstens eine laufende Prüfung je Anlage, eine weitere wird Doppelprüfung
      select id into laufend from anlagenpruefung
       where session_id is null and anlage_id = p.anlage_id and status = 'in_pruefung' and id <> p.id limit 1;
      update anlagenpruefung
         set session_id = null,
             status = case when laufend is null then 'in_pruefung'::pruefung_status else 'duplikat' end,
             duplikat_von = laufend, duplikat_geklaert = case when laufend is null then duplikat_geklaert else false end,
             unterschrift = null, unterschrift_am = null, abgeschlossen_am = null, protokoll_nr = null
       where id = p.id;
      update anlagenpruefung_mitpruefer set unterschrift = null, fertig_am = null where anlagenpruefung_id = p.id;
    end loop;

    update anlagenpruefung_freigabe set session_id = null where session_id = s.id;

    if s.revision > 0 then
      -- zurück in den abgeschlossenen Stand vor der Revision (der Grund bleibt im Audit-Log)
      delete from session_revision where session_id = s.id and revision = s.revision;
      update session set status = 'abgeschlossen', revision = s.revision - 1,
             abgeschlossen_am = coalesce((select max(erzeugt_am) from protokoll where session_id = s.id and revision = s.revision - 1), now())
       where id = s.id;
    elsif not exists (select 1 from anlagenpruefung where session_id = s.id)
          and not exists (select 1 from session z where z.zusammengefuehrt_in = s.id)
          and not exists (select 1 from protokoll where session_id = s.id) then
      delete from session_teilnehmer where session_id = s.id;
      delete from session where id = s.id;
    else
      update session set status = 'abgeschlossen', abgeschlossen_am = now(),
             bemerkung = concat_ws(E'\n', bemerkung, 'Beim Umstieg auf „Prüfung je Anlage“ aufgelöst.')
       where id = s.id;
    end if;
  end loop;
end $$;

-- Ab jetzt gibt es nur noch abgeschlossene Sessions
alter table session add constraint session_nur_abgeschlossen check (status = 'abgeschlossen');

-- ---------------------------------------------------------------------------
-- 3. Sessions nur noch lesen; Prüfungen aus Sessions sind gesperrt
-- ---------------------------------------------------------------------------
drop policy session_admin on session;
drop policy session_teilnehmer_admin on session_teilnehmer;
drop policy teilnehmer_aendern on session_teilnehmer;

drop policy anlagenpruefung_anlegen on anlagenpruefung;
create policy anlagenpruefung_anlegen on anlagenpruefung for insert to authenticated
  with check (pruefer_id = auth.uid() and session_id is null and ist_aktiv());
drop policy anlagenpruefung_aendern on anlagenpruefung;
create policy anlagenpruefung_aendern on anlagenpruefung for update to authenticated
  using (pruefer_id = auth.uid() and session_id is null)
  with check (pruefer_id = auth.uid() and session_id is null);

create or replace function pruefung_gesperrt(p_anlagenpruefung_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.session_id is not null or p.abgeschlossen_am is not null
                     from anlagenpruefung p where p.id = p_anlagenpruefung_id), false);
$$;

create or replace function session_sperre() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  pid uuid;
begin
  -- Wartung: Löschen mit Service-Role (z. B. Testdaten aufräumen) ist erlaubt, nie aus der App
  if coalesce(current_setting('session.revision', true), '') = 'ja' or (tg_op = 'DELETE' and auth.role() = 'service_role') then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'anlagenpruefung' then
    -- Prüfungen ohne Session sperrt anlagenpruefung_abschluss
    if coalesce(new.session_id, old.session_id) is not null then
      raise exception 'Die Prüfung ist abgeschlossen und kann nicht mehr geändert werden';
    end if;
    return coalesce(new, old);
  end if;
  pid := coalesce(new.anlagenpruefung_id, old.anlagenpruefung_id);
  if tg_op = 'DELETE' and not exists (select 1 from anlagenpruefung where id = pid) then
    return old;  -- Prüfung wird gerade gelöscht (Kaskade)
  end if;
  if pruefung_gesperrt(pid) then
    raise exception 'Die Prüfung ist abgeschlossen und kann nicht mehr geändert werden';
  end if;
  return coalesce(new, old);
end $$;

create or replace function foto_sperre() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r foto;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  if coalesce(current_setting('session.revision', true), '') = 'ja' or (tg_op = 'DELETE' and auth.role() = 'service_role') then
    return r;
  end if;
  if pruefung_gesperrt(foto_pruefung(r.bezug_typ, r.bezug_id)) then
    raise exception 'Die Prüfung ist abgeschlossen und kann nicht mehr geändert werden';
  end if;
  if tg_op = 'UPDATE' and (new.bezug_typ <> old.bezug_typ or new.bezug_id <> old.bezug_id)
     and pruefung_gesperrt(foto_pruefung(old.bezug_typ, old.bezug_id)) then
    raise exception 'Die Prüfung ist abgeschlossen und kann nicht mehr geändert werden';
  end if;
  return r;
end $$;

drop policy anlagenpruefung_freigabe_lesen on anlagenpruefung_freigabe;
create policy anlagenpruefung_freigabe_lesen on anlagenpruefung_freigabe for select to authenticated
  using (pruefer_id = auth.uid() or ist_admin());

-- ---------------------------------------------------------------------------
-- 4. Abschluss, Mitprüfen, Freigeben, Doppelprüfungen ohne Session-Zweige;
--    eine andere Bewertung früherer Mängel lässt die Unterschrift des Hauptprüfers erlöschen
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
      -- Erneuter Sync desselben Abschlusses ist harmlos, jede andere Änderung braucht pruefung_wieder_oeffnen
      if (new.status, new.ergebnis, new.ergebnis_auto, new.ergebnis_begruendung, new.beendet_am, new.unterschrift,
          new.kunde_name, new.kunde_unterschrift, new.altmaengel, new.checkliste_version_id)
         is not distinct from
         (old.status, old.ergebnis, old.ergebnis_auto, old.ergebnis_begruendung, old.beendet_am, old.unterschrift,
          old.kunde_name, old.kunde_unterschrift, old.altmaengel, old.checkliste_version_id) then
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

create or replace function mitpruefung_anfragen(p_anlagenpruefung_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  tp anlagenpruefung;
  erlaubt boolean;
  art text;
  art_name text;
  pflicht boolean;
  ergebnis text;
begin
  select * into tp from anlagenpruefung where id = p_anlagenpruefung_id;
  if tp.id is null then raise exception 'Prüfung nicht gefunden'; end if;
  if not ist_aktiv() then raise exception 'Nicht angemeldet oder deaktiviert'; end if;
  if pruefung_gesperrt(tp.id) then raise exception 'Die Prüfung ist bereits abgeschlossen'; end if;
  if tp.status <> 'in_pruefung' then raise exception 'Diese Anlage wird nicht mehr geprüft'; end if;
  if tp.pruefer_id = auth.uid() then raise exception 'Das ist Ihre eigene Prüfung'; end if;
  select ty.mehrpersonenpruefung, ty.anlagenart, ar.name, ar.sachkunde_pflicht into erlaubt, art, art_name, pflicht
    from anlage a join anlagentyp ty on ty.id = a.anlagentyp_id join anlagenart ar on ar.schluessel = ty.anlagenart
   where a.id = tp.anlage_id;
  if not coalesce(erlaubt, false) then raise exception 'Für diesen Anlagentyp ist keine Mehrpersonenprüfung eingeschaltet'; end if;
  if pflicht and not hat_sachkunde(auth.uid(), art) then
    raise exception 'Für % ist bei Ihnen keine gültige Sachkunde hinterlegt. Admin: unter „Benutzer“ eintragen.', art_name;
  end if;
  perform set_config('anlagenpruefung.intern', 'ja', true);
  insert into anlagenpruefung_mitpruefer (anlagenpruefung_id, benutzer_id)
    values (tp.id, auth.uid())
    on conflict (anlagenpruefung_id, benutzer_id) do update
      set status = 'angefragt', angefragt_am = now(), entschieden_am = null, unterschrift = null, fertig_am = null
      where anlagenpruefung_mitpruefer.status in ('abgelehnt', 'entfernt');
  perform set_config('anlagenpruefung.intern', '', true);
  select status into ergebnis from anlagenpruefung_mitpruefer where anlagenpruefung_id = tp.id and benutzer_id = auth.uid();
  return ergebnis;
end $$;

create or replace function mitpruefung_beenden(p_anlagenpruefung_id uuid, p_benutzer_id uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  tp anlagenpruefung;
  wer uuid := coalesce(p_benutzer_id, auth.uid());
begin
  select * into tp from anlagenpruefung where id = p_anlagenpruefung_id;
  if tp.id is null then return; end if;
  if not (tp.pruefer_id = auth.uid() or wer = auth.uid()) then
    raise exception 'Nur der Hauptprüfer oder der Mitprüfer selbst kann das beenden';
  end if;
  if pruefung_gesperrt(tp.id) then raise exception 'Die Prüfung ist bereits abgeschlossen'; end if;
  perform set_config('anlagenpruefung.intern', 'ja', true);
  update anlagenpruefung_mitpruefer set status = 'entfernt', unterschrift = null, fertig_am = null
   where anlagenpruefung_id = tp.id and benutzer_id = wer and status <> 'entfernt';
  perform set_config('anlagenpruefung.intern', '', true);
end $$;

create or replace function reservierung_aufheben(p_anlagenpruefung_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  tp anlagenpruefung;
begin
  select * into tp from anlagenpruefung where id = p_anlagenpruefung_id;
  if tp.id is null then return; end if;
  if not (tp.pruefer_id = auth.uid() or ist_admin()) then
    raise exception 'Nur der Prüfer selbst oder ein Admin kann die Prüfung freigeben';
  end if;
  if tp.status <> 'in_pruefung' then raise exception 'Nur laufende Prüfungen können freigegeben werden'; end if;
  if tp.revision > 0 then raise exception 'Eine wieder geöffnete Prüfung kann nicht verworfen werden – bitte wieder abschließen'; end if;
  if tp.pruefer_id <> auth.uid() then
    insert into anlagenpruefung_freigabe (id, anlage_id, pruefer_id)
      values (tp.id, tp.anlage_id, tp.pruefer_id) on conflict (id) do nothing;
  end if;
  -- Alles der Prüfung entfällt; Unterschriften gibt es hier noch keine (revision 0, nicht abgeschlossen)
  perform set_config('anlagenpruefung.intern', 'ja', true);
  -- In dieser Prüfung als behoben bestätigte frühere Mängel wieder öffnen
  update mangel set status = case when behoben_am is not null then 'behoben'::mangel_status else 'offen'::mangel_status end, nachgeprueft_in = null
   where nachgeprueft_in = tp.id;
  delete from foto where bezug_typ = 'mangel' and bezug_id in (select id from mangel where entdeckt_in = tp.id);
  delete from foto where bezug_typ = 'antwort' and bezug_id in (select id from antwort where anlagenpruefung_id = tp.id);
  delete from element_ergebnis where anlagenpruefung_id = tp.id;
  delete from mangel where entdeckt_in = tp.id;
  delete from antwort where anlagenpruefung_id = tp.id;
  delete from anlagenpruefung where id = tp.id;
  perform set_config('anlagenpruefung.intern', '', true);
end $$;

create or replace function duplikat_aufloesen(p_gueltig uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  tp anlagenpruefung;
  erste uuid;
begin
  select * into tp from anlagenpruefung where id = p_gueltig;
  if tp.id is null then raise exception 'Prüfung nicht gefunden'; end if;
  if tp.session_id is not null then raise exception 'Prüfungen aus der Zeit der Sessions sind abgeschlossen'; end if;
  erste := coalesce(tp.duplikat_von, tp.id);
  if not (ist_admin() or (ist_aktiv() and exists (
      select 1 from anlagenpruefung where (id = erste or duplikat_von = erste) and pruefer_id = auth.uid()))) then
    raise exception 'Nur die beteiligten Prüfer oder ein Admin können Doppelprüfungen klären';
  end if;
  perform set_config('anlagenpruefung.aufloesen', 'ja', true);
  perform set_config('anlagenpruefung.intern', 'ja', true);
  update anlagenpruefung set status = 'duplikat', duplikat_von = tp.id, duplikat_geklaert = true
   where (id = erste or duplikat_von = erste) and id <> tp.id;
  update anlagenpruefung
     set status = case when abgeschlossen_am is not null then 'geprueft'::pruefung_status else 'in_pruefung' end,
         protokoll_nr = case when abgeschlossen_am is not null then coalesce(protokoll_nr, naechste_protokoll_nr()) end,
         duplikat_von = null, duplikat_geklaert = true
   where id = tp.id;
  perform set_config('anlagenpruefung.intern', '', true);
  perform set_config('anlagenpruefung.aufloesen', '', true);
end $$;

-- Freigegebene Prüfung (Admin): Hinweis ohne Sessionleitung
create or replace function anlagenpruefung_nicht_freigegeben() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from anlagenpruefung_freigabe where id = new.id) then
    raise exception 'Diese Prüfung wurde von einem Admin freigegeben und kann nicht mehr übertragen werden';
  end if;
  return new;
end $$;

-- Änderungen einer Revision: auch die Bewertung früherer Mängel
create or replace function revision_ergebnis() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.session_id is null and new.revision > 0
     and (new.ergebnis, new.ergebnis_begruendung, new.altmaengel) is distinct from (old.ergebnis, old.ergebnis_begruendung, old.altmaengel)
     and coalesce(current_setting('session.revision', true), '') <> 'ja' then
    insert into anlagenpruefung_aenderung (anlagenpruefung_id, revision, tabelle, datensatz_id, aktion, alt, neu)
    values (new.id, new.revision, 'anlagenpruefung', new.id, 'UPDATE',
            jsonb_build_object('ergebnis', old.ergebnis, 'ergebnis_begruendung', old.ergebnis_begruendung, 'altmaengel', old.altmaengel),
            jsonb_build_object('ergebnis', new.ergebnis, 'ergebnis_begruendung', new.ergebnis_begruendung, 'altmaengel', new.altmaengel));
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Alte Session-Funktionen entfernen
-- ---------------------------------------------------------------------------
drop trigger anlagenpruefung_wieder_geoeffnet on anlagenpruefung;
drop function anlagenpruefung_wieder_geoeffnet();
drop trigger session_teilnehmer_schutz on session_teilnehmer;
drop function session_teilnehmer_schutz();
drop function anlage_reservieren(uuid, uuid, uuid, uuid, erfassung, uuid);
drop function session_starten(uuid, uuid);
drop function session_abschliessen(uuid, text, text, text, text);
drop function session_revision_oeffnen(uuid, text, uuid);
drop function session_verwerfen(uuid);
drop function sessionleitung_uebertragen(uuid, uuid);
drop function pruefung_uebernehmen(uuid);
drop function pruefung_session(uuid);
drop function anlage_nicht_geprueft(uuid, uuid, uuid, text);
drop function session_offen(uuid);
drop function ist_leiter(uuid);


-- ---------------------------------------------------------------------------
-- 6. Protokolle je Prüfung legen nur Beteiligte oder Admins ab; Meldungen ohne entfernte Funktionen
-- ---------------------------------------------------------------------------
create or replace function protokoll_pfad_erlaubt(p_pfad text) returns boolean
language sql stable security definer set search_path = public as $$
  select (coalesce(array_length(string_to_array(p_pfad, '/'), 1) = 3 and split_part(p_pfad, '/', 3) <> '', false)
     and exists (
       select 1 from session s
        where s.id::text = split_part(p_pfad, '/', 1)
          and split_part(p_pfad, '/', 2) = 'r' || s.revision
          and s.status = 'abgeschlossen'
          and (ist_teilnehmer(s.id) or ist_admin())))
  or (coalesce(array_length(string_to_array(p_pfad, '/'), 1) = 4 and split_part(p_pfad, '/', 1) = 'p' and split_part(p_pfad, '/', 4) <> '', false)
     and ist_aktiv()
     and exists (
       select 1 from anlagenpruefung ap
        where ap.id::text = split_part(p_pfad, '/', 2) and ap.session_id is null
          and split_part(p_pfad, '/', 3) = 'r' || ap.revision
          and ap.status = 'geprueft' and ap.abgeschlossen_am is not null
          -- ablegen dürfen die Beteiligten (Haupt- und Mitprüfer) und Admins/Planer – kein Unbeteiligter legt ein PDF vor
          and (ap.pruefer_id = auth.uid() or ist_admin() or exists (
                select 1 from anlagenpruefung_mitpruefer mp
                 where mp.anlagenpruefung_id = ap.id and mp.benutzer_id = auth.uid() and mp.status in ('zugelassen', 'entfernt')))));
$$;

create or replace function eintrag_unterschrift() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  wer uuid := auth.uid();
  zeile jsonb := to_jsonb(coalesce(new, old));
  pid uuid;
  verfasser uuid;
  ohne constant text[] := array['geaendert_am', 'erstellt_am', 'erfasst_von'];
begin
  if wer is null or coalesce(current_setting('session.revision', true), '') = 'ja'
     or coalesce(current_setting('anlagenpruefung.intern', true), '') = 'ja' then
    return coalesce(new, old);
  end if;
  pid := case tg_table_name
    when 'mangel' then (zeile ->> 'entdeckt_in')::uuid
    when 'foto' then foto_pruefung((zeile ->> 'bezug_typ')::foto_bezug, (zeile ->> 'bezug_id')::uuid)
    else (zeile ->> 'anlagenpruefung_id')::uuid end;
  if pid is null or not exists (select 1 from anlagenpruefung where id = pid and session_id is null) then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' then
    if tg_table_name = 'foto' then return new; end if;  -- nur Umhängen beim Ersetzen einer Antwort
    if tg_table_name = 'mangel' then
      if (new.beschreibung, new.stufe, new.punkt_id, new.element_id) is not distinct from (old.beschreibung, old.stufe, old.punkt_id, old.element_id) then
        return new;
      end if;
    elsif (to_jsonb(new) - ohne) = (to_jsonb(old) - ohne) then
      new.erfasst_von := old.erfasst_von;
      return new;
    end if;
  end if;
  if not exists (
      select 1 from anlagenpruefung p where p.id = pid and p.pruefer_id = wer
      union all
      select 1 from anlagenpruefung_mitpruefer m where m.anlagenpruefung_id = pid and m.benutzer_id = wer and m.status = 'zugelassen') then
    raise exception 'Einträge einer Prüfung ändern nur ihre Prüfer – bitte mitprüfen anfragen';
  end if;
  if tg_op <> 'INSERT' then
    verfasser := (to_jsonb(old) ->> case when tg_table_name = 'foto' then 'erstellt_von' else 'erfasst_von' end)::uuid;
    if verfasser is not null and verfasser <> wer then perform unterschrift_erloeschen(pid, verfasser); end if;
  end if;
  perform unterschrift_erloeschen(pid, wer);
  if tg_op = 'DELETE' then return old; end if;
  if tg_table_name <> 'foto' then new.erfasst_von := wer; end if;
  return new;
end $$;

create or replace function pruefung_wieder_oeffnen(p_anlagenpruefung_id uuid, p_grund text, p_pruefer_id uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  tp anlagenpruefung;
  neu uuid;
  art text;
  art_name text;
  pflicht boolean;
  mit anlagenpruefung_mitpruefer;
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
  if neu <> tp.pruefer_id then
    select * into mit from anlagenpruefung_mitpruefer where anlagenpruefung_id = tp.id and benutzer_id = neu and status = 'zugelassen';
    delete from anlagenpruefung_mitpruefer where anlagenpruefung_id = tp.id and benutzer_id = neu;
    insert into anlagenpruefung_mitpruefer (anlagenpruefung_id, benutzer_id, status, entschieden_am, unterschrift, fertig_am)
      values (tp.id, tp.pruefer_id, 'zugelassen', now(), tp.unterschrift, tp.unterschrift_am)
      on conflict (anlagenpruefung_id, benutzer_id) do update
        set status = 'zugelassen', unterschrift = excluded.unterschrift, fertig_am = excluded.fertig_am;
    perform set_config('anlagenpruefung.uebernehmen', 'ja', true);
    update anlagenpruefung
       set pruefer_id = neu, urspruenglicher_pruefer_id = coalesce(urspruenglicher_pruefer_id, tp.pruefer_id), uebernommen_am = now(),
           unterschrift = mit.unterschrift, unterschrift_am = mit.fertig_am
     where id = tp.id;
    perform set_config('anlagenpruefung.uebernehmen', '', true);
  end if;
  -- beendet_am bleibt: das Prüfdatum ändert sich durch eine Korrektur nicht
  update anlagenpruefung set status = 'in_pruefung', abgeschlossen_am = null, revision = tp.revision + 1, letzte_aktivitaet = now()
   where id = tp.id;
  perform set_config('anlagenpruefung.intern', '', true);
  return tp.revision + 1;
end $$;

select set_config('session.revision', '', true);
