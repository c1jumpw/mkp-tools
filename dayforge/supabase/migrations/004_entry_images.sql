-- =============================================================================
-- MIGRATION: 004_entry_images.sql
-- PURPOSE: Adds labeled image attachments to both tasks and notes. Multiple
--          images per entry, each with its own optional text label, entered
--          at upload time.
-- RUN THIS ONCE in Supabase Dashboard -> SQL Editor -> New query, on top of
-- schema.sql + migrations 002 and 003.
-- =============================================================================

-- Two separate tables (not one polymorphic table) so each keeps a real
-- foreign key with ON DELETE CASCADE to its actual parent — deleting a task
-- or note cleanly deletes its image rows without needing application-level
-- cleanup logic or a fragile "entry_type" string column.
create table if not exists task_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  storage_path text not null,
  label text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists note_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  note_id uuid not null references notes(id) on delete cascade,
  storage_path text not null,
  label text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table task_images enable row level security;
alter table note_images enable row level security;

create policy "own task images" on task_images for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own note images" on note_images for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists task_images_task_idx on task_images (task_id, sort_order);
create index if not exists note_images_note_idx on note_images (note_id, sort_order);

-- Storage bucket for the actual image files. Private, same RLS pattern as
-- the voice-notes bucket (migration 002): every object path is prefixed
-- with the owning user's id, and the app never constructs a bare public URL
-- to one of these files.
insert into storage.buckets (id, name, public)
values ('entry-images', 'entry-images', false)
on conflict (id) do nothing;

create policy "own entry image objects select" on storage.objects for select
  using (bucket_id = 'entry-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own entry image objects insert" on storage.objects for insert
  with check (bucket_id = 'entry-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own entry image objects delete" on storage.objects for delete
  using (bucket_id = 'entry-images' and (storage.foldername(name))[1] = auth.uid()::text);
