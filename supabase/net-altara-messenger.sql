-- ALTARA Messenger V1: identity-backed direct and group text communication.
-- Run once after the deployed Multi-OS, ALTARA ecosystem, and GM control
-- migrations. This migration creates no app accounts and changes no OS,
-- economy, installation, wallpaper, or existing application data.

begin;

do $$
begin
  if to_regclass('public.net_identity_links') is null
    or to_regclass('public.net_active_identities') is null
    or to_regclass('public.net_identity_os_assignments') is null
    or to_regclass('public.net_os_service_scopes') is null
    or to_regclass('public.net_gm_persona_sessions') is null
    or to_regclass('public.net_universal_profiles') is null
    or to_regclass('public.character_sheet_forms') is null
    or to_regclass('public.npc_cards') is null
    or to_regclass('public.characters') is null
    or to_regprocedure('public.net_identity_link_can_access_service(uuid,text)') is null
    or to_regprocedure('public.current_user_controls_playable_net_identity_link(uuid)') is null
    or to_regprocedure('public.is_current_user_gm()') is null
    or to_regprocedure('public.set_updated_at()') is null
  then
    raise exception 'ALTARA_MESSENGER_DEPENDENCY_REVIEW_REQUIRED' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from public.net_os_service_scopes as service_scope
    where service_scope.service_id = 'altara-messenger'
      and service_scope.scope_kind = 'primary-os'
      and service_scope.required_os_id = 'altara'
  ) then
    raise exception 'ALTARA_MESSENGER_SERVICE_SCOPE_REVIEW_REQUIRED' using errcode = '23514';
  end if;

  if to_regclass('public.net_altara_conversations') is not null
    or to_regclass('public.net_altara_conversation_members') is not null
    or to_regclass('public.net_altara_messages') is not null
    or to_regclass('public.net_altara_messenger_realtime_state') is not null
  then
    raise exception 'ALTARA_MESSENGER_SCHEMA_COLLISION_REVIEW_REQUIRED' using errcode = '42P07';
  end if;
end;
$$;

create table public.net_altara_conversations (
  id uuid primary key default gen_random_uuid(),
  conversation_kind text not null,
  title text,
  created_by_identity_link_id uuid
    references public.net_identity_links (id) on delete set null,
  direct_identity_a uuid
    references public.net_identity_links (id) on delete cascade,
  direct_identity_b uuid
    references public.net_identity_links (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint net_altara_conversations_kind_valid
    check (conversation_kind in ('direct', 'group')),
  constraint net_altara_conversations_shape_valid check (
    (
      conversation_kind = 'direct'
      and title is null
      and direct_identity_a is not null
      and direct_identity_b is not null
      and direct_identity_a < direct_identity_b
    )
    or
    (
      conversation_kind = 'group'
      and title is not null
      and title = btrim(title)
      and char_length(title) between 1 and 80
      and direct_identity_a is null
      and direct_identity_b is null
    )
  )
);

create unique index net_altara_conversations_direct_pair_uidx
  on public.net_altara_conversations (direct_identity_a, direct_identity_b)
  where conversation_kind = 'direct';

create index net_altara_conversations_updated_idx
  on public.net_altara_conversations (updated_at desc, id desc);

create table public.net_altara_conversation_members (
  conversation_id uuid not null
    references public.net_altara_conversations (id) on delete cascade,
  identity_link_id uuid not null
    references public.net_identity_links (id) on delete cascade,
  member_role text not null default 'member',
  joined_at timestamptz not null default timezone('utc', now()),
  last_read_at timestamptz not null default timezone('utc', now()),
  last_read_message_id uuid,
  primary key (conversation_id, identity_link_id),
  constraint net_altara_conversation_members_role_valid
    check (member_role in ('owner', 'member'))
);

create index net_altara_conversation_members_identity_idx
  on public.net_altara_conversation_members (identity_link_id, conversation_id);

create table public.net_altara_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.net_altara_conversations (id) on delete cascade,
  author_identity_link_id uuid
    not null references public.net_identity_links (id) on delete restrict,
  request_key uuid not null,
  body text not null,
  created_at timestamptz not null default timezone('utc', clock_timestamp()),
  constraint net_altara_messages_body_valid check (
    body = btrim(body)
    and char_length(body) between 1 and 4000
  ),
  unique (author_identity_link_id, request_key)
);

create index net_altara_messages_page_idx
  on public.net_altara_messages (conversation_id, created_at desc, id desc);

create index net_altara_messages_author_recent_idx
  on public.net_altara_messages (
    author_identity_link_id,
    created_at desc,
    id desc
  );

create table public.net_altara_messenger_realtime_state (
  identity_link_id uuid primary key
    references public.net_identity_links (id) on delete cascade,
  revision bigint not null default 0,
  updated_at timestamptz not null default timezone('utc', clock_timestamp()),
  constraint net_altara_messenger_realtime_revision_valid check (revision >= 0)
);

comment on table public.net_altara_conversations is
  'ALTARA Messenger direct and group conversation metadata. Identity links, not app accounts, are membership authority.';
comment on table public.net_altara_messages is
  'Text-only ALTARA Messenger history. Clients read and append exclusively through bounded RPCs.';
comment on column public.net_altara_conversation_members.last_read_message_id is
  'Deterministic tie-break for the read cursor. Intentionally not a foreign key so future message lifecycle changes cannot mutate or cascade membership read state.';
comment on table public.net_altara_messenger_realtime_state is
  'Private metadata-free invalidation row per effective Messenger identity. No message, conversation, or member data is broadcast.';

drop trigger if exists net_altara_conversations_set_updated_at
  on public.net_altara_conversations;
