-- =============================================================================
-- MIGRATION: 002_voice_notes.sql
-- PURPOSE: Adds voice notes alongside the existing text `notes` field on
--          tasks. One optional voice note per task: a pointer to the audio
--          file in Supabase Storage, its transcript, and its duration.
-- RUN THIS ONCE in Supabase Dashboard -> SQL Editor -> New query, on top of
-- the already-applied supabase/schema.sql.
-- =============================================================================

-- New columns on tasks. All nullable — a task with no voice note simply has
-- these as null, same pattern as the existing `notes` text column.
alter table tasks add column if not exists voice_note_path text;
-- ^ Storage object path within the 'voice-notes' bucket, e.g.
--   "<user_id>/<task_id>-<timestamp>.webm". NOT a public URL — the bucket is
--   private, so the app fetches audio via an authenticated download call
--   (see src/lib/voiceNotes.js), not by constructing a URL from this path.
alter table tasks add column if not exists voice_note_transcript text;
-- ^ The transcribed (and user-editable) text of the voice note.
alter table tasks add column if not exists voice_note_duration_seconds integer;
-- ^ Recording length in whole seconds, shown in the UI (e.g. "0:42").

-- Storage bucket for the actual audio files. `public = false` — nobody can
-- read these files via a bare URL; every read goes through Supabase Auth +
-- the RLS policies below.
insert into storage.buckets (id, name, public)
values ('voice-notes', 'voice-notes', false)
on conflict (id) do nothing;

-- Storage RLS policies. Supabase's storage.objects table already has RLS
-- enabled by default on every project — these policies restrict access to
-- objects whose PATH starts with the requesting user's own id, e.g. only
-- auth.uid() = 'abc123' can read/write objects under 'abc123/...'.
-- IMPORTANT: the app MUST upload every file under a path prefixed with the
-- uploading user's id (see uploadVoiceNote() in src/lib/voiceNotes.js) or
-- these policies will correctly deny the write.
create policy "own voice note objects select" on storage.objects for select
  using (bucket_id = 'voice-notes' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own voice note objects insert" on storage.objects for insert
  with check (bucket_id = 'voice-notes' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own voice note objects delete" on storage.objects for delete
  using (bucket_id = 'voice-notes' and (storage.foldername(name))[1] = auth.uid()::text);
