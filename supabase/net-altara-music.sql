-- ALTARA MUSIC V1: native private-audio catalogue, personal libraries, and
-- structured Spotify embeds for the ALTARA runtime. This migration creates no
-- music, Spotify references, identities, or Storage objects.

begin;

do $$
declare
  v_install_constraint text;
  v_install_ids text[];
begin
  if to_regclass('public.profiles') is null
    or to_regclass('public.net_identity_links') is null
    or to_regclass('public.net_identity_app_installs') is null
    or to_regclass('public.net_os_service_scopes') is null
    or to_regclass('public.net_app_account_policies') is null
    or to_regclass('public.net_action_audit') is null
    or to_regclass('storage.buckets') is null
    or to_regclass('storage.objects') is null
    or to_regprocedure('public.current_net_effective_runtime_identity_link_id()') is null
    or to_regprocedure('public.assert_net_effective_runtime_identity(uuid,text,boolean)') is null
    or to_regprocedure('public.current_user_has_net_runtime_service_for_link(uuid,text)') is null
    or to_regprocedure('public.net_runtime_action_context(uuid)') is null
    or to_regprocedure('public.current_user_is_net_system_admin()') is null
    or to_regprocedure('public.assert_net_system_admin()') is null
    or to_regprocedure('public.set_updated_at()') is null
  then
    raise exception 'ALTARA_MUSIC_DEPENDENCY_REQUIRED' using errcode = '55000';
  end if;

  if not exists (
    select 1 from storage.buckets as bucket
    where bucket.id = 'rpg-audio' and bucket.public = false
  ) or not exists (
    select 1 from storage.buckets as bucket
    where bucket.id = 'rpg-media' and bucket.public = false
  ) then
    raise exception 'ALTARA_MUSIC_PRIVATE_STORAGE_REQUIRED' using errcode = '55000';
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
    'altara-bank', 'altara-news', 'echo', 'nvn', 'pulse',
    'shneider-bank', 'vox-bank'
  ]::text[] then
    raise exception 'ALTARA_MUSIC_INSTALL_DOMAIN_REVIEW_REQUIRED' using errcode = '55000';
  end if;
end;
$$;

insert into public.net_os_service_scopes (service_id, scope_kind, required_os_id)
values ('altara-music', 'primary-os', 'altara')
on conflict (service_id) do update set
  scope_kind = excluded.scope_kind,
  required_os_id = excluded.required_os_id,
  updated_at = timezone('utc', now());

insert into public.net_app_account_policies (app_id, account_mode, account_available)
values ('altara-music', 'none', false)
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
    'altara-bank', 'altara-news', 'altara-music'
  )) not valid;
alter table public.net_identity_app_installs
  validate constraint net_identity_app_installs_app_id_check;

-- Preserve the deployed effective-runtime installer exactly and extend only
-- the bounded optional-app domain.
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
      'altara-bank', 'altara-news', 'altara-music'
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

create table public.net_altara_music_artists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  avatar_ref text,
  banner_ref text,
  bio text,
  status text not null default 'draft',
  featured boolean not null default false,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint net_altara_music_artist_name_shape check (
    name = btrim(name) and char_length(name) between 1 and 120
  ),
  constraint net_altara_music_artist_slug_shape check (
    slug = lower(btrim(slug)) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    and char_length(slug) between 1 and 120
  ),
  constraint net_altara_music_artist_bio_shape check (
    bio is null or (bio = btrim(bio) and char_length(bio) between 1 and 4000)
  ),
  constraint net_altara_music_artist_status_check check (
    status in ('draft', 'published', 'archived')
  ),
  constraint net_altara_music_artist_media_shape check (
    (avatar_ref is null or (avatar_ref like 'rpg-media:v1:%' and char_length(avatar_ref) between 16 and 4096))
    and (banner_ref is null or (banner_ref like 'rpg-media:v1:%' and char_length(banner_ref) between 16 and 4096))
  )
);

create table public.net_altara_music_releases (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.net_altara_music_artists(id) on delete restrict,
  title text not null,
  slug text not null unique,
  release_type text not null,
  cover_ref text,
  release_date date,
  description text,
  status text not null default 'draft',
  featured boolean not null default false,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint net_altara_music_release_title_shape check (
    title = btrim(title) and char_length(title) between 1 and 160
  ),
  constraint net_altara_music_release_slug_shape check (
    slug = lower(btrim(slug)) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    and char_length(slug) between 1 and 140
  ),
  constraint net_altara_music_release_type_check check (release_type in ('album', 'ep', 'single')),
  constraint net_altara_music_release_description_shape check (
    description is null or (description = btrim(description) and char_length(description) between 1 and 4000)
  ),
  constraint net_altara_music_release_status_check check (status in ('draft', 'published', 'archived')),
  constraint net_altara_music_release_cover_shape check (
    cover_ref is null or (cover_ref like 'rpg-media:v1:%' and char_length(cover_ref) between 16 and 4096)
  )
);

create table public.net_altara_music_tracks (
  id uuid primary key,
  primary_artist_id uuid not null references public.net_altara_music_artists(id) on delete restrict,
  release_id uuid references public.net_altara_music_releases(id) on delete restrict,
  title text not null,
  track_number integer,
  disc_number integer not null default 1,
  audio_object_path text not null unique,
  audio_mime_type text not null,
  audio_byte_size integer not null,
  duration_ms integer not null,
  artwork_ref text,
  explicit boolean not null default false,
  status text not null default 'draft',
  featured boolean not null default false,
  pending_delete_at timestamptz,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint net_altara_music_track_title_shape check (
    title = btrim(title) and char_length(title) between 1 and 180
  ),
  constraint net_altara_music_track_numbers_shape check (
    (track_number is null or track_number between 1 and 999) and disc_number between 1 and 99
  ),
  constraint net_altara_music_track_audio_path_shape check (
    audio_object_path ~ '^altara-music/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[a-f0-9]{64}\.(mp3|m4a|mp4|ogg|webm)$'
  ),
  constraint net_altara_music_track_audio_mime_check check (
    audio_mime_type in ('audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/ogg', 'audio/webm')
  ),
  constraint net_altara_music_track_audio_bounds check (
    audio_byte_size between 1 and 15728640 and duration_ms between 2000 and 900000
  ),
  constraint net_altara_music_track_status_check check (status in ('draft', 'published', 'archived')),
  constraint net_altara_music_track_artwork_shape check (
    artwork_ref is null or (artwork_ref like 'rpg-media:v1:%' and char_length(artwork_ref) between 16 and 4096)
  )
);

create table public.net_altara_music_playlists (
  id uuid primary key default gen_random_uuid(),
  playlist_kind text not null,
  owner_identity_link_id uuid references public.net_identity_links(id) on delete restrict,
  title text not null,
  description text,
  cover_ref text,
  status text not null default 'published',
  featured boolean not null default false,
  created_by_profile_id uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint net_altara_music_playlist_kind_check check (playlist_kind in ('personal', 'curated')),
  constraint net_altara_music_playlist_owner_shape check (
    (playlist_kind = 'personal' and owner_identity_link_id is not null and created_by_profile_id is null)
    or (playlist_kind = 'curated' and owner_identity_link_id is null and created_by_profile_id is not null)
  ),
  constraint net_altara_music_playlist_title_shape check (
    title = btrim(title) and char_length(title) between 1 and 120
  ),
  constraint net_altara_music_playlist_description_shape check (
    description is null or (description = btrim(description) and char_length(description) between 1 and 1000)
  ),
  constraint net_altara_music_playlist_status_check check (status in ('draft', 'published', 'archived')),
  constraint net_altara_music_playlist_cover_shape check (
    cover_ref is null or (cover_ref like 'rpg-media:v1:%' and char_length(cover_ref) between 16 and 4096)
  )
);

create table public.net_altara_music_playlist_items (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.net_altara_music_playlists(id) on delete cascade,
  track_id uuid not null references public.net_altara_music_tracks(id) on delete restrict,
  sort_rank bigint not null,
  added_at timestamptz not null default timezone('utc', now()),
  unique (playlist_id, track_id),
  unique (playlist_id, sort_rank),
  constraint net_altara_music_playlist_item_rank_check check (sort_rank between 1 and 9000000000000000)
);

create table public.net_altara_music_liked_tracks (
  identity_link_id uuid not null references public.net_identity_links(id) on delete cascade,
  track_id uuid not null references public.net_altara_music_tracks(id) on delete restrict,
  liked_at timestamptz not null default timezone('utc', now()),
  primary key (identity_link_id, track_id)
);

create table public.net_altara_music_recently_played (
  identity_link_id uuid not null references public.net_identity_links(id) on delete cascade,
  track_id uuid not null references public.net_altara_music_tracks(id) on delete restrict,
  play_count integer not null default 1,
  last_played_at timestamptz not null default timezone('utc', now()),
  primary key (identity_link_id, track_id),
  constraint net_altara_music_recent_count_check check (play_count between 1 and 2147483647)
);

create table public.net_altara_music_external_entries (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'spotify',
  content_type text not null,
  provider_content_id text not null,
  canonical_url text not null,
  display_title text not null,
  description text,
  status text not null default 'draft',
  featured boolean not null default false,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (provider, content_type, provider_content_id),
  constraint net_altara_music_external_provider_check check (provider = 'spotify'),
  constraint net_altara_music_external_type_check check (content_type in ('playlist', 'album', 'track', 'artist')),
  constraint net_altara_music_external_id_shape check (provider_content_id ~ '^[A-Za-z0-9]{22}$'),
  constraint net_altara_music_external_url_shape check (
    canonical_url = 'https://open.spotify.com/' || content_type || '/' || provider_content_id
  ),
  constraint net_altara_music_external_title_shape check (
    display_title = btrim(display_title) and char_length(display_title) between 1 and 160
  ),
  constraint net_altara_music_external_description_shape check (
    description is null or (description = btrim(description) and char_length(description) between 1 and 1000)
  ),
  constraint net_altara_music_external_status_check check (status in ('draft', 'published', 'archived'))
);

