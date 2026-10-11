/**
 * =========================================================================
 * clickup-proxy.js — Cloudflare Worker (entry point + router)
 * =========================================================================
 * PURPOSE
 *   Sits between the Dispatch front end and api.clickup.com. Jobs:
 *     1. CORS — ClickUp's API sends no CORS headers, so a browser page
 *        calling it directly gets blocked. This Worker adds the header.
 *     2. Credential custody — Dispatch is registered as its own ClickUp
 *        OAuth app (see README "OAuth setup"). This Worker completes
 *        the OAuth handshake, stores the resulting access_token in KV
 *        storage, and attaches it to every proxied request. The token
 *        NEVER goes to the browser or into this repo — only this
 *        Worker and Cloudflare's KV store ever see it.
 *     3. Access control — every request (except the OAuth callback and
 *        signed ClickUp webhooks) must carry the device passcode.
 *     4. Smart routing (v8) — Gemini-powered placement, duplicate
 *        detection, audit log with undo, and a feedback loop. The logic
 *        lives in ./lib/*; this file only routes requests to it.
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
 * DATA FLOW (manual capture)
 *   Browser  → POST {this Worker}/list/{id}/task  (no token attached)
 *   Worker   → reads access_token from TOKEN_STORE, forwards to ClickUp
 *              with Authorization: Bearer {access_token}, relays the
 *              response back with CORS headers added
 *
 * DATA FLOW (smart capture, v8)
 *   Browser  → POST /route/suggest   → lib/routing-engine.js (Gemini +
 *              vector search; read-only) → suggestion + confidence
 *   Browser  → POST /route/commit    → creates the task (or comments on
 *              the duplicate), writes the audit record, updates feedback
 *   Browser  → POST /audit/:id/undo  → reverses it
 *   ClickUp  → POST /webhook/clickup → keeps the workspace index fresh
 *   Cron     → scheduled()           → one small sync step every 15 min
 *
 * ASSUMPTIONS / EXTERNAL DEPENDENCIES
 *   Environment bindings (never hardcoded in this file):
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
 *     env.WORKSPACE_ID           - ClickUp Workspace ID (var, public)
 *     env.CHAT_CHANNEL_ID        - default Chat channel for handleChatLog()
 *     env.TOKEN_STORE            - KV namespace: OAuth token + all smart-
 *                                   routing state (see lib/store.js)
 *     env.GEMINI_API_KEY         - (secret, v8) Google AI Studio key
 *     env.GEMINI_MODEL / GEMINI_EMBED_MODEL / EMBED_DIMS /
 *     GEMINI_THINKING_LEVEL      - (vars, v8) see lib/gemini.js
 *     env.TASK_VECTORS           - (Vectorize binding, v8, optional)
 *     env.PRIVATE_LIST_IDS       - (var, v8) lists never sent to Gemini
 *   Free-plan limits that shaped v8: 10ms CPU and 50 external
 *   subrequests per invocation, 1,000 KV writes/day. See
 *   lib/workspace-index.js for how sync work is chunked around them.
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
 *                    login at all. Every proxied request (except
 *                    /oauth/callback, which is self-protecting) now
 *                    requires a matching X-Dispatch-Key header, checked
 *                    server-side. Deliberately a single shared passcode,
 *                    appropriate for "me + my assistants" scale.
 *   v4  2026-07-25  (1) Allowlisted `list/:id/member` (GET) for the
 *                    assignee dropdown. (2) Added handleChatLog() — v3
 *                    Chat "create message" (ClickUp marks this API
 *                    "experimental"). (3) Added handleChatChannelsLookup()
 *                    to discover the real channel_id.
 *   v5  2026-07-25  (1) Fixed the generic passthrough dropping query
 *                    strings (url.search). (2) Allowlisted bare
 *                    `task/:id` (GET) for direct-by-ID lookup — ClickUp
 *                    has no task name-search endpoint.
 *   v6  2026-07-26  (1) Allowlisted `task/:id/comment` (POST) for
 *                    Follow-up / Reminder (ClickUp Reminders have no
 *                    public API). (2) handleChatLog() accepts an optional
 *                    client channel_id (used by "Add to Accounts").
 *   v7  2026-08-07  Allowlisted `list/:id/field` (GET) so Add to
 *                    Accounts' Direct-to-List mode can populate real
 *                    custom fields.
 *   v8  2026-10-10  Smart routing + hardening:
 *                    (1) New routes, all passcode-gated:
 *                        GET  /routing/status, /routing/lists, /audit,
 *                             /audit/:id
 *                        POST /routing/settings, /routing/sync,
 *                             /routing/webhook, /routing/index-tasks,
 *                             /route/suggest, /route/duplicates,
 *                             /route/commit, /audit/record,
 *                             /audit/:id/undo
 *                    (2) POST /webhook/clickup — NOT passcode-gated (ClickUp
 *                        can't send our header); authenticated instead by
 *                        verifying ClickUp's HMAC X-Signature.
 *                    (3) scheduled() cron handler — one sync step per run.
 *                    (4) Allowlisted `team/:id/task` (GET) so the app can
 *                        page open tasks for the initial index backfill
 *                        (streamed through untouched; see
 *                        lib/workspace-index.js for why the device does
 *                        that part, not the Worker).
 *                    (5) Generic JSON passthrough now has a 25s timeout
 *                        and answers 504 {error:'upstream_timeout',
 *                        outcome:'unknown'} instead of hanging; the app
 *                        treats that as "might have been created" and
 *                        checks before retrying, so a slow ClickUp no
 *                        longer risks a duplicate task.
 *                    (6) Passcode compare is now constant-time.
 *                    (7) json() moved to lib/http.js (shared).
 *                    (8) Pre-deploy review fixes: the passthrough now
 *                        allows only specific METHODS per path (before,
 *                        DELETE/PUT /task/:id would have been forwarded);
 *                        the OAuth callback only stores a token that can
 *                        access WORKSPACE_ID (pre-existing gap: anyone
 *                        could authorize the public client id and replace
 *                        the connection).
 * =========================================================================
 */

