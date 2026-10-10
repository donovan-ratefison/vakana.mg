import * as FileSystem from 'expo-file-system/legacy';
import { getDb } from '../database/db';
import { getCurrentVaultId, attachmentsDirFor } from '../utils/vaults';
import { warn } from '../utils/log';

// Media persistence for entry attachments. ImagePicker, the audio
// recorder, and DocumentPicker all land their files in the app's *cache*
// directory, which the OS and third-party "cleaner" apps (the field
// data loss was a Xiaomi cleaner) may wipe at any time. Every URI must
// be copied under documentDirectory/attachments/<vaultId>/ before it is
// written to entry_photos / entry_voice_notes. This module owns that
// invariant: the copy-on-attach helpers, the startup rescue pass that
// migrates pre-existing cache URIs, and the orphan sweep that deletes
// files no row references any more (attachment removal and entry
// deletion never delete files inline. The sweep is the single cleanup
// point, so fusion, batch delete, and the editor's wholesale
// delete+reinsert all stay file-agnostic).

const KIND_DIRS = { photo: 'photos/', voice: 'voice/' };

// A file must sit unreferenced for this long before the sweep may delete
// it. This closes the race with an attach whose copy has landed on disk but
// whose row hasn't committed yet.
const SWEEP_MIN_AGE_MS = 24 * 60 * 60 * 1000;

function extensionOf(uri) {
  const path = uri.split('?')[0];
  const dot = path.lastIndexOf('.');
  if (dot <= path.lastIndexOf('/')) return '';
  const ext = path.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? `.${ext}` : '';
}

async function ensureDir(dir) {
  try {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  } catch {
    // Silent on purpose: "already exists" is the common case, and a real
    // failure surfaces at the copyAsync that follows (logged by callers).
  }
}

async function copyIntoStore(uri, kind, root) {
  const dir = `${root}${KIND_DIRS[kind]}`;
  await ensureDir(dir);
  const name = `${kind[0]}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}${extensionOf(uri)}`;
  const dest = `${dir}${name}`;
  await FileSystem.copyAsync({ from: uri, to: dest });
  return dest;
}

// Copy a freshly captured/picked file into the vault's attachment store
// and return the durable URI. Non-file URIs pass through untouched, and
// any copy failure (disk full, source vanished) degrades to the original
// URI: a cache-resident attachment beats a lost one.
export async function persistMediaUri(uri, kind) {
  if (!uri || !KIND_DIRS[kind] || !uri.startsWith('file:')) return uri;
  try {
    const root = attachmentsDirFor(await getCurrentVaultId());
    if (uri.startsWith(root)) return uri;
    return await copyIntoStore(uri, kind, root);
  } catch (e) {
    console.warn('persistMediaUri: keeping original URI:', e?.message || e);
    return uri;
  }
}

export async function persistMediaUris(uris, kind) {
  const out = [];
  for (const uri of uris || []) {
    out.push(await persistMediaUri(uri, kind));
  }
  return out;
}

async function fileExists(uri) {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists ? info : null;
  } catch {
    return null;
  }
}

async function rescueTable(db, root, table, kind) {
  const rows = await db.getAllAsync(`SELECT id, uri FROM ${table}`);
  for (const row of rows) {
    const uri = row.uri || '';
    if (!uri || uri.startsWith(root)) continue;
    let next = null;
    // Already under an attachments/ path but with a stale root prefix
    // (iOS rewrites the app container path on update): re-root in place
    // rather than duplicating the file.
    const idx = uri.indexOf('attachments/');
    if (idx !== -1) {
      const rebuilt = `${FileSystem.documentDirectory}${uri.slice(idx)}`;
      if (rebuilt.startsWith(root) && (await fileExists(rebuilt))) {
        next = rebuilt;
      }
    }
    if (!next && uri.startsWith('file:') && (await fileExists(uri))) {
      try {
        next = await copyIntoStore(uri, kind, root);
      } catch (e) {
        warn('mediaStore.rescue', e);
      }
    }
    if (next) {
      await db.runAsync(`UPDATE ${table} SET uri = ? WHERE id = ?`, [
        next,
        row.id,
      ]);
    }
    // Unreadable and un-rootable: the bytes are already gone. Leave the
    // row: the dangling URI renders as a blank, same as before.
  }
}

async function sweepKind(db, root, kind) {
  const dir = `${root}${KIND_DIRS[kind]}`;
  let listing = [];
  try {
    listing = await FileSystem.readDirectoryAsync(dir);
  } catch {
    return; // directory doesn't exist yet: nothing to sweep
  }
  // Listing is snapshotted BEFORE the reference read: a file copied after
  // this point is never a deletion candidate, so a concurrent attach can't
  // be swept between its copy and its row insert.
  const table = kind === 'photo' ? 'entry_photos' : 'entry_voice_notes';
  const rows = await db.getAllAsync(`SELECT uri FROM ${table}`);
  const referenced = new Set(rows.map((r) => r.uri));
  const now = Date.now();
  for (const name of listing) {
    const uri = `${dir}${name}`;
    if (referenced.has(uri)) continue;
    const info = await fileExists(uri);
    if (!info) continue;
    // modificationTime is seconds-since-epoch in the legacy API.
    const ageMs = now - (info.modificationTime || 0) * 1000;
    if (ageMs < SWEEP_MIN_AGE_MS) continue;
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch (e) {
      warn('mediaStore.sweep', e);
    }
  }
}

// Startup pass, fire-and-forget from App.js after initDatabase():
// 1. rescue: rewrite every row whose URI still points at the cache (or
//    at a stale container path) to a durable attachments-store copy,
//    while the bytes are still readable;
// 2. sweep: delete store files no row references (removed photos,
//    deleted entries, fused-away sources), age-gated by SWEEP_MIN_AGE_MS.
// Any error aborts the pass silently. It re-runs next launch, and a
// closed DB handle (vault switch mid-pass) must never take down boot.
export async function rescueAndSweepMedia() {
  try {
    const db = getDb();
    if (!db) return;
    const root = attachmentsDirFor(await getCurrentVaultId());
    await rescueTable(db, root, 'entry_photos', 'photo');
    await rescueTable(db, root, 'entry_voice_notes', 'voice');
    await sweepKind(db, root, 'photo');
    await sweepKind(db, root, 'voice');
  } catch (e) {
    console.warn('rescueAndSweepMedia aborted:', e?.message || e);
  }
}
