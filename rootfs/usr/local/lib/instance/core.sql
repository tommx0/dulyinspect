-- Minimal Supabase core: the roles and schemas that PostgREST, GoTrue, Storage, Realtime and the app migrations expect.
-- Runs once when the database is created, as superuser supabase_admin (before init.sql, which sets the passwords).
-- GoTrue and Storage create the tables in auth and storage through their own migrations, the app migrations create the
-- app tables (as postgres). Modelled on the init scripts of supabase/postgres.

-- Owner of the app tables and the database; as with Supabase not a superuser
create role postgres login bypassrls;
alter database postgres owner to postgres;
alter schema public owner to postgres;
alter role postgres set search_path to "$user", public, extensions;

-- API roles: PostgREST logs in as authenticator and switches to one of them per request
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit;
grant anon, authenticated, service_role to authenticator;
-- Referenced by GoTrue migrations, never logs in
create role dashboard_user nologin;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;

create schema extensions authorization postgres;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- GoTrue (authentication)
create role supabase_auth_admin login noinherit createrole noreplication;
create schema auth authorization supabase_auth_admin;
alter role supabase_auth_admin set search_path = auth;
grant usage on schema auth to anon, authenticated, service_role, postgres;

-- Storage (files): switches to the API roles for RLS
create role supabase_storage_admin login noinherit createrole noreplication;
create schema storage authorization supabase_storage_admin;
alter role supabase_storage_admin set search_path = storage;
grant anon, authenticated, service_role to supabase_storage_admin;
grant usage on schema storage to anon, authenticated, service_role, postgres;

-- The app migrations create policies on storage.objects and foreign keys to auth.users (as with Supabase)
grant supabase_auth_admin, supabase_storage_admin to postgres;

-- Realtime: the app migrations add tables to this publication
create publication supabase_realtime;
alter publication supabase_realtime owner to postgres;

-- pg_cron: the app migration supportzugang schedules a job as postgres
create extension if not exists pg_cron;
grant usage on schema cron to postgres;
