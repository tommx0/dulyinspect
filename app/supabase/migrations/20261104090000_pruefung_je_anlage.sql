-- Prüfung je Anlage (docs/KONZEPT-ABSCHLUSS-JE-ANLAGE.md): Eine Prüfung gehört nur noch zu ihrer Anlage, nicht mehr zu
-- einer Session. Sie wird für sich begonnen (pruefung_beginnen), abgeschlossen, unterschrieben und protokolliert.
--
-- - Abschluss: Das Gerät setzt beendet_am/Status „geprueft“ zusammen mit der Unterschrift des Hauptprüfers (optional der
--   Kunde). Der Server prüft Unterschrift und Fertigmeldung aller Mitprüfer, vergibt die Protokollnummer und sperrt die Prüfung.
-- - Mitprüfer melden ihren Teil mit Unterschrift fertig (anlagenpruefung_mitpruefer.unterschrift) und erfassen danach nichts mehr.
-- - Jeder Eintrag (Antwort, Elementergebnis, Mangel, Foto) merkt sich, wer ihn erfasst hat. Wird er geändert, erlischt die
--   Unterschrift dessen, von dem er stammt, und die des Ändernden; die Kundenunterschrift erlischt bei jeder Änderung.
-- - Wieder öffnen (pruefung_wieder_oeffnen): am Tag des Abschlusses der Hauptprüfer, danach ein Admin – mit Grund, als neue Revision.
--
-- Prüfungen alter Sessions (session_id gesetzt) laufen unverändert nach den bisherigen Regeln weiter.

select set_config('session.revision', 'ja', true);  -- Bestand ergänzen, ohne an Sperren abgeschlossener Prüfungen zu scheitern

-- ---------------------------------------------------------------------------
-- 1. Spalten und Tabellen
-- ---------------------------------------------------------------------------
alter table anlagenpruefung alter column session_id drop not null;
alter table anlagenpruefung
  add column abgeschlossen_am timestamptz,
  add column revision int not null default 0,
  add column protokoll_nr text,
  add column unterschrift text,
  add column unterschrift_am timestamptz,
  add column kunde_name text,
  add column kunde_unterschrift text,
  add column kunde_unterschrift_am timestamptz;
comment on column anlagenpruefung.session_id is 'Nur bei Prüfungen aus der Zeit der Sessions; neue Prüfungen gehören allein zu ihrer Anlage';
comment on column anlagenpruefung.abgeschlossen_am is 'Server: Abschluss angenommen, die Prüfung ist gesperrt (nur Prüfungen ohne Session)';
comment on column anlagenpruefung.revision is 'Zählt jedes Wiederöffnen (anlagenpruefung_revision); das Protokoll trägt sie';
comment on column anlagenpruefung.protokoll_nr is 'Nummer des Protokolls, vergeben beim ersten Abschluss (nur Prüfungen ohne Session)';
comment on column anlagenpruefung.unterschrift is 'Unterschrift des Hauptprüfers (Pfad im Speicher „unterschriften“)';
comment on column anlagenpruefung.unterschrift_am is 'Server: Unterschrift gültig seit; leer = fehlt oder erloschen';
comment on column anlagenpruefung.kunde_unterschrift_am is 'Server: Kundenunterschrift gültig seit; leer = fehlt oder erloschen';

-- Je Anlage läuft höchstens eine Prüfung (offline doppelt begonnene werden Duplikate)
create unique index anlagenpruefung_eine_laufende_je_anlage on anlagenpruefung (anlage_id)
  where session_id is null and status = 'in_pruefung';
create unique index anlagenpruefung_protokoll_nr on anlagenpruefung (protokoll_nr) where protokoll_nr is not null;

alter table anlagenpruefung_mitpruefer alter column session_id drop not null;
alter table anlagenpruefung_mitpruefer drop constraint anlagenpruefung_mitpruefer_status_check;
alter table anlagenpruefung_mitpruefer add constraint anlagenpruefung_mitpruefer_status_check
  check (status in ('angefragt', 'zugelassen', 'abgelehnt', 'entfernt'));
