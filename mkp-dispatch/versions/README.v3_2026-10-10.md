<!--
  README.md — Dispatch It
  VERSION HISTORY
    v1  2026-07-25  First write-up (setup sections 1–3).
    v2  2026-08-07  Added auto-deploy section (4).
    v3  2026-10-10  Renamed to "Dispatch It". Added Smart routing
                    (setup, how it works, privacy, limits). Marked the
                    auto-deploy workflow as optional/inactive (manual
                    deploys chosen). Removed stale text ("capture layer
                    only — never reads", `verify: true` flags, "leave
                    ALLOWED_ORIGIN as *"). Added "Secrets — never paste
                    these in chat" and a troubleshooting section.
-->

# Dispatch It

A mobile-first capture app for the MKC entities. Say it once — type or
dictate a thought, hit send — and it lands in the right ClickUp list.

Two ways to capture:

- **Smart capture** (default when set up): one text box. Gemini picks
  the list, cleans up the title, reads dates ("by Friday") and priority
  ("ASAP"), and checks whether the same work already exists as an open
  task. Confident captures file themselves (with one-tap Undo);
  anything uncertain asks you first.
- **Manual**: pick the business → pick the type → fill a short form.
  Still gets a quick duplicate check once the task index is built.

Everything Dispatch It does in ClickUp is recorded in **Activity**, from
every device, and can be undone from there.

---

## How it's put together

```
┌──────────────────┐      ┌───────────────────────────┐      ┌──────────────┐
│ Dispatch It (PWA) │ ───▶ │ Cloudflare Worker          │ ───▶ │ ClickUp API  │
│ GitHub Pages      │      │ • ClickUp OAuth token (KV) │      └──────────────┘
│ no secrets        │ ◀─── │ • passcode check           │ ───▶ ┌──────────────┐
└──────────────────┘      │ • smart routing (./lib)    │      │ Gemini API   │
                           │ • workspace index (KV)     │      └──────────────┘
         ClickUp webhook ─▶│ • task vectors (Vectorize) │
         cron (15 min)   ─▶│ • audit log + feedback (KV)│
                           └───────────────────────────┘
```

- **Frontend** — plain HTML/CSS/JS, no build step. Deploys straight to
  GitHub Pages from `mkp-tools/mkp-dispatch/`.
- **Worker** (`worker/`) — the only thing that holds credentials. It
  proxies ClickUp (adding CORS + the OAuth token), enforces the device
  passcode, and runs smart routing. Code is split into
  `clickup-proxy.js` (router) and `lib/*.js` (features); `wrangler
  deploy` bundles them.

---

## Secrets — never paste these in chat

| Secret | Where it lives | How it's set |
|---|---|---|
| `CLICKUP_CLIENT_SECRET` | Worker secret | `wrangler secret put` |
| `APP_PASSCODE` | Worker secret (+ each device after unlock) | `wrangler secret put` |
| `GEMINI_API_KEY` | Worker secret | `wrangler secret put` |
| ClickUp OAuth token | Worker KV | automatic (Connect to ClickUp) |
| Webhook signing secret | Worker KV | automatic (Turn on live updates) |
| Any `pk_…` ClickUp token, Cloudflare API tokens | — | not used by this app |

Safe to share: the Client ID, Workspace ID, list IDs, the Worker URL,
and the KV / Vectorize names. They identify things; they grant nothing.

Always enter secrets with `Read-Host` (see below) — on this machine
`Get-Clipboard` has been unreliable and once captured the wrong value.

---

## 1. Worker setup (first time)

1. `npm install -g wrangler` then `wrangler login`.
2. From `worker/`: `wrangler kv namespace create TOKEN_STORE`, and put
   the id in `wrangler.toml` (already done in this repo).
3. Register the ClickUp OAuth app (ClickUp → Settings → Apps → ClickUp
   API Settings → Create an App). Redirect URL:
   `<worker-url>/oauth/callback`. Client ID → `wrangler.toml`; Client
   Secret → `wrangler secret put CLICKUP_CLIENT_SECRET`.
4. `wrangler secret put APP_PASSCODE` (any passcode; every device enters
   it once).
5. `wrangler deploy`.

## 2. Smart routing setup (one time)

1. **Gemini key** — Google AI Studio → *Get API key*
   (aistudio.google.com/apikey). Use a **dedicated key for Dispatch It**
   so it can be rotated without touching anything else.
   - A free-tier key works, but Google may use free-tier prompts to
     improve its products and daily limits are low. A key on a project
     with billing enabled avoids both.
2. **Vector index** (for duplicate detection), from `worker/`:
   ```
   wrangler vectorize create dispatch-tasks --dimensions=768 --metric=cosine
   ```
3. **Store the key**, from `worker/` in PowerShell:
   ```
   $k = Read-Host "Paste Gemini key"
   $k.Length
   $k | wrangler secret put GEMINI_API_KEY
   Remove-Variable k
   ```
4. `wrangler deploy` — the output should list `TASK_VECTORS` and a
   `*/15 * * * *` schedule.
5. In the app: **Settings → Smart routing**
   - **Sync workspace** — reads every Space, Folder, List, status and
     custom field.
   - **Build task index** — embeds your open tasks for duplicate
     detection. Keep the screen open; a few thousand tasks take a few
     minutes (it pauses and resumes by itself if Gemini rate-limits).
   - **Turn on live updates** — registers a ClickUp webhook so new
     lists and task changes sync within seconds.

## 3. First-time device setup

1. Open the app → enter the passcode (saved on that device only).
2. First device ever: Settings → **Connect to ClickUp** and approve.
   This is stored on the Worker, so other devices only need the passcode.
3. Add to Home Screen.

## 4. Deploying changes

Frontend changes go live when pushed (GitHub Pages). Worker changes need
`wrangler deploy` from `worker/`.

The app's service worker is **network-first** (since `sw.js` v3): an
installed app picks up a new deploy the next time it opens online. The
refresh icon on Home forces it immediately.

> `.github/workflows/deploy-worker.yml` (at the repo root) can run
> `wrangler deploy` automatically on push, but it's **inactive** — it
> needs a `CLOUDFLARE_API_TOKEN` repository secret, which was
> deliberately not set up. Manual deploys are the chosen workflow.

---

## How smart routing works

1. **Workspace awareness.** The Worker keeps an index of every Space →
   Folder → List, each list's statuses (its workflow) and custom field
   names. It's refreshed by the ClickUp webhook (seconds), a 15-minute
   cron (safety net), and **Sync workspace**. Lists created in ClickUp
   become routing destinations automatically, and show up on the manual
   type screen under **More lists in this space**.
2. **Placement.** Each capture is sent to Gemini with that catalog —
   your configured destinations (`js/config.js`) marked as your usual
   places — plus today's date in your time zone, recent corrections, and
   any similar open tasks. Gemini answers in strict JSON: list, title,
   start/due date, priority, a one-line reason, and a duplicate verdict.
3. **Confidence.** Gemini's own score is adjusted with things it can't
   see: a close second choice (−10), this list's track record (scaled
   by how often its suggestions were kept), and where the most similar
   tasks live (±5–8). The Review screen shows the breakdown under
   **Why N%?**. Auto-filing needs the threshold you pick (Cautious 92 /
   Balanced 85 / Bold 75) **and** no likely duplicate; otherwise you're
   asked.
