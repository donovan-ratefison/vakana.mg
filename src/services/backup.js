// Vault backup & restore. The DB stores attachments as URIs only: the
// bytes live on disk under FileSystem.documentDirectory (or in
// image-picker caches that may have been evicted).
//
// Three backup modes (since v0.14.0):
//   - 'data-only':  DB + manifest.json only. Tiny, fast, no OOM risk.
//                    Use as a worst-case safety net.
//   - 'full':       DB + every still-present attachment. The "real"
//                    backup.
//   - 'media-only': Just the attachments + a media manifest. Useful for
//                    archiving photo libraries separately. Restore is not
//                    supported for this mode yet (exports only).
//
// All three pipe through `react-native-zip-archive`'s native streaming
// zip(). Files are staged into a temp directory via native `copyAsync`
// (zero JS-memory copy) and then zip()'d in one shot. Memory peak is
// flat regardless of dataset size, replacing the OOM-prone JSZip path
// from v0.13.x where the entire archive was built as a base64 string in
// JS memory before being written to disk.
//
// Restore accepts data-only and full zips (zip layout is identical, only
// the contents differ). It is forward-compatible with v0.13.x backups
// (those didn't carry `manifest.mode`; restoreFromZip treats their
// absence as 'full').

import { zip as nativeZip, unzip as nativeUnzip } from 'react-native-zip-archive';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import * as Notifications from 'expo-notifications';
import {
  getDb,
  closeDatabase,
  initDatabase,
} from '../database/db';
import {
  getCurrentVault,
  attachmentsDirFor,
  dbFilePathFor,
} from '../utils/vaults';
import { warn } from '../utils/log';

const MANIFEST_NAME = 'manifest.json';
const DB_NAME_IN_ZIP = 'journal.db';
const PHOTO_DIR = 'attachments/photos/';
const VOICE_DIR = 'attachments/voice/';

export const BACKUP_MODE_DATA_ONLY = 'data-only';
export const BACKUP_MODE_FULL = 'full';
export const BACKUP_MODE_MEDIA_ONLY = 'media-only';

const VALID_MODES = new Set([
  BACKUP_MODE_DATA_ONLY,
  BACKUP_MODE_FULL,
  BACKUP_MODE_MEDIA_ONLY,
]);

// ---- Filesystem helpers --------------------------------------------------

function extOf(uri) {
  if (!uri) return '';
  const cleaned = uri.split('?')[0].split('#')[0];
  const idx = cleaned.lastIndexOf('.');
  if (idx < 0 || idx === cleaned.length - 1) return '';
  const ext = cleaned.slice(idx + 1).toLowerCase();
  if (ext.length > 5) return '';
  return ext;
}

async function ensureDir(dirUri) {
  try {
    const info = await FileSystem.getInfoAsync(dirUri);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(dirUri, { intermediates: true });
    }
  } catch (e) {
    warn('backup.ensureDir', e);
  }
}

async function safeDelete(uri) {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch (e) {
    warn('backup.safeDelete', e);
  }
}

function timestampStamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

// react-native-zip-archive expects raw filesystem paths, not `file://`
// URIs. expo-file-system returns `file://` URIs everywhere, so we strip.
function fsPath(uri) {
  if (!uri) return uri;
  return uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
}

// ---- Staging-then-zip exports --------------------------------------------

