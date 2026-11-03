-- Verschlüsselung (docs/KONZEPT-VERSCHLUESSELUNG.md, Schritt 1): Kunden, Objekte, Unterzeichner, Ansprechpartner,
-- Dateinamen der Sachkundenachweise und alle Bilder und PDFs der privaten Buckets verschlüsselt der Browser mit dem
-- Firmenschlüssel der Instanz (AES-GCM 256). Der Server sieht den Schlüssel nie.
--
-- - Tabelle verschluesselung (eine Zeile): instanz_id, schluessel_id, pruefwert, aktiv, laufender Schlüsseltausch.
--   Lesen alle aktiven Benutzer, schreiben nur Admins über die Funktionen dieser Migration.
-- - verschluesselung_felder(): die Feldliste als Code (Werte „enc1.<schlüssel-id>.<iv>.<geheimtext>“, Dateipfade auf
--   „.k<erste 8 Zeichen der Schlüssel-ID>.enc“). src/lib/verschluesselung/felder.ts muss dazu passen (Test felder.test.ts).
-- - Schutz vor Klartext und veraltetem Schlüssel: Trigger statt fester Checks. Klartext lehnen sie ab
--   verschluesselung.aktiv ab – jede Instanz wird zu einem anderen Zeitpunkt umgestellt –, Geheimtext und Pfade mit der
--   Kennung eines anderen Schlüssels, sobald eingerichtet ist (während eines Tauschs: alter oder – nur für den tauschenden
--   Admin – neuer). Geprüft werden nur neue bzw. geänderte Werte; verschluesselung_aktivieren lässt sich erst aufrufen, wenn
--   alles mit dem aktuellen Schlüssel verschlüsselt ist. Ebenso eine Storage-Policy für fotos, unterschriften, protokolle
--   und nachweise.
-- - Umstellung und Schlüsseltausch: umschluesseln(p_aenderungen) setzt Werte und Dateipfade (nur Admin; nur Klartext → enc1
--   während der Umstellung, enc1 → enc1 mit anderem Schlüssel während eines Tauschs, auch zurück beim Abbruch) und geht
--   dabei gezielt an den Sperren abgeschlossener Prüfungen, Sessions und Protokolle vorbei. Alte Dateien darf ein Admin nur
--   in dieser Zeit löschen und nur, wenn kein Datensatz mehr auf sie verweist.
-- - Verwaiste Dateien (ohne Datensatz, noch nicht mit dem Zielschlüssel verschlüsselt) zählt verschluesselung_stand,
--   verschluesselung_verwaiste listet sie; Aktivieren und Abschluss eines Tauschs gehen erst ohne sie. Löschbar sind sie
--   erst nach 24 Stunden (ihr Datensatz kann noch in der Outbox eines Geräts warten), außer die Datei liegt umgeschlüsselt
--   unter neuem Pfad vor.
-- - Logs: verschlüsselte Werte erscheinen als „(verschlüsselt)“; beim Aktivieren werden Klartexte dieser Felder aus
--   audit_log und den Logdateien entfernt, beim Abschluss eines Tauschs alle alten Geheimtexte aus audit_log.
-- - anlage_suche: neuer Parameter p_objekte (Listen von Objekt-IDs, im Browser über die entschlüsselten Namen ermittelt –
--   die Wörter dazu gehen nicht an den Server).

-- ---------------------------------------------------------------------------
-- 1. Geheimtext erkennen, Feldliste
-- ---------------------------------------------------------------------------
-- enc1.<Schlüssel-ID: 16 Zeichen hex>.<IV: 12 Byte = 16 Zeichen base64url>.<Geheimtext samt 16 Byte Prüfwert: mindestens 22 Zeichen>
create function ist_geheimtext(p_wert text) returns boolean
language sql immutable set search_path = public as $$
  select p_wert ~ '^enc1\.[0-9a-f]{16}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$';
$$;
comment on function ist_geheimtext(text) is 'Wert im Format enc1.<schlüssel-id>.<iv>.<geheimtext> (base64url), siehe docs/KONZEPT-VERSCHLUESSELUNG.md';

-- Schlüssel-ID eines Geheimtexts (null bei Klartext)
create function geheimtext_schluessel(p_wert text) returns text
language sql immutable set search_path = public as $$
  select case when ist_geheimtext(p_wert) then split_part(p_wert, '.', 2) end;
$$;

-- Feldliste: art „wert“ = Spalte (bzw. Eigenschaft „eigenschaften.<name>“) mit Geheimtext, art „pfad“ = Dateipfad im
-- Bucket, die Datei ist verschlüsselt und der Pfad endet auf „.enc“
create function verschluesselung_felder() returns table (tabelle text, spalte text, art text, bucket text)
language sql immutable set search_path = public as $$
  values
    ('endkunde', 'name', 'wert', null::text),
    ('endkunde', 'strasse', 'wert', null),
    ('endkunde', 'plz', 'wert', null),
    ('endkunde', 'ort', 'wert', null),
    ('endkunde', 'ansprechpartner', 'wert', null),
    ('endkunde', 'email', 'wert', null),
    ('endkunde', 'telefon', 'wert', null),
    ('endkunde', 'notiz', 'wert', null),
    ('objekt', 'name', 'wert', null),
    ('objekt', 'strasse', 'wert', null),
    ('objekt', 'plz', 'wert', null),
    ('objekt', 'ort', 'wert', null),
    ('objekt', 'zugangshinweise', 'wert', null),
    ('anlagenpruefung', 'kunde_name', 'wert', null),
    ('session', 'kunde_name', 'wert', null),
    ('anlage', 'eigenschaften.ansprechpartner', 'wert', null),
    ('benutzer_sachkunde', 'datei_name', 'wert', null),
    ('foto', 'storage_pfad', 'pfad', 'fotos'),
    ('protokoll', 'storage_pfad', 'pfad', 'protokolle'),
    ('benutzer_sachkunde', 'datei_pfad', 'pfad', 'nachweise'),
    ('anlagenpruefung', 'unterschrift', 'pfad', 'unterschriften'),
    ('anlagenpruefung', 'kunde_unterschrift', 'pfad', 'unterschriften'),
    ('anlagenpruefung_mitpruefer', 'unterschrift', 'pfad', 'unterschriften'),
    ('session', 'unterschrift_leiter', 'pfad', 'unterschriften'),
    ('session', 'unterschrift_kunde', 'pfad', 'unterschriften'),
    ('session_teilnehmer', 'unterschrift', 'pfad', 'unterschriften');
