-- Impressum und Datenschutzerklärung wahlweise als Text mit einfacher Formatierung (wie bisher), als HTML
-- (z. B. aus einem Generator für Rechtstexte) oder als Link auf eine externe Seite. Inhalt bleibt in impressum/datenschutz.
-- HTML bereinigt die App beim Anzeigen (nur erlaubte Elemente, keine Skripte oder Formatierungen).

alter table firma
  add column impressum_format text not null default 'text' check (impressum_format in ('text', 'html', 'link')),
  add column datenschutz_format text not null default 'text' check (datenschutz_format in ('text', 'html', 'link'));
comment on column firma.impressum_format is 'text = einfache Formatierung, html = HTML, link = Webadresse einer externen Seite';
comment on column firma.datenschutz_format is 'text = einfache Formatierung, html = HTML, link = Webadresse einer externen Seite';

-- Bisher galt ein Feld, in dem nur eine Webadresse steht, als Link
update firma set impressum_format = 'link' where impressum ~* '^\s*https?://\S+\s*$';
update firma set datenschutz_format = 'link' where datenschutz ~* '^\s*https?://\S+\s*$';

insert into log_bezeichnung (tabelle, spalte, text) values
  ('firma', 'impressum_format', 'Impressum (Art)'), ('firma', 'datenschutz_format', 'Datenschutz (Art)');

-- Öffentlich lesbar wie rechtstext(), zusätzlich mit der Art. rechtstext() bleibt für ältere App-Versionen.
create function rechtstext_inhalt(p_art text) returns table (format text, inhalt text)
language sql stable security definer set search_path = public as $$
  select case p_art when 'impressum' then impressum_format when 'datenschutz' then datenschutz_format end,
         case p_art when 'impressum' then impressum when 'datenschutz' then datenschutz end
    from firma where id = 1
$$;
revoke all on function rechtstext_inhalt(text) from public;
grant execute on function rechtstext_inhalt(text) to anon, authenticated;
