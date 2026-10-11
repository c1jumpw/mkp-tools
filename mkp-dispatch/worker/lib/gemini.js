/**
 * =========================================================================
 * lib/gemini.js — Gemini API calls (reasoning + embeddings)
 * =========================================================================
 * PURPOSE
 *   The Worker's only contact with Google's Gemini API. Two capabilities:
 *     1. generateJSON()  — one structured-output call: send instructions +
 *                          a prompt + a response schema, get back parsed
 *                          JSON. Powers placement / due-date / duplicate
 *                          reasoning (routing-engine.js).
 *     2. embedTexts()    — turn short texts (capture text, open task
 *                          titles) into vectors for semantic duplicate
 *                          search (workspace-index.js, routing-engine.js).
 *
 * DATA FLOW
 *   routing-engine.js / workspace-index.js → this file → Gemini REST API
 *   (generativelanguage.googleapis.com, header x-goog-api-key).
 *
 * ASSUMPTIONS / EXTERNAL DEPENDENCIES
 *   env.GEMINI_API_KEY        (secret)  Google AI Studio API key. Never
 *                                       logged, never returned to the app.
 *   env.GEMINI_MODEL          (var)     default "gemini-3.8-flash" (GA as
 *                                       of 2026-09-02 per Google's docs).
 *                                       Any generateContent-capable model
 *                                       works; change it in wrangler.toml.
 *   env.GEMINI_THINKING_LEVEL (var)     "low" | "medium" | "high"; only
 *                                       sent to gemini-3* models (older
 *                                       models use a different knob).
 *   env.GEMINI_EMBED_MODEL    (var)     default "gemini-embedding-2".
 *   env.EMBED_DIMS            (var)     default 768. MUST equal the
 *                                       Vectorize index's dimensions —
 *                                       changing it means recreating the
 *                                       index (see README).
 *   - Uses the classic generateContent endpoint with
 *     generationConfig.responseMimeType/responseSchema (OpenAPI-style
 *     schema, upper-case types), which works across Gemini 2.5 and 3.x.
 *   - Privacy: whatever is sent here leaves Cloudflare for Google. On a
 *     free-tier (unbilled) key Google may use prompts to improve its
 *     products; a billing-enabled key does not. Sensitive lists are kept
 *     out upstream of this file (PRIVATE_LIST_IDS in wrangler.toml).
 *
 * -------------------------------------------------------------------------
 * VERSION HISTORY
 *   v1  2026-10-10  Initial version for smart routing.
 * =========================================================================
 */

import { fetchWithTimeout, UpstreamError } from './http.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * geminiConfigured
 * @param {object} env
 * @returns {boolean} true when a Gemini key is present on the Worker
 */
export function geminiConfigured(env) {
  return Boolean(env.GEMINI_API_KEY);
}

/**
 * modelName
 * @param {object} env
 * @returns {string} the reasoning model ID in use (for status/audit)
 */
export function modelName(env) {
  return env.GEMINI_MODEL || 'gemini-3.8-flash';
}

/**
 * embedDims
 * @param {object} env
 * @returns {number} vector size requested from the embedding model —
 *   must match the Vectorize index (created with --dimensions=768)
 */
export function embedDims(env) {
  const n = Number(env.EMBED_DIMS || 768);
  return Number.isFinite(n) && n >= 128 && n <= 3072 ? n : 768;
}

/**
 * generateJSON
 * Runs one structured-output generateContent call and returns the
 * parsed JSON object.
 * @param {object} env
 * @param {object} args
 * @param {string} args.system  - system instruction (role/rules)
 * @param {string} args.prompt  - the per-request content
 * @param {object} args.schema  - OpenAPI-style responseSchema
 * @param {number} [args.temperature=0.2] - low: routing should be
 *   consistent run-to-run, not creative
 * @param {number} [args.timeoutMs=25000]
 * @returns {Promise<{data: object, usage: object|null, model: string}>}
 * @throws UpstreamError — status 401/403 bad key, 429 quota/rate limit,
 *   400 malformed request, 504 timeout, 502 blocked/unparseable output
 * Edge cases:
 *   - If the model rejects thinkingConfig (older/other model family),
 *     retries once without it rather than failing the capture.
 *   - Output wrapped in ```json fences (rare with responseMimeType, but
 *     seen) is unwrapped before parsing.
 */
