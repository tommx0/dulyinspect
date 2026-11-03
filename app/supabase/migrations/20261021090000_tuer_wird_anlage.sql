-- Version 2.0.0, Phase 1 aus docs/KONZEPT-ANLAGEN.md: Tür → Anlage.
-- Reine Umbenennung, keine fachliche Änderung. Tabellen, Spalten, Typen, Indizes, Constraints, Trigger, Richtlinien
-- und Funktionen bekommen allgemeine Namen, damit später weitere Anlagenarten (Sicherheitsbeleuchtung, BMA, EMA) folgen können.
-- Etiketten (FT-00001) und die Türkategorie (tuer_kategorie) bleiben unverändert.
-- Erzeugt aus dem Datenbankkatalog; Funktionsrümpfe werden neu angelegt, weil Postgres sie bei Umbenennungen nicht anpasst.

-- 1. Richtlinien vorübergehend entfernen, die Funktionen mit umbenannten Parametern nutzen
drop policy antwort_schreiben on antwort;
drop policy foto_loeschen_eigene_pruefung on foto;
drop policy mangel_anlegen on mangel;
drop policy mangel_loeschen on mangel;

-- 2. Tabellen, Spalten, Typen
alter table tuerpruefung_freigabe rename to anlagenpruefung_freigabe;
alter table tuerpruefung rename to anlagenpruefung;
alter table tuertyp rename to anlagentyp;
alter table tuer rename to anlage;
alter table antwort rename column tuerpruefung_id to anlagenpruefung_id;
alter table etikett rename column tuer_id to anlage_id;
alter table mangel rename column tuer_id to anlage_id;
alter table protokoll rename column tuerpruefung_id to anlagenpruefung_id;
alter table anlage rename column tuertyp_id to anlagentyp_id;
alter table anlagenpruefung rename column tuer_id to anlage_id;
alter table anlagenpruefung_freigabe rename column tuer_id to anlage_id;
alter type tuer_status rename to anlage_status;
alter type foto_bezug rename value 'tuer' to 'anlage';

