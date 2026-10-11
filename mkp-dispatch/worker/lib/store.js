/**
 * =========================================================================
 * lib/store.js — KV key names, routing settings, and small KV helpers
 * =========================================================================
 * PURPOSE
 *   One place that knows how smart-routing data is laid out in the
 *   existing TOKEN_STORE KV namespace, so the feature modules never
 *   hard-code key strings and can't collide with each other or with the
 *   OAuth token that already lives there.
 *
 * KV LAYOUT (all in the TOKEN_STORE namespace)
 *   access_token        OAuth token (pre-existing, written by the OAuth callback)
 *   routing:index       workspace index — spaces, lists, statuses, custom
 *                       field names (workspace-index.js syncHierarchy)
 *   routing:sync        sync bookkeeping — last runs, cursors, errors
 *   routing:webhook     {id, secret, endpoint, created_at} for the ClickUp
 *                       webhook that keeps the index fresh
 *   routing:settings    owner-tunable thresholds (see DEFAULT_SETTINGS)
 *   routing:feedback    corrections + per-list accuracy (audit-log.js)
 *   audit:<id>          one audit record per action (audit-log.js); id
 *                       sorts newest-first, records expire after 180 days
 *
 * ASSUMPTIONS / EXTERNAL DEPENDENCIES
 *   - env.TOKEN_STORE is bound (wrangler.toml [[kv_namespaces]]).
 *   - Free-plan KV allows 1,000 writes/day; everything here is written
 *     sparingly (settings on change, index on sync, ~1–2 writes per
 *     capture) to stay far under that.
 *   - KV is eventually consistent (a write can take up to ~60s to be seen
 *     from another location). Fine for this single-owner app; noted where
 *     it matters.
 *
 * -------------------------------------------------------------------------
 * VERSION HISTORY
 *   v1  2026-10-10  Initial version for smart routing (incl. putJSONPaced,
 *                    added after review found same-key writes <1s apart).
 * =========================================================================
 */

// Key names — see the KV LAYOUT table above.
export const KEYS = {
  token: 'access_token',
  index: 'routing:index',
  sync: 'routing:sync',
  webhook: 'routing:webhook',
  settings: 'routing:settings',
  feedback: 'routing:feedback',
  auditPrefix: 'audit:'
};

// Defaults for owner-tunable behavior. Values are probabilities 0–1.
//   auto_enabled    master switch for "file it without asking"
//   auto_threshold  calibrated confidence needed to auto-file (0.85 =
//                   "Balanced" in the app; 0.92 Cautious; 0.75 Bold)
//   dup_threshold   vector similarity at which a MANUAL send gets the
//                   "looks like an existing task" prompt (no LLM on that
//                   path, so this is deliberately conservative)
export const DEFAULT_SETTINGS = {
  auto_enabled: true,
  auto_threshold: 0.85,
  dup_threshold: 0.9
};

/**
 * getJSON — KV read with a fallback for missing/corrupt values.
 * @param {object} env
 * @param {string} key
 * @param {*} fallback
 * @returns {Promise<*>}
 */
export async function getJSON(env, key, fallback) {
  try {
    const v = await env.TOKEN_STORE.get(key, 'json');
    return v == null ? fallback : v;
  } catch (e) {
    // Corrupt JSON in KV shouldn't take routing down — start fresh.
    return fallback;
  }
}

/**
 * putJSON — KV write of a JSON value.
 * @param {object} env
 * @param {string} key
 * @param {*} value
 * @param {object} [opts] - passed through (expirationTtl, metadata)
 * @returns {Promise<void>}
 */
export function putJSON(env, key, value, opts) {
  return env.TOKEN_STORE.put(key, JSON.stringify(value), opts);
}

// Last write time per key within this isolate — see putJSONPaced().
const lastWriteAt = new Map();

/**
 * putJSONPaced
 * Like putJSON, but waits so the same key is never written twice within
 * ~1.1s from this isolate. Workers KV allows only one write per second
 * per key; a faster second write fails (429). Sync steps write
 * routing:sync before AND after their work, often well under a second
 * apart, which is what this protects. The wait is wall-clock time
 * (setTimeout), not CPU time, so it doesn't count against the CPU cap.
 * @param {object} env
 * @param {string} key
 * @param {*} value
 * @param {object} [opts]
 * @returns {Promise<void>}
 */
export async function putJSONPaced(env, key, value, opts) {
  const last = lastWriteAt.get(key) || 0;
  const wait = 1100 - (Date.now() - last);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastWriteAt.set(key, Date.now());
  return putJSON(env, key, value, opts);
}

/**
 * getSettings — saved settings merged over DEFAULT_SETTINGS.
 * @param {object} env
 * @returns {Promise<typeof DEFAULT_SETTINGS>}
 */
export async function getSettings(env) {
  const saved = await getJSON(env, KEYS.settings, {});
  return { ...DEFAULT_SETTINGS, ...saved };
}

/**
 * saveSettings
 * Validates and stores a partial settings update. Out-of-range or
 * wrong-typed values are ignored rather than rejected, so an old app
 * version can't brick routing by sending something unexpected.
 * @param {object} env
 * @param {object} patch
 * @returns {Promise<typeof DEFAULT_SETTINGS>} the settings now in effect
 */
export async function saveSettings(env, patch = {}) {
  const current = await getSettings(env);
  const next = { ...current };
  if (typeof patch.auto_enabled === 'boolean') next.auto_enabled = patch.auto_enabled;
  // Thresholds are clamped to sane bands: auto-filing below 0.6 would
  // be mostly guesses; duplicate prompts below 0.8 would nag constantly.
  if (isNum(patch.auto_threshold)) next.auto_threshold = clamp(patch.auto_threshold, 0.6, 0.99);
  if (isNum(patch.dup_threshold)) next.dup_threshold = clamp(patch.dup_threshold, 0.8, 0.99);
  await putJSON(env, KEYS.settings, next);
  return next;
}

/**
 * privateListIds
 * Lists that must never be sent to Gemini — not as routing destinations,
 * not as indexed tasks. Comes from wrangler.toml PRIVATE_LIST_IDS
 * (comma-separated). Ships with the MKC Client Accounts list, whose task
 * descriptions can contain passwords.
 * @param {object} env
 * @returns {Set<string>}
 */
export function privateListIds(env) {
  return new Set(String(env.PRIVATE_LIST_IDS || '').split(',').map(s => s.trim()).filter(Boolean));
}

/**
 * vectorsAvailable
 * @param {object} env
 * @returns {boolean} true when the Vectorize index binding exists — the
 *   duplicate-detection features quietly switch off without it.
 */
export function vectorsAvailable(env) {
  return Boolean(env.TASK_VECTORS && typeof env.TASK_VECTORS.query === 'function');
}

/** isNum — finite number check. */
function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }
/** clamp — bounds a number to [lo, hi]. */
export function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
