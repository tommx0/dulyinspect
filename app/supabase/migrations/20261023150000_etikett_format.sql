-- Version 2.12.0: neues Etikettformat <Präfix>-<6 Ziffern Nummer><1 Prüfziffer>, z. B. PK-0000427.
-- Das Präfix legt jede Instanz selbst fest (Standard PK). Die Nummern laufen über alle Präfixe weiter,
-- jede Nummer gibt es also nur einmal. Alte Etiketten FT-00001 (5 Ziffern, ohne Prüfziffer) bleiben gültig.
-- Prüfziffer nach Damm, dieselbe Rechnung wie pruefziffer() in src/lib/etikett.ts.

alter table firma add column etikett_praefix text not null default 'PK'
  constraint firma_etikett_praefix_check check (etikett_praefix ~ '^[A-Z]{2,3}$' and etikett_praefix <> 'FT');

-- Damm-Rechnung über eine Ziffernfolge: Prüfziffer zu einer Nummer, bzw. 0 für Nummer mit gültiger Prüfziffer
create function etikett_damm(p_ziffern text) returns int
language plpgsql immutable as $$
declare
  t constant int[] := array[
    [0,3,1,7,5,9,8,6,4,2], [7,0,9,2,1,5,4,8,6,3], [4,2,0,6,8,7,1,3,5,9], [1,7,5,0,9,8,3,4,2,6], [6,1,2,3,0,4,5,9,7,8],
    [3,6,7,4,2,0,9,5,8,1], [5,8,6,9,7,2,0,1,3,4], [8,9,4,5,3,6,2,0,1,7], [9,4,3,8,6,1,7,2,0,5], [2,5,8,1,4,3,6,7,9,0]];
  z int := 0;
begin
  for i in 1..length(p_ziffern) loop
    z := t[z + 1][substr(p_ziffern, i, 1)::int + 1];
  end loop;
  return z;
end $$;

-- Laufende Nummer eines Etiketts: FT-00815 → 815, PK-0000427 → 42 (ohne Prüfziffer)
create function etikett_nummer(p_id text) returns bigint
language sql immutable as $$
  select case
    when p_id ~ '^FT-[0-9]+$' then substring(p_id from 4)::bigint
    when p_id ~ '^[A-Z]{2,3}-[0-9]{7}$' then left(right(p_id, 7), 6)::bigint
  end;
$$;

alter table etikett drop constraint etikett_id_check;
alter table etikett add constraint etikett_id_check check (
  id ~ '^FT-[0-9]{5,}$' or (id ~ '^[A-Z]{2,3}-[0-9]{7}$' and etikett_damm(right(id, 7)) = 0));

create or replace function etiketten_erzeugen(p_anzahl int, p_charge text default null) returns setof etikett
language plpgsql security definer set search_path = public as $$
declare
  charge text := coalesce(nullif(p_charge, ''), to_char(now(), 'YYYY-MM-DD HH24:MI'));
  praefix text := coalesce((select etikett_praefix from firma where id = 1), 'PK');
  hoechste bigint;
begin
  if not ist_admin() then raise exception 'Nur Admins dürfen Etiketten erzeugen'; end if;
  if p_anzahl not between 1 and 1000 then raise exception 'Anzahl muss zwischen 1 und 1000 liegen'; end if;
  -- Nach einer Wiederherstellung kann die Zahlenfolge hinter den vorhandenen Etiketten liegen → nachziehen
  select max(etikett_nummer(id)) into hoechste from etikett;
  if hoechste > coalesce((select last_value from etikett_nr where is_called), 0) then
    perform setval('etikett_nr', hoechste);
  end if;
  if greatest(coalesce(hoechste, 0), coalesce((select last_value from etikett_nr where is_called), 0)) + p_anzahl > 999999 then
    raise exception 'Der Nummernbereich der Etiketten ist erschöpft';
  end if;
  return query
    insert into etikett (id, charge)
    select praefix || '-' || n || etikett_damm(n), charge
    from (select lpad(nextval('etikett_nr')::text, 6, '0') as n from generate_series(1, p_anzahl)) z
    returning *;
end $$;

insert into log_bezeichnung (tabelle, spalte, text) values ('firma', 'etikett_praefix', 'Etikett-Präfix')
on conflict (tabelle, spalte) do nothing;
