-- Version 2.37.0: Kennzahlen für das Dashboard der Startseite (große Bildschirme) in einer Abfrage.
-- Läuft mit den Rechten des Aufrufers (RLS gilt). Gezählt werden aktive Anlagen aktiver Objekte und Kunden.
-- „Geprüft“ = Anlagenprüfungen mit Status geprueft; Ergebnis gruen = in Ordnung, gelb = mit Mängeln, rot = nicht bestanden.
create function startseite_kennzahlen(p_heute date default current_date) returns jsonb
language sql stable set search_path = public as $$
  with anlagen as (
    select a.id, t.anlagenart, a.naechste_pruefung_am
    from anlage a
    join anlagentyp t on t.id = a.anlagentyp_id
    join objekt o on o.id = a.objekt_id
    join endkunde k on k.id = o.endkunde_id
    where a.status = 'aktiv' and o.aktiv and k.aktiv
  ),
  pruefungen as (
    select p.ergebnis, coalesce(p.beendet_am, p.begonnen_am)::date as am, t.anlagenart
    from anlagenpruefung p
    join anlage a on a.id = p.anlage_id
    join anlagentyp t on t.id = a.anlagentyp_id
    where p.status = 'geprueft'
  ),
  jahr as (select * from pruefungen where am >= date_trunc('year', p_heute)::date and am <= p_heute),
  monate as (
    select to_char(m, 'YYYY-MM') as monat, m::date as von, (m + interval '1 month')::date as bis
    from generate_series(date_trunc('month', p_heute) - interval '11 months', date_trunc('month', p_heute), interval '1 month') m
  )
  select jsonb_build_object(
    'anlagen', (select count(*) from anlagen),
    'anlagen_je_art', (select coalesce(jsonb_object_agg(anlagenart, n), '{}') from (select anlagenart, count(*) as n from anlagen group by 1) x),
    'elemente', (select count(*) from anlage_element e join anlagen a on a.id = e.anlage_id where e.aktiv),
    'ueberfaellig', (select count(*) from anlagen where naechste_pruefung_am < p_heute),
    'faellig_30', (select count(*) from anlagen where naechste_pruefung_am between p_heute and p_heute + 30),
    'geprueft_gesamt', (select count(*) from pruefungen),
    'geprueft_jahr', (select count(*) from jahr),
    'geprueft_vorjahr', (select count(*) from pruefungen
                         where am >= (date_trunc('year', p_heute) - interval '1 year')::date and am <= (p_heute - interval '1 year')::date),
    'jahr_je_art', (select coalesce(jsonb_object_agg(anlagenart, jsonb_build_object(
                      'gruen', g, 'gelb', y, 'rot', r)), '{}')
                    from (select anlagenart, count(*) filter (where ergebnis = 'gruen') as g, count(*) filter (where ergebnis = 'gelb') as y,
                                 count(*) filter (where ergebnis = 'rot') as r
                          from jahr group by 1) x),
    'monate', (select jsonb_agg(jsonb_build_object('monat', m.monat,
                 'gruen', (select count(*) from pruefungen p where p.am >= m.von and p.am < m.bis and p.ergebnis = 'gruen'),
                 'gelb', (select count(*) from pruefungen p where p.am >= m.von and p.am < m.bis and p.ergebnis = 'gelb'),
                 'rot', (select count(*) from pruefungen p where p.am >= m.von and p.am < m.bis and p.ergebnis = 'rot')) order by m.monat)
               from monate m),
    'maengel', (select jsonb_build_object(
                  '1', count(*) filter (where m.stufe = 1), '2', count(*) filter (where m.stufe = 2), '3', count(*) filter (where m.stufe = 3))
                from mangel m join anlagen a on a.id = m.anlage_id where m.status = 'offen')
  );
$$;
revoke all on function startseite_kennzahlen(date) from public, anon;
grant execute on function startseite_kennzahlen(date) to authenticated, service_role;
