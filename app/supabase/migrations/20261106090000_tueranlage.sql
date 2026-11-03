-- Türanlage (docs/KONZEPT-TUERANLAGE.md, Schritt 1): Mehrere Türen gehören zu einer Türanlage und werden gemeinsam
-- geprüft, unterschrieben und abgeschlossen. Jede Türanlage eines Objekts wird für sich abgeschlossen.
--
-- - Neue Anlagenart „tueranlage“. Türen bekommen anlage.teil_von_id (die Türanlage); sie bleiben eigene Anlagen mit
--   Etikett, Checkliste, Mängeln, Fälligkeit und Verlauf.
-- - Die Prüfung läuft auf der Türanlage (Hauptprüfung). Jede geprüfte Tür bekommt darunter eine Teilprüfung
--   (anlagenpruefung.teil_von_id). Erfassen funktioniert in der Teilprüfung wie in jeder Prüfung.
-- - Abschluss, Unterschriften (Hauptprüfer, Mitprüfer, Kunde), Protokollnummer und Revision gibt es nur an der
--   Hauptprüfung. Teilprüfungen tragen ihr Türergebnis („Tür fertig“) oder „nicht geprüft“ mit Grund.
-- - Beim Abschluss der Türanlage müssen alle aktiven Türen fertig oder als nicht geprüft markiert sein. Das Gesamtergebnis
--   ist das schlechteste Türergebnis; der Hauptprüfer kann es mit Begründung verschärfen, nie verbessern.
-- - Die Fälligkeit der geprüften Türen schreibt der Server beim Abschluss der Türanlage fort (nicht schon bei „Tür fertig“).
-- - Schreibrechte, Erlöschen der Unterschriften, Änderungen einer Revision und Sperren werden über die Hauptprüfung
--   aufgelöst (hauptpruefung()). Wieder öffnen, Abbrechen und Doppelprüfungen laufen auf der Hauptprüfung.

-- ---------------------------------------------------------------------------
-- 1. Anlagenart
-- ---------------------------------------------------------------------------
insert into anlagenart (schluessel, name, aktiv, reihenfolge) values ('tueranlage', 'Türanlagen', false, 10)
  on conflict (schluessel) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Türen gehören zu einer Türanlage (anlage.teil_von_id)
-- ---------------------------------------------------------------------------
-- Verzögert geprüft, damit eine Datensicherung die Türen auch vor ihrer Türanlage einspielen kann
alter table anlage add column teil_von_id uuid references anlage (id) deferrable initially deferred;
create index anlage_teil_von on anlage (teil_von_id) where teil_von_id is not null;
comment on column anlage.teil_von_id is 'Türanlage, zu der diese Tür gehört (nur Art „tuer“ → Art „tueranlage“ im selben Objekt)';

-- Zuordnung prüfen: nur Tür → Türanlage im selben Objekt; nicht, solange die Tür geprüft wird; eine Türanlage mit Türen
-- wechselt weder Objekt noch Art und wird nicht stillgelegt. Läuft nach anlage_vor_ort_schuetzen (zz), das die Zuordnung
-- für Prüfer vor Ort beim Ändern zurücksetzt.
create function anlage_teil_pruefen() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  art text;
  haupt anlage;
begin
  if coalesce(current_setting('session.revision', true), '') = 'ja' then return new; end if;
  select anlagenart into art from anlagentyp where id = new.anlagentyp_id;
  if new.teil_von_id is not null then
    if art <> 'tuer' then raise exception 'Nur Türen können zu einer Türanlage gehören'; end if;
    select * into haupt from anlage where id = new.teil_von_id;
    if haupt.id is null or haupt.id = new.id
       or (select anlagenart from anlagentyp where id = haupt.anlagentyp_id) <> 'tueranlage' then
      raise exception 'Eine Tür kann nur zu einer Türanlage gehören';
    end if;
    if haupt.objekt_id <> new.objekt_id then raise exception 'Die Türanlage gehört zu einem anderen Objekt'; end if;
    if haupt.status <> 'aktiv' then raise exception 'Die Türanlage ist stillgelegt'; end if;
  end if;
  if tg_op = 'UPDATE' then
    if new.teil_von_id is distinct from old.teil_von_id
       and exists (select 1 from anlagenpruefung where anlage_id = new.id and session_id is null and status = 'in_pruefung') then
      raise exception 'Die Tür wird gerade geprüft – die Zuordnung zur Türanlage kann erst danach geändert werden';
    end if;
    if (new.objekt_id <> old.objekt_id or new.anlagentyp_id <> old.anlagentyp_id or (new.status <> 'aktiv' and old.status = 'aktiv'))
       and exists (select 1 from anlage where teil_von_id = new.id and status = 'aktiv') then
      raise exception 'Der Türanlage sind noch Türen zugeordnet – bitte zuerst die Türen herausnehmen';
    end if;
  end if;
  return new;
end $$;
create trigger anlage_zz_teil_pruefen before insert or update on anlage
  for each row execute function anlage_teil_pruefen();

