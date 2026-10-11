/**
 * =========================================================================
 * lib/routing-engine.js — placement, confidence, duplicates, commit
 * =========================================================================
 * PURPOSE
 *   The "intelligent routing" brain. For one capture it:
 *     1. Builds a CATALOG of every list the capture could go to (from the
 *        synced workspace index, falling back to the app's config.js
 *        destinations if the index hasn't been built yet).
 *     2. Finds semantically similar OPEN tasks (Gemini embeddings +
 *        Vectorize) as duplicate candidates.
 *     3. Asks Gemini for placement, title, due/start date, priority and a
 *        duplicate verdict as strict JSON (structured output).
 *     4. CALIBRATES the model's self-reported confidence with evidence it
 *        can't see by itself — past accuracy for that list, a close
 *        runner-up, where the similar tasks live — and decides whether
 *        it's safe to auto-file.
 *   Then, once the app (or the owner) decides, commitCapture() performs
 *   the ClickUp action, writes the audit record, and feeds the outcome
 *   back into the learning store.
 *
 * DATA FLOW
 *   POST /route/suggest    → suggestPlacement()  (read-only: no ClickUp
 *                            writes, no KV writes)
 *   POST /route/commit     → commitCapture()     (ClickUp write + audit +
 *                            feedback)
 *   POST /route/duplicates → findDuplicates()    (manual-send path; vector
 *                            search only, no LLM, fast)
 *   POST /audit/record     → recordManual()      (manual sends, for one
 *                            complete Activity history + undo)
 *
 * ASSUMPTIONS / EXTERNAL DEPENDENCIES
 *   - gemini.js (GEMINI_API_KEY), workspace-index.js (index + vectors),
 *     audit-log.js, store.js. PRIVATE_LIST_IDS lists never appear in the
 *     catalog or as duplicate candidates.
 *   - Confidence numbers are a ranking signal, not a probability you can
 *     bank on: LLM self-reports are optimistic, which is why the
 *     calibration step exists and why the auto-file threshold defaults
 *     to a conservative 0.85.
 *
 * -------------------------------------------------------------------------
 * VERSION HISTORY
 *   v1  2026-10-10  Initial version for smart routing. Includes pre-deploy
 *                    review fixes: the audit write after a successful
 *                    ClickUp action can no longer fail the request
 *                    (safeRecord — a failure there used to invite a retry
 *                    that created the task twice); records carry `origin`
 *                    ('worker' | 'client') so undo can verify
 *                    app-reported ids before deleting.
 * =========================================================================
 */

import { clickup, clampText } from './http.js';
import { KEYS, getJSON, getSettings, privateListIds, vectorsAvailable, clamp } from './store.js';
import { generateJSON, embedTexts, geminiConfigured, modelName } from './gemini.js';
import { getIndex, searchSimilar, embeddingText, indexTaskItems } from './workspace-index.js';
import { recordAction, recordFeedback, getFeedback, statusError } from './audit-log.js';

// Minimum vector similarity for a task to be shown to Gemini as a
// possible duplicate. Below this the matches are usually same-topic,
// not same-work, and only add prompt noise.
const DUP_CANDIDATE_MIN = 0.72;
// Largest catalog sent with an enum constraint on list_id (guarantees a
// valid id). Bigger catalogs drop the enum (schema size limits) and rely
// on post-validation instead.
const ENUM_MAX = 250;
// Hard cap on catalog size so the prompt stays small and fast.
const CATALOG_MAX = 300;
// Task payload keys the app may set through /route/commit — anything
// else is dropped, so this route can't be used to set arbitrary fields.
const ALLOWED_TASK_KEYS = new Set(['name', 'description', 'priority', 'due_date', 'due_date_time', 'start_date', 'start_date_time', 'tags', 'assignees', 'parent']);