create index net_altara_music_artists_published_idx
  on public.net_altara_music_artists (featured desc, updated_at desc, id)
  where status = 'published';
create index net_altara_music_releases_published_idx
  on public.net_altara_music_releases (featured desc, release_date desc nulls last, id)
  where status = 'published';
create index net_altara_music_releases_artist_idx
  on public.net_altara_music_releases (artist_id, release_date desc nulls last, id);
create index net_altara_music_tracks_published_idx
  on public.net_altara_music_tracks (featured desc, created_at desc, id)
  where status = 'published';
create index net_altara_music_tracks_artist_idx
  on public.net_altara_music_tracks (primary_artist_id, created_at desc, id);
create index net_altara_music_tracks_release_idx
  on public.net_altara_music_tracks (release_id, disc_number, track_number, id);
create index net_altara_music_playlists_owner_idx
  on public.net_altara_music_playlists (owner_identity_link_id, updated_at desc, id)
  where playlist_kind = 'personal';
create index net_altara_music_playlists_curated_idx
  on public.net_altara_music_playlists (featured desc, updated_at desc, id)
  where playlist_kind = 'curated' and status = 'published';
create index net_altara_music_playlist_items_order_idx
  on public.net_altara_music_playlist_items (playlist_id, sort_rank, id);
create index net_altara_music_recent_identity_idx
  on public.net_altara_music_recently_played (identity_link_id, last_played_at desc, track_id);
create index net_altara_music_external_published_idx
  on public.net_altara_music_external_entries (featured desc, updated_at desc, id)
  where status = 'published';

create trigger net_altara_music_artists_set_updated_at before update on public.net_altara_music_artists
for each row execute function public.set_updated_at();
create trigger net_altara_music_releases_set_updated_at before update on public.net_altara_music_releases
for each row execute function public.set_updated_at();
create trigger net_altara_music_tracks_set_updated_at before update on public.net_altara_music_tracks
for each row execute function public.set_updated_at();
create trigger net_altara_music_playlists_set_updated_at before update on public.net_altara_music_playlists
for each row execute function public.set_updated_at();
create trigger net_altara_music_external_set_updated_at before update on public.net_altara_music_external_entries
for each row execute function public.set_updated_at();

create or replace function public.net_altara_music_assert_reader(requested_expected_identity_link_id uuid)
returns uuid
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select public.assert_net_effective_runtime_identity(
    requested_expected_identity_link_id,
    'altara-music',
    true
  );
$$;

create or replace function public.net_altara_music_assert_studio()
returns uuid
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select public.assert_net_system_admin();
$$;

create or replace function public.net_altara_music_audit(
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
  v_actor uuid;
begin
  v_actor := public.net_altara_music_assert_studio();
  if requested_action is null or char_length(requested_action) not between 1 and 120
    or requested_resource_type is null or char_length(requested_resource_type) not between 1 and 80
    or requested_resource_id is null
  then
    raise exception 'ALTARA_MUSIC_AUDIT_INPUT_INVALID' using errcode = '22023';
  end if;
  insert into public.net_action_audit (
    authenticated_actor_profile_id, presented_account_id,
    persona_subject_kind, persona_subject_id, action_mode, action_type,
    authorization_basis, resource_type, resource_id
  ) values (
    v_actor, null, null, null, 'gm-system', requested_action,
    'authoritative-gm-system:altara-music', requested_resource_type,
    requested_resource_id
  );
end;
$$;

create or replace function public.net_altara_music_audit_runtime(
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
  v_identity_link_id uuid;
  v_context record;
begin
  v_identity_link_id := public.net_altara_music_assert_reader(requested_identity_link_id);
  if requested_action is null or char_length(requested_action) not between 1 and 120
    or requested_resource_type is null or char_length(requested_resource_type) not between 1 and 80
    or requested_resource_id is null
  then
    raise exception 'ALTARA_MUSIC_AUDIT_INPUT_INVALID' using errcode = '22023';
  end if;
  select context.* into v_context
  from public.net_runtime_action_context(v_identity_link_id) as context;
  if v_context.action_mode is null or v_context.authorization_basis is null then
    raise exception 'ALTARA_MUSIC_RUNTIME_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;
  insert into public.net_action_audit (
    authenticated_actor_profile_id, presented_account_id,
    persona_subject_kind, persona_subject_id, action_mode, action_type,
    authorization_basis, resource_type, resource_id
  ) values (
    auth.uid(), null, v_context.persona_subject_kind, v_context.persona_subject_id,
    v_context.action_mode, requested_action,
    v_context.authorization_basis || ':altara-music',
    requested_resource_type, requested_resource_id
  );
end;
$$;

create or replace function public.net_altara_music_track_payload(
  requested_track public.net_altara_music_tracks,
  requested_identity_link_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', requested_track.id,
    'title', requested_track.title,
    'artist_id', artist.id,
    'artist_name', artist.name,
    'release_id', release_record.id,
    'release_title', release_record.title,
    'track_number', requested_track.track_number,
    'disc_number', requested_track.disc_number,
    'duration_ms', requested_track.duration_ms,
    'audio_object_path', requested_track.audio_object_path,
    'artwork_ref', coalesce(requested_track.artwork_ref, release_record.cover_ref, artist.avatar_ref),
    'explicit', requested_track.explicit,
    'featured', requested_track.featured,
    'liked', exists (
      select 1 from public.net_altara_music_liked_tracks as liked
      where liked.identity_link_id = requested_identity_link_id
        and liked.track_id = requested_track.id
    )
  )
  from public.net_altara_music_artists as artist
  left join public.net_altara_music_releases as release_record
    on release_record.id = requested_track.release_id
  where artist.id = requested_track.primary_artist_id;
$$;

create or replace function public.net_altara_music_release_payload(
  requested_release public.net_altara_music_releases
)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', requested_release.id, 'artist_id', artist.id, 'artist_name', artist.name,
    'title', requested_release.title, 'slug', requested_release.slug,
    'release_type', requested_release.release_type, 'cover_ref', requested_release.cover_ref,
    'release_date', requested_release.release_date, 'description', requested_release.description,
    'featured', requested_release.featured
  ) from public.net_altara_music_artists as artist
  where artist.id = requested_release.artist_id;
$$;

create or replace function public.net_altara_music_artist_payload(
  requested_artist public.net_altara_music_artists
)
returns jsonb
language sql immutable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', requested_artist.id, 'name', requested_artist.name, 'slug', requested_artist.slug,
    'avatar_ref', requested_artist.avatar_ref, 'banner_ref', requested_artist.banner_ref,
    'bio', requested_artist.bio, 'featured', requested_artist.featured
  );
$$;

create or replace function public.net_altara_music_playlist_payload(
  requested_playlist public.net_altara_music_playlists
)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', requested_playlist.id, 'playlist_kind', requested_playlist.playlist_kind,
    'title', requested_playlist.title, 'description', requested_playlist.description,
    'cover_ref', requested_playlist.cover_ref, 'featured', requested_playlist.featured,
    'track_count', (select count(*) from public.net_altara_music_playlist_items as item where item.playlist_id = requested_playlist.id)
  );
$$;

-- Exact artwork descriptor parser for the isolated ALTARA MUSIC namespace.
-- This is defined before Studio RPCs so PostgreSQL can validate every call at
-- function-creation time. Passing a null object name validates the complete
-- descriptor shape without broadening object-level Storage authorization.
create or replace function public.net_altara_music_media_ref_contains_object(
  requested_media_ref text,
  requested_subject_id uuid,
  requested_object_name text
)
returns boolean
language plpgsql immutable security definer set search_path = public, pg_temp
as $$
declare
  v_payload jsonb;
  v_variant jsonb;
  v_path text;
  v_hash text;
  v_mime text;
  v_extension text;
  v_found boolean := requested_object_name is null;
begin
  if requested_media_ref is null
    or requested_media_ref not like 'rpg-media:v1:%'
    or char_length(requested_media_ref) not between 16 and 4096
    or requested_subject_id is null
  then
    return false;
  end if;

  v_payload := convert_from(decode(
    translate(substr(requested_media_ref, char_length('rpg-media:v1:') + 1), '-_', '+/')
      || repeat('=', (4 - char_length(substr(requested_media_ref, char_length('rpg-media:v1:') + 1)) % 4) % 4),
    'base64'), 'UTF8')::jsonb;
  v_hash := lower(v_payload ->> 'h');
  if jsonb_typeof(v_payload) <> 'object'
    or v_payload ->> 'v' <> '1'
    or v_hash !~ '^[a-f0-9]{16,64}$'
    or jsonb_typeof(v_payload -> 'd') <> 'object'
    or (v_payload ? 't' and jsonb_typeof(v_payload -> 't') <> 'object')
  then
    return false;
  end if;

  for v_variant in
    select value
    from jsonb_array_elements(
      jsonb_build_array(v_payload -> 'd')
        || case when v_payload ? 't'
          then jsonb_build_array(v_payload -> 't')
          else '[]'::jsonb
        end
    )
  loop
    v_path := v_variant ->> 'p';
    v_mime := v_variant ->> 'm';
    v_extension := lower(split_part(split_part(v_path, '/', 6), '.', 2));
    if v_path is null
      or char_length(v_path) not between 1 and 1024
      or v_path like '/%'
      or v_path like '%..%'
      or split_part(v_path, '/', 1) <> 'altara-music-artwork'
      or split_part(v_path, '/', 2) <> requested_subject_id::text
      or split_part(v_path, '/', 3) <> 'general'
      or split_part(v_path, '/', 4) !~ '^[a-z0-9][a-z0-9_-]{0,127}$'
      or split_part(v_path, '/', 5) <> left(v_hash, 32)
      or split_part(v_path, '/', 6) !~ '^(display|thumbnail)\.(jpg|jpeg|png|webp|gif|avif)$'
      or split_part(v_path, '/', 7) <> ''
      or v_mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif')
      or (v_extension in ('jpg', 'jpeg') and v_mime <> 'image/jpeg')
      or (v_extension not in ('jpg', 'jpeg') and v_mime <> 'image/' || v_extension)
      or coalesce(v_variant ->> 'w', '') !~ '^[1-9][0-9]*$'
      or coalesce(v_variant ->> 'h', '') !~ '^[1-9][0-9]*$'
      or coalesce(v_variant ->> 'b', '') !~ '^[1-9][0-9]*$'
    then
      return false;
    end if;
    if v_path = requested_object_name then
      v_found := true;
    end if;
  end loop;
  return v_found;