alter table anlagenpruefung_mitpruefer add column unterschrift text, add column fertig_am timestamptz;
comment on column anlagenpruefung_mitpruefer.status is 'entfernt: hat mitgeprüft und wurde entfernt oder ist gegangen; seine Einträge bleiben';
comment on column anlagenpruefung_mitpruefer.unterschrift is 'Unterschrift beim Fertigmelden (Pfad im Speicher „unterschriften“); setzt nur der Mitprüfer selbst';
comment on column anlagenpruefung_mitpruefer.fertig_am is 'Server: fertig gemeldet und unterschrieben; leer = arbeitet noch oder Unterschrift erloschen';
-- Nur die eigene Unterschrift schreibt der Mitprüfer selbst, alles andere läuft über die Funktionen
grant update (unterschrift) on anlagenpruefung_mitpruefer to authenticated;
create policy anlagenpruefung_mitpruefer_unterschreiben on anlagenpruefung_mitpruefer for update to authenticated
  using (benutzer_id = auth.uid() and ist_aktiv()) with check (benutzer_id = auth.uid() and ist_aktiv());

alter table anlagenpruefung_freigabe alter column session_id drop not null;
alter table protokoll alter column session_id drop not null;
create unique index protokoll_einmalig_je_pruefung on protokoll (anlagenpruefung_id, revision) where session_id is null;

alter table antwort add column erfasst_von uuid references benutzer (id) default auth.uid();
alter table element_ergebnis add column erfasst_von uuid references benutzer (id) default auth.uid();
alter table mangel add column erfasst_von uuid references benutzer (id) default auth.uid();
comment on column antwort.erfasst_von is 'Wer den Eintrag zuletzt erfasst oder geändert hat (seine Unterschrift deckt ihn)';
comment on column element_ergebnis.erfasst_von is 'Wer den Eintrag zuletzt erfasst oder geändert hat (seine Unterschrift deckt ihn)';
comment on column mangel.erfasst_von is 'Wer Beschreibung, Stufe oder Bezug zuletzt erfasst oder geändert hat (seine Unterschrift deckt ihn)';
update antwort a set erfasst_von = p.pruefer_id from anlagenpruefung p where p.id = a.anlagenpruefung_id;
update element_ergebnis r set erfasst_von = p.pruefer_id from anlagenpruefung p where p.id = r.anlagenpruefung_id;
update mangel m set erfasst_von = coalesce(m.erstellt_von, p.pruefer_id) from anlagenpruefung p where p.id = m.entdeckt_in;

create table anlagenpruefung_revision (
  anlagenpruefung_id uuid not null references anlagenpruefung (id) on delete cascade,
  revision int not null,
  grund text not null check (nullif(trim(grund), '') is not null),
  von uuid not null references benutzer (id) default auth.uid(),
  am timestamptz not null default now(),
  primary key (anlagenpruefung_id, revision)
);
comment on table anlagenpruefung_revision is 'Wiederöffnen einer abgeschlossenen Prüfung mit Grund; geschrieben nur über pruefung_wieder_oeffnen';
alter table anlagenpruefung_revision enable row level security;
create policy anlagenpruefung_revision_lesen on anlagenpruefung_revision for select to authenticated using (ist_aktiv());
create policy zwei_faktor on anlagenpruefung_revision as restrictive for all to authenticated
  using ((select zwei_faktor_erfuellt())) with check ((select zwei_faktor_erfuellt()));
revoke insert, update, delete on anlagenpruefung_revision from authenticated;

-- Audit auch für Tabellen, deren Schlüssel aus Prüfung und Benutzer bzw. Revision besteht
create or replace function audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  zeile jsonb := to_jsonb(coalesce(new, old));
begin
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
create trigger anlagenpruefung_revision_audit after insert on anlagenpruefung_revision for each row execute function audit();
create trigger anlagenpruefung_mitpruefer_audit after insert or update or delete on anlagenpruefung_mitpruefer
  for each row execute function audit();

