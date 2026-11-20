# DayForge — change log

Every update to DayForge, newest first. This file is the source for:

- **⋮ › Admin › Change log** (admins only): the full history, oldest to newest or the reverse, with filters and CSV / JSON download.
- **What's new**: shown once to each person after an update, with only the items meant for them.
- The What's new box in the guide and the getting-started tour (everyone-items only).

## How to add an entry (every change, every time)

Put a new release at the top, below this section:

    ## YYYY-MM-DD · Short title
    - New: One plain sentence, written for the person using the app.
    - Fixed: Another change.
    - [Admins] Changed: Something only admins need to know or do (a migration to run, a setting to change).

- Kinds: `New`, `Improved`, `Fixed`, `Changed`, `Removed`, `Security` (no kind = Improved).
- `[Admins]` hides an item from everyone except admins. Add `[Admins]` to the end of the heading to hide a whole release.
- Keep the date and title of a published release unchanged: they identify it, and changing them shows it again as new.
- The build checks this file and fails on a typo in a tag or kind.

## 2026-11-20 · Change log, admin roles and What's new
- New: After an update, a What's new card shows what changed, once per account on any device. You only see the changes that apply to you.
- [Admins] New: ⋮ › Admin › Change log lists every update from launch to today. Switch between newest and oldest first, filter by who it's for or what kind of change it is, search, and download the whole history as CSV or JSON.
- [Admins] New: The Every change tab lists each code change automatically, so nothing is missed even without a written note.
- [Admins] New: The Admins tab lets you add or remove admins by email. The first account ever created becomes the first admin.
- [Admins] Changed: Run supabase/migrations/009_admin_roles.sql in the Supabase SQL Editor to turn on admin roles.
- [Admins] Changed: Ready to move to dayforge.mkcworkspace.com. Follow "Move to mkcworkspace.com" in README.md.

## 2026-11-18 · Getting-started tour and help guide
- New: A getting-started tour with real screenshots. Pick Everyday use or Owner / admin and step through the screens. Replay it from ⋮ › Getting started tour.
- New: ⋮ › Help & guide: an illustrated guide to every screen and setting.
- Changed: Sign out now signs out only the phone or computer you are using. Your other devices stay signed in.
- [Admins] New: The guide and tour retake their screenshots automatically whenever DayForge changes.

## 2026-11-18 · Note labels
- New: Give notes labels like Work or Travel, then tap a label at the top of Notes to see only those notes.
- New: New notes get the label you're filtering by.
- [Admins] Changed: Run supabase/migrations/008_note_labels.sql in the Supabase SQL Editor.

## 2026-09-24 · New note typing shortcuts
- Changed: Enter continues the list at the same level. Press Enter twice on an empty line to start a new topic (--)).
- New: Type two spaces on an empty - or * line to switch it between a main point and a detail.

## 2026-09-21 · File delete and note shortcut fixes
- Fixed: You can now delete a file attached to a task or note.
- Fixed: The cursor stays on the date line so you can type a title right after it.
- Improved: Enter after a note's first line always starts the list, whatever the line ends with.

## 2026-09-20 · Note icons and title shortcut
- Improved: The Pin and Edit icons on notes are bigger on phones and light up when active.
- New: Press Enter after a line ending in a colon to start a list.

## 2026-09-20 · Pinned notes
- New: Pin a note to keep it at the top of the list.
- [Admins] Changed: Run supabase/migrations/007_note_pinning.sql.

## 2026-09-19 · Clickable links
- New: Web links in notes and pinned reminders open with a tap.

## 2026-09-18 · Note color tint
- Improved: A colored note is lightly tinted across the whole card, so colors are easy to spot.

## 2026-09-17 · Note colors and search
- New: Color-code notes.
- New: Search your notes.
- [Admins] Changed: Run supabase/migrations/006_note_colors.sql.

## 2026-09-16 · Note list shortcut
- New: Press Enter after a - or * line and the next line continues the list.

## 2026-09-14 · Full-screen note editor
- Improved: Note cards show a short preview. Editing opens a full-screen editor that saves as you type.
- Fixed: Window titles and close buttons no longer hide under the phone's notch.

## 2026-09-08 · Any file, autosave and Refresh app
- New: Attach any type of file to tasks and notes, not just photos.
- New: Changes to a task save as you type.
- New: ⋮ › Refresh app loads the newest version.
- New: The note box starts with today's date.
- Improved: Pop-up windows fill the screen on phones.
- [Admins] Changed: Run supabase/migrations/005_generic_attachments.sql.

## 2026-08-12 · Photo attachments
- New: Attach labeled photos to tasks and notes. They're resized before upload to save space.
- [Admins] Changed: Run supabase/migrations/004_entry_images.sql (adds a private storage bucket).

## 2026-08-11 · Note timestamps
- New: Notes show when they were created and last edited.

## 2026-08-11 · Clearer note errors
- Improved: Notes show a message if something goes wrong instead of doing nothing.
- Fixed: The help text shows the --) topic separator the way you type it.

## 2026-08-11 · Notes
- New: Notes: jot things down freely, split topics with --), and turn any note into a task.
- [Admins] Changed: Run supabase/migrations/003_notes.sql.

## 2026-08-11 · WAV downloads and tappable pinned items
- Fixed: Downloaded voice notes save as WAV audio, so they no longer open as video.
- Improved: A message appears when transcription quietly gets nothing.
- New: Tap a pinned reminder to open it in full.

## 2026-08-08 · Voice note copy and download
- New: Copy transcript and Download audio are always available.
- Improved: Transcription problems are shown instead of failing silently. Saved transcripts stay folded until you open them.

## 2026-08-07 · Voice notes
- New: Record a voice note on a task, with live transcription where the browser supports it. Edit the transcript before saving.
- [Admins] Changed: Run supabase/migrations/002_voice_notes.sql (adds the voice-notes storage bucket).

## 2026-08-04 · Export filters
- New: Choose which categories (Personal, Work) and types (To-do, Reminder, Event) to export.
- Fixed: Header buttons are easier to tap on small phones.

## 2026-08-04 · Calendar export and home-screen icon
- New: Export a day or a week as a calendar file (.ics) for Google, Outlook or Apple Calendar.
- New: Add DayForge to your home screen. It gets its own icon and opens full screen.

## 2026-08-04 · Phone dragging, Send to tray and Clear all
- Fixed: Scrolling on a phone no longer grabs tasks. Drag with the grip handle instead.
- New: Undo appears for a few seconds after you move a task.
- New: Send to tray moves a scheduled task back to the tray.
- New: Clear all for pinned reminders and Clear tray (both ask first).
- Fixed: The remove button on pinned reminders works on touch screens.

## 2026-08-04 · Durations and end times
- New: Set a duration in hours and minutes, or an end time. The other one updates by itself.
- Improved: Timeline blocks are sized by how long they take, and overlapping tasks sit side by side.

## 2026-08-04 · Editing, themes and account settings
- Fixed: Tapping a task reliably opens it instead of starting a drag.
- New: ✕ buttons to delete items on the timeline and in the tray.
- New: Light and dark themes (sun / moon in the header).
- New: Change your email or password from ⋮ › Account settings.

## 2026-08-04 · DayForge launches
- New: Plan your day on an hour-by-hour timeline, with a tray for tasks that don't have a time yet.
- New: Pinned reminders, a 7-day forecast and reusable routines.
- New: Sign in with your email and password. Everything syncs across your phone, tablet and computer.
- [Admins] New: Runs on Supabase (database and sign-in) and Vercel. Setup steps are in README.md.
