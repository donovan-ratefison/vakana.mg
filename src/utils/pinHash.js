// Pure PIN-hash + backoff logic, no Expo imports: `utils/auth.js` wires it
// to expo-crypto and expo-secure-store. Kept dependency-free so the format,
// the comparison and the backoff curve can be exercised from plain node.
//
// Stored format (SecureStore, under the vault's pin key):
//
//   v2$<saltHex>$<hashHex>
//
//   salt  16 random bytes (Crypto.getRandomBytes)
//   hash  h1 = SHA-256(salt || utf8(pin)); h(k+1) = SHA-256(h(k));
//         PIN_HASH_ROUNDS[version] digests in total.
//
// Why so few rounds: a 4-digit PIN has 10 000 values, so no iteration
// count makes an offline brute force expensive (10 000 × 5000 SHA-256 is
// well under a second on a laptop). Iterating only buys a constant factor;
// the real controls are that the value sits in the Keystore/Keychain-backed
// SecureStore and that online guessing is rate-limited (backoff below).
// The count is sized for the unlock tap instead. Each `Crypto.digest` is a
// native call whose fixed overhead dominates a 32-byte hash: measured on the
// maker's Redmi (0.89.0), v1's 5000 rounds took close to a second after the
// fourth digit (~0.2 ms per round). v2 keeps 100 rounds (~20 ms).
//
// A known older version still verifies, and `needsRehash` re-stores it in
// the current version on the first successful unlock. Changing the count
// means a new version prefix, never an edit to an existing one.
//
// Anything without a known `vN$` prefix is a legacy plain-text PIN
// (pre-hash builds); it is verified by plain comparison and re-stored hashed
// on the first successful unlock.

export const PIN_HASH_ROUNDS = { v1: 5000, v2: 100 };
export const PIN_HASH_VERSION = 'v2';
export const PIN_SALT_BYTES = 16;

// Backoff: the first 4 consecutive failures are free; the 5th locks input
// for 30 s and every further failure doubles it, capped at 15 min.
export const FREE_ATTEMPTS = 4;
export const BASE_LOCKOUT_MS = 30 * 1000;
export const MAX_LOCKOUT_MS = 15 * 60 * 1000;

export function bytesToHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += (bytes[i] & 0xff).toString(16).padStart(2, '0');
  }
  return out;
}

export function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    return null;
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

// PINs are digits, but encode properly anyway (no reliance on TextEncoder /
// unescape being present in the JS engine).
function utf8Bytes(str) {
  const encoded = encodeURIComponent(String(str));
  const out = [];
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === '%') {
      out.push(parseInt(encoded.substr(i + 1, 2), 16));
      i += 2;
    } else {
      out.push(encoded.charCodeAt(i));
    }
  }
  return Uint8Array.from(out);
}

// Constant-time-ish equality for two hex strings: every character is
// visited regardless of where the first mismatch is. Length is not secret
// (both sides are 64-char SHA-256 hex), so an early length check is fine.
export function hexEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Same loop over arbitrary strings, used for the legacy plain-text compare.
function stringEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// `sha256(bytes: Uint8Array) => Promise<Uint8Array>` is injected so this
// module stays free of native imports.
export async function derivePinHash(pin, saltBytes, sha256, rounds = PIN_HASH_ROUNDS[PIN_HASH_VERSION]) {
  const pinBytes = utf8Bytes(pin);
  const first = new Uint8Array(saltBytes.length + pinBytes.length);
  first.set(saltBytes, 0);
  first.set(pinBytes, saltBytes.length);
  let h = await sha256(first);
  for (let i = 1; i < rounds; i++) {
    h = await sha256(h);
  }
  return bytesToHex(h);
}

export function isHashedPinRecord(stored) {
  if (typeof stored !== 'string') return false;
  const sep = stored.indexOf('$');
  return sep > 0 && Object.prototype.hasOwnProperty.call(PIN_HASH_ROUNDS, stored.slice(0, sep));
}

export function parsePinRecord(stored) {
  if (!isHashedPinRecord(stored)) return null;
  const parts = stored.split('$');
  if (parts.length !== 3) return null;
  const salt = hexToBytes(parts[1]);
  if (!salt || salt.length === 0 || !/^[0-9a-f]{64}$/i.test(parts[2])) return null;
  return { version: parts[0], salt, hashHex: parts[2].toLowerCase() };
}

export async function encodePinRecord(pin, saltBytes, sha256) {
  const hashHex = await derivePinHash(pin, saltBytes, sha256);
  return `${PIN_HASH_VERSION}$${bytesToHex(saltBytes)}$${hashHex}`;
}

// → { ok, needsRehash }. `needsRehash` is true when the PIN matched a
// legacy plain-text value or an older hash version, so the caller re-stores
// it in the current format.
export async function checkPinAgainstRecord(pin, stored, sha256) {
  if (stored == null || stored === '') return { ok: false, needsRehash: false };
  if (isHashedPinRecord(stored)) {
    const rec = parsePinRecord(stored);
    if (!rec) return { ok: false, needsRehash: false };
    const candidate = await derivePinHash(pin, rec.salt, sha256, PIN_HASH_ROUNDS[rec.version]);
    const ok = hexEquals(candidate, rec.hashHex);
    return { ok, needsRehash: ok && rec.version !== PIN_HASH_VERSION };
  }
  const ok = stringEquals(String(pin), stored);
  return { ok, needsRehash: ok };
}

// ---- Backoff --------------------------------------------------------------

export function lockoutDurationMs(failures) {
  if (failures <= FREE_ATTEMPTS) return 0;
  const exp = failures - FREE_ATTEMPTS - 1;
  // Cap the exponent too so a huge counter can't overflow to Infinity.
  return Math.min(MAX_LOCKOUT_MS, BASE_LOCKOUT_MS * Math.pow(2, Math.min(exp, 20)));
}

export function parseAttemptState(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    const failures = Number.isFinite(parsed?.failures) ? Math.max(0, parsed.failures) : 0;
    const lockedUntil = Number.isFinite(parsed?.lockedUntil) ? parsed.lockedUntil : 0;
    return { failures, lockedUntil };
  } catch {
    return { failures: 0, lockedUntil: 0 };
  }
}

export function serializeAttemptState(state) {
  return JSON.stringify({ failures: state.failures, lockedUntil: state.lockedUntil });
}

// The persisted `lockedUntil` is wall-clock based so it survives restarts.
// If the clock was moved backwards the stored deadline could sit hours out;
// clamp the remaining wait to the longest lockout this counter can earn.
export function remainingLockoutMs(state, now) {
  if (!state || !state.lockedUntil) return 0;
  const remaining = state.lockedUntil - now;
  if (remaining <= 0) return 0;
  return Math.min(remaining, Math.max(lockoutDurationMs(state.failures), BASE_LOCKOUT_MS));
}

export function stateAfterFailure(state, now) {
  const failures = (state?.failures || 0) + 1;
  const duration = lockoutDurationMs(failures);
  return { failures, lockedUntil: duration ? now + duration : 0 };
}

export function formatLockoutMessage(remainingMs) {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  return `Too many attempts. Try again in ${m}:${s}`;
}
