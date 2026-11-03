-- Verschlüsselung abschalten (docs/KONZEPT-VERSCHLUESSELUNG.md, „Abschalten der Verschlüsselung“, Version 2.53.0): die
-- Umstellung rückwärts. Ein Admin beginnt die Abschaltung (ab dann aktiv = false, Klartext und Geheimtext mit dem aktuellen
-- Schlüssel sind erlaubt), sein Browser entschlüsselt den Bestand über umschluesseln, verschluesselung_abschalten schließt
-- ab, sobald weder Geheimtext noch eine „.enc“-Datei übrig ist. Danach lehnt der Server Geheimtext ab.
--
-- - Die Zeile verschluesselung bleibt (instanz_id, schluessel_id, pruefwert), dazu abgeschaltet_am und ein
--   Abschaltnachweis: Text, im Admin-Browser mit dem Schlüssel verschlüsselt. Geräte mit Schlüssel glauben die Abschaltung
--   nur, wenn sie ihn lesen können – ein fehlgeleiteter Server bringt sie so nicht dazu, Klartext zu übertragen.
-- - verschluesselung_kennung meldet danach eingerichtet: false und abgeschaltet: true.
-- - Abbrechen macht aus der Abschaltung wieder eine Umstellung (vorwärts mit verschluesselung_aktivieren).
-- - Wieder einschalten: verschluesselung_einrichten (bzw. _ersetzen) setzt die Spalten der Abschaltung zurück.

-- ---------------------------------------------------------------------------
-- 1. Spalten
-- ---------------------------------------------------------------------------
alter table verschluesselung
  add column abschaltung_seit timestamptz,
  add column abschaltung_von uuid references benutzer (id) on delete set null,
  add column abschaltnachweis text check (ist_geheimtext(abschaltnachweis)),
  add column abgeschaltet_am timestamptz,
  add constraint verschluesselung_abschaltung_zustand check (abschaltung_seit is null or (not aktiv and tausch_seit is null and abgeschaltet_am is null)),
  add constraint verschluesselung_abgeschaltet_zustand check (abgeschaltet_am is null or (not aktiv and tausch_seit is null)),
  add constraint verschluesselung_nachweis_zustand check ((abschaltung_seit is null and abgeschaltet_am is null) = (abschaltnachweis is null));
comment on column verschluesselung.abschaltung_seit is 'Beginn einer laufenden Abschaltung (Bestand wird entschlüsselt)';
comment on column verschluesselung.abschaltnachweis is 'Fester Text, mit dem Schlüssel verschlüsselt – Geräte erkennen daran eine echte Abschaltung';
comment on column verschluesselung.abgeschaltet_am is 'Verschlüsselung abgeschaltet: Bestand ist Klartext, Geheimtext wird abgelehnt';

-- ---------------------------------------------------------------------------
-- 2. Kennung für den Browser
-- ---------------------------------------------------------------------------
create or replace function verschluesselung_kennung() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not ist_aktiv() then jsonb_build_object('berechtigt', false)
    else jsonb_build_object('berechtigt', true, 'eingerichtet', v.id is not null and v.abgeschaltet_am is null,
           'aktiv', coalesce(v.aktiv, false), 'abgeschaltet', v.abgeschaltet_am is not null,
           'instanz_id', v.instanz_id, 'schluessel_id', v.schluessel_id, 'pruefwert', v.pruefwert,
           'tausch_seit', v.tausch_seit, 'tausch_von', v.tausch_von,
           'tausch_schluessel_id', v.tausch_schluessel_id, 'tausch_pruefwert', v.tausch_pruefwert,
           'abschaltung_seit', v.abschaltung_seit, 'abschaltnachweis', v.abschaltnachweis) end
    from (select 1) eins left join verschluesselung v on v.id = 1;
$$;

-- ---------------------------------------------------------------------------
-- 3. Schutz vor Klartext: nach der Abschaltung kein Geheimtext mehr
-- ---------------------------------------------------------------------------
create or replace function verschluesselung_klartext_pruefen() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  f record;
  neu jsonb := to_jsonb(new);
  alt jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  w text;
  v verschluesselung;
  gelesen boolean := false;
  erlaubt text[];
  kennung text;
