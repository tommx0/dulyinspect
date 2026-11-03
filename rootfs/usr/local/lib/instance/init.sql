-- Runs once when the database is created, after core.sql (as supabase_admin).
-- Every service gets its own password.
\set pw_supabase_admin `echo "$PW_SUPABASE_ADMIN"`
\set pw_postgres `echo "$PW_POSTGRES"`
\set pw_authenticator `echo "$PW_AUTHENTICATOR"`
\set pw_auth `echo "$PW_AUTH"`
\set pw_storage `echo "$PW_STORAGE"`
\set pw_realtime_meta `echo "$PW_REALTIME_META"`
\set jwt_secret `echo "$JWT_SECRET"`

alter role supabase_admin password :'pw_supabase_admin';
alter role postgres password :'pw_postgres';
alter role authenticator password :'pw_authenticator';
alter role supabase_auth_admin password :'pw_auth';
alter role supabase_storage_admin password :'pw_storage';

-- Roles that nobody needs to log in with here
do $$
declare r text;
begin
  for r in select rolname from pg_roles where rolname in ('pgbouncer', 'supabase_functions_admin', 'supabase_replication_admin',
      'supabase_read_only_user', 'dashboard_user') loop
    execute format('alter role %I nologin', r);
  end loop;
end $$;

alter database postgres set "app.settings.jwt_secret" to :'jwt_secret';
alter database postgres set "app.settings.jwt_exp" to '3600';

-- State of the app migrations, as with "supabase db push"
create schema if not exists supabase_migrations authorization postgres;
create table if not exists supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text);
alter table supabase_migrations.schema_migrations owner to postgres;

-- Realtime metadata in a separate database (as in the multi-tenant stack)
create role realtime_meta login password :'pw_realtime_meta';
create database realtime_meta owner realtime_meta;
revoke connect, temporary on database realtime_meta from public;
\c realtime_meta
create schema _realtime authorization realtime_meta;
