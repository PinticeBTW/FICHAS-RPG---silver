-- Caderno do Mestre (instalação completa)
-- Corre este SQL no Supabase SQL Editor para ativar notas, pastas e partilhas.

create table if not exists public.rpg_master_note_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  parent_id uuid references public.rpg_master_note_folders (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.rpg_master_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Sem titulo',
  content text not null default '',
  note_type text not null default 'note' check (
    note_type in ('note', 'session', 'npc', 'location', 'quest', 'secret', 'rule')
  ),
  folder_id uuid references public.rpg_master_note_folders (id) on delete set null,
  tags text[] not null default '{}',
  visibility text not null default 'private' check (
    visibility in ('private', 'all_players', 'selected_players')
  ),
  is_favorite boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.rpg_master_note_recipients (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.rpg_master_notes (id) on delete cascade,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  unique (note_id, recipient_user_id)
);

create index if not exists rpg_master_notes_user_id_updated_at_idx
  on public.rpg_master_notes (user_id, updated_at desc);

create index if not exists rpg_master_notes_user_id_folder_id_idx
  on public.rpg_master_notes (user_id, folder_id);

create index if not exists rpg_master_notes_tags_gin_idx
  on public.rpg_master_notes using gin (tags);

create index if not exists rpg_master_note_folders_user_id_name_idx
  on public.rpg_master_note_folders (user_id, name);

create index if not exists rpg_master_note_recipients_note_id_idx
  on public.rpg_master_note_recipients (note_id);

create index if not exists rpg_master_note_recipients_owner_user_id_idx
  on public.rpg_master_note_recipients (owner_user_id);

create index if not exists rpg_master_note_recipients_recipient_user_id_idx
  on public.rpg_master_note_recipients (recipient_user_id);

grant select, insert, update, delete on public.rpg_master_notes to authenticated;
grant select, insert, update, delete on public.rpg_master_note_folders to authenticated;
grant select, insert, update, delete on public.rpg_master_note_recipients to authenticated;

alter table public.rpg_master_notes enable row level security;
alter table public.rpg_master_note_folders enable row level security;
alter table public.rpg_master_note_recipients enable row level security;

drop policy if exists rpg_master_notes_select_owner_or_recipient on public.rpg_master_notes;
drop policy if exists rpg_master_notes_select_own on public.rpg_master_notes;
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

drop policy if exists rpg_master_note_folders_select_own on public.rpg_master_note_folders;
create policy rpg_master_note_folders_select_own
on public.rpg_master_note_folders
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists rpg_master_note_folders_insert_own on public.rpg_master_note_folders;
create policy rpg_master_note_folders_insert_own
on public.rpg_master_note_folders
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists rpg_master_note_folders_update_own on public.rpg_master_note_folders;
create policy rpg_master_note_folders_update_own
on public.rpg_master_note_folders
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists rpg_master_note_folders_delete_own on public.rpg_master_note_folders;
create policy rpg_master_note_folders_delete_own
on public.rpg_master_note_folders
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

drop trigger if exists rpg_master_notes_set_updated_at on public.rpg_master_notes;
create trigger rpg_master_notes_set_updated_at
before update on public.rpg_master_notes
for each row execute procedure public.set_updated_at();

drop trigger if exists rpg_master_note_folders_set_updated_at on public.rpg_master_note_folders;
create trigger rpg_master_note_folders_set_updated_at
before update on public.rpg_master_note_folders
for each row execute procedure public.set_updated_at();
