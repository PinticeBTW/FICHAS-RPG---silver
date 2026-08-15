-- ALTARA NEWS V2 Phase 2: isolated global broadcast/radio parity.
-- Forward-only. Run after net-altara-news-platform-parity.sql.
-- Creates no clips, uploads no objects, and inserts no fictional content.

begin;

do $$
begin
  if to_regclass('public.net_altara_news_realtime_state') is null
    or to_regclass('public.net_altara_news_articles') is null
    or to_regclass('public.net_action_audit') is null
    or to_regclass('public.profiles') is null
    or to_regclass('storage.objects') is null
    or to_regclass('storage.buckets') is null
    or not exists (
      select 1
      from information_schema.columns as column_definition
      where column_definition.table_schema = 'storage'
        and column_definition.table_name = 'objects'
        and column_definition.column_name = 'metadata'
        and column_definition.data_type = 'jsonb'
    )
    or to_regprocedure('auth.uid()') is null
    or to_regprocedure('public.set_updated_at()') is null
    or to_regprocedure('public.is_current_user_gm()') is null
    or to_regprocedure('public.assert_net_altara_news_gm_editor()') is null
    or to_regprocedure('public.net_altara_news_effective_player_identity(uuid)') is null
    or to_regprocedure('public.current_user_can_read_net_altara_news_revision()') is null
  then
    raise exception 'ALTARA_NEWS_BROADCAST_DEPENDENCY_REQUIRED' using errcode = '55000';
  end if;

  if to_regclass('public.net_altara_news_broadcast_clips') is not null
    or to_regclass('public.net_altara_news_broadcast_station') is not null
    or exists (
      select 1
      from information_schema.columns as column_definition
      where column_definition.table_schema = 'public'
        and column_definition.table_name = 'net_altara_news_realtime_state'
        and column_definition.column_name = 'broadcast_revision'
    )
  then
    raise exception 'ALTARA_NEWS_BROADCAST_PREEXISTING_REVIEW_REQUIRED' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from storage.buckets as bucket
    where bucket.id = 'rpg-audio'
      and bucket.public = false
      and bucket.file_size_limit is not null
      and bucket.file_size_limit >= 15728640
      and bucket.allowed_mime_types @> array[
        'audio/mpeg', 'audio/mp4', 'audio/m4a',
        'audio/x-m4a', 'audio/ogg', 'audio/webm'
      ]::text[]
  ) then
    raise exception 'ALTARA_NEWS_BROADCAST_PRIVATE_AUDIO_BUCKET_REQUIRED' using errcode = '55000';
  end if;
end;
$$;


alter table public.net_altara_news_realtime_state
  add column broadcast_revision bigint not null default 0;

alter table public.net_altara_news_realtime_state
  add constraint net_altara_news_realtime_state_broadcast_revision_nonnegative
  check (broadcast_revision >= 0);

alter table public.net_altara_news_realtime_state replica identity full;

create table public.net_altara_news_broadcast_clips (
  id uuid primary key,
  internal_label text not null,
  public_label text,
  clip_kind text not null check (clip_kind in (
    'news', 'bulletin', 'station-id', 'jingle', 'advertisement',
    'weather', 'traffic', 'interview', 'public-service', 'ambience', 'other'
  )),
  status text not null default 'active' check (status in ('active', 'archived')),
  rotation_enabled boolean not null default false,
  rotation_weight smallint not null default 1 check (rotation_weight between 1 and 5),
  object_path text not null unique,
  mime_type text not null check (mime_type in (
    'audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/ogg', 'audio/webm'
  )),
  byte_size integer not null check (byte_size between 1 and 15728640),
  duration_ms integer not null check (duration_ms between 2000 and 900000),
  pending_delete_at timestamptz,
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint net_altara_news_broadcast_clips_internal_label_shape check (
    internal_label = btrim(internal_label) and char_length(internal_label) between 1 and 120
  ),
  constraint net_altara_news_broadcast_clips_public_label_shape check (
    public_label is null or (
      public_label = btrim(public_label) and char_length(public_label) between 1 and 160
    )
  ),
  constraint net_altara_news_broadcast_clips_archive_shape check (
    status = 'active' or rotation_enabled = false
  ),
  constraint net_altara_news_broadcast_clips_pending_delete_shape check (
    pending_delete_at is null or (status = 'archived' and rotation_enabled = false)
  ),
  constraint net_altara_news_broadcast_clips_object_path_shape check (
    object_path = lower(object_path)
    and object_path !~ '\.\.'
    and split_part(object_path, '/', 1) = 'altara-news-broadcast'
    and split_part(object_path, '/', 2) = id::text
    and split_part(object_path, '/', 3) ~ '^[0-9a-f]{64}\.(mp3|m4a|mp4|ogg|webm)$'
    and split_part(object_path, '/', 4) = ''
  ),
  constraint net_altara_news_broadcast_clips_mime_extension_shape check (
    (mime_type = 'audio/mpeg' and object_path ~ '\.mp3$')
    or (mime_type in ('audio/mp4', 'audio/m4a', 'audio/x-m4a') and object_path ~ '\.(m4a|mp4)$')
    or (mime_type = 'audio/ogg' and object_path ~ '\.ogg$')
    or (mime_type = 'audio/webm' and object_path ~ '\.webm$')
  )
);

comment on table public.net_altara_news_broadcast_clips is
  'Private ALTARA NEWS global broadcast library. It has no NVN dependency and players receive only the current on-air projection.';

create index net_altara_news_broadcast_clips_gm_directory_idx
  on public.net_altara_news_broadcast_clips (status, updated_at desc, id desc);
create index net_altara_news_broadcast_clips_rotation_idx
  on public.net_altara_news_broadcast_clips (id)
  where status = 'active' and rotation_enabled = true;

create trigger net_altara_news_broadcast_clips_set_updated_at
before update on public.net_altara_news_broadcast_clips
for each row execute function public.set_updated_at();

create table public.net_altara_news_broadcast_station (
  channel text primary key default 'public' check (channel = 'public'),
  station_enabled boolean not null default false,
  rotation_epoch_at timestamptz not null default timezone('utc', now()),
  rotation_seed bigint not null default 0,
  breaking_stinger_clip_id uuid
    references public.net_altara_news_broadcast_clips (id) on delete restrict,
  override_mode text check (override_mode is null or override_mode in ('play-now', 'breaking')),
  override_clip_id uuid
    references public.net_altara_news_broadcast_clips (id) on delete restrict,
  override_started_at timestamptz,
  override_ends_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint net_altara_news_broadcast_station_override_shape check (
    num_nonnulls(override_mode, override_clip_id, override_started_at, override_ends_at) in (0, 4)
    and (override_mode is null or override_ends_at > override_started_at)
  )
);

