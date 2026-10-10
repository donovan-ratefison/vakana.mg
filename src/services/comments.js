// Comments service (N14 + N15).
//
// Comments are polymorphic: `parent_kind` ∈ {entry, thread, reminder}, with
// `parent_id` interpreted in that namespace. There's no FK because SQLite
// can't express "FK whose target table depends on another column"; cleanup
// on parent delete is handled here via removeCommentsForParent, which the
// entry / thread / reminder delete paths call before issuing their DELETE.
//
// Comment-reminders (N15) live as nullable columns on the same row:
//   remind_at:        ISO datetime; null = plain comment
//   notification_id:  for OS-level cancel/reschedule
//   reminded_at:      set when the user acknowledges (via content edit)
//
// Note: remind_at is stored as a JS toISOString() value ('2026-…T…Z'),
// while SQLite's datetime('now') returns 'YYYY-MM-DD HH:MM:SS' (no T, no Z).
// Direct string comparison breaks because 'T' (0x54) > ' ' (0x20). Every
// remind_at <=> now comparison must wrap *both* sides in datetime() so
// SQLite parses the ISO string into a comparable timestamp.

import * as SecureStore from 'expo-secure-store';
import { getDb } from '../database/db';
import { DEFAULT_BEAD } from '../beads/types';
import {
  scheduleNotificationAt,
  cancelNotification,
  getScheduledNotificationIds,
} from '../utils/notifications';
import { syncAutoBeadForEntry } from './autoThread';
import { formatDateStr } from '../utils/dateString';

const INLINE_COMMENTS_KEY = 'vakana_inline_comments_visible';

export async function isInlineCommentsVisible() {
  try {
    const v = await SecureStore.getItemAsync(INLINE_COMMENTS_KEY);
    return v === '1'; // default OFF
  } catch {
    return false;
  }
}

export async function setInlineCommentsVisible(enabled) {
  try {
    await SecureStore.setItemAsync(INLINE_COMMENTS_KEY, enabled ? '1' : '0');
  } catch (e) {
    console.warn('setInlineCommentsVisible failed:', e?.message || e);
  }
}

export const PARENT_ENTRY = 'entry';
export const PARENT_THREAD = 'thread';
export const PARENT_REMINDER = 'reminder';

const VALID_PARENTS = new Set([PARENT_ENTRY, PARENT_THREAD, PARENT_REMINDER]);

function assertKind(kind) {
  if (!VALID_PARENTS.has(kind)) {
    throw new Error(`comments: invalid parent_kind '${kind}'`);
  }
}

// ---- Reads --------------------------------------------------------------

export async function loadComments(parentKind, parentId) {
  assertKind(parentKind);
  if (parentId == null) return [];
  const db = getDb();
  if (!db) return [];
  return db.getAllAsync(
    `SELECT * FROM comments
       WHERE parent_kind = ? AND parent_id = ?
       ORDER BY created_at ASC, id ASC`,
    [parentKind, parentId]
  );
}

export async function countComments(parentKind, parentId) {
  assertKind(parentKind);
  if (parentId == null) return 0;
  const db = getDb();
  if (!db) return 0;
  const row = await db.getFirstAsync(
    `SELECT COUNT(*) AS n FROM comments
       WHERE parent_kind = ? AND parent_id = ?`,
    [parentKind, parentId]
  );
  return row?.n ?? 0;
}

// Batch fetch the latest N comments per parent in a single query. Used by
// the inline preview block on entry list rows and thread cards. Returns
// { [parentId]: [...comments] } with comments in chronological order
// (oldest of the previewed ones first), so the row reads top-to-bottom
// like the drawer.
export async function loadCommentPreviews(parentKind, parentIds = [], perRow = 2) {
  assertKind(parentKind);
  if (!parentIds.length) return {};
  const db = getDb();
  if (!db) return {};
  const placeholders = parentIds.map(() => '?').join(', ');
  const rows = await db.getAllAsync(
    `SELECT * FROM (
       SELECT *,
              ROW_NUMBER() OVER (
                PARTITION BY parent_id
                ORDER BY created_at DESC, id DESC
              ) AS rn
         FROM comments
        WHERE parent_kind = ? AND parent_id IN (${placeholders})
     )
     WHERE rn <= ?
     ORDER BY parent_id, created_at ASC, id ASC`,
    [parentKind, ...parentIds, perRow]
  );
  const out = {};
  for (const r of rows) {
    if (!out[r.parent_id]) out[r.parent_id] = [];
    out[r.parent_id].push(r);
  }
  return out;
}

