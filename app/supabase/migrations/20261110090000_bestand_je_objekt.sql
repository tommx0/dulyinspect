-- Bestand je Objekt (docs/KONZEPT-BESTAND-JE-OBJEKT.md, Version 2.56.0): Rauchwarnmelder und ortsveränderliche Geräte haben
-- keine zentralen Bauteile. Je Objekt und Art gibt es genau eine Anlage, den Bestand, als Klammer für die Elemente (Melder,
-- Geräte) – ohne Etikett, Lage, Hersteller und besondere Felder, wie die Türanlage je Objekt.
--
-- - ID aus Objekt und Art abgeleitet (bestand_id(), in der App bestandId()), damit gleichzeitiges Anlegen offline dieselbe
--   Zeile trifft. Angelegt wird der Bestand beim ersten Bedarf, nicht mit jedem Objekt. Die Bezeichnung setzt der Server auf
--   den Namen der Art. Typ (derselben Art) und Status bleiben änderbar.
-- - Fälligkeit je Element: anlage_element.geprueft_je_pruefart hält je Prüfart den Tag der letzten Prüfung mit Ergebnis
--   („nicht zugänglich“ zählt nicht). Bei Prüfarten mit allen Elementen ist der Bestand fällig, sobald eines seiner aktiven
--   Elemente fällig ist (noch nie geprüft: ab seiner Anlage). Welche Elemente beim Abschluss Pflicht sind, prüft die App.
-- - Bestehende Anlagen dieser Arten werden je Objekt zu einem Bestand zusammengeführt (bestand_zusammenfuehren(), auch nach
--   dem Wiederherstellen älterer Sicherungen).

-- ---------------------------------------------------------------------------
-- 1. Arten, ID, Erkennung
-- ---------------------------------------------------------------------------
create function bestand_art(p_art text) returns boolean
language sql immutable set search_path = public as $$ select coalesce(p_art in ('rauchwarnmelder', 'geraete'), false) $$;
comment on function bestand_art(text) is 'Arten ohne zentrale Bauteile: je Objekt ein Bestand (wie src/lib/anlagenarten.ts, bestand: true)';

-- ID des Bestands eines Objekts (wie bestandId() in src/lib/bestand.ts)
create function bestand_id(p_objekt_id uuid, p_art text) returns uuid
language sql immutable set search_path = public as $$ select md5('bestand:' || p_art || ':' || p_objekt_id::text)::uuid $$;
grant execute on function bestand_art(text) to authenticated;
grant execute on function bestand_id(uuid, text) to authenticated;

create function bestand_anlage(p_anlage_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from anlage a join anlagentyp t on t.id = a.anlagentyp_id where a.id = p_anlage_id and bestand_art(t.anlagenart));
$$;

-- ---------------------------------------------------------------------------
-- 2. Der Bestand: richtige ID, keine Stammdaten, Name der Art
-- ---------------------------------------------------------------------------
create function anlage_bestand_pruefen() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  art text;
  alt_art text;
begin
  select anlagenart into art from anlagentyp where id = new.anlagentyp_id;
  if tg_op = 'UPDATE' then select anlagenart into alt_art from anlagentyp where id = old.anlagentyp_id; end if;
  if not bestand_art(art) and not bestand_art(alt_art) then return new; end if;
  -- Sicherungen älterer Versionen kommen wie gesichert zurück (danach bestand_zusammenfuehren), Zusammenführen selbst
  -- und die Zusammenfassung der Fälligkeit (anlage_zusammenfassen)
  if coalesce(current_setting('session.revision', true), '') = 'ja' or coalesce(current_setting('anlage.bestand', true), '') = 'ja'
     or coalesce(current_setting('app.zusammenfassung', true), '') = 'ja' then
    return new;
  end if;
  if tg_op = 'UPDATE' and art is distinct from alt_art then
    raise exception 'Der Typ eines Bestands lässt sich nur gegen einen Typ derselben Art tauschen';
  end if;
  if new.id <> bestand_id(new.objekt_id, art) then
    raise exception '% gibt es je Objekt nur einmal – bitte den Bestand des Objekts verwenden',
      coalesce((select name from anlagenart where schluessel = art), art);
  end if;
  new.kunden_bezeichnung := coalesce((select name from anlagenart where schluessel = art), art);
  new.etikett_id := null;
  new.gebaeude := null; new.etage := null; new.raum := null; new.lage_beschreibung := null;
  new.hersteller := null; new.modell := null; new.baujahr := null;
  new.eigenschaften := '{}'::jsonb;
  if tg_op = 'UPDATE' and new.anlagentyp_id <> old.anlagentyp_id
     and exists (select 1 from anlagenpruefung where anlage_id = new.id and session_id is null and status = 'in_pruefung') then
    raise exception 'Der Bestand wird gerade geprüft – der Typ kann erst danach geändert werden';
  end if;
  return new;
