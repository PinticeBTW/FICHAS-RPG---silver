-- Multi-OS NPC assignment foundation.
-- Run once after the deployed Multi-OS foundation, ALTARA ecosystem, GM
-- system-control, and ALTARA Messenger migrations. This migration adds no
-- automatic NPC assignment and does not change player ownership authority.

begin;

do $$
begin
  if to_regclass('public.net_identity_links') is null
    or to_regclass('public.net_identity_os_assignments') is null
    or to_regclass('public.net_os_families') is null
    or to_regclass('public.net_os_service_scopes') is null
    or to_regclass('public.net_action_audit') is null
    or to_regclass('storage.objects') is null
    or to_regprocedure('public.net_identity_link_can_access_service(uuid,text)') is null
    or to_regprocedure('public.assert_net_identity_service_access(uuid,text)') is null
    or to_regprocedure('public.current_user_controls_playable_net_identity_link(uuid)') is null
    or to_regprocedure('public.is_current_user_gm()') is null
    or to_regprocedure('public.enforce_net_app_account_os_scope()') is null
    or to_regprocedure('public.ensure_net_app_account_unscoped(uuid,text)') is null
    or to_regprocedure('public.create_net_app_account_unscoped(uuid,text,text,text,text)') is null
    or to_regprocedure('public.fetch_net_gm_identity_os(uuid)') is null
    or to_regprocedure('public.set_net_gm_identity_primary_os(uuid,text)') is null
    or to_regprocedure('public.net_altara_effective_messenger_identity()') is null
    or to_regprocedure('public.net_altara_identity_can_use_messenger(uuid)') is null
    or to_regprocedure('public.net_altara_identity_presentation(uuid)') is null
  then
    raise exception 'NET_OS_NPC_DEPENDENCY_REQUIRED' using errcode = '55000';
  end if;
end;
$$;

