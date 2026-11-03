-- Phase 2: Prüfablauf vor Ort (Spezifikation 3.1, 3.8, 4.3, 4.4)
-- Schreibrechte für Prüfer, Reservierung, Doppelprüfungen, Abschluss, Datei-Speicher, Realtime.

-- ---------------------------------------------------------------------------
-- Schemaergänzungen
-- ---------------------------------------------------------------------------
-- Nicht geprüfte Türen haben keine Checkliste
alter table tuerpruefung alter column checkliste_version_id drop not null;
alter table tuerpruefung add constraint tuerpruefung_checkliste_noetig
  check (status = 'nicht_geprueft' or checkliste_version_id is not null);
alter table tuerpruefung add constraint tuerpruefung_grund_noetig
  check (status <> 'nicht_geprueft' or nullif(trim(nicht_geprueft_grund), '') is not null);
-- Doppelprüfung (offline entstanden) wurde vom Sessionleiter geklärt
alter table tuerpruefung add column duplikat_geklaert boolean not null default false;

-- ---------------------------------------------------------------------------
-- Hilfsfunktionen
-- ---------------------------------------------------------------------------
create function ist_teilnehmer(p_session_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from session_teilnehmer where session_id = p_session_id and benutzer_id = auth.uid())
     and ist_aktiv();
$$;

create function ist_leiter(p_session_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from session where id = p_session_id and leiter_id = auth.uid()) and ist_aktiv();
$$;

create function session_offen(p_session_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from session where id = p_session_id and status = 'offen');
$$;

