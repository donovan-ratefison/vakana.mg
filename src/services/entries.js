// Entry deletion: the one write path for removing entries rows.
//
// Every delete surface (Home swipe, Home batch, editor Delete button) used
// to run the same three steps as separate autocommits: strip auto-beads,
// cascade comments, DELETE the row. A crash or error between them left
// half-deleted state (comments gone but entry alive, or an orphaned
// auto-bead). deleteEntries runs all DB writes in ONE transaction:
//
//   1. detach the entries from every auto-thread + prune emptied auto-
//      threads (thread_beads.entry_id is ON DELETE SET NULL, not CASCADE,
//      so auto-beads must be stripped proactively; see beads-and-threads.md);
//   2. delete their comments (polymorphic, no FK: app-level cascade);
//   3. DELETE FROM entries. The FKs then cascade entry_photos,
//      entry_voice_notes and entry_thread_links, and SET NULL the
//      user-thread thread_beads rows, so frozen snapshots on user threads
//      survive as faded beads, exactly as before.
//
// OS notifications for the deleted comment-reminders are cancelled only
// AFTER commit: a rolled-back delete must not have silenced reminders that
// still exist. Attachment files are never touched here: the media sweep
// (mediaStore.rescueAndSweepMedia) is the single cleanup point.
//
// Must not be called from inside another transaction (they don't nest).

import { getDb } from '../database/db';
import { removeAutoBeadsForEntriesInTx } from './autoThread';
import {
  PARENT_ENTRY,
  deleteCommentsForParentsInTx,
  cancelCommentNotifications,
} from './comments';

export async function deleteEntries(entryIds) {
  const ids = (entryIds || []).filter((id) => id != null).map(Number);
  if (ids.length === 0) return;
  const db = getDb();
  if (!db) return;

  let notificationIds = [];
  await db.withTransactionAsync(async () => {
    await removeAutoBeadsForEntriesInTx(db, ids);
    notificationIds = await deleteCommentsForParentsInTx(db, PARENT_ENTRY, ids);
    const placeholders = ids.map(() => '?').join(',');
    await db.runAsync(`DELETE FROM entries WHERE id IN (${placeholders})`, ids);
  });

  await cancelCommentNotifications(notificationIds);
}
