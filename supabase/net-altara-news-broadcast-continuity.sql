-- ALTARA NEWS Broadcast continuity hotfix.
-- Forward-only. Run after net-altara-news-broadcast.sql.
-- Rotation configuration changes are staged behind the programme already on air.

begin;

do $$
begin
  if to_regclass('public.net_altara_news_broadcast_clips') is null
    or to_regclass('public.net_altara_news_broadcast_station') is null
    or to_regclass('public.net_altara_news_realtime_state') is null
    or to_regprocedure('public.net_altara_news_broadcast_tune_payload_at(timestamptz)') is null
    or to_regprocedure('public.create_net_altara_news_gm_broadcast_clip(uuid,text,text,text,boolean,integer,text,text,integer,integer)') is null
    or to_regprocedure('public.update_net_altara_news_gm_broadcast_clip(uuid,text,text,text,boolean,integer)') is null
    or to_regprocedure('public.set_net_altara_news_gm_broadcast_clip_archived(uuid,boolean)') is null
    or to_regprocedure('public.set_net_altara_news_gm_broadcast_station_enabled(boolean)') is null
    or to_regprocedure('public.assert_net_altara_news_gm_editor()') is null
    or to_regprocedure('public.assert_net_altara_news_gm_broadcast_clip_input(uuid,text,text,text,boolean,integer,text,text,integer,integer)') is null
    or to_regprocedure('public.net_altara_news_gm_broadcast_payload()') is null
    or to_regprocedure('public.signal_net_altara_news_broadcast_change()') is null
    or to_regprocedure('public.audit_net_altara_news_gm_broadcast_action(text,uuid)') is null
  then
    raise exception 'ALTARA_NEWS_BROADCAST_CONTINUITY_DEPENDENCY_REQUIRED'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from information_schema.columns as column_definition
    where column_definition.table_schema = 'public'
      and column_definition.table_name = 'net_altara_news_broadcast_station'
      and column_definition.column_name in (
        'rotation_hold_clip_id',
        'rotation_hold_started_at',
        'rotation_hold_ends_at'
      )
  )
    or to_regprocedure('public.net_altara_news_broadcast_prepare_rotation_change(timestamptz)') is not null
  then
    raise exception 'ALTARA_NEWS_BROADCAST_CONTINUITY_PREEXISTING_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;
end;
$$;

alter table public.net_altara_news_broadcast_station
  add column rotation_hold_clip_id uuid,
  add column rotation_hold_started_at timestamptz,
  add column rotation_hold_ends_at timestamptz,
  add constraint net_altara_news_broadcast_station_rotation_hold_shape check (
    num_nonnulls(
      rotation_hold_clip_id,
      rotation_hold_started_at,
      rotation_hold_ends_at
    ) in (0, 3)
    and (
      rotation_hold_clip_id is null
      or rotation_hold_ends_at > rotation_hold_started_at
    )
  );

comment on column public.net_altara_news_broadcast_station.rotation_hold_clip_id is
  'Internal exact programme hold used only until the natural boundary of a rotation configuration change.';
comment on column public.net_altara_news_broadcast_station.rotation_hold_started_at is
  'Authoritative start of the unchanged rotation programme held across configuration changes.';
