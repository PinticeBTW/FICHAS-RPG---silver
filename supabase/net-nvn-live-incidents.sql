-- NVN Live Incidents V1: authoritative newsroom incident ledger.
-- Run after net-nvn-foundation.sql, net-nvn-gm-control.sql, and
-- net-nvn-realtime.sql. This migration creates no incidents or updates.

begin;

create table if not exists public.net_nvn_incidents (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'draft'
    check (status in ('draft', 'live', 'closed', 'archived')),
  headline text not null,
  summary text,
  category text not null
    check (category in (
      'new-vega',
      'world',
      'business',
      'technology',
      'culture',
      'opinion'
    )),
  verification_status text not null default 'developing'
    check (verification_status in (
      'developing',
      'verified',
      'multiple-sources',
      'official-statement',
      'unconfirmed'
    )),
  byline_name text not null,
  byline_role text,
  district_label text,
  location_label text,
  occurred_at timestamptz,
  created_by_profile_id uuid not null
    references public.profiles (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  started_at timestamptz,
  closed_at timestamptz,
  archived_at timestamptz,
  constraint net_nvn_incidents_headline_shape check (
    btrim(headline) <> '' and char_length(headline) <= 180
  ),
  constraint net_nvn_incidents_summary_shape check (
    summary is null
    or (btrim(summary) <> '' and char_length(summary) <= 600)
  ),
  constraint net_nvn_incidents_byline_name_shape check (
    btrim(byline_name) <> '' and char_length(byline_name) <= 100
  ),
  constraint net_nvn_incidents_byline_role_shape check (
    byline_role is null
    or (btrim(byline_role) <> '' and char_length(byline_role) <= 100)
  ),
  constraint net_nvn_incidents_district_label_shape check (
    district_label is null
    or (btrim(district_label) <> '' and char_length(district_label) <= 120)
  ),
  constraint net_nvn_incidents_location_label_shape check (
    location_label is null
    or (btrim(location_label) <> '' and char_length(location_label) <= 120)
  ),
  constraint net_nvn_incidents_lifecycle_shape check (
    (
      status = 'draft'
      and started_at is null
      and closed_at is null
      and archived_at is null
    )
    or (
      status = 'live'
      and started_at is not null
      and closed_at is null
      and archived_at is null
    )
    or (
      status = 'closed'
      and started_at is not null
      and closed_at is not null
      and closed_at >= started_at
      and archived_at is null
    )
    or (
      status = 'archived'
      and started_at is not null
      and closed_at is not null
      and closed_at >= started_at
      and archived_at is not null
      and archived_at >= closed_at
    )
  )
);

comment on table public.net_nvn_incidents is
  'GM-authored NVN live-desk records. Only a lifecycle-filtered bounded RPC exposes the active desk to authenticated readers.';
comment on column public.net_nvn_incidents.byline_name is
  'Presentation snapshot only; it is never mutation authority.';

create unique index if not exists net_nvn_incidents_one_live_idx
  on public.net_nvn_incidents ((true))
  where status = 'live';

create index if not exists net_nvn_incidents_gm_directory_idx
  on public.net_nvn_incidents (status, updated_at desc, id desc);

drop trigger if exists net_nvn_incidents_set_updated_at
  on public.net_nvn_incidents;
create trigger net_nvn_incidents_set_updated_at
before update on public.net_nvn_incidents
for each row execute procedure public.set_updated_at();

create table if not exists public.net_nvn_incident_updates (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null
    references public.net_nvn_incidents (id) on delete cascade,
  sequence integer not null check (sequence between 1 and 100),
  update_kind text not null default 'update'
    check (update_kind in ('update', 'confirmation', 'warning', 'correction')),
  verification_status text not null default 'developing'
    check (verification_status in ('confirmed', 'developing', 'unconfirmed')),
  body text not null,
  created_by_profile_id uuid not null
    references public.profiles (id) on delete restrict,
  published_at timestamptz not null default timezone('utc', now()),
  constraint net_nvn_incident_updates_body_shape check (
    btrim(body) <> '' and char_length(body) <= 1200
  ),
  constraint net_nvn_incident_updates_sequence_unique
    unique (incident_id, sequence)
);

comment on table public.net_nvn_incident_updates is
  'Append-only ordered NVN live-desk update ledger. Corrections are new rows; existing updates have no client mutation API.';

create index if not exists net_nvn_incident_updates_ledger_idx
  on public.net_nvn_incident_updates (incident_id, sequence);

-- Keep both revision classes in the one compact, metadata-free singleton.
alter table public.net_nvn_realtime_state
  add column if not exists live_revision bigint not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.net_nvn_realtime_state'::regclass
      and constraint_row.conname = 'net_nvn_realtime_state_live_revision_nonnegative'
  ) then
    alter table public.net_nvn_realtime_state
      add constraint net_nvn_realtime_state_live_revision_nonnegative
      check (live_revision >= 0);
  end if;
