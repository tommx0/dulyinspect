-- Zwei-Faktor-Anmeldung (TOTP, Authenticator-App): Der Admin legt je Benutzer fest, ob sie Pflicht ist – auch für sich selbst.
-- Pflicht heißt: Ohne bestätigten zweiten Faktor (Sitzung mit aal2) sieht und ändert der Benutzer nichts.
-- Durchgesetzt in den Hilfsfunktionen ist_aktiv/ist_admin/ist_systemadmin (stecken in fast allen Regeln und Funktionen)
-- und zusätzlich mit einer einschränkenden Regel „zwei_faktor“ auf jeder Tabelle und auf storage.objects.
-- Neue Tabellen in späteren Migrationen brauchen diese Regel ebenfalls (der Test schutz_zwei_faktor_test.sql prüft das).

alter table benutzer add column zwei_faktor boolean not null default false;
comment on column benutzer.zwei_faktor is 'Zwei-Faktor-Anmeldung Pflicht (setzt nur der Admin)';
insert into log_bezeichnung (tabelle, spalte, text) values ('benutzer', 'zwei_faktor', 'Zwei-Faktor-Anmeldung');

-- Ohne Pflicht immer erfüllt; mit Pflicht nur in einer Sitzung, die den zweiten Faktor bestätigt hat
create function zwei_faktor_erfuellt() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      or not exists (select 1 from benutzer where id = auth.uid() and zwei_faktor);
$$;
revoke all on function zwei_faktor_erfuellt() from public, anon;
grant execute on function zwei_faktor_erfuellt() to authenticated;

-- Für die App vor dem zweiten Faktor: Muss ich den zweiten Faktor angeben bzw. einrichten?
create function zwei_faktor_pflicht() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select zwei_faktor from benutzer where id = auth.uid()), false);
$$;
revoke all on function zwei_faktor_pflicht() from public, anon;
grant execute on function zwei_faktor_pflicht() to authenticated;

-- Für die Benutzerverwaltung: Wer hat eine Authenticator-App bestätigt? (nur Admin)
create function zwei_faktor_eingerichtet() returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct f.user_id from auth.mfa_factors f where f.status = 'verified' and ist_systemadmin();
$$;
revoke all on function zwei_faktor_eingerichtet() from public, anon;
grant execute on function zwei_faktor_eingerichtet() to authenticated;

create or replace function ist_aktiv() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from benutzer where id = auth.uid() and aktiv) and zwei_faktor_erfuellt();
$$;

create or replace function ist_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from benutzer where id = auth.uid() and rolle::text in ('admin', 'planer') and aktiv) and zwei_faktor_erfuellt();
$$;

create or replace function ist_systemadmin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from benutzer where id = auth.uid() and rolle::text = 'admin' and aktiv) and zwei_faktor_erfuellt();
$$;

-- Einschränkende Regel zusätzlich zu allen bestehenden (auch zu denen, die nur auth.uid() vergleichen)
do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('create policy zwei_faktor on %I as restrictive for all to authenticated
      using ((select zwei_faktor_erfuellt())) with check ((select zwei_faktor_erfuellt()))', t);
  end loop;
end $$;
create policy zwei_faktor on storage.objects as restrictive for all to authenticated
  using ((select public.zwei_faktor_erfuellt())) with check ((select public.zwei_faktor_erfuellt()));

-- Die Pflicht setzt nur der Admin (über die Benutzerverwaltung)
create or replace function benutzer_schutz() returns trigger
language plpgsql as $$
begin
  -- Serverseitige Aufrufe (Edge Function mit Service-Role, Migrationen) sind erlaubt
  if auth.role() = 'service_role' or auth.uid() is null then
    return new;
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