import { json, safeEqual, readJsonBody, fetchWithTimeout } from './lib/http.js';
import { KEYS, getJSON, getSettings, saveSettings, privateListIds, vectorsAvailable } from './lib/store.js';
import { geminiConfigured, modelName, describeGeminiError } from './lib/gemini.js';
import {
  getIndex, runSyncStep, indexTaskItems, finishBackfill, enableWebhook, disableWebhook,
  webhookStatus, handleWebhookRequest, vectorCount
} from './lib/workspace-index.js';
import { suggestPlacement, findDuplicates, commitCapture, recordManual } from './lib/routing-engine.js';
import { listAudit, getAudit, undoAction, getFeedback, accuracySummary, statusError } from './lib/audit-log.js';

// v2-style ClickUp paths the generic passthrough will forward, each with
// the ONLY methods the app needs. Anything else is rejected, so this
// Worker can't be used as an open proxy — and in particular can't DELETE
// or PUT tasks (deletion only happens through audited Undo).
const API_V2_ROUTES = [
  { re: /^\/user$/, methods: ['GET'] },
  { re: /^\/list\/\d+\/task$/, methods: ['GET', 'POST'] },
  { re: /^\/list\/\d+\/member$/, methods: ['GET'] },
  { re: /^\/list\/\d+\/field$/, methods: ['GET'] },
  { re: /^\/task\/[A-Za-z0-9]+$/, methods: ['GET'] },
  { re: /^\/task\/[A-Za-z0-9]+\/attachment$/, methods: ['POST'] },
  { re: /^\/task\/[A-Za-z0-9]+\/comment$/, methods: ['POST'] },
  { re: /^\/team\/\d+\/task$/, methods: ['GET'] }
];

/**
 * isAllowedPassthrough
 * @param {string} method
 * @param {string} pathname
 * @returns {boolean} true when this exact method+path may be proxied
 */
function isAllowedPassthrough(method, pathname) {
  return API_V2_ROUTES.some(r => r.re.test(pathname) && r.methods.includes(method));
}