begin
  for f in select * from verschluesselung_felder() x where x.tabelle = tg_table_name loop
    w := neu #>> string_to_array(f.spalte, '.');
    if coalesce(w, '') = '' or (alt is not null and w is not distinct from alt #>> string_to_array(f.spalte, '.')) then
      continue;
    end if;
    if not gelesen then
      -- Ohne Filter sperren, erst dann prüfen: Aktivieren, Abschluss eines Tauschs und Abschalten (alle for update)
      -- warten, bis dieser Schreibvorgang fertig ist, und sehen ihn beim Prüfen des Bestands.
      select * into v from verschluesselung where id = 1 for share;
      gelesen := true;
      if v.id is null then return new; end if;
      erlaubt := case when v.abgeschaltet_am is not null then '{}'::text[]
                      else verschluesselung_schreibschluessel(v.schluessel_id, v.tausch_schluessel_id, v.tausch_von) end;
    end if;
    kennung := case f.art when 'wert' then geheimtext_schluessel(w) else verschluesselung_pfad_kennung(w) end;
    if kennung is null then
      if v.aktiv or (f.art = 'pfad' and w like '%.enc') then
        raise exception 'Unverschlüsselter Wert in %.% – die Verschlüsselung ist aktiv. Bitte die App aktualisieren.', tg_table_name, f.spalte
          using errcode = 'check_violation';
      end if;
    elsif v.abgeschaltet_am is not null then
      raise exception 'Wert in %.% ist verschlüsselt, die Verschlüsselung ist aber abgeschaltet. Bitte die App neu laden.', tg_table_name, f.spalte
        using errcode = 'check_violation', hint = 'verschluesselung_abgeschaltet';
    elsif not exists (select 1 from unnest(erlaubt) e where (case f.art when 'wert' then e else left(e, 8) end) = kennung) then
      raise exception 'Wert in %.% ist mit einem veralteten Schlüssel verschlüsselt. Bitte das aktuelle Schlüsselblatt scannen.', tg_table_name, f.spalte
        using errcode = 'check_violation', hint = 'schluessel_veraltet';
    end if;
  end loop;
  return new;
end $$;

-- Storage: nach der Abschaltung keine Datei mit Kennung mehr
create or replace function verschluesselung_dateipfad_erlaubt(p_pfad text) returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  v verschluesselung;
  kennung text := verschluesselung_pfad_kennung(p_pfad);
begin
  select * into v from verschluesselung where id = 1 for share;
  if v.id is null then return true; end if;
  if kennung is null then return not v.aktiv and p_pfad not like '%.enc'; end if;
  if v.abgeschaltet_am is not null then return false; end if;
  return exists (select 1 from unnest(verschluesselung_schreibschluessel(v.schluessel_id, v.tausch_schluessel_id, v.tausch_von)) e where left(e, 8) = kennung);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Stand und verwaiste Dateien: während der Abschaltung ist das Ziel Klartext (p_ziel null)
-- ---------------------------------------------------------------------------
create or replace function verschluesselung_verwaiste(p_ziel text) returns table (bucket text, name text, erstellt_am timestamptz, loeschbar boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v verschluesselung;
begin
  if not ist_systemadmin() then
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
end $$;

create or replace function verschluesselung_stand() returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
  if not ist_systemadmin() then
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
end $$;

-- ---------------------------------------------------------------------------
-- 5. Einrichten, Aktivieren, Ersetzen: nicht während der Abschaltung; nach der Abschaltung wieder möglich
-- ---------------------------------------------------------------------------
create or replace function verschluesselung_einrichten(p_instanz_id uuid, p_schluessel_id text, p_pruefwert text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v verschluesselung;
begin
  if not ist_systemadmin() then
    raise exception 'Nur Administratoren können die Verschlüsselung einrichten' using errcode = 'insufficient_privilege';
  end if;
  if p_instanz_id is null or coalesce(p_schluessel_id, '') !~ '^[0-9a-f]{16}$' or geheimtext_schluessel(p_pruefwert) is distinct from p_schluessel_id then
    raise exception 'Ungültige Angaben zum Schlüssel';
  end if;
  select * into v from verschluesselung where id = 1 for update;
  if v.aktiv then
    raise exception 'Die Verschlüsselung ist schon eingerichtet. Einen neuen Schlüssel gibt es nur über „Schlüssel tauschen“.';
  end if;
  if v.abschaltung_seit is not null then
    raise exception 'Die Verschlüsselung wird gerade abgeschaltet. Zum Weiterverschlüsseln die Abschaltung abbrechen.';
  end if;
  if v.id is not null and v.abgeschaltet_am is null and (v.instanz_id, v.schluessel_id) is distinct from (p_instanz_id, p_schluessel_id)
     and (verschluesselung_stand() ->> 'verschluesselt')::bigint > 0 then
    raise exception 'Die Umstellung läuft schon mit dem bisherigen Schlüssel. Bitte dessen Schlüsselblatt scannen.';
  end if;
  insert into verschluesselung (id, aktiv, instanz_id, schluessel_id, pruefwert, eingerichtet_am, eingerichtet_von)
  values (1, false, p_instanz_id, p_schluessel_id, p_pruefwert, now(), auth.uid())
  on conflict (id) do update set instanz_id = excluded.instanz_id, schluessel_id = excluded.schluessel_id,
    pruefwert = excluded.pruefwert, eingerichtet_am = excluded.eingerichtet_am, eingerichtet_von = excluded.eingerichtet_von,
    aktiv_seit = null, abgeschaltet_am = null, abschaltnachweis = null;
end $$;

create or replace function verschluesselung_aktivieren() returns void
language plpgsql security definer set search_path = public as $$
declare
  v verschluesselung;
  klar bigint;
  verwaist bigint;
begin
  if not ist_systemadmin() then
    raise exception 'Nur Administratoren können die Verschlüsselung verwalten' using errcode = 'insufficient_privilege';
  end if;
  -- Sperre zuerst: laufende Schreibvorgänge mit Klartext (siehe verschluesselung_klartext_pruefen) sind danach sichtbar
  select * into v from verschluesselung where id = 1 for update;
  if v.id is null or v.abgeschaltet_am is not null then raise exception 'Die Verschlüsselung ist noch nicht eingerichtet'; end if;
  if v.abschaltung_seit is not null then raise exception 'Die Verschlüsselung wird gerade abgeschaltet. Bitte die Abschaltung erst abbrechen.'; end if;
  if v.aktiv then return; end if;
  klar := (verschluesselung_anzahl(v.schluessel_id) ->> 'ohne')::bigint;
  if klar > 0 then
    raise exception 'Noch % Werte bzw. Dateien nicht mit dem aktuellen Schlüssel verschlüsselt – bitte die Umstellung fortsetzen', klar;
  end if;
  select count(*) into verwaist from verschluesselung_verwaiste_intern(v.schluessel_id);
  if verwaist > 0 then
    raise exception 'Noch % Dateien ohne Datensatz unverschlüsselt im Speicher – bitte die Umstellung fortsetzen (jüngere als 24 Stunden erst danach)', verwaist;
  end if;
  perform verschluesselung_logs_bereinigen(false);
  update verschluesselung set aktiv = true, aktiv_seit = now() where id = 1;
end $$;

create or replace function verschluesselung_ersetzen(p_instanz_id uuid, p_schluessel_id text, p_pruefwert text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v verschluesselung;
  s jsonb;
begin
  if not ist_systemadmin() then
    raise exception 'Nur Administratoren können die Verschlüsselung verwalten' using errcode = 'insufficient_privilege';
  end if;
  if p_instanz_id is null or coalesce(p_schluessel_id, '') !~ '^[0-9a-f]{16}$' or geheimtext_schluessel(p_pruefwert) is distinct from p_schluessel_id then
    raise exception 'Ungültige Angaben zum Schlüssel';
  end if;
  select * into v from verschluesselung where id = 1 for update;
  if v.id is null then raise exception 'Die Verschlüsselung ist noch nicht eingerichtet'; end if;
  if v.tausch_seit is not null then raise exception 'Während eines Schlüsseltauschs lässt sich die Kennung nicht ersetzen'; end if;
  if v.abschaltung_seit is not null then raise exception 'Während der Abschaltung lässt sich die Kennung nicht ersetzen'; end if;
  s := verschluesselung_stand();
  if not (s ->> 'leer')::boolean then
    raise exception 'Die Kennung lässt sich nur in einer leeren Instanz ersetzen (ohne Kunden, Objekte, Fotos, Unterschriften, Protokolle und Nachweise)';
  end if;
  update verschluesselung
     set instanz_id = p_instanz_id, schluessel_id = p_schluessel_id, pruefwert = p_pruefwert, aktiv = false, aktiv_seit = null,
         eingerichtet_am = now(), eingerichtet_von = auth.uid(), abgeschaltet_am = null, abschaltnachweis = null
   where id = 1;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Abschalten
-- ---------------------------------------------------------------------------
-- Beginnen (oder fortsetzen): nur Admin, ohne Tausch, nicht schon abgeschaltet. p_nachweis: Abschaltnachweis mit dem
-- aktuellen Schlüssel (den Inhalt prüft der Browser der anderen Geräte). Ab jetzt aktiv = false: Klartext ist erlaubt.
create function verschluesselung_abschaltung_beginnen(p_nachweis text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v verschluesselung;
begin
  if not ist_systemadmin() then
    raise exception 'Nur Administratoren können die Verschlüsselung abschalten' using errcode = 'insufficient_privilege';
  end if;
  select * into v from verschluesselung where id = 1 for update;
  if v.id is null or v.abgeschaltet_am is not null then raise exception 'Die Verschlüsselung ist nicht eingerichtet'; end if;
  if v.tausch_seit is not null then raise exception 'Während eines Schlüsseltauschs lässt sich die Verschlüsselung nicht abschalten'; end if;
  if geheimtext_schluessel(p_nachweis) is distinct from v.schluessel_id then
    raise exception 'Ungültiger Abschaltnachweis';
  end if;
  update verschluesselung
     set aktiv = false, abschaltung_seit = coalesce(v.abschaltung_seit, now()), abschaltung_von = auth.uid(),
         abschaltnachweis = coalesce(v.abschaltnachweis, p_nachweis)
   where id = 1;
end $$;
revoke all on function verschluesselung_abschaltung_beginnen(text) from public, anon;
grant execute on function verschluesselung_abschaltung_beginnen(text) to authenticated;

-- Abbrechen: die Instanz steht danach mitten in einer Umstellung (vorwärts weiter mit umschluesseln und aktivieren).
create function verschluesselung_abschaltung_abbrechen() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not ist_systemadmin() then
    raise exception 'Nur Administratoren können die Verschlüsselung verwalten' using errcode = 'insufficient_privilege';
  end if;
  perform 1 from verschluesselung where id = 1 and abschaltung_seit is not null for update;
  if not found then raise exception 'Es läuft keine Abschaltung'; end if;
  update verschluesselung set abschaltung_seit = null, abschaltung_von = null, abschaltnachweis = null where id = 1;
end $$;
revoke all on function verschluesselung_abschaltung_abbrechen() from public, anon;
grant execute on function verschluesselung_abschaltung_abbrechen() to authenticated;

-- Abschließen: erst, wenn kein Wert der Feldliste mehr Geheimtext ist, kein Pfad auf „.enc“ endet und keine „.enc“-Datei
-- mehr in den vier Buckets liegt. Die Sperre (for update) wartet auf laufende Schreibvorgänge (Trigger und Storage-Policy
-- sperren mit for share) und sieht sie danach.
create function verschluesselung_abschalten() returns void
language plpgsql security definer set search_path = public as $$
declare
  v verschluesselung;
  s jsonb;
begin
  if not ist_systemadmin() then
    raise exception 'Nur Administratoren können die Verschlüsselung abschalten' using errcode = 'insufficient_privilege';
  end if;
  select * into v from verschluesselung where id = 1 for update;
  if v.abschaltung_seit is null then raise exception 'Es läuft keine Abschaltung'; end if;
  s := verschluesselung_stand();
  if (s ->> 'verschluesselt')::bigint > 0 then
    raise exception 'Noch % Werte bzw. Dateien verschlüsselt – bitte das Entschlüsseln fortsetzen', s ->> 'verschluesselt';
  end if;
  if (s ->> 'enc_dateien')::bigint > 0 then
    raise exception 'Noch % verschlüsselte Dateien im Speicher – bitte das Entschlüsseln fortsetzen (Dateien ohne Datensatz, die jünger als 24 Stunden sind, erst danach)', s ->> 'enc_dateien';
  end if;
  update verschluesselung set abgeschaltet_am = now(), abschaltung_seit = null, abschaltung_von = null where id = 1;
end $$;
revoke all on function verschluesselung_abschalten() from public, anon;
grant execute on function verschluesselung_abschalten() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Umschlüsseln: während der Abschaltung Geheimtext → Klartext
-- ---------------------------------------------------------------------------
-- Zusätzlich zu Umstellung und Tausch (20261107090000_verschluesselung.sql):
--   Wert:  Geheimtext mit dem aktuellen Schlüssel → Klartext (nicht leer).
--   Pfad:  „x.k<Kennung>.enc“ → „x“; die Klartext-Datei muss im Bucket liegen. „fehlt“ wie bisher; „verwerfen“: die Datei
--          ist nicht lesbar – der Pfad wird ohne Datei umgesetzt, die alte bleibt als verwaist zurück und wird gelöscht.
create or replace function umschluesseln(p_aenderungen jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v verschluesselung;
  tausch boolean;
  abschaltung boolean;
  erlaubt text[];
  e jsonb;
  f record;
  spalten text[];
  bedingung text;
  ausdruck text;
  k text;
  aktuell text;
  alt text;
  neu text;
  gefunden boolean;
  n integer;
  geaendert integer := 0;
  revision_vorher text := coalesce(current_setting('session.revision', true), '');
begin
  if not ist_systemadmin() then
    raise exception 'Nur Administratoren können umschlüsseln' using errcode = 'insufficient_privilege';
  end if;
  select * into v from verschluesselung where id = 1;
  if v.id is null then raise exception 'Die Verschlüsselung ist noch nicht eingerichtet'; end if;
  if v.abgeschaltet_am is not null then raise exception 'Die Verschlüsselung ist abgeschaltet'; end if;
  tausch := v.tausch_seit is not null;
  abschaltung := v.abschaltung_seit is not null;
  if v.aktiv and not tausch then
    raise exception 'Umschlüsseln geht nur während der Umstellung oder eines Schlüsseltauschs';
  end if;
  if tausch and v.tausch_von is distinct from auth.uid() then
    raise exception 'Den Schlüsseltausch hat ein anderer Admin begonnen';
  end if;
  if jsonb_typeof(p_aenderungen) <> 'array' or jsonb_array_length(p_aenderungen) > 500 then
    raise exception 'Bitte höchstens 500 Änderungen je Aufruf';
  end if;
  erlaubt := array[v.schluessel_id] || case when tausch then array[v.tausch_schluessel_id] else '{}'::text[] end;

  perform set_config('session.revision', 'ja', true);
  perform set_config('verschluesselung.umschluesseln', 'ja', true);
  for e in select * from jsonb_array_elements(p_aenderungen) loop
    select * into f from verschluesselung_felder() x where x.tabelle = e ->> 'tabelle' and x.spalte = e ->> 'spalte';
    if f.tabelle is null then raise exception 'Kein verschlüsseltes Feld: %.%', e ->> 'tabelle', e ->> 'spalte'; end if;
    alt := e ->> 'alt';
    neu := e ->> 'neu';
    -- Zeile über ihre Schlüsselspalten (Namen aus der festen Liste, Werte als Literal)
    spalten := verschluesselung_schluesselspalten(f.tabelle);
    bedingung := '';
    foreach k in array spalten loop
      if coalesce(e -> 'schluessel' ->> k, '') = '' then raise exception 'Schlüsselspalte % fehlt', k; end if;
      bedingung := bedingung || case when bedingung = '' then '' else ' and ' end || format('%I = %L', k, e -> 'schluessel' ->> k);
    end loop;
    ausdruck := case when f.spalte like '%.%' then format('(%I #>> %L)', split_part(f.spalte, '.', 1), '{' || split_part(f.spalte, '.', 2) || '}')
                     else format('%I', f.spalte) end;
    execute format('select %s, true from %I where %s for update', ausdruck, f.tabelle, bedingung) into aktuell, gefunden;
    if not coalesce(gefunden, false) or aktuell is distinct from alt then continue; end if;  -- inzwischen geändert oder gelöscht

    if abschaltung then
      if f.art = 'wert' then
        if geheimtext_schluessel(aktuell) is distinct from v.schluessel_id or coalesce(neu, '') = '' or coalesce(ist_geheimtext(neu), false) then
          raise exception 'Unzulässige Änderung von %.%: bei der Abschaltung nur Geheimtext → Klartext', f.tabelle, f.spalte;
        end if;
      else
        if aktuell is null or verschluesselung_pfad_kennung(aktuell) is distinct from left(v.schluessel_id, 8)
           or neu is distinct from verschluesselung_pfad_basis(aktuell) then
          raise exception 'Unzulässiger neuer Pfad für %.%', f.tabelle, f.spalte;
        end if;
        if coalesce((e ->> 'fehlt')::boolean, false) then
          if exists (select 1 from storage.objects o where o.bucket_id = f.bucket and o.name = aktuell) then
            raise exception 'Die Datei % ist vorhanden und muss entschlüsselt werden', aktuell;
          end if;
        elsif not coalesce((e ->> 'verwerfen')::boolean, false)
              and not exists (select 1 from storage.objects o where o.bucket_id = f.bucket and o.name = neu) then
          raise exception 'Die entschlüsselte Datei % fehlt im Bucket %', neu, f.bucket;
        end if;
      end if;
    elsif f.art = 'wert' then
      if not coalesce(ist_geheimtext(neu), false) then raise exception 'Kein gültiger Geheimtext für %.%', f.tabelle, f.spalte; end if;
      if not geheimtext_schluessel(neu) = any (erlaubt) then
        raise exception 'Geheimtext für %.% mit einem unbekannten Schlüssel', f.tabelle, f.spalte;
      end if;
      if coalesce(aktuell, '') = '' or aktuell = neu
         or (not tausch and ist_geheimtext(aktuell))
         or (tausch and (not coalesce(ist_geheimtext(aktuell), false) or geheimtext_schluessel(aktuell) = geheimtext_schluessel(neu))) then
        raise exception 'Unzulässige Änderung von %.%: %', f.tabelle, f.spalte,
          case when tausch then 'beim Tausch nur Geheimtext → Geheimtext mit dem anderen Schlüssel' else 'bei der Umstellung nur Klartext → Geheimtext' end;
      end if;
    else
      if aktuell is null
         or (not tausch and (aktuell like '%.enc' or neu is distinct from aktuell || '.k' || left(v.schluessel_id, 8) || '.enc'))
         or (tausch and (aktuell not like '%.enc' or neu = aktuell
                         or verschluesselung_pfad_basis(neu) <> verschluesselung_pfad_basis(aktuell)
                         or not coalesce(verschluesselung_pfad_kennung(neu) = any (array[left(v.schluessel_id, 8), left(v.tausch_schluessel_id, 8)]), false))) then
        raise exception 'Unzulässiger neuer Pfad für %.%', f.tabelle, f.spalte;
      end if;
      if coalesce((e ->> 'fehlt')::boolean, false) then
        if exists (select 1 from storage.objects o where o.bucket_id = f.bucket and o.name = aktuell) then
          raise exception 'Die Datei % ist vorhanden und muss umgeschlüsselt werden', aktuell;
        end if;
      elsif not exists (select 1 from storage.objects o where o.bucket_id = f.bucket and o.name = neu) then
        raise exception 'Die verschlüsselte Datei % fehlt im Bucket %', neu, f.bucket;
      end if;
    end if;

    if f.spalte like '%.%' then
      execute format('update %I set %I = jsonb_set(%I, %L, to_jsonb($1::text)) where %s', f.tabelle, split_part(f.spalte, '.', 1),
                     split_part(f.spalte, '.', 1), '{' || split_part(f.spalte, '.', 2) || '}', bedingung) using neu;
    else
      execute format('update %I set %I = $1 where %s', f.tabelle, f.spalte, bedingung) using neu;
    end if;
    get diagnostics n = row_count;
    geaendert := geaendert + n;
  end loop;
  perform set_config('verschluesselung.umschluesseln', '', true);
  perform set_config('session.revision', revision_vorher, true);
  return geaendert;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Storage: Löschen und Protokolle hochladen auch während der Abschaltung, nicht nach ihr
-- ---------------------------------------------------------------------------
create or replace function verschluesselung_datei_loeschbar(p_bucket text, p_pfad text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  f record;
  verwendet boolean;
  gleich boolean;
  umgeschluesselt boolean := false;
begin
  if not ist_systemadmin() or not exists (
       select 1 from verschluesselung where id = 1 and abgeschaltet_am is null
          and (not aktiv or (tausch_seit is not null and tausch_von = auth.uid()))) then
    return false;
  end if;
  for f in select * from verschluesselung_felder() x where x.bucket = p_bucket loop
    execute format('select exists (select 1 from %1$I where %2$I = $1), exists (select 1 from %1$I where verschluesselung_pfad_basis(%2$I) = verschluesselung_pfad_basis($1))',
                   f.tabelle, f.spalte) into verwendet, gleich using p_pfad;
    if verwendet then return false; end if;
    umgeschluesselt := umgeschluesselt or gleich;
  end loop;
  return umgeschluesselt or coalesce((select o.created_at < now() - verschluesselung_mindestalter()
                                        from storage.objects o where o.bucket_id = p_bucket and o.name = p_pfad), true);
end $$;

-- Datei zu einem vorhandenen Protokoll ablegen (frühere Revisionen, die protokoll_pfad_erlaubt nicht zulässt): während
-- Umstellung oder Tausch verschlüsselt („.enc“), während der Abschaltung entschlüsselt unter dem Basispfad.
create or replace function verschluesselung_datei_hochladbar(p_bucket text, p_pfad text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  f record;
  v verschluesselung;
  basis text := verschluesselung_pfad_basis(p_pfad);
  verwendet boolean;
begin
  if not ist_systemadmin() then return false; end if;
  select * into v from verschluesselung where id = 1;
  if v.id is null or v.abgeschaltet_am is not null then return false; end if;
  if v.abschaltung_seit is not null then
    if p_pfad like '%.enc' then return false; end if;
    for f in select * from verschluesselung_felder() x where x.bucket = p_bucket loop
      execute format('select exists (select 1 from %1$I where %2$I like ''%%.enc'' and verschluesselung_pfad_basis(%2$I) = $1)', f.tabelle, f.spalte)
        into verwendet using p_pfad;
      if verwendet then return true; end if;
    end loop;
    return false;
  end if;
  if p_pfad not like '%.enc' or basis = p_pfad or not (not v.aktiv or (v.tausch_seit is not null and v.tausch_von = auth.uid())) then
    return false;
  end if;
  for f in select * from verschluesselung_felder() x where x.bucket = p_bucket loop
    execute format('select exists (select 1 from %1$I where %2$I = $1 or verschluesselung_pfad_basis(%2$I) = $1)', f.tabelle, f.spalte)
      into verwendet using basis;
    if verwendet then return true; end if;
  end loop;
  return false;
end $$;
