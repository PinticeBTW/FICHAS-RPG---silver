-- ECHO 1A: server data, identity, and security foundation.
-- Run after net-identity-selection.sql, net-universal-profiles.sql,
-- and net-app-accounts.sql.
--
-- This migration is intentionally empty of world content. It creates no
-- signals, grants, discoveries, or saves.

begin;

create extension if not exists pgcrypto;

create table if not exists public.net_echo_signals (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'fragment'
    check (kind in (
      'fragment',
      'transmission',
      'rumor',
      'incident',
      'location-trace',
      'leaked-record',
      'memory-fragment',
      'identity-clue',
      'faction-activity',
      'dead',
      'corrupted',
      'encrypted'
    )),
  status text not null default 'draft'
    check (status in ('draft', 'revealed', 'archived')),
  visibility_mode text not null default 'global'
    check (visibility_mode in ('global', 'granted', 'prerequisite')),
  title text not null,
  summary text,
  body text not null,
  reliability text not null default 'unknown'
    check (reliability in (
      'unknown',
      'unverified',
      'contested',
      'corroborated',
      'verified',
      'compromised'
    )),
  intensity text not null default 'low'
    check (intensity in ('low', 'medium', 'high', 'critical')),
  frequencies text[] not null default '{}'::text[],
  map_x numeric(5, 2) not null,
  map_y numeric(5, 2) not null,
  integrity_percent smallint,
  locked_teaser text,
  source_account_id uuid references public.net_app_accounts (id) on delete set null,
  source_label text,
  location_label text,
  district_label text,
  occurred_at timestamptz,
  primary_reference_app_id text,
  primary_reference_resource_kind text,
  primary_reference_resource_id text,
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  revealed_at timestamptz,
  constraint net_echo_signals_title_shape check (
    btrim(title) <> '' and char_length(title) <= 120
  ),
  constraint net_echo_signals_summary_limit check (
    summary is null or (btrim(summary) <> '' and char_length(summary) <= 280)
  ),
  constraint net_echo_signals_body_shape check (
    btrim(body) <> '' and char_length(body) <= 4000
  ),
  constraint net_echo_signals_frequencies_shape check (
    cardinality(frequencies) <= 10
    and array_position(frequencies, null) is null
    and array_position(frequencies, '') is null
    and octet_length(array_to_string(frequencies, '')) <= 320
  ),
  constraint net_echo_signals_map_x_range check (map_x between 0 and 100),
  constraint net_echo_signals_map_y_range check (map_y between 0 and 100),
  constraint net_echo_signals_integrity_range check (
    integrity_percent is null or integrity_percent between 0 and 100
  ),
  constraint net_echo_signals_locked_teaser_limit check (
    locked_teaser is null or (
      visibility_mode = 'prerequisite'
      and btrim(locked_teaser) <> ''
      and char_length(locked_teaser) <= 160
    )
  ),
  constraint net_echo_signals_source_label_limit check (
    source_label is null or (btrim(source_label) <> '' and char_length(source_label) <= 120)
  ),
  constraint net_echo_signals_location_label_limit check (
    location_label is null or (btrim(location_label) <> '' and char_length(location_label) <= 120)
  ),
  constraint net_echo_signals_district_label_limit check (
    district_label is null or (btrim(district_label) <> '' and char_length(district_label) <= 80)
  ),
  constraint net_echo_signals_reference_shape check (
    num_nonnulls(
      primary_reference_app_id,
      primary_reference_resource_kind,
      primary_reference_resource_id
    ) in (0, 3)
    and (
      primary_reference_app_id is null
      or (
        char_length(primary_reference_app_id) between 1 and 32
        and primary_reference_app_id ~ '^[a-z0-9][a-z0-9-]*$'
        and char_length(primary_reference_resource_kind) between 1 and 40
        and primary_reference_resource_kind ~ '^[a-z0-9][a-z0-9-]*$'
        and char_length(primary_reference_resource_id) between 1 and 160
        and btrim(primary_reference_resource_id) = primary_reference_resource_id
      )
    )
  ),
  constraint net_echo_signals_reveal_shape check (
    (status = 'draft' and revealed_at is null)
    or (status = 'revealed' and revealed_at is not null)
    or status = 'archived'
  )
);

comment on table public.net_echo_signals is
  'GM-curated ECHO intelligence. Clients use bounded visibility-filtered RPCs; direct table reads are not a product API.';
