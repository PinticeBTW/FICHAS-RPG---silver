-- WAVE V1: ALTARA-only identity-backed social network.
-- Forward-only. Run after the effective-runtime foundation, non-financial
-- runtime parity, and ALTARA MUSIC V1. No PULSE product data is referenced.

begin;

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

do $preflight$
declare
  v_install_constraint text;
  v_install_ids text[];
begin
  if to_regclass('public.profiles') is null
    or to_regclass('public.net_identity_links') is null
    or to_regclass('public.net_identity_os_assignments') is null
    or to_regclass('public.net_os_families') is null
    or to_regclass('public.net_os_service_scopes') is null
    or to_regclass('public.net_identity_app_installs') is null
    or to_regclass('public.net_app_account_policies') is null
    or to_regclass('public.net_gm_persona_sessions') is null
    or to_regclass('public.net_action_audit') is null
    or to_regclass('public.net_universal_profiles') is null
    or to_regclass('public.character_sheet_forms') is null
    or to_regclass('public.npc_cards') is null
    or to_regclass('public.characters') is null
    or to_regclass('storage.objects') is null
    or to_regprocedure('public.set_updated_at()') is null
    or to_regprocedure('public.current_net_effective_runtime_identity_link_id()') is null
    or to_regprocedure('public.assert_net_effective_runtime_identity(uuid,text,boolean)') is null
    or to_regprocedure('public.net_runtime_action_context(uuid)') is null
    or to_regprocedure('public.net_identity_link_can_access_service(uuid,text)') is null
  then
    raise exception 'ALTARA_WAVE_DEPENDENCY_REQUIRED' using errcode = '55000';
  end if;

  if exists (
    select 1 from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname like 'net_altara_wave_%'
  ) or exists (
    select 1 from pg_catalog.pg_proc as procedure_row
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure_row.pronamespace
    where namespace.nspname = 'public'
      and procedure_row.proname like '%net_altara_wave%'
  ) then
    raise exception 'ALTARA_WAVE_SCHEMA_COLLISION_REVIEW_REQUIRED' using errcode = '42P07';
  end if;

  if not exists (
    select 1 from storage.buckets as bucket
    where bucket.id = 'rpg-media' and bucket.public = false
  ) then
    raise exception 'ALTARA_WAVE_PRIVATE_MEDIA_REQUIRED' using errcode = '55000';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
  ) then
    raise exception 'ALTARA_WAVE_REALTIME_PUBLICATION_REQUIRED' using errcode = '55000';
  end if;

  select pg_get_constraintdef(constraint_row.oid, true)
  into v_install_constraint
  from pg_constraint as constraint_row
  where constraint_row.conrelid = 'public.net_identity_app_installs'::regclass
    and constraint_row.conname = 'net_identity_app_installs_app_id_check'
    and constraint_row.contype = 'c';

  select array_agg((capture)[1] order by (capture)[1])
  into v_install_ids
  from regexp_matches(coalesce(v_install_constraint, ''), '''([^'']+)''', 'g')
    as matches(capture);

  if v_install_ids is distinct from array[
    'altara-bank', 'altara-music', 'altara-news', 'echo', 'nvn', 'pulse',
    'shneider-bank', 'vox-bank'
  ]::text[] then
    raise exception 'ALTARA_WAVE_INSTALL_DOMAIN_REVIEW_REQUIRED'
      using errcode = '55000', detail = coalesce(v_install_constraint, 'missing');
  end if;
end;
$preflight$;

insert into public.net_os_service_scopes (service_id, scope_kind, required_os_id)
values ('altara-wave', 'primary-os', 'altara')
on conflict (service_id) do update set
  scope_kind = excluded.scope_kind,
  required_os_id = excluded.required_os_id,
  updated_at = timezone('utc', now());

insert into public.net_app_account_policies (app_id, account_mode, account_available)
values ('altara-wave', 'none', false)
on conflict (app_id) do update set
  account_mode = excluded.account_mode,
  account_available = excluded.account_available,
  updated_at = timezone('utc', now());

alter table public.net_identity_app_installs
  drop constraint net_identity_app_installs_app_id_check;
alter table public.net_identity_app_installs
  add constraint net_identity_app_installs_app_id_check
  check (app_id in (
    'echo', 'pulse', 'nvn', 'vox-bank', 'shneider-bank',
    'altara-bank', 'altara-news', 'altara-music', 'altara-wave'
  )) not valid;
alter table public.net_identity_app_installs
  validate constraint net_identity_app_installs_app_id_check;

