import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';

const ORIGIN = 'https://c1jumpw.github.io';
const mkKV = () => { const m = new Map(); return { m, async get(k, o) { const v = m.get(k); return v == null ? null : (o && o.type === 'json' ? JSON.parse(v) : v); }, async put(k, v) { m.set(k, v); } }; };
const mkEnv = (extra = {}) => ({ LIBRARY_STORE: mkKV(), ALLOWED_ORIGIN: ORIGIN, DEFAULT_PASSCODE: '0286', ...extra });
const P = (id, updatedAt, extra = {}) => ({ id, title: id, category: 'A', description: '', template: 't', fields: [], favorite: false, createdAt: 1, updatedAt, history: [], ...extra });
const call = (env, method, path, { key = '0286', body, origin = ORIGIN, ip = '1.1.1.1' } = {}) => worker.fetch(new Request('https://relay.test' + path, {
  method, headers: { ...(origin ? { Origin: origin } : {}), ...(key != null ? { 'X-Library-Key': key } : {}), 'CF-Connecting-IP': ip, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }), env);
const put = (env, data, o) => call(env, 'PUT', '/prompts', { body: { data }, ...o });

test('health is open and needs no passcode', async () => {
  const r = await call(mkEnv(), 'GET', '/health', { key: null }); assert.equal(r.status, 200); assert.equal((await r.json()).ok, true);
});
test('GET before any save returns null data', async () => {
  const r = await call(mkEnv(), 'GET', '/prompts'); assert.equal(r.status, 200); assert.equal((await r.json()).data, null);
});
test('missing / wrong passcode → 401 on read and write', async () => {
  const env = mkEnv();
  assert.equal((await call(env, 'GET', '/prompts', { key: null })).status, 401);
  assert.equal((await call(env, 'GET', '/prompts', { key: '9999', ip: '2.2.2.2' })).status, 401);
  assert.equal((await put(env, { prompts: [] }, { key: '1234', ip: '3.3.3.3' })).status, 401);
  assert.equal(env.LIBRARY_STORE.m.size, 0, 'nothing may be stored on a rejected write');
});
test('PASSCODE secret overrides the public default', async () => {
  const env = mkEnv({ PASSCODE: 'long-secret-42' });
  assert.equal((await call(env, 'GET', '/prompts', { key: '0286' })).status, 401);
  assert.equal((await call(env, 'GET', '/prompts', { key: 'long-secret-42', ip: '9.9.9.9' })).status, 200);
});
test('no passcode configured fails closed', async () => {
  const env = mkEnv({ DEFAULT_PASSCODE: undefined });
  assert.equal((await call(env, 'GET', '/prompts')).status, 503);
});
test('brute force is throttled per IP, other IPs unaffected, success resets', async () => {
  const env = mkEnv();
  for (let i = 0; i < 8; i++) assert.equal((await call(env, 'GET', '/prompts', { key: 'bad' + i, ip: '7.7.7.7' })).status, 401);
  assert.equal((await call(env, 'GET', '/prompts', { key: '0286', ip: '7.7.7.7' })).status, 429, 'even the right code is blocked while throttled');
  assert.equal((await call(env, 'GET', '/prompts', { key: '0286', ip: '8.8.8.8' })).status, 200);
  for (let i = 0; i < 5; i++) await call(env, 'GET', '/prompts', { key: 'bad', ip: '6.6.6.6' });
  assert.equal((await call(env, 'GET', '/prompts', { key: '0286', ip: '6.6.6.6' })).status, 200);
  for (let i = 0; i < 7; i++) assert.equal((await call(env, 'GET', '/prompts', { key: 'bad', ip: '6.6.6.6' })).status, 401, 'counter was reset by the successful attempt');
});
test('CORS: allowed origin echoed, foreign origin refused, preflight answered', async () => {
  const env = mkEnv();
  const ok = await call(env, 'GET', '/prompts'); assert.equal(ok.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const bad = await call(env, 'GET', '/prompts', { origin: 'https://evil.example', ip: '4.4.4.4' }); assert.equal(bad.status, 403); assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null);
  const pre = await call(env, 'OPTIONS', '/prompts', { key: null }); assert.equal(pre.status, 204);
  assert.match(pre.headers.get('Access-Control-Allow-Headers'), /X-Library-Key/);
  assert.equal((await call(env, 'GET', '/prompts', { origin: null, ip: '5.5.5.5' })).status, 200, 'non-browser callers (no Origin) work with the passcode');
});
test('PUT stores and returns merged data; GET reads it back', async () => {
  const env = mkEnv();
  const r = await put(env, { prompts: [P('a', 10)], colors: { A: '#111' } });
  assert.equal(r.status, 200); const j = await r.json(); assert.equal(j.data.prompts.length, 1);
  const g = await (await call(env, 'GET', '/prompts')).json(); assert.equal(g.data.prompts[0].id, 'a'); assert.equal(g.data.colors.A, '#111');
});
test('two devices editing different prompts: nothing lost', async () => {
  const env = mkEnv(); await put(env, { prompts: [P('a', 10), P('b', 10)] });
  await put(env, { prompts: [P('a', 20, { title: 'A from phone' }), P('b', 10)] });          // phone edits a
  const r = await put(env, { prompts: [P('a', 10), P('b', 30, { title: 'B from laptop' })] }); // stale laptop edits b
  const d = (await r.json()).data; const t = Object.fromEntries(d.prompts.map(p => [p.id, p.title]));
  assert.equal(t.a, 'A from phone'); assert.equal(t.b, 'B from laptop');
});
test('same prompt edited twice: newest wins; a stale write cannot clobber it', async () => {
  const env = mkEnv(); await put(env, { prompts: [P('a', 50, { title: 'new' })] });
  const d = (await (await put(env, { prompts: [P('a', 40, { title: 'old' })] })).json()).data;
  assert.equal(d.prompts[0].title, 'new');
});
test('a stale device cannot remove other prompts (omission is not deletion)', async () => {
  const env = mkEnv(); await put(env, { prompts: [P('a', 1), P('b', 1)] });
  const d = (await (await put(env, { prompts: [P('c', 2)] })).json()).data;
  assert.deepEqual(d.prompts.map(p => p.id).sort(), ['a', 'b', 'c']);
});
test('deletion via tombstone propagates; a later edit revives', async () => {
  const T = Date.now() - 5000; // realistic timestamps (tombstones older than 90 days are pruned by design)
  const env = mkEnv(); await put(env, { prompts: [P('a', T + 10), P('b', T + 10)] });
  let d = (await (await put(env, { prompts: [P('b', T + 10)], deleted: { a: T + 20 } })).json()).data;
  assert.deepEqual(d.prompts.map(p => p.id), ['b']);
  d = (await (await put(env, { prompts: [P('a', T + 10)] })).json()).data;           // stale device still has 'a'
  assert.deepEqual(d.prompts.map(p => p.id), ['b'], 'stale copy must not resurrect it');
  d = (await (await put(env, { prompts: [P('a', T + 30)] })).json()).data;           // edited after deletion (e.g. Undo)
  assert.deepEqual(d.prompts.map(p => p.id).sort(), ['a', 'b']);
});
test('old tombstones pruned; unused category colours dropped', async () => {
  const env = mkEnv(); const old = Date.now() - 91 * 86400000;
  const d = (await (await put(env, { prompts: [P('a', 1)], deleted: { gone: old, fresh: Date.now() }, colors: { A: '#1', Unused: '#2' } })).json()).data;
  assert.ok(!('gone' in d.deleted)); assert.ok('fresh' in d.deleted); assert.deepEqual(Object.keys(d.colors), ['A']);
});
test('validation rejects malformed documents and stores nothing', async () => {
  const env = mkEnv();
  for (const bad of [null, [], { prompts: 'x' }, { prompts: [{ id: 'a' }] }, { prompts: [P('a', 1), P('a', 2)] }, { prompts: [P('a', 'zz')] },
                     { prompts: [P('a', 1, { template: 'x'.repeat(100001) })] }, { prompts: [], deleted: [] }]) {
    const r = await put(env, bad, { ip: '10.0.0.' + Math.floor(Math.random() * 200) }); assert.equal(r.status, 400, JSON.stringify(bad).slice(0, 60));
  }
  assert.equal(env.LIBRARY_STORE.m.size, 0);
});
test('non-JSON and oversized bodies rejected', async () => {
  const env = mkEnv();
  const r = await worker.fetch(new Request('https://relay.test/prompts', { method: 'PUT', headers: { 'X-Library-Key': '0286', 'CF-Connecting-IP': '11.1.1.1' }, body: 'not json' }), env);
  assert.equal(r.status, 400);
  const big = await worker.fetch(new Request('https://relay.test/prompts', { method: 'PUT', headers: { 'X-Library-Key': '0286', 'CF-Connecting-IP': '11.1.1.2', 'Content-Length': '3000000' }, body: '{}' }), env);
  assert.equal(big.status, 413);
});
test('unknown route 404, wrong method 404', async () => {
  const env = mkEnv(); assert.equal((await call(env, 'GET', '/nope')).status, 404); assert.equal((await call(env, 'POST', '/prompts')).status, 404);
});
test('storage failure surfaces as 500 JSON, not a crash', async () => {
  const env = mkEnv(); env.LIBRARY_STORE.get = async () => { throw new Error('kv down'); };
  const r = await call(env, 'GET', '/prompts'); assert.equal(r.status, 500); assert.equal((await r.json()).error, 'Relay error');
});