end $$;

insert into public.net_nvn_realtime_state (
  channel,
  article_revision,
  live_revision
) values (
  'public',
  0,
  0
)
on conflict (channel) do nothing;

-- UPDATE events include both old and new compact revisions so the client can
-- refresh only article or LIVE state without guessing from absolute counters.
alter table public.net_nvn_realtime_state replica identity full;

create or replace function public.assert_net_nvn_gm_incident_input(
  requested_headline text,
  requested_summary text,
  requested_category text,
  requested_verification_status text,
  requested_byline_name text,
  requested_byline_role text,
  requested_district_label text,
  requested_location_label text
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_summary text := nullif(btrim(requested_summary), '');
  v_byline_role text := nullif(btrim(requested_byline_role), '');
  v_district_label text := nullif(btrim(requested_district_label), '');
  v_location_label text := nullif(btrim(requested_location_label), '');
begin
  if octet_length(coalesce(requested_headline, '')) > 720
    or char_length(btrim(coalesce(requested_headline, ''))) not between 1 and 180
  then
    raise exception 'NVN_LIVE_HEADLINE_INVALID' using errcode = '22023';
  end if;
  if octet_length(coalesce(requested_summary, '')) > 2400
    or (v_summary is not null and char_length(v_summary) > 600)
  then
    raise exception 'NVN_LIVE_SUMMARY_INVALID' using errcode = '22023';
  end if;
  if lower(btrim(coalesce(requested_category, ''))) not in (
    'new-vega', 'world', 'business', 'technology', 'culture', 'opinion'
  ) then
    raise exception 'NVN_LIVE_CATEGORY_INVALID' using errcode = '22023';
  end if;
  if lower(btrim(coalesce(requested_verification_status, ''))) not in (
    'developing', 'verified', 'multiple-sources',
    'official-statement', 'unconfirmed'
  ) then
    raise exception 'NVN_LIVE_VERIFICATION_INVALID' using errcode = '22023';
  end if;
  if octet_length(coalesce(requested_byline_name, '')) > 400
    or char_length(btrim(coalesce(requested_byline_name, ''))) not between 1 and 100
  then
    raise exception 'NVN_LIVE_BYLINE_INVALID' using errcode = '22023';
  end if;
  if octet_length(coalesce(requested_byline_role, '')) > 400
    or (v_byline_role is not null and char_length(v_byline_role) > 100)
  then
    raise exception 'NVN_LIVE_BYLINE_ROLE_INVALID' using errcode = '22023';
  end if;
  if octet_length(coalesce(requested_district_label, '')) > 480
    or (v_district_label is not null and char_length(v_district_label) > 120)
  then
    raise exception 'NVN_LIVE_DISTRICT_INVALID' using errcode = '22023';
  end if;
  if octet_length(coalesce(requested_location_label, '')) > 480
    or (v_location_label is not null and char_length(v_location_label) > 120)
  then
    raise exception 'NVN_LIVE_LOCATION_INVALID' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.net_nvn_gm_incident_payload(
  requested_incident_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', incident.id,
    'status', incident.status,
    'headline', incident.headline,
    'summary', incident.summary,
    'category', incident.category,
    'verification_status', incident.verification_status,
    'byline_name', incident.byline_name,
    'byline_role', incident.byline_role,
    'district_label', incident.district_label,
    'location_label', incident.location_label,
    'occurred_at', incident.occurred_at,
    'created_at', incident.created_at,
    'updated_at', incident.updated_at,
    'started_at', incident.started_at,
    'closed_at', incident.closed_at,
    'archived_at', incident.archived_at,
    'updates', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', incident_update.id,
          'sequence', incident_update.sequence,
          'update_kind', incident_update.update_kind,
          'verification_status', incident_update.verification_status,
          'body', incident_update.body,
          'published_at', incident_update.published_at
        ) order by incident_update.sequence
      )
      from public.net_nvn_incident_updates as incident_update
      where incident_update.incident_id = incident.id
    ), '[]'::jsonb)
  )
  from public.net_nvn_incidents as incident
  where incident.id = requested_incident_id;
