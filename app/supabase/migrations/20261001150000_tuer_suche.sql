-- Freitextsuche nach Türen über Etikett, Bezeichnung, Lage, Objekt, Kunde, Ort, Türtyp, Hersteller.
-- Alle Suchwörter müssen vorkommen (UND), Groß-/Kleinschreibung egal. security invoker → RLS gilt.
create function tuer_suche(p_text text, p_limit int default 50)
returns table (
  id uuid,
  etikett_id text,
  kunden_bezeichnung text,
  gebaeude text,
  etage text,
  raum text,
  lage_beschreibung text,
  status tuer_status,
  naechste_pruefung_am date,
  tuertyp text,
  objekt_id uuid,
  objekt text,
  objekt_ort text,
  kunde text
)
language sql stable security invoker set search_path = public as $$
  with woerter as (
    select w from unnest(regexp_split_to_array(lower(trim(p_text)), '\s+')) w where w <> ''
  ),
  kandidaten as (
    select t.*, ty.name as typ_name, o.name as o_name, o.ort as o_ort, k.name as k_name,
           lower(concat_ws(' ',
             t.etikett_id, t.kunden_bezeichnung, t.gebaeude, t.etage, t.raum, t.lage_beschreibung,
             t.hersteller, t.modell, ty.name,
             o.name, o.strasse, o.plz, o.ort,
             k.name, k.strasse, k.plz, k.ort, k.ansprechpartner)) as suchtext
    from tuer t
    join tuertyp ty on ty.id = t.tuertyp_id
    join objekt o on o.id = t.objekt_id
    join endkunde k on k.id = o.endkunde_id
  )
  select c.id, c.etikett_id, c.kunden_bezeichnung, c.gebaeude, c.etage, c.raum, c.lage_beschreibung,
         c.status, c.naechste_pruefung_am, c.typ_name, c.objekt_id, c.o_name, c.o_ort, c.k_name
  from kandidaten c
  where exists (select 1 from woerter)
    and not exists (select 1 from woerter where position(w in c.suchtext) = 0)
  order by (lower(c.etikett_id) = lower(trim(p_text))) desc nulls last,
           (c.status = 'aktiv') desc, c.k_name, c.o_name, c.gebaeude, c.etage, c.kunden_bezeichnung
  limit least(greatest(p_limit, 1), 200);
$$;

revoke execute on function tuer_suche(text, int) from public, anon;
grant execute on function tuer_suche(text, int) to authenticated;
