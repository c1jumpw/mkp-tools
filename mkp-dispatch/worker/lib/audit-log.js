/**
 * =========================================================================
 * lib/audit-log.js — audit trail, undo, and the routing feedback loop
 * =========================================================================
 * PURPOSE
 *   1. AUDIT: every action Dispatch takes in ClickUp (auto-filed task,
 *      confirmed suggestion, "add as update" comment, and — for one
 *      consistent history — ordinary manual sends) gets one record with
 *      a timestamp, who/what decided it (auto | confirmed | manual), the
 *      confidence score, and exactly what was created.
 *   2. UNDO: each record carries enough to reverse it — delete the task
 *      that was created, or delete the comment that was added.
 *   3. FEEDBACK: whenever the owner accepts, changes, or undoes a
 *      suggestion, that outcome is stored and fed back into future
 *      prompts (routing-engine.js) — see "HOW THE LEARNING WORKS".
 *
 * HOW THE LEARNING WORKS (honest version)
 *   This does NOT fine-tune or retrain Gemini. It keeps (a) the last ~30
 *   corrections ("you suggested A, owner chose B") and ~10 confirmations,
 *   which are included as examples in every routing prompt, and (b) a
 *   per-list hit rate that scales down confidence for lists the model
 *   keeps getting wrong. Corrections change behavior on the very next
 *   capture; nothing has to be retrained or redeployed.
 *
 * DATA FLOW
 *   routing-engine.js commitCapture() → recordAction() + recordFeedback()
 *   app (manual send)  → POST /audit/record → recordAction()
 *   app (Activity)     → GET /audit → listAudit()
 *   app (Undo)         → POST /audit/:id/undo → undoAction()
 *
 * ASSUMPTIONS / EXTERNAL DEPENDENCIES
 *   - KV TOKEN_STORE. Records live under "audit:<id>" for 180 days.
 *     KV `list` is eventually consistent: a brand-new record can take up
 *     to ~60s to show in listings (the app merges its own fresh records
 *     to hide this).
 *   - Undo uses ClickUp DELETE /task/:id and DELETE /comment/:id.
 *     ClickUp's API cannot delete attachments, so attachments added to an
 *     EXISTING task by "add as update" survive an undo — the record says
 *     so explicitly rather than claiming a full reversal.
 *   - Feedback is a single KV value; two captures committed in the same
 *     instant could each overwrite the other's stats update (last write
 *     wins). TODO: move to a Durable Object or D1 if this ever becomes
 *     multi-user; for one owner + assistants the loss is negligible.
 *
 * -------------------------------------------------------------------------
 * VERSION HISTORY
 *   v1  2026-10-10  Initial version for smart routing. Includes pre-deploy
 *                    review fixes to Undo: it now looks at the task first
 *                    and refuses if the task has subtasks or was edited
 *                    well after filing, and verifies app-reported
 *                    ("client" origin) task/comment ids are genuinely the
 *                    fresh capture before deleting anything.
 * =========================================================================
 */

import { clickup, clampText } from './http.js';
import { KEYS, getJSON, putJSON, vectorsAvailable } from './store.js';

// Audit records expire after 180 days (KV expirationTtl, in seconds).
const AUDIT_TTL_SECONDS = 180 * 24 * 60 * 60;
// Feedback history caps — enough examples to steer the model without
// bloating every prompt.
const MAX_CORRECTIONS = 30;
const MAX_CONFIRMATIONS = 10;
// Audit ids are "<16-digit inverted timestamp>-<6 random chars>" so a
// plain lexicographic KV listing returns newest first.
const AUDIT_ID_RE = /^\d{16}-[a-z0-9]{6}$/;

/**
 * newAuditId
 * @returns {string} sortable id, newest-first under lexicographic order
 */
function newAuditId() {
  const inverted = String(9e15 - Date.now()).padStart(16, '0');
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `${inverted}-${rand}`;
}

/**
 * metadataFor
 * Compact listing metadata (KV caps metadata at 1024 bytes per key) so
 * the Activity screen can render from a single `list` call without
 * fetching every record.
 * @param {object} rec - full audit record
 * @returns {object}
 */
function metadataFor(rec) {
  return {
    ts: rec.ts,
    k: rec.kind,
    s: rec.source,
    c: typeof rec.confidence === 'number' ? Math.round(rec.confidence * 100) / 100 : null,
    t: clampText(rec.title || '', 240),
    p: clampText(rec.list_path || '', 160),
    u: clampText(rec.task_url || '', 120),
    r: rec.reversed ? 1 : 0,
    d: rec.duplicate_of ? 1 : 0,
    m: rec.moved ? 1 : 0
  };
}

