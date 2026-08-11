-- PULSE public profiles and time-limited, audited owner deletion.
-- Run after supabase/net-app-accounts.sql, supabase/net-pulse-content.sql,
-- and supabase/net-compromised-session.sql.

create table if not exists public.net_pulse_profiles (
  account_id uuid primary key references public.net_app_accounts (id) on delete cascade,
  bio text,
  visibility text not null default 'public'
    check (visibility in ('public', 'limited')),
  show_district boolean not null default false,
  discoverable boolean not null default true,
  default_feed text not null default 'city'
    check (default_feed in ('city', 'following', 'raw')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint net_pulse_profiles_bio_length check (
    bio is null or char_length(bio) <= 240
  )
);

comment on table public.net_pulse_profiles is
  'PULSE-owned public presentation and feed preferences. Character and Universal NET presentation remain separate sources.';

drop trigger if exists net_pulse_profiles_set_updated_at on public.net_pulse_profiles;
create trigger net_pulse_profiles_set_updated_at
before update on public.net_pulse_profiles
for each row execute procedure public.set_updated_at();

create or replace function public.validate_net_pulse_profile_account()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.net_app_accounts
    where id = new.account_id and app_id = 'pulse'
  ) then
    raise exception 'PULSE profiles require a PULSE application account.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists net_pulse_profiles_validate_account on public.net_pulse_profiles;
create trigger net_pulse_profiles_validate_account
before insert or update of account_id on public.net_pulse_profiles
for each row execute procedure public.validate_net_pulse_profile_account();

alter table public.net_pulse_profiles enable row level security;

drop policy if exists net_pulse_profiles_select_authenticated on public.net_pulse_profiles;
create policy net_pulse_profiles_select_authenticated
on public.net_pulse_profiles
for select
to authenticated
using (true);

revoke all on public.net_pulse_profiles from anon;
revoke insert, update, delete on public.net_pulse_profiles from authenticated;
grant select on public.net_pulse_profiles to authenticated;

