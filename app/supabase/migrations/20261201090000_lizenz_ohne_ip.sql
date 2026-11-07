-- Version 2.91.0: Nachweis der Lizenzbedingungen ohne IP-Adresse und Browserkennung (Datenminimierung).
-- Für den Nachweis genügen Benutzer, Zeitpunkt und Version; die angemeldete Sitzung belegt, wer zugestimmt hat.
-- Die IP war hinter dem Proxy ohnehin oft nur eine Docker-Adresse. Vorhandene Werte werden mit den Spalten gelöscht.

-- Erst die Funktion ersetzen, sie schreibt sonst in die Spalten, die gleich wegfallen
create or replace function lizenz_akzeptieren(p_version text, p_stand text default null, p_zeitpunkt timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  b benutzer;
begin
  select * into b from benutzer where id = auth.uid() and aktiv;
  if b.id is null then raise exception 'Nicht angemeldet'; end if;
  if coalesce(trim(p_version), '') = '' then raise exception 'Version fehlt'; end if;
  insert into lizenz_akzeptanz (benutzer_id, benutzer_name, version, lizenz_stand, akzeptiert_am)
  values (b.id, b.name, p_version, p_stand,
          -- Zeitpunkt des Klicks, falls offline nachgemeldet; nie in der Zukunft
          least(coalesce(p_zeitpunkt, now()), now()))
  on conflict (benutzer_id, version) do nothing;
end $$;

alter table lizenz_akzeptanz drop column ip, drop column user_agent;
comment on table lizenz_akzeptanz is 'Nachweis: wer hat welche App-Version unter den Lizenzbedingungen wann akzeptiert';