-- Messenger presentations are identity-link based and deliberately do not
-- require an app-account signup. Add the missing private Storage read branch
-- for an authenticated effective Messenger actor viewing another eligible
-- Messenger identity's avatar. The bucket remains private and every other
-- media kind/path continues through the existing rpg-media policies. The
-- descriptor parser below requires the requested object to be the exact
-- display/thumbnail path in the identity's current presentation descriptor;
-- merely knowing an old or unrelated rpg-media object path grants nothing.
create or replace function public.net_altara_messenger_avatar_ref_contains_object(
  requested_identity_link_id uuid,
  requested_media_ref text,
  requested_object_name text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.net_identity_links%rowtype;
  v_encoded_payload text;
  v_decoded_payload jsonb;
  v_descriptor_hash text;
  v_variant jsonb;
  v_variant_path text;
  v_variant_mime text;
  v_variant_width bigint;
  v_variant_height bigint;
  v_variant_bytes bigint;
  v_expected_subject_kind text;
  v_expected_subject_id text;
  v_object_was_referenced boolean := false;
begin
  if requested_identity_link_id is null
    or requested_media_ref is null
    or char_length(requested_media_ref) not between 1 and 4096
    or requested_media_ref not like 'rpg-media:v1:%'
    or requested_object_name is null
    or requested_object_name = ''
    or char_length(requested_object_name) > 1024
    or requested_object_name like '%..%'
  then
    return false;
  end if;

  select identity_link.*
  into v_link
  from public.net_identity_links as identity_link
  where identity_link.id = requested_identity_link_id;

  if not found then
    return false;
  end if;

  v_encoded_payload := substr(
    requested_media_ref,
    char_length('rpg-media:v1:') + 1
  );
  if v_encoded_payload = '' or v_encoded_payload !~ '^[A-Za-z0-9_-]+$' then
    return false;
  end if;

  v_decoded_payload := convert_from(
    decode(
      translate(v_encoded_payload, '-_', '+/')
        || repeat('=', (4 - char_length(v_encoded_payload) % 4) % 4),
      'base64'
    ),
    'UTF8'
  )::jsonb;

  v_descriptor_hash := v_decoded_payload ->> 'h';
  if jsonb_typeof(v_decoded_payload) <> 'object'
    or v_decoded_payload ->> 'v' <> '1'
    or v_descriptor_hash is null
    or v_descriptor_hash !~ '^[A-Fa-f0-9]{16,64}$'
    or jsonb_typeof(v_decoded_payload -> 'd') <> 'object'
    or (
      v_decoded_payload ? 't'
      and jsonb_typeof(v_decoded_payload -> 't') <> 'object'
    )
  then
    return false;
  end if;

  for v_variant in
    select value
    from jsonb_array_elements(
      jsonb_build_array(v_decoded_payload -> 'd')
      || case
        when v_decoded_payload ? 't' then jsonb_build_array(v_decoded_payload -> 't')
        else '[]'::jsonb
      end
    )
  loop
    v_variant_path := v_variant ->> 'p';
    v_variant_mime := v_variant ->> 'm';
    v_variant_width := (v_variant ->> 'w')::bigint;
    v_variant_height := (v_variant ->> 'h')::bigint;
    v_variant_bytes := (v_variant ->> 'b')::bigint;

    if split_part(v_variant_path, '/', 1) in ('universal-profile', 'identity-link') then
      v_expected_subject_kind := split_part(v_variant_path, '/', 1);
      v_expected_subject_id := v_link.id::text;
    else
      v_expected_subject_kind := v_link.subject_kind;
      v_expected_subject_id := v_link.subject_id::text;
    end if;

    if v_variant_path is null
      or char_length(v_variant_path) not between 1 and 1024
      or v_variant_path like '%..%'
      or split_part(v_variant_path, '/', 1) <> v_expected_subject_kind
      or split_part(v_variant_path, '/', 2) <> v_expected_subject_id
      or split_part(v_variant_path, '/', 3) <> 'avatar'
      or split_part(v_variant_path, '/', 4) !~ '^[a-z0-9][a-z0-9_-]{0,127}$'
      or split_part(v_variant_path, '/', 5) <> left(lower(v_descriptor_hash), 32)
      or split_part(v_variant_path, '/', 6) !~ '^(display|thumbnail)\.(jpg|jpeg|png|webp|gif|avif)$'
      or split_part(v_variant_path, '/', 7) <> ''
      or v_variant_mime not in (
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'image/avif'
      )
      or v_variant_width not between 1 and 64000000
      or v_variant_height not between 1 and 64000000
      or v_variant_bytes not between 1 and 20971520
    then
      return false;
    end if;

    if v_variant_path = requested_object_name then
      v_object_was_referenced := true;
    end if;
  end loop;

  return v_object_was_referenced;
exception
  when others then
    return false;
end;
$$;

create or replace function public.current_user_can_read_net_altara_messenger_avatar(
  requested_object_name text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.net_altara_effective_messenger_identity() is not null
    and exists (
      select 1
      from public.net_identity_links as identity_link
      where public.net_altara_identity_can_use_messenger(identity_link.id)
        and public.net_altara_messenger_avatar_ref_contains_object(
          identity_link.id,
          public.net_altara_identity_presentation(identity_link.id) ->> 'avatar_url',
          requested_object_name
        )
    );
$$;

drop policy if exists net_altara_messenger_avatar_select on storage.objects;
create policy net_altara_messenger_avatar_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'rpg-media'
  and public.current_user_can_read_net_altara_messenger_avatar(name)
);

-- This predicate describes identity capability only. Actor authority remains
-- separate: player RPCs still require the existing controlled playable-player
-- checks, while GM NPC actions must use their own GM-authoritative boundary.
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
      and (
        (
          identity_link.identity_kind = 'player'
          and identity_link.playability = 'playable'
        )
        or (
          identity_link.identity_kind = 'npc'
          and identity_link.playability = 'non-playable'
        )
      )
      and (
        service_scope.scope_kind = 'global'
        or (
          service_scope.scope_kind = 'primary-os'
          and assignment.primary_os_id = service_scope.required_os_id
        )
      )
  );
$$;

