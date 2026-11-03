-- Version 2.40.0: Supportzugang (Fernwartung). Ein Benutzer „support“ mit Adminrechten, normalerweise gesperrt.
-- Ein Admin schaltet ihn für 60 oder 120 Minuten frei (Edge Function admin-benutzer, jedes Mal mit neuem Zufallspasswort)
-- und kann ihn jederzeit wieder sperren. Freischalten, Sperren und das automatische Sperren nach Ablauf stehen in der Logdatei.
--
-- Der Benutzer wird erst beim ersten Freischalten angelegt (sonst gälte die Ersteinrichtung als abgeschlossen).
-- Durchgesetzt wird der Ablauf in ist_aktiv/ist_admin/ist_systemadmin über aktiv_bis – auf die Minute genau, auch wenn die
-- Sitzung noch läuft. Danach sperrt support_ablauf() die Anmeldung in Auth und beendet die Sitzungen: jede Minute per pg_cron,
-- wo vorhanden, sonst beim nächsten Aufruf der App oder der Benutzerverwaltung.

alter table benutzer add column support boolean not null default false;
alter table benutzer add column aktiv_bis timestamptz;
comment on column benutzer.support is 'Supportzugang (Fernwartung); Freischalten und Sperren nur über die Benutzerverwaltung';
comment on column benutzer.aktiv_bis is 'Zugang nur bis zu diesem Zeitpunkt (Supportzugang); leer = unbefristet';
create unique index benutzer_ein_support on benutzer (support) where support;
insert into log_bezeichnung (tabelle, spalte, text) values ('benutzer', 'support', 'Supportzugang'), ('benutzer', 'aktiv_bis', 'Aktiv bis');

create or replace function ist_aktiv() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from benutzer where id = auth.uid() and aktiv and (aktiv_bis is null or aktiv_bis > now()))
     and zwei_faktor_erfuellt();
$$;

create or replace function ist_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from benutzer where id = auth.uid() and rolle::text in ('admin', 'planer') and aktiv
                   and (aktiv_bis is null or aktiv_bis > now()))
     and zwei_faktor_erfuellt();
$$;

create or replace function ist_systemadmin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from benutzer where id = auth.uid() and rolle::text = 'admin' and aktiv
                   and (aktiv_bis is null or aktiv_bis > now()))
     and zwei_faktor_erfuellt();
$$;

-- Supportzugang und Freischaltdauer setzt nur der Server (Edge Function); auch Admins ändern den Supportzugang nicht direkt
create or replace function benutzer_schutz() returns trigger
language plpgsql as $$
begin
  -- Serverseitige Aufrufe (Edge Function mit Service-Role, Migrationen) sind erlaubt, ebenso support_freischalten/support_sperren
  -- (support.intern; auch wenn ein angemeldeter Benutzer das Sperren nach Ablauf auslöst)
  if auth.role() = 'service_role' or auth.uid() is null or current_setting('support.intern', true) = 'an' then
    return new;
  end if;
  if (new.support, new.aktiv_bis) is distinct from (old.support, old.aktiv_bis)
     or (old.support and (new.rolle, new.aktiv, new.email, new.zwei_faktor) is distinct from (old.rolle, old.aktiv, old.email, old.zwei_faktor)) then
    raise exception 'Den Supportzugang nur über Freischalten und Sperren in der Benutzerverwaltung ändern';
  end if;
  if not ist_systemadmin() and (new.rolle <> old.rolle or new.aktiv <> old.aktiv or new.email <> old.email) then
    raise exception 'Nur Admins dürfen Rolle, Status oder E-Mail ändern';
  end if;
  -- Steht auf den Protokollen bzw. betrifft die Anmeldung; die Pflege läuft über die Benutzerverwaltung (Edge Function)
  if not ist_systemadmin() and (new.name, new.sachkunde_hinweis, new.zwei_faktor) is distinct from (old.name, old.sachkunde_hinweis, old.zwei_faktor) then
    raise exception 'Nur Admins dürfen Name, Sachkunde-Hinweis und Zwei-Faktor-Pflicht ändern';
  end if;
  return new;
end $$;

-- Freischalten (nach dem neuen Passwort und dem Aufheben der Sperre in Auth durch die Edge Function). Gibt das Ende zurück.
create function support_freischalten(p_admin uuid, p_minuten int) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v_bis timestamptz := now() + make_interval(mins => p_minuten);
begin
  if p_minuten not in (60, 120) then raise exception 'Freischalten nur für 60 oder 120 Minuten'; end if;
  perform set_config('support.intern', 'an', true);
  update benutzer set aktiv = true, aktiv_bis = v_bis where support;
  if not found then raise exception 'Kein Supportzugang angelegt'; end if;
  perform set_config('support.intern', '', true);
  perform log_schreiben(log_benutzer(p_admin), 'Supportzugang freigeschaltet',
    format('%s Minuten, bis %s; neues Passwort erzeugt', p_minuten, to_char(v_bis at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI "Uhr"')));
  return v_bis;
end $$;

-- Sperren: Profil inaktiv, Anmeldung in Auth gesperrt (wie beim Deaktivieren: 100 Jahre), alle Sitzungen beendet.
-- p_admin leer = automatisch („System“ in der Logdatei).
create function support_sperren(p_admin uuid, p_details text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  select id into v_id from benutzer where support for update;
  if v_id is null then return; end if;
  perform set_config('support.intern', 'an', true);
  update benutzer set aktiv = false, aktiv_bis = null where id = v_id and (aktiv or aktiv_bis is not null);
  perform set_config('support.intern', '', true);
  update auth.users set banned_until = now() + interval '100 years' where id = v_id;
  delete from auth.sessions where user_id = v_id;  -- Refresh-Tokens hängen an der Sitzung
  perform log_schreiben(log_benutzer(p_admin), 'Supportzugang gesperrt', p_details);
end $$;

-- Abgelaufene Freischaltung sperren. Darf jeder angemeldete Benutzer auslösen (tut nichts, solange nichts abgelaufen ist).
create function support_ablauf() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_bis timestamptz;
begin
  select aktiv_bis into v_bis from benutzer where support and aktiv and aktiv_bis <= now() for update;
  if not found then return; end if;
  perform support_sperren(null, format('automatisch, Freischaltung abgelaufen um %s',
    to_char(v_bis at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI "Uhr"')));
end $$;

revoke all on function support_freischalten(uuid, int), support_sperren(uuid, text), support_ablauf() from public, anon, authenticated;
grant execute on function support_freischalten(uuid, int), support_sperren(uuid, text), support_ablauf() to service_role;
grant execute on function support_ablauf() to authenticated;

-- Jede Minute prüfen, wo pg_cron verfügbar ist (Supabase-Datenbank „postgres“). Fehlt es oder ist es hier nicht erlaubt
-- (z. B. eine Datenbank je Kunde), übernehmen App und Benutzerverwaltung das Sperren beim nächsten Aufruf.
do $$
begin
  begin
    create extension if not exists pg_cron;
    perform cron.schedule('supportzugang-ablauf', '* * * * *', 'select public.support_ablauf()');
  exception when others then
    raise notice 'pg_cron nicht verfügbar (%), Supportzugang wird beim nächsten Aufruf gesperrt', sqlerrm;
  end;
end $$;
