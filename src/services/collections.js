// Collections service. Threads belong to zero, one, or many collections via
// the `thread_collection_links` junction table. The legacy
// `threads.collection_id` column is no longer authoritative: this module
// reads and writes the junction exclusively. The column stays around as a
// migration artifact (see ensureThreadCollectionLinks in db.js).

import { getDb } from '../database/db';

export async function loadCollections() {
  const db = getDb();
  if (!db) return [];
  return db.getAllAsync(
    'SELECT * FROM thread_collections ORDER BY name COLLATE NOCASE ASC'
  );
}

// Collections a single thread belongs to (full rows, name-sorted).
export async function loadCollectionsForThread(threadId) {
  if (threadId == null) return [];
  const db = getDb();
  if (!db) return [];
  return db.getAllAsync(
    `SELECT c.*
       FROM thread_collections c
       JOIN thread_collection_links l ON l.collection_id = c.id
      WHERE l.thread_id = ?
      ORDER BY c.name COLLATE NOCASE ASC`,
    [threadId]
  );
}

// Set of collection ids the thread is in. A convenience for picker UIs that
// need quick membership lookups.
export async function loadThreadCollectionIdSet(threadId) {
  if (threadId == null) return new Set();
  const db = getDb();
  if (!db) return new Set();
  const rows = await db.getAllAsync(
    'SELECT collection_id FROM thread_collection_links WHERE thread_id = ?',
    [threadId]
  );
  return new Set(rows.map((r) => r.collection_id));
}

export async function addThreadToCollection(threadId, collectionId) {
  if (threadId == null || collectionId == null) return;
  const db = getDb();
  if (!db) return;
  await db.runAsync(
    `INSERT OR IGNORE INTO thread_collection_links (thread_id, collection_id)
     VALUES (?, ?)`,
    [threadId, collectionId]
  );
  await db.runAsync(
    `UPDATE threads SET updated_at = datetime('now') WHERE id = ?`,
    [threadId]
  );
}

export async function removeThreadFromCollection(threadId, collectionId) {
  if (threadId == null || collectionId == null) return;
  const db = getDb();
  if (!db) return;
  await db.runAsync(
    `DELETE FROM thread_collection_links
       WHERE thread_id = ? AND collection_id = ?`,
    [threadId, collectionId]
  );
  await db.runAsync(
    `UPDATE threads SET updated_at = datetime('now') WHERE id = ?`,
    [threadId]
  );
}

// Number of threads currently in a collection. Used by the delete-confirm
// dialog so the user knows how many threads will be unassigned.
export async function countThreadsInCollection(collectionId) {
  if (collectionId == null) return 0;
  const db = getDb();
  if (!db) return 0;
  const row = await db.getFirstAsync(
    'SELECT COUNT(*) AS n FROM thread_collection_links WHERE collection_id = ?',
    [collectionId]
  );
  return row?.n ?? 0;
}

// One-shot membership counts for every collection: `{ [collectionId]: n }`.
// Used by the collection filter sheet so picking a collection out of a long
// list doesn't fire N separate COUNT(*) queries (one GROUP BY instead).
// Collections with zero threads simply don't appear in the map (callers
// treat a missing key as 0).
export async function loadCollectionThreadCounts() {
  const db = getDb();
  if (!db) return {};
  const rows = await db.getAllAsync(
    `SELECT collection_id AS id, COUNT(*) AS n
       FROM thread_collection_links
      GROUP BY collection_id`
  );
  const map = {};
  for (const r of rows) map[r.id] = r.n;
  return map;
}

// Delete a collection. The junction's ON DELETE CASCADE wipes the link
// rows automatically, so member threads are silently unassigned. They
// stay in place and only lose this membership.
export async function deleteCollection(collectionId) {
  if (collectionId == null) return;
  const db = getDb();
  if (!db) return;
  await db.runAsync('DELETE FROM thread_collections WHERE id = ?', [
    collectionId,
  ]);
}

// Create a new collection and immediately add the given thread to it.
// Returns the new collection id, or null on failure.
export async function createCollectionAndAssignThread(name, threadId) {
  const db = getDb();
  if (!db) return null;
  const trimmed = (name || '').trim();
  if (!trimmed) return null;
  const result = await db.runAsync(
    'INSERT INTO thread_collections (name) VALUES (?)',
    [trimmed]
  );
  const newId = result.lastInsertRowId;
  if (threadId != null && newId != null) {
    await addThreadToCollection(threadId, newId);
  }
  return newId;
}
