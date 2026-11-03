-- Menüpunkte, die Admin oder Planer für Prüfer ausblenden (Fälligkeiten, Mängel, Kunden, Hilfe).
-- Eine Zeile; lesen dürfen alle aktiven Benutzer, ändern Admin und Planer.
-- Reine Anzeige-Einstellung – bewusst nicht Teil der Datensicherung.

create table menue_pruefer (
  id int primary key default 1 check (id = 1),
  ausgeblendet text[] not null default '{}'
    constraint menue_pruefer_bereiche check (ausgeblendet <@ array['faelligkeiten', 'maengel', 'kunden', 'hilfe']),
  geaendert_am timestamptz not null default now()
);
insert into menue_pruefer (id) values (1);
create trigger menue_pruefer_geaendert_am before update on menue_pruefer for each row execute function setze_geaendert_am();
create trigger menue_pruefer_audit after insert or update or delete on menue_pruefer for each row execute function audit();

alter table menue_pruefer enable row level security;
create policy menue_pruefer_lesen on menue_pruefer for select to authenticated using (ist_aktiv());
create policy menue_pruefer_aendern on menue_pruefer for update to authenticated using (ist_admin()) with check (ist_admin());
