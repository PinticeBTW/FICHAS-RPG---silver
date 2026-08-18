-- ALTARA WAVE: text-first product boundary.
--
-- Forward-only migration. WAVE keeps exact reads and safe deletion for
-- historical account/post media, but no longer creates or changes WAVE-owned
-- media. Canonical RPG identity portraits remain presentation-only fallbacks.

begin;

do $preflight$
declare
  v_definition text;
  v_policy_definition text;
begin
  if to_regclass('public.net_altara_wave_accounts') is null
    or to_regclass('public.net_altara_wave_posts') is null
    or to_regclass('storage.objects') is null
  then
    raise exception 'ALTARA_WAVE_OWNED_MEDIA_PREFLIGHT_SCHEMA_MISSING'
      using errcode = '55000';
  end if;

  if to_regprocedure('public.net_altara_wave_effective_avatar_ref(uuid)') is null
    or to_regprocedure('public.net_altara_wave_account_payload(uuid,uuid)') is null
    or to_regprocedure('public.update_net_altara_wave_profile(uuid,uuid,text,text,text,text,text,text,text)') is null
    or to_regprocedure('public.create_net_altara_wave_post(uuid,uuid,uuid,text,uuid,text)') is null
    or to_regprocedure('public.current_user_can_write_net_altara_wave_media_object(text)') is null
    or to_regprocedure('public.current_user_can_read_net_altara_wave_media_object(text)') is null
    or to_regprocedure('public.current_user_can_delete_net_altara_wave_media_object(text)') is null
    or to_regprocedure('public.net_altara_wave_media_ref_contains_object(text,uuid,text)') is null
    or to_regprocedure('public.net_altara_wave_media_ref_matches_slot(text,uuid,text,text)') is null
    or to_regprocedure('public.net_altara_identity_presentation(uuid)') is null
    or to_regprocedure('extensions.digest(text,text)') is null
  then
    raise exception 'ALTARA_WAVE_OWNED_MEDIA_PREFLIGHT_FUNCTION_MISSING'
      using errcode = '55000';
  end if;

  select pg_get_functiondef(
    'public.net_altara_wave_effective_avatar_ref(uuid)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, 'account.avatar_ref') = 0
    or pg_catalog.strpos(v_definition, 'net_altara_identity_presentation') = 0
  then
    raise exception 'ALTARA_WAVE_EFFECTIVE_AVATAR_CONTRACT_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  select pg_get_functiondef(
    'public.net_altara_wave_account_payload(uuid,uuid)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, '''avatar_override_ref''') = 0
    or pg_catalog.strpos(v_definition, '''effective_avatar_ref''') = 0
    or pg_catalog.strpos(v_definition, '''banner_ref''') = 0
  then
    raise exception 'ALTARA_WAVE_ACCOUNT_MEDIA_PAYLOAD_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  select pg_get_functiondef(
    'public.update_net_altara_wave_profile(uuid,uuid,text,text,text,text,text,text,text)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, 'avatar_ref = requested_avatar_ref') = 0
    or pg_catalog.strpos(v_definition, 'banner_ref = requested_banner_ref') = 0
    or pg_catalog.strpos(v_definition, 'net_altara_wave_media_ref_matches_slot') = 0
  then
    raise exception 'ALTARA_WAVE_PROFILE_MEDIA_MUTATION_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  select pg_get_functiondef(
    'public.create_net_altara_wave_post(uuid,uuid,uuid,text,uuid,text)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, 'extensions.digest') = 0
    or pg_catalog.strpos(v_definition, 'requested_media_ref') = 0
    or pg_catalog.strpos(v_definition, 'requested_parent_post_id') = 0
    or pg_catalog.strpos(v_definition, 'v_root_id := coalesce') = 0
  then
    raise exception 'ALTARA_WAVE_POST_CONTRACT_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  select pg_get_functiondef(
    'public.current_user_can_write_net_altara_wave_media_object(text)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, '''altara-wave-account''') = 0
    or pg_catalog.strpos(v_definition, 'current_net_effective_runtime_identity_link_id') = 0
    or pg_catalog.strpos(v_definition, '''altara-wave''') = 0
  then
    raise exception 'ALTARA_WAVE_STORAGE_WRITE_HELPER_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  select pg_get_functiondef(
    'public.current_user_can_delete_net_altara_wave_media_object(text)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, 'current_user_can_write_net_altara_wave_media_object') = 0
    or pg_catalog.strpos(v_definition, 'account.avatar_ref') = 0
    or pg_catalog.strpos(v_definition, 'account.banner_ref') = 0
    or pg_catalog.strpos(v_definition, 'post.media_ref') = 0
  then
    raise exception 'ALTARA_WAVE_STORAGE_DELETE_HELPER_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  select pg_get_functiondef(
    'public.current_user_can_read_net_altara_wave_media_object(text)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, 'account.avatar_ref') = 0
    or pg_catalog.strpos(v_definition, 'account.banner_ref') = 0
    or pg_catalog.strpos(v_definition, 'post.media_ref') = 0
    or pg_catalog.strpos(v_definition, 'net_altara_wave_effective_avatar_ref') = 0
  then
    raise exception 'ALTARA_WAVE_STORAGE_READ_HELPER_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  select pg_get_expr(policy_row.polwithcheck, policy_row.polrelid)
  into v_policy_definition
  from pg_policy as policy_row
  where policy_row.polrelid = 'storage.objects'::regclass
    and policy_row.polname = 'rpg_media_altara_wave_insert_authorized'
    and policy_row.polcmd = 'a';
  if v_policy_definition is null
    or pg_catalog.strpos(v_policy_definition, 'current_user_can_write_net_altara_wave_media_object') = 0
  then
    raise exception 'ALTARA_WAVE_STORAGE_INSERT_POLICY_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  select pg_get_expr(policy_row.polqual, policy_row.polrelid)
  into v_policy_definition
  from pg_policy as policy_row
  where policy_row.polrelid = 'storage.objects'::regclass
    and policy_row.polname = 'rpg_media_altara_wave_select_authorized'
    and policy_row.polcmd = 'r';
  if v_policy_definition is null
    or pg_catalog.strpos(v_policy_definition, 'current_user_can_read_net_altara_wave_media_object') = 0
    or pg_catalog.strpos(v_policy_definition, 'current_user_can_delete_net_altara_wave_media_object') = 0
  then
    raise exception 'ALTARA_WAVE_STORAGE_SELECT_POLICY_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  select pg_get_expr(policy_row.polqual, policy_row.polrelid)
  into v_policy_definition
  from pg_policy as policy_row
  where policy_row.polrelid = 'storage.objects'::regclass
    and policy_row.polname = 'rpg_media_altara_wave_delete_authorized'
    and policy_row.polcmd = 'd';
  if v_policy_definition is null
    or pg_catalog.strpos(v_policy_definition, 'current_user_can_delete_net_altara_wave_media_object') = 0
  then
    raise exception 'ALTARA_WAVE_STORAGE_DELETE_POLICY_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_policy as policy_row
    where policy_row.polrelid = 'storage.objects'::regclass
      and policy_row.polname = 'rpg_media_altara_wave_update_authorized'
  ) then
    raise exception 'ALTARA_WAVE_STORAGE_UPDATE_POLICY_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;
end;
$preflight$;

-- Active WAVE presentation is now canonical identity portrait -> initials.
-- Historical avatar_override_ref remains stored and exactly readable so this
-- migration is reversible at the product layer and destroys no RPG history.
create or replace function public.net_altara_wave_effective_avatar_ref(
  requested_account_id uuid
)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select nullif(btrim(
    public.net_altara_identity_presentation(account.identity_link_id)
      ->> 'avatar_url'
  ), '')
  from public.net_altara_wave_accounts as account
  where account.id = requested_account_id;
$$;

-- Preserve historical override/banner columns exactly. A rolling client must
-- echo their current values; it cannot create, replace, or clear them. Textual
-- profile fields remain fully editable.
create or replace function public.update_net_altara_wave_profile(
  requested_expected_identity_link_id uuid,
  requested_expected_account_id uuid,
  requested_handle text,
  requested_display_name text,
  requested_bio text,
  requested_avatar_ref text,
  requested_banner_ref text,
  requested_location_label text,
  requested_website_url text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_account_id uuid;
  v_handle text := lower(btrim(coalesce(requested_handle, '')));
  v_display_name text := btrim(coalesce(requested_display_name, ''));
  v_bio text := btrim(coalesce(requested_bio, ''));
  v_location text := nullif(btrim(coalesce(requested_location_label, '')), '');
  v_website text := nullif(btrim(coalesce(requested_website_url, '')), '');
begin
  v_identity_link_id := public.net_altara_wave_assert_runtime_identity(
    requested_expected_identity_link_id
  );
  v_account_id := public.net_altara_wave_assert_runtime_account(
    v_identity_link_id,
    requested_expected_account_id
  );

  perform public.consume_net_altara_wave_rate_limit('profile', 1);
  if v_handle !~ '^[a-z0-9][a-z0-9._-]{1,31}$' then
    raise exception 'ALTARA_WAVE_HANDLE_INVALID' using errcode = '22023';
  end if;
  if char_length(v_display_name) not between 1 and 120
    or char_length(v_bio) > 240
    or (v_location is not null and char_length(v_location) > 120)
    or (v_website is not null and (
      char_length(v_website) > 500
      or v_website !~* '^https://[^[:space:]]+$'
    ))
  then
    raise exception 'ALTARA_WAVE_PROFILE_INVALID' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.net_altara_wave_accounts as account
    where lower(account.handle) = v_handle
      and account.id <> v_account_id
  ) then
    raise exception 'ALTARA_WAVE_HANDLE_TAKEN' using errcode = '23505';
  end if;

  update public.net_altara_wave_accounts
  set handle = v_handle,
      display_name = v_display_name,
      bio = v_bio,
      location_label = v_location,
      website_url = v_website
  where id = v_account_id
    and avatar_ref is not distinct from requested_avatar_ref
    and banner_ref is not distinct from requested_banner_ref;
  if not found then
    raise exception 'ALTARA_WAVE_OWNED_MEDIA_DISABLED'
      using errcode = '42501';
  end if;

  perform public.net_altara_wave_audit(
    v_identity_link_id,
    'altara-wave.profile.update',
    'altara-wave-account',
    v_account_id
  );
  return public.net_altara_wave_account_payload(v_account_id, v_account_id);
exception when unique_violation then
  raise exception 'ALTARA_WAVE_HANDLE_TAKEN' using errcode = '23505';
end;
$$;

-- Keep the deployed idempotency fingerprint and thread semantics. Exact
-- retries of already-created historical media posts still return their row;
-- any new request carrying a media descriptor fails before mutation.
create or replace function public.create_net_altara_wave_post(
  requested_expected_identity_link_id uuid,
  requested_expected_account_id uuid,
  requested_request_key uuid,
  requested_body text,
  requested_parent_post_id uuid default null,
  requested_media_ref text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_account_id uuid;
  v_body text := btrim(coalesce(requested_body, ''));
  v_fingerprint text;
  v_existing public.net_altara_wave_posts%rowtype;
  v_parent public.net_altara_wave_posts%rowtype;
  v_root_id uuid;
  v_post_id uuid := gen_random_uuid();
  v_mention_handle text;
  v_mentioned_account_id uuid;
begin
  v_identity_link_id := public.net_altara_wave_assert_runtime_identity(
    requested_expected_identity_link_id
  );
  v_account_id := public.net_altara_wave_assert_runtime_account(
    v_identity_link_id,
    requested_expected_account_id
  );
  if requested_request_key is null then
    raise exception 'ALTARA_WAVE_REQUEST_KEY_REQUIRED' using errcode = '22023';
  end if;
  if char_length(v_body) > 360
    or (v_body = '' and requested_media_ref is null)
  then
    raise exception 'ALTARA_WAVE_POST_INVALID' using errcode = '22023';
  end if;
  if requested_media_ref is not null
    and not public.net_altara_wave_media_ref_matches_slot(
      requested_media_ref,
      v_account_id,
      'general',
      'post-' || requested_request_key::text
    )
  then
    raise exception 'ALTARA_WAVE_POST_MEDIA_INVALID' using errcode = '22023';
  end if;

  v_fingerprint := pg_catalog.encode(extensions.digest(
    (
      v_account_id::text || '|' || requested_request_key::text || '|'
      || coalesce(requested_parent_post_id::text, '') || '|' || v_body || '|'
      || coalesce(requested_media_ref, '')
    )::text,
    'sha256'::text
  ), 'hex'::text);
  perform pg_advisory_xact_lock(hashtextextended(
    'altara-wave-post:' || v_account_id::text || ':'
      || requested_request_key::text,
    0
  ));
  select post.*
  into v_existing
  from public.net_altara_wave_posts as post
  where post.author_account_id = v_account_id
    and post.request_key = requested_request_key
  for share;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception 'ALTARA_WAVE_IDEMPOTENCY_MISMATCH' using errcode = '23505';
    end if;
    return public.net_altara_wave_post_payload(
      v_existing.id,
      v_account_id,
      v_existing.created_at,
      null
    );
  end if;

  if requested_media_ref is not null then
    raise exception 'ALTARA_WAVE_OWNED_MEDIA_DISABLED'
      using errcode = '42501';
  end if;
  if v_body = '' then
    raise exception 'ALTARA_WAVE_POST_INVALID' using errcode = '22023';
  end if;

  perform public.consume_net_altara_wave_rate_limit('post', 1);

  if requested_parent_post_id is not null then
    select post.*
    into v_parent
    from public.net_altara_wave_posts as post
    where post.id = requested_parent_post_id
      and post.status = 'published'
      and public.net_altara_wave_account_is_currently_visible(
        post.author_account_id
      )
    for share;
    if not found then
      raise exception 'ALTARA_WAVE_POST_NOT_AVAILABLE' using errcode = '42501';
    end if;
    v_root_id := coalesce(v_parent.root_post_id, v_parent.id);
  end if;

  insert into public.net_altara_wave_posts (
    id,
    author_account_id,
    parent_post_id,
    root_post_id,
    request_key,
    request_fingerprint,
    body,
    media_ref
  ) values (
    v_post_id,
    v_account_id,
    requested_parent_post_id,
    v_root_id,
    requested_request_key,
    v_fingerprint,
    v_body,
    null
  );

  if requested_parent_post_id is not null
    and v_parent.author_account_id <> v_account_id
  then
    insert into public.net_altara_wave_notifications (
      recipient_account_id,
      actor_account_id,
      notification_type,
      post_id
    ) values (
      v_parent.author_account_id,
      v_account_id,
      'reply',
      v_post_id
    )
    on conflict do nothing;
  end if;

  for v_mention_handle in
    select lower(capture[2])
    from regexp_matches(
      v_body,
      '(^|[^a-zA-Z0-9._-])@([a-zA-Z0-9][a-zA-Z0-9._-]{1,31})',
      'g'
    ) as match_row(capture)
    group by lower(capture[2])
    order by min(lower(capture[2]))
    limit 10
  loop
    select account.id
    into v_mentioned_account_id
    from public.net_altara_wave_accounts as account
    where lower(account.handle) = v_mention_handle
      and public.net_altara_wave_account_is_currently_visible(account.id);
    if found then
      insert into public.net_altara_wave_post_mentions (
        post_id,
        mentioned_account_id,
        source_handle
      ) values (
        v_post_id,
        v_mentioned_account_id,
        v_mention_handle
      )
      on conflict do nothing;
      if v_mentioned_account_id <> v_account_id then
        insert into public.net_altara_wave_notifications (
          recipient_account_id,
          actor_account_id,
          notification_type,
          post_id
        ) values (
          v_mentioned_account_id,
          v_account_id,
          'mention',
          v_post_id
        )
        on conflict do nothing;
      end if;
    end if;
  end loop;

  perform public.net_altara_wave_audit(
    v_identity_link_id,
    case
      when requested_parent_post_id is null then 'altara-wave.post.create'
      else 'altara-wave.reply.create'
    end,
    'altara-wave-post',
    v_post_id
  );
  return public.net_altara_wave_post_payload(
    v_post_id,
    v_account_id,
    null,
    null
  );
end;
$$;

-- RLS policies are OR-combined. Removing the one WAVE INSERT policy is the
-- product boundary. SELECT/DELETE policies remain untouched for exact
-- historical descriptors and detached-object cleanup.
drop policy if exists rpg_media_altara_wave_insert_authorized
  on storage.objects;

revoke all on function public.net_altara_wave_effective_avatar_ref(uuid)
  from public, anon, authenticated;
revoke all on function public.update_net_altara_wave_profile(
  uuid,uuid,text,text,text,text,text,text,text
) from public, anon, authenticated;
revoke all on function public.create_net_altara_wave_post(
  uuid,uuid,uuid,text,uuid,text
) from public, anon, authenticated;
revoke all on function public.current_user_can_write_net_altara_wave_media_object(text)
  from public, anon, authenticated;

grant execute on function public.update_net_altara_wave_profile(
  uuid,uuid,text,text,text,text,text,text,text
) to authenticated;
grant execute on function public.create_net_altara_wave_post(
  uuid,uuid,uuid,text,uuid,text
) to authenticated;

comment on function public.net_altara_wave_effective_avatar_ref(uuid) is
  'Returns only the canonical RPG identity portrait for active WAVE presentation; stored historical WAVE overrides are preserved but dormant.';
comment on function public.update_net_altara_wave_profile(
  uuid,uuid,text,text,text,text,text,text,text
) is
  'Updates text-first WAVE profile fields while preserving and prohibiting changes to historical WAVE-owned avatar/banner descriptors.';
comment on function public.create_net_altara_wave_post(
  uuid,uuid,uuid,text,uuid,text
) is
  'Creates text-only idempotent WAVE posts/replies; exact retries of existing historical media requests remain readable.';
comment on function public.current_user_can_write_net_altara_wave_media_object(text) is
  'Internal legacy namespace predicate retained only for exact detached-object delete checks; no authenticated Storage INSERT policy calls it.';

commit;