/**
 * recordAction
 * Writes one audit record.
 * @param {object} env
 * @param {object} rec - fields: kind ('create_task'|'add_comment'),
 *   source ('auto'|'confirmed'|'manual'), title, list_id, list_path,
 *   task_id, task_url, comment_id?, confidence?, raw_confidence?,
 *   factors?, suggested_list_id?, suggested_path?, duplicate_of?,
 *   attachments?, model?
 * @returns {Promise<{id: string, record: object}>}
 */
export async function recordAction(env, rec) {
  const id = newAuditId();
  const record = {
    id,
    ts: Date.now(),
    reversed: false,
    ...rec,
    // `moved` = the owner overrode the suggestion — shown as "moved
    // from X" in Activity and counted as a correction in feedback.
    moved: Boolean(rec.suggested_list_id && rec.list_id && rec.suggested_list_id !== rec.list_id && rec.kind === 'create_task')
  };
  await env.TOKEN_STORE.put(`${KEYS.auditPrefix}${id}`, JSON.stringify(record), {
    expirationTtl: AUDIT_TTL_SECONDS,
    metadata: metadataFor(record)
  });
  return { id, record };
}

/**
 * listAudit
 * Newest-first page of audit entries, built from KV listing metadata.
 * @param {object} env
 * @param {object} [opts]
 * @param {number} [opts.limit=30] - 1..100
 * @param {string} [opts.cursor] - from a previous page
 * @returns {Promise<{items: object[], cursor: string|null}>}
 */
export async function listAudit(env, { limit = 30, cursor } = {}) {
  const res = await env.TOKEN_STORE.list({
    prefix: KEYS.auditPrefix,
    limit: Math.min(100, Math.max(1, Number(limit) || 30)),
    cursor: cursor || undefined
  });
  const items = (res.keys || []).map(k => {
    const m = k.metadata || {};
    return {
      id: k.name.slice(KEYS.auditPrefix.length),
      ts: m.ts, kind: m.k, source: m.s, confidence: m.c,
      title: m.t, list_path: m.p, task_url: m.u,
      reversed: Boolean(m.r), duplicate: Boolean(m.d), moved: Boolean(m.m)
    };
  });
  return { items, cursor: res.list_complete ? null : (res.cursor || null) };
}

/**
 * getAudit — one full record (factors, suggestion, etc.).
 * @param {object} env
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getAudit(env, id) {
  if (!AUDIT_ID_RE.test(String(id || ''))) return null;
  return getJSON(env, `${KEYS.auditPrefix}${id}`, null);
}

/**
 * undoAction
 * Reverses one audited action in ClickUp and marks the record reversed.
 * @param {object} env
 * @param {string} token - ClickUp OAuth token
 * @param {string} id - audit id
 * @returns {Promise<{record: object, notes: string[]}>}
 * @throws Error with .status: 400 bad id / unsupported kind, 404 no such
 *   record, 409 already undone, or an UpstreamError if ClickUp refuses
 *   the delete (record is left un-reversed so it can be retried).
 * Edge cases: a task/comment already deleted by hand in ClickUp (404)
 *   counts as successfully undone — the end state is what was wanted.
 */
