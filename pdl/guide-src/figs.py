"""Figure content for the My PD guide: which screenshot(s), and what each numbered pin means.

Item keys match the callout keys recorded by shots/capture.py. For figures with two
screenshots, keys are written "shot:key". Numbering runs across the whole figure.

VERSION HISTORY
  v1  2026-10-30  Pins and keys for every screen.
  v2  2026-11-20  What's new figure.
  v3  2026-11-22  Moved to c3jumpw/mkp-tools/pdl/guide-src.
"""

FIGS = {
    "lock": {
        "shots": ["lock"],
        "alt": "Lock screen with the My PD lockup, a four-digit passcode field and an Unlock button.",
        "items": [
            ("code", "Passcode", "Four digits. It unlocks as soon as the fourth digit is typed."),
            ("unlock", "Unlock", "Or press Enter. After the first unlock, this device opens straight to the library."),
        ],
    },
    "home": {
        "shots": ["home"],
        "alt": "Home screen: greeting, Guide button, theme and Organize controls, Today's Practice card, view tabs, search, type filters and the folder list.",
        "items": [
            ("brand", "Greeting and date", "Good morning, good day or good evening, depending on the time."),
            ("guide", "Guide", "Opens this guide inside the app, at the part that matches what you're doing."),
            ("theme", "Theme", "Switches between dark and light. Remembered on this device."),
            ("organize", "Organize", "Shows the editing tools. Leave it off for everyday use. See Admin."),
            ("practice", "Today's Practice", "One audio track from your library, picked each day. It stays the same all day."),
            ("play", "Play", "Starts today's track in the mini-player."),
            ("tabs", "Browse, Collections, Vault", "The three main views of the app."),
            ("search", "Search", "Narrows the folder you're in as you type. In the Vault it searches the open list."),
            ("filters", "Type filters", "Show everything, or only audio, video or documents."),
            ("upload", "+ Upload", "Adds files to the folder you're in. See Uploading."),
            ("layout", "List or grid", "Grid shows cover art. Remembered on this device."),
            ("folder", "Folder", "Tap to open. Tap Library in the path above the list to go back."),
        ],
    },
    "files": {
        "shots": ["files"],
        "alt": "File list with type icons, titles, size and collection details, and summary icons.",
        "items": [
            ("icon", "Type icon", "♪ audio, ▶ video, ▤ document. Tap anywhere on the row to open it."),
            ("title", "Title", "The file name, with underscores and dashes shown as spaces."),
            ("meta", "Details", "Type, size, and the collections the item belongs to."),
            ("badge", "📝 Summary available", "Tap the icon to read the summary without starting playback."),
            ("multipart", "Multi-part", "A large file stored in parts. It plays like any other file."),
        ],
    },
    "grid": {
        "shots": ["grid"],
        "alt": "Grid view with folder tiles and square cover art tiles.",
        "items": [
            ("folder", "Folders first", "Folders come first, then files in name order."),
            ("cover", "Cover art", "Set by an admin. Items without a cover show their type icon."),
            ("kind", "Type label", "AUDIO, VIDEO or DOCS."),
            ("summary", "📝 Summary", "Tap to read it without opening the item."),
        ],
    },
    "player": {
        "shots": ["player"],
        "alt": "Mini-player expanded at the bottom of the screen with the transcript open and the current line highlighted.",
        "items": [
            ("playing", "Now playing", "The playing item is highlighted in the list."),
            ("title", "Track title", "Also shown on the lock screen and in Control Centre."),
            ("scrub", "Progress bar", "Drag or tap to jump. Time played is on the left, time left on the right."),
            ("transport", "Back 15 s, play or pause, forward 15 s", ""),
            ("speed", "Speed", "Tap to cycle 1x, 1.25x, 1.5x and 2x. Kept for next time, and used for video too."),
            ("transcript", "Transcript", "Shows or hides the transcript under the controls."),
            ("summary", "Summary", "Opens this track's summary."),
            ("close", "Close", "Stops playback and hides the player."),
            ("line", "Current line", "Highlighted as the track plays. Tap any line to jump to that moment."),
        ],
    },
    "summary": {
        "shots": ["summary"],
        "alt": "Summary sheet showing a few paragraphs about the track and an Edit button.",
        "items": [
            ("file", "Item", "The summary belongs to this file and moves with it."),
            ("body", "Summary", "What the item covers, so you can decide if now is the time for it."),
            ("edit", "Edit", "Shows + Add summary when there isn't one yet. See Writing summaries."),
            ("close", "Close", "Tap outside the sheet to close it too."),
        ],
    },
    "media": {
        "shots": ["video", "doc"],
        "caps": ["Video", "Text document"],
        "alt": {"video": "Video player in a full-screen viewer with speed, summary and close buttons.",
                "doc": "A markdown note opened as plain text in the viewer."},
        "items": [
            ("video:video", "Video player", "Standard controls, including full screen. If the screen locks, the sound carries on."),
            ("video:speed", "Speed", "The same setting as the audio player."),
            ("video:summary", "📝 Summary", "Appears when the item has a summary."),
            ("video:close", "Close", "Closes the viewer and stops playback."),
            ("doc:text", "Text and Markdown", ".txt and .md files open as text right here."),
            ("doc:close", "Close", ""),
        ],
    },
    "collections": {
        "shots": ["collections"],
        "alt": "Collections view with collection chips, a sunrise header image for Morning Ritual, and item tiles.",
        "items": [
            ("tab", "Collections", ""),
            ("chips", "Your collections", "Tap one to show it. The number is how many items it holds."),
            ("upload", "+ Upload", "Files uploaded while a collection is open are added to it straight away."),
            ("header", "Header image", "Each collection can have its own banner. An admin sets it."),
            ("item", "Items", "Tap to open, as in Browse. List and grid work here too."),
        ],
    },
    "vault": {
        "shots": ["vault"],
        "alt": "Vault Terms list with sort chips and an expanded entry for Kaizen showing its source, example, notes and actions.",
        "items": [
            ("subtabs", "Terms, Topics, Ideas", "Three kinds of entry, each with its own list."),
            ("new", "+ New", "Reads + New term, + New topic or + New idea, depending on the list."),
            ("sort", "Sort", "Newest, A–Z, or By subject."),
            ("card", "Entry", "Tap to expand or collapse."),
            ("subjects", "Subjects", "Your own tags. An entry can have several."),
            ("source", "Source", "The track, and the moment in it, where this came from."),
            ("jump", "▶ Jump to source", "Plays the track from that moment."),
            ("edit", "✎ Edit", ""),
            ("delete", "🗑 Delete", "Asks first. Vault entries don't go to Trash."),
        ],
    },
    "vault-subjects": {
        "shots": ["vault-subjects"],
        "alt": "Vault sorted by subject with a row of subject chips; Mindset is selected.",
        "items": [
            ("bysubject", "By subject", "Shows a row with every subject you've used."),
            ("filter", "Subject chip", "Tap to show only entries with that subject. Tap more than one to combine."),
            ("none", "Select none", "Clears the subject filter."),
        ],
    },
    "term": {
        "shots": ["term-editor", "term-ask"],
        "caps": ["Look it up", "Ask a follow-up"],
        "alt": {"term-editor": "New term sheet for Kaizen with a Japanese language badge, a linked source, definition, example and suggested subjects.",
                "term-ask": "Follow-up question and answer under the term, with + Add to notes, your notes field and Save to vault."},
        "items": [
            ("term-editor:term", "Word or phrase", "Any language."),
            ("term-editor:lookup", "Look it up", "AI fills in a definition, an example and suggested subjects."),
            ("term-editor:lang", "Language", "The language of the term."),
            ("term-editor:source", "Linked source", "When a track is loaded, the entry links to it at the current moment. Tap ✕ to unlink."),
            ("term-editor:definition", "Definition", "Edit it freely."),
            ("term-editor:example", "Example", ""),
            ("term-editor:newexample", "🔄 New example", "Asks for a different example sentence."),
            ("term-editor:suggested", "Suggested subjects", "Tap to add. Or type your own and press comma or Enter."),
            ("term-ask:ask", "Ask a follow-up question", "Opens a short Q&A about this term."),
            ("term-ask:q", "Your question", ""),
            ("term-ask:a", "Answer", "Based on the term, definition, example and subjects above."),
            ("term-ask:addnotes", "+ Add to notes", "Copies the Q&A into your notes. The Q&A itself isn't saved."),
            ("term-ask:notes", "Your notes", "Why it stood out, and your own thoughts."),
            ("term-ask:attach", "📎 Attach a file", "A photo, PDF or any file, kept with the entry."),
            ("term-ask:save", "Save to vault", ""),
        ],
    },
    "topic": {
        "shots": ["topic-editor"],
        "alt": "New topic sheet for Second-order thinking with a simple explanation and a longer full explanation.",
        "items": [
            ("name", "Topic", "The idea you want to understand better."),
            ("simple", "✨ Explain simply", "A short, plain-language first explanation."),
            ("full", "📖 Expand into full explainer", "Builds a page-length version from the simple one, with examples."),
            ("fulltext", "Full explanation", "Edit or add to it like any text."),
            ("subject", "Subjects", ""),
        ],
    },
    "idea": {
        "shots": ["idea-editor"],
        "alt": "New idea sheet with a title, the original note, an AI summary and subjects.",
        "items": [
            ("title", "Title", "Optional. Summarize suggests one if it's empty."),
            ("note", "Your original note", "Kept exactly as you wrote it. The AI never changes it."),
            ("summarize", "✨ Summarize", "Writes a short summary and suggests subjects."),
            ("summary", "Summary", "Edit it, or leave it blank."),
            ("subjects", "Subjects", "Below these: follow-up questions, your reflection and attachments."),
        ],
    },
    "light": {
        "shots": ["light"],
        "alt": "The home screen in the light theme.",
        "items": [
            ("theme", "Theme", "☀️ means light is on. Tap again for dark."),
        ],
    },
    # ---------------- admin ----------------
    "organize": {
        "shots": ["organize-top", "organize"],
        "caps": ["Switch on", "Tools appear"],
        "alt": {"organize-top": "Home screen with the Organize switch turned on.",
                "organize": "Browse list in Organize mode: + New folder beside + Upload, and five tool buttons on every file."},
        "items": [
            ("organize-top:organize", "Organize switch", "Turns the tools on and off. Nothing changes until you use a tool."),
            ("organize:upload", "+ Upload", "Always available, with or without Organize."),
            ("organize:newfolder", "+ New folder", "Creates a folder inside the one you're in."),
            ("organize:summary", "📝 Summary", "Opens the summary ready to edit."),
            ("organize:tag", "🏷 Collections", "Choose which collections the item is in."),
            ("organize:rename", "✎ Rename", ""),
            ("organize:move", "⇄ Move", "Asks for a folder name, such as Wealth or Daily Affirmations. Leave it blank for the top of the Library."),
            ("organize:trash", "🗑 Trash", "Asks first, then moves the item to Trash."),
        ],
    },
    "upload": {
        "shots": ["upload"],
        "alt": "Upload sheet listing three files: one done, one partway through its parts, one waiting.",
        "items": [
            ("dest", "Destination", "The folder you were in when you tapped + Upload."),
            ("note", "Keep the screen on", "Locking the phone can interrupt an upload. The app tries to keep the screen awake."),
            ("done", "Done", "The file is saved and appears in the list."),
            ("parts", "Uploading in parts", "Files of 20 MB or more go up in 4 MB parts, so a weak signal only costs one part."),
        ],
    },
    "rename": {
        "shots": ["rename"],
        "alt": "A file row in rename mode with a text field, the .m4a extension and a Save button.",
        "items": [
            ("input", "New name", "Edit the title. Spaces are fine."),
            ("ext", "File type", "Kept as it is, so the file still opens the same way."),
            ("save", "Save", "Or press Enter. Leave the name unchanged to cancel."),
        ],
    },
    "trash": {
        "shots": ["trash"],
        "alt": "Inside the Trash folder: two items with days left before deletion, and restore and delete buttons.",
        "items": [
            ("crumb", "Trash", "Only shown with Organize on, at the end of the Library list."),
            ("meta", "Countdown", "Days left before the item is deleted for good."),
            ("restore", "↩ Restore", "Puts it back in the folder it came from."),
            ("delete", "✕ Delete forever", "Deletes it now, with its summary, transcript and parts. Can't be undone."),
        ],
    },
    "manage-collections": {
        "shots": ["tag-modal", "collections-organize"],
        "caps": ["Tag a file", "Collection tools"],
        "alt": {"tag-modal": "Add to collections sheet with checkboxes for each collection and a field to add a new one.",
                "collections-organize": "Collections view in Organize mode with + New collection, Clean up missing and Edit header."},
        "items": [
            ("tag-modal:file", "Item", "The file you tapped 🏷 on."),
            ("tag-modal:list", "Collections", "Tick every collection it belongs in. Untick to remove it."),
            ("tag-modal:new", "New collection name", ""),
            ("tag-modal:add", "Add", "Adds it to the list, already ticked."),
            ("tag-modal:save", "Save", "Nothing changes until you tap Save."),
            ("collections-organize:newcoll", "+ New collection", "Creates an empty collection."),
            ("collections-organize:cleanup", "Clean up missing", "Finds tags pointing at files that no longer exist and offers to remove them."),
            ("collections-organize:editheader", "Edit header", "Choose, crop or remove the banner image."),
            ("collections-organize:tag", "🏷 on each item", "Change an item's collections without leaving the view."),
        ],
    },
    "covers": {
        "shots": ["organize-grid", "cover-editor"],
        "caps": ["Grid with Organize on", "Crop and save"],
        "alt": {"organize-grid": "Grid view in Organize mode with + Add cover and Change cover on the tiles.",
                "cover-editor": "Cover art editor with a square crop of a sunrise image, a zoom slider, and Remove, Cancel and Save cover buttons."},
        "items": [
            ("organize-grid:add", "+ Add cover", "Tap a tile without a cover. Your phone's photo picker opens."),
            ("organize-grid:change", "Change cover", "Tap to replace or remove the current cover."),
            ("cover-editor:stage", "Crop", "Drag the image to position it inside the square."),
            ("cover-editor:zoom", "Zoom", ""),
            ("cover-editor:remove", "Remove", "Deletes the cover. The type icon comes back."),
            ("cover-editor:save", "Save cover", "Saved as a 600 × 600 square. Shows on this device straight away."),
        ],
    },
    "transcripts": {
        "shots": ["transcript-editor", "transcript-paste"],
        "caps": ["Tap along", "Paste text"],
        "alt": {"transcript-editor": "Transcript editor on the Tap along tab: playback controls, a line being typed, and saved timed lines.",
                "transcript-paste": "Transcript editor on the Paste text tab with SRT captions pasted in."},
        "items": [
            ("transcript-editor:tabs", "Tap along", "Build a timed transcript while you listen."),
            ("transcript-editor:paste", "Paste text", "Paste a transcript you already have."),
            ("transcript-editor:transport", "Play and back 5 seconds", "Controls the track that's loaded in the mini-player."),
            ("transcript-editor:time", "Current time", "The time a new line will get."),
            ("transcript-editor:line", "The line you just heard", "Type it, then tap + Add or press Enter."),
            ("transcript-editor:add", "+ Add", "Saves the line at the current time."),
            ("transcript-editor:cues", "Saved lines", "In time order. Tap ✕ to remove one."),
            ("transcript-editor:save", "Save transcript", ""),
            ("transcript-paste:area", "Paste box", "SRT or VTT captions keep their timings. Plain text is saved without timings."),
        ],
    },
    "summary-edit": {
        "shots": ["summary-edit"],
        "alt": "Summary sheet in edit mode with a text box and Summarize, Cancel and Save buttons.",
        "items": [
            ("text", "Summary text", "Write it yourself, or start from the AI draft."),
            ("ai", "✨ Summarize", "Drafts a summary from the transcript, or from the file itself for .txt and .md."),
            ("save", "Save", "Saved beside the file, so it moves and renames with it."),
        ],
    },
}

FIGS["whatsnew"] = {
    "shots": ["whatsnew", "whatsnew-admin"],
    "caps": ["After unlocking", "First time Organize is on"],
    "alt": {"whatsnew": "What's new sheet listing the latest update's changes for everyone, with Show me in the guide links, See all changes and Got it.",
            "whatsnew-admin": "What's new for admins sheet, shown when Organize is switched on, listing the admin-only changes."},
    "items": [
        ("whatsnew:kicker", "What's new", "The update's name and date, shown once per update on each device after the passcode screen. Missed several? They're listed together, newest first."),
        ("whatsnew:tag", "Kind of change", "New, Improved, Fixed or Changed."),
        ("whatsnew:show", "Show me in the guide", "Opens this guide at the part that explains it."),
        ("whatsnew:all", "See all changes", "Opens the full change log."),
        ("whatsnew:ok", "Got it", "Closes it. It won't show again for this update."),
        ("whatsnew:close", "Close", "Same as Got it."),
        ("whatsnew-admin:kicker", "What's new for admins", "Admin-only changes, shown the first time Organize is switched on after an update."),
        ("whatsnew-admin:item", "Admin changes", "On a device that has used Organize before, these appear in the same sheet under For admins."),
    ],
}
