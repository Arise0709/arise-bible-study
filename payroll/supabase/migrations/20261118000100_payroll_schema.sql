-- Arise Payroll: core schema.
-- All payroll data lives in the private "payroll" schema. It is not exposed through the
-- Supabase Data API (which only serves "public" by default), and a later migration revokes
-- every privilege from the anon and authenticated API roles as a second lock.
-- Money is stored in integer cents. Hours are numeric(7,2).

create schema if not exists payroll;

-- ---------------------------------------------------------------------------
-- Settings (single row)
-- ---------------------------------------------------------------------------
create table payroll.settings (
  id                         int primary key default 1 check (id = 1),
  org_name                   text not null default 'Arise Church',
  org_city_state             text not null default 'Decatur, Alabama',
  require_separate_approver  boolean not null default true,
  overtime_multiplier        numeric(4,2) not null default 1.50 check (overtime_multiplier >= 1),
  pay_schedule               text not null default 'biweekly'
                               check (pay_schedule in ('weekly','biweekly','semimonthly','monthly')),
  schedule_anchor_start      date not null default date '2026-11-09',
  payday_offset_days         int not null default 5 check (payday_offset_days between 0 and 30),
  active_export_profile_id   uuid,
  -- Hard locks for version 1. The check constraints make it impossible to switch these on
  -- without a new, reviewed migration.
  live_money_movement        boolean not null default false check (live_money_movement = false),
  tax_filing                 boolean not null default false check (tax_filing = false),
  updated_at                 timestamptz not null default now()
);