comment on table public.net_altara_news_broadcast_station is
  'Singleton global ALTARA NEWS broadcast authority. Server time, epoch and seed determine playback without polling or a worker.';

insert into public.net_altara_news_broadcast_station (
  channel, station_enabled, rotation_epoch_at, rotation_seed
) values (
  'public', false, timezone('utc', now()), hashtextextended(gen_random_uuid()::text, 0)
);

create trigger net_altara_news_broadcast_station_set_updated_at
before update on public.net_altara_news_broadcast_station
for each row execute function public.set_updated_at();

create or replace function public.net_altara_news_broadcast_object_name_is_valid(
  requested_object_name text,
  requested_clip_id uuid default null
)
returns boolean
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select requested_object_name is not null
    and octet_length(requested_object_name) <= 240
    and requested_object_name = lower(requested_object_name)
    and requested_object_name !~ '\.\.'
    and split_part(requested_object_name, '/', 1) = 'altara-news-broadcast'
    and split_part(requested_object_name, '/', 2)
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and (requested_clip_id is null
      or split_part(requested_object_name, '/', 2) = requested_clip_id::text)
    and split_part(requested_object_name, '/', 3)
      ~ '^[0-9a-f]{64}\.(mp3|m4a|mp4|ogg|webm)$'
    and split_part(requested_object_name, '/', 4) = '';
$$;