// The standing instructions for Gemini. Kept here (not in the app) so
// routing behavior can be tuned with a Worker deploy alone.
const SYSTEM_PROMPT = `You are the routing brain inside Dispatch It, a quick-capture app that files the owner's notes, tasks and ideas into their ClickUp workspace.

For each capture, decide:
1. list_id — the single best destination list. Copy an id exactly from the CATALOG. Never invent one.
2. confidence — how sure you are that the owner would file it there themselves (0 to 1). Calibrate honestly:
   - 0.90 or higher only when the capture clearly matches one list's purpose and no other list is a reasonable home.
   - 0.60 to 0.85 when one list fits best but another is plausible.
   - below 0.50 when you are mostly guessing.
3. alternatives — up to 3 other plausible lists with their own confidence (empty array if none).
4. title — a short task title (70 characters max) in the owner's own words. Fix obvious typos; keep names, acronyms and numbers exactly; never add facts.
5. due_date and start_date — YYYY-MM-DD only when the capture states or clearly implies one ("by Friday", "on the 15th", "end of month"). Resolve relative dates against NOW. "Next week" with no day means start_date = that coming Monday and no due_date. If nothing is implied return an empty string. Never guess a deadline.
6. priority — "urgent", "high", "normal" or "low" only when the wording signals it (ASAP, urgent, whenever, no rush); otherwise "none".
7. duplicate_task_id — set ONLY if one of POSSIBLE DUPLICATES is the same piece of work (same action on the same subject), so this capture should be added to that task as an update instead of creating a new task. Sharing a topic is not enough. Otherwise return an empty string. duplicate_confidence is 0 to 1.
8. reason — one short, plain sentence the owner will read explaining the placement.

How to choose:
- Lists with an "owner label" are the owner's usual destinations; prefer them when they fit.
- If a HINT is given, stay inside that business unless the capture obviously belongs elsewhere.
- OWNER CORRECTIONS show where this owner actually files things. When a new capture resembles a corrected one, follow the correction.
- Ideas ("what if", "idea:") belong in idea / light bulb lists; actionable items in task lists; money owed or paid in finance lists; content ideas in content lists.
- Never pick a list just because it has many tasks.`;

/**
 * buildCatalog
 * Assembles the destination lists Gemini may choose from.
 * @param {object|null} index - structure index (workspace-index.js)
 * @param {Array<{list_id, label, entity}>} known - the app's configured
 *   destinations (config.js), used as "owner labels" and as the fallback
 *   catalog before the first sync
 * @param {Set<string>} excluded - ids never offered (private lists plus
 *   any the app excludes, e.g. non-task destinations)
 * @returns {{entries: object[], source: 'index'|'config'}}
 */
function buildCatalog(index, known, excluded) {
  const knownById = new Map();
  for (const k of known) {
    const id = String(k.list_id || '');
    if (/^\d+$/.test(id)) knownById.set(id, k);
  }
  const entries = [];
  const seen = new Set();
  const lists = (index && index.lists) || [];

  for (const l of lists) {
    if (l.private || excluded.has(l.id)) continue;
    const k = knownById.get(l.id);
    entries.push({
      id: l.id,
      path: l.path,
      space: l.space,
      label: k ? `${k.entity} → ${k.label}` : null,
      content: l.content || '',
      statuses: l.statuses || [],
      fields: (l.fields || []).map(f => f.n).slice(0, 10)
    });
    seen.add(l.id);
  }
  // Configured destinations missing from the index (index not built
  // yet, stale, or truncated) are still offered, labeled from config.
  for (const [id, k] of knownById) {
    if (seen.has(id) || excluded.has(id)) continue;
    entries.push({ id, path: `${k.entity} › ${k.label}`, space: k.entity, label: `${k.entity} → ${k.label}`, content: '', statuses: [], fields: [] });
  }
  // Labeled lists first so a cap never drops the owner's usual places.
  entries.sort((a, b) => (b.label ? 1 : 0) - (a.label ? 1 : 0));
  return { entries: entries.slice(0, CATALOG_MAX), source: lists.length ? 'index' : 'config' };
}

/**
 * buildSchema — Gemini responseSchema (OpenAPI subset, upper-case types).
 * @param {string[]} ids - catalog ids, used as an enum when small enough
 * @returns {object}
 */
