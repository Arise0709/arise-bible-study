-- Kaizen Cycle 6.1: accounts and cloud sync for personal study data.
--
-- Design
-- * Each person's records (notes, sermons, studies, plans, ...) are stored as versioned documents in
--   user_records, keyed by (user, kind, id). The ids are the same ones the browser database already uses,
--   so nothing local has to be renamed.
-- * Writes go through sync_push, which applies a change only if the device saw the latest version
--   (compare-and-set). Otherwise it returns a conflict and the device keeps both versions; nothing is
--   silently overwritten.
-- * Long-form records keep their previous versions in user_record_history.
-- * Row-level security: a signed-in person can read and write only their own rows. Functions run with the
--   caller's rights (security invoker), so these policies apply to them too.
-- Undo: see 20261102000100_cycle6_sync.down.sql

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (length(display_name) <= 120),
  age_confirmed_13 boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence public.sync_seq;

create table public.user_records (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in (
    'notes', 'highlights', 'bookmarks', 'dict', 'studies', 'sermons', 'folders', 'settings',
    'plans', 'planProgress', 'courses', 'lessons', 'courseVersions', 'enrollments', 'attempts', 'submissions', 'attendance'
  )),
  id text not null check (length(id) between 1 and 200),
  version bigint not null default 1 check (version >= 1),
  seq bigint not null default nextval('public.sync_seq'),
  deleted boolean not null default false,
  data jsonb,
  device_id text check (length(device_id) <= 100),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, id),
  check (deleted or data is not null),
  check (pg_column_size(data) <= 5000000)
);
create index user_records_user_seq on public.user_records (user_id, seq);

create table public.user_record_history (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  id text not null,
  version bigint not null,
  data jsonb,
  deleted boolean not null default false,
  saved_at timestamptz not null default now(),
  primary key (user_id, kind, id, version)
);

create table public.audit_events (
  id bigserial primary key,
  user_id uuid references auth.users (id) on delete cascade,
  action text not null check (length(action) <= 80),
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index audit_events_user on public.audit_events (user_id, at desc);

-- Row-level security: every table, owner only
alter table public.profiles enable row level security;
alter table public.user_records enable row level security;
alter table public.user_record_history enable row level security;
alter table public.audit_events enable row level security;

create policy profiles_own on public.profiles for all to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy records_select on public.user_records for select to authenticated using (user_id = auth.uid());
create policy records_insert on public.user_records for insert to authenticated with check (user_id = auth.uid());
create policy records_update on public.user_records for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy history_select on public.user_record_history for select to authenticated using (user_id = auth.uid());
create policy history_insert on public.user_record_history for insert to authenticated with check (user_id = auth.uid());
create policy history_delete on public.user_record_history for delete to authenticated using (user_id = auth.uid());
create policy audit_select on public.audit_events for select to authenticated using (user_id = auth.uid());
create policy audit_insert on public.audit_events for insert to authenticated with check (user_id = auth.uid());

-- Supabase grants new tables to anon and authenticated by default: take that away, then allow only what is needed.
revoke all on public.profiles, public.user_records, public.user_record_history, public.audit_events from anon, authenticated, public;
revoke all on sequence public.sync_seq from anon, authenticated, public;
grant all on public.profiles, public.user_records, public.user_record_history, public.audit_events to service_role;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.user_records to authenticated;
grant select, insert, delete on public.user_record_history to authenticated;
grant select, insert on public.audit_events to authenticated;
grant usage on sequence public.sync_seq to authenticated;
grant usage on sequence public.audit_events_id_seq to authenticated;

-- A profile for every new account. Age confirmation comes from the sign-up form (13 and over only).
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, age_confirmed_13)
  values (new.id, coalesce((new.raw_user_meta_data ->> 'age_confirmed_13')::boolean, false));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Long-form kinds keep earlier versions (the last 30) so any overwritten text can be recovered.
create function public.is_long_form(k text) returns boolean language sql immutable as $$
  select k in ('notes', 'dict', 'studies', 'sermons', 'courses', 'lessons', 'plans')
$$;

