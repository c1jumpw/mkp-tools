-- DayForge database schema
-- Run this once in your Supabase project's SQL Editor (Supabase Dashboard -> SQL Editor -> New query)

create extension if not exists "pgcrypto";

-- Tasks: to-dos, reminders, and events, scheduled or unscheduled, one-off or recurring.
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  notes text,
  type text not null default 'todo' check (type in ('todo', 'reminder', 'event')),
  category text not null default 'personal' check (category in ('personal', 'work')),
  pinned boolean not null default false,
  date date,                       -- null = unscheduled (lives in the tray) or an undated pinned reminder
  start_time time,                 -- null = no specific time (all-day / tray item)
  duration_minutes integer not null default 30,
  completed boolean not null default false,   -- used for non-recurring tasks
  recurrence text not null default 'none' check (recurrence in ('none', 'daily', 'weekly')),
  recurrence_days int[] default '{}',         -- 0=Sun..6=Sat, used when recurrence = 'weekly'
  created_at timestamptz not null default now()
);

-- Per-date completion state for recurring task instances.
create table if not exists task_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  date date not null,
  completed_at timestamptz not null default now(),
  unique (task_id, date)
);

-- Reusable routine templates (e.g. "Morning Routine", "Gym Day").
create table if not exists routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

-- Items within a routine template.
create table if not exists routine_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  routine_id uuid not null references routines(id) on delete cascade,
  title text not null,
  category text not null default 'personal' check (category in ('personal', 'work')),
  type text not null default 'todo' check (type in ('todo', 'reminder', 'event')),
  start_time time,
  duration_minutes integer not null default 30,
  sort_order integer not null default 0
);

alter table tasks enable row level security;
alter table task_completions enable row level security;
alter table routines enable row level security;
alter table routine_items enable row level security;

create policy "own tasks" on tasks for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own completions" on task_completions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own routines" on routines for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own routine items" on routine_items for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists tasks_user_date_idx on tasks (user_id, date);
create index if not exists completions_user_task_date_idx on task_completions (user_id, task_id, date);
create index if not exists routine_items_routine_idx on routine_items (routine_id, sort_order);
