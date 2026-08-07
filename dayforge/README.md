# DayForge

A personal time-blocking and forecasting app: dump tasks quickly, drag them into a day's timeline, keep pinned reminders always in view, mark tasks as personal or work, set up recurring tasks, and save reusable routine templates (e.g. "Morning Routine") you can drop into any day.

Your data is stored in a real database (Supabase), not browser localStorage — so it follows you across your phone, tablet, and laptop.

## What's included

- **Quick add** — dump a list of tasks, one per line, into an unscheduled tray
- **Timeline** — a day view (5am–11pm) you drag tasks into to block out time
- **Forecast strip** — jump between today and the next 6 days, with a task count preview for each
- **Pinned reminders** — always-visible items with no time slot
- **Personal / Work tagging** on every task
- **Recurring tasks** — daily, or weekly on chosen days, with per-day completion tracking
- **Routine templates** — build a reusable set of items (e.g. a morning routine) and apply it to any day in one click
- **Login** — single-user email/password auth via Supabase, so only you can see your data

## 1. Set up Supabase (your database)

1. Go to [supabase.com](https://supabase.com), sign up free, and create a new project.
2. Once it's ready, open **SQL Editor** in the left sidebar → **New query**.
3. Paste the entire contents of [`supabase/schema.sql`](./supabase/schema.sql) from this repo and click **Run**. This creates the tables and locks them down so only you can read/write your own data. (This file is kept up to date with every feature — a fresh install only needs this one script. If you already have a running DayForge database and are updating an existing deployment, check [`supabase/migrations/`](./supabase/migrations) for any incremental scripts you haven't run yet, and run them in filename order.)
4. In your Supabase project, go to **Settings → API**. Copy:
   - **Project URL**
   - **anon public** key
5. By default Supabase requires email confirmation for new accounts. For a single personal-use app, you can turn this off so sign-up works instantly: go to **Authentication → Providers → Email** and disable "Confirm email". (Optional — leave it on if you'd rather confirm via email.)

## 2. Configure the app locally

```bash
npm install
cp .env.example .env
```

Open `.env` and paste in your Supabase Project URL and anon key:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

Run it locally:

```bash
npm run dev
```

Open the URL it prints, click **"First time here? Create your account"**, and sign up with your own email/password. That's your one login for the app.

## 3. Publish the code to your own GitHub repo

This project is not yet pushed anywhere — it's sitting on disk, ready to become your repo.

```bash
cd dayforge
git init
git add .
git commit -m "Initial commit: DayForge"
```

Then on [github.com](https://github.com), create a new **empty** repository (no README/license, so it doesn't conflict) named `dayforge`. GitHub will show you a remote URL like `https://github.com/YOUR-USERNAME/dayforge.git`. Connect and push:

```bash
git remote add origin https://github.com/YOUR-USERNAME/dayforge.git
git branch -M main
git push -u origin main
```

Your `.env` file is excluded by `.gitignore`, so your Supabase keys never get committed — good practice even though the anon key is safe to expose (it's restricted by the row-level security policies in the schema).

## 4. Deploy so it's reachable from any device

The easiest option is **Vercel** (free tier, auto-deploys on every push):

1. Go to [vercel.com](https://vercel.com) and sign in with your GitHub account.
2. Click **Add New → Project**, and import your `dayforge` repo.
3. Vercel auto-detects Vite. Before deploying, add your environment variables under **Environment Variables**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Click **Deploy**. In under a minute you'll get a live URL like `dayforge-yourname.vercel.app` — open it on your phone, tablet, or any laptop and sign in with the account you created.

From then on, every `git push` to `main` automatically redeploys the live site.

(Netlify or Cloudflare Pages work the same way if you prefer one of those instead.)

## Notes on the design

Time is stored precisely (exact start time + duration) even though the timeline UI snaps drag-and-drop to the hour — open a task's edit screen to fine-tune it to the exact minute. Recurring tasks are stored once and expanded on the fly, with completion tracked per-date so checking off "Monday's gym session" doesn't affect other weeks.

## Tech stack

- React + Vite + Tailwind CSS v4
- Supabase (Postgres + Auth) for storage
- @dnd-kit for drag-and-drop