select log_ueberwachen('anlagenpruefung_revision');
insert into log_bezeichnung (tabelle, spalte, text) values
  ('anlagenpruefung_revision', '', 'Wiederöffnen einer Prüfung'),
  ('anlagenpruefung_revision', 'revision', 'Revision'),
  ('anlagenpruefung_revision', 'grund', 'Grund'),
  ('anlagenpruefung', 'abgeschlossen_am', 'Abgeschlossen am'),
  ('anlagenpruefung', 'revision', 'Revision'),
  ('anlagenpruefung', 'protokoll_nr', 'Protokollnummer'),
  ('anlagenpruefung', 'unterschrift', 'Unterschrift Prüfer'),
  ('anlagenpruefung', 'unterschrift_am', 'Unterschrift gültig seit'),
  ('anlagenpruefung', 'kunde_name', 'Name Kunde'),
  ('anlagenpruefung', 'kunde_unterschrift', 'Unterschrift Kunde'),
  ('anlagenpruefung', 'kunde_unterschrift_am', 'Unterschrift Kunde gültig seit'),
  ('anlagenpruefung_mitpruefer', 'unterschrift', 'Unterschrift'),
  ('anlagenpruefung_mitpruefer', 'fertig_am', 'Fertig gemeldet am'),
  ('antwort', 'erfasst_von', 'Erfasst von'),
  ('element_ergebnis', 'erfasst_von', 'Erfasst von'),
  ('mangel', 'erfasst_von', 'Erfasst von')
  on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Sperre: Erfassen nur, solange die Prüfung läuft
-- ---------------------------------------------------------------------------
-- Gesperrt: Prüfung ohne Session nach dem Abschluss, alte Prüfung nach dem Abschluss ihrer Session
create function pruefung_gesperrt(p_anlagenpruefung_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select case when p.session_id is null then p.abgeschlossen_am is not null else not session_offen(p.session_id) end
                     from anlagenpruefung p where p.id = p_anlagenpruefung_id), false);
$$;

