import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, type Bindings } from '../server/app';
import type { Store } from '../server/store';
import { world, road } from './helpers';
const worldId = '11111111-1111-4111-8111-111111111111',
  head = '22222222-2222-4222-8222-222222222222';
const env: Bindings = {
  CLERK_SECRET_KEY: 'test-only',
  DATABASE_URL: 'test-only',
  FRONTEND_URL: 'https://world.example',
  RATE_LIMITER: { limit: async () => ({ success: true }) },
  OVERPASS_URL: 'https://provider.example/interpreter',
  NOMINATIM_URL: 'https://search.example',
  NOMINATIM_CONTACT: 'test@example.invalid',
};
const w = world();
w.sourceObjects = [
  road('a', [
    [0, 0],
    [20, 0],
  ]),
];
const store: Store = {
  isAdmin: async (id) => id === 'admin',
  list: async () => [],
  get: async () => null,
  history: async () => [],
  create: async () => ({ id: worldId, head }),
  save: async (_id, _w, h) => (h === head ? { id: worldId, head } : null),
  publish: async () => ({ id: head }),
};
const verify = async (token: string) => {
  if (token === 'invalid') throw Error('bad token');
  return { sub: token, sid: 'session' };
};
const endpoints = [
  ['GET', '/api/me'],
  ['GET', '/api/worlds'],
  ['POST', '/api/worlds'],
  ['GET', '/api/worlds/' + worldId],
  ['PUT', '/api/worlds/' + worldId],
  ['GET', `/api/worlds/${worldId}/revisions`],
  ['POST', `/api/worlds/${worldId}/publish`],
  ['GET', '/api/maps/search?q=Cambridge'],
  ['POST', '/api/maps/osm'],
  ['GET', '/api/imagery?lat=52.2&lon=.12'],
];
for (const [method, path] of endpoints)
  test(method + ' ' + path + ' rejects authenticated non-administrators', async () => {
    const app = createApp({ store, verify });
    const r = await app.request(
      path,
      {
        method,
        headers: { Authorization: 'Bearer learner', 'Content-Type': 'application/json' },
        ...(method === 'GET'
          ? {}
          : {
              body: JSON.stringify({
                world: w,
                expectedHead: head,
                revisionId: head,
                bounds: [52.2, 0.1, 52.21, 0.11],
              }),
            }),
      },
      env,
    );
    assert.equal(r.status, 403);
  });
test('Missing, expired and cross-origin sessions fail closed', async () => {
  const app = createApp({ store, verify });
  assert.equal((await app.request('/api/me', {}, env)).status, 401);
  assert.equal(
    (await app.request('/api/me', { headers: { Authorization: 'Bearer invalid' } }, env)).status,
    401,
  );
  assert.equal(
    (
      await app.request(
        '/api/me',
        { headers: { Authorization: 'Bearer admin', Origin: 'https://evil.example' } },
        env,
      )
    ).status,
    403,
  );
  assert.equal((await app.request('/api/me', {}, {} as any)).status, 503);
});
test('Administrator can save; stale head is a conflict, malformed world is rejected', async () => {
  const app = createApp({ store, verify }),
    headers = { Authorization: 'Bearer admin', 'Content-Type': 'application/json' };
  assert.equal(
    (
      await app.request(
        '/api/worlds',
        { method: 'POST', headers, body: JSON.stringify({ world: w }) },
        env,
      )
    ).status,
    201,
  );
  assert.equal(
    (
      await app.request(
        '/api/worlds/' + worldId,
        { method: 'PUT', headers, body: JSON.stringify({ world: w, expectedHead: worldId }) },
        env,
      )
    ).status,
    409,
  );
  assert.equal(
    (await app.request('/api/worlds', { method: 'POST', headers, body: '{"world":{}}' }, env))
      .status,
    400,
  );
});
test('Provider deduplication/cache and bounds checks prevent redundant/unbounded requests', async () => {
  let calls = 0;
  const app = createApp({
      store,
      verify,
      fetch: async () => {
        calls++;
        return new Response(JSON.stringify({ elements: [] }));
      },
    }),
    headers = { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
    options = {
      method: 'POST',
      headers,
      body: JSON.stringify({ bounds: [52.2, 0.1, 52.21, 0.11] }),
    };
  const results = await Promise.all([
    app.request('/api/maps/osm', options, env),
    app.request('/api/maps/osm', options, env),
  ]);
  assert.ok(results.every((r) => r.status === 200));
  assert.equal(calls, 1);
  assert.equal((await app.request('/api/maps/osm', options, env)).status, 200);
  assert.equal(calls, 1);
  assert.equal(
    (
      await app.request(
        '/api/maps/osm',
        { ...options, body: JSON.stringify({ bounds: [52, 0, 53, 1] }) },
        env,
      )
    ).status,
    400,
  );
  assert.equal(calls, 1);
});
test('Provider errors remain errors; no fabricated fallback data', async () => {
  const app = createApp({
    store,
    verify,
    fetch: async () => new Response('rate limited', { status: 429 }),
  });
  const r = await app.request(
    '/api/maps/osm',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ bounds: [52.2, 0.1, 52.21, 0.11] }),
    },
    env,
  );
  assert.equal(r.status, 502);
  assert.match(((await r.json()) as any).error, /rate limit/);
});
test('Body size limit is enforced before authentication', async () => {
  const app = createApp({ store, verify });
  const r = await app.request(
    '/api/worlds',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(21 * 1024 * 1024) },
      body: '{}',
    },
    env,
  );
  assert.equal(r.status, 413);
});
