import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/pglite';
import { createDatabaseStore } from '../server/store';
import { world } from './helpers';
test('Actual Drizzle store transactions preserve CAS, complete JSON, authors and publication ownership', async () => {
  const db = new PGlite();
  try {
    await db.exec(readFileSync('migrations/0001_worlds.sql', 'utf8'));
    const store = createDatabaseStore(drizzle(db)),
      w = world();
    await db.query('INSERT INTO world_admins(user_id) VALUES ($1)', ['admin']);
    assert.equal(await store.isAdmin('admin'), true);
    assert.equal(await store.isAdmin('learner'), false);
    const a = await store.create(w, 'admin');
    assert.equal((await store.get(a.id)).id, a.id);
    assert.deepEqual((await store.get(a.id)).document, w);
    const next = { ...w, title: 'changed' };
    const concurrent = await Promise.all([
      store.save(a.id, next, a.head, 'editor1'),
      store.save(a.id, next, a.head, 'editor2'),
    ]);
    assert.equal(concurrent.filter(Boolean).length, 1);
    const history = await store.history(a.id);
    assert.equal(history.length, 2);
    assert.equal(history[0].parent, a.head);
    assert.ok(['editor1', 'editor2'].includes(history[0].author));
    const b = await store.create(w, 'admin');
    assert.equal(await store.publish(a.id, b.head, 'admin'), null);
    assert.ok(await store.publish(a.id, history[0].id, 'admin'));
    assert.equal((await store.history(a.id)).length, 2);
  } finally {
    await db.close();
  }
});
test('Migration enforces immutable history and publication, fresh users are not admins', async () => {
  const db = new PGlite();
  try {
    await db.exec(readFileSync('migrations/0001_worlds.sql', 'utf8'));
    assert.equal((await db.query('SELECT * FROM world_admins')).rows.length, 0);
    const wid = '11111111-1111-4111-8111-111111111111',
      rev = '22222222-2222-4222-8222-222222222222';
    await db.query('INSERT INTO worlds(id,title,head,author) VALUES($1,$2,$3,$4)', [
      wid,
      'test',
      rev,
      'admin',
    ]);
    await db.query('INSERT INTO world_revisions(id,world_id,author,document) VALUES($1,$2,$3,$4)', [
      rev,
      wid,
      'admin',
      '{}',
    ]);
    await assert.rejects(
      db.query('UPDATE world_revisions SET author=$1 WHERE id=$2', ['intruder', rev]),
      /immutable/,
    );
    await assert.rejects(db.query('DELETE FROM world_revisions WHERE id=$1', [rev]), /immutable/);
    await db.query(
      'INSERT INTO world_publications(id,world_id,revision_id,author) VALUES($1,$2,$3,$4)',
      [rev, wid, rev, 'admin'],
    );
    await assert.rejects(db.query('DELETE FROM world_publications'), /immutable/);
    const r = await db.query('UPDATE worlds SET title=$1 WHERE id=$2 AND head=$3 RETURNING id', [
      'bad overwrite',
      wid,
      wid,
    ]);
    assert.equal(r.rows.length, 0);
  } finally {
    await db.close();
  }
});
