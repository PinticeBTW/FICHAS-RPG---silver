-- Fixes three simultaneously-broken ALTARA apps for a normal, SOURCE-mounted
-- player with an active hacking session (even before ENTER SYSTEM):
--   Messenger: "COMMUNICATIONS UNAVAILABLE / ALTARA_MESSENGER_ACCESS_DENIED"
--   ALTARA BANK: "The controlled ALTARA identity changed. Reopen the bank
--     and try again." (ALTARA_BANK_IDENTITY_CONTEXT_CHANGED)
--   ALTARA MUSIC: "The current ALTARA MUSIC transmission could not be
--     opened: Object not found"
--
-- SHARED ROOT CLASS (not one shared function -- four separate call sites
-- that each independently developed the same defect): every one of them
-- resolves "who is acting" through current_net_effective_runtime_identity_
-- link_id() -- the single, no-disambiguation-input resolver that
-- UNCONDITIONALLY projects onto the hacking TARGET the instant a session
-- exists for the caller, regardless of whether ENTER SYSTEM has been
-- clicked -- and then either compares that value against the frontend's
-- already-correct, entered-gated expected identity (Messenger, ALTARA
-- BANK), or uses it directly with no comparison at all (ALTARA MUSIC's
-- Storage read policy). None of the four ever falls back to
-- current_net_runtime_source_identity_link_id() -- the exact, hacking-
-- unaware canonical SOURCE resolver -- so a SOURCE-mounted player whose own
-- hacking session merely exists (not yet entered) is silently evaluated as
-- if they were the TARGET. AltaraOsGateway.tsx's own identity computation
-- was already correct throughout (hacking.mounted, its expectedIdentityLinkId
-- prop, requires BOTH session.active AND the client "entered" toggle) --
-- confirmed by direct inspection, unchanged here. The bug is entirely
-- server-side, in how each RPC/policy independently re-derives identity
-- after receiving that already-correct value.
--
-- MESSENGER: fetch_net_altara_messenger_sidebar (net-altara-messenger.sql)
-- never adopted the shared net_altara_assert_messenger_context() choke
-- point that every OTHER Messenger RPC in the same file already correctly
-- uses (confirmed by direct inspection: search/ensure/create/rename/add/
-- remove/leave/delete/fetch-page/send/mark-read all already call it). It
-- instead kept its own original inline copy: v_identity_link_id :=
-- net_altara_effective_messenger_identity() (itself built on the same
-- ambiguous resolver), then a raw `is distinct from` comparison against
-- requested_expected_identity_link_id. current_user_can_read_net_altara_
-- messenger_revision (net-nonfinancial-runtime-control-parity.sql, gates
-- the Messenger Realtime revision-read policy) has the identical
-- independent-inline-comparison defect.
--
-- ALTARA BANK: net_economy_assert_altara_bank_player_context
-- (net-financial-runtime-control-parity.sql) is the single choke point
-- fetch/open/search/quote/transfer_net_economy_altara_bank all already
-- correctly delegate to (confirmed: 11 call sites, all passing their
-- already-validated v_identity_link_id straight through afterward -- no
-- separate "validate then re-derive" gap downstream of this one function).
-- Its own body is the bug: v_identity_link_id := current_net_effective_
-- runtime_identity_link_id(), then compared against requested_expected_
-- identity_link_id.
--
-- ALTARA MUSIC: "Object not found" is CONFIRMED CATEGORY A, the same
-- identity-context bug, not stale media (verified by tracing the exact call
-- chain: signNetAltaraMusicTrack signs track.audioObjectPath, the literal,
-- unambiguous audio_object_path column off the already-fetched catalogue
-- row -- there is no per-identity path selection involved on the client or
-- in the RPC layer). The failure is in Storage RLS itself:
-- current_user_can_read_net_altara_music_audio_object (net-altara-music.sql)
-- gates the rpg-audio bucket's SELECT policy (which createSignedUrl relies
-- on) using current_net_effective_runtime_identity_link_id() three times,
-- with no SOURCE fallback. Supabase Storage returns a generic
-- "Bucket not found"/"Object not found"-style message for an RLS-denied
-- read rather than an access-denied message (to avoid leaking object
-- existence), which is exactly what surfaced as "Object not found" here.
-- The referenced track objects are not missing; the SOURCE-mounted
-- listener's own read was being denied by policy. Confirmed via
-- comparison: no other MUSIC RPC (catalogue/history, already loading
-- correctly per the report) touches this predicate; it exists only on the
-- storage.objects policy.
--
-- FIX (same shape as the already-applied wallpaper fix in
-- net-wallpaper-upload-rls-fix.sql, reviewed and approved there): every one
-- of the four now accepts EITHER current_net_runtime_source_identity_link_
-- id() (exact canonical SOURCE) OR current_net_effective_runtime_identity_
-- link_id() (exact hacking/TAKE CONTROL projected TARGET) -- never a raw
-- ownership fallback, never `using (true)`, never anything broader. Every
-- other existing check (Messenger's GM-no-persona "identity-required" JSON
-- branch and net_altara_identity_can_use_messenger eligibility re-check;
-- ALTARA BANK's financial-candidate check, service-access assertion, and
-- app-install requirement; ALTARA MUSIC's admin bypass, object-name
-- validation, and published-track existence check) is preserved exactly,
-- in its original order, with its original error code. No RPC signature,
-- no Storage policy DDL, and no bucket visibility changes -- only the
-- identity resolution inside four existing function bodies.
--
-- Left deliberately untouched: current_net_pulse_owner_account_id() and the
-- current_user_has_net_runtime_service_for_link()-based VOX AUDIO read
-- policy (net-vox-audio.sql) carry the same latent single-resolver pattern
-- but are outside VEIL/PULSE, which this task is explicitly scoped away
-- from -- not fixed here, flagged for a future, separately-scoped pass.

