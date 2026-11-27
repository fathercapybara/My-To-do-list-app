-- Run this in Supabase → SQL Editor → New query → Run.

-- 1. Table
create table public.tasks (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid()
                         references auth.users (id) on delete cascade,
  title      text        not null check (char_length(title) between 1 and 500),
  done       boolean     not null default false,
  created_at timestamptz not null default now()
);

create index tasks_user_created_idx on public.tasks (user_id, created_at desc);

-- Newer Supabase projects don't expose new tables to the API automatically,
-- so signed-in users need explicit table privileges (RLS below still limits
-- them to their own rows). The anon role gets nothing.
grant select, insert, update, delete on public.tasks to authenticated;

-- 2. Row-Level Security: each signed-in user can only touch their own rows
alter table public.tasks enable row level security;

create policy "Users can view their own tasks"
  on public.tasks for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own tasks"
  on public.tasks for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own tasks"
  on public.tasks for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own tasks"
  on public.tasks for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- 3. Real-time sync across devices
alter publication supabase_realtime add table public.tasks;
