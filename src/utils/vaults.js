import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import { warn } from './log';

// Vault registry: every vault is a separate SQLite file with its own PIN
// and its own attachments. The default vault preserves pre-v0.7 data:
// `journal.db` plus the existing PIN under `journal_app_pin` get migrated
// into `journal_pin_default` on first boot.

const REGISTRY_KEY = 'journal_vaults';
const CURRENT_KEY = 'journal_current_vault';
const LEGACY_PIN_KEY = 'journal_app_pin';
const LEGACY_PIN_SET_KEY = 'journal_app_pin_set';
const MIGRATED_KEY = 'journal_vaults_migrated_v1';
export const DEFAULT_VAULT_ID = 'default';
export const DEFAULT_VAULT_NAME = 'Journal';
export const DEFAULT_DB_FILENAME = 'journal.db';

export function pinKeyForVault(vaultId) {
  return `journal_pin_${vaultId}`;
}

export function pinSetKeyForVault(vaultId) {
  return `journal_pin_${vaultId}_set`;
}

// Failed-unlock counter + lockout deadline (JSON, see utils/pinHash.js).
export function pinAttemptsKeyForVault(vaultId) {
  return `journal_pin_${vaultId}_attempts`;
}

// The pre-v0.7 migration above copies the plain-text PIN into the default
// vault's key but never deleted the original. Once the migration flag is
// set nothing reads `journal_app_pin` again, so drop it. Otherwise a
// plain-text copy outlives the switch to hashed storage. Idempotent.
export async function purgeLegacyPinKeys() {
  try {
    if ((await SecureStore.getItemAsync(MIGRATED_KEY)) !== 'true') return;
    await SecureStore.deleteItemAsync(LEGACY_PIN_KEY);
    await SecureStore.deleteItemAsync(LEGACY_PIN_SET_KEY);
  } catch (e) {
    console.warn('purgeLegacyPinKeys failed', e);
  }
}

function dbFilenameFor(vaultId) {
  if (vaultId === DEFAULT_VAULT_ID) return DEFAULT_DB_FILENAME;
  return `journal_${vaultId}.db`;
}