create or replace function public.assert_net_altara_news_gm_broadcast_clip_input(
  requested_clip_id uuid,
  requested_internal_label text,
  requested_public_label text,
  requested_clip_kind text,
  requested_rotation_enabled boolean,
  requested_rotation_weight integer,
  requested_object_path text,
  requested_mime_type text,
  requested_byte_size integer,
  requested_duration_ms integer
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_public_label text := nullif(btrim(requested_public_label), '');
  v_kind text := lower(btrim(coalesce(requested_clip_kind, '')));
  v_mime text := lower(btrim(coalesce(requested_mime_type, '')));
begin
  if requested_clip_id is null
    or char_length(btrim(coalesce(requested_internal_label, ''))) not between 1 and 120
    or octet_length(coalesce(requested_internal_label, '')) > 480
  then
    raise exception 'ALTARA_NEWS_BROADCAST_INTERNAL_LABEL_INVALID' using errcode = '22023';
  end if;
  if octet_length(coalesce(requested_public_label, '')) > 640
    or (v_public_label is not null and char_length(v_public_label) > 160)
  then
    raise exception 'ALTARA_NEWS_BROADCAST_PUBLIC_LABEL_INVALID' using errcode = '22023';
  end if;
  if v_kind not in (
    'news', 'bulletin', 'station-id', 'jingle', 'advertisement',
    'weather', 'traffic', 'interview', 'public-service', 'ambience', 'other'
  ) then
    raise exception 'ALTARA_NEWS_BROADCAST_CLIP_KIND_INVALID' using errcode = '22023';
  end if;
  if requested_rotation_enabled is null
    or requested_rotation_weight is null
    or requested_rotation_weight not between 1 and 5
  then
    raise exception 'ALTARA_NEWS_BROADCAST_ROTATION_INVALID' using errcode = '22023';
  end if;
  if not public.net_altara_news_broadcast_object_name_is_valid(
    requested_object_path, requested_clip_id
  ) then
    raise exception 'ALTARA_NEWS_BROADCAST_OBJECT_PATH_INVALID' using errcode = '22023';
  end if;
  if v_mime not in (
    'audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/ogg', 'audio/webm'
  )
    or (v_mime = 'audio/mpeg' and requested_object_path !~ '\.mp3$')
    or (v_mime in ('audio/mp4', 'audio/m4a', 'audio/x-m4a') and requested_object_path !~ '\.(m4a|mp4)$')
    or (v_mime = 'audio/ogg' and requested_object_path !~ '\.ogg$')
    or (v_mime = 'audio/webm' and requested_object_path !~ '\.webm$')
  then
    raise exception 'ALTARA_NEWS_BROADCAST_MIME_INVALID' using errcode = '22023';
  end if;
  if requested_byte_size is null or requested_byte_size not between 1 and 15728640 then
    raise exception 'ALTARA_NEWS_BROADCAST_FILE_SIZE_INVALID' using errcode = '22023';
  end if;
  if requested_duration_ms is null or requested_duration_ms not between 2000 and 900000 then
    raise exception 'ALTARA_NEWS_BROADCAST_DURATION_INVALID' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.net_altara_news_broadcast_tune_payload_at(
  requested_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_at timestamptz := coalesce(requested_at, clock_timestamp());
  v_station public.net_altara_news_broadcast_station%rowtype;
  v_cycle_duration_ms bigint;
  v_elapsed_ms bigint;
  v_cycle_index bigint;
  v_cycle_offset_ms bigint;
  v_slot_start_ms bigint;
  v_clip public.net_altara_news_broadcast_clips%rowtype;
  v_stinger public.net_altara_news_broadcast_clips%rowtype;
  v_started_at timestamptz;
  v_ends_at timestamptz;
begin
  select station.* into v_station
  from public.net_altara_news_broadcast_station as station
  where station.channel = 'public';

  if not found or not v_station.station_enabled then
    return jsonb_build_object(
      'server_now', v_at, 'station_status', 'off-air', 'mode', 'rotation', 'current', null
    );
  end if;

  if v_station.override_mode is not null
    and v_at >= v_station.override_started_at
    and v_at < v_station.override_ends_at
  then
    select clip.* into v_clip
    from public.net_altara_news_broadcast_clips as clip
    where clip.id = v_station.override_clip_id and clip.status = 'active';

    if found then
      v_started_at := v_station.override_started_at;
      if v_station.override_mode = 'breaking'
        and v_station.breaking_stinger_clip_id is not null
      then
        select clip.* into v_stinger
        from public.net_altara_news_broadcast_clips as clip
        where clip.id = v_station.breaking_stinger_clip_id and clip.status = 'active';
        if found then
          v_ends_at := v_station.override_started_at
            + (v_stinger.duration_ms::double precision * interval '1 millisecond');
          if v_at < v_ends_at then
            return jsonb_build_object(
              'server_now', v_at,
              'station_status', 'on-air',
              'mode', 'breaking',
              'current', jsonb_build_object(
                'clip_id', v_stinger.id,
                'public_label', v_stinger.public_label,
                'clip_kind', v_stinger.clip_kind,
                'duration_ms', v_stinger.duration_ms,
                'started_at', v_station.override_started_at,
                'ends_at', v_ends_at,
                'object_path', v_stinger.object_path
              )
            );
          end if;
          v_started_at := v_ends_at;
        end if;
      end if;

      v_ends_at := v_started_at
        + (v_clip.duration_ms::double precision * interval '1 millisecond');
      if v_at < v_ends_at then
        return jsonb_build_object(
          'server_now', v_at,
          'station_status', 'on-air',
          'mode', v_station.override_mode,
          'current', jsonb_build_object(
            'clip_id', v_clip.id,
            'public_label', v_clip.public_label,
            'clip_kind', v_clip.clip_kind,
            'duration_ms', v_clip.duration_ms,
            'started_at', v_started_at,
            'ends_at', v_ends_at,
            'object_path', v_clip.object_path
          )
        );
      end if;
    end if;
  end if;

  select sum(clip.duration_ms::bigint * clip.rotation_weight::bigint)
  into v_cycle_duration_ms
  from public.net_altara_news_broadcast_clips as clip
  where clip.status = 'active' and clip.rotation_enabled = true;

  if coalesce(v_cycle_duration_ms, 0) <= 0 then
    return jsonb_build_object(
      'server_now', v_at, 'station_status', 'off-air', 'mode', 'rotation', 'current', null
    );
  end if;

  v_elapsed_ms := greatest(
    0::bigint,
    floor(extract(epoch from (v_at - v_station.rotation_epoch_at)) * 1000)::bigint
  );
  v_cycle_index := v_elapsed_ms / v_cycle_duration_ms;
  v_cycle_offset_ms := v_elapsed_ms % v_cycle_duration_ms;

  with weighted_slots as (
    select
      clip.*,
      slot_number,
      md5(
        v_station.rotation_seed::text || ':' || v_cycle_index::text || ':'
        || clip.id::text || ':' || slot_number::text
      ) as sort_key
    from public.net_altara_news_broadcast_clips as clip
    cross join lateral generate_series(1, clip.rotation_weight::integer) as slot_number
    where clip.status = 'active' and clip.rotation_enabled = true
  ), positioned_slots as (
    select
      weighted_slot.*,
      coalesce(sum(weighted_slot.duration_ms::bigint) over (
        order by weighted_slot.sort_key, weighted_slot.id, weighted_slot.slot_number
        rows between unbounded preceding and 1 preceding
      ), 0)::bigint as slot_start_ms
    from weighted_slots as weighted_slot
  )
  select
    positioned_slot.id,
    positioned_slot.internal_label,
    positioned_slot.public_label,
    positioned_slot.clip_kind,
    positioned_slot.status,
    positioned_slot.rotation_enabled,
    positioned_slot.rotation_weight,
    positioned_slot.object_path,
    positioned_slot.mime_type,
    positioned_slot.byte_size,
    positioned_slot.duration_ms,
    positioned_slot.pending_delete_at,
    positioned_slot.created_by_profile_id,
    positioned_slot.created_at,
    positioned_slot.updated_at,
    positioned_slot.slot_start_ms
  into
    v_clip.id,
    v_clip.internal_label,
    v_clip.public_label,
    v_clip.clip_kind,
    v_clip.status,
    v_clip.rotation_enabled,
    v_clip.rotation_weight,
    v_clip.object_path,
    v_clip.mime_type,
    v_clip.byte_size,
    v_clip.duration_ms,
    v_clip.pending_delete_at,
    v_clip.created_by_profile_id,
    v_clip.created_at,
    v_clip.updated_at,
    v_slot_start_ms
  from positioned_slots as positioned_slot
  where v_cycle_offset_ms >= positioned_slot.slot_start_ms
    and v_cycle_offset_ms < positioned_slot.slot_start_ms + positioned_slot.duration_ms
  order by positioned_slot.slot_start_ms
  limit 1;

  if v_clip.id is null then
    return jsonb_build_object(
      'server_now', v_at, 'station_status', 'off-air', 'mode', 'rotation', 'current', null
    );
  end if;

  v_started_at := v_station.rotation_epoch_at
    + ((v_cycle_index * v_cycle_duration_ms + v_slot_start_ms)::double precision
      * interval '1 millisecond');
  v_ends_at := v_started_at
    + (v_clip.duration_ms::double precision * interval '1 millisecond');

  return jsonb_build_object(
    'server_now', v_at,
    'station_status', 'on-air',
    'mode', 'rotation',
    'current', jsonb_build_object(
      'clip_id', v_clip.id,
      'public_label', v_clip.public_label,
      'clip_kind', v_clip.clip_kind,
      'duration_ms', v_clip.duration_ms,
      'started_at', v_started_at,
      'ends_at', v_ends_at,
      'object_path', v_clip.object_path
    )
  );
end;
$$;

create or replace function public.fetch_net_altara_news_broadcast_tune_state(
  requested_expected_identity_link_id uuid
)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_identity_link_id uuid;
  v_revision bigint := 0;
begin
  v_identity_link_id := public.net_altara_news_effective_player_identity(
    requested_expected_identity_link_id
  );
  select broadcast_revision into v_revision
  from public.net_altara_news_realtime_state where channel = 'public';
  return public.net_altara_news_broadcast_tune_payload_at(v_now)
    || jsonb_build_object(
      'identity_link_id', v_identity_link_id,
      'broadcast_revision', coalesce(v_revision, 0)
    );
end;
$$;

create or replace function public.current_user_can_write_net_altara_news_broadcast_audio(
  requested_object_name text
)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and public.is_current_user_gm()
    and public.net_altara_news_broadcast_object_name_is_valid(requested_object_name, null);
$$;

create or replace function public.current_user_can_read_net_altara_news_broadcast_audio(
  requested_object_name text
)
returns boolean
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_payload jsonb;
begin
  if auth.uid() is null
    or not public.net_altara_news_broadcast_object_name_is_valid(requested_object_name, null)
  then return false;
  end if;
  if public.is_current_user_gm() then return true;
  end if;
  if not public.current_user_can_read_net_altara_news_revision() then return false;
  end if;
  v_payload := public.net_altara_news_broadcast_tune_payload_at(clock_timestamp());
  return coalesce(v_payload #>> '{current,object_path}', '') = requested_object_name;
end;
$$;

create or replace function public.current_user_can_delete_unregistered_net_altara_news_broadcast_audio(
  requested_object_name text
)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and public.is_current_user_gm()
    and public.net_altara_news_broadcast_object_name_is_valid(requested_object_name, null)
    and not exists (
      select 1 from public.net_altara_news_broadcast_clips
      where object_path = requested_object_name
    );
$$;

create or replace function public.current_user_can_delete_registered_net_altara_news_broadcast_audio(
  requested_object_name text
)
returns boolean
language sql volatile security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and public.is_current_user_gm()
    and public.net_altara_news_broadcast_object_name_is_valid(requested_object_name, null)
    and exists (
      select 1 from public.net_altara_news_broadcast_clips as clip
      where clip.object_path = requested_object_name
        and clip.status = 'archived'
        and clip.rotation_enabled = false
        and clip.pending_delete_at is not null
        and not exists (
          select 1 from public.net_altara_news_broadcast_station
          where channel = 'public' and breaking_stinger_clip_id = clip.id
        )
        and not exists (
          select 1 from public.net_altara_news_broadcast_station
          where channel = 'public' and override_clip_id = clip.id
            and override_started_at <= clock_timestamp()
            and override_ends_at > clock_timestamp()
        )
    );
$$;

create or replace function public.signal_net_altara_news_broadcast_change()
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.net_altara_news_realtime_state (
    channel, article_revision, live_revision, broadcast_revision, updated_at
  ) values ('public', 0, 0, 1, timezone('utc', now()))
  on conflict (channel) do update set
    broadcast_revision = public.net_altara_news_realtime_state.broadcast_revision + 1,
    updated_at = excluded.updated_at;
end;
$$;

create or replace function public.audit_net_altara_news_gm_broadcast_action(
  requested_action_type text,
  requested_clip_id uuid default null
)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare v_actor uuid;
begin
  v_actor := public.assert_net_altara_news_gm_editor();
  if requested_action_type is null or btrim(requested_action_type) = ''
    or char_length(requested_action_type) > 120
  then
    raise exception 'ALTARA_NEWS_BROADCAST_AUDIT_CONTEXT_INVALID' using errcode = '22023';
  end if;
  insert into public.net_action_audit (
    authenticated_actor_profile_id, presented_account_id, persona_subject_kind,
    persona_subject_id, action_mode, action_type, authorization_basis,
    resource_type, resource_id
  ) values (
    v_actor, null, null, null, 'system', requested_action_type,
    'authoritative-gm-editor',
    case when requested_clip_id is null then null else 'altara-news-broadcast-clip' end,
    requested_clip_id
  );
end;
$$;

create or replace function public.net_altara_news_gm_broadcast_payload()
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_station public.net_altara_news_broadcast_station%rowtype;
  v_revision bigint := 0;
  v_library_byte_size bigint := 0;
  v_clips jsonb;
begin
  select station.* into v_station
  from public.net_altara_news_broadcast_station as station
  where station.channel = 'public';
  if not found then
    raise exception 'ALTARA_NEWS_BROADCAST_STATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  select broadcast_revision into v_revision
  from public.net_altara_news_realtime_state where channel = 'public';
  select coalesce(sum(byte_size::bigint), 0) into v_library_byte_size
  from public.net_altara_news_broadcast_clips;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', clip.id, 'internal_label', clip.internal_label,
    'public_label', clip.public_label, 'clip_kind', clip.clip_kind,
    'status', clip.status, 'rotation_enabled', clip.rotation_enabled,
    'rotation_weight', clip.rotation_weight, 'object_path', clip.object_path,
    'mime_type', clip.mime_type, 'byte_size', clip.byte_size,
    'duration_ms', clip.duration_ms, 'pending_delete_at', clip.pending_delete_at,
    'created_at', clip.created_at, 'updated_at', clip.updated_at
  ) order by (clip.status = 'archived'), clip.updated_at desc, clip.id desc), '[]'::jsonb)
  into v_clips
  from (
    select clip_row.* from public.net_altara_news_broadcast_clips as clip_row
    order by (clip_row.status = 'archived'), clip_row.updated_at desc, clip_row.id desc
    limit 200
  ) as clip;
  return jsonb_build_object(
    'server_now', v_now, 'broadcast_revision', coalesce(v_revision, 0),
    'library_byte_size', v_library_byte_size, 'library_byte_budget', 419430400,
    'station', jsonb_build_object(
      'station_enabled', v_station.station_enabled,
      'rotation_epoch_at', v_station.rotation_epoch_at,
      'rotation_seed', v_station.rotation_seed,
      'breaking_stinger_clip_id', v_station.breaking_stinger_clip_id,
      'override_mode', v_station.override_mode,
      'override_clip_id', v_station.override_clip_id,
      'override_started_at', v_station.override_started_at,
      'override_ends_at', v_station.override_ends_at,
      'updated_at', v_station.updated_at
    ),
    'effective', public.net_altara_news_broadcast_tune_payload_at(v_now),
    'clips', v_clips
  );
