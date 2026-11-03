-- Sicherheit: Prüfdaten gegen Änderungen durch andere Teilnehmer schützen (Sicherheitsreview 2026-10-28, Befunde 1, 2, 3, 7).
--   1. Fertigmeldung und Unterschrift eines Teilnehmers setzt nur er selbst (bisher durfte die Sessionleitung jede Spalte
--      jeder Teilnehmerzeile ändern und so Kollegen als fertig und unterschrieben ausweisen).
--   2. Fotos nur zu eigenen offenen Prüfungen anlegen und löschen; an abgeschlossenen Prüfungen sind Fotos gesperrt
--      wie Antworten (bisher ließ sich jedes Foto an jeden Mangel hängen und jedes eigene Foto jederzeit löschen).
--   3. Eine Anlagenprüfung gehört zu einer Anlage des Objekts der Prüfung (bisher ließen sich Ergebnisse für Anlagen
--      fremder Objekte eintragen, die deren Fälligkeit verändert haben); die Prüfart bleibt nach dem Anlegen fest.
--   7. Den Übernahme-Vermerk („ursprünglich geprüft von …“) setzt nur pruefung_uebernehmen, auch beim Anlegen.
-- Wiederherstellung (session.revision = 'ja') und Admins/Planer sind ausgenommen, wie bei den übrigen Sperren.

-- ---------------------------------------------------------------------------
-- 1. Teilnehmerzeile
-- ---------------------------------------------------------------------------
create function session_teilnehmer_schutz() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or ist_admin() or coalesce(current_setting('session.revision', true), '') = 'ja' then
    return new;
  end if;
  if new.session_id <> old.session_id or new.benutzer_id <> old.benutzer_id then
    raise exception 'Prüfung und Teilnehmer sind unveränderlich';
  end if;
  -- Andere dürfen eine Fertigmeldung nur zurücknehmen (z. B. wenn eine Anlage wieder geöffnet wird), nie setzen
  if new.benutzer_id <> auth.uid() and (
       (new.fertig_am is distinct from old.fertig_am and new.fertig_am is not null)
    or (new.unterschrift is distinct from old.unterschrift and new.unterschrift is not null)) then
    raise exception 'Fertigmeldung und Unterschrift kann nur der Teilnehmer selbst setzen';
  end if;
  return new;
end $$;

create trigger session_teilnehmer_schutz before update on session_teilnehmer
  for each row execute function session_teilnehmer_schutz();

-- ---------------------------------------------------------------------------
-- 2. Fotos
-- ---------------------------------------------------------------------------
-- Darf der Benutzer zu diesem Bezug Fotos anlegen/löschen? Antwort und Mangel: eigene offene Prüfung (inkl. zugelassener
-- Mitprüfer); Anlage: vor Ort in einer offenen Prüfung des Objekts.
create function foto_bezug_beschreibbar(p_typ foto_bezug, p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_typ
    when 'antwort' then exists (select 1 from antwort a where a.id = p_id and ist_eigene_offene_pruefung(a.anlagenpruefung_id))
    when 'mangel' then exists (select 1 from mangel m where m.id = p_id and ist_eigene_offene_pruefung(m.entdeckt_in))
    when 'anlage' then exists (select 1 from anlage a where a.id = p_id and darf_vor_ort(a.objekt_id))
    else false
  end;
$$;
revoke all on function foto_bezug_beschreibbar(foto_bezug, uuid) from public, anon;
grant execute on function foto_bezug_beschreibbar(foto_bezug, uuid) to authenticated;

drop policy foto_anlegen on foto;
create policy foto_anlegen on foto for insert to authenticated
  with check (ist_aktiv() and erstellt_von = auth.uid() and foto_bezug_beschreibbar(bezug_typ, bezug_id));
-- Löschen: foto_loeschen_eigene_pruefung (Antwort/Mangel der eigenen offenen Prüfung) bleibt; eigene Anlagenfotos nur vor Ort
drop policy foto_loeschen on foto;
create policy foto_loeschen on foto for delete to authenticated
  using (ist_aktiv() and erstellt_von = auth.uid() and bezug_typ = 'anlage' and foto_bezug_beschreibbar(bezug_typ, bezug_id));

-- Sperre wie bei Antworten: Fotos einer abgeschlossenen Prüfung ändert niemand (auch kein Admin), außer per Revision
create function foto_sperre() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r foto;
  sid uuid;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  if coalesce(current_setting('session.revision', true), '') = 'ja' then
    return r;
  end if;
  if r.bezug_typ = 'antwort' then
    select pruefung_session(a.anlagenpruefung_id) into sid from antwort a where a.id = r.bezug_id;
  elsif r.bezug_typ = 'mangel' then
    select pruefung_session(m.entdeckt_in) into sid from mangel m where m.id = r.bezug_id;
  end if;
  if sid is not null and not session_offen(sid) then
    raise exception 'Die Prüfung ist abgeschlossen und kann nicht mehr geändert werden';
  end if;
  if tg_op = 'UPDATE' and (new.bezug_typ <> old.bezug_typ or new.bezug_id <> old.bezug_id) then
    select pruefung_session(a.anlagenpruefung_id) into sid from antwort a where a.id = old.bezug_id and old.bezug_typ = 'antwort';
    if sid is null then
      select pruefung_session(m.entdeckt_in) into sid from mangel m where m.id = old.bezug_id and old.bezug_typ = 'mangel';
    end if;
    if sid is not null and not session_offen(sid) then
      raise exception 'Die Prüfung ist abgeschlossen und kann nicht mehr geändert werden';
    end if;
  end if;
  return r;
end $$;

create trigger foto_sperre before insert or update or delete on foto
  for each row execute function foto_sperre();

-- ---------------------------------------------------------------------------
-- 3. + 7. Anlagenprüfung: Anlage des Objekts, Übernahme-Vermerk, feste Prüfart
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.anlagenpruefung_vor_einfuegen()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  vorhanden uuid;
  art text;
  art_name text;
  pflicht boolean;
  wiederherstellung boolean := coalesce(current_setting('session.revision', true), '') = 'ja';
begin
  if not wiederherstellung and not exists (
      select 1 from anlage a join session s on s.objekt_id = a.objekt_id where a.id = new.anlage_id and s.id = new.session_id) then
    raise exception 'Die Anlage gehört nicht zum Objekt dieser Prüfung';
  end if;
  -- Übernahme-Vermerk entsteht nur in pruefung_uebernehmen (bzw. kommt aus einer Wiederherstellung)
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
  -- Sachkunde: nur wenn für die Art eingeschaltet; „nicht geprüft“ vermerkt die Sessionleitung ohne Prüfung
  if new.status <> 'nicht_geprueft' and not wiederherstellung then
    select ty.anlagenart, ar.name, ar.sachkunde_pflicht into art, art_name, pflicht
      from anlage a join anlagentyp ty on ty.id = a.anlagentyp_id join anlagenart ar on ar.schluessel = ty.anlagenart
     where a.id = new.anlage_id;
    if pflicht and not hat_sachkunde(new.pruefer_id, art) then
      raise exception 'Für % ist bei Ihnen keine gültige Sachkunde hinterlegt. Admin: unter „Benutzer“ eintragen.', art_name;
    end if;
  end if;
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
  -- Prüfart wird beim Anlegen geprüft und bleibt dann (still, damit ein veralteter Sync nicht scheitert)
  if not ist_admin() and coalesce(current_setting('session.revision', true), '') <> 'ja' then
    new.pruefart_id := old.pruefart_id;
  end if;
  return new;
end $function$;

-- PostgREST: Schema neu laden
notify pgrst, 'reload schema';
