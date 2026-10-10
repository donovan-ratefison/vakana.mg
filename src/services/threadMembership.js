// Read-only helpers for "how many user threads does this entry belong to?"
// and "which user threads (with their bead-chain preview)?".
//
// An entry can be referenced by a thread two ways:
//   - thread_beads.entry_id: the entry is a live bead on a thread chain.
//   - entry_thread_links.entry_id: the entry is cross-referenced from a
//     thread (the "Mentions" section in the entry editor) without being
//     on its bead chain.
// We count the DISTINCT union per entry so an entry that appears as both
// a bead and a cross-reference on the same thread is counted once.
//
// **Auto-threads are excluded.** Every entry sits on at least an auto_day
// thread (and possibly auto_week / auto_month if highlighted), so counting
// those would make the chip read 1+ on essentially every entry, which is
// noise. The chip is meant to surface deliberate weaving, so we restrict
// to threads.kind = 'user'.

import { getDb } from '../database/db';

export async function loadThreadCountsForEntries(entryIds = []) {
  if (!entryIds.length) return {};
  const db = getDb();
  if (!db) return {};
  const placeholders = entryIds.map(() => '?').join(',');
  const rows = await db.getAllAsync(
    `SELECT entry_id, COUNT(*) AS count FROM (
       SELECT DISTINCT tb.entry_id, tb.thread_id
         FROM thread_beads tb
         JOIN threads t ON t.id = tb.thread_id
        WHERE tb.entry_id IN (${placeholders})
          AND t.kind = 'user'
       UNION
       SELECT DISTINCT etl.entry_id, etl.thread_id
         FROM entry_thread_links etl
         JOIN threads t ON t.id = etl.thread_id
        WHERE etl.entry_id IN (${placeholders})
          AND t.kind = 'user'
     )
     GROUP BY entry_id`,
    [...entryIds, ...entryIds]
  );
  const map = {};
  for (const r of rows) map[r.entry_id] = r.count;
  return map;
}

// Batched "which user threads is this entry's BEAD strung on?" Names
// only, no chain preview, one query for the whole filtered page.
//
// Scoped to thread_beads (NOT mentions): the question this answers is the
// disambiguation one ("in the bead search, whose bead is this?"), and a
// bead's locus is the chain it's strung on, not a soft cross-reference.
// Mentions still surface in the tap-to-expand block (loadThreadsForEntry).
// Auto-threads excluded for the same reason as loadThreadCountsForEntries.
// Per-entry rows are name-sorted (COLLATE NOCASE) so the inline strip's
// first-two-then-+N is stable.
export async function loadBeadThreadNamesForEntries(entryIds = []) {
  if (!entryIds.length) return {};
  const db = getDb();
  if (!db) return {};
  const placeholders = entryIds.map(() => '?').join(',');
  const rows = await db.getAllAsync(
    `SELECT DISTINCT tb.entry_id AS entry_id, t.id AS thread_id, t.name AS name
       FROM thread_beads tb
       JOIN threads t ON t.id = tb.thread_id
      WHERE tb.entry_id IN (${placeholders})
        AND t.kind = 'user'
      ORDER BY tb.entry_id, t.name COLLATE NOCASE ASC`,
    entryIds
  );
  const map = {};
  for (const r of rows) {
    (map[r.entry_id] || (map[r.entry_id] = [])).push({
      id: r.thread_id,
      name: r.name,
    });
  }
  return map;
}

// Returns the user threads an entry is part of, each carrying the full
// bead-chain snapshot (same shape as ThreadCard's `preview`). Used by the
// EntryCard inline preview that expands when the user taps the thread chip.
//
// Threads where the entry is only a Mention (no bead row) are included
// too: the chain is rendered as-is and the entry simply doesn't appear
// inside it. Ordered by thread name for a stable display.
export async function loadThreadsForEntry(entryId) {
  if (!entryId) return [];
  const db = getDb();
  if (!db) return [];
  const threads = await db.getAllAsync(
    `SELECT DISTINCT t.id, t.name
       FROM threads t
       LEFT JOIN thread_beads tb ON tb.thread_id = t.id AND tb.entry_id = ?
       LEFT JOIN entry_thread_links etl ON etl.thread_id = t.id AND etl.entry_id = ?
      WHERE t.kind = 'user'
        AND (tb.id IS NOT NULL OR etl.id IS NOT NULL)
      ORDER BY t.name COLLATE NOCASE ASC`,
    [entryId, entryId]
  );
  const out = [];
  for (const t of threads) {
    const beads = await db.getAllAsync(
      `SELECT tb.*, e.bead_shape, e.bead_pattern, e.bead_mood, e.bead_glyph
         FROM thread_beads tb
         LEFT JOIN entries e ON e.id = tb.entry_id
        WHERE tb.thread_id = ?
        ORDER BY tb.position ASC`,
      [t.id]
    );
    out.push({ id: t.id, name: t.name, preview: beads });
  }
  return out;
}

// "Mentioned by": the inbound half of the mention primitive. The editor's
// Mentions section is outbound (this entry → these threads); this is the
// reverse read: every entry whose editor cross-references THIS thread
// (entry_thread_links.thread_id = ?), whether or not its bead is on the
// chain. The backlink that makes mention a two-ended bibliography.
//
// Uses idx_entry_thread_links_thread (thread_id is indexed) so the lookup
// is O(log n). GROUP BY e.id collapses any duplicate link row so an entry
// is exactly one backlink. Newest citation first: a backlink list reads
// most-recent-first, like org-roam's backlink buffer. Carries bead_* +
// is_private so the drawer row can render the live bead and mask private
// titles. Only kind='user' threads ever accrue these (the mention picker
// is user-only), so no auto-thread special-casing is needed here.
export async function loadMentioningEntriesForThread(threadId) {
  if (threadId == null) return [];
  const db = getDb();
  if (!db) return [];
  return db.getAllAsync(
    `SELECT e.id, e.title, e.date, e.is_private,
            e.bead_shape, e.bead_pattern, e.bead_mood, e.bead_glyph
       FROM entry_thread_links etl
       JOIN entries e ON e.id = etl.entry_id
      WHERE etl.thread_id = ?
      GROUP BY e.id
      ORDER BY e.date DESC, e.id DESC`,
    [threadId]
  );
}
