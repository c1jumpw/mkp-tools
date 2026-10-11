/**
 * =========================================================================
 * lib/workspace-index.js — keeps an up-to-date map of the ClickUp workspace
 * =========================================================================
 * PURPOSE
 *   "Workspace awareness" for smart routing. Maintains two things:
 *     1. The STRUCTURE index (KV routing:index): every Space → Folder →
 *        List, each list's statuses (its workflow) and custom field names.
 *        Gemini reads this as the catalog of places a capture can go, so
 *        a list created in ClickUp tomorrow becomes a routing option
 *        without anyone editing config.js.
 *     2. The OPEN-TASK vectors (Vectorize index "dispatch-tasks"): one
 *        embedding per open task, used to find semantic duplicates
 *        ("Call Jim about the invoice" ≈ "Follow up w/ Jim re: overdue
 *        payment") rather than only exact title matches.
 *
 * HOW IT STAYS FRESH (three layers, each covering the others' gaps)
 *   - ClickUp webhook (real time): list/folder/space events mark the
 *     structure dirty and re-sync it within seconds; task events
 *     re-embed or remove that one task. See handleWebhookRequest().
 *   - Cron trigger (every 15 min, wrangler.toml [triggers]): one small
 *     step per run — structure if stale (>6h) or dirty, otherwise a batch
 *     of custom-field lookups or a page of recently-changed tasks.
 *     Catches anything a missed/failed webhook delivery dropped.
 *   - Initial task backfill is driven FROM THE APP (Settings → Build task
 *     index): the phone pages through open tasks via the proxy and posts
 *     compact items to /routing/index-tasks. Done this way because a
 *     page of 100 full ClickUp task objects can be ~1MB of JSON, and
 *     parsing that inside the Worker risks the free plan's 10ms CPU cap;
 *     the proxy streams those pages through untouched instead.
 *
 * ASSUMPTIONS / EXTERNAL DEPENDENCIES
 *   - env.WORKSPACE_ID (var), env.TOKEN_STORE (KV), env.TASK_VECTORS
 *     (Vectorize binding, optional — duplicate features switch off
 *     without it), env.PRIVATE_LIST_IDS (var, never indexed).
 *   - Free plan: ≤50 external subrequests per invocation. A structure
 *     sync costs 1 + 2×(number of Spaces) calls; capped below that limit.
 *   - ClickUp "Get Filtered Team Tasks" returns ≤100 tasks per page.
 *
 * -------------------------------------------------------------------------
 * VERSION HISTORY
 *   v1  2026-10-10  Initial version for smart routing. Includes pre-deploy
 *                    review fixes: a Space that errors during a structure
 *                    sync keeps its previous lists instead of vanishing;
 *                    webhook bursts claim one structure sync instead of
 *                    each running their own; same-key KV writes are paced
 *                    ≥1.1s apart (KV's 1 write/sec/key limit); idle cron
 *                    steps write nothing.
 * =========================================================================
 */

import { clickup, clampText, shortHash, json, hmacSha256Hex, safeEqual } from './http.js';
import { KEYS, getJSON, putJSON, putJSONPaced, privateListIds, vectorsAvailable } from './store.js';
import { embedTexts, geminiConfigured } from './gemini.js';

// Structure is re-synced at least this often even with no webhook signal.
const HIER_MAX_AGE_MS = 6 * 60 * 60 * 1000;
// Custom-field lookups per sync step (one ClickUp call each).
const FIELDS_PER_STEP = 6;
// Safety cap on Spaces per structure sync: 1 + 2×22 = 45 calls, under
// the free plan's 50-subrequest ceiling with a little headroom.
const MAX_SPACES_PER_SYNC = 22;
// Task events that can change a task's text, list, or open/closed state —
// the only ones worth re-embedding for.
const TASK_EVENTS = new Set(['taskCreated', 'taskUpdated', 'taskStatusUpdated', 'taskMoved']);
// Everything the webhook subscribes to (task text/status + structure).
export const WEBHOOK_EVENTS = [
  'taskCreated', 'taskUpdated', 'taskDeleted', 'taskStatusUpdated', 'taskMoved',
  'listCreated', 'listUpdated', 'listDeleted',
  'folderCreated', 'folderUpdated', 'folderDeleted',
  'spaceCreated', 'spaceUpdated', 'spaceDeleted'
];