create or replace function public.upsert_net_pulse_profile(
  requested_account_id uuid,
  requested_bio text,
  requested_visibility text,
  requested_show_district boolean,
  requested_discoverable boolean,
  requested_default_feed text
)
returns public.net_pulse_profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  account public.net_app_accounts%rowtype;
  normalized_bio text := nullif(btrim(coalesce(requested_bio, '')), '');
  saved_profile public.net_pulse_profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select * into account
  from public.net_app_accounts
  where id = requested_account_id;

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
  if normalized_bio is not null and char_length(normalized_bio) > 240 then
    raise exception 'PULSE bios are limited to 240 characters.' using errcode = '22001';
  end if;
  if requested_visibility is null or requested_visibility not in ('public', 'limited') then
    raise exception 'PULSE profile visibility is invalid.' using errcode = '22023';
  end if;
  if requested_default_feed is null or requested_default_feed not in ('city', 'following', 'raw') then
    raise exception 'PULSE default feed is invalid.' using errcode = '22023';
  end if;

  insert into public.net_pulse_profiles (
    account_id,
    bio,
    visibility,
    show_district,
    discoverable,
    default_feed
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
    default_feed = excluded.default_feed
  returning * into saved_profile;

  return saved_profile;
end;
$$;

-- PULSE onboarding provisions its explicit account and PULSE-owned profile in
-- one transaction. The existing account RPC remains the single handle and
-- identity-control authority.
create or replace function public.create_net_pulse_account_with_profile(
  requested_identity_link_id uuid,
  requested_handle text,
  requested_bio text,
  requested_visibility text,
  requested_show_district boolean,
  requested_discoverable boolean,
  requested_default_feed text
)
returns public.net_app_accounts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved_account public.net_app_accounts%rowtype;
begin
  select * into saved_account
  from public.create_net_app_account(
    requested_identity_link_id,
    'pulse',
    requested_handle,
    null,
    null
  );

  perform public.upsert_net_pulse_profile(
    saved_account.id,
    requested_bio,
    requested_visibility,
    requested_show_district,
    requested_discoverable,
    requested_default_feed
  );

  return saved_account;
end;
$$;

alter table public.net_pulse_posts
  add column if not exists deleted_at timestamptz;

comment on column public.net_pulse_posts.deleted_at is
  'Authoritative soft-deletion timestamp. Creation audit remains immutable; public feed reads omit deleted subtrees.';

create index if not exists net_pulse_posts_visible_created_idx
  on public.net_pulse_posts (created_at desc)
  where deleted_at is null;

create or replace function public.validate_net_pulse_visible_parent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.parent_post_id is null then
    return new;
  end if;

  if exists (
    with recursive ancestors as (
      select parent.id, parent.parent_post_id, parent.deleted_at
      from public.net_pulse_posts as parent
      where parent.id = new.parent_post_id

      union all

      select parent.id, parent.parent_post_id, parent.deleted_at
      from public.net_pulse_posts as parent
      join ancestors as child on child.parent_post_id = parent.id
    )
    select 1 from ancestors where deleted_at is not null
  ) then
    raise exception 'Replies cannot be added to a deleted PULSE thread.' using errcode = '23503';
  end if;

  return new;
end;
$$;

drop trigger if exists net_pulse_posts_validate_visible_parent on public.net_pulse_posts;
create trigger net_pulse_posts_validate_visible_parent
before insert or update of parent_post_id on public.net_pulse_posts
for each row execute procedure public.validate_net_pulse_visible_parent();

-- A deleted root or reply hides its complete descendant subtree, keeping the
-- thread coherent without deleting authored rows or audit evidence.
create or replace function public.fetch_net_pulse_feed(
  requested_limit integer default 200
)
returns table (
  id uuid,
  author_account_id uuid,
  parent_post_id uuid,
  body text,
  created_at timestamptz,
  updated_at timestamptz,
  author_handle text,
  author_display_name text,
  author_avatar_url text,
  author_status text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  safe_limit integer := least(greatest(coalesce(requested_limit, 200), 1), 500);
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  return query
  with recursive visible_posts as (
    select root.*
    from public.net_pulse_posts as root
    where root.parent_post_id is null
      and root.deleted_at is null

    union all

    select child.*
    from public.net_pulse_posts as child
    join visible_posts as parent on parent.id = child.parent_post_id
    where child.deleted_at is null
  )
  select
    post.id,
    post.author_account_id,
    post.parent_post_id,
    post.body,
    post.created_at,
    post.updated_at,
    account.handle as author_handle,
    coalesce(
      nullif(btrim(account.display_name_override), ''),
      nullif(btrim(universal_profile.display_name_override), ''),
      case identity_link.subject_kind
        when 'profile-sheet' then coalesce(
          nullif(btrim(profile_sheet.field_data ->> 'NOME'), ''),
          nullif(btrim(profile.display_name), '')
        )
        when 'npc-card' then coalesce(
          nullif(btrim(npc_card.field_data ->> 'NOME'), ''),
          nullif(btrim(npc_card.display_name), '')
        )
        when 'character' then coalesce(
          nullif(btrim(campaign_character.alias), ''),
          nullif(btrim(campaign_character.name), '')
        )
      end,
      account.handle
    ) as author_display_name,
    coalesce(
      nullif(btrim(account.avatar_url_override), ''),
      nullif(btrim(universal_profile.avatar_url_override), ''),
      case identity_link.subject_kind
        when 'profile-sheet' then coalesce(
          nullif(btrim(profile_sheet.field_data ->> 'FOTO2'), ''),
          nullif(btrim(profile_sheet.field_data ->> 'FOTO'), '')
        )
        when 'npc-card' then coalesce(
          nullif(btrim(npc_card.field_data ->> 'FOTO2'), ''),
          nullif(btrim(npc_card.field_data ->> 'FOTO'), '')
        )
        when 'character' then nullif(btrim(campaign_character.portrait_url), '')
      end
    ) as author_avatar_url,
    account.status as author_status
  from visible_posts as post
  join public.net_app_accounts as account
    on account.id = post.author_account_id
    and account.app_id = 'pulse'
  left join public.net_identity_links as identity_link
    on identity_link.id = account.identity_link_id
  left join public.net_universal_profiles as universal_profile
    on universal_profile.identity_link_id = identity_link.id
  left join public.profiles as profile
    on identity_link.subject_kind = 'profile-sheet'
    and profile.id = identity_link.subject_id
  left join public.character_sheet_forms as profile_sheet
    on identity_link.subject_kind = 'profile-sheet'
    and profile_sheet.profile_id = identity_link.subject_id
  left join public.npc_cards as npc_card
    on identity_link.subject_kind = 'npc-card'
    and npc_card.id = identity_link.subject_id
  left join public.characters as campaign_character
    on identity_link.subject_kind = 'character'
    and campaign_character.id = identity_link.subject_id
  order by post.created_at desc
  limit safe_limit;
end;
$$;

drop policy if exists net_pulse_posts_select_authenticated on public.net_pulse_posts;
create policy net_pulse_posts_select_authenticated
on public.net_pulse_posts
for select
to authenticated
using (deleted_at is null);

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
begin
  if actor_profile_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select * into target_post
  from public.net_pulse_posts
  where id = requested_post_id
  for update;

  if not found or target_post.deleted_at is not null then
    raise exception 'The requested PULSE is not available.' using errcode = 'P0002';
  end if;

  select * into author_account
  from public.net_app_accounts
  where id = target_post.author_account_id;

  if not found
    or author_account.app_id <> 'pulse'
    or author_account.identity_link_id is null
    or not public.current_user_controls_playable_net_identity_link(author_account.identity_link_id)
  then
    raise exception 'Only the controlling player may delete this PULSE.' using errcode = '42501';
  end if;

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
    null,
    null,
    'owner',
    case when target_post.parent_post_id is null
      then 'pulse.post.delete'
      else 'pulse.reply.delete'
    end,
    'controlled-playable-identity-within-delete-window',
    'pulse-post',
    target_post.id
  );

  return target_post.id;
end;
$$;

revoke all on function public.upsert_net_pulse_profile(uuid, text, text, boolean, boolean, text) from public;
revoke all on function public.create_net_pulse_account_with_profile(uuid, text, text, text, boolean, boolean, text) from public;
revoke all on function public.delete_net_pulse_post(uuid) from public;
grant execute on function public.upsert_net_pulse_profile(uuid, text, text, boolean, boolean, text) to authenticated;
grant execute on function public.create_net_pulse_account_with_profile(uuid, text, text, text, boolean, boolean, text) to authenticated;
grant execute on function public.delete_net_pulse_post(uuid) to authenticated;

revoke all on function public.validate_net_pulse_visible_parent() from public;
revoke all on function public.validate_net_pulse_profile_account() from public;