exception when others then
  return false;
end;
$$;

create or replace function public.fetch_net_altara_music_home(
  requested_expected_identity_link_id uuid,
  requested_limit integer default 20
)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_limit integer := least(greatest(coalesce(requested_limit, 20), 1), 40);
begin
  v_identity_link_id := public.net_altara_music_assert_reader(requested_expected_identity_link_id);
  return jsonb_build_object(
    'identity_link_id', v_identity_link_id,
    'artists', coalesce((select jsonb_agg(public.net_altara_music_artist_payload(row_value::public.net_altara_music_artists)) from (
      select artist.* from public.net_altara_music_artists as artist
      where artist.status = 'published'
      order by artist.featured desc, artist.updated_at desc, artist.id limit v_limit
    ) as row_value), '[]'::jsonb),
    'releases', coalesce((select jsonb_agg(public.net_altara_music_release_payload(row_value::public.net_altara_music_releases)) from (
      select release_record.* from public.net_altara_music_releases as release_record
      join public.net_altara_music_artists as artist on artist.id = release_record.artist_id and artist.status = 'published'
      where release_record.status = 'published'
      order by release_record.featured desc, release_record.release_date desc nulls last, release_record.id limit v_limit
    ) as row_value), '[]'::jsonb),
    'tracks', coalesce((select jsonb_agg(public.net_altara_music_track_payload(row_value::public.net_altara_music_tracks, v_identity_link_id)) from (
      select track.* from public.net_altara_music_tracks as track
      join public.net_altara_music_artists as artist on artist.id = track.primary_artist_id and artist.status = 'published'
      left join public.net_altara_music_releases as release_record on release_record.id = track.release_id
      where track.status = 'published' and (track.release_id is null or release_record.status = 'published')
      order by track.featured desc, track.created_at desc, track.id limit v_limit
    ) as row_value), '[]'::jsonb),
    'playlists', coalesce((select jsonb_agg(public.net_altara_music_playlist_payload(row_value::public.net_altara_music_playlists)) from (
      select playlist.* from public.net_altara_music_playlists as playlist
      where playlist.playlist_kind = 'curated' and playlist.status = 'published'
      order by playlist.featured desc, playlist.updated_at desc, playlist.id limit v_limit
    ) as row_value), '[]'::jsonb),
    'spotify', coalesce((select jsonb_agg(to_jsonb(row_value)) from (
      select entry.id, entry.content_type, entry.provider_content_id as spotify_id,
        entry.canonical_url, entry.display_title, entry.description, entry.featured
      from public.net_altara_music_external_entries as entry
      where entry.status = 'published'
      order by entry.featured desc, entry.updated_at desc, entry.id limit v_limit
    ) as row_value), '[]'::jsonb),
    'recently_played', coalesce((select jsonb_agg(public.net_altara_music_track_payload(row_value::public.net_altara_music_tracks, v_identity_link_id)) from (
      select track.* from public.net_altara_music_recently_played as recent
      join public.net_altara_music_tracks as track on track.id = recent.track_id and track.status = 'published'
      join public.net_altara_music_artists as artist on artist.id = track.primary_artist_id and artist.status = 'published'
      left join public.net_altara_music_releases as release_record on release_record.id = track.release_id
      where recent.identity_link_id = v_identity_link_id
        and (track.release_id is null or release_record.status = 'published')
      order by recent.last_played_at desc, track.id limit 20
    ) as row_value), '[]'::jsonb)
  );
end;
$$;

create or replace function public.search_net_altara_music(
  requested_expected_identity_link_id uuid,
  requested_query text,
  requested_limit integer default 20
)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_query text := btrim(coalesce(requested_query, ''));
  v_pattern text;
  v_limit integer := least(greatest(coalesce(requested_limit, 20), 3), 40);
