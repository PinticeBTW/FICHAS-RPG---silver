-- Non-financial effective-runtime parity for NVN, ALTARA NEWS, ALTARA
-- Messenger, ECHO, and IDEN. Forward-only: run after
-- net-effective-runtime-identity.sql and net-pulse-dormant-account-visibility.sql.

begin;

do $$
begin
  if to_regclass('public.profiles') is null
    or to_regclass('public.net_gm_persona_sessions') is null
    or to_regclass('public.net_identity_links') is null
    or to_regclass('public.net_identity_app_installs') is null
    or to_regclass('public.net_nvn_realtime_state') is null
    or to_regclass('public.net_altara_news_realtime_state') is null
    or to_regclass('public.net_altara_messenger_realtime_state') is null
    or to_regprocedure('public.current_net_effective_runtime_identity_link_id()') is null
    or to_regprocedure('public.assert_net_effective_runtime_identity(uuid,text,boolean)') is null
    or to_regprocedure('public.net_runtime_action_context(uuid)') is null
    or to_regprocedure('public.net_identity_link_can_access_service(uuid,text)') is null
    or to_regprocedure('public.net_altara_news_effective_player_identity(uuid)') is null
    or to_regprocedure('public.net_altara_effective_messenger_identity()') is null
    or to_regprocedure('public.net_altara_assert_messenger_context(uuid)') is null
    or to_regprocedure('public.assert_net_echo_gm_editor()') is null
    or to_regprocedure('public.fetch_net_nvn_article_page_unscoped(text,text,text,timestamptz,uuid,integer)') is null
    or to_regprocedure('public.fetch_net_nvn_article_unscoped(uuid)') is null
    or to_regprocedure('public.fetch_net_nvn_live_desk_unscoped()') is null
    or to_regprocedure('public.fetch_net_nvn_radio_tune_state_unscoped()') is null
    or to_regprocedure('public.current_user_can_read_rpg_media_object(text)') is null
    or to_regprocedure('public.current_user_can_read_rpg_audio_object(text)') is null
    or to_regprocedure('public.current_user_can_read_net_altara_news_media_object(text)') is null
    or to_regprocedure('public.current_user_can_read_net_altara_news_broadcast_audio(text)') is null
  then
    raise exception 'NET_NONFINANCIAL_RUNTIME_PARITY_DEPENDENCY_REQUIRED'
      using errcode = '55000';
  end if;
end;
$$;

-- GM System is the administrative workspace. TAKE CONTROL, ACT AS, INSPECT,
-- and compromised-session are not interchangeable with that workspace.
create or replace function public.current_user_is_net_system_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.profiles as profile
      where profile.id = auth.uid() and profile.role = 'gm'
    )
    and not exists (
      select 1
      from public.net_gm_persona_sessions as gm_session
      where gm_session.gm_profile_id = auth.uid()
        and gm_session.mode <> 'none'
    );
$$;

create or replace function public.assert_net_system_admin()
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.app_role;
  v_mode text;
begin
  if v_actor is null then
    raise exception 'NET_SYSTEM_GM_REQUIRED' using errcode = '42501';
  end if;

  select profile.role into v_role
  from public.profiles as profile
  where profile.id = v_actor
  for share;

  if not found or v_role <> 'gm' then
    raise exception 'NET_SYSTEM_GM_REQUIRED' using errcode = '42501';
  end if;

  -- A first-use GM may not have a row yet. Creating the canonical none row
  -- makes the subsequent lock serialize with every persona-session upsert.
  insert into public.net_gm_persona_sessions (
    gm_profile_id, subject_kind, subject_id, mode
  ) values (v_actor, null, null, 'none')
  on conflict (gm_profile_id) do nothing;

  select gm_session.mode into v_mode
  from public.net_gm_persona_sessions as gm_session
  where gm_session.gm_profile_id = v_actor
  for share;

  if not found or v_mode <> 'none' then
    raise exception 'NET_SYSTEM_GM_CONTEXT_REQUIRED' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