function buildSchema(ids) {
  const listId = { type: 'STRING', description: 'Destination list id copied exactly from the CATALOG.' };
  if (ids.length && ids.length <= ENUM_MAX) listId.enum = ids;
  return {
    type: 'OBJECT',
    properties: {
      list_id: listId,
      confidence: { type: 'NUMBER' },
      alternatives: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { list_id: { type: 'STRING' }, confidence: { type: 'NUMBER' } },
          required: ['list_id', 'confidence']
        }
      },
      title: { type: 'STRING' },
      due_date: { type: 'STRING', description: 'YYYY-MM-DD or empty string' },
      start_date: { type: 'STRING', description: 'YYYY-MM-DD or empty string' },
      priority: { type: 'STRING', enum: ['none', 'urgent', 'high', 'normal', 'low'] },
      date_reason: { type: 'STRING' },
      duplicate_task_id: { type: 'STRING' },
      duplicate_confidence: { type: 'NUMBER' },
      duplicate_reason: { type: 'STRING' },
      reason: { type: 'STRING' }
    },
    required: ['list_id', 'confidence', 'alternatives', 'title', 'due_date', 'start_date', 'priority', 'duplicate_task_id', 'duplicate_confidence', 'reason'],
    propertyOrdering: ['list_id', 'confidence', 'alternatives', 'title', 'due_date', 'start_date', 'priority', 'date_reason', 'duplicate_task_id', 'duplicate_confidence', 'duplicate_reason', 'reason']
  };
}

/**
 * buildPrompt — the per-capture prompt text.
 * @param {object} p
 * @returns {string}
 */
function buildPrompt({ capture, now, hint, catalog, corrections, confirmations, candidates, pathById }) {
  const lines = [];
  lines.push(`NOW: ${now.today} (${now.weekday}), time zone ${now.tz}`);
  lines.push('');
  lines.push('CAPTURE');
  if (capture.title) lines.push(`Title: ${capture.title}`);
  lines.push(`Text: ${capture.text || '(none)'}`);
  if (capture.attachments) lines.push(`Attachments: ${capture.attachments} file(s)`);
  if (hint) lines.push(`HINT: the owner says this is for "${hint}".`);
  lines.push('');
  lines.push('CATALOG (id | path | owner label | about | statuses | fields)');
  for (const c of catalog) {
    const parts = [c.id, c.path];
    parts.push(c.label ? `owner label: ${c.label}` : '-');
    parts.push(c.content ? `about: ${c.content}` : '-');
    parts.push(c.statuses.length ? `statuses: ${c.statuses.join('/')}` : '-');
    parts.push(c.fields.length ? `fields: ${c.fields.join(', ')}` : '-');
    lines.push(parts.join(' | '));
  }
  if (corrections.length) {
    lines.push('');
    lines.push('OWNER CORRECTIONS (most recent first)');
    for (const c of corrections) {
      lines.push(c.to
        ? `- "${c.text}" → you suggested ${c.from}; the owner chose ${c.to}`
        : `- "${c.text}" → you filed it in ${c.from}; the owner undid it`);
    }
  }
  if (confirmations.length) {
    lines.push('');
    lines.push('CONFIRMED PLACEMENTS');
    for (const c of confirmations) lines.push(`- "${c.text}" → ${c.path}`);
  }
  lines.push('');
  if (candidates.length) {
    lines.push('POSSIBLE DUPLICATES (open tasks; similarity 0-1 is a hint, not a verdict)');
    for (const d of candidates) {
      lines.push(`- id=${d.task_id} | "${d.name}" | in ${pathById.get(d.list_id) || 'list ' + d.list_id} | status: ${d.status || '?'} | similarity ${d.similarity}`);
    }
  } else {
    lines.push('POSSIBLE DUPLICATES: none found');
  }
  return lines.join('\n');
}

/**
 * validDate
 * Accepts only real YYYY-MM-DD dates within a sane window (yesterday …
 * 3 years out) — guards against hallucinated or malformed dates.
 * @param {string} s
 * @param {string} today - YYYY-MM-DD
 * @returns {string} the date, or '' if rejected
 */
function validDate(s, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return '';
  const d = Date.parse(`${s}T12:00:00Z`);
  const t = Date.parse(`${today}T12:00:00Z`);
  if (!Number.isFinite(d) || !Number.isFinite(t)) return '';
  const day = 86400000;
  return d >= t - day && d <= t + 3 * 366 * day ? s : '';
}

