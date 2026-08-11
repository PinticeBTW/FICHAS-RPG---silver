-- NVN 1E: secure shared-media metadata for newsroom articles.
-- Run after net-nvn-foundation.sql, net-nvn-gm-control.sql,
-- net-nvn-realtime.sql, and rpg-shared-media.sql.
--
-- This migration creates no articles and uploads no objects. Image bytes stay
-- in the existing private rpg-media bucket; PostgreSQL stores only compact
-- rpg-media:v1 descriptors and deterministic paragraph placement metadata.

begin;

create table if not exists public.net_nvn_article_media (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.net_nvn_articles (id) on delete cascade,
  placement_kind text not null check (placement_kind in ('hero', 'inline')),
  media_ref text not null,
  caption text,
  alt_text text not null,
  paragraph_index integer,
  sort_order integer not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint net_nvn_article_media_reference_shape check (
    char_length(media_ref) between 1 and 4096
    and media_ref like 'rpg-media:v1:%'
  ),
  constraint net_nvn_article_media_caption_shape check (
    caption is null
    or (caption = btrim(caption) and char_length(caption) between 1 and 400)
  ),
  constraint net_nvn_article_media_alt_shape check (
    alt_text = btrim(alt_text) and char_length(alt_text) between 1 and 300
  ),
  constraint net_nvn_article_media_placement_shape check (
    (
      placement_kind = 'hero'
      and paragraph_index is null
      and sort_order = 0
    )
    or (
      placement_kind = 'inline'
      and paragraph_index between 0 and 4095
      and sort_order between 0 and 7
    )
  ),
  constraint net_nvn_article_media_slot_unique
    unique (article_id, placement_kind, sort_order)
);

create or replace function public.set_net_nvn_article_media_updated_at()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_net_nvn_article_media_updated_at
  on public.net_nvn_article_media;
create trigger set_net_nvn_article_media_updated_at
before update on public.net_nvn_article_media
for each row execute function public.set_net_nvn_article_media_updated_at();

