-- Unify Silver's player TAKE CONTROL and network-NPC ACT AS routing under one
-- authoritative controlled-identity session mode. This changes OS routing
-- context only; player ownership and application mutation predicates remain
-- unchanged.
-- Run once after net-multi-os-gm-act-as-routing.sql.

begin;

do $$
begin
  if to_regclass('public.profiles') is null
    or to_regclass('public.npc_cards') is null
    or to_regclass('public.net_gm_persona_sessions') is null
    or to_regclass('public.net_identity_links') is null
    or to_regclass('public.net_active_identities') is null
    or to_regclass('public.net_identity_os_assignments') is null
    or to_regclass('public.net_os_families') is null
    or to_regtype('public.app_role') is null
    or to_regprocedure('public.is_current_user_gm()') is null
    or to_regprocedure('public.current_user_controls_playable_net_identity_link(uuid)') is null
    or to_regprocedure('public.set_net_gm_persona(text,uuid,text)') is null
    or to_regprocedure('public.fetch_net_current_os_session()') is null
  then
    raise exception 'NET_UNIFIED_GM_CONTROL_DEPENDENCY_REQUIRED'
      using errcode = '55000';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'net_gm_persona_sessions'
      and column_name in (
        'mode',
        'subject_kind',
        'subject_id',
        'session_generation',
        'updated_at'
      )
  ) <> 5 then
    raise exception 'NET_UNIFIED_GM_CONTROL_SESSION_SHAPE_REQUIRED'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_constraint as table_constraint
    where table_constraint.conrelid = 'public.net_gm_persona_sessions'::regclass
      and table_constraint.contype = 'c'
      and pg_get_constraintdef(table_constraint.oid) like '%take-control%'
  ) then
    raise exception 'NET_UNIFIED_GM_CONTROL_MODE_REQUIRED'
      using errcode = '55000';
  end if;
end;
$$;

comment on column public.net_gm_persona_sessions.mode is
  'none is GM system; take-control is the single OS-routing control mode for an authoritative player/playable or network NPC/non-playable identity; inspect, legacy gm-persona, and compromised-session do not affect OS routing. Control routing never grants player ownership or application mutation authority.';

create or replace function public.set_net_gm_persona(
  requested_subject_kind text,
  requested_subject_id uuid,
  requested_mode text
)
returns public.net_gm_persona_sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  target_link public.net_identity_links%rowtype;
  saved_session public.net_gm_persona_sessions%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if not public.is_current_user_gm() then
    raise exception 'Only an authenticated GM may select a GM control context.'
      using errcode = '42501';
  end if;

  if requested_subject_id is null
    or requested_subject_kind is null
    or requested_subject_kind not in ('profile-sheet', 'npc-card')
    or requested_mode is null
    or requested_mode not in ('inspect', 'take-control', 'compromised-session')
  then
    raise exception 'Unsupported GM control request.' using errcode = '22023';
  end if;

  select identity_link.*
  into target_link
  from public.net_identity_links as identity_link
  where identity_link.subject_kind = requested_subject_kind
    and identity_link.subject_id = requested_subject_id;

  if requested_subject_kind = 'profile-sheet' then
    if not exists (
      select 1
      from public.profiles as target_profile
      where target_profile.id = requested_subject_id
        and target_profile.role = 'player'
    ) then
      raise exception 'Requested player profile sheet is unavailable.'
        using errcode = '22023';
    end if;
  elsif requested_subject_kind = 'npc-card' then
    if not exists (
      select 1
      from public.npc_cards as target_card
      where target_card.id = requested_subject_id
    ) then
      raise exception 'Requested NPC card is unavailable.' using errcode = '22023';
    end if;
  end if;

  if requested_mode = 'take-control' then
    if target_link.id is null
      or not (
        (
          target_link.identity_kind = 'player'
          and target_link.playability = 'playable'
        )
        or
        (
          requested_subject_kind = 'npc-card'
          and target_link.identity_kind = 'npc'
          and target_link.playability = 'non-playable'
        )
      )
    then
      raise exception 'GM CONTROL requires an authoritative playable player or network-enabled NPC identity.'
        using errcode = '42501';
    end if;
  elsif requested_mode = 'compromised-session' then
    if target_link.id is null
      or target_link.identity_kind <> 'player'
      or target_link.playability <> 'playable'
    then
      raise exception 'Compromised sessions require an authoritative playable player identity.'
        using errcode = '42501';
    end if;
  end if;

  insert into public.net_gm_persona_sessions (
    gm_profile_id,
    subject_kind,
    subject_id,
    mode
  )
  values (
    actor_id,
    requested_subject_kind,
    requested_subject_id,
    requested_mode
  )
  on conflict (gm_profile_id) do update
  set
    subject_kind = excluded.subject_kind,
    subject_id = excluded.subject_id,
    mode = excluded.mode
  returning * into saved_session;

  return saved_session;
