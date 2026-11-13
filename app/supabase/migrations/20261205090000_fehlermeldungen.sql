-- Version 2.92.0: Fehler- und Sofortmeldungen per Mail (Konzept docs/KONZEPT-MAIL.md, Schritt 5).
-- Fehler aus dem Browser (fehler_melden) und aus den Edge Functions sammelt die Datenbank, gleiche Fehler nur gezählt.
-- Die Edge Function mail-takt schickt höchstens stündlich eine Sammelmail mit neuen und wieder aufgetretenen Fehlern,
-- dazu Sofortmeldungen: neu überfällige Prüfungen (einmal am Tag) und kritische Ergebnisse (nach einstellbarer Schwelle).
-- Die Tabellen liegen im Schema intern (für Clients gesperrt), lesen darf der Systemadmin über fehler_liste().

alter table mail_einstellung
  add column fehler_aktiv boolean not null default true,
  -- leer: an die Empfänger der Statusmail
  add column meldung_empfaenger text[] not null default '{}' check (cardinality(meldung_empfaenger) <= 20),
  add column sofort_schwelle text not null default 'stufe3' check (sofort_schwelle in ('aus', 'stufe3', 'stufe2')),
  add column sofort_ueberfaellig boolean not null default true;
insert into log_bezeichnung (tabelle, spalte, text) values
  ('mail_einstellung', 'fehler_aktiv', 'Fehlermeldungen per Mail'),
  ('mail_einstellung', 'meldung_empfaenger', 'Empfänger der Meldungen'),
  ('mail_einstellung', 'sofort_schwelle', 'Sofortmeldung ab'),
  ('mail_einstellung', 'sofort_ueberfaellig', 'Neu überfällige Prüfungen melden')
on conflict (tabelle, spalte) do nothing;

alter table intern.mail_stand
  add column fehler_gemeldet_am timestamptz,
  -- Prüfungen bis zu diesem Abschluss sind auf kritische Ergebnisse geprüft; null = noch nie (ab jetzt beginnen)
  add column sofort_pruefung_bis timestamptz,
  -- Tag, für den neu überfällige Prüfungen zuletzt gemeldet wurden
  add column ueberfaellig_tag date;

create table intern.fehler_meldung (
  id bigint generated always as identity primary key,
  art text not null check (art in ('app', 'edge', 'protokoll')),
  -- gleicher Fehler (Art, Text, Ort) = eine Zeile, nur gezählt
  hash text not null unique,
  text text not null,
  stack text,
  ort text,
  version text,
  geraet text,
  benutzer_id uuid,
  anzahl int not null default 1,
  -- so oft war der Fehler bei der letzten Sammelmail aufgetreten; anzahl > gemeldet_anzahl = neu bzw. wieder aufgetreten
  gemeldet_anzahl int not null default 0,
  erstmals_am timestamptz not null default now(),
  zuletzt_am timestamptz not null default now()
);
create index on intern.fehler_meldung (zuletzt_am);
revoke all on intern.fehler_meldung from public, anon, authenticated;

-- Drossel: je Benutzer höchstens 30 Meldungen in der Stunde
create table intern.fehler_drossel (benutzer_id uuid not null, zeit timestamptz not null default now());
create index on intern.fehler_drossel (benutzer_id, zeit);
revoke all on intern.fehler_drossel from public, anon, authenticated;

-- Schon gemeldete Überfälligkeiten (je Anlage, Prüfart und Fälligkeitsdatum einmal)
create table intern.mail_ueberfaellig_gemeldet (
  anlage_id uuid not null,
  pruefart_id uuid not null,
  faellig_am date not null,
  primary key (anlage_id, pruefart_id, faellig_am)
);
revoke all on intern.mail_ueberfaellig_gemeldet from public, anon, authenticated;

/*
 * Fehler melden: angemeldete aktive Benutzer (Art app oder protokoll) und die Service-Rolle (Edge Functions, Art edge).
 * Kürzt die Texte, zählt gleiche Fehler, drosselt je Benutzer, löscht Einträge älter als 90 Tage. Wirft nie wegen Inhalt.
 */
