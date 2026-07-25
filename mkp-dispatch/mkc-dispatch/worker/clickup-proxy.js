/**
 * =========================================================================
 * clickup-proxy.js — Cloudflare Worker
 * =========================================================================
 * PURPOSE
 *   Sits between the Dispatch front end and api.clickup.com. Two jobs:
 *     1. CORS — ClickUp's API sends no CORS headers, so a browser page
 *        calling it directly gets blocked. This Worker adds the header.
 *     2. Credential custody — Dispatch is registered as its own ClickUp
 *        OAuth app (see README "OAuth setup"). This Worker completes
 *        the OAuth handshake, stores the resulting access_token in KV
 *        storage, and attaches it to every proxied request. The token
 *        NEVER goes to the browser or into this repo — only this
 *        Worker and Cloudflare's KV store ever see it.
 *
 * DATA FLOW (OAuth connect, one-time per re-connect)
 *   Browser → GET https://app.clickup.com/api?client_id=...&redirect_uri=...
 *   User approves in ClickUp's UI
 *   ClickUp  → GET {this Worker}/oauth/callback?code=XYZ
 *   Worker   → POST https://api.clickup.com/api/v2/oauth/token
 *              (client_id + client_secret + code) → { access_token }
 *   Worker   → writes access_token to TOKEN_STORE (KV), key "access_token"
 *   Worker   → 302 redirects the browser back to APP_URL#/settings
 *
 * DATA FLOW (normal use, every capture)
 *   Browser  → POST {this Worker}/list/{id}/task  (no token attached)
 *   Worker   → reads access_token from TOKEN_STORE
 *   Worker   → POST https://api.clickup.com/api/v2/list/{id}/task
 *              with Authorization: Bearer {access_token}
 *   Worker   → relays ClickUp's response back to the browser, with
 *              CORS headers added
 *
 * ASSUMPTIONS / EXTERNAL DEPENDENCIES
 *   Environment bindings required (set via `wrangler secret put` / the
 *   [vars] block in wrangler.toml — never hardcoded in this file):
 *     env.CLICKUP_CLIENT_ID      - public app identifier      (var)
 *     env.CLICKUP_CLIENT_SECRET  - private, used only here     (secret)
 *     env.ALLOWED_ORIGIN         - the one origin allowed to call this
 *                                   Worker via fetch() (CORS)   (var)
 *     env.APP_URL                - full URL of the deployed app, used
 *                                   as the redirect target after OAuth
 *                                   approval (var)
 *     env.APP_PASSCODE           - shared-secret device passcode; every
 *                                   proxied request must include a
 *                                   matching X-Dispatch-Key header
 *                                   (secret)
 *     env.TOKEN_STORE            - KV namespace binding storing the
 *                                   live access_token
 *
 * -------------------------------------------------------------------------
 * VERSION HISTORY
 *   v1  2026-07-23  Initial version. Used a single long-lived personal
 *                    API token (CLICKUP_TOKEN secret) shared with other
 *                    integrations. Retired after the token was found
 *                    revoked (ClickUp error OAUTH_025) and re-pointing
 *                    it risked breaking those other integrations.
 *   v2  2026-07-23  Switched to a dedicated ClickUp OAuth app so
 *                    Dispatch has its own independent credential.
 *                    Added /oauth/callback route (code→token exchange),
 *                    KV-backed token storage, Bearer-prefixed auth on
 *                    proxied requests. CLICKUP_TOKEN secret is no
 *                    longer read by this file (safe to leave the old
 *                    secret in place unused, or remove it later).
 *   v3  2026-07-24  Added APP_PASSCODE enforcement. Discovered that a
 *                    public GitHub Pages URL + an already-connected
 *                    OAuth token meant ANYONE who found the app's URL
 *                    could create tasks in the owner's ClickUp with no
 *                    login at all — v2 had CORS + credential custody
 *                    but no actual access control. Every proxied
 *                    request (except /oauth/callback, which is
 *                    self-protecting — see its own doc comment) now
 *                    requires a matching X-Dispatch-Key header, checked
 *                    here server-side so it can't be bypassed by
 *                    reading the front-end JS. Deliberately NOT
 *                    per-user auth (no accounts, no rotation) — a
 *                    single shared passcode, appropriate for "me + my
 *                    assistants" scale per the original project brief,
 *                    not for a multi-tenant product.
 * =========================================================================
 */

