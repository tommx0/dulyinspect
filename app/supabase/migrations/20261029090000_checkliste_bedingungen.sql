-- Version 2.27.0: Erweiterte Bedingungen für Prüfpunkte (nur_wenn).
-- Bisher: Bezug nur auf Ja/Nein- und Auswahl-Punkte mit ist / ist_nicht / in. Neu:
--  * Bezug auch auf i.O./n.i.O./entfällt („ist“: io | nio | entfaellt) und auf Messwerte
--  * „mangel“: true/false – die Antwort ergibt (keinen) Mangel; bei Messwerten: außerhalb/innerhalb Soll
--  * „unter“ / „ueber“: Messwert kleiner/größer als eine Zahl (beide zusammen = dazwischen)
--  * Gruppen: {"alle": [...]} = UND, {"eine": [...]} = ODER, bis zu drei Ebenen tief
-- Ausgewertet wird weiterhin in der App; hier wird nur die Struktur beim Freigeben geprüft. Bestehende Bedingungen bleiben gültig.

-- Prüft eine Bedingung (Blatt oder Gruppe). Liefert Fehlertexte (leer = gültig).
create function checkliste_bedingung_pruefen(p_bedingung jsonb, p_id text, p_vorher jsonb, p_tiefe int default 0) returns text[]
language plpgsql immutable as $$
declare
  fehler text[] := '{}';
  liste jsonb;
  kind jsonb;
  bezug jsonb;
  erlaubt text[];
  wert text;
  typ text;
  wert_op boolean;
  mangel_op boolean;
  zahl_op boolean;
begin
  if jsonb_typeof(p_bedingung) <> 'object' then
    return array[format('%s: Bedingung ungültig', p_id)];
  end if;

  if p_bedingung ? 'alle' or p_bedingung ? 'eine' then
    if p_bedingung ? 'alle' and p_bedingung ? 'eine' then
      return array[format('%s: Bedingung darf UND und ODER nicht mischen', p_id)];
    end if;
    if p_tiefe >= 3 then
      return array[format('%s: Bedingung zu tief verschachtelt', p_id)];
    end if;
    liste := coalesce(p_bedingung -> 'alle', p_bedingung -> 'eine');
    if jsonb_typeof(liste) <> 'array' or jsonb_array_length(liste) = 0 then
      return array[format('%s: Bedingungsgruppe ohne Bedingung', p_id)];
    end if;
    for kind in select * from jsonb_array_elements(liste) loop
      fehler := fehler || checkliste_bedingung_pruefen(kind, p_id, p_vorher, p_tiefe + 1);
    end loop;
    return fehler;
  end if;

  bezug := p_vorher -> (p_bedingung ->> 'punkt');
  if bezug is null then
    return array[format('%s: Bedingung verweist nicht auf einen vorherigen Punkt', p_id)];
  end if;
  typ := bezug ->> 'typ';
  if typ in ('text', 'foto') then
    return array[format('%s: Bedingung muss auf einen Punkt mit auswertbarer Antwort verweisen (nicht Freitext oder Foto)', p_id)];
  end if;

  wert_op := p_bedingung ? 'ist' or p_bedingung ? 'ist_nicht' or p_bedingung ? 'in';
  mangel_op := p_bedingung ? 'mangel';
  zahl_op := p_bedingung ? 'unter' or p_bedingung ? 'ueber';
  if not (wert_op or mangel_op or zahl_op) then
    return array[format('%s: Bedingung ohne Wert', p_id)];
  end if;
  if (wert_op::int + mangel_op::int + zahl_op::int) > 1 then
    return array[format('%s: Bedingung mischt Antwortwert, Mangel und Zahl', p_id)];
  end if;

  if wert_op then
    erlaubt := case typ
      when 'ja_nein' then array['ja', 'nein']
      when 'status' then array['io', 'nio', 'entfaellt']
      when 'auswahl' then array(select o ->> 'wert' from jsonb_array_elements(bezug -> 'optionen') o)
      else '{}'::text[] end;
    if cardinality(erlaubt) = 0 then
      return array[format('%s: Bedingung auf einen Messwert braucht „unter“, „über“ oder „Mangel“', p_id)];
    end if;
    if p_bedingung ? 'in' and jsonb_typeof(p_bedingung -> 'in') <> 'array' then
      return array[format('%s: Bedingung ohne Wert', p_id)];
    end if;
    if p_bedingung ? 'in' and jsonb_array_length(p_bedingung -> 'in') = 0 then
      fehler := fehler || format('%s: Bedingung ohne Wert', p_id);
    end if;
    for wert in
      select jsonb_array_elements_text(p_bedingung -> 'in') where p_bedingung ? 'in'
      union all select p_bedingung ->> 'ist' where p_bedingung ? 'ist'
      union all select p_bedingung ->> 'ist_nicht' where p_bedingung ? 'ist_nicht'
    loop
      if not (wert = any (erlaubt)) then
        fehler := fehler || format('%s: ungültiger Bedingungswert „%s“', p_id, wert);
      end if;
    end loop;
  elsif mangel_op then
    if jsonb_typeof(p_bedingung -> 'mangel') <> 'boolean' or typ not in ('status', 'messwert', 'ja_nein', 'auswahl') then
      fehler := fehler || format('%s: Bedingung „Mangel“ passt nicht zum Punkt „%s“', p_id, bezug ->> 'id');
    end if;
  else
    if typ <> 'messwert' then
      fehler := fehler || format('%s: Bedingung „unter/über“ braucht einen Messwert-Punkt', p_id);
    elsif (p_bedingung ? 'unter' and jsonb_typeof(p_bedingung -> 'unter') <> 'number')
       or (p_bedingung ? 'ueber' and jsonb_typeof(p_bedingung -> 'ueber') <> 'number') then
      fehler := fehler || format('%s: Bedingung braucht eine Zahl', p_id);
    end if;
  end if;
  return fehler;
