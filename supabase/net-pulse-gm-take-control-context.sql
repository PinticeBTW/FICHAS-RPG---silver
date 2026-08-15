-- Bind PULSE to the same authoritative playable identity mounted by GM TAKE
-- CONTROL without widening the shared player-ownership predicate. This keeps
-- NPC control, GM System, account provisioning, and every non-PULSE product
-- outside the new authority boundary.

begin;

do $$
begin
  if to_regclass('public.profiles') is null
    or to_regclass('public.net_active_identities') is null
    or to_regclass('public.net_gm_persona_sessions') is null
    or to_regclass('public.net_identity_links') is null
    or to_regclass('public.net_identity_app_installs') is null
    or to_regclass('public.net_app_accounts') is null
    or to_regclass('public.net_pulse_posts') is null
    or to_regclass('public.net_pulse_profiles') is null
    or to_regclass('public.net_action_audit') is null
    or to_regprocedure('public.is_current_user_gm()') is null
    or to_regprocedure('public.current_user_controls_playable_net_identity_link(uuid)') is null
    or to_regprocedure('public.net_identity_link_can_access_service(uuid,text)') is null
    or to_regprocedure('public.assert_net_identity_service_access(uuid,text)') is null
    or to_regprocedure('public.current_net_pulse_owner_account_id()') is null
    or to_regprocedure('public.assert_net_pulse_account_context(uuid,boolean)') is null
    or to_regprocedure('public.create_net_pulse_post(uuid,text,uuid)') is null
    or to_regprocedure('public.update_net_pulse_public_profile(uuid,text,text,text,boolean,boolean,text)') is null
    or to_regprocedure('public.delete_net_pulse_post(uuid)') is null
  then
    raise exception 'PULSE_GM_CONTROL_DEPENDENCY_REQUIRED' using errcode = '55000';
  end if;
end;
$$;

-- PULSE-only effective viewer/actor. Normal players retain the deployed
-- active-identity ownership path. A GM branch exists only for the exact
-- take-control session target and only when that target remains a playable
-- player with VEIL PULSE capability and a current PULSE installation.
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
      and identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
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

-- Comparison-only request guard. The authoritative active/control row and the
-- exact target installation are locked for the transaction so a switch or
-- uninstall fails closed instead of rebinding a request. The immutable account
-- UUID is comparison-bound below; mutation workers retain their own row locks.
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
        and identity_link.identity_kind = 'player'
        and identity_link.playability = 'playable'
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

-- The shared audit table deliberately does not have a take-control enum value.
-- Reuse the established project representation from ALTARA BANK: gm-persona
-- plus an explicit authoritative-gm-take-control-player basis and exact
-- persona subject. This preserves the deployed CHECK and every audit reader.
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
      'authoritative-gm-take-control-player'::text,
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
      and identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
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

-- Engagement workers also write PULSE audit rows after their public wrappers
-- acquire the same guard. Normalize only those legacy owner-labelled PULSE
-- inserts when the authenticated actor is an authoritative GM TAKE CONTROL
-- session. Compromised-session and every non-PULSE audit remain untouched.
create or replace function public.bind_net_pulse_take_control_audit()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_context record;
begin
  if new.action_mode <> 'owner'
    or new.presented_account_id is null
    or new.action_type not like 'pulse.%'
    or new.authorization_basis not in (
      'controlled-playable-identity',
      'controlled-playable-identity-within-delete-window'
    )
    or not public.is_current_user_gm()
  then
    return new;
  end if;

  select context.*
  into v_context
  from public.net_pulse_action_audit_context(new.presented_account_id) as context;

  new.action_mode := v_context.action_mode;
  new.authorization_basis := v_context.authorization_basis;
  new.persona_subject_kind := v_context.persona_subject_kind;
  new.persona_subject_id := v_context.persona_subject_id;
  return new;
end;
$$;

drop trigger if exists net_action_audit_bind_pulse_take_control
  on public.net_action_audit;
create trigger net_action_audit_bind_pulse_take_control
before insert on public.net_action_audit
for each row execute procedure public.bind_net_pulse_take_control_audit();