-- Capability is never actor authority. Re-state the app-account mutation
-- boundaries here so the widened NPC capability cannot become sufficient even
-- if an internal implementation changes later. Authenticated non-GM callers
-- must control the exact playable/player link before capability is evaluated.
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

  if new.identity_link_id is null
    or not public.current_user_controls_playable_net_identity_link(
      new.identity_link_id
    )
  then
    raise exception 'The requested playable identity is not controlled by this account.'
      using errcode = '42501';
  end if;

  perform public.assert_net_identity_service_access(
    new.identity_link_id,
    new.app_id
  );
  return new;
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
  if auth.uid() is null
    or requested_identity_link_id is null
    or not public.current_user_controls_playable_net_identity_link(
      requested_identity_link_id
    )
  then
    raise exception 'The requested playable identity is not controlled by this account.'
      using errcode = '42501';
  end if;

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
  if auth.uid() is null
    or requested_identity_link_id is null
    or not public.current_user_controls_playable_net_identity_link(
      requested_identity_link_id
    )
  then
    raise exception 'The requested playable identity is not controlled by this account.'
      using errcode = '42501';
  end if;

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

-- Explicit provisioning only. Reading GM Settings never creates a link, and
-- this function never promotes an NPC into a playable/player identity.
create or replace function public.enable_net_gm_npc_network_identity(
  requested_npc_card_id uuid
)
returns public.net_identity_links
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_link public.net_identity_links%rowtype;
  v_created boolean := false;
begin
  if v_actor is null or not public.is_current_user_gm() then
    raise exception 'NET_OS_GM_REQUIRED' using errcode = '42501';
  end if;

  perform 1
  from public.npc_cards as card
  where card.id = requested_npc_card_id
  for share;

  if not found then
    raise exception 'NET_OS_NPC_CARD_REQUIRED' using errcode = '22023';
  end if;

  insert into public.net_identity_links (
    subject_kind,
    subject_id,
    entity_id,
    identity_kind,
    playability
  ) values (
    'npc-card',
    requested_npc_card_id,
    null,
    'npc',
    'non-playable'
  )
  on conflict (subject_kind, subject_id) do nothing
  returning * into v_link;

  v_created := found;

  if not v_created then
    select identity_link.*
    into v_link
    from public.net_identity_links as identity_link
    where identity_link.subject_kind = 'npc-card'
      and identity_link.subject_id = requested_npc_card_id
    for update;
  end if;

  if not found
    or v_link.identity_kind <> 'npc'
    or v_link.playability <> 'non-playable'
  then
    raise exception 'NET_OS_NPC_IDENTITY_CONFLICT' using errcode = '23514';
  end if;

  if v_created then
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
      'npc-card',
      requested_npc_card_id,
      'system',
      'net.identity.network.enable',
      'authenticated-gm',
      'net-identity-link',
      v_link.id
    );
  end if;

  return v_link;
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
  v_link public.net_identity_links%rowtype;
  v_assignment public.net_identity_os_assignments%rowtype;
  v_has_assignment boolean := false;
