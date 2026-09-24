/**
 * =========================================================================
 * worker.js — prompt-library-relay (Cloudflare Worker)
 * =========================================================================
 * PURPOSE
 *   Gives the Prompt Library (a static GitHub Pages site) somewhere real to
 *   save prompts, so edits made on any device show up on every device —
 *   with no token or login on the device itself beyond the passcode.
 *
 * STORAGE
 *   One JSON document in Workers KV under the key "prompt-library:v1".
 *   Prompts you add are NOT written to the public repo. The repo's own
 *   prompts.json is only the starter set the site loads the first time.
 *
 * ENDPOINTS
 *   GET  /health    no auth. { ok: true } — lets the app check the relay is up.
 *   GET  /prompts   needs X-Library-Key. { data } (data is null until the
 *                   first save).
 *   PUT  /prompts   needs X-Library-Key. Body { data }. The Worker MERGES the
 *                   incoming document into what is stored (per prompt, the
 *                   newest updatedAt wins; deletions are tombstones) and
 *                   returns { data: <merged> }. Merging on the server means
 *                   two devices saving at nearly the same moment cannot
 *                   silently overwrite each other.
 *
 * BINDINGS (wrangler.toml)
 *   env.LIBRARY_STORE     KV namespace                      (binding)
 *   env.ALLOWED_ORIGIN    origin(s) allowed via CORS, comma-separated (var)
 *   env.PASSCODE          optional secret. If set, it is the passcode.
 *   env.DEFAULT_PASSCODE  var used only when PASSCODE is not set.
 *
 * SECURITY NOTES
 *   - The passcode is compared in constant time (via SHA-256 digests).
 *   - Failed attempts are counted per IP and blocked after FAIL_LIMIT for
 *     FAIL_WINDOW_MS. The counter lives in Worker memory, so it is
 *     best-effort (it resets when the isolate recycles). It slows guessing;
 *     it is not a hard guarantee. A 4-digit code is a convenience gate, not
 *     strong security — use a longer PASSCODE secret for anything sensitive.
 *   - Browsers from any origin other than ALLOWED_ORIGIN are refused.
 *   - Request size, prompt count and field types are validated before
 *     anything reaches storage.
 * =========================================================================
 */

const DATA_KEY = 'prompt-library:v1';
const MAX_BODY_BYTES = 2_000_000;
const MAX_PROMPTS = 1000;
const MAX_TEMPLATE_CHARS = 100_000;
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const FAIL_LIMIT = 8;
const FAIL_WINDOW_MS = 10 * 60 * 1000;

const failures = new Map(); // ip -> { count, first }

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    // A browser from an unexpected origin gets nothing. (Non-browser callers send no Origin.)
    const origin = request.headers.get('Origin');
    if (origin && !cors['Access-Control-Allow-Origin']) return json({ error: 'Origin not allowed' }, 403, cors);

    try {
      if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true, service: 'prompt-library-relay' }, 200, cors);

      if (url.pathname === '/prompts' && (request.method === 'GET' || request.method === 'PUT')) {
        const denied = await authorize(request, env, cors);
        if (denied) return denied;
        // `await` matters here: without it a rejected storage call would escape the try/catch.
        if (request.method === 'GET') return await handleGet(env, cors);
        return await handlePut(request, env, cors);
      }
      return json({ error: 'Not found' }, 404, cors);
    } catch (err) {
      return json({ error: 'Relay error', detail: String(err && err.message || err) }, 500, cors);
    }
  }
};

/* ------------------------------------------------------------------ */
async function handleGet(env, cors) {
  const stored = await env.LIBRARY_STORE.get(DATA_KEY, { type: 'json', cacheTtl: 30 });
  return json({ data: stored || null }, 200, cors);
}

async function handlePut(request, env, cors) {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_BODY_BYTES) return json({ error: 'Payload too large' }, 413, cors);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: 'Payload too large' }, 413, cors);

  let body;
  try { body = JSON.parse(text); } catch { return json({ error: 'Body must be JSON' }, 400, cors); }
  const problem = validate(body && body.data);
  if (problem) return json({ error: problem }, 400, cors);

  const stored = await env.LIBRARY_STORE.get(DATA_KEY, { type: 'json', cacheTtl: 30 });
  const merged = prune(merge(stored || emptyDoc(), body.data));
  await env.LIBRARY_STORE.put(DATA_KEY, JSON.stringify(merged));
  return json({ data: merged }, 200, cors);
}