export async function generateJSON(env, { system, prompt, schema, temperature = 0.2, timeoutMs = 25000 }) {
  if (!geminiConfigured(env)) {
    throw new UpstreamError('gemini', 503, 'GEMINI_API_KEY is not set on the Worker.');
  }
  const model = modelName(env);
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      temperature,
      maxOutputTokens: 4096
    }
  };
  // Gemini 3.x replaced thinking_budget with a thinking_level enum.
  // "low" keeps routing snappy (a capture app can't wait 10s); older
  // models get no thinking config at all.
  const wantsThinking = /^gemini-3/.test(model);
  if (wantsThinking) {
    body.generationConfig.thinkingConfig = { thinkingLevel: env.GEMINI_THINKING_LEVEL || 'low' };
  }

  let res = await callGenerate(env, model, body, timeoutMs);
  if (res.status === 400 && wantsThinking) {
    // Retry once without thinkingConfig — covers a model swap in
    // wrangler.toml to something that doesn't accept the field.
    const text = await res.clone().text();
    if (/thinking/i.test(text)) {
      delete body.generationConfig.thinkingConfig;
      res = await callGenerate(env, model, body, timeoutMs);
    }
  }

  const raw = await res.text();
  if (!res.ok) {
    const retryAfter = Number(res.headers.get('Retry-After')) || undefined;
    throw new UpstreamError('gemini', res.status, `Gemini ${model} → ${res.status}`, raw, retryAfter);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new UpstreamError('gemini', 502, 'Gemini returned a non-JSON envelope.', raw);
  }

  const candidate = parsed.candidates && parsed.candidates[0];
  if (!candidate) {
    // No candidate at all usually means the prompt itself was blocked.
    const reason = parsed.promptFeedback && parsed.promptFeedback.blockReason;
    throw new UpstreamError('gemini', 502, `Gemini returned no answer${reason ? ` (blocked: ${reason})` : ''}.`, raw);
  }
  // Concatenate text parts, skipping any "thought" parts some models
  // include alongside the answer.
  const text = ((candidate.content && candidate.content.parts) || [])
    .filter(p => typeof p.text === 'string' && !p.thought)
    .map(p => p.text)
    .join('')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  if (!text) {
    throw new UpstreamError('gemini', 502, `Gemini answer was empty (finishReason: ${candidate.finishReason || 'unknown'}).`, raw);
  }
  try {
    return { data: JSON.parse(text), usage: parsed.usageMetadata || null, model };
  } catch (e) {
    // Most likely truncated output (finishReason MAX_TOKENS).
    throw new UpstreamError('gemini', 502, `Gemini answer wasn't valid JSON (finishReason: ${candidate.finishReason || 'unknown'}).`, text);
  }
}

/**
 * callGenerate — the raw HTTP call behind generateJSON (split out so the
 * thinkingConfig retry can reuse it).
 * @returns {Promise<Response>}
 */
function callGenerate(env, model, body, timeoutMs) {
  return fetchWithTimeout(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify(body)
  }, timeoutMs);
}

