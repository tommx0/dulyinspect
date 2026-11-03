-- Nachweis der Lizenzbedingungen: Jeder Benutzer akzeptiert nach der Erstinstallation und nach jedem Update (App-Version) einmal.
-- Gespeichert werden Zeitpunkt, Benutzer, Version und die IP-Adresse(n) laut Proxy-Kopf (X-Forwarded-For) sowie der Browser.
-- Geschrieben wird nur über lizenz_akzeptieren(); Zeilen sind danach unveränderlich (keine Regel zum Ändern oder Löschen).
-- Lesen: jeder seine eigenen, der Admin alle.

create table lizenz_akzeptanz (
  id uuid primary key default gen_random_uuid(),
  benutzer_id uuid not null references benutzer (id),
  benutzer_name text not null,
  version text not null,
  lizenz_stand text,
  akzeptiert_am timestamptz not null default now(),
  ip text,
  user_agent text,
  unique (benutzer_id, version)
);
comment on table lizenz_akzeptanz is 'Nachweis: wer hat welche App-Version unter den Lizenzbedingungen wann (und von welcher IP) akzeptiert';
comment on column lizenz_akzeptanz.ip is 'X-Forwarded-For bzw. X-Real-IP der Anfrage (bei Proxy-Kette mehrere, kommagetrennt)';

alter table lizenz_akzeptanz enable row level security;
create policy lizenz_akzeptanz_lesen on lizenz_akzeptanz for select to authenticated
  using (benutzer_id = auth.uid() or ist_systemadmin());
create policy zwei_faktor on lizenz_akzeptanz as restrictive for all to authenticated
  using ((select zwei_faktor_erfuellt())) with check ((select zwei_faktor_erfuellt()));

-- Hat der angemeldete Benutzer diese App-Version schon akzeptiert?
create function lizenz_akzeptiert(p_version text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from lizenz_akzeptanz where benutzer_id = auth.uid() and version = p_version);
$$;
revoke all on function lizenz_akzeptiert(text) from public, anon;
grant execute on function lizenz_akzeptiert(text) to authenticated;

-- Akzeptieren festhalten (mehrfach aufrufbar: der erste Eintrag je Benutzer und Version bleibt)
create function lizenz_akzeptieren(p_version text, p_stand text default null, p_zeitpunkt timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  kopf json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  b benutzer;
begin
  select * into b from benutzer where id = auth.uid() and aktiv;
  if b.id is null then raise exception 'Nicht angemeldet'; end if;
  if coalesce(trim(p_version), '') = '' then raise exception 'Version fehlt'; end if;
  insert into lizenz_akzeptanz (benutzer_id, benutzer_name, version, lizenz_stand, akzeptiert_am, ip, user_agent)
  values (b.id, b.name, p_version, p_stand,
          -- Zeitpunkt des Klicks, falls offline nachgemeldet; nie in der Zukunft
          least(coalesce(p_zeitpunkt, now()), now()),
          nullif(trim(coalesce(kopf ->> 'x-forwarded-for', kopf ->> 'x-real-ip')), ''),
          nullif(kopf ->> 'user-agent', ''))
  on conflict (benutzer_id, version) do nothing;
end $$;
revoke all on function lizenz_akzeptieren(text, text, timestamptz) from public, anon;
grant execute on function lizenz_akzeptieren(text, text, timestamptz) to authenticated;
