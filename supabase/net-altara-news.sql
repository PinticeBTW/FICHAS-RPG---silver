-- ALTARA NEWS V1: global, multi-city editorial product for ALTARA OS.
-- Run once after the deployed Multi-OS, GM control, ALTARA ecosystem, and
-- net_action_audit migrations. This migration creates no editorial content.

begin;

do $$
declare
  v_install_constraint_definition text;
  v_install_allowed_app_ids text[];
begin
  if to_regclass('public.profiles') is null
    or to_regclass('public.net_identity_links') is null
    or to_regclass('public.net_active_identities') is null
    or to_regclass('public.net_identity_os_assignments') is null
    or to_regclass('public.net_os_families') is null
    or to_regclass('public.net_os_service_scopes') is null
    or to_regclass('public.net_identity_app_installs') is null
    or to_regclass('public.net_app_account_policies') is null
    or to_regclass('public.net_gm_persona_sessions') is null
    or to_regclass('public.net_gm_identity_directory_summaries') is null
    or to_regclass('public.net_action_audit') is null
    or to_regprocedure('public.is_current_user_gm()') is null
    or to_regprocedure('public.current_user_controls_playable_net_identity_link(uuid)') is null
    or to_regprocedure('public.net_identity_link_can_access_service(uuid,text)') is null
    or to_regprocedure('public.assert_net_identity_service_access(uuid,text)') is null
    or to_regprocedure('public.set_net_identity_app_install(uuid,text,boolean)') is null
    or to_regprocedure('public.set_updated_at()') is null
    or to_regtype('public.app_role') is null
  then
    raise exception 'ALTARA_NEWS_DEPENDENCY_REQUIRED' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_constraint as table_constraint
    where table_constraint.conrelid = 'public.net_identity_app_installs'::regclass
      and table_constraint.contype = 'p'
      and pg_get_constraintdef(table_constraint.oid) =
        'PRIMARY KEY (identity_link_id, app_id)'
  ) then
    raise exception 'ALTARA_NEWS_DEPENDENCY_REQUIRED' using errcode = '55000';
  end if;

  select pg_get_constraintdef(table_constraint.oid, true)
  into v_install_constraint_definition
  from pg_constraint as table_constraint
  where table_constraint.conrelid = 'public.net_identity_app_installs'::regclass
    and table_constraint.conname = 'net_identity_app_installs_app_id_check'
    and table_constraint.contype = 'c';

  if v_install_constraint_definition is null then
    raise exception 'ALTARA_NEWS_DEPENDENCY_REQUIRED' using errcode = '55000';
  end if;

  select array_agg((capture)[1] order by (capture)[1])
  into v_install_allowed_app_ids
  from regexp_matches(
    v_install_constraint_definition,
    '''([^'']+)''',
    'g'
  ) as matched(capture);

  if v_install_allowed_app_ids is distinct from array[
    'altara-bank', 'echo', 'nvn', 'pulse', 'shneider-bank', 'vox-bank'
  ]::text[] then
    raise exception 'ALTARA_NEWS_DEPENDENCY_REQUIRED' using errcode = '55000';
  end if;
end;
$$;

insert into public.net_os_service_scopes (service_id, scope_kind, required_os_id)
values ('altara-news', 'primary-os', 'altara')
on conflict (service_id) do update set
  scope_kind = excluded.scope_kind,
  required_os_id = excluded.required_os_id,
  updated_at = timezone('utc', now());

insert into public.net_app_account_policies (app_id, account_mode, account_available)
values ('altara-news', 'none', false)
on conflict (app_id) do update set
  account_mode = excluded.account_mode,
  account_available = excluded.account_available,
  updated_at = timezone('utc', now());

-- Keep the deployed six-app domain byte-for-behavior and add only NEWS.
alter table public.net_identity_app_installs
  drop constraint if exists net_identity_app_installs_app_id_check;
alter table public.net_identity_app_installs
  add constraint net_identity_app_installs_app_id_check
  check (app_id in (
    'echo', 'pulse', 'nvn', 'vox-bank', 'shneider-bank',
    'altara-bank', 'altara-news'
  )) not valid;
alter table public.net_identity_app_installs
  validate constraint net_identity_app_installs_app_id_check;

