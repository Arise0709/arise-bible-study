-- Undo for 20261102000200_cycle6_mfa_required.sql: owner-only policies without the two-step check.
alter policy records_select on public.user_records using (user_id = auth.uid());
alter policy records_insert on public.user_records with check (user_id = auth.uid());
alter policy records_update on public.user_records using (user_id = auth.uid()) with check (user_id = auth.uid());
alter policy history_select on public.user_record_history using (user_id = auth.uid());
alter policy history_insert on public.user_record_history with check (user_id = auth.uid());
alter policy history_delete on public.user_record_history using (user_id = auth.uid());
drop function if exists public.mfa_satisfied();