comment on column public.net_echo_signals.locked_teaser is
  'Optional GM-authored text intentionally safe to expose before a prerequisite signal unlocks. It never grants detail access.';
comment on column public.net_echo_signals.source_account_id is
  'Optional presentation source. It is not writer, owner, visibility, or authorization authority.';
comment on column public.net_echo_signals.primary_reference_resource_id is
  'Optional stable cross-app reference. References are descriptive and never authorization authority.';

create table if not exists public.net_echo_signal_links (
  from_signal_id uuid not null references public.net_echo_signals (id) on delete cascade,
  to_signal_id uuid not null references public.net_echo_signals (id) on delete cascade,
  relationship_kind text not null
    check (relationship_kind in ('related', 'supports', 'contradicts', 'origin', 'requires')),
  label text,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (from_signal_id, to_signal_id, relationship_kind),
  constraint net_echo_signal_links_not_self check (from_signal_id <> to_signal_id),
  constraint net_echo_signal_links_label_limit check (
    label is null or (btrim(label) <> '' and char_length(label) <= 80)
  )
);

comment on table public.net_echo_signal_links is
  'Directed ECHO graph edges. For requires, from_signal_id is the locked target and to_signal_id is the prerequisite that must already be discovered.';

create table if not exists public.net_echo_account_signal_state (
  account_id uuid not null references public.net_app_accounts (id) on delete cascade,
  signal_id uuid not null references public.net_echo_signals (id) on delete cascade,
  granted_at timestamptz,
  discovered_at timestamptz,
  saved_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (account_id, signal_id),
  constraint net_echo_account_signal_state_not_empty check (
    num_nonnulls(granted_at, discovered_at, saved_at) > 0
  )
);

comment on table public.net_echo_account_signal_state is
  'Private ECHO-account discovery, grant, and save state. Player RPCs derive account_id from the active identity.';

create index if not exists net_echo_signals_revealed_map_idx
  on public.net_echo_signals (revealed_at desc, id desc)
  where status = 'revealed';

create index if not exists net_echo_signal_links_reverse_idx
  on public.net_echo_signal_links (to_signal_id, relationship_kind, from_signal_id);

create index if not exists net_echo_account_signal_state_saved_idx
  on public.net_echo_account_signal_state (account_id, saved_at desc, signal_id)
  where saved_at is not null;

drop trigger if exists net_echo_signals_set_updated_at on public.net_echo_signals;
create trigger net_echo_signals_set_updated_at
before update on public.net_echo_signals
for each row execute procedure public.set_updated_at();

drop trigger if exists net_echo_account_signal_state_set_updated_at
  on public.net_echo_account_signal_state;
create trigger net_echo_account_signal_state_set_updated_at
before update on public.net_echo_account_signal_state
for each row execute procedure public.set_updated_at();

