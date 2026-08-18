-- ALTARA Messenger V1 group lifecycle: LEAVE GROUP and DELETE GROUP.
-- Forward-only: run after
-- net-altara-messenger-audit-trigger-record-field-fix.sql.
--
-- Schema/FK audit (proven, not assumed, before choosing statement order):
--   net_altara_conversation_members.conversation_id
--     references net_altara_conversations (id) on delete cascade
--   net_altara_messages.conversation_id
--     references net_altara_conversations (id) on delete cascade
-- These are the ONLY foreign keys anywhere in the schema that reference
-- net_altara_conversations. Deleting a conversation row therefore already
-- cascades to remove exactly its own membership rows and its own messages,
-- and nothing else -- no other table references any Messenger table.
-- net_action_audit.resource_id is a plain uuid column with no foreign key
-- (net_action_audit_resource_pair only requires resource_type/resource_id to
-- be both-null or both-set) -- audit rows referencing a deleted
-- conversation are never cascaded away and remain as immutable history,
-- matching the deployed contract for that table.

begin;

do $$
begin
  if to_regclass('public.net_altara_conversations') is null
    or to_regclass('public.net_altara_conversation_members') is null
    or to_regclass('public.net_altara_messages') is null
    or to_regclass('public.net_action_audit') is null
    or to_regprocedure('public.net_altara_assert_messenger_context(uuid)') is null
    or to_regprocedure('public.net_altara_bump_messenger_revisions(uuid[])') is null
    or to_regprocedure('public.net_runtime_action_context(uuid)') is null
  then
    raise exception 'NET_ALTARA_MESSENGER_GROUP_LIFECYCLE_DEPENDENCY_REQUIRED'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.net_altara_conversation_members'::regclass
      and constraint_record.contype = 'f'
      and constraint_record.confrelid = 'public.net_altara_conversations'::regclass
      and constraint_record.confdeltype = 'c'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.net_altara_messages'::regclass
      and constraint_record.contype = 'f'
      and constraint_record.confrelid = 'public.net_altara_conversations'::regclass
      and constraint_record.confdeltype = 'c'
  ) then
    raise exception 'NET_ALTARA_MESSENGER_GROUP_LIFECYCLE_CASCADE_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.contype = 'f'
      and constraint_record.confrelid in (
        'public.net_altara_conversations'::regclass,
        'public.net_altara_conversation_members'::regclass,
        'public.net_altara_messages'::regclass
      )
      and constraint_record.conrelid not in (
        'public.net_altara_conversation_members'::regclass,
        'public.net_altara_messages'::regclass
      )
  ) then
    raise exception 'NET_ALTARA_MESSENGER_GROUP_LIFECYCLE_UNEXPECTED_REFERENCE'
      using errcode = '55000';
  end if;
end;
$$;