end;
$$;

create or replace function public.fetch_net_current_os_session()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.app_role;
  v_gm_session public.net_gm_persona_sessions%rowtype;
  v_control_link public.net_identity_links%rowtype;
  v_identity_link_id uuid;
  v_primary_os_id text;
  v_os_status text;
  v_has_assignment boolean := false;
  v_control_is_npc boolean := false;
begin
  if v_actor is null then
    raise exception 'NET_OS_AUTH_REQUIRED' using errcode = '42501';
  end if;

  select profile.role
  into v_role
  from public.profiles as profile
  where profile.id = v_actor;

  if not found then
    raise exception 'NET_OS_PROFILE_UNAVAILABLE' using errcode = '42501';
  end if;

  if v_role = 'gm' then
    select session_row.*
    into v_gm_session
    from public.net_gm_persona_sessions as session_row
    where session_row.gm_profile_id = v_actor;

    if found and v_gm_session.mode = 'take-control' then
      select identity_link.*
      into v_control_link
      from public.net_identity_links as identity_link
      where identity_link.subject_kind = v_gm_session.subject_kind
        and identity_link.subject_id = v_gm_session.subject_id;

      if not found or not (
        (
          v_control_link.identity_kind = 'player'
          and v_control_link.playability = 'playable'
        )
        or
        (
          v_gm_session.subject_kind = 'npc-card'
          and v_control_link.identity_kind = 'npc'
          and v_control_link.playability = 'non-playable'
        )
      ) then
        raise exception 'NET_GM_CONTROL_TARGET_INVALID' using errcode = '42501';
      end if;

      v_identity_link_id := v_control_link.id;
      v_control_is_npc := v_control_link.identity_kind = 'npc';

      select assignment.primary_os_id, os_family.status
      into v_primary_os_id, v_os_status
      from public.net_identity_os_assignments as assignment
      left join public.net_os_families as os_family
        on os_family.id = assignment.primary_os_id
      where assignment.identity_link_id = v_control_link.id;

      v_has_assignment := found;

      if v_has_assignment and (v_os_status is null or v_os_status <> 'active') then
        raise exception 'NET_GM_CONTROL_TARGET_OS_UNAVAILABLE' using errcode = '42501';
      end if;

      if not v_control_is_npc and (not v_has_assignment or v_primary_os_id is null) then
        raise exception 'NET_GM_CONTROL_TARGET_OS_UNAVAILABLE' using errcode = '42501';
      end if;

      return jsonb_build_object(
        'actor_mode', 'gm-system',
        'context_mode', 'take-control',
        'identity_link_id', v_identity_link_id,
        'primary_os_id', case when v_has_assignment then v_primary_os_id else null end
      );
    end if;

    -- Inspect, compromised PULSE context, legacy gm-persona, none, and an
    -- absent session never select a fictional identity operating system.
    return jsonb_build_object(
      'actor_mode', 'gm-system',
      'context_mode', 'system',
      'identity_link_id', null,
      'primary_os_id', null
    );
  end if;

  -- Preserve the deployed normal-player authority path: auth.uid() must own
  -- the active player/playable identity link.
  select identity_link.id, assignment.primary_os_id
  into v_identity_link_id, v_primary_os_id
  from public.net_active_identities as active_identity
  join public.net_identity_links as identity_link
    on identity_link.id = active_identity.identity_link_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable'
  left join public.net_identity_os_assignments as assignment
    on assignment.identity_link_id = identity_link.id
  where active_identity.profile_id = v_actor
    and public.current_user_controls_playable_net_identity_link(identity_link.id);

  if v_identity_link_id is null then
    return jsonb_build_object(
      'actor_mode', 'player',
      'context_mode', 'identity',
      'identity_link_id', null,
      'primary_os_id', null
    );
  end if;

  if v_primary_os_id is null then
    raise exception 'NET_PRIMARY_OS_ASSIGNMENT_MISSING' using errcode = '55000';
  end if;

  return jsonb_build_object(
    'actor_mode', 'player',
    'context_mode', 'identity',
    'identity_link_id', v_identity_link_id,
    'primary_os_id', v_primary_os_id
  );
end;
$$;

revoke all on function public.set_net_gm_persona(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_net_gm_persona(text, uuid, text)
  to authenticated;

revoke all on function public.fetch_net_current_os_session()
  from public, anon, authenticated;
grant execute on function public.fetch_net_current_os_session()
  to authenticated;

commit;
