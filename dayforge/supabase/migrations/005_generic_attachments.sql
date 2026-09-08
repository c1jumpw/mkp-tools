-- =============================================================================
-- MIGRATION: 005_generic_attachments.sql
-- PURPOSE: Broadens image attachments (migration 004) into attachments of
--          ANY file type — documents, PDFs, etc, not just photos. Renames
--          the tables accordingly and adds columns to track each file's
--          real MIME type and original filename (needed to render non-image
--          files sensibly and offer a correct download name).
-- RUN THIS ONCE in Supabase Dashboard -> SQL Editor -> New query, on top of
-- schema.sql + migrations 002, 003, and 004.
-- =============================================================================

-- Table rename is metadata-only in Postgres — existing rows, RLS policies,
-- and the foreign keys pointing at tasks/notes all carry over unchanged.
alter table if exists task_images rename to task_attachments;
alter table if exists note_images rename to note_attachments;

alter table task_attachments add column if not exists mime_type text;
alter table task_attachments add column if not exists original_filename text;
alter table note_attachments add column if not exists mime_type text;
alter table note_attachments add column if not exists original_filename text;

-- NOTE: the underlying Storage bucket stays named 'entry-images' (NOT
-- renamed to match). Renaming a Storage bucket's id would require moving
-- every already-uploaded object to new paths (bucket_id is effectively
-- part of each object's identity) — real risk to already-uploaded photos
-- for a purely cosmetic rename of an internal technical name nobody sees.
-- The bucket now generically holds any file type despite its name; this is
-- noted in src/lib/entryAttachments.js as well.
