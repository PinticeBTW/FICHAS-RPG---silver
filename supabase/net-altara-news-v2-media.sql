-- ALTARA NEWS V2 Phase 1: secure article media parity on the shared news core.
-- Run once after net-altara-news.sql and net-altara-news-global-city-sharing.sql.
-- This forward migration uploads no objects and creates no editorial content.

begin;

do $$
begin
  if to_regclass('public.net_altara_news_articles') is null
    or to_regclass('public.net_altara_news_article_media') is null
    or to_regclass('public.net_altara_news_realtime_state') is null
    or to_regclass('public.net_action_audit') is null
    or to_regclass('storage.buckets') is null
    or to_regclass('storage.objects') is null
    or to_regprocedure('auth.uid()') is null
    or to_regprocedure('public.is_current_user_gm()') is null
    or to_regprocedure('public.assert_net_altara_news_gm_editor()') is null
    or to_regprocedure('public.audit_net_altara_news_gm_action(text,text,uuid)') is null
    or to_regprocedure('public.net_altara_news_article_summary(uuid,uuid)') is null
    or to_regprocedure('public.net_altara_news_effective_player_identity(uuid)') is null
    or to_regprocedure('public.signal_net_altara_news_change()') is null
    or to_regprocedure('public.current_user_can_read_net_altara_news_revision()') is null
    or to_regprocedure('public.set_updated_at()') is null
  then
    raise exception 'ALTARA_NEWS_V2_MEDIA_DEPENDENCY_REQUIRED' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from storage.buckets as bucket
    where bucket.id = 'rpg-media' and bucket.public = false
  ) then
    raise exception 'ALTARA_NEWS_V2_PRIVATE_MEDIA_BUCKET_REQUIRED' using errcode = '55000';
  end if;

  -- V1 exposed no media mutation or media payload. Refuse to invent alternative
  -- text or placement for any service-role row created outside that contract.
  if exists (select 1 from public.net_altara_news_article_media) then
    raise exception 'ALTARA_NEWS_V2_EXISTING_MEDIA_REVIEW_REQUIRED' using errcode = '55000';
  end if;
end;
$$;

alter table public.net_altara_news_article_media
  add column alt_text text,
  add column paragraph_index integer,
  add column updated_at timestamptz not null default timezone('utc', now());

alter table public.net_altara_news_article_media
  alter column alt_text set not null,
  add constraint net_altara_news_article_media_alt_shape check (
    alt_text = btrim(alt_text) and char_length(alt_text) between 1 and 300
  ),
  add constraint net_altara_news_article_media_placement_shape check (
    (
      media_kind = 'hero'
      and ordinal = 0
      and paragraph_index is null
    )
    or (
      media_kind = 'gallery'
      and ordinal between 1 and 8
      and paragraph_index between 0 and 4095
    )
  );

drop trigger if exists net_altara_news_article_media_set_updated_at
  on public.net_altara_news_article_media;
create trigger net_altara_news_article_media_set_updated_at
before update on public.net_altara_news_article_media
for each row execute function public.set_updated_at();

-- One exact descriptor parser is authoritative for both metadata attachment and
-- Storage-object membership. Paths are immutable and article-UUID scoped.
create or replace function public.net_altara_news_article_media_reference_check(
  requested_media_ref text,
  requested_article_id uuid,
  requested_object_name text
)
returns boolean
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
declare
  encoded_payload text;
  decoded_payload jsonb;
  descriptor_hash text;
  variant jsonb;
  variant_path text;
  variant_mime text;
  variant_width bigint;
  variant_height bigint;
  variant_bytes bigint;
  object_was_referenced boolean := requested_object_name is null;
