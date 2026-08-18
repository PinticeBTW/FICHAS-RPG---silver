-- ECHO 1C: authoritative GM signal control, lifecycle, links, and grants.
-- Run after net-echo-foundation.sql, net-pulse-content.sql (audit ledger),
-- and net-gm-persona-directory-performance.sql (compact grant targets).
-- This migration creates no signals and changes no player visibility rules.

begin;

create or replace function public.assert_net_echo_gm_editor()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  actor_profile_id uuid := auth.uid();
begin
  if actor_profile_id is null or not public.is_current_user_gm() then
    raise exception 'Only the authoritative GM may control ECHO signals.'
      using errcode = '42501';
  end if;
  return actor_profile_id;
end;
$$;

create or replace function public.assert_net_echo_gm_signal_input(
  requested_kind text,
  requested_visibility_mode text,
  requested_title text,
  requested_summary text,
  requested_body text,
  requested_reliability text,
  requested_intensity text,
  requested_frequencies text[],
  requested_map_x numeric,
  requested_map_y numeric,
  requested_integrity_percent smallint,
  requested_locked_teaser text,
  requested_source_account_id uuid,
  requested_source_label text,
  requested_location_label text,
  requested_district_label text,
  requested_reference_app_id text,
  requested_reference_resource_kind text,
  requested_reference_resource_id text
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if requested_kind not in (
    'fragment', 'transmission', 'rumor', 'incident', 'location-trace',
    'leaked-record', 'memory-fragment', 'identity-clue',
    'faction-activity', 'dead', 'corrupted', 'encrypted'
  ) then
    raise exception 'Unsupported ECHO signal kind.' using errcode = '22023';
  end if;
  if requested_visibility_mode not in ('global', 'granted', 'prerequisite') then
    raise exception 'Unsupported ECHO visibility mode.' using errcode = '22023';
  end if;
  if requested_reliability not in (
    'unknown', 'unverified', 'contested', 'corroborated',
    'verified', 'compromised'
  ) then
    raise exception 'Unsupported ECHO reliability.' using errcode = '22023';
  end if;
  if requested_intensity not in ('low', 'medium', 'high', 'critical') then
    raise exception 'Unsupported ECHO intensity.' using errcode = '22023';
  end if;

  if requested_title is null
    or btrim(requested_title) = ''
    or char_length(btrim(requested_title)) > 120
    or octet_length(requested_title) > 1024
  then
    raise exception 'ECHO title must contain 1 to 120 characters.' using errcode = '22023';
  end if;
  if requested_summary is not null and (
    btrim(requested_summary) = ''
    or char_length(btrim(requested_summary)) > 280
    or octet_length(requested_summary) > 2048
  ) then
    raise exception 'ECHO summary is limited to 280 characters.' using errcode = '22023';
  end if;
  if requested_body is null
    or btrim(requested_body) = ''
    or char_length(btrim(requested_body)) > 4000
    or octet_length(requested_body) > 16000
  then
    raise exception 'ECHO body must contain 1 to 4000 characters.' using errcode = '22023';
  end if;

  if requested_frequencies is null
    or cardinality(requested_frequencies) > 10
    or exists (
      select 1
      from unnest(requested_frequencies) as frequency(value)
      where frequency.value is null
        or btrim(frequency.value) = ''
        or char_length(btrim(frequency.value)) > 32
    )
  then
    raise exception 'ECHO supports at most 10 frequencies of 32 characters.' using errcode = '22023';
  end if;
  if requested_map_x is null or requested_map_x < 0 or requested_map_x > 100
    or requested_map_y is null or requested_map_y < 0 or requested_map_y > 100
  then
    raise exception 'ECHO map coordinates must be between 0 and 100.' using errcode = '22023';
  end if;
  if requested_integrity_percent is not null
    and (requested_integrity_percent < 0 or requested_integrity_percent > 100)
  then
    raise exception 'ECHO integrity must be between 0 and 100.' using errcode = '22023';
  end if;

  if requested_locked_teaser is not null and (
    requested_visibility_mode <> 'prerequisite'
    or btrim(requested_locked_teaser) = ''
    or char_length(btrim(requested_locked_teaser)) > 160
    or octet_length(requested_locked_teaser) > 1024
  ) then
    raise exception 'A locked teaser is valid only for prerequisite signals and is limited to 160 characters.'
      using errcode = '22023';
  end if;
  if requested_source_label is not null and (
    btrim(requested_source_label) = ''
    or char_length(btrim(requested_source_label)) > 120
  ) then
    raise exception 'ECHO source label is limited to 120 characters.' using errcode = '22023';
  end if;
  if requested_location_label is not null and (
    btrim(requested_location_label) = ''
    or char_length(btrim(requested_location_label)) > 120
  ) then
    raise exception 'ECHO location label is limited to 120 characters.' using errcode = '22023';
  end if;
  if requested_district_label is not null and (
    btrim(requested_district_label) = ''
    or char_length(btrim(requested_district_label)) > 80
  ) then
    raise exception 'ECHO district label is limited to 80 characters.' using errcode = '22023';
  end if;

  if num_nonnulls(
    requested_reference_app_id,
    requested_reference_resource_kind,
    requested_reference_resource_id
  ) not in (0, 3) then
    raise exception 'ECHO cross-app references require app, resource kind, and resource id.'
      using errcode = '22023';
  end if;
  if requested_reference_app_id is not null and (
    char_length(btrim(requested_reference_app_id)) not between 1 and 32
    or lower(btrim(requested_reference_app_id)) !~ '^[a-z0-9][a-z0-9-]*$'
    or char_length(btrim(requested_reference_resource_kind)) not between 1 and 40
    or lower(btrim(requested_reference_resource_kind)) !~ '^[a-z0-9][a-z0-9-]*$'
    or char_length(btrim(requested_reference_resource_id)) not between 1 and 160
  ) then
    raise exception 'ECHO cross-app reference format is invalid.' using errcode = '22023';
  end if;

  if requested_source_account_id is not null and not exists (
    select 1
    from public.net_app_accounts as source_account
    where source_account.id = requested_source_account_id
      and source_account.status = 'active'
  ) then
    raise exception 'The selected ECHO source account is unavailable.' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.net_echo_gm_signal_payload(
  requested_signal_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', signal.id,
    'kind', signal.kind,
    'status', signal.status,
    'visibility_mode', signal.visibility_mode,
    'title', signal.title,
    'summary', signal.summary,
    'body', signal.body,
    'reliability', signal.reliability,
    'intensity', signal.intensity,
    'frequencies', to_jsonb(signal.frequencies),
    'map_x', signal.map_x,
    'map_y', signal.map_y,
    'integrity_percent', signal.integrity_percent,
    'locked_teaser', signal.locked_teaser,
    'source_account_id', signal.source_account_id,
    'source_label', signal.source_label,
    'location_label', signal.location_label,
    'district_label', signal.district_label,
    'occurred_at', signal.occurred_at,
    'primary_reference_app_id', signal.primary_reference_app_id,
    'primary_reference_resource_kind', signal.primary_reference_resource_kind,
    'primary_reference_resource_id', signal.primary_reference_resource_id,
    'created_at', signal.created_at,
    'updated_at', signal.updated_at,
    'revealed_at', signal.revealed_at,
    'links', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'from_signal_id', link.from_signal_id,
          'to_signal_id', link.to_signal_id,
          'relationship_kind', link.relationship_kind,
          'label', link.label,
          'created_at', link.created_at
        )
        order by link.relationship_kind, link.from_signal_id, link.to_signal_id
      )
      from (
        select
          selected_link.from_signal_id,
          selected_link.to_signal_id,
          selected_link.relationship_kind,
          selected_link.label,
          selected_link.created_at
        from public.net_echo_signal_links as selected_link
        where selected_link.from_signal_id = signal.id
          or selected_link.to_signal_id = signal.id
        order by
          selected_link.relationship_kind,
          selected_link.from_signal_id,
          selected_link.to_signal_id
        limit 200
      ) as link
    ), '[]'::jsonb)
  )
  from public.net_echo_signals as signal
  where signal.id = requested_signal_id;