// Smart-routing routes (exact "METHOD /path" matches). Parameterized
// audit routes are matched separately below.
const ROUTING_ROUTES = new Set([
  'GET /routing/status',
  'GET /routing/lists',
  'POST /routing/settings',
  'POST /routing/sync',
  'POST /routing/webhook',
  'POST /routing/index-tasks',
  'POST /route/suggest',
  'POST /route/duplicates',
  'POST /route/commit',
  'GET /audit',
  'POST /audit/record'
]);
const AUDIT_ITEM_RE = /^\/audit\/(\d{16}-[a-z0-9]{6})(\/undo)?$/;

export default {
  /**
   * fetch — Worker entry point, called once per incoming HTTP request.
   * Order: CORS preflight → OAuth callback → ClickUp webhook → allowlist
   * → passcode → (status needs no token) → token → dispatch.
   * @param {Request} request
   * @param {object} env - bindings, see header comment above
   * @param {ExecutionContext} ctx - for waitUntil() background work
   * @returns {Promise<Response>}
   */
  async fetch(request, env, ctx) {
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

    // OAuth callback — deliberately NOT passcode-gated: it's a browser
    // navigation (no custom headers possible), and completing it needs a
    // valid `code` that only ClickUp issues after the owner clicks Allow.
    if (url.pathname === '/oauth/callback') {
      return handleOAuthCallback(url, env);
    }

    // ClickUp webhook deliveries — authenticated by HMAC signature
    // instead of the passcode (see lib/workspace-index.js).
    if (url.pathname === '/webhook/clickup' && request.method === 'POST') {
      return handleWebhookRequest(request, env, ctx);
    }

    const routeKey = `${request.method} ${url.pathname}`;
    const auditItem = url.pathname.match(AUDIT_ITEM_RE);
    const isRouting = ROUTING_ROUTES.has(routeKey) || Boolean(auditItem);
    const isChatChannelsLookup = url.pathname === '/chat/channels' && request.method === 'GET';
    const isChatLog = url.pathname === '/log/chat' && request.method === 'POST';

    const isPassthrough = isAllowedPassthrough(request.method, url.pathname);
    if (!isPassthrough && !isChatChannelsLookup && !isChatLog && !isRouting) {
      return json({ error: 'Endpoint not allowed by proxy.' }, 404, corsHeaders);
    }

    // Access control: the real security boundary (see v3 history).
    if (!checkPasscode(request, env)) {
      return json({ error: 'Invalid or missing passcode.' }, 403, corsHeaders);
    }

    const accessToken = await env.TOKEN_STORE.get(KEYS.token);

    // Status works even before ClickUp is connected, so Settings can
    // explain what's missing.
    if (routeKey === 'GET /routing/status') {
      return safely(() => routingStatus(env, accessToken), corsHeaders);
    }

    if (!accessToken) {
      return json({ error: 'Not connected to ClickUp yet. Open Settings → Connect to ClickUp.' }, 401, corsHeaders);
    }

    if (isChatChannelsLookup) return handleChatChannelsLookup(accessToken, env, corsHeaders);
    if (isChatLog) return handleChatLog(request, accessToken, env, corsHeaders);
    if (isRouting) return safely(() => handleRouting(request, env, ctx, accessToken, url, routeKey, auditItem), corsHeaders);

    return proxyToClickUp(request, url, accessToken, corsHeaders);
  },

  /**
   * scheduled — cron entry point (wrangler.toml [triggers]). Runs ONE
   * bounded sync step so each run stays inside free-plan limits; see
   * lib/workspace-index.js runSyncStep().
   * @param {ScheduledController} event
   * @param {object} env
   * @param {ExecutionContext} ctx
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const token = await env.TOKEN_STORE.get(KEYS.token);
      if (!token) return; // not connected yet — nothing to sync
      await runSyncStep(env, token, { source: 'cron' });
    })().catch(() => {
      // Error already recorded in routing:sync.last_error by runSyncStep;
      // the next cron run simply tries again.
    }));
  }
};

/**
 * proxyToClickUp
 * The original generic passthrough for allowlisted v2 paths.
 * @param {Request} request
 * @param {URL} url
 * @param {string} accessToken
 * @param {object} corsHeaders
 * @returns {Promise<Response>}
 * Timeouts: JSON calls give up after 25s with 504 {error:
 *   'upstream_timeout', outcome: 'unknown'} — "unknown" because ClickUp
 *   may still have created the task; the app checks before retrying.
 *   Multipart uploads (attachments, up to 90MB) get no timeout, since a
 *   big file on a slow connection legitimately takes a while.
 */
async function proxyToClickUp(request, url, accessToken, corsHeaders) {
  const upstream = `https://api.clickup.com/api/v2${url.pathname}${url.search}`;
  const init = {
    method: request.method,
    // OAuth-issued tokens use the "Bearer " prefix (unlike personal pk_
    // tokens). Getting this wrong is a classic misleading 401.
    headers: { Authorization: `Bearer ${accessToken}` }
  };

  const contentType = request.headers.get('Content-Type') || '';
  const isMultipart = request.method === 'POST' && !contentType.includes('application/json');
  if (request.method === 'POST' && !isMultipart) {
    init.headers['Content-Type'] = 'application/json';
    init.body = await request.text();
  } else if (isMultipart) {
    // multipart/form-data (attachment upload) — stream the body
    // through unmodified rather than buffering it in memory.
    init.body = request.body;
    init.duplex = 'half';
    if (contentType) init.headers['Content-Type'] = contentType;
  }

  try {
    const upstreamRes = isMultipart ? await fetch(upstream, init) : await fetchWithTimeout(upstream, init, 25000);
    // Stream the body back untouched — no parsing here keeps CPU near
    // zero even for 100-task pages (important on the free plan).
    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: { ...corsHeaders, 'Content-Type': upstreamRes.headers.get('Content-Type') || 'application/json' }
    });
  } catch (err) {
    if (err && err.status === 504) {
      return json({ error: 'upstream_timeout', outcome: 'unknown', detail: 'ClickUp didn’t answer within 25 seconds.' }, 504, corsHeaders);
    }
    return json({ error: 'Upstream request to ClickUp failed.', detail: String(err && err.message || err) }, 502, corsHeaders);
  }
}