end $$;
-- vor anlage_zz_teil_pruefen und der Verschlüsselung
create trigger anlage_zy_bestand_pruefen before insert or update on anlage
  for each row execute function anlage_bestand_pruefen();

-- ---------------------------------------------------------------------------
-- 3. Fälligkeit je Element
-- ---------------------------------------------------------------------------
alter table anlage_element add column geprueft_je_pruefart jsonb not null default '{}'::jsonb
  check (jsonb_typeof(geprueft_je_pruefart) = 'object');
comment on column anlage_element.geprueft_je_pruefart is
  'Je Prüfart (ID) der Tag der letzten abgeschlossenen Prüfung mit Ergebnis für dieses Element (wird automatisch gesetzt)';
insert into log_bezeichnung (tabelle, spalte, text) values ('anlage_element', 'geprueft_je_pruefart', 'Geprüft je Prüfart')
on conflict (tabelle, spalte) do nothing;

-- Wie zuletzt_geprueft_am setzt die Spalte nur die Datenbank
create or replace function element_zuletzt_schuetzen() returns trigger
language plpgsql set search_path = public as $$
begin
  -- Ausnahme: Fortschreiben nach einer Prüfung und Wiederherstellen einer Datensicherung
  if coalesce(current_setting('app.element_stand', true), '') <> 'ja' and coalesce(current_setting('session.revision', true), '') <> 'ja' then
    new.zuletzt_geprueft_am := case when tg_op = 'INSERT' then null else old.zuletzt_geprueft_am end;
    new.geprueft_je_pruefart := case when tg_op = 'INSERT' then '{}'::jsonb else old.geprueft_je_pruefart end;
  end if;
  return new;
end $$;

-- Nächste Prüfung einer Anlage in einer Prüfart. Bestand mit allen Elementen: das früheste fällige aktive Element
-- (noch nie in dieser Prüfart geprüft: ab seiner Anlage). Sonst wie bisher letzte Prüfung + Intervall.
create function faelligkeit_naechste(p_anlage_id uuid, p_pruefart_id uuid, p_letzte date, p_intervall int) returns date
language sql stable security definer set search_path = public as $$
  select case when p_letzte is null then null else coalesce(
    case when pa.elemente = 'alle' and bestand_anlage(p_anlage_id) then
      (select min(coalesce((e.geprueft_je_pruefart ->> p_pruefart_id::text)::date + make_interval(months => x.monate), e.erstellt_am::date))::date
         from anlage_element e where e.anlage_id = p_anlage_id and e.aktiv)
    end,
    (p_letzte + make_interval(months => x.monate))::date) end
  from pruefart pa cross join lateral (select coalesce(p_intervall, pa.intervall_monate) as monate) x
  where pa.id = p_pruefart_id;
$$;
revoke execute on function faelligkeit_naechste(uuid, uuid, date, int) from public, anon, authenticated;

