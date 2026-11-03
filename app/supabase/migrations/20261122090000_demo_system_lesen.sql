-- Demomodus (2.79): Planer sehen im Demo auch die System-Bereiche (Benutzer, Einstellungen, Datensicherung, Logdateien),
-- ändern dort aber nichts. Dafür dürfen sie im Demo lesen, was sonst nur der Admin liest: Logdateien, Stand der Verschlüsselung,
-- eingerichtete zweite Faktoren, Lizenzbestätigungen und Sachkunde-Nachweise. Schreibende Prüfungen bleiben bei
-- ist_systemadmin(); im Demo sperrt ohnehin der Trigger aa_demo_schreibsperre.

-- Admin, im Demomodus auch Planer
create function ist_systemleser() returns boolean
language sql stable security definer set search_path = public as $$
  select ist_systemadmin() or (demo_modus() and ist_admin());
$$;
revoke all on function ist_systemleser() from public, anon;
grant execute on function ist_systemleser() to authenticated;

drop policy lizenz_akzeptanz_lesen on lizenz_akzeptanz;
create policy lizenz_akzeptanz_lesen on lizenz_akzeptanz for select to authenticated
  using (benutzer_id = auth.uid() or ist_systemleser());

-- Lesende Funktionen: unverändert bis auf ist_systemleser() statt ist_systemadmin()