-- A regular (non-owner) member removes only their own membership. There is
-- no target-identity parameter: the actor can never remove anyone but the
-- exact identity net_altara_assert_messenger_context() just resolved for
-- them, so this can never be used to make another identity leave.
--
-- "Not found or not an eligible group member" is folded into one uniform
-- outcome, matching how fetch_net_altara_message_page/
-- remove_net_altara_group_member already avoid distinguishing "conversation
-- absent" from "conversation exists but caller has no standing" -- a
-- non-existent id, an existing group the caller never joined, an already-left
-- retry, and a DM the caller is a genuine party to (folded in via the join
-- requiring conversation_kind = 'group') are all indistinguishable from the
-- response alone.
create or replace function public.leave_net_altara_group(
  requested_expected_identity_link_id uuid,
  requested_conversation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_identity_link_id uuid;
  v_member_role text;
begin
  v_actor_identity_link_id := public.net_altara_assert_messenger_context(
    requested_expected_identity_link_id
  );

  select membership.member_role
  into v_member_role
  from public.net_altara_conversation_members as membership
  join public.net_altara_conversations as conversation
    on conversation.id = membership.conversation_id
    and conversation.conversation_kind = 'group'
  where membership.conversation_id = requested_conversation_id
    and membership.identity_link_id = v_actor_identity_link_id
  for update of conversation;

  if not found then
    -- Already not a current member of an existing group -- whether because
    -- the id never existed, the caller never joined, the id is a DM, or
    -- this is an exact retry of the caller's own prior successful leave.
    -- The caller's desired end state already holds; report the same
    -- idempotent outcome rather than an error, without revealing which of
    -- those cases applied.
    return jsonb_build_object(
      'conversation_id', requested_conversation_id,
      'left', false
    );
  end if;

  if v_member_role = 'owner' then
    raise exception 'ALTARA_MESSENGER_OWNER_CANNOT_LEAVE' using errcode = '42501';
  end if;

  delete from public.net_altara_conversation_members as member_row
  where member_row.conversation_id = requested_conversation_id
    and member_row.identity_link_id = v_actor_identity_link_id;

  update public.net_altara_conversations
  set updated_at = timezone('utc', clock_timestamp())
  where id = requested_conversation_id;

  -- Remaining members are queried after the delete, so the leaving identity
  -- is naturally excluded; append it explicitly so its own sidebar also
  -- reconciles and drops the conversation. Matches the exact pattern
  -- already used by remove_net_altara_group_member.
  perform public.net_altara_bump_messenger_revisions(
    array(
      select member_row.identity_link_id
      from public.net_altara_conversation_members as member_row
      where member_row.conversation_id = requested_conversation_id
    ) || array[v_actor_identity_link_id]
  );

  return jsonb_build_object(
    'conversation_id', requested_conversation_id,
    'left', true
  );
end;
$$;

comment on function public.leave_net_altara_group(uuid, uuid) is
  'Non-owner group member removes only their own membership row. Owner, DM, non-member, and non-existent conversation all resolve to the same outcome shape (owner gets a distinct error); history and remaining members are untouched.';

-- Only the current owner may delete a group. "Not found", "not a group",
-- and "not owner" are folded into the same uniform error, matching
-- remove_net_altara_group_member's established owner-check shape and
-- avoiding an existence oracle for conversation ids the caller has no
-- standing on.
--
-- A genuine response-loss retry of the caller's own prior successful delete
-- is still safely distinguishable, without creating that oracle: this
-- function's own success path writes an immutable net_action_audit row
-- (mirroring the shape audit_net_altara_messenger_runtime_insert already
-- writes for conversation/message inserts), and a "not found" retry checks
-- for exactly that actor+resource+action combination.
--
-- auth.uid() and net_runtime_action_context()'s action_mode/persona_subject
-- fields alone are not exact-identity-bound for every context: GM
-- TAKE CONTROL/ACT AS returns a distinct persona_subject_id per controlled
-- subject (Adrian vs Ayin compare unequal, correctly), but for an ordinary
-- player identity ("owner" mode) that function always returns
-- persona_subject_kind/persona_subject_id = null, regardless of exactly
-- which of that account's own identity_links resolved -- e.g. a player who
-- also owns an NPC (public.own-extra-player-sheets.sql establishes this is
-- a real, schema-supported shape) and switches net_active_identities
-- between the two would otherwise compare as the same "owner, no persona"
-- retry proof.
--
-- net_action_audit has no field whose established semantics can safely
-- carry an exact identity_link_id: persona_subject_kind/persona_subject_id
-- are contractually null for non-GM-persona actors across every existing
-- writer in this schema (net_runtime_action_context, PULSE's take-control
-- binding, the financial-audit normalizer) -- writing a real value there
-- for the player case would silently redefine that contract for every
-- other consumer of this shared table. presented_account_id is foreign-key
-- bound to net_app_accounts, a disjoint concept (installed OS-app
-- accounts); Messenger identities are not app accounts and no
-- identity_link_id would satisfy that constraint.
--
-- authorization_basis is the one field this schema already treats as
-- extensible free text for exactly this kind of caller-supplied context: it
-- already carries appended, colon- and hyphen-delimited markers elsewhere
-- (net-effective-runtime-identity.sql's normalize_net_runtime_pulse_audit
-- appends '-within-delete-window'; every net_altara_*-authored audit row
-- already appends ':altara-messenger' or ':<app-id>'), it is matched with
-- both '=' and 'like'/'in' by existing BEFORE INSERT normalizers scoped to
-- other action_types (net_action_audit_normalize_runtime_pulse,
-- net_action_audit_normalize_runtime_finance,
-- net_action_audit_bind_pulse_take_control -- all three guard on
-- action_type values this function never uses, so none of them touch or
-- rewrite this row), and it has no length or format constraint beyond
-- non-empty text. This function appends the exact deleting
-- identity_link_id as its own explicit, colon-delimited, server-generated
-- segment -- never derived from client input -- and the retry branch
-- recomputes the identical expected string from the CURRENTLY resolved
-- identity_link_id, comparing by exact equality (not a pattern match).
create or replace function public.delete_net_altara_group(
  requested_expected_identity_link_id uuid,
  requested_conversation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_identity_link_id uuid;
  v_affected_identity_link_ids uuid[];
  v_already_deleted_by_caller boolean;
  v_context_action_mode text;
  v_context_persona_subject_kind text;
  v_context_persona_subject_id uuid;
  v_expected_authorization_basis text;
begin
  v_actor_identity_link_id := public.net_altara_assert_messenger_context(
    requested_expected_identity_link_id
  );

  perform 1
  from public.net_altara_conversations as conversation
  join public.net_altara_conversation_members as owner_membership
    on owner_membership.conversation_id = conversation.id
    and owner_membership.identity_link_id = v_actor_identity_link_id
    and owner_membership.member_role = 'owner'
  where conversation.id = requested_conversation_id
    and conversation.conversation_kind = 'group'
  for update of conversation;

  if not found then
    select context.action_mode, context.persona_subject_kind,
      context.persona_subject_id,
      context.authorization_basis || ':altara-messenger:delete:identity-link:'
        || v_actor_identity_link_id::text
    into v_context_action_mode, v_context_persona_subject_kind,
      v_context_persona_subject_id, v_expected_authorization_basis
    from public.net_runtime_action_context(v_actor_identity_link_id) as context;

    select exists (
      select 1
      from public.net_action_audit as audit_row
      where audit_row.authenticated_actor_profile_id = auth.uid()
        and audit_row.resource_type = 'altara-conversation'
        and audit_row.resource_id = requested_conversation_id
        and audit_row.action_type = 'altara-messenger.conversation.delete'
        and audit_row.action_mode = v_context_action_mode
        and audit_row.persona_subject_kind
          is not distinct from v_context_persona_subject_kind
        and audit_row.persona_subject_id
          is not distinct from v_context_persona_subject_id
        and audit_row.authorization_basis = v_expected_authorization_basis
    )
    into v_already_deleted_by_caller;

    if v_already_deleted_by_caller then
      return jsonb_build_object(
        'conversation_id', requested_conversation_id,
        'deleted', false
      );
    end if;

    raise exception 'ALTARA_MESSENGER_GROUP_OWNER_REQUIRED' using errcode = '42501';
  end if;

  -- Membership rows are about to be cascade-deleted with the conversation;
  -- capture every currently affected identity (including the owner/caller,
  -- who also needs their own sidebar to reconcile) before that happens.
  select coalesce(array_agg(member_row.identity_link_id), '{}'::uuid[])
  into v_affected_identity_link_ids
  from public.net_altara_conversation_members as member_row
  where member_row.conversation_id = requested_conversation_id;

  -- Cascades to net_altara_conversation_members and net_altara_messages for
  -- this conversation only (the only two foreign keys referencing this
  -- table, both ON DELETE CASCADE; proven in the preflight block above).
  -- net_action_audit rows referencing this conversation are not touched --
  -- resource_id carries no foreign key, by the deployed contract for that
  -- table's immutable history.
  delete from public.net_altara_conversations
  where id = requested_conversation_id;

  perform public.net_altara_bump_messenger_revisions(v_affected_identity_link_ids);

  insert into public.net_action_audit (
    authenticated_actor_profile_id,
    presented_account_id,
    persona_subject_kind,
    persona_subject_id,
    action_mode,
    action_type,
    authorization_basis,
    resource_type,
    resource_id
  )
  select
    auth.uid(),
    null,
    context.persona_subject_kind,
    context.persona_subject_id,
    context.action_mode,
    'altara-messenger.conversation.delete',
    context.authorization_basis || ':altara-messenger:delete:identity-link:'
      || v_actor_identity_link_id::text,
    'altara-conversation',
    requested_conversation_id
  from public.net_runtime_action_context(v_actor_identity_link_id) as context;

  return jsonb_build_object(
    'conversation_id', requested_conversation_id,
    'deleted', true
  );
end;
$$;

comment on function public.delete_net_altara_group(uuid, uuid) is
  'Group owner permanently deletes the conversation. Cascades to its own membership and message rows only (proven FK audit); net_action_audit rows survive as immutable history. A response-loss retry is safely idempotent only for the exact same identity_link_id that performed the original delete: the audit row''s authorization_basis carries a server-generated ":identity-link:<uuid>" suffix compared by exact equality against the currently resolved identity, layered with action_mode/persona_subject_kind/persona_subject_id from net_runtime_action_context as additional defense -- a different identity_link_id under the same auth.uid() (normal player switching owned identities, or GM TAKE CONTROL/ACT AS switching controlled subjects), a different account, or a random id all fail closed with the same uniform error.';

revoke all on function public.leave_net_altara_group(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.delete_net_altara_group(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.leave_net_altara_group(uuid, uuid)
  to authenticated;
grant execute on function public.delete_net_altara_group(uuid, uuid)
  to authenticated;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_proc as procedure_record
    where procedure_record.oid in (
      'public.leave_net_altara_group(uuid,uuid)'::regprocedure::oid,
      'public.delete_net_altara_group(uuid,uuid)'::regprocedure::oid
    )
      and (
        not procedure_record.prosecdef
        or not (
          'search_path=public, pg_temp'
          = any(coalesce(procedure_record.proconfig, array[]::text[]))
        )
      )
  ) then
    raise exception 'NET_ALTARA_MESSENGER_GROUP_LIFECYCLE_DEFINER_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;
end;
$$;

commit;