/**
 * handleRouting
 * Dispatches every smart-routing route to its lib/* implementation.
 * @param {Request} request
 * @param {object} env
 * @param {ExecutionContext} ctx
 * @param {string} token - ClickUp OAuth token
 * @param {URL} url
 * @param {string} routeKey - "METHOD /path"
 * @param {RegExpMatchArray|null} auditItem - match for /audit/:id(/undo)
 * @returns {Promise<object>} JSON-able result (safely() wraps it)
 */
async function handleRouting(request, env, ctx, token, url, routeKey, auditItem) {
  if (auditItem) {
    const id = auditItem[1];
    if (auditItem[2] && request.method === 'POST') {
      const { record, notes } = await undoAction(env, token, id);
      return { ok: true, record, notes };
    }
    if (!auditItem[2] && request.method === 'GET') {
      const record = await getAudit(env, id);
      if (!record) throw statusError(404, 'No such activity record.');
      return { record };
    }
    throw statusError(405, 'Method not allowed.');
  }

  switch (routeKey) {
    case 'GET /routing/lists': {
      // Compact catalog for the app's pickers (private lists left out).
      const index = await getIndex(env);
      const hidden = privateListIds(env);
      const lists = ((index && index.lists) || [])
        .filter(l => !l.private && !hidden.has(l.id))
        .map(l => ({ id: l.id, name: l.name, path: l.path, space_id: l.space_id, space: l.space }));
      return { synced_at: (index && index.synced_at) || null, lists };
    }
    case 'POST /routing/settings': {
      const body = await readJsonBody(request, 4096);
      return { settings: await saveSettings(env, body) };
    }
    case 'POST /routing/sync': {
      const body = await readJsonBody(request, 4096);
      const mode = ['auto', 'hierarchy', 'fields', 'tasks'].includes(body.mode) ? body.mode : 'auto';
      return runSyncStep(env, token, { mode, source: 'manual' });
    }
    case 'POST /routing/webhook': {
      const body = await readJsonBody(request, 4096);
      if (body.action === 'disable') {
        await disableWebhook(env, token);
        return { enabled: false };
      }
      const { id } = await enableWebhook(env, token, `${url.origin}/webhook/clickup`);
      return { enabled: true, id };
    }
    case 'POST /routing/index-tasks': {
      // Device-driven backfill: ≤50 compact items per call keeps the
      // embedding response small enough for the free-plan CPU budget.
      const body = await readJsonBody(request, 131072);
      const items = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
      if (!vectorsAvailable(env)) throw statusError(409, 'The task index (Vectorize) isn’t set up on the Worker yet.');
      if (items.length && !geminiConfigured(env)) throw statusError(409, 'GEMINI_API_KEY isn’t set on the Worker yet.');
      const result = items.length ? await indexTaskItems(env, items.map(cleanItem)) : { upserted: 0, deleted: 0, skipped: 0 };
      if (body.finish) await finishBackfill(env, body.finish.started_at, body.finish.total);
      return result;
    }
    case 'POST /route/suggest':
      return suggestPlacement(env, await readJsonBody(request, 65536));
    case 'POST /route/duplicates':
      return findDuplicates(env, await readJsonBody(request, 16384));
    case 'POST /route/commit':
      return commitCapture(env, token, ctx, await readJsonBody(request, 65536));
    case 'GET /audit':
      return listAudit(env, { limit: url.searchParams.get('limit'), cursor: url.searchParams.get('cursor') });
    case 'POST /audit/record':
      return recordManual(env, ctx, await readJsonBody(request, 16384));
    default:
      throw statusError(404, 'Unknown route.');
  }
}

