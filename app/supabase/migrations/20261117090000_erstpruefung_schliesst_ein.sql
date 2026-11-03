-- Erstprüfung schließt die wiederkehrende Prüfung ein: Nach der Erstinstallation der Rauchwarnmelder (bzw. der Erst- oder
-- Inbetriebnahmeprüfung) galt die Wartung als „noch nie geprüft“ und sofort fällig, obwohl die Anlage gerade geprüft war.
-- - Vorlagen: Erstinstallation → Wartung, Erstprüfung → Wiederholungsprüfung, Inbetriebnahmeprüfung → Wartung und
--   Wiederholungsprüfung (nur, wo die Prüfart noch nichts einschließt).
-- - Wird „schließt ein“ nachträglich gesetzt, gelten die schon abgeschlossenen Prüfungen auch für die eingeschlossene
--   Prüfart (Fälligkeit der Anlage und Stand der Elemente), wie beim Abschluss in pruefung_faelligkeit_fortschreiben().

create function pruefart_einschluss_nachtragen(p_pruefart_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  ziel uuid;
  anlagen uuid[];
begin
  select schliesst_ein_id into ziel from pruefart where id = p_pruefart_id;
  if ziel is null then return; end if;
  -- erst die Elemente (der Bestand rechnet seine Fälligkeit daraus), dann die Fälligkeit der Anlagen
  perform set_config('app.element_stand', 'ja', true);
  update anlage_element e set geprueft_je_pruefart = e.geprueft_je_pruefart || jsonb_build_object(ziel::text, x.tag)
    from (select r.element_id, max(coalesce(p.beendet_am, p.begonnen_am)::date) as tag
            from element_ergebnis r join anlagenpruefung p on p.id = r.anlagenpruefung_id
           where p.pruefart_id = p_pruefart_id and p.status = 'geprueft' and p.ergebnis is not null
             and r.status <> 'nicht_zugaenglich'
           group by 1) x
   where x.element_id = e.id and coalesce((e.geprueft_je_pruefart ->> ziel::text)::date < x.tag, true);
  perform set_config('app.element_stand', '', true);
  insert into anlage_faelligkeit (anlage_id, pruefart_id, letzte_pruefung_am, letztes_ergebnis)
    select distinct on (p.anlage_id) p.anlage_id, ziel, coalesce(p.beendet_am, p.begonnen_am)::date, p.ergebnis
      from anlagenpruefung p
     where p.pruefart_id = p_pruefart_id and p.status = 'geprueft' and p.ergebnis is not null
     order by p.anlage_id, coalesce(p.beendet_am, p.begonnen_am) desc
    on conflict (anlage_id, pruefart_id) do update
      set letzte_pruefung_am = excluded.letzte_pruefung_am, letztes_ergebnis = excluded.letztes_ergebnis
      where anlage_faelligkeit.letzte_pruefung_am is null or anlage_faelligkeit.letzte_pruefung_am < excluded.letzte_pruefung_am;
  select array_agg(distinct p.anlage_id) into anlagen
    from anlagenpruefung p where p.pruefart_id = p_pruefart_id and p.status = 'geprueft' and p.ergebnis is not null;
  perform bestand_faelligkeit_neu(coalesce(anlagen, '{}'));
end $$;
revoke execute on function pruefart_einschluss_nachtragen(uuid) from public, anon, authenticated;

create function pruefart_einschluss_geaendert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Eine Datensicherung bringt Fälligkeiten und Stand der Elemente selbst mit
  if coalesce(current_setting('session.revision', true), '') <> 'ja' then
    perform pruefart_einschluss_nachtragen(new.id);
  end if;
  return null;
end $$;
create trigger pruefart_einschluss_nachtragen after update of schliesst_ein_id on pruefart
  for each row when (new.schliesst_ein_id is not null and new.schliesst_ein_id is distinct from old.schliesst_ein_id)
  execute function pruefart_einschluss_geaendert();

-- Vorhandene Typen aus den Vorlagen (der Trigger trägt abgeschlossene Erstprüfungen nach)
update pruefart p set schliesst_ein_id = z.id
  from anlagentyp t, (values ('rauchwarnmelder', 'Erstinstallation', 'Wartung'),
                             ('elektro', 'Erstprüfung', 'Wiederholungsprüfung'),
                             ('pv', 'Inbetriebnahmeprüfung', 'Wartung und Wiederholungsprüfung')) v (art, erst, folge),
       pruefart z
 where t.id = p.anlagentyp_id and t.anlagenart = v.art and p.name = v.erst and p.schliesst_ein_id is null
   and z.anlagentyp_id = p.anlagentyp_id and z.name = v.folge and z.schliesst_ein_id is distinct from p.id;
