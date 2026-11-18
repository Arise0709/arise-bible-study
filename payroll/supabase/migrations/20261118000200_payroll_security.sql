-- Arise Payroll: database access controls.
--
-- How it works
--   * The app's server code opens each request in a transaction, records who is signed in
--     (app.user_id, app.roles, app.employee_id) with set_config(..., true), and then runs
--     SET LOCAL ROLE payroll_app. Every query after that is checked by the policies below.
--   * payroll_app is a NOLOGIN role. Nobody can sign in as it directly.
--   * The Supabase API roles (anon, authenticated) get no access to the payroll schema at all.
--   * "system" is the context used by sign-in, migrations and the demo seed only.
--
-- These policies are a second line of defense. The server code checks roles before every
-- action too, so a bug in one layer does not expose data on its own.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'payroll_app') then
    create role payroll_app nologin;
  end if;
  -- Let the migrating user (postgres on Supabase) switch into payroll_app.
  begin
    execute format('grant payroll_app to %I', current_user);
  exception when others then
    null; -- already a member, or a superuser that does not need it
  end;
end $$;

-- Context helpers ------------------------------------------------------------
create or replace function payroll.app_roles() returns text[]
language sql stable as $$
  select coalesce(string_to_array(nullif(current_setting('app.roles', true), ''), ','), '{}'::text[])
$$;

create or replace function payroll.has_any_role(wanted text[]) returns boolean
language sql stable as $$
  select payroll.app_roles() && wanted
$$;

create or replace function payroll.app_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function payroll.app_employee_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.employee_id', true), '')::uuid
$$;

-- Lock out the Supabase API roles and PUBLIC ---------------------------------
revoke all on schema payroll from public;
revoke all on all tables in schema payroll from public;
revoke all on all functions in schema payroll from public;

do $$
declare r text;
begin
  foreach r in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema payroll from %I', r);
      execute format('revoke all on all tables in schema payroll from %I', r);
      execute format('revoke all on all sequences in schema payroll from %I', r);
      execute format('revoke all on all functions in schema payroll from %I', r);
    end if;
  end loop;
end $$;

-- Grants for the app role ------------------------------------------------------
grant usage on schema payroll to payroll_app;
grant execute on all functions in schema payroll to payroll_app;
grant usage on all sequences in schema payroll to payroll_app;

grant select, insert, update on
  payroll.settings, payroll.export_profiles, payroll.employees, payroll.users,
  payroll.pay_runs, payroll.provider_imports, payroll.reconciliation_items
  to payroll_app;
grant select, insert, update, delete on
  payroll.sessions, payroll.time_entries, payroll.earnings_items, payroll.run_lines
  to payroll_app;
-- Append-only tables: no update or delete privilege at all.
grant select, insert on
  payroll.compensation_rates, payroll.housing_allowances, payroll.exports,
  payroll.provider_results, payroll.pay_statements, payroll.audit_events
  to payroll_app;

-- Row level security -----------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'settings','export_profiles','employees','compensation_rates','housing_allowances',
    'users','sessions','pay_runs','time_entries','earnings_items','run_lines','exports',
    'provider_imports','provider_results','reconciliation_items','pay_statements','audit_events'
  ] loop
    execute format('alter table payroll.%I enable row level security', t);
    execute format('alter table payroll.%I force row level security', t);
  end loop;
end $$;

-- Payroll office tables: admins, approvers and the system context only.
do $$
declare t text;
begin
  foreach t in array array[
    'settings','export_profiles','compensation_rates','housing_allowances','pay_runs',
    'time_entries','earnings_items','run_lines','exports','provider_imports',
    'provider_results','reconciliation_items'
  ] loop
    execute format(
      'create policy payroll_office on payroll.%I for all to payroll_app
         using (payroll.has_any_role(array[''admin'',''approver'',''system'']))
         with check (payroll.has_any_role(array[''admin'',''approver'',''system'']))', t);
  end loop;
end $$;

-- Staff records: the office sees everyone; a staff member sees only their own record.
create policy employees_read on payroll.employees for select to payroll_app
  using (payroll.has_any_role(array['admin','approver','system']) or id = payroll.app_employee_id());
create policy employees_write on payroll.employees for insert to payroll_app
  with check (payroll.has_any_role(array['admin','system']));
create policy employees_update on payroll.employees for update to payroll_app
  using (payroll.has_any_role(array['admin','approver','system']))
  with check (payroll.has_any_role(array['admin','approver','system']));

-- Pay statements: the office sees all; staff only their own.
create policy statements_read on payroll.pay_statements for select to payroll_app
  using (payroll.has_any_role(array['admin','approver','system']) or employee_id = payroll.app_employee_id());
create policy statements_write on payroll.pay_statements for insert to payroll_app
  with check (payroll.has_any_role(array['admin','system']));

-- Staff can see the pay run header (number, dates, status) only for runs that include
-- one of their own published statements.
create policy pay_runs_own_statement on payroll.pay_runs for select to payroll_app
  using (exists (select 1 from payroll.pay_statements s
                  where s.run_id = pay_runs.id and s.employee_id = payroll.app_employee_id()));

-- Users: admins and the system context manage accounts. Approvers can read accounts so the
-- app can show who prepared, approved and changed things. Everyone can read and update their own.
-- (Password hashes are scrypt and MFA secrets are AES-GCM encrypted with APP_SECRET; the app
-- never sends either to a browser.)
create policy users_read on payroll.users for select to payroll_app
  using (payroll.has_any_role(array['admin','approver','system']) or id = payroll.app_user_id());
create policy users_insert on payroll.users for insert to payroll_app
  with check (payroll.has_any_role(array['admin','system']));
create policy users_update on payroll.users for update to payroll_app
  using (payroll.has_any_role(array['admin','system']) or id = payroll.app_user_id())
  with check (payroll.has_any_role(array['admin','system']) or id = payroll.app_user_id());

-- A person can change their own password or MFA, but never their own roles, status or link.
create or replace function payroll.guard_user_privileges() returns trigger
language plpgsql as $$
begin
  if (new.roles, new.status, new.employee_id, new.email)
       is distinct from (old.roles, old.status, old.employee_id, old.email)
     and not payroll.has_any_role(array['admin','system']) then
    raise exception 'Only a payroll admin can change roles, status, email or staff link';
  end if;
  return new;
end $$;
create trigger users_guard before update on payroll.users
  for each row execute function payroll.guard_user_privileges();

-- Sessions are handled only by the sign-in code (system context).
create policy sessions_system on payroll.sessions for all to payroll_app
  using (payroll.has_any_role(array['system']))
  with check (payroll.has_any_role(array['system']));

-- Audit: anyone signed in can add an event; only the office can read the log.
create policy audit_insert on payroll.audit_events for insert to payroll_app
  with check (true);
create policy audit_read on payroll.audit_events for select to payroll_app
  using (payroll.has_any_role(array['admin','approver','system']));
