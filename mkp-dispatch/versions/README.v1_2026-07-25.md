# Dispatch

A mobile-first capture app for the MKC entities. Open it, pick which
business the thought belongs to, pick a type (Task, Light Bulb, Note,
Contact…), dump the thought, hit send — it lands in the right ClickUp
list. No dashboards, no browsing folders, no typing on a tiny sidebar.

This is a **capture layer only**. It creates things in ClickUp; it
never reads, edits, or displays your existing ClickUp data (other than
a "recent captures" list stored on your own device).

---

## How it's put together

Two pieces, because of two unavoidable constraints: **ClickUp's API
doesn't allow browsers to call it directly** (no CORS headers), and a
static site can't hide a credential in its own code — anyone could
open dev tools and read it. So:

```
┌─────────────────┐        ┌──────────────────────┐        ┌───────────────┐
│  Dispatch (PWA)  │  ───▶  │  Proxy (Cloudflare    │  ───▶  │  ClickUp API  │
│  GitHub Pages    │        │  Worker, free tier)   │        │               │
│  static, no key  │  ◀───  │  holds the connection │  ◀───  │               │
└─────────────────┘        └──────────────────────┘        └───────────────┘
```

- **Frontend** — plain HTML/CSS/JS, no build step, no framework. Lives
  in this repo's root and deploys straight to GitHub Pages.
- **Proxy** — a Cloudflare Worker (free tier comfortably covers
  personal use: 100,000 requests/day). It:
  1. **Holds the ClickUp connection.** Dispatch is registered as its
     own ClickUp OAuth app (not a shared personal API token — see
     `worker/clickup-proxy.js`'s version history for why that changed).
     After a one-time "Connect to ClickUp" approval, the resulting
     access token lives in Cloudflare KV storage, never in the browser
     or this repo.
  2. **Enforces a device passcode.** Since the app's URL is public,
     every proxied request must include a shared passcode
     (`APP_PASSCODE`) that only this Worker knows — without it, the
     URL alone doesn't let anyone touch your ClickUp data.
  3. **Adds CORS headers** so the browser is allowed to call it at all.

Nothing sensitive ever touches the browser or this repo: not the
ClickUp connection, not the passcode's canonical value (only a
device's own copy, entered once, saved locally after it's verified).

---

