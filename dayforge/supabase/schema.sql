-- =============================================================================
-- DayForge database schema
-- VERSION: v2 (2026-11-22)
-- =============================================================================
-- Everything DayForge stores lives in its own Postgres schema, `dayforge`, so
-- it can share a Supabase project with other tools (since v2 it lives in the
-- shared "mkp-tools" project next to PingPath, Circuit Book and My PD) without
-- name clashes. The app reaches it with createClient(..., { db: { schema:
-- 'dayforge' } }) (src/lib/supabaseClient.js), and the schema must be listed
-- under Project Settings -> Data API -> Exposed schemas.
--
-- Run this once in the project's SQL Editor (Dashboard -> SQL Editor -> New
-- query). Safe to re-run: every statement is guarded.
--
-- REVISION HISTORY
--   v1  initial      Tables in `public`; later features added by migrations
--                    002-009 (kept in migrations/ for the old standalone
--                    project, lmrbqkhefzbsnfxlszbs).
--   v2  2026-11-22  Moved to the `dayforge` schema for the shared mkp-tools
--                    project; storage policies renamed "DayForge: ..."; the
--                    admin is added by hand, no sign-up trigger (see the
--                    admin section);
--                    grants for the Data API at the end.
-- =============================================================================

create schema if not exists dayforge;
-- Unqualified names below are created in (and resolved from) dayforge.
set search_path = dayforge, public, extensions;

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

drop policy if exists "own tasks" on tasks;
create policy "own tasks" on tasks for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own completions" on task_completions;
create policy "own completions" on task_completions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own routines" on routines;
create policy "own routines" on routines for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own routine items" on routine_items;
create policy "own routine items" on routine_items for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists tasks_user_date_idx on tasks (user_id, date);
create index if not exists completions_user_task_date_idx on task_completions (user_id, task_id, date);
create index if not exists routine_items_routine_idx on routine_items (routine_id, sort_order);

-- =============================================================================
-- Voice notes (added in migrations/002_voice_notes.sql for already-deployed
-- projects; included here too so a FRESH install gets the same schema in one
-- pass). See that migration file's comments for the full explanation.
-- =============================================================================
alter table tasks add column if not exists voice_note_path text;
alter table tasks add column if not exists voice_note_transcript text;
alter table tasks add column if not exists voice_note_duration_seconds integer;

insert into storage.buckets (id, name, public)
values ('voice-notes', 'voice-notes', false)
on conflict (id) do nothing;

