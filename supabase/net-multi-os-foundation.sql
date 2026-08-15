-- Multi-OS foundation V1.
-- Run once after the deployed identity, app-account, NVN, ECHO, and economy
-- migrations. This migration assigns an explicit primary OS to every current
-- playable player identity without deriving runtime authority from CITY.

begin;

create extension if not exists pgcrypto;

create table if not exists public.net_os_families (
  id text primary key,
  display_name text not null unique,
  status text not null default 'active',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint net_os_families_id_valid check (id ~ '^[a-z][a-z0-9-]{1,31}$'),
  constraint net_os_families_status_valid check (status in ('active', 'retired'))
);

create table if not exists public.net_identity_os_assignments (
  identity_link_id uuid primary key
    references public.net_identity_links (id) on delete cascade,
  primary_os_id text not null
    references public.net_os_families (id) on delete restrict,
  assignment_basis text not null default 'default',
  assigned_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint net_identity_os_assignments_basis_valid check (
    assignment_basis in ('default', 'migration', 'gm')
  )
);

create table if not exists public.net_os_service_scopes (
  service_id text primary key,
  scope_kind text not null,
  required_os_id text references public.net_os_families (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint net_os_service_scopes_id_valid check (
    service_id ~ '^[a-z][a-z0-9-]{1,63}$'
  ),
  constraint net_os_service_scopes_scope_valid check (
    (scope_kind = 'global' and required_os_id is null)
    or (scope_kind = 'primary-os' and required_os_id is not null)
  )
);

drop trigger if exists net_os_families_set_updated_at on public.net_os_families;
create trigger net_os_families_set_updated_at
before update on public.net_os_families
for each row execute procedure public.set_updated_at();

drop trigger if exists net_identity_os_assignments_set_updated_at
  on public.net_identity_os_assignments;
create trigger net_identity_os_assignments_set_updated_at
before update on public.net_identity_os_assignments
for each row execute procedure public.set_updated_at();

drop trigger if exists net_os_service_scopes_set_updated_at
  on public.net_os_service_scopes;
create trigger net_os_service_scopes_set_updated_at
before update on public.net_os_service_scopes
for each row execute procedure public.set_updated_at();

insert into public.net_os_families (id, display_name, status)
values
  ('veil', 'VEIL OS', 'active'),
  ('altara', 'ALTARA OS', 'active')
on conflict (id) do update
set
  display_name = excluded.display_name,
  status = excluded.status,
  updated_at = timezone('utc', now());

insert into public.net_os_service_scopes (
  service_id,
  scope_kind,
  required_os_id
)
values
  ('echo', 'primary-os', 'veil'),
  ('pulse', 'global', null),
  ('iden', 'primary-os', 'veil'),
  ('vlt', 'primary-os', 'veil'),
  ('vox-bank', 'global', null),
  ('shneider-bank', 'global', null),
  ('nvn', 'primary-os', 'veil'),
  ('net-store', 'primary-os', 'veil'),
  ('veil-settings', 'primary-os', 'veil'),
  ('loop', 'global', null)
on conflict (service_id) do update
set
  scope_kind = excluded.scope_kind,
  required_os_id = excluded.required_os_id,
  updated_at = timezone('utc', now());

-- One-time reviewed lore assignments for the complete production playable
-- roster. Every authority key below is an exact production identity-link and
-- subject tuple. Email, handle, display name, CITY, and editable sheet fields
-- are deliberately absent from this authority map.
create temporary table net_os_current_identity_seed (
  seed_key text primary key,
  identity_link_id uuid not null unique,
  expected_subject_kind text not null,
  expected_subject_id uuid not null,
  primary_os_id text not null
) on commit drop;

insert into net_os_current_identity_seed (
  seed_key,
  identity_link_id,
  expected_subject_kind,
  expected_subject_id,
  primary_os_id
)
values
  (
    'adrian-altara',
    '8e7ebd04-f106-4db8-877b-bb83919406e0'::uuid,
    'npc-card',
    '9f9873b5-89fd-40d5-9682-e20173b10e85'::uuid,
    'altara'
  ),
  (
    'ayin',
    '93497f00-fdd8-4153-a1db-be811f88ef64'::uuid,
    'profile-sheet',
    'ffa69533-8497-4734-8bba-ef8ccef59f21'::uuid,
    'altara'
  ),
  (
    'gfx-436-jeff',
    '82f0d1c5-bdc1-4495-b97f-48e1f0f699df'::uuid,
    'profile-sheet',
    '79afa091-9831-4be8-8f32-43cd6cade43e'::uuid,
    'veil'
  ),
  (
    'jack-yamazaki',
    'bc985bfc-c854-4cc5-9006-c8935d9975bc'::uuid,
    'profile-sheet',
    '56534cd8-bdc1-44a6-b768-6ff5a1b53d92'::uuid,
    'altara'
  ),
  (
    'jett-rar',
    '5ff53dce-0847-4f49-a66e-d9360bda25c4'::uuid,
    'profile-sheet',
    '53a78f8c-294c-4510-b9ad-b28fa42c8e64'::uuid,
    'veil'
  ),
  (
    'lorenzo',
    '14c481fc-4755-4803-b904-d72864e190f7'::uuid,
    'profile-sheet',
    'ee9c586e-33c0-4ab4-9902-64d31c2d04cc'::uuid,
    'veil'
  ),
  (
    'orion-haylo',
    '3708ffb7-beab-4b13-be7b-e69156b17e5c'::uuid,
    'profile-sheet',
    'b73f2fa7-57ad-4b66-a68c-4849f167fe70'::uuid,
    'veil'
  ),
  (
    'vanessa-schneider',
    '179b8ff5-634b-4fad-b5d7-6793cd365e11'::uuid,
    'profile-sheet',
    '05995694-6976-4d23-b6f5-7523c31320cd'::uuid,
    'veil'
  );

do $$
declare
  v_seed_count integer;
  v_unreviewed_ids text;
begin
  select count(*)::integer
  into v_seed_count
  from net_os_current_identity_seed as reviewed
  join public.net_identity_links as identity_link
    on identity_link.id = reviewed.identity_link_id
    and identity_link.subject_kind = reviewed.expected_subject_kind
    and identity_link.subject_id = reviewed.expected_subject_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable';

  if v_seed_count <> 8 then
    raise exception 'NET_OS_CURRENT_IDENTITY_SEED_REVIEW_REQUIRED: expected 8, resolved %',
      v_seed_count
      using errcode = '23514';
  end if;

  select string_agg(identity_link.id::text, ', ' order by identity_link.id)
  into v_unreviewed_ids
  from public.net_identity_links as identity_link
  where identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable'
    and not exists (
      select 1
      from net_os_current_identity_seed as reviewed
      where reviewed.identity_link_id = identity_link.id
    );

  if v_unreviewed_ids is not null then
    raise exception 'NET_OS_UNREVIEWED_PLAYABLE_IDENTITIES: %', v_unreviewed_ids
      using errcode = '23514';
  end if;
end;
$$;

insert into public.net_identity_os_assignments (
  identity_link_id,
  primary_os_id,
  assignment_basis
)
select reviewed.identity_link_id, reviewed.primary_os_id, 'migration'
from net_os_current_identity_seed as reviewed
join public.net_identity_links as identity_link
  on identity_link.id = reviewed.identity_link_id
  and identity_link.subject_kind = reviewed.expected_subject_kind
  and identity_link.subject_id = reviewed.expected_subject_id
  and identity_link.identity_kind = 'player'
  and identity_link.playability = 'playable'
on conflict (identity_link_id) do nothing;

create or replace function public.ensure_net_identity_primary_os()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.identity_kind = 'player' and new.playability = 'playable' then
    insert into public.net_identity_os_assignments (
      identity_link_id,
      primary_os_id,
      assignment_basis
    ) values (
      new.id,
      'altara',
      'default'
    )
    on conflict (identity_link_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists net_identity_links_ensure_primary_os
  on public.net_identity_links;
create trigger net_identity_links_ensure_primary_os
after insert or update of identity_kind, playability on public.net_identity_links
for each row execute procedure public.ensure_net_identity_primary_os();

-- Close the narrow seed/trigger-install race. Every identity present during
-- the reviewed seed was mapped explicitly above; only a concurrently-created
-- or future playable identity can reach this ALTARA default path.
insert into public.net_identity_os_assignments (
  identity_link_id,
  primary_os_id,
  assignment_basis
)
select identity_link.id, 'altara', 'default'
from public.net_identity_links as identity_link
where identity_link.identity_kind = 'player'
  and identity_link.playability = 'playable'
on conflict (identity_link_id) do nothing;

create or replace function public.net_identity_link_can_access_service(
  requested_identity_link_id uuid,
  requested_service_id text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.net_identity_links as identity_link
    join public.net_identity_os_assignments as assignment
      on assignment.identity_link_id = identity_link.id
    join public.net_os_families as os_family
      on os_family.id = assignment.primary_os_id
      and os_family.status = 'active'
    join public.net_os_service_scopes as service_scope
      on service_scope.service_id = requested_service_id
    where identity_link.id = requested_identity_link_id
      and identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
      and (
        service_scope.scope_kind = 'global'
        or (
          service_scope.scope_kind = 'primary-os'
          and assignment.primary_os_id = service_scope.required_os_id
        )
      )
  );
$$;

create or replace function public.current_user_controls_net_service_for_link(
  requested_identity_link_id uuid,
  requested_service_id text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and public.current_user_controls_playable_net_identity_link(
      requested_identity_link_id
    )
    and public.net_identity_link_can_access_service(
      requested_identity_link_id,
      requested_service_id
    );
$$;

create or replace function public.current_user_can_access_net_service(
  requested_service_id text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and (
      public.is_current_user_gm()
      or exists (
        select 1
        from public.net_active_identities as active_identity
        where active_identity.profile_id = auth.uid()
          and public.current_user_controls_net_service_for_link(
            active_identity.identity_link_id,
            requested_service_id
          )
      )
    );
$$;

create or replace function public.assert_net_identity_service_access(
  requested_identity_link_id uuid,
  requested_service_id text
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if requested_identity_link_id is null
    or not public.net_identity_link_can_access_service(
      requested_identity_link_id,
      requested_service_id
    )
  then
    raise exception 'NET_OS_SERVICE_ACCESS_DENIED' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.assert_current_user_net_service_access(
  requested_service_id text
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.current_user_can_access_net_service(requested_service_id) then
    raise exception 'NET_OS_SERVICE_ACCESS_DENIED' using errcode = '42501';
  end if;
end;
$$;

-- The deployed Karma-only sheet path is an alternate VLT mutation boundary.
-- Preserve its implementation behind an execution-revoked compatibility name,
-- then put the same primary-OS authority check in front of every caller,
-- including the legacy character save RPC.
do $$
begin
  if to_regprocedure(
    'public.net_economy_apply_sheet_karma_absolute_balance(uuid,bigint,text,uuid)'
  ) is null then
    raise exception 'NET_OS_KARMA_SHEET_HELPER_REVIEW_REQUIRED'
      using errcode = '42883';
  end if;

  if to_regprocedure(
    'public.net_economy_apply_sheet_karma_absolute_balance_unscoped(uuid,bigint,text,uuid)'
  ) is null then
    execute 'alter function public.net_economy_apply_sheet_karma_absolute_balance(uuid, bigint, text, uuid) rename to net_economy_apply_sheet_karma_absolute_balance_unscoped';
  end if;
end;
$$;

revoke all on function public.net_economy_apply_sheet_karma_absolute_balance_unscoped(
  uuid,
  bigint,
  text,
  uuid
) from public, anon, authenticated;

create or replace function public.net_economy_apply_sheet_karma_absolute_balance(
  requested_identity_link_id uuid,
  requested_absolute_balance bigint,
  requested_subject_kind text,
  requested_subject_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_identity_service_access(
    requested_identity_link_id,
    'vlt'
  );

  return public.net_economy_apply_sheet_karma_absolute_balance_unscoped(
    requested_identity_link_id,
    requested_absolute_balance,
    requested_subject_kind,
    requested_subject_id
  );
end;
$$;

-- Preserve the deployed semantic parser, existing-enrolment rule, exact sheet
-- permission checks, and Adrian's '--' presentation exception. For an ALTARA
-- identity this interpreter returns the authoritative historical mirror and
-- never reaches the ledger helper, so an unrelated sheet save remains usable.
create or replace function public.net_economy_apply_sheet_karma_request(
  requested_subject_kind text,
  requested_subject_id uuid,
  requested_field_patch jsonb
)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_adrian_subject_id constant uuid :=
    '9f9873b5-89fd-40d5-9682-e20173b10e85'::uuid;
  v_identity_link_id uuid;
  v_identity_count integer;
  v_karma_account public.net_economy_accounts%rowtype;
  v_parser_field_patch jsonb;
  v_karma_semantic jsonb;
  v_requested_karma bigint;
  v_key text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if not public.net_economy_current_user_can_edit_sheet_subject(
    requested_subject_kind,
    requested_subject_id
  ) then
    raise exception 'ECONOMY_SHEET_EDIT_DENIED' using errcode = '42501';
  end if;
  if requested_field_patch is null
    or jsonb_typeof(requested_field_patch) <> 'object'
  then
    raise exception 'ECONOMY_SHEET_PATCH_INVALID' using errcode = '22023';
  end if;

  v_parser_field_patch := requested_field_patch;
  if requested_subject_kind = 'npc-card'
    and requested_subject_id = v_adrian_subject_id
  then
    foreach v_key in array array['KARMA', 'Karma', 'karma', 'K4rma', 'K4RMA']
    loop
      if btrim(coalesce(v_parser_field_patch ->> v_key, '')) = '--' then
        v_parser_field_patch := jsonb_set(
          v_parser_field_patch,
          array[v_key],
          to_jsonb('-'::text),
          true
        );
      end if;
    end loop;
  end if;

  v_karma_semantic := public.net_economy_parse_sheet_karma(
    v_parser_field_patch
  );

  select count(*)
  into v_identity_count
  from public.net_identity_links as identity_link
  where identity_link.subject_kind = requested_subject_kind
    and identity_link.subject_id = requested_subject_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable';

  if v_identity_count = 0 then
    return case
      when requested_subject_kind = 'npc-card'
        and requested_subject_id = v_adrian_subject_id
      then '--'
      else '-'
    end;
  end if;
  if v_identity_count > 1 then
    raise exception 'ECONOMY_SHEET_IDENTITY_AMBIGUOUS' using errcode = '23514';
  end if;

  select identity_link.id
  into v_identity_link_id
  from public.net_identity_links as identity_link
  where identity_link.subject_kind = requested_subject_kind
    and identity_link.subject_id = requested_subject_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable';

  select *
  into v_karma_account
  from public.net_economy_accounts as account
  where account.identity_link_id = v_identity_link_id
    and account.account_kind = 'wallet'
    and account.currency_code = 'KARMA';

  if v_karma_account.id is null then
    return case
      when requested_subject_kind = 'npc-card'
        and requested_subject_id = v_adrian_subject_id
      then '--'
      else '-'
    end;
  end if;

  if not public.net_identity_link_can_access_service(v_identity_link_id, 'vlt') then
    return public.net_economy_karma_display(v_karma_account.balance_amount);
  end if;

  if v_karma_semantic ->> 'state' = 'numeric' then
    v_requested_karma := (v_karma_semantic ->> 'amount')::bigint;
    perform public.net_economy_apply_sheet_karma_absolute_balance(
      v_identity_link_id,
      v_requested_karma,
      requested_subject_kind,
      requested_subject_id
    );
  end if;

  select *
  into v_karma_account
  from public.net_economy_accounts as account
  where account.id = v_karma_account.id;

  return public.net_economy_karma_display(v_karma_account.balance_amount);
end;
$$;

comment on function public.net_economy_apply_sheet_karma_absolute_balance(
  uuid,
  bigint,
  text,
  uuid
) is
  'Internal Karma-only sheet mutation boundary. Requires the subject identity to retain VLT service access before delegating to the deployed ledger implementation.';
comment on function public.net_economy_apply_sheet_karma_request(text, uuid, jsonb) is
  'Internal Karma sheet interpreter. ALTARA identities remain canonical read-only mirrors; VEIL identities retain the deployed ledgered bidirectional path; Adrian preserves the -- no-profile sentinel.';

revoke all on function public.net_economy_apply_sheet_karma_absolute_balance(
  uuid,
  bigint,
  text,
  uuid
) from public, anon, authenticated;
revoke all on function public.net_economy_apply_sheet_karma_request(text, uuid, jsonb)
  from public, anon, authenticated;

create or replace function public.fetch_net_current_os_session()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.app_role;
  v_identity_link_id uuid;
  v_primary_os_id text;
begin
  if v_actor is null then
    raise exception 'NET_OS_AUTH_REQUIRED' using errcode = '42501';
  end if;

  select profile.role
  into v_role
  from public.profiles as profile
  where profile.id = v_actor;

  if not found then
    raise exception 'NET_OS_PROFILE_UNAVAILABLE' using errcode = '42501';
  end if;

  if v_role = 'gm' then
    return jsonb_build_object(
      'actor_mode', 'gm-system',
      'identity_link_id', null,
      'primary_os_id', 'veil'
    );
  end if;

  select identity_link.id, assignment.primary_os_id
  into v_identity_link_id, v_primary_os_id
  from public.net_active_identities as active_identity
  join public.net_identity_links as identity_link
    on identity_link.id = active_identity.identity_link_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable'
  left join public.net_identity_os_assignments as assignment
    on assignment.identity_link_id = identity_link.id
  where active_identity.profile_id = v_actor
    and public.current_user_controls_playable_net_identity_link(identity_link.id);

  if v_identity_link_id is null then
    return jsonb_build_object(
      'actor_mode', 'player',
      'identity_link_id', null,
      'primary_os_id', null
    );
  end if;

  if v_primary_os_id is null then
    raise exception 'NET_PRIMARY_OS_ASSIGNMENT_MISSING' using errcode = '55000';
  end if;

  return jsonb_build_object(
    'actor_mode', 'player',
    'identity_link_id', v_identity_link_id,
    'primary_os_id', v_primary_os_id
  );
end;
$$;

create or replace function public.fetch_net_gm_identity_os(
  requested_identity_link_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_assignment public.net_identity_os_assignments%rowtype;
begin
  if auth.uid() is null or not public.is_current_user_gm() then
    raise exception 'NET_OS_GM_REQUIRED' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.net_identity_links as identity_link
    where identity_link.id = requested_identity_link_id
      and identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
  ) then
    raise exception 'NET_OS_PLAYABLE_IDENTITY_REQUIRED' using errcode = '22023';
  end if;

  select assignment.*
  into v_assignment
  from public.net_identity_os_assignments as assignment
  where assignment.identity_link_id = requested_identity_link_id;

  if not found then
    raise exception 'NET_PRIMARY_OS_ASSIGNMENT_MISSING' using errcode = '55000';
  end if;

  return jsonb_build_object(
    'identity_link_id', v_assignment.identity_link_id,
    'primary_os_id', v_assignment.primary_os_id,
    'updated_at', v_assignment.updated_at
  );
end;
$$;

create or replace function public.set_net_gm_identity_primary_os(
  requested_identity_link_id uuid,
  requested_primary_os_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_link public.net_identity_links%rowtype;
  v_assignment public.net_identity_os_assignments%rowtype;
  v_normalized_os_id text := lower(btrim(coalesce(requested_primary_os_id, '')));
  v_changed boolean := false;
begin
  if v_actor is null or not public.is_current_user_gm() then
    raise exception 'NET_OS_GM_REQUIRED' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.net_os_families as os_family
    where os_family.id = v_normalized_os_id
      and os_family.status = 'active'
  ) then
    raise exception 'NET_OS_UNSUPPORTED' using errcode = '22023';
  end if;

  select identity_link.*
  into v_link
  from public.net_identity_links as identity_link
  where identity_link.id = requested_identity_link_id
  for update;

  if not found
    or v_link.identity_kind <> 'player'
    or v_link.playability <> 'playable'
  then
    raise exception 'NET_OS_PLAYABLE_IDENTITY_REQUIRED' using errcode = '22023';
  end if;

  insert into public.net_identity_os_assignments (
    identity_link_id,
    primary_os_id,
    assignment_basis,
    assigned_by_profile_id
  ) values (
    v_link.id,
    v_normalized_os_id,
    'gm',
    v_actor
  )
  on conflict (identity_link_id) do nothing;

  select assignment.*
  into v_assignment
  from public.net_identity_os_assignments as assignment
  where assignment.identity_link_id = v_link.id
  for update;

  v_changed := v_assignment.primary_os_id is distinct from v_normalized_os_id;
  if v_changed then
    update public.net_identity_os_assignments as assignment
    set
      primary_os_id = v_normalized_os_id,
      assignment_basis = 'gm',
      assigned_by_profile_id = v_actor
    where assignment.identity_link_id = v_link.id
    returning assignment.* into v_assignment;

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
      v_actor,
      null,
      null,
      null,
      'system',
      'net.identity.primary-os.change',
      'authenticated-gm',
      'net-identity-link',
      v_link.id
    );
  end if;

  return jsonb_build_object(
    'identity_link_id', v_assignment.identity_link_id,
    'primary_os_id', v_assignment.primary_os_id,
    'updated_at', v_assignment.updated_at
  );
end;
$$;

-- App-account rows are data, never entitlements. New player-owned account
-- writes must match the identity's effective OS scope; GM/system maintenance is
-- intentionally unaffected.
create or replace function public.enforce_net_app_account_os_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or public.is_current_user_gm() then
    return new;
  end if;

  if new.identity_link_id is null then
    raise exception 'NET_OS_SERVICE_ACCESS_DENIED' using errcode = '42501';
  end if;

  perform public.assert_net_identity_service_access(
    new.identity_link_id,
    new.app_id
  );
  return new;
end;
$$;

drop trigger if exists net_app_accounts_enforce_os_scope
  on public.net_app_accounts;
create trigger net_app_accounts_enforce_os_scope
before insert or update of app_id, identity_link_id on public.net_app_accounts
for each row execute procedure public.enforce_net_app_account_os_scope();

do $$
begin
  if to_regprocedure('public.ensure_net_app_account_unscoped(uuid,text)') is null then
    execute 'alter function public.ensure_net_app_account(uuid, text) rename to ensure_net_app_account_unscoped';
  end if;
  if to_regprocedure(
    'public.create_net_app_account_unscoped(uuid,text,text,text,text)'
  ) is null then
    execute 'alter function public.create_net_app_account(uuid, text, text, text, text) rename to create_net_app_account_unscoped';
  end if;
end;
$$;

create or replace function public.ensure_net_app_account(
  requested_identity_link_id uuid,
  requested_app_id text
)
returns public.net_app_accounts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account public.net_app_accounts%rowtype;
begin
  perform public.assert_net_identity_service_access(
    requested_identity_link_id,
    requested_app_id
  );
  v_account := public.ensure_net_app_account_unscoped(
    requested_identity_link_id,
    requested_app_id
  );
  return v_account;
end;
$$;

create or replace function public.create_net_app_account(
  requested_identity_link_id uuid,
  requested_app_id text,
  requested_handle text,
  requested_display_name_override text default null,
  requested_avatar_url_override text default null
)
returns public.net_app_accounts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account public.net_app_accounts%rowtype;
begin
  perform public.assert_net_identity_service_access(
    requested_identity_link_id,
    requested_app_id
  );
  v_account := public.create_net_app_account_unscoped(
    requested_identity_link_id,
    requested_app_id,
    requested_handle,
    requested_display_name_override,
    requested_avatar_url_override
  );
  return v_account;
end;
$$;

create or replace function public.set_net_identity_app_install(
  requested_identity_link_id uuid,
  requested_app_id text,
  requested_installed boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if requested_identity_link_id is null
    or not public.current_user_controls_playable_net_identity_link(
      requested_identity_link_id
    )
  then
    raise exception 'The requested playable identity is not controlled by this account.'
      using errcode = '42501';
  end if;

  if requested_app_id is null
    or requested_app_id not in (
      'echo', 'pulse', 'nvn', 'vox-bank', 'shneider-bank'
    )
  then
    raise exception 'This application is not an installable optional NET module.'
      using errcode = '22023';
  end if;

  perform public.assert_net_identity_service_access(
    requested_identity_link_id,
    requested_app_id
  );

  if requested_installed is null then
    raise exception 'Installation state is required.' using errcode = '22023';
  end if;

  if requested_installed then
    insert into public.net_identity_app_installs (identity_link_id, app_id)
    values (requested_identity_link_id, requested_app_id)
    on conflict (identity_link_id, app_id) do update
    set updated_at = timezone('utc', now());
  else
    delete from public.net_identity_app_installs
    where identity_link_id = requested_identity_link_id
      and app_id = requested_app_id;
  end if;

  return requested_installed;
end;
$$;

create or replace function public.set_net_identity_wallpaper(
  requested_identity_link_id uuid,
  requested_wallpaper_path text,
  requested_fit text,
  requested_position text
)
returns public.net_identity_system_profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_normalized_path text := nullif(btrim(requested_wallpaper_path), '');
  v_saved_profile public.net_identity_system_profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if requested_identity_link_id is null
    or not public.current_user_controls_playable_net_identity_link(
      requested_identity_link_id
    )
  then
    raise exception 'The requested playable identity is not controlled by this account.'
      using errcode = '42501';
  end if;
  perform public.assert_net_identity_service_access(
    requested_identity_link_id,
    'veil-settings'
  );

  if v_normalized_path is null
    or split_part(v_normalized_path, '/', 1) <> requested_identity_link_id::text
    or split_part(v_normalized_path, '/', 2) = ''
    or v_normalized_path like '%..%'
  then
    raise exception 'Wallpaper path does not belong to the requested identity.'
      using errcode = '22023';
  end if;
  if requested_fit is null
    or requested_fit not in ('cover', 'contain')
    or requested_position is null
    or requested_position not in ('center', 'top', 'bottom')
  then
    raise exception 'Unsupported wallpaper presentation.' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from storage.objects as object
    where object.bucket_id = 'net-wallpapers'
      and object.name = v_normalized_path
  ) then
    raise exception 'Wallpaper object is unavailable.' using errcode = '22023';
  end if;

  insert into public.net_identity_system_profiles (
    identity_link_id,
    wallpaper_path,
    wallpaper_fit,
    wallpaper_position
  ) values (
    requested_identity_link_id,
    v_normalized_path,
    requested_fit,
    requested_position
  )
  on conflict (identity_link_id) do update
  set
    wallpaper_path = excluded.wallpaper_path,
    wallpaper_fit = excluded.wallpaper_fit,
    wallpaper_position = excluded.wallpaper_position
  returning * into v_saved_profile;

  return v_saved_profile;
end;
$$;

create or replace function public.clear_net_identity_wallpaper(
  requested_identity_link_id uuid
)
returns public.net_identity_system_profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_saved_profile public.net_identity_system_profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if requested_identity_link_id is null
    or not public.current_user_controls_playable_net_identity_link(
      requested_identity_link_id
    )
  then
    raise exception 'The requested playable identity is not controlled by this account.'
      using errcode = '42501';
  end if;
  perform public.assert_net_identity_service_access(
    requested_identity_link_id,
    'veil-settings'
  );

  insert into public.net_identity_system_profiles (
    identity_link_id,
    wallpaper_path,
    wallpaper_fit,
    wallpaper_position
  ) values (
    requested_identity_link_id,
    null,
    'cover',
    'center'
  )
  on conflict (identity_link_id) do update
  set
    wallpaper_path = null,
    wallpaper_fit = 'cover',
    wallpaper_position = 'center'
  returning * into v_saved_profile;

  return v_saved_profile;
end;
$$;

-- ECHO has one shared active-identity assertion boundary, so all player ECHO
-- account provisioning/read/write RPCs inherit the same VEIL-only check.
create or replace function public.assert_net_echo_active_identity_context(
  requested_expected_identity_link_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_actual_identity_link_id uuid;
begin
  if v_actor is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select identity_link.id
  into v_actual_identity_link_id
  from public.net_active_identities as active_identity
  join public.net_identity_links as identity_link
    on identity_link.id = active_identity.identity_link_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable'
  where active_identity.profile_id = v_actor
    and public.current_user_controls_playable_net_identity_link(identity_link.id)
  for share of active_identity;

  if requested_expected_identity_link_id is null
    or requested_expected_identity_link_id is distinct from v_actual_identity_link_id
  then
    raise exception 'ECHO_ACCOUNT_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;

  perform public.assert_net_identity_service_access(
    v_actual_identity_link_id,
    'echo'
  );
  return v_actual_identity_link_id;
end;
$$;

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
  v_actor uuid := auth.uid();
  v_actual_identity_link_id uuid;
  v_actual_account_id uuid;
begin
  if v_actor is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select identity_link.id, echo_account.id
  into v_actual_identity_link_id, v_actual_account_id
  from public.net_active_identities as active_identity
  join public.net_identity_links as identity_link
    on identity_link.id = active_identity.identity_link_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable'
  left join public.net_app_accounts as echo_account
    on echo_account.identity_link_id = identity_link.id
    and echo_account.app_id = 'echo'
    and echo_account.status = 'active'
  where active_identity.profile_id = v_actor
    and public.current_user_controls_playable_net_identity_link(identity_link.id)
  for share of active_identity;

  if requested_expected_account_id is distinct from v_actual_account_id then
    raise exception 'ECHO_ACCOUNT_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;
  if coalesce(requested_require_account, true) and v_actual_account_id is null then
    raise exception 'An active, controlled ECHO account is required.' using errcode = '42501';
  end if;

  perform public.assert_net_identity_service_access(
    v_actual_identity_link_id,
    'echo'
  );
  return v_actual_account_id;
end;
$$;

-- VLT remains a VEIL/New-Vega product. Existing rows are preserved; the
-- bounded player RPCs simply fail closed when the active identity is not
-- entitled. GM Economy Control remains available through GM authority.
create or replace function public.fetch_net_economy_wallet(
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 20
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
begin
  if (requested_cursor_at is null) <> (requested_cursor_id is null) then
    raise exception 'ECONOMY_CURSOR_INVALID' using errcode = '22023';
  end if;
  v_identity_link_id := public.assert_net_economy_player_identity();
  perform public.assert_net_identity_service_access(v_identity_link_id, 'vlt');
  return public.net_economy_wallet_payload(
    v_identity_link_id,
    requested_cursor_at,
    requested_cursor_id,
    requested_limit
  );
end;
$$;

create or replace function public.fetch_net_economy_wallet_v2(
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 20
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
begin
  if (requested_cursor_at is null) <> (requested_cursor_id is null) then
    raise exception 'ECONOMY_CURSOR_INVALID' using errcode = '22023';
  end if;
  v_identity_link_id := public.assert_net_economy_player_identity();
  perform public.assert_net_identity_service_access(v_identity_link_id, 'vlt');
  return public.net_economy_wallet_bundle_payload(
    v_identity_link_id,
    requested_cursor_at,
    requested_cursor_id,
    requested_limit
  );
end;
$$;

create or replace function public.search_net_economy_payees(
  requested_query text,
  requested_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_query text := lower(btrim(coalesce(requested_query, '')));
  v_limit integer := least(greatest(coalesce(requested_limit, 20), 1), 20);
begin
  v_identity_link_id := public.assert_net_economy_player_identity();
  perform public.assert_net_identity_service_access(v_identity_link_id, 'vlt');
  if char_length(v_query) < 2 or char_length(v_query) > 60 then
    raise exception 'ECONOMY_PAYEE_QUERY_INVALID' using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'payment_identifier', directory.payment_identifier,
        'display_name', directory.display_name,
        'karma_available', directory.karma_available
      ) order by directory.display_name, directory.payment_identifier
    )
    from (
      select
        account.payment_identifier,
        public.net_economy_identity_display_name(account.identity_link_id) as display_name,
        exists (
          select 1
          from public.net_economy_accounts as karma
          where karma.identity_link_id = account.identity_link_id
            and karma.account_kind = 'wallet'
            and karma.currency_code = 'KARMA'
            and karma.status = 'active'
        ) as karma_available
      from public.net_economy_accounts as account
      join public.net_identity_links as identity_link
        on identity_link.id = account.identity_link_id
      where account.identity_link_id <> v_identity_link_id
        and account.account_kind = 'wallet'
        and account.currency_code = 'VG'
        and account.status = 'active'
        and identity_link.identity_kind = 'player'
        and identity_link.playability = 'playable'
        and public.net_identity_link_can_access_service(
          account.identity_link_id,
          'vlt'
        )
        and (
          account.payment_identifier like '%'
            || replace(replace(v_query, '%', '\%'), '_', '\_') || '%' escape '\'
          or lower(public.net_economy_identity_display_name(account.identity_link_id))
            like '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%' escape '\'
        )
      order by display_name, account.payment_identifier
      limit v_limit
    ) as directory
  ), '[]'::jsonb);
end;
$$;

create or replace function public.assert_net_vlt_payee_access(
  requested_payment_identifier text
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_target_identity_link_id uuid;
begin
  select account.identity_link_id
  into v_target_identity_link_id
  from public.net_economy_accounts as account
  join public.net_identity_links as identity_link
    on identity_link.id = account.identity_link_id
    and identity_link.identity_kind = 'player'
    and identity_link.playability = 'playable'
  where account.payment_identifier = lower(btrim(coalesce(requested_payment_identifier, '')))
    and account.account_kind = 'wallet'
    and account.currency_code = 'VG'
    and account.status = 'active';

  if v_target_identity_link_id is null
    or not public.net_identity_link_can_access_service(
      v_target_identity_link_id,
      'vlt'
    )
  then
    raise exception 'ECONOMY_PAYEE_NOT_FOUND' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.current_user_can_read_net_economy_wallet_revision(
  requested_account_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and (
      public.is_current_user_gm()
      or exists (
        select 1
        from public.net_economy_accounts as account
        where account.id = requested_account_id
          and account.identity_link_id is not null
          and public.current_user_controls_playable_net_identity_link(
            account.identity_link_id
          )
          and (
            account.account_kind = 'bank'
            or (
              account.account_kind = 'wallet'
              and public.net_identity_link_can_access_service(
                account.identity_link_id,
                'vlt'
              )
            )
          )
      )
    );
$$;

-- Preserve the deployed VLT mutation bodies and their exact idempotency,
-- locking, audit, and response contracts behind OS-aware wrappers.
do $$
begin
  if to_regprocedure(
    'public.transfer_net_economy_wallet_unscoped(text,bigint,text,uuid)'
  ) is null then
    execute 'alter function public.transfer_net_economy_wallet(text, bigint, text, uuid) rename to transfer_net_economy_wallet_unscoped';
  end if;
  if to_regprocedure(
    'public.transfer_net_economy_wallet_v2_unscoped(text,text,bigint,text,uuid)'
  ) is null then
    execute 'alter function public.transfer_net_economy_wallet_v2(text, text, bigint, text, uuid) rename to transfer_net_economy_wallet_v2_unscoped';
  end if;
end;
$$;

create or replace function public.transfer_net_economy_wallet(
  requested_payment_identifier text,
  requested_amount bigint,
  requested_note text,
  requested_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_result jsonb;
begin
  v_identity_link_id := public.assert_net_economy_player_identity();
  perform public.assert_net_identity_service_access(v_identity_link_id, 'vlt');
  perform public.assert_net_vlt_payee_access(requested_payment_identifier);
  v_result := public.transfer_net_economy_wallet_unscoped(
    requested_payment_identifier,
    requested_amount,
    requested_note,
    requested_request_key
  );
  return v_result;
end;
$$;

create or replace function public.transfer_net_economy_wallet_v2(
  requested_payment_identifier text,
  requested_currency_code text,
  requested_amount bigint,
  requested_note text,
  requested_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_result jsonb;
begin
  v_identity_link_id := public.assert_net_economy_player_identity();
  perform public.assert_net_identity_service_access(v_identity_link_id, 'vlt');
  perform public.assert_net_vlt_payee_access(requested_payment_identifier);
  v_result := public.transfer_net_economy_wallet_v2_unscoped(
    requested_payment_identifier,
    requested_currency_code,
    requested_amount,
    requested_note,
    requested_request_key
  );
  return v_result;
end;
$$;

-- Bank-to-VLT principal moves remain available only when the active identity
-- can use VLT. Direct same-bank payments, bank reads, VOX yield, and account
-- history remain global and retain their deployed contracts.
do $$
begin
  if to_regprocedure(
    'public.transfer_net_economy_vox_bank_unscoped(text,bigint,uuid)'
  ) is null then
    execute 'alter function public.transfer_net_economy_vox_bank(text, bigint, uuid) rename to transfer_net_economy_vox_bank_unscoped';
  end if;
  if to_regprocedure(
    'public.transfer_net_economy_shneider_bank_unscoped(text,bigint,uuid)'
  ) is null then
    execute 'alter function public.transfer_net_economy_shneider_bank(text, bigint, uuid) rename to transfer_net_economy_shneider_bank_unscoped';
  end if;
end;
$$;

create or replace function public.transfer_net_economy_vox_bank(
  requested_direction text,
  requested_amount bigint,
  requested_request_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_current_user_net_service_access('vlt');
  return public.transfer_net_economy_vox_bank_unscoped(
    requested_direction,
    requested_amount,
    requested_request_key
  );
end;
$$;

create or replace function public.transfer_net_economy_shneider_bank(
  requested_direction text,
  requested_amount bigint,
  requested_request_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_current_user_net_service_access('vlt');
  return public.transfer_net_economy_shneider_bank_unscoped(
    requested_direction,
    requested_amount,
    requested_request_key
  );
end;
$$;

-- Rename the deployed NVN public readers once, then put narrow OS-aware
-- wrappers back at the stable PostgREST names. The underlying newsroom data
-- and Realtime publication remain untouched.
do $$
begin
  if to_regprocedure(
    'public.fetch_net_nvn_article_page_unscoped(text,text,text,timestamptz,uuid,integer)'
  ) is null then
    execute 'alter function public.fetch_net_nvn_article_page(text, text, text, timestamptz, uuid, integer) rename to fetch_net_nvn_article_page_unscoped';
  end if;
  if to_regprocedure('public.fetch_net_nvn_article_unscoped(uuid)') is null then
    execute 'alter function public.fetch_net_nvn_article(uuid) rename to fetch_net_nvn_article_unscoped';
  end if;
  if to_regprocedure('public.fetch_net_nvn_live_desk_unscoped()') is null then
    execute 'alter function public.fetch_net_nvn_live_desk() rename to fetch_net_nvn_live_desk_unscoped';
  end if;
  if to_regprocedure('public.fetch_net_nvn_radio_tune_state_unscoped()') is null then
    execute 'alter function public.fetch_net_nvn_radio_tune_state() rename to fetch_net_nvn_radio_tune_state_unscoped';
  end if;
end;
$$;

create or replace function public.fetch_net_nvn_article_page(
  requested_mode text,
  requested_category text default null,
  requested_search_query text default null,
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 20
)
returns table (
  id uuid,
  slug text,
  status text,
  headline text,
  short_headline text,
  summary text,
  story_kind text,
  priority text,
  category text,
  byline_name text,
  byline_role text,
  byline_kind text,
  source_status text,
  tags text[],
  district_label text,
  location_label text,
  occurred_at timestamptz,
  published_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz,
  page_sort_at timestamptz,
  page_has_more boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_current_user_net_service_access('nvn');
  return query
  select unscoped.*
  from public.fetch_net_nvn_article_page_unscoped(
    requested_mode,
    requested_category,
    requested_search_query,
    requested_cursor_at,
    requested_cursor_id,
    requested_limit
  ) as unscoped;
end;
$$;

create or replace function public.fetch_net_nvn_article(
  requested_article_id uuid
)
returns table (
  id uuid,
  slug text,
  status text,
  headline text,
  short_headline text,
  summary text,
  body text,
  story_kind text,
  priority text,
  category text,
  byline_name text,
  byline_role text,
  byline_kind text,
  source_status text,
  tags text[],
  source_labels text[],
  district_label text,
  location_label text,
  occurred_at timestamptz,
  pull_quote text,
  pull_quote_attribution text,
  primary_reference_app_id text,
  primary_reference_resource_kind text,
  primary_reference_resource_id text,
  published_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz,
  media jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_current_user_net_service_access('nvn');
  return query
  select unscoped.*
  from public.fetch_net_nvn_article_unscoped(requested_article_id) as unscoped;
end;
$$;

create or replace function public.fetch_net_nvn_live_desk()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_current_user_net_service_access('nvn');
  return public.fetch_net_nvn_live_desk_unscoped();
end;
$$;

create or replace function public.fetch_net_nvn_radio_tune_state()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_current_user_net_service_access('nvn');
  return public.fetch_net_nvn_radio_tune_state_unscoped();
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
  if not public.current_user_can_access_net_service('nvn') then
    return false;
  end if;

  v_payload := public.net_nvn_radio_tune_payload_at(clock_timestamp());
  return coalesce(v_payload #>> '{current,object_path}', '') = object_name;
end;
$$;

alter table public.net_os_families enable row level security;
alter table public.net_identity_os_assignments enable row level security;
alter table public.net_os_service_scopes enable row level security;

-- The assignment/scope tables are deliberately RPC-only. RLS remains enabled
-- as defense in depth even though no direct client table grants are retained.
revoke all on table public.net_os_families from public, anon, authenticated;
revoke all on table public.net_identity_os_assignments from public, anon, authenticated;
revoke all on table public.net_os_service_scopes from public, anon, authenticated;

drop policy if exists net_nvn_realtime_state_select_authenticated
  on public.net_nvn_realtime_state;
create policy net_nvn_realtime_state_select_authenticated
on public.net_nvn_realtime_state
for select
to authenticated
using (
  channel = 'public'
  and (
    public.is_current_user_gm()
    or exists (
      select 1
      from public.net_active_identities as active_identity
      where active_identity.profile_id = auth.uid()
        and public.current_user_controls_net_service_for_link(
          active_identity.identity_link_id,
          'nvn'
        )
    )
  )
);

drop policy if exists net_identity_app_installs_select_authorised
  on public.net_identity_app_installs;
create policy net_identity_app_installs_select_authorised
on public.net_identity_app_installs
for select
to authenticated
using (
  public.is_current_user_gm()
  or public.current_user_controls_net_service_for_link(
    identity_link_id,
    app_id
  )
);

drop policy if exists net_app_accounts_select_authorised
  on public.net_app_accounts;
create policy net_app_accounts_select_authorised
on public.net_app_accounts
for select
to authenticated
using (
  public.is_current_user_gm()
  or (
    identity_link_id is not null
    and public.current_user_controls_net_service_for_link(
      identity_link_id,
      app_id
    )
  )
  or entity_id is not null
  or organisation_id is not null
);

drop policy if exists net_identity_system_profiles_select_authorised
  on public.net_identity_system_profiles;
create policy net_identity_system_profiles_select_authorised
on public.net_identity_system_profiles
for select
to authenticated
using (
  public.is_current_user_gm()
  or public.current_user_controls_net_service_for_link(
    identity_link_id,
    'veil-settings'
  )
);

drop policy if exists net_wallpapers_select_authorised on storage.objects;
create policy net_wallpapers_select_authorised
on storage.objects
for select
to authenticated
using (
  bucket_id = 'net-wallpapers'
  and (
    public.is_current_user_gm()
    or public.current_user_controls_net_service_for_link(
      public.net_wallpaper_identity_link_id(name),
      'veil-settings'
    )
  )
);

drop policy if exists net_wallpapers_insert_authorised on storage.objects;
drop policy if exists net_wallpapers_insert_controlled on storage.objects;
create policy net_wallpapers_insert_controlled
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'net-wallpapers'
  and public.current_user_controls_net_service_for_link(
    public.net_wallpaper_identity_link_id(name),
    'veil-settings'
  )
);

drop policy if exists net_wallpapers_update_controlled on storage.objects;
create policy net_wallpapers_update_controlled
on storage.objects
for update
to authenticated
using (
  bucket_id = 'net-wallpapers'
  and public.current_user_controls_net_service_for_link(
    public.net_wallpaper_identity_link_id(name),
    'veil-settings'
  )
)
with check (
  bucket_id = 'net-wallpapers'
  and public.current_user_controls_net_service_for_link(
    public.net_wallpaper_identity_link_id(name),
    'veil-settings'
  )
);

drop policy if exists net_wallpapers_delete_authorised on storage.objects;
drop policy if exists net_wallpapers_delete_controlled on storage.objects;
create policy net_wallpapers_delete_controlled
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'net-wallpapers'
  and public.current_user_controls_net_service_for_link(
    public.net_wallpaper_identity_link_id(name),
    'veil-settings'
  )
);

-- Preserve every existing shared-image authorization branch while adding one
-- outer gate for NVN article objects only. Character sheets, avatars, ECHO,
-- PULSE, and other shared RPG image media retain their deployed behavior.
drop policy if exists rpg_media_select_authorised on storage.objects;
create policy rpg_media_select_authorised
on storage.objects
for select
to authenticated
using (
  bucket_id = 'rpg-media'
  and (
    split_part(name, '/', 1) <> 'nvn-article'
    or public.is_current_user_gm()
    or exists (
      select 1
      from public.net_active_identities as active_identity
      where active_identity.profile_id = auth.uid()
        and public.current_user_controls_net_service_for_link(
          active_identity.identity_link_id,
          'nvn'
        )
    )
  )
  and public.current_user_can_read_rpg_media_object(name)
);

revoke all on function public.ensure_net_identity_primary_os()
  from public, anon, authenticated;
revoke all on function public.net_identity_link_can_access_service(uuid, text)
  from public, anon, authenticated;
revoke all on function public.current_user_can_access_net_service(text)
  from public, anon, authenticated;
revoke all on function public.assert_net_identity_service_access(uuid, text)
  from public, anon, authenticated;
revoke all on function public.assert_current_user_net_service_access(text)
  from public, anon, authenticated;
revoke all on function public.enforce_net_app_account_os_scope()
  from public, anon, authenticated;
revoke all on function public.ensure_net_app_account_unscoped(uuid, text)
  from public, anon, authenticated;
revoke all on function public.create_net_app_account_unscoped(uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.ensure_net_app_account(uuid, text)
  from public, anon;
revoke all on function public.create_net_app_account(uuid, text, text, text, text)
  from public, anon;
grant execute on function public.ensure_net_app_account(uuid, text)
  to authenticated;
grant execute on function public.create_net_app_account(uuid, text, text, text, text)
  to authenticated;
revoke all on function public.assert_net_vlt_payee_access(text)
  from public, anon, authenticated;

revoke all on function public.current_user_controls_net_service_for_link(uuid, text)
  from public, anon;
grant execute on function public.current_user_controls_net_service_for_link(uuid, text)
  to authenticated;

revoke all on function public.fetch_net_current_os_session()
  from public, anon;
revoke all on function public.fetch_net_gm_identity_os(uuid)
  from public, anon;
revoke all on function public.set_net_gm_identity_primary_os(uuid, text)
  from public, anon;
grant execute on function public.fetch_net_current_os_session()
  to authenticated;
grant execute on function public.fetch_net_gm_identity_os(uuid)
  to authenticated;
grant execute on function public.set_net_gm_identity_primary_os(uuid, text)
  to authenticated;

revoke all on function public.set_net_identity_app_install(uuid, text, boolean)
  from public, anon;
revoke all on function public.set_net_identity_wallpaper(uuid, text, text, text)
  from public, anon;
revoke all on function public.clear_net_identity_wallpaper(uuid)
  from public, anon;
grant execute on function public.set_net_identity_app_install(uuid, text, boolean)
  to authenticated;
grant execute on function public.set_net_identity_wallpaper(uuid, text, text, text)
  to authenticated;
grant execute on function public.clear_net_identity_wallpaper(uuid)
  to authenticated;

revoke all on function public.fetch_net_economy_wallet(timestamptz, uuid, integer)
  from public, anon;
revoke all on function public.fetch_net_economy_wallet_v2(timestamptz, uuid, integer)
  from public, anon;
revoke all on function public.search_net_economy_payees(text, integer)
  from public, anon;
revoke all on function public.transfer_net_economy_wallet(text, bigint, text, uuid)
  from public, anon;
revoke all on function public.transfer_net_economy_wallet_v2(text, text, bigint, text, uuid)
  from public, anon;
revoke all on function public.transfer_net_economy_wallet_unscoped(text, bigint, text, uuid)
  from public, anon, authenticated;
revoke all on function public.transfer_net_economy_wallet_v2_unscoped(text, text, bigint, text, uuid)
  from public, anon, authenticated;
grant execute on function public.fetch_net_economy_wallet(timestamptz, uuid, integer)
  to authenticated;
grant execute on function public.fetch_net_economy_wallet_v2(timestamptz, uuid, integer)
  to authenticated;
grant execute on function public.search_net_economy_payees(text, integer)
  to authenticated;
grant execute on function public.transfer_net_economy_wallet(text, bigint, text, uuid)
  to authenticated;
grant execute on function public.transfer_net_economy_wallet_v2(text, text, bigint, text, uuid)
  to authenticated;

revoke all on function public.transfer_net_economy_vox_bank_unscoped(text, bigint, uuid)
  from public, anon, authenticated;
revoke all on function public.transfer_net_economy_shneider_bank_unscoped(text, bigint, uuid)
  from public, anon, authenticated;
revoke all on function public.transfer_net_economy_vox_bank(text, bigint, uuid)
  from public, anon;
revoke all on function public.transfer_net_economy_shneider_bank(text, bigint, uuid)
  from public, anon;
grant execute on function public.transfer_net_economy_vox_bank(text, bigint, uuid)
  to authenticated;
grant execute on function public.transfer_net_economy_shneider_bank(text, bigint, uuid)
  to authenticated;

revoke all on function public.fetch_net_nvn_article_page_unscoped(
  text, text, text, timestamptz, uuid, integer
) from public, anon, authenticated;
revoke all on function public.fetch_net_nvn_article_unscoped(uuid)
  from public, anon, authenticated;
revoke all on function public.fetch_net_nvn_live_desk_unscoped()
  from public, anon, authenticated;
revoke all on function public.fetch_net_nvn_radio_tune_state_unscoped()
  from public, anon, authenticated;
revoke all on function public.fetch_net_nvn_article_page(
  text, text, text, timestamptz, uuid, integer
) from public, anon;
revoke all on function public.fetch_net_nvn_article(uuid)
  from public, anon;
revoke all on function public.fetch_net_nvn_live_desk()
  from public, anon;
revoke all on function public.fetch_net_nvn_radio_tune_state()
  from public, anon;
grant execute on function public.fetch_net_nvn_article_page(
  text, text, text, timestamptz, uuid, integer
) to authenticated;
grant execute on function public.fetch_net_nvn_article(uuid)
  to authenticated;
grant execute on function public.fetch_net_nvn_live_desk()
  to authenticated;
grant execute on function public.fetch_net_nvn_radio_tune_state()
  to authenticated;

-- These shared assertions and the Storage policy helper retain only the same
-- bounded client capability required by their existing policies/RPCs.
revoke all on function public.assert_net_echo_active_identity_context(uuid)
  from public, anon, authenticated;
revoke all on function public.assert_net_echo_account_context(uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.current_user_can_read_rpg_audio_object(text)
  from public, anon;
grant execute on function public.current_user_can_read_rpg_audio_object(text)
  to authenticated;

commit;