-- 3. Namen von Indizes, Constraints, Triggern und Richtlinien
alter table antwort rename constraint antwort_tuerpruefung_id_fkey to antwort_anlagenpruefung_id_fkey;
alter table antwort rename constraint antwort_tuerpruefung_id_punkt_id_key to antwort_anlagenpruefung_id_punkt_id_key;
alter table etikett rename constraint etikett_tuer_fk to etikett_anlage_fk;
alter table etikett rename constraint etikett_tuer_id_key to etikett_anlage_id_key;
alter table mangel rename constraint mangel_tuer_id_fkey to mangel_anlage_id_fkey;
alter table protokoll rename constraint protokoll_tuerpruefung_id_fkey to protokoll_anlagenpruefung_id_fkey;
alter table anlage rename constraint tuer_erstellt_von_fkey to anlage_erstellt_von_fkey;
alter table anlage rename constraint tuer_etikett_id_fkey to anlage_etikett_id_fkey;
alter table anlage rename constraint tuer_etikett_id_key to anlage_etikett_id_key;
alter table anlage rename constraint tuer_intervall_monate_check to anlage_intervall_monate_check;
alter table anlage rename constraint tuer_objekt_id_fkey to anlage_objekt_id_fkey;
alter table anlage rename constraint tuer_pkey to anlage_pkey;
alter table anlage rename constraint tuer_tuertyp_id_fkey to anlage_anlagentyp_id_fkey;
alter table anlagenpruefung rename constraint tuerpruefung_altmaengel_objekt to anlagenpruefung_altmaengel_objekt;
alter table anlagenpruefung rename constraint tuerpruefung_checkliste_noetig to anlagenpruefung_checkliste_noetig;
alter table anlagenpruefung rename constraint tuerpruefung_checkliste_version_id_fkey to anlagenpruefung_checkliste_version_id_fkey;
alter table anlagenpruefung rename constraint tuerpruefung_duplikat_von_fkey to anlagenpruefung_duplikat_von_fkey;
alter table anlagenpruefung rename constraint tuerpruefung_grund_noetig to anlagenpruefung_grund_noetig;
alter table anlagenpruefung rename constraint tuerpruefung_pkey to anlagenpruefung_pkey;
alter table anlagenpruefung rename constraint tuerpruefung_pruefer_id_fkey to anlagenpruefung_pruefer_id_fkey;
alter table anlagenpruefung rename constraint tuerpruefung_session_id_fkey to anlagenpruefung_session_id_fkey;
alter table anlagenpruefung rename constraint tuerpruefung_tuer_id_fkey to anlagenpruefung_anlage_id_fkey;
alter table anlagenpruefung rename constraint tuerpruefung_urspruenglicher_pruefer_id_fkey to anlagenpruefung_urspruenglicher_pruefer_id_fkey;
alter table anlagenpruefung_freigabe rename constraint tuerpruefung_freigabe_freigegeben_von_fkey to anlagenpruefung_freigabe_freigegeben_von_fkey;
alter table anlagenpruefung_freigabe rename constraint tuerpruefung_freigabe_pkey to anlagenpruefung_freigabe_pkey;
alter table anlagenpruefung_freigabe rename constraint tuerpruefung_freigabe_pruefer_id_fkey to anlagenpruefung_freigabe_pruefer_id_fkey;
alter table anlagenpruefung_freigabe rename constraint tuerpruefung_freigabe_session_id_fkey to anlagenpruefung_freigabe_session_id_fkey;
alter table anlagenpruefung_freigabe rename constraint tuerpruefung_freigabe_tuer_id_fkey to anlagenpruefung_freigabe_anlage_id_fkey;
alter table anlagentyp rename constraint tuertyp_checkliste_id_fkey to anlagentyp_checkliste_id_fkey;
alter table anlagentyp rename constraint tuertyp_erstellt_von_fkey to anlagentyp_erstellt_von_fkey;
alter table anlagentyp rename constraint tuertyp_intervall_monate_check to anlagentyp_intervall_monate_check;
alter table anlagentyp rename constraint tuertyp_pkey to anlagentyp_pkey;
alter index mangel_tuer_id_idx rename to mangel_anlage_id_idx;
alter index tuer_naechste_pruefung_am_idx rename to anlage_naechste_pruefung_am_idx;
alter index tuer_objekt_id_idx rename to anlage_objekt_id_idx;
alter index tuerpruefung_einmal_je_session rename to anlagenpruefung_einmal_je_session;
alter index tuerpruefung_freigabe_session_id_idx rename to anlagenpruefung_freigabe_session_id_idx;
alter trigger tuer_audit on anlage rename to anlage_audit;
alter trigger tuer_etikett_sync on anlage rename to anlage_etikett_sync;
alter trigger tuer_geaendert_am on anlage rename to anlage_geaendert_am;
alter trigger tuer_naechste_pruefung on anlage rename to anlage_naechste_pruefung;
alter trigger tuer_vor_loeschen on anlage rename to anlage_vor_loeschen;
alter trigger tuerpruefung_audit on anlagenpruefung rename to anlagenpruefung_audit;
alter trigger tuerpruefung_geaendert_am on anlagenpruefung rename to anlagenpruefung_geaendert_am;
alter trigger tuerpruefung_nach_aendern on anlagenpruefung rename to anlagenpruefung_nach_aendern;
alter trigger tuerpruefung_nicht_freigegeben on anlagenpruefung rename to anlagenpruefung_nicht_freigegeben;
alter trigger tuerpruefung_sperre on anlagenpruefung rename to anlagenpruefung_sperre;
alter trigger tuerpruefung_vor_aendern on anlagenpruefung rename to anlagenpruefung_vor_aendern;
alter trigger tuerpruefung_vor_einfuegen on anlagenpruefung rename to anlagenpruefung_vor_einfuegen;
alter trigger tuerpruefung_wieder_geoeffnet on anlagenpruefung rename to anlagenpruefung_wieder_geoeffnet;
alter trigger tuertyp_audit on anlagentyp rename to anlagentyp_audit;
alter trigger tuertyp_geaendert_am on anlagentyp rename to anlagentyp_geaendert_am;
alter trigger tuertyp_intervall_geaendert on anlagentyp rename to anlagentyp_intervall_geaendert;
alter policy tuer_admin on anlage rename to anlage_admin;
alter policy tuer_lesen on anlage rename to anlage_lesen;
alter policy tuer_pruefer_aendern on anlage rename to anlage_pruefer_aendern;
alter policy tuer_pruefer_anlegen on anlage rename to anlage_pruefer_anlegen;
alter policy tuerpruefung_admin on anlagenpruefung rename to anlagenpruefung_admin;
alter policy tuerpruefung_aendern on anlagenpruefung rename to anlagenpruefung_aendern;
alter policy tuerpruefung_anlegen on anlagenpruefung rename to anlagenpruefung_anlegen;
alter policy tuerpruefung_lesen on anlagenpruefung rename to anlagenpruefung_lesen;
alter policy tuerpruefung_freigabe_lesen on anlagenpruefung_freigabe rename to anlagenpruefung_freigabe_lesen;
alter policy tuertyp_admin on anlagentyp rename to anlagentyp_admin;
alter policy tuertyp_lesen on anlagentyp rename to anlagentyp_lesen;

