-- Prüfart „schließt ein“: Eine abgeschlossene Wartung gilt zugleich als Inspektion.
-- Wird eine Prüfung der Wartung abgeschlossen, setzt das auch die Fälligkeit der eingeschlossenen Prüfart (derselben Anlage) zurück.
-- Bewusst ohne Fremdschlüssel: Die Wiederherstellung einer Datensicherung legt Prüfarten einzeln und in beliebiger Reihenfolge an.
-- Entfernt wird die Verknüpfung stattdessen per Trigger, wenn die eingeschlossene Prüfart gelöscht wird.

alter table pruefart add column schliesst_ein_id uuid;
comment on column pruefart.schliesst_ein_id is 'Prüfart desselben Anlagentyps, die mit dieser zusammen als durchgeführt gilt (z. B. Wartung schließt Inspektion ein)';

create function pruefart_schliesst_ein_pruefen() returns trigger
language plpgsql set search_path = public as $$
declare
  ziel pruefart;
begin
  if new.schliesst_ein_id is null then return new; end if;
  if new.schliesst_ein_id = new.id then raise exception 'Eine Prüfart kann sich nicht selbst einschließen'; end if;
  select * into ziel from pruefart where id = new.schliesst_ein_id;
  -- Fehlt die Prüfart noch (Wiederherstellung einer Sicherung in beliebiger Reihenfolge), wird nicht geprüft
  if ziel.id is null then return new; end if;
  if ziel.anlagentyp_id <> new.anlagentyp_id then raise exception 'Die eingeschlossene Prüfart muss zum selben Anlagentyp gehören'; end if;
  if ziel.schliesst_ein_id = new.id then raise exception 'Zwei Prüfarten können sich nicht gegenseitig einschließen'; end if;
  return new;
end $$;
create trigger pruefart_schliesst_ein_pruefen before insert or update of schliesst_ein_id on pruefart
  for each row execute function pruefart_schliesst_ein_pruefen();

create function pruefart_schliesst_ein_loesen() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update pruefart set schliesst_ein_id = null where schliesst_ein_id = old.id;
  return old;
end $$;
create trigger pruefart_schliesst_ein_loesen after delete on pruefart
  for each row execute function pruefart_schliesst_ein_loesen();

insert into log_bezeichnung (tabelle, spalte, text) values ('pruefart', 'schliesst_ein_id', 'Schließt ein') on conflict do nothing;

-- Abgeschlossene Prüfung: Fälligkeit der Prüfart – und der eingeschlossenen – fortschreiben, Stand der Elemente aktualisieren
create or replace function anlagenpruefung_nach_aendern() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  tag date;
begin
  if new.status = 'geprueft' and new.ergebnis is not null then
    tag := coalesce(new.beendet_am, new.begonnen_am)::date;
    insert into anlage_faelligkeit (anlage_id, pruefart_id, letzte_pruefung_am, letztes_ergebnis)
      select new.anlage_id, a.id, tag, new.ergebnis
        from pruefart p join pruefart a on a.id in (p.id, p.schliesst_ein_id)
       where p.id = new.pruefart_id
      on conflict (anlage_id, pruefart_id) do update
        set letzte_pruefung_am = excluded.letzte_pruefung_am, letztes_ergebnis = excluded.letztes_ergebnis
        where anlage_faelligkeit.letzte_pruefung_am is null or anlage_faelligkeit.letzte_pruefung_am <= excluded.letzte_pruefung_am;
    perform set_config('app.element_stand', 'ja', true);
    update anlage_element e set zuletzt_geprueft_am = tag
      from element_ergebnis r
     where r.anlagenpruefung_id = new.id and r.element_id = e.id and r.status <> 'nicht_zugaenglich'
       and (e.zuletzt_geprueft_am is null or e.zuletzt_geprueft_am < tag);
    perform set_config('app.element_stand', '', true);
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
