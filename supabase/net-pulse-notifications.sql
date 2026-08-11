-- PULSE Notifications V1 and account-linked @mentions.
-- Run after net-pulse-performance-pagination.sql. This migration does not
-- replace any owner/compromised mutation RPC or alter their authorization.

create extension if not exists pgcrypto;

create table if not exists public.net_pulse_post_mentions (
  post_id uuid not null references public.net_pulse_posts (id) on delete cascade,
  mentioned_account_id uuid not null references public.net_app_accounts (id) on delete restrict,
  source_handle text not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (post_id, mentioned_account_id),
  constraint net_pulse_post_mentions_source_handle_valid check (
    public.normalize_net_app_handle(source_handle) is not null
    and source_handle = public.normalize_net_app_handle(source_handle)
  )
);

comment on table public.net_pulse_post_mentions is
  'Immutable account UUID links for recognised @mentions. source_handle records the text token only; account ownership and current presentation remain authoritative in net_app_accounts.';

create table if not exists public.net_pulse_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_account_id uuid not null references public.net_app_accounts (id) on delete restrict,
  actor_account_id uuid not null references public.net_app_accounts (id) on delete restrict,
  notification_type text not null,
  post_id uuid references public.net_pulse_posts (id) on delete restrict,
  root_post_id uuid references public.net_pulse_posts (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  read_at timestamptz,
  constraint net_pulse_notifications_type_valid check (
    notification_type in ('follow', 'reaction', 'boost', 'reply', 'mention')
  ),
  constraint net_pulse_notifications_not_self check (
    recipient_account_id <> actor_account_id
  ),
  constraint net_pulse_notifications_resource_shape check (
    (notification_type = 'follow' and post_id is null and root_post_id is null)
    or
    (notification_type <> 'follow' and post_id is not null and root_post_id is not null)
  )
);

comment on table public.net_pulse_notifications is
  'Private, server-authored PULSE inbox rows. Handles are resolved dynamically from immutable account UUIDs.';

create index if not exists net_pulse_notifications_recipient_page_idx
  on public.net_pulse_notifications (recipient_account_id, created_at desc, id desc);

create index if not exists net_pulse_notifications_recipient_unread_idx
  on public.net_pulse_notifications (recipient_account_id, created_at desc, id desc)
  where read_at is null;

