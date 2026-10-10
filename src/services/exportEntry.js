// Per-entry markdown export. Writes a single .md file to the cache
// directory and hands it to the system share sheet via expo-sharing.
//
// The output is plain CommonMark with YAML frontmatter so the file
// drops cleanly into Hugo / Jekyll / Astro / Zola / Substack imports.
// Photos and voice notes are not bundled: they're listed by filename
// at the bottom so the writer remembers what was attached. Users who
// need full fidelity export the vault backup.

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { getDb } from '../database/db';

function slugify(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function escapeYamlString(value) {
  // Wrap in double quotes and escape `\` and `"`. The values we write are
  // short (title, date) so single-line YAML is always safe.
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function basenameOf(uri) {
  if (!uri) return '';
  const cleaned = uri.split('?')[0].split('#')[0];
  const idx = cleaned.lastIndexOf('/');
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

export function buildEntryMarkdown({ entry, photos, voiceNotes }) {
  const title = (entry.title || '').trim() || 'Untitled';
  const date = entry.date || '';
  const lines = [];

  lines.push('---');
  lines.push(`title: ${escapeYamlString(title)}`);
  if (date) lines.push(`date: ${escapeYamlString(date)}`);
  if (entry.time) lines.push(`time: ${escapeYamlString(entry.time)}`);
  if (entry.created_at) lines.push(`created_at: ${escapeYamlString(entry.created_at)}`);
  if (entry.updated_at) lines.push(`updated_at: ${escapeYamlString(entry.updated_at)}`);
  if (photos.length > 0) {
    lines.push('photos:');
    for (const p of photos) lines.push(`  - ${escapeYamlString(basenameOf(p))}`);
  }
  lines.push('---');
  lines.push('');

  lines.push(`# ${title}`);
  lines.push('');

  const body = (entry.content || '').trim();
  if (body) {
    lines.push(body);
    lines.push('');
  }

  if (photos.length > 0) {
    lines.push('## Photos');
    lines.push('');
    for (const p of photos) {
      const name = basenameOf(p);
      lines.push(`- ${name}`);
    }
    lines.push('');
  }

  if (voiceNotes.length > 0) {
    lines.push('## Voice notes');
    lines.push('');
    for (const v of voiceNotes) {
      const name = basenameOf(v.uri);
      const dur =
        typeof v.duration === 'number' && v.duration > 0
          ? ` (${Math.round(v.duration)}s)`
          : '';
      lines.push(`- ${name}${dur}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export async function exportEntryAsMarkdown(entryId) {
  if (entryId == null) throw new Error('No entry id');
  const db = getDb();
  if (!db) throw new Error('Database not ready');

  const entry = await db.getFirstAsync('SELECT * FROM entries WHERE id = ?', [
    entryId,
  ]);
  if (!entry) throw new Error('Entry not found');

  const photoRows = await db.getAllAsync(
    'SELECT uri FROM entry_photos WHERE entry_id = ?',
    [entryId]
  );
  const voiceRows = await db.getAllAsync(
    'SELECT uri, duration FROM entry_voice_notes WHERE entry_id = ?',
    [entryId]
  );

  const md = buildEntryMarkdown({
    entry,
    photos: photoRows.map((p) => p.uri),
    voiceNotes: voiceRows.map((v) => ({ uri: v.uri, duration: v.duration })),
  });

  const slug = slugify(entry.title) || `entry-${entryId}`;
  const date = entry.date || 'undated';
  const filename = `${slug}-${date}.md`;
  const targetUri = `${FileSystem.cacheDirectory}${filename}`;

  await FileSystem.writeAsStringAsync(targetUri, md, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error('Sharing is not available on this device');
  }
  await Sharing.shareAsync(targetUri, {
    mimeType: 'text/markdown',
    dialogTitle: 'Share entry as Markdown',
    UTI: 'net.daringfireball.markdown',
  });

  return targetUri;
}
