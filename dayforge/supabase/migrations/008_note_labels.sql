-- =============================================================================
-- MIGRATION: 008_note_labels.sql
-- VERSION: v1 (initial)
-- PURPOSE: Adds LABELS (categories) to notes, Google-Keep style:
--          - A note can carry SEVERAL labels at once (e.g. a "Trip budget"
--            note can be both "Travel" and "Money"), chosen per user request
--            over one-category-per-note folders.
--          - Labels are their own rows (note_labels) rather than free text
--            stored on each note, so a label can be renamed once and every
--            note using it follows, and a label can exist before any note
--            uses it (created up front from "Manage labels").
--          - Each note stores the ids of its labels in notes.label_ids
--            (a uuid array). An array rather than a join table because this
--            is a single-user app whose notes are always fully loaded and
--            filtered client-side — one column means no extra fetch and no
--            extra writes when toggling a label on a note.
--
-- RUN THIS ONCE in Supabase Dashboard -> SQL Editor -> New query, on top of
-- schema.sql + migrations 002 through 007. Safe to re-run: every statement
-- is guarded (if not exists / or replace / drop-then-create).
--
-- ASSUMPTIONS / EDGE CASES
--   - A label id left inside notes.label_ids after its label row is gone
--     (should not happen when deleting through the app, see
--     delete_note_label below) is simply ignored by the app's display and
--     filters — it never errors.
--   - Label names are unique per user ignoring case ("Work" and "work"
--     cannot both exist), enforced by a unique index on lower(name).
--   - sort_order exists for a future drag-to-reorder; today every label is
--     created with 0, so the app's (sort_order, name) ordering is
--     effectively alphabetical.
--     TODO: drag-to-reorder labels in "Manage labels" (writes sort_order).
-- =============================================================================

-- ---- The labels themselves -------------------------------------------------
create table if not exists note_labels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 1-40 visible characters; the app trims before saving and caps input at 40.
  name text not null check (char_length(btrim(name)) between 1 and 40),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table note_labels enable row level security;

-- Policies have no "if not exists", so drop-then-create keeps this re-runnable.
drop policy if exists "own note labels" on note_labels;
create policy "own note labels" on note_labels for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create unique index if not exists note_labels_user_name_uniq
  on note_labels (user_id, lower(name));

-- ---- Which labels each note carries ---------------------------------------
-- Empty array (not null) = unlabeled, so the app never has to null-check.
alter table notes add column if not exists label_ids uuid[] not null default '{}';

-- GIN index supports "notes having label X" lookups (label_id = any(label_ids))
-- used by delete_note_label below; harmless for the client-side filtering.
create index if not exists notes_label_ids_gin on notes using gin (label_ids);

-- ---- Deleting a label ------------------------------------------------------
-- Removes the label from every note that carries it AND deletes the label
-- row, in one call (one transaction), so a note can't be left pointing at a
-- deleted label if the connection drops halfway. SECURITY INVOKER means it
-- runs with the caller's own permissions, so the RLS policies above still
-- limit it to the caller's own notes and labels; the explicit
-- user_id = auth.uid() filters are a second, belt-and-braces guard.
-- Deliberately does NOT touch notes.updated_at: removing a label is not an
-- edit of the note's content, so it shouldn't show "Edited <time>".
create or replace function delete_note_label(p_label_id uuid)
returns void
language sql
security invoker
set search_path = public
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

-- Tell the Supabase API layer (PostgREST) to pick up the new table, column
-- and function right away instead of after its periodic schema refresh.
notify pgrst, 'reload schema';
