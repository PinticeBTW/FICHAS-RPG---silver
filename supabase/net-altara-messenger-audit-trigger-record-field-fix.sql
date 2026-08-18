-- Regression fix: audit_net_altara_messenger_runtime_insert() -- deployed by
-- net-nonfinancial-runtime-control-parity.sql -- is one trigger function
-- shared across two tables with different identity columns
-- (net_altara_messages.author_identity_link_id,
-- net_altara_conversations.created_by_identity_link_id). Its body picked
-- between them with a single SQL CASE expression assigned in one PL/pgSQL
-- statement:
--
--   v_identity_link_id := case tg_table_name
--     when 'net_altara_messages' then new.author_identity_link_id
--     else new.created_by_identity_link_id
--   end;
--
-- NEW is a generic `record` in a trigger shared across tables (its exact
-- composite type is only known per invocation). PostgreSQL resolves every
-- branch's column reference against NEW's actual runtime type while parsing
-- the CASE expression as a single query, before any branch is chosen --
-- CASE's runtime short-circuiting only skips evaluating the untaken branch's
-- *value*, not this parse-time column lookup. So `new.author_identity_link_id`
-- fails to resolve on every net_altara_conversations row (which has no such
-- column), even though that branch never matches for that table, raising
-- exactly: record "new" has no field "author_identity_link_id". This fires
-- on every group AND direct-conversation creation (any insert into
-- net_altara_conversations), immediately inside create_net_altara_group()'s
-- own insert statement.
--
-- Fix: replace the single CASE expression with separate PL/pgSQL IF/ELSE
-- branches. Each branch is its own independently prepared statement; only
-- the entered branch is ever parsed against NEW, so the untaken branch's
-- column reference is never resolved. The two remaining CASE expressions in
-- this function (action_type, resource_type) only return string literals in
-- every branch -- no column access -- and are unaffected; left unchanged.
-- new.id is unconditional in both branches already, since both tables carry
-- an `id` column -- left unchanged.
--
-- Forward-only: run after net-nonfinancial-runtime-control-parity.sql.

begin;

do $$
declare
  v_source text;
begin
  if to_regclass('public.net_altara_conversations') is null
    or to_regclass('public.net_altara_messages') is null
    or to_regclass('public.net_action_audit') is null
    or to_regprocedure('public.audit_net_altara_messenger_runtime_insert()') is null
    or to_regprocedure('public.current_net_effective_runtime_identity_link_id()') is null
    or to_regprocedure('public.net_runtime_action_context(uuid)') is null
  then
    raise exception 'NET_ALTARA_MESSENGER_AUDIT_TRIGGER_DEPENDENCY_REQUIRED'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger as trigger_record
    where trigger_record.tgrelid = 'public.net_altara_messages'::regclass
      and trigger_record.tgfoid =
        'public.audit_net_altara_messenger_runtime_insert()'::regprocedure::oid
      and not trigger_record.tgisinternal
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger as trigger_record
    where trigger_record.tgrelid = 'public.net_altara_conversations'::regclass
      and trigger_record.tgfoid =
        'public.audit_net_altara_messenger_runtime_insert()'::regprocedure::oid
      and not trigger_record.tgisinternal
  ) then
    raise exception 'NET_ALTARA_MESSENGER_AUDIT_TRIGGER_ATTACHMENT_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  select procedure_record.prosrc into v_source
  from pg_catalog.pg_proc as procedure_record
  where procedure_record.oid =
    'public.audit_net_altara_messenger_runtime_insert()'::regprocedure::oid;

  if pg_catalog.strpos(v_source, 'new.author_identity_link_id') = 0
    or pg_catalog.strpos(v_source, 'new.created_by_identity_link_id') = 0
    or pg_catalog.strpos(v_source, 'case tg_table_name') = 0
  then
    raise exception 'NET_ALTARA_MESSENGER_AUDIT_TRIGGER_SOURCE_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;
end;
$$;

create or replace function public.audit_net_altara_messenger_runtime_insert()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_context record;
begin
  if auth.uid() is null then return null; end if;

  -- Separate IF/ELSE branches, not a single CASE expression: only the
  -- entered branch's column reference is ever prepared/resolved against
  -- NEW's actual row type for this invocation.
  if tg_table_name = 'net_altara_messages' then
    v_identity_link_id := new.author_identity_link_id;
  else
    v_identity_link_id := new.created_by_identity_link_id;
  end if;

  if v_identity_link_id is distinct from
    public.current_net_effective_runtime_identity_link_id()
  then
    raise exception 'ALTARA_MESSENGER_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;
  select context.* into v_context
  from public.net_runtime_action_context(v_identity_link_id) as context;

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
  ) values (
    auth.uid(),
    null,
    v_context.persona_subject_kind,
    v_context.persona_subject_id,
    v_context.action_mode,
    case tg_table_name
      when 'net_altara_messages' then 'altara-messenger.message.send'
      else 'altara-messenger.conversation.create'
    end,
    v_context.authorization_basis || ':altara-messenger',
    case tg_table_name
      when 'net_altara_messages' then 'altara-message'
      else 'altara-conversation'
    end,
    new.id
  );
  return null;
end;
$$;

comment on function public.audit_net_altara_messenger_runtime_insert() is
  'Shared AFTER INSERT audit trigger for net_altara_messages and net_altara_conversations. Branches on TG_TABLE_NAME with separate IF/ELSE statements so only the entered branch''s identity column (author_identity_link_id vs created_by_identity_link_id) is ever resolved against NEW -- a single CASE expression previously failed parse-time column resolution for the untaken branch on every insert.';

do $$
declare
  v_source text;
begin
  select procedure_record.prosrc into v_source
  from pg_catalog.pg_proc as procedure_record
  where procedure_record.oid =
    'public.audit_net_altara_messenger_runtime_insert()'::regprocedure::oid;

  if pg_catalog.strpos(v_source, 'if tg_table_name = ''net_altara_messages'' then') = 0
    or pg_catalog.strpos(v_source, 'case tg_table_name') = 0
  then
    raise exception 'NET_ALTARA_MESSENGER_AUDIT_TRIGGER_PATCH_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;
end;
$$;

commit;
