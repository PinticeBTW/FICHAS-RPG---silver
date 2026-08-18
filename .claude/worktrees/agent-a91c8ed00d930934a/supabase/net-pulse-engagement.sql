-- Durable PULSE engagement, public account summaries, and batched viewer state.
-- Run after supabase/net-pulse-account-control-v2-hotfix.sql.

create table if not exists public.net_pulse_reactions (
  post_id uuid not null references public.net_pulse_posts (id) on delete cascade,
  account_id uuid not null references public.net_app_accounts (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (post_id, account_id)
);

create table if not exists public.net_pulse_boosts (
  post_id uuid not null references public.net_pulse_posts (id) on delete cascade,
  account_id uuid not null references public.net_app_accounts (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (post_id, account_id)
);

create table if not exists public.net_pulse_bookmarks (
  post_id uuid not null references public.net_pulse_posts (id) on delete cascade,
  account_id uuid not null references public.net_app_accounts (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (post_id, account_id)
);

create table if not exists public.net_pulse_follows (
  follower_account_id uuid not null references public.net_app_accounts (id) on delete cascade,
  followed_account_id uuid not null references public.net_app_accounts (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (follower_account_id, followed_account_id),
  constraint net_pulse_follows_not_self check (follower_account_id <> followed_account_id)
);

comment on table public.net_pulse_reactions is
  'One binary PULSE reaction per PULSE account and visible post/reply.';
comment on table public.net_pulse_boosts is
  'One boost per PULSE account and top-level Pulse.';
comment on table public.net_pulse_bookmarks is
  'Private saved-content state scoped to a PULSE account.';
comment on table public.net_pulse_follows is
  'Directed social relationships between server-backed PULSE accounts.';

create index if not exists net_pulse_reactions_account_idx
  on public.net_pulse_reactions (account_id, created_at desc);
create index if not exists net_pulse_boosts_account_idx
  on public.net_pulse_boosts (account_id, created_at desc);
create index if not exists net_pulse_boosts_post_created_idx
  on public.net_pulse_boosts (post_id, created_at desc);
create index if not exists net_pulse_bookmarks_account_created_idx
  on public.net_pulse_bookmarks (account_id, created_at desc);
create index if not exists net_pulse_follows_followed_idx
  on public.net_pulse_follows (followed_account_id, created_at desc);

alter table public.net_pulse_reactions enable row level security;
alter table public.net_pulse_boosts enable row level security;
alter table public.net_pulse_bookmarks enable row level security;
alter table public.net_pulse_follows enable row level security;

-- Engagement tables are RPC-mediated. In particular, bookmarks and the social
-- graph are not exposed as raw client-readable tables.
revoke all on public.net_pulse_reactions from anon, authenticated;
revoke all on public.net_pulse_boosts from anon, authenticated;
revoke all on public.net_pulse_bookmarks from anon, authenticated;
revoke all on public.net_pulse_follows from anon, authenticated;

create or replace function public.current_net_pulse_owner_account_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select pulse_account.id
  from public.net_active_identities as active_identity
  join public.net_identity_links as identity_link
    on identity_link.id = active_identity.identity_link_id
  join public.net_app_accounts as pulse_account
    on pulse_account.identity_link_id = identity_link.id
    and pulse_account.app_id = 'pulse'
    and pulse_account.status = 'active'
  where active_identity.profile_id = auth.uid()
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable'
    and public.current_user_controls_playable_net_identity_link(identity_link.id)
  limit 1;
$$;

create or replace function public.net_pulse_post_is_visible(requested_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with recursive ancestors as (
    select post.id, post.parent_post_id, post.deleted_at
    from public.net_pulse_posts as post
    where post.id = requested_post_id

    union all

    select parent.id, parent.parent_post_id, parent.deleted_at
    from public.net_pulse_posts as parent
    join ancestors as child on child.parent_post_id = parent.id
  )
  select exists (select 1 from ancestors)
    and not exists (select 1 from ancestors where deleted_at is not null);
$$;

create or replace function public.set_net_pulse_follow(
  requested_target_account_id uuid,
  requested_following boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_profile_id uuid := auth.uid();
  acting_account_id uuid;
  target_account public.net_app_accounts%rowtype;
  target_profile public.net_pulse_profiles%rowtype;
  changed_rows integer := 0;
begin
  if actor_profile_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if requested_following is null then
    raise exception 'A desired follow state is required.' using errcode = '22023';
  end if;

  acting_account_id := public.current_net_pulse_owner_account_id();
  if acting_account_id is null then
    raise exception 'An active, controlled PULSE account is required.' using errcode = '42501';
  end if;
  if requested_target_account_id is null or requested_target_account_id = acting_account_id then
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
    values (acting_account_id, target_account.id)
    on conflict (follower_account_id, followed_account_id) do nothing;
  else
    delete from public.net_pulse_follows as follow
    where follow.follower_account_id = acting_account_id
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
      acting_account_id,
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
  requested_reacted boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_profile_id uuid := auth.uid();
  acting_account_id uuid;
  target_post public.net_pulse_posts%rowtype;
  changed_rows integer := 0;
begin
  if actor_profile_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if requested_reacted is null then
    raise exception 'A desired reaction state is required.' using errcode = '22023';
  end if;
  acting_account_id := public.current_net_pulse_owner_account_id();
  if acting_account_id is null then
    raise exception 'An active, controlled PULSE account is required.' using errcode = '42501';
  end if;

  select post.* into target_post
  from public.net_pulse_posts as post
  where post.id = requested_post_id and post.deleted_at is null;
  if not found or not public.net_pulse_post_is_visible(target_post.id) then
    raise exception 'The requested PULSE is not available.' using errcode = 'P0002';
  end if;

  if requested_reacted then
    insert into public.net_pulse_reactions (post_id, account_id)
    values (target_post.id, acting_account_id)
    on conflict (post_id, account_id) do nothing;
  else
    delete from public.net_pulse_reactions as reaction
    where reaction.post_id = target_post.id and reaction.account_id = acting_account_id;
  end if;
  get diagnostics changed_rows = row_count;

  if changed_rows > 0 then
    insert into public.net_action_audit (
      authenticated_actor_profile_id, presented_account_id, action_mode,
      action_type, authorization_basis, resource_type, resource_id
    ) values (
      actor_profile_id, acting_account_id, 'owner',
      case when requested_reacted then 'pulse.reaction.add' else 'pulse.reaction.remove' end,
      'controlled-playable-identity', 'pulse-post', target_post.id
    );
  end if;
  return requested_reacted;
end;
$$;

create or replace function public.set_net_pulse_boost(
  requested_post_id uuid,
  requested_boosted boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_profile_id uuid := auth.uid();
  acting_account_id uuid;
  target_post public.net_pulse_posts%rowtype;
  changed_rows integer := 0;
begin
  if actor_profile_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if requested_boosted is null then
    raise exception 'A desired boost state is required.' using errcode = '22023';
  end if;
  acting_account_id := public.current_net_pulse_owner_account_id();
  if acting_account_id is null then
    raise exception 'An active, controlled PULSE account is required.' using errcode = '42501';
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
  if target_post.author_account_id = acting_account_id then
    raise exception 'A PULSE account cannot boost its own Pulse.' using errcode = '22023';
  end if;

  if requested_boosted then
    insert into public.net_pulse_boosts (post_id, account_id)
    values (target_post.id, acting_account_id)
    on conflict (post_id, account_id) do nothing;
  else
    delete from public.net_pulse_boosts as boost
    where boost.post_id = target_post.id and boost.account_id = acting_account_id;
  end if;
  get diagnostics changed_rows = row_count;

  if changed_rows > 0 then
    insert into public.net_action_audit (
      authenticated_actor_profile_id, presented_account_id, action_mode,
      action_type, authorization_basis, resource_type, resource_id
    ) values (
      actor_profile_id, acting_account_id, 'owner',
      case when requested_boosted then 'pulse.boost.add' else 'pulse.boost.remove' end,
      'controlled-playable-identity', 'pulse-post', target_post.id
    );
  end if;
  return requested_boosted;
end;
$$;

create or replace function public.set_net_pulse_bookmark(
  requested_post_id uuid,
  requested_bookmarked boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_profile_id uuid := auth.uid();
  acting_account_id uuid;
  target_post public.net_pulse_posts%rowtype;
  changed_rows integer := 0;
begin
  if actor_profile_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if requested_bookmarked is null then
    raise exception 'A desired bookmark state is required.' using errcode = '22023';
  end if;
  acting_account_id := public.current_net_pulse_owner_account_id();
  if acting_account_id is null then
    raise exception 'An active, controlled PULSE account is required.' using errcode = '42501';
  end if;

  select post.* into target_post
  from public.net_pulse_posts as post
  where post.id = requested_post_id and post.deleted_at is null;
  if not found or not public.net_pulse_post_is_visible(target_post.id) then
    raise exception 'The requested PULSE is not available.' using errcode = 'P0002';
  end if;

  if requested_bookmarked then
    insert into public.net_pulse_bookmarks (post_id, account_id)
    values (target_post.id, acting_account_id)
    on conflict (post_id, account_id) do nothing;
  else
    delete from public.net_pulse_bookmarks as bookmark
    where bookmark.post_id = target_post.id and bookmark.account_id = acting_account_id;
  end if;
  get diagnostics changed_rows = row_count;

  if changed_rows > 0 then
    insert into public.net_action_audit (
      authenticated_actor_profile_id, presented_account_id, action_mode,
      action_type, authorization_basis, resource_type, resource_id
    ) values (
      actor_profile_id, acting_account_id, 'owner',
      case when requested_bookmarked then 'pulse.bookmark.add' else 'pulse.bookmark.remove' end,
      'controlled-playable-identity', 'pulse-post', target_post.id
    );
  end if;
  return requested_bookmarked;
end;
$$;

-- Replaces the existing feed function because PostgreSQL cannot change a
-- function's table-return signature with CREATE OR REPLACE alone.
drop function if exists public.fetch_net_pulse_feed(integer);
create function public.fetch_net_pulse_feed(
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
  author_status text,
  author_bio text,
  author_visibility text,
  author_discoverable boolean,
  author_followers bigint,
  author_following bigint,
  author_pulses bigint,
  viewer_follows_author boolean,
  reply_count bigint,
  reaction_count bigint,
  boost_count bigint,
  viewer_reacted boolean,
  viewer_boosted boolean,
  viewer_bookmarked boolean,
  followed_booster_account_id uuid,
  followed_booster_handle text,
  following_activity_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  safe_limit integer := least(greatest(coalesce(requested_limit, 200), 1), 500);
  viewer_account_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  viewer_account_id := public.current_net_pulse_owner_account_id();

  return query
  with recursive visible_posts as (
    select root.*
    from public.net_pulse_posts as root
    where root.parent_post_id is null and root.deleted_at is null
    union all
    select child.*
    from public.net_pulse_posts as child
    join visible_posts as parent on parent.id = child.parent_post_id
    where child.deleted_at is null
  ),
  reply_counts as (
    select child.parent_post_id as post_id, count(*)::bigint as total
    from visible_posts as child
    where child.parent_post_id is not null
    group by child.parent_post_id
  ),
  reaction_counts as (
    select reaction.post_id, count(*)::bigint as total
    from public.net_pulse_reactions as reaction
    join visible_posts as post on post.id = reaction.post_id
    group by reaction.post_id
  ),
  boost_counts as (
    select boost.post_id, count(*)::bigint as total
    from public.net_pulse_boosts as boost
    join visible_posts as post on post.id = boost.post_id
    group by boost.post_id
  ),
  follower_counts as (
    select follow.followed_account_id as account_id, count(*)::bigint as total
    from public.net_pulse_follows as follow
    group by follow.followed_account_id
  ),
  following_counts as (
    select follow.follower_account_id as account_id, count(*)::bigint as total
    from public.net_pulse_follows as follow
    group by follow.follower_account_id
  ),
  pulse_counts as (
    select post.author_account_id as account_id, count(*)::bigint as total
    from visible_posts as post
    where post.parent_post_id is null
    group by post.author_account_id
  ),
  viewer_follows as (
    select follow.followed_account_id
    from public.net_pulse_follows as follow
    where follow.follower_account_id = viewer_account_id
  ),
  latest_followed_boosts as (
    select distinct on (boost.post_id)
      boost.post_id,
      booster.id as booster_account_id,
      booster.handle as booster_handle,
      boost.created_at as boosted_at
    from public.net_pulse_boosts as boost
    join viewer_follows as followed on followed.followed_account_id = boost.account_id
    join public.net_app_accounts as booster
      on booster.id = boost.account_id
      and booster.app_id = 'pulse'
      and booster.status = 'active'
    order by boost.post_id, boost.created_at desc
  )
  select
    post.id,
    post.author_account_id,
    post.parent_post_id,
    post.body,
    post.created_at,
    post.updated_at,
    account.handle,
    account.handle,
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
    ),
    account.status,
    coalesce(pulse_profile.bio, ''),
    coalesce(pulse_profile.visibility, 'limited'),
    coalesce(pulse_profile.discoverable, false),
    coalesce(follower_count.total, 0),
    coalesce(following_count.total, 0),
    coalesce(pulse_count.total, 0),
    viewer_follow.followed_account_id is not null,
    coalesce(reply_count.total, 0),
    coalesce(reaction_count.total, 0),
    coalesce(boost_count.total, 0),
    viewer_reaction.post_id is not null,
    viewer_boost.post_id is not null,
    viewer_bookmark.post_id is not null,
    latest_boost.booster_account_id,
    latest_boost.booster_handle,
    greatest(post.created_at, coalesce(latest_boost.boosted_at, post.created_at))
  from visible_posts as post
  join public.net_app_accounts as account
    on account.id = post.author_account_id and account.app_id = 'pulse'
  left join public.net_pulse_profiles as pulse_profile on pulse_profile.account_id = account.id
  left join public.net_identity_links as identity_link on identity_link.id = account.identity_link_id
  left join public.net_universal_profiles as universal_profile on universal_profile.identity_link_id = identity_link.id
  left join public.character_sheet_forms as profile_sheet
    on identity_link.subject_kind = 'profile-sheet' and profile_sheet.profile_id = identity_link.subject_id
  left join public.npc_cards as npc_card
    on identity_link.subject_kind = 'npc-card' and npc_card.id = identity_link.subject_id
  left join public.characters as campaign_character
    on identity_link.subject_kind = 'character' and campaign_character.id = identity_link.subject_id
  left join follower_counts as follower_count on follower_count.account_id = account.id
  left join following_counts as following_count on following_count.account_id = account.id
  left join pulse_counts as pulse_count on pulse_count.account_id = account.id
  left join viewer_follows as viewer_follow on viewer_follow.followed_account_id = account.id
  left join reply_counts as reply_count on reply_count.post_id = post.id
  left join reaction_counts as reaction_count on reaction_count.post_id = post.id
  left join boost_counts as boost_count on boost_count.post_id = post.id
  left join public.net_pulse_reactions as viewer_reaction
    on viewer_reaction.post_id = post.id and viewer_reaction.account_id = viewer_account_id
  left join public.net_pulse_boosts as viewer_boost
    on viewer_boost.post_id = post.id and viewer_boost.account_id = viewer_account_id
  left join public.net_pulse_bookmarks as viewer_bookmark
    on viewer_bookmark.post_id = post.id and viewer_bookmark.account_id = viewer_account_id
  left join latest_followed_boosts as latest_boost on latest_boost.post_id = post.id
  order by post.created_at desc
  limit safe_limit;
end;
$$;

create or replace function public.fetch_net_pulse_account_summaries(
  requested_query text default null,
  requested_account_id uuid default null,
  requested_limit integer default 20
)
returns table (
  account_id uuid,
  handle text,
  avatar_url text,
  bio text,
  visibility text,
  discoverable boolean,
  status text,
  followers_count bigint,
  following_count bigint,
  pulses_count bigint,
  viewer_following boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  viewer_account_id uuid;
  normalized_query text := lower(regexp_replace(btrim(coalesce(requested_query, '')), '^@', ''));
  safe_limit integer := least(greatest(coalesce(requested_limit, 20), 1), 50);
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  viewer_account_id := public.current_net_pulse_owner_account_id();

  return query
  with visible_roots as (
    select post.author_account_id
    from public.net_pulse_posts as post
    where post.parent_post_id is null and post.deleted_at is null
  ),
  follower_counts as (
    select follow.followed_account_id as id, count(*)::bigint as total
    from public.net_pulse_follows as follow group by follow.followed_account_id
  ),
  following_counts as (
    select follow.follower_account_id as id, count(*)::bigint as total
    from public.net_pulse_follows as follow group by follow.follower_account_id
  ),
  pulse_counts as (
    select root.author_account_id as id, count(*)::bigint as total
    from visible_roots as root group by root.author_account_id
  )
  select
    account.id,
    account.handle,
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
    ),
    coalesce(profile.bio, ''),
    profile.visibility,
    profile.discoverable,
    account.status,
    coalesce(follower_count.total, 0),
    coalesce(following_count.total, 0),
    coalesce(pulse_count.total, 0),
    exists (
      select 1 from public.net_pulse_follows as follow
      where follow.follower_account_id = viewer_account_id
        and follow.followed_account_id = account.id
    )
  from public.net_app_accounts as account
  join public.net_pulse_profiles as profile on profile.account_id = account.id
  left join public.net_identity_links as identity_link on identity_link.id = account.identity_link_id
  left join public.net_universal_profiles as universal_profile on universal_profile.identity_link_id = identity_link.id
  left join public.character_sheet_forms as profile_sheet
    on identity_link.subject_kind = 'profile-sheet' and profile_sheet.profile_id = identity_link.subject_id
  left join public.npc_cards as npc_card
    on identity_link.subject_kind = 'npc-card' and npc_card.id = identity_link.subject_id
  left join public.characters as campaign_character
    on identity_link.subject_kind = 'character' and campaign_character.id = identity_link.subject_id
  left join follower_counts as follower_count on follower_count.id = account.id
  left join following_counts as following_count on following_count.id = account.id
  left join pulse_counts as pulse_count on pulse_count.id = account.id
  where account.app_id = 'pulse'
    and (
      (requested_account_id is not null
        and account.id = requested_account_id
        and (
          profile.visibility = 'public'
          or account.id = viewer_account_id
          or public.is_current_user_gm()
        ))
      or (requested_account_id is null
        and normalized_query <> ''
        and account.status = 'active'
        and profile.visibility = 'public'
        and profile.discoverable
        and account.handle ilike '%' || normalized_query || '%')
    )
  order by account.handle asc
  limit safe_limit;
end;
$$;

drop trigger if exists net_pulse_reactions_signal_realtime on public.net_pulse_reactions;
create trigger net_pulse_reactions_signal_realtime
after insert or delete on public.net_pulse_reactions
for each row execute procedure public.signal_net_pulse_realtime_change();

drop trigger if exists net_pulse_boosts_signal_realtime on public.net_pulse_boosts;
create trigger net_pulse_boosts_signal_realtime
after insert or delete on public.net_pulse_boosts
for each row execute procedure public.signal_net_pulse_realtime_change();

drop trigger if exists net_pulse_bookmarks_signal_realtime on public.net_pulse_bookmarks;
create trigger net_pulse_bookmarks_signal_realtime
after insert or delete on public.net_pulse_bookmarks
for each row execute procedure public.signal_net_pulse_realtime_change();

drop trigger if exists net_pulse_follows_signal_realtime on public.net_pulse_follows;
create trigger net_pulse_follows_signal_realtime
after insert or delete on public.net_pulse_follows
for each row execute procedure public.signal_net_pulse_realtime_change();

revoke all on function public.current_net_pulse_owner_account_id() from public;
revoke all on function public.net_pulse_post_is_visible(uuid) from public;
revoke all on function public.set_net_pulse_follow(uuid, boolean) from public;
revoke all on function public.set_net_pulse_reaction(uuid, boolean) from public;
revoke all on function public.set_net_pulse_boost(uuid, boolean) from public;
revoke all on function public.set_net_pulse_bookmark(uuid, boolean) from public;
revoke all on function public.fetch_net_pulse_feed(integer) from public;
revoke all on function public.fetch_net_pulse_account_summaries(text, uuid, integer) from public;

grant execute on function public.set_net_pulse_follow(uuid, boolean) to authenticated;
grant execute on function public.set_net_pulse_reaction(uuid, boolean) to authenticated;
grant execute on function public.set_net_pulse_boost(uuid, boolean) to authenticated;
grant execute on function public.set_net_pulse_bookmark(uuid, boolean) to authenticated;
grant execute on function public.fetch_net_pulse_feed(integer) to authenticated;
grant execute on function public.fetch_net_pulse_account_summaries(text, uuid, integer) to authenticated;

revoke all on function public.current_net_pulse_owner_account_id() from anon, authenticated;
revoke all on function public.net_pulse_post_is_visible(uuid) from anon, authenticated;