create trigger net_altara_conversations_set_updated_at
before update on public.net_altara_conversations
for each row execute procedure public.set_updated_at();

create or replace function public.net_altara_identity_can_use_messenger(
  requested_identity_link_id uuid
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
    where identity_link.id = requested_identity_link_id
      and identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
      and public.net_identity_link_can_access_service(
        identity_link.id,
        'altara-messenger'
      )
  );
$$;

create or replace function public.net_altara_effective_messenger_identity()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.app_role;
  v_identity_link_id uuid;
begin
  if v_actor is null then
    return null;
  end if;

  select profile.role
  into v_role
  from public.profiles as profile
  where profile.id = v_actor;

  if not found then
    return null;
  end if;

  if v_role = 'gm' then
    select identity_link.id
    into v_identity_link_id
    from public.net_gm_persona_sessions as gm_session
    join public.net_identity_links as identity_link
      on identity_link.subject_kind = gm_session.subject_kind
      and identity_link.subject_id = gm_session.subject_id
      and identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
    where gm_session.gm_profile_id = v_actor
      and gm_session.mode = 'take-control';
  else
    select identity_link.id
    into v_identity_link_id
    from public.net_active_identities as active_identity
    join public.net_identity_links as identity_link
      on identity_link.id = active_identity.identity_link_id
      and identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
    where active_identity.profile_id = v_actor
      and public.current_user_controls_playable_net_identity_link(identity_link.id);
  end if;

  if v_identity_link_id is null
    or not public.net_altara_identity_can_use_messenger(v_identity_link_id)
  then
    return null;
  end if;

  return v_identity_link_id;
end;
$$;

create or replace function public.net_altara_assert_messenger_context(
  requested_expected_identity_link_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
begin
  if auth.uid() is null then
    raise exception 'ALTARA_MESSENGER_AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_identity_link_id := public.net_altara_effective_messenger_identity();
  if v_identity_link_id is null then
    raise exception 'ALTARA_MESSENGER_IDENTITY_REQUIRED' using errcode = '42501';
  end if;
  if requested_expected_identity_link_id is null
    or requested_expected_identity_link_id is distinct from v_identity_link_id
  then
    raise exception 'ALTARA_MESSENGER_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;

  return v_identity_link_id;
end;
$$;

create or replace function public.net_altara_identity_presentation(
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
  v_name text;
  v_avatar_url text;
begin
  select identity_link.*
  into v_link
  from public.net_identity_links as identity_link
  where identity_link.id = requested_identity_link_id;

  if not found then
    return jsonb_build_object(
      'identity_link_id', requested_identity_link_id,
      'display_name', 'Former ALTARA identity',
      'avatar_url', null
    );
  end if;

  select
    nullif(btrim(universal_profile.display_name_override), ''),
    nullif(btrim(universal_profile.avatar_url_override), '')
  into v_name, v_avatar_url
  from public.net_universal_profiles as universal_profile
  where universal_profile.identity_link_id = v_link.id;

  case v_link.subject_kind
    when 'profile-sheet' then
      select
        coalesce(
          v_name,
          nullif(btrim(sheet.field_data ->> 'NOME'), ''),
          nullif(btrim(profile.display_name), ''),
          nullif(btrim(profile.handle), '')
        ),
        coalesce(
          v_avatar_url,
          nullif(btrim(sheet.field_data ->> 'FOTO2'), ''),
          nullif(btrim(sheet.field_data ->> 'FOTO'), ''),
          nullif(btrim(profile.avatar_url), '')
        )
      into v_name, v_avatar_url
      from public.profiles as profile
      left join public.character_sheet_forms as sheet
        on sheet.profile_id = profile.id
      where profile.id = v_link.subject_id;

    when 'npc-card' then
      select
        coalesce(
          v_name,
          nullif(btrim(card.field_data ->> 'NOME'), ''),
          nullif(btrim(card.display_name), '')
        ),
        coalesce(
          v_avatar_url,
          nullif(btrim(card.field_data ->> 'FOTO2'), ''),
          nullif(btrim(card.field_data ->> 'FOTO'), '')
        )
      into v_name, v_avatar_url
      from public.npc_cards as card
      where card.id = v_link.subject_id;

    when 'character' then
      select
        coalesce(
          v_name,
          nullif(btrim(character.alias), ''),
          nullif(btrim(character.name), '')
        ),
        coalesce(v_avatar_url, nullif(btrim(character.portrait_url), ''))
      into v_name, v_avatar_url
      from public.characters as character
      where character.id = v_link.subject_id;
  end case;

  if v_avatar_url is not null
    and (
      char_length(v_avatar_url) > 2048
      or lower(v_avatar_url) like 'data:%'
    )
  then
    v_avatar_url := null;
  end if;

  return jsonb_build_object(
    'identity_link_id', v_link.id,
    'display_name', left(coalesce(v_name, 'ALTARA identity'), 160),
    'avatar_url', v_avatar_url
  );
end;
$$;

create or replace function public.net_altara_conversation_members_json(
  requested_conversation_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'identity', presentation.value,
        'role', member_row.member_role,
        'available', public.net_altara_identity_can_use_messenger(
          member_row.identity_link_id
        )
      )
      order by
        case member_row.member_role when 'owner' then 0 else 1 end,
        lower(presentation.value ->> 'display_name'),
        member_row.identity_link_id
    ),
    '[]'::jsonb
  )
  from public.net_altara_conversation_members as member_row
  cross join lateral (
    select public.net_altara_identity_presentation(
      member_row.identity_link_id
    ) as value
  ) as presentation
  where member_row.conversation_id = requested_conversation_id;
$$;