create or replace function public.set_net_identity_app_install(
  requested_identity_link_id uuid,
  requested_app_id text,
  requested_installed boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if requested_identity_link_id is null
    or not public.current_user_controls_playable_net_identity_link(
      requested_identity_link_id
    )
  then
    raise exception 'The requested playable identity is not controlled by this account.'
      using errcode = '42501';
  end if;
  if requested_app_id is null
    or requested_app_id not in (
      'echo',
      'pulse',
      'nvn',
      'vox-bank',
      'shneider-bank',
      'altara-bank',
      'altara-news'
    )
  then
    raise exception 'This application is not an installable optional OS module.'
      using errcode = '22023';
  end if;
  if requested_installed is null then
    raise exception 'Installation state is required.' using errcode = '22023';
  end if;

  -- The central scope registry is the install authority. Stale rows from a
  -- previous OS remain stored but cannot be read, launched, or recreated
  -- through this RPC under the wrong primary OS.
  perform public.assert_net_identity_service_access(
    requested_identity_link_id,
    requested_app_id
  );

  if requested_installed then
    insert into public.net_identity_app_installs (identity_link_id, app_id)
    values (requested_identity_link_id, requested_app_id)
    on conflict (identity_link_id, app_id) do update
    set updated_at = timezone('utc', now());
  else
    delete from public.net_identity_app_installs
    where identity_link_id = requested_identity_link_id
      and app_id = requested_app_id;
  end if;

  return requested_installed;
end;
$$;

create table public.net_altara_news_articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  section text not null
    check (section in ('world', 'business', 'technology', 'culture')),
  coverage_scope text not null default 'world'
    check (coverage_scope in ('world', 'local')),
  priority text not null default 'standard'
    check (priority in ('standard', 'breaking')),
  headline text not null,
  deck text,
  body text not null,
  author_label text not null,
  source_label text,
  location_label text,
  featured boolean not null default false,
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  published_at timestamptz,
  archived_at timestamptz,
  constraint net_altara_news_articles_slug_shape check (
    slug = lower(btrim(slug))
    and char_length(slug) between 1 and 100
    and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  constraint net_altara_news_articles_headline_shape check (
    headline = btrim(headline) and char_length(headline) between 1 and 180
  ),
  constraint net_altara_news_articles_deck_shape check (
    deck is null or (deck = btrim(deck) and char_length(deck) between 1 and 400)
  ),
  constraint net_altara_news_articles_body_shape check (
    body = btrim(body) and char_length(body) between 1 and 16000
  ),
  constraint net_altara_news_articles_author_shape check (
    author_label = btrim(author_label) and char_length(author_label) between 1 and 100
  ),
  constraint net_altara_news_articles_source_shape check (
    source_label is null
    or (source_label = btrim(source_label) and char_length(source_label) between 1 and 120)
  ),
  constraint net_altara_news_articles_location_shape check (
    (coverage_scope = 'world' and location_label is null)
    or (
      coverage_scope = 'local'
      and location_label = btrim(location_label)
      and char_length(location_label) between 1 and 120
    )
  ),
  constraint net_altara_news_articles_lifecycle_shape check (
    (status = 'draft' and published_at is null and archived_at is null)
    or (status = 'published' and published_at is not null and archived_at is null)
    or (status = 'archived' and archived_at is not null)
  )
);

comment on table public.net_altara_news_articles is
  'Private ALTARA NEWS editorial records. Location is descriptive feed metadata and never authorization authority.';
comment on column public.net_altara_news_articles.body is
  'Bounded plain text. Clients never render this field as trusted HTML.';

create index net_altara_news_articles_published_cursor_idx
  on public.net_altara_news_articles (published_at desc, id desc)
  where status = 'published';
create index net_altara_news_articles_coverage_cursor_idx
  on public.net_altara_news_articles (coverage_scope, published_at desc, id desc)
  where status = 'published';
create index net_altara_news_articles_section_cursor_idx
  on public.net_altara_news_articles (section, published_at desc, id desc)
  where status = 'published';
create index net_altara_news_articles_local_cursor_idx
  on public.net_altara_news_articles (lower(location_label), published_at desc, id desc)
  where status = 'published' and coverage_scope = 'local';
create index net_altara_news_articles_gm_directory_idx
  on public.net_altara_news_articles (status, updated_at desc, id desc);

drop trigger if exists net_altara_news_articles_set_updated_at
  on public.net_altara_news_articles;
create trigger net_altara_news_articles_set_updated_at
before update on public.net_altara_news_articles
for each row execute procedure public.set_updated_at();

-- Schema support is reserved for the existing private rpg-media descriptor
-- format. V1 intentionally exposes no media-write RPC or Storage policy: the
-- shipped newsroom is text-first and cannot weaken private object authority.
create table public.net_altara_news_article_media (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null
    references public.net_altara_news_articles (id) on delete cascade,
  media_kind text not null check (media_kind in ('hero', 'gallery')),
  media_ref text not null,
  caption text,
  ordinal smallint not null default 0 check (ordinal between 0 and 11),
  created_at timestamptz not null default timezone('utc', now()),
  constraint net_altara_news_article_media_ref_shape check (
    media_ref like 'rpg-media:v1:%' and char_length(media_ref) between 16 and 4096
  ),
  constraint net_altara_news_article_media_caption_shape check (
    caption is null or (caption = btrim(caption) and char_length(caption) between 1 and 240)
  ),
  constraint net_altara_news_article_media_slot_unique unique (article_id, ordinal)
);
create unique index net_altara_news_article_media_one_hero_idx
  on public.net_altara_news_article_media (article_id)
  where media_kind = 'hero';

create table public.net_altara_news_incidents (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'draft'
    check (status in ('draft', 'live', 'closed', 'archived')),
  section text not null
    check (section in ('world', 'business', 'technology', 'culture')),
  coverage_scope text not null default 'world'
    check (coverage_scope in ('world', 'local')),
  headline text not null,
  deck text,
  author_label text not null,
  source_label text,
  location_label text,
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  started_at timestamptz,
  closed_at timestamptz,
  archived_at timestamptz,
  constraint net_altara_news_incidents_headline_shape check (
    headline = btrim(headline) and char_length(headline) between 1 and 180
  ),
  constraint net_altara_news_incidents_deck_shape check (
    deck is null or (deck = btrim(deck) and char_length(deck) between 1 and 400)
  ),
  constraint net_altara_news_incidents_author_shape check (
    author_label = btrim(author_label) and char_length(author_label) between 1 and 100
  ),
  constraint net_altara_news_incidents_source_shape check (
    source_label is null
    or (source_label = btrim(source_label) and char_length(source_label) between 1 and 120)
  ),
  constraint net_altara_news_incidents_location_shape check (
    (coverage_scope = 'world' and location_label is null)
    or (
      coverage_scope = 'local'
      and location_label = btrim(location_label)
      and char_length(location_label) between 1 and 120
    )
  ),
  constraint net_altara_news_incidents_lifecycle_shape check (
    (status = 'draft' and started_at is null and closed_at is null and archived_at is null)
    or (status = 'live' and started_at is not null and closed_at is null and archived_at is null)
    or (status = 'closed' and started_at is not null and closed_at is not null and archived_at is null)
    or (status = 'archived' and started_at is not null and closed_at is not null and archived_at is not null)
  )
);
create index net_altara_news_incidents_live_idx
  on public.net_altara_news_incidents (started_at desc, id desc)
  where status = 'live';
create index net_altara_news_incidents_gm_directory_idx
  on public.net_altara_news_incidents (status, updated_at desc, id desc);
drop trigger if exists net_altara_news_incidents_set_updated_at
  on public.net_altara_news_incidents;
create trigger net_altara_news_incidents_set_updated_at
before update on public.net_altara_news_incidents
for each row execute procedure public.set_updated_at();

create table public.net_altara_news_incident_updates (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null
    references public.net_altara_news_incidents (id) on delete cascade,
  sequence smallint not null check (sequence between 1 and 100),
  update_kind text not null default 'update'
    check (update_kind in ('update', 'confirmation', 'warning', 'correction')),
  body text not null,
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  published_at timestamptz not null default timezone('utc', now()),
  constraint net_altara_news_incident_updates_body_shape check (
    body = btrim(body) and char_length(body) between 1 and 1200
  ),
  constraint net_altara_news_incident_updates_sequence_unique
    unique (incident_id, sequence)
);
create index net_altara_news_incident_updates_ledger_idx
  on public.net_altara_news_incident_updates (incident_id, sequence);

create table public.net_altara_news_saved_articles (
  identity_link_id uuid not null
    references public.net_identity_links (id) on delete cascade,
  article_id uuid not null
    references public.net_altara_news_articles (id) on delete cascade,
  saved_at timestamptz not null default timezone('utc', now()),
  primary key (identity_link_id, article_id)
);
create index net_altara_news_saved_articles_cursor_idx
  on public.net_altara_news_saved_articles (identity_link_id, saved_at desc, article_id desc);

create table public.net_altara_news_realtime_state (
  channel text primary key default 'public' check (channel = 'public'),
  article_revision bigint not null default 0 check (article_revision >= 0),
  live_revision bigint not null default 0 check (live_revision >= 0),
  updated_at timestamptz not null default timezone('utc', now())
);
insert into public.net_altara_news_realtime_state (channel)
values ('public') on conflict (channel) do nothing;
alter table public.net_altara_news_realtime_state replica identity full;

create or replace function public.net_altara_news_effective_player_identity(
  requested_expected_identity_link_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.app_role;
  v_identity_link_id uuid;
  v_context_locked boolean := false;
begin
  if v_actor is null then
    raise exception 'ALTARA_NEWS_AUTH_REQUIRED' using errcode = '42501';
  end if;

  select profile.role into v_role
  from public.profiles as profile
  where profile.id = v_actor;

  if v_role = 'player' then
    select active_identity.identity_link_id
    into v_identity_link_id
    from public.net_active_identities as active_identity
    join public.net_identity_links as identity_link
      on identity_link.id = active_identity.identity_link_id
    where active_identity.profile_id = v_actor
      and identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
      and public.current_user_controls_playable_net_identity_link(identity_link.id)
    for share of active_identity, identity_link;
  elsif v_role = 'gm' then
    select identity_link.id
    into v_identity_link_id
    from public.net_gm_persona_sessions as session_row
    join public.net_identity_links as identity_link
      on identity_link.subject_kind = session_row.subject_kind
      and identity_link.subject_id = session_row.subject_id
    where session_row.gm_profile_id = v_actor
      and session_row.mode = 'take-control'
      and identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
    for share of session_row, identity_link;
  end if;

  if v_identity_link_id is null
    or requested_expected_identity_link_id is null
    or v_identity_link_id <> requested_expected_identity_link_id
  then
    raise exception 'ALTARA_NEWS_PLAYER_CONTEXT_REQUIRED' using errcode = '42501';
  end if;

  select true into v_context_locked
  from public.net_identity_os_assignments as assignment
  join public.net_os_families as family
    on family.id = assignment.primary_os_id and family.status = 'active'
  join public.net_os_service_scopes as scope
    on scope.service_id = 'altara-news'
    and scope.scope_kind = 'primary-os'
    and scope.required_os_id = assignment.primary_os_id
  join public.net_identity_app_installs as install
    on install.identity_link_id = assignment.identity_link_id
    and install.app_id = 'altara-news'
  where assignment.identity_link_id = v_identity_link_id
  for share of assignment, family, scope, install;

  if not coalesce(v_context_locked, false)
    or not public.net_identity_link_can_access_service(v_identity_link_id, 'altara-news')
  then
    raise exception 'ALTARA_NEWS_ACCESS_DENIED' using errcode = '42501';
  end if;
  return v_identity_link_id;
end;
$$;

create or replace function public.net_altara_news_identity_local_label(
  requested_identity_link_id uuid
)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select nullif(btrim(summary.city), '')
  from public.net_identity_links as identity_link
  join public.net_gm_identity_directory_summaries as summary
    on summary.subject_kind = identity_link.subject_kind
    and summary.subject_id = identity_link.subject_id
  where identity_link.id = requested_identity_link_id
    and char_length(nullif(btrim(summary.city), '')) <= 120;
$$;

create or replace function public.net_altara_news_article_summary(
  requested_article_id uuid,
  requested_identity_link_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'article_id', article.id,
    'slug', article.slug,
    'section', article.section,
    'coverage_scope', article.coverage_scope,
    'priority', article.priority,
    'headline', article.headline,
    'deck', article.deck,
    'author_label', article.author_label,
    'source_label', article.source_label,
    'location_label', article.location_label,
    'featured', article.featured,
    'published_at', article.published_at,
    'updated_at', article.updated_at,
    'saved', exists (
      select 1 from public.net_altara_news_saved_articles as saved
      where saved.identity_link_id = requested_identity_link_id
        and saved.article_id = article.id
    ),
    'reference', jsonb_build_object('app_id', 'altara-news', 'article_id', article.id)
  )
  from public.net_altara_news_articles as article
  where article.id = requested_article_id;
$$;

create or replace function public.fetch_net_altara_news_feed(
  requested_expected_identity_link_id uuid,
  requested_mode text,
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
  v_mode text := lower(btrim(coalesce(requested_mode, '')));
  v_local_label text;
  v_limit integer := least(greatest(coalesce(requested_limit, 20), 1), 40);
  v_result jsonb;
begin
  v_identity_link_id := public.net_altara_news_effective_player_identity(
    requested_expected_identity_link_id
  );
  if v_mode not in ('home', 'local', 'world', 'business', 'technology', 'culture', 'saved') then
    raise exception 'ALTARA_NEWS_FEED_MODE_INVALID' using errcode = '22023';
  end if;
  if (requested_cursor_at is null) <> (requested_cursor_id is null) then
    raise exception 'ALTARA_NEWS_CURSOR_INVALID' using errcode = '22023';
  end if;
  v_local_label := public.net_altara_news_identity_local_label(v_identity_link_id);

  with candidate as materialized (
    select article.id, article.published_at
    from public.net_altara_news_articles as article
    where article.status = 'published'
      and (
        (v_mode = 'home' and (
          article.coverage_scope = 'world'
          or (
            v_local_label is not null
            and article.coverage_scope = 'local'
            and lower(article.location_label) = lower(v_local_label)
          )
        ))
        or (v_mode = 'local' and v_local_label is not null
          and article.coverage_scope = 'local'
          and lower(article.location_label) = lower(v_local_label))
        or (v_mode = 'world' and article.coverage_scope = 'world')
        or (v_mode = 'business' and article.section = 'business')
        or (v_mode = 'technology' and article.section = 'technology')
        or (v_mode = 'culture' and article.section = 'culture')
        or (v_mode = 'saved' and exists (
          select 1 from public.net_altara_news_saved_articles as saved
          where saved.identity_link_id = v_identity_link_id
            and saved.article_id = article.id
        ))
      )
      and (
        requested_cursor_at is null
        or (article.published_at, article.id) < (requested_cursor_at, requested_cursor_id)
      )
    order by article.published_at desc, article.id desc
    limit v_limit + 1
  ), page as (
    select candidate.* from candidate
    order by candidate.published_at desc, candidate.id desc limit v_limit
  )
  select jsonb_build_object(
    'identity_link_id', v_identity_link_id,
    'mode', v_mode,
    'local_label', v_local_label,
    'local_available', v_local_label is not null,
    'articles', coalesce((
      select jsonb_agg(
        public.net_altara_news_article_summary(page.id, v_identity_link_id)
        order by page.published_at desc, page.id desc
      ) from page
    ), '[]'::jsonb),
    'next_cursor', case when (select count(*) from candidate) > v_limit then (
      select jsonb_build_object('published_at', page.published_at, 'article_id', page.id)
      from page order by page.published_at asc, page.id asc limit 1
    ) else null end
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.fetch_net_altara_news_article(
  requested_expected_identity_link_id uuid,
  requested_article_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_result jsonb;
begin
  v_identity_link_id := public.net_altara_news_effective_player_identity(
    requested_expected_identity_link_id
  );
  select jsonb_build_object(
    'article', public.net_altara_news_article_summary(article.id, v_identity_link_id)
      || jsonb_build_object('body', article.body),
    'media', '[]'::jsonb,
    'related', coalesce((
      select jsonb_agg(public.net_altara_news_article_summary(related.id, v_identity_link_id)
        order by related.published_at desc, related.id desc)
      from (
        select candidate.id, candidate.published_at
        from public.net_altara_news_articles as candidate
        where candidate.status = 'published'
          and candidate.section = article.section
          and candidate.id <> article.id
        order by candidate.published_at desc, candidate.id desc
        limit 4
      ) as related
    ), '[]'::jsonb)
  ) into v_result
  from public.net_altara_news_articles as article
  where article.id = requested_article_id and article.status = 'published';
  if v_result is null then
    raise exception 'ALTARA_NEWS_ARTICLE_NOT_FOUND' using errcode = 'P0002';
  end if;
  return v_result;
end;
$$;

create or replace function public.fetch_net_altara_news_live(
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
begin
  v_identity_link_id := public.net_altara_news_effective_player_identity(
    requested_expected_identity_link_id
  );
  return jsonb_build_object(
    'identity_link_id', v_identity_link_id,
    'incidents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'incident_id', incident.id,
        'headline', incident.headline,
        'deck', incident.deck,
        'section', incident.section,
        'coverage_scope', incident.coverage_scope,
        'author_label', incident.author_label,
        'source_label', incident.source_label,
        'location_label', incident.location_label,
        'started_at', incident.started_at,
        'updated_at', incident.updated_at,
        'updates', coalesce((
          select jsonb_agg(jsonb_build_object(
            'update_id', incident_update.id,
            'sequence', incident_update.sequence,
            'update_kind', incident_update.update_kind,
            'body', incident_update.body,
            'published_at', incident_update.published_at
          ) order by incident_update.sequence)
          from public.net_altara_news_incident_updates as incident_update
          where incident_update.incident_id = incident.id
        ), '[]'::jsonb)
      ) order by incident.started_at desc, incident.id desc)
      from (
        select * from public.net_altara_news_incidents
        where status = 'live'
        order by started_at desc, id desc limit 5
      ) as incident
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.set_net_altara_news_saved(
  requested_expected_identity_link_id uuid,
  requested_article_id uuid,
  requested_saved boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
begin
  v_identity_link_id := public.net_altara_news_effective_player_identity(
    requested_expected_identity_link_id
  );
  if requested_article_id is null or requested_saved is null
    or not exists (
      select 1 from public.net_altara_news_articles
      where id = requested_article_id and status = 'published'
    )
  then
    raise exception 'ALTARA_NEWS_SAVE_TARGET_INVALID' using errcode = '22023';
  end if;
  if requested_saved then
    insert into public.net_altara_news_saved_articles (identity_link_id, article_id)
    values (v_identity_link_id, requested_article_id)
    on conflict (identity_link_id, article_id) do nothing;
  else
    delete from public.net_altara_news_saved_articles
    where identity_link_id = v_identity_link_id and article_id = requested_article_id;
  end if;
  return jsonb_build_object(
    'article_id', requested_article_id,
    'saved', requested_saved
  );
end;
$$;

create or replace function public.assert_net_altara_news_gm_editor()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or not public.is_current_user_gm() then
    raise exception 'ALTARA_NEWS_GM_REQUIRED' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

create or replace function public.audit_net_altara_news_gm_action(
  requested_action_type text,
  requested_resource_type text,
  requested_resource_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_actor uuid;
begin
  v_actor := public.assert_net_altara_news_gm_editor();
  if btrim(coalesce(requested_action_type, '')) = ''
    or requested_resource_type not in ('altara-news-article', 'altara-news-incident')
    or requested_resource_id is null
  then
    raise exception 'ALTARA_NEWS_AUDIT_INVALID' using errcode = '22023';
  end if;
  insert into public.net_action_audit (
    authenticated_actor_profile_id, presented_account_id,
    persona_subject_kind, persona_subject_id, action_mode,
    action_type, authorization_basis, resource_type, resource_id
  ) values (
    v_actor, null, null, null, 'system', requested_action_type,
    'authoritative-gm-newsroom', requested_resource_type, requested_resource_id
  );
end;
$$;

create or replace function public.fetch_net_altara_news_gm_articles(
  requested_status text default 'all',
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text := lower(btrim(coalesce(requested_status, 'all')));
  v_limit integer := least(greatest(coalesce(requested_limit, 20), 1), 40);
  v_result jsonb;
begin
  perform public.assert_net_altara_news_gm_editor();
  if v_status not in ('all', 'draft', 'published', 'archived')
    or ((requested_cursor_at is null) <> (requested_cursor_id is null))
  then
    raise exception 'ALTARA_NEWS_GM_DIRECTORY_INVALID' using errcode = '22023';
  end if;
  with candidate as materialized (
    select article.* from public.net_altara_news_articles as article
    where (v_status = 'all' or article.status = v_status)
      and (requested_cursor_at is null
        or (article.updated_at, article.id) < (requested_cursor_at, requested_cursor_id))
    order by article.updated_at desc, article.id desc limit v_limit + 1
  ), page as (
    select * from candidate order by updated_at desc, id desc limit v_limit
  )
  select jsonb_build_object(
    'articles', coalesce((select jsonb_agg(jsonb_build_object(
      'article_id', page.id, 'slug', page.slug, 'status', page.status,
      'section', page.section, 'coverage_scope', page.coverage_scope,
      'priority', page.priority, 'headline', page.headline,
      'featured', page.featured, 'updated_at', page.updated_at,
      'published_at', page.published_at
    ) order by page.updated_at desc, page.id desc) from page), '[]'::jsonb),
    'next_cursor', case when (select count(*) from candidate) > v_limit then (
      select jsonb_build_object('updated_at', page.updated_at, 'article_id', page.id)
      from page order by page.updated_at asc, page.id asc limit 1
    ) else null end
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.fetch_net_altara_news_gm_article(
  requested_article_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_result jsonb;
begin
  perform public.assert_net_altara_news_gm_editor();
  select to_jsonb(article) - 'created_by_profile_id'
  into v_result from public.net_altara_news_articles as article
  where article.id = requested_article_id;
  if v_result is null then
    raise exception 'ALTARA_NEWS_ARTICLE_NOT_FOUND' using errcode = 'P0002';
  end if;
  return v_result || jsonb_build_object('media', '[]'::jsonb);
end;
$$;

create or replace function public.save_net_altara_news_gm_article(
  requested_article_id uuid,
  requested_slug text,
  requested_section text,
  requested_coverage_scope text,
  requested_priority text,
  requested_headline text,
  requested_deck text,
  requested_body text,
  requested_author_label text,
  requested_source_label text,
  requested_location_label text,
  requested_featured boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_article public.net_altara_news_articles%rowtype;
  v_section text := lower(btrim(coalesce(requested_section, '')));
  v_scope text := lower(btrim(coalesce(requested_coverage_scope, '')));
  v_priority text := lower(btrim(coalesce(requested_priority, '')));
  v_deck text := nullif(btrim(requested_deck), '');
  v_source text := nullif(btrim(requested_source_label), '');
  v_location text := nullif(btrim(requested_location_label), '');
begin
  v_actor := public.assert_net_altara_news_gm_editor();
  if lower(btrim(coalesce(requested_slug, ''))) !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or char_length(btrim(coalesce(requested_slug, ''))) not between 1 and 100
    or v_section not in ('world', 'business', 'technology', 'culture')
    or v_scope not in ('world', 'local')
    or v_priority not in ('standard', 'breaking')
    or char_length(btrim(coalesce(requested_headline, ''))) not between 1 and 180
    or char_length(btrim(coalesce(requested_body, ''))) not between 1 and 16000
    or char_length(btrim(coalesce(requested_author_label, ''))) not between 1 and 100
    or (v_deck is not null and char_length(v_deck) > 400)
    or (v_source is not null and char_length(v_source) > 120)
    or (v_scope = 'local' and (v_location is null or char_length(v_location) > 120))
    or (v_scope = 'world' and v_location is not null)
    or requested_featured is null
  then
    raise exception 'ALTARA_NEWS_ARTICLE_INPUT_INVALID' using errcode = '22023';
  end if;

  if requested_article_id is null then
    insert into public.net_altara_news_articles (
      slug, section, coverage_scope, priority, headline, deck, body,
      author_label, source_label, location_label, featured, created_by_profile_id
    ) values (
      lower(btrim(requested_slug)), v_section, v_scope, v_priority,
      btrim(requested_headline), v_deck, btrim(requested_body),
      btrim(requested_author_label), v_source, v_location,
      requested_featured, v_actor
    ) returning * into v_article;
    perform public.audit_net_altara_news_gm_action(
      'altara-news.article.create', 'altara-news-article', v_article.id
    );
  else
    update public.net_altara_news_articles as article set
      slug = lower(btrim(requested_slug)), section = v_section,
      coverage_scope = v_scope, priority = v_priority,
      headline = btrim(requested_headline), deck = v_deck,
      body = btrim(requested_body), author_label = btrim(requested_author_label),
      source_label = v_source, location_label = v_location,
      featured = requested_featured
    where article.id = requested_article_id
      and article.status in ('draft', 'published')
    returning * into v_article;
    if not found then
      raise exception 'ALTARA_NEWS_ARTICLE_NOT_EDITABLE' using errcode = 'P0001';
    end if;
    perform public.audit_net_altara_news_gm_action(
      'altara-news.article.update', 'altara-news-article', v_article.id
    );
  end if;
  return (to_jsonb(v_article) - 'created_by_profile_id') || jsonb_build_object('media', '[]'::jsonb);
end;
$$;

create or replace function public.set_net_altara_news_gm_article_lifecycle(
  requested_article_id uuid,
  requested_action text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_action text := lower(btrim(coalesce(requested_action, '')));
  v_article public.net_altara_news_articles%rowtype;
begin
  perform public.assert_net_altara_news_gm_editor();
  if v_action = 'publish' then
    update public.net_altara_news_articles set
      status = 'published', published_at = timezone('utc', now()), archived_at = null
    where id = requested_article_id and status = 'draft'
    returning * into v_article;
  elsif v_action = 'unpublish' then
    update public.net_altara_news_articles set
      status = 'draft', published_at = null, archived_at = null
    where id = requested_article_id and status = 'published'
    returning * into v_article;
  elsif v_action = 'archive' then
    update public.net_altara_news_articles set
      status = 'archived', archived_at = timezone('utc', now())
    where id = requested_article_id and status in ('draft', 'published')
    returning * into v_article;
  else
    raise exception 'ALTARA_NEWS_LIFECYCLE_ACTION_INVALID' using errcode = '22023';
  end if;
  if not found then
    raise exception 'ALTARA_NEWS_LIFECYCLE_INVALID' using errcode = 'P0001';
  end if;
  perform public.audit_net_altara_news_gm_action(
    'altara-news.article.' || v_action, 'altara-news-article', v_article.id
  );
  return to_jsonb(v_article) - 'created_by_profile_id';
end;
$$;

create or replace function public.net_altara_news_gm_incident_payload(
  requested_incident_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (to_jsonb(incident) - 'created_by_profile_id') || jsonb_build_object(
    'updates', coalesce((
      select jsonb_agg((to_jsonb(incident_update) - 'created_by_profile_id' - 'incident_id')
        order by incident_update.sequence)
      from public.net_altara_news_incident_updates as incident_update
      where incident_update.incident_id = incident.id
    ), '[]'::jsonb)
  )
  from public.net_altara_news_incidents as incident
  where incident.id = requested_incident_id;
$$;

create or replace function public.fetch_net_altara_news_gm_incidents(
  requested_status text default 'all',
  requested_limit integer default 40
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text := lower(btrim(coalesce(requested_status, 'all')));
  v_limit integer := least(greatest(coalesce(requested_limit, 40), 1), 40);
begin
  perform public.assert_net_altara_news_gm_editor();
  if v_status not in ('all', 'draft', 'live', 'closed', 'archived') then
    raise exception 'ALTARA_NEWS_INCIDENT_DIRECTORY_INVALID' using errcode = '22023';
  end if;
  return jsonb_build_object('incidents', coalesce((
    select jsonb_agg(public.net_altara_news_gm_incident_payload(incident.id)
      order by incident.updated_at desc, incident.id desc)
    from (
      select row.id, row.updated_at
      from public.net_altara_news_incidents as row
      where v_status = 'all' or row.status = v_status
      order by row.updated_at desc, row.id desc limit v_limit
    ) as incident
  ), '[]'::jsonb));
end;
$$;

create or replace function public.fetch_net_altara_news_gm_incident(
  requested_incident_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_result jsonb;
begin
  perform public.assert_net_altara_news_gm_editor();
  v_result := public.net_altara_news_gm_incident_payload(requested_incident_id);
  if v_result is null then
    raise exception 'ALTARA_NEWS_INCIDENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  return v_result;
end;
$$;

create or replace function public.save_net_altara_news_gm_incident(
  requested_incident_id uuid,
  requested_section text,
  requested_coverage_scope text,
  requested_headline text,
  requested_deck text,
  requested_author_label text,
  requested_source_label text,
  requested_location_label text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_incident public.net_altara_news_incidents%rowtype;
  v_section text := lower(btrim(coalesce(requested_section, '')));
  v_scope text := lower(btrim(coalesce(requested_coverage_scope, '')));
  v_deck text := nullif(btrim(requested_deck), '');
  v_source text := nullif(btrim(requested_source_label), '');
  v_location text := nullif(btrim(requested_location_label), '');
begin
  v_actor := public.assert_net_altara_news_gm_editor();
  if v_section not in ('world', 'business', 'technology', 'culture')
    or v_scope not in ('world', 'local')
    or char_length(btrim(coalesce(requested_headline, ''))) not between 1 and 180
    or char_length(btrim(coalesce(requested_author_label, ''))) not between 1 and 100
    or (v_deck is not null and char_length(v_deck) > 400)
    or (v_source is not null and char_length(v_source) > 120)
    or (v_scope = 'local' and (v_location is null or char_length(v_location) > 120))
    or (v_scope = 'world' and v_location is not null)
  then
    raise exception 'ALTARA_NEWS_INCIDENT_INPUT_INVALID' using errcode = '22023';
  end if;
  if requested_incident_id is null then
    insert into public.net_altara_news_incidents (
      section, coverage_scope, headline, deck, author_label,
      source_label, location_label, created_by_profile_id
    ) values (
      v_section, v_scope, btrim(requested_headline), v_deck,
      btrim(requested_author_label), v_source, v_location, v_actor
    ) returning * into v_incident;
    perform public.audit_net_altara_news_gm_action(
      'altara-news.incident.create', 'altara-news-incident', v_incident.id
    );
  else
    update public.net_altara_news_incidents as incident set
      section = v_section, coverage_scope = v_scope,
      headline = btrim(requested_headline), deck = v_deck,
      author_label = btrim(requested_author_label), source_label = v_source,
      location_label = v_location
    where incident.id = requested_incident_id and incident.status in ('draft', 'live')
    returning * into v_incident;
    if not found then
      raise exception 'ALTARA_NEWS_INCIDENT_NOT_EDITABLE' using errcode = 'P0001';
    end if;
    perform public.audit_net_altara_news_gm_action(
      'altara-news.incident.update', 'altara-news-incident', v_incident.id
    );
  end if;
  return public.net_altara_news_gm_incident_payload(v_incident.id);
end;
$$;

create or replace function public.set_net_altara_news_gm_incident_lifecycle(
  requested_incident_id uuid,
  requested_action text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_action text := lower(btrim(coalesce(requested_action, '')));
  v_incident public.net_altara_news_incidents%rowtype;
begin
  perform public.assert_net_altara_news_gm_editor();
  if v_action = 'start' then
    update public.net_altara_news_incidents set
      status = 'live', started_at = timezone('utc', now())
    where id = requested_incident_id and status = 'draft'
    returning * into v_incident;
  elsif v_action = 'close' then
    update public.net_altara_news_incidents set
      status = 'closed', closed_at = timezone('utc', now())
    where id = requested_incident_id and status = 'live'
    returning * into v_incident;
  elsif v_action = 'archive' then
    update public.net_altara_news_incidents set
      status = 'archived', archived_at = timezone('utc', now())
    where id = requested_incident_id and status = 'closed'
    returning * into v_incident;
  else
    raise exception 'ALTARA_NEWS_INCIDENT_ACTION_INVALID' using errcode = '22023';
  end if;
  if not found then
    raise exception 'ALTARA_NEWS_INCIDENT_LIFECYCLE_INVALID' using errcode = 'P0001';
  end if;
  perform public.audit_net_altara_news_gm_action(
    'altara-news.incident.' || v_action, 'altara-news-incident', v_incident.id
  );
  return public.net_altara_news_gm_incident_payload(v_incident.id);
end;
$$;

create or replace function public.append_net_altara_news_gm_incident_update(
  requested_incident_id uuid,
  requested_update_kind text,
  requested_body text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_kind text := lower(btrim(coalesce(requested_update_kind, '')));
  v_sequence integer;
begin
  v_actor := public.assert_net_altara_news_gm_editor();
  if v_kind not in ('update', 'confirmation', 'warning', 'correction')
    or char_length(btrim(coalesce(requested_body, ''))) not between 1 and 1200
  then
    raise exception 'ALTARA_NEWS_INCIDENT_UPDATE_INVALID' using errcode = '22023';
  end if;
  perform 1 from public.net_altara_news_incidents
  where id = requested_incident_id and status = 'live' for update;
  if not found then
    raise exception 'ALTARA_NEWS_INCIDENT_NOT_LIVE' using errcode = 'P0001';
  end if;
  select coalesce(max(sequence), 0) + 1 into v_sequence
  from public.net_altara_news_incident_updates
  where incident_id = requested_incident_id;
  if v_sequence > 100 then
    raise exception 'ALTARA_NEWS_INCIDENT_UPDATE_LIMIT_REACHED' using errcode = 'P0001';
  end if;
  insert into public.net_altara_news_incident_updates (
    incident_id, sequence, update_kind, body, created_by_profile_id
  ) values (
    requested_incident_id, v_sequence, v_kind, btrim(requested_body), v_actor
  );
  perform public.audit_net_altara_news_gm_action(
    'altara-news.incident.update.append', 'altara-news-incident', requested_incident_id
  );
  return public.net_altara_news_gm_incident_payload(requested_incident_id);
end;
$$;

create or replace function public.signal_net_altara_news_change()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_live boolean := tg_table_name in ('net_altara_news_incidents', 'net_altara_news_incident_updates');
begin
  insert into public.net_altara_news_realtime_state (
    channel, article_revision, live_revision, updated_at
  ) values (
    'public', case when v_live then 0 else 1 end,
    case when v_live then 1 else 0 end, timezone('utc', now())
  ) on conflict (channel) do update set
    article_revision = public.net_altara_news_realtime_state.article_revision
      + case when v_live then 0 else 1 end,
    live_revision = public.net_altara_news_realtime_state.live_revision
      + case when v_live then 1 else 0 end,
    updated_at = excluded.updated_at;
  return null;
end;
$$;

create trigger net_altara_news_articles_signal_realtime
after insert or update on public.net_altara_news_articles
for each row execute procedure public.signal_net_altara_news_change();
create trigger net_altara_news_incidents_signal_realtime
after insert or update on public.net_altara_news_incidents
for each row execute procedure public.signal_net_altara_news_change();
create trigger net_altara_news_incident_updates_signal_realtime
after insert on public.net_altara_news_incident_updates
for each row execute procedure public.signal_net_altara_news_change();

create or replace function public.current_user_can_read_net_altara_news_revision()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and (
    public.is_current_user_gm()
    or exists (
      select 1
      from public.net_active_identities as active_identity
      join public.net_identity_links as identity_link
        on identity_link.id = active_identity.identity_link_id
      join public.net_identity_app_installs as install
        on install.identity_link_id = identity_link.id and install.app_id = 'altara-news'
      where active_identity.profile_id = auth.uid()
        and identity_link.identity_kind = 'player'
        and identity_link.playability = 'playable'
        and public.current_user_controls_playable_net_identity_link(identity_link.id)
        and public.net_identity_link_can_access_service(identity_link.id, 'altara-news')
    )
  );
$$;

alter table public.net_altara_news_articles enable row level security;
alter table public.net_altara_news_article_media enable row level security;
alter table public.net_altara_news_incidents enable row level security;
alter table public.net_altara_news_incident_updates enable row level security;
alter table public.net_altara_news_saved_articles enable row level security;
alter table public.net_altara_news_realtime_state enable row level security;

create policy net_altara_news_realtime_state_select_authorized
on public.net_altara_news_realtime_state
for select to authenticated
using (channel = 'public' and public.current_user_can_read_net_altara_news_revision());

revoke all on table public.net_altara_news_articles from public, anon, authenticated;
revoke all on table public.net_altara_news_article_media from public, anon, authenticated;
revoke all on table public.net_altara_news_incidents from public, anon, authenticated;
revoke all on table public.net_altara_news_incident_updates from public, anon, authenticated;
revoke all on table public.net_altara_news_saved_articles from public, anon, authenticated;
revoke all on table public.net_altara_news_realtime_state from public, anon, authenticated;
grant select on table public.net_altara_news_realtime_state to authenticated;

revoke all on function public.net_altara_news_effective_player_identity(uuid) from public, anon, authenticated;
revoke all on function public.net_altara_news_identity_local_label(uuid) from public, anon, authenticated;
revoke all on function public.net_altara_news_article_summary(uuid, uuid) from public, anon, authenticated;
revoke all on function public.assert_net_altara_news_gm_editor() from public, anon, authenticated;
revoke all on function public.audit_net_altara_news_gm_action(text, text, uuid) from public, anon, authenticated;
revoke all on function public.net_altara_news_gm_incident_payload(uuid) from public, anon, authenticated;
revoke all on function public.signal_net_altara_news_change() from public, anon, authenticated;
revoke all on function public.current_user_can_read_net_altara_news_revision() from public, anon, authenticated;
revoke all on function public.set_net_identity_app_install(uuid, text, boolean) from public, anon, authenticated;

revoke all on function public.fetch_net_altara_news_feed(uuid, text, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.fetch_net_altara_news_article(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fetch_net_altara_news_live(uuid) from public, anon, authenticated;
revoke all on function public.set_net_altara_news_saved(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.fetch_net_altara_news_gm_articles(text, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.fetch_net_altara_news_gm_article(uuid) from public, anon, authenticated;
revoke all on function public.save_net_altara_news_gm_article(uuid, text, text, text, text, text, text, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.set_net_altara_news_gm_article_lifecycle(uuid, text) from public, anon, authenticated;
revoke all on function public.fetch_net_altara_news_gm_incidents(text, integer) from public, anon, authenticated;
revoke all on function public.fetch_net_altara_news_gm_incident(uuid) from public, anon, authenticated;
revoke all on function public.save_net_altara_news_gm_incident(uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.set_net_altara_news_gm_incident_lifecycle(uuid, text) from public, anon, authenticated;
revoke all on function public.append_net_altara_news_gm_incident_update(uuid, text, text) from public, anon, authenticated;

grant execute on function public.fetch_net_altara_news_feed(uuid, text, timestamptz, uuid, integer) to authenticated;
grant execute on function public.current_user_can_read_net_altara_news_revision() to authenticated;
grant execute on function public.set_net_identity_app_install(uuid, text, boolean) to authenticated;
grant execute on function public.fetch_net_altara_news_article(uuid, uuid) to authenticated;
grant execute on function public.fetch_net_altara_news_live(uuid) to authenticated;
grant execute on function public.set_net_altara_news_saved(uuid, uuid, boolean) to authenticated;
grant execute on function public.fetch_net_altara_news_gm_articles(text, timestamptz, uuid, integer) to authenticated;
grant execute on function public.fetch_net_altara_news_gm_article(uuid) to authenticated;
grant execute on function public.save_net_altara_news_gm_article(uuid, text, text, text, text, text, text, text, text, text, text, boolean) to authenticated;
grant execute on function public.set_net_altara_news_gm_article_lifecycle(uuid, text) to authenticated;
grant execute on function public.fetch_net_altara_news_gm_incidents(text, integer) to authenticated;
grant execute on function public.fetch_net_altara_news_gm_incident(uuid) to authenticated;
grant execute on function public.save_net_altara_news_gm_incident(uuid, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.set_net_altara_news_gm_incident_lifecycle(uuid, text) to authenticated;
grant execute on function public.append_net_altara_news_gm_incident_update(uuid, text, text) to authenticated;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'net_altara_news_articles', 'net_altara_news_article_media',
    'net_altara_news_incidents', 'net_altara_news_incident_updates',
    'net_altara_news_saved_articles'
  ] loop
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime drop table public.%I', v_table);
    end if;
  end loop;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'net_altara_news_realtime_state'
  ) then
    alter publication supabase_realtime add table public.net_altara_news_realtime_state;
  end if;
exception when duplicate_object then null;
end;
$$;

commit;