async function stageDb(stagingUri, vault) {
  const db = getDb();
  if (!db) throw new Error('Database not initialised');

  // WAL checkpoint so journal.db captures the latest committed writes.
  try {
    await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch (e) {
    // Not fatal, but the staged journal.db may miss the latest writes.
    warn('backup.walCheckpoint', e);
  }

  const srcDb = dbFilePathFor(vault);
  const destDb = `${stagingUri}${DB_NAME_IN_ZIP}`;
  await FileSystem.copyAsync({ from: srcDb, to: destDb });
}

async function stageAttachments(stagingUri, manifest, { onProgress }) {
  const db = getDb();
  if (!db) throw new Error('Database not initialised');

  const photosDir = `${stagingUri}${PHOTO_DIR}`;
  const voiceDir = `${stagingUri}${VOICE_DIR}`;
  await ensureDir(photosDir);
  await ensureDir(voiceDir);

  onProgress?.({ stage: 'staging-photos' });
  const photos = await db.getAllAsync(
    'SELECT id, entry_id, uri FROM entry_photos'
  );
  for (const row of photos) {
    const ext = extOf(row.uri) || 'jpg';
    const archivePath = `${PHOTO_DIR}${row.id}.${ext}`;
    const dest = `${stagingUri}${archivePath}`;
    try {
      const info = await FileSystem.getInfoAsync(row.uri);
      if (!info.exists) {
        manifest.skipped.push({ kind: 'photo', id: row.id, originalUri: row.uri });
        continue;
      }
      await FileSystem.copyAsync({ from: row.uri, to: dest });
      manifest.photos.push({
        id: row.id,
        entryId: row.entry_id,
        archivePath,
      });
    } catch {
      manifest.skipped.push({ kind: 'photo', id: row.id, originalUri: row.uri });
    }
  }

  onProgress?.({ stage: 'staging-voice' });
  const voice = await db.getAllAsync(
    'SELECT id, entry_id, uri, duration FROM entry_voice_notes'
  );
  for (const row of voice) {
    const ext = extOf(row.uri) || 'm4a';
    const archivePath = `${VOICE_DIR}${row.id}.${ext}`;
    const dest = `${stagingUri}${archivePath}`;
    try {
      const info = await FileSystem.getInfoAsync(row.uri);
      if (!info.exists) {
        manifest.skipped.push({ kind: 'voice', id: row.id, originalUri: row.uri });
        continue;
      }
      await FileSystem.copyAsync({ from: row.uri, to: dest });
      manifest.voice.push({
        id: row.id,
        entryId: row.entry_id,
        archivePath,
        duration: row.duration,
      });
    } catch {
      manifest.skipped.push({ kind: 'voice', id: row.id, originalUri: row.uri });
    }
  }
}

async function writeManifestFile(stagingUri, manifest) {
  await FileSystem.writeAsStringAsync(
    `${stagingUri}${MANIFEST_NAME}`,
    JSON.stringify(manifest, null, 2)
  );
}

async function buildZipFromStaging(stagingUri, outName) {
  const outUri = `${FileSystem.cacheDirectory}${outName}`;
  await safeDelete(outUri); // overwrite any previous attempt of the same name
  const stagedPath = fsPath(
    stagingUri.endsWith('/') ? stagingUri.slice(0, -1) : stagingUri
  );
  const outPath = fsPath(outUri);
  await nativeZip(stagedPath, outPath);
  return outUri;
}

// Backbone of all three modes. Dispatcher lives in `exportCurrentVault`.
async function exportWithMode(mode, { onProgress } = {}) {
  if (!VALID_MODES.has(mode)) {
    throw new Error(`exportCurrentVault: invalid mode '${mode}'`);
  }
  const db = getDb();
  if (!db) throw new Error('Database not initialised');
  const vault = await getCurrentVault();
  if (!vault) throw new Error('No active vault');

  const manifest = {
    version: 2,
    mode,
    createdAt: new Date().toISOString(),
    vault: { name: vault.name },
    photos: [],
    voice: [],
    skipped: [],
  };

  const stamp = timestampStamp();
  const stagingUri = `${FileSystem.cacheDirectory}backup-staging-${stamp}/`;
  await safeDelete(stagingUri);
  await ensureDir(stagingUri);

  try {
    if (mode === BACKUP_MODE_DATA_ONLY || mode === BACKUP_MODE_FULL) {
      onProgress?.({ stage: 'reading-db' });
      await stageDb(stagingUri, vault);
    }

    if (mode === BACKUP_MODE_FULL || mode === BACKUP_MODE_MEDIA_ONLY) {
      await stageAttachments(stagingUri, manifest, { onProgress });
    }

    await writeManifestFile(stagingUri, manifest);

    onProgress?.({ stage: 'compressing' });
    const safeName = (vault.name || 'vault').replace(/[^a-zA-Z0-9_-]+/g, '_');
    const modeTag =
      mode === BACKUP_MODE_DATA_ONLY ? 'data' :
      mode === BACKUP_MODE_MEDIA_ONLY ? 'media' :
      'full';
    const outName = `journal-${safeName}-${modeTag}-${stamp}.zip`;
    const outUri = await buildZipFromStaging(stagingUri, outName);

    onProgress?.({ stage: 'done', uri: outUri });
    // vaultId is returned (not added to the manifest, so manifest v2 stays
    // stable) so the caller can stamp last-backup bookkeeping without a
    // second getCurrentVault() round-trip.
    return { uri: outUri, filename: outName, manifest, vaultId: vault.id };
  } finally {
    // Always clean up staging, on the successful zip path and the failure path. Awaiting
    // in finally would swallow real errors; fire-and-forget is fine.
    safeDelete(stagingUri);
  }
}

// Default mode = 'full' for backwards compat with any caller that
// doesn't pass a mode. The settings screen passes one explicitly.
export async function exportCurrentVault({
  mode = BACKUP_MODE_FULL,
  onProgress,
} = {}) {
  return exportWithMode(mode, { onProgress });
}

// ---- Share ---------------------------------------------------------------

export async function shareBackup(uri) {
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error('Sharing is not available on this device');
  }
  await Sharing.shareAsync(uri, {
    mimeType: 'application/zip',
    dialogTitle: 'Save journal backup',
    UTI: 'public.zip-archive',
  });
}

