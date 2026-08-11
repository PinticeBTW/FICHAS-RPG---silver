-- NVN 1D: compact article invalidation for authenticated open NVN clients.
-- Run after net-nvn-foundation.sql and net-nvn-gm-control.sql.
-- The singleton row exposes only a monotonic revision and timestamp.

begin;

create table if not exists public.net_nvn_realtime_state (
  channel text primary key default 'public'
    check (channel = 'public'),
  article_revision bigint not null default 0
    check (article_revision >= 0),
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.net_nvn_realtime_state (channel, article_revision)
values ('public', 0)
on conflict (channel) do nothing;

alter table public.net_nvn_realtime_state enable row level security;

drop policy if exists net_nvn_realtime_state_select_authenticated
  on public.net_nvn_realtime_state;
create policy net_nvn_realtime_state_select_authenticated
on public.net_nvn_realtime_state
for select
to authenticated
using (channel = 'public');

revoke all on table public.net_nvn_realtime_state
  from public, anon, authenticated;
grant select on table public.net_nvn_realtime_state
  to authenticated;

create or replace function public.signal_net_nvn_article_change()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and row(
    new.slug,
    new.status,
    new.story_kind,
    new.priority,
    new.category,
    new.headline,
    new.short_headline,
    new.summary,
    new.body,
    new.byline_name,
    new.byline_role,
    new.byline_kind,
    new.source_status,
    new.tags,
    new.source_labels,
    new.district_label,
    new.location_label,
    new.occurred_at,
    new.pull_quote,
    new.pull_quote_attribution,
    new.primary_reference_app_id,
    new.primary_reference_resource_kind,
    new.primary_reference_resource_id,
    new.published_at,
    new.archived_at
  ) is not distinct from row(
    old.slug,
    old.status,
    old.story_kind,
    old.priority,
    old.category,
    old.headline,
    old.short_headline,
    old.summary,
    old.body,
    old.byline_name,
    old.byline_role,
    old.byline_kind,
    old.source_status,
    old.tags,
    old.source_labels,
    old.district_label,
    old.location_label,
    old.occurred_at,
    old.pull_quote,
    old.pull_quote_attribution,
    old.primary_reference_app_id,
    old.primary_reference_resource_kind,
    old.primary_reference_resource_id,
    old.published_at,
    old.archived_at
  ) then
    return null;
  end if;

  insert into public.net_nvn_realtime_state (
    channel,
    article_revision,
    updated_at
  ) values (
    'public',
    1,
    timezone('utc', now())
  )
  on conflict (channel) do update set
    article_revision = public.net_nvn_realtime_state.article_revision + 1,
    updated_at = excluded.updated_at;

  return null;
end;
$$;

drop trigger if exists net_nvn_articles_signal_realtime
  on public.net_nvn_articles;
create trigger net_nvn_articles_signal_realtime
after insert or update on public.net_nvn_articles
for each row execute procedure public.signal_net_nvn_article_change();

revoke all on function public.signal_net_nvn_article_change()
  from public, anon, authenticated;

-- The compact singleton is NVN's only Realtime publication. Article rows,
-- including drafts and bodies, must never enter the Realtime stream.
do $$
begin
  if exists (
    select 1
    from pg_publication_tables as publication_table
    where publication_table.pubname = 'supabase_realtime'
      and publication_table.schemaname = 'public'
      and publication_table.tablename = 'net_nvn_articles'
  ) then
    alter publication supabase_realtime drop table public.net_nvn_articles;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables as publication_table
    where publication_table.pubname = 'supabase_realtime'
      and publication_table.schemaname = 'public'
      and publication_table.tablename = 'net_nvn_realtime_state'
  ) then
    alter publication supabase_realtime add table public.net_nvn_realtime_state;
  end if;
exception when duplicate_object then null;
end $$;

commit;
