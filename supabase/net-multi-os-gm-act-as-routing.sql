-- Route an authenticated GM ACT AS session through an explicitly assigned
-- network-capable NPC operating system. This is routing context only: it does
-- not grant player ownership or broaden any application mutation authority.
-- Run once after net-multi-os-npc-assignments.sql.

begin;

do $$
begin
  if to_regclass('public.profiles') is null
    or to_regclass('public.net_gm_persona_sessions') is null
    or to_regclass('public.net_identity_links') is null
    or to_regclass('public.net_active_identities') is null
    or to_regclass('public.net_identity_os_assignments') is null
    or to_regclass('public.net_os_families') is null
    or to_regprocedure('public.fetch_net_current_os_session()') is null
    or to_regprocedure('public.current_user_controls_playable_net_identity_link(uuid)') is null
  then
    raise exception 'NET_GM_ACT_AS_OS_DEPENDENCY_REQUIRED' using errcode = '55000';
  end if;
end;
$$;

comment on column public.net_gm_persona_sessions.mode is
  'none is GM system; inspect and compromised-session do not affect OS routing; gm-persona routes ACT AS through an exact network NPC explicit active OS when present; take-control routes through the playable target authoritative OS. Routing never grants player ownership or app mutation authority.';

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
  v_identity_link public.net_identity_links%rowtype;
  v_identity_link_id uuid;
  v_primary_os_id text;
  v_has_identity_link boolean := false;
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
      select identity_link.id, assignment.primary_os_id
      into v_identity_link_id, v_primary_os_id
      from public.net_identity_links as identity_link
      join public.net_identity_os_assignments as assignment
        on assignment.identity_link_id = identity_link.id
      join public.net_os_families as os_family
        on os_family.id = assignment.primary_os_id
        and os_family.status = 'active'
      where identity_link.subject_kind = v_gm_session.subject_kind
        and identity_link.subject_id = v_gm_session.subject_id
        and identity_link.identity_kind = 'player'
        and identity_link.playability = 'playable';

      if v_identity_link_id is null or v_primary_os_id is null then
        raise exception 'NET_GM_CONTROL_TARGET_OS_UNAVAILABLE' using errcode = '42501';
      end if;

      return jsonb_build_object(
        'actor_mode', 'gm-system',
        'context_mode', 'take-control',
        'identity_link_id', v_identity_link_id,
        'primary_os_id', v_primary_os_id
      );
    end if;

    if found and v_gm_session.mode = 'gm-persona' then
      if v_gm_session.subject_kind <> 'npc-card' then
        raise exception 'NET_GM_ACT_AS_TARGET_INVALID' using errcode = '42501';
      end if;

      select identity_link.*
      into v_identity_link
      from public.net_identity_links as identity_link
      where identity_link.subject_kind = v_gm_session.subject_kind
        and identity_link.subject_id = v_gm_session.subject_id;

      v_has_identity_link := found;

      if v_has_identity_link and (
        v_identity_link.identity_kind <> 'npc'
        or v_identity_link.playability <> 'non-playable'
      ) then
        raise exception 'NET_GM_ACT_AS_TARGET_INVALID' using errcode = '42501';
      end if;

      if v_has_identity_link then
        v_identity_link_id := v_identity_link.id;

        select assignment.primary_os_id
        into v_primary_os_id
        from public.net_identity_os_assignments as assignment
        join public.net_os_families as os_family
          on os_family.id = assignment.primary_os_id
          and os_family.status = 'active'
        where assignment.identity_link_id = v_identity_link.id;
      end if;

      return jsonb_build_object(
        'actor_mode', 'gm-system',
        'context_mode', 'act-as',
        'identity_link_id', case when v_has_identity_link then v_identity_link_id else null end,
        'primary_os_id', v_primary_os_id
      );
    end if;

    -- Inspect, compromised PULSE context, none, and an absent session never
    -- select a fictional identity operating system.
    return jsonb_build_object(
      'actor_mode', 'gm-system',
      'context_mode', 'system',
      'identity_link_id', null,
      'primary_os_id', null
    );
  end if;

  -- Preserve the deployed normal-player authority path exactly: auth.uid()
  -- must control the active playable/player identity link.
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

revoke all on function public.fetch_net_current_os_session()
  from public, anon, authenticated;
grant execute on function public.fetch_net_current_os_session()
  to authenticated;

commit;