comment on column public.net_altara_news_broadcast_station.rotation_hold_ends_at is
  'Natural boundary at which the newly configured deterministic rotation becomes effective.';

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
  v_selected record;
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
      'server_now', v_at,
      'station_status', 'off-air',
      'mode', 'rotation',
      'current', null
    );
  end if;

  -- Explicit Play Now / Breaking authority always outranks an internal
  -- rotation-continuity hold and is never rewritten by that hold.
  if v_station.override_mode is not null
    and v_at >= v_station.override_started_at
    and v_at < v_station.override_ends_at
  then
    select clip.* into v_clip
    from public.net_altara_news_broadcast_clips as clip
    where clip.id = v_station.override_clip_id
      and clip.status = 'active';

    if found then
      v_started_at := v_station.override_started_at;
      if v_station.override_mode = 'breaking'
        and v_station.breaking_stinger_clip_id is not null
      then
        select clip.* into v_stinger
        from public.net_altara_news_broadcast_clips as clip
        where clip.id = v_station.breaking_stinger_clip_id
          and clip.status = 'active';
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

  -- Rotation configuration is already committed, but the exact programme
  -- that was airing at that commit remains authoritative through its original
  -- natural end. Disabling its rotation membership does not end the hold;
  -- archiving it is rejected by the mutation RPC while this payload is current.
  if v_station.rotation_hold_clip_id is not null
    and v_at >= v_station.rotation_hold_started_at
    and v_at < v_station.rotation_hold_ends_at
  then
    select clip.* into v_clip
    from public.net_altara_news_broadcast_clips as clip
    where clip.id = v_station.rotation_hold_clip_id
      and clip.status = 'active';

    if not found then
      raise exception 'ALTARA_NEWS_BROADCAST_ROTATION_HOLD_INVALID'
        using errcode = '55000';
    end if;

    return jsonb_build_object(
      'server_now', v_at,
      'station_status', 'on-air',
      'mode', 'rotation',
      'current', jsonb_build_object(
        'clip_id', v_clip.id,
        'public_label', v_clip.public_label,
        'clip_kind', v_clip.clip_kind,
        'duration_ms', v_clip.duration_ms,
        'started_at', v_station.rotation_hold_started_at,
        'ends_at', v_station.rotation_hold_ends_at,
        'object_path', v_clip.object_path
      )
    );
  end if;

  select sum(clip.duration_ms::bigint * clip.rotation_weight::bigint)
  into v_cycle_duration_ms
  from public.net_altara_news_broadcast_clips as clip
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
        v_station.rotation_seed::text || ':' || v_cycle_index::text || ':'
        || clip.id::text || ':' || slot_number::text
      ) as sort_key
    from public.net_altara_news_broadcast_clips as clip
    cross join lateral generate_series(1, clip.rotation_weight::integer) as slot_number
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
  select positioned_slot.* into v_selected
  from positioned_slots as positioned_slot
  where v_cycle_offset_ms >= positioned_slot.slot_start_ms
    and v_cycle_offset_ms < positioned_slot.slot_start_ms + positioned_slot.duration_ms
  order by positioned_slot.slot_start_ms
  limit 1;

  if not found then
    return jsonb_build_object(
      'server_now', v_at,
      'station_status', 'off-air',
      'mode', 'rotation',
      'current', null
    );
  end if;

  v_started_at := v_station.rotation_epoch_at
    + ((v_cycle_index * v_cycle_duration_ms + v_selected.slot_start_ms)::double precision
      * interval '1 millisecond');
  v_ends_at := v_started_at
    + (v_selected.duration_ms::double precision * interval '1 millisecond');

  return jsonb_build_object(
    'server_now', v_at,
    'station_status', 'on-air',
    'mode', 'rotation',
    'current', jsonb_build_object(
      'clip_id', v_selected.id,
      'public_label', v_selected.public_label,
      'clip_kind', v_selected.clip_kind,
      'duration_ms', v_selected.duration_ms,
      'started_at', v_started_at,
      'ends_at', v_ends_at,
      'object_path', v_selected.object_path
    )
  );
end;
$$;