/**
 * readCapture — validates and normalizes the capture part of a request.
 * @param {object} body
 * @returns {{title: string, text: string, attachments: number}}
 * @throws statusError(400) when there's nothing to route
 */
function readCapture(body) {
  const title = clampText(String(body.title || '').trim(), 300);
  const text = String(body.text || '').trim().slice(0, 4000);
  if (!title && !text) throw statusError(400, 'Nothing to route — add some text.');
  return { title, text, attachments: Math.max(0, Math.min(20, Number(body.attachments) || 0)) };
}

/**
 * readNow — the owner's local date context, as sent by the app.
 * Falls back to UTC when missing/malformed.
 * @param {object} body
 * @returns {{today: string, weekday: string, tz: string}}
 */
function readNow(body) {
  const fallback = new Date().toISOString().slice(0, 10);
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(body.today || '')) ? body.today : fallback;
  const weekday = /^[A-Za-z]{3,9}$/.test(String(body.weekday || '')) ? body.weekday : new Date(`${today}T12:00:00Z`).toUTCString().slice(0, 3);
  const tz = /^[A-Za-z_\/+\-0-9]{1,64}$/.test(String(body.tz || '')) ? body.tz : 'UTC';
  return { today, weekday, tz };
}

/**
 * suggestPlacement
 * Main entry for POST /route/suggest. Read-only.
 * @param {object} env
 * @param {object} body - { title?, text, hint?, attachments?, today, weekday,
 *   tz, known: [{list_id, label, entity}], exclude: [list_id] }
 * @returns {Promise<object>} { suggestion: {...} } — see the return
 *   statement for the full shape
 * @throws statusError(400/409) for bad input / empty catalog;
 *   UpstreamError from Gemini (router maps it to a friendly message)
 */
export async function suggestPlacement(env, body) {
  const capture = readCapture(body);
  const now = readNow(body);
  const hint = body.hint ? clampText(String(body.hint), 60) : null;
  const known = Array.isArray(body.known) ? body.known.slice(0, 200) : [];
  const excluded = privateListIds(env);
  for (const id of (Array.isArray(body.exclude) ? body.exclude : [])) excluded.add(String(id));

  const [settings, index, feedback] = await Promise.all([getSettings(env), getIndex(env), getFeedback(env)]);
  const { entries: catalog, source } = buildCatalog(index, known, excluded);
  if (!catalog.length) throw statusError(409, 'No destinations available to route to yet.');
  const pathById = new Map(catalog.map(c => [c.id, c.path]));
  // Paths for lists outside the catalog too (e.g. a duplicate living in a
  // list the app excluded), for display only.
  for (const l of ((index && index.lists) || [])) if (!pathById.has(l.id) && !l.private) pathById.set(l.id, l.path);

  // Semantic neighbors → duplicate candidates. Any failure here simply
  // means "no duplicate check this time", never a failed capture.
  let similar = [];
  let dupCheck = vectorsAvailable(env) ? 'ok' : 'unavailable';
  if (vectorsAvailable(env)) {
    try {
      const [vec] = await embedTexts(env, [embeddingText(capture.title || capture.text.slice(0, 120), capture.text)]);
      // Private lists are never indexed, but filter defensively anyway.
      const hidden = privateListIds(env);
      similar = (await searchSimilar(env, vec, 6)).filter(s => !hidden.has(s.list_id));
    } catch (e) {
      dupCheck = 'failed';
    }
  }
  const candidates = similar.filter(s => s.similarity >= DUP_CANDIDATE_MIN).slice(0, 5);

  const prompt = buildPrompt({
    capture, now, hint, catalog,
    corrections: feedback.corrections.slice(0, 12),
    confirmations: feedback.confirmations.slice(0, 6),
    candidates, pathById
  });
  const { data: raw, model } = await generateJSON(env, {
    system: SYSTEM_PROMPT,
    prompt,
    schema: buildSchema(catalog.map(c => c.id))
  });

  return {
    suggestion: calibrate(raw, { catalog, pathById, candidates, similar, feedback, settings, now, capture, model, source, index, dupCheck })
  };
}