// Batch count for list rendering (entry list rows, threads list, etc.)
// Returns { [parentId]: count }.
export async function loadCommentCounts(parentKind, parentIds = []) {
  assertKind(parentKind);
  if (!parentIds.length) return {};
  const db = getDb();
  if (!db) return {};
  const placeholders = parentIds.map(() => '?').join(', ');
  const rows = await db.getAllAsync(
    `SELECT parent_id, COUNT(*) AS n FROM comments
       WHERE parent_kind = ? AND parent_id IN (${placeholders})
       GROUP BY parent_id`,
    [parentKind, ...parentIds]
  );
  const out = {};
  for (const r of rows) out[r.parent_id] = r.n;
  return out;
}

// Comments whose schedule has fired but haven't been acknowledged yet.
// Used by HomeScreen's banner derivation alongside scheduled_prompts. The
// LEFT JOINs surface a parent_label so the banner can show "Iceland trip"
// or "Tuesday's note" without a follow-up query per row.
export async function loadFiredCommentReminders() {
  const db = getDb();
  if (!db) return [];
  return db.getAllAsync(
    `SELECT c.*,
            CASE c.parent_kind
              WHEN 'entry'  THEN e.title
              WHEN 'thread' THEN t.name
            END AS parent_label
       FROM comments c
       LEFT JOIN entries e ON c.parent_kind = 'entry'  AND c.parent_id = e.id
       LEFT JOIN threads t ON c.parent_kind = 'thread' AND c.parent_id = t.id
      WHERE c.remind_at IS NOT NULL
        AND c.reminded_at IS NULL
        AND datetime(c.remind_at) <= datetime('now')
      ORDER BY c.remind_at ASC`
  );
}

// All live comment-reminders (pending OR fired-but-not-acked), with the
// parent's display label joined in for the calendar panel and for any UI
// that lists self-pings outside the home banner.
export async function loadCommentRemindersWithLabels() {
  const db = getDb();
  if (!db) return [];
  return db.getAllAsync(
    `SELECT c.id, c.parent_kind, c.parent_id, c.body,
            c.remind_at, c.reminded_at,
            CASE c.parent_kind
              WHEN 'entry'  THEN e.title
              WHEN 'thread' THEN t.name
            END AS parent_label
       FROM comments c
       LEFT JOIN entries e ON c.parent_kind = 'entry'  AND c.parent_id = e.id
       LEFT JOIN threads t ON c.parent_kind = 'thread' AND c.parent_id = t.id
      WHERE c.remind_at IS NOT NULL
        AND c.reminded_at IS NULL
      ORDER BY c.remind_at ASC`
  );
}

// Acked comment-reminders (reminded_at set), with parent labels. The
// calendar panel's "view acked" toggle reveals these struck. Unlike a
// one-shot scheduled_prompt, an acked comment-reminder was never lost
// (the comment persists in its parent's drawer); this is purely the
// symmetric panel view, so there's no restore. Tapping still routes to
// the parent where the comment lives and can be re-scheduled.
export async function loadDoneCommentRemindersWithLabels() {
  const db = getDb();
  if (!db) return [];
  return db.getAllAsync(
    `SELECT c.id, c.parent_kind, c.parent_id, c.body,
            c.remind_at, c.reminded_at,
            CASE c.parent_kind
              WHEN 'entry'  THEN e.title
              WHEN 'thread' THEN t.name
            END AS parent_label
       FROM comments c
       LEFT JOIN entries e ON c.parent_kind = 'entry'  AND c.parent_id = e.id
       LEFT JOIN threads t ON c.parent_kind = 'thread' AND c.parent_id = t.id
      WHERE c.remind_at IS NOT NULL
        AND c.reminded_at IS NOT NULL
      ORDER BY c.remind_at ASC`
  );
}

// Mark a single comment-reminder as acknowledged via its dismiss × button
// (an explicit user gesture). Distinct from the implicit "content edit" path,
// which clears every fired comment-reminder for the parent at once.
export async function acknowledgeCommentReminder(commentId) {
  if (commentId == null) return;
  const db = getDb();
  if (!db) return;
  await db.runAsync(
    `UPDATE comments SET reminded_at = datetime('now') WHERE id = ?`,
    [commentId]
  );
}

