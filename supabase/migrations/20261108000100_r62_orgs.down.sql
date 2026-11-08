-- Undo Release 6.2 (church workspaces). Deletes every workspace, course, group, share and announcement in the
-- cloud: take a dump first (see docs/operations/backup-and-recovery.md). Personal study data (user_records) is
-- not touched.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in (
             'create_org', 'update_org', 'check_invite_authority', 'create_invitation', 'resend_invitation', 'revoke_invitation',
             'invitation_preview', 'accept_invitation', 'set_member_role', 'remove_member', 'set_my_member_settings', 'offer_ownership',
             'my_ownership_offers', 'accept_ownership', 'cancel_ownership_offer', 'delete_org', 'restore_org', 'my_deleted_orgs',
             'orgs_blocking_account_deletion', 'student_copy', 'published_snapshot', 'create_org_course', 'save_org_course_draft', 'set_org_course_options',
             'publish_org_course', 'assign_instructor', 'enroll_self', 'enroll_members', 'withdraw_enrollment', 'update_enrollment_version',
             'refresh_completion', 'mark_lesson', 'set_last_lesson', 'claim_certificate', 'save_written_answer', 'grade_written_answer',
             'review_quiz_attempt', 'quiz_attempt_check', 'create_session', 'delete_session', 'record_attendance', 'save_group',
             'set_group_member', 'request_to_join_group', 'save_group_study', 'note_on_response', 'create_topic', 'moderate',
             'report_content', 'resolve_report', 'share_resource', 'update_shared_resource', 'revoke_shared_resource',
             'approve_shared_resource', 'set_resource_editor', 'post_announcement', 'delete_announcement', 'org_report') loop
    execute format('drop function %s', f.sig);
  end loop;
end $$;

drop table if exists
  public.org_announcement_reads, public.org_announcements, public.org_resource_editors, public.org_shared_resources,
  public.org_content_reports, public.org_discussion_posts, public.org_discussion_topics, public.org_group_responses,
  public.org_group_studies, public.org_group_members, public.org_groups, public.org_attendance, public.org_sessions,
  public.org_written_answers, public.org_quiz_attempts, public.org_lesson_progress, public.org_enrollments,
  public.org_course_instructors, public.org_course_releases, public.org_course_versions, public.org_course_drafts,
  public.org_courses, public.org_audit_events, public.org_ownership_transfers, public.org_invitations,
  public.org_member_contacts, public.org_members, public.orgs cascade;

drop function if exists public.my_visible_members(), public.my_staff_enrollments(), public.my_staff_courses(), public.my_enrollments(), public.set_org_from_parent(), public.response_stamp(), public.can_see_member(uuid, uuid),
  public.can_see_announcement(uuid), public.can_see_resource(uuid), public.can_see_group(uuid), public.is_group_leader(uuid),
  public.is_group_member(uuid), public.enrollment_staff(uuid), public.is_my_enrollment(uuid), public.my_enrollment(uuid),
  public.is_course_staff(uuid), public.org_audit(uuid, text, uuid, jsonb), public.org_rank(uuid), public.clean(text, int),
  public.me(), public.role_rank(text);

alter table public.profiles drop column if exists adult_confirmed_at, drop column if exists adult_confirmed_18;
