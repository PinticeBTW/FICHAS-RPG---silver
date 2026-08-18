-- WAVE V1 reply-feed and canonical-avatar correction.
-- Forward-only. Run after the deployed WAVE foundation and post-digest hotfix.

begin;

do $preflight$
declare
  v_account_payload_definition text;
  v_page_definition text;
  v_post_definition text;
  v_media_definition text;
  v_policy_definition text;
begin
  if to_regclass('public.net_altara_wave_accounts') is null
    or to_regclass('public.net_altara_wave_posts') is null
    or to_regclass('public.net_altara_wave_follows') is null
    or to_regclass('public.net_altara_wave_bookmarks') is null
    or to_regclass('public.net_altara_wave_boosts') is null
    or to_regclass('storage.objects') is null
    or to_regprocedure('public.net_altara_identity_presentation(uuid)') is null
    or to_regprocedure('public.net_altara_wave_account_is_currently_visible(uuid)') is null
    or to_regprocedure('public.net_altara_wave_account_payload(uuid,uuid)') is null
    or to_regprocedure(
      'public.fetch_net_altara_wave_page(uuid,uuid,text,uuid,text,timestamptz,uuid,integer)'
    ) is null
    or to_regprocedure(
      'public.create_net_altara_wave_post(uuid,uuid,uuid,text,uuid,text)'
    ) is null
    or to_regprocedure('public.current_user_can_read_net_altara_wave_media_object(text)') is null
    or to_regprocedure('public.net_altara_wave_media_ref_contains_object(text,uuid,text)') is null
    or to_regprocedure('public.current_net_effective_runtime_identity_link_id()') is null
    or to_regprocedure('public.net_identity_link_can_access_service(uuid,text)') is null
  then
    raise exception 'ALTARA_WAVE_REPLY_AVATAR_DEPENDENCY_REQUIRED'
      using errcode = '55000';
  end if;

  if to_regprocedure('public.net_altara_wave_effective_avatar_ref(uuid)') is not null
    or to_regprocedure('public.net_altara_wave_media_ref_contains_exact_object(text,text)') is not null
  then
    raise exception 'ALTARA_WAVE_REPLY_AVATAR_ALREADY_APPLIED_OR_COLLISION'
      using errcode = '42P07';
  end if;

  select pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.net_altara_wave_account_payload(uuid,uuid)'::regprocedure
  )) into v_account_payload_definition;
  if pg_catalog.strpos(
    v_account_payload_definition,
    '''avatar_ref'', account.avatar_ref'
  ) = 0
    or pg_catalog.strpos(
      v_account_payload_definition,
      '''avatar_override_ref'''
    ) > 0
  then
    raise exception 'ALTARA_WAVE_ACCOUNT_PAYLOAD_DEFINITION_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  select pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.fetch_net_altara_wave_page(uuid,uuid,text,uuid,text,timestamptz,uuid,integer)'::regprocedure
  )) into v_page_definition;
  if pg_catalog.strpos(
    v_page_definition,
    'from public.net_altara_wave_posts as post'
  ) = 0
    or pg_catalog.strpos(
      v_page_definition,
      'where post.status = ''published'''
    ) = 0
    or pg_catalog.strpos(
      v_page_definition,
      'post.parent_post_id is null'
    ) > 0
  then
    raise exception 'ALTARA_WAVE_PAGE_DEFINITION_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  select pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.create_net_altara_wave_post(uuid,uuid,uuid,text,uuid,text)'::regprocedure
  )) into v_post_definition;
  if pg_catalog.strpos(
    v_post_definition,
    'extensions.digest('
  ) = 0
    or pg_catalog.strpos(
      v_post_definition,
      'v_root_id := coalesce(v_parent.root_post_id, v_parent.id)'
    ) = 0
    or pg_catalog.strpos(
      v_post_definition,
      'v_post_id, v_account_id, requested_parent_post_id, v_root_id'
    ) = 0
  then
    raise exception 'ALTARA_WAVE_POST_THREAD_CONTRACT_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  select pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.current_user_can_read_net_altara_wave_media_object(text)'::regprocedure
  )) into v_media_definition;
  if pg_catalog.strpos(
    v_media_definition,
    'net_altara_wave_media_ref_contains_object'
  ) = 0
    or pg_catalog.strpos(
      v_media_definition,
      'net_altara_wave_effective_avatar_ref'
    ) > 0
  then
    raise exception 'ALTARA_WAVE_MEDIA_READER_DEFINITION_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_expr(policy_row.polqual, policy_row.polrelid)
  into v_policy_definition
  from pg_catalog.pg_policy as policy_row
  where policy_row.polrelid = 'storage.objects'::regclass
    and policy_row.polname = 'rpg_media_altara_wave_select_authorized';
  if v_policy_definition is null
      or pg_catalog.strpos(
        pg_catalog.lower(v_policy_definition),
        'current_user_can_read_net_altara_wave_media_object'
      ) = 0
  then
    raise exception 'ALTARA_WAVE_STORAGE_POLICY_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;
