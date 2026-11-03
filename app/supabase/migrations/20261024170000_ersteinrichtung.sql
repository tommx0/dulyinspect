-- Ersteinrichtung: Solange es noch keinen Zugang gibt, zeigt die Anmeldeseite statt der Anmeldung ein Formular für den
-- ersten Admin (Edge Function „ersteinrichtung“). Es gibt keinen vorab angelegten Zugang mehr.
-- Öffentlich lesbar, verrät nur, ob die Instanz schon eingerichtet ist.
create function ersteinrichtung_offen() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from auth.users)
$$;
revoke all on function ersteinrichtung_offen() from public;
grant execute on function ersteinrichtung_offen() to anon, authenticated;