begin
  if auth.uid() is null or not public.is_current_user_gm() then
    raise exception 'NET_OS_GM_REQUIRED' using errcode = '42501';
  end if;

  select identity_link.*
  into v_link
  from public.net_identity_links as identity_link
  where identity_link.id = requested_identity_link_id;

  if not found
    or not (
      (v_link.identity_kind = 'player' and v_link.playability = 'playable')
      or (v_link.identity_kind = 'npc' and v_link.playability = 'non-playable')
    )
  then
    raise exception 'NET_OS_NETWORK_IDENTITY_REQUIRED' using errcode = '22023';
  end if;

  select assignment.*
  into v_assignment
  from public.net_identity_os_assignments as assignment
  where assignment.identity_link_id = v_link.id;

  v_has_assignment := found;

  if not v_has_assignment and v_link.identity_kind = 'player' then
    raise exception 'NET_PRIMARY_OS_ASSIGNMENT_MISSING' using errcode = '55000';
  end if;

  return jsonb_build_object(
    'identity_link_id', v_link.id,
    'primary_os_id', case when v_has_assignment then v_assignment.primary_os_id else null end,
    'updated_at', case when v_has_assignment then v_assignment.updated_at else v_link.updated_at end
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
  v_normalized_os_id text := nullif(lower(btrim(coalesce(requested_primary_os_id, ''))), '');
  v_has_assignment boolean := false;
  v_changed boolean := false;
  v_updated_at timestamptz;
begin
  if v_actor is null or not public.is_current_user_gm() then
    raise exception 'NET_OS_GM_REQUIRED' using errcode = '42501';
  end if;

  select identity_link.*
  into v_link
  from public.net_identity_links as identity_link
  where identity_link.id = requested_identity_link_id
  for update;

  if not found
    or not (
      (v_link.identity_kind = 'player' and v_link.playability = 'playable')
      or (v_link.identity_kind = 'npc' and v_link.playability = 'non-playable')
    )
  then
    raise exception 'NET_OS_NETWORK_IDENTITY_REQUIRED' using errcode = '22023';
  end if;

  if v_normalized_os_id is null and v_link.identity_kind = 'player' then
    raise exception 'NET_OS_PLAYER_ASSIGNMENT_REQUIRED' using errcode = '22023';
  end if;

  if v_normalized_os_id is not null and not exists (
    select 1
    from public.net_os_families as os_family
    where os_family.id = v_normalized_os_id
      and os_family.status = 'active'
  ) then
    raise exception 'NET_OS_UNSUPPORTED' using errcode = '22023';
  end if;

  select assignment.*
  into v_assignment
  from public.net_identity_os_assignments as assignment
  where assignment.identity_link_id = v_link.id
  for update;

  v_has_assignment := found;

  if v_normalized_os_id is null then
    if v_has_assignment then
      delete from public.net_identity_os_assignments as assignment
      where assignment.identity_link_id = v_link.id;
      v_changed := true;
      v_has_assignment := false;
    end if;
    v_updated_at := timezone('utc', now());
  elsif not v_has_assignment then
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
    returning * into v_assignment;
    v_has_assignment := true;
    v_changed := true;
    v_updated_at := v_assignment.updated_at;
  elsif v_assignment.primary_os_id is distinct from v_normalized_os_id then
    update public.net_identity_os_assignments as assignment
    set
      primary_os_id = v_normalized_os_id,
      assignment_basis = 'gm',
      assigned_by_profile_id = v_actor
    where assignment.identity_link_id = v_link.id
    returning assignment.* into v_assignment;
    v_changed := true;
    v_updated_at := v_assignment.updated_at;
  else
    v_updated_at := v_assignment.updated_at;
  end if;

  if v_changed then
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
    'identity_link_id', v_link.id,
    'primary_os_id', case when v_has_assignment then v_assignment.primary_os_id else null end,
    'updated_at', coalesce(v_updated_at, v_link.updated_at)
  );
end;
$$;

revoke all on function public.net_identity_link_can_access_service(uuid, text)
  from public, anon, authenticated;
revoke all on function public.assert_net_identity_service_access(uuid, text)
  from public, anon, authenticated;
revoke all on function public.enforce_net_app_account_os_scope()
  from public, anon, authenticated;
revoke all on function public.ensure_net_app_account_unscoped(uuid, text)
  from public, anon, authenticated;
revoke all on function public.create_net_app_account_unscoped(uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.net_altara_messenger_avatar_ref_contains_object(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.current_user_can_read_net_altara_messenger_avatar(text)
  from public, anon;
revoke all on function public.enable_net_gm_npc_network_identity(uuid)
  from public, anon, authenticated;
revoke all on function public.fetch_net_gm_identity_os(uuid)
  from public, anon;
revoke all on function public.set_net_gm_identity_primary_os(uuid, text)
  from public, anon;

grant execute on function public.enable_net_gm_npc_network_identity(uuid)
  to authenticated;
revoke all on function public.ensure_net_app_account(uuid, text)
  from public, anon;
revoke all on function public.create_net_app_account(uuid, text, text, text, text)
  from public, anon;
grant execute on function public.ensure_net_app_account(uuid, text)
  to authenticated;
grant execute on function public.create_net_app_account(uuid, text, text, text, text)
  to authenticated;
grant execute on function public.current_user_can_read_net_altara_messenger_avatar(text)
  to authenticated;
grant execute on function public.fetch_net_gm_identity_os(uuid)
  to authenticated;
grant execute on function public.set_net_gm_identity_primary_os(uuid, text)
  to authenticated;

commit;