begin
  if requested_article_id is null
    or requested_media_ref is null
    or char_length(requested_media_ref) not between 1 and 4096
    or requested_media_ref not like 'rpg-media:v1:%'
  then
    return false;
  end if;

  if requested_object_name is not null
    and (
      requested_object_name = ''
      or char_length(requested_object_name) > 1024
      or requested_object_name like '%..%'
    )
  then
    return false;
  end if;

  encoded_payload := substr(requested_media_ref, char_length('rpg-media:v1:') + 1);
  if encoded_payload = '' or encoded_payload !~ '^[A-Za-z0-9_-]+$' then
    return false;
  end if;

  decoded_payload := convert_from(
    decode(
      translate(encoded_payload, '-_', '+/')
        || repeat('=', (4 - char_length(encoded_payload) % 4) % 4),
      'base64'
    ),
    'UTF8'
  )::jsonb;

  descriptor_hash := decoded_payload ->> 'h';
  if jsonb_typeof(decoded_payload) <> 'object'
    or decoded_payload ->> 'v' <> '1'
    or descriptor_hash is null
    or descriptor_hash !~ '^[A-Fa-f0-9]{16,64}$'
    or jsonb_typeof(decoded_payload -> 'd') <> 'object'
    or (
      decoded_payload ? 't'
      and jsonb_typeof(decoded_payload -> 't') <> 'object'
    )
  then
    return false;
  end if;

  for variant in
    select value
    from jsonb_array_elements(
      jsonb_build_array(decoded_payload -> 'd')
      || case
        when decoded_payload ? 't' then jsonb_build_array(decoded_payload -> 't')
        else '[]'::jsonb
      end
    )
  loop
    variant_path := variant ->> 'p';
    variant_mime := variant ->> 'm';
    variant_width := (variant ->> 'w')::bigint;
    variant_height := (variant ->> 'h')::bigint;
    variant_bytes := (variant ->> 'b')::bigint;

    if variant_path is null
      or char_length(variant_path) not between 1 and 1024
      or variant_path like '%..%'
      or split_part(variant_path, '/', 1) <> 'altara-news-article'
      or split_part(variant_path, '/', 2) <> requested_article_id::text
      or split_part(variant_path, '/', 3) <> 'general'
      or split_part(variant_path, '/', 4) !~ '^[a-z0-9][a-z0-9_-]{0,127}$'
      or split_part(variant_path, '/', 5) <> left(lower(descriptor_hash), 32)
      or split_part(variant_path, '/', 6) !~ '^(display|thumbnail)\.(jpeg|png|webp|gif|avif)$'
      or split_part(variant_path, '/', 7) <> ''
      or variant_mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif')
      or variant_width not between 1 and 64000000
      or variant_height not between 1 and 64000000
      or variant_bytes not between 1 and 20971520
    then
      return false;
    end if;

    if requested_object_name is not null and variant_path = requested_object_name then
      object_was_referenced := true;
    end if;
  end loop;

  return object_was_referenced;
exception
  when others then
    return false;
end;
$$;

create or replace function public.net_altara_news_article_media_reference_is_valid(
  requested_media_ref text,
  requested_article_id uuid
)
returns boolean
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select public.net_altara_news_article_media_reference_check(
    requested_media_ref,
    requested_article_id,
    null
  );
$$;

create or replace function public.net_altara_news_article_media_ref_contains_object(
  requested_media_ref text,
  requested_article_id uuid,
  requested_object_name text
)
returns boolean
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select requested_object_name is not null
    and public.net_altara_news_article_media_reference_check(
      requested_media_ref,
      requested_article_id,
      requested_object_name
    );
$$;

-- Product-specific Storage policies avoid replacing the deployed shared-media
-- helper used by NVN, identity avatars, character sheets, and other apps.
create or replace function public.current_user_can_write_net_altara_news_media_object(
  requested_object_name text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and public.is_current_user_gm()
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
      public.is_current_user_gm()
      or (
        public.current_user_can_read_net_altara_news_revision()
        and exists (
          select 1
          from public.net_altara_news_articles as article
          join public.net_altara_news_article_media as media_record
            on media_record.article_id = article.id
          where article.id::text = split_part(requested_object_name, '/', 2)
            and article.status = 'published'
            and public.net_altara_news_article_media_ref_contains_object(
              media_record.media_ref,
              article.id,
              requested_object_name
            )
        )
      )
    );
$$;

drop policy if exists rpg_media_altara_news_select_authorised on storage.objects;
create policy rpg_media_altara_news_select_authorised
on storage.objects for select to authenticated
using (
  bucket_id = 'rpg-media'
  and public.current_user_can_read_net_altara_news_media_object(name)
);

drop policy if exists rpg_media_altara_news_insert_authorised on storage.objects;
create policy rpg_media_altara_news_insert_authorised
on storage.objects for insert to authenticated
with check (
  bucket_id = 'rpg-media'
  and public.current_user_can_write_net_altara_news_media_object(name)
);

