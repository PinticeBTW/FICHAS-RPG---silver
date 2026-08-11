-- NVN RADIO V1: deterministic global station timeline, GM clip control,
-- current-object-only player audio authorization, and compact invalidation.
-- Run after the current NVN article, realtime, media, and live-incident chain.
-- This migration creates no clips, uploads no objects, and inserts no lore.

begin;

create table if not exists public.net_nvn_radio_clips (
  id uuid primary key,
  internal_label text not null,
  public_label text,
  clip_kind text not null
    check (clip_kind in (
      'news', 'bulletin', 'station-id', 'jingle', 'advertisement',
      'weather', 'traffic', 'interview', 'public-service', 'ambience', 'other'
    )),
  status text not null default 'active'
    check (status in ('active', 'archived')),
  rotation_enabled boolean not null default false,
  rotation_weight smallint not null default 1
    check (rotation_weight between 1 and 5),
  object_path text not null unique,
  mime_type text not null
    check (mime_type in (
      'audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a',
      'audio/ogg', 'audio/webm'
    )),
  byte_size integer not null
    check (byte_size between 1 and 15728640),
  duration_ms integer not null
    check (duration_ms between 2000 and 900000),
  created_by_profile_id uuid not null
    references public.profiles (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint net_nvn_radio_clips_internal_label_shape check (
    btrim(internal_label) <> '' and char_length(internal_label) <= 120
  ),
  constraint net_nvn_radio_clips_public_label_shape check (
    public_label is null
    or (btrim(public_label) <> '' and char_length(public_label) <= 160)
  ),
  constraint net_nvn_radio_clips_archive_shape check (
    status = 'active' or rotation_enabled = false
  ),
  constraint net_nvn_radio_clips_object_path_shape check (
    object_path = lower(object_path)
    and object_path !~ '\.\.'
    and split_part(object_path, '/', 1) = 'nvn-radio'
    and split_part(object_path, '/', 2) = id::text
    and split_part(object_path, '/', 4) = ''
    and split_part(object_path, '/', 3)
      ~ '^[0-9a-f]{64}\.(mp3|m4a|mp4|ogg|webm)$'
  ),
  constraint net_nvn_radio_clips_mime_extension_shape check (
    (mime_type = 'audio/mpeg' and object_path ~ '\.mp3$')
    or (mime_type in ('audio/mp4', 'audio/m4a', 'audio/x-m4a') and object_path ~ '\.(m4a|mp4)$')
    or (mime_type = 'audio/ogg' and object_path ~ '\.ogg$')
    or (mime_type = 'audio/webm' and object_path ~ '\.webm$')
  )
);

comment on table public.net_nvn_radio_clips is
  'Bounded authoritative NVN radio audio library. Players never receive this directory; only the current on-air projection is exposed.';
comment on column public.net_nvn_radio_clips.internal_label is
  'GM-only library label. Never returned by the player tune-state RPC.';
comment on column public.net_nvn_radio_clips.object_path is
  'Private immutable rpg-audio object name. Player signing is authorized only while this exact object is currently on-air.';

create index if not exists net_nvn_radio_clips_gm_directory_idx
  on public.net_nvn_radio_clips (status, updated_at desc, id desc);

create index if not exists net_nvn_radio_clips_rotation_idx
  on public.net_nvn_radio_clips (id)
  where status = 'active' and rotation_enabled = true;

drop trigger if exists net_nvn_radio_clips_set_updated_at
  on public.net_nvn_radio_clips;
create trigger net_nvn_radio_clips_set_updated_at
before update on public.net_nvn_radio_clips
for each row execute procedure public.set_updated_at();

create table if not exists public.net_nvn_radio_station (
  channel text primary key default 'public'
    check (channel = 'public'),
  station_enabled boolean not null default false,
  rotation_epoch_at timestamptz not null default timezone('utc', now()),
  rotation_seed bigint not null default 0,
  override_mode text
    check (override_mode is null or override_mode in ('play-now', 'breaking')),
  override_clip_id uuid
    references public.net_nvn_radio_clips (id) on delete restrict,
  override_started_at timestamptz,
  override_ends_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint net_nvn_radio_station_override_shape check (
    num_nonnulls(
      override_mode,
      override_clip_id,
      override_started_at,
      override_ends_at
    ) in (0, 4)
    and (
      override_mode is null
      or override_ends_at > override_started_at
    )
  )
);

comment on table public.net_nvn_radio_station is
  'Singleton NVN radio authority. Normal rotation is derived from server time, epoch, seed, and the bounded active clip library; no worker advances tracks.';

insert into public.net_nvn_radio_station (
  channel,
  station_enabled,
  rotation_epoch_at,
  rotation_seed
) values (
  'public',
  false,
  timezone('utc', now()),
  hashtextextended(gen_random_uuid()::text, 0)
)
on conflict (channel) do nothing;

drop trigger if exists net_nvn_radio_station_set_updated_at
  on public.net_nvn_radio_station;
create trigger net_nvn_radio_station_set_updated_at
before update on public.net_nvn_radio_station
for each row execute procedure public.set_updated_at();

alter table public.net_nvn_realtime_state
  add column if not exists radio_revision bigint not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.net_nvn_realtime_state'::regclass
      and constraint_row.conname = 'net_nvn_realtime_state_radio_revision_nonnegative'
  ) then
    alter table public.net_nvn_realtime_state
      add constraint net_nvn_realtime_state_radio_revision_nonnegative
      check (radio_revision >= 0);
  end if;
