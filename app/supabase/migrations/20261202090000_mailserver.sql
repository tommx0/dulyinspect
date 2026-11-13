-- Version 2.92.0: Mailserver je Instanz (Konzept docs/KONZEPT-MAIL.md, Schritt 1). Grundlage für Statusmails,
-- Fehlermeldungen und „Passwort vergessen“ in späteren Versionen.
--
-- quelle: zentral = Mailserver des Betreibers (Umgebung MAIL_ZENTRAL_* der Edge Functions), eigen = hier eingetragen, aus = keine Mails.
-- Lesen darf nur der Systemadmin; geschrieben wird nur über die Edge Function „mail“ (Service-Rolle), die den Host prüft
-- (keine internen Adressen) und das Passwort verschlüsselt. Das Passwort steht deshalb nicht hier, sondern in intern.mail_geheim,
-- AES-GCM-verschlüsselt mit MAIL_SCHLUESSEL aus der Umgebung der Edge Functions: Ein Datenbank-Dump allein verrät es nicht.

create table mail_einstellung (
  id int primary key default 1 check (id = 1),
  quelle text not null default 'aus' check (quelle in ('aus', 'zentral', 'eigen')),
  smtp_host text check (smtp_host ~ '^[A-Za-z0-9.-]{1,253}$'),
  smtp_port int check (smtp_port between 1 and 65535),
  smtp_sicherheit text not null default 'starttls' check (smtp_sicherheit in ('tls', 'starttls', 'keine')),
  smtp_benutzer text check (length(smtp_benutzer) <= 254 and smtp_benutzer !~ '[\r\n]'),
  absender_adresse text check (absender_adresse ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(absender_adresse) <= 254),
  absender_name text check (length(absender_name) <= 100 and absender_name !~ '[\r\n"<>]'),
  zuletzt_getestet_am timestamptz,
  zuletzt_test_ok boolean,
  geaendert_am timestamptz not null default now(),
  constraint mail_einstellung_eigen_vollstaendig check (
    quelle <> 'eigen' or (smtp_host is not null and smtp_port is not null and absender_adresse is not null))
);
comment on table mail_einstellung is 'Mailserver der Instanz (eine Zeile); Passwort verschlüsselt in intern.mail_geheim';
insert into mail_einstellung default values;

create trigger mail_einstellung_geaendert_am before update on mail_einstellung for each row execute function setze_geaendert_am();
create trigger mail_einstellung_audit after insert or update or delete on mail_einstellung for each row execute function audit();
create trigger aa_demo_schreibsperre before insert or update or delete on mail_einstellung
  for each row execute function demo_schreibsperre();

alter table mail_einstellung enable row level security;
revoke all on mail_einstellung from public, anon, authenticated;
grant select on mail_einstellung to authenticated;
grant select, update on mail_einstellung to service_role;
create policy mail_einstellung_lesen on mail_einstellung for select to authenticated using (ist_systemadmin());
create policy zwei_faktor on mail_einstellung as restrictive for all to authenticated
  using ((select zwei_faktor_erfuellt())) with check ((select zwei_faktor_erfuellt()));
-- Änderungen in die Logdatei (als „System“, weil die Edge Function schreibt; sie trägt den handelnden Admin zusätzlich ein)
select log_ueberwachen('mail_einstellung');

-- Passwort des eigenen Mailservers: nur Geheimtext, nur über die beiden Funktionen für die Service-Rolle
create table intern.mail_geheim (
  id int primary key default 1 check (id = 1),
  passwort text check (passwort ~ '^mail1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$')
);
revoke all on intern.mail_geheim from public, anon, authenticated;
insert into intern.mail_geheim default values;

create function mail_passwort_setzen(p_geheim text) returns void
language sql security definer set search_path = public as $$
  update intern.mail_geheim set passwort = nullif(p_geheim, '') where id = 1;
$$;
create function mail_passwort_lesen() returns text
language sql stable security definer set search_path = public as $$
  select passwort from intern.mail_geheim where id = 1;
$$;
revoke all on function mail_passwort_setzen(text) from public, anon, authenticated;
revoke all on function mail_passwort_lesen() from public, anon, authenticated;
grant execute on function mail_passwort_setzen(text) to service_role;
grant execute on function mail_passwort_lesen() to service_role;

insert into log_bezeichnung (tabelle, spalte, text) values
  ('mail_einstellung', '', 'Mailserver'),
  ('mail_einstellung', 'quelle', 'Mailserver'),
  ('mail_einstellung', 'smtp_host', 'SMTP-Server'),
  ('mail_einstellung', 'smtp_port', 'Port'),
  ('mail_einstellung', 'smtp_sicherheit', 'Verschlüsselung'),
  ('mail_einstellung', 'smtp_benutzer', 'SMTP-Benutzer'),
  ('mail_einstellung', 'absender_adresse', 'Absenderadresse'),
  ('mail_einstellung', 'absender_name', 'Absendername'),
  ('mail_einstellung', 'zuletzt_getestet_am', 'Zuletzt getestet'),
  ('mail_einstellung', 'zuletzt_test_ok', 'Letzter Test erfolgreich')
on conflict (tabelle, spalte) do nothing;

-- Die Edge Functions prüfen vor dem Versand den Demomodus (im Demomodus gehen keine Mails hinaus)
grant execute on function demo_modus() to service_role;
