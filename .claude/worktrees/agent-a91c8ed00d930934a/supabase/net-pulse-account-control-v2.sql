-- Atomic PULSE public-identity control, compromised mutations, and realtime.
-- Run after supabase/net-compromised-session.sql and
-- supabase/net-pulse-profile-management.sql.

-- A single public revision row is an RLS-safe invalidation signal. It avoids
-- exposing soft-deleted post bodies merely to make their deletion observable
-- through Realtime.
create table if not exists public.net_pulse_realtime_state (
  channel text primary key check (channel = 'public'),
  revision bigint not null default 0,
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.net_pulse_realtime_state (channel)
values ('public')
on conflict (channel) do nothing;

alter table public.net_pulse_realtime_state enable row level security;

drop policy if exists net_pulse_realtime_state_select_authenticated
  on public.net_pulse_realtime_state;
create policy net_pulse_realtime_state_select_authenticated
on public.net_pulse_realtime_state
for select
to authenticated
using (true);

revoke all on public.net_pulse_realtime_state from anon;
revoke insert, update, delete on public.net_pulse_realtime_state from authenticated;
grant select on public.net_pulse_realtime_state to authenticated;

create or replace function public.signal_net_pulse_realtime_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'net_app_accounts' then
    if tg_op = 'DELETE' then
      if old.app_id <> 'pulse' then return null; end if;
    else
      if new.app_id <> 'pulse' then return null; end if;
    end if;
  end if;

  insert into public.net_pulse_realtime_state (channel, revision, updated_at)
  values ('public', 1, timezone('utc', now()))
  on conflict (channel) do update set
    revision = public.net_pulse_realtime_state.revision + 1,
    updated_at = excluded.updated_at;

  return null;
end;
$$;

drop trigger if exists net_pulse_posts_signal_realtime on public.net_pulse_posts;
create trigger net_pulse_posts_signal_realtime
after insert or update or delete on public.net_pulse_posts
for each row execute procedure public.signal_net_pulse_realtime_change();

drop trigger if exists net_pulse_profiles_signal_realtime on public.net_pulse_profiles;
create trigger net_pulse_profiles_signal_realtime
after insert or update or delete on public.net_pulse_profiles
for each row execute procedure public.signal_net_pulse_realtime_change();

drop trigger if exists net_app_accounts_signal_pulse_realtime on public.net_app_accounts;
create trigger net_app_accounts_signal_pulse_realtime
after insert or update or delete on public.net_app_accounts
for each row execute procedure public.signal_net_pulse_realtime_change();

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
  actor_id uuid := auth.uid();
  persona_session public.net_gm_persona_sessions%rowtype;
  target_link public.net_identity_links%rowtype;
  target_account public.net_app_accounts%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if not public.is_current_user_gm() then
    raise exception 'Only an authoritative GM may use a compromised session.' using errcode = '42501';
  end if;

  select * into persona_session
  from public.net_gm_persona_sessions
  where gm_profile_id = actor_id
    and mode = 'compromised-session'
  for share;

  if not found then
    raise exception 'A current compromised persona session is required.' using errcode = '42501';
  end if;

  select * into target_link
  from public.net_identity_links
  where subject_kind = persona_session.subject_kind
    and subject_id = persona_session.subject_id
    and identity_kind = 'player'
    and playability = 'playable';

  if not found then
    raise exception 'The compromised player identity is no longer available.' using errcode = '42501';
  end if;

  if target_link.subject_kind = 'profile-sheet' then
    if not exists (
      select 1 from public.profiles
      where id = target_link.subject_id and role = 'player'
    ) then
      raise exception 'The compromised player profile is no longer available.' using errcode = '42501';
    end if;
  elsif target_link.subject_kind = 'npc-card' then
    if not exists (
      select 1 from public.npc_cards where id = target_link.subject_id
    ) then
      raise exception 'The compromised player sheet is no longer available.' using errcode = '42501';
    end if;
  else
    raise exception 'This compromised player source is not supported.' using errcode = '42501';
  end if;

  select * into target_account
  from public.net_app_accounts
  where identity_link_id = target_link.id
    and app_id = 'pulse'
  for share;

  if not found then
    raise exception 'TARGET_HAS_NO_PULSE_ACCOUNT' using errcode = 'P0001';
  end if;
  if target_account.status <> 'active' then
    raise exception 'TARGET_PULSE_ACCOUNT_RESTRICTED' using errcode = '42501';
  end if;

  return query select
    actor_id,
    persona_session.subject_kind,
    persona_session.subject_id,
    target_link.id,
    target_account.id;
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
  actor_id uuid := auth.uid();
  account public.net_app_accounts%rowtype;
  normalized_handle text := public.normalize_net_app_handle(requested_handle);
  normalized_bio text := nullif(btrim(coalesce(requested_bio, '')), '');
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select * into account
  from public.net_app_accounts as candidate
  where candidate.id = requested_account_id
  for update;

  if not found
    or account.app_id <> 'pulse'
    or account.identity_link_id is null
    or not public.current_user_controls_playable_net_identity_link(account.identity_link_id)
  then
    raise exception 'The authenticated actor cannot manage this PULSE profile.' using errcode = '42501';
  end if;
  if account.status <> 'active' then
    raise exception 'Only an active PULSE account may edit its profile.' using errcode = '42501';
  end if;
  if normalized_handle is null then
    raise exception 'PULSE_HANDLE_INVALID' using errcode = '22023';
  end if;
  if normalized_bio is not null and char_length(normalized_bio) > 240 then
    raise exception 'PULSE bios are limited to 240 characters.' using errcode = '22001';
  end if;
  if requested_visibility is null or requested_visibility not in ('public', 'limited') then
    raise exception 'PULSE profile visibility is invalid.' using errcode = '22023';
  end if;
  if requested_default_feed is null or requested_default_feed not in ('city', 'following', 'raw') then
    raise exception 'PULSE default feed is invalid.' using errcode = '22023';
  end if;

  begin
    update public.net_app_accounts as target
    set handle = normalized_handle
    where target.id = account.id;
  exception
    when unique_violation then
      raise exception 'PULSE_HANDLE_TAKEN' using errcode = '23505';
  end;

  insert into public.net_pulse_profiles (
    account_id, bio, visibility, show_district, discoverable, default_feed
  ) values (
    account.id,
    normalized_bio,
    requested_visibility,
    coalesce(requested_show_district, false),
    coalesce(requested_discoverable, true),
    requested_default_feed
  )
  on conflict (account_id) do update set
    bio = excluded.bio,
    visibility = excluded.visibility,
    show_district = excluded.show_district,
    discoverable = excluded.discoverable,
    default_feed = excluded.default_feed;

  insert into public.net_action_audit (
    authenticated_actor_profile_id,
    presented_account_id,
    action_mode,
    action_type,
    authorization_basis,
    resource_type,
    resource_id
  ) values (
    actor_id,
    account.id,
    'owner',
    'pulse.profile.update',
    'controlled-playable-identity',
    'pulse-profile',
    account.id
  );

  return query
  select
    pulse_account.id,
    pulse_account.handle,
    profile.bio,
    profile.visibility,
    profile.show_district,
    profile.discoverable,
    profile.default_feed,
    profile.created_at,
    profile.updated_at
  from public.net_app_accounts as pulse_account
  join public.net_pulse_profiles as profile on profile.account_id = pulse_account.id
  where pulse_account.id = account.id;
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
  compromised record;
  normalized_handle text := public.normalize_net_app_handle(requested_handle);
  normalized_bio text := nullif(btrim(coalesce(requested_bio, '')), '');
begin
  select * into compromised
  from public.resolve_current_compromised_pulse_context();

  if normalized_handle is null then
    raise exception 'PULSE_HANDLE_INVALID' using errcode = '22023';
  end if;
  if normalized_bio is not null and char_length(normalized_bio) > 240 then
    raise exception 'PULSE bios are limited to 240 characters.' using errcode = '22001';
  end if;
  if requested_visibility is null or requested_visibility not in ('public', 'limited') then
    raise exception 'PULSE profile visibility is invalid.' using errcode = '22023';
  end if;
  if requested_default_feed is null or requested_default_feed not in ('city', 'following', 'raw') then
    raise exception 'PULSE default feed is invalid.' using errcode = '22023';
  end if;

  begin
    update public.net_app_accounts as target
    set handle = normalized_handle
    where target.id = compromised.pulse_account_id;
  exception
    when unique_violation then
      raise exception 'PULSE_HANDLE_TAKEN' using errcode = '23505';
  end;

  insert into public.net_pulse_profiles (
    account_id, bio, visibility, show_district, discoverable, default_feed
  ) values (
    compromised.pulse_account_id,
    normalized_bio,
    requested_visibility,
    coalesce(requested_show_district, false),
    coalesce(requested_discoverable, true),
    requested_default_feed
  )
  on conflict (account_id) do update set
    bio = excluded.bio,
    visibility = excluded.visibility,
    show_district = excluded.show_district,
    discoverable = excluded.discoverable,
    default_feed = excluded.default_feed;

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
    compromised.actor_profile_id,
    compromised.pulse_account_id,
    compromised.persona_subject_kind,
    compromised.persona_subject_id,
    'compromised-session',
    'pulse.profile.update',
    'gm-compromised-session',
    'pulse-profile',
    compromised.pulse_account_id
  );

  return query
  select
    pulse_account.id,
    pulse_account.handle,
    profile.bio,
    profile.visibility,
    profile.show_district,
    profile.discoverable,
    profile.default_feed,
    profile.created_at,
    profile.updated_at
  from public.net_app_accounts as pulse_account
  join public.net_pulse_profiles as profile on profile.account_id = pulse_account.id
  where pulse_account.id = compromised.pulse_account_id;