-- Vor Ort ändert ein Prüfer die Zuordnung nicht (beim Anlegen einer Tür darf er sie setzen)
create or replace function anlage_vor_ort_schuetzen() returns trigger
language plpgsql as $$
begin
  if auth.uid() is null or auth.role() = 'service_role' or ist_admin() then
    return new;
  end if;
  new.objekt_id := old.objekt_id;
  new.anlagentyp_id := old.anlagentyp_id;
  new.kunden_bezeichnung := old.kunden_bezeichnung;
  new.gebaeude := old.gebaeude;
  new.etage := old.etage;
  new.raum := old.raum;
  new.lage_beschreibung := old.lage_beschreibung;
  new.status := old.status;
  new.erstellt_am := old.erstellt_am;
  new.erstellt_von := old.erstellt_von;
  new.teil_von_id := old.teil_von_id;
  if old.etikett_id is not null then
    new.etikett_id := old.etikett_id;
  end if;
  return new;
end $$;

create or replace function anlage_vor_loeschen() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from anlagenpruefung where anlage_id = old.id) or exists (select 1 from mangel where anlage_id = old.id) then
    raise exception 'Die Tür hat bereits Prüfungen und kann nicht gelöscht werden. Bitte stattdessen stilllegen.';
  end if;
  if exists (select 1 from anlage where teil_von_id = old.id) then
    raise exception 'Der Türanlage sind noch Türen zugeordnet – bitte zuerst die Türen herausnehmen';
  end if;
  update etikett set anlage_id = null, zugeordnet_am = null where anlage_id = old.id;
  delete from foto where bezug_typ = 'anlage' and bezug_id = old.id;
  return old;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Teilprüfungen (anlagenpruefung.teil_von_id)
-- ---------------------------------------------------------------------------
alter table anlagenpruefung add column teil_von_id uuid references anlagenpruefung (id) on delete cascade deferrable initially deferred;
create index anlagenpruefung_teil_von on anlagenpruefung (teil_von_id) where teil_von_id is not null;
-- Je Hauptprüfung und Tür eine Teilprüfung (eine zweite, offline von einem Mitprüfer begonnene, wird Duplikat)
create unique index anlagenpruefung_eine_teilpruefung_je_tuer on anlagenpruefung (teil_von_id, anlage_id)
  where teil_von_id is not null and status <> 'duplikat';
comment on column anlagenpruefung.teil_von_id is 'Teilprüfung einer Tür innerhalb der Prüfung ihrer Türanlage (Hauptprüfung); Abschluss, Unterschriften und Protokoll hängen an der Hauptprüfung';
-- Eine Hauptprüfung der Türanlage braucht keine Checkliste; das prüft jetzt der Trigger anlagenpruefung_teil
alter table anlagenpruefung drop constraint anlagenpruefung_checkliste_noetig;

insert into log_bezeichnung (tabelle, spalte, text) values
  ('anlage', 'teil_von_id', 'Gehört zu Türanlage'),
  ('anlagenpruefung', 'teil_von_id', 'Teil der Prüfung')
  on conflict do nothing;

-- Hauptprüfung eines Eintrags: die Prüfung selbst oder, bei einer Teilprüfung, die Prüfung der Türanlage
create function hauptpruefung(p_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(teil_von_id, id) from anlagenpruefung where id = p_id;
$$;
revoke all on function hauptpruefung(uuid) from public, anon;
grant execute on function hauptpruefung(uuid) to authenticated;

-- Zugelassener Mitprüfer der Hauptprüfung, der noch nicht fertig gemeldet hat
create function ist_zugelassener_mitpruefer(p_anlagenpruefung_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from anlagenpruefung_mitpruefer m
     where m.anlagenpruefung_id = p_anlagenpruefung_id and m.benutzer_id = auth.uid() and m.status = 'zugelassen' and m.fertig_am is null);
$$;
revoke all on function ist_zugelassener_mitpruefer(uuid) from public, anon;
grant execute on function ist_zugelassener_mitpruefer(uuid) to authenticated;

-- Teilprüfung anlegen darf, wer an der Hauptprüfung beteiligt ist; der Prüfer der Teilprüfung ist immer der Hauptprüfer
create function darf_teilpruefung_anlegen(p_haupt_id uuid, p_pruefer_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from anlagenpruefung h
     where h.id = p_haupt_id and h.teil_von_id is null and h.session_id is null and h.pruefer_id = p_pruefer_id
       and (h.pruefer_id = auth.uid() or ist_zugelassener_mitpruefer(h.id)));
$$;
revoke all on function darf_teilpruefung_anlegen(uuid, uuid) from public, anon;
grant execute on function darf_teilpruefung_anlegen(uuid, uuid) to authenticated;

drop policy anlagenpruefung_anlegen on anlagenpruefung;
create policy anlagenpruefung_anlegen on anlagenpruefung for insert to authenticated
  with check (session_id is null and ist_aktiv()
              and (pruefer_id = auth.uid() or (teil_von_id is not null and darf_teilpruefung_anlegen(teil_von_id, pruefer_id))));
-- Teilprüfungen (Türergebnis, „Tür fertig“, „nicht geprüft“) ändern Hauptprüfer und zugelassene Mitprüfer
drop policy anlagenpruefung_aendern on anlagenpruefung;
create policy anlagenpruefung_aendern on anlagenpruefung for update to authenticated
  using (session_id is null and (pruefer_id = auth.uid() or (teil_von_id is not null and ist_aktiv() and ist_zugelassener_mitpruefer(teil_von_id))))
  with check (session_id is null and (pruefer_id = auth.uid() or (teil_von_id is not null and ist_aktiv() and ist_zugelassener_mitpruefer(teil_von_id))));

-- Gesperrt ist eine Teilprüfung mit ihrer Hauptprüfung
create or replace function pruefung_gesperrt(p_anlagenpruefung_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.session_id is not null or p.abgeschlossen_am is not null
                          or (p.teil_von_id is not null and exists (select 1 from anlagenpruefung h where h.id = p.teil_von_id and h.abgeschlossen_am is not null))
                     from anlagenpruefung p where p.id = p_anlagenpruefung_id), false);