end;
$preflight$;

-- Presentation only: the stored WAVE override remains authoritative product
-- state, while the canonical identity portrait remains a live fallback.
create function public.net_altara_wave_effective_avatar_ref(
  requested_account_id uuid
)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    nullif(btrim(account.avatar_ref), ''),
    nullif(btrim(
      public.net_altara_identity_presentation(account.identity_link_id)
        ->> 'avatar_url'
    ), '')
  )
  from public.net_altara_wave_accounts as account
  where account.id = requested_account_id;
$$;

-- Exact descriptor/object comparison for canonical fallback portraits. This
-- does not grant a namespace or prefix: every signed path must be a currently
-- referenced display/thumbnail object from one exact descriptor.
create function public.net_altara_wave_media_ref_contains_exact_object(
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
  v_payload jsonb;
  v_hash text;
  v_variant jsonb;
  v_path text;
  v_mime text;
  v_extension text;
  v_found boolean := false;
begin
  if requested_media_ref is null
    or requested_media_ref not like 'rpg-media:v1:%'
    or char_length(requested_media_ref) not between 16 and 4096
    or requested_object_name is null
    or char_length(requested_object_name) not between 1 and 1024
    or requested_object_name like '/%'
    or requested_object_name like '%..%'
  then
    return false;
  end if;

  v_payload := convert_from(decode(
    translate(
      substr(requested_media_ref, char_length('rpg-media:v1:') + 1),
      '-_',
      '+/'
    ) || repeat('=', (
      4 - char_length(substr(
        requested_media_ref,
        char_length('rpg-media:v1:') + 1
      )) % 4
    ) % 4),
    'base64'
  ), 'UTF8')::jsonb;
  v_hash := lower(v_payload ->> 'h');

  if jsonb_typeof(v_payload) <> 'object'
    or v_payload ->> 'v' <> '1'
    or v_hash is null
    or v_hash !~ '^[a-f0-9]{16,64}$'
    or jsonb_typeof(v_payload -> 'd') <> 'object'
    or (v_payload ? 't' and jsonb_typeof(v_payload -> 't') <> 'object')
  then
    return false;
  end if;

  for v_variant in
    select value
    from jsonb_array_elements(
      jsonb_build_array(v_payload -> 'd')
      || case
        when v_payload ? 't' then jsonb_build_array(v_payload -> 't')
        else '[]'::jsonb
      end
    )
  loop
    v_path := v_variant ->> 'p';
    v_mime := v_variant ->> 'm';
    v_extension := lower(split_part(split_part(v_path, '/', 6), '.', 2));

    if v_path is null
      or char_length(v_path) not between 1 and 1024
      or v_path like '/%'
      or v_path like '%..%'
      or split_part(v_path, '/', 1) !~ '^[a-z0-9][a-z0-9_-]{0,127}$'
      or split_part(v_path, '/', 2) !~ '^[a-z0-9][a-z0-9_-]{0,127}$'
      or split_part(v_path, '/', 3) <> 'avatar'
      or split_part(v_path, '/', 4) !~ '^[a-z0-9][a-z0-9_-]{0,127}$'
      or split_part(v_path, '/', 5) <> left(v_hash, 32)
      or split_part(v_path, '/', 6)
        !~ '^(display|thumbnail)\.(jpg|jpeg|png|webp|gif|avif)$'
      or split_part(v_path, '/', 7) <> ''
      or v_mime not in (
        'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'
      )
      or (v_extension in ('jpg', 'jpeg') and v_mime <> 'image/jpeg')
      or (v_extension not in ('jpg', 'jpeg') and v_mime <> 'image/' || v_extension)
      or coalesce(v_variant ->> 'w', '') !~ '^[1-9][0-9]*$'
      or coalesce(v_variant ->> 'h', '') !~ '^[1-9][0-9]*$'
      or coalesce(v_variant ->> 'b', '') !~ '^[1-9][0-9]*$'
    then
      return false;
    end if;

    if v_path = requested_object_name then
      v_found := true;
    end if;
  end loop;

  return v_found;
exception when others then
  return false;
end;
$$;

create or replace function public.net_altara_wave_account_payload(
  requested_account_id uuid,
  requested_viewer_account_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', account.id,
    'identity_link_id', account.identity_link_id,
    'handle', account.handle,
    'display_name', account.display_name,
    'bio', account.bio,
    -- Preserve the deployed field for rolling-client compatibility. New
    -- clients render effective_avatar_ref and mutate avatar_override_ref.
    'avatar_ref', account.avatar_ref,
    'avatar_override_ref', account.avatar_ref,
    'effective_avatar_ref', public.net_altara_wave_effective_avatar_ref(account.id),
    'banner_ref', account.banner_ref,
    'location_label', account.location_label,
    'website_url', account.website_url,
    'status', account.status,
    'joined_at', account.joined_at,
    'updated_at', account.updated_at,
    'followers_count', (
      select count(*)
      from public.net_altara_wave_follows as follow
      where follow.followed_account_id = account.id
        and public.net_altara_wave_account_is_currently_visible(
          follow.follower_account_id
        )
    ),
    'following_count', (
      select count(*)
      from public.net_altara_wave_follows as follow
      where follow.follower_account_id = account.id
        and public.net_altara_wave_account_is_currently_visible(
          follow.followed_account_id
        )
    ),
    'posts_count', (
      select count(*)
      from public.net_altara_wave_posts as post
      where post.author_account_id = account.id
        and post.status = 'published'
        and post.parent_post_id is null
    ),
    'viewer_following', exists (
      select 1
      from public.net_altara_wave_follows as follow
      where follow.follower_account_id = requested_viewer_account_id
        and follow.followed_account_id = account.id
    ),
    'viewer_owns', account.id = requested_viewer_account_id
  )
  from public.net_altara_wave_accounts as account
  where account.id = requested_account_id;
$$;

-- Main WAVE projections contain root posts only. Replies remain stored and
-- continue to render through the bounded conversation RPC.
create or replace function public.fetch_net_altara_wave_page(
  requested_expected_identity_link_id uuid,
  requested_expected_account_id uuid,
  requested_mode text,
  requested_profile_account_id uuid default null,
  requested_search_query text default null,
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
  v_viewer_account_id uuid;
  v_limit integer := least(greatest(coalesce(requested_limit, 20), 1), 40);
  v_query text := lower(btrim(coalesce(requested_search_query, '')));
  v_items jsonb;
  v_has_more boolean;
begin
  v_identity_link_id := public.net_altara_wave_assert_runtime_identity(
    requested_expected_identity_link_id
  );
  v_viewer_account_id := public.net_altara_wave_assert_runtime_account(
    v_identity_link_id,
    requested_expected_account_id
  );

  if requested_mode not in ('home', 'explore', 'bookmarks', 'profile', 'search') then
    raise exception 'ALTARA_WAVE_FEED_MODE_INVALID' using errcode = '22023';
  end if;
  if requested_mode = 'profile' and requested_profile_account_id is null then
    raise exception 'ALTARA_WAVE_PROFILE_REQUIRED' using errcode = '22023';
  end if;
  if requested_mode = 'search' and char_length(v_query) not between 2 and 80 then
    raise exception 'ALTARA_WAVE_SEARCH_INVALID' using errcode = '22023';
  end if;

  with candidates as (
    select
      post.id,
      case
        when requested_mode = 'bookmarks' then bookmark.created_at
        when requested_mode = 'home' then greatest(
          post.created_at,
          coalesce(boost_activity.created_at, post.created_at)
        )
        else post.created_at
      end as sort_at,
      case
        when requested_mode = 'home' then boost_activity.account_id
        else null
      end as booster_account_id
    from public.net_altara_wave_posts as post
    left join public.net_altara_wave_bookmarks as bookmark
      on bookmark.account_id = v_viewer_account_id
      and bookmark.post_id = post.id
    left join lateral (
      select boost.account_id, boost.created_at
      from public.net_altara_wave_boosts as boost
      where boost.post_id = post.id
        and public.net_altara_wave_account_is_currently_visible(boost.account_id)
        and (
          boost.account_id = v_viewer_account_id
          or exists (
            select 1
            from public.net_altara_wave_follows as followed_booster
            where followed_booster.follower_account_id = v_viewer_account_id
              and followed_booster.followed_account_id = boost.account_id
          )
        )
      order by boost.created_at desc, boost.account_id desc
      limit 1
    ) as boost_activity on true
    where post.status = 'published'
      and post.parent_post_id is null
      and public.net_altara_wave_account_is_currently_visible(post.author_account_id)
      and (
        (requested_mode = 'home' and (
          post.author_account_id = v_viewer_account_id
          or exists (
            select 1
            from public.net_altara_wave_follows as followed_author
            where followed_author.follower_account_id = v_viewer_account_id
              and followed_author.followed_account_id = post.author_account_id
          )
          or boost_activity.account_id is not null
        ))
        or requested_mode = 'explore'
        or (requested_mode = 'bookmarks' and bookmark.post_id is not null)
        or (
          requested_mode = 'profile'
          and post.author_account_id = requested_profile_account_id
        )
        or (
          requested_mode = 'search'
          and lower(post.body) like '%' || v_query || '%'
        )
      )
  ), cursor_filtered as (
    select candidate.*
    from candidates as candidate
    where requested_cursor_at is null
      or requested_cursor_id is null
      or (candidate.sort_at, candidate.id) < (
        requested_cursor_at,
        requested_cursor_id
      )
    order by candidate.sort_at desc, candidate.id desc
    limit v_limit + 1
  ), numbered as (
    select
      candidate.*,
      row_number() over (
        order by candidate.sort_at desc, candidate.id desc
      ) as row_number
    from cursor_filtered as candidate
  )
  select
    coalesce(jsonb_agg(
      public.net_altara_wave_post_payload(
        candidate.id,
        v_viewer_account_id,
        candidate.sort_at,
        candidate.booster_account_id
      ) order by candidate.sort_at desc, candidate.id desc
    ) filter (where candidate.row_number <= v_limit), '[]'::jsonb),
    count(*) > v_limit
  into v_items, v_has_more
  from numbered as candidate;

  return jsonb_build_object(
    'items', v_items,
    'has_more', v_has_more,
    'next_cursor', case
      when jsonb_array_length(v_items) = 0 then null
      else jsonb_build_object(
        'sort_at', v_items -> -1 ->> 'activity_at',
        'id', v_items -> -1 ->> 'id'
      )
    end
  );
end;
$$;

create or replace function public.current_user_can_read_net_altara_wave_media_object(
  requested_object_name text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
begin
  v_identity_link_id := public.current_net_effective_runtime_identity_link_id();
  if v_identity_link_id is null
    or not public.net_identity_link_can_access_service(
      v_identity_link_id,
      'altara-wave'
    )
    or not exists (
      select 1
      from public.net_identity_app_installs as install
      where install.identity_link_id = v_identity_link_id
        and install.app_id = 'altara-wave'
    )
  then
    return false;
  end if;

  return requested_object_name is not null
    and (
      exists (
        select 1
        from public.net_altara_wave_accounts as account
        where public.net_altara_wave_account_is_currently_visible(account.id)
          and (
            public.net_altara_wave_media_ref_contains_object(
              account.avatar_ref,
              account.id,
              requested_object_name
            )
            or public.net_altara_wave_media_ref_contains_object(
              account.banner_ref,
              account.id,
              requested_object_name
            )
          )
      )
      or exists (
        select 1
        from public.net_altara_wave_accounts as account
        where public.net_altara_wave_account_is_currently_visible(account.id)
          and public.net_altara_wave_media_ref_contains_exact_object(
            public.net_altara_wave_effective_avatar_ref(account.id),
            requested_object_name
          )
      )
      or exists (
        select 1
        from public.net_altara_wave_posts as post
        where post.status = 'published'
          and public.net_altara_wave_account_is_currently_visible(
            post.author_account_id
          )
          and public.net_altara_wave_media_ref_contains_object(
            post.media_ref,
            post.author_account_id,
            requested_object_name
          )
      )
    );
end;
$$;

revoke all on function public.net_altara_wave_effective_avatar_ref(uuid)
  from public, anon, authenticated;
revoke all on function public.net_altara_wave_media_ref_contains_exact_object(text,text)
  from public, anon, authenticated;
revoke all on function public.net_altara_wave_account_payload(uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.fetch_net_altara_wave_page(
  uuid,uuid,text,uuid,text,timestamptz,uuid,integer
) from public, anon, authenticated;
revoke all on function public.current_user_can_read_net_altara_wave_media_object(text)
  from public, anon, authenticated;

grant execute on function public.fetch_net_altara_wave_page(
  uuid,uuid,text,uuid,text,timestamptz,uuid,integer
) to authenticated;
grant execute on function public.current_user_can_read_net_altara_wave_media_object(text)
  to authenticated;

comment on function public.net_altara_wave_effective_avatar_ref(uuid) is
  'Returns the WAVE avatar override or the canonical identity portrait fallback without copying media.';
comment on function public.fetch_net_altara_wave_page(
  uuid,uuid,text,uuid,text,timestamptz,uuid,integer
) is
  'Returns bounded root-post projections for WAVE Home, Explore, Bookmarks, Profile, and Search.';

commit;
