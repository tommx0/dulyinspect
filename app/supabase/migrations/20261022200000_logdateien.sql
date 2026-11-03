-- Logdateien: jede Datenbankänderung und wichtige Aktionen der App als Textzeile
--   <Zeit UTC> | <Benutzer oder System> | <Aktion> | <Details>
-- Eine Datei ist höchstens 10 MB groß. Ist sie voll, wird sie archiviert und eine neue begonnen;
-- es bleiben die aktuelle Datei und 2 Archive. Lesen und Herunterladen nur für Admins (System → Logdateien).
--
-- Neue Tabellen in späteren Migrationen: select log_ueberwachen('tabelle');

create table log_datei (
  nr int primary key,
  angelegt_am timestamptz not null default now(),
  archiviert_am timestamptz
);

-- Ohne Fremdschlüssel: Schreiben soll nie an einer gerade gelöschten Archivdatei scheitern
create table log_zeile (
  id bigint generated always as identity primary key,
  datei int not null,
  zeile text not null,
  bytes int generated always as (octet_length(zeile) + 1) stored  -- + Zeilenumbruch in der Datei
);
create index on log_zeile (datei, id) include (bytes);

alter table log_datei enable row level security;
alter table log_zeile enable row level security;
revoke all on log_datei, log_zeile from public, anon, authenticated;

insert into log_datei (nr) values (1);

-- Größe, ab der die aktuelle Datei archiviert wird: 10 MB abzüglich Puffer für Zeilen zwischen zwei Prüfungen
-- (geprüft wird nur jede 32. Zeile, eine Zeile hat höchstens ~3 KB). Für Tests über log.grenze kleiner einstellbar.
create function log_grenze() returns bigint
language sql stable set search_path = public as $$
  select coalesce(nullif(current_setting('log.grenze', true), '')::bigint, 10 * 1024 * 1024 - 256 * 1024);
$$;

-- Text einzeilig machen und kürzen.
create function log_kurz(p_text text, p_max int) returns text
language sql immutable as $$
  select case when length(t) > p_max then left(t, p_max - 1) || '…' else t end
    from (select regexp_replace(coalesce(p_text, ''), '[[:cntrl:]]+', ' ', 'g') as t) x;
$$;

-- Anzeigename des angemeldeten Benutzers, „System“ für Server, Migrationen und Service-Role.
create function log_benutzer(p_id uuid default auth.uid()) returns text
language sql stable security definer set search_path = public as $$
  select case when p_id is null then 'System'
    else coalesce((select case when trim(name) = '' then email else trim(name) || ' <' || email || '>' end from benutzer where id = p_id), p_id::text)
  end;
$$;

create function log_rotieren() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_datei int;
begin
  -- Nur ein Aufrufer rotiert; die anderen schreiben einfach weiter
  if not pg_try_advisory_xact_lock(hashtext('log_rotieren')) then return; end if;
  select max(nr) into v_datei from log_datei;
  if (select coalesce(sum(bytes), 0) from log_zeile where datei = v_datei) < log_grenze() then return; end if;
  update log_datei set archiviert_am = now() where nr = v_datei;
  insert into log_datei (nr) values (v_datei + 1);
  -- aktuelle Datei + 2 Archive behalten
  delete from log_zeile where datei <= v_datei - 2;
  delete from log_datei where nr <= v_datei - 2;
end $$;

