-- Silver GM workspace routing and authoritative TAKE CONTROL OS resolution.
-- Forward migration: run after net-multi-os-altara-ecosystem.sql.

begin;

do $$
begin
  if to_regclass('public.net_gm_persona_sessions') is null
    or to_regclass('public.net_identity_os_assignments') is null
    or to_regclass('public.net_os_families') is null
  then
    raise exception 'NET_GM_OS_FOUNDATION_REQUIRED';
  end if;
end;
$$;

alter table public.net_gm_persona_sessions
  drop constraint if exists net_gm_persona_sessions_mode_check;
alter table public.net_gm_persona_sessions
  add constraint net_gm_persona_sessions_mode_check
  check (mode in ('none', 'inspect', 'gm-persona', 'take-control', 'compromised-session'));

alter table public.net_gm_persona_sessions
  drop constraint if exists net_gm_persona_sessions_subject_shape;
alter table public.net_gm_persona_sessions
  add constraint net_gm_persona_sessions_subject_shape check (
    (mode = 'none' and subject_kind is null and subject_id is null)
    or
    (
      mode in ('inspect', 'gm-persona', 'take-control', 'compromised-session')
      and subject_kind in ('profile-sheet', 'npc-card')
      and subject_id is not null
    )
  );

comment on column public.net_gm_persona_sessions.mode is
  'none is GM system; inspect and gm-persona do not affect OS routing; take-control routes through the playable target authoritative OS without fabricating app ownership; compromised-session remains separately limited to audited PULSE actions.';

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
    raise exception 'Only an authenticated GM may select a GM persona.'
      using errcode = '42501';
  end if;

  if requested_subject_id is null
    or requested_subject_kind is null
    or requested_subject_kind not in ('profile-sheet', 'npc-card')
    or requested_mode is null
    or requested_mode not in ('inspect', 'gm-persona', 'take-control', 'compromised-session')
  then
    raise exception 'Unsupported GM persona request.' using errcode = '22023';
  end if;

  select *
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

  if requested_mode in ('take-control', 'compromised-session') then
    if target_link.id is null
      or target_link.identity_kind <> 'player'
      or target_link.playability <> 'playable'
    then
      raise exception 'TAKE CONTROL and compromised sessions require an authoritative playable player identity.'
        using errcode = '42501';
    end if;
  elsif requested_mode = 'gm-persona' then
    if requested_subject_kind <> 'npc-card'
      or (target_link.id is not null and target_link.identity_kind = 'player')
    then
      raise exception 'GM persona mode is reserved for authorised NPC identities.'
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
  v_identity_link_id uuid;
  v_primary_os_id text;
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

    return jsonb_build_object(
      'actor_mode', 'gm-system',
      'context_mode', 'system',
      'identity_link_id', null,
      'primary_os_id', null
    );
  end if;

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
