-- Demomodus (2.76): Planer und Prüfer sehen alles, ändern aber nichts. Nur der Admin schreibt (Demodaten pflegen), dazu
-- Skripte und Edge Functions mit der Service-Rolle. Die App schaltet den Modus über die Build-Variable VITE_DEMO=ja und sperrt
-- im Browser selbst (src/lib/demo.ts); diese Sperre hier gilt auch für Aufrufe direkt über die API.
-- Einschalten (Ausroll-Skript oder von Hand): update intern.demo_modus set aktiv = true;
-- Ausgenommen sind nur technische Tabellen, die jeder Benutzer beim Arbeiten schreibt: Protokoll (log_*), Lizenzbestätigung
-- und das Änderungsprotokoll der Trigger. Neue Tabellen bekommen die Sperre nicht von selbst – der Test demomodus_test.sql
-- schlägt dann fehl.

create table intern.demo_modus (
  id int primary key default 1 check (id = 1),
  aktiv boolean not null default false
);
revoke all on intern.demo_modus from public, anon, authenticated;
insert into intern.demo_modus default values;

-- Für die App: Abgleich mit VITE_DEMO beim Start (auch vor der Anmeldung lesbar)
create function demo_modus() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select aktiv from intern.demo_modus where id = 1), false);
$$;
revoke all on function demo_modus() from public;
grant execute on function demo_modus() to anon, authenticated;

-- Ohne Benutzer (Service-Rolle, psql, Ausroll-Skripte) keine Sperre; anon schreibt ohnehin nichts (Zugriffsregeln)
create function demo_schreibsperre() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not demo_modus() or auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if exists (select 1 from benutzer where id = auth.uid() and rolle = 'admin' and aktiv) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'Demomodus: Änderungen werden nicht gespeichert' using errcode = 'insufficient_privilege';
end $$;
revoke all on function demo_schreibsperre() from public, anon, authenticated;

-- „aa_“: vor den übrigen BEFORE-Triggern, damit die Meldung des Demomodus kommt und nicht ein Folgefehler
do $$
declare
  t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename not in ('audit_log', 'lizenz_akzeptanz', 'log_datei', 'log_zeile')
  loop
    execute format('create trigger aa_demo_schreibsperre before insert or update or delete on public.%I
                    for each row execute function demo_schreibsperre()', t);
  end loop;
end $$;

-- Fotos, Unterschriften, Protokoll-PDFs, Logo
create trigger aa_demo_schreibsperre before insert or update or delete on storage.objects
  for each row execute function public.demo_schreibsperre();
