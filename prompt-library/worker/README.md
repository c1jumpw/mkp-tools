# Prompt Library relay

A small Cloudflare Worker that stores the Prompt Library's prompts in Workers KV,
so edits made on any device appear on every device. No token is needed on the devices,
only the passcode.

- `worker.js`: the Worker (endpoints and security notes are in its header comment)
- `wrangler.toml`: config (KV binding, allowed origin, default passcode)
- `worker.test.mjs`: unit tests. Run with `node --test worker.test.mjs`

## Deploying

**First time only:** move `deploy-workflow.yml` (in this folder) to
`.github/workflows/deploy-prompt-library-relay.yml`. On GitHub: open the file → pencil icon →
change the path at the top → Commit. That commit deploys the Worker.

Pushing a change under `prompt-library/worker/` deploys automatically
(`.github/workflows/deploy-prompt-library-relay.yml`, using the repo's existing
`CLOUDFLARE_API_TOKEN` secret). You can also run the workflow by hand from the Actions tab,
or deploy from a terminal with `npx wrangler deploy` in this folder.

The Worker lives at `https://prompt-library-relay.c1-jumpw.workers.dev`.

## The passcode

The Worker accepts the `PASSCODE` secret if one is set, otherwise the `DEFAULT_PASSCODE`
var in `wrangler.toml` (currently the same code the site already uses). The var is public
because this repo is public. To keep the passcode genuinely private, or to use a longer one:

```
cd prompt-library/worker
npx wrangler secret put PASSCODE
```

Devices are asked for the new passcode the next time they sync.

## Where the data lives

One JSON document in KV under `prompt-library:v1`, in the same KV namespace as Dispatch's
`TOKEN_STORE`. The Worker only touches that one key. The `prompts.json` next to the site is
just the starter set, used the first time the relay is empty.

To back up, use **Settings → Export JSON** in the app.
