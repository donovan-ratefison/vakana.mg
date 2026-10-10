// Per-entry HTML export. Reuses the thread-article renderer by feeding it
// a synthetic single-section "article" assembled from the entry. Same
// CSS, same photo-budget pipeline, same template choices: entries get
// the polish for free, and any future template tweaks benefit both.
//
// The article-title (h1) shows the entry title. To avoid duplicating it
// in the editorial/journal/minimal section heading, the synthetic
// section carries `hideTitle: true`. Storyboard and postcard use the
// section title in stylistically distinct slots (post-author byline,
// polaroid caption) so the duplication reads as deliberate styling.

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { getDb } from '../database/db';
import { PARENT_ENTRY } from './comments';
import {
  TEMPLATE_KEYS,
  renderHtml,
  buildPhotoBase64Map,
  slugify,
} from './threadArticles';

const DEFAULT_BEAD = { shape: 'circle', pattern: null, mood: null, glyph: '' };

function buildSyntheticArticleData(entry, photoUris, comments, template) {
  const title = (entry.title || '').trim() || 'Untitled';

  // Cover only for the long-form templates; storyboard and postcard
  // render photos inline per-section and don't read article.cover_photo_uri.
  const useStoryTemplate = template === 'storyboard' || template === 'postcard';
  const coverUri = useStoryTemplate ? null : photoUris[0] || null;
  const sectionPhotos = coverUri ? photoUris.slice(1) : photoUris.slice();

  const thread = {
    id: entry.id,
    name: title,
    created_at: entry.created_at,
  };

  const article = {
    thread_id: entry.id,
    title,
    subtitle: '',
    intro: '',
    cover_photo_uri: coverUri,
    template,
    hidden_bead_ids: [],
    bead_overrides: {},
    created_at: entry.created_at,
    updated_at: entry.updated_at,
  };

  const bead = entry.bead_shape
    ? {
        shape: entry.bead_shape,
        pattern: entry.bead_pattern,
        mood: entry.bead_mood,
        glyph: entry.bead_glyph || '',
      }
    : DEFAULT_BEAD;

  const sections = [
    {
      beadId: 0,
      position: 0,
      bead,
      entry,
      photos: sectionPhotos,
      comments,
      hidden: false,
      hideTitle: true,
      titleOverride: '',
      leadOverride: '',
    },
  ];

  return { thread, article, sections, threadComments: [] };
}

export async function exportEntryAsHtml(entryId, template) {
  if (entryId == null) throw new Error('No entry id');
  if (!TEMPLATE_KEYS.includes(template)) {
    throw new Error(`Invalid template: ${template}`);
  }

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
      ORDER BY created_at ASC, id ASC`,
    [PARENT_ENTRY, entryId]
  );

  const photoUris = photoRows.map((p) => p.uri);
  const data = buildSyntheticArticleData(entry, photoUris, commentRows, template);

  const photosBase64 = await buildPhotoBase64Map(data, 'html');
  const html = renderHtml({ ...data, photosBase64 });

  const slug = slugify(entry.title) || `entry-${entryId}`;
  const date = entry.date || 'undated';
  const filename = `${slug}-${date}.html`;
  const targetUri = `${FileSystem.cacheDirectory}${filename}`;

  await FileSystem.writeAsStringAsync(targetUri, html, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  const available = await Sharing.isAvailableAsync();
  if (!available) throw new Error('Sharing is not available on this device');

  await Sharing.shareAsync(targetUri, {
    mimeType: 'text/html',
    dialogTitle: 'Share entry as HTML',
    UTI: 'public.html',
  });

  return targetUri;
}