/**
 * getIndex
 * @param {object} env
 * @returns {Promise<object|null>} the structure index, or null if never synced
 *   Shape: { v, synced_at, team_id, truncated, spaces:[{id,name}],
 *            lists:[{id,name,path,space_id,space,folder_id,folder,
 *                    statuses:string[],content,task_count,fields?:[{n,t}]}] }
 */
export function getIndex(env) {
  return getJSON(env, KEYS.index, null);
}

/**
 * syncHierarchy
 * Rebuilds the structure index from ClickUp: Spaces, then each Space's
 * Folders (which embed their Lists) and folderless Lists. Custom-field
 * names already learned for a list are carried over so a structure
 * refresh doesn't throw that work away.
 * @param {object} env
 * @param {string} token - ClickUp OAuth token
 * @returns {Promise<object>} the new index (also written to KV)
 * @throws UpstreamError if ClickUp rejects the spaces call; a single
 *   Space's folder/list call failing just skips that Space for this run.
 */
export async function syncHierarchy(env, token) {
  const ws = env.WORKSPACE_ID;
  const spacesRes = await clickup(token, `/team/${ws}/space?archived=false`);
  const allSpaces = (spacesRes && spacesRes.spaces) || [];
  const spaces = allSpaces.slice(0, MAX_SPACES_PER_SYNC);
  const old = await getIndex(env);
  // Carry over custom-field names learned by earlier syncFieldsBatch runs.
  const carried = new Map(((old && old.lists) || []).map(l => [l.id, { fields: l.fields, fields_at: l.fields_at }]));
  const hidden = privateListIds(env);

  const lists = [];
  // Spaces fetched in parallel (2 calls each); ClickUp's 100/min rate
  // limit is comfortably above the ~2×spaces burst this creates.
  const perSpace = await Promise.all(spaces.map(async (sp) => {
    try {
      const [foldersRes, listsRes] = await Promise.all([
        clickup(token, `/space/${sp.id}/folder?archived=false`),
        clickup(token, `/space/${sp.id}/list?archived=false`)
      ]);
      return { sp, folders: (foldersRes && foldersRes.folders) || [], folderless: (listsRes && listsRes.lists) || [] };
    } catch (err) {
      return { sp, folders: [], folderless: [], error: String(err.message || err) };
    }
  }));

  const failedSpaces = [];
  for (const { sp, folders, folderless, error } of perSpace) {
    if (error) {
      // A 429/timeout for one Space must not make its lists vanish from
      // routing — keep last sync's entries for it until the next run.
      failedSpaces.push(String(sp.id));
      for (const l of ((old && old.lists) || [])) if (l.space_id === String(sp.id)) lists.push(l);
      continue;
    }
    const spaceStatuses = statusNames(sp.statuses);
    for (const f of folders) {
      for (const l of (f.lists || [])) {
        if (l.archived) continue;
        lists.push(makeList(l, sp, f, statusNames(l.statuses) || statusNames(f.statuses) || spaceStatuses, carried, hidden));
      }
    }
    for (const l of folderless) {
      if (l.archived) continue;
      lists.push(makeList(l, sp, null, statusNames(l.statuses) || spaceStatuses, carried, hidden));
    }
  }

  const index = {
    v: 1,
    synced_at: Date.now(),
    team_id: ws,
    truncated: allSpaces.length > spaces.length,
    // Spaces whose lists were carried over from the previous sync because
    // ClickUp didn't answer for them this time (retried next sync).
    stale_spaces: failedSpaces,
    spaces: spaces.map(s => ({ id: String(s.id), name: s.name })),
    lists
  };
  await putJSONPaced(env, KEYS.index, index);
  return index;
}