$$;

-- Schlüsselspalten je Tabelle (Teil der Zusatzdaten im Browser und Auswahl in umschluesseln)
create function verschluesselung_schluesselspalten(p_tabelle text) returns text[]
language sql immutable set search_path = public as $$
  select case p_tabelle
    when 'benutzer_sachkunde' then array['benutzer_id', 'anlagenart']
    when 'anlagenpruefung_mitpruefer' then array['anlagenpruefung_id', 'benutzer_id']
    when 'session_teilnehmer' then array['session_id', 'benutzer_id']
    when 'endkunde' then array['id'] when 'objekt' then array['id'] when 'anlagenpruefung' then array['id']
    when 'session' then array['id'] when 'anlage' then array['id'] when 'foto' then array['id'] when 'protokoll' then array['id']
  end;
$$;

-- Pfad ohne „.enc“ und ohne Kennung des Schlüssels („.k<8 hex>.enc“)
create function verschluesselung_pfad_basis(p_pfad text) returns text
language sql immutable set search_path = public as $$
  select regexp_replace(p_pfad, '(\.k[0-9a-f]{8})?\.enc$', '');
$$;

-- Kennung des Schlüssels im Pfad einer verschlüsselten Datei (erste 8 Zeichen der Schlüssel-ID), sonst null
create function verschluesselung_pfad_kennung(p_pfad text) returns text
language sql immutable set search_path = public as $$
  select substring(p_pfad from '\.k([0-9a-f]{8})\.enc$');
$$;

-- Wie lange eine Datei ohne Datensatz mindestens liegen bleibt, bevor sie als verwaist gelöscht werden darf: Ein Gerät lädt
-- erst die Datei, dann den Datensatz hoch – reißt dazwischen die Verbindung ab, wartet der Datensatz in seiner Outbox.
create function verschluesselung_mindestalter() returns interval
language sql immutable set search_path = public as $$
  select interval '24 hours';
$$;

-- ---------------------------------------------------------------------------
-- 2. Tabelle verschluesselung
-- ---------------------------------------------------------------------------
create table verschluesselung (
  id integer primary key default 1 check (id = 1),
  aktiv boolean not null default false,
  instanz_id uuid not null,
  schluessel_id text not null check (schluessel_id ~ '^[0-9a-f]{16}$'),
  pruefwert text not null check (ist_geheimtext(pruefwert)),
  eingerichtet_am timestamptz not null default now(),
  eingerichtet_von uuid references benutzer (id) on delete set null,
  aktiv_seit timestamptz,
  tausch_seit timestamptz,
  tausch_von uuid references benutzer (id) on delete set null,
  tausch_schluessel_id text check (tausch_schluessel_id ~ '^[0-9a-f]{16}$'),
  tausch_pruefwert text check (ist_geheimtext(tausch_pruefwert)),
  check ((tausch_seit is null) = (tausch_schluessel_id is null) and (tausch_seit is null) = (tausch_pruefwert is null)),
  check (tausch_seit is null or aktiv)
);
comment on table verschluesselung is 'Firmenschlüssel der Instanz (nur Kennung und Prüfwert, nie der Schlüssel), docs/KONZEPT-VERSCHLUESSELUNG.md';
comment on column verschluesselung.aktiv is 'Bestand umgeschlüsselt; ab jetzt lehnen Trigger und Storage-Policy Klartext ab';
comment on column verschluesselung.instanz_id is 'Zufällig im Browser erzeugt, Teil der Zusatzdaten (AAD) jedes Werts und jeder Datei';
comment on column verschluesselung.schluessel_id is 'Erste 8 Byte von SHA-256 des Schlüssels (hex) – zum Wiedererkennen';
comment on column verschluesselung.pruefwert is 'Fester Text, mit dem Schlüssel verschlüsselt – prüft einen gescannten Schlüssel';
comment on column verschluesselung.tausch_seit is 'Beginn eines laufenden Schlüsseltauschs (andere Geräte sperren)';
comment on column verschluesselung.tausch_schluessel_id is 'Kennung des neuen Schlüssels während eines Tauschs';

alter table verschluesselung enable row level security;
create policy verschluesselung_lesen on verschluesselung for select to authenticated using (ist_aktiv());
create policy zwei_faktor on verschluesselung as restrictive for all to authenticated
  using ((select zwei_faktor_erfuellt())) with check ((select zwei_faktor_erfuellt()));
grant select on verschluesselung to authenticated;
create trigger verschluesselung_audit after insert or update or delete on verschluesselung for each row execute function audit();
select log_ueberwachen('verschluesselung');

create function verschluesselung_aktiv() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select aktiv from verschluesselung where id = 1), false);
$$;
revoke all on function verschluesselung_aktiv() from public, anon;
grant execute on function verschluesselung_aktiv() to authenticated;

-- Für die Prüfung der Instanz im Browser (Bedingung 3): unterscheidet „keine Verschlüsselung eingerichtet“ von „darf nicht
-- lesen“ (abgemeldet, deaktiviert, Zwei-Faktor offen) – im zweiten Fall ist keine Aussage möglich.
create function verschluesselung_kennung() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not ist_aktiv() then jsonb_build_object('berechtigt', false)
    else jsonb_build_object('berechtigt', true, 'eingerichtet', v.id is not null, 'aktiv', coalesce(v.aktiv, false),
           'instanz_id', v.instanz_id, 'schluessel_id', v.schluessel_id, 'pruefwert', v.pruefwert,
           'tausch_seit', v.tausch_seit, 'tausch_von', v.tausch_von,
           'tausch_schluessel_id', v.tausch_schluessel_id, 'tausch_pruefwert', v.tausch_pruefwert) end
    from (select 1) eins left join verschluesselung v on v.id = 1;
