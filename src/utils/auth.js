import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import {
  getCurrentVaultId,
  listVaults,
  pinKeyForVault,
  pinSetKeyForVault,
  pinAttemptsKeyForVault,
  purgeLegacyPinKeys,
} from './vaults';
import {
  PIN_SALT_BYTES,
  checkPinAgainstRecord,
  encodePinRecord,
  isHashedPinRecord,
  parseAttemptState,
  remainingLockoutMs,
  serializeAttemptState,
  stateAfterFailure,
} from './pinHash';

// PIN storage + unlock rate-limiting, per vault. The stored value is a
// salted, iterated SHA-256 record (`v2$<salt>$<hash>`, format and the
// iteration-count rationale in `utils/pinHash.js`); legacy plain-text values
// and older hash versions are still accepted and upgraded in place. The lock gates the in-app UI
// only: it does not encrypt the database or attachments.

// Each `Crypto.digest` is a native call with a fixed ~0.2 ms overhead on
// Android, so the round count in `pinHash.js` is kept small.
async function sha256(bytes) {
  const out = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return new Uint8Array(out);
}

async function hashRecordFor(pin) {
  const salt = Crypto.getRandomBytes(PIN_SALT_BYTES);
  return encodePinRecord(pin, salt, sha256);
}

async function keysFor(vaultId) {
  const id = vaultId ?? (await getCurrentVaultId());
  return {
    pin: pinKeyForVault(id),
    isSet: pinSetKeyForVault(id),
    attempts: pinAttemptsKeyForVault(id),
  };
}

async function readAttempts(key) {
  try {
    return parseAttemptState(await SecureStore.getItemAsync(key));
  } catch {
    return parseAttemptState(null);
  }
}

async function clearAttempts(key) {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch (e) {
    console.warn('clear PIN attempts failed', e);
  }
}

export async function isPinSet() {
  const { isSet } = await keysFor();
  const result = await SecureStore.getItemAsync(isSet);
  return result === 'true';
}

// Every "set PIN" path (first run on the lock screen, Change PIN) lands here,
// so nothing ever writes a plain-text PIN.
export async function setPin(pin) {
  const { pin: pinKey, isSet, attempts } = await keysFor();
  const record = await hashRecordFor(pin);
  await SecureStore.setItemAsync(pinKey, record);
  await SecureStore.setItemAsync(isSet, 'true');
  await clearAttempts(attempts);
  await purgeLegacyPinKeys();
}

// Check a PIN against the vault's record, upgrading a legacy plain-text
// record on a match. Not rate-limited: only for callers already past the
// lock (Change PIN's "new PIN must differ" check); the lock screen and the
// Change PIN verify step go through `attemptPin`.
async function checkPin(pin, pinKey) {
  const stored = await SecureStore.getItemAsync(pinKey);
  const { ok, needsRehash } = await checkPinAgainstRecord(pin, stored, sha256);
  if (ok && needsRehash) {
    try {
      await SecureStore.setItemAsync(pinKey, await hashRecordFor(pin));
      await purgeLegacyPinKeys();
    } catch (e) {
      // The legacy value still verifies next time; never lock the user out
      // over a failed upgrade.
      console.warn('PIN rehash failed', e);
    }
  }
  return ok;
}

export async function verifyPin(pin) {
  const { pin: pinKey } = await keysFor();
  return checkPin(pin, pinKey);
}

// Remaining lockout (ms) for the current vault; 0 when input is allowed.
export async function getPinLockoutMs() {
  const { attempts } = await keysFor();
  return remainingLockoutMs(await readAttempts(attempts), Date.now());
}

// Rate-limited unlock attempt → { ok, lockoutMs }.
// The failure is recorded *before* the PIN is checked and cleared on
// success, so killing the app between a wrong guess and its bookkeeping
// can't be used to dodge the counter.
export async function attemptPin(pin) {
  const { pin: pinKey, attempts } = await keysFor();
  const state = await readAttempts(attempts);
  const now = Date.now();
  const waiting = remainingLockoutMs(state, now);
  if (waiting > 0) return { ok: false, lockoutMs: waiting };

  const pessimistic = stateAfterFailure(state, now);
  try {
    await SecureStore.setItemAsync(attempts, serializeAttemptState(pessimistic));
  } catch (e) {
    console.warn('record PIN attempt failed', e);
  }

  const ok = await checkPin(pin, pinKey);
  if (ok) {
    await clearAttempts(attempts);
    return { ok: true, lockoutMs: 0 };
  }
  return { ok: false, lockoutMs: remainingLockoutMs(pessimistic, now) };
}

export async function removePin() {
  const { pin: pinKey, isSet, attempts } = await keysFor();
  await SecureStore.deleteItemAsync(pinKey);
  await SecureStore.deleteItemAsync(isSet);
  await clearAttempts(attempts);
}

export async function isPinSetForVault(vaultId) {
  const result = await SecureStore.getItemAsync(pinSetKeyForVault(vaultId));
  return result === 'true';
}

// Boot-time sweep: hash every vault's legacy plain-text PIN in place, so a
// vault the user doesn't open this session doesn't keep a readable PIN. The
// stored string *is* the PIN, so its hash verifies exactly as before.
// Idempotent and fire-and-forget; `checkPin` covers anything it misses.
export async function upgradeLegacyPinRecords() {
  try {
    const vaults = await listVaults();
    for (const v of vaults) {
      const pinKey = pinKeyForVault(v.id);
      const stored = await SecureStore.getItemAsync(pinKey);
      if (!stored || isHashedPinRecord(stored)) continue;
      const record = await hashRecordFor(stored);
      // Re-read so a PIN set/rehashed while we were hashing is never
      // overwritten with the old one.
      if ((await SecureStore.getItemAsync(pinKey)) !== stored) continue;
      await SecureStore.setItemAsync(pinKey, record);
    }
    await purgeLegacyPinKeys();
  } catch (e) {
    console.warn('upgradeLegacyPinRecords failed', e);
  }
}
