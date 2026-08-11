-- NVN LIVE: reserve the configured Breaking Intro exclusively for the
-- BREAKING NEWS intro phase. Run after net-nvn-live-broadcast-polish.sql.
-- Creates no clips, objects, or lore.

begin;

-- Normalize only the currently configured intro. If this removes one slot
-- from normal rotation, re-anchor the wall-clock rotation once and emit one
-- compact radio invalidation. Deployment normalization has no authenticated
-- GM actor, so it intentionally does not manufacture an editorial audit row.
do $$
declare
  v_stinger_clip_id uuid;
  v_changed_rows integer := 0;
  v_now timestamptz := clock_timestamp();
begin
  select station.breaking_stinger_clip_id
  into v_stinger_clip_id
  from public.net_nvn_radio_station as station
  where station.channel = 'public'
  for update;

  if v_stinger_clip_id is not null then
    update public.net_nvn_radio_clips as clip
    set rotation_enabled = false
    where clip.id = v_stinger_clip_id
      and clip.rotation_enabled = true;
    get diagnostics v_changed_rows = row_count;

    if v_changed_rows > 0 then
      update public.net_nvn_radio_station as station
      set
        rotation_epoch_at = v_now,
        rotation_seed = hashtextextended(gen_random_uuid()::text, 0)
      where station.channel = 'public';
      perform public.signal_net_nvn_radio_change();
    end if;
  end if;
end $$;

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
  v_requested_clip public.net_nvn_radio_clips%rowtype;
  v_now timestamptz := clock_timestamp();
  v_configuration_changed boolean := false;
  v_rotation_changed boolean := false;
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

  v_configuration_changed :=
    v_station.breaking_stinger_clip_id is distinct from requested_clip_id;

  if v_configuration_changed
    and v_station.override_mode = 'breaking'
    and v_station.override_started_at <= v_now
    and v_station.override_ends_at > v_now
  then
    raise exception 'NVN_RADIO_STINGER_CHANGE_DURING_BREAKING' using errcode = 'P0001';
  end if;

  if requested_clip_id is not null then
    select clip.*
    into v_requested_clip
    from public.net_nvn_radio_clips as clip
    where clip.id = requested_clip_id
      and clip.status = 'active'
    for update;
    if not found then
      raise exception 'NVN_RADIO_CLIP_NOT_FOUND' using errcode = 'P0002';
    end if;

    v_rotation_changed := v_requested_clip.rotation_enabled;
    if v_rotation_changed then
      update public.net_nvn_radio_clips as clip
      set rotation_enabled = false
      where clip.id = requested_clip_id;
    end if;
  end if;

  if not v_configuration_changed and not v_rotation_changed then
    return public.net_nvn_gm_radio_payload();
  end if;

  update public.net_nvn_radio_station as station
  set
    breaking_stinger_clip_id = requested_clip_id,
    rotation_epoch_at = case
      when v_rotation_changed then v_now
      else station.rotation_epoch_at
    end,
    rotation_seed = case
      when v_rotation_changed
        then hashtextextended(gen_random_uuid()::text, 0)
      else station.rotation_seed
    end
  where station.channel = 'public';

  perform public.audit_net_nvn_gm_radio_action(
    case
      when v_configuration_changed and requested_clip_id is null
        then 'nvn.radio.breaking-stinger.clear'
      when v_configuration_changed
        then 'nvn.radio.breaking-stinger.configure'
      else 'nvn.radio.rotation.change'
    end,
    requested_clip_id
  );
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
  v_station public.net_nvn_radio_station%rowtype;
  v_clip public.net_nvn_radio_clips%rowtype;
  v_changed_rows integer := 0;
  v_rotation_changed boolean := false;
begin
  perform public.assert_net_nvn_gm_editor();

  -- Match the lock order used by intro/archive mutations so concurrent GM
  -- tabs cannot race intro selection against a rotation enable.
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
  if requested_rotation_enabled
    and v_station.breaking_stinger_clip_id = requested_clip_id
  then
    raise exception 'NVN_RADIO_STINGER_ROTATION_INVALID' using errcode = 'P0001';
  end if;

  v_rotation_changed :=
    v_clip.rotation_enabled is distinct from requested_rotation_enabled
    or (
      v_clip.rotation_enabled = true
      and requested_rotation_enabled = true
      and v_clip.rotation_weight is distinct from requested_rotation_weight
    );

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

revoke all on function public.set_net_nvn_gm_radio_breaking_stinger(uuid)
  from public, anon, authenticated;
revoke all on function public.update_net_nvn_gm_radio_clip(
  uuid, text, text, text, boolean, integer
) from public, anon, authenticated;

grant execute on function public.set_net_nvn_gm_radio_breaking_stinger(uuid)
  to authenticated;
grant execute on function public.update_net_nvn_gm_radio_clip(
  uuid, text, text, text, boolean, integer
) to authenticated;

-- Direct table access remains denied; all authority is asserted inside the
-- narrow GM RPCs above. No Realtime publication membership changes here.
revoke all on table public.net_nvn_radio_clips
  from public, anon, authenticated;
revoke all on table public.net_nvn_radio_station
  from public, anon, authenticated;

commit;
