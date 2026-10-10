import { getDb } from '../database/db';

// Batch attachment fetch for list rendering (home list, day view). One
// query per attachment table instead of two queries per entry, the same
// shape as loadCommentCounts in comments.js. Returns
// { [entryId]: { photos: [{uri}], voiceNotes: [{uri, duration}] } };
// entries with no attachments are simply absent from the map.
//
// ORDER BY id preserves each entry's insertion order: the editor
// rewrites attachments in array order on every save, so rowid order *is*
// the user's ordering (same guarantee the old per-entry queries gave).
export async function loadAttachmentsForEntries(entryIds = []) {
  if (!entryIds.length) return {};
  const db = getDb();
  if (!db) return {};
  const placeholders = entryIds.map(() => '?').join(', ');
  const [photoRows, voiceRows] = await Promise.all([
    db.getAllAsync(
      `SELECT entry_id, uri FROM entry_photos
        WHERE entry_id IN (${placeholders})
        ORDER BY id ASC`,
      entryIds
    ),
    db.getAllAsync(
      `SELECT entry_id, uri, duration FROM entry_voice_notes
        WHERE entry_id IN (${placeholders})
        ORDER BY id ASC`,
      entryIds
    ),
  ]);
  const out = {};
  const bucket = (id) =>
    (out[id] ??= { photos: [], voiceNotes: [] });
  for (const r of photoRows) {
    bucket(r.entry_id).photos.push({ uri: r.uri });
  }
  for (const r of voiceRows) {
    bucket(r.entry_id).voiceNotes.push({ uri: r.uri, duration: r.duration });
  }
  return out;
}
