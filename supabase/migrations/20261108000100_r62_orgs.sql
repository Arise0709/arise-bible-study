-- Release 6.2: church and ministry workspaces, courses, groups, sharing, and announcements.
--
-- Design
-- * Personal study data (user_records and its history) is not touched. No rule in this file grants any
--   organization role access to it. Church data lives only in the tables below.
-- * Every tenant row carries org_id. Access is decided by the database on every request from the caller's
--   CURRENT membership, so removing a member ends their access at once.
-- * Roles (rank): owner 6, admin 5, teacher (Pastor/Teacher) 4, instructor 3, leader (Group Leader) 2,
--   member (Student/Member) 1. Course and group access also needs an assignment, not just a rank.
-- * Changes to roles, invitations, enrollment, grades, attendance, groups and sharing go only through the
--   checked functions below; the tables themselves are not writable except where a policy says so.
-- * Two-step sign-in is respected: me() is null for a session that still owes its authenticator code.
-- * Church membership is for adults (18+) in this release; joining records the person's confirmation.
-- Undo: 20261108000100_r62_orgs.down.sql

alter table public.profiles
  add column adult_confirmed_18 boolean not null default false,
  add column adult_confirmed_at timestamptz;

/* ============================== helpers ============================== */

create function public.role_rank(r text) returns int language sql immutable set search_path = '' as $$
  select case r when 'owner' then 6 when 'admin' then 5 when 'teacher' then 4 when 'instructor' then 3
                when 'leader' then 2 when 'member' then 1 else 0 end
$$;

/** The caller, or null when the session still owes its two-step code. */
create function public.me() returns uuid language sql stable set search_path = '' as $$
  select case when public.mfa_satisfied() then auth.uid() end
$$;

create function public.clean(t text, maxlen int) returns text language sql immutable set search_path = '' as $$
  -- trims, removes control characters (keeps line breaks and tabs), and caps the length
  select left(btrim(regexp_replace(coalesce(t, ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g')), maxlen)
$$;

/* ============================== organizations ============================== */

create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 120),
  kind text not null check (kind in ('church', 'ministry', 'study_group', 'education')),
  description text not null default '' check (length(description) <= 2000),
  city text not null default '' check (length(city) <= 80),
  state text not null default '' check (length(state) <= 40),
  website text not null default '' check (website = '' or (website ~ '^https://[^\s<>"]+$' and length(website) <= 200)),
  logo text check (logo is null or (logo ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$' and length(logo) <= 280000)),
  contact_email text not null check (contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(contact_email) <= 254),
  time_zone text not null default 'America/Chicago' check (length(time_zone) between 1 and 64),
  require_course_review boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  purge_after timestamptz
);

create table public.org_members (
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'teacher', 'instructor', 'leader', 'member')),
  display_name text not null check (length(display_name) between 1 and 80),
  notify jsonb not null default '{"announcements": true}'::jsonb,
  joined_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references auth.users (id) on delete set null,
  primary key (org_id, user_id)
);
create unique index org_one_owner on public.org_members (org_id) where role = 'owner' and removed_at is null;
create index org_members_user on public.org_members (user_id) where removed_at is null;

/** Email addresses of members: administrators only. */
create table public.org_member_contacts (
  org_id uuid not null,
  user_id uuid not null,
  email text not null,
  primary key (org_id, user_id),
  foreign key (org_id, user_id) references public.org_members (org_id, user_id) on delete cascade
);

create table public.org_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254),
  role text not null check (role in ('admin', 'teacher', 'instructor', 'leader', 'member')),
  group_ids uuid[] not null default '{}',
  course_ids uuid[] not null default '{}',
  token_hash bytea not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  sent_count int not null default 1,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null
);
create index org_invitations_org on public.org_invitations (org_id, created_at desc);
create index org_invitations_inviter on public.org_invitations (invited_by, created_at desc);

create table public.org_ownership_transfers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  from_user uuid not null references auth.users (id) on delete cascade,
  to_user uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  cancelled_at timestamptz
);
create unique index org_one_open_transfer on public.org_ownership_transfers (org_id) where accepted_at is null and cancelled_at is null;