-- Prevent toggle spam and duplicate trigger delivery. A re-follow or repeated
-- reaction/boost on the same resource does not manufacture another inbox row.
create unique index if not exists net_pulse_notifications_event_unique_idx
  on public.net_pulse_notifications (
    recipient_account_id,
    actor_account_id,
    notification_type,
    coalesce(post_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists net_pulse_post_mentions_account_idx
  on public.net_pulse_post_mentions (mentioned_account_id, created_at desc, post_id);

alter table public.net_pulse_post_mentions enable row level security;
alter table public.net_pulse_notifications enable row level security;

-- Both tables are RPC/trigger mediated. In particular, even an authoritative
-- GM cannot directly enumerate another account's private notification inbox.
revoke all on public.net_pulse_post_mentions from anon, authenticated;
revoke all on public.net_pulse_notifications from anon, authenticated;

alter table public.net_pulse_realtime_state
  add column if not exists notification_revision bigint not null default 0;

-- The incumbent revision row may contain metadata from a mutation that
-- happened before this privacy-hardened trigger was installed. Remove those
-- stale identifiers immediately when the migration is applied.
update public.net_pulse_realtime_state
set
  last_entity = 'net_pulse_state',
  last_operation = 'change',
  last_resource_id = null,
  last_parent_post_id = null,
  last_account_id = null;

-- Preserve the single compact Realtime row. Notification creation reuses the
-- content/engagement write already made by the incumbent trigger, so the row
-- never contains a recipient id, stable token, or pseudonymous recipient key.
-- PostgreSQL fires same-event triggers alphabetically: each create-notification
-- trigger runs before the existing signal-realtime trigger after the row insert.
create or replace function public.signal_net_pulse_realtime_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  scope_name text;
  entity_name text;
  resource_id uuid;
  operation_name text := 'change';
  notification_change boolean := false;
begin
  if tg_table_name = 'net_app_accounts' then
    if tg_op = 'DELETE' then
      if old.app_id <> 'pulse' then return null; end if;
    else
      if new.app_id <> 'pulse' then return null; end if;
    end if;
    scope_name := 'profile';
    entity_name := 'net_pulse_profile';
  elsif tg_table_name = 'net_pulse_profiles' then
    scope_name := 'profile';
    entity_name := 'net_pulse_profile';
  elsif tg_table_name = 'net_pulse_posts' then
    if tg_op = 'UPDATE' and old.deleted_at is null and new.deleted_at is not null then
      operation_name := 'soft-delete';
      resource_id := new.id;
    end if;
    scope_name := 'content';
    entity_name := 'net_pulse_posts';
    notification_change := tg_op = 'INSERT';
  elsif tg_table_name in ('net_pulse_reactions', 'net_pulse_boosts', 'net_pulse_bookmarks') then
    scope_name := 'engagement';
    entity_name := 'net_pulse_engagement';
    notification_change := tg_op = 'INSERT'
      and tg_table_name in ('net_pulse_reactions', 'net_pulse_boosts');
  elsif tg_table_name = 'net_pulse_follows' then
    scope_name := 'engagement';
    entity_name := 'net_pulse_engagement';
    notification_change := tg_op = 'INSERT';
  else
    scope_name := 'content';
    entity_name := 'net_pulse_content';
  end if;

  insert into public.net_pulse_realtime_state (
    channel,
    revision,
    content_revision,
    profile_revision,
    engagement_revision,
    notification_revision,
    last_entity,
    last_operation,
    last_resource_id,
    last_parent_post_id,
    last_account_id,
    updated_at
  ) values (
    'public',
    1,
    case when scope_name = 'content' then 1 else 0 end,
    case when scope_name = 'profile' then 1 else 0 end,
    case when scope_name = 'engagement' then 1 else 0 end,
    case when notification_change then 1 else 0 end,
    entity_name,
    operation_name,
    resource_id,
    null,
    null,
    timezone('utc', now())
  )
  on conflict (channel) do update set
    revision = public.net_pulse_realtime_state.revision + 1,
    content_revision = public.net_pulse_realtime_state.content_revision
      + case when scope_name = 'content' then 1 else 0 end,
    profile_revision = public.net_pulse_realtime_state.profile_revision
      + case when scope_name = 'profile' then 1 else 0 end,
    engagement_revision = public.net_pulse_realtime_state.engagement_revision
      + case when scope_name = 'engagement' then 1 else 0 end,
    notification_revision = public.net_pulse_realtime_state.notification_revision
      + case when notification_change then 1 else 0 end,
    last_entity = excluded.last_entity,
    last_operation = excluded.last_operation,
    last_resource_id = excluded.last_resource_id,
    last_parent_post_id = excluded.last_parent_post_id,
    last_account_id = excluded.last_account_id,
    updated_at = excluded.updated_at;

  return null;
end;
$$;

-- Read-state changes have no incumbent public mutation trigger, so they use a
-- single recipient-agnostic revision write. Every client refetches only its own
-- tiny unread state through an auth-derived RPC.
create or replace function public.signal_net_pulse_notification_read_change()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.net_pulse_realtime_state (
    channel,
    revision,
    notification_revision,
    last_entity,
    last_operation,
    last_resource_id,
    last_parent_post_id,
    last_account_id,
    updated_at
  ) values (
    'public',
    1,
    1,
    'net_pulse_notifications',
    'read-state',
    null,
    null,
    null,
    timezone('utc', now())
  )
  on conflict (channel) do update set
    revision = public.net_pulse_realtime_state.revision + 1,
    notification_revision = public.net_pulse_realtime_state.notification_revision + 1,
    last_entity = excluded.last_entity,
    last_operation = excluded.last_operation,
    last_resource_id = null,
    last_parent_post_id = null,
    last_account_id = null,
    updated_at = excluded.updated_at;
end;
$$;

create or replace function public.net_pulse_root_post_id(requested_post_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with recursive ancestors as (
    select post.id, post.parent_post_id, 0 as depth
    from public.net_pulse_posts as post
    where post.id = requested_post_id

    union all

    select parent.id, parent.parent_post_id, child.depth + 1
    from public.net_pulse_posts as parent
    join ancestors as child on child.parent_post_id = parent.id
    where child.depth < 16
  )
  select ancestor.id
  from ancestors as ancestor
  order by ancestor.depth desc
  limit 1;
$$;

create or replace function public.create_net_pulse_engagement_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_post public.net_pulse_posts%rowtype;
  recipient_account_id uuid;
  actor_account_id uuid;
  notification_kind text;
  target_post_id uuid;
  target_root_post_id uuid;
begin
  if tg_table_name = 'net_pulse_follows' then
    recipient_account_id := new.followed_account_id;
    actor_account_id := new.follower_account_id;
    notification_kind := 'follow';
  elsif tg_table_name = 'net_pulse_reactions' then
    select post.* into target_post
    from public.net_pulse_posts as post
    where post.id = new.post_id and post.deleted_at is null;
    if not found or not public.net_pulse_post_is_visible(target_post.id) then return null; end if;
    recipient_account_id := target_post.author_account_id;
    actor_account_id := new.account_id;
    notification_kind := 'reaction';
    target_post_id := target_post.id;
    target_root_post_id := public.net_pulse_root_post_id(target_post.id);
  elsif tg_table_name = 'net_pulse_boosts' then
    select post.* into target_post
    from public.net_pulse_posts as post
    where post.id = new.post_id and post.deleted_at is null;
    if not found or not public.net_pulse_post_is_visible(target_post.id) then return null; end if;
    recipient_account_id := target_post.author_account_id;
    actor_account_id := new.account_id;
    notification_kind := 'boost';
    target_post_id := target_post.id;
    target_root_post_id := public.net_pulse_root_post_id(target_post.id);
  else
    return null;
  end if;

  if recipient_account_id is null
    or actor_account_id is null
    or recipient_account_id = actor_account_id
  then
    return null;
  end if;

  insert into public.net_pulse_notifications (
    recipient_account_id,
    actor_account_id,
    notification_type,
    post_id,
    root_post_id
  ) values (
    recipient_account_id,
    actor_account_id,
    notification_kind,
    target_post_id,
    target_root_post_id
  )
  on conflict do nothing;
  return null;
end;
$$;

create or replace function public.create_net_pulse_post_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent_author_account_id uuid;
  root_id uuid := new.id;
  valid_mention_count integer := 0;
begin
  if new.parent_post_id is not null then
    select parent.author_account_id
    into parent_author_account_id
    from public.net_pulse_posts as parent
    where parent.id = new.parent_post_id
      and parent.deleted_at is null;
    if not found or not public.net_pulse_post_is_visible(new.parent_post_id) then
      return null;
    end if;
    root_id := public.net_pulse_root_post_id(new.parent_post_id);
  end if;

  with mention_tokens as (
    select public.normalize_net_app_handle((token_match.capture)[2]) as source_handle
    from regexp_matches(
      new.body,
      '(^|[^A-Za-z0-9_.@-])@([A-Za-z0-9_.-]+)',
      'g'
    ) as token_match(capture)
  ),
  resolved_mentions as (
    select distinct account.id
    from mention_tokens as token
    join public.net_app_accounts as account
      on account.app_id = 'pulse'
      and account.status = 'active'
      and account.handle = token.source_handle
    join public.net_pulse_profiles as profile
      on profile.account_id = account.id
    where token.source_handle is not null
  )
  select count(*)::integer into valid_mention_count
  from resolved_mentions;

  if valid_mention_count > 10 then
    raise exception 'PULSE supports up to 10 distinct account mentions per Pulse.'
      using errcode = '22023';
  end if;

  with mention_tokens as (
    select public.normalize_net_app_handle((token_match.capture)[2]) as source_handle
    from regexp_matches(
      new.body,
      '(^|[^A-Za-z0-9_.@-])@([A-Za-z0-9_.-]+)',
      'g'
    ) as token_match(capture)
  ),
  resolved_mentions as (
    select distinct on (account.id)
      account.id as mentioned_account_id,
      token.source_handle
    from mention_tokens as token
    join public.net_app_accounts as account
      on account.app_id = 'pulse'
      and account.status = 'active'
      and account.handle = token.source_handle
    join public.net_pulse_profiles as profile
      on profile.account_id = account.id
    where token.source_handle is not null
    order by account.id, token.source_handle
  )
  insert into public.net_pulse_post_mentions (
    post_id,
    mentioned_account_id,
    source_handle
  )
  select new.id, mention.mentioned_account_id, mention.source_handle
  from resolved_mentions as mention
  on conflict (post_id, mentioned_account_id) do nothing;

  with notification_candidates as (
    select
      parent_author_account_id as recipient_account_id,
      'reply'::text as notification_type
    where parent_author_account_id is not null
      and parent_author_account_id <> new.author_account_id

    union all

    select
      mention.mentioned_account_id,
      'mention'::text
    from public.net_pulse_post_mentions as mention
    where mention.post_id = new.id
      and mention.mentioned_account_id <> new.author_account_id
      and mention.mentioned_account_id is distinct from parent_author_account_id
  )
  insert into public.net_pulse_notifications (
    recipient_account_id,
    actor_account_id,
    notification_type,
    post_id,
    root_post_id
  )
  select
    candidate.recipient_account_id,
    new.author_account_id,
    candidate.notification_type,
    new.id,
    coalesce(root_id, new.id)
  from notification_candidates as candidate
  on conflict do nothing;

  return null;
end;
$$;

drop trigger if exists net_pulse_follows_create_notification on public.net_pulse_follows;
create trigger net_pulse_follows_create_notification
after insert on public.net_pulse_follows
for each row execute procedure public.create_net_pulse_engagement_notification();

drop trigger if exists net_pulse_reactions_create_notification on public.net_pulse_reactions;
create trigger net_pulse_reactions_create_notification
after insert on public.net_pulse_reactions
for each row execute procedure public.create_net_pulse_engagement_notification();

drop trigger if exists net_pulse_boosts_create_notification on public.net_pulse_boosts;
create trigger net_pulse_boosts_create_notification
after insert on public.net_pulse_boosts
for each row execute procedure public.create_net_pulse_engagement_notification();

drop trigger if exists net_pulse_posts_create_notifications on public.net_pulse_posts;
create trigger net_pulse_posts_create_notifications
after insert on public.net_pulse_posts
for each row execute procedure public.create_net_pulse_post_notifications();

create or replace function public.fetch_net_pulse_notification_page(
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 20
)
returns table (
  id uuid,
  notification_type text,
  actor_account_id uuid,
  actor_handle text,
  actor_avatar_url text,
  post_id uuid,
  root_post_id uuid,
  post_excerpt text,
  post_available boolean,
  created_at timestamptz,
  read_at timestamptz,
  page_has_more boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  viewer_account_id uuid;
  safe_limit integer := least(greatest(coalesce(requested_limit, 20), 1), 40);
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if (requested_cursor_at is null) <> (requested_cursor_id is null) then
    raise exception 'Notification cursor timestamp and id must be supplied together.' using errcode = '22023';
  end if;

  viewer_account_id := public.current_net_pulse_owner_account_id();
  if viewer_account_id is null then
    raise exception 'An active, controlled PULSE account is required.' using errcode = '42501';
  end if;

  return query
  with recursive candidates as (
    select notification.*
    from public.net_pulse_notifications as notification
    where notification.recipient_account_id = viewer_account_id
      and (
        requested_cursor_at is null
        or (notification.created_at, notification.id) < (requested_cursor_at, requested_cursor_id)
      )
    order by notification.created_at desc, notification.id desc
    limit safe_limit + 1
  ),
  marked as (
    select candidate.*,
      count(*) over () > safe_limit as has_more,
      row_number() over (order by candidate.created_at desc, candidate.id desc) as row_number
    from candidates as candidate
  ),
  selected as (
    select candidate.* from marked as candidate where candidate.row_number <= safe_limit
  ),
  ancestry as (
    select
      selected.id as notification_id,
      post.id,
      post.parent_post_id,
      post.deleted_at,
      post.body,
      0 as depth
    from selected
    join public.net_pulse_posts as post on post.id = selected.post_id

    union all

    select
      child.notification_id,
      parent.id,
      parent.parent_post_id,
      parent.deleted_at,
      parent.body,
      child.depth + 1
    from ancestry as child
    join public.net_pulse_posts as parent on parent.id = child.parent_post_id
    where child.depth < 16
  ),
  availability as (
    select
      selected.id,
      selected.post_id is not null
        and count(ancestor.id) > 0
        and bool_and(ancestor.deleted_at is null) as available,
      max(ancestor.body) filter (where ancestor.depth = 0) as body
    from selected
    left join ancestry as ancestor on ancestor.notification_id = selected.id
    group by selected.id, selected.post_id
  )
  select
    selected.id,
    selected.notification_type,
    selected.actor_account_id,
    actor.handle,
    presentation.avatar_url,
    selected.post_id,
    selected.root_post_id,
    case when availability.available then left(availability.body, 120) else null end,
    case when selected.notification_type = 'follow' then true else availability.available end,
    selected.created_at,
    selected.read_at,
    selected.has_more
  from selected
  join public.net_app_accounts as actor
    on actor.id = selected.actor_account_id and actor.app_id = 'pulse'
  left join public.net_pulse_account_presentation as presentation
    on presentation.account_id = actor.id
  left join availability on availability.id = selected.id
  order by selected.created_at desc, selected.id desc;
end;
$$;

create or replace function public.fetch_net_pulse_notification_state()
returns table (
  unread_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  viewer_account_id uuid;
  resolved_unread_count bigint;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  viewer_account_id := public.current_net_pulse_owner_account_id();
  if viewer_account_id is null then
    raise exception 'An active, controlled PULSE account is required.' using errcode = '42501';
  end if;

  select count(*)::bigint into resolved_unread_count
  from public.net_pulse_notifications as notification
  where notification.recipient_account_id = viewer_account_id
    and notification.read_at is null;

  return query select resolved_unread_count;
end;
$$;

create or replace function public.mark_net_pulse_notification_read(
  requested_notification_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  viewer_account_id uuid;
  marked_notification_id uuid;
  changed_read_state boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if requested_notification_id is null then
    raise exception 'A PULSE notification is required.' using errcode = '22023';
  end if;
  viewer_account_id := public.current_net_pulse_owner_account_id();
  if viewer_account_id is null then
    raise exception 'An active, controlled PULSE account is required.' using errcode = '42501';
  end if;

  update public.net_pulse_notifications as notification
  set read_at = timezone('utc', now())
  where notification.id = requested_notification_id
    and notification.recipient_account_id = viewer_account_id
    and notification.read_at is null
  returning notification.id into marked_notification_id;

  changed_read_state := marked_notification_id is not null;

  if marked_notification_id is null then
    select notification.id into marked_notification_id
    from public.net_pulse_notifications as notification
    where notification.id = requested_notification_id
      and notification.recipient_account_id = viewer_account_id;
  end if;
  if marked_notification_id is null then
    raise exception 'The requested PULSE notification is unavailable.' using errcode = 'P0002';
  end if;

  if changed_read_state then
    perform public.signal_net_pulse_notification_read_change();
  end if;
  return marked_notification_id;
end;
$$;

create or replace function public.mark_all_net_pulse_notifications_read()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  viewer_account_id uuid;
  changed_rows integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  viewer_account_id := public.current_net_pulse_owner_account_id();
  if viewer_account_id is null then
    raise exception 'An active, controlled PULSE account is required.' using errcode = '42501';
  end if;

  update public.net_pulse_notifications as notification
  set read_at = timezone('utc', now())
  where notification.recipient_account_id = viewer_account_id
    and notification.read_at is null;
  get diagnostics changed_rows = row_count;

  if changed_rows > 0 then
    perform public.signal_net_pulse_notification_read_change();
  end if;
  return changed_rows;
end;
$$;

create or replace function public.fetch_net_pulse_mentions_for_posts(
  requested_post_ids uuid[]
)
returns table (
  post_id uuid,
  mentioned_account_id uuid,
  source_handle text,
  current_handle text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if cardinality(coalesce(requested_post_ids, array[]::uuid[])) > 80 then
    raise exception 'At most 80 PULSE records may be resolved at once.' using errcode = '22023';
  end if;

  return query
  with requested as (
    select distinct requested_id as post_id
    from unnest(coalesce(requested_post_ids, array[]::uuid[])) as request(requested_id)
    where requested_id is not null
  ),
  visible_requested as (
    select requested.post_id
    from requested
    where public.net_pulse_post_is_visible(requested.post_id)
  )
  select
    mention.post_id,
    mention.mentioned_account_id,
    mention.source_handle,
    account.handle
  from visible_requested as visible
  join public.net_pulse_post_mentions as mention on mention.post_id = visible.post_id
  join public.net_app_accounts as account
    on account.id = mention.mentioned_account_id and account.app_id = 'pulse'
  order by mention.post_id, mention.source_handle;
end;
$$;

revoke all on function public.signal_net_pulse_realtime_change() from public, anon, authenticated;
revoke all on function public.signal_net_pulse_notification_read_change() from public, anon, authenticated;
revoke all on function public.net_pulse_root_post_id(uuid) from public, anon, authenticated;
revoke all on function public.create_net_pulse_engagement_notification() from public, anon, authenticated;
revoke all on function public.create_net_pulse_post_notifications() from public, anon, authenticated;
revoke all on function public.fetch_net_pulse_notification_page(timestamptz, uuid, integer) from public, anon;
revoke all on function public.fetch_net_pulse_notification_state() from public, anon;
revoke all on function public.mark_net_pulse_notification_read(uuid) from public, anon;
revoke all on function public.mark_all_net_pulse_notifications_read() from public, anon;
revoke all on function public.fetch_net_pulse_mentions_for_posts(uuid[]) from public, anon;

grant execute on function public.fetch_net_pulse_notification_page(timestamptz, uuid, integer) to authenticated;
grant execute on function public.fetch_net_pulse_notification_state() to authenticated;
grant execute on function public.mark_net_pulse_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_net_pulse_notifications_read() to authenticated;
grant execute on function public.fetch_net_pulse_mentions_for_posts(uuid[]) to authenticated;
