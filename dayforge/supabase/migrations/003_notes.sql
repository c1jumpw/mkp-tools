-- =============================================================================
-- MIGRATION: 003_notes.sql
-- PURPOSE: Adds a lightweight "notepad" — raw, unstructured quick-capture
--          notes that live BEFORE the tray in the app's funnel (Notepad ->
--          Tray -> Timeline). Each note is one text blob; a "Convert to
--          task" action in the app creates a task from it and links back.
-- RUN THIS ONCE in Supabase Dashboard -> SQL Editor -> New query, on top of
-- the already-applied schema.sql + migrations/002_voice_notes.sql.
-- =============================================================================

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  -- content is the RAW text as typed, including the user's own "-"/"•"
  -- bullet markers and multi-topic "—)" separators — parsing/display of
  -- topic vs. bullet lines happens client-side (see src/lib/notesParsing.js),
  -- not in the database, so the exact rendering logic can evolve without a
  -- migration.
  converted boolean not null default false,
  converted_task_id uuid references tasks(id) on delete set null,
  -- ^ set when "Convert to task" is used, so the app can offer a "view the
  -- task" link from the original note. ON DELETE SET NULL rather than
  -- CASCADE: if the resulting task is later deleted, the note itself should
  -- NOT disappear too — it just reverts to showing as unconverted-looking
  -- (though `converted` stays true; the app treats a set task_id as the
  -- source of truth for "still linked to a live task").
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table notes enable row level security;

create policy "own notes" on notes for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists notes_user_created_idx on notes (user_id, created_at desc);