end $$;

alter table public.net_nvn_realtime_state replica identity full;

create or replace function public.net_nvn_radio_object_name_is_valid(
  requested_object_name text,
  requested_clip_id uuid default null
)
returns boolean
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select
    requested_object_name is not null
    and octet_length(requested_object_name) <= 220
    and requested_object_name = lower(requested_object_name)
    and requested_object_name !~ '\.\.'
    and split_part(requested_object_name, '/', 1) = 'nvn-radio'
    and split_part(requested_object_name, '/', 2)
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and (
      requested_clip_id is null
      or split_part(requested_object_name, '/', 2) = requested_clip_id::text
    )
    and split_part(requested_object_name, '/', 3)
      ~ '^[0-9a-f]{64}\.(mp3|m4a|mp4|ogg|webm)$'
    and split_part(requested_object_name, '/', 4) = '';
$$;

create or replace function public.assert_net_nvn_gm_radio_clip_input(
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
  v_mime_type text := lower(btrim(coalesce(requested_mime_type, '')));
begin
  if requested_clip_id is null
    or octet_length(coalesce(requested_internal_label, '')) > 480
    or char_length(btrim(coalesce(requested_internal_label, ''))) not between 1 and 120
  then
    raise exception 'NVN_RADIO_INTERNAL_LABEL_INVALID' using errcode = '22023';
  end if;
  if octet_length(coalesce(requested_public_label, '')) > 640
    or (v_public_label is not null and char_length(v_public_label) > 160)
  then
    raise exception 'NVN_RADIO_PUBLIC_LABEL_INVALID' using errcode = '22023';
  end if;
  if v_kind not in (
    'news', 'bulletin', 'station-id', 'jingle', 'advertisement',
    'weather', 'traffic', 'interview', 'public-service', 'ambience', 'other'
  ) then
    raise exception 'NVN_RADIO_CLIP_KIND_INVALID' using errcode = '22023';
  end if;
  if requested_rotation_enabled is null
    or requested_rotation_weight is null
    or requested_rotation_weight not between 1 and 5
  then
    raise exception 'NVN_RADIO_ROTATION_INVALID' using errcode = '22023';
  end if;
  if not public.net_nvn_radio_object_name_is_valid(
    requested_object_path,
    requested_clip_id
  ) then
    raise exception 'NVN_RADIO_OBJECT_PATH_INVALID' using errcode = '22023';
  end if;
  if v_mime_type not in (
    'audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a',
    'audio/ogg', 'audio/webm'
  )
    or (v_mime_type = 'audio/mpeg' and requested_object_path !~ '\.mp3$')
    or (v_mime_type in ('audio/mp4', 'audio/m4a', 'audio/x-m4a') and requested_object_path !~ '\.(m4a|mp4)$')
    or (v_mime_type = 'audio/ogg' and requested_object_path !~ '\.ogg$')
    or (v_mime_type = 'audio/webm' and requested_object_path !~ '\.webm$')
  then
    raise exception 'NVN_RADIO_MIME_INVALID' using errcode = '22023';
  end if;
  if requested_byte_size is null or requested_byte_size not between 1 and 15728640 then
    raise exception 'NVN_RADIO_FILE_SIZE_INVALID' using errcode = '22023';
  end if;
  if requested_duration_ms is null or requested_duration_ms not between 2000 and 900000 then
    raise exception 'NVN_RADIO_DURATION_INVALID' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.net_nvn_radio_tune_payload_at(
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
  v_station public.net_nvn_radio_station%rowtype;
  v_cycle_duration_ms bigint;
  v_elapsed_ms bigint;
  v_cycle_index bigint;
  v_cycle_offset_ms bigint;
  v_slot_start_ms bigint;
  v_clip public.net_nvn_radio_clips%rowtype;
  v_started_at timestamptz;
  v_ends_at timestamptz;
begin
  select station.*
  into v_station
  from public.net_nvn_radio_station as station
  where station.channel = 'public';

  if not found or not v_station.station_enabled then
    return jsonb_build_object(
      'server_now', v_at,
      'station_status', 'off-air',
      'mode', 'rotation',
      'current', null
    );
  end if;

  if v_station.override_mode is not null
    and v_at >= v_station.override_started_at
    and v_at < v_station.override_ends_at
  then
    select clip.*
    into v_clip
    from public.net_nvn_radio_clips as clip
    where clip.id = v_station.override_clip_id
      and clip.status = 'active';

    if found then
      return jsonb_build_object(
        'server_now', v_at,
        'station_status', 'on-air',
        'mode', v_station.override_mode,
        'current', jsonb_build_object(
          'clip_id', v_clip.id,
          'public_label', v_clip.public_label,
          'clip_kind', v_clip.clip_kind,
          'duration_ms', v_clip.duration_ms,
          'started_at', v_station.override_started_at,
          'ends_at', v_station.override_ends_at,
          'object_path', v_clip.object_path
        )
      );
    end if;
  end if;

  select sum(clip.duration_ms::bigint * clip.rotation_weight::bigint)
  into v_cycle_duration_ms
  from public.net_nvn_radio_clips as clip
  where clip.status = 'active'
    and clip.rotation_enabled = true;

  if coalesce(v_cycle_duration_ms, 0) <= 0 then
    return jsonb_build_object(
      'server_now', v_at,
      'station_status', 'off-air',
      'mode', 'rotation',
      'current', null
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
        v_station.rotation_seed::text || ':' ||
        v_cycle_index::text || ':' ||
        clip.id::text || ':' ||
        slot_number::text
      ) as sort_key
    from public.net_nvn_radio_clips as clip
    cross join lateral generate_series(1, clip.rotation_weight::integer)
      as slot_number
    where clip.status = 'active'
      and clip.rotation_enabled = true
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
      'server_now', v_at,
      'station_status', 'off-air',
      'mode', 'rotation',
      'current', null
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

create or replace function public.fetch_net_nvn_radio_tune_state()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_payload jsonb;
  v_revision bigint := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  v_payload := public.net_nvn_radio_tune_payload_at(v_now);
  select realtime_state.radio_revision
  into v_revision
  from public.net_nvn_realtime_state as realtime_state
  where realtime_state.channel = 'public';
  return v_payload || jsonb_build_object('radio_revision', coalesce(v_revision, 0));
end;
$$;

create or replace function public.current_user_can_write_rpg_audio_object(
  object_name text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  return auth.uid() is not null
    and public.is_current_user_gm()
    and public.net_nvn_radio_object_name_is_valid(object_name, null);
end;
$$;

create or replace function public.current_user_can_read_rpg_audio_object(
  object_name text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_payload jsonb;
begin
  if auth.uid() is null
    or not public.net_nvn_radio_object_name_is_valid(object_name, null)
  then
    return false;
  end if;

  if public.is_current_user_gm() then
    return true;
  end if;

  v_payload := public.net_nvn_radio_tune_payload_at(clock_timestamp());
  return coalesce(v_payload #>> '{current,object_path}', '') = object_name;
end;
$$;

create or replace function public.signal_net_nvn_radio_change()
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.net_nvn_realtime_state (
    channel,
    article_revision,
    live_revision,
    radio_revision,
    updated_at
  ) values (
    'public',
    0,
    0,
    1,
    timezone('utc', now())
  )
  on conflict (channel) do update set
    radio_revision = public.net_nvn_realtime_state.radio_revision + 1,
    updated_at = excluded.updated_at;
end;
$$;

create or replace function public.audit_net_nvn_gm_radio_action(
  requested_action_type text,
  requested_clip_id uuid default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_profile_id uuid;
begin
  v_actor_profile_id := public.assert_net_nvn_gm_editor();
  if requested_action_type is null or btrim(requested_action_type) = '' then
    raise exception 'NVN radio audit context is invalid.' using errcode = '22023';
  end if;
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
    v_actor_profile_id,
    null,
    null,
    null,
    'system',
    requested_action_type,
    'authoritative-gm-editor',
    case when requested_clip_id is null then null else 'nvn-radio-clip' end,
    requested_clip_id
  );
end;
$$;

create or replace function public.net_nvn_gm_radio_payload()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_station public.net_nvn_radio_station%rowtype;
  v_current jsonb;
  v_revision bigint := 0;
  v_clips jsonb;
begin
  select station.*
  into v_station
  from public.net_nvn_radio_station as station
  where station.channel = 'public';
  v_current := public.net_nvn_radio_tune_payload_at(v_now);
  select realtime_state.radio_revision
  into v_revision
  from public.net_nvn_realtime_state as realtime_state
  where realtime_state.channel = 'public';
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', clip.id,
      'internal_label', clip.internal_label,
      'public_label', clip.public_label,
      'clip_kind', clip.clip_kind,
      'status', clip.status,
      'rotation_enabled', clip.rotation_enabled,
      'rotation_weight', clip.rotation_weight,
      'object_path', clip.object_path,
      'mime_type', clip.mime_type,
      'byte_size', clip.byte_size,
      'duration_ms', clip.duration_ms,
      'created_at', clip.created_at,
      'updated_at', clip.updated_at
    ) order by (clip.status = 'archived'), clip.updated_at desc, clip.id desc
  ), '[]'::jsonb)
  into v_clips
  from (
    select clip_row.*
    from public.net_nvn_radio_clips as clip_row
    order by (clip_row.status = 'archived'), clip_row.updated_at desc, clip_row.id desc
    limit 200
  ) as clip;
  return jsonb_build_object(
    'server_now', v_now,
    'radio_revision', coalesce(v_revision, 0),
    'station', jsonb_build_object(
      'station_enabled', v_station.station_enabled,
      'rotation_epoch_at', v_station.rotation_epoch_at,
      'rotation_seed', v_station.rotation_seed,
      'override_mode', v_station.override_mode,
      'override_clip_id', v_station.override_clip_id,
      'override_started_at', v_station.override_started_at,
      'override_ends_at', v_station.override_ends_at,
      'updated_at', v_station.updated_at
    ),
    'effective', v_current,
    'clips', v_clips
  );
end;
$$;

create or replace function public.fetch_net_nvn_gm_radio_control()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_nvn_gm_editor();
  return public.net_nvn_gm_radio_payload();
end;
$$;

create or replace function public.create_net_nvn_gm_radio_clip(
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
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_profile_id uuid;
  v_active_count integer;
  v_total_count integer;
begin
  v_actor_profile_id := public.assert_net_nvn_gm_editor();
  perform public.assert_net_nvn_gm_radio_clip_input(
    requested_clip_id,
    requested_internal_label,
    requested_public_label,
    requested_clip_kind,
    requested_rotation_enabled,
    requested_rotation_weight,
    requested_object_path,
    requested_mime_type,
    requested_byte_size,
    requested_duration_ms
  );

  perform 1
  from public.net_nvn_radio_station as station
  where station.channel = 'public'
  for update;

  select
    count(*) filter (where clip.status = 'active'),
    count(*)
  into v_active_count, v_total_count
  from public.net_nvn_radio_clips as clip;

  if v_active_count >= 100 then
    raise exception 'NVN_RADIO_ACTIVE_CLIP_LIMIT_REACHED' using errcode = 'P0001';
  end if;
  if v_total_count >= 200 then
    raise exception 'NVN_RADIO_LIBRARY_LIMIT_REACHED' using errcode = 'P0001';
  end if;
  if not exists (
    select 1
    from storage.objects as stored_object
    where stored_object.bucket_id = 'rpg-audio'
      and stored_object.name = requested_object_path
  ) then
    raise exception 'NVN_RADIO_OBJECT_NOT_FOUND' using errcode = 'P0002';
  end if;

  begin
    insert into public.net_nvn_radio_clips (
      id,
      internal_label,
      public_label,
      clip_kind,
      status,
      rotation_enabled,
      rotation_weight,
      object_path,
      mime_type,
      byte_size,
      duration_ms,
      created_by_profile_id
    ) values (
      requested_clip_id,
      btrim(requested_internal_label),
      nullif(btrim(requested_public_label), ''),
      lower(btrim(requested_clip_kind)),
      'active',
      requested_rotation_enabled,
      requested_rotation_weight,
      requested_object_path,
      lower(btrim(requested_mime_type)),
      requested_byte_size,
      requested_duration_ms,
      v_actor_profile_id
    );
  exception
    when unique_violation then
      if exists (
        select 1
        from public.net_nvn_radio_clips as clip
        where clip.id = requested_clip_id
          and clip.object_path = requested_object_path
      ) then
        return public.net_nvn_gm_radio_payload();
      end if;
      raise exception 'NVN_RADIO_CLIP_CONFLICT' using errcode = 'P0001';
  end;

  if requested_rotation_enabled then
    update public.net_nvn_radio_station as station
    set
      rotation_epoch_at = clock_timestamp(),
      rotation_seed = hashtextextended(gen_random_uuid()::text, 0)
    where station.channel = 'public';
  end if;
  perform public.audit_net_nvn_gm_radio_action('nvn.radio.clip.create', requested_clip_id);
  perform public.signal_net_nvn_radio_change();
  return public.net_nvn_gm_radio_payload();
end;
$$;

create or replace function public.update_net_nvn_gm_radio_clip(
  requested_clip_id uuid,
  requested_internal_label text,
  requested_public_label text,
  requested_clip_kind text,
  requested_rotation_enabled boolean,
  requested_rotation_weight integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_clip public.net_nvn_radio_clips%rowtype;
  v_changed_rows integer := 0;
  v_rotation_changed boolean := false;
begin
  perform public.assert_net_nvn_gm_editor();
  select clip.*
  into v_clip
  from public.net_nvn_radio_clips as clip
  where clip.id = requested_clip_id
  for update;
  if not found then
    raise exception 'NVN_RADIO_CLIP_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_net_nvn_gm_radio_clip_input(
    v_clip.id,
    requested_internal_label,
    requested_public_label,
    requested_clip_kind,
    requested_rotation_enabled,
    requested_rotation_weight,
    v_clip.object_path,
    v_clip.mime_type,
    v_clip.byte_size,
    v_clip.duration_ms
  );
  if v_clip.status = 'archived' and requested_rotation_enabled then
    raise exception 'NVN_RADIO_ARCHIVED_CLIP_ROTATION_INVALID' using errcode = 'P0001';
  end if;
  v_rotation_changed := row(v_clip.rotation_enabled, v_clip.rotation_weight)
    is distinct from row(requested_rotation_enabled, requested_rotation_weight);

  update public.net_nvn_radio_clips as clip
  set
    internal_label = btrim(requested_internal_label),
    public_label = nullif(btrim(requested_public_label), ''),
    clip_kind = lower(btrim(requested_clip_kind)),
    rotation_enabled = requested_rotation_enabled,
    rotation_weight = requested_rotation_weight
  where clip.id = requested_clip_id
    and row(
      clip.internal_label,
      clip.public_label,
      clip.clip_kind,
      clip.rotation_enabled,
      clip.rotation_weight
    ) is distinct from row(
      btrim(requested_internal_label),
      nullif(btrim(requested_public_label), ''),
      lower(btrim(requested_clip_kind)),
      requested_rotation_enabled,
      requested_rotation_weight::smallint
    );
  get diagnostics v_changed_rows = row_count;

  if v_changed_rows > 0 then
    if v_rotation_changed then
      update public.net_nvn_radio_station as station
      set
        rotation_epoch_at = clock_timestamp(),
        rotation_seed = hashtextextended(gen_random_uuid()::text, 0)
      where station.channel = 'public';
    end if;
    perform public.audit_net_nvn_gm_radio_action(
      case when v_rotation_changed
        then 'nvn.radio.rotation.change'
        else 'nvn.radio.clip.update'
      end,
      requested_clip_id
    );
    perform public.signal_net_nvn_radio_change();
  end if;
  return public.net_nvn_gm_radio_payload();
end;
$$;

create or replace function public.set_net_nvn_gm_radio_clip_archived(
  requested_clip_id uuid,
  requested_archived boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_clip public.net_nvn_radio_clips%rowtype;
  v_now timestamptz := clock_timestamp();
  v_active_count integer;
begin
  perform public.assert_net_nvn_gm_editor();
  if requested_archived is null then
    raise exception 'NVN_RADIO_ARCHIVE_REQUEST_INVALID' using errcode = '22023';
  end if;
  perform 1
  from public.net_nvn_radio_station as station
  where station.channel = 'public'
  for update;
  select clip.*
  into v_clip
  from public.net_nvn_radio_clips as clip
  where clip.id = requested_clip_id
  for update;
  if not found then
    raise exception 'NVN_RADIO_CLIP_NOT_FOUND' using errcode = 'P0002';
  end if;
  if requested_archived and v_clip.status = 'archived' then
    return public.net_nvn_gm_radio_payload();
  end if;
  if not requested_archived and v_clip.status = 'active' then
    return public.net_nvn_gm_radio_payload();
  end if;
  if requested_archived and exists (
    select 1
    from public.net_nvn_radio_station as station
    where station.channel = 'public'
      and station.override_clip_id = requested_clip_id
      and station.override_started_at <= v_now
      and station.override_ends_at > v_now
  ) then
    raise exception 'NVN_RADIO_CLIP_CURRENTLY_OVERRIDING' using errcode = 'P0001';
  end if;
  if not requested_archived then
    select count(*)
    into v_active_count
    from public.net_nvn_radio_clips as clip
    where clip.status = 'active';
    if v_active_count >= 100 then
      raise exception 'NVN_RADIO_ACTIVE_CLIP_LIMIT_REACHED' using errcode = 'P0001';
    end if;
  end if;

  update public.net_nvn_radio_clips as clip
  set
    status = case when requested_archived then 'archived' else 'active' end,
    rotation_enabled = case when requested_archived then false else clip.rotation_enabled end
  where clip.id = requested_clip_id;

  if v_clip.rotation_enabled then
    update public.net_nvn_radio_station as station
    set
      rotation_epoch_at = v_now,
      rotation_seed = hashtextextended(gen_random_uuid()::text, 0)
    where station.channel = 'public';
  end if;
  perform public.audit_net_nvn_gm_radio_action(
    case when requested_archived
      then 'nvn.radio.clip.archive'
      else 'nvn.radio.clip.restore'
    end,
    requested_clip_id
  );
  perform public.signal_net_nvn_radio_change();
  return public.net_nvn_gm_radio_payload();
end;
$$;

create or replace function public.set_net_nvn_gm_radio_station_enabled(
  requested_enabled boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_changed_rows integer := 0;
begin
  perform public.assert_net_nvn_gm_editor();
  if requested_enabled is null then
    raise exception 'NVN_RADIO_STATION_REQUEST_INVALID' using errcode = '22023';
  end if;
  update public.net_nvn_radio_station as station
  set
    station_enabled = requested_enabled,
    override_mode = case when requested_enabled then station.override_mode else null end,
    override_clip_id = case when requested_enabled then station.override_clip_id else null end,
    override_started_at = case when requested_enabled then station.override_started_at else null end,
    override_ends_at = case when requested_enabled then station.override_ends_at else null end
  where station.channel = 'public'
    and station.station_enabled is distinct from requested_enabled;
  get diagnostics v_changed_rows = row_count;
  if v_changed_rows > 0 then
    perform public.audit_net_nvn_gm_radio_action(
      case when requested_enabled
        then 'nvn.radio.station.enable'
        else 'nvn.radio.station.disable'
      end,
      null
    );
    perform public.signal_net_nvn_radio_change();
  end if;
  return public.net_nvn_gm_radio_payload();
end;
$$;

create or replace function public.start_net_nvn_gm_radio_override(
  requested_clip_id uuid,
  requested_mode text,
  requested_replace_active boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text := lower(btrim(coalesce(requested_mode, '')));
  v_now timestamptz := clock_timestamp();
  v_clip public.net_nvn_radio_clips%rowtype;
  v_station public.net_nvn_radio_station%rowtype;
begin
  perform public.assert_net_nvn_gm_editor();
  if v_mode not in ('play-now', 'breaking') or requested_replace_active is null then
    raise exception 'NVN_RADIO_OVERRIDE_REQUEST_INVALID' using errcode = '22023';
  end if;
  select station.*
  into v_station
  from public.net_nvn_radio_station as station
  where station.channel = 'public'
  for update;
  if not v_station.station_enabled then
    raise exception 'NVN_RADIO_STATION_DISABLED' using errcode = 'P0001';
  end if;
  if v_station.override_mode is not null
    and v_station.override_started_at <= v_now
    and v_station.override_ends_at > v_now
    and not requested_replace_active
  then
    raise exception 'NVN_RADIO_OVERRIDE_ACTIVE' using errcode = 'P0001';
  end if;
  select clip.*
  into v_clip
  from public.net_nvn_radio_clips as clip
  where clip.id = requested_clip_id
    and clip.status = 'active';
  if not found then
    raise exception 'NVN_RADIO_CLIP_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.net_nvn_radio_station as station
  set
    override_mode = v_mode,
    override_clip_id = v_clip.id,
    override_started_at = v_now,
    override_ends_at = v_now
      + (v_clip.duration_ms::double precision * interval '1 millisecond')
  where station.channel = 'public';

  perform public.audit_net_nvn_gm_radio_action(
    case when v_mode = 'breaking'
      then 'nvn.radio.breaking'
      else 'nvn.radio.play-now'
    end,
    v_clip.id
  );
  perform public.signal_net_nvn_radio_change();
  return public.net_nvn_gm_radio_payload();
end;
$$;

create or replace function public.end_net_nvn_gm_radio_override()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_station public.net_nvn_radio_station%rowtype;
  v_now timestamptz := clock_timestamp();
  v_clip_id uuid;
begin
  perform public.assert_net_nvn_gm_editor();
  select station.*
  into v_station
  from public.net_nvn_radio_station as station
  where station.channel = 'public'
  for update;
  if v_station.override_mode is null
    or v_station.override_ends_at <= v_now
  then
    raise exception 'NVN_RADIO_OVERRIDE_NOT_ACTIVE' using errcode = 'P0001';
  end if;
  v_clip_id := v_station.override_clip_id;
  update public.net_nvn_radio_station as station
  set
    override_mode = null,
    override_clip_id = null,
    override_started_at = null,
    override_ends_at = null
  where station.channel = 'public';
  perform public.audit_net_nvn_gm_radio_action(
    'nvn.radio.override.end',
    v_clip_id
  );
  perform public.signal_net_nvn_radio_change();
  return public.net_nvn_gm_radio_payload();
end;
$$;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'rpg-audio',
  'rpg-audio',
  false,
  15728640,
  array[
    'audio/mpeg', 'audio/mp4', 'audio/m4a',
    'audio/x-m4a', 'audio/ogg', 'audio/webm'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists rpg_audio_select_authorised on storage.objects;
create policy rpg_audio_select_authorised
on storage.objects
for select
to authenticated
using (
  bucket_id = 'rpg-audio'
  and public.current_user_can_read_rpg_audio_object(name)
);

drop policy if exists rpg_audio_insert_authorised on storage.objects;
create policy rpg_audio_insert_authorised
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'rpg-audio'
  and public.current_user_can_write_rpg_audio_object(name)
);

alter table public.net_nvn_radio_clips enable row level security;
alter table public.net_nvn_radio_station enable row level security;

revoke all on table public.net_nvn_radio_clips
  from public, anon, authenticated;
revoke all on table public.net_nvn_radio_station
  from public, anon, authenticated;

revoke all on function public.net_nvn_radio_object_name_is_valid(text, uuid)
  from public, anon, authenticated;
revoke all on function public.assert_net_nvn_gm_radio_clip_input(
  uuid, text, text, text, boolean, integer, text, text, integer, integer
) from public, anon, authenticated;
revoke all on function public.net_nvn_radio_tune_payload_at(timestamptz)
  from public, anon, authenticated;
revoke all on function public.signal_net_nvn_radio_change()
  from public, anon, authenticated;
revoke all on function public.audit_net_nvn_gm_radio_action(text, uuid)
  from public, anon, authenticated;
revoke all on function public.net_nvn_gm_radio_payload()
  from public, anon, authenticated;

revoke all on function public.fetch_net_nvn_radio_tune_state()
  from public, anon, authenticated;
revoke all on function public.fetch_net_nvn_gm_radio_control()
  from public, anon, authenticated;
revoke all on function public.create_net_nvn_gm_radio_clip(
  uuid, text, text, text, boolean, integer, text, text, integer, integer
) from public, anon, authenticated;
revoke all on function public.update_net_nvn_gm_radio_clip(
  uuid, text, text, text, boolean, integer
) from public, anon, authenticated;
revoke all on function public.set_net_nvn_gm_radio_clip_archived(uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.set_net_nvn_gm_radio_station_enabled(boolean)
  from public, anon, authenticated;
revoke all on function public.start_net_nvn_gm_radio_override(uuid, text, boolean)
  from public, anon, authenticated;
revoke all on function public.end_net_nvn_gm_radio_override()
  from public, anon, authenticated;

revoke all on function public.current_user_can_write_rpg_audio_object(text)
  from public, anon, authenticated;
revoke all on function public.current_user_can_read_rpg_audio_object(text)
  from public, anon, authenticated;

grant execute on function public.fetch_net_nvn_radio_tune_state()
  to authenticated;
grant execute on function public.fetch_net_nvn_gm_radio_control()
  to authenticated;
grant execute on function public.create_net_nvn_gm_radio_clip(
  uuid, text, text, text, boolean, integer, text, text, integer, integer
) to authenticated;
grant execute on function public.update_net_nvn_gm_radio_clip(
  uuid, text, text, text, boolean, integer
) to authenticated;
grant execute on function public.set_net_nvn_gm_radio_clip_archived(uuid, boolean)
  to authenticated;
grant execute on function public.set_net_nvn_gm_radio_station_enabled(boolean)
  to authenticated;
grant execute on function public.start_net_nvn_gm_radio_override(uuid, text, boolean)
  to authenticated;
grant execute on function public.end_net_nvn_gm_radio_override()
  to authenticated;
grant execute on function public.current_user_can_write_rpg_audio_object(text)
  to authenticated;
grant execute on function public.current_user_can_read_rpg_audio_object(text)
  to authenticated;

-- No radio data row enters Realtime. The existing metadata-free singleton is
-- still NVN's only publication member and the client keeps one channel.
do $$
declare
  v_table_name text;
begin
  foreach v_table_name in array array[
    'net_nvn_articles',
    'net_nvn_article_media',
    'net_nvn_incidents',
    'net_nvn_incident_updates',
    'net_nvn_radio_clips',
    'net_nvn_radio_station'
  ] loop
    if to_regclass('public.' || v_table_name) is not null
      and exists (
        select 1
        from pg_publication_tables as publication_table
        where publication_table.pubname = 'supabase_realtime'
          and publication_table.schemaname = 'public'
          and publication_table.tablename = v_table_name
      )
    then
      execute format(
        'alter publication supabase_realtime drop table public.%I',
        v_table_name
      );
    end if;
  end loop;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables as publication_table
    where publication_table.pubname = 'supabase_realtime'
      and publication_table.schemaname = 'public'
      and publication_table.tablename = 'net_nvn_realtime_state'
  ) then
    alter publication supabase_realtime add table public.net_nvn_realtime_state;
  end if;
exception when duplicate_object then null;
end $$;

commit;