/**
 * cleanItem
 * Normalizes one app-supplied backfill item (the app's twin of
 * workspace-index.js taskToItem). Values are coerced to short strings so
 * a malformed item can't bloat the index.
 * @param {object} it
 * @returns {object}
 */
function cleanItem(it) {
  return {
    id: String((it && it.id) || ''),
    name: String((it && it.name) || '').slice(0, 300),
    text: String((it && it.text) || '').slice(0, 400),
    list_id: String((it && it.list_id) || ''),
    space_id: String((it && it.space_id) || ''),
    status: String((it && it.status) || '').slice(0, 40),
    closed: Boolean(it && it.closed),
    parent: Boolean(it && it.parent)
  };
}

/**
 * routingStatus
 * Everything Settings needs to show the state of smart routing in one
 * call: what's configured, how fresh the index is, webhook health,
 * thresholds and accuracy so far.
 * @param {object} env
 * @param {string|null} token
 * @returns {Promise<object>}
 */
async function routingStatus(env, token) {
  const [index, sync, settings, feedback, count, webhook] = await Promise.all([
    getIndex(env),
    getJSON(env, KEYS.sync, {}),
    getSettings(env),
    getFeedback(env),
    vectorCount(env),
    token ? webhookStatus(env, token) : Promise.resolve({ enabled: false })
  ]);
  return {
    clickup_connected: Boolean(token),
    gemini: { configured: geminiConfigured(env), model: modelName(env) },
    vectors: { available: vectorsAvailable(env), count },
    index: index ? { lists: index.lists.length, spaces: index.spaces.length, synced_at: index.synced_at, truncated: Boolean(index.truncated) } : null,
    sync: {
      last_run: sync.last_run || null,
      last_source: sync.last_source || null,
      last_error: sync.last_error || null,
      hier_at: sync.hier_at || null,
      tasks_indexed_through: sync.tasks_hwm || null,
      backfill: sync.backfill || null,
      fields: index ? { done: Math.min(sync.fields_cursor || 0, index.lists.length), total: index.lists.length } : null
    },
    webhook,
    settings,
    accuracy: accuracySummary(feedback),
    private_lists: privateListIds(env).size
  };
}

/**
 * safely
 * Runs a route handler and converts its result or error into a JSON
 * Response with consistent error shapes the app can rely on:
 *   { error: <human message>, code: <machine code>, ... }
 * @param {() => Promise<object>} fn
 * @param {object} corsHeaders
 * @returns {Promise<Response>}
 */
