-- PULSE currently forks its own identity resolution instead of using the
-- canonical public.current_net_effective_runtime_identity_link_id() /
-- assert_net_effective_runtime_identity() used by every other identity-scoped
-- app (Messenger, Store install, WAVE, ALTARA MUSIC/BANK, NOVA BANK, VOX
-- AUDIO/BANK, SHNEIDER BANK, ECHO, VLT). That fork's GM take-control branch
-- only ever matches identity_link.identity_kind = 'player' — the canonical
-- resolver's own GM branch, by contrast, accepts
-- (player, playable) OR (npc, non-playable), exactly the ACT AS route.
-- Net effect: GM TAKE CONTROL of a player identity works for PULSE, but ACT
-- AS on a network NPC cannot resolve a PULSE identity/account at all, even
-- when that NPC is otherwise OS/service-eligible for PULSE — unlike every
-- other app, where NPC ACT AS gets the exact same runtime parity as player
-- TAKE CONTROL. This migration widens the GM branch of the three PULSE
-- functions that hard-code the player-only filter to match the identical
-- OR condition already used by the canonical resolver, and aligns the
-- audit `authorization_basis` string with the already-established
-- npc/player split from public.net_runtime_action_context() (the same
-- convention this file's own comment says to reuse from ALTARA BANK).
-- Every other predicate (install check, active-account check, service-access
-- check, row locking, the separate normal-player branch, the
-- compromised-session branch) is untouched.

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
begin
  if v_actor is null then
    return null;
  end if;

  select profile.role::text
  into v_actor_role
  from public.profiles as profile
  where profile.id = v_actor;

  if v_actor_role = 'gm' then
    -- A GM never falls through to a possibly stale personal active-identity
    -- row. Only the exact authoritative TAKE CONTROL target can resolve.
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
    -- Preserve the deployed normal-player resolver byte-for-behavior: the
    -- owned active playable identity selects its existing active account.
    select pulse_account.id
    into v_account_id
    from public.net_active_identities as active_identity
    join public.net_identity_links as identity_link
      on identity_link.id = active_identity.identity_link_id
      and identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
    join public.net_app_accounts as pulse_account
      on pulse_account.identity_link_id = identity_link.id
      and pulse_account.app_id = 'pulse'
      and pulse_account.status = 'active'
    where active_identity.profile_id = v_actor
      and public.current_user_controls_playable_net_identity_link(identity_link.id);
  end if;

  return v_account_id;
end;
$$;

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
  v_account_id uuid;
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
      into v_account_id
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

    perform public.assert_net_identity_service_access(v_identity_link_id, 'pulse');
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

create or replace function public.net_pulse_action_audit_context(
  requested_account_id uuid
)
returns table (
  action_mode text,
  authorization_basis text,
  persona_subject_kind text,
  persona_subject_id uuid
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_actual_account_id uuid;
begin
  v_actual_account_id := public.assert_net_pulse_account_context(
    requested_account_id,
    true
  );

  select profile.role::text
  into v_actor_role
  from public.profiles as profile
  where profile.id = v_actor;

  if v_actor_role = 'gm' then
    select
      'gm-persona'::text,
      case identity_link.identity_kind
        when 'npc' then 'authoritative-gm-take-control-npc'
        else 'authoritative-gm-take-control-player'
      end::text,
      gm_session.subject_kind,
      gm_session.subject_id
    into
      action_mode,
      authorization_basis,
      persona_subject_kind,
      persona_subject_id
    from public.net_gm_persona_sessions as gm_session
    join public.net_identity_links as identity_link
      on identity_link.subject_kind = gm_session.subject_kind
      and identity_link.subject_id = gm_session.subject_id
      and (
        (identity_link.identity_kind = 'player' and identity_link.playability = 'playable')
        or
        (identity_link.identity_kind = 'npc' and identity_link.playability = 'non-playable')
      )
    join public.net_app_accounts as pulse_account
      on pulse_account.identity_link_id = identity_link.id
      and pulse_account.app_id = 'pulse'
      and pulse_account.status = 'active'
    where gm_session.gm_profile_id = v_actor
      and gm_session.mode = 'take-control'
      and pulse_account.id = v_actual_account_id
    for share of gm_session;

    if not found then
      raise exception 'PULSE_ACCOUNT_CONTEXT_CHANGED' using errcode = 'P0001';
    end if;
  else
    action_mode := 'owner';
    authorization_basis := 'controlled-playable-identity';
    persona_subject_kind := null;
    persona_subject_id := null;
  end if;

  return next;
end;
$$;
