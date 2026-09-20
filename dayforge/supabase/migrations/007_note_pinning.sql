-- =============================================================================
-- MIGRATION: 007_note_pinning.sql
-- PURPOSE: Adds the ability to pin a note to the top of the Notes list.
--          This is UNRELATED to the existing "pinned reminders" feature on
--          tasks (task.pinned, a different column on a different table) —
--          that pins a TASK to the always-visible sidebar; this pins a
--          NOTE within the notepad's own list. Sharing the word "pin" is a
--          UI-language coincidence, not a shared mechanism.
-- RUN THIS ONCE in Supabase Dashboard -> SQL Editor -> New query, on top of
-- schema.sql + migrations 002 through 006.
-- =============================================================================

alter table notes add column if not exists pinned boolean not null default false;

create index if not exists notes_user_pinned_created_idx
  on notes (user_id, pinned desc, created_at desc);
