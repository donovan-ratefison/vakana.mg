// Bead presets service: the macro/snippet layer over the bead
// vocabulary. A preset is a named, reusable {shape,pattern,mood,glyph}
// the user composes once and recalls in BeadComposer. Presets are
// independent of entries (no FK): deleting an entry or preset never
// touches the other. `last_used_at` is bumped on recall so the recents
// strip surfaces whatever rhythm the user is currently in.
//
// Screens/components must route through this service rather than running
// SQL against `bead_presets` inline (services-layer convention).

import { getDb } from '../database/db';

// Recently-used first (the cadence you're in floats up), then
// never-used, then newest. In SQLite NULLs sort last under DESC, so
// untouched presets fall below used ones automatically.
export async function listBeadPresets() {
  const db = getDb();
  if (!db) return [];
  return db.getAllAsync(
    `SELECT id, name, shape, pattern, mood, glyph
       FROM bead_presets
      ORDER BY last_used_at DESC, created_at DESC`
  );
}

// Create a named preset from a composed bead. `name` is trimmed; an
// empty name is rejected (returns null) so the strip never shows a
// blank chip. Returns the new row id on success.
export async function createBeadPreset({ name, shape, pattern, mood, glyph }) {
  const db = getDb();
  if (!db) return null;
  const trimmed = (name || '').trim();
  if (!trimmed || !shape) return null;
  const result = await db.runAsync(
    `INSERT INTO bead_presets (name, shape, pattern, mood, glyph)
     VALUES (?, ?, ?, ?, ?)`,
    [
      trimmed,
      shape,
      pattern || 'solid',
      mood || 'slate',
      glyph || '',
    ]
  );
  return result.lastInsertRowId;
}

export async function deleteBeadPreset(id) {
  const db = getDb();
  if (!db || id == null) return;
  await db.runAsync('DELETE FROM bead_presets WHERE id = ?', [id]);
}

// Bump recency on recall so listBeadPresets() floats this preset up.
// Fire-and-forget from the caller: ordering is cosmetic, not critical.
export async function touchBeadPreset(id) {
  const db = getDb();
  if (!db || id == null) return;
  await db.runAsync(
    "UPDATE bead_presets SET last_used_at = datetime('now') WHERE id = ?",
    [id]
  );
}

// A bead has no preset_id on entries: it's stored by value. So "which
// entries use this bead" has one honest answer: facet-equality. In an
// encoding system two identical {shape,pattern,mood,glyph} ARE the same
// symbol; that's the premise, not a false positive. Entry bead columns
// are nullable (legacy rows), so the entry side is normalised the same
// way readBead() does (pattern→solid, mood→slate, glyph→''); the `from`
// tuple comes off a preset row so it's already complete.
function normTuple(b) {
  return {
    shape: b.shape,
    pattern: b.pattern || 'solid',
    mood: b.mood || 'slate',
    glyph: b.glyph || '',
  };
}

// Count of past entries whose bead equals this tuple. Drives the
// reshape confirm ("on N past entries"). Counted before the Alert so the
// user is never blind-firing a history rewrite.
export async function countEntriesWithBead(from) {
  const db = getDb();
  if (!db || !from || !from.shape) return 0;
  const t = normTuple(from);
  const row = await db.getFirstAsync(
    `SELECT COUNT(*) AS n FROM entries
       WHERE bead_shape = ?
         AND IFNULL(bead_pattern, 'solid') = ?
         AND IFNULL(bead_mood, 'slate') = ?
         AND IFNULL(bead_glyph, '') = ?`,
    [t.shape, t.pattern, t.mood, t.glyph]
  );
  return row?.n ?? 0;
}