create or replace function public.net_altara_news_broadcast_prepare_rotation_change(
  requested_at timestamptz
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(requested_at, clock_timestamp());
  v_station public.net_altara_news_broadcast_station%rowtype;
  v_current jsonb;
  v_hold_clip_id uuid;
  v_hold_started_at timestamptz;
  v_hold_ends_at timestamptz;
begin
  select station.* into v_station
  from public.net_altara_news_broadcast_station as station
  where station.channel = 'public'
  for update;

  if not found then
    raise exception 'ALTARA_NEWS_BROADCAST_STATION_REQUIRED'
      using errcode = '55000';
  end if;

  -- An explicit Play Now / Breaking override masks the rotation in the public
  -- tune payload, but it does not cancel a continuity hold that is still aging
  -- underneath. Preserve the exact held tuple and boundary before consulting
  -- the override-first effective payload.
  if v_station.rotation_hold_clip_id is not null
    and v_now >= v_station.rotation_hold_started_at
    and v_now < v_station.rotation_hold_ends_at
  then
    if not v_station.station_enabled
      or not exists (
        select 1
        from public.net_altara_news_broadcast_clips as clip
        where clip.id = v_station.rotation_hold_clip_id
          and clip.status = 'active'
      )
    then
      raise exception 'ALTARA_NEWS_BROADCAST_ROTATION_HOLD_INVALID'
        using errcode = '55000';
    end if;

    update public.net_altara_news_broadcast_station
    set rotation_epoch_at = v_station.rotation_hold_ends_at,
      rotation_seed = hashtextextended(gen_random_uuid()::text, 0)
    where channel = 'public';
    return;
  end if;

  if v_station.station_enabled then
    v_current := public.net_altara_news_broadcast_tune_payload_at(v_now);
  end if;

  if v_station.station_enabled
    and coalesce(v_current ->> 'mode', '') = 'rotation'
    and v_current -> 'current' is not null
    and jsonb_typeof(v_current -> 'current') = 'object'
  then
    begin
      v_hold_clip_id := (v_current #>> '{current,clip_id}')::uuid;
      v_hold_started_at := (v_current #>> '{current,started_at}')::timestamptz;
      v_hold_ends_at := (v_current #>> '{current,ends_at}')::timestamptz;
    exception when invalid_text_representation or datetime_field_overflow then
      raise exception 'ALTARA_NEWS_BROADCAST_ROTATION_CONTEXT_INVALID'
        using errcode = '55000';
    end;

    if v_hold_clip_id is null
      or v_hold_started_at > v_now
      or v_hold_ends_at <= v_now
      or not exists (
        select 1
        from public.net_altara_news_broadcast_clips as clip
        where clip.id = v_hold_clip_id
          and clip.status = 'active'
      )
    then
      raise exception 'ALTARA_NEWS_BROADCAST_ROTATION_CONTEXT_CHANGED'
        using errcode = '55000';
    end if;

    update public.net_altara_news_broadcast_station
    set rotation_hold_clip_id = v_hold_clip_id,
      rotation_hold_started_at = v_hold_started_at,
      rotation_hold_ends_at = v_hold_ends_at,
      rotation_epoch_at = v_hold_ends_at,
      rotation_seed = hashtextextended(gen_random_uuid()::text, 0)
    where channel = 'public';
  else
    -- With no still-active hold, off-air and explicit-override mutations have
    -- no current normal programme to preserve. They may establish the next
    -- hidden rotation immediately, without touching explicit override columns.
    update public.net_altara_news_broadcast_station
    set rotation_hold_clip_id = null,
      rotation_hold_started_at = null,
      rotation_hold_ends_at = null,
      rotation_epoch_at = v_now,
      rotation_seed = hashtextextended(gen_random_uuid()::text, 0)
    where channel = 'public';
  end if;
end;
$$;

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
language plpgsql
volatile
security definer
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
  from public.net_altara_news_broadcast_station
  where channel = 'public'
  for update;

  if exists (
    select 1
    from public.net_altara_news_broadcast_clips
    where id = requested_clip_id
      and object_path = requested_object_path
  ) then
    return public.net_altara_news_gm_broadcast_payload();
  end if;

  if exists (
    select 1
    from public.net_altara_news_broadcast_clips
    where id = requested_clip_id
      or object_path = requested_object_path
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
    requested_clip_id,
    requested_internal_label,
    requested_public_label,
    requested_clip_kind,
    requested_rotation_enabled,
    requested_rotation_weight,
    requested_object_path,
    v_storage_mime_type,
    v_storage_byte_size::integer,
    requested_duration_ms
  );

  if requested_byte_size::bigint <> v_storage_byte_size
    or lower(btrim(requested_mime_type)) <> v_storage_mime_type
  then
    raise exception 'ALTARA_NEWS_BROADCAST_OBJECT_METADATA_MISMATCH' using errcode = 'P0001';
  end if;

  select
    count(*) filter (where status = 'active'),
    count(*),
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

  if requested_rotation_enabled then
    perform public.net_altara_news_broadcast_prepare_rotation_change(clock_timestamp());
  end if;

  insert into public.net_altara_news_broadcast_clips (
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
    v_storage_mime_type,
    v_storage_byte_size::integer,
    requested_duration_ms,
    v_actor_profile_id
  );

  perform public.audit_net_altara_news_gm_broadcast_action(
    'altara-news.broadcast.clip.create',
    requested_clip_id
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
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_clip public.net_altara_news_broadcast_clips%rowtype;
  v_rotation_changed boolean;
  v_was_in_rotation boolean;
  v_will_be_in_rotation boolean;
begin
  perform public.assert_net_altara_news_gm_editor();
  perform 1
  from public.net_altara_news_broadcast_station
  where channel = 'public'
  for update;

  select clip.* into v_clip
  from public.net_altara_news_broadcast_clips as clip
  where clip.id = requested_clip_id
  for update;

  if not found then
    raise exception 'ALTARA_NEWS_BROADCAST_CLIP_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_clip.pending_delete_at is not null then
    raise exception 'ALTARA_NEWS_BROADCAST_DELETE_PENDING' using errcode = 'P0001';
  end if;

  perform public.assert_net_altara_news_gm_broadcast_clip_input(
    v_clip.id,
    requested_internal_label,
    requested_public_label,
    requested_clip_kind,
    case when v_clip.status = 'archived' then false else requested_rotation_enabled end,
    requested_rotation_weight,
    v_clip.object_path,
    v_clip.mime_type,
    v_clip.byte_size,
    v_clip.duration_ms
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

  if v_rotation_changed then
    perform public.net_altara_news_broadcast_prepare_rotation_change(clock_timestamp());
  end if;

  update public.net_altara_news_broadcast_clips
  set internal_label = btrim(requested_internal_label),
    public_label = nullif(btrim(requested_public_label), ''),
    clip_kind = lower(btrim(requested_clip_kind)),
    rotation_enabled = requested_rotation_enabled,
    rotation_weight = requested_rotation_weight
  where id = requested_clip_id;

  perform public.audit_net_altara_news_gm_broadcast_action(
    'altara-news.broadcast.clip.update',
    requested_clip_id
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
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_clip public.net_altara_news_broadcast_clips%rowtype;
  v_station public.net_altara_news_broadcast_station%rowtype;
  v_now timestamptz;
  v_active_count integer;
  v_current jsonb;
begin
  perform public.assert_net_altara_news_gm_editor();
  if requested_archived is null then
    raise exception 'ALTARA_NEWS_BROADCAST_ARCHIVE_REQUEST_INVALID' using errcode = '22023';
  end if;

  select station.* into v_station
  from public.net_altara_news_broadcast_station as station
  where station.channel = 'public'
  for update;

  select clip.* into v_clip
  from public.net_altara_news_broadcast_clips as clip
  where clip.id = requested_clip_id
  for update;

  if not found then
    raise exception 'ALTARA_NEWS_BROADCAST_CLIP_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Capture time only after the station/clip lock pair is held. A mutation
  -- that waited across a natural boundary must resolve the programme that is
  -- current after the wait, not the programme that was current on RPC entry.
  v_now := clock_timestamp();
  if requested_archived
    and v_station.rotation_hold_clip_id = requested_clip_id
    and v_now >= v_station.rotation_hold_started_at
    and v_now < v_station.rotation_hold_ends_at
  then
    -- The effective payload may currently expose Play Now / Breaking instead.
    -- The underlying held rotation clip remains pinned until its wall-clock
    -- boundary and cannot be archived while masked by that override.
    raise exception 'ALTARA_NEWS_BROADCAST_CLIP_CURRENTLY_PLAYING' using errcode = 'P0001';
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
  if requested_archived
    and v_station.breaking_stinger_clip_id = requested_clip_id
  then
    raise exception 'ALTARA_NEWS_BROADCAST_STINGER_CONFIGURED' using errcode = 'P0001';
  end if;
  if requested_archived
    and v_station.override_clip_id = requested_clip_id
    and v_station.override_started_at <= v_now
    and v_station.override_ends_at > v_now
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
    from public.net_altara_news_broadcast_clips
    where status = 'active';
    if v_active_count >= 100 then
      raise exception 'ALTARA_NEWS_BROADCAST_ACTIVE_CLIP_LIMIT_REACHED' using errcode = 'P0001';
    end if;
  end if;

  if v_clip.rotation_enabled then
    perform public.net_altara_news_broadcast_prepare_rotation_change(v_now);
  end if;

  update public.net_altara_news_broadcast_clips
  set status = case when requested_archived then 'archived' else 'active' end,
    rotation_enabled = case when requested_archived then false else rotation_enabled end
  where id = requested_clip_id;

  perform public.audit_net_altara_news_gm_broadcast_action(
    case when requested_archived
      then 'altara-news.broadcast.clip.archive'
      else 'altara-news.broadcast.clip.restore'
    end,
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
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_station public.net_altara_news_broadcast_station%rowtype;
  v_now timestamptz;
begin
  perform public.assert_net_altara_news_gm_editor();
  if requested_enabled is null then
    raise exception 'ALTARA_NEWS_BROADCAST_STATION_REQUEST_INVALID' using errcode = '22023';
  end if;

  select station.* into v_station
  from public.net_altara_news_broadcast_station as station
  where station.channel = 'public'
  for update;

  if v_station.station_enabled = requested_enabled then
    return public.net_altara_news_gm_broadcast_payload();
  end if;

  v_now := clock_timestamp();

  update public.net_altara_news_broadcast_station
  set station_enabled = requested_enabled,
    rotation_epoch_at = v_now,
    rotation_seed = hashtextextended(gen_random_uuid()::text, 0),
    rotation_hold_clip_id = null,
    rotation_hold_started_at = null,
    rotation_hold_ends_at = null,
    override_mode = case when requested_enabled then override_mode else null end,
    override_clip_id = case when requested_enabled then override_clip_id else null end,
    override_started_at = case when requested_enabled then override_started_at else null end,
    override_ends_at = case when requested_enabled then override_ends_at else null end
  where channel = 'public';

  perform public.audit_net_altara_news_gm_broadcast_action(
    case when requested_enabled
      then 'altara-news.broadcast.station.enable'
      else 'altara-news.broadcast.station.disable'
    end,
    null
  );
  perform public.signal_net_altara_news_broadcast_change();
  return public.net_altara_news_gm_broadcast_payload();
end;
$$;

revoke all on function public.net_altara_news_broadcast_tune_payload_at(timestamptz)
  from public, anon, authenticated;
revoke all on function public.net_altara_news_broadcast_prepare_rotation_change(timestamptz)
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

commit;