-- Product-level revision capability. Raw content remains private; these
-- checks authorize only the existing metadata-free singleton rows.
create or replace function public.current_user_can_read_net_runtime_product_revision(
  requested_service_id text,
  requested_require_install boolean default true
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and (
    public.current_user_is_net_system_admin()
    or exists (
      select 1
      from public.net_identity_links as identity_link
      where identity_link.id = public.current_net_effective_runtime_identity_link_id()
        and public.net_identity_link_can_access_service(
          identity_link.id,
          requested_service_id
        )
        and (
          not coalesce(requested_require_install, true)
          or exists (
            select 1
            from public.net_identity_app_installs as install
            where install.identity_link_id = identity_link.id
              and install.app_id = requested_service_id
          )
        )
    )
  );
$$;

-- NVN player/private reader boundary. The UUID is comparison-only and the
-- central assertion locks the exact owner/control context, OS scope, and
-- current install row before invoking the existing bounded workers.
create or replace function public.assert_net_nvn_runtime_reader(
  requested_expected_identity_link_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  return public.assert_net_effective_runtime_identity(
    requested_expected_identity_link_id,
    'nvn',
    true
  );
end;
$$;

create or replace function public.fetch_net_nvn_article_page(
  requested_expected_identity_link_id uuid,
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
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_nvn_runtime_reader(
    requested_expected_identity_link_id
  );
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
  requested_expected_identity_link_id uuid,
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
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_nvn_runtime_reader(
    requested_expected_identity_link_id
  );
  return query
  select unscoped.*
  from public.fetch_net_nvn_article_unscoped(requested_article_id) as unscoped;
end;
$$;

create or replace function public.fetch_net_nvn_live_desk(
  requested_expected_identity_link_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_nvn_runtime_reader(
    requested_expected_identity_link_id
  );
  return public.fetch_net_nvn_live_desk_unscoped();
end;
$$;

create or replace function public.fetch_net_nvn_radio_tune_state(
  requested_expected_identity_link_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_nvn_runtime_reader(
    requested_expected_identity_link_id
  );
  return public.fetch_net_nvn_radio_tune_state_unscoped();
end;
$$;

create or replace function public.current_user_can_read_net_nvn_revision()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_user_can_read_net_runtime_product_revision('nvn', true);
$$;

drop policy if exists net_nvn_realtime_state_select_authenticated
  on public.net_nvn_realtime_state;
create policy net_nvn_realtime_state_select_authenticated
on public.net_nvn_realtime_state
for select to authenticated
using (
  channel = 'public'
  and public.current_user_can_read_net_nvn_revision()
);

-- ALTARA NEWS keeps every deployed feed/media/broadcast worker. Only its
-- historical player-only resolver is replaced by the central runtime guard.
create or replace function public.net_altara_news_effective_player_identity(
  requested_expected_identity_link_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  return public.assert_net_effective_runtime_identity(
    requested_expected_identity_link_id,
    'altara-news',
    true
  );
end;
$$;

comment on function public.net_altara_news_effective_player_identity(uuid) is
  'Compatibility name for the exact ALTARA NEWS effective-runtime reader guard. Supports player/playable and network NPC/non-playable runtime identities; never GM System, inspect, or compromised-session.';

create or replace function public.current_user_can_read_net_altara_news_revision()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_user_can_read_net_runtime_product_revision(
    'altara-news',
    true
  );
$$;

-- ALTARA Messenger has no app-account or optional-install layer. Membership,
-- authored messages, reads, and revisions bind directly to the exact runtime
-- identity link.
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
      and (
        (identity_link.identity_kind = 'player' and identity_link.playability = 'playable')
        or
        (identity_link.identity_kind = 'npc' and identity_link.playability = 'non-playable')
      )
      and public.net_identity_link_can_access_service(
        identity_link.id,
        'altara-messenger'
      )
  );
$$;

create or replace function public.net_altara_effective_messenger_identity()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select identity_link.id
  from public.net_identity_links as identity_link
  where identity_link.id = public.current_net_effective_runtime_identity_link_id()
    and public.net_altara_identity_can_use_messenger(identity_link.id)
  limit 1;
$$;

create or replace function public.net_altara_assert_messenger_context(
  requested_expected_identity_link_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  return public.assert_net_effective_runtime_identity(
    requested_expected_identity_link_id,
    'altara-messenger',
    false
  );
end;
$$;

alter function public.search_net_altara_messenger_recipients(uuid, text, integer)
  volatile;
alter function public.fetch_net_altara_message_page(uuid, uuid, timestamptz, uuid, integer)
  volatile;

create or replace function public.search_net_altara_messenger_recipients(
  requested_expected_identity_link_id uuid,
  requested_query text,
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
    select identity_link.id, presentation.value
    from public.net_identity_links as identity_link
    cross join lateral (
      select public.net_altara_identity_presentation(identity_link.id) as value
    ) as presentation
    where identity_link.id <> v_identity_link_id
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

-- Truthful immutable actor/persona evidence for newly-created Messenger
-- conversations and messages. The fictional author remains the identity-link
-- column; auth.uid() remains the Silver/player actor in net_action_audit.
create or replace function public.audit_net_altara_messenger_runtime_insert()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_context record;
begin
  if auth.uid() is null then return null; end if;
  v_identity_link_id := case tg_table_name
    when 'net_altara_messages' then new.author_identity_link_id
    else new.created_by_identity_link_id
  end;
  if v_identity_link_id is distinct from
    public.current_net_effective_runtime_identity_link_id()
  then
    raise exception 'ALTARA_MESSENGER_CONTEXT_CHANGED' using errcode = 'P0001';
  end if;
  select context.* into v_context
  from public.net_runtime_action_context(v_identity_link_id) as context;

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
    auth.uid(),
    null,
    v_context.persona_subject_kind,
    v_context.persona_subject_id,
    v_context.action_mode,
    case tg_table_name
      when 'net_altara_messages' then 'altara-messenger.message.send'
      else 'altara-messenger.conversation.create'
    end,
    v_context.authorization_basis || ':altara-messenger',
    case tg_table_name
      when 'net_altara_messages' then 'altara-message'
      else 'altara-conversation'
    end,
    new.id
  );
  return null;
end;
$$;

drop trigger if exists net_altara_messages_audit_runtime_insert
  on public.net_altara_messages;
create trigger net_altara_messages_audit_runtime_insert
after insert on public.net_altara_messages
for each row execute procedure public.audit_net_altara_messenger_runtime_insert();

drop trigger if exists net_altara_conversations_audit_runtime_insert
  on public.net_altara_conversations;
create trigger net_altara_conversations_audit_runtime_insert
after insert on public.net_altara_conversations
for each row execute procedure public.audit_net_altara_messenger_runtime_insert();

-- Newsroom/editor mutations are administrative GM System actions. A GM
-- currently controlling, inspecting, or compromising a persona cannot use
-- those sessions as an alternate editorial mutation boundary.
create or replace function public.assert_net_nvn_gm_editor()
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  return public.assert_net_system_admin();
end;
$$;

create or replace function public.assert_net_altara_news_gm_editor()
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  return public.assert_net_system_admin();
end;
$$;

create or replace function public.assert_net_echo_gm_editor()
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  return public.assert_net_system_admin();
end;
$$;

-- A volatile lock-taking editor guard cannot be invoked from a read-only
-- STABLE wrapper. Promote every existing reviewed caller without changing its
-- body, signature, grant, result, pagination, or product semantics.
do $$
declare
  v_function record;
begin
  for v_function in
    select function_row.oid
    from pg_catalog.pg_proc as function_row
    join pg_catalog.pg_namespace as function_schema
      on function_schema.oid = function_row.pronamespace
    where function_schema.nspname = 'public'
      and function_row.prokind = 'f'
      and function_row.oid not in (
        'public.assert_net_nvn_gm_editor()'::regprocedure,
        'public.assert_net_altara_news_gm_editor()'::regprocedure,
        'public.assert_net_echo_gm_editor()'::regprocedure
      )
      and (
        pg_get_functiondef(function_row.oid) ilike '%assert_net_nvn_gm_editor()%'
        or pg_get_functiondef(function_row.oid) ilike '%assert_net_altara_news_gm_editor()%'
        or pg_get_functiondef(function_row.oid) ilike '%assert_net_echo_gm_editor()%'
      )
  loop
    execute format(
      'alter function %s volatile',
      v_function.oid::regprocedure
    );
  end loop;
end;
$$;

-- ALTARA NEWS article media remains exact-descriptor-only. Reader visibility
-- follows the deployed published/previously-published archive lifecycle.
create or replace function public.current_user_can_write_net_altara_news_media_object(
  requested_object_name text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_user_is_net_system_admin()
    and requested_object_name is not null
    and char_length(requested_object_name) between 1 and 1024
    and requested_object_name not like '%..%'
    and split_part(requested_object_name, '/', 1) = 'altara-news-article'
    and split_part(requested_object_name, '/', 2)
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and split_part(requested_object_name, '/', 3) = 'general'
    and split_part(requested_object_name, '/', 4) ~ '^[a-z0-9][a-z0-9_-]{0,127}$'
    and split_part(requested_object_name, '/', 5) ~ '^[a-f0-9]{32}$'
    and split_part(requested_object_name, '/', 6)
      ~ '^(display|thumbnail)\.(jpeg|png|webp|gif|avif)$'
    and split_part(requested_object_name, '/', 7) = ''
    and exists (
      select 1
      from public.net_altara_news_articles as article
      where article.id::text = split_part(requested_object_name, '/', 2)
    );
$$;

create or replace function public.current_user_can_read_net_altara_news_media_object(
  requested_object_name text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and requested_object_name is not null
    and char_length(requested_object_name) between 1 and 1024
    and requested_object_name not like '%..%'
    and split_part(requested_object_name, '/', 1) = 'altara-news-article'
    and split_part(requested_object_name, '/', 2)
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and split_part(requested_object_name, '/', 3) = 'general'
    and split_part(requested_object_name, '/', 6) <> ''
    and split_part(requested_object_name, '/', 7) = ''
    and (
      public.current_user_is_net_system_admin()
      or (
        public.current_user_can_read_net_altara_news_revision()
        and exists (
          select 1
          from public.net_altara_news_articles as article
          join public.net_altara_news_article_media as media_record
            on media_record.article_id = article.id
          where article.id::text = split_part(requested_object_name, '/', 2)
            and (
              article.status = 'published'
              or (article.status = 'archived' and article.published_at is not null)
            )
            and public.net_altara_news_article_media_ref_contains_object(
              media_record.media_ref,
              article.id,
              requested_object_name
            )
        )
      )
    );
$$;

-- ALTARA broadcast signing remains current-object-only. GM Storage mutation
-- is restricted to GM System; runtime readers use the same exact revision
-- capability as the article reader.
create or replace function public.current_user_can_write_net_altara_news_broadcast_audio(
  requested_object_name text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_user_is_net_system_admin()
    and public.net_altara_news_broadcast_object_name_is_valid(
      requested_object_name,
      null
    );
$$;

create or replace function public.current_user_can_read_net_altara_news_broadcast_audio(
  requested_object_name text
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
    or not public.net_altara_news_broadcast_object_name_is_valid(
      requested_object_name,
      null
    )
  then return false;
  end if;
  if public.current_user_is_net_system_admin() then return true; end if;
  if not public.current_user_can_read_net_altara_news_revision() then return false; end if;
  v_payload := public.net_altara_news_broadcast_tune_payload_at(clock_timestamp());
  return coalesce(v_payload #>> '{current,object_path}', '') = requested_object_name;
end;
$$;

create or replace function public.current_user_can_delete_unregistered_net_altara_news_broadcast_audio(
  requested_object_name text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_user_is_net_system_admin()
    and public.net_altara_news_broadcast_object_name_is_valid(requested_object_name, null)
    and not exists (
      select 1
      from public.net_altara_news_broadcast_clips as clip
      where clip.object_path = requested_object_name
    );
$$;

create or replace function public.current_user_can_delete_registered_net_altara_news_broadcast_audio(
  requested_object_name text
)
returns boolean
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select public.current_user_is_net_system_admin()
    and public.net_altara_news_broadcast_object_name_is_valid(requested_object_name, null)
    and exists (
      select 1
      from public.net_altara_news_broadcast_clips as clip
      where clip.object_path = requested_object_name
        and clip.status = 'archived'
        and clip.rotation_enabled = false
        and clip.pending_delete_at is not null
        and not exists (
          select 1
          from public.net_altara_news_broadcast_station as station
          where station.channel = 'public'
            and station.breaking_stinger_clip_id = clip.id
        )
        and not exists (
          select 1
          from public.net_altara_news_broadcast_station as station
          where station.channel = 'public'
            and station.override_clip_id = clip.id
            and station.override_started_at <= clock_timestamp()
            and station.override_ends_at > clock_timestamp()
        )
    );
$$;

-- Preserve every deployed shared-media branch verbatim except the NVN branch,
-- which now requires GM System for edits and exact NVN runtime capability for
-- player reads. No ALTARA object can match the NVN namespace/parser.
create or replace function public.current_user_can_write_rpg_media_object(
  object_name text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_object_name text := object_name;
  v_subject_kind text := split_part(v_object_name, '/', 1);
  v_subject_id text := split_part(v_object_name, '/', 2);
  v_media_kind text := split_part(v_object_name, '/', 3);
begin
  if v_actor is null
    or v_subject_kind = ''
    or v_subject_id = ''
    or v_media_kind = ''
    or split_part(v_object_name, '/', 6) = ''
    or v_object_name like '%..%'
  then
    return false;
  end if;

  case v_subject_kind
    when 'profile-sheet' then
      return v_subject_id = v_actor::text or public.is_current_user_gm();

    when 'npc-card' then
      return exists (
        select 1
        from public.npc_cards as card
        where card.id::text = v_subject_id
          and (
            public.is_current_user_gm()
            or card.owner_profile_id = v_actor
            or public.has_sheet_share_access('npc', card.id)
          )
      );

    when 'profile' then
      return v_subject_id = v_actor::text;

    when 'character' then
      return exists (
        select 1
        from public.characters as character_record
        where character_record.id::text = v_subject_id
          and (
            character_record.owner_profile_id = v_actor
            or public.is_current_user_gm()
          )
      );

    when 'identity-link', 'universal-profile' then
      return exists (
        select 1
        from public.net_identity_links as link
        where link.id::text = v_subject_id
          and public.current_user_controls_playable_net_identity_link(link.id)
      );

    when 'app-account' then
      return exists (
        select 1
        from public.net_app_accounts as account
        where account.id::text = v_subject_id
          and account.identity_link_id is not null
          and public.current_user_controls_playable_net_identity_link(
            account.identity_link_id
          )
      );

    when 'gm-profile' then
      return v_subject_id = v_actor::text and public.is_current_user_gm();

    when 'global' then
      return v_subject_id = 'global'
        and v_media_kind = 'cyberware'
        and public.is_current_user_gm();

    when 'nvn-article' then
      return v_media_kind = 'general'
        and split_part(v_object_name, '/', 7) = ''
        and public.current_user_is_net_system_admin()
        and exists (
          select 1
          from public.net_nvn_articles as article
          where article.id::text = v_subject_id
        );

    else
      return false;
  end case;
end;
$$;

create or replace function public.current_user_can_read_rpg_media_object(
  object_name text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_object_name text := object_name;
  v_subject_kind text := split_part(v_object_name, '/', 1);
  v_subject_id text := split_part(v_object_name, '/', 2);
  v_media_kind text := split_part(v_object_name, '/', 3);
begin
  if v_actor is null
    or v_subject_kind = ''
    or v_subject_id = ''
    or v_media_kind = ''
  then
    return false;
  end if;

  if v_media_kind = 'avatar'
    and v_subject_kind in ('universal-profile', 'app-account')
  then
    return true;
  end if;

  if v_media_kind = 'avatar'
    and v_subject_kind in ('profile-sheet', 'npc-card', 'character')
    and exists (
      select 1
      from public.net_identity_links as link
      join public.net_app_accounts as account
        on account.identity_link_id = link.id
      where link.subject_kind = v_subject_kind
        and link.subject_id::text = v_subject_id
        and account.status = 'active'
    )
  then
    return true;
  end if;

  if v_subject_kind = 'global'
    and v_subject_id = 'global'
    and v_media_kind = 'cyberware'
  then
    return true;
  end if;

  case v_subject_kind
    when 'profile-sheet' then
      return v_subject_id = v_actor::text
        or public.is_current_user_gm()
        or exists (
          select 1
          from public.profiles as sheet_profile
          where sheet_profile.id::text = v_subject_id
            and public.has_sheet_share_access('profile', sheet_profile.id)
        );

    when 'npc-card' then
      return exists (
        select 1
        from public.npc_cards as card
        where card.id::text = v_subject_id
          and (
            public.is_current_user_gm()
            or card.owner_profile_id = v_actor
            or public.has_sheet_share_access('npc', card.id)
          )
      );

    when 'character' then
      return exists (
        select 1
        from public.characters as character_record
        where character_record.id::text = v_subject_id
          and (
            character_record.owner_profile_id = v_actor
            or public.is_current_user_gm()
          )
      );

    when 'profile' then
      return v_subject_id = v_actor::text or public.is_current_user_gm();

    when 'identity-link', 'universal-profile' then
      return public.is_current_user_gm() or exists (
        select 1
        from public.net_identity_links as link
        where link.id::text = v_subject_id
          and public.current_user_controls_playable_net_identity_link(link.id)
      );

    when 'app-account' then
      return public.is_current_user_gm() or exists (
        select 1
        from public.net_app_accounts as account
        where account.id::text = v_subject_id
          and account.identity_link_id is not null
          and public.current_user_controls_playable_net_identity_link(
            account.identity_link_id
          )
      );

    when 'gm-profile' then
      return v_subject_id = v_actor::text and public.is_current_user_gm();

    when 'nvn-article' then
      return v_media_kind = 'general'
        and split_part(v_object_name, '/', 6) <> ''
        and split_part(v_object_name, '/', 7) = ''
        and v_object_name not like '%..%'
        and exists (
          select 1
          from public.net_nvn_articles as article
          where article.id::text = v_subject_id
            and (
              public.current_user_is_net_system_admin()
              or (
                public.current_user_can_read_net_nvn_revision()
                and article.status in ('published', 'archived')
                and exists (
                  select 1
                  from public.net_nvn_article_media as media_record
                  where media_record.article_id = article.id
                    and public.net_nvn_article_media_ref_contains_object(
                      media_record.media_ref,
                      article.id,
                      v_object_name
                    )
                )
              )
            )
        );

    else
      return false;
  end case;
end;
$$;

create or replace function public.current_user_can_write_rpg_audio_object(
  object_name text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  return public.current_user_is_net_system_admin()
    and public.net_nvn_radio_object_name_is_valid(object_name, null);
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
  if public.current_user_is_net_system_admin() then return true; end if;
  if not public.current_user_can_read_net_nvn_revision() then return false; end if;
  v_payload := public.net_nvn_radio_tune_payload_at(clock_timestamp());
  return coalesce(v_payload #>> '{current,object_path}', '') = object_name;
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
  return public.current_user_is_net_system_admin()
    and public.net_nvn_radio_object_name_is_valid(object_name, null)
    and not exists (
      select 1
      from public.net_nvn_radio_clips as clip
      where clip.object_path = object_name
    );
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
  return public.current_user_is_net_system_admin()
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

-- Public surface: only bounded product RPCs and boolean Storage/RLS
-- predicates remain executable by authenticated clients.
revoke all on function public.current_user_is_net_system_admin()
  from public, anon, authenticated;
revoke all on function public.assert_net_system_admin()
  from public, anon, authenticated;
revoke all on function public.current_user_can_read_net_runtime_product_revision(text, boolean)
  from public, anon, authenticated;
revoke all on function public.assert_net_nvn_runtime_reader(uuid)
  from public, anon, authenticated;

revoke all on function public.fetch_net_nvn_article_page(
  text, text, text, timestamptz, uuid, integer
) from public, anon, authenticated;
revoke all on function public.fetch_net_nvn_article(uuid)
  from public, anon, authenticated;
revoke all on function public.fetch_net_nvn_live_desk()
  from public, anon, authenticated;
revoke all on function public.fetch_net_nvn_radio_tune_state()
  from public, anon, authenticated;

revoke all on function public.fetch_net_nvn_article_page(
  uuid, text, text, text, timestamptz, uuid, integer
) from public, anon, authenticated;
revoke all on function public.fetch_net_nvn_article(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.fetch_net_nvn_live_desk(uuid)
  from public, anon, authenticated;
revoke all on function public.fetch_net_nvn_radio_tune_state(uuid)
  from public, anon, authenticated;
revoke all on function public.current_user_can_read_net_nvn_revision()
  from public, anon, authenticated;

grant execute on function public.fetch_net_nvn_article_page(
  uuid, text, text, text, timestamptz, uuid, integer
) to authenticated;
grant execute on function public.fetch_net_nvn_article(uuid, uuid)
  to authenticated;
grant execute on function public.fetch_net_nvn_live_desk(uuid)
  to authenticated;
grant execute on function public.fetch_net_nvn_radio_tune_state(uuid)
  to authenticated;
grant execute on function public.current_user_can_read_net_nvn_revision()
  to authenticated;

revoke all on function public.net_altara_news_effective_player_identity(uuid)
  from public, anon, authenticated;
revoke all on function public.net_altara_identity_can_use_messenger(uuid)
  from public, anon, authenticated;
revoke all on function public.net_altara_effective_messenger_identity()
  from public, anon, authenticated;
revoke all on function public.net_altara_assert_messenger_context(uuid)
  from public, anon, authenticated;
revoke all on function public.audit_net_altara_messenger_runtime_insert()
  from public, anon, authenticated;
revoke all on function public.assert_net_nvn_gm_editor()
  from public, anon, authenticated;
revoke all on function public.assert_net_altara_news_gm_editor()
  from public, anon, authenticated;
revoke all on function public.assert_net_echo_gm_editor()
  from public, anon, authenticated;

-- Reassert raw-table privacy. Realtime continues to expose only each
-- product's existing metadata-free revision relation.
revoke all on table public.net_nvn_articles
  from public, anon, authenticated;
revoke all on table public.net_nvn_article_media
  from public, anon, authenticated;
revoke all on table public.net_altara_news_articles
  from public, anon, authenticated;
revoke all on table public.net_altara_news_article_media
  from public, anon, authenticated;
revoke all on table public.net_altara_news_saved_articles
  from public, anon, authenticated;
revoke all on table public.net_altara_conversations
  from public, anon, authenticated;
revoke all on table public.net_altara_conversation_members
  from public, anon, authenticated;
revoke all on table public.net_altara_messages
  from public, anon, authenticated;
revoke all on table public.net_echo_signals
  from public, anon, authenticated;
revoke all on table public.net_echo_signal_links
  from public, anon, authenticated;
revoke all on table public.net_echo_account_signal_state
  from public, anon, authenticated;

commit;
