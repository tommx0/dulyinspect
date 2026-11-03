-- Version 2.89.0: Sprache der Prüfprotokolle (PDF) je Instanz. Die Oberfläche folgt der Sprache des Geräts (src/lib/sprache.ts),
-- Protokolle sind Dokumente für Kunden und Behörden und sollen nicht von der Browsersprache des Prüfers abhängen.

alter table firma add column protokoll_sprache text not null default 'de'
  constraint firma_protokoll_sprache_check check (protokoll_sprache in ('de', 'en'));
comment on column firma.protokoll_sprache is 'Sprache der Prüfprotokolle und Etiketten: de oder en';

insert into log_bezeichnung (tabelle, spalte, text) values
  ('firma', 'protokoll_sprache', 'Sprache der Prüfprotokolle')
on conflict (tabelle, spalte) do nothing;