## 1. Deploy the proxy (Cloudflare Worker)

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com) if you don't have one.
2. Install Wrangler (Cloudflare's CLI) and log in:
   ```
   npm install -g wrangler
   wrangler login
   ```
3. From the `worker/` folder in this repo, create the KV namespace that stores the ClickUp connection:
   ```
   wrangler kv namespace create TOKEN_STORE
   ```
   Copy the `id` it prints into `worker/wrangler.toml`'s `[[kv_namespaces]]` block (already done in this repo's copy — only needed again if you're setting this up fresh elsewhere).
4. Register Dispatch as its own ClickUp OAuth app: ClickUp → avatar → **Settings** → **Apps** → **ClickUp API Settings** tab → **Create an App**. Redirect URL must be `<your-worker-url>/oauth/callback`. Put the resulting **Client ID** in `wrangler.toml` (`CLICKUP_CLIENT_ID`, safe to commit — it's public) and the **Client Secret** in Cloudflare as a secret (below — never commit this one).
5. Deploy:
   ```
   cd worker
   wrangler deploy
   ```
6. Set the two secrets (never stored in any file — held encrypted by Cloudflare):
   ```
   wrangler secret put CLICKUP_CLIENT_SECRET
   ```
   ```
   wrangler secret put APP_PASSCODE
   ```
   For `APP_PASSCODE`, pick any passcode you'll remember (this is what every device will need to enter once) — it's a shared-secret gate, not a per-user login, appropriate for "me + my assistants" scale.
7. Wrangler prints a URL like `https://dispatch-clickup-proxy.<you>.workers.dev` — this is baked into `js/config.js` as `DEFAULT_PROXY_URL` already; update it there if you deploy your own copy under a different name.
8. Once you know your GitHub Pages URL (step 2), set `ALLOWED_ORIGIN` and `APP_URL` in `wrangler.toml` accordingly and run `wrangler deploy` again.

## 2. Deploy the frontend (GitHub Pages)

1. Push this whole folder to a new GitHub repo.
2. In the repo: **Settings → Pages → Source → Deploy from a branch**, pick `main` and `/ (root)`.
3. GitHub gives you a URL like `https://yourname.github.io/dispatch/`. Open it on your phone and **Add to Home Screen** — it installs like a native app.

## 3. First-time device setup

1. Open Dispatch. You'll land on a passcode lock screen — enter the `APP_PASSCODE` you set in step 1.6. This is saved on this device only; you won't be asked again unless you clear the site's storage.
2. Gear icon → **Settings**. If this is the very first device ever, tap **Connect to ClickUp** and approve access on ClickUp's page — this only needs to happen once, ever, for the whole app (the connection is stored server-side on the Worker, not per-device). Every other device just needs the passcode from step 1.

---

## Editing what goes where

Everything about routing lives in one file: **`js/config.js`**. Each
entity (ClickUp Space) has a list of capture types, and each capture
type points at one List ID. To add a capture type, add an entry; to
fix a destination, change the `listId`.

**Before you rely on this for real work**, double check the entries
flagged `verify: true` in `config.js` — a few List IDs came out
identical in the export this was built from, which usually means a
copy-paste artifact rather than the real destination. Tapping the red
"!" on that capture type in the app explains this in place; the same
list is here for quick reference:

- MKP → Contact Follow-up / Meeting Note (both currently point at the To-Dos list)
- Super Admin → Light Bulb (currently points at the same list as Task)
- Unywebs → New Hosting Account Request (currently shares an ID with JTG's Content Idea list)

To find the correct ID: open the list in ClickUp, look at the URL —
`app.clickup.com/<workspace>/v/li/<LIST_ID>` — and copy the number
after `/li/`.

---

## UX notes / why it's built this way

- **Two taps to a form, one tap to send.** Entity → Type → dump →
  Send. No typing to find a list.
- **Only the fields that matter show up.** A Light Bulb never asks for
  a due date; a Task never asks for "opportunity level." Each capture
  type has its own small field set defined in `config.js`.
- **Voice is first-class.** *Dictate* transcribes speech straight into
  the notes field (Web Speech API) so you can talk instead of type.
  *Voice note* records actual audio and attaches the file to the
  ClickUp task, for when the words matter less than the tone or you
  want ClickUp to have the raw recording.
- **Offline doesn't lose your capture.** If you're on the subway with
  no signal, Dispatch saves the entry locally (attachments included,
  as base64) and retries automatically the moment you're back online —
  you'll see a small banner on the home screen while anything's
  pending.
- **No dashboards, on purpose.** The home screen is: one big button,
  a short recent list, nothing else. Anything resembling task
  management already exists in ClickUp — this app's only job is
  getting a thought out of your head and off your plate.

---

## Local development

No build step — just serve the folder:

```
npx serve .
```

Note: the Worker's `ALLOWED_ORIGIN` needs to include whatever origin
you're testing from (e.g. `http://localhost:3000`) or you'll get a
CORS error in the console. Leave it as `*` while developing locally,
then lock it down once you have your real GitHub Pages URL.

## Limits worth knowing about

- Offline-queued attachments are stored as base64 in `localStorage`,
  which most mobile browsers cap around 5–10MB total. Fine for photos
  and short voice notes; if you're offline with something huge, send
  it once you're back on Wi-Fi instead of letting it queue.
- Speech-to-text dictation uses the Web Speech API, which is Chrome/
  Edge/Safari — not Firefox. The button simply won't appear where it
  isn't supported; typing still works everywhere.