create function pruefung_session(p_tuerpruefung_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select session_id from tuerpruefung where id = p_tuerpruefung_id;
$$;

create function ist_eigene_offene_pruefung(p_tuerpruefung_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tuerpruefung tp join session s on s.id = tp.session_id
    where tp.id = p_tuerpruefung_id and tp.pruefer_id = auth.uid() and s.status = 'offen'
  ) and ist_aktiv();
$$;

-- ---------------------------------------------------------------------------
-- Zugriffsregeln für Prüfer (Lesen + Admin bestehen bereits aus dem Grundschema)
-- ---------------------------------------------------------------------------
-- Teilnehmer: eigene Zeile (fertig, Unterschrift) bzw. Sessionleiter (Bereiche) in offener Session
create policy teilnehmer_aendern on session_teilnehmer for update to authenticated
  using (session_offen(session_id) and (benutzer_id = auth.uid() or ist_leiter(session_id)))
  with check (session_offen(session_id) and (benutzer_id = auth.uid() or ist_leiter(session_id)));

-- Türprüfung: nur eigene, nur in offener Session, nur als Teilnehmer
create policy tuerpruefung_anlegen on tuerpruefung for insert to authenticated
  with check (pruefer_id = auth.uid() and ist_teilnehmer(session_id) and session_offen(session_id));
create policy tuerpruefung_aendern on tuerpruefung for update to authenticated
  using (pruefer_id = auth.uid() and session_offen(session_id))
  with check (pruefer_id = auth.uid() and session_offen(session_id));

-- Antworten: nur zu eigener Prüfung in offener Session
create policy antwort_schreiben on antwort for all to authenticated
  using (ist_eigene_offene_pruefung(tuerpruefung_id))
  with check (ist_eigene_offene_pruefung(tuerpruefung_id));

-- Mängel: anlegen/löschen nur aus eigener offener Prüfung; Status ändern dürfen alle aktiven (siehe Trigger)
create policy mangel_anlegen on mangel for insert to authenticated
  with check (ist_eigene_offene_pruefung(entdeckt_in));
create policy mangel_loeschen on mangel for delete to authenticated
  using (ist_eigene_offene_pruefung(entdeckt_in) and status = 'offen');
create policy mangel_aendern on mangel for update to authenticated
  using (ist_aktiv()) with check (ist_aktiv());

-- Fotos: eigene anlegen und löschen
create policy foto_anlegen on foto for insert to authenticated
  with check (ist_aktiv() and erstellt_von = auth.uid());
create policy foto_loeschen on foto for delete to authenticated
  using (ist_aktiv() and erstellt_von = auth.uid());

-- ---------------------------------------------------------------------------
-- Trigger: Türprüfung
-- ---------------------------------------------------------------------------
-- Offline entstandene Doppelprüfung: nicht ablehnen (Daten gehen sonst verloren), sondern als Duplikat speichern.
create function tuerpruefung_vor_einfuegen() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  vorhanden uuid;
begin
  if new.status <> 'duplikat' then
    select id into vorhanden from tuerpruefung
     where session_id = new.session_id and tuer_id = new.tuer_id and status <> 'duplikat' and id <> new.id
     limit 1;
    if vorhanden is not null then
      new.status := 'duplikat';
      new.duplikat_von := vorhanden;
      new.duplikat_geklaert := false;
    end if;
  end if;
  return new;
end $$;

create trigger tuerpruefung_vor_einfuegen before insert on tuerpruefung
  for each row execute function tuerpruefung_vor_einfuegen();

create function tuerpruefung_vor_aendern() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.session_id <> old.session_id or new.tuer_id <> old.tuer_id or new.pruefer_id <> old.pruefer_id then
    raise exception 'Session, Tür und Prüfer einer Türprüfung sind unveränderlich';
  end if;
  -- Ein Duplikat bleibt Duplikat, bis der Sessionleiter es klärt (Sync des Geräts darf das nicht überschreiben)
  if old.status = 'duplikat' and new.status <> 'duplikat'
     and coalesce(current_setting('tuerpruefung.aufloesen', true), '') <> 'ja' then
    new.status := 'duplikat';
    new.duplikat_von := old.duplikat_von;
    new.duplikat_geklaert := old.duplikat_geklaert;
  end if;
  return new;
end $$;

create trigger tuerpruefung_vor_aendern before update on tuerpruefung
  for each row execute function tuerpruefung_vor_aendern();

-- Abgeschlossene Sessions sind gesperrt (Korrektur nur per Revision, Phase 3)
create function session_sperre() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  sid uuid;
begin
  if tg_table_name = 'tuerpruefung' then
    sid := coalesce(new.session_id, old.session_id);
  else
    sid := pruefung_session(coalesce(new.tuerpruefung_id, old.tuerpruefung_id));
  end if;
  if not session_offen(sid) and coalesce(current_setting('session.revision', true), '') <> 'ja' then
    raise exception 'Die Prüfung ist abgeschlossen und kann nicht mehr geändert werden';
  end if;
  return coalesce(new, old);
end $$;

create trigger tuerpruefung_sperre before insert or update or delete on tuerpruefung
  for each row execute function session_sperre();
create trigger antwort_sperre before insert or update or delete on antwort
  for each row execute function session_sperre();

-- Geprüfte Tür: letztes Prüfdatum und Ergebnis an der Tür nachführen (→ Fälligkeit per Trigger)
create function tuerpruefung_nach_aendern() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  tag date;
begin
  if new.status = 'geprueft' and new.ergebnis is not null then
    tag := coalesce(new.beendet_am, new.begonnen_am)::date;
    update tuer set letzte_pruefung_am = tag, letztes_ergebnis = new.ergebnis
     where id = new.tuer_id and (letzte_pruefung_am is null or letzte_pruefung_am <= tag);
  end if;
  return new;
end $$;

create trigger tuerpruefung_nach_aendern after insert or update of status, ergebnis, beendet_am on tuerpruefung
  for each row execute function tuerpruefung_nach_aendern();

-- ---------------------------------------------------------------------------
-- Trigger: Mangel
-- ---------------------------------------------------------------------------
create function mangel_schutz() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if ist_admin() or auth.uid() is null then
    return new;
  end if;
  if (new.beschreibung, new.stufe, new.punkt_id, new.tuer_id, new.entdeckt_in)
     is distinct from (old.beschreibung, old.stufe, old.punkt_id, old.tuer_id, old.entdeckt_in)
     and not ist_eigene_offene_pruefung(old.entdeckt_in) then
    raise exception 'Mängel können nur in der eigenen, offenen Prüfung bearbeitet werden';
  end if;
  if new.status = 'nachgeprueft' and old.status <> 'nachgeprueft'
     and (new.nachgeprueft_in is null or not ist_eigene_offene_pruefung(new.nachgeprueft_in)) then
    raise exception 'Nachprüfung nur innerhalb einer eigenen Prüfung der Tür';
  end if;
  if new.status = 'verworfen' and old.status <> 'verworfen' then
    raise exception 'Nur Admins dürfen Mängel verwerfen';
  end if;
  if new.status = 'behoben' and old.status <> 'behoben' and new.behoben_am is null then
    new.behoben_am := now();
  end if;
  return new;
end $$;

create trigger mangel_schutz before update on mangel
  for each row execute function mangel_schutz();


-- ---------------------------------------------------------------------------
-- RPC: Session starten bzw. beitreten (idempotent; Gerät erzeugt die ID, auch offline)
-- Gibt die ID der gültigen Session zurück. Weicht sie ab (Kollege hat schon gestartet),
-- führt das Gerät seine lokale Session in diese über.
-- ---------------------------------------------------------------------------
create function session_starten(p_session_id uuid, p_objekt_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  ziel uuid;
begin
  if not ist_aktiv() then raise exception 'Nicht angemeldet oder deaktiviert'; end if;
  for versuch in 1..3 loop
    -- schon bekannt (erneuter Sync) oder offene Session des Objekts
    select id into ziel from session where id = p_session_id and status = 'offen';
    if ziel is null then
      select id into ziel from session
       where objekt_id = p_objekt_id and status = 'offen' and zusammengefuehrt_in is null;
    end if;
    if ziel is null then
      begin
        insert into session (id, objekt_id, leiter_id) values (p_session_id, p_objekt_id, auth.uid());
        ziel := p_session_id;
      exception when unique_violation then
        ziel := null;  -- gleichzeitig von Kollegen gestartet → erneut suchen
        continue;
      end;
    end if;
    insert into session_teilnehmer (session_id, benutzer_id) values (ziel, auth.uid())
      on conflict do nothing;
    return ziel;
  end loop;
  raise exception 'Session konnte nicht gestartet werden';
end $$;

-- ---------------------------------------------------------------------------
-- RPC: Tür reservieren (online). Lehnt ab, wenn ein Kollege die Tür schon hat.
-- ---------------------------------------------------------------------------
create function tuer_reservieren(p_id uuid, p_session_id uuid, p_tuer_id uuid,
                                 p_checkliste_version_id uuid, p_erfassung erfassung)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  vorhanden tuerpruefung;
  name text;
begin
  if not ist_teilnehmer(p_session_id) then raise exception 'Sie nehmen an dieser Prüfung nicht teil'; end if;
  if not session_offen(p_session_id) then raise exception 'Die Prüfung ist bereits abgeschlossen'; end if;
  if exists (select 1 from tuerpruefung where id = p_id) then
    return jsonb_build_object('ok', true, 'id', p_id);
  end if;
  select * into vorhanden from tuerpruefung
   where session_id = p_session_id and tuer_id = p_tuer_id and status <> 'duplikat'
   for update;
  if vorhanden.id is not null then
    if vorhanden.pruefer_id = auth.uid() then
      return jsonb_build_object('ok', true, 'id', vorhanden.id, 'fortsetzen', true);
    end if;
    select b.name into name from benutzer b where b.id = vorhanden.pruefer_id;
    return jsonb_build_object('ok', false, 'pruefer', name, 'status', vorhanden.status);
  end if;
  insert into tuerpruefung (id, session_id, tuer_id, pruefer_id, checkliste_version_id, erfassung)
    values (p_id, p_session_id, p_tuer_id, auth.uid(), p_checkliste_version_id, p_erfassung);
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

-- ---------------------------------------------------------------------------
-- RPC: Reservierung aufheben (eigene oder als Sessionleiter), nur solange in Prüfung
-- ---------------------------------------------------------------------------
create function reservierung_aufheben(p_tuerpruefung_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  tp tuerpruefung;
begin
  select * into tp from tuerpruefung where id = p_tuerpruefung_id;
  if tp.id is null then return; end if;
  if not (tp.pruefer_id = auth.uid() or ist_leiter(tp.session_id) or ist_admin()) then
    raise exception 'Nur der Prüfer selbst oder der Sessionleiter kann die Reservierung aufheben';
  end if;
  if tp.status <> 'in_pruefung' then raise exception 'Nur laufende Prüfungen können freigegeben werden'; end if;
  delete from foto where bezug_typ = 'mangel' and bezug_id in (select id from mangel where entdeckt_in = tp.id);
  delete from mangel where entdeckt_in = tp.id;
  delete from antwort where tuerpruefung_id = tp.id;
  delete from tuerpruefung where id = tp.id;
end $$;

-- ---------------------------------------------------------------------------
-- RPC: Doppelprüfung klären – p_gueltig gilt, alle anderen derselben Tür/Session werden Duplikat
-- ---------------------------------------------------------------------------
create function duplikat_aufloesen(p_gueltig uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  tp tuerpruefung;
begin
  select * into tp from tuerpruefung where id = p_gueltig;
  if tp.id is null then raise exception 'Prüfung nicht gefunden'; end if;
  if not (ist_leiter(tp.session_id) or ist_admin()) then raise exception 'Nur der Sessionleiter kann Doppelprüfungen klären'; end if;
  perform set_config('tuerpruefung.aufloesen', 'ja', true);
  -- erst alle anderen zu Duplikaten machen (eindeutiger Index), dann die gültige freigeben
  update tuerpruefung set status = 'duplikat', duplikat_von = tp.id, duplikat_geklaert = true
   where session_id = tp.session_id and tuer_id = tp.tuer_id and id <> tp.id;
  update tuerpruefung
     set status = case when beendet_am is not null then 'geprueft'::pruefung_status else 'in_pruefung' end,
         duplikat_von = null, duplikat_geklaert = true
   where id = tp.id;
  perform set_config('tuerpruefung.aufloesen', '', true);
end $$;

-- ---------------------------------------------------------------------------
-- RPC: Tür als „nicht geprüft“ markieren (Sessionleiter beim Abschluss)
-- ---------------------------------------------------------------------------
create function tuer_nicht_geprueft(p_id uuid, p_session_id uuid, p_tuer_id uuid, p_grund text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (ist_leiter(p_session_id) or ist_admin()) then raise exception 'Nur der Sessionleiter'; end if;
  if nullif(trim(p_grund), '') is null then raise exception 'Bitte einen Grund angeben'; end if;
  if exists (select 1 from tuerpruefung where session_id = p_session_id and tuer_id = p_tuer_id and status <> 'duplikat' and id <> p_id) then
    raise exception 'Für diese Tür gibt es bereits eine Prüfung';
  end if;
  insert into tuerpruefung (id, session_id, tuer_id, pruefer_id, erfassung, status, nicht_geprueft_grund, beendet_am)
    values (p_id, p_session_id, p_tuer_id, auth.uid(), 'manuell', 'nicht_geprueft', trim(p_grund), now())
    on conflict (id) do update set nicht_geprueft_grund = excluded.nicht_geprueft_grund;
end $$;

-- ---------------------------------------------------------------------------
-- RPC: Sessionleitung übertragen
-- ---------------------------------------------------------------------------
create function sessionleitung_uebertragen(p_session_id uuid, p_benutzer_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (ist_leiter(p_session_id) or ist_admin()) then raise exception 'Nur der Sessionleiter'; end if;
  if not exists (select 1 from session_teilnehmer where session_id = p_session_id and benutzer_id = p_benutzer_id) then
    raise exception 'Der neue Leiter muss an der Prüfung teilnehmen';
  end if;
  update session set leiter_id = p_benutzer_id where id = p_session_id and status = 'offen';
end $$;

-- ---------------------------------------------------------------------------
-- RPC: Session abschließen (Sessionleiter). Prüft Vollständigkeit, sperrt danach.
-- ---------------------------------------------------------------------------
create function session_abschliessen(p_session_id uuid, p_bemerkung text, p_unterschrift_leiter text,
                                     p_unterschrift_kunde text, p_kunde_name text) returns void
language plpgsql security definer set search_path = public as $$
declare
  s session;
  offen text;
begin
  select * into s from session where id = p_session_id for update;
  if s.id is null then raise exception 'Prüfung nicht gefunden'; end if;
  if s.status <> 'offen' then return; end if;  -- idempotent (erneuter Sync)
  if not (s.leiter_id = auth.uid() and ist_aktiv()) then raise exception 'Nur der Sessionleiter kann abschließen'; end if;
  if nullif(p_unterschrift_leiter, '') is null then raise exception 'Unterschrift des Sessionleiters fehlt'; end if;
  if p_unterschrift_kunde is not null and nullif(trim(p_kunde_name), '') is null then
    raise exception 'Bitte den Namen des Kundenvertreters angeben';
  end if;

  if exists (select 1 from tuerpruefung where session_id = s.id and status = 'in_pruefung') then
    raise exception 'Es sind noch Türen in Prüfung';
  end if;
  if exists (select 1 from tuerpruefung where session_id = s.id and status = 'duplikat' and not duplikat_geklaert) then
    raise exception 'Es gibt ungeklärte Doppelprüfungen';
  end if;
  select string_agg(coalesce(t.etikett_id, t.kunden_bezeichnung, 'ohne Bezeichnung'), ', ') into offen
    from tuer t
   where t.objekt_id = s.objekt_id and t.status = 'aktiv'
     and not exists (select 1 from tuerpruefung tp where tp.session_id = s.id and tp.tuer_id = t.id and tp.status <> 'duplikat');
  if offen is not null then raise exception 'Türen ohne Ergebnis: %', offen; end if;
  if exists (
    select 1 from session_teilnehmer st
     where st.session_id = s.id and st.benutzer_id <> s.leiter_id and st.fertig_am is null
       and exists (select 1 from tuerpruefung tp where tp.session_id = s.id and tp.pruefer_id = st.benutzer_id)
  ) then
    raise exception 'Nicht alle Prüfer haben ihre Türen als fertig gemeldet';
  end if;

  update session_teilnehmer set fertig_am = coalesce(fertig_am, now()),
         unterschrift = coalesce(unterschrift, p_unterschrift_leiter)
   where session_id = s.id and benutzer_id = s.leiter_id;
  update session set status = 'abgeschlossen', abgeschlossen_am = now(), bemerkung = nullif(trim(p_bemerkung), ''),
         unterschrift_leiter = p_unterschrift_leiter, unterschrift_kunde = p_unterschrift_kunde,
         kunde_name = nullif(trim(p_kunde_name), '')
   where id = s.id;
end $$;

do $$
declare f text;
begin
  foreach f in array array['session_starten(uuid, uuid)', 'tuer_reservieren(uuid, uuid, uuid, uuid, erfassung)',
    'reservierung_aufheben(uuid)', 'duplikat_aufloesen(uuid)', 'tuer_nicht_geprueft(uuid, uuid, uuid, text)',
    'sessionleitung_uebertragen(uuid, uuid)', 'session_abschliessen(uuid, text, text, text, text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Datei-Speicher: Fotos und Unterschriften (privat)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('fotos', 'fotos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('unterschriften', 'unterschriften', false, 1048576, array['image/png'])
on conflict (id) do nothing;

create policy dateien_lesen on storage.objects for select to authenticated
  using (bucket_id in ('fotos', 'unterschriften') and public.ist_aktiv());
create policy dateien_hochladen on storage.objects for insert to authenticated
  with check (bucket_id in ('fotos', 'unterschriften') and public.ist_aktiv());
create policy dateien_admin on storage.objects for all to authenticated
  using (bucket_id in ('fotos', 'unterschriften') and public.ist_admin())
  with check (bucket_id in ('fotos', 'unterschriften') and public.ist_admin());

-- ---------------------------------------------------------------------------
-- Realtime: Live-Türliste für alle Teilnehmer (RLS gilt auch hier)
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table tuerpruefung, session_teilnehmer, session;
