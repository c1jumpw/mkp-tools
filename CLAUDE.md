# mkp-tools — notes for anyone changing this repo (people and AI assistants)

## Apps in this repo

| Folder | App | Hosting |
|---|---|---|
| `dayforge/` | DayForge — planner + notes (React, Vite, Tailwind v4, Supabase) | Vercel → https://dayforge.mkcworkspace.com |
| `mkp-dispatch/` | Dispatch It — ClickUp capture PWA (plain JS) + Cloudflare Worker in `worker/` | Vercel → https://dispatch.mkcworkspace.com (old GitHub Pages copy forwards) |
| `pdl/` | My PD's library only: `pdl/media` (audio, video, docs, covers, summaries, transcripts, collections, Trash), written by the `pdl-relay` Worker. The app itself moved to `c3jumpw/mkp-tools/pdl`; `pdl/index.html` just forwards the old address | Vercel (from c3) → https://mypd.mkcworkspace.com |
| `guides/` | Builds each app's illustrated guide, getting-started tour and change-log data | GitHub Actions (`.github/workflows/guides.yml`) |

## Every change gets a change-log entry

The change log is permanent history that admins read and download, and it drives the What's new card people see after an update. **Every change to an app adds a release at the top of that app's `CHANGELOG.md`** (`dayforge/CHANGELOG.md`, `mkp-dispatch/CHANGELOG.md`), in the same commit as the change:

```
## YYYY-MM-DD · Short title
- New: One plain sentence for the person using the app.
- Fixed: …
- [Admins] Changed: Something only admins need to know or do (a migration, a Worker secret).
```

- Kinds: New, Improved, Fixed, Changed, Removed, Security. Audience tag `[Admins]` = admins only; default is everyone.
- Never edit or reorder published releases' dates or titles (they're the ids devices remember as "seen").
- Write for the person using the app, not about the code. Setup steps go in `[Admins]` lines.
- `guides/lib/changelog.py` validates the file; the guides workflow fails on a bad tag or kind and warns when app code changed without an entry.

## When a screen changes

Update `guides/<app>/shots.py` (steps + numbered markers), `guides/<app>/guide.src.html` and `guides/<app>/tour.json`, then run `python guides/run.py <app>` (see `guides/README.md`). Never hand-edit the generated `dayforge/public/guide/` or `mkp-dispatch/guide/` files.

## Code conventions (owner's standing preferences)

- Every file: a header (purpose, responsibilities, assumptions/edge cases) and a VERSION / revision history; bump it on every change.
- Doc comment on every function; inline comments for non-obvious logic; TODOs where something is knowingly left.
- Public config (Supabase URL + anon key, ClickUp IDs, Worker URL) is hardcoded on purpose.
- DayForge database changes ship as the next numbered file in `dayforge/supabase/migrations/` (re-runnable) and are mirrored in `schema.sql`; the owner runs them in the Supabase SQL Editor.

## Security

- Never use or expose the Supabase `service_role` key.
- Never write Worker secrets (`CLICKUP_CLIENT_SECRET`, `APP_PASSCODE`, `ADMIN_PASSCODE`, `GEMINI_API_KEY`) anywhere in the repo or in chat; they're set with `npx wrangler secret put`.
- Admin checks are enforced server-side (Supabase functions in migration 009; Worker `ADMIN_ROUTES`). Hiding a button is never the only lock.