end;
$$;

create or replace function public.delete_net_pulse_post_as_compromised_persona(
  requested_post_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  compromised record;
  target_post public.net_pulse_posts%rowtype;
begin
  select * into compromised
  from public.resolve_current_compromised_pulse_context();

  select * into target_post
  from public.net_pulse_posts as candidate
  where candidate.id = requested_post_id
  for update;

  if not found or target_post.deleted_at is not null then
    raise exception 'The requested PULSE is not available.' using errcode = 'P0002';
  end if;
  if target_post.author_account_id <> compromised.pulse_account_id then
    raise exception 'The compromised session cannot delete another PULSE account''s content.' using errcode = '42501';
  end if;

  update public.net_pulse_posts as target
  set deleted_at = now()
  where target.id = target_post.id;

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
    compromised.actor_profile_id,
    compromised.pulse_account_id,
    compromised.persona_subject_kind,
    compromised.persona_subject_id,
    'compromised-session',
    case when target_post.parent_post_id is null
      then 'pulse.post.delete'
      else 'pulse.reply.delete'
    end,
    'gm-compromised-session',
    'pulse-post',
    target_post.id
  );

  return target_post.id;
end;
$$;

-- The audited public-profile RPC supersedes the unaudited owner-only profile
-- writer. First-launch provisioning can still call it internally as owner.
revoke execute on function public.upsert_net_pulse_profile(uuid, text, text, boolean, boolean, text) from authenticated;