// All future comment-reminder timestamps (for the precise-timer effect).
export async function loadPendingCommentReminders() {
  const db = getDb();
  if (!db) return [];
  return db.getAllAsync(
    `SELECT id, remind_at FROM comments
       WHERE remind_at IS NOT NULL
         AND reminded_at IS NULL
         AND datetime(remind_at) > datetime('now')
       ORDER BY remind_at ASC`
  );
}

// ---- Writes -------------------------------------------------------------

export async function addComment(parentKind, parentId, body) {
  assertKind(parentKind);
  if (parentId == null) return null;
  const db = getDb();
  if (!db) return null;
  const trimmed = (body || '').trim();
  if (!trimmed) return null;
  const result = await db.runAsync(
    `INSERT INTO comments (parent_kind, parent_id, body) VALUES (?, ?, ?)`,
    [parentKind, parentId, trimmed]
  );
  // Adding a comment is content engagement → acknowledge any fired self-pings
  // on this parent (per N15: "acknowledged on content edit, not on tap").
  await acknowledgeFiredCommentRemindersForParent(parentKind, parentId);
  return result.lastInsertRowId;
}

export async function updateCommentBody(commentId, body) {
  if (commentId == null) return;
  const db = getDb();
  if (!db) return;
  const trimmed = (body || '').trim();
  if (!trimmed) return;
  const c = await db.getFirstAsync(
    `SELECT parent_kind, parent_id FROM comments WHERE id = ?`,
    [commentId]
  );
  await db.runAsync(
    `UPDATE comments
        SET body = ?, edited_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?`,
    [trimmed, commentId]
  );
  if (c) {
    await acknowledgeFiredCommentRemindersForParent(c.parent_kind, c.parent_id);
  }
}

// Resolve / reopen a comment loop. `resolved` true → stamp resolved_at
// with SQLite's space-separated datetime (the closed_at convention);
// false → clear it. This is the micro-scale sibling of "close the vakana"
// (threads.closed_at): a comment is often a thing the user is trying, and
// resolving marks that loop shut. Orthogonal to the reminder columns:
// resolving neither schedules, fires, nor acknowledges a reminder, and
// does NOT touch updated_at (resolution is a lifecycle mark, not a content
// edit, so it must not bump the "edited" surface or the order/recency).
export async function setCommentResolved(commentId, resolved) {
  if (commentId == null) return;
  const db = getDb();
  if (!db) return;
  await db.runAsync(
    resolved
      ? `UPDATE comments SET resolved_at = datetime('now') WHERE id = ?`
      : `UPDATE comments SET resolved_at = NULL WHERE id = ?`,
    [commentId]
  );
}

export async function deleteComment(commentId) {
  if (commentId == null) return;
  const db = getDb();
  if (!db) return;
  // Cancel any scheduled OS notification before deleting the row.
  const row = await db.getFirstAsync(
    `SELECT notification_id FROM comments WHERE id = ?`,
    [commentId]
  );
  if (row?.notification_id) await cancelNotification(row.notification_id);
  await db.runAsync(`DELETE FROM comments WHERE id = ?`, [commentId]);
}

// Cascade cleanup. Called by entry / thread / reminder delete paths since
// SQLite has no FK to fall back on for polymorphic associations.
export async function removeCommentsForParent(parentKind, parentId) {
  assertKind(parentKind);
  if (parentId == null) return;
  const db = getDb();
  if (!db) return;
  const rows = await db.getAllAsync(
    `SELECT notification_id FROM comments
       WHERE parent_kind = ? AND parent_id = ?
         AND notification_id IS NOT NULL`,
    [parentKind, parentId]
  );
  for (const r of rows) {
    if (r.notification_id) await cancelNotification(r.notification_id);
  }
  await db.runAsync(
    `DELETE FROM comments WHERE parent_kind = ? AND parent_id = ?`,
    [parentKind, parentId]
  );
}

