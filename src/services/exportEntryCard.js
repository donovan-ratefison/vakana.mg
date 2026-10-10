// Snapshot a hidden `EntryCardForExport` view to PNG and hand the file
// to the system share sheet. Two pieces:
//   - `loadEntryCardData`: read entry + bead + cover photo + comments
//     from SQLite. Returns the props the card needs.
//   - `captureAndShareCard`: given a view ref pointing at the rendered
//     card, capture it at 1080×1350 (Instagram portrait) via
//     react-native-view-shot and share via expo-sharing.
//
// The card is rendered in the screen's tree (positioned off-screen) so
// the screen owns mount/unmount. This service stays pure side-effects.

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { getDb } from '../database/db';
import { PARENT_ENTRY } from './comments';
import { slugify } from './threadArticles';

const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1350;

// Resize the source photo to a width close to its final rendered size on
// the card so RN Image isn't asked to downsample a 4000 px source bitmap
// to ~380 px display, which produces visible "filter / haze" artifacts
// after the second resize that view-shot does at capture time. Main
// polaroid renders at ~380 logical = ~760 px output; mini-polaroids at
// ~76 logical = ~152 px output. A single ~1200 px source covers either
// at high quality. JPEG 0.9 keeps file size sane.
const PREP_WIDTH = 1200;
const PREP_QUALITY = 0.95;

// Read the resized file as base64 and return a data URI. RN Image with
// a data URI renders synchronously through the static-image path; this
// avoids react-native-view-shot's known Android-side compositing bug
// where file:// URI images can come out with reduced contrast / a
// translucent wash at capture time (the async decode race interacts
// badly with PixelCopy.request).
async function prepPhoto(uri) {
  try {
    const r = await manipulateAsync(
      uri,
      [{ resize: { width: PREP_WIDTH } }],
      { compress: PREP_QUALITY, format: SaveFormat.JPEG }
    );
    const b64 = await FileSystem.readAsStringAsync(r.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return `data:image/jpeg;base64,${b64}`;
  } catch {
    // If prep fails (corrupted file, OOM, etc.), fall back to the
    // original URI so the export doesn't die. RN Image will do its
    // best with the source.
    return uri;
  }
}

export async function prepCardPhotos(photoUris) {
  // Sequential, not Promise.all. This keeps peak memory at one resized
  // bitmap's worth instead of N for a multi-photo entry.
  const out = [];
  for (const u of photoUris) {
    // eslint-disable-next-line no-await-in-loop
    out.push(await prepPhoto(u));
  }
  return out;
}

export async function loadEntryCardData(entryId) {
  if (entryId == null) throw new Error('No entry id');
  const db = getDb();
  if (!db) throw new Error('Database not ready');

  const entry = await db.getFirstAsync(
    'SELECT * FROM entries WHERE id = ?',
    [entryId]
  );
  if (!entry) throw new Error('Entry not found');

  const photoRows = await db.getAllAsync(
    'SELECT uri FROM entry_photos WHERE entry_id = ? ORDER BY id ASC',
    [entryId]
  );
  const commentRows = await db.getAllAsync(
    `SELECT id, body, created_at, resolved_at
       FROM comments
      WHERE parent_kind = ? AND parent_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 3`,
    [PARENT_ENTRY, entryId]
  );

  const bead = entry.bead_shape
    ? {
        shape: entry.bead_shape,
        pattern: entry.bead_pattern,
        mood: entry.bead_mood,
        glyph: entry.bead_glyph || '',
      }
    : null;

  return {
    entry,
    bead,
    photoUris: photoRows.map((r) => r.uri),
    // Reverse so the oldest of the three is rendered top: sticky notes
    // read top-to-bottom, oldest first, which feels more like a margin
    // conversation than a feed.
    comments: commentRows.reverse(),
  };
}

export async function captureAndShareCard(viewRef, entry, withNotes) {
  if (!viewRef?.current) throw new Error('Card view is not mounted');

  const uri = await captureRef(viewRef, {
    format: 'png',
    quality: 1,
    result: 'tmpfile',
    width: OUTPUT_WIDTH,
    height: OUTPUT_HEIGHT,
  });

  // Move the file into our cache with a friendly name so the share-sheet
  // suggestion picks up something nicer than "<random>.png".
  const slug = slugify(entry?.title) || `entry-${entry?.id ?? 'card'}`;
  const date = entry?.date || 'undated';
  const suffix = withNotes ? 'card-notes' : 'card';
  const filename = `${slug}-${date}-${suffix}.png`;
  const targetUri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.copyAsync({ from: uri, to: targetUri });

  const available = await Sharing.isAvailableAsync();
  if (!available) throw new Error('Sharing is not available on this device');

  await Sharing.shareAsync(targetUri, {
    mimeType: 'image/png',
    dialogTitle: withNotes ? 'Share card with notes' : 'Share card',
    UTI: 'public.png',
  });

  return targetUri;
}
