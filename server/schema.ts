import { pgTable, text, uuid, jsonb, timestamp, boolean } from 'drizzle-orm/pg-core';
export const admins = pgTable('world_admins', {
  userId: text('user_id').primaryKey(),
  enabled: boolean('enabled').notNull().default(true),
});
export const worlds = pgTable('worlds', {
  id: uuid('id').primaryKey(),
  title: text('title').notNull(),
  head: uuid('head').notNull(),
  author: text('author').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
export const revisions = pgTable('world_revisions', {
  id: uuid('id').primaryKey(),
  worldId: uuid('world_id')
    .notNull()
    .references(() => worlds.id),
  parent: uuid('parent'),
  author: text('author').notNull(),
  document: jsonb('document').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
export const publications = pgTable('world_publications', {
  id: uuid('id').primaryKey(),
  worldId: uuid('world_id')
    .notNull()
    .references(() => worlds.id),
  revisionId: uuid('revision_id')
    .notNull()
    .references(() => revisions.id),
  author: text('author').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