/**
 * makeList — normalizes one ClickUp List object into an index entry.
 * @param {object} l - ClickUp list
 * @param {object} sp - its Space
 * @param {object|null} f - its Folder (null for folderless lists)
 * @param {string[]|null} statuses - effective workflow status names
 * @param {Map} carried - previously learned custom fields by list id
 * @param {Set<string>} hidden - private list ids (kept in the index so
 *   the app can still show them in pickers, but flagged `private` so the
 *   routing engine never sends them to Gemini)
 * @returns {object}
 */
function makeList(l, sp, f, statuses, carried, hidden) {
  const id = String(l.id);
  const folderName = f && !f.hidden ? f.name : null;
  const prev = carried.get(id) || {};
  const entry = {
    id,
    name: l.name,
    path: [sp.name, folderName, l.name].filter(Boolean).join(' › '),
    space_id: String(sp.id),
    space: sp.name,
    folder_id: f ? String(f.id) : null,
    folder: folderName,
    statuses: (statuses || []).slice(0, 8),
    // List descriptions are often the best routing signal there is
    // ("Bills to pay this month") — trimmed to keep the prompt small.
    content: clampText(stripMarkdown(l.content || ''), 200),
    task_count: Number(l.task_count) || 0
  };
  if (hidden.has(id)) entry.private = true;
  if (prev.fields) { entry.fields = prev.fields; entry.fields_at = prev.fields_at; }
  return entry;
}

/** statusNames — status objects → names, or null when absent/empty. */
function statusNames(statuses) {
  if (!Array.isArray(statuses) || !statuses.length) return null;
  return statuses.map(s => s.status).filter(Boolean);
}