/**
 * calibrate
 * Turns Gemini's raw answer into the final suggestion: validates ids and
 * dates, adjusts confidence with evidence the model doesn't have, and
 * decides auto vs. ask. Every adjustment is returned in `factors` so the
 * app can show WHY a number is what it is.
 * @param {object} raw - Gemini's JSON
 * @param {object} ctx - catalog, candidates, feedback, settings, ...
 * @returns {object} suggestion
 */
function calibrate(raw, ctx) {
  const { catalog, pathById, candidates, similar, feedback, settings, now, capture, model, source, index, dupCheck } = ctx;
  const ids = new Set(catalog.map(c => c.id));
  const factors = [];
  let listId = String(raw.list_id || '');
  let conf = clamp(Number(raw.confidence) || 0, 0, 1);
  factors.push({ label: 'Gemini’s own confidence', value: round2(conf) });

  let alternatives = (Array.isArray(raw.alternatives) ? raw.alternatives : [])
    .map(a => ({ list_id: String(a.list_id || ''), confidence: clamp(Number(a.confidence) || 0, 0, 1) }))
    .filter(a => ids.has(a.list_id) && a.list_id !== listId)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);

  // 1. Invalid pick (not in catalog) → promote the best valid
  //    alternative, but cap it well below any auto-file threshold.
  if (!ids.has(listId)) {
    factors.push({ label: 'Picked a list outside the catalog', delta: round2(-conf) });
    if (alternatives.length) {
      listId = alternatives[0].list_id;
      conf = Math.min(alternatives[0].confidence, 0.5);
      alternatives = alternatives.slice(1);
    } else {
      listId = null;
      conf = 0;
    }
  }

  if (listId) {
    // 2. A close runner-up means genuine ambiguity.
    const second = alternatives[0] ? alternatives[0].confidence : 0;
    if (second && conf - second < 0.15) {
      conf -= 0.1;
      factors.push({ label: 'Close second choice', delta: -0.1 });
    }
    // 3. Track record for this list (only once there's enough history).
    const st = feedback.stats[listId];
    if (st && st.n >= 3) {
      const acc = st.a / st.n;
      const adjusted = conf * (0.7 + 0.3 * acc);
      const d = round2(adjusted - conf);
      if (d <= -0.01) factors.push({ label: `Past accuracy for this list: ${Math.round(acc * 100)}%`, delta: d });
      conf = adjusted;
    }
    // 4. Where do the most similar open tasks live?
    const near = similar.filter(s => s.similarity >= 0.75);
    if (near.length >= 2) {
      const same = near.filter(s => s.list_id === listId).length;
      if (same >= 2) { conf += 0.05; factors.push({ label: 'Similar tasks already live here', delta: 0.05 }); }
      else if (same === 0) { conf -= 0.08; factors.push({ label: 'Similar tasks live in other lists', delta: -0.08 }); }
    }
  }
  // Never present certainty; 0.97 leaves visible room for doubt.
  conf = clamp(conf, 0, 0.97);

  // Duplicate verdict — only trusted when it names one of the candidates
  // we actually supplied (no invented task ids).
  let duplicate = null;
  const dupId = String(raw.duplicate_task_id || '');
  const dupConf = clamp(Number(raw.duplicate_confidence) || 0, 0, 1);
  const cand = candidates.find(c => c.task_id === dupId);
  if (cand && dupConf >= 0.6) {
    duplicate = {
      ...cand,
      list_path: pathById.get(cand.list_id) || '',
      confidence: round2(dupConf),
      reason: clampText(String(raw.duplicate_reason || ''), 240)
    };
  }

  const priority = ['urgent', 'high', 'normal', 'low'].includes(raw.priority) ? raw.priority : null;
  const cleanTitle = clampText(String(raw.title || '').trim(), 200) || fallbackTitle(capture);
  const entry = listId ? catalog.find(c => c.id === listId) : null;
  const auto = Boolean(settings.auto_enabled && listId && conf >= settings.auto_threshold && !duplicate);

  return {
    list_id: listId,
    list_path: entry ? entry.path : null,
    owner_label: entry ? entry.label : null,
    confidence: round2(conf),
    raw_confidence: round2(clamp(Number(raw.confidence) || 0, 0, 1)),
    factors,
    reason: clampText(String(raw.reason || ''), 300),
    alternatives: alternatives.map(a => ({ ...a, confidence: round2(a.confidence), list_path: pathById.get(a.list_id) || a.list_id })),
    title: cleanTitle,
    due_date: validDate(raw.due_date, now.today),
    start_date: validDate(raw.start_date, now.today),
    date_reason: clampText(String(raw.date_reason || ''), 200),
    priority,
    duplicate,
    auto,
    threshold: settings.auto_threshold,
    model,
    catalog_source: source,
    catalog_size: catalog.length,
    index_synced_at: (index && index.synced_at) || null,
    // 'ok' | 'unavailable' (no Vectorize binding) | 'failed' (embedding
    // or query errored) — lets the app say "duplicate check skipped".
    duplicate_check: dupCheck
  };
}