create function log_schreiben(p_benutzer text, p_aktion text, p_details text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
begin
  insert into log_zeile (datei, zeile)
  values ((select max(nr) from log_datei),
          to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          || ' | ' || log_kurz(p_benutzer, 200) || ' | ' || log_kurz(p_aktion, 200)
          || case when coalesce(p_details, '') <> '' then ' | ' || log_kurz(p_details, 2000) else '' end)
  returning id into v_id;
  if v_id % 32 = 0 then perform log_rotieren(); end if;
end $$;

-- Feldwert für die Logzeile: Texte in Anführungszeichen, alles gekürzt.
create function log_wert(p_wert jsonb) returns text
language sql immutable as $$
  select case
    when p_wert is null or jsonb_typeof(p_wert) = 'null' then '∅'
    when jsonb_typeof(p_wert) = 'string' then '"' || log_kurz(p_wert #>> '{}', 80) || '"'
    else log_kurz(p_wert::text, 80)
  end;
$$;

-- Trigger für alle Tabellen; Argumente = Spalten des Primärschlüssels
create function log_datenbank() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  alt jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  neu jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  zeile jsonb := coalesce(neu, alt);
  pfad text := current_setting('request.path', true);
  schluessel text;
  teile text[] := '{}';
  k text;
begin
  -- Wiederherstellung: eine Zeile je Tabelle statt je Datensatz (die Zusammenfassung schreibt die App)
  if pfad = '/rpc/admin_wiederherstellen' then
    if current_setting('log.wiederherstellung', true) is distinct from tg_table_name then
      perform set_config('log.wiederherstellung', tg_table_name, true);
      perform log_schreiben(log_benutzer(), 'Wiederherstellung', format('Tabelle %s: fehlende Datensätze werden ergänzt', tg_table_name));
    end if;
    return null;
  end if;

  select string_agg(format('%s=%s', a, coalesce(zeile ->> a, '∅')), ', ' order by n) into schluessel
    from unnest(tg_argv) with ordinality as x (a, n);
  if tg_op = 'UPDATE' then
    for k in select key from jsonb_each(neu) where key <> 'geaendert_am' and neu -> key is distinct from alt -> key loop
      teile := teile || format('%s: %s → %s', k, log_wert(alt -> k), log_wert(neu -> k));
    end loop;
    if teile = '{}' then teile := array['keine Änderung']; end if;
  else
    for k in select key from jsonb_each(zeile) where key <> 'geaendert_am' and jsonb_typeof(zeile -> key) <> 'null' and key <> all (tg_argv) loop
      teile := teile || format('%s=%s', k, log_wert(zeile -> k));
    end loop;
  end if;

  perform log_schreiben(log_benutzer(), format('DB %s %s', tg_op, tg_table_name),
    schluessel || ' | ' || array_to_string(teile, '; ')
    || case when pfad like '/rpc/%' then ' | über ' || substr(pfad, 2) else '' end);
  return null;
end $$;

create function log_ueberwachen(p_tabelle text) returns void
language plpgsql security definer set search_path = public as $$
declare
  argumente text;
begin
  select string_agg(quote_literal(a.attname), ', ' order by array_position(i.indkey::int2[], a.attnum)) into argumente
    from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
   where i.indrelid = format('public.%I', p_tabelle)::regclass and i.indisprimary;
  if argumente is null then raise exception 'Tabelle % hat keinen Primärschlüssel', p_tabelle; end if;
  execute format('drop trigger if exists %I on %I', p_tabelle || '_log', p_tabelle);
  execute format('create trigger %I after insert or update or delete on %I for each row execute function log_datenbank(%s)',
                 p_tabelle || '_log', p_tabelle, argumente);
end $$;

do $$
declare t text;
begin
  -- audit_log nicht: jede Zeile dort ist schon als Änderung der eigentlichen Tabelle im Log
  for t in select tablename from pg_tables where schemaname = 'public' and tablename not in ('audit_log', 'log_datei', 'log_zeile') loop
    perform log_ueberwachen(t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Schnittstelle für App und Edge Function
-- ---------------------------------------------------------------------------

-- Aktion der App ins Log schreiben. p_erfasst_am: Zeitpunkt auf dem Gerät, wenn der Eintrag offline gewartet hat.
create function log_eintragen(p_aktion text, p_details text default null, p_erfasst_am timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not ist_aktiv() then raise exception 'Nicht angemeldet'; end if;
  perform log_schreiben(log_benutzer(), p_aktion,
    concat_ws(' | ', nullif(p_details, ''),
      case when p_erfasst_am < now() - interval '1 minute'
        then 'auf dem Gerät erfasst ' || to_char(p_erfasst_am at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || ', nachgetragen' end));
end $$;

-- Für die Edge Function (Service-Role): Aktion im Namen des aufrufenden Admins.
create function log_eintragen_fuer(p_benutzer_id uuid, p_aktion text, p_details text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform log_schreiben(log_benutzer(p_benutzer_id), p_aktion, p_details);
end $$;

-- Aktuelle Datei und Archive (neueste zuerst).
create function log_dateien() returns table (nr int, aktuell boolean, angelegt_am timestamptz, archiviert_am timestamptz, groesse bigint, zeilen bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not ist_systemadmin() then raise exception 'Nur für Admins'; end if;
  return query
    select d.nr, d.nr = (select max(x.nr) from log_datei x), d.angelegt_am, d.archiviert_am,
           coalesce(sum(z.bytes), 0)::bigint, count(z.id)
      from log_datei d left join log_zeile z on z.datei = d.nr
     group by d.nr order by d.nr desc;
end $$;

-- Zeilen einer Datei, neueste zuerst, seitenweise (p_vor_id = kleinste id der vorigen Seite), optional gefiltert.
create function log_lesen(p_nr int, p_suche text default null, p_vor_id bigint default null, p_anzahl int default 200)
returns table (id bigint, zeile text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not ist_systemadmin() then raise exception 'Nur für Admins'; end if;
  return query
    select z.id, z.zeile from log_zeile z
     where z.datei = p_nr and (p_vor_id is null or z.id < p_vor_id)
       and (coalesce(p_suche, '') = '' or z.zeile ilike '%' || replace(replace(replace(p_suche, '\', '\\'), '%', '\%'), '_', '\_') || '%')
     order by z.id desc
     limit least(greatest(p_anzahl, 1), 1000);
end $$;

-- Ganze Datei als Text zum Herunterladen (älteste Zeile zuerst).
create function log_text(p_nr int) returns text
language plpgsql security definer set search_path = public as $$
declare
  inhalt text;
begin
  if not ist_systemadmin() then raise exception 'Nur für Admins'; end if;
  select coalesce(string_agg(zeile, e'\n' order by id) || e'\n', '') into inhalt from log_zeile where datei = p_nr;
  perform log_schreiben(log_benutzer(), 'Logdatei heruntergeladen', format('Datei %s', p_nr));
  return inhalt;
end $$;

revoke all on function log_grenze(), log_kurz(text, int), log_benutzer(uuid), log_rotieren(), log_schreiben(text, text, text),
  log_wert(jsonb), log_ueberwachen(text), log_eintragen_fuer(uuid, text, text) from public, anon, authenticated;
grant execute on function log_eintragen_fuer(uuid, text, text) to service_role;
revoke all on function log_eintragen(text, text, timestamptz), log_dateien(), log_lesen(int, text, bigint, int), log_text(int) from public, anon;
grant execute on function log_eintragen(text, text, timestamptz), log_dateien(), log_lesen(int, text, bigint, int), log_text(int) to authenticated;

select log_schreiben('System', 'Logdateien eingerichtet');
