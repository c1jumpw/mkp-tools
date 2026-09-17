-- =============================================================================
-- MIGRATION: 006_note_colors.sql
-- PURPOSE: Adds an optional color tag to notes (Keep-style color-coding).
-- RUN THIS ONCE in Supabase Dashboard -> SQL Editor -> New query, on top of
-- schema.sql + migrations 002 through 005.
-- =============================================================================

alter table notes add column if not exists color text;
-- ^ Stores a COLOR KEY (e.g. 'red', 'teal', 'purple' — see the palette in
-- src/lib/noteColors.js), not a raw hex value. Null/absent means "no color
-- chosen", which renders with the app's existing default accent. Keeping
-- this as a small fixed set of named keys (rather than a free-form hex
-- string) means the palette's actual colors can be retuned later purely in
-- the frontend, without a migration or touching any already-colored note.