// Transaction-safe split of removeCommentsForParent for batch parent
// deletes (services/entries.js, services/threads.js). Both take the caller's
// `db` and open NO transaction of their own (expo-sqlite transactions don't
// nest), and neither touches the OS: the caller collects the notification
// ids inside its transaction, deletes the rows there too, and only after
// commit hands the ids to cancelCommentNotifications. A rollback therefore
// leaves both the comments and their scheduled notifications intact.
export async function deleteCommentsForParentsInTx(db, parentKind, parentIds) {
  assertKind(parentKind);
  const ids = (parentIds || []).filter((id) => id != null);
  if (!db || ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  const rows = await db.getAllAsync(
    `SELECT notification_id FROM comments
       WHERE parent_kind = ? AND parent_id IN (${placeholders})
         AND notification_id IS NOT NULL`,
    [parentKind, ...ids]
  );
  await db.runAsync(
    `DELETE FROM comments WHERE parent_kind = ? AND parent_id IN (${placeholders})`,
    [parentKind, ...ids]
  );
  return rows.map((r) => r.notification_id).filter(Boolean);
}

// Post-commit half of the split above. Sequential, like
// removeCommentsForParent; cancelNotification swallows its own failures,
// so one bad id never blocks the rest.
export async function cancelCommentNotifications(notificationIds) {
  for (const id of notificationIds || []) {
    if (id) await cancelNotification(id);
  }
}

// ---- Comment-reminder scheduling (N15) ----------------------------------

// `remindAt` is a JS Date. The OS notification's body is a short pointer
// back to the parent, not the comment body itself, so notifications stay
// readable on a lock screen.
export async function scheduleCommentReminder(commentId, remindAt, parentLabel) {
  if (commentId == null || !(remindAt instanceof Date)) return;
  const db = getDb();
  if (!db) return;

  // Cancel any prior schedule first (rescheduling). The same query grabs
  // the parent pointer for the tap payload.
  const prior = await db.getFirstAsync(
    `SELECT notification_id, parent_kind, parent_id FROM comments WHERE id = ?`,
    [commentId]
  );
  if (prior?.notification_id) await cancelNotification(prior.notification_id);

  const notificationId = await scheduleNotificationAt(
    'Comment reminder',
    parentLabel || '',
    remindAt,
    prior
      ? { kind: 'comment', parentKind: prior.parent_kind, parentId: prior.parent_id }
      : undefined
  );

  // Store the schedule even if the OS reject (notificationsAvailable false
  // on Android Expo Go): the in-app banner derivation uses remind_at, not
  // notification_id, so the user still gets the self-ping when the app is
  // open at the scheduled moment.
  await db.runAsync(
    `UPDATE comments
        SET remind_at = ?,
            notification_id = ?,
            reminded_at = NULL,
            updated_at = datetime('now')
      WHERE id = ?`,
    [remindAt.toISOString(), notificationId || null, commentId]
  );
}

export async function cancelCommentReminder(commentId) {
  if (commentId == null) return;
  const db = getDb();
  if (!db) return;
  const row = await db.getFirstAsync(
    `SELECT notification_id FROM comments WHERE id = ?`,
    [commentId]
  );
  if (row?.notification_id) await cancelNotification(row.notification_id);
  await db.runAsync(
    `UPDATE comments
        SET remind_at = NULL,
            notification_id = NULL,
            reminded_at = NULL,
            updated_at = datetime('now')
      WHERE id = ?`,
    [commentId]
  );
}

// Reschedule OS notifications for every pending comment-reminder whose
// fire moment is in the future. Runs on EVERY boot and after a vault
// switch (v0.86.1; previously vault-switch only). Idempotent via the
// live-schedule check, same as reminders.js's pass; see the notes there.
// The `remind_at` values stay; only `notification_id` is refreshed.
export async function rehydrateCommentReminderNotifications() {
  const db = getDb();
  if (!db) return;
  const rows = await db.getAllAsync(
    `SELECT c.id, c.remind_at, c.parent_kind, c.parent_id, c.notification_id
       FROM comments c
      WHERE c.remind_at IS NOT NULL
        AND c.reminded_at IS NULL
        AND datetime(c.remind_at) > datetime('now')`
  );
  if (rows.length === 0) return;
  const liveIds = await getScheduledNotificationIds();
  for (const row of rows) {
    const when = new Date(row.remind_at);
    if (!Number.isFinite(when.getTime())) continue;
    if (row.notification_id && liveIds.has(row.notification_id)) continue;
    const notificationId = await scheduleNotificationAt(
      'Comment reminder',
      '',
      when,
      { kind: 'comment', parentKind: row.parent_kind, parentId: row.parent_id }
    );
    if (notificationId) {
      await db.runAsync(
        `UPDATE comments SET notification_id = ? WHERE id = ?`,
        [notificationId, row.id]
      );
    }
  }
}

// ---- Promote comment → entry (N21) --------------------------------------
//
// A comment that grew up. The user long-presses a comment and picks
// "Make a bead" → "Just a bead" or "...and chain". We materialize a new
// entry from the comment's body, then delete the comment (no provenance
// tracking; the bead IS the thought now). The caller decides whether and
// how to chain.

const PROMOTE_TITLE_MAX = 80;

// First sentence of `body`, trimmed and ellipsized, prefixed with
// "(from comment) ". Used as the default title of the promoted entry.
// Falls back to the bare prefix when the body is empty (defensive: the
// drawer doesn't let empty comments exist, but the helper is safe to call
// in any state).
export function makePromotedTitle(body) {
  const trimmed = (body || '').trim();
  if (!trimmed) return '(from comment)';
  const match = trimmed.match(/^[^.!?\n]*[.!?]?/);
  const first = (match?.[0] || trimmed).trim();
  const head =
    first.length > PROMOTE_TITLE_MAX
      ? first.slice(0, PROMOTE_TITLE_MAX).trimEnd() + '…'
      : first;
  return `(from comment) ${head}`;
}

// Create a new entry from a comment row, delete the comment, and return
// the new entry's id (plus the bead snapshot for downstream chaining).
// Today's date, DEFAULT_BEAD, no highlight. syncAutoBeadForEntry runs so
// the day's auto-thread picks it up immediately.
export async function promoteCommentToEntry(comment) {
  if (!comment || comment.id == null) {
    throw new Error('promoteCommentToEntry: invalid comment');
  }
  const db = getDb();
  if (!db) throw new Error('promoteCommentToEntry: DB not ready');

  const dateStr = formatDateStr(new Date());
  const title = makePromotedTitle(comment.body);
  const body = (comment.body || '').trim();

  const result = await db.runAsync(
    `INSERT INTO entries
       (title, content, date, bead_shape, bead_pattern, bead_mood, bead_glyph)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      title,
      body,
      dateStr,
      DEFAULT_BEAD.shape,
      DEFAULT_BEAD.pattern,
      DEFAULT_BEAD.mood,
      DEFAULT_BEAD.glyph,
    ]
  );
  const entryId = result.lastInsertRowId;

  // Drop the comment first so callers don't observe a transient dual-existence
  // (deleteComment also cancels any attached OS notification).
  await deleteComment(comment.id);

  await syncAutoBeadForEntry({
    id: entryId,
    date: dateStr,
    bead_shape: DEFAULT_BEAD.shape,
    bead_pattern: DEFAULT_BEAD.pattern,
    bead_mood: DEFAULT_BEAD.mood,
    bead_glyph: DEFAULT_BEAD.glyph,
    highlight_tier: 0,
  });

  return {
    entryId,
    bead: { ...DEFAULT_BEAD },
  };
}

// Append a promoted entry's bead to an existing thread's chain. Used when
// the comment's parent is a thread and the user picks the chain option.
// Mirrors ThreadDetailScreen.handleQuickAddBead's position logic: append
// at MAX(position) + 1, bump thread.updated_at.
export async function chainPromotedEntryToThread(entryId, threadId, bead) {
  if (entryId == null || threadId == null) return;
  const db = getDb();
  if (!db) return;
  const safeBead = bead || DEFAULT_BEAD;
  const posRow = await db.getFirstAsync(
    'SELECT COALESCE(MAX(position), -1) AS maxPos FROM thread_beads WHERE thread_id = ?',
    [threadId]
  );
  const nextPos = (posRow?.maxPos ?? -1) + 1;
  await db.runAsync(
    `INSERT INTO thread_beads
       (thread_id, entry_id, position, snapshot_shape, snapshot_pattern, snapshot_mood, snapshot_glyph)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      threadId,
      entryId,
      nextPos,
      safeBead.shape,
      safeBead.pattern,
      safeBead.mood,
      safeBead.glyph,
    ]
  );
  await db.runAsync(
    `UPDATE threads SET updated_at = datetime('now') WHERE id = ?`,
    [threadId]
  );
}

// Acknowledged on content edit (per the N15 design): writing or editing
// any comment on the parent clears every fired comment-reminder for that
// parent. The banner stack derives from `reminded_at IS NULL`, so this is
// the single source of truth.
export async function acknowledgeFiredCommentRemindersForParent(parentKind, parentId) {
  assertKind(parentKind);
  if (parentId == null) return;
  const db = getDb();
  if (!db) return;
  await db.runAsync(
    `UPDATE comments
        SET reminded_at = datetime('now')
      WHERE parent_kind = ? AND parent_id = ?
        AND remind_at IS NOT NULL
        AND reminded_at IS NULL
        AND datetime(remind_at) <= datetime('now')`,
    [parentKind, parentId]
  );
}
