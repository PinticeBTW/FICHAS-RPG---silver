-- NVN LIVE: recoverable permanent deletion for archived registered audio.
-- Run after net-nvn-breaking-intro-exclusivity.sql. This migration does not
-- delete clips or Storage objects and creates no content.

begin;

alter table public.net_nvn_radio_clips
  add column if not exists pending_delete_at timestamptz;

comment on column public.net_nvn_radio_clips.pending_delete_at is
  'Server-set prepare marker for recoverable archived-audio deletion. The row and its byte_size remain authoritative until finalize removes the row.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.net_nvn_radio_clips'::regclass
      and constraint_row.conname = 'net_nvn_radio_clips_pending_delete_shape'
  ) then
    alter table public.net_nvn_radio_clips
      add constraint net_nvn_radio_clips_pending_delete_shape check (
        pending_delete_at is null
        or (status = 'archived' and rotation_enabled = false)
      );
  end if;
end $$;

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
      'pending_delete_at', clip.pending_delete_at,
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
  if not requested_archived and v_clip.pending_delete_at is not null then
    raise exception 'NVN_RADIO_DELETE_PENDING' using errcode = 'P0001';
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

create or replace function public.prepare_net_nvn_gm_radio_clip_delete(
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
  v_clip public.net_nvn_radio_clips%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  perform public.assert_net_nvn_gm_editor();

  select station.*
  into v_station
  from public.net_nvn_radio_station as station
  where station.channel = 'public'
  for update;
  if not found then
    raise exception 'NVN_RADIO_STATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  select clip.*
  into v_clip
  from public.net_nvn_radio_clips as clip
  where clip.id = requested_clip_id
  for update;
  if not found then
    raise exception 'NVN_RADIO_CLIP_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_clip.status <> 'archived' or v_clip.rotation_enabled then
    raise exception 'NVN_RADIO_DELETE_REQUIRES_ARCHIVED' using errcode = 'P0001';
  end if;
  if v_station.breaking_stinger_clip_id = requested_clip_id then
    raise exception 'NVN_RADIO_STINGER_CONFIGURED' using errcode = 'P0001';
  end if;

  if v_station.override_clip_id = requested_clip_id then
    if v_station.override_started_at <= v_now
      and v_station.override_ends_at > v_now
    then
      raise exception 'NVN_RADIO_CLIP_CURRENTLY_OVERRIDING' using errcode = 'P0001';
    elsif v_station.override_ends_at <= v_now then
      update public.net_nvn_radio_station as station
      set
        override_mode = null,
        override_clip_id = null,
        override_started_at = null,
        override_ends_at = null
      where station.channel = 'public';
    else
      raise exception 'NVN_RADIO_DELETE_OVERRIDE_STATE_INVALID' using errcode = 'P0001';
    end if;
  end if;

  if v_clip.pending_delete_at is not null then
    return public.net_nvn_gm_radio_payload();
  end if;

  update public.net_nvn_radio_clips as clip
  set pending_delete_at = v_now
  where clip.id = requested_clip_id;
  perform public.audit_net_nvn_gm_radio_action(
    'nvn.radio.clip.delete.prepare',
    requested_clip_id
  );

  -- Preparation changes only GM maintenance state. It deliberately does not
  -- invalidate tuned player clients; finalize emits the one compact revision.
  return public.net_nvn_gm_radio_payload();
end;
$$;

create or replace function public.finalize_net_nvn_gm_radio_clip_delete(
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
  v_clip public.net_nvn_radio_clips%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  perform public.assert_net_nvn_gm_editor();

  select station.*
  into v_station
  from public.net_nvn_radio_station as station
  where station.channel = 'public'
  for update;
  if not found then
    raise exception 'NVN_RADIO_STATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  select clip.*
  into v_clip
  from public.net_nvn_radio_clips as clip
  where clip.id = requested_clip_id
  for update;
  if not found then
    -- Safe recovery after a committed finalize whose HTTP response was lost.
    return public.net_nvn_gm_radio_payload();
  end if;
  if v_clip.status <> 'archived' or v_clip.rotation_enabled then
    raise exception 'NVN_RADIO_DELETE_REQUIRES_ARCHIVED' using errcode = 'P0001';
  end if;
  if v_clip.pending_delete_at is null then
    raise exception 'NVN_RADIO_DELETE_NOT_PREPARED' using errcode = 'P0001';
  end if;
  if v_station.breaking_stinger_clip_id = requested_clip_id then
    raise exception 'NVN_RADIO_STINGER_CONFIGURED' using errcode = 'P0001';
  end if;

  if v_station.override_clip_id = requested_clip_id then
    if v_station.override_started_at <= v_now
      and v_station.override_ends_at > v_now
    then
      raise exception 'NVN_RADIO_CLIP_CURRENTLY_OVERRIDING' using errcode = 'P0001';
    elsif v_station.override_ends_at <= v_now then
      update public.net_nvn_radio_station as station
      set
        override_mode = null,
        override_clip_id = null,
        override_started_at = null,
        override_ends_at = null
      where station.channel = 'public';
    else
      raise exception 'NVN_RADIO_DELETE_OVERRIDE_STATE_INVALID' using errcode = 'P0001';
    end if;
  end if;

  if exists (
    select 1
    from storage.objects as stored_object
    where stored_object.bucket_id = 'rpg-audio'
      and stored_object.name = v_clip.object_path
  ) then
    raise exception 'NVN_RADIO_DELETE_OBJECT_STILL_EXISTS' using errcode = 'P0001';
  end if;

  delete from public.net_nvn_radio_clips as clip
  where clip.id = requested_clip_id;

  perform public.audit_net_nvn_gm_radio_action(
    'nvn.radio.clip.delete',
    requested_clip_id
  );
  perform public.signal_net_nvn_radio_change();
  return public.net_nvn_gm_radio_payload();
end;
$$;

create or replace function public.current_user_can_delete_registered_nvn_radio_object(
  requested_object_name text
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
    and public.net_nvn_radio_object_name_is_valid(requested_object_name, null)
    and exists (
      select 1
      from public.net_nvn_radio_clips as clip
      where clip.object_path = requested_object_name
        and clip.status = 'archived'
        and clip.rotation_enabled = false
        and clip.pending_delete_at is not null
        and not exists (
          select 1
          from public.net_nvn_radio_station as station
          where station.channel = 'public'
            and station.breaking_stinger_clip_id = clip.id
        )
        and not exists (
          select 1
          from public.net_nvn_radio_station as station
          where station.channel = 'public'
            and station.override_clip_id = clip.id
            and station.override_started_at <= clock_timestamp()
            and station.override_ends_at > clock_timestamp()
        )
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
  and (
    public.current_user_can_delete_unregistered_rpg_audio_object(name)
    or public.current_user_can_delete_registered_nvn_radio_object(name)
  )
);

revoke all on function public.net_nvn_gm_radio_payload()
  from public, anon, authenticated;
revoke all on function public.set_net_nvn_gm_radio_clip_archived(uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.prepare_net_nvn_gm_radio_clip_delete(uuid)
  from public, anon, authenticated;
revoke all on function public.finalize_net_nvn_gm_radio_clip_delete(uuid)
  from public, anon, authenticated;
revoke all on function public.current_user_can_delete_registered_nvn_radio_object(text)
  from public, anon, authenticated;

grant execute on function public.set_net_nvn_gm_radio_clip_archived(uuid, boolean)
  to authenticated;
grant execute on function public.prepare_net_nvn_gm_radio_clip_delete(uuid)
  to authenticated;
grant execute on function public.finalize_net_nvn_gm_radio_clip_delete(uuid)
  to authenticated;
grant execute on function public.current_user_can_delete_registered_nvn_radio_object(text)
  to authenticated;

alter table public.net_nvn_radio_clips enable row level security;
revoke all on table public.net_nvn_radio_clips
  from public, anon, authenticated;
revoke all on table public.net_nvn_radio_station
  from public, anon, authenticated;

-- Player read/sign authorization, station rotation math, and Realtime
-- publication membership are intentionally unchanged.

commit;