end;
$$;

create or replace function public.fetch_net_altara_news_gm_broadcast_control()
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_altara_news_gm_editor();
  return public.net_altara_news_gm_broadcast_payload();
end;
$$;
-- ALTARA_NEWS_BROADCAST_MUTATIONS_FOLLOW

create or replace function public.create_net_altara_news_gm_broadcast_clip(
  requested_clip_id uuid,
  requested_internal_label text,
  requested_public_label text,
  requested_clip_kind text,
  requested_rotation_enabled boolean,
  requested_rotation_weight integer,
  requested_object_path text,
  requested_mime_type text,
  requested_byte_size integer,
  requested_duration_ms integer
)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_profile_id uuid;
  v_active_count integer;
  v_total_count integer;
  v_library_byte_size bigint;
  v_storage_metadata jsonb;
  v_storage_byte_size bigint;
  v_storage_mime_type text;
begin
  v_actor_profile_id := public.assert_net_altara_news_gm_editor();
  perform public.assert_net_altara_news_gm_broadcast_clip_input(
    requested_clip_id, requested_internal_label, requested_public_label,
    requested_clip_kind, requested_rotation_enabled, requested_rotation_weight,
    requested_object_path, requested_mime_type, requested_byte_size,
    requested_duration_ms
  );
  perform 1 from public.net_altara_news_broadcast_station
  where channel = 'public' for update;
  if exists (
    select 1 from public.net_altara_news_broadcast_clips
    where id = requested_clip_id and object_path = requested_object_path
  ) then
    return public.net_altara_news_gm_broadcast_payload();
  end if;
  if exists (
    select 1 from public.net_altara_news_broadcast_clips
    where id = requested_clip_id or object_path = requested_object_path
  ) then
    raise exception 'ALTARA_NEWS_BROADCAST_CLIP_CONFLICT' using errcode = 'P0001';
  end if;
  select stored_object.metadata
  into v_storage_metadata
  from storage.objects as stored_object
  where stored_object.bucket_id = 'rpg-audio'
    and stored_object.name = requested_object_path
  for share;
  if not found then
    raise exception 'ALTARA_NEWS_BROADCAST_OBJECT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_storage_metadata is null
    or jsonb_typeof(v_storage_metadata) <> 'object'
    or coalesce(v_storage_metadata ->> 'size', '') !~ '^[0-9]+$'
    or octet_length(coalesce(v_storage_metadata ->> 'size', '')) > 10
    or nullif(btrim(v_storage_metadata ->> 'mimetype'), '') is null
  then
    raise exception 'ALTARA_NEWS_BROADCAST_OBJECT_METADATA_REQUIRED' using errcode = 'P0001';
  end if;
  v_storage_byte_size := (v_storage_metadata ->> 'size')::bigint;
  v_storage_mime_type := lower(btrim(v_storage_metadata ->> 'mimetype'));
  if v_storage_byte_size not between 1 and 15728640 then
    raise exception 'ALTARA_NEWS_BROADCAST_FILE_SIZE_INVALID' using errcode = '22023';
  end if;
  perform public.assert_net_altara_news_gm_broadcast_clip_input(
    requested_clip_id, requested_internal_label, requested_public_label,
    requested_clip_kind, requested_rotation_enabled, requested_rotation_weight,
    requested_object_path, v_storage_mime_type, v_storage_byte_size::integer,
    requested_duration_ms
  );
  if requested_byte_size::bigint <> v_storage_byte_size
    or lower(btrim(requested_mime_type)) <> v_storage_mime_type
  then
    raise exception 'ALTARA_NEWS_BROADCAST_OBJECT_METADATA_MISMATCH' using errcode = 'P0001';
  end if;
  select count(*) filter (where status = 'active'), count(*),
    coalesce(sum(byte_size::bigint), 0)
  into v_active_count, v_total_count, v_library_byte_size
  from public.net_altara_news_broadcast_clips;
  if v_active_count >= 100 then
    raise exception 'ALTARA_NEWS_BROADCAST_ACTIVE_CLIP_LIMIT_REACHED' using errcode = 'P0001';
  end if;
  if v_total_count >= 200 then
    raise exception 'ALTARA_NEWS_BROADCAST_LIBRARY_LIMIT_REACHED' using errcode = 'P0001';
  end if;
  if v_library_byte_size + v_storage_byte_size > 419430400 then
    raise exception 'ALTARA_NEWS_BROADCAST_STORAGE_BUDGET_REACHED' using errcode = 'P0001';
  end if;
  insert into public.net_altara_news_broadcast_clips (
    id, internal_label, public_label, clip_kind, status, rotation_enabled,
    rotation_weight, object_path, mime_type, byte_size, duration_ms,
    created_by_profile_id
  ) values (
    requested_clip_id, btrim(requested_internal_label),
    nullif(btrim(requested_public_label), ''), lower(btrim(requested_clip_kind)),
    'active', requested_rotation_enabled, requested_rotation_weight,
    requested_object_path, v_storage_mime_type, v_storage_byte_size::integer,
    requested_duration_ms, v_actor_profile_id
  );
  if requested_rotation_enabled then
    update public.net_altara_news_broadcast_station
    set rotation_epoch_at = clock_timestamp(),
      rotation_seed = hashtextextended(gen_random_uuid()::text, 0)
    where channel = 'public';
  end if;
  perform public.audit_net_altara_news_gm_broadcast_action(
    'altara-news.broadcast.clip.create', requested_clip_id
  );
  perform public.signal_net_altara_news_broadcast_change();
  return public.net_altara_news_gm_broadcast_payload();