// ---- Pick + restore ------------------------------------------------------

export async function pickBackupFile() {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/zip', 'application/x-zip-compressed', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset) return null;
  return asset;
}

// Restore. Native unzip into a temp dir, walk by manifest, native
// copyAsync into place. Memory-flat. Compatible with v0.13.x backups
// (those omit `manifest.mode`; we infer 'full').
export async function restoreFromZip(zipUri, { onProgress } = {}) {
  const vault = await getCurrentVault();
  if (!vault) throw new Error('No active vault');

  onProgress?.({ stage: 'reading-zip' });

  const stamp = timestampStamp();
  const extractDir = `${FileSystem.cacheDirectory}restore-staging-${stamp}/`;
  await safeDelete(extractDir);
  await ensureDir(extractDir);

  try {
    const extractTo = fsPath(extractDir.slice(0, -1));
    const fromZip = fsPath(zipUri);
    await nativeUnzip(fromZip, extractTo);

    const manifestRaw = await FileSystem.readAsStringAsync(
      `${extractDir}${MANIFEST_NAME}`
    ).catch(() => null);
    if (!manifestRaw) throw new Error('Backup is missing manifest.json');

    let manifest;
    try {
      manifest = JSON.parse(manifestRaw);
    } catch {
      throw new Error('Backup manifest is not valid JSON');
    }

    const mode = manifest.mode || BACKUP_MODE_FULL;
    if (mode === BACKUP_MODE_MEDIA_ONLY) {
      throw new Error(
        'This is a media-only archive. Vakana cannot restore media without a database.'
      );
    }

    const dbInfo = await FileSystem.getInfoAsync(
      `${extractDir}${DB_NAME_IN_ZIP}`
    );
    if (!dbInfo.exists) throw new Error('Backup is missing journal.db');

    // Cancel scheduled OS notifications: the notification_ids in the
    // restored DB no longer correspond to anything the OS knows about.
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
    } catch (e) {
      warn('backup.restore.cancelNotifications', e);
    }

    onProgress?.({ stage: 'closing-db' });
    await closeDatabase();

    // Replace the DB file (and its WAL siblings).
    const sqliteDir = `${FileSystem.documentDirectory}SQLite/`;
    await ensureDir(sqliteDir);
    const dbUri = dbFilePathFor(vault);
    for (const sibling of [dbUri, `${dbUri}-journal`, `${dbUri}-wal`, `${dbUri}-shm`]) {
      await safeDelete(sibling);
    }
    await FileSystem.copyAsync({
      from: `${extractDir}${DB_NAME_IN_ZIP}`,
      to: dbUri,
    });

    // NOTE: backup-meta.json (last-backup bookkeeping) lives at
    // documentDirectory root and is intentionally NOT deleted here. It is
    // device/install state, not journal data, so it must survive a restore.
    // Do not "tidy" it into this reset block.

    // Reset attachments folder so we don't mix old + new files.
    const attachDir = attachmentsDirFor(vault.id);
    await safeDelete(attachDir);
    await ensureDir(`${attachDir}photos/`);
    await ensureDir(`${attachDir}voice/`);

    onProgress?.({ stage: 'extracting-photos' });
    const photoIdToUri = new Map();
    for (const item of manifest.photos || []) {
      const src = `${extractDir}${item.archivePath}`;
      const srcInfo = await FileSystem.getInfoAsync(src);
      if (!srcInfo.exists) continue;
      const ext = extOf(item.archivePath) || 'jpg';
      const dest = `${attachDir}photos/${item.id}.${ext}`;
      await FileSystem.copyAsync({ from: src, to: dest });
      photoIdToUri.set(item.id, dest);
    }

    onProgress?.({ stage: 'extracting-voice' });
    const voiceIdToUri = new Map();
    for (const item of manifest.voice || []) {
      const src = `${extractDir}${item.archivePath}`;
      const srcInfo = await FileSystem.getInfoAsync(src);
      if (!srcInfo.exists) continue;
      const ext = extOf(item.archivePath) || 'm4a';
      const dest = `${attachDir}voice/${item.id}.${ext}`;
      await FileSystem.copyAsync({ from: src, to: dest });
      voiceIdToUri.set(item.id, dest);
    }

    onProgress?.({ stage: 'rewriting-uris' });
    await initDatabase();
    const db = getDb();
    if (db) {
      for (const [id, uri] of photoIdToUri.entries()) {
        await db.runAsync(
          'UPDATE entry_photos SET uri = ? WHERE id = ?',
          [uri, id]
        );
      }
      for (const [id, uri] of voiceIdToUri.entries()) {
        await db.runAsync(
          'UPDATE entry_voice_notes SET uri = ? WHERE id = ?',
          [uri, id]
        );
      }
      // Stale notification_ids: every series will be rehydrated when the
      // user unlocks the vault again, so just clear them now.
      await db.runAsync(
        `UPDATE scheduled_prompts SET notification_id = NULL WHERE notification_id IS NOT NULL`
      );
      await db.runAsync(
        `UPDATE comments SET notification_id = NULL WHERE notification_id IS NOT NULL`
      );
    }
    // Close again so the AppShell re-init runs against the restored file.
    await closeDatabase();

    onProgress?.({ stage: 'done' });
    return {
      mode,
      photosRestored: photoIdToUri.size,
      voiceRestored: voiceIdToUri.size,
      skipped: manifest.skipped?.length || 0,
    };
  } finally {
    safeDelete(extractDir);
  }
}