create function fehler_melden(p_art text, p_text text, p_stack text default null, p_ort text default null, p_version text default null,
                              p_geraet text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  dienst boolean := coalesce(auth.role(), '') = 'service_role';
  wer uuid := auth.uid();
  text_ text := left(coalesce(nullif(trim(p_text), ''), 'Unbekannter Fehler'), 2000);
  ort_ text := left(p_ort, 300);
begin
  if not dienst then
    if wer is null or not ist_aktiv() then return; end if;
    if p_art not in ('app', 'protokoll') then return; end if;
    if (select count(*) from intern.fehler_drossel where benutzer_id = wer and zeit > now() - interval '1 hour') >= 30 then return; end if;
    insert into intern.fehler_drossel (benutzer_id) values (wer);
    delete from intern.fehler_drossel where zeit < now() - interval '1 hour';
  elsif p_art <> 'edge' then
    return;
  end if;
  delete from intern.fehler_meldung where zuletzt_am < now() - interval '90 days';
  insert into intern.fehler_meldung (art, hash, text, stack, ort, version, geraet, benutzer_id)
  values (p_art, md5(p_art || '|' || text_ || '|' || coalesce(ort_, '')), text_, left(p_stack, 4000), ort_, left(p_version, 40),
          left(p_geraet, 200), wer)
  on conflict (hash) do update set anzahl = intern.fehler_meldung.anzahl + 1, zuletzt_am = now(),
    stack = coalesce(excluded.stack, intern.fehler_meldung.stack), version = coalesce(excluded.version, intern.fehler_meldung.version),
    geraet = coalesce(excluded.geraet, intern.fehler_meldung.geraet), benutzer_id = coalesce(excluded.benutzer_id, intern.fehler_meldung.benutzer_id);
end $$;
revoke all on function fehler_melden(text, text, text, text, text, text) from public, anon;
grant execute on function fehler_melden(text, text, text, text, text, text) to authenticated, service_role;

-- Fehlerprotokoll für den Systemadmin (Einstellungen → System → Fehlerprotokoll), neueste zuerst
create function fehler_liste() returns table (id bigint, art text, text text, stack text, ort text, version text, geraet text,
                                               benutzer text, anzahl int, erstmals_am timestamptz, zuletzt_am timestamptz, gemeldet boolean)
language sql stable security definer set search_path = public as $$
  select f.id, f.art, f.text, f.stack, f.ort, f.version, f.geraet, b.name, f.anzahl, f.erstmals_am, f.zuletzt_am, f.anzahl <= f.gemeldet_anzahl
  from intern.fehler_meldung f left join benutzer b on b.id = f.benutzer_id
  where ist_systemadmin() or coalesce(auth.role(), '') = 'service_role'
  order by f.zuletzt_am desc
  limit 500;
$$;
revoke all on function fehler_liste() from public, anon;
grant execute on function fehler_liste() to authenticated, service_role;

create function fehler_leeren() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not ist_systemadmin() then raise exception 'Nur für Admins'; end if;
  delete from intern.fehler_meldung where true;
  get diagnostics n = row_count;
  perform log_schreiben(log_benutzer(auth.uid()), 'Fehlerprotokoll geleert', n || ' Einträge');
  return n;
end $$;
revoke all on function fehler_leeren() from public, anon;
grant execute on function fehler_leeren() to authenticated;

-- --- Für die Edge Function mail-takt (nur Service-Rolle) ---

-- Meldung beanspruchen: true, wenn die letzte Sammelmail länger als p_abstand her ist (setzt den Zeitpunkt unter Sperre)
create function mail_fehler_beanspruchen(p_abstand interval) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update intern.mail_stand set fehler_gemeldet_am = now()
  where id = 1 and (fehler_gemeldet_am is null or fehler_gemeldet_am < now() - p_abstand);
  return found;
end $$;

-- Neue bzw. wieder aufgetretene Fehler
create function mail_fehler_offen() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'art', art, 'text', text, 'ort', ort, 'version', version, 'anzahl', anzahl,
                                               'neu', anzahl - gemeldet_anzahl, 'erstmals', erstmals_am, 'zuletzt', zuletzt_am)
                            order by zuletzt_am desc), '[]')
  from (select * from intern.fehler_meldung where anzahl > gemeldet_anzahl order by zuletzt_am desc limit 100) f;