4. **Duplicates.** Open tasks are embedded (Gemini embeddings) into a
   Cloudflare Vectorize index. A capture is compared by meaning, not
   wording ("call Jim about the invoice" ≈ "follow up w/ Jim re:
   overdue payment"). A likely match is offered as **Add as update**,
   which comments on the existing task instead of creating a copy.
5. **Audit log.** Every action — auto, confirmed, or manual — is stored
   with timestamp, source, confidence, the suggestion, and what was
   created. **Undo** deletes the created task or the added comment.
   Records are kept 180 days.
6. **Feedback loop.** When you pick a different list or undo an
   auto-filed capture, that correction is saved and included in future
   prompts, and that list's accuracy score drops. This is learning by
   example — the model itself isn't retrained — so a correction affects
   the very next capture, with no retraining or redeploy.

### Privacy

- Gemini sees: the capture text, list names/paths/descriptions,
  custom-field names, recent corrections, and (for the duplicate index)
  open task titles plus the first 400 characters of their descriptions.
- **Never sent to Gemini:** anything in `PRIVATE_LIST_IDS`
  (`wrangler.toml`; ships with MKC Client Accounts), and **Add to
  Accounts** captures. Those don't use smart routing, aren't saved as
  drafts, and aren't put in the offline queue. Add any other sensitive
  list ID to `PRIVATE_LIST_IDS` and redeploy.

### Limits worth knowing

- **Cloudflare free plan**: 10ms CPU per request, 50 outbound calls per
  request, 1,000 KV writes/day. The design stays inside these limits:
  sync work is chunked, the initial task backfill runs from the phone,
  and there are about 2 KV writes per capture. If Settings ever shows "Exceeded CPU" sync
  errors, Workers Paid ($5/mo) lifts the limits; nothing else changes.
- **Vectorize free tier**: ~6,500 open tasks at 768 dimensions; ~39,000
  lookups/month.
- **Gemini**: rate limits depend on your key's tier. When limited,
  smart capture says so and offers the manual picker with your text
  carried over.
- **Undo**: ClickUp's API can't delete attachments, so files added to an
  *existing* task by "Add as update" stay after an undo (the app tells
  you). Created tasks go away with their attachments.
- **Offline**: smart routing needs a connection. Offline, smart capture
  hands your text to the manual picker, which queues it.

---

## Editing destinations

`js/config.js` holds the curated destinations (business → capture type →
List ID). Smart routing treats these as your usual places. To find a
List ID, open the list in ClickUp: `app.clickup.com/<workspace>/v/li/<LIST_ID>`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Phone shows an old version | Tap the refresh icon on Home once (after `sw.js` v3 this shouldn't recur). |
| "Smart routing isn't set up" | `GEMINI_API_KEY` secret missing → step 2.3, then `wrangler deploy`. |
| "Duplicate detection off" | Vectorize index missing → step 2.2, `wrangler deploy`, then **Build task index**. |
| Live updates "suspended" | ClickUp paused the webhook after failed deliveries → **Re-enable live updates**. |
| "The ClickUp connection expired" | Settings → Connect to ClickUp. |
| "Passcode was rejected" | The Worker's `APP_PASSCODE` changed → Settings → Forget passcode → re-enter. |

## Local development

```
npx serve .
```
`ALLOWED_ORIGIN` in `wrangler.toml` must match the origin you test from
(e.g. `http://localhost:3000`) or the browser will block requests (CORS).