$$;

create or replace function public.audit_net_nvn_gm_incident_action(
  requested_action_type text,
  requested_incident_id uuid
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
  if requested_action_type is null
    or btrim(requested_action_type) = ''
    or requested_incident_id is null
  then
    raise exception 'NVN live audit context is invalid.' using errcode = '22023';
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
    'nvn-incident',
    requested_incident_id
  );
end;
$$;

create or replace function public.fetch_net_nvn_live_desk()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_incident_id uuid;
  v_incident jsonb;
  v_updates jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select incident.id
  into v_incident_id
  from public.net_nvn_incidents as incident
  where incident.status = 'live'
  order by incident.started_at desc, incident.id desc
  limit 1;

  if v_incident_id is null then
    return jsonb_build_object('incident', null, 'updates', '[]'::jsonb);
  end if;

  select jsonb_build_object(
    'id', incident.id,
    'headline', incident.headline,
    'summary', incident.summary,
    'category', incident.category,
    'verification_status', incident.verification_status,
    'byline_name', incident.byline_name,
    'byline_role', incident.byline_role,
    'district_label', incident.district_label,
    'location_label', incident.location_label,
    'occurred_at', incident.occurred_at,
    'started_at', incident.started_at,
    'updated_at', incident.updated_at
  )
  into v_incident
  from public.net_nvn_incidents as incident
  where incident.id = v_incident_id
    and incident.status = 'live';

  if v_incident is null then
    return jsonb_build_object('incident', null, 'updates', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', incident_update.id,
      'sequence', incident_update.sequence,
      'update_kind', incident_update.update_kind,
      'verification_status', incident_update.verification_status,
      'body', incident_update.body,
      'published_at', incident_update.published_at
    ) order by incident_update.sequence
  ), '[]'::jsonb)
  into v_updates
  from public.net_nvn_incident_updates as incident_update
  where incident_update.incident_id = v_incident_id
    and incident_update.sequence between 1 and 100;

  return jsonb_build_object('incident', v_incident, 'updates', v_updates);
end;
$$;

