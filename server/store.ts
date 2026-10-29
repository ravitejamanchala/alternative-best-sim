import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, and, desc, sql } from 'drizzle-orm';
import { admins, worlds, revisions, publications } from './schema';
import type { World } from '../src/world/types';
export interface Store {
  isAdmin: (id: string) => Promise<boolean>;
  list: () => Promise<any[]>;
  get: (id: string) => Promise<any>;
  history: (id: string) => Promise<any[]>;
  create: (w: World, author: string) => Promise<any>;
  save: (id: string, w: World, head: string, author: string) => Promise<any>;
  publish: (id: string, revision: string, author: string) => Promise<any>;
}
export function createStore(url: string): Store {
  return createDatabaseStore(drizzle(neon(url)));
}
export function createDatabaseStore(db: any): Store {
  return {
    async isAdmin(id) {
      return (
        (
          await db
            .select()
            .from(admins)
            .where(and(eq(admins.userId, id), eq(admins.enabled, true)))
        ).length === 1
      );
    },
    async list() {
      return db.select().from(worlds).orderBy(desc(worlds.createdAt));
    },
    async get(id) {
      const [w] = await db.select().from(worlds).where(eq(worlds.id, id));
      if (!w) return null;
      const [r] = await db.select().from(revisions).where(eq(revisions.id, w.head));
      return {
        ...w,
        document: r.document,
        revision: r.id,
        parent: r.parent,
        revisionAuthor: r.author,
      };
    },
    async history(id) {
      return db
        .select()
        .from(revisions)
        .where(eq(revisions.worldId, id))
        .orderBy(desc(revisions.createdAt));
    },
    async create(w, author) {
      const id = crypto.randomUUID(),
        head = crypto.randomUUID();
      await db.execute(
        sql`WITH inserted AS (INSERT INTO worlds (id,title,head,author) VALUES (${id}::uuid,${w.title},${head}::uuid,${author}) RETURNING id) INSERT INTO world_revisions (id,world_id,author,document) SELECT ${head}::uuid,id,${author},${JSON.stringify(w)}::jsonb FROM inserted`,
      );
      return { id, head };
    },
    async save(id, w, head, author) {
      const next = crypto.randomUUID();
      const r = await db.execute(
        sql`WITH claimed AS (UPDATE worlds SET head=${next}::uuid,title=${w.title} WHERE id=${id}::uuid AND head=${head}::uuid RETURNING id), added AS (INSERT INTO world_revisions (id,world_id,parent,author,document) SELECT ${next}::uuid,id,${head}::uuid,${author},${JSON.stringify(w)}::jsonb FROM claimed RETURNING id) SELECT id FROM added`,
      );
      return r.rows.length ? { id, head: next } : null;
    },
    async publish(id, revision, author) {
      const publication = crypto.randomUUID();
      const r = await db.execute(
        sql`INSERT INTO world_publications(id,world_id,revision_id,author) SELECT ${publication}::uuid,world_id,id,${author} FROM world_revisions WHERE world_id=${id}::uuid AND id=${revision}::uuid RETURNING id`,
      );
      return r.rows[0] || null;
    },
  };
}
