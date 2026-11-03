-- Version 2.29.0: Wirkungen an Prüfpunkten (Feld "wirkungen" in checkliste_version.punkte).
-- Eine Wirkung gilt, solange ihre Bedingung ("wenn", gleiche Form wie nur_wenn) zutrifft; der Punkt bleibt dabei sichtbar:
--   "pflicht": true       der Punkt wird zur Pflichtangabe
--   "stufe": 1..3         ein Mangel hat mindestens diese Stufe (bei Status, Messwert, Ja/Nein, Auswahl)
--   "soll_min"/"soll_max" Grenzwerte eines Messwerts ersetzen die des Punkts
-- Ausgewertet wird in der App (Prüfung, Protokoll); hier wird nur die Struktur beim Freigeben geprüft.
-- Bestehende Checklisten ohne "wirkungen" bleiben unverändert gültig.

create function checkliste_wirkungen_pruefen(p_punkt jsonb, p_vorher jsonb) returns text[]
language plpgsql immutable as $$
declare
  fehler text[] := '{}';
  pid text := p_punkt ->> 'id';
  typ text := p_punkt ->> 'typ';
  w jsonb;
  grenze boolean;
begin
  if jsonb_typeof(p_punkt -> 'wirkungen') <> 'array' or jsonb_array_length(p_punkt -> 'wirkungen') = 0 then
    return array[format('%s: Wirkungen ungültig', pid)];
  end if;
  for w in select * from jsonb_array_elements(p_punkt -> 'wirkungen') loop
    if jsonb_typeof(w) <> 'object' then
      fehler := fehler || format('%s: Wirkungen ungültig', pid);
      continue;
    end if;
    if not (w ? 'wenn') then
      fehler := fehler || format('%s: Wirkung ohne Bedingung', pid);
    else
      fehler := fehler || checkliste_bedingung_pruefen(w -> 'wenn', pid, p_vorher);
    end if;
    grenze := w ? 'soll_min' or w ? 'soll_max';
    if not (w ? 'pflicht' or w ? 'stufe' or grenze) then
      fehler := fehler || format('%s: Wirkung ohne Folge', pid);
    end if;
    if w ? 'pflicht' and w -> 'pflicht' <> 'true'::jsonb then
      fehler := fehler || format('%s: Wirkung „Pflicht“ muss „ja“ sein', pid);
    end if;
    if w ? 'stufe' then
      if jsonb_typeof(w -> 'stufe') <> 'number' or (w ->> 'stufe')::numeric not in (1, 2, 3) then
        fehler := fehler || format('%s: Wirkung hat eine ungültige Mangelstufe', pid);
      elsif typ not in ('status', 'messwert', 'ja_nein', 'auswahl') then
        fehler := fehler || format('%s: Wirkung „Mangelstufe“ passt nicht zum Antworttyp', pid);
      end if;
    end if;
    if grenze then
      if typ <> 'messwert' then
        fehler := fehler || format('%s: Wirkung „Grenzwert“ gilt nur für Messwerte', pid);
      elsif (w ? 'soll_min' and jsonb_typeof(w -> 'soll_min') <> 'number') or (w ? 'soll_max' and jsonb_typeof(w -> 'soll_max') <> 'number') then
        fehler := fehler || format('%s: Wirkung hat einen ungültigen Grenzwert', pid);
      elsif w ? 'soll_min' and w ? 'soll_max' and (w ->> 'soll_min')::numeric > (w ->> 'soll_max')::numeric then
        fehler := fehler || format('%s: Wirkung: Soll-Minimum ist größer als Soll-Maximum', pid);
      end if;
    end if;
  end loop;
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
    if punkt ? 'wirkungen' then
      fehler := fehler || checkliste_wirkungen_pruefen(punkt, vorher);
    end if;
    vorher := vorher || jsonb_build_object(punkt ->> 'id', punkt);
  end loop;
  return fehler;
end $$;
