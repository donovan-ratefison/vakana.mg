// Thread deletion: the one write path for removing threads rows.
//
// Comments are polymorphic (no FK), so they're deleted by hand; every
// other dependant cascades from the threads DELETE via its FK:
// thread_beads, thread_collection_links, entry_thread_links (Mentions)
// and thread_articles. Comment rows and thread rows go in ONE transaction
// so a failure can't leave a thread whose comments are already gone.
// Comment-reminder OS notifications are cancelled only after commit.
//
// This deletes exactly the ids it is given. Callers decide which kinds
// may be deleted: auto-threads are derived state (pruned by
// autoThread.js when their last bead goes) and the UI never offers them:
// HomeScreen's batch delete filters to kind = 'user' before calling, and
// ThreadDetailScreen hides Delete on auto kinds.
//
// Must not be called from inside another transaction (they don't nest).

import { getDb } from '../database/db';
import {
  PARENT_THREAD,
  deleteCommentsForParentsInTx,
  cancelCommentNotifications,
} from './comments';

export async function deleteThreads(threadIds) {
  const ids = (threadIds || []).filter((id) => id != null).map(Number);
  if (ids.length === 0) return;
  const db = getDb();
  if (!db) return;

  let notificationIds = [];
  await db.withTransactionAsync(async () => {
    notificationIds = await deleteCommentsForParentsInTx(db, PARENT_THREAD, ids);
    const placeholders = ids.map(() => '?').join(',');
    await db.runAsync(`DELETE FROM threads WHERE id IN (${placeholders})`, ids);
  });

  await cancelCommentNotifications(notificationIds);
}