create table public.org_audit_events (
  id bigserial primary key,
  org_id uuid not null references public.orgs (id) on delete cascade,
  actor uuid references auth.users (id) on delete set null,
  action text not null check (length(action) <= 80),
  target uuid,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index org_audit_org on public.org_audit_events (org_id, at desc);

/** Rank of the caller in an organization (0 = not a current member, organization deleted, or code owed). */
create function public.org_rank(o uuid) returns int language sql stable security definer set search_path = '' as $$
  select coalesce((
    select public.role_rank(m.role) from public.org_members m join public.orgs g on g.id = m.org_id
    where m.org_id = o and m.user_id = public.me() and m.removed_at is null and g.deleted_at is null), 0)
$$;

create function public.org_audit(o uuid, act text, tgt uuid default null, det jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.org_audit_events (org_id, actor, action, target, detail) values (o, auth.uid(), act, tgt, coalesce(det, '{}'::jsonb))
$$;

/* ============================== courses ============================== */

create table public.org_courses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  description text not null default '' check (length(description) <= 4000),
  status text not null default 'draft' check (status in ('draft', 'review', 'published', 'archived')),
  published_version int not null default 0,
  catalog boolean not null default false,
  enroll_deadline date,
  source_course_id text check (length(source_course_id) <= 200),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index org_courses_org on public.org_courses (org_id, status);

/** Working copy of a course ({course, lessons}); staff only. rev guards against two editors overwriting each other. */
create table public.org_course_drafts (
  course_id uuid primary key references public.org_courses (id) on delete cascade,
  org_id uuid not null references public.orgs (id) on delete cascade,
  content jsonb not null check (pg_column_size(content) <= 5000000),
  rev int not null default 1,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

/** Frozen published copies, with answers; staff only. Never edited after publishing. */
create table public.org_course_versions (
  course_id uuid not null references public.org_courses (id) on delete cascade,
  version int not null,
  org_id uuid not null references public.orgs (id) on delete cascade,
  content jsonb not null,
  notes text not null default '' check (length(notes) <= 2000),
  published_by uuid references auth.users (id) on delete set null,
  published_at timestamptz not null default now(),
  primary key (course_id, version)
);

/** The student copy of each published version: answers, explanations and instructor notes removed. */
create table public.org_course_releases (
  course_id uuid not null,
  version int not null,
  org_id uuid not null references public.orgs (id) on delete cascade,
  content jsonb not null,
  primary key (course_id, version),
  foreign key (course_id, version) references public.org_course_versions (course_id, version) on delete cascade
);

create table public.org_course_instructors (
  course_id uuid not null references public.org_courses (id) on delete cascade,
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (course_id, user_id)
);
create index org_course_instructors_user on public.org_course_instructors (user_id);

create table public.org_enrollments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  course_id uuid not null references public.org_courses (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  version int not null,
  status text not null default 'active' check (status in ('active', 'withdrawn', 'completed')),
  enrolled_at timestamptz not null default now(),
  enrolled_by uuid references auth.users (id) on delete set null,
  deadline date,
  last_lesson_id text,
  withdrawn_at timestamptz,
  completed_at timestamptz,
  certificate_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index org_enrollments_one on public.org_enrollments (course_id, user_id) where user_id is not null;
create index org_enrollments_user on public.org_enrollments (user_id);

create table public.org_lesson_progress (
  enrollment_id uuid not null references public.org_enrollments (id) on delete cascade,
  org_id uuid not null references public.orgs (id) on delete cascade,
  lesson_id text not null,
  done_at timestamptz not null default now(),
  primary key (enrollment_id, lesson_id)
);

create table public.org_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  course_id uuid not null references public.org_courses (id) on delete cascade,
  enrollment_id uuid not null references public.org_enrollments (id) on delete cascade,
  lesson_id text not null,
  quiz_id text not null,
  version int not null,
  answers jsonb not null check (pg_column_size(answers) <= 200000),
  score int not null check (score between 0 and 100), -- percent of automatically graded points
  passed boolean not null,
  results jsonb not null,
  submitted_at timestamptz not null default now(),
  manual jsonb not null default '{}'::jsonb, -- instructor credit for written questions, by question id
  feedback text not null default '' check (length(feedback) <= 4000),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz
);
create index org_quiz_attempts_enr on public.org_quiz_attempts (enrollment_id, lesson_id);

create table public.org_written_answers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  course_id uuid not null references public.org_courses (id) on delete cascade,
  enrollment_id uuid not null references public.org_enrollments (id) on delete cascade,
  lesson_id text not null,
  kind text not null check (kind in ('reflection', 'assignment')),
  prompt text not null check (length(prompt) between 1 and 2000),
  body text not null check (length(body) <= 20000),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  grade text check (grade in ('complete', 'needs_revision', 'incomplete')),
  points numeric check (points >= 0 and points <= 1000),
  feedback text not null default '' check (length(feedback) <= 4000),
  graded_by uuid references auth.users (id) on delete set null,
  graded_at timestamptz,
  unique (enrollment_id, lesson_id, kind, prompt)
);

create table public.org_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  course_id uuid not null references public.org_courses (id) on delete cascade,
  held_on date not null,
  title text not null default '' check (length(title) <= 200),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index org_sessions_course on public.org_sessions (course_id, held_on);

create table public.org_attendance (
  session_id uuid not null references public.org_sessions (id) on delete cascade,
  org_id uuid not null references public.orgs (id) on delete cascade,
  enrollment_id uuid not null references public.org_enrollments (id) on delete cascade,
  status text not null check (status in ('present', 'absent', 'excused', 'late')),
  recorded_by uuid references auth.users (id) on delete set null,
  recorded_at timestamptz not null default now(),
  primary key (session_id, enrollment_id)
);

/** Course staff: administrators and owners, or an assigned instructor (instructor rank or above). */
create function public.is_course_staff(cid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_courses c where c.id = cid and (
      public.org_rank(c.org_id) >= 5 or (public.org_rank(c.org_id) >= 3 and exists (
        select 1 from public.org_course_instructors i where i.course_id = cid and i.user_id = public.me()))))
$$;

/** The caller's own enrollment in a course, when they are a current member. */
create function public.my_enrollment(cid uuid) returns uuid language sql stable security definer set search_path = '' as $$
  select e.id from public.org_enrollments e
  where e.course_id = cid and e.user_id = public.me() and e.status in ('active', 'completed') and public.org_rank(e.org_id) >= 1
$$;

create function public.is_my_enrollment(eid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.org_enrollments e where e.id = eid and e.user_id = public.me() and public.org_rank(e.org_id) >= 1)
$$;

create function public.enrollment_staff(eid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select public.is_course_staff(e.course_id) from public.org_enrollments e where e.id = eid), false)
$$;

/* ============================== groups ============================== */

create table public.org_groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  description text not null default '' check (length(description) <= 2000),
  topic text not null default '' check (length(topic) <= 200),
  visibility text not null default 'private' check (visibility in ('private', 'invite', 'org')),
  schedule text not null default '' check (length(schedule) <= 200),
  discussions boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index org_groups_org on public.org_groups (org_id);

create table public.org_group_members (
  group_id uuid not null references public.org_groups (id) on delete cascade,
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('leader', 'member')),
  status text not null default 'active' check (status in ('active', 'requested', 'removed')),
  added_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index org_group_members_user on public.org_group_members (user_id);

create function public.is_group_member(gid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.org_group_members gm join public.org_groups g on g.id = gm.group_id
    where gm.group_id = gid and gm.user_id = public.me() and gm.status = 'active' and public.org_rank(g.org_id) >= 1)
$$;

/** Leads this group (as its leader, with Group Leader rank or above), or administers the organization. */
create function public.is_group_leader(gid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.org_groups g where g.id = gid and (
    public.org_rank(g.org_id) >= 5 or (public.org_rank(g.org_id) >= 2 and exists (
      select 1 from public.org_group_members gm where gm.group_id = gid and gm.user_id = public.me() and gm.role = 'leader' and gm.status = 'active'))))
$$;

create function public.can_see_group(gid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_group_member(gid) or public.is_group_leader(gid) or exists (
    select 1 from public.org_groups g where g.id = gid and g.visibility = 'org' and g.archived_at is null and public.org_rank(g.org_id) >= 1)
$$;

create table public.org_group_studies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  group_id uuid not null references public.org_groups (id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  passage text not null check (length(passage) between 1 and 200), -- OSIS range
  instructions text not null default '' check (length(instructions) <= 8000),
  questions jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array' and pg_column_size(questions) <= 100000),
  resources jsonb not null default '[]'::jsonb check (jsonb_typeof(resources) = 'array' and pg_column_size(resources) <= 200000),
  due_on date,
  status text not null default 'draft' check (status in ('draft', 'assigned', 'closed')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index org_group_studies_group on public.org_group_studies (group_id, status);

/** A member's answers to a group study. Drafts are theirs alone; the leader sees it only once submitted. */
create table public.org_group_responses (
  study_id uuid not null references public.org_group_studies (id) on delete cascade,
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) <= 100000),
  reflection text not null default '' check (length(reflection) <= 20000),
  read_done boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  leader_note text not null default '' check (length(leader_note) <= 4000),
  primary key (study_id, user_id)
);

create table public.org_discussion_topics (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  group_id uuid not null references public.org_groups (id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  study_id uuid references public.org_group_studies (id) on delete set null,
  locked boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.org_discussion_posts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  topic_id uuid not null references public.org_discussion_topics (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (length(body) between 1 and 5000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  hidden_at timestamptz,
  hidden_by uuid references auth.users (id) on delete set null
);
create index org_discussion_posts_topic on public.org_discussion_posts (topic_id, created_at);

create table public.org_content_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  group_id uuid references public.org_groups (id) on delete cascade,
  reporter uuid references auth.users (id) on delete set null,
  target_kind text not null check (target_kind in ('post', 'resource')),
  target_id uuid not null,
  reason text not null check (length(reason) between 1 and 1000),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  outcome text check (outcome in ('hidden', 'removed', 'no_action'))
);

/* ============================== sharing and announcements ============================== */

/**
 * A copy its owner chose to share (a study, sermon outline, lesson, Scripture collection, handout or note).
 * The original stays in the owner's private records. Revoking deletes the copy.
 */
create table public.org_shared_resources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  group_id uuid references public.org_groups (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('study', 'sermon_outline', 'lesson', 'scripture_collection', 'handout', 'note')),
  title text not null check (length(title) between 1 and 200),
  description text not null default '' check (length(description) <= 2000),
  content jsonb not null check (pg_column_size(content) <= 3000000),
  source_id text check (length(source_id) <= 200),
  access text not null default 'view' check (access in ('view', 'edit')),
  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
create index org_shared_resources_org on public.org_shared_resources (org_id, group_id);

create table public.org_resource_editors (
  resource_id uuid not null references public.org_shared_resources (id) on delete cascade,
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  primary key (resource_id, user_id)
);

create table public.org_announcements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  group_id uuid references public.org_groups (id) on delete cascade,
  course_id uuid references public.org_courses (id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  body text not null default '' check (length(body) <= 8000),
  pinned boolean not null default false,
  expires_on date,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (group_id is null or course_id is null)
);
create index org_announcements_org on public.org_announcements (org_id, created_at desc);

create table public.org_announcement_reads (
  announcement_id uuid not null references public.org_announcements (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

create function public.can_see_resource(rid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.org_shared_resources r where r.id = rid and (
    (r.owner_id = public.me() and public.org_rank(r.org_id) >= 1)
    or public.org_rank(r.org_id) >= 5
    or (r.group_id is null and r.approved_at is not null and public.org_rank(r.org_id) >= 1)
    or (r.group_id is not null and r.approved_at is not null and public.is_group_member(r.group_id))
    or (exists (select 1 from public.org_resource_editors e where e.resource_id = rid and e.user_id = public.me()) and public.org_rank(r.org_id) >= 1)))
$$;

create function public.can_see_announcement(aid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.org_announcements a where a.id = aid and public.org_rank(a.org_id) >= 1 and (
    (a.group_id is null and a.course_id is null)
    or (a.group_id is not null and (public.is_group_member(a.group_id) or public.is_group_leader(a.group_id)))
    or (a.course_id is not null and (public.my_enrollment(a.course_id) is not null or public.is_course_staff(a.course_id)))))
$$;

/**
 * Whose names a member may see: themselves; everyone if they administer the organization; anyone holding a
 * leadership role (so people know who leads); people in a group with them; their students if they teach a
 * course; nothing else. Email addresses are a separate table, visible to administrators only.
 */
create function public.can_see_member(o uuid, u uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select public.org_rank(o) >= 1 and (
    u = public.me()
    or public.org_rank(o) >= 5
    or exists (select 1 from public.org_members m where m.org_id = o and m.user_id = u and m.removed_at is null and public.role_rank(m.role) >= 2)
    or exists (select 1 from public.org_group_members a join public.org_group_members b on a.group_id = b.group_id
               where a.org_id = o and a.user_id = public.me() and a.status = 'active' and b.user_id = u and b.status = 'active')
    or exists (select 1 from public.org_enrollments e where e.org_id = o and e.user_id = u and public.is_course_staff(e.course_id)))
$$;

/* ============================== row-level security ============================== */

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and (tablename = 'orgs' or tablename like 'org\_%') loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated, public', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('grant select on public.%I to authenticated', t); -- rows still need a policy below
  end loop;
end $$;
revoke all on sequence public.org_audit_events_id_seq from anon, authenticated, public;
grant usage on sequence public.org_audit_events_id_seq to service_role;

-- Reading. Writing goes through the functions further down unless a policy below allows it.
create policy orgs_read on public.orgs for select to authenticated using (public.org_rank(id) >= 1);
create policy members_read on public.org_members for select to authenticated using (public.can_see_member(org_id, user_id) and (removed_at is null or public.org_rank(org_id) >= 5));
create policy contacts_read on public.org_member_contacts for select to authenticated using (public.org_rank(org_id) >= 5 or user_id = public.me());
create policy invitations_read on public.org_invitations for select to authenticated using (public.org_rank(org_id) >= 5 or (invited_by = public.me() and public.org_rank(org_id) >= 2));
create policy transfers_read on public.org_ownership_transfers for select to authenticated using (public.org_rank(org_id) >= 5);
create policy audit_read on public.org_audit_events for select to authenticated using (public.org_rank(org_id) >= 5);

create policy courses_read on public.org_courses for select to authenticated using (
  public.is_course_staff(id) or public.org_rank(org_id) >= 4 or public.my_enrollment(id) is not null
  or (status = 'published' and catalog and public.org_rank(org_id) >= 1));
create policy drafts_read on public.org_course_drafts for select to authenticated using (public.is_course_staff(course_id));
create policy versions_read on public.org_course_versions for select to authenticated using (public.is_course_staff(course_id));
create policy releases_read on public.org_course_releases for select to authenticated using (
  public.is_course_staff(course_id) or public.my_enrollment(course_id) is not null
  or exists (select 1 from public.org_courses c where c.id = course_id and c.status = 'published' and c.catalog and c.published_version = version and public.org_rank(c.org_id) >= 1));
create policy instructors_read on public.org_course_instructors for select to authenticated using (public.org_rank(org_id) >= 1 and (public.is_course_staff(course_id) or public.org_rank(org_id) >= 4 or public.my_enrollment(course_id) is not null));
create policy enrollments_read on public.org_enrollments for select to authenticated using ((user_id = public.me() and public.org_rank(org_id) >= 1) or public.is_course_staff(course_id));
create policy progress_read on public.org_lesson_progress for select to authenticated using (public.is_my_enrollment(enrollment_id) or public.enrollment_staff(enrollment_id));
create policy attempts_read on public.org_quiz_attempts for select to authenticated using (public.is_my_enrollment(enrollment_id) or public.is_course_staff(course_id));
create policy written_read on public.org_written_answers for select to authenticated using (public.is_my_enrollment(enrollment_id) or public.is_course_staff(course_id));
create policy sessions_read on public.org_sessions for select to authenticated using (public.is_course_staff(course_id) or public.my_enrollment(course_id) is not null);
create policy attendance_read on public.org_attendance for select to authenticated using (public.is_my_enrollment(enrollment_id) or public.enrollment_staff(enrollment_id));

create policy groups_read on public.org_groups for select to authenticated using (public.can_see_group(id));
create policy group_members_read on public.org_group_members for select to authenticated using (
  (user_id = public.me() and public.org_rank(org_id) >= 1) or public.is_group_leader(group_id) or (status = 'active' and public.is_group_member(group_id)));
create policy studies_read on public.org_group_studies for select to authenticated using (public.is_group_leader(group_id) or (status <> 'draft' and public.is_group_member(group_id)));
create policy responses_read on public.org_group_responses for select to authenticated using (
  (user_id = public.me() and public.org_rank(org_id) >= 1)
  or (status = 'submitted' and exists (select 1 from public.org_group_studies s where s.id = study_id and public.is_group_leader(s.group_id))));
create policy topics_read on public.org_discussion_topics for select to authenticated using (
  public.is_group_leader(group_id) or (public.is_group_member(group_id) and exists (select 1 from public.org_groups g where g.id = group_id and g.discussions)));
create policy posts_read on public.org_discussion_posts for select to authenticated using (exists (
  select 1 from public.org_discussion_topics t join public.org_groups g on g.id = t.group_id where t.id = topic_id and (
    public.is_group_leader(t.group_id) or (public.is_group_member(t.group_id) and g.discussions and (hidden_at is null or author_id = public.me())))));
create policy reports_read on public.org_content_reports for select to authenticated using (
  public.org_rank(org_id) >= 5 or (group_id is not null and public.is_group_leader(group_id)) or (reporter = public.me() and public.org_rank(org_id) >= 1));

create policy resources_read on public.org_shared_resources for select to authenticated using (public.can_see_resource(id));
create policy editors_read on public.org_resource_editors for select to authenticated using (public.can_see_resource(resource_id));
create policy announcements_read on public.org_announcements for select to authenticated using (public.can_see_announcement(id));
create policy reads_own on public.org_announcement_reads for select to authenticated using (user_id = public.me());

-- The few direct writes allowed (each limited to the caller's own rows and to specific columns).

grant insert (study_id, user_id, answers, reflection, read_done, status, submitted_at) on public.org_group_responses to authenticated;
grant update (answers, reflection, read_done, status, submitted_at, updated_at) on public.org_group_responses to authenticated;
create policy responses_insert on public.org_group_responses for insert to authenticated with check (
  user_id = public.me() and exists (select 1 from public.org_group_studies s where s.id = study_id and s.status = 'assigned' and public.is_group_member(s.group_id)));
create policy responses_update on public.org_group_responses for update to authenticated
  using (user_id = public.me() and exists (select 1 from public.org_group_studies s where s.id = study_id and s.status = 'assigned' and public.is_group_member(s.group_id)))
  with check (user_id = public.me());

grant insert (topic_id, author_id, body) on public.org_discussion_posts to authenticated;
grant update (body, edited_at) on public.org_discussion_posts to authenticated;
create policy posts_insert on public.org_discussion_posts for insert to authenticated with check (
  author_id = public.me() and exists (select 1 from public.org_discussion_topics t join public.org_groups g on g.id = t.group_id
    where t.id = topic_id and not t.locked and g.discussions and g.archived_at is null and public.is_group_member(t.group_id)));
create policy posts_update on public.org_discussion_posts for update to authenticated
  using (author_id = public.me() and hidden_at is null and exists (select 1 from public.org_discussion_topics t where t.id = topic_id and not t.locked and public.is_group_member(t.group_id)))
  with check (author_id = public.me());

grant insert (announcement_id, user_id) on public.org_announcement_reads to authenticated;
create policy reads_insert on public.org_announcement_reads for insert to authenticated with check (user_id = public.me() and public.can_see_announcement(announcement_id));

-- org_id on directly written rows always comes from the parent row, never from the client.
create function public.set_org_from_parent() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'org_group_responses' then
    select s.org_id into new.org_id from public.org_group_studies s where s.id = new.study_id;
  elsif tg_table_name = 'org_discussion_posts' then
    select t.org_id into new.org_id from public.org_discussion_topics t where t.id = new.topic_id;
  end if;
  return new;
end $$;
create trigger responses_org before insert on public.org_group_responses for each row execute function public.set_org_from_parent();
create trigger posts_org before insert on public.org_discussion_posts for each row execute function public.set_org_from_parent();

-- A submitted response keeps its submission time; drafts get none.
create function public.response_stamp() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.submitted_at := case when new.status = 'submitted' then coalesce(case when tg_op = 'UPDATE' then old.submitted_at end, now()) end;
  return new;
end $$;
create trigger responses_stamp before insert or update on public.org_group_responses for each row execute function public.response_stamp();

/* ============================== organization functions ============================== */

create function public.create_org(p jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.me();
  oid uuid;
  owned int;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if coalesce((p ->> 'adult')::boolean, false) is not true then raise exception 'Church workspaces are for adults (18 and over) in this release.'; end if;
  if length(public.clean(p ->> 'name', 120)) < 2 then raise exception 'Enter the workspace name.'; end if;
  if lower(public.clean(p ->> 'contact_email', 254)) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid contact email.'; end if;
  if public.clean(p ->> 'display_name', 80) = '' then raise exception 'Enter your name as members should see it.'; end if;
  select count(*) into owned from public.org_members m join public.orgs g on g.id = m.org_id
    where m.user_id = uid and m.role = 'owner' and m.removed_at is null and g.deleted_at is null;
  if owned >= 3 then raise exception 'You can own up to 3 workspaces.'; end if;
  if (select count(*) from public.orgs where created_by = uid and created_at > now() - interval '1 day') >= 5 then
    raise exception 'Too many workspaces created today. Try again tomorrow.';
  end if;
  insert into public.orgs (name, kind, description, city, state, website, contact_email, time_zone, created_by)
  values (public.clean(p ->> 'name', 120), p ->> 'kind', public.clean(p ->> 'description', 2000), public.clean(p ->> 'city', 80),
          public.clean(p ->> 'state', 40), public.clean(p ->> 'website', 200), lower(public.clean(p ->> 'contact_email', 254)),
          coalesce(nullif(public.clean(p ->> 'time_zone', 64), ''), 'America/Chicago'), uid)
  returning id into oid;
  insert into public.org_members (org_id, user_id, role, display_name) values (oid, uid, 'owner', public.clean(p ->> 'display_name', 80));
  insert into public.org_member_contacts values (oid, uid, lower(coalesce(auth.jwt() ->> 'email', '')));
  update public.profiles set adult_confirmed_18 = true, adult_confirmed_at = coalesce(adult_confirmed_at, now()) where id = uid;
  perform public.org_audit(oid, 'org_created');
  return oid;
end $$;

create function public.update_org(o uuid, p jsonb) returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.org_rank(o) < 5 then raise exception 'Only the owner or an administrator can change workspace settings.' using errcode = '42501'; end if;
  update public.orgs set
    name = case when p ? 'name' then public.clean(p ->> 'name', 120) else name end,
    kind = coalesce(p ->> 'kind', kind),
    description = case when p ? 'description' then public.clean(p ->> 'description', 2000) else description end,
    city = case when p ? 'city' then public.clean(p ->> 'city', 80) else city end,
    state = case when p ? 'state' then public.clean(p ->> 'state', 40) else state end,
    website = case when p ? 'website' then public.clean(p ->> 'website', 200) else website end,
    contact_email = case when p ? 'contact_email' then lower(public.clean(p ->> 'contact_email', 254)) else contact_email end,
    time_zone = coalesce(nullif(public.clean(p ->> 'time_zone', 64), ''), time_zone),
    logo = case when p ? 'logo' then nullif(p ->> 'logo', '') else logo end,
    require_course_review = coalesce((p ->> 'require_course_review')::boolean, require_course_review),
    updated_at = now()
  where id = o;
  perform public.org_audit(o, 'org_updated', null, jsonb_build_object('fields', (select jsonb_agg(k) from jsonb_object_keys(p) k where k <> 'logo')));
end $$;

/** May the caller invite someone with this role (and to these groups and courses)? Raises if not. */
create function public.check_invite_authority(o uuid, r text, groups uuid[], courses uuid[], inviter uuid default null) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  who uuid := coalesce(inviter, public.me());
  rk int;
  g uuid;
  c uuid;
begin
  select public.role_rank(m.role) into rk from public.org_members m join public.orgs x on x.id = m.org_id
    where m.org_id = o and m.user_id = who and m.removed_at is null and x.deleted_at is null;
  rk := coalesce(rk, 0);
  if public.role_rank(r) not between 1 and 5 then raise exception 'That role cannot be offered by invitation.'; end if;
  if r <> 'member' and (rk < 5 or public.role_rank(r) >= rk) then
    raise exception 'You can only offer roles below your own.' using errcode = '42501';
  end if;
  if rk < 2 then raise exception 'Only leaders can invite people.' using errcode = '42501'; end if;
  if rk < 5 and coalesce(array_length(groups, 1), 0) + coalesce(array_length(courses, 1), 0) = 0 then
    raise exception 'Choose a group you lead or a course you teach for this invitation.' using errcode = '42501';
  end if;
  foreach g in array coalesce(groups, '{}') loop
    if not exists (select 1 from public.org_groups x where x.id = g and x.org_id = o and x.archived_at is null and (rk >= 5 or exists (
      select 1 from public.org_group_members gm where gm.group_id = g and gm.user_id = who and gm.role = 'leader' and gm.status = 'active'))) then
      raise exception 'You can only invite people to groups you lead.' using errcode = '42501';
    end if;
  end loop;
  foreach c in array coalesce(courses, '{}') loop
    if not exists (select 1 from public.org_courses x where x.id = c and x.org_id = o and (rk >= 5 or (rk >= 3 and exists (
      select 1 from public.org_course_instructors i where i.course_id = c and i.user_id = who)))) then
      raise exception 'You can only invite people to courses you teach.' using errcode = '42501';
    end if;
  end loop;
end $$;

/** Creates (or re-issues) an invitation. Only a hash of the token is stored; the token is returned once. */
create function public.create_invitation(o uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.me();
  addr text := lower(public.clean(p ->> 'email', 254));
  r text := coalesce(p ->> 'role', 'member');
  groups uuid[] := coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p -> 'group_ids', '[]')) x), '{}');
  courses uuid[] := coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p -> 'course_ids', '[]')) x), '{}');
  days int := least(greatest(coalesce((p ->> 'days')::int, 7), 1), 30);
  tok text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  iid uuid;
  exp timestamptz := now() + make_interval(days => days);
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  perform public.check_invite_authority(o, r, groups, courses);
  if addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address.'; end if;
  if (select count(*) from public.org_invitations where invited_by = uid and created_at > now() - interval '1 day') >= 50
     or (select count(*) from public.org_invitations where org_id = o and created_at > now() - interval '1 day') >= 200 then
    raise exception 'Too many invitations today. Try again tomorrow.';
  end if;
  -- one open invitation per person per workspace: a new one replaces the old link
  update public.org_invitations set revoked_at = now(), revoked_by = uid
    where org_id = o and email = addr and accepted_at is null and revoked_at is null;
  insert into public.org_invitations (org_id, email, role, group_ids, course_ids, token_hash, invited_by, expires_at)
  values (o, addr, r, groups, courses, sha256(convert_to(tok, 'UTF8')), uid, exp) returning id into iid;
  perform public.org_audit(o, 'invitation_created', iid, jsonb_build_object('role', r, 'groups', cardinality(groups), 'courses', cardinality(courses)));
  return jsonb_build_object('id', iid, 'token', tok, 'expires_at', exp, 'org_name', (select name from public.orgs where id = o));
end $$;

create function public.resend_invitation(iid uuid, days int default 7) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  inv public.org_invitations%rowtype;
  tok text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  exp timestamptz := now() + make_interval(days => least(greatest(coalesce(days, 7), 1), 30));
begin
  select * into inv from public.org_invitations where id = iid for update;
  if not found or not (public.org_rank(inv.org_id) >= 5 or (inv.invited_by = public.me() and public.org_rank(inv.org_id) >= 2)) then
    raise exception 'Invitation not found.' using errcode = '42501';
  end if;
  if inv.accepted_at is not null then raise exception 'This invitation was already accepted.'; end if;
  perform public.check_invite_authority(inv.org_id, inv.role, inv.group_ids, inv.course_ids);
  if (select count(*) from public.org_invitations where invited_by = public.me() and created_at > now() - interval '1 day') >= 50 then
    raise exception 'Too many invitations today. Try again tomorrow.';
  end if;
  update public.org_invitations set token_hash = sha256(convert_to(tok, 'UTF8')), expires_at = exp, revoked_at = null, revoked_by = null,
    sent_count = sent_count + 1, created_at = now(), invited_by = public.me() where id = iid;
  perform public.org_audit(inv.org_id, 'invitation_resent', iid);
  return jsonb_build_object('id', iid, 'token', tok, 'expires_at', exp, 'email', inv.email, 'org_name', (select name from public.orgs where id = inv.org_id));
end $$;

create function public.revoke_invitation(iid uuid) returns void language plpgsql security definer set search_path = '' as $$
declare inv public.org_invitations%rowtype;
begin
  select * into inv from public.org_invitations where id = iid for update;
  if not found or not (public.org_rank(inv.org_id) >= 5 or (inv.invited_by = public.me() and public.org_rank(inv.org_id) >= 2)) then
    raise exception 'Invitation not found.' using errcode = '42501';
  end if;
  if inv.accepted_at is null and inv.revoked_at is null then
    update public.org_invitations set revoked_at = now(), revoked_by = public.me() where id = iid;
    perform public.org_audit(inv.org_id, 'invitation_revoked', iid);
  end if;
end $$;

/** What an invitation offers, shown before accepting. Details only for the account it was sent to. */
create function public.invitation_preview(token text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  inv public.org_invitations%rowtype;
  g public.orgs%rowtype;
begin
  if public.me() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select * into inv from public.org_invitations where token_hash = sha256(convert_to(coalesce(token, ''), 'UTF8'));
  if not found then return jsonb_build_object('status', 'invalid'); end if;
  if inv.email <> lower(coalesce(auth.jwt() ->> 'email', '')) then return jsonb_build_object('status', 'wrong_account'); end if;
  select * into g from public.orgs where id = inv.org_id;
  return jsonb_build_object(
    'status', case when g.deleted_at is not null then 'invalid' when inv.accepted_at is not null then 'used' when inv.revoked_at is not null then 'revoked'
                   when inv.expires_at < now() then 'expired' else 'ok' end,
    'org', jsonb_build_object('name', g.name, 'kind', g.kind, 'description', g.description, 'city', g.city, 'state', g.state, 'logo', g.logo),
    'role', inv.role, 'expires_at', inv.expires_at,
    'invited_by', (select m.display_name from public.org_members m where m.org_id = inv.org_id and m.user_id = inv.invited_by),
    'groups', (select coalesce(jsonb_agg(x.name), '[]') from public.org_groups x where x.id = any (inv.group_ids)),
    'courses', (select coalesce(jsonb_agg(x.title), '[]') from public.org_courses x where x.id = any (inv.course_ids)),
    'already_member', exists (select 1 from public.org_members m where m.org_id = inv.org_id and m.user_id = public.me() and m.removed_at is null));
end $$;

create function public.accept_invitation(token text, display_name text, adult boolean) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.me();
  inv public.org_invitations%rowtype;
  cur public.org_members%rowtype;
  name text := public.clean(display_name, 80);
  g uuid;
  c uuid;
  pv int;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select * into inv from public.org_invitations where token_hash = sha256(convert_to(coalesce(token, ''), 'UTF8')) for update;
  if not found then raise exception 'This invitation link is not valid.'; end if;
  if inv.email <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'This invitation was sent to a different email address. Sign in with that address to accept it.';
  end if;
  if inv.accepted_at is not null then raise exception 'This invitation has already been used.'; end if;
  if inv.revoked_at is not null then raise exception 'This invitation was withdrawn. Ask for a new one.'; end if;
  if inv.expires_at < now() then raise exception 'This invitation has expired. Ask for a new one.'; end if;
  if exists (select 1 from public.orgs where id = inv.org_id and deleted_at is not null) then raise exception 'This invitation link is not valid.'; end if;
  if adult is not true then raise exception 'Church workspaces are for adults (18 and over) in this release.'; end if;
  if name = '' then raise exception 'Enter your name as members should see it.'; end if;
  -- the person who sent it must still be allowed to offer this
  perform public.check_invite_authority(inv.org_id, inv.role, inv.group_ids, inv.course_ids, inv.invited_by);

  select * into cur from public.org_members where org_id = inv.org_id and user_id = uid for update;
  if not found then
    insert into public.org_members (org_id, user_id, role, display_name) values (inv.org_id, uid, inv.role, name);
  elsif cur.removed_at is not null then
    update public.org_members set role = inv.role, display_name = name, removed_at = null, removed_by = null, joined_at = now()
      where org_id = inv.org_id and user_id = uid;
  elsif public.role_rank(inv.role) > public.role_rank(cur.role) and cur.role <> 'owner' then
    update public.org_members set role = inv.role where org_id = inv.org_id and user_id = uid;
  end if;
  insert into public.org_member_contacts values (inv.org_id, uid, inv.email) on conflict (org_id, user_id) do update set email = excluded.email;
  update public.profiles set adult_confirmed_18 = true, adult_confirmed_at = coalesce(adult_confirmed_at, now()) where id = uid;

  foreach g in array inv.group_ids loop
    if exists (select 1 from public.org_groups where id = g and org_id = inv.org_id and archived_at is null) then
      insert into public.org_group_members (group_id, org_id, user_id) values (g, inv.org_id, uid)
      on conflict (group_id, user_id) do update set status = 'active';
    end if;
  end loop;
  foreach c in array inv.course_ids loop
    select published_version into pv from public.org_courses where id = c and org_id = inv.org_id and status = 'published';
    if found and pv > 0 then
      insert into public.org_enrollments (org_id, course_id, user_id, version, enrolled_by) values (inv.org_id, c, uid, pv, inv.invited_by)
      on conflict (course_id, user_id) where user_id is not null do update set status = 'active', withdrawn_at = null, updated_at = now()
        where public.org_enrollments.status = 'withdrawn';
    end if;
  end loop;

  update public.org_invitations set accepted_at = now(), accepted_by = uid where id = inv.id;
  perform public.org_audit(inv.org_id, 'invitation_accepted', inv.id, jsonb_build_object('role', inv.role));
  return inv.org_id;
end $$;

create function public.set_member_role(o uuid, u uuid, r text) returns void language plpgsql security definer set search_path = '' as $$
declare
  mine int := public.org_rank(o);
  theirs text;
begin
  if u = public.me() then raise exception 'You cannot change your own role.' using errcode = '42501'; end if;
  select role into theirs from public.org_members where org_id = o and user_id = u and removed_at is null for update;
  if not found then raise exception 'That person is not a member.'; end if;
  if r = 'owner' then raise exception 'Ownership moves only through a transfer the new owner accepts.' using errcode = '42501'; end if;
  if mine < 5 or public.role_rank(theirs) >= mine or public.role_rank(r) >= mine or public.role_rank(r) = 0 then
    raise exception 'You can only change roles below your own.' using errcode = '42501';
  end if;
  update public.org_members set role = r where org_id = o and user_id = u;
  -- assignments that need a higher role end with it
  if public.role_rank(r) < 3 then delete from public.org_course_instructors where org_id = o and user_id = u; end if;
  if public.role_rank(r) < 2 then update public.org_group_members set role = 'member' where org_id = o and user_id = u and role = 'leader'; end if;
  perform public.org_audit(o, 'role_changed', u, jsonb_build_object('from', theirs, 'to', r));
end $$;

/** Removes a member (or the caller leaves). Their personal data is not touched; church records stay with the church. */
create function public.remove_member(o uuid, u uuid) returns void language plpgsql security definer set search_path = '' as $$
declare
  mine int := public.org_rank(o);
  theirs text;
begin
  select role into theirs from public.org_members where org_id = o and user_id = u and removed_at is null for update;
  if not found then raise exception 'That person is not a member.'; end if;
  if theirs = 'owner' then raise exception 'The owner must transfer ownership before leaving.' using errcode = '42501'; end if;
  if u <> public.me() and (mine < 5 or public.role_rank(theirs) >= mine) then
    raise exception 'You can only remove people below your own role.' using errcode = '42501';
  end if;
  if u = public.me() and mine < 1 then raise exception 'Not a member.' using errcode = '42501'; end if;
  update public.org_members set removed_at = now(), removed_by = public.me() where org_id = o and user_id = u;
  delete from public.org_course_instructors where org_id = o and user_id = u;
  update public.org_group_members set status = 'removed' where org_id = o and user_id = u;
  delete from public.org_resource_editors where org_id = o and user_id = u;
  perform public.org_audit(o, case when u = public.me() then 'member_left' else 'member_removed' end, u);
end $$;

create function public.set_my_member_settings(o uuid, p jsonb) returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.org_rank(o) < 1 then raise exception 'Not a member.' using errcode = '42501'; end if;
  update public.org_members set
    display_name = coalesce(nullif(public.clean(p ->> 'display_name', 80), ''), display_name),
    notify = case when p ? 'notify' and jsonb_typeof(p -> 'notify') = 'object' then jsonb_build_object('announcements', coalesce((p -> 'notify' ->> 'announcements')::boolean, true)) else notify end
  where org_id = o and user_id = public.me();
end $$;

create function public.offer_ownership(o uuid, u uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare tid uuid;
begin
  if public.org_rank(o) <> 6 then raise exception 'Only the owner can transfer ownership.' using errcode = '42501'; end if;
  if not exists (select 1 from public.org_members where org_id = o and user_id = u and role = 'admin' and removed_at is null) then
    raise exception 'Ownership can only be offered to an administrator.';
  end if;
  update public.org_ownership_transfers set cancelled_at = now() where org_id = o and accepted_at is null and cancelled_at is null;
  insert into public.org_ownership_transfers (org_id, from_user, to_user) values (o, public.me(), u) returning id into tid;
  perform public.org_audit(o, 'ownership_offered', u);
  return tid;
end $$;

create function public.my_ownership_offers() returns table (id uuid, org_id uuid, org_name text, from_name text, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select t.id, t.org_id, g.name, m.display_name, t.expires_at from public.org_ownership_transfers t
  join public.orgs g on g.id = t.org_id left join public.org_members m on m.org_id = t.org_id and m.user_id = t.from_user
  where t.to_user = public.me() and t.accepted_at is null and t.cancelled_at is null and t.expires_at > now() and g.deleted_at is null
$$;

create function public.accept_ownership(tid uuid) returns void language plpgsql security definer set search_path = '' as $$
declare t public.org_ownership_transfers%rowtype;
begin
  select * into t from public.org_ownership_transfers where id = tid for update;
  if not found or t.to_user is distinct from public.me() then raise exception 'Transfer not found.' using errcode = '42501'; end if;
  if t.accepted_at is not null or t.cancelled_at is not null or t.expires_at < now() then raise exception 'This transfer is no longer open.'; end if;
  if public.org_rank(t.org_id) <> 5 then raise exception 'Only an administrator can accept ownership.' using errcode = '42501'; end if;
  if not exists (select 1 from public.org_members where org_id = t.org_id and user_id = t.from_user and role = 'owner' and removed_at is null) then
    raise exception 'This transfer is no longer open.';
  end if;
  update public.org_members set role = 'admin' where org_id = t.org_id and user_id = t.from_user;
  update public.org_members set role = 'owner' where org_id = t.org_id and user_id = t.to_user;
  update public.org_ownership_transfers set accepted_at = now() where id = tid;
  perform public.org_audit(t.org_id, 'ownership_transferred', t.to_user, jsonb_build_object('from', t.from_user));
end $$;

create function public.cancel_ownership_offer(tid uuid) returns void language plpgsql security definer set search_path = '' as $$
declare t public.org_ownership_transfers%rowtype;
begin
  select * into t from public.org_ownership_transfers where id = tid for update;
  if not found or not (t.from_user = public.me() or t.to_user = public.me()) or public.org_rank(t.org_id) < 5 then
    raise exception 'Transfer not found.' using errcode = '42501';
  end if;
  update public.org_ownership_transfers set cancelled_at = now() where id = tid and accepted_at is null;
  perform public.org_audit(t.org_id, 'ownership_offer_cancelled', t.to_user);
end $$;

/** Deleting a workspace ends all access at once; its records are kept for 30 days in case it was a mistake. */
create function public.delete_org(o uuid, confirm_name text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.org_rank(o) <> 6 then raise exception 'Only the owner can delete a workspace.' using errcode = '42501'; end if;
  if (select name from public.orgs where id = o) is distinct from confirm_name then raise exception 'Type the workspace name exactly to confirm.'; end if;
  update public.orgs set deleted_at = now(), purge_after = now() + interval '30 days' where id = o;
  perform public.org_audit(o, 'org_deleted');
end $$;

create function public.restore_org(o uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.org_members m join public.orgs g on g.id = m.org_id
    where m.org_id = o and m.user_id = public.me() and m.role = 'owner' and m.removed_at is null and g.deleted_at is not null and g.purge_after > now()) then
    raise exception 'Workspace not found.' using errcode = '42501';
  end if;
  update public.orgs set deleted_at = null, purge_after = null where id = o;
  perform public.org_audit(o, 'org_restored');
end $$;

/** Workspaces the caller owns that are waiting to be purged (so they can be restored). */
create function public.my_deleted_orgs() returns table (id uuid, name text, purge_after timestamptz) language sql stable security definer set search_path = '' as $$
  select g.id, g.name, g.purge_after from public.orgs g join public.org_members m on m.org_id = g.id
  where m.user_id = public.me() and m.role = 'owner' and m.removed_at is null and g.deleted_at is not null and g.purge_after > now()
$$;

/** For the owner of the account: workspaces that would be left without an owner if the account were deleted. */
create function public.orgs_blocking_account_deletion(u uuid) returns table (id uuid, name text, members bigint) language sql stable security definer set search_path = '' as $$
  select g.id, g.name, (select count(*) from public.org_members x where x.org_id = g.id and x.removed_at is null)
  from public.orgs g join public.org_members m on m.org_id = g.id
  where m.user_id = u and m.role = 'owner' and m.removed_at is null and g.deleted_at is null
    and (select count(*) from public.org_members x where x.org_id = g.id and x.removed_at is null) > 1
$$;

/* ============================== course functions ============================== */

/** The student copy: no answers, explanations, AI-review flags or instructor notes; matching options in a neutral order. */
create function public.student_copy(content jsonb) returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  lessons jsonb := '[]'::jsonb;
  l jsonb;
  q jsonb;
  qs jsonb;
  rights jsonb;
begin
  for l in select * from jsonb_array_elements(coalesce(content -> 'lessons', '[]')) loop
    l := l - 'instructorNotes';
    if jsonb_typeof(l -> 'quiz') = 'object' then
      qs := '[]'::jsonb;
      for q in select * from jsonb_array_elements(coalesce(l -> 'quiz' -> 'questions', '[]')) loop
        if q ->> 'type' = 'matching' then
          select coalesce(jsonb_agg(v order by v), '[]') into rights from (select p -> 1 as v from jsonb_array_elements(coalesce(q -> 'pairs', '[]')) p) s;
          q := jsonb_set(q, '{pairs}', coalesce((select jsonb_agg(jsonb_build_array(p.v -> 0, rights -> (p.i::int - 1)) order by p.i)
                                                 from jsonb_array_elements(coalesce(q -> 'pairs', '[]')) with ordinality p(v, i)), '[]'));
        end if;
        qs := qs || jsonb_build_array(q - 'answer' - 'explanation' - 'aiDraft' - 'reviewed');
      end loop;
      l := jsonb_set(l, '{quiz,questions}', qs);
    end if;
    lessons := lessons || jsonb_build_array(l);
  end loop;
  return jsonb_build_object('course', content -> 'course', 'lessons', lessons);
end $$;

create function public.create_org_course(o uuid, content jsonb, source text default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare cid uuid;
begin
  if public.org_rank(o) < 4 then raise exception 'Only pastors, teachers and administrators can add courses.' using errcode = '42501'; end if;
  if jsonb_typeof(content -> 'course') <> 'object' or jsonb_typeof(content -> 'lessons') <> 'array' then raise exception 'The course could not be read.'; end if;
  insert into public.org_courses (org_id, title, description, source_course_id, created_by)
  values (o, coalesce(nullif(public.clean(content -> 'course' ->> 'title', 200), ''), 'Untitled course'), public.clean(content -> 'course' ->> 'description', 4000),
          left(source, 200), public.me())
  returning id into cid;
  insert into public.org_course_drafts (course_id, org_id, content, updated_by) values (cid, o, content, public.me());
  insert into public.org_course_instructors (course_id, org_id, user_id) values (cid, o, public.me());
  perform public.org_audit(o, 'course_created', cid, jsonb_build_object('copied_from_personal', source is not null));
  return cid;
end $$;

/** Saves the working copy only if nobody else saved since (rev), so two editors never overwrite each other. */
create function public.save_org_course_draft(cid uuid, base_rev int, content jsonb) returns int language plpgsql security definer set search_path = '' as $$
declare r int;
begin
  if not public.is_course_staff(cid) then raise exception 'Only this course''s instructors can edit it.' using errcode = '42501'; end if;
  if jsonb_typeof(content -> 'course') <> 'object' or jsonb_typeof(content -> 'lessons') <> 'array' then raise exception 'The course could not be read.'; end if;
  update public.org_course_drafts set content = save_org_course_draft.content, rev = rev + 1, updated_by = public.me(), updated_at = now()
    where course_id = cid and rev = base_rev returning rev into r;
  if not found then raise exception 'Someone else saved this course a moment ago. Reload to see their changes.'; end if;
  update public.org_courses set title = coalesce(nullif(public.clean(content -> 'course' ->> 'title', 200), ''), title),
    description = public.clean(content -> 'course' ->> 'description', 4000), updated_at = now() where id = cid;
  return r;
end $$;

create function public.set_org_course_options(cid uuid, p jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare c public.org_courses%rowtype;
begin
  select * into c from public.org_courses where id = cid;
  if not found or not public.is_course_staff(cid) then raise exception 'Only this course''s instructors can change it.' using errcode = '42501'; end if;
  update public.org_courses set
    catalog = coalesce((p ->> 'catalog')::boolean, catalog),
    enroll_deadline = case when p ? 'enroll_deadline' then nullif(p ->> 'enroll_deadline', '')::date else enroll_deadline end,
    status = case when p ->> 'status' = 'archived' then 'archived'
                  when p ->> 'status' = 'review' and status = 'draft' then 'review'
                  when p ->> 'status' = 'draft' and status = 'review' then 'draft'
                  when p ->> 'status' = 'published' and status = 'archived' and published_version > 0 then 'published'
                  else status end,
    updated_at = now()
  where id = cid;
  perform public.org_audit(c.org_id, 'course_options_changed', cid, p - 'content');
end $$;

/** Publishes the working copy as a new frozen version. Students already enrolled keep the version they started. */
create function public.publish_org_course(cid uuid, notes text default '') returns int language plpgsql security definer set search_path = '' as $$
declare
  c public.org_courses%rowtype;
  d public.org_course_drafts%rowtype;
  rk int;
  v int;
begin
  select * into c from public.org_courses where id = cid for update;
  if not found or not public.is_course_staff(cid) then raise exception 'Only this course''s instructors can publish it.' using errcode = '42501'; end if;
  rk := public.org_rank(c.org_id);
  if rk < 5 and (rk < 4 or (select require_course_review from public.orgs where id = c.org_id)) then
    raise exception 'An administrator must review and publish this course.' using errcode = '42501';
  end if;
  select * into d from public.org_course_drafts where course_id = cid;
  v := c.published_version + 1;
  insert into public.org_course_versions (course_id, version, org_id, content, notes, published_by) values (cid, v, c.org_id, d.content, public.clean(notes, 2000), public.me());
  insert into public.org_course_releases (course_id, version, org_id, content) values (cid, v, c.org_id, public.student_copy(d.content));
  update public.org_courses set status = 'published', published_version = v, updated_at = now() where id = cid;
  perform public.org_audit(c.org_id, 'course_published', cid, jsonb_build_object('version', v));
  return v;
end $$;

create function public.assign_instructor(cid uuid, u uuid, assign boolean) returns void language plpgsql security definer set search_path = '' as $$
declare c public.org_courses%rowtype;
begin
  select * into c from public.org_courses where id = cid;
  if not found or not (public.org_rank(c.org_id) >= 5 or (public.org_rank(c.org_id) >= 4 and public.is_course_staff(cid))) then
    raise exception 'Only administrators or this course''s pastor or teacher can assign instructors.' using errcode = '42501';
  end if;
  if assign then
    if not exists (select 1 from public.org_members where org_id = c.org_id and user_id = u and removed_at is null and public.role_rank(role) >= 3) then
      raise exception 'Instructors need the Instructor role or above.';
    end if;
    insert into public.org_course_instructors (course_id, org_id, user_id) values (cid, c.org_id, u) on conflict do nothing;
  else
    delete from public.org_course_instructors where course_id = cid and user_id = u;
  end if;
  perform public.org_audit(c.org_id, case when assign then 'instructor_assigned' else 'instructor_unassigned' end, u, jsonb_build_object('course', cid));
end $$;

create function public.enroll_self(cid uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  c public.org_courses%rowtype;
  eid uuid;
begin
  select * into c from public.org_courses where id = cid;
  if not found or public.org_rank(c.org_id) < 1 or c.status <> 'published' or not c.catalog then raise exception 'This course is not open for enrollment.' using errcode = '42501'; end if;
  if c.enroll_deadline is not null and c.enroll_deadline < current_date then raise exception 'Enrollment for this course has closed.'; end if;
  insert into public.org_enrollments (org_id, course_id, user_id, version, enrolled_by) values (c.org_id, cid, public.me(), c.published_version, public.me())
  on conflict (course_id, user_id) where user_id is not null do update set status = 'active', withdrawn_at = null, updated_at = now()
    where public.org_enrollments.status = 'withdrawn'
  returning id into eid;
  if eid is null then select id into eid from public.org_enrollments where course_id = cid and user_id = public.me(); end if;
  perform public.org_audit(c.org_id, 'enrolled_self', eid);
  return eid;
end $$;

create function public.enroll_members(cid uuid, users uuid[], deadline date default null) returns int language plpgsql security definer set search_path = '' as $$
declare
  c public.org_courses%rowtype;
  u uuid;
  n int := 0;
begin
  select * into c from public.org_courses where id = cid;
  if not found or not public.is_course_staff(cid) then raise exception 'Only this course''s instructors can enroll students.' using errcode = '42501'; end if;
  if c.status <> 'published' then raise exception 'Publish the course before enrolling students.'; end if;
  foreach u in array coalesce(users, '{}') loop
    if not exists (select 1 from public.org_members where org_id = c.org_id and user_id = u and removed_at is null) then
      raise exception 'Only current members of this workspace can be enrolled.';
    end if;
    insert into public.org_enrollments (org_id, course_id, user_id, version, enrolled_by, deadline) values (c.org_id, cid, u, c.published_version, public.me(), deadline)
    on conflict (course_id, user_id) where user_id is not null do update set status = 'active', withdrawn_at = null, deadline = excluded.deadline, updated_at = now()
      where public.org_enrollments.status = 'withdrawn';
    n := n + 1;
  end loop;
  perform public.org_audit(c.org_id, 'enrolled_by_staff', cid, jsonb_build_object('count', n));
  return n;
end $$;

create function public.withdraw_enrollment(eid uuid) returns void language plpgsql security definer set search_path = '' as $$
declare e public.org_enrollments%rowtype;
begin
  select * into e from public.org_enrollments where id = eid for update;
  if not found or not (public.is_my_enrollment(eid) or public.is_course_staff(e.course_id)) then raise exception 'Enrollment not found.' using errcode = '42501'; end if;
  update public.org_enrollments set status = 'withdrawn', withdrawn_at = now(), updated_at = now() where id = eid and status = 'active';
  perform public.org_audit(e.org_id, 'enrollment_withdrawn', eid);
end $$;

/** Moves a student to the latest published version; completed lessons with the same id carry over. */
create function public.update_enrollment_version(eid uuid) returns int language plpgsql security definer set search_path = '' as $$
declare
  e public.org_enrollments%rowtype;
  v int;
begin
  select * into e from public.org_enrollments where id = eid for update;
  if not found or not (public.is_my_enrollment(eid) or public.is_course_staff(e.course_id)) then raise exception 'Enrollment not found.' using errcode = '42501'; end if;
  if e.status <> 'active' then raise exception 'Only an active enrollment can move to the new version.'; end if;
  select published_version into v from public.org_courses where id = e.course_id;
  update public.org_enrollments set version = v, updated_at = now() where id = eid;
  perform public.refresh_completion(eid);
  return v;
end $$;

/** Recomputes completion from the saved activity (lessons, required quizzes, attendance) for the enrolled version. */
create function public.refresh_completion(eid uuid) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  e public.org_enrollments%rowtype;
  vc jsonb;
  rules jsonb;
  ok boolean := true;
  need int;
begin
  select * into e from public.org_enrollments where id = eid for update;
  if not found or e.status = 'withdrawn' then return false; end if;
  select content into vc from public.org_course_versions where course_id = e.course_id and version = e.version;
  rules := coalesce(vc -> 'course' -> 'completion', '{}');
  if coalesce((rules ->> 'lessons')::boolean, true) then
    ok := ok and not exists (
      select 1 from jsonb_array_elements(coalesce(vc -> 'course' -> 'units', '[]')) u, jsonb_array_elements_text(coalesce(u -> 'lessonIds', '[]')) lid
      where not exists (select 1 from public.org_lesson_progress p where p.enrollment_id = eid and p.lesson_id = lid));
  end if;
  if coalesce((rules ->> 'quizzes')::boolean, false) then
    ok := ok and not exists (
      select 1 from jsonb_array_elements(coalesce(vc -> 'lessons', '[]')) l
      where jsonb_typeof(l -> 'quiz') = 'object' and coalesce((l -> 'quiz' ->> 'required')::boolean, false)
        and not exists (select 1 from public.org_quiz_attempts a where a.enrollment_id = eid and a.lesson_id = l ->> 'id' and a.passed));
  end if;
  need := coalesce((rules ->> 'attendance')::int, 0);
  if need > 0 then
    ok := ok and (select count(*) from public.org_attendance a where a.enrollment_id = eid and a.status in ('present', 'late')) >= need;
  end if;
  if ok and e.completed_at is null then
    update public.org_enrollments set status = 'completed', completed_at = now(), updated_at = now() where id = eid;
  elsif not ok and e.completed_at is not null and e.certificate_at is null then
    update public.org_enrollments set status = 'active', completed_at = null, updated_at = now() where id = eid;
  end if;
  return ok;
end $$;

create function public.mark_lesson(eid uuid, lesson text, done boolean) returns boolean language plpgsql security definer set search_path = '' as $$
declare e public.org_enrollments%rowtype;
begin
  select * into e from public.org_enrollments where id = eid;
  if not found or not public.is_my_enrollment(eid) or e.status = 'withdrawn' then raise exception 'Enrollment not found.' using errcode = '42501'; end if;
  if not exists (select 1 from public.org_course_versions v, jsonb_array_elements(v.content -> 'lessons') l
                 where v.course_id = e.course_id and v.version = e.version and l ->> 'id' = lesson) then
    raise exception 'That lesson is not part of this course.';
  end if;
  if done then
    insert into public.org_lesson_progress (enrollment_id, org_id, lesson_id) values (eid, e.org_id, lesson) on conflict do nothing;
  else
    delete from public.org_lesson_progress where enrollment_id = eid and lesson_id = lesson;
  end if;
  update public.org_enrollments set last_lesson_id = lesson, updated_at = now() where id = eid;
  return public.refresh_completion(eid);
end $$;

create function public.set_last_lesson(eid uuid, lesson text) returns void language sql security definer set search_path = '' as $$
  update public.org_enrollments set last_lesson_id = left(lesson, 200), updated_at = now() where id = eid and public.is_my_enrollment(eid)
$$;

create function public.claim_certificate(eid uuid) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare at timestamptz;
begin
  update public.org_enrollments set certificate_at = coalesce(certificate_at, now()), updated_at = now()
    where id = eid and public.is_my_enrollment(eid) and status = 'completed' returning certificate_at into at;
  if at is null then raise exception 'The certificate is available once the course is complete.'; end if;
  return at;
end $$;

/** A reflection or written assignment answer. The prompt must be one the enrolled version actually asks. */
create function public.save_written_answer(eid uuid, lesson text, kind text, prompt text, body text) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  e public.org_enrollments%rowtype;
  aid uuid;
begin
  select * into e from public.org_enrollments where id = eid;
  if not found or not public.is_my_enrollment(eid) or e.status = 'withdrawn' then raise exception 'Enrollment not found.' using errcode = '42501'; end if;
  if save_written_answer.kind not in ('reflection', 'assignment') or not exists (
    select 1 from public.org_course_versions v, jsonb_array_elements(v.content -> 'lessons') l,
                  jsonb_array_elements_text(coalesce(l -> case save_written_answer.kind when 'reflection' then 'reflection' else 'assignments' end, '[]')) q
    where v.course_id = e.course_id and v.version = e.version and l ->> 'id' = lesson and q = save_written_answer.prompt) then
    raise exception 'That question is not part of this lesson.';
  end if;
  insert into public.org_written_answers (org_id, course_id, enrollment_id, lesson_id, kind, prompt, body)
  values (e.org_id, e.course_id, eid, lesson, save_written_answer.kind, save_written_answer.prompt, left(coalesce(save_written_answer.body, ''), 20000))
  on conflict on constraint org_written_answers_enrollment_id_lesson_id_kind_prompt_key do update set body = excluded.body, updated_at = now()
  returning id into aid;
  return aid;
end $$;

create function public.grade_written_answer(aid uuid, grade text, points numeric, feedback text) returns void language plpgsql security definer set search_path = '' as $$
declare w public.org_written_answers%rowtype;
begin
  select * into w from public.org_written_answers where id = aid for update;
  if not found or not public.is_course_staff(w.course_id) then raise exception 'Only this course''s instructors can grade it.' using errcode = '42501'; end if;
  update public.org_written_answers set grade = grade_written_answer.grade, points = grade_written_answer.points,
    feedback = public.clean(grade_written_answer.feedback, 4000), graded_by = public.me(), graded_at = now() where id = aid;
  perform public.org_audit(w.org_id, 'answer_graded', aid);
end $$;

create function public.review_quiz_attempt(aid uuid, manual jsonb, feedback text) returns void language plpgsql security definer set search_path = '' as $$
declare a public.org_quiz_attempts%rowtype;
begin
  select * into a from public.org_quiz_attempts where id = aid for update;
  if not found or not public.is_course_staff(a.course_id) then raise exception 'Only this course''s instructors can review it.' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(manual, '{}')) <> 'object' then raise exception 'The review could not be read.'; end if;
  update public.org_quiz_attempts set manual = coalesce(review_quiz_attempt.manual, '{}'), feedback = public.clean(review_quiz_attempt.feedback, 4000),
    reviewed_by = public.me(), reviewed_at = now() where id = aid;
  perform public.org_audit(a.org_id, 'quiz_reviewed', aid);
end $$;

/** Checked before the server grades a quiz: the caller's enrollment, the version, and tries left. */
create function public.quiz_attempt_check(cid uuid, lesson text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  e public.org_enrollments%rowtype;
  q jsonb;
  used int;
begin
  select * into e from public.org_enrollments where course_id = cid and user_id = public.me() and status in ('active', 'completed');
  if not found or public.org_rank(e.org_id) < 1 then raise exception 'You are not enrolled in this course.' using errcode = '42501'; end if;
  select l -> 'quiz' into q from public.org_course_versions v, jsonb_array_elements(v.content -> 'lessons') l
    where v.course_id = cid and v.version = e.version and l ->> 'id' = lesson;
  if q is null or jsonb_typeof(q) <> 'object' then raise exception 'This lesson has no quiz.'; end if;
  select count(*) into used from public.org_quiz_attempts where enrollment_id = e.id and lesson_id = lesson;
  if (used > 0 and not coalesce((q ->> 'allowRetake')::boolean, true)) or (coalesce((q ->> 'attempts')::int, 0) > 0 and used >= (q ->> 'attempts')::int) then
    raise exception 'No tries left for this quiz.';
  end if;
  return jsonb_build_object('enrollment_id', e.id, 'version', e.version, 'org_id', e.org_id, 'used', used);
end $$;

create function public.create_session(cid uuid, held_on date, title text) returns uuid language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  if not public.is_course_staff(cid) then raise exception 'Only this course''s instructors can add sessions.' using errcode = '42501'; end if;
  insert into public.org_sessions (org_id, course_id, held_on, title, created_by)
  select org_id, cid, create_session.held_on, public.clean(create_session.title, 200), public.me() from public.org_courses where id = cid returning id into sid;
  return sid;
end $$;

create function public.delete_session(sid uuid) returns void language plpgsql security definer set search_path = '' as $$
declare s public.org_sessions%rowtype; e uuid;
begin
  select * into s from public.org_sessions where id = sid;
  if not found or not public.is_course_staff(s.course_id) then raise exception 'Session not found.' using errcode = '42501'; end if;
  delete from public.org_sessions where id = sid;
  for e in select id from public.org_enrollments where course_id = s.course_id loop perform public.refresh_completion(e); end loop;
  perform public.org_audit(s.org_id, 'session_deleted', sid);
end $$;

/** Attendance is recorded by an instructor for a real session; it is never inferred from app activity. */
create function public.record_attendance(sid uuid, eid uuid, status text) returns void language plpgsql security definer set search_path = '' as $$
declare s public.org_sessions%rowtype;
begin
  select * into s from public.org_sessions where id = sid;
  if not found or not public.is_course_staff(s.course_id) then raise exception 'Only this course''s instructors can take attendance.' using errcode = '42501'; end if;
  if not exists (select 1 from public.org_enrollments where id = eid and course_id = s.course_id) then raise exception 'That student is not in this course.'; end if;
  if status is null then
    delete from public.org_attendance where session_id = sid and enrollment_id = eid;
  else
    insert into public.org_attendance (session_id, org_id, enrollment_id, status, recorded_by) values (sid, s.org_id, eid, status, public.me())
    on conflict (session_id, enrollment_id) do update set status = excluded.status, recorded_by = excluded.recorded_by, recorded_at = now();
  end if;
  perform public.refresh_completion(eid);
end $$;

/* ============================== group functions ============================== */

create function public.save_group(o uuid, gid uuid, p jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  id_ uuid := gid;
  leader uuid := coalesce((p ->> 'leader')::uuid, public.me());
begin
  if gid is null then
    if public.org_rank(o) < 4 then raise exception 'Only pastors, teachers and administrators can create groups.' using errcode = '42501'; end if;
    if public.clean(p ->> 'name', 120) = '' then raise exception 'Enter the group name.'; end if;
    if not exists (select 1 from public.org_members where org_id = o and user_id = leader and removed_at is null and public.role_rank(role) >= 2) then
      raise exception 'The group leader needs the Group Leader role or above.';
    end if;
    insert into public.org_groups (org_id, name, description, topic, visibility, schedule, discussions, created_by)
    values (o, public.clean(p ->> 'name', 120), public.clean(p ->> 'description', 2000), public.clean(p ->> 'topic', 200),
            coalesce(p ->> 'visibility', 'private'), public.clean(p ->> 'schedule', 200), coalesce((p ->> 'discussions')::boolean, false), public.me())
    returning id into id_;
    insert into public.org_group_members (group_id, org_id, user_id, role) values (id_, o, leader, 'leader');
    perform public.org_audit(o, 'group_created', id_);
  else
    if not public.is_group_leader(gid) or not exists (select 1 from public.org_groups where id = gid and org_id = o) then
      raise exception 'Only this group''s leader can change it.' using errcode = '42501';
    end if;
    update public.org_groups set
      name = coalesce(nullif(public.clean(p ->> 'name', 120), ''), name),
      description = case when p ? 'description' then public.clean(p ->> 'description', 2000) else description end,
      topic = case when p ? 'topic' then public.clean(p ->> 'topic', 200) else topic end,
      visibility = coalesce(p ->> 'visibility', visibility),
      schedule = case when p ? 'schedule' then public.clean(p ->> 'schedule', 200) else schedule end,
      discussions = coalesce((p ->> 'discussions')::boolean, discussions),
      archived_at = case when p ? 'archived' then case when (p ->> 'archived')::boolean then coalesce(archived_at, now()) end else archived_at end
    where id = gid;
  end if;
  return id_;
end $$;

/** Adds, promotes or removes a group member (leader), or lets a member leave. */
create function public.set_group_member(gid uuid, u uuid, r text) returns void language plpgsql security definer set search_path = '' as $$
declare
  g public.org_groups%rowtype;
begin
  select * into g from public.org_groups where id = gid;
  if not found then raise exception 'Group not found.' using errcode = '42501'; end if;
  if r is null and u = public.me() and public.is_group_member(gid) then
    update public.org_group_members set status = 'removed' where group_id = gid and user_id = u;
    return;
  end if;
  if not public.is_group_leader(gid) then raise exception 'Only this group''s leader can manage its members.' using errcode = '42501'; end if;
  if r is null then
    update public.org_group_members set status = 'removed' where group_id = gid and user_id = u;
  else
    if g.visibility = 'invite' and not exists (select 1 from public.org_group_members where group_id = gid and user_id = u) and r = 'member' then
      raise exception 'People join this group by invitation.';
    end if;
    if not exists (select 1 from public.org_members where org_id = g.org_id and user_id = u and removed_at is null
                   and (r = 'member' or public.role_rank(role) >= 2)) then
      raise exception 'Only current members can be added, and group leaders need the Group Leader role or above.';
    end if;
    insert into public.org_group_members (group_id, org_id, user_id, role) values (gid, g.org_id, u, r)
    on conflict (group_id, user_id) do update set role = excluded.role, status = 'active';
  end if;
  perform public.org_audit(g.org_id, 'group_member_changed', u, jsonb_build_object('group', gid, 'role', r));
end $$;

create function public.request_to_join_group(gid uuid) returns void language plpgsql security definer set search_path = '' as $$
declare g public.org_groups%rowtype;
begin
  select * into g from public.org_groups where id = gid;
  if not found or g.visibility <> 'org' or g.archived_at is not null or public.org_rank(g.org_id) < 1 then raise exception 'This group is not open to requests.' using errcode = '42501'; end if;
  insert into public.org_group_members (group_id, org_id, user_id, status) values (gid, g.org_id, public.me(), 'requested')
  on conflict (group_id, user_id) do update set status = 'requested' where public.org_group_members.status = 'removed';
end $$;

create function public.save_group_study(gid uuid, sid uuid, p jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  id_ uuid := sid;
  g public.org_groups%rowtype;
begin
  select * into g from public.org_groups where id = gid;
  if not found or not public.is_group_leader(gid) then raise exception 'Only this group''s leader can prepare studies.' using errcode = '42501'; end if;
  if sid is null then
    if public.clean(p ->> 'title', 200) = '' or public.clean(p ->> 'passage', 200) = '' then raise exception 'Enter a title and a passage.'; end if;
    insert into public.org_group_studies (org_id, group_id, title, passage, instructions, questions, resources, due_on, status, created_by)
    values (g.org_id, gid, public.clean(p ->> 'title', 200), public.clean(p ->> 'passage', 200), public.clean(p ->> 'instructions', 8000),
            coalesce(p -> 'questions', '[]'), coalesce(p -> 'resources', '[]'), nullif(p ->> 'due_on', '')::date, coalesce(p ->> 'status', 'draft'), public.me())
    returning id into id_;
  else
    update public.org_group_studies set
      title = coalesce(nullif(public.clean(p ->> 'title', 200), ''), title),
      passage = coalesce(nullif(public.clean(p ->> 'passage', 200), ''), passage),
      instructions = case when p ? 'instructions' then public.clean(p ->> 'instructions', 8000) else instructions end,
      questions = coalesce(p -> 'questions', questions),
      resources = coalesce(p -> 'resources', resources),
      due_on = case when p ? 'due_on' then nullif(p ->> 'due_on', '')::date else due_on end,
      status = coalesce(p ->> 'status', status),
      updated_at = now()
    where id = sid and group_id = gid;
    if not found then raise exception 'Study not found.'; end if;
  end if;
  return id_;
end $$;

create function public.note_on_response(sid uuid, u uuid, note text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.org_group_studies s where s.id = sid and public.is_group_leader(s.group_id)) then
    raise exception 'Only this group''s leader can respond.' using errcode = '42501';
  end if;
  update public.org_group_responses set leader_note = public.clean(note, 4000) where study_id = sid and user_id = u and status = 'submitted';
  if not found then raise exception 'No submitted response to answer.'; end if;
end $$;

create function public.create_topic(gid uuid, title text, sid uuid default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare tid uuid;
begin
  if not public.is_group_leader(gid) then raise exception 'Only this group''s leader can start topics.' using errcode = '42501'; end if;
  insert into public.org_discussion_topics (org_id, group_id, title, study_id, created_by)
  select org_id, gid, public.clean(create_topic.title, 200), sid, public.me() from public.org_groups where id = gid returning id into tid;
  return tid;
end $$;

create function public.moderate(kind text, target uuid, act text) returns void language plpgsql security definer set search_path = '' as $$
declare gid uuid; oid uuid;
begin
  if kind = 'post' then
    select t.group_id, t.org_id into gid, oid from public.org_discussion_posts p join public.org_discussion_topics t on t.id = p.topic_id where p.id = target;
  elsif kind = 'topic' then
    select group_id, org_id into gid, oid from public.org_discussion_topics where id = target;
  end if;
  if gid is null or not public.is_group_leader(gid) then raise exception 'Only this group''s leader can moderate it.' using errcode = '42501'; end if;
  if kind = 'post' and act = 'hide' then update public.org_discussion_posts set hidden_at = now(), hidden_by = public.me() where id = target;
  elsif kind = 'post' and act = 'show' then update public.org_discussion_posts set hidden_at = null, hidden_by = null where id = target;
  elsif kind = 'topic' and act = 'lock' then update public.org_discussion_topics set locked = true where id = target;
  elsif kind = 'topic' and act = 'unlock' then update public.org_discussion_topics set locked = false where id = target;
  elsif kind = 'topic' and act = 'delete' then delete from public.org_discussion_topics where id = target;
  else raise exception 'Unknown action.'; end if;
  perform public.org_audit(oid, 'moderated', target, jsonb_build_object('kind', kind, 'action', act));
end $$;

create function public.report_content(kind text, target uuid, reason text) returns uuid language plpgsql security definer set search_path = '' as $$
declare gid uuid; oid uuid; rid uuid;
begin
  if kind = 'post' then
    select t.group_id, t.org_id into gid, oid from public.org_discussion_posts p join public.org_discussion_topics t on t.id = p.topic_id
      where p.id = target and (public.is_group_member(t.group_id) or public.is_group_leader(t.group_id));
  elsif kind = 'resource' then
    select r.group_id, r.org_id into gid, oid from public.org_shared_resources r where r.id = target and public.can_see_resource(r.id);
  end if;
  if oid is null then raise exception 'Not found.' using errcode = '42501'; end if;
  if (select count(*) from public.org_content_reports where reporter = public.me() and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many reports in the last hour.';
  end if;
  insert into public.org_content_reports (org_id, group_id, reporter, target_kind, target_id, reason)
  values (oid, gid, public.me(), kind, target, public.clean(reason, 1000)) returning id into rid;
  return rid;
end $$;

create function public.resolve_report(rid uuid, outcome text) returns void language plpgsql security definer set search_path = '' as $$
declare r public.org_content_reports%rowtype;
begin
  select * into r from public.org_content_reports where id = rid for update;
  if not found or not (public.org_rank(r.org_id) >= 5 or (r.group_id is not null and public.is_group_leader(r.group_id))) then
    raise exception 'Report not found.' using errcode = '42501';
  end if;
  if outcome = 'hidden' and r.target_kind = 'post' then update public.org_discussion_posts set hidden_at = now(), hidden_by = public.me() where id = r.target_id; end if;
  if outcome = 'removed' and r.target_kind = 'resource' then delete from public.org_shared_resources where id = r.target_id; end if;
  update public.org_content_reports set resolved_at = now(), resolved_by = public.me(), outcome = resolve_report.outcome where id = rid;
  perform public.org_audit(r.org_id, 'report_resolved', rid, jsonb_build_object('outcome', outcome));
end $$;

/* ============================== sharing and announcement functions ============================== */

create function public.share_resource(o uuid, gid uuid, p jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  rid uuid;
  rk int := public.org_rank(o);
begin
  if rk < 1 then raise exception 'Not a member.' using errcode = '42501'; end if;
  if public.clean(p ->> 'title', 200) = '' then raise exception 'Enter a title.'; end if;
  if gid is not null and not exists (select 1 from public.org_groups where id = gid and org_id = o) then raise exception 'Group not found.'; end if;
  if gid is not null and not (public.is_group_member(gid) or public.is_group_leader(gid)) then raise exception 'You can only share with groups you belong to.' using errcode = '42501'; end if;
  insert into public.org_shared_resources (org_id, group_id, owner_id, kind, title, description, content, source_id, access, approved_at, approved_by)
  values (o, gid, public.me(), p ->> 'kind', public.clean(p ->> 'title', 200), public.clean(p ->> 'description', 2000), p -> 'content',
          left(p ->> 'source_id', 200), coalesce(p ->> 'access', 'view'),
          case when gid is not null or rk >= 4 then now() end, case when gid is not null or rk >= 4 then public.me() end)
  returning id into rid;
  perform public.org_audit(o, 'resource_shared', rid, jsonb_build_object('kind', p ->> 'kind', 'group', gid));
  return rid;
end $$;

create function public.update_shared_resource(rid uuid, p jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare r public.org_shared_resources%rowtype;
begin
  select * into r from public.org_shared_resources where id = rid for update;
  if not found or public.org_rank(r.org_id) < 1 or not (r.owner_id = public.me() or (r.access = 'edit' and exists (
    select 1 from public.org_resource_editors e where e.resource_id = rid and e.user_id = public.me()))) then
    raise exception 'Only the owner or an invited editor can change this.' using errcode = '42501';
  end if;
  update public.org_shared_resources set
    title = coalesce(nullif(public.clean(p ->> 'title', 200), ''), title),
    description = case when p ? 'description' then public.clean(p ->> 'description', 2000) else description end,
    content = coalesce(p -> 'content', content),
    access = case when r.owner_id = public.me() then coalesce(p ->> 'access', access) else access end,
    updated_at = now(), updated_by = public.me()
  where id = rid;
end $$;

/** The owner withdraws a share (the copy is deleted), or an administrator removes it from the workspace. */
create function public.revoke_shared_resource(rid uuid) returns void language plpgsql security definer set search_path = '' as $$
declare r public.org_shared_resources%rowtype;
begin
  select * into r from public.org_shared_resources where id = rid;
  if not found or not ((r.owner_id = public.me() and public.org_rank(r.org_id) >= 1) or public.org_rank(r.org_id) >= 5) then raise exception 'Not found.' using errcode = '42501'; end if;
  delete from public.org_shared_resources where id = rid;
  perform public.org_audit(r.org_id, 'resource_revoked', rid);
end $$;

create function public.approve_shared_resource(rid uuid) returns void language plpgsql security definer set search_path = '' as $$
declare r public.org_shared_resources%rowtype;
begin
  select * into r from public.org_shared_resources where id = rid;
  if not found or public.org_rank(r.org_id) < 5 then raise exception 'Only administrators can approve workspace-wide shares.' using errcode = '42501'; end if;
  update public.org_shared_resources set approved_at = now(), approved_by = public.me() where id = rid;
  perform public.org_audit(r.org_id, 'resource_approved', rid);
end $$;

create function public.set_resource_editor(rid uuid, u uuid, allow boolean) returns void language plpgsql security definer set search_path = '' as $$
declare r public.org_shared_resources%rowtype;
begin
  select * into r from public.org_shared_resources where id = rid;
  if not found or r.owner_id is distinct from public.me() or public.org_rank(r.org_id) < 1 then raise exception 'Only the owner can invite editors.' using errcode = '42501'; end if;
  if allow then
    if not exists (select 1 from public.org_members where org_id = r.org_id and user_id = u and removed_at is null) then raise exception 'Editors must be members of this workspace.'; end if;
    insert into public.org_resource_editors (resource_id, org_id, user_id) values (rid, r.org_id, u) on conflict do nothing;
    update public.org_shared_resources set access = 'edit' where id = rid;
  else
    delete from public.org_resource_editors where resource_id = rid and user_id = u;
  end if;
end $$;

create function public.post_announcement(o uuid, p jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  gid uuid := nullif(p ->> 'group_id', '')::uuid;
  cid uuid := nullif(p ->> 'course_id', '')::uuid;
  aid uuid;
begin
  if gid is not null then
    if not public.is_group_leader(gid) or not exists (select 1 from public.org_groups where id = gid and org_id = o) then raise exception 'Only this group''s leader can post here.' using errcode = '42501'; end if;
  elsif cid is not null then
    if not public.is_course_staff(cid) or not exists (select 1 from public.org_courses where id = cid and org_id = o) then raise exception 'Only this course''s instructors can post here.' using errcode = '42501'; end if;
  elsif public.org_rank(o) < 4 then
    raise exception 'Only pastors, teachers and administrators can post to the whole workspace.' using errcode = '42501';
  end if;
  if public.clean(p ->> 'title', 200) = '' then raise exception 'Enter a title.'; end if;
  if (select count(*) from public.org_announcements where created_by = public.me() and created_at > now() - interval '1 day') >= 30 then
    raise exception 'Too many announcements today.';
  end if;
  insert into public.org_announcements (org_id, group_id, course_id, title, body, pinned, expires_on, created_by)
  values (o, gid, cid, public.clean(p ->> 'title', 200), public.clean(p ->> 'body', 8000), coalesce((p ->> 'pinned')::boolean, false),
          nullif(p ->> 'expires_on', '')::date, public.me())
  returning id into aid;
  return aid;
end $$;

create function public.delete_announcement(aid uuid) returns void language plpgsql security definer set search_path = '' as $$
declare a public.org_announcements%rowtype;
begin
  select * into a from public.org_announcements where id = aid;
  if not found or not ((a.created_by = public.me() and public.org_rank(a.org_id) >= 1) or public.org_rank(a.org_id) >= 5) then
    raise exception 'Not found.' using errcode = '42501';
  end if;
  delete from public.org_announcements where id = aid;
end $$;

/* ============================== function permissions ============================== */

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in (
             'role_rank', 'me', 'clean', 'org_rank', 'org_audit', 'is_course_staff', 'my_enrollment', 'is_my_enrollment', 'enrollment_staff',
             'is_group_member', 'is_group_leader', 'can_see_group', 'can_see_resource', 'can_see_announcement', 'can_see_member',
             'set_org_from_parent', 'response_stamp', 'create_org', 'update_org', 'check_invite_authority', 'create_invitation',
             'resend_invitation', 'revoke_invitation', 'invitation_preview', 'accept_invitation', 'set_member_role', 'remove_member',
             'set_my_member_settings', 'offer_ownership', 'my_ownership_offers', 'accept_ownership', 'cancel_ownership_offer', 'delete_org',
             'restore_org', 'my_deleted_orgs', 'orgs_blocking_account_deletion', 'student_copy', 'create_org_course', 'save_org_course_draft',
             'set_org_course_options', 'publish_org_course', 'assign_instructor', 'enroll_self', 'enroll_members', 'withdraw_enrollment',
             'update_enrollment_version', 'refresh_completion', 'mark_lesson', 'set_last_lesson', 'claim_certificate', 'save_written_answer',
             'grade_written_answer', 'review_quiz_attempt', 'quiz_attempt_check', 'create_session', 'delete_session', 'record_attendance',
             'save_group', 'set_group_member', 'request_to_join_group', 'save_group_study', 'note_on_response', 'create_topic', 'moderate',
             'report_content', 'resolve_report', 'share_resource', 'update_shared_resource', 'revoke_shared_resource',
             'approve_shared_resource', 'set_resource_editor', 'post_announcement', 'delete_announcement') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
    -- internal helpers stay closed to signed-in users; everything else checks its own permissions
    if f.proname not in ('org_audit', 'check_invite_authority', 'refresh_completion', 'set_org_from_parent', 'response_stamp',
                         'orgs_blocking_account_deletion', 'student_copy') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
