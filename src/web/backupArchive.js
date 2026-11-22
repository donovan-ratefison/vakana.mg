import JSZip from 'jszip';
import { backupDatabaseAsync, deserializeDatabaseAsync } from 'expo-sqlite';
import { closeDatabase, getDb } from '../database/db';
import { openMediaFile, writeMediaBlob } from '../services/mediaStore.web';
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

const SQLITE_MAGIC = 'SQLite format 3\0';
const MEDIA_EXT = /^[a-z0-9]{1,5}$/;

// Web only. Reads a backup archive (made on web or on Android) and replaces
// the database of the current vault. The archive comes from the user: all of
// it is validated before the first write, and the database is replaced last,
// in one step, so that a failure leaves the journal as it was.
// Returns what the common end of the restore needs (services/backup.js), with
// the database closed. The messages of the 4 first checks are those of the
// Android restore.
// shortcut: the archive is read in memory, read it as a stream (zip entries one at a time from the File) when a media library fails to restore.
export async function restoreArchive({ zipUri, names, modes, onProgress }) {
  const db = getDb();
  if (!db) throw new Error('Database not initialised');

  let zip;
  try {
    zip = await JSZip.loadAsync(await (await fetch(zipUri)).arrayBuffer());
  } catch {
    throw new Error('This file is not a zip archive.');
  }

  const manifestRaw = await zip.file(names.manifest)?.async('string');
  if (!manifestRaw) throw new Error('Backup is missing manifest.json');
  let manifest = null;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch {
    // Same refusal as a value that is not an object.
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Backup manifest is not valid JSON');
  }
  const mode = manifest.mode || modes.fallback;
  if (mode === modes.refused) {
    throw new Error(
      'This is a media-only archive. Vakana cannot restore media without a database.'
    );
  }
  // The bytes come out of the zip as a new array: the changes below stay here.
  const dbBytes = await zip.file(names.db)?.async('uint8array');
  if (!dbBytes) throw new Error('Backup is missing journal.db');
  if (String.fromCharCode(...dbBytes.subarray(0, 16)) !== SQLITE_MAGIC) {
    throw new Error('Backup database is not a SQLite file.');
  }

  // An Android backup is in WAL mode (header bytes 18 and 19 at 2), which the
  // web storage cannot open. Its WAL file is empty (checkpoint before the
  // copy), so the rollback-journal version (1) reads the same pages.
  if (dbBytes[18] === 2 || dbBytes[19] === 2) {
    dbBytes[18] = 1;
    dbBytes[19] = 1;
  }
  let memDb;
  try {
    memDb = await deserializeDatabaseAsync(dbBytes);
    const check = await memDb.getFirstAsync('PRAGMA integrity_check');
    const table = await memDb.getFirstAsync(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'entries'"
    );
    if (check?.integrity_check !== 'ok' || !table) throw new Error('check failed');
  } catch (e) {
    warn('backup.restore.checkDb', e);
    await memDb?.closeAsync().catch(() => {});
    throw new Error('Backup database is damaged or is not a Vakana journal.');
  }

  let photoIdToUri;
  let voiceIdToUri;
  try {
    // The files of the journal that is replaced are not deleted here: the
    // startup sweep removes them, and a failure below must leave them in place.
    const writeMedia = async (list, dir, kind) => {
      const idToUri = new Map();
      for (const item of Array.isArray(list) ? list : []) {
        // An item that does not fit the layout of the archive is skipped, as
        // a missing file is on Android. The path is never used to write.
        if (!Number.isInteger(item?.id) || typeof item.archivePath !== 'string') continue;
        const prefix = `${dir}${item.id}.`;
        const ext = item.archivePath.slice(prefix.length);
        if (!item.archivePath.startsWith(prefix) || !MEDIA_EXT.test(ext)) continue;
        const bytes = await zip.file(item.archivePath)?.async('uint8array');
        if (!bytes) continue;
        idToUri.set(item.id, await writeMediaBlob(new Blob([bytes]), kind, `.${ext}`));
      }
      return idToUri;
    };

    onProgress?.({ stage: 'extracting-photos' });
    photoIdToUri = await writeMedia(manifest.photos, names.photoDir, 'photo');
    onProgress?.({ stage: 'extracting-voice' });
    voiceIdToUri = await writeMedia(manifest.voice, names.voiceDir, 'voice');

    for (const [id, uri] of photoIdToUri) {
      await memDb.runAsync('UPDATE entry_photos SET uri = ? WHERE id = ?', [uri, id]);
    }
    for (const [id, uri] of voiceIdToUri) {
      await memDb.runAsync('UPDATE entry_voice_notes SET uri = ? WHERE id = ?', [uri, id]);
    }
    // An archive URI that is not rewritten must never load an outside address.
    for (const [table, sql] of [
      ['entry_photos', "DELETE FROM entry_photos WHERE substr(uri, 1, 17) <> 'opfs:attachments/'"],
      [
        'entry_voice_notes',
        "DELETE FROM entry_voice_notes WHERE substr(uri, 1, 17) <> 'opfs:attachments/'",
      ],
      [
        'thread_articles',
        "UPDATE thread_articles SET cover_photo_uri = NULL WHERE substr(cover_photo_uri, 1, 17) <> 'opfs:attachments/'",
      ],
    ]) {
      const found = await memDb.getFirstAsync(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        [table]
      );
      if (found) await memDb.runAsync(sql);
    }

    onProgress?.({ stage: 'closing-db' });
    await backupDatabaseAsync({ sourceDatabase: memDb, destDatabase: db });
  } finally {
    await memDb.closeAsync().catch((e) => warn('backup.restore.closeMemoryDb', e));
  }
  // Closed only after the replacement: the common end reopens the new file.
  await closeDatabase();
  return { mode, manifest, photoIdToUri, voiceIdToUri };
}