$$;

-- Schreiben dürfen Hauptprüfer und zugelassene Mitprüfer der Hauptprüfung (auch in Teilprüfungen)
create or replace function ist_eigene_offene_pruefung(p_anlagenpruefung_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from anlagenpruefung tp
    where tp.id = hauptpruefung(p_anlagenpruefung_id) and not pruefung_gesperrt(p_anlagenpruefung_id)
      and (tp.pruefer_id = auth.uid()
           or (tp.status = 'in_pruefung' and exists (
                 select 1 from anlagenpruefung_mitpruefer m
                  where m.anlagenpruefung_id = tp.id and m.benutzer_id = auth.uid() and m.status = 'zugelassen'
                    and m.fertig_am is null)))
  ) and ist_aktiv();
$$;

-- Regeln der Teilprüfung; Checkliste nötig außer für Türanlagen und „nicht geprüft“
create function anlagenpruefung_teil() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  haupt anlagenpruefung;
  art text;
  intern boolean := coalesce(current_setting('anlagenpruefung.intern', true), '') = 'ja';
begin
  if coalesce(current_setting('session.revision', true), '') = 'ja' then return new; end if;
  select ty.anlagenart into art from anlage a join anlagentyp ty on ty.id = a.anlagentyp_id where a.id = new.anlage_id;
  if tg_op = 'UPDATE' and new.teil_von_id is distinct from old.teil_von_id then
    raise exception 'Die Zuordnung einer Teilprüfung zu ihrer Türanlage ist unveränderlich';
  end if;
  if new.teil_von_id is null then
    if tg_op = 'INSERT' and art = 'tuer' and exists (select 1 from anlage where id = new.anlage_id and teil_von_id is not null) then
      raise exception 'Diese Tür gehört zu einer Türanlage – bitte die Türanlage prüfen';
    end if;
    if new.checkliste_version_id is null and new.status <> 'nicht_geprueft' and art <> 'tueranlage' then
      raise exception 'Für die Prüfung fehlt die Checkliste';
    end if;
    return new;
  end if;
  if new.session_id is not null then raise exception 'Teilprüfungen gehören zu keiner Session'; end if;
  if new.unterschrift is not null or new.unterschrift_am is not null or new.kunde_name is not null
     or new.kunde_unterschrift is not null or new.kunde_unterschrift_am is not null or new.protokoll_nr is not null then
    raise exception 'Unterschrieben und protokolliert wird die Türanlage, nicht die einzelne Tür';
  end if;
  if new.checkliste_version_id is null and new.status <> 'nicht_geprueft' then
    raise exception 'Für die Prüfung fehlt die Checkliste';
  end if;
  if tg_op = 'INSERT' then
    select * into haupt from anlagenpruefung where id = new.teil_von_id;
    if haupt.id is null or haupt.teil_von_id is not null or haupt.session_id is not null then
      raise exception 'Die Prüfung der Türanlage wurde nicht gefunden';
    end if;
    if not exists (select 1 from anlage where id = new.anlage_id and teil_von_id = haupt.anlage_id) then
      raise exception 'Die Tür gehört nicht zu dieser Türanlage';
    end if;
    if haupt.abgeschlossen_am is not null and not intern then
      raise exception 'Die Prüfung der Türanlage ist abgeschlossen und kann nicht mehr geändert werden';
    end if;
    new.pruefer_id := haupt.pruefer_id;
    new.revision := haupt.revision;
    if haupt.status = 'duplikat' then
      -- Teile einer Doppelprüfung sind Doppelprüfungen (geklärt wird an der Türanlage)
      new.status := 'duplikat';
      new.duplikat_von := coalesce(
        (select t.id from anlagenpruefung t where t.teil_von_id = haupt.duplikat_von and t.anlage_id = new.anlage_id and t.status <> 'duplikat'),
        haupt.duplikat_von);
      new.duplikat_geklaert := haupt.duplikat_geklaert;
    end if;
  end if;
  return new;
end $$;
create trigger anlagenpruefung_teil before insert or update on anlagenpruefung
  for each row execute function anlagenpruefung_teil();