create or replace function public.net_altara_bump_messenger_revisions(
  requested_identity_link_ids uuid[]
)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  insert into public.net_altara_messenger_realtime_state (
    identity_link_id,
    revision,
    updated_at
  )
  select distinct
    identity_id,
    1,
    timezone('utc', clock_timestamp())
  from unnest(coalesce(requested_identity_link_ids, '{}'::uuid[])) as identity_id
  where identity_id is not null
  on conflict (identity_link_id) do update
  set
    revision = public.net_altara_messenger_realtime_state.revision + 1,
    updated_at = excluded.updated_at;
$$;

create or replace function public.current_user_can_read_net_altara_messenger_revision(
  requested_identity_link_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select requested_identity_link_id is not null
    and requested_identity_link_id = public.net_altara_effective_messenger_identity();
$$;

create or replace function public.fetch_net_altara_messenger_sidebar(
  requested_expected_identity_link_id uuid,
  requested_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_limit integer := greatest(1, least(coalesce(requested_limit, 50), 50));
  v_conversations jsonb;
begin
  if auth.uid() is null then
    raise exception 'ALTARA_MESSENGER_AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_identity_link_id := public.net_altara_effective_messenger_identity();
  if v_identity_link_id is null then
    if public.is_current_user_gm() then
      return jsonb_build_object(
        'status', 'identity-required',
        'reason', 'TAKE CONTROL of an ALTARA identity to access personal communications.',
        'identity', null,
        'conversations', '[]'::jsonb
      );
    end if;
    raise exception 'ALTARA_MESSENGER_ACCESS_DENIED' using errcode = '42501';
  end if;
  if requested_expected_identity_link_id is null
    or requested_expected_identity_link_id is distinct from v_identity_link_id
  then
    raise exception 'ALTARA_MESSENGER_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;

  with conversation_page as (
    select
      conversation.id,
      conversation.conversation_kind,
      conversation.title,
      conversation.direct_identity_a,
      conversation.direct_identity_b,
      conversation.created_at,
      conversation.updated_at,
      membership.member_role,
      membership.last_read_at,
      membership.last_read_message_id
    from public.net_altara_conversation_members as membership
    join public.net_altara_conversations as conversation
      on conversation.id = membership.conversation_id
    where membership.identity_link_id = v_identity_link_id
    order by conversation.updated_at desc, conversation.id desc
    limit v_limit
  ), hydrated as (
    select
      conversation_page.*,
      case
        when conversation_page.conversation_kind = 'direct'
          and conversation_page.direct_identity_a = v_identity_link_id
          then conversation_page.direct_identity_b
        when conversation_page.conversation_kind = 'direct'
          then conversation_page.direct_identity_a
        else null
      end as direct_recipient_id,
      latest.id as latest_message_id,
      latest.body as latest_message_body,
      latest.created_at as latest_message_at,
      latest.author_identity_link_id as latest_author_id,
      coalesce(unread.value, 0) as unread_count,
      public.net_altara_conversation_members_json(
        conversation_page.id
      ) as members,
      not exists (
        select 1
        from public.net_altara_conversation_members as current_member
        where current_member.conversation_id = conversation_page.id
          and not public.net_altara_identity_can_use_messenger(
            current_member.identity_link_id
          )
      ) as can_send
    from conversation_page
    left join lateral (
      select message.*
      from public.net_altara_messages as message
      where message.conversation_id = conversation_page.id
      order by message.created_at desc, message.id desc
      limit 1
    ) as latest on true
    left join lateral (
      select count(*)::integer as value
      from (
        select 1
        from public.net_altara_messages as unread_message
        where unread_message.conversation_id = conversation_page.id
          and (
            unread_message.created_at > conversation_page.last_read_at
            or (
              unread_message.created_at = conversation_page.last_read_at
              and (
                conversation_page.last_read_message_id is null
                or unread_message.id > conversation_page.last_read_message_id
              )
            )
          )
          and unread_message.author_identity_link_id is distinct from v_identity_link_id
        order by unread_message.created_at, unread_message.id
        limit 100
      ) as bounded_unread
    ) as unread on true
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'conversation_id', hydrated.id,
        'kind', hydrated.conversation_kind,
        'title', case
          when hydrated.conversation_kind = 'group' then hydrated.title
          else direct_presentation.value ->> 'display_name'
        end,
        'avatar_url', case
          when hydrated.conversation_kind = 'direct'
            then direct_presentation.value ->> 'avatar_url'
          else null
        end,
        'direct_recipient', case
          when hydrated.conversation_kind = 'direct' then direct_presentation.value
          else null
        end,
        'role', hydrated.member_role,
        'members', hydrated.members,
        'member_count', jsonb_array_length(hydrated.members),
        'can_send', hydrated.can_send,
        'latest_message', case
          when hydrated.latest_message_id is null then null
          else jsonb_build_object(
            'message_id', hydrated.latest_message_id,
            'body', left(hydrated.latest_message_body, 180),
            'created_at', hydrated.latest_message_at,
            'author', public.net_altara_identity_presentation(
              hydrated.latest_author_id
            ),
            'mine', hydrated.latest_author_id = v_identity_link_id
          )
        end,
        'unread_count', least(hydrated.unread_count, 99),
        'unread_capped', hydrated.unread_count >= 100,
        'created_at', hydrated.created_at,
        'updated_at', hydrated.updated_at
      )
      order by hydrated.updated_at desc, hydrated.id desc
    ),
    '[]'::jsonb
  )
  into v_conversations
  from hydrated
  left join lateral (
    select public.net_altara_identity_presentation(
      hydrated.direct_recipient_id
    ) as value
  ) as direct_presentation
    on hydrated.direct_recipient_id is not null;

  return jsonb_build_object(
    'status', 'ready',
    'identity', public.net_altara_identity_presentation(v_identity_link_id),
    'conversations', v_conversations
  );
