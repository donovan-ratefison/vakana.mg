import { getDb } from '../database/db';
import { getCurrentVaultId } from '../utils/vaults';
import { warn } from '../utils/log';

// Web counterpart of mediaStore.js. The picker gives a `blob:` URL that dies
// when the page reloads, so the bytes are copied into the origin private file
// system (OPFS) and the database keeps a stable reference:
//   opfs:attachments/<vaultId>/photos/<name>
// The path after `opfs:` is relative to navigator.storage.getDirectory().
// As on Android, the startup sweep is the only place that deletes a file.

const PREFIX = 'opfs:';
const KIND_DIRS = { photo: 'photos', voice: 'voice' };
const SWEEP_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'audio/webm': '.webm',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
};

// The file extension for a MIME type, or '' for an unknown type. The
// recorder gives a type with parameters (`audio/webm;codecs=opus`).
export function mediaExtension(type) {
  return EXTENSIONS[(type || '').split(';')[0].trim().toLowerCase()] || '';
}

async function openDir(path, create) {
  let dir = await navigator.storage.getDirectory();
  for (const part of path.split('/')) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir;
}

// Write a Blob into the store of the current vault, under a new name, and
// return its reference. `ext` is '' or starts with a dot.
export async function writeMediaBlob(blob, kind, ext = mediaExtension(blob.type)) {
  if (!KIND_DIRS[kind]) throw new Error(`unknown media kind: ${kind}`);
  const path = `attachments/${await getCurrentVaultId()}/${KIND_DIRS[kind]}`;
  const name = `${kind[0]}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
  const dir = await openDir(path, true);
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return `${PREFIX}${path}/${name}`;
}

// Copy a picked or captured file into OPFS and return its reference. A
// failure throws: a `blob:` URL in the database would be a silent loss.
export async function persistMediaUri(uri, kind) {
  if (!uri || uri.startsWith(PREFIX)) return uri;
  try {
    const ref = await writeMediaBlob(await (await fetch(uri)).blob(), kind);
    // The bytes are in OPFS: the URL of the picker is of no more use.
    if (uri.startsWith('blob:')) URL.revokeObjectURL(uri);
    return ref;
  } catch (e) {
    warn('mediaStore.persist', e);
    throw new Error(
      `The ${kind === 'voice' ? 'voice note' : 'photo'} could not be saved in this browser.`
    );
  }
}

export async function persistMediaUris(uris, kind) {
  const out = [];
  for (const uri of uris || []) {
    out.push(await persistMediaUri(uri, kind));
  }
  return out;
}

// The File behind a reference, or null (not a reference into `attachments/`,
// file missing). A reference comes from the database: it must not open
// another part of OPFS, such as the files of SQLite.
export async function openMediaFile(ref) {
  try {
    if (!ref.startsWith(`${PREFIX}attachments/`)) return null;
    const path = ref.slice(PREFIX.length);
    const cut = path.lastIndexOf('/');
    const dir = await openDir(path.slice(0, cut), false);
    return await (await dir.getFileHandle(path.slice(cut + 1))).getFile();
  } catch {
    return null;
  }
}

function missing() {
  return new Error('Media file is missing');
}

// Call `fn` with a URL that the image manipulator can load (it sets
// `img.src`, which cannot read an `opfs:` reference). A reference gets a
// `blob:` URL that lives only for the call. Any other URI is refused
// without a request: an export reads local files only.
export async function withMediaUrl(uri, fn) {
  if (uri?.startsWith('blob:') || uri?.startsWith('data:')) return fn(uri);
  const file = uri?.startsWith(PREFIX) ? await openMediaFile(uri) : null;
  if (!file) throw missing();
  const url = URL.createObjectURL(file);
  try {
    return await fn(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const BASE64_CHUNK = 32768;

// The raw base64 content (no `data:` prefix) of a referenced file.
export async function readMediaBase64(uri) {
  const file = uri?.startsWith(PREFIX) ? await openMediaFile(uri) : null;
  if (!file) throw missing();
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  // By chunks: one String.fromCharCode call on a big array overflows the stack.
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

async function sweepKind(db, vaultId, kind) {
  const path = `attachments/${vaultId}/${KIND_DIRS[kind]}`;
  let dir;
  const listing = [];
  try {
    dir = await openDir(path, false);
    for await (const name of dir.keys()) listing.push(name);
  } catch {
    return; // directory doesn't exist yet: nothing to sweep
  }
  // Listing is snapshotted BEFORE the reference read: a file copied after
  // this point is never a deletion candidate.
  const table = kind === 'photo' ? 'entry_photos' : 'entry_voice_notes';
  const rows = await db.getAllAsync(`SELECT uri FROM ${table}`);
  const referenced = new Set(rows.map((r) => r.uri));
  const now = Date.now();
  for (const name of listing) {
    if (referenced.has(`${PREFIX}${path}/${name}`)) continue;
    try {
      const file = await (await dir.getFileHandle(name)).getFile();
      if (now - file.lastModified < SWEEP_MIN_AGE_MS) continue;
      await dir.removeEntry(name);
    } catch (e) {
      warn('mediaStore.sweep', e);
    }
  }
}

// Startup pass, fire-and-forget from App.js. No rescue phase on web: a
// `blob:` URL from an earlier page is already dead. Sweep only: delete the
// files no row references, age-gated by SWEEP_MIN_AGE_MS.
export async function rescueAndSweepMedia() {
  try {
    const db = getDb();
    if (!db) return;
    const vaultId = await getCurrentVaultId();
    await sweepKind(db, vaultId, 'photo');
    await sweepKind(db, vaultId, 'voice');
  } catch (e) {
    console.warn('rescueAndSweepMedia aborted:', e?.message || e);
  }
}