-- Comparison-only active identity assertion used by provisioning and by the
-- net_app_accounts insert invariant. The active row lock serializes a
-- cross-tab identity switch with the surrounding transaction.
create or replace function public.assert_net_echo_active_identity_context(
  requested_expected_identity_link_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  authenticated_actor_id uuid := auth.uid();
  actual_identity_link_id uuid;
begin
  if authenticated_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select identity_link.id
  into actual_identity_link_id
  from public.net_active_identities as active_identity
  join public.net_identity_links as identity_link
    on identity_link.id = active_identity.identity_link_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable'
  where active_identity.profile_id = authenticated_actor_id
    and public.current_user_controls_playable_net_identity_link(identity_link.id)
  for share of active_identity;

  if requested_expected_identity_link_id is null
    or requested_expected_identity_link_id is distinct from actual_identity_link_id
  then
    raise exception 'ECHO_ACCOUNT_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;

  return actual_identity_link_id;
end;
$$;

-- Comparison-only active account assertion for every player read/write RPC.
-- Canonical entity accounts may be public sources, but private player state
-- always belongs to a directly identity-linked ECHO account.
create or replace function public.assert_net_echo_account_context(
  requested_expected_account_id uuid,
  requested_require_account boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  authenticated_actor_id uuid := auth.uid();
  actual_account_id uuid;
begin
  if authenticated_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select echo_account.id
  into actual_account_id
  from public.net_active_identities as active_identity
  join public.net_identity_links as identity_link
    on identity_link.id = active_identity.identity_link_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable'
  join public.net_app_accounts as echo_account
    on echo_account.identity_link_id = identity_link.id
    and echo_account.app_id = 'echo'
    and echo_account.status = 'active'
  where active_identity.profile_id = authenticated_actor_id
    and public.current_user_controls_playable_net_identity_link(identity_link.id)
  for share of active_identity;

  if requested_expected_account_id is distinct from actual_account_id then
    raise exception 'ECHO_ACCOUNT_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;
  if coalesce(requested_require_account, true) and actual_account_id is null then
    raise exception 'An active, controlled ECHO account is required.' using errcode = '42501';
  end if;

  return actual_account_id;
end;
$$;

-- Defense in depth for both the dedicated ECHO provisioner and the existing
-- generic explicit-account RPC. Client-selected identity_link_id never grants
-- authority: for ECHO it must equal the locked server-active identity.
create or replace function public.validate_net_echo_account_active_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.app_id = 'echo' and auth.uid() is not null then
    if new.identity_link_id is null then
      raise exception 'ECHO player accounts require an active playable identity.'
        using errcode = '42501';
    end if;
    perform public.assert_net_echo_active_identity_context(new.identity_link_id);
  end if;
  return new;
end;
$$;

drop trigger if exists net_app_accounts_validate_echo_active_identity
  on public.net_app_accounts;
create trigger net_app_accounts_validate_echo_active_identity
before insert on public.net_app_accounts
for each row execute procedure public.validate_net_echo_account_active_identity();

-- State is intentionally limited to identity-owned ECHO accounts. Canonical
-- entity/service accounts can be signal sources but cannot share private
-- player discoveries or saves.
create or replace function public.validate_net_echo_account_signal_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.net_app_accounts as account
    where account.id = new.account_id
      and account.app_id = 'echo'
      and account.identity_link_id is not null
  ) then
    raise exception 'ECHO state requires an identity-owned ECHO account.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists net_echo_account_signal_state_validate_account
  on public.net_echo_account_signal_state;
create trigger net_echo_account_signal_state_validate_account
before insert or update of account_id on public.net_echo_account_signal_state
for each row execute procedure public.validate_net_echo_account_signal_state();

-- Dedicated ECHO provisioning. The supplied identity UUID is an assertion;
-- only the server-derived active identity is used as the inserted owner.
create or replace function public.create_net_echo_account(
  requested_expected_identity_link_id uuid,
  requested_handle text
)
returns table (
  account_id uuid,
  handle text,
  status text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actual_identity_link_id uuid;
  normalized_handle text := public.normalize_net_app_handle(requested_handle);
  existing_account public.net_app_accounts%rowtype;
  saved_account public.net_app_accounts%rowtype;
  echo_policy public.net_app_account_policies%rowtype;
begin
  actual_identity_link_id := public.assert_net_echo_active_identity_context(
    requested_expected_identity_link_id
  );

  if normalized_handle is null then
    raise exception 'ECHO handle is invalid.' using errcode = '22023';
  end if;

  select policy.*
  into echo_policy
  from public.net_app_account_policies as policy
  where policy.app_id = 'echo'
  for share;

  if not found
    or echo_policy.account_mode <> 'explicit'
    or not echo_policy.account_available
  then
    raise exception 'ECHO account provisioning is unavailable.' using errcode = '22023';
  end if;

  select account.*
  into existing_account
  from public.net_app_accounts as account
  where account.app_id = 'echo'
    and account.identity_link_id = actual_identity_link_id
  for update;

  if found then
    return query select
      existing_account.id,
      existing_account.handle,
      existing_account.status,
      existing_account.created_at,
      existing_account.updated_at;
    return;
  end if;

  begin
    insert into public.net_app_accounts (
      app_id,
      identity_link_id,
      handle,
      status
    ) values (
      'echo',
      actual_identity_link_id,
      normalized_handle,
      'active'
    )
    returning * into saved_account;
  exception
    when unique_violation then
      select account.*
      into existing_account
      from public.net_app_accounts as account
      where account.app_id = 'echo'
        and account.identity_link_id = actual_identity_link_id;

      if found then
        return query select
          existing_account.id,
          existing_account.handle,
          existing_account.status,
          existing_account.created_at,
          existing_account.updated_at;
        return;
      end if;

      raise exception 'That ECHO handle is already registered.' using errcode = '23505';
  end;

  return query select
    saved_account.id,
    saved_account.handle,
    saved_account.status,
    saved_account.created_at,
    saved_account.updated_at;
end;
$$;

-- Internal visibility helper. Prerequisites are deliberately one direct
-- level: the target's complete set of requires edges must already be marked
-- discovered for the active account. No recursive graph traversal occurs.
create or replace function public.net_echo_signal_is_fully_visible(
  requested_signal_id uuid,
  requested_account_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.net_echo_signals as signal
    where signal.id = requested_signal_id
      and signal.status = 'revealed'
      and (
        signal.visibility_mode = 'global'
        or (
          signal.visibility_mode = 'granted'
          and exists (
            select 1
            from public.net_echo_account_signal_state as own_state
            where own_state.account_id = requested_account_id
              and own_state.signal_id = signal.id
              and own_state.granted_at is not null
          )
        )
        or (
          signal.visibility_mode = 'prerequisite'
          and exists (
            select 1
            from public.net_echo_signal_links as requirement
            where requirement.from_signal_id = signal.id
              and requirement.relationship_kind = 'requires'
          )
          and not exists (
            select 1
            from public.net_echo_signal_links as requirement
            left join public.net_echo_account_signal_state as prerequisite_state
              on prerequisite_state.account_id = requested_account_id
              and prerequisite_state.signal_id = requirement.to_signal_id
              and prerequisite_state.discovered_at is not null
            where requirement.from_signal_id = signal.id
              and requirement.relationship_kind = 'requires'
              and prerequisite_state.signal_id is null
          )
        )
      )
  );
$$;

-- One bounded request supplies compact map nodes and safe edges. Full bodies,
-- source metadata, primary references, and hidden topology are excluded.
create or replace function public.fetch_net_echo_map(
  requested_expected_account_id uuid,
  requested_node_limit integer default 100,
  requested_edge_limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  viewer_account_id uuid;
  node_limit integer := least(greatest(coalesce(requested_node_limit, 100), 1), 100);
  edge_limit integer := least(greatest(coalesce(requested_edge_limit, 200), 1), 200);
  graph_payload jsonb;
begin
  viewer_account_id := public.assert_net_echo_account_context(
    requested_expected_account_id,
    true
  );

  with requirement_counts as materialized (
    select
      requirement.from_signal_id as signal_id,
      count(*)::integer as requirement_count,
      count(prerequisite_state.signal_id)::integer as discovered_requirement_count
    from public.net_echo_signal_links as requirement
    join public.net_echo_signals as target_signal
      on target_signal.id = requirement.from_signal_id
      and target_signal.status = 'revealed'
    left join public.net_echo_account_signal_state as prerequisite_state
      on prerequisite_state.account_id = viewer_account_id
      and prerequisite_state.signal_id = requirement.to_signal_id
      and prerequisite_state.discovered_at is not null
    where requirement.relationship_kind = 'requires'
    group by requirement.from_signal_id
  ),
  access_rows as materialized (
    select
      signal.*,
      own_state.discovered_at as viewer_discovered_at,
      own_state.saved_at as viewer_saved_at,
      case
        when signal.visibility_mode = 'global' then true
        when signal.visibility_mode = 'granted' then own_state.granted_at is not null
        when signal.visibility_mode = 'prerequisite' then
          coalesce(requirements.requirement_count, 0) > 0
          and requirements.requirement_count = requirements.discovered_requirement_count
        else false
      end as fully_visible
    from public.net_echo_signals as signal
    left join public.net_echo_account_signal_state as own_state
      on own_state.account_id = viewer_account_id
      and own_state.signal_id = signal.id
    left join requirement_counts as requirements
      on requirements.signal_id = signal.id
    where signal.status = 'revealed'
  ),
  represented_nodes as materialized (
    select access_row.*
    from access_rows as access_row
    where access_row.fully_visible
      or (
        access_row.visibility_mode = 'prerequisite'
        and access_row.locked_teaser is not null
      )
    order by access_row.revealed_at desc, access_row.id desc
    limit node_limit
  ),
  bounded_edges as materialized (
    select edge.*
    from public.net_echo_signal_links as edge
    join represented_nodes as from_node
      on from_node.id = edge.from_signal_id
      and from_node.fully_visible
    join represented_nodes as to_node
      on to_node.id = edge.to_signal_id
      and to_node.fully_visible
    order by edge.from_signal_id, edge.to_signal_id, edge.relationship_kind
    limit edge_limit
  )
  select jsonb_build_object(
    'nodes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', node.id,
          'access_state', case when node.fully_visible then 'visible' else 'locked' end,
          'map_x', node.map_x,
          'map_y', node.map_y,
          'title', case when node.fully_visible then node.title else null end,
          'locked_teaser', case when node.fully_visible then null else node.locked_teaser end,
          'kind', case when node.fully_visible then node.kind else 'encrypted' end,
          'intensity', case when node.fully_visible then node.intensity else null end,
          'frequencies', case when node.fully_visible then to_jsonb(node.frequencies) else '[]'::jsonb end,
          'reliability', case when node.fully_visible then node.reliability else null end,
          'district_label', case when node.fully_visible then node.district_label else null end,
          'viewer_discovered', node.fully_visible and node.viewer_discovered_at is not null,
          'viewer_saved', node.fully_visible and node.viewer_saved_at is not null,
          'revealed_at', case when node.fully_visible then node.revealed_at else null end
        )
        order by node.revealed_at desc, node.id desc
      )
      from represented_nodes as node
    ), '[]'::jsonb),
    'edges', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'from_signal_id', edge.from_signal_id,
          'to_signal_id', edge.to_signal_id,
          'relationship_kind', edge.relationship_kind,
          'label', edge.label
        )
        order by edge.from_signal_id, edge.to_signal_id, edge.relationship_kind
      )
      from bounded_edges as edge
    ), '[]'::jsonb)
  )
  into graph_payload;

  return coalesce(graph_payload, jsonb_build_object('nodes', '[]'::jsonb, 'edges', '[]'::jsonb));
