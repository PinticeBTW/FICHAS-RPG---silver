-- WAVE V1 post fingerprint hotfix.
-- Forward-only. Run after the deployed supabase/net-altara-wave.sql.

begin;

do $preflight$
declare
  v_definition text;
begin
  if to_regclass('public.net_altara_wave_posts') is null
    or to_regclass('public.net_altara_wave_post_mentions') is null
    or to_regclass('public.net_altara_wave_notifications') is null
    or to_regprocedure(
      'public.create_net_altara_wave_post(uuid,uuid,uuid,text,uuid,text)'
    ) is null
  then
    raise exception 'ALTARA_WAVE_POST_DIGEST_DEPENDENCY_REQUIRED'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_extension as extension_row
    join pg_catalog.pg_namespace as namespace_row
      on namespace_row.oid = extension_row.extnamespace
    where extension_row.extname = 'pgcrypto'
      and namespace_row.nspname = 'extensions'
  ) or to_regprocedure('extensions.digest(text,text)') is null then
    raise exception 'ALTARA_WAVE_PGCRYPTO_EXTENSIONS_DIGEST_REQUIRED'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.create_net_altara_wave_post(uuid,uuid,uuid,text,uuid,text)'::regprocedure
  ) into v_definition;

 if pg_catalog.strpos(
    pg_catalog.lower(v_definition),
    'encode(digest('
  ) = 0
  or pg_catalog.strpos(
    pg_catalog.lower(v_definition),
    'extensions.digest('
  ) > 0
  then
    raise exception 'ALTARA_WAVE_POST_DIGEST_DEFINITION_REVIEW_REQUIRED'
      using errcode = '55000';
  end if;
end;
$preflight$;

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
    v_identity_link_id, requested_expected_account_id
  );
  if requested_request_key is null then
    raise exception 'ALTARA_WAVE_REQUEST_KEY_REQUIRED' using errcode = '22023';
  end if;
  if char_length(v_body) > 360 or (v_body = '' and requested_media_ref is null) then
    raise exception 'ALTARA_WAVE_POST_INVALID' using errcode = '22023';
  end if;
  if requested_media_ref is not null and not public.net_altara_wave_media_ref_matches_slot(
    requested_media_ref, v_account_id, 'general', 'post-' || requested_request_key::text
  ) then raise exception 'ALTARA_WAVE_POST_MEDIA_INVALID' using errcode = '22023'; end if;

  v_fingerprint := pg_catalog.encode(extensions.digest(
    (
      v_account_id::text || '|' || requested_request_key::text || '|'
      || coalesce(requested_parent_post_id::text, '') || '|' || v_body || '|'
      || coalesce(requested_media_ref, '')
    )::text,
    'sha256'::text
  ), 'hex'::text);
  perform pg_advisory_xact_lock(hashtextextended(
    'altara-wave-post:' || v_account_id::text || ':' || requested_request_key::text, 0
  ));
  select post.* into v_existing
  from public.net_altara_wave_posts as post
  where post.author_account_id = v_account_id
    and post.request_key = requested_request_key
  for share;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception 'ALTARA_WAVE_IDEMPOTENCY_MISMATCH' using errcode = '23505';
    end if;
    return public.net_altara_wave_post_payload(
      v_existing.id, v_account_id, v_existing.created_at, null
    );
  end if;
  perform public.consume_net_altara_wave_rate_limit('post', 1);

  if requested_parent_post_id is not null then
    select post.* into v_parent
    from public.net_altara_wave_posts as post
    where post.id = requested_parent_post_id
      and post.status = 'published'
      and public.net_altara_wave_account_is_currently_visible(post.author_account_id)
    for share;
    if not found then raise exception 'ALTARA_WAVE_POST_NOT_AVAILABLE' using errcode = '42501'; end if;
    v_root_id := coalesce(v_parent.root_post_id, v_parent.id);
  end if;

  insert into public.net_altara_wave_posts (
    id, author_account_id, parent_post_id, root_post_id,
    request_key, request_fingerprint, body, media_ref
  ) values (
    v_post_id, v_account_id, requested_parent_post_id, v_root_id,
    requested_request_key, v_fingerprint, v_body, requested_media_ref
  );

  if requested_parent_post_id is not null and v_parent.author_account_id <> v_account_id then
    insert into public.net_altara_wave_notifications (
      recipient_account_id, actor_account_id, notification_type, post_id
    ) values (v_parent.author_account_id, v_account_id, 'reply', v_post_id)
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
    select account.id into v_mentioned_account_id
    from public.net_altara_wave_accounts as account
    where lower(account.handle) = v_mention_handle
      and public.net_altara_wave_account_is_currently_visible(account.id);
    if found then
      insert into public.net_altara_wave_post_mentions (
        post_id, mentioned_account_id, source_handle
      ) values (v_post_id, v_mentioned_account_id, v_mention_handle)
      on conflict do nothing;
      if v_mentioned_account_id <> v_account_id then
        insert into public.net_altara_wave_notifications (
          recipient_account_id, actor_account_id, notification_type, post_id
        ) values (v_mentioned_account_id, v_account_id, 'mention', v_post_id)
        on conflict do nothing;
      end if;
    end if;
  end loop;

  perform public.net_altara_wave_audit(
    v_identity_link_id,
    case when requested_parent_post_id is null then 'altara-wave.post.create' else 'altara-wave.reply.create' end,
    'altara-wave-post', v_post_id
  );
  return public.net_altara_wave_post_payload(v_post_id, v_account_id, null, null);
end;
$$;

revoke all on function public.create_net_altara_wave_post(uuid,uuid,uuid,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.create_net_altara_wave_post(uuid,uuid,uuid,text,uuid,text)
  to authenticated;

comment on function public.create_net_altara_wave_post(uuid,uuid,uuid,text,uuid,text) is
  'Creates an idempotent WAVE post/reply. SHA-256 resolves through the Supabase pgcrypto extensions schema.';

commit;
