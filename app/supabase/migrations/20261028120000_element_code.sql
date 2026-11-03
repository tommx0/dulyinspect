-- Version 2.21.0: Code am Element (z. B. QR-Aufkleber eines Rauchwarnmelders, Inhalt wie „Ei650i-26W25-019DDBD8“).
-- Beim Scannen findet die App den Melder darüber. Der Code ist unter den aktiven Elementen eindeutig
-- (Groß-/Kleinschreibung egal); ein stillgelegter Melder gibt seinen Code frei, z. B. beim Austausch.
alter table anlage_element
  add column code text check (code is null or length(trim(code)) between 1 and 200);
create unique index anlage_element_code on anlage_element (lower(code)) where aktiv and code is not null;
comment on column anlage_element.code is 'Gescannter Code des Elements (Herstellercode oder eigener Code), eindeutig unter den aktiven Elementen';

insert into log_bezeichnung (tabelle, spalte, text) values ('anlage_element', 'code', 'Code (Aufkleber)')
on conflict (tabelle, spalte) do nothing;