begin;

do $preflight$
begin
  if to_regprocedure('public.current_net_runtime_source_identity_link_id()') is null
    or to_regprocedure('public.current_net_effective_runtime_identity_link_id()') is null
    or to_regprocedure('public.net_altara_effective_messenger_identity()') is null
    or to_regprocedure('public.net_altara_identity_can_use_messenger(uuid)') is null
    or to_regprocedure('public.net_altara_identity_presentation(uuid)') is null
    or to_regprocedure('public.net_altara_conversation_members_json(uuid)') is null
    or to_regprocedure('public.is_current_user_gm()') is null
    or to_regprocedure('public.fetch_net_altara_messenger_sidebar(uuid,integer)') is null
    or to_regprocedure('public.current_user_can_read_net_altara_messenger_revision(uuid)') is null
    or to_regclass('public.net_altara_conversation_members') is null
    or to_regclass('public.net_altara_conversations') is null
    or to_regclass('public.net_altara_messages') is null
    or to_regprocedure('public.net_economy_assert_altara_bank_player_context(uuid)') is null
    or to_regprocedure('public.net_economy_identity_is_runtime_financial_candidate(uuid)') is null
    or to_regprocedure('public.assert_net_identity_service_access(uuid,text)') is null
    or to_regclass('public.net_identity_app_installs') is null
    or to_regprocedure('public.current_user_can_read_net_altara_music_audio_object(text)') is null
    or to_regprocedure('public.net_altara_music_audio_object_name_is_valid(text,uuid)') is null
    or to_regprocedure('public.current_user_is_net_system_admin()') is null
    or to_regprocedure('public.net_identity_link_can_access_service(uuid,text)') is null
    or to_regclass('public.net_altara_music_tracks') is null
    or to_regclass('public.net_altara_music_artists') is null
    or to_regclass('public.net_altara_music_releases') is null
  then
    raise exception 'NET_ALTARA_MESSENGER_BANK_MUSIC_RUNTIME_IDENTITY_FIX_DEPENDENCY_REQUIRED. This migration requires net-altara-messenger.sql, net-nonfinancial-runtime-control-parity.sql, net-financial-runtime-control-parity.sql, net-altara-music.sql, and net-system-hacking-runtime-projection.sql to be deployed first.'
      using errcode = '55000';
  end if;
end;
$preflight$;

-- ==================================================================
-- MESSENGER
-- ==================================================================