$$;
revoke all on function verschluesselung_kennung() from public, anon;
grant execute on function verschluesselung_kennung() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Schutz vor Klartext (Trigger, greift ab verschluesselung.aktiv)
-- ---------------------------------------------------------------------------
-- Schlüssel-IDs, mit denen geschrieben werden darf: der aktuelle; während eines Tauschs zusätzlich der neue, aber nur für
-- den tauschenden Admin und aus umschluesseln heraus (andere Geräte haben ihn nicht – was dort mit dem alten ankommt,
-- schlüsselt der Tausch um, und der Abschluss geht erst, wenn nichts mehr mit dem alten verschlüsselt ist).
create function verschluesselung_schreibschluessel(p_schluessel_id text, p_tausch_schluessel_id text, p_tausch_von uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select array[p_schluessel_id] || case when p_tausch_schluessel_id is not null
      and (p_tausch_von = auth.uid() or coalesce(current_setting('verschluesselung.umschluesseln', true), '') = 'ja')
    then array[p_tausch_schluessel_id] else '{}'::text[] end;
$$;
revoke execute on function verschluesselung_schreibschluessel(text, text, uuid) from public, anon, authenticated;

-- Prüft nur neue und geänderte Werte: unveränderte Zeilen aus der Zeit vor der Umstellung bleiben änderbar, und bei
-- aktiver Verschlüsselung ist der Bestand ohnehin geprüft (verschluesselung_aktivieren). Leere Werte ('' und null) sind
-- erlaubt. Läuft als letzter BEFORE-Trigger (zzz), damit er sieht, was die anderen Trigger gesetzt haben.
--   Klartext (Wert ohne enc1, Pfad ohne „.enc“): nur, solange die Verschlüsselung nicht aktiv ist.
--   Geheimtext bzw. Pfad mit Schlüsselkennung: nur mit einem der Schreibschlüssel – sonst hat das Gerät einen veralteten
--   Schlüssel (Tausch abgeschlossen) und muss das neue Blatt scannen (Hinweis „schluessel_veraltet“ für die Outbox).
create function verschluesselung_klartext_pruefen() returns trigger
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
      -- Ohne Filter sperren, erst dann aktiv prüfen: verschluesselung_aktivieren und der Abschluss eines Tauschs (beide
      -- for update) warten, bis dieser Schreibvorgang fertig ist, und sehen ihn beim Prüfen des Bestands – oder dieser hier
      -- wartet auf sie und sieht danach den neuen Stand.
      select * into v from verschluesselung where id = 1 for share;
      gelesen := true;
      if v.id is null then return new; end if;
      erlaubt := verschluesselung_schreibschluessel(v.schluessel_id, v.tausch_schluessel_id, v.tausch_von);
    end if;
    kennung := case f.art when 'wert' then geheimtext_schluessel(w) else verschluesselung_pfad_kennung(w) end;
    if kennung is null then
      if v.aktiv or (f.art = 'pfad' and w like '%.enc') then
        raise exception 'Unverschlüsselter Wert in %.% – die Verschlüsselung ist aktiv. Bitte die App aktualisieren.', tg_table_name, f.spalte
          using errcode = 'check_violation';
      end if;
    elsif not exists (select 1 from unnest(erlaubt) e where (case f.art when 'wert' then e else left(e, 8) end) = kennung) then
      raise exception 'Wert in %.% ist mit einem veralteten Schlüssel verschlüsselt. Bitte das aktuelle Schlüsselblatt scannen.', tg_table_name, f.spalte
        using errcode = 'check_violation', hint = 'schluessel_veraltet';
    end if;
  end loop;
  return new;
end $$;
revoke execute on function verschluesselung_klartext_pruefen() from public, anon, authenticated;

create trigger zzz_verschluesselung before insert or update on endkunde for each row execute function verschluesselung_klartext_pruefen();
create trigger zzz_verschluesselung before insert or update on objekt for each row execute function verschluesselung_klartext_pruefen();
create trigger zzz_verschluesselung before insert or update on anlagenpruefung for each row execute function verschluesselung_klartext_pruefen();
create trigger zzz_verschluesselung before insert or update on session for each row execute function verschluesselung_klartext_pruefen();
create trigger zzz_verschluesselung before insert or update on anlage for each row execute function verschluesselung_klartext_pruefen();
create trigger zzz_verschluesselung before insert or update on benutzer_sachkunde for each row execute function verschluesselung_klartext_pruefen();
create trigger zzz_verschluesselung before insert or update on foto for each row execute function verschluesselung_klartext_pruefen();
create trigger zzz_verschluesselung before insert or update on protokoll for each row execute function verschluesselung_klartext_pruefen();
create trigger zzz_verschluesselung before insert or update on anlagenpruefung_mitpruefer for each row execute function verschluesselung_klartext_pruefen();
create trigger zzz_verschluesselung before insert or update on session_teilnehmer for each row execute function verschluesselung_klartext_pruefen();

-- ---------------------------------------------------------------------------
-- 4. Stand des Bestands, Einrichten, Aktivieren
-- ---------------------------------------------------------------------------
-- Werte und Pfade der Feldliste mit bzw. ohne diese Schlüssel-ID (Klartext zählt zu „ohne“). Für Aktivieren, Abschluss und
-- Abbruch eines Tauschs: Die Kennung steht in jedem Wert und Pfad, so sieht der Server, was noch umzuschlüsseln ist.
create function verschluesselung_anzahl(p_schluessel_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  f record;
  ausdruck text;
  m bigint;
  o bigint;
  mit bigint := 0;
  ohne bigint := 0;
begin
  for f in select * from verschluesselung_felder() loop
    ausdruck := case when f.spalte like '%.%' then format('(%I #>> %L)', split_part(f.spalte, '.', 1), '{' || split_part(f.spalte, '.', 2) || '}')
                     else format('%I', f.spalte) end;
    execute format('select count(*) filter (where %2$s(%1$s) = $1), count(*) filter (where coalesce(%1$s, '''') <> '''' and %2$s(%1$s) is distinct from $1) from %3$I',
                   ausdruck, case f.art when 'wert' then 'geheimtext_schluessel' else 'verschluesselung_pfad_kennung' end, f.tabelle)
      into m, o using case f.art when 'wert' then p_schluessel_id else left(p_schluessel_id, 8) end;
    mit := mit + m;
    ohne := ohne + o;
  end loop;
  return jsonb_build_object('mit', mit, 'ohne', ohne);
end $$;
revoke execute on function verschluesselung_anzahl(text) from public, anon, authenticated;

-- Alle Pfade, auf die ein Datensatz verweist (je Bucket)
create function verschluesselung_verweise() returns table (bucket text, pfad text)
language plpgsql stable security definer set search_path = public as $$
declare
  f record;
begin
  for f in select * from verschluesselung_felder() x where x.art = 'pfad' loop
    return query execute format('select %L::text, %I::text from %I where %I is not null', f.bucket, f.spalte, f.tabelle, f.spalte);
  end loop;
end $$;
revoke execute on function verschluesselung_verweise() from public, anon, authenticated;

-- Verwaiste Dateien: in den vier Buckets, ohne Datensatz, der auf sie verweist, und nicht mit dem Zielschlüssel
-- verschlüsselt (Klartext oder Kennung eines anderen Schlüssels). Löschbar, sobald älter als verschluesselung_mindestalter()
-- – oder wenn ein Datensatz auf dieselbe Datei unter anderem Pfad verweist (umgeschlüsselt, die alte blieb liegen).
create function verschluesselung_verwaiste_intern(p_ziel text) returns table (bucket text, name text, erstellt_am timestamptz, loeschbar boolean)
language sql stable security definer set search_path = public as $$
  with ref as materialized (select * from verschluesselung_verweise())
  select o.bucket_id, o.name, o.created_at,
         o.created_at < now() - verschluesselung_mindestalter()
           or exists (select 1 from ref r where r.bucket = o.bucket_id and verschluesselung_pfad_basis(r.pfad) = verschluesselung_pfad_basis(o.name))
    from storage.objects o
   where o.bucket_id in ('fotos', 'unterschriften', 'protokolle', 'nachweise')
     and verschluesselung_pfad_kennung(o.name) is distinct from left(p_ziel, 8)
     and not exists (select 1 from ref r where r.bucket = o.bucket_id and r.pfad = o.name)
   order by o.bucket_id, o.name;
$$;
revoke execute on function verschluesselung_verwaiste_intern(text) from public, anon, authenticated;

-- Für das Umschlüsseln im Browser (nur Admin): p_ziel ist der aktuelle Schlüssel (Umstellung), während eines Tauschs der
-- neue (bzw. beim Abbruch der bisherige). Höchstens 1000 je Aufruf.
create function verschluesselung_verwaiste(p_ziel text) returns table (bucket text, name text, erstellt_am timestamptz, loeschbar boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v verschluesselung;
begin
  if not ist_systemadmin() then
    raise exception 'Nur Administratoren können die Verschlüsselung verwalten' using errcode = 'insufficient_privilege';
  end if;
  select * into v from verschluesselung where id = 1;
  if v.id is null then return; end if;
  if p_ziel is distinct from v.schluessel_id and p_ziel is distinct from v.tausch_schluessel_id then
    raise exception 'Unbekannter Zielschlüssel';
  end if;
  return query select * from verschluesselung_verwaiste_intern(p_ziel) limit 1000;
end $$;
revoke all on function verschluesselung_verwaiste(text) from public, anon;
grant execute on function verschluesselung_verwaiste(text) to authenticated;

-- Je Feld: Anzahl Klartext und Geheimtext (bei Pfaden: ohne bzw. mit „.enc“). Für Fortschritt und Abschluss der Umstellung.
-- Dazu verwaiste Dateien, offene Werte und Dateien eines Tauschs und ob die Instanz leer ist (keine verschlüsselbaren Daten).
create function verschluesselung_stand() returns jsonb
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
  ziel := coalesce(v.tausch_schluessel_id, v.schluessel_id);
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
  if ziel is not null then
    select count(*), count(*) filter (where w.loeschbar) into verwaist, verwaist_loeschbar from verschluesselung_verwaiste_intern(ziel) w;
  end if;
  -- Während eines Tauschs: Werte und Pfade noch ohne bzw. schon mit dem neuen Schlüssel
  return jsonb_build_object('felder', felder, 'klartext', summe_klar, 'verschluesselt', summe_geheim,
    'verwaist', verwaist, 'verwaist_loeschbar', verwaist_loeschbar,
    'leer', summe_klar + summe_geheim = 0
            and not exists (select 1 from storage.objects o where o.bucket_id in ('fotos', 'unterschriften', 'protokolle', 'nachweise')),
    'tausch_offen', case when v.tausch_seit is not null then (verschluesselung_anzahl(v.tausch_schluessel_id) ->> 'ohne')::bigint end,
    'tausch_neu', case when v.tausch_seit is not null then (verschluesselung_anzahl(v.tausch_schluessel_id) ->> 'mit')::bigint end);
end $$;
revoke all on function verschluesselung_stand() from public, anon;
grant execute on function verschluesselung_stand() to authenticated;

-- Schlüssel einrichten: nur Admin, nur solange die Verschlüsselung nicht aktiv ist. Ein erneutes Einrichten (z. B. Blatt
-- vor dem Umstellen verloren) geht nur, solange noch nichts verschlüsselt ist – sonst wären diese Daten verloren.
create function verschluesselung_einrichten(p_instanz_id uuid, p_schluessel_id text, p_pruefwert text) returns void
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
  if v.id is not null and (v.instanz_id, v.schluessel_id) is distinct from (p_instanz_id, p_schluessel_id)
     and (verschluesselung_stand() ->> 'verschluesselt')::bigint > 0 then
    raise exception 'Die Umstellung läuft schon mit dem bisherigen Schlüssel. Bitte dessen Schlüsselblatt scannen.';
  end if;
  insert into verschluesselung (id, aktiv, instanz_id, schluessel_id, pruefwert, eingerichtet_am, eingerichtet_von)
  values (1, false, p_instanz_id, p_schluessel_id, p_pruefwert, now(), auth.uid())
  on conflict (id) do update set instanz_id = excluded.instanz_id, schluessel_id = excluded.schluessel_id,
    pruefwert = excluded.pruefwert, eingerichtet_am = excluded.eingerichtet_am, eingerichtet_von = excluded.eingerichtet_von;
end $$;
revoke all on function verschluesselung_einrichten(uuid, text, text) from public, anon;
grant execute on function verschluesselung_einrichten(uuid, text, text) to authenticated;

-- Klartexte der verschlüsselten Felder aus audit_log und den Logdateien entfernen (beim Aktivieren), bzw. alle alten
-- Werte dieser Felder aus audit_log (p_alle, beim Abschluss eines Schlüsseltauschs: der alte Schlüssel gilt als bekannt).
-- Logzeilen werden über die ersten 40 Zeichen jedes Klartexts gefunden. Kürzere Werte als 4 Zeichen (z. B. „Ulm“) nur, wo
-- sie als ganzer Wert zitiert stehen („Ulm“, so schreibt log_zitat Werte ins Log) – als Teil eines Worts träfen sie fast
-- jede Zeile. Grenze: ein kurzer Wert mitten im Freitext einer Logzeile bleibt.
create function verschluesselung_logs_bereinigen(p_alle boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  f record;
  pfad text[];
  muster text[];
begin
  if not p_alle then
    select array_agg(distinct case when length(w) >= 4 then '%' || e || '%' else '%„' || e || '“%' end)
      into muster
      from (
        select w, replace(replace(replace(left(regexp_replace(w, '[[:cntrl:]]+', ' ', 'g'), 40), '\', '\\'), '%', '\%'), '_', '\_') as e
          from (
            select x #>> string_to_array(v.spalte, '.') as w
              from verschluesselung_felder() v
              join audit_log a on a.tabelle = v.tabelle
              cross join lateral (values (a.alt), (a.neu)) as z (x)
             where v.art = 'wert'
          ) roh
         where length(trim(w)) >= 1 and not coalesce(ist_geheimtext(w), false)
      ) werte;
    if muster is not null then
      delete from log_zeile where zeile like any (muster);
    end if;
  end if;
  for f in select * from verschluesselung_felder() v where v.art = 'wert' loop
    pfad := string_to_array(f.spalte, '.');
    update audit_log a
       set alt = case when a.alt #>> pfad is not null and (p_alle or not coalesce(ist_geheimtext(a.alt #>> pfad), false)) then a.alt #- pfad else a.alt end,
           neu = case when a.neu #>> pfad is not null and (p_alle or not coalesce(ist_geheimtext(a.neu #>> pfad), false)) then a.neu #- pfad else a.neu end
     where a.tabelle = f.tabelle
       and ((a.alt #>> pfad is not null and (p_alle or not coalesce(ist_geheimtext(a.alt #>> pfad), false)))
         or (a.neu #>> pfad is not null and (p_alle or not coalesce(ist_geheimtext(a.neu #>> pfad), false))));
  end loop;
end $$;
revoke execute on function verschluesselung_logs_bereinigen(boolean) from public, anon, authenticated;

-- Umstellung abschließen: nur, wenn alles mit dem aktuellen Schlüssel verschlüsselt ist und keine verwaisten Dateien
-- (Klartext ohne Datensatz) mehr im Speicher liegen. Danach lehnen Trigger und Storage-Policy Klartext ab.
create function verschluesselung_aktivieren() returns void
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
  if v.id is null then raise exception 'Die Verschlüsselung ist noch nicht eingerichtet'; end if;
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
revoke all on function verschluesselung_aktivieren() from public, anon;
grant execute on function verschluesselung_aktivieren() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Schlüsseltausch
-- ---------------------------------------------------------------------------
-- Beginnen, fortsetzen bzw. von einem anderen Admin mit demselben neuen Schlüssel übernehmen (falls das erste Gerät
-- ausfällt). Läuft der Tausch schon, zählt nur die Schlüssel-ID; der Prüfwert bleibt der zuerst gemeldete (jeder neu
-- erzeugte hat einen anderen IV).
create function verschluesselung_tausch_beginnen(p_schluessel_id text, p_pruefwert text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v verschluesselung;
begin
  if not ist_systemadmin() then
    raise exception 'Nur Administratoren können den Schlüssel tauschen' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_schluessel_id, '') !~ '^[0-9a-f]{16}$' or geheimtext_schluessel(p_pruefwert) is distinct from p_schluessel_id then
    raise exception 'Ungültige Angaben zum Schlüssel';
  end if;
  select * into v from verschluesselung where id = 1 for update;
  if not coalesce(v.aktiv, false) then raise exception 'Die Verschlüsselung ist noch nicht aktiv'; end if;
  if p_schluessel_id = v.schluessel_id then raise exception 'Der neue Schlüssel ist der bisherige'; end if;
  if left(p_schluessel_id, 8) = left(v.schluessel_id, 8) then
    raise exception 'Der neue Schlüssel hat im Dateipfad dieselbe Kennung wie der bisherige. Bitte den Tausch neu vorbereiten.';
  end if;
  if v.tausch_seit is not null and v.tausch_schluessel_id is distinct from p_schluessel_id then
    raise exception 'Es läuft schon ein Schlüsseltausch mit einem anderen neuen Schlüssel. Zum Fortsetzen dessen Schlüsselblatt scannen.';
  end if;
  update verschluesselung
     set tausch_seit = coalesce(v.tausch_seit, now()), tausch_von = auth.uid(),
         tausch_schluessel_id = p_schluessel_id, tausch_pruefwert = coalesce(v.tausch_pruefwert, p_pruefwert)
   where id = 1;
end $$;
revoke all on function verschluesselung_tausch_beginnen(text, text) from public, anon;
grant execute on function verschluesselung_tausch_beginnen(text, text) to authenticated;

-- Abschließen: erst, wenn jeder Wert und jeder Pfad die Kennung des neuen Schlüssels trägt und keine verwaisten Dateien mit
-- dem alten mehr im Speicher liegen. (Ob ein Wert mit dieser Kennung wirklich mit dem neuen Schlüssel lesbar ist, prüft der
-- Browser beim Umschlüsseln – der Server kennt keinen Schlüssel.) Die Sperre (for update) wartet auf laufende
-- Schreibvorgänge anderer Geräte (Trigger und Storage-Policy sperren mit for share) und sieht sie danach.
create function verschluesselung_tausch_abschliessen() returns void
language plpgsql security definer set search_path = public as $$
declare
  v verschluesselung;
  offen bigint;
  verwaist bigint;
begin
  if not ist_systemadmin() then
    raise exception 'Nur Administratoren können den Schlüssel tauschen' using errcode = 'insufficient_privilege';
  end if;
  select * into v from verschluesselung where id = 1 for update;
  if v.tausch_seit is null then raise exception 'Es läuft kein Schlüsseltausch'; end if;
  if v.tausch_von is distinct from auth.uid() then
    raise exception 'Den Schlüsseltausch hat ein anderer Admin begonnen. Zum Übernehmen das neue Schlüsselblatt scannen.';
  end if;
  offen := (verschluesselung_anzahl(v.tausch_schluessel_id) ->> 'ohne')::bigint;
  if offen > 0 then
    raise exception 'Noch % Werte bzw. Dateien mit dem bisherigen Schlüssel – bitte das Umschlüsseln fortsetzen', offen;
  end if;
  select count(*) into verwaist from verschluesselung_verwaiste_intern(v.tausch_schluessel_id);
  if verwaist > 0 then
    raise exception 'Noch % Dateien ohne Datensatz mit dem bisherigen Schlüssel im Speicher – bitte das Umschlüsseln fortsetzen (jüngere als 24 Stunden erst danach)', verwaist;
  end if;
  update verschluesselung
     set schluessel_id = v.tausch_schluessel_id, pruefwert = v.tausch_pruefwert,
         tausch_seit = null, tausch_von = null, tausch_schluessel_id = null, tausch_pruefwert = null
   where id = 1;
  perform verschluesselung_logs_bereinigen(true);
end $$;
revoke all on function verschluesselung_tausch_abschliessen() from public, anon;
grant execute on function verschluesselung_tausch_abschliessen() to authenticated;

-- Abbrechen: nur der tauschende Admin, und erst, wenn nichts mehr mit dem neuen Schlüssel verschlüsselt ist (der Browser
-- schlüsselt vorher zurück, umschluesseln nimmt während des Tauschs beide Richtungen an) und keine Datei mit seiner Kennung
-- mehr im Speicher liegt. Danach gilt der bisherige Schlüssel weiter, die anderen Geräte sind wieder frei.
create function verschluesselung_tausch_abbrechen() returns void
language plpgsql security definer set search_path = public as $$
declare
  v verschluesselung;
  neu bigint;
  dateien bigint;
begin
  if not ist_systemadmin() then
    raise exception 'Nur Administratoren können den Schlüssel tauschen' using errcode = 'insufficient_privilege';
  end if;
  select * into v from verschluesselung where id = 1 for update;
  if v.tausch_seit is null then raise exception 'Es läuft kein Schlüsseltausch'; end if;
  if v.tausch_von is distinct from auth.uid() then
    raise exception 'Den Schlüsseltausch hat ein anderer Admin begonnen. Zum Übernehmen das neue Schlüsselblatt scannen.';
  end if;
  neu := (verschluesselung_anzahl(v.tausch_schluessel_id) ->> 'mit')::bigint;
  select count(*) into dateien from storage.objects o
   where o.bucket_id in ('fotos', 'unterschriften', 'protokolle', 'nachweise') and verschluesselung_pfad_kennung(o.name) = left(v.tausch_schluessel_id, 8);
  if neu + dateien > 0 then
    raise exception 'Noch % Werte bzw. Dateien mit dem neuen Schlüssel – bitte zuerst zurückschlüsseln', neu + dateien;
  end if;
  update verschluesselung set tausch_seit = null, tausch_von = null, tausch_schluessel_id = null, tausch_pruefwert = null where id = 1;
end $$;
revoke all on function verschluesselung_tausch_abbrechen() from public, anon;
grant execute on function verschluesselung_tausch_abbrechen() to authenticated;

-- Kennung einer leeren Instanz ersetzen (Wiederherstellung eines Backups in eine frisch eingerichtete Instanz): nur Admin,
-- nicht während eines Tauschs und nur, solange es keine verschlüsselbaren Werte und keine Dateien in den vier Buckets gibt
-- – dann geht nichts verloren. Danach ist die Verschlüsselung (wieder) nicht aktiv; das Zurückspielen aktiviert sie, wenn
-- das Backup aktiv war.
create function verschluesselung_ersetzen(p_instanz_id uuid, p_schluessel_id text, p_pruefwert text) returns void
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
  s := verschluesselung_stand();
  if not (s ->> 'leer')::boolean then
    raise exception 'Die Kennung lässt sich nur in einer leeren Instanz ersetzen (ohne Kunden, Objekte, Fotos, Unterschriften, Protokolle und Nachweise)';
  end if;
  update verschluesselung
     set instanz_id = p_instanz_id, schluessel_id = p_schluessel_id, pruefwert = p_pruefwert, aktiv = false, aktiv_seit = null,
         eingerichtet_am = now(), eingerichtet_von = auth.uid()
   where id = 1;
end $$;
revoke all on function verschluesselung_ersetzen(uuid, text, text) from public, anon;
grant execute on function verschluesselung_ersetzen(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Umschlüsseln (Umstellung und Tausch)
-- ---------------------------------------------------------------------------
-- p_aenderungen: [{ "tabelle", "spalte", "schluessel": { <Schlüsselspalten> }, "alt", "neu", "fehlt"? }]
--   Wert:  Umstellung Klartext → enc1 mit dem aktuellen Schlüssel, Tausch enc1 → enc1 mit dem anderen der beiden Schlüssel
--          (neu, beim Abbruch zurück zum bisherigen).
--   Pfad:  Umstellung „x“ → „x.k<aktueller Schlüssel>.enc“, Tausch „x.k….enc“ → „x.k<anderer der beiden>.enc“; die neue
--          Datei muss im Bucket liegen.
--          „fehlt“: Die alte Datei fehlt im Bucket (schon vorher verloren) – dann wird nur der Pfad umgesetzt.
-- Geändert wird nur, wenn der Wert noch „alt“ ist (sonst hat ihn inzwischen jemand geändert: übersprungen, beim nächsten
-- Durchlauf neu). Ergebnis: Anzahl der geänderten Werte.
-- Die Änderung läuft mit session.revision (der Ausnahme für Wartung und Datensicherung, die die Sperren abgeschlossener
-- Prüfungen und Sessions kennen) und verschluesselung.umschluesseln (Protokolle). Beides gilt nur in dieser Funktion,
-- die nur die eine Spalte der Feldliste ändert.
create function umschluesseln(p_aenderungen jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v verschluesselung;
  tausch boolean;
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
  tausch := v.tausch_seit is not null;
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

    if f.art = 'wert' then
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
revoke all on function umschluesseln(jsonb) from public, anon;
grant execute on function umschluesseln(jsonb) to authenticated;

-- Protokolle bleiben unveränderlich – außer dem Speicherpfad beim Umschlüsseln (nur aus umschluesseln heraus)
create or replace function protokoll_unveraenderlich() returns trigger
language plpgsql as $$
begin
  -- Einzige Ausnahme: Wartung mit Service-Role (z. B. Testdaten aufräumen), nie aus der App
  if tg_op = 'DELETE' and auth.role() = 'service_role' then return old; end if;
  -- Umschlüsseln: nur der Pfad der Datei wechselt (Inhalt und sha256 der unverschlüsselten PDF bleiben)
  if tg_op = 'UPDATE' and coalesce(current_setting('verschluesselung.umschluesseln', true), '') = 'ja'
     and (to_jsonb(new) - 'storage_pfad') = (to_jsonb(old) - 'storage_pfad')
     and verschluesselung_pfad_basis(new.storage_pfad) = verschluesselung_pfad_basis(old.storage_pfad) then
    return new;
  end if;
  raise exception 'Gespeicherte Protokolle sind unveränderlich';
end $$;

-- ---------------------------------------------------------------------------
-- 7. Storage
-- ---------------------------------------------------------------------------
-- Verschlüsselte Dateien werden als application/octet-stream hochgeladen
update storage.buckets set allowed_mime_types = allowed_mime_types || array['application/octet-stream']
 where id in ('fotos', 'unterschriften', 'protokolle', 'nachweise')
   and allowed_mime_types is not null and not ('application/octet-stream' = any (allowed_mime_types));

-- Pfad einer neuen Datei in fotos, unterschriften, protokolle und nachweise (den Inhalt prüft der Browser beim Lesen,
-- Bedingung 2): mit eingerichteter Verschlüsselung nur mit der Kennung eines Schreibschlüssels („.k<…>.enc“), ohne
-- Kennung nur Klartext und nur, solange die Verschlüsselung nicht aktiv ist. Sperrt die Zeile wie der Trigger (for share),
-- damit Aktivieren und Abschluss eines Tauschs auf laufende Uploads warten.
create function verschluesselung_dateipfad_erlaubt(p_pfad text) returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  v verschluesselung;
  kennung text := verschluesselung_pfad_kennung(p_pfad);
begin
  select * into v from verschluesselung where id = 1 for share;
  if v.id is null then return true; end if;
  if kennung is null then return not v.aktiv and p_pfad not like '%.enc'; end if;
  return exists (select 1 from unnest(verschluesselung_schreibschluessel(v.schluessel_id, v.tausch_schluessel_id, v.tausch_von)) e where left(e, 8) = kennung);
end $$;
revoke all on function verschluesselung_dateipfad_erlaubt(text) from public, anon;
grant execute on function verschluesselung_dateipfad_erlaubt(text) to authenticated;

create policy verschluesselung_nur_enc on storage.objects as restrictive for insert to authenticated
  with check (bucket_id not in ('fotos', 'unterschriften', 'protokolle', 'nachweise') or verschluesselung_dateipfad_erlaubt(name));
create policy verschluesselung_nur_enc_aendern on storage.objects as restrictive for update to authenticated
  using (true)
  with check (bucket_id not in ('fotos', 'unterschriften', 'protokolle', 'nachweise') or verschluesselung_dateipfad_erlaubt(name));

-- Alte Dateien löschen: nur Admin, nur während Umstellung oder Tausch und nur, wenn kein Datensatz mehr auf sie verweist.
-- Verwaiste Dateien (auch unter anderem Pfad verweist nichts auf sie) erst nach verschluesselung_mindestalter().
create function verschluesselung_datei_loeschbar(p_bucket text, p_pfad text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  f record;
  verwendet boolean;
  gleich boolean;
  umgeschluesselt boolean := false;
begin
  if not ist_systemadmin() or not exists (
       select 1 from verschluesselung where id = 1 and (not aktiv or (tausch_seit is not null and tausch_von = auth.uid()))) then
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
revoke all on function verschluesselung_datei_loeschbar(text, text) from public, anon;
grant execute on function verschluesselung_datei_loeschbar(text, text) to authenticated;

create policy verschluesselung_loeschen on storage.objects for delete to authenticated
  using (bucket_id in ('fotos', 'unterschriften', 'protokolle', 'nachweise') and verschluesselung_datei_loeschbar(bucket_id, name));

-- Gelöschtes Foto: die Datei geht mit (src/offline/aktionen.ts, fotoLoeschen – über die Outbox nach dem Datensatz). Der
-- Prüfer darf nur eigene Dateien löschen und nur, wenn kein Foto mehr auf sie verweist (Fotos abgeschlossener Prüfungen
-- schützen die Trigger der Tabelle foto). Admins und Planer löschen ohnehin (dateien_admin).
create function foto_datei_loeschbar(p_pfad text) returns boolean
language sql stable security definer set search_path = public as $$
  select ist_aktiv() and not exists (select 1 from foto where storage_pfad = p_pfad);
$$;
revoke all on function foto_datei_loeschbar(text) from public, anon;
grant execute on function foto_datei_loeschbar(text) to authenticated;

create policy fotos_eigene_loeschen on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and owner_id = (select auth.uid())::text and foto_datei_loeschbar(name));

-- Verschlüsselte Datei zu einem vorhandenen Protokoll ablegen: nur Admin, nur während Umstellung oder Tausch, nur auf
-- „.enc“ und nur für einen Pfad, auf den (ohne „.enc“ bzw. Tauschkennung) schon ein Protokoll verweist.
-- protokoll_pfad_erlaubt lässt nur die aktuelle Revision einer abgeschlossenen Prüfung zu – alte Revisionen, wieder
-- geöffnete Prüfungen und Sessions mit späterer Revision blieben sonst unverschlüsselt. Fotos, Unterschriften und
-- Nachweise darf ein Admin ohnehin hochladen.
create function verschluesselung_datei_hochladbar(p_bucket text, p_pfad text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  f record;
  basis text := verschluesselung_pfad_basis(p_pfad);
  verwendet boolean;
begin
  if p_pfad not like '%.enc' or basis = p_pfad or not ist_systemadmin() or not exists (
       select 1 from verschluesselung where id = 1 and (not aktiv or (tausch_seit is not null and tausch_von = auth.uid()))) then
    return false;
  end if;
  for f in select * from verschluesselung_felder() x where x.bucket = p_bucket loop
    execute format('select exists (select 1 from %1$I where %2$I = $1 or verschluesselung_pfad_basis(%2$I) = $1)', f.tabelle, f.spalte)
      into verwendet using basis;
    if verwendet then return true; end if;
  end loop;
  return false;
end $$;
revoke all on function verschluesselung_datei_hochladbar(text, text) from public, anon;
grant execute on function verschluesselung_datei_hochladbar(text, text) to authenticated;

create policy verschluesselung_protokolle_hochladen on storage.objects for insert to authenticated
  with check (bucket_id = 'protokolle' and verschluesselung_datei_hochladbar(bucket_id, name));

-- ---------------------------------------------------------------------------
-- 8. Logs: Geheimtext nicht ausschreiben
-- ---------------------------------------------------------------------------
create or replace function log_zitat(p_text text, p_max integer default 120) returns text
language sql immutable as $$
  select case when coalesce(ist_geheimtext(p_text), false) then '(verschlüsselt)' else '„' || log_kurz(p_text, p_max) || '“' end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Anlagensuche mit Objekten aus dem Browser
-- ---------------------------------------------------------------------------
-- p_objekte: Liste, je Eintrag
--   ["<Objekt-ID>", …]                    – ein Wort, das der Browser in den entschlüsselten Namen und Adressen von Objekten
--                                           und Kunden gefunden hat; das Wort selbst kommt nicht mit (es wäre ein Kunden- oder
--                                           Objektname im Klartext). Die Anlage muss zu einem dieser Objekte gehören.
--   {"w": "<Wort>", "ids": ["<Objekt-ID>", …]} – ein kurzes Wort (unter 3 Zeichen, z. B. „eg“), das auch in p_text steht: es
--                                           zählt in den Anlagenfeldern oder über diese Objekte (verrät keinen Namen).
-- Die übrigen Wörter stehen in p_text (klein geschrieben, an Leerraum getrennt, wie im Browser). Jedes Wort muss weiter
-- irgendwo vorkommen. Geheimtexte zählen nicht zum Suchtext (zufällige Zeichen würden sonst kurze Wörter treffen). objekt,
-- objekt_ort und kunde sind dann Geheimtext, endkunde_id dient dem Entschlüsseln im Browser.
drop function anlage_suche(text, integer);
create function anlage_suche(p_text text, p_limit integer default 50, p_objekte jsonb default null)
returns table (
  id uuid, etikett_id text, kunden_bezeichnung text, gebaeude text, etage text, raum text, lage_beschreibung text,
  status anlage_status, naechste_pruefung_am date, anlagentyp text, objekt_id uuid, objekt text, objekt_ort text, kunde text,
  endkunde_id uuid
)
language sql stable set search_path = public as $$
  with woerter as (
    select w from unnest(regexp_split_to_array(lower(trim(coalesce(p_text, ''))), '\s+')) w where w <> ''
  ),
  listen as (
    select l.e from jsonb_array_elements(case when jsonb_typeof(p_objekte) = 'array' then p_objekte else '[]'::jsonb end) as l (e)
  ),
  kandidaten as (
    select t.*, ty.name as typ_name, o.name as o_name, o.ort as o_ort, k.id as k_id, k.name as k_name,
           lower(concat_ws(' ',
             t.etikett_id, t.kunden_bezeichnung, t.gebaeude, t.etage, t.raum, t.lage_beschreibung,
             t.hersteller, t.modell,
             (select string_agg(e.value, ' ') from jsonb_each_text(t.eigenschaften) e where not coalesce(ist_geheimtext(e.value), false)),
             ty.name,
             (select string_agg(x, ' ') from unnest(array[o.name, o.strasse, o.plz, o.ort, k.name, k.strasse, k.plz, k.ort, k.ansprechpartner]) x
               where not coalesce(ist_geheimtext(x), false)))) as suchtext
    from anlage t
    join anlagentyp ty on ty.id = t.anlagentyp_id
    join objekt o on o.id = t.objekt_id
    join endkunde k on k.id = o.endkunde_id
  )
  select c.id, c.etikett_id, c.kunden_bezeichnung, c.gebaeude, c.etage, c.raum, c.lage_beschreibung,
         c.status, c.naechste_pruefung_am, c.typ_name, c.objekt_id, c.o_name, c.o_ort, c.k_name, c.k_id
  from kandidaten c
  where (exists (select 1 from woerter) or exists (select 1 from listen))
    and not exists (select 1 from woerter
                     where position(w in c.suchtext) = 0
                       and not exists (select 1 from listen l where jsonb_typeof(l.e) = 'object' and l.e ->> 'w' = w
                                         and coalesce((l.e -> 'ids') @> to_jsonb(c.objekt_id::text), false)))
    and not exists (select 1 from listen l where jsonb_typeof(l.e) <> 'object' and not coalesce(jsonb_typeof(l.e) = 'array' and l.e @> to_jsonb(c.objekt_id::text), false))
  order by (lower(c.etikett_id) = lower(trim(p_text))) desc nulls last,
           (c.status = 'aktiv') desc, c.k_name, c.o_name, c.gebaeude, c.etage, c.kunden_bezeichnung
  limit least(greatest(p_limit, 1), 200);
$$;
revoke all on function anlage_suche(text, integer, jsonb) from public, anon, authenticated;
grant execute on function anlage_suche(text, integer, jsonb) to authenticated;
grant execute on function anlage_suche(text, integer, jsonb) to service_role;