create table payroll.export_profiles (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text not null default '',
  columns      jsonb not null,   -- [{ "header": "Employee ID", "field": "employee_code" }, ...]
  date_format  text not null default 'YYYY-MM-DD' check (date_format in ('YYYY-MM-DD','MM/DD/YYYY')),
  amount_format text not null default 'dollars' check (amount_format in ('dollars','cents')),
  include_banner boolean not null default true,  -- first row says REVIEW COPY; turn off for provider imports
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table payroll.settings
  add constraint settings_export_profile_fk foreign key (active_export_profile_id)
  references payroll.export_profiles(id);

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
create table payroll.employees (
  id                          uuid primary key default gen_random_uuid(),
  employee_code               text not null unique,
  first_name                  text not null,
  last_name                   text not null,
  email                       text not null,
  phone                       text not null default '',
  address_line                text not null default '',
  city                        text not null default '',
  state                       text not null default 'AL',
  postal_code                 text not null default '',
  job_title                   text not null default '',
  worker_type                 text not null check (worker_type in ('employee','clergy','contractor')),
  pay_type                    text not null check (pay_type in ('hourly','salary','contract')),
  flsa_status                 text not null default 'nonexempt' check (flsa_status in ('nonexempt','exempt','not_applicable')),
  start_date                  date not null,
  active                      boolean not null default true,
  -- Review flag: worker classification (employee vs contractor, minister status)
  classification_confirmed    boolean not null default false,
  classification_confirmed_by uuid,
  classification_confirmed_at timestamptz,
  classification_note         text not null default '',
  -- Review flag: how clergy compensation is configured at the payroll provider
  clergy_config_confirmed     boolean not null default false,
  clergy_config_confirmed_by  uuid,
  clergy_config_confirmed_at  timestamptz,
  clergy_config_note          text not null default '',
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint pay_type_matches_worker check (
    (worker_type = 'contractor' and pay_type = 'contract') or
    (worker_type = 'clergy' and pay_type = 'salary') or
    (worker_type = 'employee' and pay_type in ('hourly','salary'))
  )
);

-- Pay rates by effective date. Append-only: a change is a new row, so history stays intact.
--   hourly   -> amount_cents is the hourly rate
--   salary   -> amount_cents is the annual salary (for clergy: total annual cash compensation,
--               including any designated housing allowance)
--   contract -> amount_cents is a default per-period fee (0 = enter payments per run)
create table payroll.compensation_rates (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references payroll.employees(id),
  pay_type       text not null check (pay_type in ('hourly','salary','contract')),
  amount_cents   bigint not null check (amount_cents >= 0),
  effective_date date not null,
  reason         text not null default '',
  created_by     uuid,
  created_at     timestamptz not null default now(),
  unique (employee_id, effective_date)
);

-- Clergy housing allowance designations. Append-only.
-- The designated amount is a portion of the minister's total compensation, approved in advance
-- by the church's governing body. It is not added on top of salary.
create table payroll.housing_allowances (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references payroll.employees(id),
  annual_amount_cents bigint not null check (annual_amount_cents >= 0),
  effective_date      date not null,
  approval_reference  text not null check (length(trim(approval_reference)) > 0),
  approved_by_body    text not null default '',
  approved_on         date,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  unique (employee_id, effective_date)
);

-- ---------------------------------------------------------------------------
-- Users and sessions (invite-only)
-- ---------------------------------------------------------------------------
create table payroll.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null unique check (email = lower(email)),
  display_name       text not null,
  roles              text[] not null default '{staff}'
                       check (roles <@ array['admin','approver','staff']::text[] and cardinality(roles) > 0),
  employee_id        uuid unique references payroll.employees(id),
  status             text not null default 'invited' check (status in ('invited','active','disabled')),
  password_hash      text,
  invite_token_hash  text unique,
  invite_expires_at  timestamptz,
  mfa_secret_enc     text,
  mfa_enabled_at     timestamptz,
  mfa_last_step      bigint,          -- last accepted TOTP time step, blocks code replay
  failed_logins      int not null default 0,
  locked_until       timestamptz,
  last_login_at      timestamptz,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table payroll.sessions (
  token_hash    text primary key,
  user_id       uuid not null references payroll.users(id) on delete cascade,
  mfa_verified  boolean not null default false,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null
);
create index sessions_user_idx on payroll.sessions(user_id);

-- ---------------------------------------------------------------------------
-- Pay runs
-- ---------------------------------------------------------------------------
create table payroll.pay_runs (
  id                 uuid primary key default gen_random_uuid(),
  run_number         int generated always as identity,
  kind               text not null default 'regular' check (kind in ('regular','correction')),
  corrects_run_id    uuid references payroll.pay_runs(id),
  schedule           text not null check (schedule in ('weekly','biweekly','semimonthly','monthly')),
  period_start       date not null,
  period_end         date not null,
  pay_date           date not null,
  status             text not null default 'draft'
                       check (status in ('draft','submitted','approved','exported','reconciled','voided')),
  notes              text not null default '',
  revision           int not null default 1,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  submitted_by       uuid,
  submitted_at       timestamptz,
  approved_by        uuid,
  approved_at        timestamptz,
  approved_revision  int,
  self_approved      boolean not null default false,
  return_reason      text,
  returned_by        uuid,
  returned_at        timestamptz,
  provider_batch_ref text,
  provider_batch_recorded_by uuid,
  provider_batch_recorded_at timestamptz,
  reconciled_by      uuid,
  reconciled_at      timestamptz,
  voided_by          uuid,
  voided_at          timestamptz,
  void_reason        text,
  updated_at         timestamptz not null default now(),
  check (period_end >= period_start),
  check (status <> 'voided' or void_reason is not null)
);
create unique index pay_runs_one_regular_per_period
  on payroll.pay_runs(period_start, period_end)
  where kind = 'regular' and status <> 'voided';

create table payroll.time_entries (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references payroll.pay_runs(id),
  employee_id     uuid not null references payroll.employees(id),
  work_date       date,
  regular_hours   numeric(7,2) not null default 0 check (regular_hours >= 0 and regular_hours <= 200),
  overtime_hours  numeric(7,2) not null default 0 check (overtime_hours >= 0 and overtime_hours <= 100),
  status          text not null default 'pending' check (status in ('pending','approved')),
  source          text not null default 'manual' check (source in ('manual','csv')),
  note            text not null default '',
  created_by      uuid,
  created_at      timestamptz not null default now(),
  approved_by     uuid,
  approved_at     timestamptz
);
create index time_entries_run_idx on payroll.time_entries(run_id);

create table payroll.earnings_items (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references payroll.pay_runs(id),
  employee_id   uuid not null references payroll.employees(id),
  kind          text not null check (kind in ('bonus','other_earning','reimbursement','deduction','contractor_payment')),
  description   text not null,
  amount_cents  bigint not null check (amount_cents > 0),
  created_by    uuid,
  created_at    timestamptz not null default now()
);
create index earnings_items_run_idx on payroll.earnings_items(run_id);

-- Calculated lines. Rebuilt while a run is a draft; frozen once it is submitted.
create table payroll.run_lines (
  id                  uuid primary key default gen_random_uuid(),
  run_id              uuid not null references payroll.pay_runs(id),
  employee_id         uuid not null references payroll.employees(id),
  worker_type         text not null,
  category            text not null check (category in ('earning','reimbursement','deduction','contractor')),
  line_type           text not null,
  description         text not null,
  hours               numeric(7,2),
  rate_cents          bigint,
  amount_cents        bigint not null,
  rate_effective_date date,
  sort_order          int not null default 0
);
create index run_lines_run_idx on payroll.run_lines(run_id);

-- ---------------------------------------------------------------------------
-- Provider handoff
-- ---------------------------------------------------------------------------
create table payroll.exports (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references payroll.pay_runs(id),
  profile_id    uuid references payroll.export_profiles(id),
  profile_name  text not null,
  kind          text not null check (kind in ('employee','contractor')),
  filename      text not null,
  content       text not null,
  row_count     int not null,
  total_cents   bigint not null,
  sha256        text not null,
  run_revision  int not null,
  created_by    uuid,
  created_at    timestamptz not null default now()
);

create table payroll.provider_imports (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references payroll.pay_runs(id),
  filename     text not null,
  content      text not null,
  row_count    int not null,
  is_current   boolean not null default true,
  imported_by  uuid,
  imported_at  timestamptz not null default now()
);

create table payroll.provider_results (
  id                         uuid primary key default gen_random_uuid(),
  import_id                  uuid not null references payroll.provider_imports(id),
  run_id                     uuid not null references payroll.pay_runs(id),
  employee_id                uuid references payroll.employees(id),
  employee_code              text not null,
  gross_cents                bigint not null,
  reimbursement_cents        bigint not null default 0,
  federal_withholding_cents  bigint not null default 0,
  state_withholding_cents    bigint not null default 0,
  social_security_cents      bigint not null default 0,
  medicare_cents             bigint not null default 0,
  other_deductions_cents     bigint not null default 0,
  net_pay_cents              bigint not null,
  statement_ref              text not null default '',
  check_date                 date
);

create table payroll.reconciliation_items (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references payroll.pay_runs(id),
  import_id       uuid not null references payroll.provider_imports(id),
  employee_id     uuid references payroll.employees(id),
  employee_code   text not null,
  issue           text not null check (issue in ('gross_mismatch','reimbursement_mismatch','deduction_mismatch',
                                                 'missing_from_provider','unexpected_in_provider','net_math')),
  expected_cents  bigint,
  actual_cents    bigint,
  status          text not null default 'open' check (status in ('open','acknowledged')),
  note            text not null default '',
  resolved_by     uuid,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);

create table payroll.pay_statements (
  id                         uuid primary key default gen_random_uuid(),
  run_id                     uuid not null references payroll.pay_runs(id),
  employee_id                uuid not null references payroll.employees(id),
  provider_result_id         uuid references payroll.provider_results(id),
  pay_date                   date not null,
  period_start               date not null,
  period_end                 date not null,
  gross_cents                bigint not null,
  reimbursement_cents        bigint not null default 0,
  federal_withholding_cents  bigint not null default 0,
  state_withholding_cents    bigint not null default 0,
  social_security_cents      bigint not null default 0,
  medicare_cents             bigint not null default 0,
  other_deductions_cents     bigint not null default 0,
  net_pay_cents              bigint not null,
  statement_ref              text not null default '',
  earnings_detail            jsonb not null default '[]',
  published_by               uuid,
  published_at               timestamptz not null default now(),
  unique (run_id, employee_id)
);
create index pay_statements_employee_idx on payroll.pay_statements(employee_id);

-- ---------------------------------------------------------------------------
-- Audit trail (append-only)
-- ---------------------------------------------------------------------------
create table payroll.audit_events (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  actor_user_id uuid,
  actor_email   text,
  action        text not null,
  entity_type   text not null,
  entity_id     text,
  summary       text not null,
  details       jsonb not null default '{}'
);
create index audit_events_entity_idx on payroll.audit_events(entity_type, entity_id);
create index audit_events_at_idx on payroll.audit_events(at desc);

create or replace function payroll.forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only; record a new row instead', tg_table_name;
end $$;

create trigger audit_events_append_only before update or delete on payroll.audit_events
  for each row execute function payroll.forbid_change();
create trigger compensation_rates_append_only before update or delete on payroll.compensation_rates
  for each row execute function payroll.forbid_change();
create trigger housing_allowances_append_only before update or delete on payroll.housing_allowances
  for each row execute function payroll.forbid_change();
create trigger exports_append_only before update or delete on payroll.exports
  for each row execute function payroll.forbid_change();
create trigger provider_results_append_only before update or delete on payroll.provider_results
  for each row execute function payroll.forbid_change();

-- Runs and their inputs can only change while in draft. This backs up the server checks.
create or replace function payroll.require_draft_run() returns trigger
language plpgsql as $$
declare
  v_status text;
  v_run uuid := coalesce(new.run_id, old.run_id);
begin
  select status into v_status from payroll.pay_runs where id = v_run;
  if v_status is distinct from 'draft' then
    raise exception 'Pay run is %; hours, earnings and lines can only change while it is a draft', v_status;
  end if;
  return coalesce(new, old);
end $$;

create trigger time_entries_draft_only before insert or update or delete on payroll.time_entries
  for each row execute function payroll.require_draft_run();
create trigger earnings_items_draft_only before insert or update or delete on payroll.earnings_items
  for each row execute function payroll.require_draft_run();
create trigger run_lines_draft_only before insert or update or delete on payroll.run_lines
  for each row execute function payroll.require_draft_run();

-- Allowed status transitions.
create or replace function payroll.check_run_transition() returns trigger
language plpgsql as $$
begin
  if new.status = old.status then
    if old.status in ('exported','reconciled','voided')
       and (new.period_start, new.period_end, new.pay_date, new.revision)
           is distinct from (old.period_start, old.period_end, old.pay_date, old.revision) then
      raise exception 'An exported pay run cannot be edited; create a correction run instead';
    end if;
    return new;
  end if;
  if not (
    (old.status = 'draft'      and new.status in ('submitted','voided')) or
    (old.status = 'submitted'  and new.status in ('draft','approved')) or
    (old.status = 'approved'   and new.status in ('draft','exported')) or
    (old.status = 'exported'   and new.status in ('reconciled','voided')) or
    (old.status = 'reconciled' and new.status in ('voided'))
  ) then
    raise exception 'Pay run cannot move from % to %', old.status, new.status;
  end if;
  return new;
end $$;

create trigger pay_runs_transition before update on payroll.pay_runs
  for each row execute function payroll.check_run_transition();
create trigger pay_runs_no_delete before delete on payroll.pay_runs
  for each row execute function payroll.forbid_change();
