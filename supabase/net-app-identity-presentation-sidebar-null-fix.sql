-- Keep direct-recipient app-local presentation lookups from being evaluated
-- for group sidebar rows where no direct recipient exists.

create or replace function public.fetch_net_veil_messenger_sidebar(
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
    raise exception 'RELAY_AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_identity_link_id := public.net_veil_messenger_effective_identity(
    requested_expected_identity_link_id
  );

  if v_identity_link_id is null then
    if public.is_current_user_gm() then
      return jsonb_build_object(
        'status', 'identity-required',
        'reason', 'TAKE CONTROL or ACT AS a VEIL identity to access RELAY.',
        'identity', null,
        'conversations', '[]'::jsonb
      );
    end if;
    if requested_expected_identity_link_id is null then
      raise exception 'RELAY_ACCESS_DENIED' using errcode = '42501';
    end if;
    raise exception 'RELAY_CONTEXT_CHANGED' using errcode = 'P0001';
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
    from public.net_veil_messenger_conversation_members as membership
    join public.net_veil_messenger_conversations as conversation
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
      public.net_veil_messenger_conversation_members_json(
        conversation_page.id
      ) as members,
      not exists (
        select 1
        from public.net_veil_messenger_conversation_members as current_member
        where current_member.conversation_id = conversation_page.id
          and not public.net_veil_messenger_identity_can_use_messenger(
            current_member.identity_link_id
          )
      ) as can_send
    from conversation_page
    left join lateral (
      select message.*
      from public.net_veil_messenger_messages as message
      where message.conversation_id = conversation_page.id
      order by message.created_at desc, message.id desc
      limit 1
    ) as latest on true
    left join lateral (
      select count(*)::integer as value
      from (
        select 1
        from public.net_veil_messenger_messages as unread_message
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
            'author', public.fetch_net_app_identity_presentation(
              'relay',
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
    select case
      when hydrated.direct_recipient_id is not null then public.fetch_net_app_identity_presentation(
        'relay',
        hydrated.direct_recipient_id
      )
      else null::jsonb
    end as value
  ) as direct_presentation
    on true;

  return jsonb_build_object(
    'status', 'ready',
    'identity', public.fetch_net_app_identity_presentation('relay', v_identity_link_id),
    'conversations', v_conversations
  );
end;
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

  if requested_expected_identity_link_id is not null
    and (
      requested_expected_identity_link_id = public.current_net_runtime_source_identity_link_id()
      or requested_expected_identity_link_id = public.current_net_effective_runtime_identity_link_id()
    )
    and public.net_altara_identity_can_use_messenger(requested_expected_identity_link_id)
  then
    v_identity_link_id := requested_expected_identity_link_id;
  end if;

  if v_identity_link_id is null then
    if public.is_current_user_gm() then
      return jsonb_build_object(
        'status', 'identity-required',
        'reason', 'TAKE CONTROL of an ALTARA identity to access personal communications.',
        'identity', null,
        'conversations', '[]'::jsonb
      );
    end if;
    if requested_expected_identity_link_id is null then
      raise exception 'ALTARA_MESSENGER_ACCESS_DENIED' using errcode = '42501';
    end if;
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
            'author', public.fetch_net_app_identity_presentation(
              'altara-messenger',
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
    select case
      when hydrated.direct_recipient_id is not null then public.fetch_net_app_identity_presentation(
        'altara-messenger',
        hydrated.direct_recipient_id
      )
      else null::jsonb
    end as value
  ) as direct_presentation
    on true;

  return jsonb_build_object(
    'status', 'ready',
    'identity', public.fetch_net_app_identity_presentation('altara-messenger', v_identity_link_id),
    'conversations', v_conversations
  );
end;
$$;
