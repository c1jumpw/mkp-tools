/**
 * =========================================================================
 * lib/http.js — shared HTTP helpers for the Dispatch Worker
 * =========================================================================
 * PURPOSE
 *   Small, dependency-free helpers every other Worker module uses:
 *     - json()              build a JSON Response with CORS headers merged in
 *     - fetchWithTimeout()  fetch() that gives up after N ms instead of
 *                           hanging until Cloudflare kills the invocation
 *     - clickup()           one call into ClickUp's REST API with the stored
 *                           OAuth token, returning parsed JSON or throwing
 *                           an UpstreamError that carries the HTTP status
 *     - readJsonBody()      size-capped JSON body parsing for routes that
 *                           accept input from the app
 *     - safeEqual()         constant-time string compare (passcode/HMAC)
 *     - hmacSha256Hex()     webhook signature verification helper
 *
 * DATA FLOW
 *   clickup-proxy.js (router) → feature modules (routing-engine,
 *   workspace-index, audit-log) → these helpers → ClickUp / Gemini.
 *
 * ASSUMPTIONS / EXTERNAL DEPENDENCIES
 *   - Runs on Cloudflare Workers (Web Crypto `crypto.subtle`, global
 *     fetch, AbortController all available).
 *   - ClickUp v2 base: https://api.clickup.com/api/v2 ; v3 base:
 *     https://api.clickup.com/api/v3 . OAuth tokens use the "Bearer "
 *     prefix (see clickup-proxy.js v2 history).
 *
 * -------------------------------------------------------------------------
 * VERSION HISTORY
 *   v1  2026-10-10  Created while adding smart routing (clickup-proxy.js
 *                    v8). Pulled json() out of clickup-proxy.js so the new
 *                    modules can share it, and added timeouts — before this
 *                    every upstream call could hang for the full Worker
 *                    wall-clock limit, which is what made some captures
 *                    "take a while to appear" with no feedback.
 * =========================================================================
 */

// Base URLs for ClickUp's two API generations. v2 covers tasks/lists/
// webhooks; v3 only Chat (see clickup-proxy.js handleChatLog()).
export const CLICKUP_V2 = 'https://api.clickup.com/api/v2';
export const CLICKUP_V3 = 'https://api.clickup.com/api/v3';

/**
 * UpstreamError
 * Thrown when ClickUp or Gemini answers with a non-2xx status (or the
 * call times out). Carries enough detail for the router to relay a
 * useful, consistent error to the app.
 * @property {string} service - 'clickup' | 'gemini'
 * @property {number} status  - HTTP status from upstream; 504 for our own
 *                              timeout, 502 for a network-level failure
 * @property {string} body    - upstream response text (truncated), for
 *                              debugging; never contains our credentials
 * @property {number} [retryAfter] - seconds, when upstream sent Retry-After
 */
export class UpstreamError extends Error {
  constructor(service, status, message, body = '', retryAfter) {
    super(message);
    this.name = 'UpstreamError';
    this.service = service;
    this.status = status;
    this.body = String(body || '').slice(0, 2000);
    if (retryAfter) this.retryAfter = retryAfter;
  }
}

/**
 * json
 * Builds a JSON Response, merging in whatever extra headers (normally
 * the CORS set) the caller passes.
 * @param {*} obj - JSON-serializable body
 * @param {number} [status=200]
 * @param {object} [headers={}]
 * @returns {Response}
 */
export function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' }
  });
}

/**
 * fetchWithTimeout
 * fetch() with an AbortController deadline.
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {number} [ms=15000] - give up after this many milliseconds
 * @returns {Promise<Response>}
 * @throws UpstreamError(status 504) on timeout, (status 502) on a
 *   network failure — both WITHOUT a real upstream status, which callers
 *   use to decide "unknown outcome" vs "rejected".
 */