drop policy if exists rpg_media_altara_news_update_authorised on storage.objects;
create policy rpg_media_altara_news_update_authorised
on storage.objects for update to authenticated
using (
  bucket_id = 'rpg-media'
  and public.current_user_can_write_net_altara_news_media_object(name)
)
with check (
  bucket_id = 'rpg-media'
  and public.current_user_can_write_net_altara_news_media_object(name)
);

drop policy if exists rpg_media_altara_news_delete_authorised on storage.objects;
create policy rpg_media_altara_news_delete_authorised
on storage.objects for delete to authenticated
using (
  bucket_id = 'rpg-media'
  and public.current_user_can_write_net_altara_news_media_object(name)
);

create or replace function public.net_altara_news_article_media_payload(
  requested_article_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', media_record.id,
      'placement_kind', case media_record.media_kind
        when 'hero' then 'hero' else 'inline' end,
      'media_ref', media_record.media_ref,
      'caption', media_record.caption,
      'alt_text', media_record.alt_text,
      'paragraph_index', media_record.paragraph_index,
      'sort_order', case media_record.media_kind
        when 'hero' then 0 else media_record.ordinal - 1 end
    )
    order by media_record.ordinal, media_record.id
  ), '[]'::jsonb)
  from public.net_altara_news_article_media as media_record
  where media_record.article_id = requested_article_id;
$$;