async function safely(fn, corsHeaders) {
  try {
    return json(await fn(), 200, corsHeaders);
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
}

/**
 * errorResponse — maps internal/upstream errors to app-facing JSON.
 * @param {Error} err
 * @param {object} corsHeaders
 * @returns {Response}
 */
function errorResponse(err, corsHeaders) {
  // Our own validation errors: safe to show verbatim.
  if (err && err.expose) {
    return json({ error: err.message, code: `http_${err.status}` }, err.status || 400, corsHeaders);
  }
  if (err && err.name === 'UpstreamError') {
    if (err.service === 'gemini') {
      const d = describeGeminiError(err);
      return json({ error: d.message, code: d.code }, err.status === 429 ? 429 : 503, corsHeaders);
    }
    if (err.service === 'clickup') {
      // ClickUp error bodies look like {"err":"...","ECODE":"..."}.
      let detail = {};
      try { detail = JSON.parse(err.body || '{}'); } catch (e) { /* non-JSON body */ }
      if (err.status === 504) {
        return json({ error: 'upstream_timeout', outcome: 'unknown', code: 'clickup_timeout' }, 504, corsHeaders);
      }
      return json({
        error: detail.err ? `ClickUp: ${detail.err}` : `ClickUp returned ${err.status}.`,
        code: detail.ECODE || 'clickup_error',
        clickup_status: err.status
      }, err.status >= 500 ? 502 : err.status, corsHeaders);
    }
  }
  // Size/JSON errors from readJsonBody carry a status but no `expose`.
  if (err && (err.status === 400 || err.status === 413)) {
    return json({ error: err.message, code: `http_${err.status}` }, err.status, corsHeaders);
  }
  return json({ error: 'Unexpected server error.', code: 'internal', detail: String((err && err.message) || err).slice(0, 200) }, 500, corsHeaders);
}

/**
 * handleChatChannelsLookup
 * One-time discovery helper: lists every Chat channel in the
 * Workspace so the real `channel_id` for CHAT_CHANNEL_ID can be
 * confirmed (the "/chat/r/..." URL slug isn't guaranteed to be the
 * API's id format). Not used by the normal capture flow.
 * @param {string} accessToken - OAuth token from TOKEN_STORE
 * @param {object} env
 * @param {object} corsHeaders
 * @returns {Promise<Response>} ClickUp's channel list, relayed as-is
 */
async function handleChatChannelsLookup(accessToken, env, corsHeaders) {
  if (!env.WORKSPACE_ID) {
    return json({ error: 'WORKSPACE_ID is not set on this Worker.' }, 500, corsHeaders);
  }
  try {
    const res = await fetchWithTimeout(`https://api.clickup.com/api/v3/workspaces/${env.WORKSPACE_ID}/chat/channels`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    }, 15000);
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { ...corsHeaders, 'Content-Type': res.headers.get('Content-Type') || 'application/json' }
    });
  } catch (err) {
    return json({ error: 'Upstream request to ClickUp failed.', detail: String(err.message || err) }, 502, corsHeaders);
  }
}

/**
 * handleChatLog
 * Posts a message into a ClickUp Chat channel. Defaults to the
 * general activity channel (CHAT_CHANNEL_ID); a request can pass its own
 * `channel_id` (used by "Add to Accounts"). Trusting a client-specified
 * channel_id is a deliberate, narrow trade-off: callers are already
 * passcode-gated, and this only ever posts Chat messages.
 * Best-effort by design: the app never lets a failure here undo or
 * block a capture that already succeeded.
 * @param {Request} request - expects JSON body { content: string, channel_id?: string }
 * @param {string} accessToken
 * @param {object} env - needs WORKSPACE_ID, CHAT_CHANNEL_ID (default)
 * @param {object} corsHeaders
 * @returns {Promise<Response>}
 * Edge cases: no resolvable channel_id → clear 500 rather than posting
 * nowhere. ClickUp's Chat API is "experimental" — a schema change on
 * their side surfaces here as a relayed non-2xx.
 */