export default {
  /**
   * fetch — Worker entry point, called once per incoming HTTP request.
   * Routes to one of: CORS preflight, OAuth callback, or a proxied
   * ClickUp API call, based on method + path.
   * @param {Request} request
   * @param {object} env - bindings, see header comment above
   * @returns {Promise<Response>}
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS headers applied to every JSON response this Worker returns
    // to the browser (the OAuth callback below is a top-level browser
    // *navigation*, not a fetch(), so CORS doesn't apply there).
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || '*';
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowed === '*' ? '*' : (origin === allowed ? origin : 'null'),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Dispatch-Key',
      'Vary': 'Origin'
    };

    // Preflight requests: the browser asks "am I allowed to call this?"
    // before the real request. Just echo the CORS headers back.
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // ---------------------------------------------------------------
    // Route: OAuth callback — ClickUp redirects the user's browser
    // here after they approve access, with a one-time ?code=...
    // Deliberately NOT passcode-gated: it's a browser navigation (no
    // custom headers possible), and it's already self-protecting —
    // completing it requires a valid `code` that only ClickUp issues,
    // only after the account owner clicks Allow on ClickUp's own page.
    // ---------------------------------------------------------------
    if (url.pathname === '/oauth/callback') {
      return handleOAuthCallback(url, env);
    }

    // ---------------------------------------------------------------
    // Route: proxied ClickUp API calls. Only these three exact shapes
    // are allowed through — anything else is rejected, so this Worker
    // can't be repurposed as an open proxy to arbitrary ClickUp
    // endpoints even if someone discovers its URL.
    // ---------------------------------------------------------------
    const allowedPath = /^\/(user|list\/\d+\/task|task\/[A-Za-z0-9]+\/attachment)$/;
    if (!allowedPath.test(url.pathname)) {
      return json({ error: 'Endpoint not allowed by proxy.' }, 404, corsHeaders);
    }

    // ---------------------------------------------------------------
    // Access control: every proxied request must carry the correct
    // device passcode. This is the actual security boundary — CORS
    // (above) only stops *browsers* from calling this cross-origin; it
    // does nothing against a direct script/curl request, and the
    // OAuth token being server-side-only stops token theft but not
    // someone simply using the app's own working URL. Checked before
    // touching TOKEN_STORE or ClickUp at all.
    // ---------------------------------------------------------------
    if (!checkPasscode(request, env)) {
      return json({ error: 'Invalid or missing passcode.' }, 403, corsHeaders);
    }

    const accessToken = await env.TOKEN_STORE.get('access_token');
    if (!accessToken) {
      // No one has completed the OAuth connect flow yet (or it was
      // never stored successfully). Tell the caller plainly rather
      // than letting ClickUp return a confusing generic auth error.
      return json({ error: 'Not connected to ClickUp yet. Open Settings → Connect to ClickUp.' }, 401, corsHeaders);
    }

    const upstream = new URL(`https://api.clickup.com/api/v2${url.pathname}`);
    const init = {
      method: request.method,
      // OAuth-issued tokens use the "Bearer " prefix (unlike ClickUp's
      // personal pk_ tokens, which are sent raw). Getting this prefix
      // wrong is a common source of a misleading 401 here.
      headers: { Authorization: `Bearer ${accessToken}` }
    };

    const contentType = request.headers.get('Content-Type') || '';
    if (request.method === 'POST' && contentType.includes('application/json')) {
      init.headers['Content-Type'] = 'application/json';
      init.body = await request.text();
    } else if (request.method === 'POST') {
      // multipart/form-data (attachment upload) — stream the body
      // through unmodified rather than buffering it in memory.
      init.body = request.body;
      init.duplex = 'half';
      if (contentType) init.headers['Content-Type'] = contentType;
    }

    try {
      const upstreamRes = await fetch(upstream.toString(), init);
      const body = await upstreamRes.text();
      return new Response(body, {
        status: upstreamRes.status,
        headers: { ...corsHeaders, 'Content-Type': upstreamRes.headers.get('Content-Type') || 'application/json' }
      });
    } catch (err) {
      return json({ error: 'Upstream request to ClickUp failed.', detail: String(err) }, 502, corsHeaders);
    }
  }
};

/**
 * checkPasscode
 * Verifies the request's X-Dispatch-Key header matches the Worker's
 * configured APP_PASSCODE secret. This is the actual access-control
 * check for every proxied ClickUp call (see fetch()'s call site).
 * @param {Request} request
 * @param {object} env - needs env.APP_PASSCODE
 * @returns {boolean} true if authorized
 * Edge case: if APP_PASSCODE was never set on the Worker (e.g. setup
 * not finished yet), this fails closed — returns false rather than
 * silently allowing all requests through, since an unset secret is
 * indistinguishable from "not configured" and open access is the
 * wrong default to fail into.
 */
function checkPasscode(request, env) {
  const expected = env.APP_PASSCODE;
  if (!expected) return false;
  const provided = request.headers.get('X-Dispatch-Key') || '';
  return provided === expected;
}

/**
 * handleOAuthCallback
 * Completes the OAuth "authorization code" exchange: takes the
 * one-time `code` ClickUp put on the redirect URL, trades it
 * server-side (with the client secret, which never leaves the
 * Worker) for a long-lived access_token, stores that token in KV,
 * and sends the user's browser back to the app.
 *
 * @param {URL} url - the incoming request URL, expected to carry a
 *   `code` query param (ClickUp also sends `error` here if the user
 *   declined access instead of approving).
 * @param {object} env - Worker bindings (needs CLICKUP_CLIENT_ID,
 *   CLICKUP_CLIENT_SECRET, TOKEN_STORE, APP_URL)
 * @returns {Promise<Response>} a 302 redirect back into the app, with
 *   ?connected=1 on success or ?connect_error=... on failure — the
 *   Settings screen (app.js) reads this to show the right message.
 *
 * Failure modes handled:
 *   - User declined access (ClickUp sends ?error=... instead of ?code=)
 *   - code→token exchange fails (bad/expired code, misconfigured
 *     client secret, redirect URI mismatch) — ClickUp's error body is
 *     passed through in the redirect so it's visible for debugging.
 */
async function handleOAuthCallback(url, env) {
  const code = url.searchParams.get('code');
  const errorParam = url.searchParams.get('error');
  const appUrl = (env.APP_URL || '/').replace(/\/$/, '');

  if (errorParam) {
    return Response.redirect(`${appUrl}/#/settings?connect_error=${encodeURIComponent(errorParam)}`, 302);
  }
  if (!code) {
    return Response.redirect(`${appUrl}/#/settings?connect_error=missing_code`, 302);
  }

  try {
    const tokenRes = await fetch('https://api.clickup.com/api/v2/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: env.CLICKUP_CLIENT_ID,
        client_secret: env.CLICKUP_CLIENT_SECRET,
        code
      })
    });

    const data = await tokenRes.json();
    if (!tokenRes.ok || !data.access_token) {
      const reason = data.err || data.error || `HTTP ${tokenRes.status}`;
      return Response.redirect(`${appUrl}/#/settings?connect_error=${encodeURIComponent(reason)}`, 302);
    }

    // Persist the token so future requests (from any device, since
    // this lives on the Worker, not the browser) can use it without
    // repeating the OAuth handshake.
    await env.TOKEN_STORE.put('access_token', data.access_token);

    return Response.redirect(`${appUrl}/#/settings?connected=1`, 302);
  } catch (err) {
    return Response.redirect(`${appUrl}/#/settings?connect_error=${encodeURIComponent(String(err))}`, 302);
  }
}

/**
 * json — small helper to build a JSON Response with the right headers.
 * @param {object} obj - value to serialize as the response body
 * @param {number} status - HTTP status code
 * @param {object} headers - additional headers to merge in (typically
 *   the CORS header set built in fetch())
 * @returns {Response}
 */
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' }
  });
}
