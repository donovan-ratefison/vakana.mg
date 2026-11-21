import JSZip from 'jszip';
import { openMediaFile } from '../services/mediaStore.web';
import { warn } from '../utils/log';

// Web only. Builds the backup archive with the layout of the Android backup
// (services/backup.js): manifest.json, journal.db, attachments/photos|voice/.
// The caller gives the names, `extOf` and the start manifest, so that the
// format has one definition. `manifest` receives the media entries.
// shortcut: the archive is built in memory, write it as a stream (File System Access API) when a media library fails to export.
export async function buildBackupBytes({
  db,
  manifest,
  withDb,
  withMedia,
  names,
  extOf,
  onProgress,
}) {
  const zip = new JSZip();

  if (withDb) {
    onProgress?.({ stage: 'reading-db' });
    // WAL checkpoint so journal.db captures the latest committed writes.
    try {
      await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch (e) {
      // Not fatal, but journal.db may miss the latest writes.
      warn('backup.walCheckpoint', e);
    }
    zip.file(names.db, await db.serializeAsync(), { compression: 'DEFLATE' });
  }

  if (withMedia) {
    const addMedia = async (rows, kind, dir, fallbackExt, list, extra) => {
      for (const row of rows) {
        const file = await openMediaFile(row.uri);
        // A file that is missing or that cannot be read is skipped, as on Android.
        const bytes = file && (await file.arrayBuffer().catch(() => null));
        if (!bytes) {
          manifest.skipped.push({ kind, id: row.id, originalUri: row.uri });
          continue;
        }
        const archivePath = `${dir}${row.id}.${extOf(row.uri) || fallbackExt}`;
        zip.file(archivePath, bytes);
        list.push({ id: row.id, entryId: row.entry_id, archivePath, ...extra(row) });
      }
    };

    onProgress?.({ stage: 'staging-photos' });
    await addMedia(
      await db.getAllAsync('SELECT id, entry_id, uri FROM entry_photos'),
      'photo',
      names.photoDir,
      'jpg',
      manifest.photos,
      () => ({})
    );

    onProgress?.({ stage: 'staging-voice' });
    await addMedia(
      await db.getAllAsync('SELECT id, entry_id, uri, duration FROM entry_voice_notes'),
      'voice',
      names.voiceDir,
      'm4a',
      manifest.voice,
      (row) => ({ duration: row.duration })
    );
  }

  zip.file(names.manifest, JSON.stringify(manifest, null, 2));

  onProgress?.({ stage: 'compressing' });
  return zip.generateAsync({ type: 'uint8array' });
}

// The archive as an object URL. downloadBackup releases it.
export async function createBackupUrl(options) {
  const bytes = await buildBackupBytes(options);
  return URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
}

// Makes the browser save the archive. expo-sharing shares only a URL on web,
// and an object URL has no use outside this page.
export function downloadBackup(url, filename) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // A release in the same task can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
