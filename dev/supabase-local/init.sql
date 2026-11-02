-- Local stand-in for the roles a Supabase project already has. Development and tests only.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login password 'local-dev-only' noinherit;
grant anon, authenticated, service_role to authenticator;
create role supabase_auth_admin login password 'local-dev-only' createrole;
create schema auth authorization supabase_auth_admin;
grant usage on schema auth to anon, authenticated, service_role;
alter role supabase_auth_admin set search_path = auth;
grant create on database postgres to supabase_auth_admin;
grant usage on schema public to anon, authenticated, service_role;