export async function fetchWithTimeout(url, init = {}, ms = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    const timedOut = err && err.name === 'AbortError';
    const service = url.includes('clickup.com') ? 'clickup' : (url.includes('googleapis.com') ? 'gemini' : 'upstream');
    throw new UpstreamError(service, timedOut ? 504 : 502, timedOut ? `${service} timed out after ${ms}ms` : `${service} unreachable: ${err}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * clickup
 * One authenticated call to ClickUp's REST API.
 * @param {string} token - OAuth access token from KV
 * @param {string} path - path beginning with "/", relative to the base
 * @param {object} [opts]
 * @param {string} [opts.method='GET']
 * @param {object} [opts.body] - serialized as JSON when present
 * @param {'v2'|'v3'} [opts.version='v2']
 * @param {number} [opts.timeoutMs=15000]
 * @returns {Promise<object|null>} parsed JSON, or null for an empty body
 *   (DELETE endpoints answer 204/empty)
 * @throws UpstreamError on non-2xx — `.status` is ClickUp's own status,
 *   `.body` its error text (usually {"err": "...", "ECODE": "..."}).
 * Edge cases: 429 (rate limit, 100 req/min per token on most plans)
 *   surfaces Retry-After when ClickUp sends it so callers can back off.
 */
export async function clickup(token, path, opts = {}) {
  const { method = 'GET', body, version = 'v2', timeoutMs = 15000 } = opts;
  const base = version === 'v3' ? CLICKUP_V3 : CLICKUP_V2;
  const init = { method, headers: { Authorization: `Bearer ${token}` } };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetchWithTimeout(`${base}${path}`, init, timeoutMs);
  const text = await res.text();
  if (!res.ok) {
    const retryAfter = Number(res.headers.get('Retry-After')) || undefined;
    throw new UpstreamError('clickup', res.status, `ClickUp ${method} ${path} → ${res.status}`, text, retryAfter);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    // ClickUp occasionally answers DELETE with a non-JSON body; treat as
    // success-with-no-data rather than an error.
    return null;
  }
}

/**
 * readJsonBody
 * Parses a request's JSON body with a size cap, so a misbehaving client
 * can't make the Worker buffer something huge (and burn the free-plan
 * 10ms CPU budget parsing it).
 * @param {Request} request
 * @param {number} [maxBytes=65536]
 * @returns {Promise<object>} parsed object (never null)
 * @throws Error with `.status` 400 (bad JSON) or 413 (too large)
 */
export async function readJsonBody(request, maxBytes = 65536) {
  const text = await request.text();
  if (text.length > maxBytes) {
    const err = new Error(`Body too large (max ${maxBytes} bytes).`);
    err.status = 413;
    throw err;
  }
  try {
    const parsed = JSON.parse(text || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    const err = new Error('Invalid JSON body.');
    err.status = 400;
    throw err;
  }
}

/**
 * safeEqual
 * Constant-time string comparison — avoids leaking how many leading
 * characters of a guess were right through response timing. Used for
 * the device passcode and webhook signatures.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function safeEqual(a, b) {
  a = String(a || '');
  b = String(b || '');
  // Length difference is folded into the result rather than returning
  // early, so timing doesn't reveal the expected length either.
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * hmacSha256Hex
 * Hex-encoded HMAC-SHA256 — the scheme ClickUp uses for the
 * X-Signature header on webhook deliveries (hash of the raw body,
 * keyed with the secret returned when the webhook was created).
 * @param {string} secret
 * @param {string} message - the raw request body, byte-for-byte
 * @returns {Promise<string>} lowercase hex digest
 */
export async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * shortHash
 * Cheap, non-cryptographic 32-bit FNV-1a hash rendered as base36. Used
 * only to detect "has this task's text changed since we embedded it?"
 * so the sync can skip re-embedding unchanged tasks. Not for security.
 * @param {string} str
 * @returns {string}
 */
export function shortHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * clampText
 * Trims a string to a maximum number of UTF-8 bytes — KV metadata is
 * capped at 1024 bytes per key, and an emoji-heavy title counted in
 * characters could silently overflow that.
 * @param {string} str
 * @param {number} maxBytes
 * @returns {string}
 */
export function clampText(str, maxBytes) {
  str = String(str || '');
  const enc = new TextEncoder();
  if (enc.encode(str).length <= maxBytes) return str;
  // Walk back by code points until it fits, then mark the cut.
  const chars = Array.from(str);
  while (chars.length && enc.encode(chars.join('') + '…').length > maxBytes) chars.pop();
  return chars.join('') + '…';
}
