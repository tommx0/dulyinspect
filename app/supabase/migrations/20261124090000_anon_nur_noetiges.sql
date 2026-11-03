-- anon (jeder, der die öffentliche Adresse und den Anon-Key aus der App kennt) darf nur noch, was die App vor der Anmeldung
-- braucht: schema_stand (auch die Erreichbarkeitsprüfung), demo_modus, ersteinrichtung_offen, rechtstext_inhalt und das
-- Erscheinungsbild lesen. Bisher durfte anon wie bei Supabase üblich alle Funktionen ausführen und hatte alle Rechte an
-- allen Tabellen; geschützt hat allein RLS. Funktionen mit Eigentümerrechten wie bestand_anlage, pruefung_gesperrt oder
-- foto_pruefung gaben ohne Anmeldung Auskunft über bekannte IDs.
--
-- authenticated und service_role behalten genau die Rechte, die sie vorher hatten, auch die über PUBLIC. Nur eigene
-- Funktionen (Eigentümer = Rolle, die die Migrationen ausführt: postgres bzw. <id>_eigentuemer im Mandanten-Stack), keine
-- aus Erweiterungen. Trigger-Funktionen brauchen beim Auslösen kein EXECUTE; Regeln für anon (erscheinungsbild_lesen,
-- branding_lesen) rufen keine Funktionen auf. Neue Funktionen und Tabellen sind ab jetzt für anon gesperrt (Standardrechte),
-- supabase/tests/anon_rechte_test.sql prüft die Liste.

do $$
declare
  f regprocedure;
  fuer_angemeldete boolean;
  fuer_dienst boolean;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proowner = (select oid from pg_roles where rolname = current_user)
       and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    fuer_angemeldete := has_function_privilege('authenticated', f, 'execute');
    fuer_dienst := has_function_privilege('service_role', f, 'execute');
    execute format('revoke execute on function %s from public, anon', f);
    if fuer_angemeldete then execute format('grant execute on function %s to authenticated', f); end if;
    if fuer_dienst then execute format('grant execute on function %s to service_role', f); end if;
  end loop;
end $$;

grant execute on function schema_stand(), demo_modus(), ersteinrichtung_offen(), rechtstext_inhalt(text) to anon;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select on erscheinungsbild to anon;

-- Künftige Objekte der Rolle, die die Migrationen ausführt: authenticated und service_role wie bisher, anon nichts.
-- EXECUTE für PUBLIC ist ein Standard der ganzen Rolle und lässt sich nicht je Schema entziehen; deshalb bekommen
-- authenticated und service_role neue Funktionen ebenfalls rollenweit (wie bisher über PUBLIC), anon nicht mehr.
alter default privileges revoke execute on functions from public;
alter default privileges grant execute on functions to authenticated, service_role;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