export async function undoAction(env, token, id) {
  if (!AUDIT_ID_RE.test(String(id || ''))) throw statusError(400, 'Bad audit id.');
  const key = `${KEYS.auditPrefix}${id}`;
  const record = await getJSON(env, key, null);
  if (!record) throw statusError(404, 'That activity record no longer exists (records are kept 180 days).');
  if (record.reversed) throw statusError(409, 'Already undone.');

  const notes = [];
  if (record.kind === 'create_task') {
    if (!/^[A-Za-z0-9]+$/.test(String(record.task_id || ''))) throw statusError(400, 'Record has no task id.');
    // Look before deleting: undo must only ever remove the task this
    // record created, and only while it's still essentially untouched.
    let task = null;
    try {
      task = await clickup(token, `/task/${record.task_id}?include_subtasks=true`);
    } catch (err) {
      if (err.status !== 404) throw err;
    }
    if (!task) {
      notes.push('The task was already gone from ClickUp.');
    } else {
      assertSafeToDeleteTask(record, task);
      try {
        await clickup(token, `/task/${record.task_id}`, { method: 'DELETE' });
        notes.push('Task deleted. ClickUp usually keeps deleted tasks in its Trash for a while if you need it back.');
      } catch (err) {
        if (err.status !== 404) throw err;
        notes.push('The task was already gone from ClickUp.');
      }
    }
    if (vectorsAvailable(env)) await env.TASK_VECTORS.deleteByIds([String(record.task_id)]).catch(() => {});
  } else if (record.kind === 'add_comment') {
    if (!/^\d+$/.test(String(record.comment_id || ''))) throw statusError(400, 'Record has no comment id, so it can’t be undone automatically.');
    // App-reported comment ids are verified against the task's real
    // comments (exists + posted around the time of the record).
    if (record.origin !== 'worker') {
      const res = await clickup(token, `/task/${record.task_id}/comment`).catch(err => { if (err.status === 404) return { comments: [] }; throw err; });
      const c = ((res && res.comments) || []).find(x => String(x.id) === String(record.comment_id));
      if (c && !withinWindow(Number(c.date), record.ts)) {
        throw statusError(409, 'For safety, that comment can’t be removed from here — it doesn’t match this send. Delete it in ClickUp if needed.');
      }
    }
    try {
      await clickup(token, `/comment/${record.comment_id}`, { method: 'DELETE' });
      notes.push('Update comment removed from the existing task.');
    } catch (err) {
      if (err.status !== 404) throw err;
      notes.push('The comment was already gone.');
    }
    if (record.attachments) {
      notes.push(`${record.attachments} attachment(s) stay on that task — ClickUp’s API can’t delete attachments, so remove them in ClickUp if needed.`);
    }
  } else {
    throw statusError(400, `Undo isn’t supported for “${record.kind}”.`);
  }

  record.reversed = true;
  record.reversed_at = Date.now();
  await env.TOKEN_STORE.put(key, JSON.stringify(record), { expirationTtl: AUDIT_TTL_SECONDS, metadata: metadataFor(record) });

  // An undone AI placement is a strong "that was wrong" signal.
  if ((record.source === 'auto' || record.source === 'confirmed') && record.kind === 'create_task' && record.suggested_list_id) {
    await recordFeedback(env, {
      kind: 'undo',
      text: record.title,
      suggested_list_id: record.suggested_list_id,
      suggested_path: record.suggested_path,
      chosen_list_id: record.list_id,
      chosen_path: record.list_path,
      source: record.source
    });
  }
  return { record, notes };
}

// Undo safety windows (see assertSafeToDeleteTask).
//   FRESH_WINDOW_MS — an app-reported task must have been created within
//     this long before its audit record (a manual send records itself
//     seconds after creating; queued sends can be later, hence 15 min).
//   EDIT_GRACE_MS — edits within this long after filing (attachment
//     uploads, ClickUp automations) don't block undo; later ones do.
const FRESH_WINDOW_MS = 15 * 60 * 1000;
const EDIT_GRACE_MS = 10 * 60 * 1000;

/**
 * withinWindow
 * @param {number} createdMs - ClickUp timestamp (ms)
 * @param {number} recordTs - audit record timestamp (ms)
 * @returns {boolean} created no earlier than FRESH_WINDOW_MS before the
 *   record and no later than 1 minute after it
 */
function withinWindow(createdMs, recordTs) {
  return Number.isFinite(createdMs) && createdMs >= recordTs - FRESH_WINDOW_MS && createdMs <= recordTs + 60 * 1000;
}

/**
 * assertSafeToDeleteTask
 * Guards Undo against deleting more than it should:
 *   - app-reported records (origin 'client'): the task must have been
 *     created right around the record — otherwise any passcode holder
 *     could log "I created task X" for an arbitrary task and undo it;
 *   - any record: refuse once the task has subtasks or was edited well
 *     after filing (deleting it would destroy later work). The owner can
 *     still delete it deliberately in ClickUp.
 * @param {object} record - audit record
 * @param {object} task - ClickUp task (fetched with include_subtasks)
 * @throws statusError(409) with a plain-language reason
 */