// Most-recent strictly-older entry whose bead equals this tuple. Drives
// R1's echo chip in the editor meta strip: one tap walks the chain
// *backward in time* (return-to-the-past, what the ⤺ arrow means),
// so successive taps cannot ping-pong between two adjacent occurrences.
// Facet-equality (normTuple), not fuzzy match: the same identity contract
// as S14's reshape.
//
// `before` is either `{ entryId, date }` for a saved entry or
// `{ entryId: null, date }` for a brand-new unsaved one (its date is
// still load-bearing: the chip should respect a user-picked past date).
// `null` falls back to "most recent overall" (no current locus at all).
export async function getLatestEntryWithBead(from, before) {
  const db = getDb();
  if (!db || !from || !from.shape) return null;
  const t = normTuple(from);
  const params = [t.shape, t.pattern, t.mood, t.glyph];
  let beforeClause = '';
  if (before && before.date) {
    if (before.entryId != null) {
      // Saved entry: strictly older than (date, id). Using id as the
      // same-date tiebreaker assumes id is monotonic with creation.
      // SQLite rowid AUTOINCREMENT gives us that for free.
      beforeClause = ' AND (date < ? OR (date = ? AND id < ?))';
      params.push(before.date, before.date, before.entryId);
    } else {
      // Unsaved entry: no row yet, so no self to exclude. Cap only
      // by the user-picked date.
      beforeClause = ' AND date <= ?';
      params.push(before.date);
    }
  }
  const row = await db.getFirstAsync(
    `SELECT id, date, title FROM entries
       WHERE bead_shape = ?
         AND IFNULL(bead_pattern, 'solid') = ?
         AND IFNULL(bead_mood, 'slate') = ?
         AND IFNULL(bead_glyph, '') = ?
         ${beforeClause}
       ORDER BY date DESC, created_at DESC
       LIMIT 1`,
    params
  );
  return row || null;
}

// Reshape a saved bead: Emacs `query-replace` over the journal, not a
// foreign-key reference model (that would retro-mutate the past
// coercively and split the renderer). The preset row's facets always
// move (so future picks stamp the new shape). When `rewritePast` is
// true, every past entry whose bead equals `from` is rewritten to `to`,
// AND every matching `thread_beads` snapshot (including the deliberately
// *frozen* ones) travels with it (the maker's "everything travels"
// call; the documented frozen-snapshot guarantee is amended to carve out
// this one user-invoked global rewrite; see beads-and-threads.md).
//
// No autoThread re-sync: the chain renderer prefers the live bead
// (beads-and-threads.md), so rewriting `entries` already makes every
// live day/week/month chain follow; membership and the
// `YYYYMMDD×1e6+id` position are invariant under a facet-only change.
// The thread_beads UPDATE is purely what makes the faded *ghost*
// snapshots travel too. (A `from` tuple byte-identical to a weekday
// placeholder would also rewrite that placeholder. This is accepted and
// consistent with "value-equality is identity", not special-cased.)
//
// `name` is optional and propagation-free: entries never stored the
// preset's name, only its facets, so a rename is a pure label edit with
// no history impact. The whole batch is one transaction: a partial
// history rewrite would be worse than none, and there is no undo.
export async function reshapeBeadAcrossHistory({
  presetId,
  name,
  from,
  to,
  rewritePast,
}) {
  const db = getDb();
  if (!db || presetId == null || !to || !to.shape) return { entryCount: 0 };
  const t = normTuple(to);
  const trimmedName = name == null ? null : String(name).trim() || null;

  if (!rewritePast) {
    await db.runAsync(
      `UPDATE bead_presets
          SET name = COALESCE(?, name),
              shape = ?, pattern = ?, mood = ?, glyph = ?
        WHERE id = ?`,
      [trimmedName, t.shape, t.pattern, t.mood, t.glyph, presetId]
    );
    return { entryCount: 0 };
  }

  const f = normTuple(from);
  let entryCount = 0;
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE bead_presets
          SET name = COALESCE(?, name),
              shape = ?, pattern = ?, mood = ?, glyph = ?
        WHERE id = ?`,
      [trimmedName, t.shape, t.pattern, t.mood, t.glyph, presetId]
    );
    const res = await db.runAsync(
      `UPDATE entries
          SET bead_shape = ?, bead_pattern = ?, bead_mood = ?,
              bead_glyph = ?, updated_at = datetime('now')
        WHERE bead_shape = ?
          AND IFNULL(bead_pattern, 'solid') = ?
          AND IFNULL(bead_mood, 'slate') = ?
          AND IFNULL(bead_glyph, '') = ?`,
      [
        t.shape, t.pattern, t.mood, t.glyph,
        f.shape, f.pattern, f.mood, f.glyph,
      ]
    );
    entryCount = res?.changes ?? 0;
    await db.runAsync(
      `UPDATE thread_beads
          SET snapshot_shape = ?, snapshot_pattern = ?,
              snapshot_mood = ?, snapshot_glyph = ?
        WHERE snapshot_shape = ?
          AND snapshot_pattern = ?
          AND snapshot_mood = ?
          AND snapshot_glyph = ?`,
      [
        t.shape, t.pattern, t.mood, t.glyph,
        f.shape, f.pattern, f.mood, f.glyph,
      ]
    );
  });
  return { entryCount };
}
