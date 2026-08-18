-- Migration incremental do Caderno do Mestre:
-- - nova visibilidade (private/all_players/selected_players)
-- - tabela de recipients por nota
-- - RLS para leitura partilhada segura
--
-- Corre este SQL no Supabase SQL Editor.

do $$
declare
  constraint_name text;
begin
  if exists (
    select 1
    from pg_tables
    where schemaname = 'public'
      and tablename = 'rpg_master_notes'
  ) then
    for constraint_name in
      select c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname = 'rpg_master_notes'
        and c.contype = 'c'
        and pg_get_constraintdef(c.oid) ilike '%visibility%'
    loop
      execute format(
        'alter table public.rpg_master_notes drop constraint if exists %I',
        constraint_name
      );
    end loop;

    update public.rpg_master_notes
    set visibility = case
      when visibility = 'shared' then 'all_players'
      when visibility in ('private', 'all_players', 'selected_players') then visibility
      else 'private'
    end;

    alter table public.rpg_master_notes
      alter column visibility set default 'private';

    alter table public.rpg_master_notes
      add constraint rpg_master_notes_visibility_check
      check (visibility in ('private', 'all_players', 'selected_players'));
  end if;
end $$;

create table if not exists public.rpg_master_note_recipients (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.rpg_master_notes (id) on delete cascade,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  unique (note_id, recipient_user_id)
);

create index if not exists rpg_master_note_recipients_note_id_idx
  on public.rpg_master_note_recipients (note_id);

create index if not exists rpg_master_note_recipients_owner_user_id_idx
  on public.rpg_master_note_recipients (owner_user_id);

create index if not exists rpg_master_note_recipients_recipient_user_id_idx
  on public.rpg_master_note_recipients (recipient_user_id);

grant select, insert, update, delete on public.rpg_master_note_recipients to authenticated;

alter table public.rpg_master_note_recipients enable row level security;

drop policy if exists rpg_master_notes_select_own on public.rpg_master_notes;
drop policy if exists rpg_master_notes_select_owner_or_recipient on public.rpg_master_notes;
create policy rpg_master_notes_select_owner_or_recipient
on public.rpg_master_notes
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.rpg_master_note_recipients recipient
    where recipient.note_id = rpg_master_notes.id
      and recipient.recipient_user_id = auth.uid()
      and rpg_master_notes.visibility in ('all_players', 'selected_players')
  )
);

drop policy if exists rpg_master_notes_insert_own on public.rpg_master_notes;
create policy rpg_master_notes_insert_own
on public.rpg_master_notes
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists rpg_master_notes_update_own on public.rpg_master_notes;
create policy rpg_master_notes_update_own
on public.rpg_master_notes
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists rpg_master_notes_delete_own on public.rpg_master_notes;
create policy rpg_master_notes_delete_own
on public.rpg_master_notes
for delete
to authenticated
using (user_id = auth.uid());

drop policy if exists rpg_master_note_recipients_select_owner on public.rpg_master_note_recipients;
create policy rpg_master_note_recipients_select_owner
on public.rpg_master_note_recipients
for select
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists rpg_master_note_recipients_select_recipient on public.rpg_master_note_recipients;
create policy rpg_master_note_recipients_select_recipient
on public.rpg_master_note_recipients
for select
to authenticated
using (recipient_user_id = auth.uid());

drop policy if exists rpg_master_note_recipients_insert_owner on public.rpg_master_note_recipients;
create policy rpg_master_note_recipients_insert_owner
on public.rpg_master_note_recipients
for insert
to authenticated
with check (
  owner_user_id = auth.uid()
  and exists (
    select 1
    from public.rpg_master_notes note
    where note.id = rpg_master_note_recipients.note_id
      and note.user_id = auth.uid()
  )
);

drop policy if exists rpg_master_note_recipients_update_owner on public.rpg_master_note_recipients;
create policy rpg_master_note_recipients_update_owner
on public.rpg_master_note_recipients
for update
to authenticated
using (
  owner_user_id = auth.uid()
  and exists (
    select 1
    from public.rpg_master_notes note
    where note.id = rpg_master_note_recipients.note_id
      and note.user_id = auth.uid()
  )
)
with check (
  owner_user_id = auth.uid()
  and exists (
    select 1
    from public.rpg_master_notes note
    where note.id = rpg_master_note_recipients.note_id
      and note.user_id = auth.uid()
  )
);

drop policy if exists rpg_master_note_recipients_delete_owner on public.rpg_master_note_recipients;
create policy rpg_master_note_recipients_delete_owner
on public.rpg_master_note_recipients
for delete
to authenticated
using (
  owner_user_id = auth.uid()
  and exists (
    select 1
    from public.rpg_master_notes note
    where note.id = rpg_master_note_recipients.note_id
      and note.user_id = auth.uid()
  )
);