function newVaultId() {
  return `v_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function readRegistry() {
  try {
    const raw = await SecureStore.getItemAsync(REGISTRY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((v) => v && v.id && v.name && v.dbFilename);
  } catch {
    return null;
  }
}

async function writeRegistry(vaults) {
  await SecureStore.setItemAsync(REGISTRY_KEY, JSON.stringify(vaults));
}

async function ensureMigrated() {
  const done = await SecureStore.getItemAsync(MIGRATED_KEY);
  if (done === 'true') return;

  const legacyPin = await SecureStore.getItemAsync(LEGACY_PIN_KEY);
  const legacyPinSet = await SecureStore.getItemAsync(LEGACY_PIN_SET_KEY);

  if (legacyPin) {
    await SecureStore.setItemAsync(pinKeyForVault(DEFAULT_VAULT_ID), legacyPin);
  }
  if (legacyPinSet === 'true') {
    await SecureStore.setItemAsync(pinSetKeyForVault(DEFAULT_VAULT_ID), 'true');
  }

  await SecureStore.setItemAsync(MIGRATED_KEY, 'true');
}

export async function getCurrentVaultId() {
  await ensureRegistry();
  const stored = await SecureStore.getItemAsync(CURRENT_KEY);
  if (stored) {
    const list = (await readRegistry()) || [];
    if (list.some((v) => v.id === stored)) return stored;
  }
  return DEFAULT_VAULT_ID;
}

export async function ensureRegistry() {
  await ensureMigrated();
  let list = await readRegistry();
  if (!list || list.length === 0) {
    list = [
      {
        id: DEFAULT_VAULT_ID,
        name: DEFAULT_VAULT_NAME,
        dbFilename: DEFAULT_DB_FILENAME,
      },
    ];
    await writeRegistry(list);
  }
  const current = await SecureStore.getItemAsync(CURRENT_KEY);
  if (!current || !list.some((v) => v.id === current)) {
    await SecureStore.setItemAsync(CURRENT_KEY, list[0].id);
  }
  return list;
}

export async function listVaults() {
  return await ensureRegistry();
}

export async function getVault(vaultId) {
  const list = await ensureRegistry();
  return list.find((v) => v.id === vaultId) || null;
}

export async function getCurrentVault() {
  const id = await getCurrentVaultId();
  return await getVault(id);
}

export async function createVault(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Vault name cannot be empty');
  const list = await ensureRegistry();
  if (list.some((v) => v.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error('A vault with this name already exists');
  }
  const id = newVaultId();
  const vault = { id, name: trimmed, dbFilename: dbFilenameFor(id) };
  list.push(vault);
  await writeRegistry(list);
  return vault;
}

export async function renameVault(vaultId, nextName) {
  const trimmed = (nextName || '').trim();
  if (!trimmed) throw new Error('Vault name cannot be empty');
  const list = await ensureRegistry();
  const idx = list.findIndex((v) => v.id === vaultId);
  if (idx === -1) throw new Error('Vault not found');
  if (
    list.some(
      (v) => v.id !== vaultId && v.name.toLowerCase() === trimmed.toLowerCase()
    )
  ) {
    throw new Error('A vault with this name already exists');
  }
  list[idx] = { ...list[idx], name: trimmed };
  await writeRegistry(list);
  return list[idx];
}

export async function setCurrentVault(vaultId) {
  const list = await ensureRegistry();
  if (!list.some((v) => v.id === vaultId)) {
    throw new Error('Vault not found');
  }
  await SecureStore.setItemAsync(CURRENT_KEY, vaultId);
}

export async function deleteVault(vaultId) {
  const list = await ensureRegistry();
  if (list.length <= 1) {
    throw new Error('Cannot delete the only vault');
  }
  const target = list.find((v) => v.id === vaultId);
  if (!target) throw new Error('Vault not found');
  const current = await getCurrentVaultId();
  if (current === vaultId) {
    throw new Error('Switch to another vault before deleting this one');
  }

  // Remove DB file + WAL siblings + attachments folder.
  const sqliteDir = `${FileSystem.documentDirectory}SQLite/`;
  const candidates = [
    target.dbFilename,
    `${target.dbFilename}-journal`,
    `${target.dbFilename}-wal`,
    `${target.dbFilename}-shm`,
  ];
  for (const name of candidates) {
    const uri = `${sqliteDir}${name}`;
    try {
      const info = await FileSystem.getInfoAsync(uri);
      if (info.exists) await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch (e) {
      warn('vaults.deleteVault.dbFile', e);
    }
  }
  const attachDir = `${FileSystem.documentDirectory}attachments/${vaultId}/`;
  try {
    const info = await FileSystem.getInfoAsync(attachDir);
    if (info.exists) await FileSystem.deleteAsync(attachDir, { idempotent: true });
  } catch (e) {
    warn('vaults.deleteVault.attachments', e);
  }

  // Drop PIN keys for the vault.
  try {
    await SecureStore.deleteItemAsync(pinKeyForVault(vaultId));
  } catch (e) {
    warn('vaults.deleteVault.pinKey', e);
  }
  try {
    await SecureStore.deleteItemAsync(pinSetKeyForVault(vaultId));
  } catch (e) {
    warn('vaults.deleteVault.pinSetKey', e);
  }
  try {
    await SecureStore.deleteItemAsync(pinAttemptsKeyForVault(vaultId));
  } catch (e) {
    warn('vaults.deleteVault.pinAttemptsKey', e);
  }

  const next = list.filter((v) => v.id !== vaultId);
  await writeRegistry(next);
  return next;
}

export function dbFilePathFor(vault) {
  return `${FileSystem.documentDirectory}SQLite/${vault.dbFilename}`;
}

export function attachmentsDirFor(vaultId) {
  return `${FileSystem.documentDirectory}attachments/${vaultId}/`;
}
