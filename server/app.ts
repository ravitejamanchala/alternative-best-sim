import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { verifyToken } from '@clerk/backend';
import { createStore, type Store } from './store';
import { validateWorld, MAX_BYTES } from '../src/world/model';
import { checkBounds } from '../src/world/provider';
export interface Bindings {
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  FRONTEND_URL: string;
  NOMINATIM_URL?: string;
  NOMINATIM_CONTACT?: string;
  OVERPASS_URL?: string;
  MAPILLARY_ACCESS_TOKEN?: string;
  RATE_LIMITER: { limit: (a: { key: string }) => Promise<{ success: boolean }> };
}
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export function createApp(
  deps: {
    verify?: (token: string, options: any) => Promise<any>;
    store?: Store;
    fetch?: typeof fetch;
  } = {},
) {
  const app = new Hono<{ Bindings: Bindings; Variables: { store: Store; author: string } }>();
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    await next();
  });
  app.use(
    '*',
    cors({
      origin: (o, c) => (o === c.env.FRONTEND_URL ? o : ''),
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    }),
  );
  app.get('/health', (c) => c.json({ ok: true, service: 'slaydrive-world' }));
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: MAX_BYTES + 1024,
      onError: (c) => c.json({ error: 'Request exceeds 20 MiB' }, 413),
    }),
  );
  app.use('/api/*', async (c, next) => {
    if (
      !c.env.CLERK_SECRET_KEY ||
      !c.env.DATABASE_URL ||
      !c.env.FRONTEND_URL ||
      !c.env.RATE_LIMITER
    )
      return c.json(
        {
          error:
            'Configure the World Worker: Clerk, database, frontend origin and rate limiter are required.',
        },
        503,
      );
    if (c.req.header('Origin') && c.req.header('Origin') !== c.env.FRONTEND_URL)
      return c.json({ error: 'Origin not permitted' }, 403);
    if (
      !(await c.env.RATE_LIMITER.limit({ key: 'world:' + c.req.header('CF-Connecting-IP') }))
        .success
    )
      return c.json({ error: 'Too many requests; retry shortly.' }, 429);
    const match = /^Bearer (\S+)$/.exec(c.req.header('Authorization') || '');
    if (!match) return c.json({ error: 'Sign in with an administrator account.' }, 401);
    let claims: any;
    try {
      claims = await (deps.verify || verifyToken)(match[1], {
        secretKey: c.env.CLERK_SECRET_KEY,
        authorizedParties: [c.env.FRONTEND_URL],
      });
    } catch {
      return c.json({ error: 'Invalid or expired session' }, 401);
    }
    if (!claims?.sub || !claims.sid) return c.json({ error: 'Invalid session' }, 401);
    const store = deps.store || createStore(c.env.DATABASE_URL);
    if (!(await store.isAdmin(claims.sub)))
      return c.json(
        { error: 'Administrator permission required; signing in is not sufficient.' },
        403,
      );
    c.set('store', store);
    c.set('author', claims.sub);
    await next();
  });
  app.get('/api/me', (c) => c.json({ id: c.get('author'), admin: true }));
  app.get('/api/worlds', async (c) => c.json(await c.get('store').list()));
  app.get('/api/worlds/:id', async (c) => {
    if (!uuid.test(c.req.param('id'))) return c.json({ error: 'Invalid world ID' }, 400);
    const w = await c.get('store').get(c.req.param('id'));
    return w ? c.json(w) : c.json({ error: 'World not found' }, 404);
  });
  app.get('/api/worlds/:id/revisions', async (c) => {
    if (!uuid.test(c.req.param('id'))) return c.json({ error: 'Invalid world ID' }, 400);
    return c.json(await c.get('store').history(c.req.param('id')));
  });
  app.post('/api/worlds', async (c) => {
    let w;
    try {
      w = validateWorld((await c.req.json()).world);
    } catch (e: any) {
      return c.json({ error: e.message }, 400);
    }
    return c.json(await c.get('store').create(w, c.get('author')), 201);
  });
  app.put('/api/worlds/:id', async (c) => {
    let b, w;
    try {
      b = await c.req.json();
      w = validateWorld(b.world);
      if (!uuid.test(c.req.param('id')) || !uuid.test(b.expectedHead || ''))
        throw Error('World ID and expected head are required');
    } catch (e: any) {
      return c.json({ error: e.message }, 400);
    }
    const saved = await c.get('store').save(c.req.param('id'), w, b.expectedHead, c.get('author'));
    return saved
      ? c.json(saved)
      : c.json(
          {
            error: 'Revision conflict. Reload before saving; your draft has not been overwritten.',
          },
          409,
        );
  });
  app.post('/api/worlds/:id/publish', async (c) => {
    const b = await c.req.json().catch(() => null);
    if (!uuid.test(c.req.param('id')) || !uuid.test(b?.revisionId || ''))
      return c.json({ error: 'Valid world and revision IDs required' }, 400);
    const p = await c.get('store').publish(c.req.param('id'), b.revisionId, c.get('author'));
    return p ? c.json(p, 201) : c.json({ error: 'Revision not found in this world' }, 404);
  });
  const cached = new Map<string, { at: number; data: any }>(),
    pending = new Map<string, Promise<any>>();
  const request = deps.fetch || fetch;
  let lastSearch = 0;
  async function provider(key: string, url: string, options: RequestInit = {}) {
    const item = cached.get(key);
    if (item && Date.now() - item.at < 300000) return item.data;
    if (pending.has(key)) return pending.get(key);
    const work = (async () => {
      const u = new URL(url);
      if (u.protocol !== 'https:' || u.username || u.password)
        throw Error('Provider must be a configured HTTPS endpoint');
      const r = await request(url, {
        ...options,
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok)
        throw Error(
          r.status === 429
            ? 'Provider rate limit reached; retry later.'
            : 'Provider unavailable (' + r.status + ').',
        );
      if (!r.body) throw Error('Provider returned no body');
      const reader = r.body.getReader(),
        chunks: Uint8Array[] = [];
      let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 16 * 1024 * 1024) {
          await reader.cancel();
          throw Error('Provider response exceeds 16 MiB. Reduce your area.');
        }
        chunks.push(value);
      }
      const arr = new Uint8Array(bytes);
      let pos = 0;
      for (const c of chunks) {
        arr.set(c, pos);
        pos += c.length;
      }
      const data = JSON.parse(new TextDecoder().decode(arr));
      cached.set(key, { at: Date.now(), data });
      if (cached.size > 4) cached.delete(cached.keys().next().value!);
      return data;
    })().finally(() => pending.delete(key));
    pending.set(key, work);
    return work;
  }
  app.get('/api/maps/search', async (c) => {
    const q = c.req.query('q')?.trim();
    if (!q || q.length > 200)
      return c.json({ error: 'Enter a UK place or address (max 200 characters).' }, 400);
    if (!c.env.NOMINATIM_URL || !c.env.NOMINATIM_CONTACT)
      return c.json(
        {
          error:
            'Configure NOMINATIM_URL and NOMINATIM_CONTACT on the Worker; offline search remains available.',
        },
        503,
      );
    const cacheKey = 'search:' + q;
    if (!cached.has(cacheKey) && Date.now() - lastSearch < 1100)
      return c.json({ error: 'Search is limited to one submitted request per second.' }, 429);
    lastSearch = Date.now();
    try {
      return c.json(
        await provider(
          cacheKey,
          c.env.NOMINATIM_URL.replace(/\/$/, '') +
            '/search?format=jsonv2&countrycodes=gb&limit=8&q=' +
            encodeURIComponent(q),
          { headers: { 'User-Agent': 'SlayDriveWorld/0.1 (' + c.env.NOMINATIM_CONTACT + ')' } },
        ),
      );
    } catch (e: any) {
      return c.json({ error: e.message }, 502);
    }
  });
  app.post('/api/maps/osm', async (c) => {
    const b = await c.req.json().catch(() => null);
    try {
      checkBounds(b?.bounds);
    } catch (e: any) {
      return c.json({ error: e.message }, 400);
    }
    if (!c.env.OVERPASS_URL)
      return c.json(
        { error: 'Configure OVERPASS_URL on the Worker, or use the offline Cambridge example.' },
        503,
      );
    const bounds = b.bounds.join(',');
    const query = `[out:json][timeout:25][maxsize:16777216];(way[highway](${bounds});way[building](${bounds});relation[building](${bounds});relation[type=restriction](${bounds});node[natural=tree](${bounds});node[shop](${bounds}););(._;>;);out body;`;
    try {
      return c.json(
        await provider('osm:' + bounds, c.env.OVERPASS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query),
        }),
      );
    } catch (e: any) {
      return c.json({ error: e.message }, 502);
    }
  });
  app.get('/api/imagery', async (c) => {
    const lat = Number(c.req.query('lat')),
      lon = Number(c.req.query('lon'));
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < 49 ||
      lat > 61 ||
      lon < -9 ||
      lon > 3
    )
      return c.json({ error: 'UK coordinates required' }, 400);
    if (!c.env.MAPILLARY_ACCESS_TOKEN)
      return c.json({ error: 'Optional Mapillary reference is not configured.' }, 503);
    try {
      const d = await provider(
        'imagery:' + lat + ',' + lon,
        `https://graph.mapillary.com/images?fields=id,geometry,captured_at,compass_angle&limit=20&bbox=${lon - 0.002},${lat - 0.001},${lon + 0.002},${lat + 0.001}`,
        { headers: { Authorization: 'OAuth ' + c.env.MAPILLARY_ACCESS_TOKEN } },
      );
      return c.json(d);
    } catch (e: any) {
      return c.json({ error: e.message }, 502);
    }
  });
  app.onError((_e, c) =>
    c.json({ error: 'World service failed. Your local draft is unaffected.' }, 500),
  );
  return app;
}
export default createApp();