end;
$$;

create or replace function public.update_net_altara_news_gm_broadcast_clip(
  requested_clip_id uuid,
  requested_internal_label text,
  requested_public_label text,
  requested_clip_kind text,
  requested_rotation_enabled boolean,
  requested_rotation_weight integer
)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_clip public.net_altara_news_broadcast_clips%rowtype;
  v_rotation_changed boolean;
  v_was_in_rotation boolean;
  v_will_be_in_rotation boolean;
begin
  perform public.assert_net_altara_news_gm_editor();
  perform 1 from public.net_altara_news_broadcast_station
  where channel = 'public' for update;
  select clip.* into v_clip from public.net_altara_news_broadcast_clips as clip
  where clip.id = requested_clip_id for update;
  if not found then
    raise exception 'ALTARA_NEWS_BROADCAST_CLIP_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_clip.pending_delete_at is not null then
    raise exception 'ALTARA_NEWS_BROADCAST_DELETE_PENDING' using errcode = 'P0001';
  end if;
  perform public.assert_net_altara_news_gm_broadcast_clip_input(
    v_clip.id, requested_internal_label, requested_public_label,
    requested_clip_kind,
    case when v_clip.status = 'archived' then false else requested_rotation_enabled end,
    requested_rotation_weight, v_clip.object_path, v_clip.mime_type,
    v_clip.byte_size, v_clip.duration_ms
  );
  if v_clip.status = 'archived' and requested_rotation_enabled then
    raise exception 'ALTARA_NEWS_BROADCAST_ARCHIVED_ROTATION_INVALID' using errcode = 'P0001';
  end if;
  v_was_in_rotation := v_clip.status = 'active' and v_clip.rotation_enabled;
  v_will_be_in_rotation := v_clip.status = 'active' and requested_rotation_enabled;
  v_rotation_changed := v_was_in_rotation is distinct from v_will_be_in_rotation
    or (
      v_was_in_rotation
      and v_will_be_in_rotation
      and v_clip.rotation_weight is distinct from requested_rotation_weight
    );
  update public.net_altara_news_broadcast_clips
  set internal_label = btrim(requested_internal_label),
    public_label = nullif(btrim(requested_public_label), ''),
    clip_kind = lower(btrim(requested_clip_kind)),
    rotation_enabled = requested_rotation_enabled,
    rotation_weight = requested_rotation_weight
  where id = requested_clip_id;
  if v_rotation_changed then
    update public.net_altara_news_broadcast_station
    set rotation_epoch_at = clock_timestamp(),
      rotation_seed = hashtextextended(gen_random_uuid()::text, 0)
    where channel = 'public';
  end if;
  perform public.audit_net_altara_news_gm_broadcast_action(
    'altara-news.broadcast.clip.update', requested_clip_id
  );
  perform public.signal_net_altara_news_broadcast_change();
  return public.net_altara_news_gm_broadcast_payload();
end;
$$;

create or replace function public.set_net_altara_news_gm_broadcast_clip_archived(
  requested_clip_id uuid,
  requested_archived boolean
)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_clip public.net_altara_news_broadcast_clips%rowtype;
  v_station public.net_altara_news_broadcast_station%rowtype;
  v_now timestamptz := clock_timestamp();
  v_active_count integer;
  v_current jsonb;