/** fallbackTitle — first line of the capture, trimmed. */
function fallbackTitle(capture) {
  return clampText((capture.title || capture.text.split('\n')[0] || 'Untitled capture').trim(), 120);
}

/** round2 — two-decimal rounding for display. */
function round2(n) { return Math.round(n * 100) / 100; }

/**
 * findDuplicates
 * POST /route/duplicates — the manual-send path's quick check. Pure
 * vector search (one embedding call + one query, no LLM), compared
 * against the owner's dup_threshold setting.
 * @param {object} env
 * @param {object} body - { title, text }
 * @returns {Promise<{available: boolean, threshold?: number, matches: object[]}>}
 */
export async function findDuplicates(env, body) {
  if (!vectorsAvailable(env) || !geminiConfigured(env)) return { available: false, matches: [] };
  const capture = readCapture(body);
  const [settings, index] = await Promise.all([getSettings(env), getIndex(env)]);
  const hidden = privateListIds(env);
  const pathById = new Map(((index && index.lists) || []).map(l => [l.id, l.path]));
  const [vec] = await embedTexts(env, [embeddingText(capture.title, capture.text)]);
  const similar = await searchSimilar(env, vec, 5);
  const matches = similar
    .filter(s => s.similarity >= settings.dup_threshold && !hidden.has(s.list_id))
    .map(s => ({ ...s, list_path: pathById.get(s.list_id) || '' }));
  return { available: true, threshold: settings.dup_threshold, matches };
}

/**
 * sanitizeTaskPayload
 * Keeps only ALLOWED_TASK_KEYS and enforces basic types/sizes.
 * @param {object} payload - built by the app (clickup.js buildTaskPayload)
 * @returns {object}
 * @throws statusError(400) when there's no task name
 */
function sanitizeTaskPayload(payload) {
  const out = {};
  for (const [k, v] of Object.entries(payload || {})) {
    if (ALLOWED_TASK_KEYS.has(k) && v !== undefined && v !== null) out[k] = v;
  }
  out.name = clampText(String(out.name || '').trim(), 1000);
  if (!out.name) throw statusError(400, 'Task needs a name.');
  if (typeof out.description === 'string') out.description = out.description.slice(0, 20000);
  return out;
}

/**
 * commitCapture
 * POST /route/commit — performs the decided action in ClickUp, then
 * records it (audit) and learns from it (feedback).
 * @param {object} env
 * @param {string} token
 * @param {ExecutionContext} ctx - for background indexing/feedback writes
 * @param {object} body
 * @param {{mode: 'create'|'update', list_id?: string, task_id?: string}} body.decision
 * @param {object} [body.payload] - ClickUp task payload (create mode)
 * @param {string} [body.comment_text] - comment body (update mode)
 * @param {'auto'|'confirmed'|'manual'} body.source
 * @param {object} [body.suggestion] - what /route/suggest returned (for
 *   audit + feedback); omitted on a pure manual pick
 * @param {object} [body.capture] - {title, text} for the audit record and
 *   immediate vector indexing
 * @param {number} [body.attachments_count] - files the app will upload
 *   afterwards (recorded so an undo can be honest about them)
 * @returns {Promise<object>} { audit_id, task: {id, url, name}, comment_id?, list_path }
 * @throws statusError(400) for invalid ids/inputs; UpstreamError if
 *   ClickUp rejects the write (nothing is audited in that case)
 */
