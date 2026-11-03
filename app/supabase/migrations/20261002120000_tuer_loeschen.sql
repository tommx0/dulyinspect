-- Türen löschen (nur Admin, RLS: tuer_admin). Türen mit Prüfhistorie bleiben erhalten (Protokolle!) –
-- dafür gibt es den Status „stillgelegt“. Das Etikett wird wieder frei.
create function tuer_vor_loeschen() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from tuerpruefung where tuer_id = old.id) or exists (select 1 from mangel where tuer_id = old.id) then
    raise exception 'Die Tür hat bereits Prüfungen und kann nicht gelöscht werden. Bitte stattdessen stilllegen.';
  end if;
  update etikett set tuer_id = null, zugeordnet_am = null where tuer_id = old.id;
  delete from foto where bezug_typ = 'tuer' and bezug_id = old.id;
  return old;
end $$;

create trigger tuer_vor_loeschen before delete on tuer
  for each row execute function tuer_vor_loeschen();
