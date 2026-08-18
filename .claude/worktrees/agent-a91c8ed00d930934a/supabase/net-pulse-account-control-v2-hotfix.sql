-- Focused ambiguity hotfix for deployed PULSE Account Control V2 functions.
-- Run after supabase/net-pulse-account-control-v2.sql.

create or replace function public.resolve_current_compromised_pulse_context()
returns table (
  actor_profile_id uuid,
  persona_subject_kind text,
  persona_subject_id uuid,
  identity_link_id uuid,
  pulse_account_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_authenticated_actor_id uuid := auth.uid();
  v_persona_session public.net_gm_persona_sessions%rowtype;
  v_target_identity_link public.net_identity_links%rowtype;
  v_target_pulse_account public.net_app_accounts%rowtype;
begin
  if v_authenticated_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if not public.is_current_user_gm() then
    raise exception 'Only an authoritative GM may use a compromised session.' using errcode = '42501';
  end if;

  select persona.*
  into v_persona_session
  from public.net_gm_persona_sessions as persona
  where persona.gm_profile_id = v_authenticated_actor_id
    and persona.mode = 'compromised-session'
  for share;

  if not found then
    raise exception 'A current compromised persona session is required.' using errcode = '42501';
  end if;

  select identity_link.*
  into v_target_identity_link
  from public.net_identity_links as identity_link
  where identity_link.subject_kind = v_persona_session.subject_kind
    and identity_link.subject_id = v_persona_session.subject_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable';

  if not found then
    raise exception 'The compromised player identity is no longer available.' using errcode = '42501';
  end if;

  if v_target_identity_link.subject_kind = 'profile-sheet' then
    if not exists (
      select 1
      from public.profiles as target_profile
      where target_profile.id = v_target_identity_link.subject_id
        and target_profile.role = 'player'
    ) then
      raise exception 'The compromised player profile is no longer available.' using errcode = '42501';
    end if;
  elsif v_target_identity_link.subject_kind = 'npc-card' then
    if not exists (
      select 1
      from public.npc_cards as target_card
      where target_card.id = v_target_identity_link.subject_id
    ) then
      raise exception 'The compromised player sheet is no longer available.' using errcode = '42501';
    end if;
  else
    raise exception 'This compromised player source is not supported.' using errcode = '42501';
  end if;

  select pulse_account.*
  into v_target_pulse_account
  from public.net_app_accounts as pulse_account
  where pulse_account.identity_link_id = v_target_identity_link.id
    and pulse_account.app_id = 'pulse'
  for share;

  if not found then
    raise exception 'TARGET_HAS_NO_PULSE_ACCOUNT' using errcode = 'P0001';
  end if;
  if v_target_pulse_account.status <> 'active' then
    raise exception 'TARGET_PULSE_ACCOUNT_RESTRICTED' using errcode = '42501';
  end if;

  return query
  select
    v_authenticated_actor_id,
    v_persona_session.subject_kind,
    v_persona_session.subject_id,
    v_target_identity_link.id,
    v_target_pulse_account.id;
end;
$$;

create or replace function public.update_net_pulse_public_profile(
  requested_account_id uuid,
  requested_handle text,
  requested_bio text,
  requested_visibility text,
  requested_show_district boolean,
  requested_discoverable boolean,
  requested_default_feed text
)
returns table (
  account_id uuid,
  handle text,
  bio text,
  visibility text,
  show_district boolean,
  discoverable boolean,
  default_feed text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_authenticated_actor_id uuid := auth.uid();
  v_target_pulse_account public.net_app_accounts%rowtype;
  v_normalized_handle text := public.normalize_net_app_handle(requested_handle);
  v_normalized_bio text := nullif(btrim(coalesce(requested_bio, '')), '');
begin
  if v_authenticated_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select pulse_account.*
  into v_target_pulse_account
  from public.net_app_accounts as pulse_account
  where pulse_account.id = requested_account_id
  for update;

  if not found
    or v_target_pulse_account.app_id <> 'pulse'
    or v_target_pulse_account.identity_link_id is null
    or not public.current_user_controls_playable_net_identity_link(
      v_target_pulse_account.identity_link_id
    )
  then
    raise exception 'The authenticated actor cannot manage this PULSE profile.' using errcode = '42501';
  end if;
  if v_target_pulse_account.status <> 'active' then
    raise exception 'Only an active PULSE account may edit its profile.' using errcode = '42501';
  end if;
  if v_normalized_handle is null then
    raise exception 'PULSE_HANDLE_INVALID' using errcode = '22023';
  end if;
  if v_normalized_bio is not null and char_length(v_normalized_bio) > 240 then
    raise exception 'PULSE bios are limited to 240 characters.' using errcode = '22001';
  end if;
  if requested_visibility is null or requested_visibility not in ('public', 'limited') then
    raise exception 'PULSE profile visibility is invalid.' using errcode = '22023';
  end if;
  if requested_default_feed is null or requested_default_feed not in ('city', 'following', 'raw') then
    raise exception 'PULSE default feed is invalid.' using errcode = '22023';
  end if;

  begin
    update public.net_app_accounts as pulse_account
    set handle = v_normalized_handle
    where pulse_account.id = v_target_pulse_account.id;
  exception
    when unique_violation then
      raise exception 'PULSE_HANDLE_TAKEN' using errcode = '23505';
  end;

  insert into public.net_pulse_profiles as pulse_profile (
    account_id,
    bio,
    visibility,
    show_district,
    discoverable,
    default_feed
  ) values (
    v_target_pulse_account.id,
    v_normalized_bio,
    requested_visibility,
    coalesce(requested_show_district, false),
    coalesce(requested_discoverable, true),
    requested_default_feed
  )
  on conflict on constraint net_pulse_profiles_pkey do update set
    bio = excluded.bio,
    visibility = excluded.visibility,
    show_district = excluded.show_district,
    discoverable = excluded.discoverable,
    default_feed = excluded.default_feed;

  insert into public.net_action_audit as audit (
    authenticated_actor_profile_id,
    presented_account_id,
    action_mode,
    action_type,
    authorization_basis,
    resource_type,
    resource_id
  ) values (
    v_authenticated_actor_id,
    v_target_pulse_account.id,
    'owner',
    'pulse.profile.update',
    'controlled-playable-identity',
    'pulse-profile',
    v_target_pulse_account.id
  );

  return query
  select
    pulse_account.id,
    pulse_account.handle,
    pulse_profile.bio,
    pulse_profile.visibility,
    pulse_profile.show_district,
    pulse_profile.discoverable,
    pulse_profile.default_feed,
    pulse_profile.created_at,
    pulse_profile.updated_at
  from public.net_app_accounts as pulse_account
  join public.net_pulse_profiles as pulse_profile
    on pulse_profile.account_id = pulse_account.id
  where pulse_account.id = v_target_pulse_account.id;
end;
$$;

create or replace function public.update_net_pulse_profile_as_compromised_persona(
  requested_handle text,
  requested_bio text,
  requested_visibility text,
  requested_show_district boolean,
  requested_discoverable boolean,
  requested_default_feed text
)
returns table (
  account_id uuid,
  handle text,
  bio text,
  visibility text,
  show_district boolean,
  discoverable boolean,
  default_feed text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_compromised_context record;
  v_normalized_handle text := public.normalize_net_app_handle(requested_handle);
  v_normalized_bio text := nullif(btrim(coalesce(requested_bio, '')), '');
begin
  select compromised_context.*
  into v_compromised_context
  from public.resolve_current_compromised_pulse_context() as compromised_context;

  if v_normalized_handle is null then
    raise exception 'PULSE_HANDLE_INVALID' using errcode = '22023';
  end if;
  if v_normalized_bio is not null and char_length(v_normalized_bio) > 240 then
    raise exception 'PULSE bios are limited to 240 characters.' using errcode = '22001';
  end if;
  if requested_visibility is null or requested_visibility not in ('public', 'limited') then
    raise exception 'PULSE profile visibility is invalid.' using errcode = '22023';
  end if;
  if requested_default_feed is null or requested_default_feed not in ('city', 'following', 'raw') then
    raise exception 'PULSE default feed is invalid.' using errcode = '22023';
  end if;

  begin
    update public.net_app_accounts as pulse_account
    set handle = v_normalized_handle
    where pulse_account.id = v_compromised_context.pulse_account_id;
  exception
    when unique_violation then
      raise exception 'PULSE_HANDLE_TAKEN' using errcode = '23505';
  end;

  insert into public.net_pulse_profiles as pulse_profile (
    account_id,
    bio,
    visibility,
    show_district,
    discoverable,
    default_feed
  ) values (
    v_compromised_context.pulse_account_id,
    v_normalized_bio,
    requested_visibility,
    coalesce(requested_show_district, false),
    coalesce(requested_discoverable, true),
    requested_default_feed
  )
  on conflict on constraint net_pulse_profiles_pkey do update set
    bio = excluded.bio,
    visibility = excluded.visibility,
    show_district = excluded.show_district,
    discoverable = excluded.discoverable,
    default_feed = excluded.default_feed;

  insert into public.net_action_audit as audit (
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
    v_compromised_context.actor_profile_id,
    v_compromised_context.pulse_account_id,
    v_compromised_context.persona_subject_kind,
    v_compromised_context.persona_subject_id,
    'compromised-session',
    'pulse.profile.update',
    'gm-compromised-session',
    'pulse-profile',
    v_compromised_context.pulse_account_id
  );

  return query
  select
    pulse_account.id,
    pulse_account.handle,
    pulse_profile.bio,
    pulse_profile.visibility,
    pulse_profile.show_district,
    pulse_profile.discoverable,
    pulse_profile.default_feed,
    pulse_profile.created_at,
    pulse_profile.updated_at
  from public.net_app_accounts as pulse_account
  join public.net_pulse_profiles as pulse_profile
    on pulse_profile.account_id = pulse_account.id
  where pulse_account.id = v_compromised_context.pulse_account_id;
end;
$$;

revoke all on function public.resolve_current_compromised_pulse_context() from public;
revoke all on function public.update_net_pulse_public_profile(uuid, text, text, text, boolean, boolean, text) from public;
revoke all on function public.update_net_pulse_profile_as_compromised_persona(text, text, text, boolean, boolean, text) from public;
grant execute on function public.update_net_pulse_public_profile(uuid, text, text, text, boolean, boolean, text) to authenticated;
grant execute on function public.update_net_pulse_profile_as_compromised_persona(text, text, text, boolean, boolean, text) to authenticated;