end;
$$;

create or replace function public.search_net_altara_messenger_recipients(
  requested_expected_identity_link_id uuid,
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
  v_limit integer := greatest(1, least(coalesce(requested_limit, 20), 20));
  v_results jsonb;
begin
  v_identity_link_id := public.net_altara_assert_messenger_context(
    requested_expected_identity_link_id
  );

  if v_query = '' then
    return '[]'::jsonb;
  end if;

  with eligible as (
    select
      identity_link.id,
      presentation.value
    from public.net_identity_links as identity_link
    cross join lateral (
      select public.net_altara_identity_presentation(identity_link.id) as value
    ) as presentation
    where identity_link.identity_kind = 'player'
      and identity_link.playability = 'playable'
      and identity_link.id <> v_identity_link_id
      and public.net_altara_identity_can_use_messenger(identity_link.id)
      and lower(presentation.value ->> 'display_name') like '%' || v_query || '%'
    order by lower(presentation.value ->> 'display_name'), identity_link.id
    limit v_limit
  )
  select coalesce(jsonb_agg(eligible.value), '[]'::jsonb)
  into v_results
  from eligible;

  return v_results;
end;
$$;

create or replace function public.ensure_net_altara_direct_conversation(
  requested_expected_identity_link_id uuid,
  requested_recipient_identity_link_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_identity_link_id uuid;
  v_identity_a uuid;
  v_identity_b uuid;
  v_conversation_id uuid;
  v_created boolean := false;
begin
  v_actor_identity_link_id := public.net_altara_assert_messenger_context(
    requested_expected_identity_link_id
  );

  if requested_recipient_identity_link_id is null
    or requested_recipient_identity_link_id = v_actor_identity_link_id
    or not public.net_altara_identity_can_use_messenger(
      requested_recipient_identity_link_id
    )
  then
    raise exception 'ALTARA_MESSENGER_RECIPIENT_UNAVAILABLE' using errcode = '22023';
  end if;

  if v_actor_identity_link_id < requested_recipient_identity_link_id then
    v_identity_a := v_actor_identity_link_id;
    v_identity_b := requested_recipient_identity_link_id;
  else
    v_identity_a := requested_recipient_identity_link_id;
    v_identity_b := v_actor_identity_link_id;
  end if;

  insert into public.net_altara_conversations (
    conversation_kind,
    created_by_identity_link_id,
    direct_identity_a,
    direct_identity_b
  ) values (
    'direct',
    v_actor_identity_link_id,
    v_identity_a,
    v_identity_b
  )
  on conflict (direct_identity_a, direct_identity_b)
    where conversation_kind = 'direct'
  do nothing
  returning id into v_conversation_id;

  if v_conversation_id is not null then
    v_created := true;
  else
    select conversation.id
    into v_conversation_id
    from public.net_altara_conversations as conversation
    where conversation.conversation_kind = 'direct'
      and conversation.direct_identity_a = v_identity_a
      and conversation.direct_identity_b = v_identity_b;
  end if;

  if v_conversation_id is null then
    raise exception 'ALTARA_MESSENGER_DIRECT_CONVERSATION_UNAVAILABLE'
      using errcode = '55000';
  end if;

  insert into public.net_altara_conversation_members (
    conversation_id,
    identity_link_id,
    member_role
  ) values
    (v_conversation_id, v_identity_a, 'member'),
    (v_conversation_id, v_identity_b, 'member')
  on conflict (conversation_id, identity_link_id) do nothing;

  if v_created then
    perform public.net_altara_bump_messenger_revisions(
      array[v_identity_a, v_identity_b]
    );
  end if;

  return jsonb_build_object(
    'conversation_id', v_conversation_id,
    'created', v_created
  );
end;
$$;

create or replace function public.create_net_altara_group(
  requested_expected_identity_link_id uuid,
  requested_title text,
  requested_member_identity_link_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_identity_link_id uuid;
  v_title text := btrim(coalesce(requested_title, ''));
  v_member_ids uuid[];
  v_conversation_id uuid;
begin
  v_actor_identity_link_id := public.net_altara_assert_messenger_context(
    requested_expected_identity_link_id
  );

  if char_length(v_title) < 1 or char_length(v_title) > 80 then
    raise exception 'ALTARA_MESSENGER_GROUP_TITLE_INVALID' using errcode = '22023';
  end if;

  select coalesce(array_agg(member_id order by member_id), '{}'::uuid[])
  into v_member_ids
  from (
    select distinct requested_member_id as member_id
    from unnest(coalesce(requested_member_identity_link_ids, '{}'::uuid[]))
      as requested_member_id
    where requested_member_id is not null
      and requested_member_id <> v_actor_identity_link_id
  ) as requested_members;

  if coalesce(array_length(v_member_ids, 1), 0) < 1 then
    raise exception 'ALTARA_MESSENGER_GROUP_MEMBER_REQUIRED' using errcode = '22023';
  end if;
  if coalesce(array_length(v_member_ids, 1), 0) > 15 then
    raise exception 'ALTARA_MESSENGER_GROUP_SIZE_EXCEEDED' using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(v_member_ids) as member_id
    where not public.net_altara_identity_can_use_messenger(member_id)
  ) then
    raise exception 'ALTARA_MESSENGER_GROUP_MEMBER_UNAVAILABLE' using errcode = '22023';
  end if;

  insert into public.net_altara_conversations (
    conversation_kind,
    title,
    created_by_identity_link_id
  ) values (
    'group',
    v_title,
    v_actor_identity_link_id
  )
  returning id into v_conversation_id;

  insert into public.net_altara_conversation_members (
    conversation_id,
    identity_link_id,
    member_role
  ) values (
    v_conversation_id,
    v_actor_identity_link_id,
    'owner'
  );

  insert into public.net_altara_conversation_members (
    conversation_id,
    identity_link_id,
    member_role
  )
  select v_conversation_id, member_id, 'member'
  from unnest(v_member_ids) as member_id;

  perform public.net_altara_bump_messenger_revisions(
    array[v_actor_identity_link_id] || v_member_ids
  );

  return jsonb_build_object('conversation_id', v_conversation_id);
end;
$$;

create or replace function public.rename_net_altara_group(
  requested_expected_identity_link_id uuid,
  requested_conversation_id uuid,
  requested_title text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_identity_link_id uuid;
  v_title text := btrim(coalesce(requested_title, ''));
  v_current_title text;
begin
  v_actor_identity_link_id := public.net_altara_assert_messenger_context(
    requested_expected_identity_link_id
  );
  if char_length(v_title) < 1 or char_length(v_title) > 80 then
    raise exception 'ALTARA_MESSENGER_GROUP_TITLE_INVALID' using errcode = '22023';
  end if;

  select conversation.title
  into v_current_title
  from public.net_altara_conversations as conversation
  join public.net_altara_conversation_members as membership
    on membership.conversation_id = conversation.id
    and membership.identity_link_id = v_actor_identity_link_id
    and membership.member_role = 'owner'
  where conversation.id = requested_conversation_id
    and conversation.conversation_kind = 'group'
  for update of conversation;

  if not found then
    raise exception 'ALTARA_MESSENGER_GROUP_OWNER_REQUIRED' using errcode = '42501';
  end if;

  if v_current_title is distinct from v_title then
    update public.net_altara_conversations
    set title = v_title
    where id = requested_conversation_id;

    perform public.net_altara_bump_messenger_revisions(array(
      select member_row.identity_link_id
      from public.net_altara_conversation_members as member_row
      where member_row.conversation_id = requested_conversation_id
    ));
  end if;

  return jsonb_build_object(
    'conversation_id', requested_conversation_id,
    'title', v_title
  );
end;
$$;

create or replace function public.add_net_altara_group_members(
  requested_expected_identity_link_id uuid,
  requested_conversation_id uuid,
  requested_member_identity_link_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_identity_link_id uuid;
  v_member_ids uuid[];
  v_existing_count integer;
  v_new_count integer;
begin
  v_actor_identity_link_id := public.net_altara_assert_messenger_context(
    requested_expected_identity_link_id
  );

  perform 1
  from public.net_altara_conversations as conversation
  join public.net_altara_conversation_members as membership
    on membership.conversation_id = conversation.id
    and membership.identity_link_id = v_actor_identity_link_id
    and membership.member_role = 'owner'
  where conversation.id = requested_conversation_id
    and conversation.conversation_kind = 'group'
  for update of conversation;

  if not found then
    raise exception 'ALTARA_MESSENGER_GROUP_OWNER_REQUIRED' using errcode = '42501';
  end if;

  select coalesce(array_agg(member_id order by member_id), '{}'::uuid[])
  into v_member_ids
  from (
    select distinct requested_member_id as member_id
    from unnest(coalesce(requested_member_identity_link_ids, '{}'::uuid[]))
      as requested_member_id
    where requested_member_id is not null
      and requested_member_id <> v_actor_identity_link_id
  ) as requested_members;

  if coalesce(array_length(v_member_ids, 1), 0) = 0 then
    return jsonb_build_object(
      'conversation_id', requested_conversation_id,
      'added_count', 0
    );
  end if;
  if exists (
    select 1
    from unnest(v_member_ids) as member_id
    where not public.net_altara_identity_can_use_messenger(member_id)
  ) then
    raise exception 'ALTARA_MESSENGER_GROUP_MEMBER_UNAVAILABLE' using errcode = '22023';
  end if;

  select count(*)::integer
  into v_existing_count
  from public.net_altara_conversation_members as member_row
  where member_row.conversation_id = requested_conversation_id;

  select count(*)::integer
  into v_new_count
  from unnest(v_member_ids) as member_id
  where not exists (
    select 1
    from public.net_altara_conversation_members as existing_member
    where existing_member.conversation_id = requested_conversation_id
      and existing_member.identity_link_id = member_id
  );

  if v_existing_count + v_new_count > 16 then
    raise exception 'ALTARA_MESSENGER_GROUP_SIZE_EXCEEDED' using errcode = '22023';
  end if;

  insert into public.net_altara_conversation_members (
    conversation_id,
    identity_link_id,
    member_role
  )
  select requested_conversation_id, member_id, 'member'
  from unnest(v_member_ids) as member_id
  on conflict (conversation_id, identity_link_id) do nothing;

  if v_new_count > 0 then
    update public.net_altara_conversations
    set updated_at = timezone('utc', clock_timestamp())
    where id = requested_conversation_id;

    perform public.net_altara_bump_messenger_revisions(array(
      select member_row.identity_link_id
      from public.net_altara_conversation_members as member_row
      where member_row.conversation_id = requested_conversation_id
    ));
  end if;

  return jsonb_build_object(
    'conversation_id', requested_conversation_id,
    'added_count', v_new_count
  );
end;
$$;

create or replace function public.remove_net_altara_group_member(
  requested_expected_identity_link_id uuid,
  requested_conversation_id uuid,
  requested_member_identity_link_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_identity_link_id uuid;
  v_removed_role text;
begin
  v_actor_identity_link_id := public.net_altara_assert_messenger_context(
    requested_expected_identity_link_id
  );

  if requested_member_identity_link_id is null
    or requested_member_identity_link_id = v_actor_identity_link_id
  then
    raise exception 'ALTARA_MESSENGER_GROUP_OWNER_CANNOT_BE_REMOVED'
      using errcode = '22023';
  end if;

  perform 1
  from public.net_altara_conversations as conversation
  join public.net_altara_conversation_members as owner_membership
    on owner_membership.conversation_id = conversation.id
    and owner_membership.identity_link_id = v_actor_identity_link_id
    and owner_membership.member_role = 'owner'
  where conversation.id = requested_conversation_id
    and conversation.conversation_kind = 'group'
  for update of conversation;

  if not found then
    raise exception 'ALTARA_MESSENGER_GROUP_OWNER_REQUIRED' using errcode = '42501';
  end if;

  delete from public.net_altara_conversation_members as member_row
  where member_row.conversation_id = requested_conversation_id
    and member_row.identity_link_id = requested_member_identity_link_id
    and member_row.member_role = 'member'
  returning member_row.member_role into v_removed_role;

  if v_removed_role is null then
    raise exception 'ALTARA_MESSENGER_GROUP_MEMBER_NOT_FOUND' using errcode = '22023';
  end if;

  update public.net_altara_conversations
  set updated_at = timezone('utc', clock_timestamp())
  where id = requested_conversation_id;

  perform public.net_altara_bump_messenger_revisions(
    array(
      select member_row.identity_link_id
      from public.net_altara_conversation_members as member_row
      where member_row.conversation_id = requested_conversation_id
    ) || array[requested_member_identity_link_id]
  );

  return jsonb_build_object(
    'conversation_id', requested_conversation_id,
    'removed_identity_link_id', requested_member_identity_link_id
  );
end;
$$;

create or replace function public.fetch_net_altara_message_page(
  requested_expected_identity_link_id uuid,
  requested_conversation_id uuid,
  requested_cursor_at timestamptz default null,
  requested_cursor_id uuid default null,
  requested_limit integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_identity_link_id uuid;
  v_limit integer := greatest(1, least(coalesce(requested_limit, 30), 50));
  v_conversation public.net_altara_conversations%rowtype;
  v_messages jsonb;
  v_oldest_at timestamptz;
  v_oldest_id uuid;
  v_has_more boolean := false;
  v_can_send boolean;
  v_title text;
  v_avatar_url text;
begin
  v_actor_identity_link_id := public.net_altara_assert_messenger_context(
    requested_expected_identity_link_id
  );

  if (requested_cursor_at is null) <> (requested_cursor_id is null) then
    raise exception 'ALTARA_MESSENGER_CURSOR_INVALID' using errcode = '22023';
  end if;

  select conversation.*
  into v_conversation
  from public.net_altara_conversations as conversation
  join public.net_altara_conversation_members as membership
    on membership.conversation_id = conversation.id
    and membership.identity_link_id = v_actor_identity_link_id
  where conversation.id = requested_conversation_id;

  if not found then
    raise exception 'ALTARA_MESSENGER_CONVERSATION_NOT_FOUND' using errcode = '42501';
  end if;

  select not exists (
    select 1
    from public.net_altara_conversation_members as member_row
    where member_row.conversation_id = requested_conversation_id
      and not public.net_altara_identity_can_use_messenger(
        member_row.identity_link_id
      )
  )
  into v_can_send;

  if v_conversation.conversation_kind = 'direct' then
    select
      presentation.value ->> 'display_name',
      presentation.value ->> 'avatar_url'
    into v_title, v_avatar_url
    from (
      select case
        when v_conversation.direct_identity_a = v_actor_identity_link_id
          then v_conversation.direct_identity_b
        else v_conversation.direct_identity_a
      end as identity_link_id
    ) as recipient
    cross join lateral (
      select public.net_altara_identity_presentation(
        recipient.identity_link_id
      ) as value
    ) as presentation;
  else
    v_title := v_conversation.title;
    v_avatar_url := null;
  end if;

  with message_page as (
    select message.*
    from public.net_altara_messages as message
    where message.conversation_id = requested_conversation_id
      and (
        requested_cursor_at is null
        or (message.created_at, message.id) < (
          requested_cursor_at,
          requested_cursor_id
        )
      )
    order by message.created_at desc, message.id desc
    limit v_limit
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'message_id', message_page.id,
        'conversation_id', message_page.conversation_id,
        'author', public.net_altara_identity_presentation(
          message_page.author_identity_link_id
        ),
        'body', message_page.body,
        'created_at', message_page.created_at,
        'mine', message_page.author_identity_link_id = v_actor_identity_link_id
      )
      order by message_page.created_at, message_page.id
    ),
    '[]'::jsonb
  )
  into v_messages
  from message_page;

  with message_page as (
    select message.created_at, message.id
    from public.net_altara_messages as message
    where message.conversation_id = requested_conversation_id
      and (
        requested_cursor_at is null
        or (message.created_at, message.id) < (
          requested_cursor_at,
          requested_cursor_id
        )
      )
    order by message.created_at desc, message.id desc
    limit v_limit
  )
  select message_page.created_at, message_page.id
  into v_oldest_at, v_oldest_id
  from message_page
  order by message_page.created_at, message_page.id
  limit 1;

  if v_oldest_at is not null then
    select exists (
      select 1
      from public.net_altara_messages as older_message
      where older_message.conversation_id = requested_conversation_id
        and (older_message.created_at, older_message.id) < (
          v_oldest_at,
          v_oldest_id
        )
    )
    into v_has_more;
  end if;

  return jsonb_build_object(
    'conversation', jsonb_build_object(
      'conversation_id', v_conversation.id,
      'kind', v_conversation.conversation_kind,
      'title', v_title,
      'avatar_url', v_avatar_url,
      'role', (
        select membership.member_role
        from public.net_altara_conversation_members as membership
        where membership.conversation_id = v_conversation.id
          and membership.identity_link_id = v_actor_identity_link_id
      ),
      'members', public.net_altara_conversation_members_json(
        v_conversation.id
      ),
      'can_send', v_can_send,
      'updated_at', v_conversation.updated_at
    ),
    'messages', v_messages,
    'next_cursor', case
      when v_has_more then jsonb_build_object(
        'created_at', v_oldest_at,
        'message_id', v_oldest_id
      )
      else null
    end
  );
end;
$$;

create or replace function public.send_net_altara_message(
  requested_expected_identity_link_id uuid,
  requested_conversation_id uuid,
  requested_body text,
  requested_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_identity_link_id uuid;
  v_body text := btrim(coalesce(requested_body, ''));
  v_message public.net_altara_messages%rowtype;
  v_inserted boolean := false;
  v_recent_message_count integer := 0;
  v_rate_cutoff_at timestamptz;
begin
  v_actor_identity_link_id := public.net_altara_assert_messenger_context(
    requested_expected_identity_link_id
  );

  if requested_request_key is null then
    raise exception 'ALTARA_MESSENGER_REQUEST_KEY_REQUIRED' using errcode = '22023';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 4000 then
    raise exception 'ALTARA_MESSENGER_MESSAGE_INVALID' using errcode = '22023';
  end if;

  -- Serialize sends for one effective identity. This makes the bounded
  -- per-author rate check authoritative across concurrent conversations.
  perform 1
  from public.net_identity_links as identity_link
  where identity_link.id = v_actor_identity_link_id
  for update;

  if not found then
    raise exception 'ALTARA_MESSENGER_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;

  perform 1
  from public.net_altara_conversations as conversation
  join public.net_altara_conversation_members as membership
    on membership.conversation_id = conversation.id
    and membership.identity_link_id = v_actor_identity_link_id
  where conversation.id = requested_conversation_id
  for share of conversation, membership;

  if not found then
    raise exception 'ALTARA_MESSENGER_CONVERSATION_NOT_FOUND' using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.net_altara_conversation_members as member_row
    where member_row.conversation_id = requested_conversation_id
      and not public.net_altara_identity_can_use_messenger(
        member_row.identity_link_id
      )
  ) then
    raise exception 'ALTARA_MESSENGER_MEMBER_ACCESS_CHANGED' using errcode = '42501';
  end if;

  -- Resolve idempotency before rate limiting. A legitimate retry returns the
  -- original message even if the author has since reached the send limit.
  select message.*
  into v_message
  from public.net_altara_messages as message
  where message.author_identity_link_id = v_actor_identity_link_id
    and message.request_key = requested_request_key;

  if v_message.id is not null then
    if v_message.conversation_id is distinct from requested_conversation_id
      or v_message.body is distinct from v_body
    then
      raise exception 'ALTARA_MESSENGER_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
  else
    v_rate_cutoff_at := clock_timestamp() - interval '10 seconds';

    select count(*)::integer
    into v_recent_message_count
    from (
      select recent_message.id
      from public.net_altara_messages as recent_message
      where recent_message.author_identity_link_id = v_actor_identity_link_id
        and recent_message.created_at >= v_rate_cutoff_at
      order by recent_message.created_at desc, recent_message.id desc
      limit 20
    ) as bounded_recent_messages;

    if v_recent_message_count >= 20 then
      raise exception 'ALTARA_MESSENGER_RATE_LIMITED' using errcode = 'P0001';
    end if;

    insert into public.net_altara_messages (
      conversation_id,
      author_identity_link_id,
      request_key,
      body
    ) values (
      requested_conversation_id,
      v_actor_identity_link_id,
      requested_request_key,
      v_body
    )
    returning * into v_message;

    v_inserted := true;
  end if;

  if v_inserted then
    update public.net_altara_conversations
    set updated_at = timezone('utc', clock_timestamp())
    where id = requested_conversation_id;

    perform public.net_altara_bump_messenger_revisions(array(
      select member_row.identity_link_id
      from public.net_altara_conversation_members as member_row
      where member_row.conversation_id = requested_conversation_id
    ));
  end if;

  return jsonb_build_object(
    'message_id', v_message.id,
    'conversation_id', v_message.conversation_id,
    'author', public.net_altara_identity_presentation(
      v_message.author_identity_link_id
    ),
    'body', v_message.body,
    'created_at', v_message.created_at,
    'mine', true,
    'created', v_inserted
  );
end;
$$;

create or replace function public.mark_net_altara_conversation_read(
  requested_expected_identity_link_id uuid,
  requested_conversation_id uuid,
  requested_observed_message_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_identity_link_id uuid;
  v_stored_at timestamptz;
  v_stored_message_id uuid;
  v_observed_at timestamptz;
  v_updated boolean := false;
begin
  v_actor_identity_link_id := public.net_altara_assert_messenger_context(
    requested_expected_identity_link_id
  );

  select
    membership.last_read_at,
    membership.last_read_message_id
  into v_stored_at, v_stored_message_id
  from public.net_altara_conversation_members as membership
  where membership.conversation_id = requested_conversation_id
    and membership.identity_link_id = v_actor_identity_link_id
  for update;

  if not found then
    raise exception 'ALTARA_MESSENGER_CONVERSATION_NOT_FOUND' using errcode = '42501';
  end if;

  if requested_observed_message_id is null then
    raise exception 'ALTARA_MESSENGER_READ_CURSOR_INVALID' using errcode = '22023';
  end if;

  select message.created_at
  into v_observed_at
  from public.net_altara_messages as message
  where message.id = requested_observed_message_id
    and message.conversation_id = requested_conversation_id;

  if not found then
    raise exception 'ALTARA_MESSENGER_READ_CURSOR_INVALID' using errcode = '22023';
  end if;

  if v_observed_at > v_stored_at
    or (
      v_observed_at = v_stored_at
      and (
        v_stored_message_id is null
        or requested_observed_message_id > v_stored_message_id
      )
    )
  then
    update public.net_altara_conversation_members
    set
      last_read_at = v_observed_at,
      last_read_message_id = requested_observed_message_id
    where conversation_id = requested_conversation_id
      and identity_link_id = v_actor_identity_link_id;

    v_stored_at := v_observed_at;
    v_stored_message_id := requested_observed_message_id;
    v_updated := true;
    perform public.net_altara_bump_messenger_revisions(
      array[v_actor_identity_link_id]
    );
  end if;

  return jsonb_build_object(
    'conversation_id', requested_conversation_id,
    'last_read_at', v_stored_at,
    'last_read_message_id', v_stored_message_id,
    'updated', v_updated
  );
end;
$$;

alter table public.net_altara_conversations enable row level security;
alter table public.net_altara_conversation_members enable row level security;
alter table public.net_altara_messages enable row level security;
alter table public.net_altara_messenger_realtime_state enable row level security;

create policy net_altara_messenger_realtime_select_effective_identity
on public.net_altara_messenger_realtime_state
for select
to authenticated
using (
  public.current_user_can_read_net_altara_messenger_revision(identity_link_id)
);

revoke all on table public.net_altara_conversations
  from public, anon, authenticated;
revoke all on table public.net_altara_conversation_members
  from public, anon, authenticated;
revoke all on table public.net_altara_messages
  from public, anon, authenticated;
revoke all on table public.net_altara_messenger_realtime_state
  from public, anon, authenticated;
grant select on table public.net_altara_messenger_realtime_state
  to authenticated;

revoke all on function public.net_altara_identity_can_use_messenger(uuid)
  from public, anon, authenticated;
revoke all on function public.net_altara_effective_messenger_identity()
  from public, anon, authenticated;
revoke all on function public.net_altara_assert_messenger_context(uuid)
  from public, anon, authenticated;
revoke all on function public.net_altara_identity_presentation(uuid)
  from public, anon, authenticated;
revoke all on function public.net_altara_conversation_members_json(uuid)
  from public, anon, authenticated;
revoke all on function public.net_altara_bump_messenger_revisions(uuid[])
  from public, anon, authenticated;
revoke all on function public.current_user_can_read_net_altara_messenger_revision(uuid)
  from public, anon;

revoke all on function public.fetch_net_altara_messenger_sidebar(uuid, integer)
  from public, anon;
revoke all on function public.search_net_altara_messenger_recipients(uuid, text, integer)
  from public, anon;
revoke all on function public.ensure_net_altara_direct_conversation(uuid, uuid)
  from public, anon;
revoke all on function public.create_net_altara_group(uuid, text, uuid[])
  from public, anon;
revoke all on function public.rename_net_altara_group(uuid, uuid, text)
  from public, anon;
revoke all on function public.add_net_altara_group_members(uuid, uuid, uuid[])
  from public, anon;
revoke all on function public.remove_net_altara_group_member(uuid, uuid, uuid)
  from public, anon;
revoke all on function public.fetch_net_altara_message_page(
  uuid,
  uuid,
  timestamptz,
  uuid,
  integer
) from public, anon;
revoke all on function public.send_net_altara_message(uuid, uuid, text, uuid)
  from public, anon;
revoke all on function public.mark_net_altara_conversation_read(uuid, uuid, uuid)
  from public, anon;

grant execute on function public.current_user_can_read_net_altara_messenger_revision(uuid)
  to authenticated;
grant execute on function public.fetch_net_altara_messenger_sidebar(uuid, integer)
  to authenticated;
grant execute on function public.search_net_altara_messenger_recipients(uuid, text, integer)
  to authenticated;
grant execute on function public.ensure_net_altara_direct_conversation(uuid, uuid)
  to authenticated;
grant execute on function public.create_net_altara_group(uuid, text, uuid[])
  to authenticated;
grant execute on function public.rename_net_altara_group(uuid, uuid, text)
  to authenticated;
grant execute on function public.add_net_altara_group_members(uuid, uuid, uuid[])
  to authenticated;
grant execute on function public.remove_net_altara_group_member(uuid, uuid, uuid)
  to authenticated;
grant execute on function public.fetch_net_altara_message_page(
  uuid,
  uuid,
  timestamptz,
  uuid,
  integer
) to authenticated;
grant execute on function public.send_net_altara_message(uuid, uuid, text, uuid)
  to authenticated;
grant execute on function public.mark_net_altara_conversation_read(uuid, uuid, uuid)
  to authenticated;

alter table public.net_altara_messenger_realtime_state replica identity full;

-- Raw communication rows never enter Realtime. Only the private identity
-- revision row is published; RLS resolves the effective Messenger identity.
do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'net_altara_conversations'
  ) then
    alter publication supabase_realtime
      drop table public.net_altara_conversations;
  end if;
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'net_altara_conversation_members'
  ) then
    alter publication supabase_realtime
      drop table public.net_altara_conversation_members;
  end if;
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'net_altara_messages'
  ) then
    alter publication supabase_realtime
      drop table public.net_altara_messages;
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'net_altara_messenger_realtime_state'
  ) then
    alter publication supabase_realtime
      add table public.net_altara_messenger_realtime_state;
  end if;
exception
  when duplicate_object then null;
end;
$$;

commit;