create or replace function public.fetch_net_nvn_gm_incident_directory(
  requested_status text default null,
  requested_limit integer default 100
)
returns table (
  id uuid,
  status text,
  headline text,
  category text,
  verification_status text,
  byline_name text,
  updated_at timestamptz,
  started_at timestamptz,
  closed_at timestamptz,
  archived_at timestamptz,
  update_count integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text := lower(btrim(coalesce(requested_status, 'all')));
  v_limit integer := least(greatest(coalesce(requested_limit, 100), 1), 100);
begin
  perform public.assert_net_nvn_gm_editor();
  if v_status not in ('all', 'draft', 'live', 'closed', 'archived') then
    raise exception 'NVN_LIVE_STATUS_INVALID' using errcode = '22023';
  end if;

  return query
  select
    incident.id,
    incident.status,
    incident.headline,
    incident.category,
    incident.verification_status,
    incident.byline_name,
    incident.updated_at,
    incident.started_at,
    incident.closed_at,
    incident.archived_at,
    (
      select count(*)::integer
      from public.net_nvn_incident_updates as incident_update
      where incident_update.incident_id = incident.id
    ) as update_count
  from public.net_nvn_incidents as incident
  where v_status = 'all' or incident.status = v_status
  order by incident.updated_at desc, incident.id desc
  limit v_limit;
end;
$$;

create or replace function public.fetch_net_nvn_gm_incident(
  requested_incident_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_payload jsonb;
begin
  perform public.assert_net_nvn_gm_editor();
  if requested_incident_id is null then
    raise exception 'NVN_LIVE_INCIDENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_payload := public.net_nvn_gm_incident_payload(requested_incident_id);
  if v_payload is null then
    raise exception 'NVN_LIVE_INCIDENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  return v_payload;
end;
$$;

create or replace function public.create_net_nvn_gm_incident(
  requested_headline text,
  requested_summary text,
  requested_category text,
  requested_verification_status text,
  requested_byline_name text,
  requested_byline_role text,
  requested_district_label text,
  requested_location_label text,
  requested_occurred_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_profile_id uuid;
  v_incident_id uuid;
begin
  v_actor_profile_id := public.assert_net_nvn_gm_editor();
  perform public.assert_net_nvn_gm_incident_input(
    requested_headline,
    requested_summary,
    requested_category,
    requested_verification_status,
    requested_byline_name,
    requested_byline_role,
    requested_district_label,
    requested_location_label
  );

  insert into public.net_nvn_incidents (
    status,
    headline,
    summary,
    category,
    verification_status,
    byline_name,
    byline_role,
    district_label,
    location_label,
    occurred_at,
    created_by_profile_id,
    started_at,
    closed_at,
    archived_at
  ) values (
    'draft',
    btrim(requested_headline),
    nullif(btrim(requested_summary), ''),
    lower(btrim(requested_category)),
    lower(btrim(requested_verification_status)),
    btrim(requested_byline_name),
    nullif(btrim(requested_byline_role), ''),
    nullif(btrim(requested_district_label), ''),
    nullif(btrim(requested_location_label), ''),
    requested_occurred_at,
    v_actor_profile_id,
    null,
    null,
    null
  ) returning id into v_incident_id;

  perform public.audit_net_nvn_gm_incident_action(
    'nvn.incident.create',
    v_incident_id
  );
  return public.net_nvn_gm_incident_payload(v_incident_id);
end;
$$;

create or replace function public.update_net_nvn_gm_incident(
  requested_incident_id uuid,
  requested_headline text,
  requested_summary text,
  requested_category text,
  requested_verification_status text,
  requested_byline_name text,
  requested_byline_role text,
  requested_district_label text,
  requested_location_label text,
  requested_occurred_at timestamptz
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
  if requested_incident_id is null then
    raise exception 'NVN_LIVE_INCIDENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_net_nvn_gm_incident_input(
    requested_headline,
    requested_summary,
    requested_category,
    requested_verification_status,
    requested_byline_name,
    requested_byline_role,
    requested_district_label,
    requested_location_label
  );

  update public.net_nvn_incidents as incident
  set
    headline = btrim(requested_headline),
    summary = nullif(btrim(requested_summary), ''),
    category = lower(btrim(requested_category)),
    verification_status = lower(btrim(requested_verification_status)),
    byline_name = btrim(requested_byline_name),
    byline_role = nullif(btrim(requested_byline_role), ''),
    district_label = nullif(btrim(requested_district_label), ''),
    location_label = nullif(btrim(requested_location_label), ''),
    occurred_at = requested_occurred_at
  where incident.id = requested_incident_id
    and row(
      incident.headline,
      incident.summary,
      incident.category,
      incident.verification_status,
      incident.byline_name,
      incident.byline_role,
      incident.district_label,
      incident.location_label,
      incident.occurred_at
    ) is distinct from row(
      btrim(requested_headline),
      nullif(btrim(requested_summary), ''),
      lower(btrim(requested_category)),
      lower(btrim(requested_verification_status)),
      btrim(requested_byline_name),
      nullif(btrim(requested_byline_role), ''),
      nullif(btrim(requested_district_label), ''),
      nullif(btrim(requested_location_label), ''),
      requested_occurred_at
    );
  get diagnostics v_changed_rows = row_count;

  if not exists (
    select 1
    from public.net_nvn_incidents as incident
    where incident.id = requested_incident_id
  ) then
    raise exception 'NVN_LIVE_INCIDENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_changed_rows > 0 then
    perform public.audit_net_nvn_gm_incident_action(
      'nvn.incident.update',
      requested_incident_id
    );
  end if;
  return public.net_nvn_gm_incident_payload(requested_incident_id);
end;
$$;

create or replace function public.set_net_nvn_gm_incident_lifecycle(
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
  v_current_incident public.net_nvn_incidents%rowtype;
  v_action text := lower(btrim(coalesce(requested_action, '')));
begin
  perform public.assert_net_nvn_gm_editor();
  if requested_incident_id is null then
    raise exception 'NVN_LIVE_INCIDENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_action not in ('start', 'close', 'archive', 'restore') then
    raise exception 'NVN_LIVE_LIFECYCLE_INVALID' using errcode = 'P0001';
  end if;

  select incident.*
  into v_current_incident
  from public.net_nvn_incidents as incident
  where incident.id = requested_incident_id
  for update;

  if not found then
    raise exception 'NVN_LIVE_INCIDENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if (v_action = 'start' and v_current_incident.status <> 'draft')
    or (v_action = 'close' and v_current_incident.status <> 'live')
    or (v_action = 'archive' and v_current_incident.status <> 'closed')
    or (v_action = 'restore' and v_current_incident.status <> 'archived')
  then
    raise exception 'NVN_LIVE_LIFECYCLE_INVALID' using errcode = 'P0001';
  end if;

  begin
    update public.net_nvn_incidents as incident
    set
      status = case v_action
        when 'start' then 'live'
        when 'close' then 'closed'
        when 'archive' then 'archived'
        when 'restore' then 'closed'
      end,
      started_at = case v_action
        when 'start' then timezone('utc', now())
        else incident.started_at
      end,
      closed_at = case v_action
        when 'close' then timezone('utc', now())
        else incident.closed_at
      end,
      archived_at = case v_action
        when 'archive' then timezone('utc', now())
        when 'restore' then null
        else incident.archived_at
      end
    where incident.id = requested_incident_id;
  exception
    when unique_violation then
      raise exception 'NVN_LIVE_DESK_BUSY' using errcode = 'P0001';
  end;

  perform public.audit_net_nvn_gm_incident_action(
    case v_action
      when 'start' then 'nvn.incident.start'
      when 'close' then 'nvn.incident.close'
      when 'archive' then 'nvn.incident.archive'
      when 'restore' then 'nvn.incident.restore'
    end,
    requested_incident_id
  );
  return public.net_nvn_gm_incident_payload(requested_incident_id);
end;
$$;

create or replace function public.append_net_nvn_gm_incident_update(
  requested_incident_id uuid,
  requested_update_kind text,
  requested_verification_status text,
  requested_body text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_profile_id uuid;
  v_incident_status text;
  v_next_sequence integer;
begin
  v_actor_profile_id := public.assert_net_nvn_gm_editor();
  if requested_incident_id is null then
    raise exception 'NVN_LIVE_INCIDENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if lower(btrim(coalesce(requested_update_kind, ''))) not in (
    'update', 'confirmation', 'warning', 'correction'
  ) then
    raise exception 'NVN_LIVE_UPDATE_KIND_INVALID' using errcode = '22023';
  end if;
  if lower(btrim(coalesce(requested_verification_status, ''))) not in (
    'confirmed', 'developing', 'unconfirmed'
  ) then
    raise exception 'NVN_LIVE_UPDATE_VERIFICATION_INVALID' using errcode = '22023';
  end if;
  if octet_length(coalesce(requested_body, '')) > 4800
    or char_length(btrim(coalesce(requested_body, ''))) not between 1 and 1200
  then
    raise exception 'NVN_LIVE_UPDATE_BODY_INVALID' using errcode = '22023';
  end if;

  select incident.status
  into v_incident_status
  from public.net_nvn_incidents as incident
  where incident.id = requested_incident_id
  for update;

  if not found then
    raise exception 'NVN_LIVE_INCIDENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_incident_status <> 'live' then
    raise exception 'NVN_LIVE_LIFECYCLE_INVALID' using errcode = 'P0001';
  end if;

  select coalesce(max(incident_update.sequence), 0) + 1
  into v_next_sequence
  from public.net_nvn_incident_updates as incident_update
  where incident_update.incident_id = requested_incident_id;

  if v_next_sequence > 100 then
    raise exception 'NVN_LIVE_UPDATE_LIMIT_REACHED' using errcode = 'P0001';
  end if;

  insert into public.net_nvn_incident_updates (
    incident_id,
    sequence,
    update_kind,
    verification_status,
    body,
    created_by_profile_id,
    published_at
  ) values (
    requested_incident_id,
    v_next_sequence,
    lower(btrim(requested_update_kind)),
    lower(btrim(requested_verification_status)),
    btrim(requested_body),
    v_actor_profile_id,
    timezone('utc', now())
  );

  perform public.audit_net_nvn_gm_incident_action(
    'nvn.incident.update.append',
    requested_incident_id
  );
  return public.net_nvn_gm_incident_payload(requested_incident_id);
end;
$$;

create or replace function public.signal_net_nvn_live_change()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'net_nvn_incidents' then
    if tg_op = 'UPDATE'
      and row(
        new.status,
        new.headline,
        new.summary,
        new.category,
        new.verification_status,
        new.byline_name,
        new.byline_role,
        new.district_label,
        new.location_label,
        new.occurred_at,
        new.started_at,
        new.closed_at,
        new.archived_at
      ) is not distinct from row(
        old.status,
        old.headline,
        old.summary,
        old.category,
        old.verification_status,
        old.byline_name,
        old.byline_role,
        old.district_label,
        old.location_label,
        old.occurred_at,
        old.started_at,
        old.closed_at,
        old.archived_at
      )
    then
      return null;
    end if;
  end if;

  insert into public.net_nvn_realtime_state (
    channel,
    article_revision,
    live_revision,
    updated_at
  ) values (
    'public',
    0,
    1,
    timezone('utc', now())
  )
  on conflict (channel) do update set
    live_revision = public.net_nvn_realtime_state.live_revision + 1,
    updated_at = excluded.updated_at;

  return null;
end;
$$;

drop trigger if exists net_nvn_incidents_signal_realtime
  on public.net_nvn_incidents;
create trigger net_nvn_incidents_signal_realtime
after insert or update on public.net_nvn_incidents
for each row execute procedure public.signal_net_nvn_live_change();

drop trigger if exists net_nvn_incident_updates_signal_realtime
  on public.net_nvn_incident_updates;
create trigger net_nvn_incident_updates_signal_realtime
after insert on public.net_nvn_incident_updates
for each row execute procedure public.signal_net_nvn_live_change();

alter table public.net_nvn_incidents enable row level security;
alter table public.net_nvn_incident_updates enable row level security;

revoke all on table public.net_nvn_incidents
  from public, anon, authenticated;
revoke all on table public.net_nvn_incident_updates
  from public, anon, authenticated;

revoke all on function public.assert_net_nvn_gm_incident_input(
  text, text, text, text, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.net_nvn_gm_incident_payload(uuid)
  from public, anon, authenticated;
revoke all on function public.audit_net_nvn_gm_incident_action(text, uuid)
  from public, anon, authenticated;
revoke all on function public.signal_net_nvn_live_change()
  from public, anon, authenticated;

revoke all on function public.fetch_net_nvn_live_desk()
  from public, anon, authenticated;
revoke all on function public.fetch_net_nvn_gm_incident_directory(text, integer)
  from public, anon, authenticated;
revoke all on function public.fetch_net_nvn_gm_incident(uuid)
  from public, anon, authenticated;
revoke all on function public.create_net_nvn_gm_incident(
  text, text, text, text, text, text, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.update_net_nvn_gm_incident(
  uuid, text, text, text, text, text, text, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.set_net_nvn_gm_incident_lifecycle(uuid, text)
  from public, anon, authenticated;
revoke all on function public.append_net_nvn_gm_incident_update(
  uuid, text, text, text
) from public, anon, authenticated;

grant execute on function public.fetch_net_nvn_live_desk()
  to authenticated;
grant execute on function public.fetch_net_nvn_gm_incident_directory(text, integer)
  to authenticated;
grant execute on function public.fetch_net_nvn_gm_incident(uuid)
  to authenticated;
grant execute on function public.create_net_nvn_gm_incident(
  text, text, text, text, text, text, text, text, timestamptz
) to authenticated;
grant execute on function public.update_net_nvn_gm_incident(
  uuid, text, text, text, text, text, text, text, text, timestamptz
) to authenticated;
grant execute on function public.set_net_nvn_gm_incident_lifecycle(uuid, text)
  to authenticated;
grant execute on function public.append_net_nvn_gm_incident_update(
  uuid, text, text, text
) to authenticated;

-- NVN row tables never carry Realtime payloads. The existing singleton remains
-- the only NVN publication member.
do $$
declare
  v_table_name text;
begin
  foreach v_table_name in array array[
    'net_nvn_articles',
    'net_nvn_article_media',
    'net_nvn_incidents',
    'net_nvn_incident_updates'
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
