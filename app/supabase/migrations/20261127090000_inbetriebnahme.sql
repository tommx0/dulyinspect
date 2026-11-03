-- Version 2.87.0: Inbetriebnahme-Assistent. Nach der Ersteinrichtung führt die App den Admin schrittweise durch Firmendaten,
-- Anlagenarten, Vorlagen, Rechtstexte, Erscheinungsbild, Etiketten und Benutzer (src/seiten/Inbetriebnahme.tsx).
-- Hier steht je Schritt, wann er bestätigt oder übersprungen wurde, und wann die Inbetriebnahme abgeschlossen ist:
-- {"schritte": {"firmendaten": "<Zeitpunkt>", …}, "abgeschlossen": "<Zeitpunkt>"}.
-- Bestehende Instanzen (es gibt schon Benutzer) gelten als in Betrieb genommen; der Assistent erscheint nur bei neuen.

alter table firma add column inbetriebnahme jsonb not null default '{}'
  constraint firma_inbetriebnahme_check check (jsonb_typeof(inbetriebnahme) = 'object');
comment on column firma.inbetriebnahme is 'Inbetriebnahme-Assistent: bestätigte Schritte und Abschluss (Zeitpunkte)';

update firma set inbetriebnahme = jsonb_build_object('abgeschlossen', now())
where exists (select 1 from benutzer);

insert into log_bezeichnung (tabelle, spalte, text) values
  ('firma', 'inbetriebnahme', 'Inbetriebnahme')
on conflict (tabelle, spalte) do nothing;