create or replace function faelligkeit_berechnen() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.letzte_pruefung_am > current_date then
    raise exception 'Das Datum der letzten Prüfung darf nicht in der Zukunft liegen';
  end if;
  new.naechste_pruefung_am := faelligkeit_naechste(new.anlage_id, new.pruefart_id, new.letzte_pruefung_am, new.intervall_monate);
  return new;
end $$;

-- Fälligkeit von Beständen neu berechnen (nur Zeilen, deren Ergebnis sich ändert)
create function bestand_faelligkeit_neu(p_anlage_ids uuid[]) returns void
language sql security definer set search_path = public as $$
  update anlage_faelligkeit f set letzte_pruefung_am = f.letzte_pruefung_am
   where f.anlage_id = any (p_anlage_ids) and bestand_anlage(f.anlage_id)
     and f.naechste_pruefung_am is distinct from faelligkeit_naechste(f.anlage_id, f.pruefart_id, f.letzte_pruefung_am, f.intervall_monate);
$$;
revoke execute on function bestand_faelligkeit_neu(uuid[]) from public, anon, authenticated;

-- Neue, stillgelegte, gelöschte oder umgehängte Elemente ändern die Fälligkeit ihres Bestands
create function anlage_element_bestand_neu() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.element_stand', true), '') = 'ja' then return null; end if;
  if tg_op = 'INSERT' then
    perform bestand_faelligkeit_neu(array(select distinct anlage_id from neu));
  elsif tg_op = 'DELETE' then
    perform bestand_faelligkeit_neu(array(select distinct anlage_id from alt));
  else
    perform bestand_faelligkeit_neu(array(
      select distinct x.anlage_id from alt a join neu n on n.id = a.id
        cross join lateral (values (a.anlage_id), (n.anlage_id)) x (anlage_id)
       where (a.aktiv, a.anlage_id, a.geprueft_je_pruefart) is distinct from (n.aktiv, n.anlage_id, n.geprueft_je_pruefart)));
  end if;
  return null;
end $$;
create trigger anlage_element_bestand_einfuegen after insert on anlage_element
  referencing new table as neu for each statement execute function anlage_element_bestand_neu();
create trigger anlage_element_bestand_aendern after update on anlage_element
  referencing old table as alt new table as neu for each statement execute function anlage_element_bestand_neu();
create trigger anlage_element_bestand_loeschen after delete on anlage_element
  referencing old table as alt for each statement execute function anlage_element_bestand_neu();

