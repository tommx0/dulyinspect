-- Version 2.92.0: „Passwort vergessen“ (Konzept docs/KONZEPT-MAIL.md, Schritt 3). Die Edge Function „passwort-vergessen“
-- erzeugt den Link über die Auth-API (generateLink, GoTrue verschickt selbst nichts) und sendet ihn über den Mailserver
-- der Instanz. Hier: Schalter für den Admin und die Drossel gegen Mailfluten und Ausprobieren.

alter table mail_einstellung add column passwort_vergessen boolean not null default true;
comment on column mail_einstellung.passwort_vergessen is 'Link „Passwort vergessen?“ auf der Anmeldeseite anbieten (nur mit Mailserver)';
insert into log_bezeichnung (tabelle, spalte, text) values
  ('mail_einstellung', 'passwort_vergessen', 'Passwort vergessen anbieten')
on conflict (tabelle, spalte) do nothing;

-- Anfragen der letzten 24 Stunden, nur als Prüfsummen (keine Adressen im Klartext)
create table intern.passwort_vergessen_anfrage (
  id bigint generated always as identity primary key,
  email_hash text not null,
  ip_hash text not null,
  zeit timestamptz not null default now()
);
create index on intern.passwort_vergessen_anfrage (email_hash, zeit);
create index on intern.passwort_vergessen_anfrage (ip_hash, zeit);
revoke all on intern.passwort_vergessen_anfrage from public, anon, authenticated;

-- Anfrage zählen und eintragen. true = darf eine Mail auslösen: höchstens 3 je Adresse und 10 je IP in der Stunde.
-- Abgewiesene Anfragen zählen mit, sonst könnte man die Sperre durch Dauerfeuer umgehen.
create function passwort_vergessen_zulassen(p_email_hash text, p_ip_hash text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  je_email int;
  je_ip int;
begin
  if coalesce(p_email_hash, '') = '' or coalesce(p_ip_hash, '') = '' then raise exception 'Prüfsumme fehlt'; end if;
  delete from intern.passwort_vergessen_anfrage where zeit < now() - interval '24 hours';
  select count(*) into je_email from intern.passwort_vergessen_anfrage where email_hash = p_email_hash and zeit > now() - interval '1 hour';
  select count(*) into je_ip from intern.passwort_vergessen_anfrage where ip_hash = p_ip_hash and zeit > now() - interval '1 hour';
  insert into intern.passwort_vergessen_anfrage (email_hash, ip_hash) values (p_email_hash, p_ip_hash);
  return je_email < 3 and je_ip < 10;
end $$;
revoke all on function passwort_vergessen_zulassen(text, text) from public, anon, authenticated;
grant execute on function passwort_vergessen_zulassen(text, text) to service_role;