/**
 * embedTexts
 * Embeds an array of short texts for semantic-similarity comparison.
 * @param {object} env
 * @param {string[]} texts - each trimmed to ~2,000 chars (titles plus a
 *   short description excerpt; well under the model's 8,192-token cap)
 * @returns {Promise<number[][]>} one vector per input, same order,
 *   each of length embedDims(env)
 * @throws UpstreamError on any failed batch (whole call fails — callers
 *   treat embeddings as all-or-nothing per batch)
 * Notes:
 *   - gemini-embedding-2 takes its task as a text prefix instead of a
 *     taskType field; Google's documented symmetric format for
 *     similarity is "task: sentence similarity | query: {content}". The
 *     SAME prefix is used for captures and stored tasks, which is what
 *     makes their vectors comparable.
 *   - gemini-embedding-001 (legacy) uses taskType instead and returns
 *     un-normalized vectors at reduced sizes, so they're normalized here.
 *   - Batched 100 per request to keep each call small; the sync only
 *     ever sends one page (≤100 tasks) at a time anyway.
 */
export async function embedTexts(env, texts) {
  if (!geminiConfigured(env)) {
    throw new UpstreamError('gemini', 503, 'GEMINI_API_KEY is not set on the Worker.');
  }
  if (!texts.length) return [];
  const model = env.GEMINI_EMBED_MODEL || 'gemini-embedding-2';
  const legacy = /embedding-001$/.test(model);
  const dims = embedDims(env);
  const out = [];

  for (let i = 0; i < texts.length; i += 100) {
    const chunk = texts.slice(i, i + 100);
    const requests = chunk.map(t => {
      const clean = String(t || '').replace(/\s+/g, ' ').trim().slice(0, 2000) || '(empty)';
      const req = {
        model: `models/${model}`,
        content: { parts: [{ text: legacy ? clean : `task: sentence similarity | query: ${clean}` }] },
        outputDimensionality: dims
      };
      if (legacy) req.taskType = 'SEMANTIC_SIMILARITY';
      return req;
    });

    const res = await fetchWithTimeout(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:batchEmbedContents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({ requests })
    }, 20000);
    const raw = await res.text();
    if (!res.ok) {
      const retryAfter = Number(res.headers.get('Retry-After')) || undefined;
      throw new UpstreamError('gemini', res.status, `Gemini embeddings → ${res.status}`, raw, retryAfter);
    }
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) {
      throw new UpstreamError('gemini', 502, 'Gemini embeddings returned non-JSON.', raw);
    }
    const vectors = (parsed.embeddings || []).map(e => e.values || []);
    if (vectors.length !== chunk.length || vectors.some(v => v.length !== dims)) {
      // A dimension mismatch here would make Vectorize reject the upsert
      // anyway — fail loudly with a clear reason instead.
      throw new UpstreamError('gemini', 502, `Embedding shape mismatch (expected ${chunk.length}×${dims}).`, raw.slice(0, 300));
    }
    out.push(...(legacy ? vectors.map(normalize) : vectors));
  }
  return out;
}

/**
 * normalize — scales a vector to unit length (cosine-ready).
 * @param {number[]} v
 * @returns {number[]}
 */
function normalize(v) {
  let sum = 0;
  for (const x of v) sum += x * x;
  const n = Math.sqrt(sum) || 1;
  return v.map(x => x / n);
}

/**
 * describeGeminiError
 * Maps an UpstreamError from this module to a short, user-facing reason
 * the app can show (the app never sees raw Google error bodies).
 * @param {Error} err
 * @returns {{code: string, message: string}}
 */
export function describeGeminiError(err) {
  const s = err && err.status;
  if (s === 503 && /not set/.test(err.message)) return { code: 'not_configured', message: 'Smart routing isn’t set up yet (no Gemini key on the server).' };
  if (s === 401 || s === 403) return { code: 'bad_key', message: 'Gemini rejected the API key. Re-set GEMINI_API_KEY on the Worker.' };
  if (s === 429) return { code: 'rate_limited', message: 'Gemini is rate-limiting requests right now. Try again in a minute, or pick the destination yourself.' };
  if (s === 504) return { code: 'timeout', message: 'Gemini took too long to answer.' };
  if (s === 404) return { code: 'bad_model', message: 'The configured Gemini model wasn’t found. Check GEMINI_MODEL in wrangler.toml.' };
  return { code: 'gemini_error', message: 'Gemini couldn’t route this one.' };
}
