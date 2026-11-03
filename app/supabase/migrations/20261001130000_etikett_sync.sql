-- etikett.tuer_id automatisch aus tuer.etikett_id pflegen.
-- So können Prüfer beim Anlegen/Bearbeiten einer Tür ein Etikett zuordnen, ohne Schreibrecht auf etikett zu haben.
-- Doppelte Zuordnung verhindert bereits der eindeutige Index auf tuer.etikett_id.
create function tuer_etikett_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.etikett_id is not distinct from new.etikett_id then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.etikett_id is not null then
    update etikett set tuer_id = null, zugeordnet_am = null where id = old.etikett_id;
  end if;
  if new.etikett_id is not null then
    update etikett set tuer_id = new.id, zugeordnet_am = now() where id = new.etikett_id;
  end if;
  return new;
end $$;

create trigger tuer_etikett_sync after insert or update of etikett_id on tuer
  for each row execute function tuer_etikett_sync();