-- The legacy worker remains internal. Its only authority change is to consume
-- the PULSE-specific effective account above instead of the global ownership
-- predicate; all validation, immutable author UUIDs, and audit rows remain.
create or replace function public.create_net_pulse_post(
  requested_author_account_id uuid,
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
  author_account public.net_app_accounts%rowtype;
  parent_post public.net_pulse_posts%rowtype;
  normalized_body text := btrim(coalesce(requested_body, ''));
  saved_post public.net_pulse_posts%rowtype;
  v_audit_context record;
begin
  if actor_profile_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if requested_author_account_id is null then
    raise exception 'A PULSE author account is required.' using errcode = '22023';
  end if;

  select pulse_account.*
  into author_account
  from public.net_app_accounts as pulse_account
  where pulse_account.id = requested_author_account_id;

  if not found
    or author_account.app_id <> 'pulse'
    or author_account.identity_link_id is null
  then
    raise exception 'The requested account cannot author PULSE content.' using errcode = '42501';
  end if;
  if author_account.status <> 'active' then
    raise exception 'Only an active PULSE account may author content.' using errcode = '42501';
  end if;
  select context.*
  into v_audit_context
  from public.net_pulse_action_audit_context(author_account.id) as context;
  if normalized_body = '' then
    raise exception 'PULSE content cannot be empty.' using errcode = '22023';
  end if;
  if char_length(normalized_body) > 360 then
    raise exception 'PULSE content is limited to 360 characters.' using errcode = '22001';
  end if;

  if requested_parent_post_id is not null then
    select post.*
    into parent_post
    from public.net_pulse_posts as post
    where post.id = requested_parent_post_id;
    if not found then
      raise exception 'The requested parent PULSE does not exist.' using errcode = '23503';
    end if;
  end if;

  insert into public.net_pulse_posts (author_account_id, parent_post_id, body)
  values (author_account.id, requested_parent_post_id, normalized_body)
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
  ) values (
    actor_profile_id,
    author_account.id,
    v_audit_context.persona_subject_kind,
    v_audit_context.persona_subject_id,
    v_audit_context.action_mode,
    case when requested_parent_post_id is null
      then 'pulse.post.create'
      else 'pulse.reply.create'
    end,
    v_audit_context.authorization_basis,
    'pulse-post',
    saved_post.id
  );

  return saved_post;
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
  v_audit_context record;
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
  then
    raise exception 'The authenticated actor cannot manage this PULSE profile.' using errcode = '42501';
  end if;
  if v_target_pulse_account.status <> 'active' then
    raise exception 'Only an active PULSE account may edit its profile.' using errcode = '42501';
  end if;

  select context.*
  into v_audit_context
  from public.net_pulse_action_audit_context(v_target_pulse_account.id) as context;
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
    persona_subject_kind,
    persona_subject_id,
    action_mode,
    action_type,
    authorization_basis,
    resource_type,
    resource_id
  ) values (
    v_authenticated_actor_id,
    v_target_pulse_account.id,
    v_audit_context.persona_subject_kind,
    v_audit_context.persona_subject_id,
    v_audit_context.action_mode,
    'pulse.profile.update',
    v_audit_context.authorization_basis,
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

create or replace function public.delete_net_pulse_post(
  requested_post_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_profile_id uuid := auth.uid();
  target_post public.net_pulse_posts%rowtype;
  author_account public.net_app_accounts%rowtype;
  v_audit_context record;
begin
  if actor_profile_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select post.*
  into target_post
  from public.net_pulse_posts as post
  where post.id = requested_post_id
  for update;

  if not found or target_post.deleted_at is not null then
    raise exception 'The requested PULSE is not available.' using errcode = 'P0002';
  end if;

  select pulse_account.*
  into author_account
  from public.net_app_accounts as pulse_account
  where pulse_account.id = target_post.author_account_id;

  if not found
    or author_account.app_id <> 'pulse'
    or author_account.identity_link_id is null
  then
    raise exception 'Only the controlling player may delete this PULSE.' using errcode = '42501';
  end if;

  select context.*
  into v_audit_context
  from public.net_pulse_action_audit_context(author_account.id) as context;

  if now() > target_post.created_at + interval '10 minutes' then
    raise exception 'The 10-minute deletion window has closed.' using errcode = '42501';
  end if;

  update public.net_pulse_posts
  set deleted_at = now()
  where id = target_post.id;

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
    actor_profile_id,
    author_account.id,
    v_audit_context.persona_subject_kind,
    v_audit_context.persona_subject_id,
    v_audit_context.action_mode,
    case when target_post.parent_post_id is null
      then 'pulse.post.delete'
      else 'pulse.reply.delete'
    end,
    case when v_audit_context.action_mode = 'owner'
      then 'controlled-playable-identity-within-delete-window'
      else v_audit_context.authorization_basis
    end,
    'pulse-post',
    target_post.id
  );

  return target_post.id;
end;
$$;

-- Internal comparison and legacy worker functions remain unreachable from the
-- client. Existing bounded public RPC grants are preserved unchanged.
revoke all on function public.current_net_pulse_owner_account_id()
  from public, anon, authenticated;
revoke all on function public.assert_net_pulse_account_context(uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.net_pulse_action_audit_context(uuid)
  from public, anon, authenticated;
revoke all on function public.bind_net_pulse_take_control_audit()
  from public, anon, authenticated;
revoke all on function public.create_net_pulse_post(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.update_net_pulse_public_profile(uuid, text, text, text, boolean, boolean, text)
  from public, anon, authenticated;
revoke all on function public.delete_net_pulse_post(uuid)
  from public, anon, authenticated;

commit;