$$;

create or replace function public.audit_net_echo_gm_action(
  requested_action_type text,
  requested_signal_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_profile_id uuid;
begin
  actor_profile_id := public.assert_net_echo_gm_editor();
  if requested_action_type is null or btrim(requested_action_type) = ''
    or requested_signal_id is null
  then
    raise exception 'ECHO audit context is invalid.' using errcode = '22023';
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
    actor_profile_id,
    null,
    null,
    null,
    'system',
    requested_action_type,
    'authoritative-gm-editor',
    'echo-signal',
    requested_signal_id
  );
end;
$$;

create or replace function public.fetch_net_echo_gm_signal_directory(
  requested_limit integer default 200
)
returns table (
  signal_id uuid,
  title text,
  kind text,
  status text,
  visibility_mode text,
  reliability text,
  intensity text,
  map_x numeric,
  map_y numeric,
  locked_teaser text,
  link_count integer,
  requires_count integer,
  updated_at timestamptz,
  revealed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  bounded_limit integer := least(greatest(coalesce(requested_limit, 200), 1), 200);
begin
  perform public.assert_net_echo_gm_editor();

  return query
  with selected_signals as materialized (
    select
      signal.id,
      signal.title,
      signal.kind,
      signal.status,
      signal.visibility_mode,
      signal.reliability,
      signal.intensity,
      signal.map_x,
      signal.map_y,
      signal.locked_teaser,
      signal.updated_at,
      signal.revealed_at
    from public.net_echo_signals as signal
    order by signal.updated_at desc, signal.id desc
    limit bounded_limit
  ), link_rows as (
    select link.from_signal_id as signal_id, link.relationship_kind, true as is_outgoing
    from public.net_echo_signal_links as link
    join selected_signals as selected on selected.id = link.from_signal_id
    union all
    select link.to_signal_id as signal_id, link.relationship_kind, false as is_outgoing
    from public.net_echo_signal_links as link
    join selected_signals as selected on selected.id = link.to_signal_id
  ), link_counts as (
    select
      link_row.signal_id,
      count(*)::integer as link_count,
      count(*) filter (
        where link_row.relationship_kind = 'requires'
          and link_row.is_outgoing
      )::integer as requires_count
    from link_rows as link_row
    group by link_row.signal_id
  )
  select
    signal.id,
    signal.title,
    signal.kind,
    signal.status,
    signal.visibility_mode,
    signal.reliability,
    signal.intensity,
    signal.map_x,
    signal.map_y,
    signal.locked_teaser,
    coalesce(counts.link_count, 0),
    coalesce(counts.requires_count, 0),
    signal.updated_at,
    signal.revealed_at
  from selected_signals as signal
  left join link_counts as counts on counts.signal_id = signal.id
  order by signal.updated_at desc, signal.id desc
  ;
end;
$$;

create or replace function public.fetch_net_echo_gm_signal(
  requested_signal_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  payload jsonb;
begin
  perform public.assert_net_echo_gm_editor();
  if requested_signal_id is null then
    raise exception 'An ECHO signal id is required.' using errcode = '22023';
  end if;
  payload := public.net_echo_gm_signal_payload(requested_signal_id);
  return payload;
end;
$$;

create or replace function public.create_net_echo_gm_signal(
  requested_kind text,
  requested_visibility_mode text,
  requested_title text,
  requested_summary text,
  requested_body text,
  requested_reliability text,
  requested_intensity text,
  requested_frequencies text[],
  requested_map_x numeric,
  requested_map_y numeric,
  requested_integrity_percent smallint,
  requested_locked_teaser text,
  requested_source_account_id uuid,
  requested_source_label text,
  requested_location_label text,
  requested_district_label text,
  requested_occurred_at timestamptz,
  requested_reference_app_id text,
  requested_reference_resource_kind text,
  requested_reference_resource_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_profile_id uuid;
  saved_signal public.net_echo_signals%rowtype;
  normalized_frequencies text[];
begin
  actor_profile_id := public.assert_net_echo_gm_editor();
  perform public.assert_net_echo_gm_signal_input(
    requested_kind, requested_visibility_mode, requested_title,
    requested_summary, requested_body, requested_reliability,
    requested_intensity, requested_frequencies, requested_map_x,
    requested_map_y, requested_integrity_percent, requested_locked_teaser,
    requested_source_account_id, requested_source_label,
    requested_location_label, requested_district_label,
    requested_reference_app_id, requested_reference_resource_kind,
    requested_reference_resource_id
  );

  select coalesce(array_agg(value order by value), '{}'::text[])
  into normalized_frequencies
  from (
    select distinct lower(btrim(frequency.value)) as value
    from unnest(requested_frequencies) as frequency(value)
  ) as normalized;

  insert into public.net_echo_signals (
    kind, status, visibility_mode, title, summary, body, reliability,
    intensity, frequencies, map_x, map_y, integrity_percent,
    locked_teaser, source_account_id, source_label, location_label,
    district_label, occurred_at, primary_reference_app_id,
    primary_reference_resource_kind, primary_reference_resource_id,
    created_by_profile_id, revealed_at
  ) values (
    requested_kind, 'draft', requested_visibility_mode,
    btrim(requested_title), nullif(btrim(requested_summary), ''),
    btrim(requested_body), requested_reliability, requested_intensity,
    normalized_frequencies, requested_map_x, requested_map_y,
    requested_integrity_percent, nullif(btrim(requested_locked_teaser), ''),
    requested_source_account_id, nullif(btrim(requested_source_label), ''),
    nullif(btrim(requested_location_label), ''),
    nullif(btrim(requested_district_label), ''), requested_occurred_at,
    lower(nullif(btrim(requested_reference_app_id), '')),
    lower(nullif(btrim(requested_reference_resource_kind), '')),
    nullif(btrim(requested_reference_resource_id), ''),
    actor_profile_id, null
  )
  returning * into saved_signal;

  perform public.audit_net_echo_gm_action('echo.signal.create', saved_signal.id);
  return public.net_echo_gm_signal_payload(saved_signal.id);
end;
$$;

create or replace function public.update_net_echo_gm_signal(
  requested_signal_id uuid,
  requested_kind text,
  requested_visibility_mode text,
  requested_title text,
  requested_summary text,
  requested_body text,
  requested_reliability text,
  requested_intensity text,
  requested_frequencies text[],
  requested_map_x numeric,
  requested_map_y numeric,
  requested_integrity_percent smallint,
  requested_locked_teaser text,
  requested_source_account_id uuid,
  requested_source_label text,
  requested_location_label text,
  requested_district_label text,
  requested_occurred_at timestamptz,
  requested_reference_app_id text,
  requested_reference_resource_kind text,
  requested_reference_resource_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_signal public.net_echo_signals%rowtype;
  saved_signal public.net_echo_signals%rowtype;
  normalized_frequencies text[];
  changed_rows integer := 0;
begin
  perform public.assert_net_echo_gm_editor();
  if requested_signal_id is null then
    raise exception 'An ECHO signal id is required.' using errcode = '22023';
  end if;
  perform public.assert_net_echo_gm_signal_input(
    requested_kind, requested_visibility_mode, requested_title,
    requested_summary, requested_body, requested_reliability,
    requested_intensity, requested_frequencies, requested_map_x,
    requested_map_y, requested_integrity_percent, requested_locked_teaser,
    requested_source_account_id, requested_source_label,
    requested_location_label, requested_district_label,
    requested_reference_app_id, requested_reference_resource_kind,
    requested_reference_resource_id
  );

  select signal.* into current_signal
  from public.net_echo_signals as signal
  where signal.id = requested_signal_id
  for update;
  if not found then
    raise exception 'ECHO signal was not found.' using errcode = 'P0002';
  end if;

  if current_signal.status = 'revealed'
    and requested_visibility_mode = 'prerequisite'
    and not exists (
      select 1 from public.net_echo_signal_links as link
      where link.from_signal_id = requested_signal_id
        and link.relationship_kind = 'requires'
    )
  then
    raise exception 'ECHO_PREREQUISITE_REQUIRED' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(value order by value), '{}'::text[])
  into normalized_frequencies
  from (
    select distinct lower(btrim(frequency.value)) as value
    from unnest(requested_frequencies) as frequency(value)
  ) as normalized;

  update public.net_echo_signals as signal
  set
    kind = requested_kind,
    visibility_mode = requested_visibility_mode,
    title = btrim(requested_title),
    summary = nullif(btrim(requested_summary), ''),
    body = btrim(requested_body),
    reliability = requested_reliability,
    intensity = requested_intensity,
    frequencies = normalized_frequencies,
    map_x = requested_map_x,
    map_y = requested_map_y,
    integrity_percent = requested_integrity_percent,
    locked_teaser = nullif(btrim(requested_locked_teaser), ''),
    source_account_id = requested_source_account_id,
    source_label = nullif(btrim(requested_source_label), ''),
    location_label = nullif(btrim(requested_location_label), ''),
    district_label = nullif(btrim(requested_district_label), ''),
    occurred_at = requested_occurred_at,
    primary_reference_app_id = lower(nullif(btrim(requested_reference_app_id), '')),
    primary_reference_resource_kind = lower(nullif(btrim(requested_reference_resource_kind), '')),
    primary_reference_resource_id = nullif(btrim(requested_reference_resource_id), '')
  where signal.id = requested_signal_id
    and row(
      signal.kind, signal.visibility_mode, signal.title, signal.summary,
      signal.body, signal.reliability, signal.intensity, signal.frequencies,
      signal.map_x, signal.map_y, signal.integrity_percent,
      signal.locked_teaser, signal.source_account_id, signal.source_label,
      signal.location_label, signal.district_label, signal.occurred_at,
      signal.primary_reference_app_id,
      signal.primary_reference_resource_kind,
      signal.primary_reference_resource_id
    ) is distinct from row(
      requested_kind, requested_visibility_mode, btrim(requested_title),
      nullif(btrim(requested_summary), ''), btrim(requested_body),
      requested_reliability, requested_intensity, normalized_frequencies,
      requested_map_x, requested_map_y, requested_integrity_percent,
      nullif(btrim(requested_locked_teaser), ''), requested_source_account_id,
      nullif(btrim(requested_source_label), ''),
      nullif(btrim(requested_location_label), ''),
      nullif(btrim(requested_district_label), ''), requested_occurred_at,
      lower(nullif(btrim(requested_reference_app_id), '')),
      lower(nullif(btrim(requested_reference_resource_kind), '')),
      nullif(btrim(requested_reference_resource_id), '')
    )
  returning signal.* into saved_signal;
  get diagnostics changed_rows = row_count;

  if changed_rows > 0 then
    perform public.audit_net_echo_gm_action('echo.signal.update', requested_signal_id);
  end if;
  return public.net_echo_gm_signal_payload(requested_signal_id);
end;
$$;

create or replace function public.set_net_echo_gm_signal_lifecycle(
  requested_signal_id uuid,
  requested_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_signal public.net_echo_signals%rowtype;
  audit_action text;
begin
  perform public.assert_net_echo_gm_editor();
  if requested_signal_id is null or requested_status not in ('draft', 'revealed', 'archived') then
    raise exception 'Unsupported ECHO lifecycle transition.' using errcode = '22023';
  end if;

  select signal.* into current_signal
  from public.net_echo_signals as signal
  where signal.id = requested_signal_id
  for update;
  if not found then
    raise exception 'ECHO signal was not found.' using errcode = 'P0002';
  end if;
  if current_signal.status = requested_status then
    return public.net_echo_gm_signal_payload(requested_signal_id);
  end if;

  if requested_status = 'revealed'
    and current_signal.visibility_mode = 'prerequisite'
    and not exists (
      select 1 from public.net_echo_signal_links as link
      where link.from_signal_id = requested_signal_id
        and link.relationship_kind = 'requires'
    )
  then
    raise exception 'ECHO_PREREQUISITE_REQUIRED' using errcode = 'P0001';
  end if;

  update public.net_echo_signals as signal
  set
    status = requested_status,
    revealed_at = case
      when requested_status = 'revealed' then timezone('utc', now())
      when requested_status = 'draft' then null
      else signal.revealed_at
    end
  where signal.id = requested_signal_id;

  audit_action := case
    when requested_status = 'revealed' then 'echo.signal.reveal'
    when requested_status = 'archived' then 'echo.signal.archive'
    when current_signal.status = 'archived' then 'echo.signal.restore'
    else 'echo.signal.hide'
  end;
  perform public.audit_net_echo_gm_action(audit_action, requested_signal_id);
  return public.net_echo_gm_signal_payload(requested_signal_id);
end;
$$;

create or replace function public.set_net_echo_gm_signal_link(
  requested_from_signal_id uuid,
  requested_to_signal_id uuid,
  requested_relationship_kind text,
  requested_label text,
  requested_desired_linked boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  from_signal public.net_echo_signals%rowtype;
  normalized_label text := nullif(btrim(requested_label), '');
  changed_rows integer := 0;
begin
  perform public.assert_net_echo_gm_editor();
  if requested_from_signal_id is null or requested_to_signal_id is null
    or requested_from_signal_id = requested_to_signal_id
    or requested_relationship_kind not in ('related', 'supports', 'contradicts', 'origin', 'requires')
    or requested_desired_linked is null
  then
    raise exception 'Invalid ECHO signal link.' using errcode = '22023';
  end if;
  if normalized_label is not null and char_length(normalized_label) > 80 then
    raise exception 'ECHO link labels are limited to 80 characters.' using errcode = '22023';
  end if;

  select signal.* into from_signal
  from public.net_echo_signals as signal
  where signal.id = requested_from_signal_id
  for update;
  if not found or not exists (
    select 1 from public.net_echo_signals as target
    where target.id = requested_to_signal_id
  ) then
    raise exception 'An ECHO link endpoint was not found.' using errcode = 'P0002';
  end if;

  if requested_desired_linked then
    insert into public.net_echo_signal_links as link (
      from_signal_id, to_signal_id, relationship_kind, label
    ) values (
      requested_from_signal_id, requested_to_signal_id,
      requested_relationship_kind, normalized_label
    )
    on conflict on constraint net_echo_signal_links_pkey do update
    set label = excluded.label
    where link.label is distinct from excluded.label;
    get diagnostics changed_rows = row_count;
  else
    if requested_relationship_kind = 'requires'
      and from_signal.status = 'revealed'
      and from_signal.visibility_mode = 'prerequisite'
      and exists (
        select 1 from public.net_echo_signal_links as link
        where link.from_signal_id = requested_from_signal_id
          and link.to_signal_id = requested_to_signal_id
          and link.relationship_kind = 'requires'
      )
      and (
        select count(*) from public.net_echo_signal_links as link
        where link.from_signal_id = requested_from_signal_id
          and link.relationship_kind = 'requires'
      ) <= 1
    then
      raise exception 'ECHO_PREREQUISITE_REQUIRED' using errcode = 'P0001';
    end if;

    delete from public.net_echo_signal_links as link
    where link.from_signal_id = requested_from_signal_id
      and link.to_signal_id = requested_to_signal_id
      and link.relationship_kind = requested_relationship_kind;
    get diagnostics changed_rows = row_count;
  end if;

  if changed_rows > 0 then
    perform public.audit_net_echo_gm_action(
      case when requested_desired_linked then 'echo.signal.link' else 'echo.signal.unlink' end,
      requested_from_signal_id
    );
  end if;
  return public.net_echo_gm_signal_payload(requested_from_signal_id);
end;
$$;

create or replace function public.fetch_net_echo_gm_grant_targets(
  requested_signal_id uuid,
  requested_limit integer default 200
)
returns table (
  account_id uuid,
  handle text,
  display_name text,
  avatar_url text,
  subject_kind text,
  subject_id uuid,
  granted boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  bounded_limit integer := least(greatest(coalesce(requested_limit, 200), 1), 200);
begin
  perform public.assert_net_echo_gm_editor();
  if requested_signal_id is null or not exists (
    select 1 from public.net_echo_signals as signal
    where signal.id = requested_signal_id
  ) then
    raise exception 'ECHO signal was not found.' using errcode = 'P0002';
  end if;

  return query
  select
    account.id,
    account.handle,
    coalesce(account.display_name_override, summary.display_name, account.handle),
    coalesce(account.avatar_url_override, summary.avatar_url),
    identity_link.subject_kind,
    identity_link.subject_id,
    grant_state.granted_at is not null
  from public.net_app_accounts as account
  join public.net_identity_links as identity_link
    on identity_link.id = account.identity_link_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable'
  left join public.net_gm_identity_directory_summaries as summary
    on summary.subject_kind = identity_link.subject_kind
    and summary.subject_id = identity_link.subject_id
  left join public.net_echo_account_signal_state as grant_state
    on grant_state.account_id = account.id
    and grant_state.signal_id = requested_signal_id
  where account.app_id = 'echo'
    and account.status = 'active'
  order by lower(coalesce(account.display_name_override, summary.display_name, account.handle)), account.id
  limit bounded_limit;
end;
$$;

create or replace function public.set_net_echo_gm_signal_grant(
  requested_signal_id uuid,
  requested_target_account_id uuid,
  requested_desired_granted boolean
)
returns table (
  signal_id uuid,
  account_id uuid,
  granted boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  selected_signal public.net_echo_signals%rowtype;
  existing_state public.net_echo_account_signal_state%rowtype;
  changed_rows integer := 0;
begin
  perform public.assert_net_echo_gm_editor();
  if requested_signal_id is null or requested_target_account_id is null
    or requested_desired_granted is null
  then
    raise exception 'An ECHO signal, target account, and grant state are required.'
      using errcode = '22023';
  end if;

  select signal.* into selected_signal
  from public.net_echo_signals as signal
  where signal.id = requested_signal_id
  for update;
  if not found then
    raise exception 'ECHO signal was not found.' using errcode = 'P0002';
  end if;
  if not exists (
    select 1
    from public.net_app_accounts as account
    join public.net_identity_links as identity_link
      on identity_link.id = account.identity_link_id
      and identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
    where account.id = requested_target_account_id
      and account.app_id = 'echo'
      and account.status = 'active'
  ) then
    raise exception 'The selected playable ECHO account is unavailable.' using errcode = '22023';
  end if;

  if requested_desired_granted then
    if selected_signal.visibility_mode <> 'granted' then
      raise exception 'ECHO grants require granted visibility mode.' using errcode = '22023';
    end if;
    insert into public.net_echo_account_signal_state as state (
      account_id, signal_id, granted_at
    ) values (
      requested_target_account_id, requested_signal_id, timezone('utc', now())
    )
    on conflict on constraint net_echo_account_signal_state_pkey do update
    set granted_at = excluded.granted_at
    where state.granted_at is null;
    get diagnostics changed_rows = row_count;
  else
    select state.* into existing_state
    from public.net_echo_account_signal_state as state
    where state.account_id = requested_target_account_id
      and state.signal_id = requested_signal_id
    for update;

    if found and existing_state.granted_at is not null then
      if existing_state.discovered_at is null and existing_state.saved_at is null then
        delete from public.net_echo_account_signal_state as state
        where state.account_id = requested_target_account_id
          and state.signal_id = requested_signal_id;
      else
        update public.net_echo_account_signal_state as state
        set granted_at = null
        where state.account_id = requested_target_account_id
          and state.signal_id = requested_signal_id;
      end if;
      changed_rows := 1;
    end if;
  end if;

  if changed_rows > 0 then
    perform public.audit_net_echo_gm_action(
      case when requested_desired_granted then 'echo.signal.grant' else 'echo.signal.revoke' end,
      requested_signal_id
    );
  end if;
  return query select requested_signal_id, requested_target_account_id, requested_desired_granted;
end;
$$;

revoke all on function public.assert_net_echo_gm_editor()
  from public, anon, authenticated;
revoke all on function public.assert_net_echo_gm_signal_input(
  text, text, text, text, text, text, text, text[], numeric, numeric,
  smallint, text, uuid, text, text, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.net_echo_gm_signal_payload(uuid)
  from public, anon, authenticated;
revoke all on function public.audit_net_echo_gm_action(text, uuid)
  from public, anon, authenticated;

revoke all on function public.fetch_net_echo_gm_signal_directory(integer)
  from public, anon, authenticated;
revoke all on function public.fetch_net_echo_gm_signal(uuid)
  from public, anon, authenticated;
revoke all on function public.create_net_echo_gm_signal(
  text, text, text, text, text, text, text, text[], numeric, numeric,
  smallint, text, uuid, text, text, text, timestamptz, text, text, text
) from public, anon, authenticated;
revoke all on function public.update_net_echo_gm_signal(
  uuid, text, text, text, text, text, text, text, text[], numeric, numeric,
  smallint, text, uuid, text, text, text, timestamptz, text, text, text
) from public, anon, authenticated;
revoke all on function public.set_net_echo_gm_signal_lifecycle(uuid, text)
  from public, anon, authenticated;
revoke all on function public.set_net_echo_gm_signal_link(uuid, uuid, text, text, boolean)
  from public, anon, authenticated;
revoke all on function public.fetch_net_echo_gm_grant_targets(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.set_net_echo_gm_signal_grant(uuid, uuid, boolean)
  from public, anon, authenticated;

grant execute on function public.fetch_net_echo_gm_signal_directory(integer)
  to authenticated;
grant execute on function public.fetch_net_echo_gm_signal(uuid)
  to authenticated;
grant execute on function public.create_net_echo_gm_signal(
  text, text, text, text, text, text, text, text[], numeric, numeric,
  smallint, text, uuid, text, text, text, timestamptz, text, text, text
) to authenticated;
grant execute on function public.update_net_echo_gm_signal(
  uuid, text, text, text, text, text, text, text, text[], numeric, numeric,
  smallint, text, uuid, text, text, text, timestamptz, text, text, text
) to authenticated;
grant execute on function public.set_net_echo_gm_signal_lifecycle(uuid, text)
  to authenticated;
grant execute on function public.set_net_echo_gm_signal_link(uuid, uuid, text, text, boolean)
  to authenticated;
grant execute on function public.fetch_net_echo_gm_grant_targets(uuid, integer)
  to authenticated;
grant execute on function public.set_net_echo_gm_signal_grant(uuid, uuid, boolean)
  to authenticated;

commit;