-- One fail-closed parser is authoritative for both descriptor validation and
-- exact Storage-object membership. A descriptor accepted for one immutable
-- article UUID cannot be attached to or authorize objects for another article.
create or replace function public.net_nvn_article_media_reference_check(
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
      or split_part(variant_path, '/', 1) <> 'nvn-article'
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

create or replace function public.net_nvn_article_media_reference_is_valid(
  requested_media_ref text,
  requested_article_id uuid
)
returns boolean
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select public.net_nvn_article_media_reference_check(
    requested_media_ref,
    requested_article_id,
    null
  );
$$;

create or replace function public.net_nvn_article_media_ref_contains_object(
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
    and public.net_nvn_article_media_reference_check(
      requested_media_ref,
      requested_article_id,
      requested_object_name
    );
$$;

-- Extend the existing shared-media authority helpers with one narrow subject
-- kind. Other subject branches are intentionally unchanged.
create or replace function public.current_user_can_write_rpg_media_object(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  subject_kind text := split_part(object_name, '/', 1);
  subject_id text := split_part(object_name, '/', 2);
  media_kind text := split_part(object_name, '/', 3);
begin
  if actor is null
    or subject_kind = ''
    or subject_id = ''
    or media_kind = ''
    or split_part(object_name, '/', 6) = ''
    or object_name like '%..%'
  then
    return false;
  end if;

  case subject_kind
    when 'profile-sheet' then
      return subject_id = actor::text or public.is_current_user_gm();

    when 'npc-card' then
      return exists (
        select 1
        from public.npc_cards as card
        where card.id::text = subject_id
          and (
            public.is_current_user_gm()
            or card.owner_profile_id = actor
            or public.has_sheet_share_access('npc', card.id)
          )
      );

    when 'profile' then
      return subject_id = actor::text;

    when 'character' then
      return exists (
        select 1
        from public.characters as character_record
        where character_record.id::text = subject_id
          and (character_record.owner_profile_id = actor or public.is_current_user_gm())
      );

    when 'identity-link', 'universal-profile' then
      return exists (
        select 1
        from public.net_identity_links as link
        where link.id::text = subject_id
          and public.current_user_controls_playable_net_identity_link(link.id)
      );

    when 'app-account' then
      return exists (
        select 1
        from public.net_app_accounts as account
        where account.id::text = subject_id
          and account.identity_link_id is not null
          and public.current_user_controls_playable_net_identity_link(account.identity_link_id)
      );

    when 'gm-profile' then
      return subject_id = actor::text and public.is_current_user_gm();

    when 'global' then
      return subject_id = 'global' and media_kind = 'cyberware' and public.is_current_user_gm();

    when 'nvn-article' then
      return media_kind = 'general'
        and split_part(object_name, '/', 7) = ''
        and public.is_current_user_gm()
        and exists (
          select 1
          from public.net_nvn_articles as article
          where article.id::text = subject_id
        );

    else
      return false;
  end case;
end;
$$;

create or replace function public.current_user_can_read_rpg_media_object(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  subject_kind text := split_part(object_name, '/', 1);
  subject_id text := split_part(object_name, '/', 2);
  media_kind text := split_part(object_name, '/', 3);
begin
  if actor is null or subject_kind = '' or subject_id = '' or media_kind = '' then
    return false;
  end if;

  if media_kind = 'avatar' and subject_kind in ('universal-profile', 'app-account') then
    return true;
  end if;

  if media_kind = 'avatar'
    and subject_kind in ('profile-sheet', 'npc-card', 'character')
    and exists (
      select 1
      from public.net_identity_links as link
      join public.net_app_accounts as account on account.identity_link_id = link.id
      where link.subject_kind = subject_kind
        and link.subject_id::text = subject_id
        and account.status = 'active'
    )
  then
    return true;
  end if;

  if subject_kind = 'global' and subject_id = 'global' and media_kind = 'cyberware' then
    return true;
  end if;

  case subject_kind
    when 'profile-sheet' then
      return subject_id = actor::text
        or public.is_current_user_gm()
        or exists (
          select 1 from public.profiles as sheet_profile
          where sheet_profile.id::text = subject_id
            and public.has_sheet_share_access('profile', sheet_profile.id)
        );

    when 'npc-card' then
      return exists (
        select 1
        from public.npc_cards as card
        where card.id::text = subject_id
          and (
            public.is_current_user_gm()
            or card.owner_profile_id = actor
            or public.has_sheet_share_access('npc', card.id)
          )
      );

    when 'character' then
      return exists (
        select 1
        from public.characters as character_record
        where character_record.id::text = subject_id
          and (character_record.owner_profile_id = actor or public.is_current_user_gm())
      );

    when 'profile' then
      return subject_id = actor::text or public.is_current_user_gm();

    when 'identity-link', 'universal-profile' then
      return public.is_current_user_gm() or exists (
        select 1
        from public.net_identity_links as link
        where link.id::text = subject_id
          and public.current_user_controls_playable_net_identity_link(link.id)
      );

    when 'app-account' then
      return public.is_current_user_gm() or exists (
        select 1
        from public.net_app_accounts as account
        where account.id::text = subject_id
          and account.identity_link_id is not null
          and public.current_user_controls_playable_net_identity_link(account.identity_link_id)
      );

    when 'gm-profile' then
      return subject_id = actor::text and public.is_current_user_gm();

    when 'nvn-article' then
      return media_kind = 'general'
        and split_part(object_name, '/', 6) <> ''
        and split_part(object_name, '/', 7) = ''
        and object_name not like '%..%'
        and exists (
          select 1
          from public.net_nvn_articles as article
          where article.id::text = subject_id
            and (
              public.is_current_user_gm()
              or (
                article.status in ('published', 'archived')
                and exists (
                  select 1
                  from public.net_nvn_article_media as media_record
                  where media_record.article_id = article.id
                    and public.net_nvn_article_media_ref_contains_object(
                      media_record.media_ref,
                      article.id,
                      object_name
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

-- The player list remains text-first. Only exact detail returns the bounded
-- media projection, avoiding joins and signed-URL work on Home/Search/Archive.
drop function if exists public.fetch_net_nvn_article(uuid);
create function public.fetch_net_nvn_article(
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
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if requested_article_id is null then
    return;
  end if;

  return query
  select
    article.id,
    article.slug,
    article.status,
    article.headline,
    article.short_headline,
    article.summary,
    article.body,
    article.story_kind,
    article.priority,
    article.category,
    article.byline_name,
    article.byline_role,
    article.byline_kind,
    article.source_status,
    article.tags,
    article.source_labels,
    article.district_label,
    article.location_label,
    article.occurred_at,
    article.pull_quote,
    article.pull_quote_attribution,
    article.primary_reference_app_id,
    article.primary_reference_resource_kind,
    article.primary_reference_resource_id,
    article.published_at,
    article.updated_at,
    article.archived_at,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', media_record.id,
          'placement_kind', media_record.placement_kind,
          'media_ref', media_record.media_ref,
          'caption', media_record.caption,
          'alt_text', media_record.alt_text,
          'paragraph_index', media_record.paragraph_index,
          'sort_order', media_record.sort_order
        )
        order by
          case media_record.placement_kind when 'hero' then 0 else 1 end,
          media_record.sort_order,
          media_record.id
      )
      from public.net_nvn_article_media as media_record
      where media_record.article_id = article.id
    ), '[]'::jsonb) as media
  from public.net_nvn_articles as article
  where article.id = requested_article_id
    and article.status in ('published', 'archived');
end;
$$;

-- Keep the ECHO-learned snapshot rule: this helper is VOLATILE because GM
-- mutation RPCs call it immediately after writes in the same request.
create or replace function public.net_nvn_gm_article_payload(
  requested_article_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', article.id,
    'slug', article.slug,
    'status', article.status,
    'story_kind', article.story_kind,
    'priority', article.priority,
    'category', article.category,
    'headline', article.headline,
    'short_headline', article.short_headline,
    'summary', article.summary,
    'body', article.body,
    'byline_name', article.byline_name,
    'byline_role', article.byline_role,
    'byline_kind', article.byline_kind,
    'source_status', article.source_status,
    'tags', to_jsonb(article.tags),
    'source_labels', to_jsonb(article.source_labels),
    'district_label', article.district_label,
    'location_label', article.location_label,
    'occurred_at', article.occurred_at,
    'pull_quote', article.pull_quote,
    'pull_quote_attribution', article.pull_quote_attribution,
    'primary_reference_app_id', article.primary_reference_app_id,
    'primary_reference_resource_kind', article.primary_reference_resource_kind,
    'primary_reference_resource_id', article.primary_reference_resource_id,
    'created_at', article.created_at,
    'updated_at', article.updated_at,
    'published_at', article.published_at,
    'archived_at', article.archived_at,
    'media', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', media_record.id,
          'placement_kind', media_record.placement_kind,
          'media_ref', media_record.media_ref,
          'caption', media_record.caption,
          'alt_text', media_record.alt_text,
          'paragraph_index', media_record.paragraph_index,
          'sort_order', media_record.sort_order
        )
        order by
          case media_record.placement_kind when 'hero' then 0 else 1 end,
          media_record.sort_order,
          media_record.id
      )
      from public.net_nvn_article_media as media_record
      where media_record.article_id = article.id
    ), '[]'::jsonb)
  )
  from public.net_nvn_articles as article
  where article.id = requested_article_id;
$$;

-- One upsert-style metadata mutation keeps hero replacement and inline edits
-- on the same authority boundary. Parent-row locking makes the bounded slot
-- allocation concurrency-safe. Unique slots structurally cap 1 hero + 8 inline.
create or replace function public.set_net_nvn_gm_article_media(
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
  normalized_placement text := lower(btrim(coalesce(requested_placement_kind, '')));
  normalized_caption text := nullif(btrim(requested_caption), '');
  normalized_alt_text text := btrim(coalesce(requested_alt_text, ''));
  target_media public.net_nvn_article_media%rowtype;
  available_sort_order integer;
  changed boolean := false;
  audit_action text;
begin
  perform public.assert_net_nvn_gm_editor();

  if requested_article_id is null
    or normalized_placement not in ('hero', 'inline')
    or octet_length(coalesce(requested_media_ref, '')) > 16384
    or octet_length(coalesce(requested_caption, '')) > 1600
    or octet_length(coalesce(requested_alt_text, '')) > 1200
    or char_length(normalized_alt_text) not between 1 and 300
    or (normalized_caption is not null and char_length(normalized_caption) > 400)
    or (normalized_placement = 'hero' and requested_paragraph_index is not null)
    or (
      normalized_placement = 'inline'
      and coalesce(requested_paragraph_index, -1) not between 0 and 4095
    )
  then
    raise exception 'NVN_MEDIA_INPUT_INVALID' using errcode = '22023';
  end if;

  if not public.net_nvn_article_media_reference_is_valid(
    requested_media_ref,
    requested_article_id
  ) then
    raise exception 'NVN_MEDIA_REFERENCE_INVALID' using errcode = '22023';
  end if;

  perform 1
  from public.net_nvn_articles as article
  where article.id = requested_article_id
  for update;
  if not found then
    raise exception 'NVN_ARTICLE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if requested_media_id is not null then
    select media_record.* into target_media
    from public.net_nvn_article_media as media_record
    where media_record.id = requested_media_id
      and media_record.article_id = requested_article_id
      and media_record.placement_kind = normalized_placement
    for update;
    if not found then
      raise exception 'NVN_MEDIA_NOT_FOUND' using errcode = 'P0002';
    end if;
  elsif normalized_placement = 'hero' then
    select media_record.* into target_media
    from public.net_nvn_article_media as media_record
    where media_record.article_id = requested_article_id
      and media_record.placement_kind = 'hero'
    for update;
  end if;

  if target_media.id is not null then
    update public.net_nvn_article_media as media_record
    set
      media_ref = requested_media_ref,
      caption = normalized_caption,
      alt_text = normalized_alt_text,
      paragraph_index = case
        when normalized_placement = 'inline' then requested_paragraph_index
        else null
      end
    where media_record.id = target_media.id
      and (
        media_record.media_ref,
        media_record.caption,
        media_record.alt_text,
        media_record.paragraph_index
      ) is distinct from (
        requested_media_ref,
        normalized_caption,
        normalized_alt_text,
        case when normalized_placement = 'inline' then requested_paragraph_index else null end
      );
    changed := found;
    audit_action := 'nvn.article.media.update';
  else
    if normalized_placement = 'inline' then
      select candidate.sort_order into available_sort_order
      from generate_series(0, 7) as candidate(sort_order)
      where not exists (
        select 1
        from public.net_nvn_article_media as existing
        where existing.article_id = requested_article_id
          and existing.placement_kind = 'inline'
          and existing.sort_order = candidate.sort_order
      )
      order by candidate.sort_order
      limit 1;
      if available_sort_order is null then
        raise exception 'NVN_MEDIA_LIMIT_REACHED' using errcode = 'P0001';
      end if;
    else
      available_sort_order := 0;
    end if;

    insert into public.net_nvn_article_media (
      article_id,
      placement_kind,
      media_ref,
      caption,
      alt_text,
      paragraph_index,
      sort_order
    ) values (
      requested_article_id,
      normalized_placement,
      requested_media_ref,
      normalized_caption,
      normalized_alt_text,
      case when normalized_placement = 'inline' then requested_paragraph_index else null end,
      available_sort_order
    );
    changed := true;
    audit_action := 'nvn.article.media.add';
  end if;

  if changed then
    perform public.audit_net_nvn_gm_action(audit_action, requested_article_id);
  end if;
  return public.net_nvn_gm_article_payload(requested_article_id);
end;
$$;

create or replace function public.remove_net_nvn_gm_article_media(
  requested_article_id uuid,
  requested_media_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  removed boolean := false;
begin
  perform public.assert_net_nvn_gm_editor();
  if requested_article_id is null or requested_media_id is null then
    raise exception 'NVN_MEDIA_INPUT_INVALID' using errcode = '22023';
  end if;

  perform 1
  from public.net_nvn_articles as article
  where article.id = requested_article_id
  for update;
  if not found then
    raise exception 'NVN_ARTICLE_NOT_FOUND' using errcode = 'P0002';
  end if;

  delete from public.net_nvn_article_media as media_record
  where media_record.id = requested_media_id
    and media_record.article_id = requested_article_id;
  removed := found;
  if not removed then
    raise exception 'NVN_MEDIA_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform public.audit_net_nvn_gm_action(
    'nvn.article.media.remove',
    requested_article_id
  );
  return public.net_nvn_gm_article_payload(requested_article_id);
end;
$$;

-- Child-row changes reuse the already deployed metadata-free NVN singleton.
-- No article/media IDs, editor IDs, or lifecycle data enter Realtime.
create or replace function public.signal_net_nvn_article_media_change()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and old is not distinct from new then
    return new;
  end if;

  update public.net_nvn_realtime_state
  set
    article_revision = article_revision + 1,
    updated_at = timezone('utc', now())
  where channel = 'public';
  if not found then
    raise exception 'NVN realtime singleton is missing.' using errcode = '55000';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists signal_net_nvn_article_media_change
  on public.net_nvn_article_media;
create trigger signal_net_nvn_article_media_change
after insert or update or delete on public.net_nvn_article_media
for each row execute function public.signal_net_nvn_article_media_change();

alter table public.net_nvn_article_media enable row level security;
revoke all on table public.net_nvn_article_media from public, anon, authenticated;

revoke all on function public.set_net_nvn_article_media_updated_at()
  from public, anon, authenticated;
revoke all on function public.net_nvn_article_media_reference_check(text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.net_nvn_article_media_reference_is_valid(text, uuid)
  from public, anon, authenticated;
revoke all on function public.net_nvn_article_media_ref_contains_object(text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.signal_net_nvn_article_media_change()
  from public, anon, authenticated;
revoke all on function public.net_nvn_gm_article_payload(uuid)
  from public, anon, authenticated;

revoke all on function public.fetch_net_nvn_article(uuid)
  from public, anon, authenticated;
grant execute on function public.fetch_net_nvn_article(uuid)
  to authenticated;

revoke all on function public.set_net_nvn_gm_article_media(
  uuid, uuid, text, text, text, text, integer
) from public, anon, authenticated;
revoke all on function public.remove_net_nvn_gm_article_media(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.set_net_nvn_gm_article_media(
  uuid, uuid, text, text, text, text, integer
) to authenticated;
grant execute on function public.remove_net_nvn_gm_article_media(uuid, uuid)
  to authenticated;

-- The Storage policy helpers remain intentionally executable by authenticated:
-- Storage RLS calls them, and each helper derives auth.uid() and authority.
revoke all on function public.current_user_can_write_rpg_media_object(text) from public;
revoke all on function public.current_user_can_read_rpg_media_object(text) from public;
grant execute on function public.current_user_can_write_rpg_media_object(text) to authenticated;
grant execute on function public.current_user_can_read_rpg_media_object(text) to authenticated;

commit;