-- Preserve the deployed effective-runtime installer and extend only the
-- reviewed optional-app domain with altara-wave.
create or replace function public.set_net_identity_app_install(
  requested_identity_link_id uuid,
  requested_app_id text,
  requested_installed boolean
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_context record;
begin
  if requested_app_id is null
    or requested_app_id not in (
      'echo', 'pulse', 'nvn', 'vox-bank', 'shneider-bank',
      'altara-bank', 'altara-news', 'altara-music', 'altara-wave'
    )
  then
    raise exception 'This application is not an installable optional OS module.'
      using errcode = '22023';
  end if;
  if requested_installed is null then
    raise exception 'Installation state is required.' using errcode = '22023';
  end if;

  v_identity_link_id := public.assert_net_effective_runtime_identity(
    requested_identity_link_id,
    requested_app_id,
    false
  );

  if requested_installed then
    insert into public.net_identity_app_installs (identity_link_id, app_id)
    values (v_identity_link_id, requested_app_id)
    on conflict (identity_link_id, app_id) do update
    set updated_at = timezone('utc', now());
  else
    delete from public.net_identity_app_installs as install
    where install.identity_link_id = v_identity_link_id
      and install.app_id = requested_app_id;
  end if;

  select context.* into v_context
  from public.net_runtime_action_context(v_identity_link_id) as context;

  insert into public.net_action_audit (
    authenticated_actor_profile_id, presented_account_id,
    persona_subject_kind, persona_subject_id, action_mode, action_type,
    authorization_basis, resource_type, resource_id
  ) values (
    auth.uid(), null, v_context.persona_subject_kind, v_context.persona_subject_id,
    v_context.action_mode,
    case when requested_installed then 'net.app.install' else 'net.app.uninstall' end,
    v_context.authorization_basis || ':' || requested_app_id,
    'net-identity-link', v_identity_link_id
  );

  return requested_installed;
end;
$$;

create table public.net_altara_wave_accounts (
  id uuid primary key default gen_random_uuid(),
  identity_link_id uuid not null unique
    references public.net_identity_links (id) on delete restrict,
  handle text not null,
  display_name text not null,
  bio text not null default '',
  avatar_ref text,
  banner_ref text,
  location_label text,
  website_url text,
  status text not null default 'active',
  joined_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint net_altara_wave_accounts_handle_valid check (
    handle = lower(handle) and handle ~ '^[a-z0-9][a-z0-9._-]{1,31}$'
  ),
  constraint net_altara_wave_accounts_display_name_valid check (
    display_name = btrim(display_name) and char_length(display_name) between 1 and 120
  ),
  constraint net_altara_wave_accounts_bio_valid check (char_length(bio) <= 240),
  constraint net_altara_wave_accounts_avatar_valid check (
    avatar_ref is null or (avatar_ref like 'rpg-media:v1:%' and char_length(avatar_ref) <= 4096)
  ),
  constraint net_altara_wave_accounts_banner_valid check (
    banner_ref is null or (banner_ref like 'rpg-media:v1:%' and char_length(banner_ref) <= 4096)
  ),
  constraint net_altara_wave_accounts_location_valid check (
    location_label is null or (location_label = btrim(location_label) and char_length(location_label) between 1 and 120)
  ),
  constraint net_altara_wave_accounts_website_valid check (
    website_url is null or (
      website_url = btrim(website_url)
      and char_length(website_url) between 9 and 500
      and website_url ~* '^https://[^[:space:]]+$'
    )
  ),
  constraint net_altara_wave_accounts_status_valid check (
    status in ('active', 'suspended', 'disabled')
  )
);

create unique index net_altara_wave_accounts_handle_uidx
  on public.net_altara_wave_accounts (lower(handle));
create index net_altara_wave_accounts_discovery_idx
  on public.net_altara_wave_accounts (joined_at desc, id desc)
  where status = 'active';
create index net_altara_wave_accounts_handle_search_idx
  on public.net_altara_wave_accounts using gin (lower(handle) gin_trgm_ops);
create index net_altara_wave_accounts_name_search_idx
  on public.net_altara_wave_accounts using gin (lower(display_name) gin_trgm_ops);

create table public.net_altara_wave_posts (
  id uuid primary key default gen_random_uuid(),
  author_account_id uuid not null
    references public.net_altara_wave_accounts (id) on delete restrict,
  parent_post_id uuid references public.net_altara_wave_posts (id) on delete restrict,
  root_post_id uuid references public.net_altara_wave_posts (id) on delete restrict,
  request_key uuid not null,
  request_fingerprint text not null,
  body text not null default '',
  media_ref text,
  status text not null default 'published',
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', clock_timestamp()),
  updated_at timestamptz not null default timezone('utc', clock_timestamp()),
  unique (author_account_id, request_key),
  constraint net_altara_wave_posts_fingerprint_valid check (
    request_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  constraint net_altara_wave_posts_body_valid check (
    char_length(body) <= 360 and body = btrim(body)
  ),
  constraint net_altara_wave_posts_media_valid check (
    media_ref is null or (media_ref like 'rpg-media:v1:%' and char_length(media_ref) <= 4096)
  ),
  constraint net_altara_wave_posts_status_valid check (status in ('published', 'deleted')),
  constraint net_altara_wave_posts_thread_shape_valid check (
    (parent_post_id is null and root_post_id is null)
    or (parent_post_id is not null and root_post_id is not null)
  ),
  constraint net_altara_wave_posts_lifecycle_valid check (
    (status = 'published' and deleted_at is null and (body <> '' or media_ref is not null))
    or (status = 'deleted' and deleted_at is not null and body = '' and media_ref is null)
  )
);

create index net_altara_wave_posts_feed_idx
  on public.net_altara_wave_posts (created_at desc, id desc)
  where status = 'published';
create index net_altara_wave_posts_author_idx
  on public.net_altara_wave_posts (author_account_id, created_at desc, id desc);
create index net_altara_wave_posts_thread_idx
  on public.net_altara_wave_posts (root_post_id, created_at, id);
create index net_altara_wave_posts_search_idx
  on public.net_altara_wave_posts using gin (lower(body) gin_trgm_ops)
  where status = 'published';

create table public.net_altara_wave_post_mentions (
  post_id uuid not null references public.net_altara_wave_posts (id) on delete cascade,
  mentioned_account_id uuid not null references public.net_altara_wave_accounts (id) on delete cascade,
  source_handle text not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (post_id, mentioned_account_id),
  constraint net_altara_wave_mentions_handle_valid check (
    source_handle = lower(source_handle) and source_handle ~ '^[a-z0-9][a-z0-9._-]{1,31}$'
  )
);

create table public.net_altara_wave_follows (
  follower_account_id uuid not null references public.net_altara_wave_accounts (id) on delete cascade,
  followed_account_id uuid not null references public.net_altara_wave_accounts (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', clock_timestamp()),
  primary key (follower_account_id, followed_account_id),
  constraint net_altara_wave_follows_not_self check (follower_account_id <> followed_account_id)
);
create index net_altara_wave_follows_followed_idx
  on public.net_altara_wave_follows (followed_account_id, created_at desc, follower_account_id);

create table public.net_altara_wave_reactions (
  account_id uuid not null references public.net_altara_wave_accounts (id) on delete cascade,
  post_id uuid not null references public.net_altara_wave_posts (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', clock_timestamp()),
  primary key (account_id, post_id)
);
create index net_altara_wave_reactions_post_idx
  on public.net_altara_wave_reactions (post_id, created_at desc, account_id);

create table public.net_altara_wave_boosts (
  account_id uuid not null references public.net_altara_wave_accounts (id) on delete cascade,
  post_id uuid not null references public.net_altara_wave_posts (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', clock_timestamp()),
  primary key (account_id, post_id)
);
create index net_altara_wave_boosts_post_idx
  on public.net_altara_wave_boosts (post_id, created_at desc, account_id);
create index net_altara_wave_boosts_account_idx
  on public.net_altara_wave_boosts (account_id, created_at desc, post_id);

create table public.net_altara_wave_bookmarks (
  account_id uuid not null references public.net_altara_wave_accounts (id) on delete cascade,
  post_id uuid not null references public.net_altara_wave_posts (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', clock_timestamp()),
  primary key (account_id, post_id)
);
create index net_altara_wave_bookmarks_account_idx
  on public.net_altara_wave_bookmarks (account_id, created_at desc, post_id);

create table public.net_altara_wave_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_account_id uuid not null references public.net_altara_wave_accounts (id) on delete cascade,
  actor_account_id uuid not null references public.net_altara_wave_accounts (id) on delete cascade,
  notification_type text not null,
  post_id uuid references public.net_altara_wave_posts (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', clock_timestamp()),
  read_at timestamptz,
  constraint net_altara_wave_notifications_type_valid check (
    notification_type in ('follow', 'reaction', 'boost', 'reply', 'mention')
  ),
  constraint net_altara_wave_notifications_not_self check (
    recipient_account_id <> actor_account_id
  ),
  constraint net_altara_wave_notifications_shape_valid check (
    (notification_type = 'follow' and post_id is null)
    or (notification_type <> 'follow' and post_id is not null)
  )
);
create unique index net_altara_wave_notifications_follow_uidx
  on public.net_altara_wave_notifications (recipient_account_id, actor_account_id)
  where notification_type = 'follow';
create unique index net_altara_wave_notifications_post_uidx
  on public.net_altara_wave_notifications (
    recipient_account_id, actor_account_id, notification_type, post_id
  ) where post_id is not null;
create index net_altara_wave_notifications_recipient_idx
  on public.net_altara_wave_notifications (recipient_account_id, created_at desc, id desc);
create index net_altara_wave_notifications_unread_idx
  on public.net_altara_wave_notifications (recipient_account_id, created_at desc)
  where read_at is null;

-- Keep each inbox physically bounded without a worker. Recent unread rows are
-- retained first, followed by the newest read history up to the same cap.
create or replace function public.prune_net_altara_wave_notification_history()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'altara-wave-notifications:' || new.recipient_account_id::text, 0
  ));

  delete from public.net_altara_wave_notifications as notification
  using (
    select ranked.id
    from (
      select candidate.id,
        row_number() over (
          order by (candidate.read_at is null) desc,
            candidate.created_at desc,
            candidate.id desc
        ) as retained_rank
      from public.net_altara_wave_notifications as candidate
      where candidate.recipient_account_id = new.recipient_account_id
    ) as ranked
    where ranked.retained_rank > 500
  ) as expired
  where notification.id = expired.id;

  return null;
end;
$$;

create trigger net_altara_wave_notifications_bound_history
after insert on public.net_altara_wave_notifications
for each row execute function public.prune_net_altara_wave_notification_history();

create table public.net_altara_wave_rate_limits (
  actor_profile_id uuid not null references public.profiles (id) on delete cascade,
  action_class text not null,
  window_started_at timestamptz not null,
  action_count integer not null default 0,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (actor_profile_id, action_class),
  constraint net_altara_wave_rate_limits_class_valid check (
    action_class in ('account', 'post', 'profile', 'follow', 'engagement', 'delete')
  ),
  constraint net_altara_wave_rate_limits_count_valid check (action_count >= 0)
);

create table public.net_altara_wave_realtime_state (
  channel text primary key,
  revision bigint not null default 0,
  content_revision bigint not null default 0,
  profile_revision bigint not null default 0,
  engagement_revision bigint not null default 0,
  notification_revision bigint not null default 0,
  last_entity text,
  last_operation text,
  last_resource_id uuid,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint net_altara_wave_realtime_channel_valid check (channel = 'public'),
  constraint net_altara_wave_realtime_revision_valid check (
    revision >= 0 and content_revision >= 0 and profile_revision >= 0
    and engagement_revision >= 0 and notification_revision >= 0
  )
);
insert into public.net_altara_wave_realtime_state (channel) values ('public');

create trigger net_altara_wave_accounts_set_updated_at
before update on public.net_altara_wave_accounts
for each row execute function public.set_updated_at();
create trigger net_altara_wave_posts_set_updated_at
before update on public.net_altara_wave_posts
for each row execute function public.set_updated_at();

create or replace function public.net_altara_wave_identity_display_name(
  requested_identity_link_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.net_identity_links%rowtype;
  v_name text;
begin
  select identity_link.* into v_link
  from public.net_identity_links as identity_link
  where identity_link.id = requested_identity_link_id;
  if not found then return 'ALTARA identity'; end if;

  select nullif(btrim(profile.display_name_override), '') into v_name
  from public.net_universal_profiles as profile
  where profile.identity_link_id = v_link.id;
  if v_name is not null then return left(v_name, 120); end if;

  case v_link.subject_kind
    when 'profile-sheet' then
      select coalesce(
        nullif(btrim(sheet.field_data ->> 'NOME'), ''),
        nullif(btrim(profile.display_name), ''),
        nullif(btrim(profile.handle), '')
      ) into v_name
      from public.profiles as profile
      left join public.character_sheet_forms as sheet on sheet.profile_id = profile.id
      where profile.id = v_link.subject_id;
    when 'npc-card' then
      select coalesce(
        nullif(btrim(card.field_data ->> 'NOME'), ''),
        nullif(btrim(card.display_name), '')
      ) into v_name
      from public.npc_cards as card where card.id = v_link.subject_id;
    when 'character' then
      select coalesce(nullif(btrim(character.alias), ''), nullif(btrim(character.name), ''))
      into v_name from public.characters as character where character.id = v_link.subject_id;
    else v_name := null;
  end case;
  return left(coalesce(v_name, 'ALTARA identity'), 120);
end;
$$;

create or replace function public.net_altara_wave_assert_runtime_identity(
  requested_expected_identity_link_id uuid
)
returns uuid
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select public.assert_net_effective_runtime_identity(
    requested_expected_identity_link_id,
    'altara-wave',
    true
  );
$$;

create or replace function public.net_altara_wave_assert_runtime_account(
  requested_expected_identity_link_id uuid,
  requested_expected_account_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_account_id uuid;
begin
  v_identity_link_id := public.net_altara_wave_assert_runtime_identity(
    requested_expected_identity_link_id
  );
  select account.id into v_account_id
  from public.net_altara_wave_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.status = 'active'
  for share;
  if not found then
    raise exception 'ALTARA_WAVE_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;
  if requested_expected_account_id is null
    or requested_expected_account_id is distinct from v_account_id
  then
    raise exception 'ALTARA_WAVE_ACCOUNT_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;
  return v_account_id;
end;
$$;

-- Target visibility is a property of the target identity, not caller
-- authority. Install state controls launching/acting; current ALTARA service
-- eligibility controls whether preserved social history projects publicly.
create or replace function public.net_altara_wave_account_is_currently_visible(
  requested_account_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.net_altara_wave_accounts as account
    join public.net_identity_links as identity_link
      on identity_link.id = account.identity_link_id
    where account.id = requested_account_id
      and account.status = 'active'
      and public.net_identity_link_can_access_service(identity_link.id, 'altara-wave')
  );
$$;

create or replace function public.net_altara_wave_audit(
  requested_identity_link_id uuid,
  requested_action text,
  requested_resource_type text,
  requested_resource_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_context record;
begin
  if requested_action is null or char_length(requested_action) not between 1 and 120
    or requested_resource_type is null or char_length(requested_resource_type) not between 1 and 80
    or requested_resource_id is null
  then
    raise exception 'ALTARA_WAVE_AUDIT_INPUT_INVALID' using errcode = '22023';
  end if;
  select context.* into v_context
  from public.net_runtime_action_context(requested_identity_link_id) as context;
  if v_context.action_mode is null or v_context.authorization_basis is null then
    raise exception 'ALTARA_WAVE_RUNTIME_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;
  insert into public.net_action_audit (
    authenticated_actor_profile_id, presented_account_id,
    persona_subject_kind, persona_subject_id, action_mode, action_type,
    authorization_basis, resource_type, resource_id
  ) values (
    auth.uid(), null, v_context.persona_subject_kind, v_context.persona_subject_id,
    v_context.action_mode, requested_action,
    v_context.authorization_basis || ':altara-wave',
    requested_resource_type, requested_resource_id
  );
end;
$$;

create or replace function public.consume_net_altara_wave_rate_limit(
  requested_action_class text,
  requested_cost integer default 1
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_window interval;
  v_limit integer;
  v_bucket public.net_altara_wave_rate_limits%rowtype;
begin
  if v_actor is null then raise exception 'ALTARA_WAVE_AUTH_REQUIRED' using errcode = '42501'; end if;
  if requested_cost is null or requested_cost not between 1 and 10 then
    raise exception 'ALTARA_WAVE_RATE_LIMIT_COST_INVALID' using errcode = '22023';
  end if;
  case requested_action_class
    when 'account' then v_window := interval '1 hour'; v_limit := 5;
    when 'post' then v_window := interval '1 minute'; v_limit := 5;
    when 'profile' then v_window := interval '10 minutes'; v_limit := 10;
    when 'follow' then v_window := interval '1 minute'; v_limit := 10;
    when 'engagement' then v_window := interval '1 minute'; v_limit := 30;
    when 'delete' then v_window := interval '1 minute'; v_limit := 20;
    else raise exception 'ALTARA_WAVE_RATE_LIMIT_CLASS_INVALID' using errcode = '22023';
  end case;

  insert into public.net_altara_wave_rate_limits (
    actor_profile_id, action_class, window_started_at, action_count, updated_at
  ) values (v_actor, requested_action_class, v_now, 0, v_now)
  on conflict (actor_profile_id, action_class) do nothing;

  select bucket.* into v_bucket
  from public.net_altara_wave_rate_limits as bucket
  where bucket.actor_profile_id = v_actor
    and bucket.action_class = requested_action_class
  for update;

  if v_bucket.window_started_at + v_window <= v_now then
    update public.net_altara_wave_rate_limits set
      window_started_at = v_now,
      action_count = requested_cost,
      updated_at = v_now
    where actor_profile_id = v_actor and action_class = requested_action_class;
  elsif v_bucket.action_count + requested_cost > v_limit then
    raise exception 'ALTARA_WAVE_RATE_LIMIT' using errcode = '54000';
  else
    update public.net_altara_wave_rate_limits set
      action_count = action_count + requested_cost,
      updated_at = v_now
    where actor_profile_id = v_actor and action_class = requested_action_class;
  end if;
end;
$$;

create or replace function public.net_altara_wave_account_payload(
  requested_account_id uuid,
  requested_viewer_account_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', account.id,
    'identity_link_id', account.identity_link_id,
    'handle', account.handle,
    'display_name', account.display_name,
    'bio', account.bio,
    'avatar_ref', account.avatar_ref,
    'banner_ref', account.banner_ref,
    'location_label', account.location_label,
    'website_url', account.website_url,
    'status', account.status,
    'joined_at', account.joined_at,
    'updated_at', account.updated_at,
    'followers_count', (
      select count(*) from public.net_altara_wave_follows as follow
      where follow.followed_account_id = account.id
        and public.net_altara_wave_account_is_currently_visible(follow.follower_account_id)
    ),
    'following_count', (
      select count(*) from public.net_altara_wave_follows as follow
      where follow.follower_account_id = account.id
        and public.net_altara_wave_account_is_currently_visible(follow.followed_account_id)
    ),
    'posts_count', (
      select count(*) from public.net_altara_wave_posts as post
      where post.author_account_id = account.id and post.status = 'published'
    ),
    'viewer_following', exists (
      select 1 from public.net_altara_wave_follows as follow
      where follow.follower_account_id = requested_viewer_account_id
        and follow.followed_account_id = account.id
    ),
    'viewer_owns', account.id = requested_viewer_account_id
  )
  from public.net_altara_wave_accounts as account
  where account.id = requested_account_id;
$$;

create or replace function public.net_altara_wave_post_payload(
  requested_post_id uuid,
  requested_viewer_account_id uuid,
  requested_activity_at timestamptz,
  requested_booster_account_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', post.id,
    'author_account_id', post.author_account_id,
    'parent_post_id', post.parent_post_id,
    'root_post_id', post.root_post_id,
    'body', post.body,
    'media_ref', post.media_ref,
    'deleted', post.status = 'deleted',
    'created_at', post.created_at,
    'updated_at', post.updated_at,
    'activity_at', coalesce(requested_activity_at, post.created_at),
    'reply_count', (
      select count(*) from public.net_altara_wave_posts as reply
      where reply.parent_post_id = post.id and reply.status = 'published'
        and public.net_altara_wave_account_is_currently_visible(reply.author_account_id)
    ),
    'reaction_count', (
      select count(*) from public.net_altara_wave_reactions as reaction
      where reaction.post_id = post.id
        and public.net_altara_wave_account_is_currently_visible(reaction.account_id)
    ),
    'boost_count', (
      select count(*) from public.net_altara_wave_boosts as boost
      where boost.post_id = post.id
        and public.net_altara_wave_account_is_currently_visible(boost.account_id)
    ),
    'viewer_reacted', exists (
      select 1 from public.net_altara_wave_reactions as reaction
      where reaction.post_id = post.id and reaction.account_id = requested_viewer_account_id
    ),
    'viewer_boosted', exists (
      select 1 from public.net_altara_wave_boosts as boost
      where boost.post_id = post.id and boost.account_id = requested_viewer_account_id
    ),
    'viewer_bookmarked', exists (
      select 1 from public.net_altara_wave_bookmarks as bookmark
      where bookmark.post_id = post.id and bookmark.account_id = requested_viewer_account_id
    ),
    'boosted_by', case when requested_booster_account_id is null then null else (
      select jsonb_build_object('id', booster.id, 'handle', booster.handle, 'display_name', booster.display_name)
      from public.net_altara_wave_accounts as booster where booster.id = requested_booster_account_id
    ) end,
    'mentions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'account_id', mention.mentioned_account_id,
        'source_handle', mention.source_handle,
        'current_handle', mentioned.handle
      ) order by mention.created_at, mention.mentioned_account_id)
      from public.net_altara_wave_post_mentions as mention
      join public.net_altara_wave_accounts as mentioned on mentioned.id = mention.mentioned_account_id
      where mention.post_id = post.id
        and public.net_altara_wave_account_is_currently_visible(mentioned.id)
    ), '[]'::jsonb),
    'author', public.net_altara_wave_account_payload(post.author_account_id, requested_viewer_account_id)
  )
  from public.net_altara_wave_posts as post
  where post.id = requested_post_id;
$$;

create or replace function public.net_altara_wave_media_ref_contains_object(
  requested_media_ref text,
  requested_account_id uuid,
  requested_object_name text default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_payload jsonb;
  v_hash text;
  v_variant jsonb;
  v_path text;
  v_mime text;
  v_extension text;
  v_found boolean := requested_object_name is null;
begin
  if requested_media_ref is null
    or requested_media_ref not like 'rpg-media:v1:%'
    or char_length(requested_media_ref) not between 16 and 4096
    or requested_account_id is null
  then return false; end if;

  v_payload := convert_from(decode(
    translate(substr(requested_media_ref, char_length('rpg-media:v1:') + 1), '-_', '+/')
      || repeat('=', (4 - char_length(substr(requested_media_ref, char_length('rpg-media:v1:') + 1)) % 4) % 4),
    'base64'), 'UTF8')::jsonb;
  v_hash := lower(v_payload ->> 'h');
  if jsonb_typeof(v_payload) <> 'object'
    or v_payload ->> 'v' <> '1'
    or v_hash is null
    or v_hash !~ '^[a-f0-9]{16,64}$'
    or jsonb_typeof(v_payload -> 'd') <> 'object'
    or (v_payload ? 't' and jsonb_typeof(v_payload -> 't') <> 'object')
  then return false; end if;

  for v_variant in
    select value from jsonb_array_elements(
      jsonb_build_array(v_payload -> 'd')
      || case when v_payload ? 't' then jsonb_build_array(v_payload -> 't') else '[]'::jsonb end
    )
  loop
    v_path := v_variant ->> 'p';
    v_mime := v_variant ->> 'm';
    v_extension := lower(split_part(split_part(v_path, '/', 6), '.', 2));
    if v_path is null
      or char_length(v_path) not between 1 and 1024
      or v_path like '/%'
      or v_path like '%..%'
      or split_part(v_path, '/', 1) <> 'altara-wave-account'
      or split_part(v_path, '/', 2) <> requested_account_id::text
      or split_part(v_path, '/', 3) not in ('avatar', 'general')
      or split_part(v_path, '/', 4) !~ '^[a-z0-9][a-z0-9_-]{0,127}$'
      or (split_part(v_path, '/', 3) = 'avatar' and split_part(v_path, '/', 4) <> 'avatar')
      or (split_part(v_path, '/', 3) = 'general'
        and split_part(v_path, '/', 4) <> 'banner'
        and split_part(v_path, '/', 4) !~ '^post-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
      or split_part(v_path, '/', 5) <> left(v_hash, 32)
      or split_part(v_path, '/', 6) !~ '^(display|thumbnail)\.(jpg|jpeg|png|webp|gif|avif)$'
      or split_part(v_path, '/', 7) <> ''
      or v_mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif')
      or (v_extension in ('jpg', 'jpeg') and v_mime <> 'image/jpeg')
      or (v_extension not in ('jpg', 'jpeg') and v_mime <> 'image/' || v_extension)
      or coalesce(v_variant ->> 'w', '') !~ '^[1-9][0-9]*$'
      or coalesce(v_variant ->> 'h', '') !~ '^[1-9][0-9]*$'
      or coalesce(v_variant ->> 'b', '') !~ '^[1-9][0-9]*$'
    then return false; end if;
    if requested_object_name is not null and v_path = requested_object_name then v_found := true; end if;
  end loop;
  return v_found;
exception when others then
  return false;
end;
$$;

create or replace function public.current_user_can_write_net_altara_wave_media_object(
  requested_object_name text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_account_id uuid;
  v_kind text := split_part(requested_object_name, '/', 3);
  v_slot text := split_part(requested_object_name, '/', 4);
begin
  v_identity_link_id := public.current_net_effective_runtime_identity_link_id();
  if v_identity_link_id is null
    or not public.net_identity_link_can_access_service(v_identity_link_id, 'altara-wave')
    or not exists (
      select 1 from public.net_identity_app_installs as install
      where install.identity_link_id = v_identity_link_id and install.app_id = 'altara-wave'
    )
  then return false; end if;
  select account.id into v_account_id
  from public.net_altara_wave_accounts as account
  where account.identity_link_id = v_identity_link_id and account.status = 'active';
  if not found then return false; end if;
  return requested_object_name is not null
    and split_part(requested_object_name, '/', 1) = 'altara-wave-account'
    and split_part(requested_object_name, '/', 2) = v_account_id::text
    and v_kind in ('avatar', 'general')
    and (
      (v_kind = 'avatar' and v_slot = 'avatar')
      or (v_kind = 'general' and (
        v_slot = 'banner'
        or v_slot ~ '^post-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      ))
    )
    and split_part(requested_object_name, '/', 5) ~ '^[a-f0-9]{32}$'
    and split_part(requested_object_name, '/', 6) ~ '^(display|thumbnail)\.(jpg|jpeg|png|webp|gif|avif)$'
    and split_part(requested_object_name, '/', 7) = '';
end;
$$;

-- Storage cleanup is stricter than namespace ownership. A response-lost
-- client may retry cleanup after the database commit; canonical references
-- must therefore pin their exact immutable objects against deletion.
create or replace function public.current_user_can_delete_net_altara_wave_media_object(
  requested_object_name text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid;
begin
  if not public.current_user_can_write_net_altara_wave_media_object(requested_object_name)
  then return false; end if;

  begin
    v_account_id := split_part(requested_object_name, '/', 2)::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  if exists (
    select 1
    from public.net_altara_wave_accounts as account
    where account.id = v_account_id
      and (
        public.net_altara_wave_media_ref_contains_object(
          account.avatar_ref, account.id, requested_object_name
        )
        or public.net_altara_wave_media_ref_contains_object(
          account.banner_ref, account.id, requested_object_name
        )
      )
  ) or exists (
    select 1
    from public.net_altara_wave_posts as post
    where post.author_account_id = v_account_id
      and public.net_altara_wave_media_ref_contains_object(
        post.media_ref, post.author_account_id, requested_object_name
      )
  ) then
    return false;
  end if;

  return true;
end;
$$;

create or replace function public.net_altara_wave_media_ref_matches_slot(
  requested_media_ref text,
  requested_account_id uuid,
  requested_media_kind text,
  requested_slot text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_payload jsonb;
  v_variant jsonb;
begin
  if not public.net_altara_wave_media_ref_contains_object(
    requested_media_ref, requested_account_id, null
  ) then return false; end if;
  v_payload := convert_from(decode(
    translate(substr(requested_media_ref, char_length('rpg-media:v1:') + 1), '-_', '+/')
      || repeat('=', (4 - char_length(substr(requested_media_ref, char_length('rpg-media:v1:') + 1)) % 4) % 4),
    'base64'), 'UTF8')::jsonb;
  for v_variant in
    select value from jsonb_array_elements(
      jsonb_build_array(v_payload -> 'd')
      || case when v_payload ? 't' then jsonb_build_array(v_payload -> 't') else '[]'::jsonb end
    )
  loop
    if split_part(v_variant ->> 'p', '/', 3) <> requested_media_kind
      or split_part(v_variant ->> 'p', '/', 4) <> requested_slot
    then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create or replace function public.current_user_can_read_net_altara_wave_media_object(
  requested_object_name text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
begin
  v_identity_link_id := public.current_net_effective_runtime_identity_link_id();
  if v_identity_link_id is null
    or not public.net_identity_link_can_access_service(v_identity_link_id, 'altara-wave')
    or not exists (
      select 1 from public.net_identity_app_installs as install
      where install.identity_link_id = v_identity_link_id and install.app_id = 'altara-wave'
    )
  then return false; end if;
  return requested_object_name is not null
    and split_part(requested_object_name, '/', 1) = 'altara-wave-account'
    and (
      exists (
        select 1 from public.net_altara_wave_accounts as account
        where public.net_altara_wave_account_is_currently_visible(account.id)
          and (
            public.net_altara_wave_media_ref_contains_object(account.avatar_ref, account.id, requested_object_name)
            or public.net_altara_wave_media_ref_contains_object(account.banner_ref, account.id, requested_object_name)
          )
      )
      or exists (
        select 1 from public.net_altara_wave_posts as post
        where post.status = 'published'
          and public.net_altara_wave_account_is_currently_visible(post.author_account_id)
          and public.net_altara_wave_media_ref_contains_object(
            post.media_ref, post.author_account_id, requested_object_name
          )
      )
    );
end;
$$;

create or replace function public.current_user_can_read_net_altara_wave_revision()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.net_identity_app_installs as install
    where install.identity_link_id = public.current_net_effective_runtime_identity_link_id()
      and install.app_id = 'altara-wave'
      and public.net_identity_link_can_access_service(install.identity_link_id, 'altara-wave')
  );
$$;

create or replace function public.bump_net_altara_wave_realtime()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_resource_id uuid;
  v_entity text;
begin
  v_resource_id := coalesce(
    nullif(v_row ->> 'id', '')::uuid,
    nullif(v_row ->> 'post_id', '')::uuid,
    nullif(v_row ->> 'followed_account_id', '')::uuid,
    nullif(v_row ->> 'account_id', '')::uuid
  );
  v_entity := case
    when tg_table_name = 'net_altara_wave_accounts' then 'profile'
    when tg_table_name = 'net_altara_wave_posts' then 'post'
    when tg_table_name = 'net_altara_wave_notifications' then 'notification'
    else 'engagement'
  end;
  update public.net_altara_wave_realtime_state set
    revision = revision + 1,
    content_revision = content_revision + case when v_entity = 'post' then 1 else 0 end,
    profile_revision = profile_revision + case when v_entity = 'profile' then 1 else 0 end,
    engagement_revision = engagement_revision + case when v_entity = 'engagement' then 1 else 0 end,
    notification_revision = notification_revision + case when v_entity = 'notification' then 1 else 0 end,
    last_entity = v_entity,
    last_operation = lower(tg_op),
    last_resource_id = v_resource_id,
    updated_at = timezone('utc', clock_timestamp())
  where channel = 'public';
  return null;
end;
$$;

create trigger net_altara_wave_accounts_realtime after insert or update or delete
on public.net_altara_wave_accounts for each row execute function public.bump_net_altara_wave_realtime();
create trigger net_altara_wave_posts_realtime after insert or update or delete
on public.net_altara_wave_posts for each row execute function public.bump_net_altara_wave_realtime();
create trigger net_altara_wave_follows_realtime after insert or update or delete
on public.net_altara_wave_follows for each row execute function public.bump_net_altara_wave_realtime();
create trigger net_altara_wave_reactions_realtime after insert or update or delete
on public.net_altara_wave_reactions for each row execute function public.bump_net_altara_wave_realtime();
create trigger net_altara_wave_boosts_realtime after insert or update or delete
on public.net_altara_wave_boosts for each row execute function public.bump_net_altara_wave_realtime();
create trigger net_altara_wave_bookmarks_realtime after insert or update or delete
on public.net_altara_wave_bookmarks for each row execute function public.bump_net_altara_wave_realtime();
create trigger net_altara_wave_notifications_realtime after insert or update or delete
on public.net_altara_wave_notifications for each row execute function public.bump_net_altara_wave_realtime();

create or replace function public.fetch_net_altara_wave_session(
  requested_expected_identity_link_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_account_id uuid;
begin
  v_identity_link_id := public.net_altara_wave_assert_runtime_identity(
    requested_expected_identity_link_id
  );
  select account.id into v_account_id
  from public.net_altara_wave_accounts as account
  where account.identity_link_id = v_identity_link_id
  order by account.joined_at, account.id
  limit 1;
  return jsonb_build_object(
    'identity_link_id', v_identity_link_id,
    'canonical_display_name', public.net_altara_wave_identity_display_name(v_identity_link_id),
    'unread_count', case when v_account_id is null then 0 else (
      select count(*) from public.net_altara_wave_notifications as notification
      where notification.recipient_account_id = v_account_id
        and notification.read_at is null
        and public.net_altara_wave_account_is_currently_visible(notification.actor_account_id)
    ) end,
    'account', case when v_account_id is null then null
      else public.net_altara_wave_account_payload(v_account_id, v_account_id) end
  );
end;
$$;

create or replace function public.create_net_altara_wave_account(
  requested_expected_identity_link_id uuid,
  requested_handle text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_account_id uuid;
  v_handle text := lower(btrim(coalesce(requested_handle, '')));
  v_display_name text;
begin
  v_identity_link_id := public.net_altara_wave_assert_runtime_identity(
    requested_expected_identity_link_id
  );
  select account.id into v_account_id
  from public.net_altara_wave_accounts as account
  where account.identity_link_id = v_identity_link_id
  for share;
  if found then
    return jsonb_build_object(
      'identity_link_id', v_identity_link_id,
      'canonical_display_name', public.net_altara_wave_identity_display_name(v_identity_link_id),
      'unread_count', 0,
      'account', public.net_altara_wave_account_payload(v_account_id, v_account_id)
    );
  end if;
  if v_handle !~ '^[a-z0-9][a-z0-9._-]{1,31}$' then
    raise exception 'ALTARA_WAVE_HANDLE_INVALID' using errcode = '22023';
  end if;
  perform public.consume_net_altara_wave_rate_limit('account', 1);
  if exists (
    select 1 from public.net_altara_wave_accounts as account
    where lower(account.handle) = v_handle
  ) then raise exception 'ALTARA_WAVE_HANDLE_TAKEN' using errcode = '23505'; end if;

  v_display_name := public.net_altara_wave_identity_display_name(v_identity_link_id);
  insert into public.net_altara_wave_accounts (
    identity_link_id, handle, display_name
  ) values (v_identity_link_id, v_handle, v_display_name)
  returning id into v_account_id;

  perform public.net_altara_wave_audit(
    v_identity_link_id, 'altara-wave.account.create', 'altara-wave-account', v_account_id
  );
  return jsonb_build_object(
    'identity_link_id', v_identity_link_id,
    'canonical_display_name', v_display_name,
    'unread_count', 0,
    'account', public.net_altara_wave_account_payload(v_account_id, v_account_id)
  );
exception when unique_violation then
  raise exception 'ALTARA_WAVE_HANDLE_TAKEN' using errcode = '23505';
end;
$$;

create or replace function public.update_net_altara_wave_profile(
  requested_expected_identity_link_id uuid,
  requested_expected_account_id uuid,
  requested_handle text,
  requested_display_name text,
  requested_bio text,
  requested_avatar_ref text,
  requested_banner_ref text,
  requested_location_label text,
  requested_website_url text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_account_id uuid;
  v_handle text := lower(btrim(coalesce(requested_handle, '')));
  v_display_name text := btrim(coalesce(requested_display_name, ''));
  v_bio text := btrim(coalesce(requested_bio, ''));
  v_location text := nullif(btrim(coalesce(requested_location_label, '')), '');
  v_website text := nullif(btrim(coalesce(requested_website_url, '')), '');
begin
  v_identity_link_id := public.net_altara_wave_assert_runtime_identity(
    requested_expected_identity_link_id
  );
  v_account_id := public.net_altara_wave_assert_runtime_account(
    v_identity_link_id, requested_expected_account_id
  );
  perform public.consume_net_altara_wave_rate_limit('profile', 1);
  if v_handle !~ '^[a-z0-9][a-z0-9._-]{1,31}$' then
    raise exception 'ALTARA_WAVE_HANDLE_INVALID' using errcode = '22023';
  end if;
  if char_length(v_display_name) not between 1 and 120
    or char_length(v_bio) > 240
    or (v_location is not null and char_length(v_location) > 120)
    or (v_website is not null and (
      char_length(v_website) > 500 or v_website !~* '^https://[^[:space:]]+$'
    ))
  then raise exception 'ALTARA_WAVE_PROFILE_INVALID' using errcode = '22023'; end if;
  if requested_avatar_ref is not null
    and not public.net_altara_wave_media_ref_matches_slot(
      requested_avatar_ref, v_account_id, 'avatar', 'avatar'
    )
  then raise exception 'ALTARA_WAVE_AVATAR_DESCRIPTOR_INVALID' using errcode = '22023'; end if;
  if requested_banner_ref is not null
    and not public.net_altara_wave_media_ref_matches_slot(
      requested_banner_ref, v_account_id, 'general', 'banner'
    )
  then raise exception 'ALTARA_WAVE_BANNER_DESCRIPTOR_INVALID' using errcode = '22023'; end if;
  if exists (
    select 1 from public.net_altara_wave_accounts as account
    where lower(account.handle) = v_handle and account.id <> v_account_id
  ) then raise exception 'ALTARA_WAVE_HANDLE_TAKEN' using errcode = '23505'; end if;

  update public.net_altara_wave_accounts set
    handle = v_handle,
    display_name = v_display_name,
    bio = v_bio,
    avatar_ref = requested_avatar_ref,
    banner_ref = requested_banner_ref,
    location_label = v_location,
    website_url = v_website
  where id = v_account_id;
  perform public.net_altara_wave_audit(
    v_identity_link_id, 'altara-wave.profile.update', 'altara-wave-account', v_account_id
  );
  return public.net_altara_wave_account_payload(v_account_id, v_account_id);
exception when unique_violation then
  raise exception 'ALTARA_WAVE_HANDLE_TAKEN' using errcode = '23505';
end;
$$;

create or replace function public.fetch_net_altara_wave_page(
  requested_expected_identity_link_id uuid,
  requested_expected_account_id uuid,
  requested_mode text,
  requested_profile_account_id uuid default null,
  requested_search_query text default null,
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 20
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_viewer_account_id uuid;
  v_limit integer := least(greatest(coalesce(requested_limit, 20), 1), 40);
  v_query text := lower(btrim(coalesce(requested_search_query, '')));
  v_items jsonb;
  v_has_more boolean;
begin
  v_identity_link_id := public.net_altara_wave_assert_runtime_identity(
    requested_expected_identity_link_id
  );
  v_viewer_account_id := public.net_altara_wave_assert_runtime_account(
    v_identity_link_id, requested_expected_account_id
  );
  if requested_mode not in ('home', 'explore', 'bookmarks', 'profile', 'search') then
    raise exception 'ALTARA_WAVE_FEED_MODE_INVALID' using errcode = '22023';
  end if;
  if requested_mode = 'profile' and requested_profile_account_id is null then
    raise exception 'ALTARA_WAVE_PROFILE_REQUIRED' using errcode = '22023';
  end if;
  if requested_mode = 'search' and char_length(v_query) not between 2 and 80 then
    raise exception 'ALTARA_WAVE_SEARCH_INVALID' using errcode = '22023';
  end if;

  with candidates as (
    select
      post.id,
      case
        when requested_mode = 'bookmarks' then bookmark.created_at
        when requested_mode = 'home' then greatest(
          post.created_at, coalesce(boost_activity.created_at, post.created_at)
        )
        else post.created_at
      end as sort_at,
      case when requested_mode = 'home' then boost_activity.account_id else null end as booster_account_id
    from public.net_altara_wave_posts as post
    left join public.net_altara_wave_bookmarks as bookmark
      on bookmark.account_id = v_viewer_account_id and bookmark.post_id = post.id
    left join lateral (
      select boost.account_id, boost.created_at
      from public.net_altara_wave_boosts as boost
      where boost.post_id = post.id
        and public.net_altara_wave_account_is_currently_visible(boost.account_id)
        and (
          boost.account_id = v_viewer_account_id
          or exists (
            select 1 from public.net_altara_wave_follows as followed_booster
            where followed_booster.follower_account_id = v_viewer_account_id
              and followed_booster.followed_account_id = boost.account_id
          )
        )
      order by boost.created_at desc, boost.account_id desc
      limit 1
    ) as boost_activity on true
    where post.status = 'published'
      and public.net_altara_wave_account_is_currently_visible(post.author_account_id)
      and (
        (requested_mode = 'home' and (
          post.author_account_id = v_viewer_account_id
          or exists (
            select 1 from public.net_altara_wave_follows as followed_author
            where followed_author.follower_account_id = v_viewer_account_id
              and followed_author.followed_account_id = post.author_account_id
          )
          or boost_activity.account_id is not null
        ))
        or (requested_mode = 'explore')
        or (requested_mode = 'bookmarks' and bookmark.post_id is not null)
        or (requested_mode = 'profile' and post.author_account_id = requested_profile_account_id)
        or (requested_mode = 'search' and lower(post.body) like '%' || v_query || '%')
      )
  ), cursor_filtered as (
    select candidate.* from candidates as candidate
    where requested_cursor_at is null
      or requested_cursor_id is null
      or (candidate.sort_at, candidate.id) < (requested_cursor_at, requested_cursor_id)
    order by candidate.sort_at desc, candidate.id desc
    limit v_limit + 1
  ), numbered as (
    select candidate.*, row_number() over (order by candidate.sort_at desc, candidate.id desc) as row_number
    from cursor_filtered as candidate
  )
  select
    coalesce(jsonb_agg(
      public.net_altara_wave_post_payload(
        candidate.id, v_viewer_account_id, candidate.sort_at, candidate.booster_account_id
      ) order by candidate.sort_at desc, candidate.id desc
    ) filter (where candidate.row_number <= v_limit), '[]'::jsonb),
    count(*) > v_limit
  into v_items, v_has_more
  from numbered as candidate;

  return jsonb_build_object(
    'items', v_items,
    'has_more', v_has_more,
    'next_cursor', case when jsonb_array_length(v_items) = 0 then null else jsonb_build_object(
      'sort_at', v_items -> -1 ->> 'activity_at',
      'id', v_items -> -1 ->> 'id'
    ) end
  );
end;
$$;

create or replace function public.fetch_net_altara_wave_thread_page(
  requested_expected_identity_link_id uuid,
  requested_expected_account_id uuid,
  requested_root_post_id uuid,
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 30
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_viewer_account_id uuid;
  v_limit integer := least(greatest(coalesce(requested_limit, 30), 1), 40);
  v_root_id uuid;
  v_items jsonb;
  v_has_more boolean;
begin
  v_identity_link_id := public.net_altara_wave_assert_runtime_identity(
    requested_expected_identity_link_id
  );
  v_viewer_account_id := public.net_altara_wave_assert_runtime_account(
    v_identity_link_id, requested_expected_account_id
  );
  select post.id into v_root_id
  from public.net_altara_wave_posts as post
  where post.id = requested_root_post_id
    and post.parent_post_id is null
    and public.net_altara_wave_account_is_currently_visible(post.author_account_id);
  if not found then raise exception 'ALTARA_WAVE_POST_NOT_AVAILABLE' using errcode = '42501'; end if;

  with candidates as (
    select reply.id, reply.created_at as sort_at
    from public.net_altara_wave_posts as reply
    where reply.root_post_id = v_root_id
      and public.net_altara_wave_account_is_currently_visible(reply.author_account_id)
      and (
        requested_cursor_at is null or requested_cursor_id is null
        or (reply.created_at, reply.id) > (requested_cursor_at, requested_cursor_id)
      )
    order by reply.created_at, reply.id
    limit v_limit + 1
  ), numbered as (
    select candidate.*, row_number() over (order by candidate.sort_at, candidate.id) as row_number
    from candidates as candidate
  )
  select
    coalesce(jsonb_agg(
      public.net_altara_wave_post_payload(candidate.id, v_viewer_account_id, candidate.sort_at, null)
      order by candidate.sort_at, candidate.id
    ) filter (where candidate.row_number <= v_limit), '[]'::jsonb),
    count(*) > v_limit
  into v_items, v_has_more
  from numbered as candidate;

  return jsonb_build_object(
    'root', public.net_altara_wave_post_payload(v_root_id, v_viewer_account_id, null, null),
    'replies', v_items,
    'has_more', v_has_more,
    'next_cursor', case when jsonb_array_length(v_items) = 0 then null else jsonb_build_object(
      'sort_at', v_items -> -1 ->> 'created_at',
      'id', v_items -> -1 ->> 'id'
    ) end
  );
end;
$$;

create or replace function public.create_net_altara_wave_post(
  requested_expected_identity_link_id uuid,
  requested_expected_account_id uuid,
  requested_request_key uuid,
  requested_body text,
  requested_parent_post_id uuid default null,
  requested_media_ref text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_account_id uuid;
  v_body text := btrim(coalesce(requested_body, ''));
  v_fingerprint text;
  v_existing public.net_altara_wave_posts%rowtype;
  v_parent public.net_altara_wave_posts%rowtype;
  v_root_id uuid;
  v_post_id uuid := gen_random_uuid();
  v_mention_handle text;
  v_mentioned_account_id uuid;
begin
  v_identity_link_id := public.net_altara_wave_assert_runtime_identity(
    requested_expected_identity_link_id
  );
  v_account_id := public.net_altara_wave_assert_runtime_account(
    v_identity_link_id, requested_expected_account_id
  );
  if requested_request_key is null then
    raise exception 'ALTARA_WAVE_REQUEST_KEY_REQUIRED' using errcode = '22023';
  end if;
  if char_length(v_body) > 360 or (v_body = '' and requested_media_ref is null) then
    raise exception 'ALTARA_WAVE_POST_INVALID' using errcode = '22023';
  end if;
  if requested_media_ref is not null and not public.net_altara_wave_media_ref_matches_slot(
    requested_media_ref, v_account_id, 'general', 'post-' || requested_request_key::text
  ) then raise exception 'ALTARA_WAVE_POST_MEDIA_INVALID' using errcode = '22023'; end if;

  v_fingerprint := encode(digest(
    v_account_id::text || '|' || requested_request_key::text || '|'
    || coalesce(requested_parent_post_id::text, '') || '|' || v_body || '|'
    || coalesce(requested_media_ref, ''), 'sha256'
  ), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'altara-wave-post:' || v_account_id::text || ':' || requested_request_key::text, 0
  ));
  select post.* into v_existing
  from public.net_altara_wave_posts as post
  where post.author_account_id = v_account_id
    and post.request_key = requested_request_key
  for share;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception 'ALTARA_WAVE_IDEMPOTENCY_MISMATCH' using errcode = '23505';
    end if;
    return public.net_altara_wave_post_payload(
      v_existing.id, v_account_id, v_existing.created_at, null
    );
  end if;
  perform public.consume_net_altara_wave_rate_limit('post', 1);

  if requested_parent_post_id is not null then
    select post.* into v_parent
    from public.net_altara_wave_posts as post
    where post.id = requested_parent_post_id
      and post.status = 'published'
      and public.net_altara_wave_account_is_currently_visible(post.author_account_id)
    for share;
    if not found then raise exception 'ALTARA_WAVE_POST_NOT_AVAILABLE' using errcode = '42501'; end if;
    v_root_id := coalesce(v_parent.root_post_id, v_parent.id);
  end if;

  insert into public.net_altara_wave_posts (
    id, author_account_id, parent_post_id, root_post_id,
    request_key, request_fingerprint, body, media_ref
  ) values (
    v_post_id, v_account_id, requested_parent_post_id, v_root_id,
    requested_request_key, v_fingerprint, v_body, requested_media_ref
  );

  if requested_parent_post_id is not null and v_parent.author_account_id <> v_account_id then
    insert into public.net_altara_wave_notifications (
      recipient_account_id, actor_account_id, notification_type, post_id
    ) values (v_parent.author_account_id, v_account_id, 'reply', v_post_id)
    on conflict do nothing;
  end if;

  for v_mention_handle in
    select lower(capture[2])
    from regexp_matches(
      v_body,
      '(^|[^a-zA-Z0-9._-])@([a-zA-Z0-9][a-zA-Z0-9._-]{1,31})',
      'g'
    ) as match_row(capture)
    group by lower(capture[2])
    order by min(lower(capture[2]))
    limit 10
  loop
    select account.id into v_mentioned_account_id
    from public.net_altara_wave_accounts as account
    where lower(account.handle) = v_mention_handle
      and public.net_altara_wave_account_is_currently_visible(account.id);
    if found then
      insert into public.net_altara_wave_post_mentions (
        post_id, mentioned_account_id, source_handle
      ) values (v_post_id, v_mentioned_account_id, v_mention_handle)
      on conflict do nothing;
      if v_mentioned_account_id <> v_account_id then
        insert into public.net_altara_wave_notifications (
          recipient_account_id, actor_account_id, notification_type, post_id
        ) values (v_mentioned_account_id, v_account_id, 'mention', v_post_id)
        on conflict do nothing;
      end if;
    end if;
  end loop;

  perform public.net_altara_wave_audit(
    v_identity_link_id,
    case when requested_parent_post_id is null then 'altara-wave.post.create' else 'altara-wave.reply.create' end,
    'altara-wave-post', v_post_id
  );
  return public.net_altara_wave_post_payload(v_post_id, v_account_id, null, null);
end;
$$;

create or replace function public.delete_net_altara_wave_post(
  requested_expected_identity_link_id uuid,
  requested_expected_account_id uuid,
  requested_post_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_account_id uuid;
  v_post public.net_altara_wave_posts%rowtype;
begin
  v_identity_link_id := public.net_altara_wave_assert_runtime_identity(requested_expected_identity_link_id);
  v_account_id := public.net_altara_wave_assert_runtime_account(v_identity_link_id, requested_expected_account_id);
  perform public.consume_net_altara_wave_rate_limit('delete', 1);
  select post.* into v_post from public.net_altara_wave_posts as post
  where post.id = requested_post_id for update;
  if not found or v_post.author_account_id <> v_account_id then
    raise exception 'ALTARA_WAVE_POST_NOT_AVAILABLE' using errcode = '42501';
  end if;
  if v_post.status = 'published' then
    update public.net_altara_wave_posts set
      status = 'deleted', body = '', media_ref = null,
      deleted_at = timezone('utc', clock_timestamp())
    where id = v_post.id;
    perform public.net_altara_wave_audit(
      v_identity_link_id, 'altara-wave.post.delete', 'altara-wave-post', v_post.id
    );
  end if;
  return v_post.id;
end;
$$;

create or replace function public.set_net_altara_wave_follow(
  requested_expected_identity_link_id uuid,
  requested_expected_account_id uuid,
  requested_target_account_id uuid,
  requested_following boolean
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_identity_link_id uuid; v_account_id uuid;
begin
  v_identity_link_id := public.net_altara_wave_assert_runtime_identity(requested_expected_identity_link_id);
  v_account_id := public.net_altara_wave_assert_runtime_account(v_identity_link_id, requested_expected_account_id);
  if requested_following is null or requested_target_account_id is null
    or requested_target_account_id = v_account_id
    or not public.net_altara_wave_account_is_currently_visible(requested_target_account_id)
  then raise exception 'ALTARA_WAVE_FOLLOW_TARGET_INVALID' using errcode = '22023'; end if;
  perform public.consume_net_altara_wave_rate_limit('follow', 1);
  if requested_following then
    insert into public.net_altara_wave_follows (follower_account_id, followed_account_id)
    values (v_account_id, requested_target_account_id) on conflict do nothing;
    insert into public.net_altara_wave_notifications (
      recipient_account_id, actor_account_id, notification_type
    ) values (requested_target_account_id, v_account_id, 'follow') on conflict do nothing;
  else
    delete from public.net_altara_wave_follows
    where follower_account_id = v_account_id and followed_account_id = requested_target_account_id;
  end if;
  perform public.net_altara_wave_audit(
    v_identity_link_id,
    case when requested_following then 'altara-wave.follow.add' else 'altara-wave.follow.remove' end,
    'altara-wave-account', requested_target_account_id
  );
  return requested_following;
end;
$$;

create or replace function public.set_net_altara_wave_reaction(
  requested_expected_identity_link_id uuid,
  requested_expected_account_id uuid,
  requested_post_id uuid,
  requested_reacted boolean
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_identity_link_id uuid; v_account_id uuid; v_author_account_id uuid;
begin
  v_identity_link_id := public.net_altara_wave_assert_runtime_identity(requested_expected_identity_link_id);
  v_account_id := public.net_altara_wave_assert_runtime_account(v_identity_link_id, requested_expected_account_id);
  select post.author_account_id into v_author_account_id
  from public.net_altara_wave_posts as post
  where post.id = requested_post_id and post.status = 'published'
    and public.net_altara_wave_account_is_currently_visible(post.author_account_id)
  for share;
  if not found or requested_reacted is null then raise exception 'ALTARA_WAVE_POST_NOT_AVAILABLE' using errcode = '42501'; end if;
  perform public.consume_net_altara_wave_rate_limit('engagement', 1);
  if requested_reacted then
    insert into public.net_altara_wave_reactions (account_id, post_id)
    values (v_account_id, requested_post_id) on conflict do nothing;
    if v_author_account_id <> v_account_id then
      insert into public.net_altara_wave_notifications (
        recipient_account_id, actor_account_id, notification_type, post_id
      ) values (v_author_account_id, v_account_id, 'reaction', requested_post_id)
      on conflict do nothing;
    end if;
  else
    delete from public.net_altara_wave_reactions
    where account_id = v_account_id and post_id = requested_post_id;
  end if;
  perform public.net_altara_wave_audit(
    v_identity_link_id,
    case when requested_reacted then 'altara-wave.reaction.add' else 'altara-wave.reaction.remove' end,
    'altara-wave-post', requested_post_id
  );
  return requested_reacted;
end;
$$;

create or replace function public.set_net_altara_wave_boost(
  requested_expected_identity_link_id uuid,
  requested_expected_account_id uuid,
  requested_post_id uuid,
  requested_boosted boolean
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_identity_link_id uuid; v_account_id uuid; v_author_account_id uuid;
begin
  v_identity_link_id := public.net_altara_wave_assert_runtime_identity(requested_expected_identity_link_id);
  v_account_id := public.net_altara_wave_assert_runtime_account(v_identity_link_id, requested_expected_account_id);
  select post.author_account_id into v_author_account_id
  from public.net_altara_wave_posts as post
  where post.id = requested_post_id and post.status = 'published'
    and public.net_altara_wave_account_is_currently_visible(post.author_account_id)
  for share;
  if not found or requested_boosted is null then raise exception 'ALTARA_WAVE_POST_NOT_AVAILABLE' using errcode = '42501'; end if;
  perform public.consume_net_altara_wave_rate_limit('engagement', 1);
  if requested_boosted then
    insert into public.net_altara_wave_boosts (account_id, post_id)
    values (v_account_id, requested_post_id) on conflict do nothing;
    if v_author_account_id <> v_account_id then
      insert into public.net_altara_wave_notifications (
        recipient_account_id, actor_account_id, notification_type, post_id
      ) values (v_author_account_id, v_account_id, 'boost', requested_post_id)
      on conflict do nothing;
    end if;
  else
    delete from public.net_altara_wave_boosts
    where account_id = v_account_id and post_id = requested_post_id;
  end if;
  perform public.net_altara_wave_audit(
    v_identity_link_id,
    case when requested_boosted then 'altara-wave.boost.add' else 'altara-wave.boost.remove' end,
    'altara-wave-post', requested_post_id
  );
  return requested_boosted;
end;
$$;

create or replace function public.set_net_altara_wave_bookmark(
  requested_expected_identity_link_id uuid,
  requested_expected_account_id uuid,
  requested_post_id uuid,
  requested_bookmarked boolean
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_identity_link_id uuid; v_account_id uuid;
begin
  v_identity_link_id := public.net_altara_wave_assert_runtime_identity(requested_expected_identity_link_id);
  v_account_id := public.net_altara_wave_assert_runtime_account(v_identity_link_id, requested_expected_account_id);
  if requested_bookmarked is null or not exists (
    select 1 from public.net_altara_wave_posts as post
    where post.id = requested_post_id and post.status = 'published'
      and public.net_altara_wave_account_is_currently_visible(post.author_account_id)
  ) then raise exception 'ALTARA_WAVE_POST_NOT_AVAILABLE' using errcode = '42501'; end if;
  perform public.consume_net_altara_wave_rate_limit('engagement', 1);
  if requested_bookmarked then
    insert into public.net_altara_wave_bookmarks (account_id, post_id)
    values (v_account_id, requested_post_id) on conflict do nothing;
  else
    delete from public.net_altara_wave_bookmarks
    where account_id = v_account_id and post_id = requested_post_id;
  end if;
  perform public.net_altara_wave_audit(
    v_identity_link_id,
    case when requested_bookmarked then 'altara-wave.bookmark.add' else 'altara-wave.bookmark.remove' end,
    'altara-wave-post', requested_post_id
  );
  return requested_bookmarked;
end;
$$;

create or replace function public.fetch_net_altara_wave_accounts(
  requested_expected_identity_link_id uuid,
  requested_expected_account_id uuid,
  requested_query text default null,
  requested_account_id uuid default null,
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 20
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_viewer_account_id uuid;
  v_query text := lower(btrim(coalesce(requested_query, '')));
  v_limit integer := least(greatest(coalesce(requested_limit, 20), 1), 40);
  v_items jsonb;
  v_has_more boolean;
begin
  v_identity_link_id := public.net_altara_wave_assert_runtime_identity(requested_expected_identity_link_id);
  v_viewer_account_id := public.net_altara_wave_assert_runtime_account(v_identity_link_id, requested_expected_account_id);
  if requested_query is not null and char_length(v_query) not between 2 and 80 then
    raise exception 'ALTARA_WAVE_SEARCH_INVALID' using errcode = '22023';
  end if;
  with candidates as (
    select account.id, account.joined_at as sort_at
    from public.net_altara_wave_accounts as account
    where public.net_altara_wave_account_is_currently_visible(account.id)
      and (
        requested_account_id is not null and account.id = requested_account_id
        or requested_account_id is null and (
          v_query = '' or lower(account.handle) like '%' || v_query || '%'
          or lower(account.display_name) like '%' || v_query || '%'
        )
      )
      and (
        requested_account_id is not null
        or account.id <> v_viewer_account_id
      )
      and (
        requested_cursor_at is null or requested_cursor_id is null
        or (account.joined_at, account.id) < (requested_cursor_at, requested_cursor_id)
      )
    order by account.joined_at desc, account.id desc
    limit v_limit + 1
  ), numbered as (
    select candidate.*, row_number() over (order by candidate.sort_at desc, candidate.id desc) as row_number
    from candidates as candidate
  )
  select
    coalesce(jsonb_agg(
      public.net_altara_wave_account_payload(candidate.id, v_viewer_account_id)
        || jsonb_build_object('relationship_at', candidate.sort_at)
      order by candidate.sort_at desc, candidate.id desc
    ) filter (where candidate.row_number <= v_limit), '[]'::jsonb),
    count(*) > v_limit
  into v_items, v_has_more
  from numbered as candidate;
  return jsonb_build_object(
    'items', v_items,
    'has_more', v_has_more,
    'next_cursor', case when jsonb_array_length(v_items) = 0 then null else jsonb_build_object(
      'sort_at', v_items -> -1 ->> 'joined_at', 'id', v_items -> -1 ->> 'id'
    ) end
  );
end;
$$;

create or replace function public.fetch_net_altara_wave_relationship_page(
  requested_expected_identity_link_id uuid,
  requested_expected_account_id uuid,
  requested_profile_account_id uuid,
  requested_direction text,
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 30
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_viewer_account_id uuid;
  v_limit integer := least(greatest(coalesce(requested_limit, 30), 1), 40);
  v_items jsonb;
  v_has_more boolean;
begin
  v_identity_link_id := public.net_altara_wave_assert_runtime_identity(requested_expected_identity_link_id);
  v_viewer_account_id := public.net_altara_wave_assert_runtime_account(v_identity_link_id, requested_expected_account_id);
  if requested_direction not in ('followers', 'following')
    or not public.net_altara_wave_account_is_currently_visible(requested_profile_account_id)
  then raise exception 'ALTARA_WAVE_RELATIONSHIP_REQUEST_INVALID' using errcode = '22023'; end if;
  with candidates as (
    select
      case when requested_direction = 'followers'
        then follow.follower_account_id else follow.followed_account_id end as id,
      follow.created_at as sort_at
    from public.net_altara_wave_follows as follow
    where (
      requested_direction = 'followers' and follow.followed_account_id = requested_profile_account_id
      or requested_direction = 'following' and follow.follower_account_id = requested_profile_account_id
    )
      and public.net_altara_wave_account_is_currently_visible(
        case when requested_direction = 'followers'
          then follow.follower_account_id else follow.followed_account_id end
      )
      and (
        requested_cursor_at is null or requested_cursor_id is null
        or (follow.created_at,
          case when requested_direction = 'followers'
            then follow.follower_account_id else follow.followed_account_id end
        ) < (requested_cursor_at, requested_cursor_id)
      )
    order by follow.created_at desc,
      case when requested_direction = 'followers'
        then follow.follower_account_id else follow.followed_account_id end desc
    limit v_limit + 1
  ), numbered as (
    select candidate.*, row_number() over (order by candidate.sort_at desc, candidate.id desc) as row_number
    from candidates as candidate
  )
  select
    coalesce(jsonb_agg(
      public.net_altara_wave_account_payload(candidate.id, v_viewer_account_id)
        || jsonb_build_object('relationship_at', candidate.sort_at)
      order by candidate.sort_at desc, candidate.id desc
    ) filter (where candidate.row_number <= v_limit), '[]'::jsonb),
    count(*) > v_limit
  into v_items, v_has_more from numbered as candidate;
  return jsonb_build_object(
    'items', v_items,
    'has_more', v_has_more,
    'next_cursor', case when jsonb_array_length(v_items) = 0 then null else jsonb_build_object(
      'sort_at', v_items -> -1 ->> 'relationship_at',
      'id', v_items -> -1 ->> 'id'
    ) end
  );
end;
$$;

create or replace function public.fetch_net_altara_wave_notification_page(
  requested_expected_identity_link_id uuid,
  requested_expected_account_id uuid,
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 20
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_account_id uuid;
  v_limit integer := least(greatest(coalesce(requested_limit, 20), 1), 40);
  v_items jsonb;
  v_has_more boolean;
  v_unread bigint;
begin
  v_identity_link_id := public.net_altara_wave_assert_runtime_identity(requested_expected_identity_link_id);
  v_account_id := public.net_altara_wave_assert_runtime_account(v_identity_link_id, requested_expected_account_id);
  with candidates as (
    select notification.*
    from public.net_altara_wave_notifications as notification
    where notification.recipient_account_id = v_account_id
      and public.net_altara_wave_account_is_currently_visible(notification.actor_account_id)
      and (
        requested_cursor_at is null or requested_cursor_id is null
        or (notification.created_at, notification.id) < (requested_cursor_at, requested_cursor_id)
      )
    order by notification.created_at desc, notification.id desc
    limit v_limit + 1
  ), numbered as (
    select candidate.*, row_number() over (order by candidate.created_at desc, candidate.id desc) as row_number
    from candidates as candidate
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', candidate.id,
      'notification_type', candidate.notification_type,
      'actor', public.net_altara_wave_account_payload(candidate.actor_account_id, v_account_id),
      'post_id', candidate.post_id,
      'root_post_id', case when post.parent_post_id is null then post.id else post.root_post_id end,
      'post_excerpt', case when post.status = 'published' then left(post.body, 160) else null end,
      'post_available', post.id is not null and post.status = 'published'
        and public.net_altara_wave_account_is_currently_visible(post.author_account_id),
      'created_at', candidate.created_at,
      'read_at', candidate.read_at
    ) order by candidate.created_at desc, candidate.id desc)
      filter (where candidate.row_number <= v_limit), '[]'::jsonb),
    count(*) > v_limit
  into v_items, v_has_more
  from numbered as candidate
  left join public.net_altara_wave_posts as post on post.id = candidate.post_id;

  select count(*) into v_unread
  from public.net_altara_wave_notifications as notification
  where notification.recipient_account_id = v_account_id
    and notification.read_at is null
    and public.net_altara_wave_account_is_currently_visible(notification.actor_account_id);

  return jsonb_build_object(
    'items', v_items,
    'has_more', v_has_more,
    'unread_count', v_unread,
    'next_cursor', case when jsonb_array_length(v_items) = 0 then null else jsonb_build_object(
      'sort_at', v_items -> -1 ->> 'created_at', 'id', v_items -> -1 ->> 'id'
    ) end
  );
end;
$$;

create or replace function public.mark_net_altara_wave_notifications_read(
  requested_expected_identity_link_id uuid,
  requested_expected_account_id uuid,
  requested_notification_id uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_account_id uuid;
  v_count integer;
begin
  v_identity_link_id := public.net_altara_wave_assert_runtime_identity(requested_expected_identity_link_id);
  v_account_id := public.net_altara_wave_assert_runtime_account(v_identity_link_id, requested_expected_account_id);
  update public.net_altara_wave_notifications set read_at = timezone('utc', clock_timestamp())
  where recipient_account_id = v_account_id
    and read_at is null
    and (requested_notification_id is null or id = requested_notification_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

do $security$
declare v_table text;
begin
  foreach v_table in array array[
    'net_altara_wave_accounts',
    'net_altara_wave_posts',
    'net_altara_wave_post_mentions',
    'net_altara_wave_follows',
    'net_altara_wave_reactions',
    'net_altara_wave_boosts',
    'net_altara_wave_bookmarks',
    'net_altara_wave_notifications',
    'net_altara_wave_rate_limits',
    'net_altara_wave_realtime_state'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
  end loop;
end;
$security$;

create policy net_altara_wave_realtime_select_authorized
on public.net_altara_wave_realtime_state
for select to authenticated
using (public.current_user_can_read_net_altara_wave_revision());
grant select on public.net_altara_wave_realtime_state to authenticated;

drop policy if exists rpg_media_altara_wave_select_authorized on storage.objects;
drop policy if exists rpg_media_altara_wave_insert_authorized on storage.objects;
drop policy if exists rpg_media_altara_wave_update_authorized on storage.objects;
drop policy if exists rpg_media_altara_wave_delete_authorized on storage.objects;

create policy rpg_media_altara_wave_select_authorized on storage.objects
for select to authenticated using (
  bucket_id = 'rpg-media'
  and (
    public.current_user_can_read_net_altara_wave_media_object(name)
    or public.current_user_can_delete_net_altara_wave_media_object(name)
  )
);
create policy rpg_media_altara_wave_insert_authorized on storage.objects
for insert to authenticated with check (
  bucket_id = 'rpg-media'
  and public.current_user_can_write_net_altara_wave_media_object(name)
);
create policy rpg_media_altara_wave_delete_authorized on storage.objects
for delete to authenticated using (
  bucket_id = 'rpg-media'
  and public.current_user_can_delete_net_altara_wave_media_object(name)
);

do $revoke$
declare v_signature regprocedure;
begin
  for v_signature in
    select procedure_row.oid::regprocedure
    from pg_proc as procedure_row
    join pg_namespace as namespace_row on namespace_row.oid = procedure_row.pronamespace
    where namespace_row.nspname = 'public'
      and (
        procedure_row.proname like '%net_altara_wave%'
        or procedure_row.proname = 'consume_net_altara_wave_rate_limit'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_signature);
  end loop;
end;
$revoke$;

grant execute on function public.fetch_net_altara_wave_session(uuid) to authenticated;
grant execute on function public.create_net_altara_wave_account(uuid,text) to authenticated;
grant execute on function public.update_net_altara_wave_profile(uuid,uuid,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.fetch_net_altara_wave_page(uuid,uuid,text,uuid,text,timestamptz,uuid,integer) to authenticated;
grant execute on function public.fetch_net_altara_wave_thread_page(uuid,uuid,uuid,timestamptz,uuid,integer) to authenticated;
grant execute on function public.create_net_altara_wave_post(uuid,uuid,uuid,text,uuid,text) to authenticated;
grant execute on function public.delete_net_altara_wave_post(uuid,uuid,uuid) to authenticated;
grant execute on function public.set_net_altara_wave_follow(uuid,uuid,uuid,boolean) to authenticated;
grant execute on function public.set_net_altara_wave_reaction(uuid,uuid,uuid,boolean) to authenticated;
grant execute on function public.set_net_altara_wave_boost(uuid,uuid,uuid,boolean) to authenticated;
grant execute on function public.set_net_altara_wave_bookmark(uuid,uuid,uuid,boolean) to authenticated;
grant execute on function public.fetch_net_altara_wave_accounts(uuid,uuid,text,uuid,timestamptz,uuid,integer) to authenticated;
grant execute on function public.fetch_net_altara_wave_relationship_page(uuid,uuid,uuid,text,timestamptz,uuid,integer) to authenticated;
grant execute on function public.fetch_net_altara_wave_notification_page(uuid,uuid,timestamptz,uuid,integer) to authenticated;
grant execute on function public.mark_net_altara_wave_notifications_read(uuid,uuid,uuid) to authenticated;
grant execute on function public.current_user_can_read_net_altara_wave_revision() to authenticated;
grant execute on function public.current_user_can_write_net_altara_wave_media_object(text) to authenticated;
grant execute on function public.current_user_can_delete_net_altara_wave_media_object(text) to authenticated;
grant execute on function public.current_user_can_read_net_altara_wave_media_object(text) to authenticated;

revoke all on function public.set_net_identity_app_install(uuid,text,boolean)
  from public, anon, authenticated;
grant execute on function public.set_net_identity_app_install(uuid,text,boolean)
  to authenticated;

do $publication$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'net_altara_wave_realtime_state'
  ) then
    alter publication supabase_realtime
      add table public.net_altara_wave_realtime_state;
  end if;
end;
$publication$;

comment on table public.net_altara_wave_accounts is
  'WAVE-owned social identities. They are separate from PULSE and remain preserved while an identity is wrong-OS/dormant.';
comment on table public.net_altara_wave_realtime_state is
  'The sole WAVE Realtime publication: metadata-only revision invalidation, never raw social rows.';
comment on function public.net_altara_wave_account_is_currently_visible(uuid) is
  'Target visibility only: active WAVE account plus current ALTARA/WAVE service eligibility. It is never actor authority and intentionally ignores launcher install state.';

commit;
