-- Undo for 20261102000100_cycle6_sync.sql. Removes the sync tables and functions.
-- Run only after exporting data (pg_dump) if any real records exist: this deletes cloud copies.
-- Browser copies on each device are not affected.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop function if exists public.sync_push(text, jsonb);
drop function if exists public.sync_pull(bigint, int);
drop function if exists public.log_event(text, jsonb);
drop function if exists public.is_long_form(text);
drop table if exists public.audit_events;
drop table if exists public.user_record_history;
drop table if exists public.user_records;
drop table if exists public.profiles;
drop sequence if exists public.sync_seq;
