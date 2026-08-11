-- NVN LIVE BROADCAST POLISH V1: optional global Breaking News intro,
-- authoritative NVN audio budget, and narrow failed-registration cleanup.
-- Run after net-nvn-radio.sql. Creates no clips, objects, or lore.

begin;

alter table public.net_nvn_radio_station
  add column if not exists breaking_stinger_clip_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.net_nvn_radio_station'::regclass
      and constraint_row.conname = 'net_nvn_radio_station_breaking_stinger_clip_fk'
  ) then
    alter table public.net_nvn_radio_station
      add constraint net_nvn_radio_station_breaking_stinger_clip_fk
      foreign key (breaking_stinger_clip_id)
      references public.net_nvn_radio_clips (id)
      on delete restrict;
  end if;
end $$;

comment on column public.net_nvn_radio_station.breaking_stinger_clip_id is
  'Optional active clip used as the first server-clock phase of BREAKING NEWS. Never projected before it is currently audible.';

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
  v_stinger public.net_nvn_radio_clips%rowtype;
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
      v_started_at := v_station.override_started_at;

      if v_station.override_mode = 'breaking'
        and v_station.breaking_stinger_clip_id is not null
      then
        select clip.*
        into v_stinger
        from public.net_nvn_radio_clips as clip
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
  v_library_byte_size bigint := 0;
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
  select coalesce(sum(clip.byte_size::bigint), 0)
  into v_library_byte_size
  from public.net_nvn_radio_clips as clip;
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
    'library_byte_size', v_library_byte_size,
    'library_byte_budget', 419430400,
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
    'effective', v_current,
    'clips', v_clips
  );
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
  v_library_byte_size bigint;
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

  if exists (
    select 1
    from public.net_nvn_radio_clips as clip
    where clip.id = requested_clip_id
      and clip.object_path = requested_object_path
  ) then
    return public.net_nvn_gm_radio_payload();
  end if;
  if exists (
    select 1
    from public.net_nvn_radio_clips as clip
    where clip.id = requested_clip_id
      or clip.object_path = requested_object_path
  ) then
    raise exception 'NVN_RADIO_CLIP_CONFLICT' using errcode = 'P0001';
  end if;

  select
    count(*) filter (where clip.status = 'active'),
    count(*),
    coalesce(sum(clip.byte_size::bigint), 0)
  into v_active_count, v_total_count, v_library_byte_size
  from public.net_nvn_radio_clips as clip;

  if v_active_count >= 100 then
    raise exception 'NVN_RADIO_ACTIVE_CLIP_LIMIT_REACHED' using errcode = 'P0001';
  end if;
  if v_total_count >= 200 then
    raise exception 'NVN_RADIO_LIBRARY_LIMIT_REACHED' using errcode = 'P0001';
  end if;
  if v_library_byte_size + requested_byte_size::bigint > 419430400 then
    raise exception 'NVN_RADIO_STORAGE_BUDGET_REACHED' using errcode = 'P0001';
  end if;
  if not exists (
    select 1
    from storage.objects as stored_object
    where stored_object.bucket_id = 'rpg-audio'
      and stored_object.name = requested_object_path
  ) then
    raise exception 'NVN_RADIO_OBJECT_NOT_FOUND' using errcode = 'P0002';
  end if;

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

create or replace function public.set_net_nvn_gm_radio_breaking_stinger(
  requested_clip_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_station public.net_nvn_radio_station%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  perform public.assert_net_nvn_gm_editor();
  select station.*
  into v_station
  from public.net_nvn_radio_station as station
  where station.channel = 'public'
  for update;

  if v_station.breaking_stinger_clip_id is not distinct from requested_clip_id then
    return public.net_nvn_gm_radio_payload();
  end if;
  if v_station.override_mode = 'breaking'
    and v_station.override_started_at <= v_now
    and v_station.override_ends_at > v_now
  then
    raise exception 'NVN_RADIO_STINGER_CHANGE_DURING_BREAKING' using errcode = 'P0001';
  end if;
  if requested_clip_id is not null and not exists (
    select 1
    from public.net_nvn_radio_clips as clip
    where clip.id = requested_clip_id
      and clip.status = 'active'
  ) then
    raise exception 'NVN_RADIO_CLIP_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.net_nvn_radio_station as station
  set breaking_stinger_clip_id = requested_clip_id
  where station.channel = 'public';
  perform public.audit_net_nvn_gm_radio_action(
    case when requested_clip_id is null
      then 'nvn.radio.breaking-stinger.clear'
      else 'nvn.radio.breaking-stinger.configure'
    end,
    requested_clip_id
  );
  perform public.signal_net_nvn_radio_change();
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
      and station.breaking_stinger_clip_id = requested_clip_id
  ) then
    raise exception 'NVN_RADIO_STINGER_CONFIGURED' using errcode = 'P0001';
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
  v_stinger public.net_nvn_radio_clips%rowtype;
  v_station public.net_nvn_radio_station%rowtype;
  v_total_duration_ms bigint;
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

  v_total_duration_ms := v_clip.duration_ms;
  if v_mode = 'breaking' and v_station.breaking_stinger_clip_id is not null then
    select clip.*
    into v_stinger
    from public.net_nvn_radio_clips as clip
    where clip.id = v_station.breaking_stinger_clip_id
      and clip.status = 'active';
    if found then
      v_total_duration_ms := v_total_duration_ms + v_stinger.duration_ms;
    end if;
  end if;

  update public.net_nvn_radio_station as station
  set
    override_mode = v_mode,
    override_clip_id = v_clip.id,
    override_started_at = v_now,
    override_ends_at = v_now
      + (v_total_duration_ms::double precision * interval '1 millisecond')
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

create or replace function public.current_user_can_delete_unregistered_rpg_audio_object(
  object_name text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  return auth.uid() is not null
    and public.is_current_user_gm()
    and public.net_nvn_radio_object_name_is_valid(object_name, null)
    and not exists (
      select 1
      from public.net_nvn_radio_clips as clip
      where clip.object_path = object_name
    );
end;
$$;

drop policy if exists rpg_audio_delete_unregistered_authorised on storage.objects;
create policy rpg_audio_delete_unregistered_authorised
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'rpg-audio'
  and public.current_user_can_delete_unregistered_rpg_audio_object(name)
);

revoke all on function public.set_net_nvn_gm_radio_breaking_stinger(uuid)
  from public, anon, authenticated;
revoke all on function public.current_user_can_delete_unregistered_rpg_audio_object(text)
  from public, anon, authenticated;

grant execute on function public.set_net_nvn_gm_radio_breaking_stinger(uuid)
  to authenticated;
grant execute on function public.current_user_can_delete_unregistered_rpg_audio_object(text)
  to authenticated;

-- Existing functions replaced above retain their original intentional grants.
-- Reassert direct table denial; no radio table enters Realtime publication.
revoke all on table public.net_nvn_radio_clips
  from public, anon, authenticated;
revoke all on table public.net_nvn_radio_station
  from public, anon, authenticated;

commit;
