import { validateWorld, MAX_BYTES } from './model';
import type { World } from './types';
export interface Revision {
  id: string;
  worldId: string;
  at: string;
  author: string;
  parent: string | null;
  world: World;
}
const db = () =>
  new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open('slaydrive-world', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('revisions', { keyPath: 'id' });
      r.result.createObjectStore('drafts', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
export async function saveRevision(w: World, author = 'Local editor'): Promise<Revision> {
  validateWorld(w);
  if (new TextEncoder().encode(JSON.stringify(w)).length > MAX_BYTES)
    throw Error('World exceeds 20 MiB; nothing was overwritten.');
  const d = await db();
  try {
    return await new Promise((res, rej) => {
      const t = d.transaction(['drafts', 'revisions'], 'readwrite'),
        draft = t.objectStore('drafts'),
        read = draft.get(w.id);
      let revision: Revision;
      read.onsuccess = () => {
        revision = {
          id: crypto.randomUUID(),
          worldId: w.id,
          at: new Date().toISOString(),
          author,
          parent: read.result?.head || null,
          world: structuredClone(w),
        };
        t.objectStore('revisions').add(revision);
        draft.put({ id: w.id, head: revision.id, at: revision.at });
      };
      t.oncomplete = () => res(revision);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || Error('Save cancelled'));
    });
  } finally {
    d.close();
  }
}
export async function revisions(): Promise<Revision[]> {
  const d = await db();
  try {
    return await new Promise((res, rej) => {
      const r = d.transaction('revisions').objectStore('revisions').getAll();
      r.onsuccess = () =>
        res(r.result.sort((a: Revision, b: Revision) => b.at.localeCompare(a.at)));
      r.onerror = () => rej(r.error);
    });
  } finally {
    d.close();
  }
}
export async function latest() {
  return (await revisions())[0]?.world || null;
}
