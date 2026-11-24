<!--
  README.md — how My PD (pdl/) is put together and published
  VERSION HISTORY
    v1  2026-11-22  Created when the app moved to c3jumpw/mkp-tools: what lives where,
                    hosting on Vercel, updating, the change log, rebuilding the guide.
-->

# My PD — Personal Development Library

A private, phone-first library of personal development audio, video and documents.
It also has a Vault for words, topics and ideas, a built-in picture guide, and
What's new notes shown by role.

**Address:** https://mypd.mkcworkspace.com

## What lives where

| Thing | Where |
|---|---|
| The app (`index.html`), the guide (`guide.html`), the change log (`changelog.json`) | this folder, `c3jumpw/mkp-tools/pdl` |
| The library: media, covers, summaries, transcripts, collections, Trash | `c1jumpw/mkp-tools/pdl/media` (stays there) |
| Saves, uploads, large-file streaming, Vault and AI calls | Cloudflare Worker `pdl-relay`; holds the GitHub token and the Supabase and Gemini keys |
| Vault entries and attachments | Supabase, reached only through the relay |
| Old address `c1jumpw.github.io/mkp-tools/pdl/` | `c1jumpw/mkp-tools/pdl/index.html`, a small page that forwards here |

The app reads the library straight from GitHub (API, raw and jsDelivr) with no keys. Every write goes through the relay. `OWNER`, `REPO` and `MEDIA_PATH` at the top of `index.html` point at the library, not at this repo.

## Hosting (Vercel)

- Vercel project **mkp-tools-mypd** (team c3-jumpw), Git-linked to `c3jumpw/mkp-tools`, root directory `pdl`, framework *Other*, no build step. Pushing to `main` publishes in about a minute.
- Domain `mypd.mkcworkspace.com`: a `CNAME` record named `mypd` in GoDaddy DNS points at Vercel.
- `.vercelignore` keeps `README.md`, `CLAUDE.md` and `guide-src/` off the website.

## Updating the app

1. Change the files here.
2. In the same commit, add a release to `changelog.json` (see below and `CLAUDE.md`).
3. If a screen changed, rebuild the guide (`guide-src/README.md`).
4. Push to `main`. Check https://mypd.mkcworkspace.com after a minute.

## Change log and What's new

`changelog.json` is the permanent history. It also drives two things:
- The **What's new** sheet in the app. "everyone" items show after unlocking. "admin" items show on devices that use Organize, or the first time Organize is switched on.
- The **Change log** chapter in the guide (`guide.html#changelog`).

Releases are kept oldest first. Each release has a `version` (YYYY.MM.DD, `-2` for a second release that day), a `date`, a `title`, a `summary`, `versions` (file versions), `repo` and `commits`, plus items. Each item has a `type` (new, improved, fixed or changed), an `audience` (everyone or admin), a `title`, a `text` and an optional guide `link`.

Releases up to 2026.10.10 were rebuilt from the history of `pdl/index.html` in `c1jumpw/mkp-tools`.

## Rebuilding the guide

The guide's screenshots come from the real app running against a sample library. Every network call is answered locally, so nothing touches the real repo or relay. See `guide-src/README.md`.
