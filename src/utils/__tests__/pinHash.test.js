import { createHash } from 'crypto';
import {
  PIN_HASH_ROUNDS,
  PIN_HASH_VERSION,
  bytesToHex,
  checkPinAgainstRecord,
  derivePinHash,
  encodePinRecord,
  hexEquals,
  isHashedPinRecord,
  lockoutDurationMs,
  parsePinRecord,
  remainingLockoutMs,
  stateAfterFailure,
  formatLockoutMessage,
} from '../pinHash';

const sha256 = async (bytes) => new Uint8Array(createHash('sha256').update(bytes).digest());
const SALT = Uint8Array.from({ length: 16 }, (_, i) => i);

// Independent reference: salt||pin, then (rounds - 1) re-hashes.
function reference(pin, salt, rounds) {
  let h = createHash('sha256').update(salt).update(pin, 'utf8').digest();
  for (let i = 1; i < rounds; i++) h = createHash('sha256').update(h).digest();
  return h.toString('hex');
}

describe('record format', () => {
  test('current version is v2 with 100 rounds', () => {
    expect(PIN_HASH_VERSION).toBe('v2');
    expect(PIN_HASH_ROUNDS.v2).toBe(100);
    expect(PIN_HASH_ROUNDS.v1).toBe(5000);
  });

  test('derivePinHash matches an independent SHA-256 chain', async () => {
    expect(await derivePinHash('1234', SALT, sha256, 3)).toBe(reference('1234', SALT, 3));
  });

  test('encodePinRecord writes v2$salt$hash and parses back', async () => {
    const rec = await encodePinRecord('1234', SALT, sha256);
    expect(rec).toBe(`v2$${bytesToHex(SALT)}$${reference('1234', SALT, 100)}`);
    expect(isHashedPinRecord(rec)).toBe(true);
    expect(parsePinRecord(rec)).toMatchObject({ version: 'v2', hashHex: reference('1234', SALT, 100) });
  });

  test('isHashedPinRecord knows v1 and v2, nothing else', () => {
    expect(isHashedPinRecord(`v1$${bytesToHex(SALT)}$${'a'.repeat(64)}`)).toBe(true);
    expect(isHashedPinRecord('1234')).toBe(false);
    expect(isHashedPinRecord(`v9$${bytesToHex(SALT)}$${'a'.repeat(64)}`)).toBe(false);
    expect(isHashedPinRecord(null)).toBe(false);
  });

  test('hexEquals', () => {
    expect(hexEquals('abcd', 'abcd')).toBe(true);
    expect(hexEquals('abcd', 'abce')).toBe(false);
    expect(hexEquals('abcd', 'abc')).toBe(false);
  });
});

describe('checkPinAgainstRecord', () => {
  test('v2 record: right PIN ok, no rehash; wrong PIN rejected', async () => {
    const rec = await encodePinRecord('1234', SALT, sha256);
    expect(await checkPinAgainstRecord('1234', rec, sha256)).toEqual({ ok: true, needsRehash: false });
    expect(await checkPinAgainstRecord('4321', rec, sha256)).toEqual({ ok: false, needsRehash: false });
  });

  test('v1 record (0.89.0 builds) still verifies and asks for a rehash', async () => {
    const v1 = `v1$${bytesToHex(SALT)}$${reference('1234', SALT, 5000)}`;
    expect(await checkPinAgainstRecord('1234', v1, sha256)).toEqual({ ok: true, needsRehash: true });
    expect(await checkPinAgainstRecord('0000', v1, sha256)).toEqual({ ok: false, needsRehash: false });
  });

  test('legacy plain-text PIN verifies and asks for a rehash', async () => {
    expect(await checkPinAgainstRecord('1234', '1234', sha256)).toEqual({ ok: true, needsRehash: true });
    expect(await checkPinAgainstRecord('1235', '1234', sha256)).toEqual({ ok: false, needsRehash: false });
  });

  test('missing or malformed record never unlocks', async () => {
    expect((await checkPinAgainstRecord('1234', null, sha256)).ok).toBe(false);
    expect((await checkPinAgainstRecord('1234', '', sha256)).ok).toBe(false);
    expect((await checkPinAgainstRecord('1234', 'v2$zz$short', sha256)).ok).toBe(false);
  });
});

describe('backoff', () => {
  test('four free misses, then 30 s doubling, capped at 15 min', () => {
    expect([1, 2, 3, 4].map(lockoutDurationMs)).toEqual([0, 0, 0, 0]);
    expect(lockoutDurationMs(5)).toBe(30_000);
    expect(lockoutDurationMs(6)).toBe(60_000);
    expect(lockoutDurationMs(7)).toBe(120_000);
    expect(lockoutDurationMs(50)).toBe(15 * 60_000);
  });

  test('stateAfterFailure sets a wall-clock deadline from the 5th miss', () => {
    let s = { failures: 0, lockedUntil: 0 };
    for (let i = 0; i < 4; i++) s = stateAfterFailure(s, 1000);
    expect(s).toEqual({ failures: 4, lockedUntil: 0 });
    s = stateAfterFailure(s, 1000);
    expect(s).toEqual({ failures: 5, lockedUntil: 31_000 });
  });

  test('remainingLockoutMs survives restarts and clamps a clock moved backwards', () => {
    const s = { failures: 5, lockedUntil: 31_000 };
    expect(remainingLockoutMs(s, 16_000)).toBe(15_000);
    expect(remainingLockoutMs(s, 40_000)).toBe(0);
    expect(remainingLockoutMs({ failures: 5, lockedUntil: 10_000_000 }, 0)).toBe(30_000);
  });

  test('formatLockoutMessage', () => {
    expect(formatLockoutMessage(30_000)).toBe('Too many attempts. Try again in 0:30');
    expect(formatLockoutMessage(61_500)).toBe('Too many attempts. Try again in 1:02');
  });
});
