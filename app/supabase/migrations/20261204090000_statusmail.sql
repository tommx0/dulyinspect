-- Version 2.92.0: Statusmail (Konzept docs/KONZEPT-MAIL.md, Schritt 4). Im eingestellten Intervall eine Mail an eine feste
-- Adressliste: Prüfungen des abgelaufenen Zeitraums, überfällige und im nächsten Zeitraum fällige Prüfungen, dazu CSV.
-- Den Takt gibt die Mandanten-Verwaltung (stündlich, pg_cron ist im Mandanten-Stack gesperrt) bzw. in der Einzelinstanz ein
-- eigener Dienst; die Edge Function „mail-takt“ entscheidet selbst, ob etwas fällig ist.

alter table mail_einstellung
  add column status_aktiv boolean not null default false,
  add column status_empfaenger text[] not null default '{}'
    check (cardinality(status_empfaenger) <= 20),
  add column status_intervall text not null default 'woechentlich' check (status_intervall in ('taeglich', 'woechentlich', 'monatlich')),
  -- ISO: 1 = Montag … 7 = Sonntag
  add column status_wochentag int not null default 1 check (status_wochentag between 1 and 7),
  -- bis 28, damit es den Tag in jedem Monat gibt
  add column status_monatstag int not null default 1 check (status_monatstag between 1 and 28),
  add column status_uhrzeit time not null default '07:00' check (status_uhrzeit = date_trunc('minute', status_uhrzeit)),
  -- Adresse der App für Links in Mails (die Edge Functions kennen nur die der API); setzt die Function mail beim Speichern
  add column app_adresse text check (app_adresse ~ '^https?://[A-Za-z0-9.:\[\]-]+$'),
  add constraint mail_einstellung_status_empfaenger check (cardinality(status_empfaenger) > 0 or not status_aktiv);

insert into log_bezeichnung (tabelle, spalte, text) values
  ('mail_einstellung', 'status_aktiv', 'Statusmail'),
  ('mail_einstellung', 'status_empfaenger', 'Empfänger der Statusmail'),
  ('mail_einstellung', 'status_intervall', 'Intervall der Statusmail'),
  ('mail_einstellung', 'status_wochentag', 'Wochentag der Statusmail'),
  ('mail_einstellung', 'status_monatstag', 'Tag im Monat der Statusmail'),
  ('mail_einstellung', 'status_uhrzeit', 'Uhrzeit der Statusmail'),
  ('mail_einstellung', 'app_adresse', 'Adresse der App')
on conflict (tabelle, spalte) do nothing;

-- Stand des Versands: bis wohin gemeldet ist, Fehlversuche. Nur für die Service-Rolle (über die Funktionen unten).
create table intern.mail_stand (
  id int primary key default 1 check (id = 1),
  status_bis timestamptz,
  status_gesendet_am timestamptz,
  status_fehler int not null default 0,
  status_letzter_fehler text
);
revoke all on intern.mail_stand from public, anon, authenticated;
insert into intern.mail_stand default values;

create function mail_stand() returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(s) - 'id' from intern.mail_stand s where id = 1;
$$;

-- Zeitraum bis p_termin beanspruchen, bevor gesendet wird: Nur ein gleichzeitiger Aufruf bekommt true (Zeilensperre),
-- so geht nie eine Statusmail doppelt hinaus. Liefert den Beginn des Zeitraums (bisheriges status_bis, beim ersten Mal
-- -infinity: dann rechnet die Function ein Intervall zurück) oder null, wenn schon gemeldet.
create function mail_status_beanspruchen(p_termin timestamptz) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  alt timestamptz;
begin
  select status_bis into alt from intern.mail_stand where id = 1 for update;
  if alt is not null and alt >= p_termin then return null; end if;
  update intern.mail_stand set status_bis = p_termin where id = 1;
  return coalesce(alt, '-infinity'::timestamptz);
end $$;

