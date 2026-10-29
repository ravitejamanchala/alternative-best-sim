import type { Bounds, OSMData, World } from './types';
import { toWorld } from './geo';
export function checkBounds(b: Bounds) {
  if (
    !Array.isArray(b) ||
    b.length !== 4 ||
    !b.every(Number.isFinite) ||
    b[0] < 49 ||
    b[2] > 61 ||
    b[1] < -9 ||
    b[3] > 3 ||
    b[0] >= b[2] ||
    b[1] >= b[3]
  )
    throw Error('Select a valid UK bounding box.');
  const extent = toWorld(b[2], b[3], [b[0], b[1]]);
  if (Math.abs(extent[0]) > 2000 || Math.abs(extent[1]) > 2000)
    throw Error('Area exceeds the explicit 2 × 2 km generation limit. Select a smaller area.');
}
export class ProviderClient {
  private active = new Map<string, Promise<any>>();
  private cache = new Map<string, any>();
  constructor(
    private api = import.meta.env.VITE_API_URL || '',
    private token: () => Promise<string | null> = async () => null,
  ) {}
  async request(path: string, options: RequestInit = {}) {
    const token = await this.token();
    const r = await fetch(this.api + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
    });
    const d = await r.json().catch(() => ({
      error: 'Source API unavailable. Start the Worker or configure VITE_API_URL.',
    }));
    if (!r.ok) throw Error(d.error || 'Provider failed (' + r.status + ')');
    return d;
  }
  async osm(bounds: Bounds, signal?: AbortSignal): Promise<OSMData> {
    checkBounds(bounds);
    const key = JSON.stringify(bounds);
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (this.cache.has(key)) return structuredClone(this.cache.get(key));
    let pending = this.active.get(key);
    if (!pending) {
      pending = this.request('/api/maps/osm', { method: 'POST', body: JSON.stringify({ bounds }) })
        .then((d) => {
          this.cache.set(key, d);
          if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value!);
          return d;
        })
        .finally(() => this.active.delete(key));
      this.active.set(key, pending);
    }
    return new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException('Cancelled', 'AbortError'));
      signal?.addEventListener('abort', abort, { once: true });
      pending!.then(
        (v) => {
          signal?.removeEventListener('abort', abort);
          if (!signal?.aborted) resolve(structuredClone(v));
        },
        (e) => {
          signal?.removeEventListener('abort', abort);
          reject(e);
        },
      );
    });
  }
  search(q: string) {
    return this.request('/api/maps/search?q=' + encodeURIComponent(q));
  }
}
export function retainEdits(previous: World, next: World) {
  const ids = new Set(next.sourceObjects.map((o) => o.id));
  next.id = previous.id;
  next.overrides = {};
  next.additions = structuredClone(previous.additions);
  for (const [id, patch] of Object.entries(previous.overrides)) {
    const old = previous.sourceObjects.find((o) => o.id === id);
    if (!ids.has(id) && old && !patch.deleted) {
      next.additions.push({ ...structuredClone(old), ...patch });
      next.sourceIssues.push(
        'Edited source object no longer returned; retained as authored object ' + id,
      );
    } else if (ids.has(id) || next.additions.some((o) => o.id === id))
      next.overrides[id] = structuredClone(patch);
  }
  next.nodeOverrides = structuredClone(previous.nodeOverrides);
  next.spawn = { ...previous.spawn };
  next.route = null;
  return next;
}