-- Fortschreiben nach dem Abschluss: erst die Elemente (je Prüfart), dann die Fälligkeit der Anlage
create or replace function pruefung_faelligkeit_fortschreiben(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  p anlagenpruefung;
  tag date;
  arten text[];
begin
  select * into p from anlagenpruefung where id = p_id;
  if p.id is null then return; end if;
  tag := coalesce(p.beendet_am, p.begonnen_am)::date;
  -- auch für die Prüfarten, die diese Prüfart einschließt (pruefart.schliesst_ein_id)
  select array_agg(a.id::text) into arten
    from pruefart pa join pruefart a on a.id in (pa.id, pa.schliesst_ein_id) where pa.id = p.pruefart_id;
  perform set_config('app.element_stand', 'ja', true);
  update anlage_element e set
         zuletzt_geprueft_am = greatest(coalesce(e.zuletzt_geprueft_am, tag), tag),
         geprueft_je_pruefart = e.geprueft_je_pruefart || coalesce((
           select jsonb_object_agg(k, greatest(coalesce((e.geprueft_je_pruefart ->> k)::date, tag), tag)) from unnest(arten) k), '{}'::jsonb)
    from element_ergebnis r
   where r.anlagenpruefung_id = p.id and r.element_id = e.id and r.status <> 'nicht_zugaenglich';
  perform set_config('app.element_stand', '', true);
  insert into anlage_faelligkeit (anlage_id, pruefart_id, letzte_pruefung_am, letztes_ergebnis)
    select p.anlage_id, k::uuid, tag, p.ergebnis from unnest(arten) k
    on conflict (anlage_id, pruefart_id) do update
      set letzte_pruefung_am = excluded.letzte_pruefung_am, letztes_ergebnis = excluded.letztes_ergebnis
      where anlage_faelligkeit.letzte_pruefung_am is null or anlage_faelligkeit.letzte_pruefung_am <= excluded.letzte_pruefung_am;
  -- Ein Nachtermin mit älterem Datum ändert die letzte Prüfung nicht, wohl aber die Fälligkeit der Elemente
  perform bestand_faelligkeit_neu(array[p.anlage_id]);
end $$;
revoke execute on function pruefung_faelligkeit_fortschreiben(uuid) from public, anon, authenticated;

-- Stand je Prüfart aus dem Verlauf (Bestand vor 2.56 und Wiederherstellung älterer Sicherungen)
create function element_stand_nachtragen(p_anlage_id uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.element_stand', 'ja', true);
  update anlage_element e set geprueft_je_pruefart = x.stand
    from (select element_id, jsonb_object_agg(pruefart_id, tag) as stand
            from (select r.element_id, a.id::text as pruefart_id, max(coalesce(p.beendet_am, p.begonnen_am)::date) as tag
                    from element_ergebnis r
                    join anlagenpruefung p on p.id = r.anlagenpruefung_id
                    join pruefart pa on pa.id = p.pruefart_id
                    join pruefart a on a.id in (pa.id, pa.schliesst_ein_id)
                   where r.status <> 'nicht_zugaenglich' and p.status = 'geprueft' and p.ergebnis is not null
                     and (p_anlage_id is null or p.anlage_id = p_anlage_id)
                   group by 1, 2) y
           group by 1) x
   where x.element_id = e.id and e.geprueft_je_pruefart = '{}'::jsonb;
  perform set_config('app.element_stand', '', true);
end $$;
revoke execute on function element_stand_nachtragen(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Zusammenführen: alle Anlagen einer Art je Objekt werden ein Bestand
-- ---------------------------------------------------------------------------
-- Die Anlage einer Prüfung ist unveränderlich – außer beim Zusammenführen der Bestände
create or replace function anlagenpruefung_vor_aendern() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Einzige Ausnahme: beim Auflösen der letzten Sessions (Wartung, session.revision) verlässt die Prüfung ihre Session
  if (new.session_id is distinct from old.session_id
      and not (new.session_id is null and coalesce(current_setting('session.revision', true), '') = 'ja'))
     or (new.anlage_id <> old.anlage_id and coalesce(current_setting('anlage.bestand', true), '') <> 'ja')
     or (new.pruefer_id <> old.pruefer_id and coalesce(current_setting('anlagenpruefung.uebernehmen', true), '') <> 'ja') then
    raise exception 'Anlage und Prüfer einer Prüfung sind unveränderlich';
  end if;
  -- Ein Duplikat bleibt Duplikat, bis es geklärt wird (Sync des Geräts darf das nicht überschreiben)
  if old.status = 'duplikat' and new.status <> 'duplikat'
     and coalesce(current_setting('anlagenpruefung.aufloesen', true), '') <> 'ja' then
    new.status := 'duplikat';
    new.duplikat_von := old.duplikat_von;
    new.duplikat_geklaert := old.duplikat_geklaert;
  end if;
  -- Übernahme-Vermerk kann das Gerät nicht verändern
  if coalesce(current_setting('anlagenpruefung.uebernehmen', true), '') <> 'ja' then
    new.urspruenglicher_pruefer_id := old.urspruenglicher_pruefer_id;
    new.uebernommen_am := old.uebernommen_am;
  end if;
  -- Prüfart wird beim Anlegen geprüft und bleibt dann (still, damit ein veralteter Sync nicht scheitert)
  if not ist_admin() and coalesce(current_setting('session.revision', true), '') <> 'ja' then
    new.pruefart_id := old.pruefart_id;
  end if;
  return new;
end $$;

create function bestand_zusammenfuehren() returns int
language plpgsql security definer set search_path = public as $$
declare
  g record;
  q record;
  ziel uuid;
  typ uuid;
  mehrere boolean;
  zugang text;
  anzahl int := 0;
  revision_vorher text := coalesce(current_setting('session.revision', true), '');
begin
  if auth.uid() is not null and not ist_systemadmin() then raise exception 'Nur Admins dürfen Bestände zusammenführen'; end if;

  -- Je Objekt und Art höchstens eine laufende Prüfung, sonst stießen zwei am selben Bestand zusammen
  if exists (select 1 from anlagenpruefung p join anlage a on a.id = p.anlage_id join anlagentyp t on t.id = a.anlagentyp_id
              where bestand_art(t.anlagenart) and p.session_id is null and p.status = 'in_pruefung'
              group by a.objekt_id, t.anlagenart having count(*) > 1) then
    raise exception 'Ein Objekt hat mehrere laufende Prüfungen von Rauchwarnmeldern bzw. Geräten – bitte vorher abschließen oder abbrechen';
  end if;

  perform set_config('anlage.bestand', 'ja', true);
  perform set_config('session.revision', 'ja', true);
  for g in
    select a.objekt_id, t.anlagenart as art, count(*) as n
      from anlage a join anlagentyp t on t.id = a.anlagentyp_id
     where bestand_art(t.anlagenart)
     group by 1, 2
    having bool_or(a.id <> bestand_id(a.objekt_id, t.anlagenart))
  loop
    ziel := bestand_id(g.objekt_id, g.art);
    mehrere := g.n > 1;
    -- Typ: der der Anlage mit den meisten Elementen
    select a.anlagentyp_id into typ
      from anlage a join anlagentyp t on t.id = a.anlagentyp_id
     where a.objekt_id = g.objekt_id and t.anlagenart = g.art
     order by (select count(*) from anlage_element e where e.anlage_id = a.id and e.aktiv) desc, a.erstellt_am, a.id
     limit 1;
    insert into anlage (id, objekt_id, anlagentyp_id, kunden_bezeichnung, status, erstellt_am, erstellt_von)
      select ziel, g.objekt_id, typ, coalesce((select name from anlagenart where schluessel = g.art), g.art),
             case when bool_or(a.status = 'aktiv') then 'aktiv'::anlage_status else 'stillgelegt'::anlage_status end,
             min(a.erstellt_am), (array_agg(a.erstellt_von order by a.erstellt_am))[1]
        from anlage a join anlagentyp t on t.id = a.anlagentyp_id
       where a.objekt_id = g.objekt_id and t.anlagenart = g.art
      on conflict (id) do nothing;

    -- Bezeichnung jeder bisherigen Anlage: bei mehreren eindeutig (sonst stießen Nummern gleicher Gruppen zusammen)
    for q in
      select s.*, case when mehrere then
               coalesce(s.marke, 'Anlage') || case when count(*) over (partition by coalesce(s.marke, 'Anlage')) > 1
                 then ' ' || row_number() over (partition by coalesce(s.marke, 'Anlage') order by s.erstellt_am, s.id) else '' end
             else s.marke end as bezeichnung
        from (select a.*, left(coalesce(nullif(trim(a.kunden_bezeichnung), ''), a.etikett_id,
                                        nullif(concat_ws(' ', a.gebaeude, a.etage, a.raum), '')), 30) as marke
                from anlage a join anlagentyp t on t.id = a.anlagentyp_id
               where a.objekt_id = g.objekt_id and t.anlagenart = g.art and a.id <> ziel) s
    loop
      -- Elemente: Bezeichnung als Gruppe (bei mehreren als Vorsilbe), Hersteller/Modell als Typ
      update anlage_element e set
             anlage_id = ziel,
             gruppe = case when q.bezeichnung is null then e.gruppe
                           when mehrere then left(concat_ws(' – ', q.bezeichnung, e.gruppe), 40)
                           else coalesce(e.gruppe, left(q.bezeichnung, 40)) end,
             typ = coalesce(e.typ, nullif(concat_ws(' ', q.hersteller, q.modell), ''))
       where e.anlage_id = q.id;
      update anlagenpruefung set anlage_id = ziel where anlage_id = q.id;
      update anlagenpruefung_freigabe set anlage_id = ziel where anlage_id = q.id;
      update mangel set anlage_id = ziel where anlage_id = q.id;
      update foto set bezug_id = ziel where bezug_typ = 'anlage' and bezug_id = q.id;
      insert into anlage_faelligkeit (anlage_id, pruefart_id, intervall_monate, letzte_pruefung_am, letztes_ergebnis)
        select ziel, f.pruefart_id, f.intervall_monate, f.letzte_pruefung_am, f.letztes_ergebnis from anlage_faelligkeit f where f.anlage_id = q.id
        on conflict (anlage_id, pruefart_id) do update
          set letzte_pruefung_am = excluded.letzte_pruefung_am, letztes_ergebnis = excluded.letztes_ergebnis,
              intervall_monate = coalesce(anlage_faelligkeit.intervall_monate, excluded.intervall_monate)
          where anlage_faelligkeit.letzte_pruefung_am is null or anlage_faelligkeit.letzte_pruefung_am < excluded.letzte_pruefung_am;
      -- Besondere Felder (Zugang, Abteilung …) wandern in die Zugangshinweise des Objekts, sofern nicht verschlüsselt
      select string_agg(coalesce(b.text, x.key) || ': ' || x.value, '; ' order by x.key) into zugang
        from jsonb_each_text(q.eigenschaften) x left join log_bezeichnung b on b.tabelle = 'eigenschaften' and b.spalte = x.key
       where nullif(trim(x.value), '') is not null and not coalesce(ist_geheimtext(x.value), false);
      if zugang is not null then
        update objekt set zugangshinweise = concat_ws(E'\n', nullif(zugangshinweise, ''),
                 coalesce((select name from anlagenart where schluessel = g.art), g.art) || coalesce(' ' || q.bezeichnung, '') || ' – ' || zugang)
         where id = g.objekt_id and not coalesce(ist_geheimtext(zugangshinweise), false);
      end if;
      update etikett set anlage_id = null, zugeordnet_am = null where anlage_id = q.id;
      update anlage set etikett_id = null where id = q.id and etikett_id is not null;
      delete from anlage where id = q.id;
      anzahl := anzahl + 1;
    end loop;
    -- Der Bestand selbst ohne Stammdaten (falls er aus einer Sicherung stammt)
    update anlage set kunden_bezeichnung = coalesce((select name from anlagenart where schluessel = g.art), g.art),
           etikett_id = null, gebaeude = null, etage = null, raum = null, lage_beschreibung = null,
           hersteller = null, modell = null, baujahr = null, eigenschaften = '{}'::jsonb
     where id = ziel;
    perform element_stand_nachtragen(ziel);
    perform bestand_faelligkeit_neu(array[ziel]);
    perform anlage_zusammenfassen(ziel);
  end loop;
  perform set_config('session.revision', revision_vorher, true);
  perform set_config('anlage.bestand', '', true);
  return anzahl;
end $$;
revoke execute on function bestand_zusammenfuehren() from public, anon;
grant execute on function bestand_zusammenfuehren() to authenticated;
comment on function bestand_zusammenfuehren() is
  'Führt alle Anlagen einer Bestandsart je Objekt zu einem Bestand zusammen (Update auf 2.56, danach nach jeder Wiederherstellung)';

-- ---------------------------------------------------------------------------
-- 5. Bestand übernehmen
-- ---------------------------------------------------------------------------
select element_stand_nachtragen();
select bestand_zusammenfuehren();
-- Bestände, die schon die richtige ID hatten, gibt es noch nicht; die Fälligkeit aller Bestände einmal neu berechnen
select bestand_faelligkeit_neu(array(select a.id from anlage a join anlagentyp t on t.id = a.anlagentyp_id where bestand_art(t.anlagenart)));