begin
  v_identity_link_id := public.net_altara_music_assert_reader(requested_expected_identity_link_id);
  if char_length(v_query) not between 1 and 120 then
    raise exception 'ALTARA_MUSIC_SEARCH_QUERY_INVALID' using errcode = '22023';
  end if;
  v_pattern := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return jsonb_build_object(
    'identity_link_id', v_identity_link_id,
    'artists', coalesce((select jsonb_agg(public.net_altara_music_artist_payload(row_value::public.net_altara_music_artists)) from (
      select artist.* from public.net_altara_music_artists as artist
      where artist.status = 'published' and artist.name ilike v_pattern escape '\'
      order by artist.featured desc, artist.name, artist.id limit v_limit
    ) as row_value), '[]'::jsonb),
    'releases', coalesce((select jsonb_agg(public.net_altara_music_release_payload(row_value::public.net_altara_music_releases)) from (
      select release_record.* from public.net_altara_music_releases as release_record
      join public.net_altara_music_artists as artist on artist.id = release_record.artist_id and artist.status = 'published'
      where release_record.status = 'published'
        and (release_record.title ilike v_pattern escape '\' or artist.name ilike v_pattern escape '\')
      order by release_record.featured desc, release_record.title, release_record.id limit v_limit
    ) as row_value), '[]'::jsonb),
    'tracks', coalesce((select jsonb_agg(public.net_altara_music_track_payload(row_value::public.net_altara_music_tracks, v_identity_link_id)) from (
      select track.* from public.net_altara_music_tracks as track
      join public.net_altara_music_artists as artist on artist.id = track.primary_artist_id and artist.status = 'published'
      left join public.net_altara_music_releases as release_record on release_record.id = track.release_id
      where track.status = 'published' and (track.release_id is null or release_record.status = 'published')
        and (track.title ilike v_pattern escape '\' or artist.name ilike v_pattern escape '\'
          or release_record.title ilike v_pattern escape '\')
      order by track.featured desc, track.title, track.id limit v_limit
    ) as row_value), '[]'::jsonb),
    'playlists', coalesce((select jsonb_agg(public.net_altara_music_playlist_payload(row_value::public.net_altara_music_playlists)) from (
      select playlist.* from public.net_altara_music_playlists as playlist
      where playlist.playlist_kind = 'curated' and playlist.status = 'published'
        and (playlist.title ilike v_pattern escape '\' or playlist.description ilike v_pattern escape '\')
      order by playlist.featured desc, playlist.title, playlist.id limit v_limit
    ) as row_value), '[]'::jsonb),
    'spotify', coalesce((select jsonb_agg(to_jsonb(row_value)) from (
      select entry.id, entry.content_type, entry.provider_content_id as spotify_id,
        entry.canonical_url, entry.display_title, entry.description, entry.featured
      from public.net_altara_music_external_entries as entry
      where entry.status = 'published'
        and (entry.display_title ilike v_pattern escape '\' or entry.description ilike v_pattern escape '\')
      order by entry.featured desc, entry.display_title, entry.id limit v_limit
    ) as row_value), '[]'::jsonb)
  );
end;
$$;

create or replace function public.fetch_net_altara_music_artist(
  requested_expected_identity_link_id uuid,
  requested_artist_id uuid
)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_artist public.net_altara_music_artists%rowtype;
begin
  v_identity_link_id := public.net_altara_music_assert_reader(requested_expected_identity_link_id);
  select artist.* into v_artist from public.net_altara_music_artists as artist
  where artist.id = requested_artist_id and artist.status = 'published';
  if not found then raise exception 'ALTARA_MUSIC_ARTIST_NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'artist', public.net_altara_music_artist_payload(v_artist),
    'releases', coalesce((select jsonb_agg(public.net_altara_music_release_payload(row_value::public.net_altara_music_releases)) from (
      select release_record.* from public.net_altara_music_releases as release_record
      where release_record.artist_id = v_artist.id and release_record.status = 'published'
      order by release_record.release_date desc nulls last, release_record.id limit 40
    ) as row_value), '[]'::jsonb),
    'tracks', coalesce((select jsonb_agg(public.net_altara_music_track_payload(row_value::public.net_altara_music_tracks, v_identity_link_id)) from (
      select track.* from public.net_altara_music_tracks as track
      left join public.net_altara_music_releases as release_record on release_record.id = track.release_id
      where track.primary_artist_id = v_artist.id and track.status = 'published'
        and (track.release_id is null or release_record.status = 'published')
      order by track.featured desc, track.created_at desc, track.id limit 80
    ) as row_value), '[]'::jsonb)
  );
end;
$$;

create or replace function public.fetch_net_altara_music_release(
  requested_expected_identity_link_id uuid,
  requested_release_id uuid
)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_release public.net_altara_music_releases%rowtype;
begin
  v_identity_link_id := public.net_altara_music_assert_reader(requested_expected_identity_link_id);
  select release_record.* into v_release
  from public.net_altara_music_releases as release_record
  join public.net_altara_music_artists as artist on artist.id = release_record.artist_id and artist.status = 'published'
  where release_record.id = requested_release_id and release_record.status = 'published';
  if not found then raise exception 'ALTARA_MUSIC_RELEASE_NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'release', public.net_altara_music_release_payload(v_release),
    'tracks', coalesce((select jsonb_agg(public.net_altara_music_track_payload(row_value::public.net_altara_music_tracks, v_identity_link_id)) from (
      select track.* from public.net_altara_music_tracks as track
      where track.release_id = v_release.id and track.status = 'published'
      order by track.disc_number, track.track_number nulls last, track.id limit 100
    ) as row_value), '[]'::jsonb)
  );
end;
$$;

create or replace function public.fetch_net_altara_music_library(requested_expected_identity_link_id uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare v_identity_link_id uuid;
begin
  v_identity_link_id := public.net_altara_music_assert_reader(requested_expected_identity_link_id);
  return jsonb_build_object(
    'identity_link_id', v_identity_link_id,
    'liked_tracks', coalesce((select jsonb_agg(public.net_altara_music_track_payload(row_value::public.net_altara_music_tracks, v_identity_link_id)) from (
      select track.* from public.net_altara_music_liked_tracks as liked
      join public.net_altara_music_tracks as track on track.id = liked.track_id and track.status = 'published'
      join public.net_altara_music_artists as artist on artist.id = track.primary_artist_id and artist.status = 'published'
      left join public.net_altara_music_releases as release_record on release_record.id = track.release_id
      where liked.identity_link_id = v_identity_link_id and (track.release_id is null or release_record.status = 'published')
      order by liked.liked_at desc, track.id limit 200
    ) as row_value), '[]'::jsonb),
    'playlists', coalesce((select jsonb_agg(public.net_altara_music_playlist_payload(row_value::public.net_altara_music_playlists)) from (
      select playlist.* from public.net_altara_music_playlists as playlist
      where playlist.playlist_kind = 'personal' and playlist.owner_identity_link_id = v_identity_link_id
      order by playlist.updated_at desc, playlist.id limit 100
    ) as row_value), '[]'::jsonb),
    'recently_played', coalesce((select jsonb_agg(public.net_altara_music_track_payload(row_value::public.net_altara_music_tracks, v_identity_link_id)) from (
      select track.* from public.net_altara_music_recently_played as recent
      join public.net_altara_music_tracks as track on track.id = recent.track_id and track.status = 'published'
      join public.net_altara_music_artists as artist on artist.id = track.primary_artist_id and artist.status = 'published'
      left join public.net_altara_music_releases as release_record on release_record.id = track.release_id
      where recent.identity_link_id = v_identity_link_id and (track.release_id is null or release_record.status = 'published')
      order by recent.last_played_at desc, track.id limit 50
    ) as row_value), '[]'::jsonb)
  );
end;
$$;

create or replace function public.fetch_net_altara_music_playlist(
  requested_expected_identity_link_id uuid,
  requested_playlist_id uuid
)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_playlist public.net_altara_music_playlists%rowtype;
begin
  v_identity_link_id := public.net_altara_music_assert_reader(requested_expected_identity_link_id);
  select playlist.* into v_playlist from public.net_altara_music_playlists as playlist
  where playlist.id = requested_playlist_id and (
    (playlist.playlist_kind = 'personal' and playlist.owner_identity_link_id = v_identity_link_id)
    or (playlist.playlist_kind = 'curated' and playlist.status = 'published')
  );
  if not found then raise exception 'ALTARA_MUSIC_PLAYLIST_NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'playlist', public.net_altara_music_playlist_payload(v_playlist),
    'tracks', coalesce((select jsonb_agg(public.net_altara_music_track_payload(row_value::public.net_altara_music_tracks, v_identity_link_id)) from (
      select track.* from public.net_altara_music_playlist_items as item
      join public.net_altara_music_tracks as track on track.id = item.track_id and track.status = 'published'
      join public.net_altara_music_artists as artist on artist.id = track.primary_artist_id and artist.status = 'published'
      left join public.net_altara_music_releases as release_record on release_record.id = track.release_id
      where item.playlist_id = v_playlist.id and (track.release_id is null or release_record.status = 'published')
      order by item.sort_rank, item.id limit 500
    ) as row_value), '[]'::jsonb)
  );
end;
$$;

create or replace function public.set_net_altara_music_track_liked(
  requested_expected_identity_link_id uuid,
  requested_track_id uuid,
  requested_liked boolean
)
returns boolean
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare v_identity_link_id uuid;
begin
  v_identity_link_id := public.net_altara_music_assert_reader(requested_expected_identity_link_id);
  if requested_liked is null then raise exception 'ALTARA_MUSIC_LIKE_STATE_REQUIRED' using errcode = '22023'; end if;
  perform 1 from public.net_altara_music_tracks as track
  join public.net_altara_music_artists as artist on artist.id = track.primary_artist_id and artist.status = 'published'
  left join public.net_altara_music_releases as release_record on release_record.id = track.release_id
  where track.id = requested_track_id and track.status = 'published'
    and (track.release_id is null or release_record.status = 'published') for share of track, artist;
  if not found then raise exception 'ALTARA_MUSIC_TRACK_NOT_FOUND' using errcode = 'P0002'; end if;
  if requested_liked then
    insert into public.net_altara_music_liked_tracks (identity_link_id, track_id)
    values (v_identity_link_id, requested_track_id) on conflict do nothing;
  else
    delete from public.net_altara_music_liked_tracks
    where identity_link_id = v_identity_link_id and track_id = requested_track_id;
  end if;
  perform public.net_altara_music_audit_runtime(
    v_identity_link_id,
    case when requested_liked then 'altara-music.like.add' else 'altara-music.like.remove' end,
    'altara-music-track', requested_track_id
  );
  return requested_liked;
end;
$$;

create or replace function public.record_net_altara_music_recent_play(
  requested_expected_identity_link_id uuid,
  requested_track_id uuid
)
returns boolean
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare v_identity_link_id uuid;
begin
  v_identity_link_id := public.net_altara_music_assert_reader(requested_expected_identity_link_id);
  perform 1 from public.net_altara_music_tracks as track
  join public.net_altara_music_artists as artist on artist.id = track.primary_artist_id and artist.status = 'published'
  left join public.net_altara_music_releases as release_record on release_record.id = track.release_id
  where track.id = requested_track_id and track.status = 'published'
    and (track.release_id is null or release_record.status = 'published') for share of track, artist;
  if not found then raise exception 'ALTARA_MUSIC_TRACK_NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.net_altara_music_recently_played (identity_link_id, track_id)
  values (v_identity_link_id, requested_track_id)
  on conflict (identity_link_id, track_id) do update set
    play_count = least(public.net_altara_music_recently_played.play_count + 1, 2147483647),
    last_played_at = timezone('utc', now());
  delete from public.net_altara_music_recently_played as recent
  where recent.identity_link_id = v_identity_link_id and recent.track_id in (
    select ranked.track_id from (
      select inner_recent.track_id,
        row_number() over (order by inner_recent.last_played_at desc, inner_recent.track_id) as ordinal
      from public.net_altara_music_recently_played as inner_recent
      where inner_recent.identity_link_id = v_identity_link_id
    ) as ranked where ranked.ordinal > 50
  );
  perform public.net_altara_music_assert_reader(requested_expected_identity_link_id);
  return true;
end;
$$;

create or replace function public.save_net_altara_music_personal_playlist(
  requested_expected_identity_link_id uuid,
  requested_playlist_id uuid,
  requested_title text,
  requested_description text
)
returns uuid
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_id uuid := coalesce(requested_playlist_id, gen_random_uuid());
begin
  v_identity_link_id := public.net_altara_music_assert_reader(requested_expected_identity_link_id);
  if btrim(coalesce(requested_title, '')) = '' or char_length(btrim(requested_title)) > 120
    or (nullif(btrim(coalesce(requested_description, '')), '') is not null and char_length(btrim(requested_description)) > 1000)
  then raise exception 'ALTARA_MUSIC_PLAYLIST_INPUT_INVALID' using errcode = '22023'; end if;
  if requested_playlist_id is null then
    if (select count(*) from public.net_altara_music_playlists where playlist_kind = 'personal' and owner_identity_link_id = v_identity_link_id) >= 100
    then raise exception 'ALTARA_MUSIC_PLAYLIST_LIMIT_REACHED' using errcode = 'P0001'; end if;
    insert into public.net_altara_music_playlists (
      id, playlist_kind, owner_identity_link_id, title, description, status
    ) values (
      v_id, 'personal', v_identity_link_id, btrim(requested_title),
      nullif(btrim(coalesce(requested_description, '')), ''), 'published'
    );
  else
    update public.net_altara_music_playlists set
      title = btrim(requested_title),
      description = nullif(btrim(coalesce(requested_description, '')), '')
    where id = requested_playlist_id and playlist_kind = 'personal'
      and owner_identity_link_id = v_identity_link_id;
    if not found then raise exception 'ALTARA_MUSIC_PLAYLIST_NOT_FOUND' using errcode = 'P0002'; end if;
  end if;
  perform public.net_altara_music_audit_runtime(
    v_identity_link_id, 'altara-music.playlist.save', 'altara-music-playlist', v_id
  );
  return v_id;
end;
$$;

create or replace function public.delete_net_altara_music_personal_playlist(
  requested_expected_identity_link_id uuid,
  requested_playlist_id uuid
)
returns boolean
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare v_identity_link_id uuid;
begin
  v_identity_link_id := public.net_altara_music_assert_reader(requested_expected_identity_link_id);
  delete from public.net_altara_music_playlists
  where id = requested_playlist_id and playlist_kind = 'personal'
    and owner_identity_link_id = v_identity_link_id;
  if not found then raise exception 'ALTARA_MUSIC_PLAYLIST_NOT_FOUND' using errcode = 'P0002'; end if;
  perform public.net_altara_music_audit_runtime(
    v_identity_link_id, 'altara-music.playlist.delete', 'altara-music-playlist', requested_playlist_id
  );
  return true;
end;
$$;

create or replace function public.set_net_altara_music_personal_playlist_track(
  requested_expected_identity_link_id uuid,
  requested_playlist_id uuid,
  requested_track_id uuid,
  requested_included boolean
)
returns boolean
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_rank bigint;
begin
  v_identity_link_id := public.net_altara_music_assert_reader(requested_expected_identity_link_id);
  perform 1 from public.net_altara_music_playlists as playlist
  where playlist.id = requested_playlist_id and playlist.playlist_kind = 'personal'
    and playlist.owner_identity_link_id = v_identity_link_id for update;
  if not found then raise exception 'ALTARA_MUSIC_PLAYLIST_NOT_FOUND' using errcode = 'P0002'; end if;
  if requested_included then
    if not exists (
      select 1 from public.net_altara_music_playlist_items as item
      where item.playlist_id = requested_playlist_id and item.track_id = requested_track_id
    ) then
      perform 1 from public.net_altara_music_tracks as track
      join public.net_altara_music_artists as artist on artist.id = track.primary_artist_id and artist.status = 'published'
      left join public.net_altara_music_releases as release_record on release_record.id = track.release_id
      where track.id = requested_track_id and track.status = 'published'
        and (track.release_id is null or release_record.status = 'published') for share of track, artist;
      if not found then raise exception 'ALTARA_MUSIC_TRACK_NOT_FOUND' using errcode = 'P0002'; end if;
      if (select count(*) from public.net_altara_music_playlist_items where playlist_id = requested_playlist_id) >= 500
      then raise exception 'ALTARA_MUSIC_PLAYLIST_TRACK_LIMIT_REACHED' using errcode = 'P0001'; end if;
      select coalesce(max(item.sort_rank), 0) + 1024 into v_rank
      from public.net_altara_music_playlist_items as item where item.playlist_id = requested_playlist_id;
      insert into public.net_altara_music_playlist_items (playlist_id, track_id, sort_rank)
      values (requested_playlist_id, requested_track_id, v_rank);
    end if;
  else
    delete from public.net_altara_music_playlist_items
    where playlist_id = requested_playlist_id and track_id = requested_track_id;
  end if;
  perform public.net_altara_music_audit_runtime(
    v_identity_link_id,
    case when requested_included then 'altara-music.playlist.track.add' else 'altara-music.playlist.track.remove' end,
    'altara-music-playlist', requested_playlist_id
  );
  return requested_included;
end;
$$;

-- Structured, bounded Studio directory. It never grants a fictional listener.
create or replace function public.fetch_net_altara_music_gm_studio()
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  perform public.net_altara_music_assert_studio();
  return jsonb_build_object(
    'artists', coalesce((select jsonb_agg(to_jsonb(row_value)) from (
      select artist.id, artist.name, artist.slug, artist.avatar_ref, artist.banner_ref,
        artist.bio, artist.status, artist.featured, artist.created_at, artist.updated_at
      from public.net_altara_music_artists as artist order by artist.updated_at desc, artist.id limit 500
    ) as row_value), '[]'::jsonb),
    'releases', coalesce((select jsonb_agg(to_jsonb(row_value)) from (
      select release_record.id, release_record.artist_id, release_record.title, release_record.slug,
        release_record.release_type, release_record.cover_ref, release_record.release_date,
        release_record.description, release_record.status, release_record.featured,
        release_record.created_at, release_record.updated_at
      from public.net_altara_music_releases as release_record order by release_record.updated_at desc, release_record.id limit 500
    ) as row_value), '[]'::jsonb),
    'tracks', coalesce((select jsonb_agg(to_jsonb(row_value)) from (
      select track.id, track.primary_artist_id, track.release_id, track.title,
        track.track_number, track.disc_number, track.audio_object_path,
        track.audio_mime_type, track.audio_byte_size, track.duration_ms,
        track.artwork_ref, track.explicit, track.status, track.featured,
        track.pending_delete_at, track.created_at, track.updated_at
      from public.net_altara_music_tracks as track order by track.updated_at desc, track.id limit 1000
    ) as row_value), '[]'::jsonb),
    'playlists', coalesce((select jsonb_agg(to_jsonb(row_value)) from (
      select playlist.id, playlist.title, playlist.description, playlist.cover_ref,
        playlist.status, playlist.featured, playlist.created_at, playlist.updated_at,
        coalesce((
          select jsonb_agg(item.track_id order by item.sort_rank, item.id)
          from public.net_altara_music_playlist_items as item
          where item.playlist_id = playlist.id
        ), '[]'::jsonb) as track_ids
      from public.net_altara_music_playlists as playlist where playlist.playlist_kind = 'curated'
      order by playlist.updated_at desc, playlist.id limit 200
    ) as row_value), '[]'::jsonb),
    'spotify', coalesce((select jsonb_agg(to_jsonb(row_value)) from (
      select entry.id, entry.content_type, entry.provider_content_id as spotify_id,
        entry.canonical_url, entry.display_title, entry.description,
        entry.status, entry.featured, entry.created_at, entry.updated_at
      from public.net_altara_music_external_entries as entry order by entry.updated_at desc, entry.id limit 200
    ) as row_value), '[]'::jsonb),
    'audio_bytes', coalesce((select sum(track.audio_byte_size::bigint) from public.net_altara_music_tracks as track), 0),
    'audio_budget_bytes', 419430400
  );
end;
$$;

create or replace function public.save_net_altara_music_gm_artist(
  requested_artist_id uuid,
  requested_name text,
  requested_slug text,
  requested_bio text,
  requested_avatar_ref text,
  requested_banner_ref text,
  requested_status text,
  requested_featured boolean
)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare v_actor uuid; v_id uuid := coalesce(requested_artist_id, gen_random_uuid());
begin
  v_actor := public.net_altara_music_assert_studio();
  if (nullif(btrim(coalesce(requested_avatar_ref, '')), '') is not null
      and not public.net_altara_music_media_ref_contains_object(requested_avatar_ref, v_id, null))
    or (nullif(btrim(coalesce(requested_banner_ref, '')), '') is not null
      and not public.net_altara_music_media_ref_contains_object(requested_banner_ref, v_id, null))
  then raise exception 'ALTARA_MUSIC_ARTIST_MEDIA_INVALID' using errcode = '22023'; end if;
  insert into public.net_altara_music_artists (
    id, name, slug, bio, avatar_ref, banner_ref, status, featured, created_by_profile_id
  ) values (
    v_id, btrim(requested_name), lower(btrim(requested_slug)), nullif(btrim(coalesce(requested_bio, '')), ''),
    nullif(btrim(coalesce(requested_avatar_ref, '')), ''), nullif(btrim(coalesce(requested_banner_ref, '')), ''),
    requested_status, coalesce(requested_featured, false), v_actor
  ) on conflict (id) do update set
    name = excluded.name, slug = excluded.slug, bio = excluded.bio,
    avatar_ref = excluded.avatar_ref, banner_ref = excluded.banner_ref,
    status = excluded.status, featured = excluded.featured;
  perform public.net_altara_music_audit('altara-music.artist.save', 'altara-music-artist', v_id);
  return public.fetch_net_altara_music_gm_studio();
end;
$$;

create or replace function public.save_net_altara_music_gm_release(
  requested_release_id uuid,
  requested_artist_id uuid,
  requested_title text,
  requested_slug text,
  requested_release_type text,
  requested_cover_ref text,
  requested_release_date date,
  requested_description text,
  requested_status text,
  requested_featured boolean
)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_id uuid := coalesce(requested_release_id, gen_random_uuid());
  v_existing_artist_id uuid;
begin
  v_actor := public.net_altara_music_assert_studio();
  -- Serialize every release/track artist mutation through the same table lock.
  -- This keeps the cross-table invariant stable while the release row is
  -- revalidated and prevents a concurrent track reassignment from bypassing it.
  lock table public.net_altara_music_tracks in share row exclusive mode;
  select release_record.artist_id into v_existing_artist_id
  from public.net_altara_music_releases as release_record
  where release_record.id = v_id
  for update;
  if found
    and v_existing_artist_id is distinct from requested_artist_id
    and exists (
      select 1 from public.net_altara_music_tracks as track
      where track.release_id = v_id
    )
  then
    raise exception 'ALTARA_MUSIC_RELEASE_ARTIST_CHANGE_REQUIRES_TRACK_REASSIGNMENT'
      using errcode = 'P0001';
  end if;
  perform 1 from public.net_altara_music_artists where id = requested_artist_id for share;
  if not found then raise exception 'ALTARA_MUSIC_ARTIST_NOT_FOUND' using errcode = 'P0002'; end if;
  if nullif(btrim(coalesce(requested_cover_ref, '')), '') is not null
    and not public.net_altara_music_media_ref_contains_object(requested_cover_ref, v_id, null)
  then raise exception 'ALTARA_MUSIC_RELEASE_MEDIA_INVALID' using errcode = '22023'; end if;
  insert into public.net_altara_music_releases (
    id, artist_id, title, slug, release_type, cover_ref, release_date,
    description, status, featured, created_by_profile_id
  ) values (
    v_id, requested_artist_id, btrim(requested_title), lower(btrim(requested_slug)),
    requested_release_type, nullif(btrim(coalesce(requested_cover_ref, '')), ''), requested_release_date,
    nullif(btrim(coalesce(requested_description, '')), ''), requested_status,
    coalesce(requested_featured, false), v_actor
  ) on conflict (id) do update set
    artist_id = excluded.artist_id, title = excluded.title, slug = excluded.slug,
    release_type = excluded.release_type, cover_ref = excluded.cover_ref,
    release_date = excluded.release_date, description = excluded.description,
    status = excluded.status, featured = excluded.featured;
  perform public.net_altara_music_audit('altara-music.release.save', 'altara-music-release', v_id);
  return public.fetch_net_altara_music_gm_studio();
end;
$$;

create or replace function public.net_altara_music_audio_object_name_is_valid(
  requested_object_name text,
  requested_track_id uuid default null
)
returns boolean
language sql immutable security definer
set search_path = public, pg_temp
as $$
  select requested_object_name is not null
    and char_length(requested_object_name) between 1 and 240
    and requested_object_name !~ '\.\.'
    and split_part(requested_object_name, '/', 1) = 'altara-music'
    and split_part(requested_object_name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and (requested_track_id is null or split_part(requested_object_name, '/', 2) = requested_track_id::text)
    and split_part(requested_object_name, '/', 3) ~ '^[a-f0-9]{64}\.(mp3|m4a|mp4|ogg|webm)$'
    and split_part(requested_object_name, '/', 4) = '';
$$;

create or replace function public.net_altara_music_storage_audio_metadata(
  requested_track_id uuid,
  requested_object_path text,
  requested_mime_type text,
  requested_byte_size integer
)
returns table (mime_type text, byte_size integer)
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare v_metadata jsonb; v_mime text; v_bytes bigint; v_extension text;
begin
  perform public.net_altara_music_assert_studio();
  if not public.net_altara_music_audio_object_name_is_valid(requested_object_path, requested_track_id)
  then raise exception 'ALTARA_MUSIC_AUDIO_PATH_INVALID' using errcode = '22023'; end if;
  select object.metadata into v_metadata from storage.objects as object
  where object.bucket_id = 'rpg-audio' and object.name = requested_object_path for share;
  if not found or v_metadata is null or jsonb_typeof(v_metadata) <> 'object'
    or coalesce(v_metadata ->> 'size', '') !~ '^[0-9]+$'
    or octet_length(coalesce(v_metadata ->> 'size', '')) > 10
    or nullif(btrim(v_metadata ->> 'mimetype'), '') is null
  then raise exception 'ALTARA_MUSIC_AUDIO_METADATA_REQUIRED' using errcode = 'P0001'; end if;
  v_bytes := (v_metadata ->> 'size')::bigint;
  v_mime := lower(btrim(v_metadata ->> 'mimetype'));
  v_extension := lower(split_part(requested_object_path, '.', 2));
  if v_bytes not between 1 and 15728640
    or v_mime not in ('audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/ogg', 'audio/webm')
    or (v_extension = 'mp3' and v_mime <> 'audio/mpeg')
    or (v_extension in ('m4a', 'mp4') and v_mime not in ('audio/mp4', 'audio/m4a', 'audio/x-m4a'))
    or (v_extension = 'ogg' and v_mime <> 'audio/ogg')
    or (v_extension = 'webm' and v_mime <> 'audio/webm')
    or coalesce(requested_byte_size::bigint, -1) <> v_bytes
    or coalesce(lower(btrim(requested_mime_type)), '') <> v_mime
  then raise exception 'ALTARA_MUSIC_AUDIO_METADATA_MISMATCH' using errcode = 'P0001'; end if;
  return query select v_mime, v_bytes::integer;
end;
$$;

create or replace function public.create_net_altara_music_gm_track(
  requested_track_id uuid,
  requested_artist_id uuid,
  requested_release_id uuid,
  requested_title text,
  requested_track_number integer,
  requested_disc_number integer,
  requested_object_path text,
  requested_mime_type text,
  requested_byte_size integer,
  requested_duration_ms integer,
  requested_artwork_ref text,
  requested_explicit boolean,
  requested_status text,
  requested_featured boolean
)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare v_actor uuid; v_storage record; v_library_bytes bigint;
begin
  v_actor := public.net_altara_music_assert_studio();
  lock table public.net_altara_music_tracks in share row exclusive mode;
  if requested_track_id is null or requested_duration_ms not between 2000 and 900000
  then raise exception 'ALTARA_MUSIC_TRACK_INPUT_INVALID' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(requested_artwork_ref, '')), '') is not null
    and not public.net_altara_music_media_ref_contains_object(requested_artwork_ref, requested_track_id, null)
  then raise exception 'ALTARA_MUSIC_TRACK_MEDIA_INVALID' using errcode = '22023'; end if;
  perform 1 from public.net_altara_music_artists where id = requested_artist_id for share;
  if not found then raise exception 'ALTARA_MUSIC_ARTIST_NOT_FOUND' using errcode = 'P0002'; end if;
  if requested_release_id is not null then
    perform 1 from public.net_altara_music_releases
    where id = requested_release_id and artist_id = requested_artist_id for share;
    if not found then raise exception 'ALTARA_MUSIC_RELEASE_ARTIST_MISMATCH' using errcode = '22023'; end if;
  end if;
  select metadata.* into v_storage from public.net_altara_music_storage_audio_metadata(
    requested_track_id, requested_object_path, requested_mime_type, requested_byte_size
  ) as metadata;
  select coalesce(sum(track.audio_byte_size::bigint), 0) into v_library_bytes
  from public.net_altara_music_tracks as track;
  if v_library_bytes + v_storage.byte_size > 419430400
  then raise exception 'ALTARA_MUSIC_STORAGE_BUDGET_REACHED' using errcode = 'P0001'; end if;
  if (select count(*) from public.net_altara_music_tracks) >= 2000
  then raise exception 'ALTARA_MUSIC_TRACK_LIMIT_REACHED' using errcode = 'P0001'; end if;
  insert into public.net_altara_music_tracks (
    id, primary_artist_id, release_id, title, track_number, disc_number,
    audio_object_path, audio_mime_type, audio_byte_size, duration_ms,
    artwork_ref, explicit, status, featured, created_by_profile_id
  ) values (
    requested_track_id, requested_artist_id, requested_release_id, btrim(requested_title),
    requested_track_number, coalesce(requested_disc_number, 1), requested_object_path,
    v_storage.mime_type, v_storage.byte_size, requested_duration_ms,
    nullif(btrim(coalesce(requested_artwork_ref, '')), ''), coalesce(requested_explicit, false),
    requested_status, coalesce(requested_featured, false), v_actor
  );
  perform public.net_altara_music_audit('altara-music.track.create', 'altara-music-track', requested_track_id);
  return public.fetch_net_altara_music_gm_studio();
end;
$$;

create or replace function public.update_net_altara_music_gm_track(
  requested_track_id uuid,
  requested_artist_id uuid,
  requested_release_id uuid,
  requested_title text,
  requested_track_number integer,
  requested_disc_number integer,
  requested_artwork_ref text,
  requested_explicit boolean,
  requested_status text,
  requested_featured boolean
)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  perform public.net_altara_music_assert_studio();
  lock table public.net_altara_music_tracks in share row exclusive mode;
  if nullif(btrim(coalesce(requested_artwork_ref, '')), '') is not null
    and not public.net_altara_music_media_ref_contains_object(requested_artwork_ref, requested_track_id, null)
  then raise exception 'ALTARA_MUSIC_TRACK_MEDIA_INVALID' using errcode = '22023'; end if;
  perform 1 from public.net_altara_music_artists where id = requested_artist_id for share;
  if not found then raise exception 'ALTARA_MUSIC_ARTIST_NOT_FOUND' using errcode = 'P0002'; end if;
  if requested_release_id is not null then
    perform 1 from public.net_altara_music_releases
    where id = requested_release_id and artist_id = requested_artist_id for share;
    if not found then raise exception 'ALTARA_MUSIC_RELEASE_ARTIST_MISMATCH' using errcode = '22023'; end if;
  end if;
  update public.net_altara_music_tracks set
    primary_artist_id = requested_artist_id, release_id = requested_release_id,
    title = btrim(requested_title), track_number = requested_track_number,
    disc_number = coalesce(requested_disc_number, 1),
    artwork_ref = nullif(btrim(coalesce(requested_artwork_ref, '')), ''),
    explicit = coalesce(requested_explicit, false), status = requested_status,
    featured = coalesce(requested_featured, false), pending_delete_at = null
  where id = requested_track_id;
  if not found then raise exception 'ALTARA_MUSIC_TRACK_NOT_FOUND' using errcode = 'P0002'; end if;
  perform public.net_altara_music_audit('altara-music.track.update', 'altara-music-track', requested_track_id);
  return public.fetch_net_altara_music_gm_studio();
end;
$$;

create or replace function public.replace_net_altara_music_gm_track_audio(
  requested_track_id uuid,
  requested_object_path text,
  requested_mime_type text,
  requested_byte_size integer,
  requested_duration_ms integer
)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare v_track public.net_altara_music_tracks%rowtype; v_storage record; v_library_bytes bigint;
begin
  perform public.net_altara_music_assert_studio();
  lock table public.net_altara_music_tracks in share row exclusive mode;
  select track.* into v_track from public.net_altara_music_tracks as track
  where track.id = requested_track_id for update;
  if not found then raise exception 'ALTARA_MUSIC_TRACK_NOT_FOUND' using errcode = 'P0002'; end if;
  if requested_duration_ms not between 2000 and 900000
  then raise exception 'ALTARA_MUSIC_TRACK_DURATION_INVALID' using errcode = '22023'; end if;
  select metadata.* into v_storage from public.net_altara_music_storage_audio_metadata(
    requested_track_id, requested_object_path, requested_mime_type, requested_byte_size
  ) as metadata;
  select coalesce(sum(track.audio_byte_size::bigint), 0) into v_library_bytes
  from public.net_altara_music_tracks as track;
  if v_library_bytes - v_track.audio_byte_size + v_storage.byte_size > 419430400
  then raise exception 'ALTARA_MUSIC_STORAGE_BUDGET_REACHED' using errcode = 'P0001'; end if;
  update public.net_altara_music_tracks set
    audio_object_path = requested_object_path, audio_mime_type = v_storage.mime_type,
    audio_byte_size = v_storage.byte_size, duration_ms = requested_duration_ms,
    pending_delete_at = null
  where id = requested_track_id;
  perform public.net_altara_music_audit('altara-music.track.audio.replace', 'altara-music-track', requested_track_id);
  return jsonb_build_object(
    'previous_object_path', v_track.audio_object_path,
    'studio', public.fetch_net_altara_music_gm_studio()
  );
end;
$$;

create or replace function public.prepare_net_altara_music_gm_track_delete(requested_track_id uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare v_track public.net_altara_music_tracks%rowtype;
begin
  perform public.net_altara_music_assert_studio();
  select track.* into v_track from public.net_altara_music_tracks as track
  where track.id = requested_track_id for update;
  if not found then raise exception 'ALTARA_MUSIC_TRACK_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_track.status <> 'archived' then raise exception 'ALTARA_MUSIC_DELETE_REQUIRES_ARCHIVED' using errcode = 'P0001'; end if;
  if exists (select 1 from public.net_altara_music_playlist_items where track_id = requested_track_id)
    or exists (select 1 from public.net_altara_music_liked_tracks where track_id = requested_track_id)
  then raise exception 'ALTARA_MUSIC_DELETE_DEPENDENCY_EXISTS' using errcode = 'P0001'; end if;
  update public.net_altara_music_tracks set pending_delete_at = timezone('utc', now())
  where id = requested_track_id;
  perform public.net_altara_music_audit('altara-music.track.delete.prepare', 'altara-music-track', requested_track_id);
  return jsonb_build_object('track_id', requested_track_id, 'object_path', v_track.audio_object_path);
end;
$$;

create or replace function public.finalize_net_altara_music_gm_track_delete(requested_track_id uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare v_track public.net_altara_music_tracks%rowtype;
begin
  perform public.net_altara_music_assert_studio();
  select track.* into v_track from public.net_altara_music_tracks as track
  where track.id = requested_track_id for update;
  if not found then return public.fetch_net_altara_music_gm_studio(); end if;
  if v_track.status <> 'archived' or v_track.pending_delete_at is null
  then raise exception 'ALTARA_MUSIC_DELETE_NOT_PREPARED' using errcode = 'P0001'; end if;
  if exists (select 1 from public.net_altara_music_playlist_items where track_id = requested_track_id)
    or exists (select 1 from public.net_altara_music_liked_tracks where track_id = requested_track_id)
  then raise exception 'ALTARA_MUSIC_DELETE_DEPENDENCY_EXISTS' using errcode = 'P0001'; end if;
  if exists (select 1 from storage.objects where bucket_id = 'rpg-audio' and name = v_track.audio_object_path)
  then raise exception 'ALTARA_MUSIC_DELETE_OBJECT_STILL_EXISTS' using errcode = 'P0001'; end if;
  delete from public.net_altara_music_recently_played where track_id = requested_track_id;
  delete from public.net_altara_music_tracks where id = requested_track_id;
  perform public.net_altara_music_audit('altara-music.track.delete', 'altara-music-track', requested_track_id);
  return public.fetch_net_altara_music_gm_studio();
end;
$$;

create or replace function public.save_net_altara_music_gm_spotify_entry(
  requested_entry_id uuid,
  requested_content_type text,
  requested_spotify_id text,
  requested_display_title text,
  requested_description text,
  requested_status text,
  requested_featured boolean
)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare v_actor uuid; v_id uuid := coalesce(requested_entry_id, gen_random_uuid());
begin
  v_actor := public.net_altara_music_assert_studio();
  insert into public.net_altara_music_external_entries (
    id, provider, content_type, provider_content_id, canonical_url,
    display_title, description, status, featured, created_by_profile_id
  ) values (
    v_id, 'spotify', requested_content_type, requested_spotify_id,
    'https://open.spotify.com/' || requested_content_type || '/' || requested_spotify_id,
    btrim(requested_display_title), nullif(btrim(coalesce(requested_description, '')), ''),
    requested_status, coalesce(requested_featured, false), v_actor
  ) on conflict (id) do update set
    content_type = excluded.content_type, provider_content_id = excluded.provider_content_id,
    canonical_url = excluded.canonical_url, display_title = excluded.display_title,
    description = excluded.description, status = excluded.status, featured = excluded.featured;
  perform public.net_altara_music_audit('altara-music.spotify.save', 'altara-music-external', v_id);
  return public.fetch_net_altara_music_gm_studio();
end;
$$;

create or replace function public.save_net_altara_music_gm_curated_playlist(
  requested_playlist_id uuid,
  requested_title text,
  requested_description text,
  requested_cover_ref text,
  requested_status text,
  requested_featured boolean
)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare v_actor uuid; v_id uuid := coalesce(requested_playlist_id, gen_random_uuid());
begin
  v_actor := public.net_altara_music_assert_studio();
  if nullif(btrim(coalesce(requested_cover_ref, '')), '') is not null
    and not public.net_altara_music_media_ref_contains_object(requested_cover_ref, v_id, null)
  then raise exception 'ALTARA_MUSIC_PLAYLIST_MEDIA_INVALID' using errcode = '22023'; end if;
  insert into public.net_altara_music_playlists (
    id, playlist_kind, owner_identity_link_id, title, description,
    cover_ref, status, featured, created_by_profile_id
  ) values (
    v_id, 'curated', null, btrim(requested_title),
    nullif(btrim(coalesce(requested_description, '')), ''),
    nullif(btrim(coalesce(requested_cover_ref, '')), ''), requested_status,
    coalesce(requested_featured, false), v_actor
  ) on conflict (id) do update set
    title = excluded.title, description = excluded.description,
    cover_ref = excluded.cover_ref, status = excluded.status, featured = excluded.featured;
  perform public.net_altara_music_audit('altara-music.playlist.save', 'altara-music-playlist', v_id);
  return public.fetch_net_altara_music_gm_studio();
end;
$$;

create or replace function public.set_net_altara_music_gm_curated_playlist_track(
  requested_playlist_id uuid,
  requested_track_id uuid,
  requested_included boolean
)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare v_rank bigint;
begin
  perform public.net_altara_music_assert_studio();
  perform 1 from public.net_altara_music_playlists
  where id = requested_playlist_id and playlist_kind = 'curated' for update;
  if not found then raise exception 'ALTARA_MUSIC_PLAYLIST_NOT_FOUND' using errcode = 'P0002'; end if;
  perform 1 from public.net_altara_music_tracks where id = requested_track_id for share;
  if not found then raise exception 'ALTARA_MUSIC_TRACK_NOT_FOUND' using errcode = 'P0002'; end if;
  if requested_included then
    if not exists (
      select 1 from public.net_altara_music_playlist_items as item
      where item.playlist_id = requested_playlist_id and item.track_id = requested_track_id
    ) then
      if (select count(*) from public.net_altara_music_playlist_items where playlist_id = requested_playlist_id) >= 500
      then raise exception 'ALTARA_MUSIC_PLAYLIST_TRACK_LIMIT_REACHED' using errcode = 'P0001'; end if;
      select coalesce(max(sort_rank), 0) + 1024 into v_rank
      from public.net_altara_music_playlist_items where playlist_id = requested_playlist_id;
      insert into public.net_altara_music_playlist_items (playlist_id, track_id, sort_rank)
      values (requested_playlist_id, requested_track_id, v_rank);
    end if;
  else
    delete from public.net_altara_music_playlist_items
    where playlist_id = requested_playlist_id and track_id = requested_track_id;
  end if;
  perform public.net_altara_music_audit('altara-music.playlist.track.set', 'altara-music-playlist', requested_playlist_id);
  return public.fetch_net_altara_music_gm_studio();
end;
$$;

-- Exact private audio authorization. Readers can sign only a currently
-- published canonical track object; Studio can upload and clean its namespace.
create or replace function public.current_user_can_write_net_altara_music_audio_object(requested_object_name text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_user_is_net_system_admin()
    and public.net_altara_music_audio_object_name_is_valid(requested_object_name, null);
$$;

create or replace function public.current_user_can_read_net_altara_music_audio_object(requested_object_name text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.net_altara_music_audio_object_name_is_valid(requested_object_name, null)
    and (
      public.current_user_is_net_system_admin()
      or (
        public.current_net_effective_runtime_identity_link_id() is not null
        and public.current_user_has_net_runtime_service_for_link(
          public.current_net_effective_runtime_identity_link_id(), 'altara-music'
        )
        and exists (
          select 1 from public.net_identity_app_installs as install
          where install.identity_link_id = public.current_net_effective_runtime_identity_link_id()
            and install.app_id = 'altara-music'
        )
        and exists (
          select 1 from public.net_altara_music_tracks as track
          join public.net_altara_music_artists as artist
            on artist.id = track.primary_artist_id and artist.status = 'published'
          left join public.net_altara_music_releases as release_record on release_record.id = track.release_id
          where track.audio_object_path = requested_object_name and track.status = 'published'
            and (track.release_id is null or release_record.status = 'published')
        )
      )
    );
$$;

create or replace function public.current_user_can_delete_net_altara_music_audio_object(requested_object_name text)
returns boolean language sql volatile security definer set search_path = public, pg_temp as $$
  select public.current_user_is_net_system_admin()
    and public.net_altara_music_audio_object_name_is_valid(requested_object_name, null)
    and (
      not exists (select 1 from public.net_altara_music_tracks where audio_object_path = requested_object_name)
      or exists (
        select 1 from public.net_altara_music_tracks
        where audio_object_path = requested_object_name
          and status = 'archived' and pending_delete_at is not null
      )
    );
$$;

create policy rpg_audio_altara_music_select_authorised on storage.objects
for select to authenticated using (
  bucket_id = 'rpg-audio' and public.current_user_can_read_net_altara_music_audio_object(name)
);
create policy rpg_audio_altara_music_insert_authorised on storage.objects
for insert to authenticated with check (
  bucket_id = 'rpg-audio' and public.current_user_can_write_net_altara_music_audio_object(name)
);
create policy rpg_audio_altara_music_delete_authorised on storage.objects
for delete to authenticated using (
  bucket_id = 'rpg-audio' and public.current_user_can_delete_net_altara_music_audio_object(name)
);

create or replace function public.current_user_can_write_net_altara_music_media_object(requested_object_name text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_user_is_net_system_admin()
    and requested_object_name not like '%..%'
    and split_part(requested_object_name, '/', 1) = 'altara-music-artwork'
    and split_part(requested_object_name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and split_part(requested_object_name, '/', 3) = 'general'
    and split_part(requested_object_name, '/', 4) ~ '^[a-z0-9][a-z0-9_-]{0,127}$'
    and split_part(requested_object_name, '/', 5) ~ '^[a-f0-9]{32}$'
    and split_part(requested_object_name, '/', 6) ~ '^(display|thumbnail)\.(jpg|jpeg|png|webp|gif|avif)$'
    and split_part(requested_object_name, '/', 7) = ''
    and (
      exists (select 1 from public.net_altara_music_artists where id::text = split_part(requested_object_name, '/', 2))
      or exists (select 1 from public.net_altara_music_releases where id::text = split_part(requested_object_name, '/', 2))
      or exists (select 1 from public.net_altara_music_tracks where id::text = split_part(requested_object_name, '/', 2))
      or exists (select 1 from public.net_altara_music_playlists where id::text = split_part(requested_object_name, '/', 2) and playlist_kind = 'curated')
    );
$$;

create or replace function public.current_user_can_read_net_altara_music_media_object(requested_object_name text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and (
    public.current_user_is_net_system_admin()
    or (
      public.current_net_effective_runtime_identity_link_id() is not null
      and public.current_user_has_net_runtime_service_for_link(
        public.current_net_effective_runtime_identity_link_id(), 'altara-music'
      )
      and exists (
        select 1 from public.net_identity_app_installs as install
        where install.identity_link_id = public.current_net_effective_runtime_identity_link_id()
          and install.app_id = 'altara-music'
      )
      and (
        exists (select 1 from public.net_altara_music_artists as artist
          where artist.status = 'published' and public.net_altara_music_media_ref_contains_object(artist.avatar_ref, artist.id, requested_object_name))
        or exists (select 1 from public.net_altara_music_artists as artist
          where artist.status = 'published' and public.net_altara_music_media_ref_contains_object(artist.banner_ref, artist.id, requested_object_name))
        or exists (select 1 from public.net_altara_music_releases as release_record
          join public.net_altara_music_artists as artist on artist.id = release_record.artist_id and artist.status = 'published'
          where release_record.status = 'published' and public.net_altara_music_media_ref_contains_object(release_record.cover_ref, release_record.id, requested_object_name))
        or exists (select 1 from public.net_altara_music_tracks as track
          join public.net_altara_music_artists as artist on artist.id = track.primary_artist_id and artist.status = 'published'
          left join public.net_altara_music_releases as release_record on release_record.id = track.release_id
          where track.status = 'published' and (track.release_id is null or release_record.status = 'published')
            and public.net_altara_music_media_ref_contains_object(track.artwork_ref, track.id, requested_object_name))
        or exists (select 1 from public.net_altara_music_playlists as playlist
          where playlist.playlist_kind = 'curated' and playlist.status = 'published'
            and public.net_altara_music_media_ref_contains_object(playlist.cover_ref, playlist.id, requested_object_name))
        or exists (select 1 from public.net_altara_music_playlists as playlist
          where playlist.playlist_kind = 'personal'
            and playlist.owner_identity_link_id = public.current_net_effective_runtime_identity_link_id()
            and public.net_altara_music_media_ref_contains_object(playlist.cover_ref, playlist.id, requested_object_name))
      )
    )
  );
$$;

create policy rpg_media_altara_music_select_authorised on storage.objects
for select to authenticated using (
  bucket_id = 'rpg-media' and public.current_user_can_read_net_altara_music_media_object(name)
);
create policy rpg_media_altara_music_insert_authorised on storage.objects
for insert to authenticated with check (
  bucket_id = 'rpg-media' and public.current_user_can_write_net_altara_music_media_object(name)
);
create policy rpg_media_altara_music_update_authorised on storage.objects
for update to authenticated using (
  bucket_id = 'rpg-media' and public.current_user_can_write_net_altara_music_media_object(name)
) with check (
  bucket_id = 'rpg-media' and public.current_user_can_write_net_altara_music_media_object(name)
);
create policy rpg_media_altara_music_delete_authorised on storage.objects
for delete to authenticated using (
  bucket_id = 'rpg-media' and public.current_user_can_write_net_altara_music_media_object(name)
);

do $$ declare v_table text; begin
  foreach v_table in array array[
    'net_altara_music_artists', 'net_altara_music_releases', 'net_altara_music_tracks',
    'net_altara_music_playlists', 'net_altara_music_playlist_items',
    'net_altara_music_liked_tracks', 'net_altara_music_recently_played',
    'net_altara_music_external_entries'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
  end loop;
end $$;

-- Internal helpers stay private. Only bounded product RPCs and the narrow
-- boolean Storage predicates are executable by authenticated clients.
revoke all on function public.net_altara_music_assert_reader(uuid) from public, anon, authenticated;
revoke all on function public.net_altara_music_assert_studio() from public, anon, authenticated;
revoke all on function public.net_altara_music_audit(text,text,uuid) from public, anon, authenticated;
revoke all on function public.net_altara_music_audit_runtime(uuid,text,text,uuid) from public, anon, authenticated;
revoke all on function public.net_altara_music_track_payload(public.net_altara_music_tracks,uuid) from public, anon, authenticated;
revoke all on function public.net_altara_music_release_payload(public.net_altara_music_releases) from public, anon, authenticated;
revoke all on function public.net_altara_music_artist_payload(public.net_altara_music_artists) from public, anon, authenticated;
revoke all on function public.net_altara_music_playlist_payload(public.net_altara_music_playlists) from public, anon, authenticated;
revoke all on function public.net_altara_music_audio_object_name_is_valid(text,uuid) from public, anon, authenticated;
revoke all on function public.net_altara_music_storage_audio_metadata(uuid,text,text,integer) from public, anon, authenticated;
revoke all on function public.net_altara_music_media_ref_contains_object(text,uuid,text) from public, anon, authenticated;

do $$ declare v_signature regprocedure; begin
  for v_signature in
    select procedure_row.oid::regprocedure
    from pg_proc as procedure_row
    join pg_namespace as namespace_row on namespace_row.oid = procedure_row.pronamespace
    where namespace_row.nspname = 'public'
      and procedure_row.proname like '%net_altara_music%'
  loop execute format('revoke all on function %s from public, anon, authenticated', v_signature); end loop;
end $$;

grant execute on function public.fetch_net_altara_music_home(uuid,integer) to authenticated;
grant execute on function public.search_net_altara_music(uuid,text,integer) to authenticated;
grant execute on function public.fetch_net_altara_music_artist(uuid,uuid) to authenticated;
grant execute on function public.fetch_net_altara_music_release(uuid,uuid) to authenticated;
grant execute on function public.fetch_net_altara_music_library(uuid) to authenticated;
grant execute on function public.fetch_net_altara_music_playlist(uuid,uuid) to authenticated;
grant execute on function public.set_net_altara_music_track_liked(uuid,uuid,boolean) to authenticated;
grant execute on function public.record_net_altara_music_recent_play(uuid,uuid) to authenticated;
grant execute on function public.save_net_altara_music_personal_playlist(uuid,uuid,text,text) to authenticated;
grant execute on function public.delete_net_altara_music_personal_playlist(uuid,uuid) to authenticated;
grant execute on function public.set_net_altara_music_personal_playlist_track(uuid,uuid,uuid,boolean) to authenticated;
grant execute on function public.fetch_net_altara_music_gm_studio() to authenticated;
grant execute on function public.save_net_altara_music_gm_artist(uuid,text,text,text,text,text,text,boolean) to authenticated;
grant execute on function public.save_net_altara_music_gm_release(uuid,uuid,text,text,text,text,date,text,text,boolean) to authenticated;
grant execute on function public.create_net_altara_music_gm_track(uuid,uuid,uuid,text,integer,integer,text,text,integer,integer,text,boolean,text,boolean) to authenticated;
grant execute on function public.update_net_altara_music_gm_track(uuid,uuid,uuid,text,integer,integer,text,boolean,text,boolean) to authenticated;
grant execute on function public.replace_net_altara_music_gm_track_audio(uuid,text,text,integer,integer) to authenticated;
grant execute on function public.prepare_net_altara_music_gm_track_delete(uuid) to authenticated;
grant execute on function public.finalize_net_altara_music_gm_track_delete(uuid) to authenticated;
grant execute on function public.save_net_altara_music_gm_spotify_entry(uuid,text,text,text,text,text,boolean) to authenticated;
grant execute on function public.save_net_altara_music_gm_curated_playlist(uuid,text,text,text,text,boolean) to authenticated;
grant execute on function public.set_net_altara_music_gm_curated_playlist_track(uuid,uuid,boolean) to authenticated;
grant execute on function public.current_user_can_write_net_altara_music_audio_object(text) to authenticated;
grant execute on function public.current_user_can_read_net_altara_music_audio_object(text) to authenticated;
grant execute on function public.current_user_can_delete_net_altara_music_audio_object(text) to authenticated;
grant execute on function public.current_user_can_write_net_altara_music_media_object(text) to authenticated;
grant execute on function public.current_user_can_read_net_altara_music_media_object(text) to authenticated;

revoke all on function public.set_net_identity_app_install(uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.set_net_identity_app_install(uuid,text,boolean) to authenticated;

commit;