create or replace function public.fetch_net_altara_messenger_sidebar(
  requested_expected_identity_link_id uuid,
  requested_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_limit integer := greatest(1, least(coalesce(requested_limit, 50), 50));
  v_conversations jsonb;
begin
  if auth.uid() is null then
    raise exception 'ALTARA_MESSENGER_AUTH_REQUIRED' using errcode = '42501';
  end if;

  if requested_expected_identity_link_id is not null
    and (
      requested_expected_identity_link_id = public.current_net_runtime_source_identity_link_id()
      or requested_expected_identity_link_id = public.current_net_effective_runtime_identity_link_id()
    )
    and public.net_altara_identity_can_use_messenger(requested_expected_identity_link_id)
  then
    v_identity_link_id := requested_expected_identity_link_id;
  end if;

  if v_identity_link_id is null then
    if public.is_current_user_gm() then
      return jsonb_build_object(
        'status', 'identity-required',
        'reason', 'TAKE CONTROL of an ALTARA identity to access personal communications.',
        'identity', null,
        'conversations', '[]'::jsonb
      );
    end if;
    if requested_expected_identity_link_id is null then
      raise exception 'ALTARA_MESSENGER_ACCESS_DENIED' using errcode = '42501';
    end if;
    raise exception 'ALTARA_MESSENGER_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;

  with conversation_page as (
    select
      conversation.id,
      conversation.conversation_kind,
      conversation.title,
      conversation.direct_identity_a,
      conversation.direct_identity_b,
      conversation.created_at,
      conversation.updated_at,
      membership.member_role,
      membership.last_read_at,
      membership.last_read_message_id
    from public.net_altara_conversation_members as membership
    join public.net_altara_conversations as conversation
      on conversation.id = membership.conversation_id
    where membership.identity_link_id = v_identity_link_id
    order by conversation.updated_at desc, conversation.id desc
    limit v_limit
  ), hydrated as (
    select
      conversation_page.*,
      case
        when conversation_page.conversation_kind = 'direct'
          and conversation_page.direct_identity_a = v_identity_link_id
          then conversation_page.direct_identity_b
        when conversation_page.conversation_kind = 'direct'
          then conversation_page.direct_identity_a
        else null
      end as direct_recipient_id,
      latest.id as latest_message_id,
      latest.body as latest_message_body,
      latest.created_at as latest_message_at,
      latest.author_identity_link_id as latest_author_id,
      coalesce(unread.value, 0) as unread_count,
      public.net_altara_conversation_members_json(
        conversation_page.id
      ) as members,
      not exists (
        select 1
        from public.net_altara_conversation_members as current_member
        where current_member.conversation_id = conversation_page.id
          and not public.net_altara_identity_can_use_messenger(
            current_member.identity_link_id
          )
      ) as can_send
    from conversation_page
    left join lateral (
      select message.*
      from public.net_altara_messages as message
      where message.conversation_id = conversation_page.id
      order by message.created_at desc, message.id desc
      limit 1
    ) as latest on true
    left join lateral (
      select count(*)::integer as value
      from (
        select 1
        from public.net_altara_messages as unread_message
        where unread_message.conversation_id = conversation_page.id
          and (
            unread_message.created_at > conversation_page.last_read_at
            or (
              unread_message.created_at = conversation_page.last_read_at
              and (
                conversation_page.last_read_message_id is null
                or unread_message.id > conversation_page.last_read_message_id
              )
            )
          )
          and unread_message.author_identity_link_id is distinct from v_identity_link_id
        order by unread_message.created_at, unread_message.id
        limit 100
      ) as bounded_unread
    ) as unread on true
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'conversation_id', hydrated.id,
        'kind', hydrated.conversation_kind,
        'title', case
          when hydrated.conversation_kind = 'group' then hydrated.title
          else direct_presentation.value ->> 'display_name'
        end,
        'avatar_url', case
          when hydrated.conversation_kind = 'direct'
            then direct_presentation.value ->> 'avatar_url'
          else null
        end,
        'direct_recipient', case
          when hydrated.conversation_kind = 'direct' then direct_presentation.value
          else null
        end,
        'role', hydrated.member_role,
        'members', hydrated.members,
        'member_count', jsonb_array_length(hydrated.members),
        'can_send', hydrated.can_send,
        'latest_message', case
          when hydrated.latest_message_id is null then null
          else jsonb_build_object(
            'message_id', hydrated.latest_message_id,
            'body', left(hydrated.latest_message_body, 180),
            'created_at', hydrated.latest_message_at,
            'author', public.net_altara_identity_presentation(
              hydrated.latest_author_id
            ),
            'mine', hydrated.latest_author_id = v_identity_link_id
          )
        end,
        'unread_count', least(hydrated.unread_count, 99),
        'unread_capped', hydrated.unread_count >= 100,
        'created_at', hydrated.created_at,
        'updated_at', hydrated.updated_at
      )
      order by hydrated.updated_at desc, hydrated.id desc
    ),
    '[]'::jsonb
  )
  into v_conversations
  from hydrated
  left join lateral (
    select public.net_altara_identity_presentation(
      hydrated.direct_recipient_id
    ) as value
  ) as direct_presentation
    on hydrated.direct_recipient_id is not null;

  return jsonb_build_object(
    'status', 'ready',
    'identity', public.net_altara_identity_presentation(v_identity_link_id),
    'conversations', v_conversations
  );
