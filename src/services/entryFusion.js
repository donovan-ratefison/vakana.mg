// Fuse multiple entries into one. Fully destructive: source entries are
// replaced by a single new entry that inherits the union of their photos,
// voice notes, and comments, the concatenation of their bodies, and a
// computed "alchemy bead" derived from the contributors' shape / pattern /
// mood by majority vote.
//
// Auto-threads: source beads are removed (the auto-thread will prune if
// emptied), then the new entry syncs in normally.
// User threads: any thread that contained a source's bead has its source
// beads replaced by ONE new bead at the earliest source position, then
// positions are renumbered to close the gap. This collapses the thread
// chain consistently with the entry-fusion semantics: if you fused 5
// quick captures that were all on a "morning at the cafe" thread, the
// thread keeps one bead from that morning, not 5 faded ghosts.
//
// Comments on source entries (`parent_kind='entry'`, `parent_id=sourceId`)
// are re-parented to the new entry so the history isn't lost.

import { getDb } from '../database/db';
import { DEFAULT_BEAD, hasBead, readBead } from '../beads/types';
import {
  syncAutoBeadForEntry,
  removeAutoBeadForEntry,
} from './autoThread';

const BODY_SEPARATOR = '\n\n---\n\n';

function modeOf(values) {
  // Returns the most-common value; ties broken by first occurrence in the
  // input array, matching the user-visible source ordering (chronological).
  const counts = new Map();
  let bestVal = null;
  let bestCount = 0;
  for (const v of values) {
    if (v == null || v === '') continue;
    const c = (counts.get(v) || 0) + 1;
    counts.set(v, c);
    if (c > bestCount) {
      bestCount = c;
      bestVal = v;
    }
  }
  return bestVal;
}

export function computeFusedBead(beads) {
  if (!Array.isArray(beads)) return { ...DEFAULT_BEAD };
  const live = beads.filter(Boolean);
  if (live.length === 0) return { ...DEFAULT_BEAD };
  return {
    shape: modeOf(live.map((b) => b.shape)) || DEFAULT_BEAD.shape,
    pattern: modeOf(live.map((b) => b.pattern)) || DEFAULT_BEAD.pattern,
    mood: modeOf(live.map((b) => b.mood)) || DEFAULT_BEAD.mood,
    // Glyph deliberately blank: the fused bead is the alchemy result, and the
    // user can override in the FuseSheet preview before confirming.
    glyph: '',
  };
}

function chronologicalCompare(a, b) {
  // Sort by date string then created_at. This keeps the visible list order.
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const aCa = a.created_at || '';
  const bCa = b.created_at || '';
  if (aCa === bCa) return a.id - b.id;
  return aCa < bCa ? -1 : 1;
}

// Load the data needed to preview a fusion. Returns null if any source id
// is invalid (caller surfaces this as a user-facing error).
export async function loadFusePreview(entryIds) {
  if (!Array.isArray(entryIds) || entryIds.length < 2) return null;
  const db = getDb();
  if (!db) return null;

  const placeholders = entryIds.map(() => '?').join(',');
  const rows = await db.getAllAsync(
    `SELECT * FROM entries WHERE id IN (${placeholders})`,
    entryIds
  );
  if (rows.length !== entryIds.length) return null;

  rows.sort(chronologicalCompare);

  const photoRows = await db.getAllAsync(
    `SELECT entry_id, uri FROM entry_photos
       WHERE entry_id IN (${placeholders})
       ORDER BY entry_id, id ASC`,
    entryIds
  );
  const voiceRows = await db.getAllAsync(
    `SELECT entry_id, uri, duration FROM entry_voice_notes
       WHERE entry_id IN (${placeholders})
       ORDER BY entry_id, id ASC`,
    entryIds
  );

  // Group attachments by entry, then flatten in chronological-source order.
  const photosByEntry = new Map();
  for (const p of photoRows) {
    if (!photosByEntry.has(p.entry_id)) photosByEntry.set(p.entry_id, []);
    photosByEntry.get(p.entry_id).push(p.uri);
  }
  const voiceByEntry = new Map();
  for (const v of voiceRows) {
    if (!voiceByEntry.has(v.entry_id)) voiceByEntry.set(v.entry_id, []);
    voiceByEntry.get(v.entry_id).push({ uri: v.uri, duration: v.duration });
  }

  const photos = [];
  const voiceNotes = [];
  for (const r of rows) {
    for (const uri of photosByEntry.get(r.id) || []) photos.push(uri);
    for (const v of voiceByEntry.get(r.id) || []) voiceNotes.push(v);
  }

  const beads = rows.map((r) => readBead(r));
  const fusedBead = computeFusedBead(beads);

  const titleDefault = (rows[0]?.title || '').trim();
  const dateDefault = rows[0]?.date || '';
  const createdAtDefault = rows[0]?.created_at || null;
  const bodyDefault = rows
    .map((r) => (r.content || '').trim())
    .filter(Boolean)
    .join(BODY_SEPARATOR);

  return {
    sources: rows,
    photos,
    voiceNotes,
    fusedBead,
    titleDefault,
    dateDefault,
    createdAtDefault,
    bodyDefault,
  };
}

