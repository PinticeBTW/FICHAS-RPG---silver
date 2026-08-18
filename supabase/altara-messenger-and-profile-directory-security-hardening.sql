-- Security hardening: ALTARA Messenger identity-eligibility re-verification,
-- and bounded GM-only profile directories replacing two raw `profiles`
-- reads. Forward-only: run after net-nonfinancial-runtime-control-parity.sql.
-- Does not delete history, does not change conversation/message data, does
-- not add a Realtime channel, and does not touch existing RLS on
-- public.profiles.

begin;

do $$
begin
  if to_regclass('public.profiles') is null
    or to_regclass('public.net_altara_conversations') is null
    or to_regclass('public.net_altara_conversation_members') is null
    or to_regclass('public.net_altara_messages') is null
    or to_regprocedure('public.is_current_user_gm()') is null
    or to_regprocedure('public.net_altara_identity_can_use_messenger(uuid)') is null
    or to_regprocedure('public.net_altara_assert_messenger_context(uuid)') is null
    or to_regprocedure('public.assert_net_effective_runtime_identity(uuid,text,boolean)') is null
    or to_regprocedure('public.fetch_net_altara_message_page(uuid,uuid,timestamptz,uuid,integer)') is null
    or to_regprocedure('public.fetch_net_altara_messenger_sidebar(uuid,integer)') is null
  then
    raise exception 'NET_ALTARA_MESSENGER_SECURITY_HARDENING_DEPENDENCY_REQUIRED'
      using errcode = '55000';
  end if;
end;
$$;

-- FINDING 1 (server authority): the effective-runtime-identity refactor
-- replaced this function's body with a delegation to
-- assert_net_effective_runtime_identity(), which proves the resolved
-- identity matches the caller's session and the 'altara-messenger' OS
-- service scope -- but it does not re-check the exact player/playable or
-- npc/non-playable eligibility shape, nor current per-identity service
-- access, the way the original net_altara_identity_can_use_messenger() gate
-- did. Every Messenger RPC (fetch_net_altara_message_page,
-- fetch_net_altara_messenger_sidebar, send_net_altara_message,
-- create/rename/add/remove group, mark read, search recipients, ensure
-- direct conversation) resolves its actor identity through this one choke
-- point, so restoring the eligibility re-check here restores it everywhere
-- without touching any of those functions' own membership/ownership joins,
-- which already correctly require a live net_altara_conversation_members
-- row for the exact caller on every fetch.
create or replace function public.net_altara_assert_messenger_context(
  requested_expected_identity_link_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
begin
  v_identity_link_id := public.assert_net_effective_runtime_identity(
    requested_expected_identity_link_id,
    'altara-messenger',
    false
  );

  if not public.net_altara_identity_can_use_messenger(v_identity_link_id) then
    raise exception 'ALTARA_MESSENGER_IDENTITY_REQUIRED' using errcode = '42501';
  end if;

  return v_identity_link_id;
end;
$$;

comment on function public.net_altara_assert_messenger_context(uuid) is
  'Resolves and re-validates the exact effective Messenger identity: current runtime identity/session context, altara-messenger OS service scope, and player/playable or npc/non-playable eligibility with current service access. Every Messenger read and mutation RPC depends on this single choke point.';

-- FINDING 2 (bounded profile directories): public.profiles keeps its
-- existing RLS (own row, GM, or explicit sheet share) and its existing
-- grant to authenticated -- neither is changed by this migration. The two
-- call sites below (PDF Archive owner picker, Sheet Workspace profile/NPC
-- directory) already only ever render for a GM in the current frontend, but
-- until now they read the raw table directly with no server-side bound
-- beyond RLS and no server-side actor assertion, so the limit and the GM
-- check both lived only in client code. These bounded RPCs make both an
-- explicit, server-enforced contract, matching the pattern already used
-- everywhere else in this codebase (search_net_altara_messenger_recipients,
-- fetch_net_economy_gm_finance_directory, etc.) instead of a raw table read.
-- Fields returned are exactly the fields each existing screen already
-- displays; no field is added or widened.
create or replace function public.fetch_net_gm_archive_profile_directory()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_current_user_gm() then
    raise exception 'GM_PROFILE_DIRECTORY_REQUIRED' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', bounded_profile.id,
      'email', bounded_profile.email,
      'display_name', bounded_profile.display_name,
      'handle', bounded_profile.handle,
      'role', bounded_profile.role
    ) order by bounded_profile.display_name, bounded_profile.id)
    from (
      select profile.id, profile.email, profile.display_name,
        profile.handle, profile.role
      from public.profiles as profile
      order by profile.display_name, profile.id
      limit 500
    ) as bounded_profile
  ), '[]'::jsonb);
end;
$$;

comment on function public.fetch_net_gm_archive_profile_directory() is
  'GM-only bounded directory (max 500) of account id/email/display_name/handle/role for the PDF Archive owner picker. Replaces a raw public.profiles table read.';

create or replace function public.fetch_net_gm_sheet_profile_directory()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_current_user_gm() then
    raise exception 'GM_PROFILE_DIRECTORY_REQUIRED' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', bounded_profile.id,
      'email', bounded_profile.email,
      'display_name', bounded_profile.display_name,
      'handle', bounded_profile.handle,
      'role', bounded_profile.role,
      'avatar_url', bounded_profile.avatar_url
    ) order by bounded_profile.display_name, bounded_profile.id)
    from (
      select profile.id, profile.email, profile.display_name, profile.handle,
        profile.role, profile.avatar_url
      from public.profiles as profile
      order by profile.display_name, profile.id
      limit 500
    ) as bounded_profile
  ), '[]'::jsonb);
end;
$$;

comment on function public.fetch_net_gm_sheet_profile_directory() is
  'GM-only bounded directory (max 500) of account id/email/display_name/handle/role/avatar_url for the Sheet Workspace profile+NPC directory. Replaces a raw public.profiles table read.';

revoke all on function public.fetch_net_gm_archive_profile_directory()
  from public, anon, authenticated;
revoke all on function public.fetch_net_gm_sheet_profile_directory()
  from public, anon, authenticated;
grant execute on function public.fetch_net_gm_archive_profile_directory()
  to authenticated;
grant execute on function public.fetch_net_gm_sheet_profile_directory()
  to authenticated;

do $$
declare
  v_definition text;
begin
  v_definition := pg_get_functiondef(
    'public.net_altara_assert_messenger_context(uuid)'::regprocedure
  );
  if position('net_altara_identity_can_use_messenger' in v_definition) = 0 then
    raise exception 'NET_ALTARA_MESSENGER_CONTEXT_ELIGIBILITY_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc as procedure_record
    where procedure_record.oid in (
      'public.fetch_net_gm_archive_profile_directory()'::regprocedure::oid,
      'public.fetch_net_gm_sheet_profile_directory()'::regprocedure::oid
    )
      and (
        not procedure_record.prosecdef
        or not (
          'search_path=public, pg_temp'
          = any(coalesce(procedure_record.proconfig, array[]::text[]))
        )
      )
  ) then
    raise exception 'NET_GM_PROFILE_DIRECTORY_DEFINER_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;
end;
$$;

commit;