end;
$$;

create or replace function public.current_user_can_read_net_altara_messenger_revision(
  requested_identity_link_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select requested_identity_link_id is not null
    and (
      requested_identity_link_id = public.current_net_runtime_source_identity_link_id()
      or requested_identity_link_id = public.current_net_effective_runtime_identity_link_id()
    );
$$;

revoke all on function public.fetch_net_altara_messenger_sidebar(uuid, integer)
  from public, anon;
revoke all on function public.current_user_can_read_net_altara_messenger_revision(uuid)
  from public, anon;
grant execute on function public.fetch_net_altara_messenger_sidebar(uuid, integer)
  to authenticated;
grant execute on function public.current_user_can_read_net_altara_messenger_revision(uuid)
  to authenticated;

-- ==================================================================
-- ALTARA BANK
-- ==================================================================

create or replace function public.net_economy_assert_altara_bank_player_context(
  requested_expected_identity_link_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
begin
  if auth.uid() is null then
    raise exception 'ALTARA_BANK_AUTH_REQUIRED' using errcode = '42501';
  end if;

  if requested_expected_identity_link_id is null
    or not (
      requested_expected_identity_link_id = public.current_net_runtime_source_identity_link_id()
      or requested_expected_identity_link_id = public.current_net_effective_runtime_identity_link_id()
    )
  then
    raise exception 'ALTARA_BANK_IDENTITY_CONTEXT_CHANGED' using errcode = '42501';
  end if;

  v_identity_link_id := requested_expected_identity_link_id;

  if not public.net_economy_identity_is_runtime_financial_candidate(v_identity_link_id) then
    raise exception 'ALTARA_BANK_PERSONAL_IDENTITY_REQUIRED' using errcode = '42501';
  end if;

  perform public.assert_net_identity_service_access(v_identity_link_id, 'altara-bank');
  if not exists (
    select 1 from public.net_identity_app_installs as install
    where install.identity_link_id = v_identity_link_id
      and install.app_id = 'altara-bank'
  ) then
    raise exception 'ALTARA_BANK_APP_NOT_INSTALLED' using errcode = '42501';
  end if;

  return v_identity_link_id;
end;
$$;

revoke all on function public.net_economy_assert_altara_bank_player_context(uuid)
  from public, anon, authenticated;

-- ==================================================================
-- ALTARA MUSIC
-- ==================================================================

create or replace function public.current_user_can_read_net_altara_music_audio_object(
  requested_object_name text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_source_identity_link_id uuid;
  v_effective_identity_link_id uuid;
begin
  if not public.net_altara_music_audio_object_name_is_valid(requested_object_name, null) then
    return false;
  end if;

  if public.current_user_is_net_system_admin() then
    return true;
  end if;

  if not exists (
    select 1 from public.net_altara_music_tracks as track
    join public.net_altara_music_artists as artist
      on artist.id = track.primary_artist_id and artist.status = 'published'
    left join public.net_altara_music_releases as release_record on release_record.id = track.release_id
    where track.audio_object_path = requested_object_name and track.status = 'published'
      and (track.release_id is null or release_record.status = 'published')
  ) then
    return false;
  end if;

  v_source_identity_link_id := public.current_net_runtime_source_identity_link_id();
  v_effective_identity_link_id := public.current_net_effective_runtime_identity_link_id();

  return (
    v_source_identity_link_id is not null
    and public.net_identity_link_can_access_service(v_source_identity_link_id, 'altara-music')
    and exists (
      select 1 from public.net_identity_app_installs as install
      where install.identity_link_id = v_source_identity_link_id
        and install.app_id = 'altara-music'
    )
  ) or (
    v_effective_identity_link_id is not null
    and public.net_identity_link_can_access_service(v_effective_identity_link_id, 'altara-music')
    and exists (
      select 1 from public.net_identity_app_installs as install
      where install.identity_link_id = v_effective_identity_link_id
        and install.app_id = 'altara-music'
    )
  );
end;
$$;

revoke all on function public.current_user_can_read_net_altara_music_audio_object(text)
  from public, anon, authenticated;
grant execute on function public.current_user_can_read_net_altara_music_audio_object(text)
  to authenticated;

commit;