// ---- Last-backup bookkeeping ---------------------------------------------
//
// "When did this device last produce a backup of this vault?" This is device /
// install state, deliberately NOT in the DB (a DB-stored timestamp would
// travel inside the zip and regress on restore) and NOT a secret (so not
// secure-store). A small JSON file at documentDirectory root, keyed by
// vault id, survives a restore (restoreFromZip only touches journal.db +
// the attachments dir) and is wiped only by a full app-data clear, at
// which point the answer is moot anyway.
//
// Honest limitation: Sharing.shareAsync resolves on share-sheet *dismiss*,
// not on a confirmed save, and returns no result. So this records "a
// backup was created and the sheet opened", never "a backup is safely
// stored". UI copy must say "created", never "saved/safe".

export const BACKUP_STALE_DAYS = 30;

const BACKUP_META_URI = `${FileSystem.documentDirectory}backup-meta.json`;

async function readBackupMeta() {
  try {
    const raw = await FileSystem.readAsStringAsync(BACKUP_META_URI);
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.vaults) return parsed;
  } catch {
    // Silent on purpose: the meta file doesn't exist until the first
    // backup; unreadable/corrupt meta degrades to "never backed up".
  }
  return { version: 1, vaults: {} };
}

export async function getLastBackup(vaultId) {
  if (vaultId == null) return null;
  const meta = await readBackupMeta();
  const entry = meta.vaults?.[String(vaultId)];
  if (!entry || !entry.lastBackupAt) return null;
  return { at: entry.lastBackupAt, mode: entry.mode || null };
}

// Single enforcement point: only DB-bearing, restore-capable modes reset
// the staleness clock. media-only archives cannot be restored, so counting
// one as a backup would be a lie even if the screen forgot to guard.
export async function recordBackup(vaultId, mode) {
  if (vaultId == null) return;
  if (mode !== BACKUP_MODE_FULL && mode !== BACKUP_MODE_DATA_ONLY) return;
  const meta = await readBackupMeta();
  if (!meta.vaults) meta.vaults = {};
  meta.vaults[String(vaultId)] = {
    lastBackupAt: new Date().toISOString(),
    mode,
  };
  try {
    await FileSystem.writeAsStringAsync(
      BACKUP_META_URI,
      JSON.stringify(meta, null, 2)
    );
  } catch (e) {
    warn('backup.recordBackup', e);
  }
}