// Execute the fusion. `overrides` may carry { title, bead } to use the
// composer's user-edited values; everything else is recomputed from sources
// to ensure consistency.
export async function fuseEntries(entryIds, overrides = {}) {
  if (!Array.isArray(entryIds) || entryIds.length < 2) {
    throw new Error('Need at least two entries to fuse');
  }
  const db = getDb();
  if (!db) throw new Error('Database not ready');

  const preview = await loadFusePreview(entryIds);
  if (!preview) throw new Error('Could not load source entries');

  const sourceIds = preview.sources.map((s) => s.id);
  const placeholders = sourceIds.map(() => '?').join(',');

  const titleToSave = (overrides.title || preview.titleDefault || '').trim();
  const bead = overrides.bead || preview.fusedBead;
  const dateStr = preview.dateDefault;
  const body = preview.bodyDefault;

  // 1. Insert the new entry. Use the earliest source's created_at so the
  //    fused entry sorts back to the start of its quick-capture burst.
  const createdAt = preview.createdAtDefault;
  let newId;
  if (createdAt) {
    const result = await db.runAsync(
      `INSERT INTO entries
         (title, content, date, created_at, updated_at,
          bead_shape, bead_pattern, bead_mood, bead_glyph)
       VALUES (?, ?, ?, ?, datetime('now'), ?, ?, ?, ?)`,
      [
        titleToSave,
        body,
        dateStr,
        createdAt,
        bead.shape,
        bead.pattern || 'solid',
        bead.mood || 'slate',
        bead.glyph || '',
      ]
    );
    newId = result.lastInsertRowId;
  } else {
    const result = await db.runAsync(
      `INSERT INTO entries
         (title, content, date, bead_shape, bead_pattern, bead_mood, bead_glyph)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        titleToSave,
        body,
        dateStr,
        bead.shape,
        bead.pattern || 'solid',
        bead.mood || 'slate',
        bead.glyph || '',
      ]
    );
    newId = result.lastInsertRowId;
  }

  // 2. Copy photo URIs (union, in chronological-source order).
  for (const uri of preview.photos) {
    await db.runAsync(
      'INSERT INTO entry_photos (entry_id, uri) VALUES (?, ?)',
      [newId, uri]
    );
  }
  // 3. Copy voice notes.
  for (const v of preview.voiceNotes) {
    await db.runAsync(
      'INSERT INTO entry_voice_notes (entry_id, uri, duration) VALUES (?, ?, ?)',
      [newId, v.uri, v.duration || 0]
    );
  }

  // 4. Re-parent comments to the new entry. Polymorphic table; no FK to
  //    fight. parent_kind='entry' filter avoids touching comments that
  //    happen to share an id with one of our entries on threads/reminders.
  await db.runAsync(
    `UPDATE comments
        SET parent_id = ?, updated_at = datetime('now')
      WHERE parent_kind = 'entry' AND parent_id IN (${placeholders})`,
    [newId, ...sourceIds]
  );

  // 5. Collapse source beads inside any user thread into a single new bead
  //    at the earliest source-bead position. Auto-threads are skipped here:
  //    removeAutoBeadForEntry handles them next.
  const userThreadBeadRows = await db.getAllAsync(
    `SELECT tb.id, tb.thread_id, tb.position, tb.entry_id
       FROM thread_beads tb
       JOIN threads t ON t.id = tb.thread_id
      WHERE t.kind = 'user' AND tb.entry_id IN (${placeholders})
      ORDER BY tb.thread_id, tb.position ASC`,
    sourceIds
  );
  const affectedThreadIds = Array.from(
    new Set(userThreadBeadRows.map((r) => r.thread_id))
  );
  for (const tid of affectedThreadIds) {
    const inThread = userThreadBeadRows.filter((r) => r.thread_id === tid);
    const earliestPosition = inThread[0].position;
    await db.runAsync(
      `DELETE FROM thread_beads
        WHERE thread_id = ? AND entry_id IN (${placeholders})`,
      [tid, ...sourceIds]
    );
    await db.runAsync(
      `INSERT INTO thread_beads
         (thread_id, entry_id, position,
          snapshot_shape, snapshot_pattern, snapshot_mood, snapshot_glyph)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        tid,
        newId,
        earliestPosition,
        bead.shape,
        bead.pattern || 'solid',
        bead.mood || 'slate',
        bead.glyph || '',
      ]
    );
    // Renumber positions 0..N-1 to close gaps and keep the chain dense.
    const remaining = await db.getAllAsync(
      `SELECT id FROM thread_beads WHERE thread_id = ? ORDER BY position ASC`,
      [tid]
    );
    for (let i = 0; i < remaining.length; i++) {
      await db.runAsync(
        `UPDATE thread_beads SET position = ? WHERE id = ?`,
        [i, remaining[i].id]
      );
    }
    await db.runAsync(
      `UPDATE threads SET updated_at = datetime('now') WHERE id = ?`,
      [tid]
    );
  }

  // 6. Strip auto-thread beads for every source. Each call also prunes the
  //    auto-thread if it becomes empty. The new entry's auto-bead is
  //    written at the end.
  for (const id of sourceIds) {
    await removeAutoBeadForEntry(id);
  }

  // 7. Delete sources. ON DELETE CASCADE wipes entry_photos / voice rows
  //    (we already copied them onto the new id) and entry_thread_links.
  //    SET NULL on any leftover thread_beads (shouldn't happen: we
  //    handled user threads above and removed auto rows in step 6).
  await db.runAsync(
    `DELETE FROM entries WHERE id IN (${placeholders})`,
    sourceIds
  );

  // 8. Sync the new entry into its auto-thread for the day.
  await syncAutoBeadForEntry({
    id: newId,
    date: dateStr,
    bead_shape: bead.shape,
    bead_pattern: bead.pattern || 'solid',
    bead_mood: bead.mood || 'slate',
    bead_glyph: bead.glyph || '',
  });

  return newId;
}

