// Shared threshold utilities: the "days" knob used by Wander (R3) and
// the Quiet band (R2). Both surfaces persist a single integer in
// expo-secure-store and want the same validation contract: integer days,
// 1–3650 (1 day for testing-friendliness, 10-year cap so the secure-store
// value can't grow unbounded). The Custom-day input UX in both Settings
// screens routes through `clampThresholdDays` on commit so out-of-range
// or non-numeric input never reaches the persisted value.
//
// Why a dedicated module rather than just `wander.js`: Wander's module
// already carries Wander-specific framing (the Bell pairing, the
// `enabled` toggle, the threshold options list). Putting the generic
// clamp / load-by-key / save-by-key helpers here keeps `wander.js` from
// becoming the de-facto home of every threshold the app might add later
// (Quiet today, and conceivably others tomorrow). The Wander module
// re-exports its own typed helpers and uses `clampThresholdDays`
// internally; the Quiet module just consumes this directly.
import * as SecureStore from 'expo-secure-store';

export const THRESHOLD_MIN_DAYS = 1;
export const THRESHOLD_MAX_DAYS = 3650;

// Clamp arbitrary input to a valid integer day count, or return null
// when the input can't be coerced. Callers should treat `null` as
// "ignore this commit, keep the previous value", never as zero or as
// the default. The default belongs to the load path, not the parse path.
export function clampThresholdDays(input) {
  // Numbers and numeric strings both pass through `parseInt`. The
  // base-10 guard is important: `parseInt('0x10')` would otherwise
  // succeed as 16, and we want plain decimal days only.
  const n = typeof input === 'number' ? input : parseInt(String(input), 10);
  if (!Number.isFinite(n)) return null;
  const floored = Math.trunc(n);
  if (floored < THRESHOLD_MIN_DAYS) return THRESHOLD_MIN_DAYS;
  if (floored > THRESHOLD_MAX_DAYS) return THRESHOLD_MAX_DAYS;
  return floored;
}

// Load a threshold from secure-store under `key`. Returns `defaultDays`
// (no clamp: callers' default is assumed sane) if the key is absent or
// holds garbage. The stored value is re-clamped on read so a value
// written by an older build (when the range was wider/narrower) snaps
// back into the current contract.
export async function loadThresholdDays(key, defaultDays) {
  try {
    const v = await SecureStore.getItemAsync(key);
    if (v == null) return defaultDays;
    const parsed = clampThresholdDays(v);
    return parsed == null ? defaultDays : parsed;
  } catch {
    return defaultDays;
  }
}

// Save a threshold. Re-clamps before writing so even a programmer
// mistake (handing this function a stringified non-number) doesn't
// corrupt the stored value. Returns the value actually written.
export async function saveThresholdDays(key, days) {
  const clamped = clampThresholdDays(days);
  if (clamped == null) return null;
  try {
    await SecureStore.setItemAsync(key, String(clamped));
  } catch (e) {
    console.warn(`saveThresholdDays(${key}) failed:`, e?.message || e);
  }
  return clamped;
}
