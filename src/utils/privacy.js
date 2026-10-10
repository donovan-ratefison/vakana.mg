// Per-entry shoulder-surf masking. Visual layer only: entries.is_private
// is a 0/1 flag the editor toggles. The DB never stores masked text, so
// search keeps matching real content. List/preview surfaces swap the
// entry's title for MASKED_TITLE (muted italic) and drop the excerpt;
// date, bead, and counts stay visible so the entry is still findable.

export const MASKED_TITLE = '🔒 Private entry';

export function isPrivate(entry) {
  return !!(entry && entry.is_private);
}
