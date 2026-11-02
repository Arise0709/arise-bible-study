-- People who turn on two-step sign-in (an authenticator app) must have completed it (aal2) before the
-- database lets their session read or write their data. People without it are unaffected.
-- Undo: 20261102000200_cycle6_mfa_required.down.sql

-- Runs with the owner's rights only to look up the caller's own factors; the factor table itself (which
-- holds secrets) is never exposed to signed-in users.
create function public.mfa_satisfied() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
$$;
revoke all on function public.mfa_satisfied() from public, anon;
grant execute on function public.mfa_satisfied() to authenticated;

alter policy records_select on public.user_records using (user_id = auth.uid() and public.mfa_satisfied());
alter policy records_insert on public.user_records with check (user_id = auth.uid() and public.mfa_satisfied());
alter policy records_update on public.user_records using (user_id = auth.uid() and public.mfa_satisfied()) with check (user_id = auth.uid() and public.mfa_satisfied());
alter policy history_select on public.user_record_history using (user_id = auth.uid() and public.mfa_satisfied());
alter policy history_insert on public.user_record_history with check (user_id = auth.uid() and public.mfa_satisfied());
alter policy history_delete on public.user_record_history using (user_id = auth.uid() and public.mfa_satisfied());