$$;

-- Nach dem Versand: als gemeldet merken (so oft, wie sie zum Zeitpunkt der Mail aufgetreten waren)
create function mail_fehler_gemeldet(p_stand jsonb) returns void
language sql security definer set search_path = public as $$
  update intern.fehler_meldung f set gemeldet_anzahl = (e ->> 'anzahl')::int
  from jsonb_array_elements(p_stand) e where f.id = (e ->> 'id')::bigint;
$$;

-- Versand fehlgeschlagen: Zeitpunkt zurücknehmen, damit der nächste Takt es erneut versucht
create function mail_fehler_freigeben() returns void
language sql security definer set search_path = public as $$
  update intern.mail_stand set fehler_gemeldet_am = null where id = 1;
$$;

/*
 * Kritische Ergebnisse seit dem letzten Lauf: Prüfungen mit abgeschlossen_am nach sofort_pruefung_bis, Ergebnis rot oder ein
 * Mangel der Stufe 3 (Schwelle stufe2: auch gelb und Stufe 2). Beim ersten Aufruf nichts, nur den Beginn setzen.
 */
create function mail_sofort_pruefungen(p_schwelle text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ab timestamptz;
  bis timestamptz := now();
  liste jsonb;
begin
  select sofort_pruefung_bis into ab from intern.mail_stand where id = 1 for update;
  if ab is null then
    update intern.mail_stand set sofort_pruefung_bis = bis where id = 1;
    return jsonb_build_object('bis', bis, 'pruefungen', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('am', p.abgeschlossen_am, 'ergebnis', coalesce(p.ergebnis, p.ergebnis_auto)::text,
           'protokoll', p.protokoll_nr, 'pruefart', pa.name, 'pruefer', b.name, 'etikett', a.etikett_id, 'bezeichnung', a.kunden_bezeichnung,
           'typ', t.name, 'objekt', klartext_oder_null(o.name), 'ort', klartext_oder_null(o.ort), 'kunde', klartext_oder_null(k.name),
           'stufe', (select max(m.stufe) from mangel m where m.entdeckt_in = p.id),
           'maengel', (select count(*) from mangel m where m.entdeckt_in = p.id)) order by p.abgeschlossen_am), '[]')
    into liste
  from anlagenpruefung p
  join anlage a on a.id = p.anlage_id
  join anlagentyp t on t.id = a.anlagentyp_id
  join objekt o on o.id = a.objekt_id
  join endkunde k on k.id = o.endkunde_id
  left join pruefart pa on pa.id = p.pruefart_id
  left join benutzer b on b.id = p.pruefer_id
  where p.status = 'geprueft' and p.abgeschlossen_am > ab and p.abgeschlossen_am <= bis
    and (coalesce(p.ergebnis, p.ergebnis_auto) = 'rot'
         or exists (select 1 from mangel m where m.entdeckt_in = p.id and m.stufe = 3)
         or (p_schwelle = 'stufe2' and (coalesce(p.ergebnis, p.ergebnis_auto) = 'gelb'
                                         or exists (select 1 from mangel m where m.entdeckt_in = p.id and m.stufe = 2))));
  return jsonb_build_object('bis', bis, 'pruefungen', liste);
end $$;

create function mail_sofort_gemeldet(p_bis timestamptz) returns void
language sql security definer set search_path = public as $$
  update intern.mail_stand set sofort_pruefung_bis = greatest(coalesce(sofort_pruefung_bis, p_bis), p_bis) where id = 1;
$$;