function assertSafeToDeleteTask(record, task) {
  if (record.origin !== 'worker' && !withinWindow(Number(task.date_created), record.ts)) {
    throw statusError(409, 'For safety, this task can’t be undone from here — it wasn’t created by this send. Delete it in ClickUp if needed.');
  }
  if (Array.isArray(task.subtasks) && task.subtasks.length) {
    throw statusError(409, 'This task has subtasks now, so Undo won’t delete it automatically. Delete it in ClickUp if you’re sure.');
  }
  if (Number(task.date_updated) > record.ts + EDIT_GRACE_MS) {
    throw statusError(409, 'This task was changed after it was filed, so Undo won’t delete it automatically. Delete it in ClickUp if you’re sure.');
  }
}

/**
 * getFeedback
 * @param {object} env
 * @returns {Promise<{corrections:object[], confirmations:object[], stats:object, totals:object}>}
 */
export async function getFeedback(env) {
  const fb = await getJSON(env, KEYS.feedback, null);
  return {
    corrections: (fb && fb.corrections) || [],
    confirmations: (fb && fb.confirmations) || [],
    // stats[list_id] = {n: times suggested, a: times the suggestion stuck}
    stats: (fb && fb.stats) || {},
    // totals across all lists: n suggested, a accepted, auto filed, undone
    totals: (fb && fb.totals) || { n: 0, a: 0, auto: 0, undone: 0 }
  };
}

/**
 * recordFeedback
 * Folds one outcome into the feedback store.
 * @param {object} env
 * @param {object} ev
 * @param {'decision'|'undo'} ev.kind - a commit, or a later undo
 * @param {string} ev.text - capture title (trimmed to 140 chars)
 * @param {string} ev.suggested_list_id / ev.suggested_path
 * @param {string} ev.chosen_list_id / ev.chosen_path
 * @param {'auto'|'confirmed'} ev.source
 * @returns {Promise<void>}
 * Accounting: a commit adds 1 to `n` for the suggested list and 1 to
 *   `a` if the owner kept it. An undo of a kept suggestion takes that `a`
 *   back and records a correction, so "auto-filed then undone" ends up
 *   counting as a miss, not a hit.
 */
export async function recordFeedback(env, ev) {
  const fb = await getFeedback(env);
  const sid = String(ev.suggested_list_id || '');
  if (!sid) return;
  const st = fb.stats[sid] || (fb.stats[sid] = { n: 0, a: 0 });
  const text = clampText(ev.text || '', 140);
  const kept = String(ev.chosen_list_id || '') === sid;

  if (ev.kind === 'undo') {
    if (kept && st.a > 0) { st.a -= 1; fb.totals.a = Math.max(0, (fb.totals.a || 0) - 1); }
    fb.totals.undone = (fb.totals.undone || 0) + 1;
    fb.corrections.unshift({ ts: Date.now(), text, from: ev.chosen_path || ev.suggested_path, to: null, note: 'undone' });
  } else {
    st.n += 1;
    fb.totals.n = (fb.totals.n || 0) + 1;
    if (ev.source === 'auto') fb.totals.auto = (fb.totals.auto || 0) + 1;
    if (kept) {
      st.a += 1;
      fb.totals.a = (fb.totals.a || 0) + 1;
      // Confirmations are useful positive examples, but only when a human
      // actually looked at them (auto-filed ones are unverified).
      if (ev.source === 'confirmed') fb.confirmations.unshift({ ts: Date.now(), text, path: ev.chosen_path });
    } else {
      fb.corrections.unshift({ ts: Date.now(), text, from: ev.suggested_path, to: ev.chosen_path });
    }
  }
  fb.corrections = fb.corrections.slice(0, MAX_CORRECTIONS);
  fb.confirmations = fb.confirmations.slice(0, MAX_CONFIRMATIONS);
  fb.updated_at = Date.now();
  await putJSON(env, KEYS.feedback, fb);
}

/**
 * accuracySummary — headline numbers for Settings / Activity.
 * @param {object} fb - from getFeedback()
 * @returns {{suggested:number, accepted:number, pct:number|null, auto:number, undone:number}}
 */
export function accuracySummary(fb) {
  const t = fb.totals || {};
  const n = t.n || 0;
  return {
    suggested: n,
    accepted: t.a || 0,
    pct: n ? Math.round(((t.a || 0) / n) * 100) : null,
    auto: t.auto || 0,
    undone: t.undone || 0
  };
}

/**
 * statusError — Error with an HTTP status attached for the router.
 * @param {number} status
 * @param {string} message
 * @returns {Error}
 */
export function statusError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.expose = true; // safe to show this message to the app as-is
  return err;
}