-- 4. Funktionen: Rümpfe neu, umbenannte Namen/Parameter durch Neuanlage
CREATE OR REPLACE FUNCTION public.admin_wiederherstellen(p_tabelle text, p_zeilen jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  erlaubt constant text[] := array['benutzer', 'firma', 'erscheinungsbild', 'endkunde', 'objekt', 'checkliste', 'checkliste_version', 'anlagentyp',
    'etikett', 'anlage', 'session', 'session_revision', 'session_teilnehmer', 'anlagenpruefung', 'antwort', 'mangel', 'foto',
    'protokoll', 'protokoll_zaehler'];
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

CREATE OR REPLACE FUNCTION public.duplikat_aufloesen(p_gueltig uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tp anlagenpruefung;
begin
  select * into tp from anlagenpruefung where id = p_gueltig;
  if tp.id is null then raise exception 'Prüfung nicht gefunden'; end if;
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
end $function$;

drop function ist_eigene_offene_pruefung(p_tuerpruefung_id uuid);
CREATE FUNCTION public.ist_eigene_offene_pruefung(p_anlagenpruefung_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from anlagenpruefung tp join session s on s.id = tp.session_id
    where tp.id = p_anlagenpruefung_id and tp.pruefer_id = auth.uid() and s.status = 'offen'
  ) and ist_aktiv();
$function$;

CREATE OR REPLACE FUNCTION public.mangel_schutz()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if ist_admin() or auth.uid() is null then
    return new;
  end if;
  if (new.beschreibung, new.stufe, new.punkt_id, new.anlage_id, new.entdeckt_in)
     is distinct from (old.beschreibung, old.stufe, old.punkt_id, old.anlage_id, old.entdeckt_in)
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
end $function$;

drop function pruefung_session(p_tuerpruefung_id uuid);
CREATE FUNCTION public.pruefung_session(p_anlagenpruefung_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select session_id from anlagenpruefung where id = p_anlagenpruefung_id;
$function$;

drop function pruefung_uebernehmen(p_tuerpruefung_id uuid);
CREATE FUNCTION public.pruefung_uebernehmen(p_anlagenpruefung_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tp anlagenpruefung;
  s session;
begin
  select * into tp from anlagenpruefung where id = p_anlagenpruefung_id for update;
  if tp.id is null then raise exception 'Prüfung nicht gefunden'; end if;
  select * into s from session where id = tp.session_id;
  if s.status <> 'offen' or s.revision = 0 then raise exception 'Türen anderer Prüfer können nur in einer Revision übernommen werden'; end if;
  if not ist_leiter(s.id) then raise exception 'Nur die Sessionleitung kann Türen übernehmen'; end if;
  if tp.pruefer_id = auth.uid() then return; end if;
  if tp.status <> 'geprueft' then raise exception 'Nur abgeschlossene Türprüfungen können übernommen werden'; end if;
  perform set_config('anlagenpruefung.uebernehmen', 'ja', true);
  update anlagenpruefung
     set urspruenglicher_pruefer_id = coalesce(urspruenglicher_pruefer_id, pruefer_id), pruefer_id = auth.uid(),
         uebernommen_am = now(), status = 'in_pruefung', beendet_am = null, letzte_aktivitaet = now()
   where id = tp.id;
  perform set_config('anlagenpruefung.uebernehmen', '', true);
end $function$;

drop function reservierung_aufheben(p_tuerpruefung_id uuid);
CREATE FUNCTION public.reservierung_aufheben(p_anlagenpruefung_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tp anlagenpruefung;
begin
  select * into tp from anlagenpruefung where id = p_anlagenpruefung_id;
  if tp.id is null then return; end if;
  if not (tp.pruefer_id = auth.uid() or ist_leiter(tp.session_id) or ist_admin()) then
    raise exception 'Nur der Prüfer selbst oder der Sessionleiter kann die Reservierung aufheben';
  end if;
  if tp.status <> 'in_pruefung' then raise exception 'Nur laufende Prüfungen können freigegeben werden'; end if;
  if tp.pruefer_id <> auth.uid() then
    insert into anlagenpruefung_freigabe (id, session_id, anlage_id, pruefer_id)
      values (tp.id, tp.session_id, tp.anlage_id, tp.pruefer_id) on conflict (id) do nothing;
  end if;
  delete from foto where bezug_typ = 'mangel' and bezug_id in (select id from mangel where entdeckt_in = tp.id);
  delete from foto where bezug_typ = 'antwort' and bezug_id in (select id from antwort where anlagenpruefung_id = tp.id);
  delete from mangel where entdeckt_in = tp.id;
  delete from antwort where anlagenpruefung_id = tp.id;
  delete from anlagenpruefung where id = tp.id;
end $function$;

CREATE OR REPLACE FUNCTION public.session_abschliessen(p_session_id uuid, p_bemerkung text, p_unterschrift_leiter text, p_unterschrift_kunde text, p_kunde_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  if exists (select 1 from anlagenpruefung where session_id = s.id and status = 'in_pruefung') then
    raise exception 'Es sind noch Türen in Prüfung';
  end if;
  if exists (select 1 from anlagenpruefung where session_id = s.id and status = 'duplikat' and not duplikat_geklaert) then
    raise exception 'Es gibt ungeklärte Doppelprüfungen';
  end if;
  select string_agg(coalesce(t.etikett_id, t.kunden_bezeichnung, 'ohne Bezeichnung'), ', ') into offen
    from anlage t
   where t.objekt_id = s.objekt_id and t.status = 'aktiv'
     and not exists (select 1 from anlagenpruefung tp where tp.session_id = s.id and tp.anlage_id = t.id and tp.status <> 'duplikat');
  if offen is not null then raise exception 'Türen ohne Ergebnis: %', offen; end if;
  if exists (
    select 1 from session_teilnehmer st
     where st.session_id = s.id and st.benutzer_id <> s.leiter_id and st.fertig_am is null
       and exists (select 1 from anlagenpruefung tp where tp.session_id = s.id and tp.pruefer_id = st.benutzer_id)
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
end $function$;

CREATE OR REPLACE FUNCTION public.session_sperre()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  sid uuid;
begin
  if tg_table_name = 'anlagenpruefung' then
    sid := coalesce(new.session_id, old.session_id);
  else
    sid := pruefung_session(coalesce(new.anlagenpruefung_id, old.anlagenpruefung_id));
  end if;
  if not session_offen(sid) and coalesce(current_setting('session.revision', true), '') <> 'ja' then
    raise exception 'Die Prüfung ist abgeschlossen und kann nicht mehr geändert werden';
  end if;
  return coalesce(new, old);
end $function$;

CREATE OR REPLACE FUNCTION public.session_verwerfen(p_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s session;
  pruefungen uuid[];
begin
  select * into s from session where id = p_session_id for update;
  if s.id is null then return; end if;  -- schon weg (z. B. erneuter Aufruf)
  if not (ist_leiter(s.id) or ist_admin()) then raise exception 'Nur die Sessionleitung, ein Planer oder Admin kann die Prüfung verwerfen'; end if;
  if s.status <> 'offen' then raise exception 'Abgeschlossene Prüfungen können nicht verworfen werden'; end if;
  if s.revision > 0 then raise exception 'Eine Revision kann nicht verworfen werden – bitte regulär abschließen'; end if;
  if exists (select 1 from anlagenpruefung where session_id = s.id and status in ('geprueft', 'nicht_geprueft')) then
    raise exception 'Es gibt bereits abgeschlossene Türen – bitte die Prüfung regulär abschließen';
  end if;

  select coalesce(array_agg(id), '{}') into pruefungen from anlagenpruefung where session_id = s.id;

  -- In dieser Prüfung als behoben bestätigte frühere Mängel wieder öffnen
  update mangel set status = case when behoben_am is not null then 'behoben'::mangel_status else 'offen'::mangel_status end, nachgeprueft_in = null
   where nachgeprueft_in = any (pruefungen);
  -- In dieser Prüfung festgestellte Mängel und alle Fotos dazu
  delete from foto where bezug_typ = 'mangel' and bezug_id in (select id from mangel where entdeckt_in = any (pruefungen));
  delete from foto where bezug_typ = 'antwort' and bezug_id in (select id from antwort where anlagenpruefung_id = any (pruefungen));
  delete from mangel where entdeckt_in = any (pruefungen);
  delete from antwort where anlagenpruefung_id = any (pruefungen);
  update anlagenpruefung set duplikat_von = null where session_id = s.id;
  delete from anlagenpruefung where session_id = s.id;
  delete from session_teilnehmer where session_id = s.id;
  delete from session where id = s.id;  -- anlagenpruefung_freigabe per Kaskade
end $function$;

alter function tuer_etikett_sync() rename to anlage_etikett_sync;
CREATE OR REPLACE FUNCTION public.anlage_etikett_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'UPDATE' and old.etikett_id is not distinct from new.etikett_id then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.etikett_id is not null then
    update etikett set anlage_id = null, zugeordnet_am = null where id = old.etikett_id;
  end if;
  if new.etikett_id is not null then
    update etikett set anlage_id = new.id, zugeordnet_am = now() where id = new.etikett_id;
  end if;
  return new;
end $function$;

alter function tuer_naechste_pruefung() rename to anlage_naechste_pruefung;
CREATE OR REPLACE FUNCTION public.anlage_naechste_pruefung()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  monate int;
begin
  if new.letzte_pruefung_am > current_date then
    raise exception 'Das Datum der letzten Prüfung darf nicht in der Zukunft liegen';
  end if;
  if new.letzte_pruefung_am is null then
    new.naechste_pruefung_am := null;
    return new;
  end if;
  monate := coalesce(new.intervall_monate, (select intervall_monate from anlagentyp where id = new.anlagentyp_id));
  new.naechste_pruefung_am := (new.letzte_pruefung_am + make_interval(months => monate))::date;
  return new;
end $function$;

drop function tuer_nicht_geprueft(p_id uuid, p_session_id uuid, p_tuer_id uuid, p_grund text);
CREATE FUNCTION public.anlage_nicht_geprueft(p_id uuid, p_session_id uuid, p_anlage_id uuid, p_grund text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (ist_leiter(p_session_id) or ist_admin()) then raise exception 'Nur der Sessionleiter'; end if;
  if nullif(trim(p_grund), '') is null then raise exception 'Bitte einen Grund angeben'; end if;
  if exists (select 1 from anlagenpruefung where session_id = p_session_id and anlage_id = p_anlage_id and status <> 'duplikat' and id <> p_id) then
    raise exception 'Für diese Tür gibt es bereits eine Prüfung';
  end if;
  insert into anlagenpruefung (id, session_id, anlage_id, pruefer_id, erfassung, status, nicht_geprueft_grund, beendet_am)
    values (p_id, p_session_id, p_anlage_id, auth.uid(), 'manuell', 'nicht_geprueft', trim(p_grund), now())
    on conflict (id) do update set nicht_geprueft_grund = excluded.nicht_geprueft_grund;
end $function$;

drop function tuer_reservieren(p_id uuid, p_session_id uuid, p_tuer_id uuid, p_checkliste_version_id uuid, p_erfassung erfassung);
CREATE FUNCTION public.anlage_reservieren(p_id uuid, p_session_id uuid, p_anlage_id uuid, p_checkliste_version_id uuid, p_erfassung erfassung)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  vorhanden anlagenpruefung;
  name text;
begin
  if not ist_teilnehmer(p_session_id) then raise exception 'Sie nehmen an dieser Prüfung nicht teil'; end if;
  if not session_offen(p_session_id) then raise exception 'Die Prüfung ist bereits abgeschlossen'; end if;
  if exists (select 1 from anlagenpruefung where id = p_id) then
    return jsonb_build_object('ok', true, 'id', p_id);
  end if;
  select * into vorhanden from anlagenpruefung
   where session_id = p_session_id and anlage_id = p_anlage_id and status <> 'duplikat'
   for update;
  if vorhanden.id is not null then
    if vorhanden.pruefer_id = auth.uid() then
      return jsonb_build_object('ok', true, 'id', vorhanden.id, 'fortsetzen', true);
    end if;
    select b.name into name from benutzer b where b.id = vorhanden.pruefer_id;
    return jsonb_build_object('ok', false, 'pruefer', name, 'status', vorhanden.status);
  end if;
  insert into anlagenpruefung (id, session_id, anlage_id, pruefer_id, checkliste_version_id, erfassung)
    values (p_id, p_session_id, p_anlage_id, auth.uid(), p_checkliste_version_id, p_erfassung);
  return jsonb_build_object('ok', true, 'id', p_id);
end $function$;

drop function tuer_suche(p_text text, p_limit integer);
CREATE FUNCTION public.anlage_suche(p_text text, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, etikett_id text, kunden_bezeichnung text, gebaeude text, etage text, raum text, lage_beschreibung text, status anlage_status, naechste_pruefung_am date, anlagentyp text, objekt_id uuid, objekt text, objekt_ort text, kunde text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with woerter as (
    select w from unnest(regexp_split_to_array(lower(trim(p_text)), '\s+')) w where w <> ''
  ),
  kandidaten as (
    select t.*, ty.name as typ_name, o.name as o_name, o.ort as o_ort, k.name as k_name,
           lower(concat_ws(' ',
             t.etikett_id, t.kunden_bezeichnung, t.gebaeude, t.etage, t.raum, t.lage_beschreibung,
             t.hersteller, t.modell, t.antrieb_system, ty.name,
             o.name, o.strasse, o.plz, o.ort,
             k.name, k.strasse, k.plz, k.ort, k.ansprechpartner)) as suchtext
    from anlage t
    join anlagentyp ty on ty.id = t.anlagentyp_id
    join objekt o on o.id = t.objekt_id
    join endkunde k on k.id = o.endkunde_id
  )
  select c.id, c.etikett_id, c.kunden_bezeichnung, c.gebaeude, c.etage, c.raum, c.lage_beschreibung,
         c.status, c.naechste_pruefung_am, c.typ_name, c.objekt_id, c.o_name, c.o_ort, c.k_name
  from kandidaten c
  where exists (select 1 from woerter)
    and not exists (select 1 from woerter where position(w in c.suchtext) = 0)
  order by (lower(c.etikett_id) = lower(trim(p_text))) desc nulls last,
           (c.status = 'aktiv') desc, c.k_name, c.o_name, c.gebaeude, c.etage, c.kunden_bezeichnung
  limit least(greatest(p_limit, 1), 200);
$function$;

alter function tuer_vor_loeschen() rename to anlage_vor_loeschen;
CREATE OR REPLACE FUNCTION public.anlage_vor_loeschen()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if exists (select 1 from anlagenpruefung where anlage_id = old.id) or exists (select 1 from mangel where anlage_id = old.id) then
    raise exception 'Die Tür hat bereits Prüfungen und kann nicht gelöscht werden. Bitte stattdessen stilllegen.';
  end if;
  update etikett set anlage_id = null, zugeordnet_am = null where anlage_id = old.id;
  delete from foto where bezug_typ = 'anlage' and bezug_id = old.id;
  return old;
end $function$;

alter function tuerpruefung_nach_aendern() rename to anlagenpruefung_nach_aendern;
CREATE OR REPLACE FUNCTION public.anlagenpruefung_nach_aendern()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tag date;
begin
  if new.status = 'geprueft' and new.ergebnis is not null then
    tag := coalesce(new.beendet_am, new.begonnen_am)::date;
    update anlage set letzte_pruefung_am = tag, letztes_ergebnis = new.ergebnis
     where id = new.anlage_id and (letzte_pruefung_am is null or letzte_pruefung_am <= tag);
  end if;
  return new;
end $function$;

alter function tuerpruefung_nicht_freigegeben() rename to anlagenpruefung_nicht_freigegeben;
CREATE OR REPLACE FUNCTION public.anlagenpruefung_nicht_freigegeben()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if exists (select 1 from anlagenpruefung_freigabe where id = new.id) then
    raise exception 'Diese Türprüfung wurde von der Sessionleitung freigegeben und kann nicht mehr übertragen werden';
  end if;
  return new;
end $function$;

alter function tuerpruefung_vor_aendern() rename to anlagenpruefung_vor_aendern;
CREATE OR REPLACE FUNCTION public.anlagenpruefung_vor_aendern()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.session_id <> old.session_id or new.anlage_id <> old.anlage_id
     or (new.pruefer_id <> old.pruefer_id and coalesce(current_setting('anlagenpruefung.uebernehmen', true), '') <> 'ja') then
    raise exception 'Session, Tür und Prüfer einer Türprüfung sind unveränderlich';
  end if;
  -- Ein Duplikat bleibt Duplikat, bis der Sessionleiter es klärt (Sync des Geräts darf das nicht überschreiben)
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
  return new;
end $function$;

alter function tuerpruefung_vor_einfuegen() rename to anlagenpruefung_vor_einfuegen;
CREATE OR REPLACE FUNCTION public.anlagenpruefung_vor_einfuegen()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  vorhanden uuid;
begin
  if new.status <> 'duplikat' then
    select id into vorhanden from anlagenpruefung
     where session_id = new.session_id and anlage_id = new.anlage_id and status <> 'duplikat' and id <> new.id
     limit 1;
    if vorhanden is not null then
      new.status := 'duplikat';
      new.duplikat_von := vorhanden;
      new.duplikat_geklaert := false;
    end if;
  end if;
  return new;
end $function$;

alter function tuerpruefung_wieder_geoeffnet() rename to anlagenpruefung_wieder_geoeffnet;
CREATE OR REPLACE FUNCTION public.anlagenpruefung_wieder_geoeffnet()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if old.status = 'geprueft' and new.status = 'in_pruefung' then
    update session_teilnehmer set fertig_am = null
     where session_id = new.session_id and benutzer_id = new.pruefer_id and fertig_am is not null;
  end if;
  return null;
end $function$;

alter function tuertyp_intervall_geaendert() rename to anlagentyp_intervall_geaendert;
CREATE OR REPLACE FUNCTION public.anlagentyp_intervall_geaendert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update anlage set letzte_pruefung_am = letzte_pruefung_am
   where anlagentyp_id = new.id and intervall_monate is null and letzte_pruefung_am is not null;
  return new;
end $function$;

-- Rechte der neu angelegten Funktionen wie vorher
revoke all on function ist_eigene_offene_pruefung(p_anlagenpruefung_id uuid) from public, anon, authenticated;
grant execute on function ist_eigene_offene_pruefung(p_anlagenpruefung_id uuid) to anon;
grant execute on function ist_eigene_offene_pruefung(p_anlagenpruefung_id uuid) to authenticated;
grant execute on function ist_eigene_offene_pruefung(p_anlagenpruefung_id uuid) to service_role;
grant execute on function ist_eigene_offene_pruefung(p_anlagenpruefung_id uuid) to public;
revoke all on function pruefung_session(p_anlagenpruefung_id uuid) from public, anon, authenticated;
grant execute on function pruefung_session(p_anlagenpruefung_id uuid) to anon;
grant execute on function pruefung_session(p_anlagenpruefung_id uuid) to authenticated;
grant execute on function pruefung_session(p_anlagenpruefung_id uuid) to service_role;
grant execute on function pruefung_session(p_anlagenpruefung_id uuid) to public;
revoke all on function pruefung_uebernehmen(p_anlagenpruefung_id uuid) from public, anon, authenticated;
grant execute on function pruefung_uebernehmen(p_anlagenpruefung_id uuid) to authenticated;
grant execute on function pruefung_uebernehmen(p_anlagenpruefung_id uuid) to service_role;
revoke all on function reservierung_aufheben(p_anlagenpruefung_id uuid) from public, anon, authenticated;
grant execute on function reservierung_aufheben(p_anlagenpruefung_id uuid) to authenticated;
grant execute on function reservierung_aufheben(p_anlagenpruefung_id uuid) to service_role;
revoke all on function anlage_nicht_geprueft(p_id uuid, p_session_id uuid, p_anlage_id uuid, p_grund text) from public, anon, authenticated;
grant execute on function anlage_nicht_geprueft(p_id uuid, p_session_id uuid, p_anlage_id uuid, p_grund text) to authenticated;
grant execute on function anlage_nicht_geprueft(p_id uuid, p_session_id uuid, p_anlage_id uuid, p_grund text) to service_role;
revoke all on function anlage_reservieren(p_id uuid, p_session_id uuid, p_anlage_id uuid, p_checkliste_version_id uuid, p_erfassung erfassung) from public, anon, authenticated;
grant execute on function anlage_reservieren(p_id uuid, p_session_id uuid, p_anlage_id uuid, p_checkliste_version_id uuid, p_erfassung erfassung) to authenticated;
grant execute on function anlage_reservieren(p_id uuid, p_session_id uuid, p_anlage_id uuid, p_checkliste_version_id uuid, p_erfassung erfassung) to service_role;
revoke all on function anlage_suche(p_text text, p_limit integer) from public, anon, authenticated;
grant execute on function anlage_suche(p_text text, p_limit integer) to authenticated;
grant execute on function anlage_suche(p_text text, p_limit integer) to service_role;

-- 5. Richtlinien wieder anlegen
create policy antwort_schreiben on antwort for all to authenticated
  using (ist_eigene_offene_pruefung(anlagenpruefung_id))
  with check (ist_eigene_offene_pruefung(anlagenpruefung_id));
create policy mangel_anlegen on mangel for insert to authenticated
  with check (ist_eigene_offene_pruefung(entdeckt_in));
create policy mangel_loeschen on mangel for delete to authenticated
  using ((ist_eigene_offene_pruefung(entdeckt_in) AND (status = 'offen'::mangel_status)));
create policy foto_loeschen_eigene_pruefung on foto for delete to authenticated
  using ((ist_aktiv() AND (((bezug_typ = 'antwort'::foto_bezug) AND (EXISTS ( SELECT 1
   FROM antwort a
  WHERE ((a.id = foto.bezug_id) AND ist_eigene_offene_pruefung(a.anlagenpruefung_id))))) OR ((bezug_typ = 'mangel'::foto_bezug) AND (EXISTS ( SELECT 1
   FROM mangel m
  WHERE ((m.id = foto.bezug_id) AND ist_eigene_offene_pruefung(m.entdeckt_in))))))));

-- PostgREST: Schema neu laden
notify pgrst, 'reload schema';