export async function commitCapture(env, token, ctx, body) {
  const decision = body.decision || {};
  const source = ['auto', 'confirmed', 'manual'].includes(body.source) ? body.source : 'manual';
  const suggestion = body.suggestion && typeof body.suggestion === 'object' ? body.suggestion : null;
  const capture = body.capture || {};
  const attachments = Math.max(0, Math.min(50, Number(body.attachments_count) || 0));
  const index = await getIndex(env);
  const pathOf = (id) => {
    const l = ((index && index.lists) || []).find(x => x.id === String(id));
    return l ? l.path : null;
  };
  const common = {
    source,
    title: clampText(capture.title || (body.payload && body.payload.name) || '', 300),
    confidence: suggestion && typeof suggestion.confidence === 'number' ? suggestion.confidence : null,
    raw_confidence: suggestion && typeof suggestion.raw_confidence === 'number' ? suggestion.raw_confidence : null,
    factors: suggestion && Array.isArray(suggestion.factors) ? suggestion.factors.slice(0, 8) : null,
    suggested_list_id: suggestion && suggestion.list_id ? String(suggestion.list_id) : null,
    suggested_path: suggestion && suggestion.list_path ? clampText(suggestion.list_path, 200) : null,
    model: suggestion ? (suggestion.model || modelName(env)) : null
  };

  // ---- "Update this" — comment on the existing task instead of cloning.
  if (decision.mode === 'update') {
    const taskId = String(decision.task_id || '');
    if (!/^[A-Za-z0-9]+$/.test(taskId)) throw statusError(400, 'Missing or invalid task id to update.');
    const text = String(body.comment_text || '').trim().slice(0, 8000);
    if (!text) throw statusError(400, 'Nothing to add to the existing task.');
    const res = await clickup(token, `/task/${taskId}/comment`, { method: 'POST', body: { comment_text: text }, timeoutMs: 25000 });
    const dup = (suggestion && suggestion.duplicate) || {};
    const id = await safeRecord(env, {
      ...common,
      origin: 'worker',
      kind: 'add_comment',
      task_id: taskId,
      task_url: `https://app.clickup.com/t/${taskId}`,
      comment_id: res && res.id != null ? String(res.id) : null,
      list_id: dup.list_id ? String(dup.list_id) : null,
      list_path: dup.list_path || pathOf(dup.list_id) || null,
      duplicate_of: { task_id: taskId, name: clampText(dup.name || '', 200), similarity: dup.similarity || null },
      attachments
    });
    return { audit_id: id, task: { id: taskId, url: `https://app.clickup.com/t/${taskId}`, name: dup.name || '' }, comment_id: res && res.id, list_path: dup.list_path || null };
  }

  // ---- Create a new task in the chosen list.
  const listId = String(decision.list_id || '');
  if (!/^\d+$/.test(listId)) throw statusError(400, 'Missing or invalid destination list.');
  if (privateListIds(env).has(listId) && source !== 'manual') throw statusError(400, 'That list is private and can’t be used by smart routing.');
  const payload = sanitizeTaskPayload(body.payload);
  const task = await clickup(token, `/list/${listId}/task`, { method: 'POST', body: payload, timeoutMs: 30000 });
  const listPath = pathOf(listId) || (suggestion && suggestion.list_id === listId ? suggestion.list_path : null) || (body.list_label ? clampText(body.list_label, 200) : null);

  const id = await safeRecord(env, {
    ...common,
    origin: 'worker',
    kind: 'create_task',
    task_id: task && task.id,
    task_url: (task && task.url) || (task && task.id ? `https://app.clickup.com/t/${task.id}` : null),
    list_id: listId,
    list_path: listPath,
    attachments
  });

  // Learning + indexing happen after the response — the owner shouldn't
  // wait on them, and a failure in either doesn't affect the capture.
  const background = [];
  if (common.suggested_list_id && source !== 'manual') {
    background.push(recordFeedback(env, {
      kind: 'decision',
      text: common.title,
      suggested_list_id: common.suggested_list_id,
      suggested_path: common.suggested_path,
      chosen_list_id: listId,
      chosen_path: listPath,
      source
    }));
  }
  background.push(indexIfNoWebhook(env, {
    id: task && task.id, name: (task && task.name) || payload.name, text: capture.text || '',
    list_id: listId, space_id: String((task && task.space && task.space.id) || ''), status: (task && task.status && task.status.status) || ''
  }));
  ctx.waitUntil(Promise.allSettled(background));

  return { audit_id: id, task: { id: task && task.id, url: task && task.url, name: task && task.name }, list_path: listPath };
}

