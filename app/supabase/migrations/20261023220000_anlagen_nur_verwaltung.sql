-- Sicherheit: Anlagen, Elemente und Fälligkeiten verwalten nur Admins und Planer (Kunden und Objekte waren es schon).
-- Prüfer dürfen nur noch vor Ort, d. h. als Teilnehmer einer offenen Prüfung des Objekts:
--   - eine neue Anlage erfassen,
--   - einer Anlage ohne Etikett ein Etikett zuweisen,
--   - Hersteller, Modell, Baujahr und Eigenschaften ergänzen,
--   - Elemente (z. B. Melder) ergänzen.
-- Bisher durfte jeder aktive Benutzer jede Anlage ändern und anlegen.

-- Teilnehmer einer offenen Prüfung dieses Objekts
create function darf_vor_ort(p_objekt_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from session s join session_teilnehmer t on t.session_id = s.id
     where s.objekt_id = p_objekt_id and s.status = 'offen' and t.benutzer_id = auth.uid())
     and ist_aktiv();
$$;
revoke all on function darf_vor_ort(uuid) from public, anon;
grant execute on function darf_vor_ort(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Anlagen
-- ---------------------------------------------------------------------------
drop policy anlage_pruefer_anlegen on anlage;
drop policy anlage_pruefer_aendern on anlage;
create policy anlage_vor_ort_anlegen on anlage for insert to authenticated with check (darf_vor_ort(objekt_id));
create policy anlage_vor_ort_aendern on anlage for update to authenticated
  using (darf_vor_ort(objekt_id)) with check (darf_vor_ort(objekt_id));

-- Vor Ort ändert ein Prüfer nur Etikett (wenn noch keins vergeben ist), Hersteller, Modell, Baujahr und Eigenschaften.
-- Andere Felder behalten still ihren Wert (wie anlage_zusammenfassung_schuetzen), damit eine veraltete
-- Offline-Übertragung nicht hängen bleibt, wenn die Verwaltung die Anlage inzwischen geändert hat.
create function anlage_vor_ort_schuetzen() returns trigger
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
  if old.etikett_id is not null then
    new.etikett_id := old.etikett_id;
  end if;
  return new;
end $$;
create trigger anlage_vor_ort_schuetzen before update on anlage
  for each row execute function anlage_vor_ort_schuetzen();

-- ---------------------------------------------------------------------------
-- Elemente
-- ---------------------------------------------------------------------------
drop policy anlage_element_anlegen on anlage_element;
drop policy anlage_element_aendern on anlage_element;
create policy anlage_element_admin on anlage_element for all to authenticated using (ist_admin()) with check (ist_admin());
create policy anlage_element_vor_ort_anlegen on anlage_element for insert to authenticated
  with check (darf_vor_ort((select a.objekt_id from anlage a where a.id = anlage_id)));
create policy anlage_element_vor_ort_aendern on anlage_element for update to authenticated
  using (darf_vor_ort((select a.objekt_id from anlage a where a.id = anlage_id)))
  with check (darf_vor_ort((select a.objekt_id from anlage a where a.id = anlage_id)));

-- ---------------------------------------------------------------------------
-- Fälligkeiten: schreibt nach einer Prüfung die Datenbank selbst (anlagenpruefung_nach_aendern), sonst nur die Verwaltung
-- ---------------------------------------------------------------------------
drop policy anlage_faelligkeit_anlegen on anlage_faelligkeit;
drop policy anlage_faelligkeit_aendern on anlage_faelligkeit;
create policy anlage_faelligkeit_admin on anlage_faelligkeit for all to authenticated using (ist_admin()) with check (ist_admin());