begin
  perform public.assert_net_altara_news_gm_editor();
  if requested_archived is null then
    raise exception 'ALTARA_NEWS_BROADCAST_ARCHIVE_REQUEST_INVALID' using errcode = '22023';
  end if;
  select station.* into v_station
  from public.net_altara_news_broadcast_station as station
  where station.channel = 'public' for update;
  select clip.* into v_clip from public.net_altara_news_broadcast_clips as clip
  where clip.id = requested_clip_id for update;
  if not found then
    raise exception 'ALTARA_NEWS_BROADCAST_CLIP_NOT_FOUND' using errcode = 'P0002';
  end if;
  if requested_archived and v_clip.status = 'archived' then
    return public.net_altara_news_gm_broadcast_payload();
  end if;
  if not requested_archived and v_clip.status = 'active' then
    return public.net_altara_news_gm_broadcast_payload();
  end if;
  if not requested_archived and v_clip.pending_delete_at is not null then
    raise exception 'ALTARA_NEWS_BROADCAST_DELETE_PENDING' using errcode = 'P0001';
  end if;
  if requested_archived and v_station.breaking_stinger_clip_id = requested_clip_id then
    raise exception 'ALTARA_NEWS_BROADCAST_STINGER_CONFIGURED' using errcode = 'P0001';
  end if;
  if requested_archived and v_station.override_clip_id = requested_clip_id
    and v_station.override_started_at <= v_now and v_station.override_ends_at > v_now
  then
    raise exception 'ALTARA_NEWS_BROADCAST_CLIP_CURRENTLY_OVERRIDING' using errcode = 'P0001';
  end if;
  if requested_archived then
    v_current := public.net_altara_news_broadcast_tune_payload_at(v_now);
    if coalesce(v_current #>> '{current,clip_id}', '') = requested_clip_id::text then
      raise exception 'ALTARA_NEWS_BROADCAST_CLIP_CURRENTLY_PLAYING' using errcode = 'P0001';
    end if;
  end if;
  if not requested_archived then
    select count(*) into v_active_count
    from public.net_altara_news_broadcast_clips where status = 'active';
    if v_active_count >= 100 then
      raise exception 'ALTARA_NEWS_BROADCAST_ACTIVE_CLIP_LIMIT_REACHED' using errcode = 'P0001';
    end if;
  end if;
  update public.net_altara_news_broadcast_clips
  set status = case when requested_archived then 'archived' else 'active' end,
    rotation_enabled = case when requested_archived then false else rotation_enabled end
  where id = requested_clip_id;
  if v_clip.rotation_enabled then
    update public.net_altara_news_broadcast_station
    set rotation_epoch_at = v_now,
      rotation_seed = hashtextextended(gen_random_uuid()::text, 0)
    where channel = 'public';
  end if;
  perform public.audit_net_altara_news_gm_broadcast_action(
    case when requested_archived then 'altara-news.broadcast.clip.archive'
      else 'altara-news.broadcast.clip.restore' end,
    requested_clip_id
  );
  perform public.signal_net_altara_news_broadcast_change();
  return public.net_altara_news_gm_broadcast_payload();
end;
$$;

create or replace function public.set_net_altara_news_gm_broadcast_station_enabled(
  requested_enabled boolean
)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_station public.net_altara_news_broadcast_station%rowtype;
begin
  perform public.assert_net_altara_news_gm_editor();
  if requested_enabled is null then
    raise exception 'ALTARA_NEWS_BROADCAST_STATION_REQUEST_INVALID' using errcode = '22023';
  end if;
  select station.* into v_station
  from public.net_altara_news_broadcast_station as station
  where station.channel = 'public' for update;
  if v_station.station_enabled = requested_enabled then
    return public.net_altara_news_gm_broadcast_payload();
  end if;
  update public.net_altara_news_broadcast_station
  set station_enabled = requested_enabled,
    rotation_epoch_at = clock_timestamp(),
    rotation_seed = hashtextextended(gen_random_uuid()::text, 0),
    override_mode = case when requested_enabled then override_mode else null end,
    override_clip_id = case when requested_enabled then override_clip_id else null end,
    override_started_at = case when requested_enabled then override_started_at else null end,
    override_ends_at = case when requested_enabled then override_ends_at else null end
  where channel = 'public';
  perform public.audit_net_altara_news_gm_broadcast_action(
    case when requested_enabled then 'altara-news.broadcast.station.enable'
      else 'altara-news.broadcast.station.disable' end, null
  );
  perform public.signal_net_altara_news_broadcast_change();
  return public.net_altara_news_gm_broadcast_payload();
end;
$$;

create or replace function public.set_net_altara_news_gm_broadcast_breaking_stinger(
  requested_clip_id uuid
)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_station public.net_altara_news_broadcast_station%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  perform public.assert_net_altara_news_gm_editor();
  select station.* into v_station
  from public.net_altara_news_broadcast_station as station
  where station.channel = 'public' for update;
  if v_station.breaking_stinger_clip_id is not distinct from requested_clip_id then
    return public.net_altara_news_gm_broadcast_payload();
  end if;
  if v_station.override_mode = 'breaking'
    and v_station.override_started_at <= v_now and v_station.override_ends_at > v_now
  then
    raise exception 'ALTARA_NEWS_BROADCAST_STINGER_CHANGE_DURING_BREAKING' using errcode = 'P0001';
  end if;
  if requested_clip_id is not null and not exists (
    select 1 from public.net_altara_news_broadcast_clips
    where id = requested_clip_id and status = 'active'
  ) then
    raise exception 'ALTARA_NEWS_BROADCAST_CLIP_NOT_FOUND' using errcode = 'P0002';
  end if;
  update public.net_altara_news_broadcast_station
  set breaking_stinger_clip_id = requested_clip_id
  where channel = 'public';
  perform public.audit_net_altara_news_gm_broadcast_action(
    case when requested_clip_id is null
      then 'altara-news.broadcast.breaking-stinger.clear'
      else 'altara-news.broadcast.breaking-stinger.configure' end,
    requested_clip_id
  );
  perform public.signal_net_altara_news_broadcast_change();
  return public.net_altara_news_gm_broadcast_payload();
end;
$$;

create or replace function public.start_net_altara_news_gm_broadcast_override(
  requested_clip_id uuid,
  requested_mode text,
  requested_replace_active boolean default false
)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text := lower(btrim(coalesce(requested_mode, '')));
  v_now timestamptz := clock_timestamp();
  v_clip public.net_altara_news_broadcast_clips%rowtype;
  v_stinger public.net_altara_news_broadcast_clips%rowtype;
  v_station public.net_altara_news_broadcast_station%rowtype;
  v_total_duration_ms bigint;
begin
  perform public.assert_net_altara_news_gm_editor();
  if v_mode not in ('play-now', 'breaking') or requested_replace_active is null then
    raise exception 'ALTARA_NEWS_BROADCAST_OVERRIDE_REQUEST_INVALID' using errcode = '22023';
  end if;
  select station.* into v_station
  from public.net_altara_news_broadcast_station as station
  where station.channel = 'public' for update;
  if not v_station.station_enabled then
    raise exception 'ALTARA_NEWS_BROADCAST_STATION_DISABLED' using errcode = 'P0001';
  end if;
  if v_station.override_mode is not null
    and v_station.override_started_at <= v_now and v_station.override_ends_at > v_now
    and not requested_replace_active
  then
    raise exception 'ALTARA_NEWS_BROADCAST_OVERRIDE_ACTIVE' using errcode = 'P0001';
  end if;
  select clip.* into v_clip from public.net_altara_news_broadcast_clips as clip
  where clip.id = requested_clip_id and clip.status = 'active';
  if not found then
    raise exception 'ALTARA_NEWS_BROADCAST_CLIP_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_total_duration_ms := v_clip.duration_ms;
  if v_mode = 'breaking' and v_station.breaking_stinger_clip_id is not null then
    select clip.* into v_stinger from public.net_altara_news_broadcast_clips as clip
    where clip.id = v_station.breaking_stinger_clip_id and clip.status = 'active';
    if found then
      v_total_duration_ms := v_total_duration_ms + v_stinger.duration_ms;
    end if;
  end if;
  update public.net_altara_news_broadcast_station
  set override_mode = v_mode, override_clip_id = v_clip.id,
    override_started_at = v_now,
    override_ends_at = v_now
      + (v_total_duration_ms::double precision * interval '1 millisecond')
  where channel = 'public';
  perform public.audit_net_altara_news_gm_broadcast_action(
    case when v_mode = 'breaking' then 'altara-news.broadcast.breaking'
      else 'altara-news.broadcast.play-now' end,
    v_clip.id
  );
  perform public.signal_net_altara_news_broadcast_change();
  return public.net_altara_news_gm_broadcast_payload();
end;
$$;

create or replace function public.end_net_altara_news_gm_broadcast_override()
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare v_station public.net_altara_news_broadcast_station%rowtype;
begin
  perform public.assert_net_altara_news_gm_editor();
  select station.* into v_station
  from public.net_altara_news_broadcast_station as station
  where station.channel = 'public' for update;
  if v_station.override_mode is null then
    return public.net_altara_news_gm_broadcast_payload();
  end if;
  update public.net_altara_news_broadcast_station
  set override_mode = null, override_clip_id = null,
    override_started_at = null, override_ends_at = null
  where channel = 'public';
  perform public.audit_net_altara_news_gm_broadcast_action(
    'altara-news.broadcast.override.end', v_station.override_clip_id
  );
  perform public.signal_net_altara_news_broadcast_change();
  return public.net_altara_news_gm_broadcast_payload();
end;
$$;

create or replace function public.prepare_net_altara_news_gm_broadcast_clip_delete(
  requested_clip_id uuid
)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_station public.net_altara_news_broadcast_station%rowtype;
  v_clip public.net_altara_news_broadcast_clips%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  perform public.assert_net_altara_news_gm_editor();
  select station.* into v_station
  from public.net_altara_news_broadcast_station as station
  where station.channel = 'public' for update;
  select clip.* into v_clip from public.net_altara_news_broadcast_clips as clip
  where clip.id = requested_clip_id for update;
  if not found then
    raise exception 'ALTARA_NEWS_BROADCAST_CLIP_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_clip.status <> 'archived' or v_clip.rotation_enabled then
    raise exception 'ALTARA_NEWS_BROADCAST_DELETE_REQUIRES_ARCHIVED' using errcode = 'P0001';
  end if;
  if v_station.breaking_stinger_clip_id = requested_clip_id then
    raise exception 'ALTARA_NEWS_BROADCAST_STINGER_CONFIGURED' using errcode = 'P0001';
  end if;
  if v_station.override_clip_id = requested_clip_id then
    if v_station.override_started_at <= v_now and v_station.override_ends_at > v_now then
      raise exception 'ALTARA_NEWS_BROADCAST_CLIP_CURRENTLY_OVERRIDING' using errcode = 'P0001';
    elsif v_station.override_ends_at <= v_now then
      update public.net_altara_news_broadcast_station
      set override_mode = null, override_clip_id = null,
        override_started_at = null, override_ends_at = null
      where channel = 'public';
    else
      raise exception 'ALTARA_NEWS_BROADCAST_DELETE_OVERRIDE_STATE_INVALID' using errcode = 'P0001';
    end if;
  end if;
  if v_clip.pending_delete_at is null then
    update public.net_altara_news_broadcast_clips
    set pending_delete_at = v_now where id = requested_clip_id;
    perform public.audit_net_altara_news_gm_broadcast_action(
      'altara-news.broadcast.clip.delete.prepare', requested_clip_id
    );
  end if;
  return public.net_altara_news_gm_broadcast_payload();
end;
$$;

create or replace function public.finalize_net_altara_news_gm_broadcast_clip_delete(
  requested_clip_id uuid
)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_station public.net_altara_news_broadcast_station%rowtype;
  v_clip public.net_altara_news_broadcast_clips%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  perform public.assert_net_altara_news_gm_editor();
  select station.* into v_station
  from public.net_altara_news_broadcast_station as station
  where station.channel = 'public' for update;
  select clip.* into v_clip from public.net_altara_news_broadcast_clips as clip
  where clip.id = requested_clip_id for update;
  if not found then
    return public.net_altara_news_gm_broadcast_payload();
  end if;
  if v_clip.status <> 'archived' or v_clip.rotation_enabled then
    raise exception 'ALTARA_NEWS_BROADCAST_DELETE_REQUIRES_ARCHIVED' using errcode = 'P0001';
  end if;
  if v_clip.pending_delete_at is null then
    raise exception 'ALTARA_NEWS_BROADCAST_DELETE_NOT_PREPARED' using errcode = 'P0001';
  end if;
  if v_station.breaking_stinger_clip_id = requested_clip_id then
    raise exception 'ALTARA_NEWS_BROADCAST_STINGER_CONFIGURED' using errcode = 'P0001';
  end if;
  if v_station.override_clip_id = requested_clip_id then
    if v_station.override_started_at <= v_now and v_station.override_ends_at > v_now then
      raise exception 'ALTARA_NEWS_BROADCAST_CLIP_CURRENTLY_OVERRIDING' using errcode = 'P0001';
    elsif v_station.override_ends_at <= v_now then
      update public.net_altara_news_broadcast_station
      set override_mode = null, override_clip_id = null,
        override_started_at = null, override_ends_at = null
      where channel = 'public';
    else
      raise exception 'ALTARA_NEWS_BROADCAST_DELETE_OVERRIDE_STATE_INVALID' using errcode = 'P0001';
    end if;
  end if;
  if exists (
    select 1 from storage.objects
    where bucket_id = 'rpg-audio' and name = v_clip.object_path
  ) then
    raise exception 'ALTARA_NEWS_BROADCAST_DELETE_OBJECT_STILL_EXISTS' using errcode = 'P0001';
  end if;
  delete from public.net_altara_news_broadcast_clips where id = requested_clip_id;
  perform public.audit_net_altara_news_gm_broadcast_action(
    'altara-news.broadcast.clip.delete', requested_clip_id
  );
  perform public.signal_net_altara_news_broadcast_change();
  return public.net_altara_news_gm_broadcast_payload();
end;
$$;

alter table public.net_altara_news_broadcast_clips enable row level security;
alter table public.net_altara_news_broadcast_station enable row level security;

revoke all on table public.net_altara_news_broadcast_clips
  from public, anon, authenticated;
revoke all on table public.net_altara_news_broadcast_station
  from public, anon, authenticated;

create policy rpg_audio_altara_news_broadcast_select_authorised
on storage.objects for select to authenticated
using (
  bucket_id = 'rpg-audio'
  and public.current_user_can_read_net_altara_news_broadcast_audio(name)
);

create policy rpg_audio_altara_news_broadcast_insert_authorised
on storage.objects for insert to authenticated
with check (
  bucket_id = 'rpg-audio'
  and public.current_user_can_write_net_altara_news_broadcast_audio(name)
);

create policy rpg_audio_altara_news_broadcast_delete_authorised
on storage.objects for delete to authenticated
using (
  bucket_id = 'rpg-audio'
  and (
    public.current_user_can_delete_unregistered_net_altara_news_broadcast_audio(name)
    or public.current_user_can_delete_registered_net_altara_news_broadcast_audio(name)
  )
);

revoke all on function public.net_altara_news_broadcast_object_name_is_valid(text, uuid)
  from public, anon, authenticated;
revoke all on function public.assert_net_altara_news_gm_broadcast_clip_input(
  uuid, text, text, text, boolean, integer, text, text, integer, integer
) from public, anon, authenticated;
revoke all on function public.net_altara_news_broadcast_tune_payload_at(timestamptz)
  from public, anon, authenticated;
revoke all on function public.signal_net_altara_news_broadcast_change()
  from public, anon, authenticated;
revoke all on function public.audit_net_altara_news_gm_broadcast_action(text, uuid)
  from public, anon, authenticated;
revoke all on function public.net_altara_news_gm_broadcast_payload()
  from public, anon, authenticated;

revoke all on function public.fetch_net_altara_news_broadcast_tune_state(uuid)
  from public, anon, authenticated;
revoke all on function public.fetch_net_altara_news_gm_broadcast_control()
  from public, anon, authenticated;
revoke all on function public.create_net_altara_news_gm_broadcast_clip(
  uuid, text, text, text, boolean, integer, text, text, integer, integer
) from public, anon, authenticated;
revoke all on function public.update_net_altara_news_gm_broadcast_clip(
  uuid, text, text, text, boolean, integer
) from public, anon, authenticated;
revoke all on function public.set_net_altara_news_gm_broadcast_clip_archived(uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.set_net_altara_news_gm_broadcast_station_enabled(boolean)
  from public, anon, authenticated;
revoke all on function public.set_net_altara_news_gm_broadcast_breaking_stinger(uuid)
  from public, anon, authenticated;
revoke all on function public.start_net_altara_news_gm_broadcast_override(uuid, text, boolean)
  from public, anon, authenticated;
revoke all on function public.end_net_altara_news_gm_broadcast_override()
  from public, anon, authenticated;
revoke all on function public.prepare_net_altara_news_gm_broadcast_clip_delete(uuid)
  from public, anon, authenticated;
revoke all on function public.finalize_net_altara_news_gm_broadcast_clip_delete(uuid)
  from public, anon, authenticated;
revoke all on function public.current_user_can_write_net_altara_news_broadcast_audio(text)
  from public, anon, authenticated;
revoke all on function public.current_user_can_read_net_altara_news_broadcast_audio(text)
  from public, anon, authenticated;
revoke all on function public.current_user_can_delete_unregistered_net_altara_news_broadcast_audio(text)
  from public, anon, authenticated;
revoke all on function public.current_user_can_delete_registered_net_altara_news_broadcast_audio(text)
  from public, anon, authenticated;

grant execute on function public.fetch_net_altara_news_broadcast_tune_state(uuid)
  to authenticated;
grant execute on function public.fetch_net_altara_news_gm_broadcast_control()
  to authenticated;
grant execute on function public.create_net_altara_news_gm_broadcast_clip(
  uuid, text, text, text, boolean, integer, text, text, integer, integer
) to authenticated;
grant execute on function public.update_net_altara_news_gm_broadcast_clip(
  uuid, text, text, text, boolean, integer
) to authenticated;
grant execute on function public.set_net_altara_news_gm_broadcast_clip_archived(uuid, boolean)
  to authenticated;
grant execute on function public.set_net_altara_news_gm_broadcast_station_enabled(boolean)
  to authenticated;
grant execute on function public.set_net_altara_news_gm_broadcast_breaking_stinger(uuid)
  to authenticated;
grant execute on function public.start_net_altara_news_gm_broadcast_override(uuid, text, boolean)
  to authenticated;
grant execute on function public.end_net_altara_news_gm_broadcast_override()
  to authenticated;
grant execute on function public.prepare_net_altara_news_gm_broadcast_clip_delete(uuid)
  to authenticated;
grant execute on function public.finalize_net_altara_news_gm_broadcast_clip_delete(uuid)
  to authenticated;
grant execute on function public.current_user_can_write_net_altara_news_broadcast_audio(text)
  to authenticated;
grant execute on function public.current_user_can_read_net_altara_news_broadcast_audio(text)
  to authenticated;
grant execute on function public.current_user_can_delete_unregistered_net_altara_news_broadcast_audio(text)
  to authenticated;
grant execute on function public.current_user_can_delete_registered_net_altara_news_broadcast_audio(text)
  to authenticated;

do $$
declare v_table_name text;
begin
  foreach v_table_name in array array[
    'net_altara_news_articles', 'net_altara_news_article_media',
    'net_altara_news_incidents', 'net_altara_news_incident_updates',
    'net_altara_news_saved_articles', 'net_altara_news_broadcast_clips',
    'net_altara_news_broadcast_station'
  ] loop
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public'
        and tablename = v_table_name
    ) then
      execute format(
        'alter publication supabase_realtime drop table public.%I', v_table_name
      );
    end if;
  end loop;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'net_altara_news_realtime_state'
  ) then
    alter publication supabase_realtime add table public.net_altara_news_realtime_state;
  end if;
exception when duplicate_object then null;
end;
$$;

commit;