/*
 * Neu überfällige Prüfungen (je Anlage und aktiver Prüfart, ohne Türanlage) noch nicht gemeldet. p_erstes: beim ersten Mal
 * alle vorhandenen nur als gemeldet eintragen (kein Schwall beim Einschalten). Räumt Einträge ab, die nicht mehr überfällig sind.
 */
create function mail_ueberfaellig_neu(p_heute date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  erstes boolean;
  liste jsonb;
begin
  select ueberfaellig_tag is null into erstes from intern.mail_stand where id = 1 for update;
  if (select ueberfaellig_tag from intern.mail_stand where id = 1) >= p_heute then return '[]'; end if;
  delete from intern.mail_ueberfaellig_gemeldet g
  where not exists (select 1 from anlage_faelligkeit f where f.anlage_id = g.anlage_id and f.pruefart_id = g.pruefart_id
                      and f.naechste_pruefung_am = g.faellig_am and f.naechste_pruefung_am < p_heute);
  with neu as (
    select f.anlage_id, f.pruefart_id, f.naechste_pruefung_am, f.letzte_pruefung_am, pa.name as pruefart, a.etikett_id, a.kunden_bezeichnung,
           t.name as typ, klartext_oder_null(o.name) as objekt, klartext_oder_null(o.ort) as ort, klartext_oder_null(k.name) as kunde
    from anlage_faelligkeit f
    join anlage a on a.id = f.anlage_id and a.status = 'aktiv'
    join anlagentyp t on t.id = a.anlagentyp_id and t.id <> '00000000-0000-4000-8000-00000000a001'
    join pruefart pa on pa.id = f.pruefart_id and pa.aktiv and pa.anlagentyp_id = t.id
    join objekt o on o.id = a.objekt_id and o.aktiv
    join endkunde k on k.id = o.endkunde_id and k.aktiv
    where f.naechste_pruefung_am < p_heute
      and not exists (select 1 from intern.mail_ueberfaellig_gemeldet g
                      where g.anlage_id = f.anlage_id and g.pruefart_id = f.pruefart_id and g.faellig_am = f.naechste_pruefung_am)
  )
  select coalesce(jsonb_agg(jsonb_build_object('anlage_id', anlage_id, 'pruefart_id', pruefart_id, 'faellig', naechste_pruefung_am,
           'letzte', letzte_pruefung_am, 'pruefart', pruefart, 'etikett', etikett_id, 'bezeichnung', kunden_bezeichnung, 'typ', typ,
           'objekt', objekt, 'ort', ort, 'kunde', kunde) order by naechste_pruefung_am, etikett_id), '[]')
    into liste from neu;
  if erstes then
    perform mail_ueberfaellig_gemeldet(liste, p_heute);
    return '[]';
  end if;
  return liste;
end $$;

create function mail_ueberfaellig_gemeldet(p_liste jsonb, p_heute date) returns void
language sql security definer set search_path = public as $$
  insert into intern.mail_ueberfaellig_gemeldet (anlage_id, pruefart_id, faellig_am)
  select (e ->> 'anlage_id')::uuid, (e ->> 'pruefart_id')::uuid, (e ->> 'faellig')::date from jsonb_array_elements(p_liste) e
  on conflict do nothing;
  update intern.mail_stand set ueberfaellig_tag = p_heute where id = 1;
$$;

revoke all on function mail_fehler_beanspruchen(interval), mail_fehler_offen(), mail_fehler_gemeldet(jsonb), mail_fehler_freigeben(),
  mail_sofort_pruefungen(text), mail_sofort_gemeldet(timestamptz), mail_ueberfaellig_neu(date), mail_ueberfaellig_gemeldet(jsonb, date)
  from public, anon, authenticated;
grant execute on function mail_fehler_beanspruchen(interval), mail_fehler_offen(), mail_fehler_gemeldet(jsonb), mail_fehler_freigeben(),
  mail_sofort_pruefungen(text), mail_sofort_gemeldet(timestamptz), mail_ueberfaellig_neu(date), mail_ueberfaellig_gemeldet(jsonb, date)
  to service_role;