create or replace function public.net_altara_news_gm_article_payload(
  requested_article_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select (to_jsonb(article) - 'created_by_profile_id') || jsonb_build_object(
    'media', public.net_altara_news_article_media_payload(article.id)
  )
  from public.net_altara_news_articles as article
  where article.id = requested_article_id;
$$;

create or replace function public.fetch_net_altara_news_article(
  requested_expected_identity_link_id uuid,
  requested_article_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_link_id uuid;
  v_result jsonb;
begin
  v_identity_link_id := public.net_altara_news_effective_player_identity(
    requested_expected_identity_link_id
  );
  select jsonb_build_object(
    'article', public.net_altara_news_article_summary(article.id, v_identity_link_id)
      || jsonb_build_object('body', article.body),
    'media', public.net_altara_news_article_media_payload(article.id),
    'related', coalesce((
      select jsonb_agg(public.net_altara_news_article_summary(related.id, v_identity_link_id)
        order by related.published_at desc, related.id desc)
      from (
        select candidate.id, candidate.published_at
        from public.net_altara_news_articles as candidate
        where candidate.status = 'published'
          and candidate.section = article.section
          and candidate.id <> article.id
        order by candidate.published_at desc, candidate.id desc
        limit 4
      ) as related
    ), '[]'::jsonb)
  ) into v_result
  from public.net_altara_news_articles as article
  where article.id = requested_article_id and article.status = 'published';
  if v_result is null then
    raise exception 'ALTARA_NEWS_ARTICLE_NOT_FOUND' using errcode = 'P0002';
  end if;
  return v_result;
end;
$$;

create or replace function public.fetch_net_altara_news_gm_article(
  requested_article_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_result jsonb;
begin
  perform public.assert_net_altara_news_gm_editor();
  v_result := public.net_altara_news_gm_article_payload(requested_article_id);
  if v_result is null then
    raise exception 'ALTARA_NEWS_ARTICLE_NOT_FOUND' using errcode = 'P0002';
  end if;
  return v_result;
end;
$$;

create or replace function public.save_net_altara_news_gm_article(
  requested_article_id uuid,
  requested_slug text,
  requested_section text,
  requested_coverage_scope text,
  requested_priority text,
  requested_headline text,
  requested_deck text,
  requested_body text,
  requested_author_label text,
  requested_source_label text,
  requested_location_label text,
  requested_featured boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_article public.net_altara_news_articles%rowtype;
  v_section text := lower(btrim(coalesce(requested_section, '')));
  v_scope text := lower(btrim(coalesce(requested_coverage_scope, '')));
  v_priority text := lower(btrim(coalesce(requested_priority, '')));
  v_deck text := nullif(btrim(requested_deck), '');
  v_source text := nullif(btrim(requested_source_label), '');
  v_location text := nullif(btrim(requested_location_label), '');
begin
  v_actor := public.assert_net_altara_news_gm_editor();
  if lower(btrim(coalesce(requested_slug, ''))) !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or char_length(btrim(coalesce(requested_slug, ''))) not between 1 and 100
    or v_section not in ('world', 'business', 'technology', 'culture')
    or v_scope not in ('world', 'local')
    or v_priority not in ('standard', 'breaking')
    or char_length(btrim(coalesce(requested_headline, ''))) not between 1 and 180
    or char_length(btrim(coalesce(requested_body, ''))) not between 1 and 16000
    or char_length(btrim(coalesce(requested_author_label, ''))) not between 1 and 100
    or (v_deck is not null and char_length(v_deck) > 400)
    or (v_source is not null and char_length(v_source) > 120)
    or (v_scope = 'local' and (v_location is null or char_length(v_location) > 120))
    or (v_scope = 'world' and v_location is not null)
    or requested_featured is null
  then
    raise exception 'ALTARA_NEWS_ARTICLE_INPUT_INVALID' using errcode = '22023';
  end if;

  if requested_article_id is null then
    insert into public.net_altara_news_articles (
      slug, section, coverage_scope, priority, headline, deck, body,
      author_label, source_label, location_label, featured, created_by_profile_id
    ) values (
      lower(btrim(requested_slug)), v_section, v_scope, v_priority,
      btrim(requested_headline), v_deck, btrim(requested_body),
      btrim(requested_author_label), v_source, v_location,
      requested_featured, v_actor
    ) returning * into v_article;
    perform public.audit_net_altara_news_gm_action(
      'altara-news.article.create', 'altara-news-article', v_article.id
    );
  else
    update public.net_altara_news_articles as article set
      slug = lower(btrim(requested_slug)), section = v_section,
      coverage_scope = v_scope, priority = v_priority,
      headline = btrim(requested_headline), deck = v_deck,
      body = btrim(requested_body), author_label = btrim(requested_author_label),
      source_label = v_source, location_label = v_location,
      featured = requested_featured
    where article.id = requested_article_id
      and article.status in ('draft', 'published')
    returning * into v_article;
    if not found then
      raise exception 'ALTARA_NEWS_ARTICLE_NOT_EDITABLE' using errcode = 'P0001';
    end if;
    perform public.audit_net_altara_news_gm_action(
      'altara-news.article.update', 'altara-news-article', v_article.id
    );
  end if;
  return public.net_altara_news_gm_article_payload(v_article.id);
end;
$$;

create or replace function public.set_net_altara_news_gm_article_lifecycle(
  requested_article_id uuid,
  requested_action text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_action text := lower(btrim(coalesce(requested_action, '')));
  v_article public.net_altara_news_articles%rowtype;
begin
  perform public.assert_net_altara_news_gm_editor();
  if v_action = 'publish' then
    update public.net_altara_news_articles set
      status = 'published', published_at = timezone('utc', now()), archived_at = null
    where id = requested_article_id and status = 'draft'
    returning * into v_article;
  elsif v_action = 'unpublish' then
    update public.net_altara_news_articles set
      status = 'draft', published_at = null, archived_at = null
    where id = requested_article_id and status = 'published'
    returning * into v_article;
  elsif v_action = 'archive' then
    update public.net_altara_news_articles set
      status = 'archived', archived_at = timezone('utc', now())
    where id = requested_article_id and status in ('draft', 'published')
    returning * into v_article;
  else
    raise exception 'ALTARA_NEWS_LIFECYCLE_ACTION_INVALID' using errcode = '22023';
  end if;
  if not found then
    raise exception 'ALTARA_NEWS_LIFECYCLE_INVALID' using errcode = 'P0001';
  end if;
  perform public.audit_net_altara_news_gm_action(
    'altara-news.article.' || v_action, 'altara-news-article', v_article.id
  );
  return public.net_altara_news_gm_article_payload(v_article.id);
end;
$$;

create or replace function public.set_net_altara_news_gm_article_media(
  requested_article_id uuid,
  requested_media_id uuid,
  requested_placement_kind text,
  requested_media_ref text,
  requested_caption text,
  requested_alt_text text,
  requested_paragraph_index integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_placement text := lower(btrim(coalesce(requested_placement_kind, '')));
  v_media_kind text;
  v_caption text := nullif(btrim(requested_caption), '');
  v_alt_text text := btrim(coalesce(requested_alt_text, ''));
  v_media public.net_altara_news_article_media%rowtype;
  v_ordinal smallint;
  v_changed boolean := false;
  v_audit_action text;
begin
  perform public.assert_net_altara_news_gm_editor();
  if requested_article_id is null
    or v_placement not in ('hero', 'inline')
    or octet_length(coalesce(requested_media_ref, '')) > 16384
    or octet_length(coalesce(requested_caption, '')) > 960
    or octet_length(coalesce(requested_alt_text, '')) > 1200
    or char_length(v_alt_text) not between 1 and 300
    or (v_caption is not null and char_length(v_caption) > 240)
    or (v_placement = 'hero' and requested_paragraph_index is not null)
    or (v_placement = 'inline' and coalesce(requested_paragraph_index, -1) not between 0 and 4095)
  then
    raise exception 'ALTARA_NEWS_MEDIA_INPUT_INVALID' using errcode = '22023';
  end if;

  if not public.net_altara_news_article_media_reference_is_valid(
    requested_media_ref,
    requested_article_id
  ) then
    raise exception 'ALTARA_NEWS_MEDIA_REFERENCE_INVALID' using errcode = '22023';
  end if;

  perform 1
  from public.net_altara_news_articles as article
  where article.id = requested_article_id
    and article.status in ('draft', 'published')
  for update;
  if not found then
    raise exception 'ALTARA_NEWS_ARTICLE_NOT_EDITABLE' using errcode = 'P0001';
  end if;

  v_media_kind := case when v_placement = 'hero' then 'hero' else 'gallery' end;
  if requested_media_id is not null then
    select media_record.* into v_media
    from public.net_altara_news_article_media as media_record
    where media_record.id = requested_media_id
      and media_record.article_id = requested_article_id
      and media_record.media_kind = v_media_kind
    for update;
    if not found then
      raise exception 'ALTARA_NEWS_MEDIA_NOT_FOUND' using errcode = 'P0002';
    end if;
  elsif v_media_kind = 'hero' then
    select media_record.* into v_media
    from public.net_altara_news_article_media as media_record
    where media_record.article_id = requested_article_id
      and media_record.media_kind = 'hero'
    for update;
  end if;

  if v_media.id is not null then
    update public.net_altara_news_article_media as media_record set
      media_ref = requested_media_ref,
      caption = v_caption,
      alt_text = v_alt_text,
      paragraph_index = case when v_media_kind = 'gallery'
        then requested_paragraph_index else null end
    where media_record.id = v_media.id
      and (
        media_record.media_ref,
        media_record.caption,
        media_record.alt_text,
        media_record.paragraph_index
      ) is distinct from (
        requested_media_ref,
        v_caption,
        v_alt_text,
        case when v_media_kind = 'gallery' then requested_paragraph_index else null end
      );
    v_changed := found;
    v_audit_action := 'altara-news.article.media.update';
  else
    if v_media_kind = 'gallery' then
      select candidate.ordinal::smallint into v_ordinal
      from generate_series(1, 8) as candidate(ordinal)
      where not exists (
        select 1 from public.net_altara_news_article_media as existing
        where existing.article_id = requested_article_id
          and existing.ordinal = candidate.ordinal
      )
      order by candidate.ordinal
      limit 1;
      if v_ordinal is null then
        raise exception 'ALTARA_NEWS_MEDIA_LIMIT_REACHED' using errcode = 'P0001';
      end if;
    else
      v_ordinal := 0;
    end if;

    insert into public.net_altara_news_article_media (
      article_id, media_kind, media_ref, caption, ordinal,
      alt_text, paragraph_index
    ) values (
      requested_article_id, v_media_kind, requested_media_ref, v_caption, v_ordinal,
      v_alt_text, case when v_media_kind = 'gallery' then requested_paragraph_index else null end
    );
    v_changed := true;
    v_audit_action := 'altara-news.article.media.add';
  end if;

  if v_changed then
    perform public.audit_net_altara_news_gm_action(
      v_audit_action, 'altara-news-article', requested_article_id
    );
  end if;
  return public.net_altara_news_gm_article_payload(requested_article_id);
end;
$$;

create or replace function public.remove_net_altara_news_gm_article_media(
  requested_article_id uuid,
  requested_media_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_net_altara_news_gm_editor();
  if requested_article_id is null or requested_media_id is null then
    raise exception 'ALTARA_NEWS_MEDIA_INPUT_INVALID' using errcode = '22023';
  end if;

  perform 1
  from public.net_altara_news_articles as article
  where article.id = requested_article_id
    and article.status in ('draft', 'published')
  for update;
  if not found then
    raise exception 'ALTARA_NEWS_ARTICLE_NOT_EDITABLE' using errcode = 'P0001';
  end if;

  delete from public.net_altara_news_article_media as media_record
  where media_record.id = requested_media_id
    and media_record.article_id = requested_article_id;
  if not found then
    raise exception 'ALTARA_NEWS_MEDIA_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform public.audit_net_altara_news_gm_action(
    'altara-news.article.media.remove', 'altara-news-article', requested_article_id
  );
  return public.net_altara_news_gm_article_payload(requested_article_id);
end;
$$;

drop trigger if exists net_altara_news_article_media_signal_realtime
  on public.net_altara_news_article_media;
create trigger net_altara_news_article_media_signal_realtime
after insert or update or delete on public.net_altara_news_article_media
for each row execute function public.signal_net_altara_news_change();

alter table public.net_altara_news_article_media enable row level security;
revoke all on table public.net_altara_news_article_media from public, anon, authenticated;

revoke all on function public.net_altara_news_article_media_reference_check(text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.net_altara_news_article_media_reference_is_valid(text, uuid)
  from public, anon, authenticated;
revoke all on function public.net_altara_news_article_media_ref_contains_object(text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.net_altara_news_article_media_payload(uuid)
  from public, anon, authenticated;
revoke all on function public.net_altara_news_gm_article_payload(uuid)
  from public, anon, authenticated;

revoke all on function public.current_user_can_write_net_altara_news_media_object(text)
  from public, anon, authenticated;
revoke all on function public.current_user_can_read_net_altara_news_media_object(text)
  from public, anon, authenticated;
grant execute on function public.current_user_can_write_net_altara_news_media_object(text)
  to authenticated;
grant execute on function public.current_user_can_read_net_altara_news_media_object(text)
  to authenticated;

revoke all on function public.fetch_net_altara_news_article(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.fetch_net_altara_news_gm_article(uuid)
  from public, anon, authenticated;
revoke all on function public.save_net_altara_news_gm_article(
  uuid, text, text, text, text, text, text, text, text, text, text, boolean
) from public, anon, authenticated;
revoke all on function public.set_net_altara_news_gm_article_lifecycle(uuid, text)
  from public, anon, authenticated;
revoke all on function public.set_net_altara_news_gm_article_media(
  uuid, uuid, text, text, text, text, integer
) from public, anon, authenticated;
revoke all on function public.remove_net_altara_news_gm_article_media(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.fetch_net_altara_news_article(uuid, uuid)
  to authenticated;
grant execute on function public.fetch_net_altara_news_gm_article(uuid)
  to authenticated;
grant execute on function public.save_net_altara_news_gm_article(
  uuid, text, text, text, text, text, text, text, text, text, text, boolean
) to authenticated;
grant execute on function public.set_net_altara_news_gm_article_lifecycle(uuid, text)
  to authenticated;
grant execute on function public.set_net_altara_news_gm_article_media(
  uuid, uuid, text, text, text, text, integer
) to authenticated;
grant execute on function public.remove_net_altara_news_gm_article_media(uuid, uuid)
  to authenticated;

-- Raw editorial/media tables remain absent from Realtime. Media mutations reuse
-- the already published singleton revision row and the existing one-channel client.
do $$
declare v_table text;
begin
  foreach v_table in array array[
    'net_altara_news_articles',
    'net_altara_news_article_media',
    'net_altara_news_incidents',
    'net_altara_news_incident_updates',
    'net_altara_news_saved_articles'
  ] loop
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime drop table public.%I', v_table);
    end if;
  end loop;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'net_altara_news_realtime_state'
  ) then
    alter publication supabase_realtime add table public.net_altara_news_realtime_state;
  end if;
exception when duplicate_object then null;
end;
$$;

commit;