/* ---------------------------- merge logic -------------------------- */
// Mirrors mergeData() in the app. Per prompt the newest updatedAt wins; a
// tombstone hides a prompt unless the prompt was edited after the deletion.
const emptyDoc = () => ({ version: 1, prompts: [], deleted: {}, colors: {} });

function merge(stored, incoming) {
  const deleted = { ...(stored.deleted || {}) };
  for (const [id, ts] of Object.entries(incoming.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, Number(ts) || 0);

  const byId = new Map();
  for (const p of [...(stored.prompts || []), ...(incoming.prompts || [])]) {
    const cur = byId.get(p.id);
    if (!cur || (Number(p.updatedAt) || 0) > (Number(cur.updatedAt) || 0)) byId.set(p.id, p);
  }
  const prompts = [...byId.values()].filter(p => !(deleted[p.id] && deleted[p.id] >= (Number(p.updatedAt) || 0)));
  const colors = { ...(incoming.colors || {}), ...(stored.colors || {}) }; // stored wins so colours stay stable
  return { version: 1, prompts, deleted, colors };
}

function prune(doc) {
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  for (const [id, ts] of Object.entries(doc.deleted)) if (Number(ts) < cutoff) delete doc.deleted[id];
  const present = new Set(doc.prompts.map(p => p.category));
  for (const c of Object.keys(doc.colors)) if (!present.has(c)) delete doc.colors[c];
  return doc;
}

/* ---------------------------- validation --------------------------- */
function validate(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return 'data must be an object';
  if (!Array.isArray(d.prompts)) return 'data.prompts must be an array';
  if (d.prompts.length > MAX_PROMPTS) return `Too many prompts (max ${MAX_PROMPTS})`;
  const ids = new Set();
  for (const p of d.prompts) {
    if (!p || typeof p !== 'object') return 'Each prompt must be an object';
    if (typeof p.id !== 'string' || !p.id || p.id.length > 80) return 'Each prompt needs a string id';
    if (ids.has(p.id)) return 'Duplicate prompt id: ' + p.id;
    ids.add(p.id);
    if (typeof p.title !== 'string' || typeof p.template !== 'string') return 'Prompt title and template must be strings';
    if (p.template.length > MAX_TEMPLATE_CHARS) return 'A prompt template is too long';
    if (!Array.isArray(p.fields)) return 'Prompt fields must be an array';
    if (!Number.isFinite(Number(p.updatedAt))) return 'Prompt updatedAt must be a number';
  }
  if (d.deleted != null && (typeof d.deleted !== 'object' || Array.isArray(d.deleted))) return 'data.deleted must be an object';
  if (d.colors != null && (typeof d.colors !== 'object' || Array.isArray(d.colors))) return 'data.colors must be an object';
  return null;
}

/* ------------------------------ auth ------------------------------- */
async function authorize(request, env, cors) {
  const expected = env.PASSCODE || env.DEFAULT_PASSCODE;
  if (!expected) return json({ error: 'Relay has no passcode configured' }, 503, cors);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  let rec = failures.get(ip);
  if (rec && now - rec.first > FAIL_WINDOW_MS) { failures.delete(ip); rec = null; }
  if (rec && rec.count >= FAIL_LIMIT) return json({ error: 'Too many wrong passcodes. Try again in a few minutes.' }, 429, cors);

  const supplied = request.headers.get('X-Library-Key') || '';
  if (await safeEqual(supplied, String(expected))) { failures.delete(ip); return null; }

  failures.set(ip, { count: (rec ? rec.count : 0) + 1, first: rec ? rec.first : now });
  return json({ error: 'Wrong or missing passcode' }, 401, cors);
}

async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const A = new Uint8Array(x), B = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < A.length; i++) diff |= A[i] ^ B[i];
  return diff === 0;
}

/* ------------------------------ http ------------------------------- */
function corsHeaders(request, env) {
  const allowed = String(env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin');
  const h = {
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Library-Key',
    'Access-Control-Max-Age': '86400'
  };
  if (origin && allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors }
  });
}