-- Prüfung, zu der ein Foto gehört (Fotos einer Anlage gehören zu keiner)
create function foto_pruefung(p_typ foto_bezug, p_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select case p_typ
    when 'antwort' then (select anlagenpruefung_id from antwort where id = p_id)
    when 'mangel' then (select entdeckt_in from mangel where id = p_id)
  end;
$$;

create or replace function session_sperre() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  pid uuid;
begin
  if coalesce(current_setting('session.revision', true), '') = 'ja' then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'anlagenpruefung' then
    -- Prüfungen ohne Session sperrt anlagenpruefung_abschluss
    if coalesce(new.session_id, old.session_id) is not null and not session_offen(coalesce(new.session_id, old.session_id)) then
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
  if coalesce(current_setting('session.revision', true), '') = 'ja' then
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

-- Hauptprüfer und zugelassene Mitprüfer schreiben, solange die Prüfung läuft; ein fertig gemeldeter Mitprüfer nicht mehr
create or replace function ist_eigene_offene_pruefung(p_anlagenpruefung_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from anlagenpruefung tp
    where tp.id = p_anlagenpruefung_id and not pruefung_gesperrt(tp.id)
      and (tp.pruefer_id = auth.uid()
           or (tp.status = 'in_pruefung' and exists (
                 select 1 from anlagenpruefung_mitpruefer m
                  where m.anlagenpruefung_id = tp.id and m.benutzer_id = auth.uid() and m.status = 'zugelassen'
                    and m.fertig_am is null)))
  ) and ist_aktiv();
$$;

-- Vor Ort (Anlage anlegen, Etikett zuweisen, Elemente ergänzen): jeder aktive Benutzer – es gibt keine Session mehr,
-- an der man dafür teilnehmen müsste. Was dabei änderbar ist, begrenzt weiterhin anlage_vor_ort_schuetzen.
create or replace function darf_vor_ort(p_objekt_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select ist_aktiv() and exists (select 1 from objekt where id = p_objekt_id);
$$;

-- ---------------------------------------------------------------------------
-- 3. Prüfung anlegen, beginnen, Doppelprüfung erkennen
-- ---------------------------------------------------------------------------
drop policy anlagenpruefung_anlegen on anlagenpruefung;
create policy anlagenpruefung_anlegen on anlagenpruefung for insert to authenticated with check (
  pruefer_id = auth.uid() and (
    (session_id is null and ist_aktiv())
    or (ist_teilnehmer(session_id) and session_offen(session_id))));
drop policy anlagenpruefung_aendern on anlagenpruefung;
create policy anlagenpruefung_aendern on anlagenpruefung for update to authenticated
  using (pruefer_id = auth.uid() and (session_id is null or session_offen(session_id)))
  with check (pruefer_id = auth.uid() and (session_id is null or session_offen(session_id)));

create or replace function anlagenpruefung_vor_einfuegen() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  vorhanden uuid;
  art text;
  art_name text;
  pflicht boolean;
  wiederherstellung boolean := coalesce(current_setting('session.revision', true), '') = 'ja';
begin
  if new.session_id is null then
    if new.status = 'nicht_geprueft' and not wiederherstellung then
      raise exception 'Nicht geprüfte Anlagen bleiben einfach fällig – dafür gibt es keinen Eintrag mehr';
    end if;
  elsif not wiederherstellung and not exists (
      select 1 from anlage a join session s on s.objekt_id = a.objekt_id where a.id = new.anlage_id and s.id = new.session_id) then
    raise exception 'Die Anlage gehört nicht zum Objekt dieser Prüfung';
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
  -- Sachkunde: nur wenn für die Art eingeschaltet; „nicht geprüft“ vermerkte die Sessionleitung ohne Prüfung
  if new.status <> 'nicht_geprueft' and not wiederherstellung then
    select ty.anlagenart, ar.name, ar.sachkunde_pflicht into art, art_name, pflicht
      from anlage a join anlagentyp ty on ty.id = a.anlagentyp_id join anlagenart ar on ar.schluessel = ty.anlagenart
     where a.id = new.anlage_id;
    if pflicht and not hat_sachkunde(new.pruefer_id, art) then
      raise exception 'Für % ist bei Ihnen keine gültige Sachkunde hinterlegt. Admin: unter „Benutzer“ eintragen.', art_name;
    end if;
  end if;
  if new.status <> 'duplikat' then
    if new.session_id is null then
      -- Doppelt ist eine Prüfung, die zeitlich mit einer anderen derselben Anlage zusammenfällt (offline begonnen);
      -- eine spätere Prüfung nach dem Abschluss der ersten ist eine neue Prüfung
      select p.id into vorhanden from anlagenpruefung p
       where p.session_id is null and p.anlage_id = new.anlage_id and p.status <> 'duplikat' and p.id <> new.id
         and p.begonnen_am < coalesce(new.beendet_am, 'infinity')
         and new.begonnen_am < case when p.abgeschlossen_am is null then 'infinity' else p.beendet_am end
       order by p.begonnen_am limit 1;
    else
      select id into vorhanden from anlagenpruefung
       where session_id = new.session_id and anlage_id = new.anlage_id and status <> 'duplikat' and id <> new.id
       limit 1;
    end if;
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
  if new.session_id is distinct from old.session_id or new.anlage_id <> old.anlage_id
     or (new.pruefer_id <> old.pruefer_id and coalesce(current_setting('anlagenpruefung.uebernehmen', true), '') <> 'ja') then
    raise exception 'Session, Tür und Prüfer einer Türprüfung sind unveränderlich';
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

-- Prüfung beginnen (online): reserviert die Anlage. Läuft schon eine Prüfung, kommt sie zurück (eigene: fortsetzen).
create function pruefung_beginnen(p_id uuid, p_anlage_id uuid, p_checkliste_version_id uuid, p_erfassung erfassung,
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
revoke execute on function pruefung_beginnen(uuid, uuid, uuid, erfassung, uuid) from public, anon;
grant execute on function pruefung_beginnen(uuid, uuid, uuid, erfassung, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Unterschriften und Abschluss
-- ---------------------------------------------------------------------------
-- Eine Unterschrift wird nur gültig, wenn eine neue ankommt – eine erloschene macht ein veralteter Sync nicht wieder gültig.
create function anlagenpruefung_abschluss() returns trigger
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
    -- Anderes Ergebnis: Unterschriften von Hauptprüfer und Kunde erlöschen, sofern nicht neu unterschrieben
    if (new.ergebnis, new.ergebnis_auto, new.ergebnis_begruendung) is distinct from (old.ergebnis, old.ergebnis_auto, old.ergebnis_begruendung) then
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
-- Name mit „zz“: läuft nach den übrigen Prüfungen (Duplikat, Übernahme, Prüfart sind dann schon geklärt)
create trigger anlagenpruefung_zz_abschluss before insert or update on anlagenpruefung
  for each row execute function anlagenpruefung_abschluss();

-- Mitprüfer: die eigene Unterschrift macht ihn fertig, eine leere nimmt das zurück
create function mitpruefer_unterschrift() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('anlagenpruefung.intern', true), '') = 'ja'
     or coalesce(current_setting('session.revision', true), '') = 'ja' then
    return new;
  end if;
  if new.unterschrift is not distinct from old.unterschrift then
    new.fertig_am := old.fertig_am;
    return new;
  end if;
  if new.benutzer_id is distinct from auth.uid() then raise exception 'Unterschreiben kann nur der Mitprüfer selbst'; end if;
  if pruefung_gesperrt(new.anlagenpruefung_id) then
    raise exception 'Die Prüfung ist abgeschlossen und kann nicht mehr geändert werden';
  end if;
  if new.unterschrift is not null and old.status <> 'zugelassen' then
    raise exception 'Sie sind für diese Prüfung nicht (mehr) als Mitprüfer zugelassen';
  end if;
  new.fertig_am := case when new.unterschrift is null then null else now() end;
  return new;
end $$;
create trigger anlagenpruefung_mitpruefer_unterschrift before update on anlagenpruefung_mitpruefer
  for each row execute function mitpruefer_unterschrift();

-- Unterschrift eines Beteiligten erlischt (und die des Kunden)
create function unterschrift_erloeschen(p_anlagenpruefung_id uuid, p_benutzer_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  vorher text := coalesce(current_setting('anlagenpruefung.intern', true), '');
begin
  perform set_config('anlagenpruefung.intern', 'ja', true);
  update anlagenpruefung set unterschrift_am = null
   where id = p_anlagenpruefung_id and pruefer_id = p_benutzer_id and unterschrift_am is not null;
  update anlagenpruefung set kunde_unterschrift_am = null
   where id = p_anlagenpruefung_id and kunde_unterschrift_am is not null;
  update anlagenpruefung_mitpruefer set fertig_am = null
   where anlagenpruefung_id = p_anlagenpruefung_id and benutzer_id = p_benutzer_id and fertig_am is not null;
  perform set_config('anlagenpruefung.intern', vorher, true);
end $$;
revoke execute on function unterschrift_erloeschen(uuid, uuid) from public, anon, authenticated;

-- Einträge merken sich ihren Verfasser; eine echte Änderung lässt die Unterschriften des bisherigen Verfassers und des
-- Ändernden erlöschen. Bei Mängeln zählen nur Beschreibung, Stufe und Bezug (nicht „behoben“/„nachgeprüft“).
create function eintrag_unterschrift() returns trigger
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
    raise exception 'Einträge einer Prüfung ändern nur ihre Prüfer – bitte die Prüfung übernehmen';
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
create trigger antwort_unterschrift before insert or update or delete on antwort
  for each row execute function eintrag_unterschrift();
create trigger element_ergebnis_unterschrift before insert or update or delete on element_ergebnis
  for each row execute function eintrag_unterschrift();
create trigger mangel_unterschrift before insert or update or delete on mangel
  for each row execute function eintrag_unterschrift();
create trigger foto_unterschrift before insert or update or delete on foto
  for each row execute function eintrag_unterschrift();

-- ---------------------------------------------------------------------------
-- 5. Wieder öffnen (neue Revision)
-- ---------------------------------------------------------------------------
-- Am Tag des Abschlusses der Hauptprüfer, danach ein Admin. Die Unterschriften bleiben zunächst gültig.
-- Ein Admin kann dabei einen anderen Prüfer einsetzen: Der bisherige bleibt mit seiner Unterschrift als Mitprüfer beteiligt.
create function pruefung_wieder_oeffnen(p_anlagenpruefung_id uuid, p_grund text, p_pruefer_id uuid default null) returns int
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
  if tp.session_id is not null then raise exception 'Prüfungen aus einer Session werden über die Revision der Session korrigiert'; end if;
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
revoke execute on function pruefung_wieder_oeffnen(uuid, text, uuid) from public, anon;
grant execute on function pruefung_wieder_oeffnen(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Mitprüfen, Freigeben, Doppelprüfungen ohne Session
-- ---------------------------------------------------------------------------
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
  if tp.session_id is null then
    if not ist_aktiv() then raise exception 'Nicht angemeldet oder deaktiviert'; end if;
  elsif not ist_teilnehmer(tp.session_id) then
    raise exception 'Sie nehmen an dieser Prüfung nicht teil';
  end if;
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
  insert into anlagenpruefung_mitpruefer (anlagenpruefung_id, session_id, benutzer_id)
    values (tp.id, tp.session_id, auth.uid())
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
  if tp.pruefer_id <> auth.uid() then raise exception 'Nur der Hauptprüfer kann das Mitprüfen zulassen'; end if;
  if pruefung_gesperrt(tp.id) or tp.status <> 'in_pruefung' then raise exception 'Diese Prüfung läuft nicht mehr'; end if;
  update anlagenpruefung_mitpruefer
     set status = case when p_zulassen then 'zugelassen' else 'abgelehnt' end, entschieden_am = now()
   where anlagenpruefung_id = tp.id and benutzer_id = p_benutzer_id and status = 'angefragt';
  if not found then raise exception 'Es liegt keine offene Anfrage vor'; end if;
end $$;

-- Ohne Session bleibt der Mitprüfer als „entfernt“ verzeichnet: seine Einträge bleiben, im Protokoll ohne Unterschrift
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
  if tp.session_id is null then
    perform set_config('anlagenpruefung.intern', 'ja', true);
    update anlagenpruefung_mitpruefer set status = 'entfernt', unterschrift = null, fertig_am = null
     where anlagenpruefung_id = tp.id and benutzer_id = wer and status <> 'entfernt';
    perform set_config('anlagenpruefung.intern', '', true);
  else
    delete from anlagenpruefung_mitpruefer where anlagenpruefung_id = tp.id and benutzer_id = wer;
  end if;
end $$;

-- Laufende Prüfung freigeben: der Prüfer selbst (Abbrechen), die Sessionleitung (alte Sessions) oder ein Admin
create or replace function reservierung_aufheben(p_anlagenpruefung_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  tp anlagenpruefung;
begin
  select * into tp from anlagenpruefung where id = p_anlagenpruefung_id;
  if tp.id is null then return; end if;
  if not (tp.pruefer_id = auth.uid() or ist_leiter(tp.session_id) or ist_admin()) then
    raise exception 'Nur der Prüfer selbst oder der Sessionleiter kann die Reservierung aufheben';
  end if;
  if tp.status <> 'in_pruefung' then raise exception 'Nur laufende Prüfungen können freigegeben werden'; end if;
  if tp.revision > 0 then raise exception 'Eine wieder geöffnete Prüfung kann nicht verworfen werden – bitte wieder abschließen'; end if;
  if tp.pruefer_id <> auth.uid() then
    insert into anlagenpruefung_freigabe (id, session_id, anlage_id, pruefer_id)
      values (tp.id, tp.session_id, tp.anlage_id, tp.pruefer_id) on conflict (id) do nothing;
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

drop policy anlagenpruefung_freigabe_lesen on anlagenpruefung_freigabe;
create policy anlagenpruefung_freigabe_lesen on anlagenpruefung_freigabe for select to authenticated
  using (pruefer_id = auth.uid() or ist_teilnehmer(session_id) or ist_admin());

-- Ohne Session klären die beteiligten Prüfer oder ein Admin, welche Prüfung gilt
create or replace function duplikat_aufloesen(p_gueltig uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  tp anlagenpruefung;
  erste uuid;
begin
  select * into tp from anlagenpruefung where id = p_gueltig;
  if tp.id is null then raise exception 'Prüfung nicht gefunden'; end if;
  if tp.session_id is null then
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
    return;
  end if;
  if not (ist_leiter(tp.session_id) or ist_admin()) then raise exception 'Nur der Sessionleiter kann Doppelprüfungen klären'; end if;
  perform set_config('anlagenpruefung.aufloesen', 'ja', true);
  -- erst alle anderen zu Duplikaten machen (eindeutiger Index), dann die gültige freigeben
  update anlagenpruefung set status = 'duplikat', duplikat_von = tp.id, duplikat_geklaert = true
   where session_id = tp.session_id and anlage_id = tp.anlage_id and id <> tp.id;
  update anlagenpruefung
     set status = case when beendet_am is not null then 'geprueft'::pruefung_status else 'in_pruefung' end,
         duplikat_von = null, duplikat_geklaert = true
   where id = tp.id;
  perform set_config('anlagenpruefung.aufloesen', '', true);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Protokoll je Prüfung: Pfad p/<Prüfung>/r<Revision>/<Datei>.pdf
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
          and ap.status = 'geprueft' and ap.abgeschlossen_am is not null));
$$;

drop policy protokoll_anlegen on protokoll;
create policy protokoll_anlegen on protokoll for insert to authenticated with check (
  protokoll_pfad_erlaubt(storage_pfad) and (
    (session_id is not null
     and split_part(storage_pfad, '/', 1) = session_id::text and split_part(storage_pfad, '/', 2) = 'r' || revision
     and case art
           when 'sammel' then anlagenpruefung_id is null
           else exists (select 1 from anlagenpruefung ap where ap.id = protokoll.anlagenpruefung_id and ap.session_id = protokoll.session_id)
         end)
    or (session_id is null and art = 'einzel'
        and split_part(storage_pfad, '/', 1) = 'p' and split_part(storage_pfad, '/', 2) = anlagenpruefung_id::text
        and split_part(storage_pfad, '/', 3) = 'r' || revision)));

-- ---------------------------------------------------------------------------
-- 8. Datensicherung: Mitprüfer (mit Unterschriften) und Revisionen der Prüfungen
-- ---------------------------------------------------------------------------
create or replace function admin_wiederherstellen(p_tabelle text, p_zeilen jsonb) returns jsonb
language plpgsql security definer set search_path = public as $function$
declare
  erlaubt constant text[] := array['benutzer', 'firma', 'erscheinungsbild', 'anlagenart', 'benutzer_sachkunde', 'endkunde', 'objekt', 'checkliste', 'checkliste_version',
    'anlagentyp', 'pruefart', 'etikett', 'anlage', 'anlage_faelligkeit', 'anlage_element', 'session', 'session_revision',
    'session_teilnehmer', 'anlagenpruefung', 'anlagenpruefung_mitpruefer', 'anlagenpruefung_revision', 'antwort', 'mangel',
    'element_ergebnis', 'foto', 'protokoll', 'protokoll_zaehler'];
  zeile jsonb;
  spalten text;
  n int;
  eingefuegt int := 0;
  vorhanden int := 0;
  fehler text[] := '{}';
  neu_angelegt boolean;
begin
  if not ist_systemadmin() then raise exception 'Nur Admins dürfen wiederherstellen'; end if;
  if not (p_tabelle = any (erlaubt)) then raise exception 'Tabelle % kann nicht wiederhergestellt werden', p_tabelle; end if;
  if jsonb_typeof(p_zeilen) <> 'array' then raise exception 'Zeilen müssen ein Array sein'; end if;

  -- Schutzregeln für abgeschlossene Prüfungen gelten beim Wiederherstellen nicht (nur in dieser Transaktion)
  perform set_config('session.revision', 'ja', true);

  for zeile in select * from jsonb_array_elements(p_zeilen) loop
    begin
      if p_tabelle = 'benutzer' then
        -- Zugang anlegen, falls er fehlt (ohne Passwort – Admin vergibt danach ein neues)
        neu_angelegt := false;
        if not exists (select 1 from auth.users where id = (zeile ->> 'id')::uuid) then
          if exists (select 1 from auth.users where lower(email) = lower(zeile ->> 'email')) then
            raise exception 'E-Mail % gehört bereits einem anderen Zugang', zeile ->> 'email';
          end if;
          insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                                  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                                  confirmation_token, recovery_token, email_change_token_new, email_change)
          values ('00000000-0000-0000-0000-000000000000', (zeile ->> 'id')::uuid, 'authenticated', 'authenticated',
                  zeile ->> 'email', '', now(),
                  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'rolle', zeile ->> 'rolle'),
                  jsonb_build_object('name', zeile ->> 'name'), now(), now(), '', '', '', '');
          insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
          values (zeile ->> 'id', (zeile ->> 'id')::uuid,
                  jsonb_build_object('sub', zeile ->> 'id', 'email', zeile ->> 'email'), 'email', now(), now())
          on conflict (provider_id, provider) do update set user_id = excluded.user_id, identity_data = excluded.identity_data;
          neu_angelegt := true;
        end if;
        if neu_angelegt then
          update benutzer set name = coalesce(zeile ->> 'name', name), sachkunde_hinweis = zeile ->> 'sachkunde_hinweis',
                 aktiv = coalesce((zeile ->> 'aktiv')::boolean, true)
           where id = (zeile ->> 'id')::uuid;
          eingefuegt := eingefuegt + 1;
        else
          vorhanden := vorhanden + 1;
        end if;
        continue;
      end if;

      if p_tabelle = 'protokoll_zaehler' then
        insert into protokoll_zaehler (jahr, letzte) values ((zeile ->> 'jahr')::int, (zeile ->> 'letzte')::int)
          on conflict (jahr) do update set letzte = greatest(protokoll_zaehler.letzte, excluded.letzte);
        eingefuegt := eingefuegt + 1;
        continue;
      end if;

      -- Etiketten zuerst ohne Tür; die Zuordnung setzt der Trigger beim Wiederherstellen der Tür
      if p_tabelle = 'etikett' then zeile := zeile || '{"anlage_id": null, "zugeordnet_am": null}'::jsonb; end if;

      -- Nur Spalten übernehmen, die im Backup UND in der Tabelle vorkommen (Standardwerte bleiben sonst erhalten)
      select string_agg(quote_ident(k), ', ') into spalten
        from jsonb_object_keys(zeile) k
       where exists (select 1 from information_schema.columns c
                      where c.table_schema = 'public' and c.table_name = p_tabelle and c.column_name = k
                        and c.is_generated = 'NEVER' and c.identity_generation is null);
      begin
        execute format('insert into %I (%s) select %s from jsonb_populate_record(null::%I, $1) on conflict do nothing',
                       p_tabelle, spalten, spalten, p_tabelle) using zeile;
      exception when unique_violation then
        -- Alte freigegebene Checklisten-Version, obwohl heute eine neuere freigegeben ist → als archiviert ergänzen
        if p_tabelle = 'checkliste_version' and zeile ->> 'status' = 'freigegeben' then
          zeile := zeile || '{"status": "archiviert"}'::jsonb;
          execute format('insert into %I (%s) select %s from jsonb_populate_record(null::%I, $1) on conflict do nothing',
                         p_tabelle, spalten, spalten, p_tabelle) using zeile;
        else
          raise;
        end if;
      end;
      get diagnostics n = row_count;
      if n > 0 then eingefuegt := eingefuegt + 1; else vorhanden := vorhanden + 1; end if;
    exception when others then
      if array_length(fehler, 1) is null or array_length(fehler, 1) < 20 then
        fehler := fehler || format('%s %s: %s', p_tabelle, coalesce(zeile ->> 'id', ''), sqlerrm);
      end if;
    end;
  end loop;

  return jsonb_build_object('eingefuegt', eingefuegt, 'vorhanden', vorhanden,
                            'fehlgeschlagen', jsonb_array_length(p_zeilen) - eingefuegt - vorhanden, 'fehler', to_jsonb(fehler));
end $function$;

select set_config('session.revision', '', true);