/**
 * safeRecord
 * Writes the audit record for an action that has ALREADY happened in
 * ClickUp. A failure here (e.g. KV's daily write cap) must not turn into
 * an error response — the app would offer "try again" and create the
 * task a second time. Returns null instead; the capture still succeeds,
 * it just can't be undone from Activity.
 * @param {object} env
 * @param {object} rec - see audit-log.js recordAction()
 * @returns {Promise<string|null>} audit id, or null if it couldn't be saved
 */
async function safeRecord(env, rec) {
  try {
    const { id } = await recordAction(env, rec);
    return id;
  } catch (e) {
    return null;
  }
}

/**
 * indexIfNoWebhook
 * Adds a just-created task to the vector index right away — but only
 * when no webhook is registered (with one, ClickUp's taskCreated event
 * indexes it moments later; doing both would embed it twice).
 * @param {object} env
 * @param {object} item - compact task item
 * @returns {Promise<void>}
 */
async function indexIfNoWebhook(env, item) {
  if (!item.id || !vectorsAvailable(env) || !geminiConfigured(env)) return;
  const hook = await getJSON(env, KEYS.webhook, null);
  if (hook) return;
  await indexTaskItems(env, [{ ...item, closed: false, parent: false }]).catch(() => {});
}

/**
 * recordManual
 * POST /audit/record — logs a send the owner routed by hand (normal
 * entity → type → form flow), so Activity shows everything and any send
 * can be undone from one place.
 * @param {object} env
 * @param {ExecutionContext} ctx
 * @param {object} body - { kind, task_id, task_url, comment_id?, list_id?,
 *   list_path?, title, text?, sensitive?, attachments? }
 * @returns {Promise<{audit_id: string}>}
 * Privacy: when `sensitive` is true (Add to Accounts → Direct to List) or
 *   the list is private, nothing is embedded — only the title is logged.
 */
export async function recordManual(env, ctx, body) {
  const kind = body.kind === 'add_comment' ? 'add_comment' : 'create_task';
  const taskId = String(body.task_id || '');
  if (!/^[A-Za-z0-9]+$/.test(taskId)) throw statusError(400, 'Missing task id.');
  const commentId = body.comment_id != null ? String(body.comment_id) : null;
  if (kind === 'add_comment' && !/^\d+$/.test(commentId || '')) throw statusError(400, 'Missing comment id.');
  const listId = /^\d+$/.test(String(body.list_id || '')) ? String(body.list_id) : null;
  const url = String(body.task_url || '');

  const { id } = await recordAction(env, {
    kind,
    source: 'manual',
    // 'client' = the app reported this action; undo verifies the task /
    // comment really is that fresh capture before deleting anything
    // (audit-log.js undoAction), since the id came from the device.
    origin: 'client',
    title: clampText(String(body.title || ''), 300),
    task_id: taskId,
    task_url: /^https:\/\/app\.clickup\.com\//.test(url) ? url : `https://app.clickup.com/t/${taskId}`,
    comment_id: commentId,
    list_id: listId,
    list_path: clampText(String(body.list_path || ''), 200) || null,
    attachments: Math.max(0, Math.min(50, Number(body.attachments) || 0))
  });

  const hidden = privateListIds(env);
  if (kind === 'create_task' && !body.sensitive && listId && !hidden.has(listId)) {
    ctx.waitUntil(indexIfNoWebhook(env, {
      id: taskId, name: String(body.title || ''), text: String(body.text || '').slice(0, 400),
      list_id: listId, space_id: '', status: ''
    }));
  }
  return { audit_id: id };
}
