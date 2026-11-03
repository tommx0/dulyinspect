-- Version 2.57.0: Mandantencode – fünf zufällige Zeichen je Instanz, z. B. K7Q3X.
-- Etikett-IDs (PK-0000001) und Zählerstände sind nur innerhalb einer Instanz eindeutig. Damit ein Etikett einer anderen
-- Instanz beim Scannen nicht eine falsche Anlage öffnet, tragen neue QR-Codes den Code mit (…/?t=PK-0000001&k=K7Q3X),
-- und die App lehnt Codes mit fremdem k ab. Ältere Etiketten ohne k gelten weiter.
-- Alphabet wie bei den Melder-Codes (ohne I, L, O, U, Z). Der Code entsteht einmal und lässt sich nicht ändern;
-- nur eine Wiederherstellung in eine noch leere Instanz übernimmt den Code aus der Sicherung.

create function mandantencode_erzeugen() returns text
language plpgsql volatile as $$
declare
  zeichen constant text := '0123456789ABCDEFGHJKMNPQRSTVWXY';
  code text := '';
  b int;
begin
  while length(code) < 5 loop
    -- Byte 0 einer UUID v4 ist zufällig; ab 248 (= 31 × 8) verwerfen, damit alle Zeichen gleich häufig sind
    b := get_byte(uuid_send(gen_random_uuid()), 0);
    if b < 248 then code := code || substr(zeichen, b % 31 + 1, 1); end if;
  end loop;
  return code;
end $$;

-- Die vorhandene Zeile bekommt beim Hinzufügen ihren eigenen Zufallscode
alter table firma add column mandantencode text not null default mandantencode_erzeugen()
  constraint firma_mandantencode_check check (mandantencode ~ '^[0-9A-HJKMNP-TV-Y]{5}$');
comment on column firma.mandantencode is 'Zufällig je Instanz, steht in jedem QR-Code (k=…) und klein auf dem Etikett; nicht änderbar';

create function firma_mandantencode_schuetzen() returns trigger
language plpgsql as $$
begin
  if new.mandantencode is distinct from old.mandantencode
     and current_setting('app.mandantencode_uebernehmen', true) is distinct from 'ja' then
    raise exception 'Der Mandantencode kann nicht geändert werden';
  end if;
  return new;
end $$;
create trigger firma_mandantencode before update on firma for each row execute function firma_mandantencode_schuetzen();

-- Wiederherstellung in eine neue Instanz: Code aus der Sicherung übernehmen, damit die gedruckten Etiketten weiter passen.
-- Hat die Instanz schon Etiketten oder Melder-Codes, gehören diese zum vorhandenen Code → nichts ändern (false).
create function mandantencode_uebernehmen(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not ist_systemadmin() then raise exception 'Nur Admins dürfen wiederherstellen'; end if;
  if coalesce(p_code, '') !~ '^[0-9A-HJKMNP-TV-Y]{5}$' then raise exception 'Ungültiger Mandantencode'; end if;
  if exists (select 1 from etikett) or exists (select 1 from anlage_element where code is not null) then return false; end if;
  perform set_config('app.mandantencode_uebernehmen', 'ja', true);
  update firma set mandantencode = p_code where id = 1;
  return true;
end $$;
revoke all on function mandantencode_uebernehmen(text) from public, anon;
grant execute on function mandantencode_uebernehmen(text) to authenticated;

insert into log_bezeichnung (tabelle, spalte, text) values ('firma', 'mandantencode', 'Mandantencode')
on conflict (tabelle, spalte) do nothing;