-- „Nicht geprüft“ mit Grund gibt es nur noch für Türen einer Türanlage
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
    if new.status = 'nicht_geprueft' and new.teil_von_id is null then
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

-- Eine Tür mit Türanlage wird nur als Teil der Türanlage geprüft
create or replace function pruefung_beginnen(p_id uuid, p_anlage_id uuid, p_checkliste_version_id uuid, p_erfassung erfassung,
                                             p_pruefart_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  vorhanden anlagenpruefung;
  name text;
begin
  if not ist_aktiv() then raise exception 'Nicht angemeldet oder deaktiviert'; end if;
  if exists (select 1 from anlagenpruefung where id = p_id) then
    return jsonb_build_object('ok', true, 'id', p_id);  -- erneuter Aufruf
  end if;
  if exists (select 1 from anlage where id = p_anlage_id and teil_von_id is not null) then
    raise exception 'Diese Tür gehört zu einer Türanlage – bitte die Türanlage prüfen';
  end if;
  for versuch in 1..2 loop
    select * into vorhanden from anlagenpruefung
     where session_id is null and anlage_id = p_anlage_id and status = 'in_pruefung'
     for update;
    if vorhanden.id is not null then
      if vorhanden.pruefer_id = auth.uid() then
        return jsonb_build_object('ok', true, 'id', vorhanden.id, 'fortsetzen', true);
      end if;
      select b.name into name from benutzer b where b.id = vorhanden.pruefer_id;
      return jsonb_build_object('ok', false, 'id', vorhanden.id, 'pruefer', name, 'status', vorhanden.status);
    end if;
    begin
      insert into anlagenpruefung (id, anlage_id, pruefer_id, checkliste_version_id, erfassung, pruefart_id)
        values (p_id, p_anlage_id, auth.uid(), p_checkliste_version_id, p_erfassung, p_pruefart_id);
      return jsonb_build_object('ok', true, 'id', p_id);
    exception when unique_violation then
      continue;  -- gleichzeitig von einem Kollegen begonnen → erneut nachsehen
    end;
  end loop;
  raise exception 'Die Prüfung konnte nicht begonnen werden';
end $$;

-- Teilprüfung einer Tür beginnen (online): Hauptprüfer oder zugelassener Mitprüfer der laufenden Hauptprüfung.
-- Läuft für die Tür schon eine Teilprüfung, kommt sie zurück (fortsetzen). Offline legt das Gerät die Teilprüfung
-- selbst an (gleiche Regeln über Trigger und Policy).
create function teilpruefung_beginnen(p_id uuid, p_haupt_id uuid, p_anlage_id uuid, p_checkliste_version_id uuid, p_erfassung erfassung,
                                      p_pruefart_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  haupt anlagenpruefung;
  vorhanden anlagenpruefung;
  name text;
begin
  if not ist_aktiv() then raise exception 'Nicht angemeldet oder deaktiviert'; end if;
  if exists (select 1 from anlagenpruefung where id = p_id) then
    return jsonb_build_object('ok', true, 'id', p_id);  -- erneuter Aufruf
  end if;
  select * into haupt from anlagenpruefung where id = p_haupt_id for update;
  if haupt.id is null or haupt.teil_von_id is not null or haupt.session_id is not null then
    raise exception 'Die Prüfung der Türanlage wurde nicht gefunden';
  end if;
  if haupt.abgeschlossen_am is not null then raise exception 'Die Prüfung der Türanlage ist abgeschlossen'; end if;
  if haupt.status = 'duplikat' then raise exception 'Die Prüfung der Türanlage ist eine Doppelprüfung – bitte zuerst klären'; end if;
  if not (haupt.pruefer_id = auth.uid() or ist_zugelassener_mitpruefer(haupt.id)) then
    select b.name into name from benutzer b where b.id = haupt.pruefer_id;
    return jsonb_build_object('ok', false, 'id', haupt.id, 'pruefer', name, 'status', haupt.status);
  end if;
  select * into vorhanden from anlagenpruefung where teil_von_id = haupt.id and anlage_id = p_anlage_id and status <> 'duplikat';
  if vorhanden.id is not null then
    return jsonb_build_object('ok', true, 'id', vorhanden.id, 'fortsetzen', true);
  end if;
  insert into anlagenpruefung (id, teil_von_id, anlage_id, pruefer_id, checkliste_version_id, erfassung, pruefart_id)
    values (p_id, haupt.id, p_anlage_id, haupt.pruefer_id, p_checkliste_version_id, p_erfassung, p_pruefart_id);
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;
revoke execute on function teilpruefung_beginnen(uuid, uuid, uuid, uuid, erfassung, uuid) from public, anon;
grant execute on function teilpruefung_beginnen(uuid, uuid, uuid, uuid, erfassung, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Unterschriften erlöschen über die Hauptprüfung
-- ---------------------------------------------------------------------------
-- Eine Tür hat sich geändert (Ergebnis, Stand, Bewertung früherer Mängel): Unterschriften von Hauptprüfer und Kunde der
-- Türanlage erlöschen, dazu die Fertigmeldung des Ändernden, wenn er Mitprüfer ist
create function teil_geaendert(p_haupt_id uuid, p_benutzer_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  vorher text := coalesce(current_setting('anlagenpruefung.intern', true), '');
begin
  perform set_config('anlagenpruefung.intern', 'ja', true);
  update anlagenpruefung set unterschrift_am = null, kunde_unterschrift_am = null
   where id = p_haupt_id and (unterschrift_am is not null or kunde_unterschrift_am is not null);
  update anlagenpruefung_mitpruefer set fertig_am = null
   where anlagenpruefung_id = p_haupt_id and benutzer_id = p_benutzer_id and fertig_am is not null;
  perform set_config('anlagenpruefung.intern', vorher, true);
end $$;
revoke execute on function teil_geaendert(uuid, uuid) from public, anon, authenticated;

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
  pid := hauptpruefung(case tg_table_name
    when 'mangel' then (zeile ->> 'entdeckt_in')::uuid
    when 'foto' then foto_pruefung((zeile ->> 'bezug_typ')::foto_bezug, (zeile ->> 'bezug_id')::uuid)
    else (zeile ->> 'anlagenpruefung_id')::uuid end);
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

-- Änderungen einer Revision werden an der Hauptprüfung festgehalten (datensatz_id zeigt auf den Eintrag der Tür)
create or replace function revision_aenderung() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  zeile jsonb := to_jsonb(coalesce(new, old));
  kandidaten uuid[];
  pid uuid;
  rev int;
  ohne constant text[] := array['geaendert_am', 'erstellt_am', 'erfasst_von'];
begin
  if coalesce(current_setting('session.revision', true), '') = 'ja'
     or coalesce(current_setting('anlagenpruefung.intern', true), '') = 'ja'
     or (tg_op = 'UPDATE' and (to_jsonb(new) - ohne) = (to_jsonb(old) - ohne)) then
    return coalesce(new, old);
  end if;
  kandidaten := case tg_table_name
    when 'mangel' then array[(zeile ->> 'entdeckt_in')::uuid, (to_jsonb(new) ->> 'nachgeprueft_in')::uuid, (to_jsonb(old) ->> 'nachgeprueft_in')::uuid]
    when 'foto' then array[foto_pruefung((zeile ->> 'bezug_typ')::foto_bezug, (zeile ->> 'bezug_id')::uuid)]
    else array[(zeile ->> 'anlagenpruefung_id')::uuid] end;
  for pid in select distinct hauptpruefung(k) from unnest(kandidaten) k where k is not null loop
    select revision into rev from anlagenpruefung
     where id = pid and session_id is null and revision > 0 and status = 'in_pruefung';
    if found then
      insert into anlagenpruefung_aenderung (anlagenpruefung_id, revision, tabelle, datensatz_id, aktion, alt, neu)
      values (pid, rev, tg_table_name, (zeile ->> 'id')::uuid, tg_op,
              case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
    end if;
  end loop;
  return coalesce(new, old);
end $$;

-- Ergebnis einer Prüfung in einer Revision geändert – bei einer Tür an der Hauptprüfung festgehalten
create or replace function revision_ergebnis() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rev int;
  st pruefung_status;
begin
  if coalesce(current_setting('session.revision', true), '') = 'ja' or new.session_id is not null then return null; end if;
  if new.teil_von_id is null then
    if new.revision > 0
       and (new.ergebnis, new.ergebnis_begruendung, new.altmaengel) is distinct from (old.ergebnis, old.ergebnis_begruendung, old.altmaengel) then
      insert into anlagenpruefung_aenderung (anlagenpruefung_id, revision, tabelle, datensatz_id, aktion, alt, neu)
      values (new.id, new.revision, 'anlagenpruefung', new.id, 'UPDATE',
              jsonb_build_object('ergebnis', old.ergebnis, 'ergebnis_begruendung', old.ergebnis_begruendung, 'altmaengel', old.altmaengel),
              jsonb_build_object('ergebnis', new.ergebnis, 'ergebnis_begruendung', new.ergebnis_begruendung, 'altmaengel', new.altmaengel));
    end if;
    return null;
  end if;
  select revision, status into rev, st from anlagenpruefung where id = new.teil_von_id;
  if rev > 0 and st = 'in_pruefung'
     and (new.status, new.ergebnis, new.ergebnis_begruendung, new.altmaengel, new.nicht_geprueft_grund)
         is distinct from (old.status, old.ergebnis, old.ergebnis_begruendung, old.altmaengel, old.nicht_geprueft_grund) then
    insert into anlagenpruefung_aenderung (anlagenpruefung_id, revision, tabelle, datensatz_id, aktion, alt, neu)
    values (new.teil_von_id, rev, 'anlagenpruefung', new.id, 'UPDATE',
            jsonb_build_object('anlage_id', old.anlage_id, 'status', old.status, 'nicht_geprueft_grund', old.nicht_geprueft_grund,
                               'ergebnis', old.ergebnis, 'ergebnis_begruendung', old.ergebnis_begruendung, 'altmaengel', old.altmaengel),
            jsonb_build_object('anlage_id', new.anlage_id, 'status', new.status, 'nicht_geprueft_grund', new.nicht_geprueft_grund,
                               'ergebnis', new.ergebnis, 'ergebnis_begruendung', new.ergebnis_begruendung, 'altmaengel', new.altmaengel));
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Abschluss: Tür fertig (Teilprüfung) und Türanlage abschließen (Hauptprüfung)
-- ---------------------------------------------------------------------------
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
      -- Alle aktiven Türen sind fertig oder mit Grund nicht geprüft; das Gesamtergebnis ist das schlechteste Türergebnis
      select string_agg(coalesce(a.etikett_id, a.kunden_bezeichnung, 'ohne Bezeichnung'), ', ' order by a.etikett_id, a.kunden_bezeichnung) into offen
        from anlage a
       where a.teil_von_id = new.anlage_id and a.status = 'aktiv'
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

-- Fälligkeit und Stand der Elemente fortschreiben (aus anlagenpruefung_nach_aendern herausgelöst)
create function pruefung_faelligkeit_fortschreiben(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  p anlagenpruefung;
  tag date;
begin
  select * into p from anlagenpruefung where id = p_id;
  if p.id is null then return; end if;
  tag := coalesce(p.beendet_am, p.begonnen_am)::date;
  -- auch für die Prüfarten, die diese Prüfart einschließt (pruefart.schliesst_ein_id)
  insert into anlage_faelligkeit (anlage_id, pruefart_id, letzte_pruefung_am, letztes_ergebnis)
    select p.anlage_id, a.id, tag, p.ergebnis
      from pruefart pa join pruefart a on a.id in (pa.id, pa.schliesst_ein_id)
     where pa.id = p.pruefart_id
    on conflict (anlage_id, pruefart_id) do update
      set letzte_pruefung_am = excluded.letzte_pruefung_am, letztes_ergebnis = excluded.letztes_ergebnis
      where anlage_faelligkeit.letzte_pruefung_am is null or anlage_faelligkeit.letzte_pruefung_am <= excluded.letzte_pruefung_am;
  perform set_config('app.element_stand', 'ja', true);
  update anlage_element e set zuletzt_geprueft_am = tag
    from element_ergebnis r
   where r.anlagenpruefung_id = p.id and r.element_id = e.id and r.status <> 'nicht_zugaenglich'
     and (e.zuletzt_geprueft_am is null or e.zuletzt_geprueft_am < tag);
  perform set_config('app.element_stand', '', true);
end $$;
revoke execute on function pruefung_faelligkeit_fortschreiben(uuid) from public, anon, authenticated;

-- Teilprüfungen schreiben ihre Fälligkeit erst beim Abschluss der Türanlage fort
create or replace function anlagenpruefung_nach_aendern() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.teil_von_id is null and new.status = 'geprueft' and new.ergebnis is not null then
    perform pruefung_faelligkeit_fortschreiben(new.id);
  end if;
  return new;
end $$;

-- Abschluss der Türanlage: Teilprüfungen mit sperren, Fälligkeit der geprüften Türen fortschreiben
create function anlagenpruefung_teile_abschliessen() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t uuid;
begin
  if new.teil_von_id is not null or new.session_id is not null or new.abgeschlossen_am is null
     or (tg_op = 'UPDATE' and old.abgeschlossen_am is not null) then
    return null;
  end if;
  perform set_config('anlagenpruefung.intern', 'ja', true);
  update anlagenpruefung set abgeschlossen_am = new.abgeschlossen_am where teil_von_id = new.id and abgeschlossen_am is null;
  perform set_config('anlagenpruefung.intern', '', true);
  for t in select id from anlagenpruefung where teil_von_id = new.id and status = 'geprueft' and ergebnis is not null loop
    perform pruefung_faelligkeit_fortschreiben(t);
  end loop;
  return null;
end $$;
-- (ohne „of abgeschlossen_am“: die Spalte setzt der BEFORE-Trigger, nicht das Gerät)
create trigger anlagenpruefung_zz_teile_abschliessen after insert or update on anlagenpruefung
  for each row execute function anlagenpruefung_teile_abschliessen();

-- ---------------------------------------------------------------------------
-- 6. Wieder öffnen, Abbrechen, Mitprüfen, Doppelprüfungen – auf der Hauptprüfung
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
  if tp.teil_von_id is not null then raise exception 'Bitte die Prüfung der Türanlage wieder öffnen – die Türen gehören dazu'; end if;
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
     where id = tp.id or teil_von_id = tp.id;
    perform set_config('anlagenpruefung.uebernehmen', '', true);
  end if;
  -- beendet_am bleibt: das Prüfdatum ändert sich durch eine Korrektur nicht
  update anlagenpruefung
     set status = 'in_pruefung', abgeschlossen_am = null, revision = tp.revision + 1, letzte_aktivitaet = now(),
         unterschrift = null, unterschrift_am = null, kunde_name = null, kunde_unterschrift = null, kunde_unterschrift_am = null
   where id = tp.id;
  -- Die Türen der Türanlage werden mit geöffnet (behalten ihren Stand: fertig bzw. nicht geprüft)
  update anlagenpruefung set abgeschlossen_am = null, revision = tp.revision + 1, letzte_aktivitaet = now()
   where teil_von_id = tp.id;
  perform set_config('anlagenpruefung.intern', '', true);
  return tp.revision + 1;
end $$;

create or replace function reservierung_aufheben(p_anlagenpruefung_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  tp anlagenpruefung;
  ids uuid[];
begin
  select * into tp from anlagenpruefung where id = p_anlagenpruefung_id;
  if tp.id is null then return; end if;
  if tp.teil_von_id is not null then
    raise exception 'Eine einzelne Tür kann nicht verworfen werden – bitte die Prüfung der Türanlage abbrechen';
  end if;
  if not (tp.pruefer_id = auth.uid() or ist_admin()) then
    raise exception 'Nur der Prüfer selbst oder ein Admin kann die Prüfung freigeben';
  end if;
  if tp.status <> 'in_pruefung' then raise exception 'Nur laufende Prüfungen können freigegeben werden'; end if;
  if tp.revision > 0 then raise exception 'Eine wieder geöffnete Prüfung kann nicht verworfen werden – bitte wieder abschließen'; end if;
  ids := array(select id from anlagenpruefung where teil_von_id = tp.id) || tp.id;
  if tp.pruefer_id <> auth.uid() then
    insert into anlagenpruefung_freigabe (id, anlage_id, pruefer_id)
      select p.id, p.anlage_id, p.pruefer_id from anlagenpruefung p where p.id = any (ids) on conflict (id) do nothing;
  end if;
  -- Alles der Prüfung (und ihrer Türen) entfällt; Unterschriften gibt es hier noch keine (revision 0, nicht abgeschlossen)
  perform set_config('anlagenpruefung.intern', 'ja', true);
  -- In dieser Prüfung als behoben bestätigte frühere Mängel wieder öffnen
  update mangel set status = case when behoben_am is not null then 'behoben'::mangel_status else 'offen'::mangel_status end, nachgeprueft_in = null
   where nachgeprueft_in = any (ids);
  delete from foto where bezug_typ = 'mangel' and bezug_id in (select id from mangel where entdeckt_in = any (ids));
  delete from foto where bezug_typ = 'antwort' and bezug_id in (select id from antwort where anlagenpruefung_id = any (ids));
  delete from element_ergebnis where anlagenpruefung_id = any (ids);
  delete from mangel where entdeckt_in = any (ids);
  delete from antwort where anlagenpruefung_id = any (ids);
  delete from anlagenpruefung where teil_von_id = tp.id;
  delete from anlagenpruefung where id = tp.id;
  perform set_config('anlagenpruefung.intern', '', true);
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
  if tp.teil_von_id is not null then raise exception 'Mitprüfen wird für die Türanlage angefragt, nicht für die einzelne Tür'; end if;
  if tp.session_id is not null then raise exception 'Prüfungen aus der Zeit der Sessions sind abgeschlossen'; end if;
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

create or replace function mitpruefung_entscheiden(p_anlagenpruefung_id uuid, p_benutzer_id uuid, p_zulassen boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  tp anlagenpruefung;
begin
  select * into tp from anlagenpruefung where id = p_anlagenpruefung_id;
  if tp.id is null then raise exception 'Prüfung nicht gefunden'; end if;
  if tp.teil_von_id is not null then raise exception 'Mitprüfer werden an der Türanlage zugelassen'; end if;
  if tp.pruefer_id <> auth.uid() then raise exception 'Nur der Hauptprüfer kann das Mitprüfen zulassen'; end if;
  if pruefung_gesperrt(tp.id) or tp.status <> 'in_pruefung' then raise exception 'Diese Prüfung läuft nicht mehr'; end if;
  update anlagenpruefung_mitpruefer
     set status = case when p_zulassen then 'zugelassen' else 'abgelehnt' end, entschieden_am = now()
   where anlagenpruefung_id = tp.id and benutzer_id = p_benutzer_id and status = 'angefragt';
  if not found then raise exception 'Es liegt keine offene Anfrage vor'; end if;
end $$;

create or replace function mitpruefung_beenden(p_anlagenpruefung_id uuid, p_benutzer_id uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  tp anlagenpruefung;
  wer uuid := coalesce(p_benutzer_id, auth.uid());
begin
  select * into tp from anlagenpruefung where id = p_anlagenpruefung_id;
  if tp.id is null then return; end if;
  if tp.teil_von_id is not null then raise exception 'Mitprüfer werden an der Türanlage entfernt'; end if;
  if not (tp.pruefer_id = auth.uid() or wer = auth.uid()) then
    raise exception 'Nur der Hauptprüfer oder der Mitprüfer selbst kann das beenden';
  end if;
  if pruefung_gesperrt(tp.id) then raise exception 'Die Prüfung ist bereits abgeschlossen'; end if;
  perform set_config('anlagenpruefung.intern', 'ja', true);
  update anlagenpruefung_mitpruefer set status = 'entfernt', unterschrift = null, fertig_am = null
   where anlagenpruefung_id = tp.id and benutzer_id = wer and status <> 'entfernt';
  perform set_config('anlagenpruefung.intern', '', true);
end $$;

-- Doppelprüfungen: an der Türanlage geklärt, die Teilprüfungen folgen ihrer Hauptprüfung. Zwei Teilprüfungen derselben
-- Tür innerhalb derselben Hauptprüfung (zwei Mitprüfer offline) klären die Beteiligten für sich.
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
  if tp.teil_von_id is not null then
    if not exists (select 1 from anlagenpruefung where id = erste and teil_von_id = tp.teil_von_id) then
      raise exception 'Doppelprüfungen einer Türanlage werden an der Türanlage geklärt';
    end if;
    if not (ist_admin() or (ist_aktiv() and exists (
        select 1 from anlagenpruefung h where h.id = tp.teil_von_id and (h.pruefer_id = auth.uid() or exists (
          select 1 from anlagenpruefung_mitpruefer m where m.anlagenpruefung_id = h.id and m.benutzer_id = auth.uid() and m.status = 'zugelassen'))))) then
      raise exception 'Nur die beteiligten Prüfer oder ein Admin können Doppelprüfungen klären';
    end if;
    perform set_config('anlagenpruefung.aufloesen', 'ja', true);
    perform set_config('anlagenpruefung.intern', 'ja', true);
    update anlagenpruefung set status = 'duplikat', duplikat_von = tp.id, duplikat_geklaert = true
     where (id = erste or duplikat_von = erste) and teil_von_id = tp.teil_von_id and id <> tp.id;
    update anlagenpruefung
       set status = case when nicht_geprueft_grund is not null then 'nicht_geprueft'::pruefung_status
                         when beendet_am is not null and ergebnis is not null then 'geprueft' else 'in_pruefung' end,
           duplikat_von = null, duplikat_geklaert = true
     where id = tp.id;
    perform set_config('anlagenpruefung.intern', '', true);
    perform set_config('anlagenpruefung.aufloesen', '', true);
    return;
  end if;
  if not (ist_admin() or (ist_aktiv() and exists (
      select 1 from anlagenpruefung where (id = erste or duplikat_von = erste) and pruefer_id = auth.uid()))) then
    raise exception 'Nur die beteiligten Prüfer oder ein Admin können Doppelprüfungen klären';
  end if;
  perform set_config('anlagenpruefung.aufloesen', 'ja', true);
  perform set_config('anlagenpruefung.intern', 'ja', true);
  update anlagenpruefung set status = 'duplikat', duplikat_von = tp.id, duplikat_geklaert = true
   where (id = erste or duplikat_von = erste) and id <> tp.id;
  -- Teilprüfungen der unterlegenen Hauptprüfungen
  update anlagenpruefung t set status = 'duplikat', duplikat_geklaert = true,
         duplikat_von = coalesce((select g.id from anlagenpruefung g where g.teil_von_id = tp.id and g.anlage_id = t.anlage_id and g.status <> 'duplikat'), tp.id)
   where t.teil_von_id in (select id from anlagenpruefung where (id = erste or duplikat_von = erste) and id <> tp.id)
     and t.status <> 'duplikat';
  update anlagenpruefung
     set status = case when abgeschlossen_am is not null then 'geprueft'::pruefung_status else 'in_pruefung' end,
         protokoll_nr = case when abgeschlossen_am is not null then coalesce(protokoll_nr, naechste_protokoll_nr()) end,
         duplikat_von = null, duplikat_geklaert = true
   where id = tp.id;
  -- Teilprüfungen der gültigen Hauptprüfung (eine je Tür)
  update anlagenpruefung t
     set status = case when nicht_geprueft_grund is not null then 'nicht_geprueft'::pruefung_status
                       when beendet_am is not null and ergebnis is not null then 'geprueft' else 'in_pruefung' end,
         duplikat_von = null, duplikat_geklaert = true
   where t.teil_von_id = tp.id and t.status = 'duplikat'
     and not exists (select 1 from anlagenpruefung g where g.teil_von_id = tp.id and g.anlage_id = t.anlage_id and g.status <> 'duplikat')
     and t.id = (select min(g.id::text)::uuid from anlagenpruefung g where g.teil_von_id = tp.id and g.anlage_id = t.anlage_id);
  perform set_config('anlagenpruefung.intern', '', true);
  perform set_config('anlagenpruefung.aufloesen', '', true);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Protokolle: Einzel-PDF je Tür legen die Beteiligten der Hauptprüfung ab
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
          -- ablegen dürfen die Beteiligten (Haupt- und Mitprüfer der Hauptprüfung) und Admins/Planer
          and (ap.pruefer_id = auth.uid() or ist_admin() or exists (
                select 1 from anlagenpruefung_mitpruefer mp
                 where mp.anlagenpruefung_id = hauptpruefung(ap.id) and mp.benutzer_id = auth.uid() and mp.status in ('zugelassen', 'entfernt')))));
$$;

-- PostgREST: Schema neu laden
notify pgrst, 'reload schema';
