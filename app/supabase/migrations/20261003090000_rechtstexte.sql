-- Impressum und Datenschutzerklärung: vom Admin unter Einstellungen gepflegt, ohne Anmeldung lesbar
-- (Anmeldeseite, Wartungsseite). Öffentlich ist nur der jeweilige Text, nicht die übrigen Firmendaten.

alter table firma add column impressum text, add column datenschutz text;

create function rechtstext(p_art text) returns text
language sql stable security definer set search_path = public as $$
  select case p_art when 'impressum' then impressum when 'datenschutz' then datenschutz end from firma where id = 1
$$;
revoke all on function rechtstext(text) from public;
grant execute on function rechtstext(text) to anon, authenticated;
