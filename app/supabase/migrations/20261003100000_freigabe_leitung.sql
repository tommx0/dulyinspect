-- Sessionleitung/Admin gibt die laufende Türprüfung eines Kollegen frei (z. B. Kollege nicht mehr erreichbar).
-- Damit das Gerät des Kollegen die Prüfung später nicht wieder anlegt, wird die Freigabe vermerkt:
-- sein Gerät verwirft die Prüfung beim nächsten Abgleich, und der Server lehnt eine erneute Anlage ab.
-- Technische Hilfstabelle nur für laufende Prüfungen – bewusst nicht Teil der Datensicherung.

create table tuerpruefung_freigabe (
  id uuid primary key,  -- ID der freigegebenen Türprüfung
  session_id uuid not null references session (id) on delete cascade,
  tuer_id uuid not null references tuer (id) on delete cascade,
  pruefer_id uuid not null references benutzer (id),
  freigegeben_von uuid not null default auth.uid() references benutzer (id),
  am timestamptz not null default now()
);
create index on tuerpruefung_freigabe (session_id);
alter table tuerpruefung_freigabe enable row level security;
create policy tuerpruefung_freigabe_lesen on tuerpruefung_freigabe for select to authenticated
  using (ist_teilnehmer(session_id) or ist_admin());

create or replace function reservierung_aufheben(p_tuerpruefung_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  tp tuerpruefung;
begin
  select * into tp from tuerpruefung where id = p_tuerpruefung_id;
  if tp.id is null then return; end if;
  if not (tp.pruefer_id = auth.uid() or ist_leiter(tp.session_id) or ist_admin()) then
    raise exception 'Nur der Prüfer selbst oder der Sessionleiter kann die Reservierung aufheben';
  end if;
  if tp.status <> 'in_pruefung' then raise exception 'Nur laufende Prüfungen können freigegeben werden'; end if;
  if tp.pruefer_id <> auth.uid() then
    insert into tuerpruefung_freigabe (id, session_id, tuer_id, pruefer_id)
      values (tp.id, tp.session_id, tp.tuer_id, tp.pruefer_id) on conflict (id) do nothing;
  end if;
  delete from foto where bezug_typ = 'mangel' and bezug_id in (select id from mangel where entdeckt_in = tp.id);
  delete from foto where bezug_typ = 'antwort' and bezug_id in (select id from antwort where tuerpruefung_id = tp.id);
  delete from mangel where entdeckt_in = tp.id;
  delete from antwort where tuerpruefung_id = tp.id;
  delete from tuerpruefung where id = tp.id;
end $$;

create function tuerpruefung_nicht_freigegeben() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from tuerpruefung_freigabe where id = new.id) then
    raise exception 'Diese Türprüfung wurde von der Sessionleitung freigegeben und kann nicht mehr übertragen werden';
  end if;
  return new;
end $$;
create trigger tuerpruefung_nicht_freigegeben before insert on tuerpruefung
  for each row execute function tuerpruefung_nicht_freigegeben();

-- Sessionleitung übertragen: wie bisher, zusätzlich muss der neue Leiter aktiv sein
create or replace function sessionleitung_uebertragen(p_session_id uuid, p_benutzer_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (ist_leiter(p_session_id) or ist_admin()) then raise exception 'Nur der Sessionleiter'; end if;
  if not session_offen(p_session_id) then raise exception 'Die Prüfung ist bereits abgeschlossen'; end if;
  if not exists (select 1 from session_teilnehmer st join benutzer b on b.id = st.benutzer_id
                  where st.session_id = p_session_id and st.benutzer_id = p_benutzer_id and b.aktiv) then
    raise exception 'Der neue Leiter muss an der Prüfung teilnehmen';
  end if;
  update session set leiter_id = p_benutzer_id where id = p_session_id;
end $$;