/** stripMarkdown — crude cleanup of list descriptions for prompting. */
function stripMarkdown(s) {
  return String(s).replace(/[#*_`>\[\]]/g, '').replace(/\(https?:[^)]+\)/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * syncFieldsBatch
 * Learns custom field names/types for the next FIELDS_PER_STEP lists
 * (round-robin via state.fields_cursor). Field names give Gemini extra
 * routing signal ("Invoice Amount" → finance list).
 * @param {object} env
 * @param {string} token
 * @param {object} index - current structure index (mutated + saved)
 * @param {object} state - sync state (cursor advanced; caller saves)
 * @returns {Promise<{phase:'fields', done:number, total:number}>}
 * Edge case: a list that errors (deleted mid-sync, no access) gets an
 *   empty field set so the cursor never stalls on it.
 */
async function syncFieldsBatch(env, token, index, state) {
  const start = state.fields_cursor || 0;
  const batch = index.lists.slice(start, start + FIELDS_PER_STEP);
  await Promise.all(batch.map(async (l) => {
    if (l.private) { l.fields = []; l.fields_at = Date.now(); return; }
    try {
      const res = await clickup(token, `/list/${l.id}/field`);
      l.fields = ((res && res.fields) || []).slice(0, 15).map(f => ({ n: clampText(f.name, 48), t: f.type }));
    } catch (e) {
      l.fields = [];
    }
    l.fields_at = Date.now();
  }));
  state.fields_cursor = start + batch.length;
  await putJSONPaced(env, KEYS.index, index);
  return { phase: 'fields', done: state.fields_cursor, total: index.lists.length };
}

/**
 * taskToItem
 * Reduces a full ClickUp task object to the compact form the vector
 * index needs. The app has a twin of this (js/routing.js toIndexItem) for
 * the device-driven backfill — keep the two in sync.
 * @param {object} task - ClickUp task
 * @returns {{id, name, text, list_id, space_id, status, closed, parent}}
 */
export function taskToItem(task) {
  const status = task.status || {};
  const desc = String(task.text_content || task.description || '').replace(/\s+/g, ' ').trim();
  return {
    id: String(task.id),
    name: String(task.name || ''),
    text: desc.slice(0, 400),
    list_id: String((task.list && task.list.id) || ''),
    space_id: String((task.space && task.space.id) || ''),
    status: String(status.status || ''),
    // ClickUp status `type` is open | custom | done | closed.
    closed: status.type === 'closed' || status.type === 'done' || Boolean(task.archived),
    parent: Boolean(task.parent)
  };
}

/**
 * embeddingText — the exact text embedded for a task or a capture.
 * Name first (most of the meaning), then a description excerpt.
 * @param {string} name
 * @param {string} text
 * @returns {string}
 */
export function embeddingText(name, text) {
  const n = String(name || '').trim();
  const t = String(text || '').trim();
  return t ? `${n} — ${t.slice(0, 400)}` : n;
}

/**
 * indexTaskItems
 * Upserts open tasks into the vector index and removes closed ones.
 * @param {object} env
 * @param {object[]} items - compact items (taskToItem shape)
 * @param {object} [opts]
 * @param {boolean} [opts.checkUnchanged=false] - fetch existing vectors'
 *   metadata first and skip re-embedding tasks whose text hash hasn't
 *   changed (incremental sync / webhooks — most updates are status or
 *   assignee changes that don't alter meaning). Off for backfill, where
 *   nothing exists yet.
 * @returns {Promise<{upserted:number, deleted:number, skipped:number}>}
 * @throws UpstreamError if embedding fails (caller decides whether to retry)
 */
export async function indexTaskItems(env, items, { checkUnchanged = false } = {}) {
  if (!vectorsAvailable(env)) return { upserted: 0, deleted: 0, skipped: items.length };
  const hidden = privateListIds(env);
  const toDelete = [];
  let toEmbed = [];

  for (const it of items) {
    if (!it || !/^[A-Za-z0-9]+$/.test(it.id || '')) continue;
    // Closed tasks and anything in a private list leave (or never
    // enter) the index — private-list text must never reach Gemini.
    if (it.closed || hidden.has(it.list_id)) { toDelete.push(it.id); continue; }
    const text = embeddingText(it.name, it.text);
    toEmbed.push({ ...it, _text: text, _h: shortHash(text) });
  }

  let skipped = 0;
  // Tasks whose text is unchanged but whose list/status moved: re-upsert
  // the EXISTING vector with fresh metadata — no Gemini call needed.
  const retag = [];
  if (checkUnchanged && toEmbed.length) {
    try {
      const existing = await env.TASK_VECTORS.getByIds(toEmbed.map(i => i.id));
      const known = new Map((existing || []).map(v => [v.id, v]));
      const stillNeedEmbedding = [];
      for (const i of toEmbed) {
        const v = known.get(i.id);
        const m = (v && v.metadata) || null;
        if (!m || m.h !== i._h || !v.values || !v.values.length) { stillNeedEmbedding.push(i); continue; }
        if (m.list_id === i.list_id && m.status === i.status) { skipped++; continue; }
        retag.push({ id: i.id, values: Array.from(v.values), metadata: vectorMetadata(i) });
      }
      toEmbed = stillNeedEmbedding;
    } catch (e) {
      // getByIds failing just means we re-embed everything in this batch.
    }
  }

  if (toDelete.length) {
    try { await env.TASK_VECTORS.deleteByIds(toDelete); } catch (e) { /* best-effort */ }
  }
  if (retag.length) {
    try { await env.TASK_VECTORS.upsert(retag); } catch (e) { /* best-effort; next change retries */ }
  }
  if (!toEmbed.length) return { upserted: retag.length, deleted: toDelete.length, skipped };
  if (!geminiConfigured(env)) return { upserted: retag.length, deleted: toDelete.length, skipped: skipped + toEmbed.length };

  const vectors = await embedTexts(env, toEmbed.map(i => i._text));
  await env.TASK_VECTORS.upsert(toEmbed.map((i, n) => ({ id: i.id, values: vectors[n], metadata: vectorMetadata(i) })));
  return { upserted: toEmbed.length + retag.length, deleted: toDelete.length, skipped };
}

/**
 * vectorMetadata
 * Metadata stored next to each task vector (Vectorize allows ≤10KiB):
 * enough to show a duplicate match without a ClickUp round-trip, plus
 * the text hash used to skip re-embedding unchanged tasks.
 * @param {object} i - compact item with _h (hash) set
 * @returns {object}
 */
function vectorMetadata(i) {
  return {
    list_id: i.list_id,
    space_id: i.space_id,
    name: clampText(i.name, 200),
    status: clampText(i.status, 40),
    h: i._h,
    parent: i.parent ? 1 : 0
  };
}

/**
 * searchSimilar
 * Nearest open tasks to a vector, by cosine similarity.
 * @param {object} env
 * @param {number[]} vector - from embedTexts([embeddingText(...)])
 * @param {number} [topK=6]
 * @returns {Promise<Array<{task_id, similarity, name, list_id, status, url}>>}
 *   Empty array when Vectorize isn't bound or the query fails — duplicate
 *   detection is an enhancement and must never block a capture.
 * Note: Vectorize is eventually consistent; a task upserted seconds ago
 *   may not be queryable yet.
 */
export async function searchSimilar(env, vector, topK = 6) {
  if (!vectorsAvailable(env) || !vector) return [];
  try {
    const res = await env.TASK_VECTORS.query(vector, { topK, returnMetadata: 'all' });
    return ((res && res.matches) || []).map(m => ({
      task_id: m.id,
      similarity: Math.round((m.score || 0) * 1000) / 1000,
      name: (m.metadata && m.metadata.name) || '',
      list_id: (m.metadata && m.metadata.list_id) || '',
      status: (m.metadata && m.metadata.status) || '',
      url: `https://app.clickup.com/t/${m.id}`
    }));
  } catch (e) {
    return [];
  }
}

/**
 * syncTaskChanges
 * One page of "tasks updated since the last high-water mark", re-indexed.
 * Runs from cron / Sync now after the app-driven backfill has set
 * state.tasks_hwm. Pages are walked with a FIXED `since` so ClickUp's
 * result ordering can't make us skip anything; the mark only advances
 * once the last (short) page is processed.
 * @param {object} env
 * @param {string} token
 * @param {object} state - sync state (mutated; caller saves at the end)
 * @returns {Promise<object>} progress for this step
 * Poison-page guard: `attempts` is saved BEFORE the page is processed,
 *   so if the Worker is killed mid-page (e.g. the free plan's CPU cap),
 *   the next run sees attempts ≥ 2 and skips that page instead of
 *   retrying it forever. Skipped tasks are re-indexed the next time they
 *   change (webhook) or on a manual rebuild.
 */
async function syncTaskChanges(env, token, state) {
  if (!state.tasks_hwm) return { phase: 'tasks', skipped_reason: 'index_not_built' };
  const incr = state.incr || { since: state.tasks_hwm, page: 0, max_seen: state.tasks_hwm, attempts: 0 };
  if (incr.attempts >= 2) {
    state.last_skipped_page = { at: Date.now(), page: incr.page, since: incr.since };
    incr.page += 1;
    incr.attempts = 0;
  }
  incr.attempts += 1;
  state.incr = incr;
  await putJSONPaced(env, KEYS.sync, state);

  const q = `page=${incr.page}&subtasks=true&include_closed=true&order_by=updated&date_updated_gt=${incr.since}`;
  const data = await clickup(token, `/team/${env.WORKSPACE_ID}/task?${q}`, { timeoutMs: 20000 });
  const tasks = (data && data.tasks) || [];
  const result = await indexTaskItems(env, tasks.map(taskToItem), { checkUnchanged: true });
  for (const t of tasks) incr.max_seen = Math.max(incr.max_seen, Number(t.date_updated) || 0);

  const fullPage = tasks.length >= 100 && data.last_page !== true;
  if (fullPage) {
    incr.page += 1;
    incr.attempts = 0;
    state.incr = incr;
  } else {
    state.tasks_hwm = Math.max(incr.since, incr.max_seen);
    delete state.incr;
  }
  return { phase: 'tasks', changed: tasks.length, ...result, pending: fullPage };
}

/**
 * runSyncStep
 * Does ONE bounded unit of sync work and reports whether more remains.
 * Called by the cron trigger (one step per run) and by the app's
 * "Sync now" button (which loops while `more` is true).
 * Order of priority: structure (if never synced / dirty / >6h old) →
 * then alternates custom-field batches and changed-task pages.
 * @param {object} env
 * @param {string} token
 * @param {object} [opts]
 * @param {'auto'|'hierarchy'|'fields'|'tasks'} [opts.mode='auto']
 * @param {'cron'|'manual'|'webhook'} [opts.source='manual']
 * @returns {Promise<object>} {phase, more, ...details}
 * @throws whatever the step throws — after recording it in
 *   state.last_error so Settings can show what went wrong.
 */
export async function runSyncStep(env, token, { mode = 'auto', source = 'manual' } = {}) {
  const state = await getJSON(env, KEYS.sync, {});
  const now = Date.now();
  state.last_run = now;
  state.last_source = source;
  state.tick = (state.tick || 0) + 1;
  // Remember whether the last run failed, so a now-idle step still saves
  // the cleared error instead of leaving a stale one on screen.
  const hadError = Boolean(state.last_error);

  let result;
  let index = await getIndex(env);
  try {
    const hierDue = !index || state.hier_dirty || !state.hier_at || (now - state.hier_at) > HIER_MAX_AGE_MS;
    if (mode === 'hierarchy' || (mode === 'auto' && hierDue)) {
      index = await syncHierarchy(env, token);
      state.hier_at = now;
      state.hier_dirty = false;
      state.fields_cursor = 0;
      result = { phase: 'hierarchy', spaces: index.spaces.length, lists: index.lists.length, truncated: index.truncated };
    } else {
      const fieldsPending = Boolean(index) && (state.fields_cursor || 0) < index.lists.length;
      const tasksReady = Boolean(state.tasks_hwm) && vectorsAvailable(env) && geminiConfigured(env);
      // Alternate between field batches and task pages so neither starves.
      const preferFields = mode === 'fields' || (mode === 'auto' && fieldsPending && (!tasksReady || state.tick % 2 === 0));
      if (preferFields && fieldsPending) {
        result = await syncFieldsBatch(env, token, index, state);
      } else if (tasksReady) {
        result = await syncTaskChanges(env, token, state);
      } else {
        result = { phase: 'idle' };
      }
    }
    state.last_error = null;
  } catch (err) {
    state.last_error = { at: now, message: String(err.message || err).slice(0, 300), status: err.status || null };
    await putJSONPaced(env, KEYS.sync, state).catch(() => {});
    throw err;
  }

  const fieldsLeft = Boolean(index) && (state.fields_cursor || 0) < index.lists.length;
  const more = result.phase === 'hierarchy' || fieldsLeft || Boolean(result.pending) || Boolean(state.incr);
  // An idle step changed nothing worth persisting — skipping the write
  // keeps the 15-minute cron from spending ~100 KV writes a day on
  // "nothing to do" (free plan: 1,000 writes/day total).
  if (result.phase !== 'idle' || hadError) {
    try {
      await putJSONPaced(env, KEYS.sync, state);
    } catch (e) {
      // The work itself succeeded; worst case the next step repeats it
      // (every write it makes is idempotent).
      result.save_error = String(e.message || e).slice(0, 120);
    }
  }
  return { ...result, more };
}

/**
 * finishBackfill
 * Called by the app when its device-driven backfill reaches the last
 * page. Sets the high-water mark to when the backfill STARTED, so any
 * task edited during the backfill is picked up by the next incremental
 * step rather than missed.
 * @param {object} env
 * @param {number} startedAt - ms timestamp the app recorded at page 0
 * @param {number} total - tasks indexed (for display only)
 * @returns {Promise<object>} updated sync state
 */
export async function finishBackfill(env, startedAt, total) {
  const state = await getJSON(env, KEYS.sync, {});
  const ts = Number(startedAt);
  state.tasks_hwm = Number.isFinite(ts) && ts > 0 ? ts : Date.now();
  state.backfill = { done_at: Date.now(), total: Number(total) || 0 };
  delete state.incr;
  await putJSONPaced(env, KEYS.sync, state);
  return state;
}

// ---------------------------------------------------------------------
// ClickUp webhook: registration + delivery handling
// ---------------------------------------------------------------------

/**
 * enableWebhook
 * Registers (or re-registers) the workspace webhook pointing at this
 * Worker's /webhook/clickup route and stores its signing secret in KV.
 * Any existing webhook with the same endpoint is removed first — that
 * also cleans up a webhook whose secret was lost (e.g. KV wiped), which
 * would otherwise keep firing deliveries we can't verify.
 * @param {object} env
 * @param {string} token
 * @param {string} endpoint - absolute URL of /webhook/clickup on this Worker
 * @returns {Promise<{id: string}>}
 * @throws UpstreamError if ClickUp refuses the registration
 */
export async function enableWebhook(env, token, endpoint) {
  const ws = env.WORKSPACE_ID;
  try {
    const existing = await clickup(token, `/team/${ws}/webhook`);
    for (const w of ((existing && existing.webhooks) || [])) {
      if (w.endpoint === endpoint) {
        await clickup(token, `/webhook/${w.id}`, { method: 'DELETE' }).catch(() => {});
      }
    }
  } catch (e) {
    // Listing failing isn't fatal — try to create anyway.
  }
  const res = await clickup(token, `/team/${ws}/webhook`, { method: 'POST', body: { endpoint, events: WEBHOOK_EVENTS } });
  const hook = (res && res.webhook) || res || {};
  const id = (res && res.id) || hook.id;
  const secret = hook.secret;
  if (!id || !secret) {
    throw Object.assign(new Error('ClickUp did not return a webhook id and secret.'), { status: 502 });
  }
  await putJSON(env, KEYS.webhook, { id, secret, endpoint, created_at: Date.now() });
  return { id };
}

/**
 * disableWebhook — deletes the registered webhook (if any) and forgets it.
 * @param {object} env
 * @param {string} token
 * @returns {Promise<void>}
 */
export async function disableWebhook(env, token) {
  const hook = await getJSON(env, KEYS.webhook, null);
  if (hook && hook.id) {
    await clickup(token, `/webhook/${hook.id}`, { method: 'DELETE' }).catch(() => {});
  }
  await env.TOKEN_STORE.delete(KEYS.webhook);
}

/**
 * webhookStatus
 * @param {object} env
 * @param {string} token
 * @returns {Promise<{enabled:boolean, health?:string, fail_count?:number}>}
 *   health is ClickUp's own value ("active" | "failing" | "suspended");
 *   a suspended webhook needs re-enabling from Settings.
 */
export async function webhookStatus(env, token) {
  const hook = await getJSON(env, KEYS.webhook, null);
  if (!hook) return { enabled: false };
  try {
    const res = await clickup(token, `/team/${env.WORKSPACE_ID}/webhook`, { timeoutMs: 8000 });
    const w = ((res && res.webhooks) || []).find(x => x.id === hook.id);
    if (!w) return { enabled: false, missing: true };
    return { enabled: true, health: (w.health && w.health.status) || 'active', fail_count: (w.health && w.health.fail_count) || 0 };
  } catch (e) {
    return { enabled: true, health: 'unknown' };
  }
}

/**
 * handleWebhookRequest
 * Entry point for ClickUp's webhook deliveries (POST /webhook/clickup).
 * Not passcode-gated (ClickUp can't send our header) — instead every
 * delivery must carry a valid X-Signature (HMAC-SHA256 of the raw body
 * with the secret ClickUp issued at registration). Answers 200 right
 * away and does the real work in ctx.waitUntil, because slow responses
 * count as failures and ClickUp suspends webhooks that fail repeatedly.
 * @param {Request} request
 * @param {object} env
 * @param {ExecutionContext} ctx
 * @returns {Promise<Response>}
 */
export async function handleWebhookRequest(request, env, ctx) {
  const raw = await request.text();
  const hook = await getJSON(env, KEYS.webhook, null);
  if (!hook || !hook.secret) return json({ error: 'No webhook registered.' }, 401);
  const expected = await hmacSha256Hex(hook.secret, raw);
  const provided = (request.headers.get('X-Signature') || '').toLowerCase();
  if (!safeEqual(expected, provided)) return json({ error: 'Bad signature.' }, 401);

  let payload;
  try { payload = JSON.parse(raw); } catch (e) { return json({ error: 'Bad JSON.' }, 400); }
  ctx.waitUntil(processWebhookEvent(env, payload).catch(() => {
    // Swallowed: the cron safety net will catch up on anything missed.
  }));
  return json({ ok: true });
}

/**
 * processWebhookEvent
 * Applies one verified webhook delivery to the index.
 *   list/folder/space events → mark structure dirty and re-sync it now
 *     (debounced: at most once a minute; bursts like "create a folder
 *     with 5 lists" collapse into one sync).
 *   taskDeleted → drop the vector.
 *   other task events → re-fetch that task and re-index it.
 * @param {object} env
 * @param {object} payload - ClickUp delivery body {event, task_id?, ...}
 * @returns {Promise<void>}
 */
export async function processWebhookEvent(env, payload) {
  const ev = String(payload.event || '');
  const token = await env.TOKEN_STORE.get(KEYS.token);
  if (!token) return;

  if (/^(list|folder|space)/.test(ev)) {
    // Structure events arrive in bursts (a folder created from a template
    // fires one event per list). A random 0–4s pause spreads the burst
    // out, then the first delivery CLAIMS the sync by stamping
    // hier_claim before doing it; the rest see the fresh claim and only
    // mark the index dirty. Without this, every delivery in the burst ran
    // its own full sync (up to ~45 ClickUp calls each), tripping
    // ClickUp's 100-requests/minute limit.
    await new Promise(r => setTimeout(r, Math.floor(Math.random() * 4000)));
    const state = await getJSON(env, KEYS.sync, {});
    const recent = Math.max(state.hier_at || 0, state.hier_claim || 0);
    if (Date.now() - recent < 60 * 1000) {
      if (!state.hier_dirty) {
        state.hier_dirty = true; // next cron / Sync now picks it up
        await putJSONPaced(env, KEYS.sync, state).catch(() => {});
      }
      return;
    }
    state.hier_claim = Date.now();
    await putJSONPaced(env, KEYS.sync, state);
    await syncHierarchy(env, token);
    state.hier_at = Date.now();
    // Events that arrived during this sync may have set hier_dirty;
    // leaving it as-is means the next cron run double-checks.
    state.fields_cursor = 0;
    await putJSONPaced(env, KEYS.sync, state);
    return;
  }

  const taskId = payload.task_id;
  if (!taskId || !/^[A-Za-z0-9]+$/.test(String(taskId))) return;
  if (ev === 'taskDeleted') {
    if (vectorsAvailable(env)) await env.TASK_VECTORS.deleteByIds([String(taskId)]).catch(() => {});
    return;
  }
  if (!TASK_EVENTS.has(ev)) return;
  try {
    const task = await clickup(token, `/task/${taskId}`, { timeoutMs: 10000 });
    if (task) await indexTaskItems(env, [taskToItem(task)], { checkUnchanged: true });
  } catch (err) {
    // 404 = deleted or moved somewhere we can't see → remove from index.
    if (err.status === 404 && vectorsAvailable(env)) {
      await env.TASK_VECTORS.deleteByIds([String(taskId)]).catch(() => {});
    }
  }
}

/**
 * vectorCount — best-effort count of indexed tasks for Settings.
 * @param {object} env
 * @returns {Promise<number|null>} null when unknown/unavailable
 */
export async function vectorCount(env) {
  if (!vectorsAvailable(env)) return null;
  try {
    const info = await env.TASK_VECTORS.describe();
    const n = info && (info.vectorCount ?? info.vectorsCount);
    return typeof n === 'number' ? n : null;
  } catch (e) {
    return null;
  }
}
