-- PULSE hacking-runtime identity parity (REVISED).
--
-- CONFIRMED BUG (read-only audit, prior session): PULSE forks its own
-- effective-identity resolution -- current_net_pulse_owner_account_id() and
-- assert_net_pulse_account_context() (both last redefined in
-- net-pulse-take-control-npc-parity-fix.sql, NOT edited here) -- instead of
-- the canonical current_net_effective_runtime_identity_link_id() /
-- assert_net_effective_runtime_identity() every other identity-scoped app
-- uses, and was never taught about net_system_hacking_sessions.
--
-- PROBLEM FOUND IN THE FIRST DRAFT OF THIS MIGRATION: that first draft made
-- current_net_pulse_owner_account_id() -- a zero-argument resolver with no
-- expected-value input -- unconditionally resolve the hacking TARGET the
-- instant a session exists. For the several actor-sensitive RPCs that
-- derive their acting account ONLY from that zero-arg call (follow, react,
-- boost, bookmark, notification reads/mutations), this meant: Adrian gets a
-- hacking session for Vanessa, has NOT clicked ENTER SYSTEM, is still
-- visibly using his own PULSE -- and the backend silently acts as Vanessa.
-- Unacceptable: session existence alone must not silently replace the
-- visible SOURCE context for anything that changes who performs an action
-- or whose private data is read.
--
-- FIX (this revision): current_net_pulse_owner_account_id() is UNCHANGED
-- from the first draft -- it still projects unconditionally once a session
-- exists -- but every actor-sensitive and privacy-sensitive RPC that used
-- to call it has been migrated OFF it entirely, onto the already-fixed,
-- disambiguating assert_net_pulse_account_context(expected_account_id, ...).
-- The frontend already sends the mounted PULSE account id to every one of
-- these RPCs (confirmed by direct inspection of
-- src/lib/netPulseEngagementService.ts and
-- src/components/net/useNetPulseNotifications.ts -- unchanged, no frontend
-- edit needed); the gap was purely that each RPC's own "bound" wrapper
-- validated that id via assert_net_pulse_account_context and then DISCARDED
-- the validated result, delegating to an internal "legacy" worker that
-- re-derived the acting account independently via the ambiguous zero-arg
-- call. That inconsistency -- validate one identity, act as a different one
-- -- was the real root cause, not the disambiguation logic itself (already
-- correct from the prior revision).
--
-- Functions replaced here (all keep their exact already-granted signatures;
-- only their bodies change to use their own already-validated account
-- instead of re-deriving it):
--   set_net_pulse_follow(uuid, boolean, uuid)
--   set_net_pulse_reaction(uuid, boolean, uuid)
--   set_net_pulse_boost(uuid, boolean, uuid)
--   set_net_pulse_bookmark(uuid, boolean, uuid)
--   mark_net_pulse_notification_read(uuid, uuid)
--   mark_all_net_pulse_notifications_read(uuid)
--   fetch_net_pulse_notification_page(uuid, timestamptz, uuid, integer)
--   fetch_net_pulse_notification_state(uuid)
-- Notification reads are included alongside the mutations (not just
-- "notification/account-state mutation" as literally listed) because they
-- expose PRIVATE per-account content (another account's notification feed),
-- not merely a cosmetic viewer-state flag -- and because the codebase's own
-- existing wrappers already call assert_net_pulse_account_context(...,
-- true) (require an exact account) for these two reads, the same strict
-- mode used for every other actor-sensitive RPC here, unlike the `false`
-- (looser) mode used for the public-content reads left untouched below.
--
-- assert_net_pulse_account_context(uuid, boolean) itself is UNCHANGED from
-- the prior revision of this same file: still resolves the caller's own
-- SOURCE account, and -- only when a hacking session exists for that exact
-- source -- additionally resolves the TARGET's account and substitutes it
-- ONLY when requested_expected_account_id exactly matches the target. A
-- pre-ENTER-SYSTEM request that still expects the SOURCE's own account
-- keeps resolving to the SOURCE; nothing here erases that.
--
-- Left UNCHANGED, deliberately, as genuinely safe to leave on the
-- unconditional zero-arg resolver: fetch_net_pulse_feed/page,
-- fetch_net_pulse_thread_page, fetch_net_pulse_account_summaries,
-- net_pulse_account_directory_rows, fetch_net_pulse_relationship_page/
-- accounts, fetch_net_pulse_discover_accounts. These only personalize
-- viewer_reacted/viewer_boosted/viewer_bookmarked/viewer_follows_author
-- flags over otherwise-PUBLIC post/account content -- their own existing
-- wrappers already call assert_net_pulse_account_context(..., false), the
-- LOOSER mode, confirming the original author already treated these as
-- lower-stakes than notifications. Getting these flags from the wrong side
-- of a not-yet-entered hack is a cosmetic staleness window, not an
-- authority or privacy violation, and migrating them too would mean
-- re-implementing ~7 more read RPCs' full query bodies -- far beyond the
-- minimum fix and explicitly out of scope ("do not redesign the entire
-- PULSE API").
--
-- Every RPC left untouched here that already used
-- assert_net_pulse_account_context(expectedAccountId, ...) directly for its
-- OWN account resolution (create_net_pulse_post, update_net_pulse_public_
-- profile, delete_net_pulse_post, fetch_net_pulse_profile) was already
-- correct and remains so -- confirmed by direct inspection, not touched.
--
-- SECOND PASS (this revision): the Category-A viewer-personalization reads
-- left on the unconditionally-projecting zero-arg resolver turned out to
-- have the EXACT SAME "validate then discard, delegate to an ambiguous
-- re-deriving legacy body" bug as Category B -- just with
-- assert_net_pulse_account_context(expected, FALSE) (viewer state is
-- optional, not required) instead of `true`. Direct inspection of every one
-- of their currently-deployed bound wrappers confirmed each already
-- receives requested_expected_account_id from the frontend and already
-- calls `perform assert_net_pulse_account_context(requested_expected_
-- account_id, false)` -- but discards the result and delegates to a legacy
-- function that re-derives viewer_account_id via
-- current_net_pulse_owner_account_id(). That is what produced the disclosed
-- caveat in the prior report ("pre-ENTER cosmetic engagement icons may
-- reflect the target's state"). Since the frontend already sends the
-- mounted account id to every one of these RPCs (confirmed unchanged in
-- src/lib/netPulseContentService.ts and src/lib/netPulseEngagementService.ts
-- -- no frontend edit needed here either), the fix is the same shape as
-- Category B: capture assert_net_pulse_account_context's result and use it
-- directly for viewer-relative state, instead of re-deriving.
--
-- Functions replaced in this second pass (signatures unchanged from what is
-- already granted to authenticated):
--   fetch_net_pulse_page(text, uuid, uuid, text, timestamptz, uuid, integer)
--   fetch_net_pulse_thread_page(uuid, uuid, timestamptz, uuid, integer)
--   fetch_net_pulse_account_summaries(uuid, text, uuid, integer)
--   fetch_net_pulse_discover_accounts(uuid, integer)
--   fetch_net_pulse_relationship_page(uuid, text, uuid, timestamptz, uuid, integer)
--   fetch_net_pulse_relationship_accounts(uuid, text, uuid, integer)
-- Each now inlines the body of the "legacy" internal worker it used to
-- delegate to (net_pulse_page_candidates, net_pulse_render_post_rows and
-- net_pulse_account_summary_rows already accepted an explicit viewer
-- account id and needed no changes -- only the layer above them, which
-- called current_net_pulse_owner_account_id() itself, was ambiguous).
-- fetch_net_pulse_relationship_accounts is the one exception: rather than
-- duplicate fetch_net_pulse_relationship_page's full query body, it now
-- simply forwards requested_expected_account_id straight into the
-- now-fixed fetch_net_pulse_relationship_page (a validated value, not a
-- re-derived one) and lets that function validate once -- the same
-- "reuse the validated result" rule, applied between two RPCs instead of
-- within one.
--
-- net_pulse_account_directory_rows(uuid[], boolean, integer) is
-- deliberately left UNCHANGED. It was previously reachable only through
-- fetch_net_pulse_discover_accounts's legacy 1-arg delegate; that delegate
-- is no longer called now that fetch_net_pulse_discover_accounts inlines
-- the (simpler, hard-coded discoverable-only) directory query directly.
-- No other current caller exists (confirmed by repo-wide search), so this
-- function becomes dead code: still present, still revoked from public,
-- anon and authenticated, but no longer reachable from any granted RPC
-- path. Left in place rather than deleted, per "do not change/delete
-- unless necessary".
--
-- fetch_net_pulse_feed(integer) is likewise deliberately left UNCHANGED. It
-- takes no account-disambiguation input at all and is not called anywhere
-- in the frontend (confirmed by repo-wide search of src/ -- the frontend
-- calls fetch_net_pulse_page directly, with requested_expected_account_id,
-- for every feed mode including 'city'). It still delegates to the
-- 6-argument legacy fetch_net_pulse_page, which still derives its viewer
-- via current_net_pulse_owner_account_id() and so still target-projects
-- once a hacking session exists -- but since no UI path renders through it,
-- this cannot produce a visible SOURCE/TARGET mismatch. Giving it its own
-- expected-account parameter would require inventing new frontend plumbing
-- for an endpoint nothing currently calls, which is out of scope for a
-- minimum fix. Disclosed as a residual, non-UI-reachable gap.
--
-- No SQL executed. No frontend files changed -- confirmed unnecessary by
-- direct inspection of the existing service/hook call sites.

begin;

do $preflight$
begin
  if to_regclass('public.profiles') is null
    or to_regclass('public.net_active_identities') is null
    or to_regclass('public.net_identity_links') is null
    or to_regclass('public.net_gm_persona_sessions') is null
    or to_regclass('public.net_identity_app_installs') is null
    or to_regclass('public.net_app_accounts') is null
    or to_regclass('public.net_system_hacking_sessions') is null
    or to_regclass('public.net_pulse_posts') is null
    or to_regclass('public.net_pulse_profiles') is null
    or to_regclass('public.net_pulse_follows') is null
    or to_regclass('public.net_pulse_reactions') is null
    or to_regclass('public.net_pulse_boosts') is null
    or to_regclass('public.net_pulse_bookmarks') is null
    or to_regclass('public.net_pulse_notifications') is null
    or to_regclass('public.net_action_audit') is null
    or to_regprocedure('public.current_user_controls_playable_net_identity_link(uuid)') is null
    or to_regprocedure('public.net_identity_link_can_access_service(uuid,text)') is null
    or to_regprocedure('public.assert_net_identity_service_access(uuid,text)') is null
    or to_regprocedure('public.current_net_pulse_owner_account_id()') is null
    or to_regprocedure('public.assert_net_pulse_account_context(uuid,boolean)') is null
    or to_regprocedure('public.net_pulse_post_is_visible(uuid)') is null
    or to_regprocedure('public.net_pulse_account_is_currently_visible(uuid)') is null
    or to_regprocedure('public.consume_net_pulse_rate_limit(text,integer)') is null
    or to_regprocedure('public.signal_net_pulse_notification_read_change()') is null
    or to_regprocedure('public.set_net_pulse_follow(uuid,boolean,uuid)') is null
    or to_regprocedure('public.set_net_pulse_reaction(uuid,boolean,uuid)') is null
    or to_regprocedure('public.set_net_pulse_boost(uuid,boolean,uuid)') is null
    or to_regprocedure('public.set_net_pulse_bookmark(uuid,boolean,uuid)') is null
    or to_regprocedure('public.mark_net_pulse_notification_read(uuid,uuid)') is null
    or to_regprocedure('public.mark_all_net_pulse_notifications_read(uuid)') is null
    or to_regprocedure('public.fetch_net_pulse_notification_page(uuid,timestamptz,uuid,integer)') is null
    or to_regprocedure('public.fetch_net_pulse_notification_state(uuid)') is null
    or to_regprocedure('public.net_pulse_page_candidates(text,uuid,text,timestamptz,uuid,integer,uuid)') is null
    or to_regprocedure('public.net_pulse_render_post_rows(uuid[],uuid)') is null
    or to_regprocedure('public.net_pulse_account_summary_rows(uuid[],uuid)') is null
    or to_regprocedure('public.is_current_user_gm()') is null
    or to_regprocedure('public.fetch_net_pulse_page(text,uuid,uuid,text,timestamptz,uuid,integer)') is null
    or to_regprocedure('public.fetch_net_pulse_thread_page(uuid,uuid,timestamptz,uuid,integer)') is null
    or to_regprocedure('public.fetch_net_pulse_account_summaries(uuid,text,uuid,integer)') is null
    or to_regprocedure('public.fetch_net_pulse_discover_accounts(uuid,integer)') is null
    or to_regprocedure('public.fetch_net_pulse_relationship_page(uuid,text,uuid,timestamptz,uuid,integer)') is null
    or to_regprocedure('public.fetch_net_pulse_relationship_accounts(uuid,text,uuid,integer)') is null
  then
    raise exception 'NET_PULSE_HACKING_RUNTIME_PARITY_FIX_DEPENDENCY_REQUIRED. This migration requires net-pulse-take-control-npc-parity-fix.sql, net-pulse-abuse-budgets.sql, net-pulse-context-binding.sql, net-pulse-dormant-account-visibility.sql, and net-system-hacking-foundation.sql to be deployed first.'
      using errcode = '55000';
  end if;
end;
$preflight$;

-- ==================================================================
-- current_net_pulse_owner_account_id() -- UNCHANGED from the prior
-- revision. No expected-value input exists to disambiguate against, so it
-- keeps the unconditional projection matching current_net_effective_
-- runtime_identity_link_id()'s own no-disambiguation-input behaviour. Its
-- remaining callers (listed above) are all read-only, public-content
-- personalization -- see the header comment for why that is safe.
-- ==================================================================

create or replace function public.current_net_pulse_owner_account_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_account_id uuid;
  v_source_identity_link_id uuid;
  v_hacking_session public.net_system_hacking_sessions%rowtype;
begin
  if v_actor is null then
    return null;
  end if;

  select profile.role::text
  into v_actor_role
  from public.profiles as profile
  where profile.id = v_actor;

  if v_actor_role = 'gm' then
    -- Unchanged: a GM never falls through to a possibly stale personal
    -- active-identity row. Only the exact authoritative TAKE CONTROL target
    -- (player or, via the prior NPC-parity fix, ACT AS NPC) can resolve.
    select pulse_account.id
    into v_account_id
    from public.net_gm_persona_sessions as gm_session
    join public.net_identity_links as identity_link
      on identity_link.subject_kind = gm_session.subject_kind
      and identity_link.subject_id = gm_session.subject_id
      and (
        (identity_link.identity_kind = 'player' and identity_link.playability = 'playable')
        or
        (identity_link.identity_kind = 'npc' and identity_link.playability = 'non-playable')
      )
    join public.net_identity_app_installs as pulse_install
      on pulse_install.identity_link_id = identity_link.id
      and pulse_install.app_id = 'pulse'
    join public.net_app_accounts as pulse_account
      on pulse_account.identity_link_id = identity_link.id
      and pulse_account.app_id = 'pulse'
      and pulse_account.status = 'active'
    where gm_session.gm_profile_id = v_actor
      and gm_session.mode = 'take-control'
      and public.net_identity_link_can_access_service(identity_link.id, 'pulse');
  else
    -- Resolve the player's own canonical SOURCE identity exactly as before.
    select identity_link.id
    into v_source_identity_link_id
    from public.net_active_identities as active_identity
    join public.net_identity_links as identity_link
      on identity_link.id = active_identity.identity_link_id
      and identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
    where active_identity.profile_id = v_actor
      and public.current_user_controls_playable_net_identity_link(identity_link.id);

    if v_source_identity_link_id is not null then
      select session_row.*
      into v_hacking_session
      from public.net_system_hacking_sessions as session_row
      where session_row.actor_identity_link_id = v_source_identity_link_id;

      if found then
        select pulse_account.id
        into v_account_id
        from public.net_app_accounts as pulse_account
        where pulse_account.identity_link_id = v_hacking_session.target_identity_link_id
          and pulse_account.app_id = 'pulse'
          and pulse_account.status = 'active';
      else
        select pulse_account.id
        into v_account_id
        from public.net_app_accounts as pulse_account
        where pulse_account.identity_link_id = v_source_identity_link_id
          and pulse_account.app_id = 'pulse'
          and pulse_account.status = 'active';
      end if;
    end if;
  end if;

  return v_account_id;
end;
$$;

revoke all on function public.current_net_pulse_owner_account_id()
  from public, anon, authenticated;

-- ==================================================================
-- assert_net_pulse_account_context(...) -- UNCHANGED from the prior
-- revision. Still the SOURCE-or-exact-TARGET disambiguation gate.
-- ==================================================================

create or replace function public.assert_net_pulse_account_context(
  requested_expected_account_id uuid,
  requested_require_account boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_candidate_identity_link_id uuid;
  v_identity_link_id uuid;
  v_effective_identity_link_id uuid;
  v_account_id uuid;
  v_source_account_id uuid;
  v_target_identity_link_id uuid;
  v_target_account_id uuid;
  v_hacking_session public.net_system_hacking_sessions%rowtype;
  v_gm_mode text;
begin
  if v_actor is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select profile.role::text
  into v_actor_role
  from public.profiles as profile
  where profile.id = v_actor
  for share;

  if v_actor_role is null then
    raise exception 'Authenticated profile is unavailable.' using errcode = '42501';
  end if;

  if v_actor_role = 'gm' then
    -- Unchanged GM branch (TAKE CONTROL / ACT AS / compromised-session).
    select gm_session.mode
    into v_gm_mode
    from public.net_gm_persona_sessions as gm_session
    where gm_session.gm_profile_id = v_actor
    for share;

    if v_gm_mode = 'take-control' then
      select identity_link.id
      into v_identity_link_id
      from public.net_gm_persona_sessions as gm_session
      join public.net_identity_links as identity_link
        on identity_link.subject_kind = gm_session.subject_kind
        and identity_link.subject_id = gm_session.subject_id
        and (
          (identity_link.identity_kind = 'player' and identity_link.playability = 'playable')
          or
          (identity_link.identity_kind = 'npc' and identity_link.playability = 'non-playable')
        )
      where gm_session.gm_profile_id = v_actor
        and gm_session.mode = 'take-control'
      for share of identity_link;

      if v_identity_link_id is null then
        raise exception 'PULSE_ACCOUNT_CONTEXT_CHANGED' using errcode = 'P0001';
      end if;

      perform public.assert_net_identity_service_access(v_identity_link_id, 'pulse');

      perform 1
      from public.net_identity_app_installs as pulse_install
      where pulse_install.identity_link_id = v_identity_link_id
        and pulse_install.app_id = 'pulse'
      for share;
      if not found then
        raise exception 'PULSE_ACCOUNT_CONTEXT_CHANGED' using errcode = 'P0001';
      end if;

      select pulse_account.id
      into v_account_id
      from public.net_app_accounts as pulse_account
      where pulse_account.identity_link_id = v_identity_link_id
        and pulse_account.app_id = 'pulse'
        and pulse_account.status = 'active'
      for share;
    elsif v_gm_mode = 'compromised-session' then
      -- Compromised mutations remain on their separate generation-bound RPCs.
      -- Their shared read wrappers intentionally compare against a null owner.
      v_identity_link_id := null;
      v_account_id := null;
    else
      raise exception 'PULSE_ACCOUNT_CONTEXT_CHANGED' using errcode = 'P0001';
    end if;
  else
    -- Match set_net_active_identity's identity -> active-row lock order. This
    -- preserves the deployed normal-player authority rules while serializing
    -- an OS/capability change and an active-character switch with the request.
    select active_identity.identity_link_id
    into v_candidate_identity_link_id
    from public.net_active_identities as active_identity
    where active_identity.profile_id = v_actor;

    select identity_link.id
    into v_identity_link_id
    from public.net_identity_links as identity_link
    where identity_link.id = v_candidate_identity_link_id
      and identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
      and public.current_user_controls_playable_net_identity_link(identity_link.id)
    for share;

    if v_identity_link_id is not null then
      select pulse_account.id
      into v_source_account_id
      from public.net_active_identities as active_identity
      left join public.net_app_accounts as pulse_account
        on pulse_account.identity_link_id = active_identity.identity_link_id
        and pulse_account.app_id = 'pulse'
        and pulse_account.status = 'active'
      where active_identity.profile_id = v_actor
        and active_identity.identity_link_id = v_identity_link_id
      for share of active_identity;

      if not found then
        raise exception 'PULSE_ACCOUNT_CONTEXT_CHANGED' using errcode = 'P0001';
      end if;

      v_account_id := v_source_account_id;
      v_effective_identity_link_id := v_identity_link_id;

      -- Hacking projection, locked against a concurrent DISCONNECT racing
      -- this exact request, consistent with every other lock already in
      -- this function. Disambiguation only, never authorization:
      -- requested_expected_account_id is compared against the target
      -- account below, never used to look it up. v_account_id already
      -- holds the SOURCE's own account and is left untouched unless the
      -- caller's expectation exactly matches this session's own TARGET --
      -- a third, unrelated account id falls through unchanged and is
      -- rejected by the final comparison exactly as before.
      select session_row.*
      into v_hacking_session
      from public.net_system_hacking_sessions as session_row
      where session_row.actor_identity_link_id = v_identity_link_id
      for share;

      if found then
        v_target_identity_link_id := v_hacking_session.target_identity_link_id;

        select pulse_account.id
        into v_target_account_id
        from public.net_app_accounts as pulse_account
        where pulse_account.identity_link_id = v_target_identity_link_id
          and pulse_account.app_id = 'pulse'
          and pulse_account.status = 'active'
        for share;

        if v_target_account_id is not null
          and requested_expected_account_id is not distinct from v_target_account_id
        then
          v_account_id := v_target_account_id;
          v_effective_identity_link_id := v_target_identity_link_id;
        end if;
      end if;
    end if;

    if v_account_id is not null then
      perform 1
      from public.net_app_accounts as pulse_account
      where pulse_account.id = v_account_id
        and pulse_account.app_id = 'pulse'
        and pulse_account.status = 'active'
      for share;
      if not found then
        raise exception 'PULSE_ACCOUNT_CONTEXT_CHANGED' using errcode = 'P0001';
      end if;
    end if;

    perform public.assert_net_identity_service_access(v_effective_identity_link_id, 'pulse');
  end if;

  if requested_expected_account_id is distinct from v_account_id then
    raise exception 'PULSE_ACCOUNT_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;
  if coalesce(requested_require_account, true) and v_account_id is null then
    raise exception 'An active, controlled PULSE account is required.' using errcode = '42501';
  end if;

  return v_account_id;
end;
$$;

revoke all on function public.assert_net_pulse_account_context(uuid, boolean)
  from public, anon, authenticated;

-- ==================================================================
-- Category B: actor-sensitive engagement mutations. Each now uses its OWN
-- assert_net_pulse_account_context(...) result directly for the write,
-- instead of delegating to the internal "legacy" worker that re-derived the
-- acting account independently via current_net_pulse_owner_account_id().
-- Query/validation logic is otherwise unchanged from the current deployed
-- bodies (net-pulse-abuse-budgets.sql), rate limiting included.
-- ==================================================================

create or replace function public.set_net_pulse_follow(
  requested_target_account_id uuid,
  requested_following boolean,
  requested_expected_account_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_profile_id uuid := auth.uid();
  actual_account_id uuid;
  target_account public.net_app_accounts%rowtype;
  target_profile public.net_pulse_profiles%rowtype;
  current_state boolean;
  changed_rows integer := 0;
begin
  actual_account_id := public.assert_net_pulse_account_context(
    requested_expected_account_id,
    true
  );
  if requested_following is null then
    raise exception 'A desired follow state is required.' using errcode = '22023';
  end if;

  select exists (
    select 1
    from public.net_pulse_follows as follow
    where follow.follower_account_id = actual_account_id
      and follow.followed_account_id = requested_target_account_id
  ) into current_state;

  if current_state is distinct from requested_following then
    perform public.consume_net_pulse_rate_limit('follow', 1);
  end if;

  if requested_target_account_id is null or requested_target_account_id = actual_account_id then
    raise exception 'A PULSE account cannot follow itself.' using errcode = '22023';
  end if;

  select pulse_account.* into target_account
  from public.net_app_accounts as pulse_account
  where pulse_account.id = requested_target_account_id
    and pulse_account.app_id = 'pulse';

  if not found or target_account.status <> 'active' then
    raise exception 'The requested PULSE account cannot be followed.' using errcode = '42501';
  end if;

  select pulse_profile.* into target_profile
  from public.net_pulse_profiles as pulse_profile
  where pulse_profile.account_id = target_account.id;

  if not found or (requested_following and target_profile.visibility <> 'public') then
    raise exception 'This PULSE profile is not available for public following.' using errcode = '42501';
  end if;

  if requested_following then
    insert into public.net_pulse_follows (follower_account_id, followed_account_id)
    values (actual_account_id, target_account.id)
    on conflict (follower_account_id, followed_account_id) do nothing;
  else
    delete from public.net_pulse_follows as follow
    where follow.follower_account_id = actual_account_id
      and follow.followed_account_id = target_account.id;
  end if;
  get diagnostics changed_rows = row_count;

  if changed_rows > 0 then
    insert into public.net_action_audit (
      authenticated_actor_profile_id,
      presented_account_id,
      action_mode,
      action_type,
      authorization_basis,
      resource_type,
      resource_id
    ) values (
      actor_profile_id,
      actual_account_id,
      'owner',
      case when requested_following then 'pulse.follow.add' else 'pulse.follow.remove' end,
      'controlled-playable-identity',
      'pulse-account',
      target_account.id
    );
  end if;

  return requested_following;
end;
$$;

create or replace function public.set_net_pulse_reaction(
  requested_post_id uuid,
  requested_reacted boolean,
  requested_expected_account_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_profile_id uuid := auth.uid();
  actual_account_id uuid;
  target_post public.net_pulse_posts%rowtype;
  current_state boolean;
  changed_rows integer := 0;
begin
  actual_account_id := public.assert_net_pulse_account_context(
    requested_expected_account_id,
    true
  );
  if requested_reacted is null then
    raise exception 'A desired reaction state is required.' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.net_pulse_reactions as reaction
    where reaction.post_id = requested_post_id
      and reaction.account_id = actual_account_id
  ) into current_state;

  if current_state is distinct from requested_reacted then
    perform public.consume_net_pulse_rate_limit('engagement', 1);
  end if;

  select post.* into target_post
  from public.net_pulse_posts as post
  where post.id = requested_post_id and post.deleted_at is null;
  if not found or not public.net_pulse_post_is_visible(target_post.id) then
    raise exception 'The requested PULSE is not available.' using errcode = 'P0002';
  end if;

  if requested_reacted then
    insert into public.net_pulse_reactions (post_id, account_id)
    values (target_post.id, actual_account_id)
    on conflict (post_id, account_id) do nothing;
  else
    delete from public.net_pulse_reactions as reaction
    where reaction.post_id = target_post.id and reaction.account_id = actual_account_id;
  end if;
  get diagnostics changed_rows = row_count;

  if changed_rows > 0 then
    insert into public.net_action_audit (
      authenticated_actor_profile_id, presented_account_id, action_mode,
      action_type, authorization_basis, resource_type, resource_id
    ) values (
      actor_profile_id, actual_account_id, 'owner',
      case when requested_reacted then 'pulse.reaction.add' else 'pulse.reaction.remove' end,
      'controlled-playable-identity', 'pulse-post', target_post.id
    );
  end if;
  return requested_reacted;
end;
$$;

create or replace function public.set_net_pulse_boost(
  requested_post_id uuid,
  requested_boosted boolean,
  requested_expected_account_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_profile_id uuid := auth.uid();
  actual_account_id uuid;
  target_post public.net_pulse_posts%rowtype;
  current_state boolean;
  changed_rows integer := 0;
begin
  actual_account_id := public.assert_net_pulse_account_context(
    requested_expected_account_id,
    true
  );
  if requested_boosted is null then
    raise exception 'A desired boost state is required.' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.net_pulse_boosts as boost
    where boost.post_id = requested_post_id
      and boost.account_id = actual_account_id
  ) into current_state;

  if current_state is distinct from requested_boosted then
    perform public.consume_net_pulse_rate_limit('engagement', 1);
  end if;

  select post.* into target_post
  from public.net_pulse_posts as post
  where post.id = requested_post_id and post.deleted_at is null;
  if not found or not public.net_pulse_post_is_visible(target_post.id) then
    raise exception 'The requested PULSE is not available.' using errcode = 'P0002';
  end if;
  if target_post.parent_post_id is not null then
    raise exception 'Replies cannot be boosted in PULSE V1.' using errcode = '22023';
  end if;
  if target_post.author_account_id = actual_account_id then
    raise exception 'A PULSE account cannot boost its own Pulse.' using errcode = '22023';
  end if;

  if requested_boosted then
    insert into public.net_pulse_boosts (post_id, account_id)
    values (target_post.id, actual_account_id)
    on conflict (post_id, account_id) do nothing;
  else
    delete from public.net_pulse_boosts as boost
    where boost.post_id = target_post.id and boost.account_id = actual_account_id;
  end if;
  get diagnostics changed_rows = row_count;

  if changed_rows > 0 then
    insert into public.net_action_audit (
      authenticated_actor_profile_id, presented_account_id, action_mode,
      action_type, authorization_basis, resource_type, resource_id
    ) values (
      actor_profile_id, actual_account_id, 'owner',
      case when requested_boosted then 'pulse.boost.add' else 'pulse.boost.remove' end,
      'controlled-playable-identity', 'pulse-post', target_post.id
    );
  end if;
  return requested_boosted;
end;
$$;

create or replace function public.set_net_pulse_bookmark(
  requested_post_id uuid,
  requested_bookmarked boolean,
  requested_expected_account_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_profile_id uuid := auth.uid();
  actual_account_id uuid;
  target_post public.net_pulse_posts%rowtype;
  current_state boolean;
  changed_rows integer := 0;
begin
  actual_account_id := public.assert_net_pulse_account_context(
    requested_expected_account_id,
    true
  );
  if requested_bookmarked is null then
    raise exception 'A desired bookmark state is required.' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.net_pulse_bookmarks as bookmark
    where bookmark.post_id = requested_post_id
      and bookmark.account_id = actual_account_id
  ) into current_state;

  if current_state is distinct from requested_bookmarked then
    perform public.consume_net_pulse_rate_limit('engagement', 1);
  end if;

  select post.* into target_post
  from public.net_pulse_posts as post
  where post.id = requested_post_id and post.deleted_at is null;
  if not found or not public.net_pulse_post_is_visible(target_post.id) then
    raise exception 'The requested PULSE is not available.' using errcode = 'P0002';
  end if;

  if requested_bookmarked then
    insert into public.net_pulse_bookmarks (post_id, account_id)
    values (target_post.id, actual_account_id)
    on conflict (post_id, account_id) do nothing;
  else
    delete from public.net_pulse_bookmarks as bookmark
    where bookmark.post_id = target_post.id and bookmark.account_id = actual_account_id;
  end if;
  get diagnostics changed_rows = row_count;

  if changed_rows > 0 then
    insert into public.net_action_audit (
      authenticated_actor_profile_id, presented_account_id, action_mode,
      action_type, authorization_basis, resource_type, resource_id
    ) values (
      actor_profile_id, actual_account_id, 'owner',
      case when requested_bookmarked then 'pulse.bookmark.add' else 'pulse.bookmark.remove' end,
      'controlled-playable-identity', 'pulse-post', target_post.id
    );
  end if;
  return requested_bookmarked;
end;
$$;

revoke all on function public.set_net_pulse_follow(uuid, boolean, uuid)
  from public, anon, authenticated;
revoke all on function public.set_net_pulse_reaction(uuid, boolean, uuid)
  from public, anon, authenticated;
revoke all on function public.set_net_pulse_boost(uuid, boolean, uuid)
  from public, anon, authenticated;
revoke all on function public.set_net_pulse_bookmark(uuid, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.set_net_pulse_follow(uuid, boolean, uuid) to authenticated;
grant execute on function public.set_net_pulse_reaction(uuid, boolean, uuid) to authenticated;
grant execute on function public.set_net_pulse_boost(uuid, boolean, uuid) to authenticated;
grant execute on function public.set_net_pulse_bookmark(uuid, boolean, uuid) to authenticated;

-- ==================================================================
-- Category B: notification mutations and reads. Same treatment -- each now
-- resolves its own account via assert_net_pulse_account_context(...) and
-- uses it directly, instead of delegating to a legacy worker that
-- re-derived it via current_net_pulse_owner_account_id(). Query logic is
-- otherwise unchanged from the current deployed bodies
-- (net-pulse-dormant-account-visibility.sql).
-- ==================================================================

create or replace function public.mark_net_pulse_notification_read(
  requested_notification_id uuid,
  requested_expected_account_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actual_account_id uuid;
  marked_notification_id uuid;
  changed_read_state boolean := false;
begin
  actual_account_id := public.assert_net_pulse_account_context(
    requested_expected_account_id,
    true
  );
  if requested_notification_id is null then
    raise exception 'A PULSE notification is required.' using errcode = '22023';
  end if;

  update public.net_pulse_notifications as notification
  set read_at = timezone('utc', now())
  where notification.id = requested_notification_id
    and notification.recipient_account_id = actual_account_id
    and notification.read_at is null
    and public.net_pulse_account_is_currently_visible(notification.actor_account_id)
    and (
      notification.notification_type = 'follow'
      or (
        notification.post_id is not null
        and public.net_pulse_post_is_visible(notification.post_id)
      )
    )
  returning notification.id into marked_notification_id;

  changed_read_state := marked_notification_id is not null;

  if marked_notification_id is null then
    select notification.id into marked_notification_id
    from public.net_pulse_notifications as notification
    where notification.id = requested_notification_id
      and notification.recipient_account_id = actual_account_id
      and public.net_pulse_account_is_currently_visible(notification.actor_account_id)
      and (
        notification.notification_type = 'follow'
        or (
          notification.post_id is not null
          and public.net_pulse_post_is_visible(notification.post_id)
        )
      );
  end if;
  if marked_notification_id is null then
    raise exception 'The requested PULSE notification is unavailable.' using errcode = 'P0002';
  end if;

  if changed_read_state then
    perform public.signal_net_pulse_notification_read_change();
  end if;
  return marked_notification_id;
end;
$$;

create or replace function public.mark_all_net_pulse_notifications_read(
  requested_expected_account_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actual_account_id uuid;
  changed_rows integer := 0;
begin
  actual_account_id := public.assert_net_pulse_account_context(
    requested_expected_account_id,
    true
  );

  update public.net_pulse_notifications as notification
  set read_at = timezone('utc', now())
  where notification.recipient_account_id = actual_account_id
    and notification.read_at is null
    and public.net_pulse_account_is_currently_visible(notification.actor_account_id)
    and (
      notification.notification_type = 'follow'
      or (
        notification.post_id is not null
        and public.net_pulse_post_is_visible(notification.post_id)
      )
    );
  get diagnostics changed_rows = row_count;

  if changed_rows > 0 then
    perform public.signal_net_pulse_notification_read_change();
  end if;
  return changed_rows;
end;
$$;

create or replace function public.fetch_net_pulse_notification_page(
  requested_expected_account_id uuid,
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 20
)
returns table (
  id uuid,
  notification_type text,
  actor_account_id uuid,
  actor_handle text,
  actor_avatar_url text,
  post_id uuid,
  root_post_id uuid,
  post_excerpt text,
  post_available boolean,
  created_at timestamptz,
  read_at timestamptz,
  page_has_more boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  viewer_account_id uuid;
  safe_limit integer := least(greatest(coalesce(requested_limit, 20), 1), 40);
begin
  viewer_account_id := public.assert_net_pulse_account_context(
    requested_expected_account_id,
    true
  );
  if (requested_cursor_at is null) <> (requested_cursor_id is null) then
    raise exception 'Notification cursor timestamp and id must be supplied together.' using errcode = '22023';
  end if;

  return query
  with recursive candidates as (
    select notification.*
    from public.net_pulse_notifications as notification
    join public.net_app_accounts as actor
      on actor.id = notification.actor_account_id
      and actor.app_id = 'pulse'
    where notification.recipient_account_id = viewer_account_id
      and public.net_pulse_account_is_currently_visible(actor.id)
      and (
        notification.notification_type = 'follow'
        or (
          notification.post_id is not null
          and public.net_pulse_post_is_visible(notification.post_id)
        )
      )
      and (
        requested_cursor_at is null
        or (notification.created_at, notification.id) < (requested_cursor_at, requested_cursor_id)
      )
    order by notification.created_at desc, notification.id desc
    limit safe_limit + 1
  ),
  marked as (
    select candidate.*,
      count(*) over () > safe_limit as has_more,
      row_number() over (order by candidate.created_at desc, candidate.id desc) as row_number
    from candidates as candidate
  ),
  selected as (
    select candidate.* from marked as candidate where candidate.row_number <= safe_limit
  ),
  ancestry as (
    select
      selected.id as notification_id,
      post.id,
      post.parent_post_id,
      post.deleted_at,
      post.body,
      0 as depth
    from selected
    join public.net_pulse_posts as post on post.id = selected.post_id

    union all

    select
      child.notification_id,
      parent.id,
      parent.parent_post_id,
      parent.deleted_at,
      parent.body,
      child.depth + 1
    from ancestry as child
    join public.net_pulse_posts as parent on parent.id = child.parent_post_id
    where child.depth < 16
  ),
  availability as (
    select
      selected.id,
      selected.post_id is not null
        and count(ancestor.id) > 0
        and bool_and(ancestor.deleted_at is null) as available,
      max(ancestor.body) filter (where ancestor.depth = 0) as body
    from selected
    left join ancestry as ancestor on ancestor.notification_id = selected.id
    group by selected.id, selected.post_id
  )
  select
    selected.id,
    selected.notification_type,
    selected.actor_account_id,
    actor.handle,
    presentation.avatar_url,
    selected.post_id,
    selected.root_post_id,
    case when availability.available then left(availability.body, 120) else null end,
    case when selected.notification_type = 'follow' then true else availability.available end,
    selected.created_at,
    selected.read_at,
    selected.has_more
  from selected
  join public.net_app_accounts as actor
    on actor.id = selected.actor_account_id and actor.app_id = 'pulse'
  left join public.net_pulse_account_presentation as presentation
    on presentation.account_id = actor.id
  left join availability on availability.id = selected.id
  order by selected.created_at desc, selected.id desc;
end;
$$;

create or replace function public.fetch_net_pulse_notification_state(
  requested_expected_account_id uuid
)
returns table (
  unread_count bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  viewer_account_id uuid;
  resolved_unread_count bigint;
begin
  viewer_account_id := public.assert_net_pulse_account_context(
    requested_expected_account_id,
    true
  );

  select count(*)::bigint into resolved_unread_count
  from public.net_pulse_notifications as notification
  where notification.recipient_account_id = viewer_account_id
    and notification.read_at is null
    and public.net_pulse_account_is_currently_visible(notification.actor_account_id)
    and (
      notification.notification_type = 'follow'
      or (
        notification.post_id is not null
        and public.net_pulse_post_is_visible(notification.post_id)
      )
    );

  return query select resolved_unread_count;
end;
$$;

revoke all on function public.mark_net_pulse_notification_read(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.mark_all_net_pulse_notifications_read(uuid)
  from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_notification_page(uuid, timestamptz, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_notification_state(uuid)
  from public, anon, authenticated;
grant execute on function public.mark_net_pulse_notification_read(uuid, uuid) to authenticated;
grant execute on function public.mark_all_net_pulse_notifications_read(uuid) to authenticated;
grant execute on function public.fetch_net_pulse_notification_page(uuid, timestamptz, uuid, integer) to authenticated;
grant execute on function public.fetch_net_pulse_notification_state(uuid) to authenticated;

-- ==================================================================
-- Category A (second pass): viewer-personalized reads. Each now uses its
-- own assert_net_pulse_account_context(..., false) result directly for
-- viewer-relative flags, instead of delegating to a legacy body that
-- re-derived the viewer via current_net_pulse_owner_account_id(). Query
-- logic is otherwise unchanged from the current deployed bodies
-- (net-pulse-performance-pagination.sql, net-pulse-dormant-account-
-- visibility.sql, net-pulse-social-navigation.sql).
-- ==================================================================

create or replace function public.fetch_net_pulse_page(
  requested_mode text,
  requested_expected_account_id uuid,
  requested_profile_account_id uuid default null,
  requested_search_query text default null,
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 20
)
returns table (
  id uuid, author_account_id uuid, parent_post_id uuid, body text,
  created_at timestamptz, updated_at timestamptz, author_handle text,
  author_display_name text, author_avatar_url text, author_status text,
  author_bio text, author_visibility text, author_discoverable boolean,
  author_followers bigint, author_following bigint, author_pulses bigint,
  viewer_follows_author boolean, reply_count bigint, reaction_count bigint,
  boost_count bigint, viewer_reacted boolean, viewer_boosted boolean,
  viewer_bookmarked boolean, followed_booster_account_id uuid,
  followed_booster_handle text, following_activity_at timestamptz,
  page_sort_at timestamptz, page_has_more boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actual_account_id uuid;
  normalized_search_query text;
  effective_search_query text;
  safe_limit integer := least(greatest(coalesce(requested_limit, 20), 1), 40);
begin
  actual_account_id := public.assert_net_pulse_account_context(
    requested_expected_account_id,
    false
  );
  if requested_search_query is not null
    and (
      octet_length(requested_search_query) > 320
      or char_length(requested_search_query) > 80
    )
  then
    raise exception 'PULSE search is limited to 80 characters.' using errcode = '22001';
  end if;
  normalized_search_query := btrim(coalesce(requested_search_query, ''));
  if requested_mode = 'search' and char_length(normalized_search_query) < 3 then
    raise exception 'PULSE content search requires at least 3 characters.' using errcode = '22023';
  end if;
  effective_search_query := case
    when requested_mode = 'search' then normalized_search_query
    else requested_search_query
  end;

  if (requested_cursor_at is null) <> (requested_cursor_id is null) then
    raise exception 'PULSE cursor timestamp and id must be supplied together.' using errcode = '22023';
  end if;

  return query
  with candidate_page as (
    select candidate.*
    from public.net_pulse_page_candidates(
      requested_mode,
      requested_profile_account_id,
      effective_search_query,
      requested_cursor_at,
      requested_cursor_id,
      safe_limit,
      actual_account_id
    ) as candidate
  ),
  candidate_marked as (
    select candidate.*,
      count(*) over () > safe_limit as has_more,
      row_number() over (order by candidate.sort_at desc, candidate.post_id desc) as row_number
    from candidate_page as candidate
  ),
  selected_candidates as (
    select candidate.*
    from candidate_marked as candidate
    where candidate.row_number <= safe_limit
  ),
  rendered as (
    select row.*
    from public.net_pulse_render_post_rows(
      coalesce((select array_agg(candidate.post_id) from selected_candidates as candidate), array[]::uuid[]),
      actual_account_id
    ) as row
  )
  select
    rendered.id,
    rendered.author_account_id,
    rendered.parent_post_id,
    rendered.body,
    rendered.created_at,
    rendered.updated_at,
    rendered.author_handle,
    rendered.author_display_name,
    rendered.author_avatar_url,
    rendered.author_status,
    rendered.author_bio,
    rendered.author_visibility,
    rendered.author_discoverable,
    rendered.author_followers,
    rendered.author_following,
    rendered.author_pulses,
    rendered.viewer_follows_author,
    rendered.reply_count,
    rendered.reaction_count,
    rendered.boost_count,
    rendered.viewer_reacted,
    rendered.viewer_boosted,
    rendered.viewer_bookmarked,
    candidate.followed_booster_account_id,
    candidate.followed_booster_handle,
    candidate.sort_at,
    candidate.sort_at,
    candidate.has_more
  from selected_candidates as candidate
  join rendered on rendered.id = candidate.post_id
  order by candidate.sort_at desc, candidate.post_id desc;
end;
$$;

create or replace function public.fetch_net_pulse_thread_page(
  requested_root_post_id uuid,
  requested_expected_account_id uuid,
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 30
)
returns table (
  id uuid, author_account_id uuid, parent_post_id uuid, body text,
  created_at timestamptz, updated_at timestamptz, author_handle text,
  author_display_name text, author_avatar_url text, author_status text,
  author_bio text, author_visibility text, author_discoverable boolean,
  author_followers bigint, author_following bigint, author_pulses bigint,
  viewer_follows_author boolean, reply_count bigint, reaction_count bigint,
  boost_count bigint, viewer_reacted boolean, viewer_boosted boolean,
  viewer_bookmarked boolean, followed_booster_account_id uuid,
  followed_booster_handle text, following_activity_at timestamptz,
  page_sort_at timestamptz, page_has_more boolean, is_thread_root boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actual_account_id uuid;
  safe_limit integer := least(greatest(coalesce(requested_limit, 30), 1), 50);
begin
  actual_account_id := public.assert_net_pulse_account_context(
    requested_expected_account_id,
    false
  );
  if requested_root_post_id is null then
    raise exception 'A root PULSE is required.' using errcode = '22023';
  end if;
  if (requested_cursor_at is null) <> (requested_cursor_id is null) then
    raise exception 'PULSE reply cursor timestamp and id must be supplied together.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.net_pulse_posts as root
    where root.id = requested_root_post_id
      and root.parent_post_id is null
      and public.net_pulse_post_is_visible(root.id)
  ) then
    raise exception 'The requested PULSE thread is unavailable.' using errcode = 'P0002';
  end if;

  return query
  with reply_page as (
    select reply.id, reply.created_at
    from public.net_pulse_posts as reply
    where reply.parent_post_id = requested_root_post_id
      and public.net_pulse_post_is_visible(reply.id)
      and (requested_cursor_at is null or (reply.created_at, reply.id) < (requested_cursor_at, requested_cursor_id))
    order by reply.created_at desc, reply.id desc
    limit safe_limit + 1
  ),
  reply_marked as (
    select reply.*,
      count(*) over () > safe_limit as has_more,
      row_number() over (order by reply.created_at desc, reply.id desc) as row_number
    from reply_page as reply
  ),
  selected_replies as (
    select reply.* from reply_marked as reply where reply.row_number <= safe_limit
  ),
  selected_ids as (
    select requested_root_post_id as id
    union all
    select reply.id from selected_replies as reply
  ),
  rendered as (
    select row.*
    from public.net_pulse_render_post_rows(
      coalesce((select array_agg(selected.id) from selected_ids as selected), array[]::uuid[]),
      actual_account_id
    ) as row
  ),
  output_rows as (
    select rendered.*, rendered.created_at as sort_at,
      coalesce((select bool_or(reply.has_more) from selected_replies as reply), false) as has_more,
      true as thread_root
    from rendered
    where rendered.id = requested_root_post_id
      and requested_cursor_at is null

    union all

    select rendered.*, reply.created_at,
      reply.has_more,
      false
    from selected_replies as reply
    join rendered on rendered.id = reply.id
  )
  select
    output.id,
    output.author_account_id,
    output.parent_post_id,
    output.body,
    output.created_at,
    output.updated_at,
    output.author_handle,
    output.author_display_name,
    output.author_avatar_url,
    output.author_status,
    output.author_bio,
    output.author_visibility,
    output.author_discoverable,
    output.author_followers,
    output.author_following,
    output.author_pulses,
    output.viewer_follows_author,
    output.reply_count,
    output.reaction_count,
    output.boost_count,
    output.viewer_reacted,
    output.viewer_boosted,
    output.viewer_bookmarked,
    null::uuid,
    null::text,
    output.created_at,
    output.sort_at,
    output.has_more,
    output.thread_root
  from output_rows as output
  order by output.thread_root desc, output.sort_at desc, output.id desc;
end;
$$;

create or replace function public.fetch_net_pulse_account_summaries(
  requested_expected_account_id uuid,
  requested_query text default null,
  requested_account_id uuid default null,
  requested_limit integer default 20
)
returns table (
  account_id uuid, handle text, avatar_url text, bio text, visibility text,
  discoverable boolean, status text, followers_count bigint,
  following_count bigint, pulses_count bigint, viewer_following boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actual_account_id uuid;
  normalized_query text;
  safe_limit integer := least(greatest(coalesce(requested_limit, 20), 1), 30);
begin
  actual_account_id := public.assert_net_pulse_account_context(
    requested_expected_account_id,
    false
  );
  if requested_query is not null
    and (
      octet_length(requested_query) > 320
      or char_length(requested_query) > 80
    )
  then
    raise exception 'PULSE account search is limited to 80 characters.' using errcode = '22001';
  end if;

  normalized_query := lower(btrim(coalesce(requested_query, '')));
  if left(normalized_query, 1) = '@' then
    normalized_query := substr(normalized_query, 2);
  end if;
  if requested_account_id is null and (
    char_length(normalized_query) < 2
    or normalized_query !~ '^[a-z0-9_.-]+$'
  ) then
    raise exception 'PULSE account search requires at least 2 valid handle characters.' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select account.id, account.handle
    from public.net_app_accounts as account
    join public.net_pulse_profiles as profile on profile.account_id = account.id
    where account.app_id = 'pulse'
      and public.net_pulse_account_is_currently_visible(account.id)
      and (
        (
          requested_account_id is not null
          and account.id = requested_account_id
          and (
            profile.visibility = 'public'
            or account.id = actual_account_id
            or public.is_current_user_gm()
          )
        )
        or (
          requested_account_id is null
          and normalized_query <> ''
          and profile.visibility = 'public'
          and profile.discoverable
          and lower(account.handle) like '%' || normalized_query || '%'
        )
      )
    order by account.handle asc, account.id asc
    limit safe_limit
  )
  select summary.*
  from candidates as candidate
  join public.net_pulse_account_summary_rows(
    coalesce((select array_agg(selected.id) from candidates as selected), array[]::uuid[]),
    actual_account_id
  ) as summary on summary.account_id = candidate.id
  order by candidate.handle asc, candidate.id asc;
end;
$$;

create or replace function public.fetch_net_pulse_discover_accounts(
  requested_expected_account_id uuid,
  requested_limit integer default 12
)
returns table (
  account_id uuid, handle text, avatar_url text, bio text, visibility text,
  discoverable boolean, status text, followers_count bigint,
  following_count bigint, pulses_count bigint, viewer_following boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actual_account_id uuid;
  safe_limit integer := least(greatest(coalesce(requested_limit, 12), 1), 30);
begin
  actual_account_id := public.assert_net_pulse_account_context(
    requested_expected_account_id,
    false
  );

  return query
  with candidates as (
    select account.id, profile.created_at
    from public.net_app_accounts as account
    join public.net_pulse_profiles as profile on profile.account_id = account.id
    where account.app_id = 'pulse'
      and public.net_pulse_account_is_currently_visible(account.id)
      and profile.visibility = 'public'
      and profile.discoverable
    order by profile.created_at desc, account.id desc
    limit safe_limit
  )
  select summary.*
  from candidates as candidate
  join public.net_pulse_account_summary_rows(
    coalesce((select array_agg(selected.id) from candidates as selected), array[]::uuid[]),
    actual_account_id
  ) as summary on summary.account_id = candidate.id
  order by candidate.created_at desc, candidate.id desc;
end;
$$;

create or replace function public.fetch_net_pulse_relationship_page(
  requested_profile_account_id uuid,
  requested_direction text,
  requested_expected_account_id uuid,
  requested_cursor_at timestamptz default null,
  requested_cursor_account_id uuid default null,
  requested_limit integer default 30
)
returns table (
  account_id uuid, handle text, avatar_url text, bio text, visibility text,
  discoverable boolean, status text, followers_count bigint,
  following_count bigint, pulses_count bigint, viewer_following boolean,
  relationship_created_at timestamptz, page_has_more boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actual_account_id uuid;
  target_visibility text;
  safe_limit integer := least(greatest(coalesce(requested_limit, 30), 1), 40);
begin
  actual_account_id := public.assert_net_pulse_account_context(
    requested_expected_account_id,
    false
  );
  if requested_profile_account_id is null then
    raise exception 'A PULSE profile account is required.' using errcode = '22023';
  end if;
  if requested_direction is null or requested_direction not in ('followers', 'following') then
    raise exception 'A valid PULSE relationship direction is required.' using errcode = '22023';
  end if;
  if (requested_cursor_at is null) <> (requested_cursor_account_id is null) then
    raise exception 'PULSE relationship cursor values must be supplied together.' using errcode = '22023';
  end if;

  select profile.visibility into target_visibility
  from public.net_app_accounts as account
  join public.net_pulse_profiles as profile on profile.account_id = account.id
  where account.id = requested_profile_account_id
    and account.app_id = 'pulse'
    and public.net_pulse_account_is_currently_visible(account.id);

  if not found then
    raise exception 'The requested PULSE profile is unavailable.' using errcode = 'P0002';
  end if;
  if target_visibility <> 'public' and requested_profile_account_id <> actual_account_id then
    raise exception 'The requested social graph is not publicly available.' using errcode = '42501';
  end if;

  return query
  with relationship_candidates as (
    select
      case when requested_direction = 'followers'
        then follow.follower_account_id else follow.followed_account_id end as related_account_id,
      follow.created_at
    from public.net_pulse_follows as follow
    join public.net_app_accounts as related_account
      on related_account.id = case when requested_direction = 'followers'
        then follow.follower_account_id else follow.followed_account_id end
      and related_account.app_id = 'pulse'
    join public.net_pulse_profiles as related_profile on related_profile.account_id = related_account.id
    where (
      (requested_direction = 'followers' and follow.followed_account_id = requested_profile_account_id)
      or (requested_direction = 'following' and follow.follower_account_id = requested_profile_account_id)
    )
      and public.net_pulse_account_is_currently_visible(related_account.id)
      and (related_profile.visibility = 'public' or related_account.id = actual_account_id)
      and (
        requested_cursor_at is null
        or (follow.created_at, related_account.id) < (requested_cursor_at, requested_cursor_account_id)
      )
    order by follow.created_at desc, related_account.id desc
    limit safe_limit + 1
  ),
  candidate_marked as (
    select candidate.*,
      count(*) over () > safe_limit as has_more,
      row_number() over (order by candidate.created_at desc, candidate.related_account_id desc) as row_number
    from relationship_candidates as candidate
  ),
  selected_candidates as (
    select candidate.* from candidate_marked as candidate where candidate.row_number <= safe_limit
  )
  select
    summary.account_id,
    summary.handle,
    summary.avatar_url,
    summary.bio,
    summary.visibility,
    summary.discoverable,
    summary.status,
    summary.followers_count,
    summary.following_count,
    summary.pulses_count,
    summary.viewer_following,
    candidate.created_at,
    candidate.has_more
  from selected_candidates as candidate
  join public.net_pulse_account_summary_rows(
    coalesce((select array_agg(selected.related_account_id) from selected_candidates as selected), array[]::uuid[]),
    actual_account_id
  ) as summary on summary.account_id = candidate.related_account_id
  order by candidate.created_at desc, candidate.related_account_id desc;
end;
$$;

-- Rather than duplicate fetch_net_pulse_relationship_page's query body, this
-- forwards the already-known requested_expected_account_id straight into
-- the now-fixed function above and lets it validate once. This is the same
-- "reuse the validated result, do not re-derive" rule applied across two
-- RPCs instead of within a single one.
create or replace function public.fetch_net_pulse_relationship_accounts(
  requested_profile_account_id uuid,
  requested_direction text,
  requested_expected_account_id uuid,
  requested_limit integer default 30
)
returns table (
  account_id uuid, handle text, avatar_url text, bio text, visibility text,
  discoverable boolean, status text, followers_count bigint,
  following_count bigint, pulses_count bigint, viewer_following boolean
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    page.account_id,
    page.handle,
    page.avatar_url,
    page.bio,
    page.visibility,
    page.discoverable,
    page.status,
    page.followers_count,
    page.following_count,
    page.pulses_count,
    page.viewer_following
  from public.fetch_net_pulse_relationship_page(
    requested_profile_account_id,
    requested_direction,
    requested_expected_account_id,
    null,
    null,
    least(greatest(coalesce(requested_limit, 30), 1), 30)
  ) as page;
$$;

revoke all on function public.fetch_net_pulse_page(text, uuid, uuid, text, timestamptz, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_thread_page(uuid, uuid, timestamptz, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_account_summaries(uuid, text, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_discover_accounts(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_relationship_page(uuid, text, uuid, timestamptz, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_relationship_accounts(uuid, text, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.fetch_net_pulse_page(text, uuid, uuid, text, timestamptz, uuid, integer) to authenticated;
grant execute on function public.fetch_net_pulse_thread_page(uuid, uuid, timestamptz, uuid, integer) to authenticated;
grant execute on function public.fetch_net_pulse_account_summaries(uuid, text, uuid, integer) to authenticated;
grant execute on function public.fetch_net_pulse_discover_accounts(uuid, integer) to authenticated;
grant execute on function public.fetch_net_pulse_relationship_page(uuid, text, uuid, timestamptz, uuid, integer) to authenticated;
grant execute on function public.fetch_net_pulse_relationship_accounts(uuid, text, uuid, integer) to authenticated;

commit;
