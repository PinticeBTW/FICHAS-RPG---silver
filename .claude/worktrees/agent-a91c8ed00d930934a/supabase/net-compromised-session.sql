-- Narrow, audited GM compromise authority for PULSE post/reply creation only.
-- Run after supabase/net-gm-persona.sql and supabase/net-pulse-content.sql.

alter table public.net_gm_persona_sessions
  drop constraint if exists net_gm_persona_sessions_mode_check;
alter table public.net_gm_persona_sessions
  add constraint net_gm_persona_sessions_mode_check
  check (mode in ('none', 'inspect', 'gm-persona', 'compromised-session'));

alter table public.net_gm_persona_sessions
  drop constraint if exists net_gm_persona_sessions_subject_shape;
alter table public.net_gm_persona_sessions
  add constraint net_gm_persona_sessions_subject_shape check (
    (mode = 'none' and subject_kind is null and subject_id is null)
    or
    (
      mode in ('inspect', 'gm-persona', 'compromised-session')
      and subject_kind in ('profile-sheet', 'npc-card')
      and subject_id is not null
    )
  );

comment on column public.net_gm_persona_sessions.mode is
  'none and inspect grant no authoring; gm-persona is NPC context; compromised-session grants only separately implemented, audited actions.';

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
    or requested_mode not in ('inspect', 'gm-persona', 'compromised-session')
  then
    raise exception 'Unsupported GM persona request.' using errcode = '22023';
  end if;

  select *
  into target_link
  from public.net_identity_links
  where subject_kind = requested_subject_kind
    and subject_id = requested_subject_id;

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

  if requested_mode = 'compromised-session' then
    if target_link.id is null
      or target_link.identity_kind <> 'player'
      or target_link.playability <> 'playable'
    then
      raise exception 'Compromised sessions require an authoritative playable player identity.'
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

create or replace function public.create_net_pulse_post_as_compromised_persona(
  requested_body text,
  requested_parent_post_id uuid default null
)
returns public.net_pulse_posts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_profile_id uuid := auth.uid();
  persona_session public.net_gm_persona_sessions%rowtype;
  target_link public.net_identity_links%rowtype;
  author_account public.net_app_accounts%rowtype;
  parent_post public.net_pulse_posts%rowtype;
  normalized_body text := btrim(coalesce(requested_body, ''));
  saved_post public.net_pulse_posts%rowtype;
begin
  if actor_profile_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if not public.is_current_user_gm() then
    raise exception 'Only an authoritative GM may use a compromised session.'
      using errcode = '42501';
  end if;

  select *
  into persona_session
  from public.net_gm_persona_sessions
  where gm_profile_id = actor_profile_id
    and mode = 'compromised-session'
  for update;

  if not found then
    raise exception 'A current compromised persona session is required.'
      using errcode = '42501';
  end if;

  select *
  into target_link
  from public.net_identity_links
  where subject_kind = persona_session.subject_kind
    and subject_id = persona_session.subject_id
    and identity_kind = 'player'
    and playability = 'playable';

  if not found then
    raise exception 'The compromised player identity is no longer available.'
      using errcode = '42501';
  end if;

  if target_link.subject_kind = 'profile-sheet' then
    if not exists (
      select 1 from public.profiles
      where id = target_link.subject_id and role = 'player'
    ) then
      raise exception 'The compromised player profile is no longer available.'
        using errcode = '42501';
    end if;
  elsif target_link.subject_kind = 'npc-card' then
    if not exists (
      select 1 from public.npc_cards where id = target_link.subject_id
    ) then
      raise exception 'The compromised player sheet is no longer available.'
        using errcode = '42501';
    end if;
  else
    raise exception 'This compromised player source is not supported.'
      using errcode = '42501';
  end if;

  select *
  into author_account
  from public.net_app_accounts
  where identity_link_id = target_link.id
    and app_id = 'pulse'
  for share;

  if not found then
    raise exception 'TARGET_HAS_NO_PULSE_ACCOUNT' using errcode = 'P0001';
  end if;

  if author_account.status <> 'active' then
    raise exception 'TARGET_PULSE_ACCOUNT_RESTRICTED' using errcode = '42501';
  end if;

  if normalized_body = '' then
    raise exception 'PULSE content cannot be empty.' using errcode = '22023';
  end if;
  if char_length(normalized_body) > 360 then
    raise exception 'PULSE content is limited to 360 characters.' using errcode = '22001';
  end if;

  if requested_parent_post_id is not null then
    select *
    into parent_post
    from public.net_pulse_posts
    where id = requested_parent_post_id;

    if not found then
      raise exception 'The requested parent PULSE does not exist.' using errcode = '23503';
    end if;
  end if;

  insert into public.net_pulse_posts (
    author_account_id,
    parent_post_id,
    body
  )
  values (
    author_account.id,
    requested_parent_post_id,
    normalized_body
  )
  returning * into saved_post;

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
  values (
    actor_profile_id,
    author_account.id,
    persona_session.subject_kind,
    persona_session.subject_id,
    'compromised-session',
    case when requested_parent_post_id is null
      then 'pulse.post.create'
      else 'pulse.reply.create'
    end,
    'gm-compromised-session',
    'pulse-post',
    saved_post.id
  );

  return saved_post;
end;
$$;

revoke all on function public.set_net_gm_persona(text, uuid, text) from public;
grant execute on function public.set_net_gm_persona(text, uuid, text) to authenticated;

revoke all on function public.create_net_pulse_post_as_compromised_persona(text, uuid) from public;
grant execute on function public.create_net_pulse_post_as_compromised_persona(text, uuid) to authenticated;