revoke all on function public.resolve_current_compromised_pulse_context() from public;
revoke all on function public.signal_net_pulse_realtime_change() from public;
revoke all on function public.update_net_pulse_public_profile(uuid, text, text, text, boolean, boolean, text) from public;
revoke all on function public.update_net_pulse_profile_as_compromised_persona(text, text, text, boolean, boolean, text) from public;
revoke all on function public.delete_net_pulse_post_as_compromised_persona(uuid) from public;
grant execute on function public.update_net_pulse_public_profile(uuid, text, text, text, boolean, boolean, text) to authenticated;
grant execute on function public.update_net_pulse_profile_as_compromised_persona(text, text, text, boolean, boolean, text) to authenticated;
grant execute on function public.delete_net_pulse_post_as_compromised_persona(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'net_pulse_posts'
  ) then
    alter publication supabase_realtime add table public.net_pulse_posts;
  end if;
exception when duplicate_object then null;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'net_pulse_realtime_state'
  ) then
    alter publication supabase_realtime add table public.net_pulse_realtime_state;
  end if;
exception when duplicate_object then null;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'net_pulse_profiles'
  ) then
    alter publication supabase_realtime add table public.net_pulse_profiles;
  end if;
exception when duplicate_object then null;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'net_app_accounts'
  ) then
    alter publication supabase_realtime add table public.net_app_accounts;
  end if;
exception when duplicate_object then null;
end $$;