-- Ergebnis des Versands: ok → Zähler zurück; Fehler → Zeitraum freigeben (status_bis wieder auf p_alt), Zähler hoch
create function mail_status_ergebnis(p_ok boolean, p_alt timestamptz, p_fehler text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_ok then
    update intern.mail_stand set status_gesendet_am = now(), status_fehler = 0, status_letzter_fehler = null where id = 1;
  else
    update intern.mail_stand set status_bis = nullif(p_alt, '-infinity'::timestamptz), status_fehler = status_fehler + 1,
      status_letzter_fehler = left(p_fehler, 300) where id = 1;
  end if;
end $$;

-- Neue Einstellung (eingeschaltet, anderes Intervall): als gemeldet bis zum letzten Termin vor jetzt gelten lassen, damit die
-- erste Statusmail zum nächsten Termin kommt und einen vollen Zeitraum umfasst statt rückwirkend sofort
create function mail_status_neu_beginnen(p_ab timestamptz) returns void
language sql security definer set search_path = public as $$
  update intern.mail_stand set status_bis = p_ab, status_fehler = 0, status_letzter_fehler = null where id = 1;
$$;

-- Verschlüsselte Werte (Konzept Verschlüsselung) nie in eine Mail: der Server kennt den Schlüssel nicht
create function klartext_oder_null(p_wert text) returns text
language sql immutable set search_path = public as $$
  select case when p_wert is null or ist_geheimtext(p_wert) then null else p_wert end;
$$;

/*
 * Inhalt der Statusmail als JSON: Prüfungen mit abgeschlossen_am in [p_von, p_bis), Fälligkeiten (je Anlage und aktiver
 * Prüfart wie die Fälligkeitsliste der App, ohne den Typ Türanlage) überfällig vor p_heute und fällig in
 * [p_heute, p_naechster). Kunde und Objekt nur im Klartext, sonst null.
 */
create function statusbericht(p_von timestamptz, p_bis timestamptz, p_heute date, p_naechster date) returns jsonb
language sql stable security definer set search_path = public as $$
  with anlagen as (
    select a.id, a.etikett_id, a.kunden_bezeichnung, t.name as typ, t.anlagenart, t.id as typ_id,
           klartext_oder_null(o.name) as objekt, klartext_oder_null(o.ort) as ort, klartext_oder_null(k.name) as kunde
    from anlage a
    join anlagentyp t on t.id = a.anlagentyp_id
    join objekt o on o.id = a.objekt_id
    join endkunde k on k.id = o.endkunde_id
    where a.status = 'aktiv' and o.aktiv and k.aktiv
  ),
  pruefungen as (
    select p.id as pruefung_id, p.abgeschlossen_am, coalesce(p.ergebnis, p.ergebnis_auto)::text as ergebnis, p.protokoll_nr,
           pa.name as pruefart, b.name as pruefer, a.*,
           (select count(*) from mangel m where m.entdeckt_in = p.id) as maengel,
           (select max(m.stufe) from mangel m where m.entdeckt_in = p.id) as hoechste_stufe
    from anlagenpruefung p
    join anlagen a on a.id = p.anlage_id
    left join pruefart pa on pa.id = p.pruefart_id
    left join benutzer b on b.id = p.pruefer_id
    where p.status = 'geprueft' and p.abgeschlossen_am >= p_von and p.abgeschlossen_am < p_bis
  ),
  faellig as (
    select f.naechste_pruefung_am, f.letzte_pruefung_am, pa.name as pruefart, a.*
    from anlagen a
    join pruefart pa on pa.anlagentyp_id = a.typ_id and pa.aktiv
    join anlage_faelligkeit f on f.anlage_id = a.id and f.pruefart_id = pa.id
    where a.typ_id <> '00000000-0000-4000-8000-00000000a001' and f.naechste_pruefung_am < p_naechster
  )
  select jsonb_build_object(
    'pruefungen', coalesce((select jsonb_agg(jsonb_build_object(
        'am', abgeschlossen_am, 'ergebnis', ergebnis, 'protokoll', protokoll_nr, 'pruefart', pruefart, 'pruefer', pruefer,
        'maengel', maengel, 'stufe', hoechste_stufe, 'etikett', etikett_id, 'bezeichnung', kunden_bezeichnung, 'typ', typ,
        'objekt', objekt, 'ort', ort, 'kunde', kunde) order by abgeschlossen_am) from pruefungen), '[]'),
    'ueberfaellig', coalesce((select jsonb_agg(jsonb_build_object(
        'faellig', naechste_pruefung_am, 'letzte', letzte_pruefung_am, 'pruefart', pruefart, 'etikett', etikett_id,
        'bezeichnung', kunden_bezeichnung, 'typ', typ, 'objekt', objekt, 'ort', ort, 'kunde', kunde)
        order by naechste_pruefung_am, etikett_id) from faellig where naechste_pruefung_am < p_heute), '[]'),
    'demnaechst', coalesce((select jsonb_agg(jsonb_build_object(
        'faellig', naechste_pruefung_am, 'letzte', letzte_pruefung_am, 'pruefart', pruefart, 'etikett', etikett_id,
        'bezeichnung', kunden_bezeichnung, 'typ', typ, 'objekt', objekt, 'ort', ort, 'kunde', kunde)
        order by naechste_pruefung_am, etikett_id) from faellig where naechste_pruefung_am >= p_heute), '[]'),
    'kennzahlen', jsonb_build_object(
      'pruefungen', (select count(*) from pruefungen),
      'gruen', (select count(*) from pruefungen where ergebnis = 'gruen'),
      'gelb', (select count(*) from pruefungen where ergebnis = 'gelb'),
      'rot', (select count(*) from pruefungen where ergebnis = 'rot'),
      'maengel_neu', (select jsonb_build_object('1', count(*) filter (where m.stufe = 1), '2', count(*) filter (where m.stufe = 2),
                        '3', count(*) filter (where m.stufe = 3))
                      from mangel m join pruefungen p on p.pruefung_id = m.entdeckt_in),
      'maengel_offen', (select count(*) from mangel m join anlagen a on a.id = m.anlage_id where m.status = 'offen'),
      'ueberfaellig', (select count(*) from faellig where naechste_pruefung_am < p_heute),
      'demnaechst', (select count(*) from faellig where naechste_pruefung_am >= p_heute),
      -- Anlagen mit aktiver Prüfart ohne Fälligkeit: noch nie geprüft
      'nie_geprueft', (select count(*) from anlagen a join pruefart pa on pa.anlagentyp_id = a.typ_id and pa.aktiv
                       where a.typ_id <> '00000000-0000-4000-8000-00000000a001'
                         and not exists (select 1 from anlage_faelligkeit f where f.anlage_id = a.id and f.pruefart_id = pa.id)),
      'verschluesselt', exists (select 1 from objekt o where ist_geheimtext(o.name)) or exists (select 1 from endkunde k where ist_geheimtext(k.name))
    )
  );
$$;

revoke all on function mail_stand() from public, anon, authenticated;
revoke all on function mail_status_beanspruchen(timestamptz) from public, anon, authenticated;
revoke all on function mail_status_ergebnis(boolean, timestamptz, text) from public, anon, authenticated;
revoke all on function mail_status_neu_beginnen(timestamptz) from public, anon, authenticated;
revoke all on function statusbericht(timestamptz, timestamptz, date, date) from public, anon, authenticated;
revoke all on function klartext_oder_null(text) from public, anon, authenticated;
grant execute on function mail_stand(), mail_status_beanspruchen(timestamptz), mail_status_ergebnis(boolean, timestamptz, text),
  mail_status_neu_beginnen(timestamptz), statusbericht(timestamptz, timestamptz, date, date), klartext_oder_null(text) to service_role;
