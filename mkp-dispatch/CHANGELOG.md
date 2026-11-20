# Dispatch It — change log

Every update to Dispatch It, newest first. This file is the source for:

- **Settings › Admin › Change log** (admins only): the full history, oldest to newest or the reverse, with filters and CSV / JSON download.
- **What's new**: shown once on each device after an update, with only the items meant for that device's role (admin or everyday).
- The What's new box in the guide and the getting-started tour (everyone-items only).

## How to add an entry (every change, every time)

Put a new release at the top, below this section:

    ## YYYY-MM-DD · Short title
    - New: One plain sentence, written for the person using the app.
    - Fixed: Another change.
    - [Admins] Changed: Something only admins need to know or do (a Worker secret, a setting).

- Kinds: `New`, `Improved`, `Fixed`, `Changed`, `Removed`, `Security` (no kind = Improved).
- `[Admins]` hides an item from everyday devices. Add `[Admins]` to the end of the heading to hide a whole release.
- Keep the date and title of a published release unchanged: they identify it, and changing them shows it again as new.
- The build checks this file and fails on a typo in a tag or kind.

## 2026-11-20 · Change log, admin code and What's new
- New: After an update, a What's new card shows what changed, once on each device. You only see the changes that apply to you.
- [Admins] New: Settings › Admin › Change log lists every update from launch to today. Switch between newest and oldest first, filter by who it's for or what kind of change it is, search, and download the whole history as CSV or JSON.
- [Admins] New: The Every change tab lists each code change automatically, so nothing is missed even without a written note.
- [Admins] New: An admin code, separate from the everyday passcode. Devices unlocked with the everyday passcode can capture and undo, but can't change the ClickUp connection or smart-routing settings.
- [Admins] Changed: Worker update needed: set the ADMIN_PASSCODE secret and redeploy (README › Admin code). Until then every device keeps full access, as before.
- [Admins] Changed: Ready to move to dispatch.mkcworkspace.com. Follow "Move to mkcworkspace.com" in README.md.

## 2026-11-18 · Getting-started tour and guide
- New: A getting-started tour with real screenshots. Pick Everyday use or Admin and step through the screens.
- New: Tap the ? on Home for the tour or the full illustrated guide. Both are also under Settings › Help.
- Fixed: The wrong-passcode message now points to Settings › Forget passcode on this device.
- [Admins] New: The guide and tour retake their screenshots automatically whenever Dispatch It changes.

## 2026-10-11 · Smart routing and the new name
- New: Dispatch is now Dispatch It.
- New: Smart capture: type or say it once, and Gemini picks the list, tidies the title, and reads dates and priority.
- New: Before sending, Dispatch It checks for a matching open task and offers to update it instead.
- New: Activity shows everything that was filed, with Undo.
- Improved: Clearer error messages, and nothing is sent twice if the connection drops.
- [Admins] New: Settings › Smart routing: auto-file threshold, duplicate sensitivity, workspace sync, task index and live updates.
- [Admins] Changed: The Worker needs GEMINI_API_KEY, the dispatch-tasks Vectorize index and the KV namespace (README › Smart routing).

## 2026-08-12 · Related Account ID
- Fixed: Direct to List fills in the Related Account ID field correctly.

## 2026-08-11 · Associated account picker
- New: Pick the associated client account from a list when adding an MKC Client account.
- Changed: The password field shows what you type, so you can check it.
- Fixed: Problems saving custom fields are shown instead of failing silently.
- Removed: The Tool / Software / Act field is no longer filled in automatically.

## 2026-08-08 · Account custom fields
- Improved: Direct to List fills in the account's real ClickUp fields.
- Changed: Direct to List is for MKC Client accounts only. The review channel is told either way.

## 2026-08-07 · Add to Accounts destination
- New: Choose Review Channel or Direct to List when adding an account.

## 2026-07-28 · Capture type tidy-up
- Changed: Meeting Note is now New Meeting/Apt/Event.
- Removed: Client Account Note (it duplicated another type).

## 2026-07-26 · Follow-ups and Add to Accounts
- New: Follow-up / Reminder adds your note as a comment on an existing task.
- New: Add to Accounts sends new account details for review.
- Improved: Titles are capitalized automatically.

## 2026-07-26 · Refresh button
- New: The refresh button on Home checks for a new version of the app.
- Improved: The chat log mentions the parent task when you create a subtask.

## 2026-07-26 · Subtasks
- New: Make a capture a subtask of an existing task.

## 2026-07-25 · Plan/Product Idea
- New: Plan/Product Idea capture type.
- Fixed: JTG's name is spelled correctly.

## 2026-07-25 · Assignees, ClickUp links and chat log
- New: Assign a task to a teammate.
- New: A View in ClickUp link after each send.
- New: Each capture is posted to the team's ClickUp chat channel.
- Fixed: Captures go to the correct lists.

## 2026-07-25 · Passcode and connection status
- New: A passcode protects Dispatch on each device.
- New: Settings shows whether ClickUp is connected.
- New: A Start date field, and tap a flag to see what it means.
- [Admins] Changed: The Worker needs the APP_PASSCODE secret.

## 2026-07-24 · Own ClickUp connection
- [Admins] Changed: Dispatch has its own ClickUp connection (Settings › Connect to ClickUp) instead of a shared personal key.

## 2026-07-23 · Dispatch launches
- New: Capture to-dos, ideas, notes and requests for each business and send them straight to the right ClickUp list.
- New: Dictate, record a voice note or attach files. Captures made offline wait and send when you're back online.
- [Admins] New: A Cloudflare Worker sits between the app and ClickUp, so the ClickUp key never reaches a device.
