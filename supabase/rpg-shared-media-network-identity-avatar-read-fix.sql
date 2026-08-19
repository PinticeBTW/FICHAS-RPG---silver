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
      join public.net_identity_os_assignments as assignment
        on assignment.identity_link_id = link.id
      join public.net_os_families as os_family
        on os_family.id = assignment.primary_os_id
        and os_family.status = 'active'
      where link.subject_kind = v_subject_kind
        and link.subject_id::text = v_subject_id
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