// ---- Home backup nudge -----------------------------------------------------
//
// State for the quiet one-line strip on Home (v0.79.0). It lives beside the
// last-backup bookkeeping (same meta file, same per-vault entry) because it
// IS backup bookkeeping: "stale + unbacked-up writes + not snoozed".
// recordBackup wholesale-replaces the vault entry, which deliberately also
// clears any snooze: a fresh backup resets the whole conversation.

const NUDGE_SNOOZE_DAYS = 7;

export async function snoozeBackupNudge(vaultId, days = NUDGE_SNOOZE_DAYS) {
  if (vaultId == null) return;
  const meta = await readBackupMeta();
  if (!meta.vaults) meta.vaults = {};
  const key = String(vaultId);
  meta.vaults[key] = {
    ...(meta.vaults[key] || {}),
    nudgeSnoozedUntil: new Date(
      Date.now() + days * 86400000
    ).toISOString(),
  };
  try {
    await FileSystem.writeAsStringAsync(
      BACKUP_META_URI,
      JSON.stringify(meta, null, 2)
    );
  } catch (e) {
    warn('backup.snoozeNudge', e);
  }
}

// Decides whether Home shows the strip. Never nudges an empty vault, a
// tutorial-only vault (seeded rows aren't the user's data), or a vault
// with nothing written since the last backup. The strip only appears
// when there is actually something at risk.
export async function getBackupNudge(vaultId) {
  const none = { show: false, never: false, ageText: null };
  if (vaultId == null) return none;
  const db = getDb();
  if (!db) return none;
  const meta = await readBackupMeta();
  const entry = meta.vaults?.[String(vaultId)] || {};
  const lastAt = entry.lastBackupAt || null;
  if (!isBackupStale(lastAt)) return none;
  const snoozedUntil = entry.nudgeSnoozedUntil
    ? Date.parse(entry.nudgeSnoozedUntil)
    : NaN;
  if (Number.isFinite(snoozedUntil) && snoozedUntil > Date.now()) return none;
  let row = null;
  try {
    row = await db.getFirstAsync(
      `SELECT COUNT(*) AS n, MAX(updated_at) AS m
         FROM entries
        WHERE COALESCE(seeded, 0) = 0`
    );
  } catch {
    return none;
  }
  if (!row || !row.n) return none;
  if (lastAt && row.m) {
    // updated_at is SQLite space-form UTC, lastBackupAt is a JS ISO string:
    // the same family as the comments.remind_at gotcha, so compare as parsed
    // datetimes in JS, never as strings.
    const lastWrite = Date.parse(`${row.m.replace(' ', 'T')}Z`);
    if (!(lastWrite > Date.parse(lastAt))) return none;
  }
  return {
    show: true,
    never: !lastAt,
    ageText: lastAt ? formatBackupAge(lastAt) : null,
  };
}

function startOfLocalDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function localDayDiff(at, now) {
  // Math.round absorbs the ±1h DST drift between two local midnights.
  return Math.round(
    (startOfLocalDay(now) - startOfLocalDay(at)) / 86400000
  );
}

// Pure + deterministic. No test runner in this project, so this is
// dependency-free by design. Verify against the table in the PR body.
export function formatBackupAge(iso, now = Date.now()) {
  if (!iso) return 'Never backed up';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 'Never backed up';
  const diffMs = now - at;
  if (diffMs < 0) return 'just now';          // clock skew: never "in the future"
  if (diffMs < 60 * 1000) return 'just now';  // checked before calendar buckets
  const dayDiff = localDayDiff(at, now);
  if (dayDiff <= 0) return 'today';
  if (dayDiff === 1) return 'yesterday';
  if (dayDiff <= 13) return `${dayDiff} days ago`;
  if (dayDiff <= 59) return `${Math.floor(dayDiff / 7)} weeks ago`;
  return `${Math.floor(dayDiff / 30)} months ago`;
}

export function isBackupStale(iso, now = Date.now()) {
  if (!iso) return true;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return true;
  return localDayDiff(at, now) > BACKUP_STALE_DAYS;
}
