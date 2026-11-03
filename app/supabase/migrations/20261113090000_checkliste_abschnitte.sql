-- Version 2.59.0: Abschnitte einer Checkliste als eigene Liste.
-- Bisher stand der Abschnitt nur als Text an jedem Prüfpunkt; ein Abschnitt ohne Punkte konnte es nicht geben.
-- checkliste_version.abschnitte hält die Namen in ihrer Reihenfolge (auch noch leere Abschnitte). Abschnitte, die nur
-- an Punkten stehen (ältere Versionen haben eine leere Liste), ergänzt der Editor hinten in der Reihenfolge der Punkte.
-- Die Prüfung liest weiter nur punkte; leere Abschnitte erscheinen dort nicht.

alter table checkliste_version add column abschnitte jsonb not null default '[]'::jsonb
  constraint checkliste_version_abschnitte_check check (jsonb_typeof(abschnitte) = 'array');
comment on column checkliste_version.abschnitte is 'Abschnittsnamen in Reihenfolge, auch ohne Prüfpunkte (Editor)';

-- Freigegebene/archivierte Versionen bleiben unveränderlich, jetzt auch in ihren Abschnitten
create or replace function version_schutz() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'entwurf' then
      raise exception 'Freigegebene Checklisten-Versionen können nicht gelöscht werden';
    end if;
    return old;
  end if;
  if old.status = 'entwurf' then
    return new;
  end if;
  if old.status = 'freigegeben' and new.status = 'archiviert'
     and new.punkte = old.punkte and new.abschnitte = old.abschnitte
     and new.version = old.version and new.checkliste_id = old.checkliste_id then
    return new;
  end if;
  raise exception 'Checklisten-Version % ist % und kann nicht geändert werden', old.version, old.status;
end $$;

-- Neuer Entwurf übernimmt auch die Abschnitte
create or replace function checkliste_neuer_entwurf(p_checkliste_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  vorhanden uuid;
  neueste checkliste_version;
  neu uuid;
begin
  if not ist_admin() then raise exception 'Nur Admins dürfen Checklisten bearbeiten'; end if;
  select id into vorhanden from checkliste_version where checkliste_id = p_checkliste_id and status = 'entwurf';
  if vorhanden is not null then return vorhanden; end if;
  select * into neueste from checkliste_version where checkliste_id = p_checkliste_id order by version desc limit 1;
  insert into checkliste_version (checkliste_id, version, punkte, abschnitte)
    values (p_checkliste_id, coalesce(neueste.version, 0) + 1, coalesce(neueste.punkte, '[]'::jsonb),
            coalesce(neueste.abschnitte, '[]'::jsonb))
    returning id into neu;
  return neu;
end $$;

insert into log_bezeichnung (tabelle, spalte, text) values ('checkliste_version', 'abschnitte', 'Abschnitte')
  on conflict do nothing;