// --- Threading multiple entries -----------------------------------------
//
// Non-destructive sibling to fuseEntries: keep all source entries in
// place but string their beads onto a single user thread. Used by the
// "Thread" action in the home multi-select bar and by the burst banner's
// "Thread these" path.
//
// For each entry that has no bead yet (typical of quick-capture rows),
// `DEFAULT_BEAD` is written onto the entry first so the thread snapshot
// has something real to capture. The thread's chain receives one new
// bead per entry, appended at the end in chronological order.

export async function addEntriesToThread(entryIds, threadId) {
  if (!Array.isArray(entryIds) || entryIds.length === 0) return;
  if (threadId == null) throw new Error('threadId required');
  const db = getDb();
  if (!db) throw new Error('Database not ready');

  const placeholders = entryIds.map(() => '?').join(',');
  const rows = await db.getAllAsync(
    `SELECT * FROM entries WHERE id IN (${placeholders})`,
    entryIds
  );
  rows.sort(chronologicalCompare);

  // Materialize a bead onto any source that lacks one. The auto-thread
  // gets re-synced for these too so today's chain stays consistent.
  for (const r of rows) {
    if (hasBead(r)) continue;
    await db.runAsync(
      `UPDATE entries
          SET bead_shape = ?, bead_pattern = ?, bead_mood = ?, bead_glyph = ?,
              updated_at = datetime('now')
        WHERE id = ?`,
      [
        DEFAULT_BEAD.shape,
        DEFAULT_BEAD.pattern,
        DEFAULT_BEAD.mood,
        DEFAULT_BEAD.glyph,
        r.id,
      ]
    );
    r.bead_shape = DEFAULT_BEAD.shape;
    r.bead_pattern = DEFAULT_BEAD.pattern;
    r.bead_mood = DEFAULT_BEAD.mood;
    r.bead_glyph = DEFAULT_BEAD.glyph;
    await syncAutoBeadForEntry(r);
  }

  // Append to the existing chain.
  const maxRow = await db.getFirstAsync(
    'SELECT COALESCE(MAX(position), -1) AS maxPos FROM thread_beads WHERE thread_id = ?',
    [threadId]
  );
  let nextPos = (maxRow?.maxPos ?? -1) + 1;
  for (const r of rows) {
    const bead = readBead(r);
    if (!bead) continue; // shouldn't happen: we just ensured it above
    await db.runAsync(
      `INSERT INTO thread_beads
         (thread_id, entry_id, position,
          snapshot_shape, snapshot_pattern, snapshot_mood, snapshot_glyph)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        threadId,
        r.id,
        nextPos,
        bead.shape,
        bead.pattern || 'solid',
        bead.mood || 'slate',
        bead.glyph || '',
      ]
    );
    nextPos += 1;
  }
  await db.runAsync(
    `UPDATE threads SET updated_at = datetime('now') WHERE id = ?`,
    [threadId]
  );
}
