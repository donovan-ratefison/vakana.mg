import * as SQLite from 'expo-sqlite';
import { getCurrentDbFilename } from '../database/db';

// Web only. Removes the media folder and the database of a vault from the
// origin private file system (OPFS). A failure throws: the caller then keeps
// the vault in the registry.
export async function deleteVaultFiles(vault) {
  const id = vault?.id;
  if (!id || id.includes('/') || id.includes('..')) {
    throw new Error('Invalid vault id');
  }
  // The registry is plain data: it must never point at the open database.
  if (vault.dbFilename === getCurrentDbFilename()) {
    throw new Error('This vault is open');
  }

  // Media first: this is the step that can fail, and the database is then intact.
  try {
    const root = await navigator.storage.getDirectory();
    const attachments = await root.getDirectoryHandle('attachments');
    await attachments.removeEntry(id, { recursive: true });
  } catch (e) {
    if (e?.name !== 'NotFoundError') throw e; // no media folder: nothing to remove
  }

  // expo-sqlite keeps each database in a pool file with a random name, so the
  // deletion goes through its own API. A name that does not exist is ignored.
  for (const suffix of ['', '-journal', '-wal']) {
    await SQLite.deleteDatabaseAsync(`${vault.dbFilename}${suffix}`);
  }
}
