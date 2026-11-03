-- Nächste Prüfung automatisch berechnen: letzte Prüfung + Intervall (Tür, sonst Türtyp).
-- Gilt für Altbestand (letztes Prüfdatum bei Anlage erfasst) und später für Prüfungen aus der App.
create function tuer_naechste_pruefung() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  monate int;
begin
  if new.letzte_pruefung_am > current_date then
    raise exception 'Das Datum der letzten Prüfung darf nicht in der Zukunft liegen';
  end if;
  if new.letzte_pruefung_am is null then
    new.naechste_pruefung_am := null;
    return new;
  end if;
  monate := coalesce(new.intervall_monate, (select intervall_monate from tuertyp where id = new.tuertyp_id));
  new.naechste_pruefung_am := (new.letzte_pruefung_am + make_interval(months => monate))::date;
  return new;
end $$;

create trigger tuer_naechste_pruefung before insert or update of letzte_pruefung_am, intervall_monate, tuertyp_id on tuer
  for each row execute function tuer_naechste_pruefung();

-- Ändert sich das Standardintervall eines Türtyps, Fälligkeiten der Türen ohne eigenes Intervall neu berechnen
create function tuertyp_intervall_geaendert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update tuer set letzte_pruefung_am = letzte_pruefung_am
   where tuertyp_id = new.id and intervall_monate is null and letzte_pruefung_am is not null;
  return new;
end $$;

create trigger tuertyp_intervall_geaendert after update of intervall_monate on tuertyp
  for each row when (old.intervall_monate is distinct from new.intervall_monate)
  execute function tuertyp_intervall_geaendert();

-- Bestehende Türen nachberechnen
update tuer set letzte_pruefung_am = letzte_pruefung_am where letzte_pruefung_am is not null;