/**
 * Apply a batch of changes from one device.
 * changes: [{ "kind": "...", "id": "...", "base": <version the device last saw, 0 if new>, "deleted": bool, "data": {...} }]
 * Returns one result per change: { kind, id, status: "ok" | "conflict", version, seq, server? }
 * A change is applied only when base matches the stored version. Otherwise nothing is written and the
 * stored version is returned so the device can keep both.
 */
create function public.sync_push(device text, changes jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  uid uuid := auth.uid();
  c jsonb;
  cur public.user_records%rowtype;
  out jsonb := '[]'::jsonb;
  new_seq bigint;
  base bigint;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if jsonb_typeof(changes) <> 'array' or jsonb_array_length(changes) > 200 then
    raise exception 'send between 1 and 200 changes at a time' using errcode = '22023';
  end if;
  -- One person's saves are applied one batch at a time, so their change numbers (seq) become visible in
  -- order and a device pulling "everything after N" can never skip a change that commits late.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  for c in select * from jsonb_array_elements(changes) loop
    base := coalesce((c ->> 'base')::bigint, 0);
    select * into cur from public.user_records r
      where r.user_id = uid and r.kind = c ->> 'kind' and r.id = c ->> 'id' for update;
    if not found then
      new_seq := nextval('public.sync_seq');
      insert into public.user_records (user_id, kind, id, version, seq, deleted, data, device_id)
      values (uid, c ->> 'kind', c ->> 'id', 1, new_seq, coalesce((c ->> 'deleted')::boolean, false),
              case when coalesce((c ->> 'deleted')::boolean, false) then null else c -> 'data' end, device);
      out := out || jsonb_build_object('kind', c ->> 'kind', 'id', c ->> 'id', 'status', 'ok', 'version', 1, 'seq', new_seq);
    elsif cur.version = base then
      if public.is_long_form(cur.kind) then
        insert into public.user_record_history (user_id, kind, id, version, data, deleted)
        values (uid, cur.kind, cur.id, cur.version, cur.data, cur.deleted) on conflict do nothing;
        delete from public.user_record_history h
          where h.user_id = uid and h.kind = cur.kind and h.id = cur.id and h.version <= cur.version - 30;
      end if;
      new_seq := nextval('public.sync_seq');
      update public.user_records r set
        version = cur.version + 1, seq = new_seq, device_id = device, updated_at = now(),
        deleted = coalesce((c ->> 'deleted')::boolean, false),
        data = case when coalesce((c ->> 'deleted')::boolean, false) then null else c -> 'data' end
      where r.user_id = uid and r.kind = cur.kind and r.id = cur.id;
      out := out || jsonb_build_object('kind', cur.kind, 'id', cur.id, 'status', 'ok', 'version', cur.version + 1, 'seq', new_seq);
    else
      out := out || jsonb_build_object('kind', cur.kind, 'id', cur.id, 'status', 'conflict', 'version', cur.version, 'seq', cur.seq,
        'server', jsonb_build_object('deleted', cur.deleted, 'data', cur.data, 'updated_at', cur.updated_at, 'device_id', cur.device_id));
    end if;
  end loop;
  return out;
end $$;

/** Changes after a point (the device remembers the highest seq it has seen). */
create function public.sync_pull(since bigint, max_rows int default 500)
returns table (kind text, id text, version bigint, seq bigint, deleted boolean, data jsonb, updated_at timestamptz)
language sql security invoker stable set search_path = '' as $$
  select r.kind, r.id, r.version, r.seq, r.deleted, r.data, r.updated_at
  from public.user_records r
  where r.user_id = auth.uid() and r.seq > since
  order by r.seq
  limit least(greatest(max_rows, 1), 1000)
$$;

/** Record an account event for the person's own audit trail (no study content). */
create function public.log_event(action text, detail jsonb default '{}'::jsonb) returns void
language sql security invoker set search_path = '' as $$
  insert into public.audit_events (user_id, action, detail) values (auth.uid(), action, coalesce(detail, '{}'::jsonb))
$$;

revoke all on function public.sync_push(text, jsonb), public.sync_pull(bigint, int), public.log_event(text, jsonb), public.is_long_form(text) from public, anon;
grant execute on function public.sync_push(text, jsonb), public.sync_pull(bigint, int), public.log_event(text, jsonb) to authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on sequence public.audit_events_id_seq from anon;
