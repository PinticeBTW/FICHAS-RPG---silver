create table if not exists public.gm_settings (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  groups     jsonb not null default '[]',
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.gm_settings enable row level security;

-- Só o próprio GM pode ler/escrever as suas settings
create policy "gm_own" on public.gm_settings
  for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