end $$;

-- Prüft die Punkte-Struktur. Liefert Fehlertexte (leer = gültig).
create or replace function checkliste_punkte_pruefen(p_punkte jsonb) returns text[]
language plpgsql immutable as $$
declare
  fehler text[] := '{}';
  punkt jsonb;
  vorher jsonb := '{}'::jsonb;
  typen constant text[] := array['status','messwert','ja_nein','auswahl','text','foto'];
begin
  if jsonb_array_length(p_punkte) = 0 then
    return array['Checkliste enthält keine Prüfpunkte'];
  end if;
  for punkt in select * from jsonb_array_elements(p_punkte) loop
    if coalesce(punkt ->> 'id', '') = '' or coalesce(punkt ->> 'text', '') = '' then
      fehler := fehler || 'Prüfpunkt ohne ID oder Text';
      continue;
    end if;
    if vorher ? (punkt ->> 'id') then
      fehler := fehler || format('Doppelte Punkt-ID %s', punkt ->> 'id');
    end if;
    if not (punkt ->> 'typ' = any (typen)) then
      fehler := fehler || format('%s: unbekannter Typ %s', punkt ->> 'id', punkt ->> 'typ');
    end if;
    if punkt ->> 'typ' = 'auswahl' and jsonb_array_length(coalesce(punkt -> 'optionen', '[]')) < 2 then
      fehler := fehler || format('%s: Auswahl braucht mindestens 2 Optionen', punkt ->> 'id');
    end if;
    if (punkt ->> 'verifizieren')::boolean is true then
      fehler := fehler || format('%s: Grenzwert noch nicht fachlich bestätigt', punkt ->> 'id');
    end if;
    if punkt ? 'nur_wenn' then
      fehler := fehler || checkliste_bedingung_pruefen(punkt -> 'nur_wenn', punkt ->> 'id', vorher);
    end if;
    vorher := vorher || jsonb_build_object(punkt ->> 'id', punkt);
  end loop;
  return fehler;
end $$;