end;
$$;

-- Lazy detail and discovery are atomic. Inaccessible, hidden, archived, draft,
-- and nonexistent UUIDs all return zero rows, preventing existence probing.
-- Reopening an already-discovered signal performs no state write.
create or replace function public.open_net_echo_signal(
  requested_signal_id uuid,
  requested_expected_account_id uuid
)
returns table (
  signal_id uuid,
  kind text,
  title text,
  summary text,
  body text,
  reliability text,
  intensity text,
  frequencies text[],
  map_x numeric,
  map_y numeric,
  integrity_percent smallint,
  source_account_id uuid,
  source_handle text,
  source_display_name text,
  source_avatar_url text,
  source_label text,
  location_label text,
  district_label text,
  occurred_at timestamptz,
  primary_reference_app_id text,
  primary_reference_resource_kind text,
  primary_reference_resource_id text,
  revealed_at timestamptz,
  viewer_discovered boolean,
  viewer_saved boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  viewer_account_id uuid;
  selected_signal public.net_echo_signals%rowtype;
  discovery_time timestamptz := timezone('utc', now());
begin
  viewer_account_id := public.assert_net_echo_account_context(
    requested_expected_account_id,
    true
  );

  select signal.*
  into selected_signal
  from public.net_echo_signals as signal
  where signal.id = requested_signal_id
    and public.net_echo_signal_is_fully_visible(signal.id, viewer_account_id);

  if not found then
    return;
  end if;

  insert into public.net_echo_account_signal_state as own_state (
    account_id,
    signal_id,
    discovered_at
  ) values (
    viewer_account_id,
    selected_signal.id,
    discovery_time
  )
  on conflict on constraint net_echo_account_signal_state_pkey do update
  set discovered_at = excluded.discovered_at
  where own_state.discovered_at is null;

  return query
  select
    signal.id,
    signal.kind,
    signal.title,
    signal.summary,
    signal.body,
    signal.reliability,
    signal.intensity,
    signal.frequencies,
    signal.map_x,
    signal.map_y,
    signal.integrity_percent,
    signal.source_account_id,
    source_account.handle,
    source_account.display_name_override,
    source_account.avatar_url_override,
    signal.source_label,
    signal.location_label,
    signal.district_label,
    signal.occurred_at,
    signal.primary_reference_app_id,
    signal.primary_reference_resource_kind,
    signal.primary_reference_resource_id,
    signal.revealed_at,
    own_state.discovered_at is not null,
    own_state.saved_at is not null
  from public.net_echo_signals as signal
  join public.net_echo_account_signal_state as own_state
    on own_state.account_id = viewer_account_id
    and own_state.signal_id = signal.id
  left join public.net_app_accounts as source_account
    on source_account.id = signal.source_account_id
  where signal.id = selected_signal.id;
end;
$$;

-- Private idempotent save state. A save can target only a fully visible signal,
-- and the account is always the server-derived active ECHO account.
create or replace function public.set_net_echo_signal_saved(
  requested_signal_id uuid,
  requested_desired_saved boolean,
  requested_expected_account_id uuid
)
returns table (
  signal_id uuid,
  viewer_saved boolean,
  saved_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  viewer_account_id uuid;
  existing_state public.net_echo_account_signal_state%rowtype;
  resulting_saved_at timestamptz;
begin
  viewer_account_id := public.assert_net_echo_account_context(
    requested_expected_account_id,
    true
  );

  if requested_signal_id is null or requested_desired_saved is null then
    raise exception 'A signal and desired save state are required.' using errcode = '22023';
  end if;

  if not public.net_echo_signal_is_fully_visible(
    requested_signal_id,
    viewer_account_id
  ) then
    raise exception 'ECHO_SIGNAL_UNAVAILABLE' using errcode = 'P0001';
  end if;

  if requested_desired_saved then
    resulting_saved_at := timezone('utc', now());
    insert into public.net_echo_account_signal_state as own_state (
      account_id,
      signal_id,
      saved_at
    ) values (
      viewer_account_id,
      requested_signal_id,
      resulting_saved_at
    )
    on conflict on constraint net_echo_account_signal_state_pkey do update
    set saved_at = excluded.saved_at
    where own_state.saved_at is null
    returning own_state.saved_at into resulting_saved_at;

    if not found then
      select own_state.saved_at
      into resulting_saved_at
      from public.net_echo_account_signal_state as own_state
      where own_state.account_id = viewer_account_id
        and own_state.signal_id = requested_signal_id;
    end if;
  else
    select own_state.*
    into existing_state
    from public.net_echo_account_signal_state as own_state
    where own_state.account_id = viewer_account_id
      and own_state.signal_id = requested_signal_id
    for update;

    if not found or existing_state.saved_at is null then
      resulting_saved_at := null;
    elsif existing_state.granted_at is null and existing_state.discovered_at is null then
      delete from public.net_echo_account_signal_state as own_state
      where own_state.account_id = viewer_account_id
        and own_state.signal_id = requested_signal_id;
      resulting_saved_at := null;
    else
      update public.net_echo_account_signal_state as own_state
      set saved_at = null
      where own_state.account_id = viewer_account_id
        and own_state.signal_id = requested_signal_id;
      resulting_saved_at := null;
    end if;
  end if;

  return query select
    requested_signal_id,
    resulting_saved_at is not null,
    resulting_saved_at;
end;
$$;

alter table public.net_echo_signals enable row level security;
alter table public.net_echo_signal_links enable row level security;
alter table public.net_echo_account_signal_state enable row level security;

-- No table policies are intentional. Even authenticated GMs use future narrow
-- SECURITY DEFINER editor RPCs rather than raw PostgREST access.
revoke all on table public.net_echo_signals from public, anon, authenticated;
revoke all on table public.net_echo_signal_links from public, anon, authenticated;
revoke all on table public.net_echo_account_signal_state from public, anon, authenticated;

revoke all on function public.assert_net_echo_active_identity_context(uuid)
  from public, anon, authenticated;
revoke all on function public.assert_net_echo_account_context(uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.validate_net_echo_account_active_identity()
  from public, anon, authenticated;
revoke all on function public.validate_net_echo_account_signal_state()
  from public, anon, authenticated;
revoke all on function public.net_echo_signal_is_fully_visible(uuid, uuid)
  from public, anon, authenticated;

revoke all on function public.create_net_echo_account(uuid, text)
  from public, anon, authenticated;
revoke all on function public.fetch_net_echo_map(uuid, integer, integer)
  from public, anon, authenticated;
revoke all on function public.open_net_echo_signal(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.set_net_echo_signal_saved(uuid, boolean, uuid)
  from public, anon, authenticated;

grant execute on function public.create_net_echo_account(uuid, text)
  to authenticated;
grant execute on function public.fetch_net_echo_map(uuid, integer, integer)
  to authenticated;
grant execute on function public.open_net_echo_signal(uuid, uuid)
  to authenticated;
grant execute on function public.set_net_echo_signal_saved(uuid, boolean, uuid)
  to authenticated;

commit;
