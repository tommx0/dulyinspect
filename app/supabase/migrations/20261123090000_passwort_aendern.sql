-- Passwort bei der nächsten Anmeldung ändern (2.80): Wer ein Passwort von jemand anderem bekommt (Ersteinrichtung durch die
-- Mandanten-Verwaltung, neuer Benutzer, Passwort vom Admin neu gesetzt), legt vor dem Arbeiten ein eigenes fest.
-- Gemerkt wird der Hash des vorgegebenen Passworts: Die Pflicht gilt, solange dieses Passwort noch gilt. Ein Aufruf ohne
-- echten Wechsel hebt sie also nicht auf, und jeder spätere Wechsel (auch durch den Admin ohne Pflicht) beendet sie.
-- In intern, damit der Demomodus den Wechsel nicht sperrt und kein Benutzer die Vorgabe lesen kann.

create table intern.passwort_vorgabe (
  benutzer_id uuid primary key references auth.users (id) on delete cascade,
  hash text not null,
  gesetzt_am timestamptz not null default now()
);
revoke all on intern.passwort_vorgabe from public, anon, authenticated;

-- Für Edge Functions und Verwaltung (Service-Rolle): Pflicht für das aktuelle Passwort setzen
create function passwort_aendern_setzen(p_benutzer uuid) returns void
language sql security definer set search_path = public as $$
  insert into intern.passwort_vorgabe (benutzer_id, hash)
  select id, encrypted_password from auth.users where id = p_benutzer
  on conflict (benutzer_id) do update set hash = excluded.hash, gesetzt_am = now();
$$;
revoke all on function passwort_aendern_setzen(uuid) from public, anon, authenticated;
grant execute on function passwort_aendern_setzen(uuid) to service_role;

-- Für die App nach der Anmeldung: muss der angemeldete Benutzer sein Passwort ändern? Räumt eine erledigte Vorgabe ab.
create function passwort_aendern_noetig() returns boolean
language plpgsql security definer set search_path = public as $$
declare
  noetig boolean;
begin
  if auth.uid() is null then return false; end if;
  select v.hash = u.encrypted_password into noetig
  from intern.passwort_vorgabe v join auth.users u on u.id = v.benutzer_id
  where v.benutzer_id = auth.uid();
  if noetig is false then delete from intern.passwort_vorgabe where benutzer_id = auth.uid(); end if;
  return coalesce(noetig, false);
end $$;
revoke all on function passwort_aendern_noetig() from public, anon;
grant execute on function passwort_aendern_noetig() to authenticated;