async function handleChatLog(request, accessToken, env, corsHeaders) {
  if (!env.WORKSPACE_ID) {
    return json({ error: 'WORKSPACE_ID is not set on this Worker.' }, 500, corsHeaders);
  }
  let content, requestedChannelId;
  try {
    const payload = JSON.parse(await request.text());
    content = payload.content;
    requestedChannelId = payload.channel_id;
  } catch (err) {
    return json({ error: 'Invalid JSON body.' }, 400, corsHeaders);
  }
  if (!content) return json({ error: 'Missing "content".' }, 400, corsHeaders);

  const channelId = requestedChannelId || env.CHAT_CHANNEL_ID;
  if (!channelId) {
    return json({ error: 'No channel_id provided and CHAT_CHANNEL_ID is not set on this Worker.' }, 500, corsHeaders);
  }

  try {
    const res = await fetchWithTimeout(
      `https://api.clickup.com/api/v3/workspaces/${env.WORKSPACE_ID}/chat/channels/${encodeURIComponent(channelId)}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'message', content, content_format: 'text/md' })
      },
      15000
    );
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { ...corsHeaders, 'Content-Type': res.headers.get('Content-Type') || 'application/json' }
    });
  } catch (err) {
    return json({ error: 'Upstream request to ClickUp failed.', detail: String(err.message || err) }, 502, corsHeaders);
  }
}

/**
 * checkPasscode
 * Verifies the request's X-Dispatch-Key header matches APP_PASSCODE.
 * @param {Request} request
 * @param {object} env - needs env.APP_PASSCODE
 * @returns {boolean} true if authorized
 * Edge case: if APP_PASSCODE was never set, fails CLOSED — open access
 * is the wrong default to fall into. Comparison is constant-time (v8).
 */
function checkPasscode(request, env) {
  const expected = env.APP_PASSCODE;
  if (!expected) return false;
  return safeEqual(request.headers.get('X-Dispatch-Key') || '', expected);
}

/**
 * handleOAuthCallback
 * Completes the OAuth "authorization code" exchange: trades the
 * one-time `code` (server-side, with the client secret that never
 * leaves the Worker) for an access_token, stores it in KV, and sends
 * the browser back to the app.
 * @param {URL} url - incoming request URL with `code` (or `error` if the
 *   user declined)
 * @param {object} env - needs CLICKUP_CLIENT_ID, CLICKUP_CLIENT_SECRET,
 *   TOKEN_STORE, APP_URL
 * @returns {Promise<Response>} 302 back into the app with ?connected=1
 *   or ?connect_error=... (read by Settings in app.js)
 * Failure modes: declined access; bad/expired code; misconfigured secret
 * or redirect URI — ClickUp's error text is passed through for debugging.
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
    const tokenRes = await fetchWithTimeout('https://api.clickup.com/api/v2/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: env.CLICKUP_CLIENT_ID,
        client_secret: env.CLICKUP_CLIENT_SECRET,
        code
      })
    }, 15000);

    const data = await tokenRes.json();
    if (!tokenRes.ok || !data.access_token) {
      const reason = data.err || data.error || `HTTP ${tokenRes.status}`;
      return Response.redirect(`${appUrl}/#/settings?connect_error=${encodeURIComponent(reason)}`, 302);
    }

    // v8 hardening: only accept a token that can actually see OUR
    // workspace. The callback has to be public (browser navigation), so
    // without this anyone could authorize the public Client ID with
    // their own ClickUp account and overwrite the stored connection.
    // (ClickUp's OAuth docs don't document a `state` round-trip, so this
    // workspace check is the reliable guard.)
    if (env.WORKSPACE_ID) {
      const teamsRes = await fetchWithTimeout('https://api.clickup.com/api/v2/team', {
        headers: { Authorization: `Bearer ${data.access_token}` }
      }, 15000);
      const teams = teamsRes.ok ? ((await teamsRes.json()).teams || []) : [];
      if (!teams.some(t => String(t.id) === String(env.WORKSPACE_ID))) {
        return Response.redirect(`${appUrl}/#/settings?connect_error=${encodeURIComponent('That ClickUp account can’t access this workspace — connection not saved.')}`, 302);
      }
    }

    // Persist the token so every device can use it without repeating
    // the OAuth handshake.
    await env.TOKEN_STORE.put(KEYS.token, data.access_token);

    return Response.redirect(`${appUrl}/#/settings?connected=1`, 302);
  } catch (err) {
    return Response.redirect(`${appUrl}/#/settings?connect_error=${encodeURIComponent(String(err.message || err))}`, 302);
  }
}
