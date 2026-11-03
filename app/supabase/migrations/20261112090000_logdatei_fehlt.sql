-- Version 2.57.1: Logzeilen auch bei leerer log_datei schreiben.
-- Wurde log_datei geleert (z. B. truncate beim Zurücksetzen einer Instanz), war max(nr) null und jede Datenbankänderung
-- scheiterte mit „null value in column datei of relation log_zeile“. log_schreiben beginnt dann selbst eine neue Datei,
-- mit einer Nummer hinter noch vorhandenen Zeilen, damit sich alte und neue Zeilen nicht mischen.

create or replace function log_schreiben(p_benutzer text, p_aktion text, p_details text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_datei int := (select max(nr) from log_datei);
  v_id bigint;
begin
  if v_datei is null then
    v_datei := coalesce((select max(datei) from log_zeile), 0) + 1;
    -- Gleichzeitige Aufrufer legen dieselbe Nummer an; der zweite schreibt einfach mit
    insert into log_datei (nr) values (v_datei) on conflict do nothing;
  end if;
  insert into log_zeile (datei, zeile)
  values (v_datei,
          to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          || ' | ' || log_kurz(p_benutzer, 200) || ' | ' || log_kurz(p_aktion, 200)
          || case when coalesce(p_details, '') <> '' then ' | ' || log_kurz(p_details, 2000) else '' end)
  returning id into v_id;
  if v_id % 32 = 0 then perform log_rotieren(); end if;
end $$;