drop policy if exists "DayForge: own voice note objects select" on storage.objects;
create policy "DayForge: own voice note objects select" on storage.objects for select
  using (bucket_id = 'voice-notes' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "DayForge: own voice note objects insert" on storage.objects;
create policy "DayForge: own voice note objects insert" on storage.objects for insert
  with check (bucket_id = 'voice-notes' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "DayForge: own voice note objects delete" on storage.objects;
create policy "DayForge: own voice note objects delete" on storage.objects for delete
  using (bucket_id = 'voice-notes' and (storage.foldername(name))[1] = auth.uid()::text);

-- =============================================================================
-- Notes / notepad (added in migrations/003_notes.sql for already-deployed
-- projects; included here too so a FRESH install gets the same schema in one
-- pass). See that migration file's comments for the full explanation.
-- =============================================================================
create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  converted boolean not null default false,
  converted_task_id uuid references tasks(id) on delete set null,
  color text,
  pinned boolean not null default false,
  label_ids uuid[] not null default '{}',  -- ids from note_labels below; empty = unlabeled (migration 008)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table notes enable row level security;

drop policy if exists "own notes" on notes;
create policy "own notes" on notes for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists notes_user_created_idx on notes (user_id, created_at desc);
create index if not exists notes_user_pinned_created_idx on notes (user_id, pinned desc, created_at desc);
create index if not exists notes_label_ids_gin on notes using gin (label_ids);

-- =============================================================================
-- Note labels / categories (added in migrations/008_note_labels.sql for
-- already-deployed projects; included here so a FRESH install gets it in one
-- pass). A note can carry several labels via notes.label_ids above. See that
-- migration's comments for the full design rationale.
-- =============================================================================
create table if not exists note_labels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table note_labels enable row level security;

drop policy if exists "own note labels" on note_labels;
create policy "own note labels" on note_labels for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create unique index if not exists note_labels_user_name_uniq on note_labels (user_id, lower(name));

-- Removes a label from every note that has it, then deletes the label, in one
-- transaction. Runs with the caller's permissions (RLS still applies).
create or replace function delete_note_label(p_label_id uuid)
returns void
language sql
security invoker
set search_path = dayforge, public
as $$
  update notes
     set label_ids = array_remove(label_ids, p_label_id)
   where user_id = auth.uid()
     and p_label_id = any(label_ids);
  delete from note_labels
   where id = p_label_id
     and user_id = auth.uid();
$$;

grant execute on function delete_note_label(uuid) to authenticated;

-- =============================================================================
-- Labeled file attachments for tasks and notes — any file type, not just
-- images (added across migrations/004_entry_images.sql and
-- migrations/005_generic_attachments.sql for already-deployed projects;
-- included here in its FINAL form so a fresh install gets it in one pass,
-- without needing the create-then-rename history those migrations show).
-- The bucket is still named 'entry-images' for historical reasons (see
-- migration 005's note on why it wasn't renamed) even though it holds any
-- file type — an internal technical name, not shown to users.
-- =============================================================================
create table if not exists task_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  storage_path text not null,
  label text,
  mime_type text,
  original_filename text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists note_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  note_id uuid not null references notes(id) on delete cascade,
  storage_path text not null,
  label text,
  mime_type text,
  original_filename text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table task_attachments enable row level security;
alter table note_attachments enable row level security;

drop policy if exists "own task attachments" on task_attachments;
create policy "own task attachments" on task_attachments for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own note attachments" on note_attachments;
create policy "own note attachments" on note_attachments for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists task_attachments_task_idx on task_attachments (task_id, sort_order);
create index if not exists note_attachments_note_idx on note_attachments (note_id, sort_order);

insert into storage.buckets (id, name, public)
values ('entry-images', 'entry-images', false)
on conflict (id) do nothing;

drop policy if exists "DayForge: own entry image objects select" on storage.objects;
create policy "DayForge: own entry image objects select" on storage.objects for select
  using (bucket_id = 'entry-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "DayForge: own entry image objects insert" on storage.objects;
create policy "DayForge: own entry image objects insert" on storage.objects for insert
  with check (bucket_id = 'entry-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "DayForge: own entry image objects delete" on storage.objects;
create policy "DayForge: own entry image objects delete" on storage.objects for delete
  using (bucket_id = 'entry-images' and (storage.foldername(name))[1] = auth.uid()::text);


-- =============================================================================
-- Admin roles (added in migrations/009_admin_roles.sql for existing installs;
-- included here so a fresh install gets them in one pass). Admins see
-- ⋮ › Admin (change log, every change, admins list) and admin-only items in
-- What's new. The first admin is added by hand (see "First admin" below).
-- See the migration's header for the security model.
-- =============================================================================
create table if not exists dayforge.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table dayforge.app_admins enable row level security;
-- Intentionally no policies: direct table access is denied to the app.

-- ---- is_admin(): is the signed-in account an admin? ------------------------
create or replace function dayforge.is_admin()
returns boolean
language sql
stable
security definer
set search_path = dayforge, public
as $$
  select exists (select 1 from dayforge.app_admins where user_id = auth.uid());
$$;

-- ---- list_admins(): admins only ---------------------------------------------
create or replace function dayforge.list_admins()
returns table (user_id uuid, email text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = dayforge, public
as $$
begin
  if not dayforge.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return query
    select a.user_id, u.email::text, a.created_at
    from dayforge.app_admins a
    join auth.users u on u.id = a.user_id
    order by a.created_at;
end;
$$;

-- ---- add_admin(email): admins only ------------------------------------------
create or replace function dayforge.add_admin(p_email text)
returns void
language plpgsql
security definer
set search_path = dayforge, public
as $$
declare
  v_id uuid;
begin
  if not dayforge.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  select id into v_id from auth.users where lower(email) = lower(btrim(p_email)) limit 1;
  if v_id is null then
    raise exception 'No DayForge account uses that email yet. Ask them to sign up first.' using errcode = 'P0002';
  end if;
  insert into dayforge.app_admins (user_id, added_by) values (v_id, auth.uid())
  on conflict (user_id) do nothing;
end;
$$;

-- ---- remove_admin(user_id): admins only, never the last one -----------------
create or replace function dayforge.remove_admin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = dayforge, public
as $$
begin
  if not dayforge.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if (select count(*) from dayforge.app_admins) <= 1
     and exists (select 1 from dayforge.app_admins where user_id = p_user_id) then
    raise exception 'Keep at least one admin.' using errcode = 'P0001';
  end if;
  delete from dayforge.app_admins where user_id = p_user_id;
end;
$$;

-- Only signed-in accounts may call these (each one checks admin itself).
revoke all on function dayforge.is_admin() from public, anon;
revoke all on function dayforge.list_admins() from public, anon;
revoke all on function dayforge.add_admin(text) from public, anon;
revoke all on function dayforge.remove_admin(uuid) from public, anon;
grant execute on function dayforge.is_admin() to authenticated;
grant execute on function dayforge.list_admins() to authenticated;
grant execute on function dayforge.add_admin(text) to authenticated;
grant execute on function dayforge.remove_admin(uuid) to authenticated;

-- ---- First admin ------------------------------------------------------------
-- Not picked automatically: in a shared project the first account in
-- auth.users may belong to another tool. Make the DayForge owner admin once:
--   insert into dayforge.app_admins (user_id)
--   select id from auth.users where lower(email) = lower('<owner email>');

-- No sign-up trigger: in a shared project a trigger on auth.users would run
-- for every tool's sign-ups (and block them all if this schema broke). Add
-- the first admin by hand, as above.
-- Projects that ran migration 009 have a trigger dayforge_claim_first_admin
-- on auth.users calling public.claim_first_admin(); it only ever acts on the
-- very first account, so it's harmless there.

-- =============================================================================
-- Data API access. Row level security above decides WHICH rows; these grants
-- let signed-in users reach the schema at all. anon gets usage only (every
-- DayForge call needs a signed-in user).
-- =============================================================================
grant usage on schema dayforge to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema dayforge to authenticated, service_role;
alter default privileges in schema dayforge grant select, insert, update, delete on tables to authenticated, service_role;
grant execute on function dayforge.delete_note_label(uuid) to authenticated;

-- Make the schema's tables and functions visible to the app immediately.
notify pgrst, 'reload schema';