CREATE OR REPLACE FUNCTION public.log_dateien()
 RETURNS TABLE(nr integer, aktuell boolean, angelegt_am timestamp with time zone, archiviert_am timestamp with time zone, groesse bigint, zeilen bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not ist_systemleser() then raise exception 'Nur für Admins'; end if;
  return query
    select d.nr, d.nr = (select max(x.nr) from log_datei x), d.angelegt_am, d.archiviert_am,
           coalesce(sum(z.bytes), 0)::bigint, count(z.id)
      from log_datei d left join log_zeile z on z.datei = d.nr
     group by d.nr order by d.nr desc;
end $function$;

CREATE OR REPLACE FUNCTION public.log_lesen(p_nr integer, p_suche text DEFAULT NULL::text, p_vor_id bigint DEFAULT NULL::bigint, p_anzahl integer DEFAULT 200)
 RETURNS TABLE(id bigint, zeile text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not ist_systemleser() then raise exception 'Nur für Admins'; end if;
  return query
    select z.id, z.zeile from log_zeile z
     where z.datei = p_nr and (p_vor_id is null or z.id < p_vor_id)
       and (coalesce(p_suche, '') = '' or z.zeile ilike '%' || replace(replace(replace(p_suche, '\', '\\'), '%', '\%'), '_', '\_') || '%')
     order by z.id desc
     limit least(greatest(p_anzahl, 1), 1000);
end $function$;

CREATE OR REPLACE FUNCTION public.log_text(p_nr integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  inhalt text;
begin
  if not ist_systemleser() then raise exception 'Nur für Admins'; end if;
  select coalesce(string_agg(zeile, e'\n' order by id) || e'\n', '') into inhalt from log_zeile where datei = p_nr;
  perform log_schreiben(log_benutzer(), 'Logdatei heruntergeladen', format('Datei %s', p_nr));
  return inhalt;
end $function$;

CREATE OR REPLACE FUNCTION public.verschluesselung_stand()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  f record;
  ausdruck text;
  klar bigint;
  geheim bigint;
  felder jsonb := '[]';
  summe_klar bigint := 0;
  summe_geheim bigint := 0;
  v verschluesselung;
  ziel text;
  verwaist bigint := 0;
  verwaist_loeschbar bigint := 0;
begin
  if not ist_systemleser() then
    raise exception 'Nur Administratoren können die Verschlüsselung verwalten' using errcode = 'insufficient_privilege';
  end if;
  select * into v from verschluesselung where id = 1;
  -- Abschaltung: Ziel Klartext (verwaist sind dann Dateien ohne Datensatz mit Kennung)
  ziel := case when v.abschaltung_seit is null then coalesce(v.tausch_schluessel_id, v.schluessel_id) end;
  for f in select * from verschluesselung_felder() loop
    ausdruck := case when f.spalte like '%.%' then format('(%I #>> %L)', split_part(f.spalte, '.', 1), '{' || split_part(f.spalte, '.', 2) || '}')
                     else format('%I', f.spalte) end;
    execute format('select count(*) filter (where coalesce(%1$s, '''') <> '''' and not %2$s), count(*) filter (where %2$s) from %3$I',
                   ausdruck,
                   case f.art when 'wert' then format('coalesce(ist_geheimtext(%s), false)', ausdruck) else format('coalesce(%s like ''%%.enc'', false)', ausdruck) end,
                   f.tabelle)
      into klar, geheim;
    felder := felder || jsonb_build_object('tabelle', f.tabelle, 'spalte', f.spalte, 'art', f.art, 'bucket', f.bucket,
                                           'klartext', klar, 'verschluesselt', geheim);
    summe_klar := summe_klar + klar;
    summe_geheim := summe_geheim + geheim;
  end loop;
  if v.id is not null and v.abgeschaltet_am is null and (ziel is not null or v.abschaltung_seit is not null) then
    select count(*), count(*) filter (where w.loeschbar) into verwaist, verwaist_loeschbar from verschluesselung_verwaiste_intern(ziel) w;
  end if;
  return jsonb_build_object('felder', felder, 'klartext', summe_klar, 'verschluesselt', summe_geheim,
    'verwaist', verwaist, 'verwaist_loeschbar', verwaist_loeschbar,
    'leer', summe_klar + summe_geheim = 0
            and not exists (select 1 from storage.objects o where o.bucket_id in ('fotos', 'unterschriften', 'protokolle', 'nachweise')),
    'tausch_offen', case when v.tausch_seit is not null then (verschluesselung_anzahl(v.tausch_schluessel_id) ->> 'ohne')::bigint end,
    'tausch_neu', case when v.tausch_seit is not null then (verschluesselung_anzahl(v.tausch_schluessel_id) ->> 'mit')::bigint end,
    'abschaltung_offen', case when v.abschaltung_seit is not null then summe_geheim end,
    'enc_dateien', (select count(*) from storage.objects o
                     where o.bucket_id in ('fotos', 'unterschriften', 'protokolle', 'nachweise') and o.name like '%.enc'));
end $function$;

CREATE OR REPLACE FUNCTION public.verschluesselung_verwaiste(p_ziel text)
 RETURNS TABLE(bucket text, name text, erstellt_am timestamp with time zone, loeschbar boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v verschluesselung;
begin
  if not ist_systemleser() then
    raise exception 'Nur Administratoren können die Verschlüsselung verwalten' using errcode = 'insufficient_privilege';
  end if;
  select * into v from verschluesselung where id = 1;
  if v.id is null or v.abgeschaltet_am is not null then return; end if;
  if v.abschaltung_seit is not null then
    if p_ziel is not null then raise exception 'Während der Abschaltung ist das Ziel Klartext'; end if;
  elsif p_ziel is distinct from v.schluessel_id and p_ziel is distinct from v.tausch_schluessel_id then
    raise exception 'Unbekannter Zielschlüssel';
  end if;
  return query select * from verschluesselung_verwaiste_intern(p_ziel) limit 1000;
end $function$;

CREATE OR REPLACE FUNCTION public.zwei_faktor_eingerichtet()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select distinct f.user_id from auth.mfa_factors f where f.status = 'verified' and ist_systemleser();
$function$;


-- Sachkunde-Nachweise (Dateien) zum Ansehen
drop policy nachweise_lesen on storage.objects;
create policy nachweise_lesen on storage.objects for select to authenticated
  using (bucket_id = 'nachweise' and (ist_systemleser() or (storage.foldername(name))[1] = auth.uid()::text));
