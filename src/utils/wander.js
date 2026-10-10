// Wander: opt-in chance return primitive.
//
// A peer to the Bell on the Home header: where Bell carries *intentional*
// returns the user set themselves (scheduled reminders, comment-reminders
// firing), Wander carries *chance* returns the system brings back: a
// random entry older than the configured threshold. Both compose into
// the same "the past arrives in the present" stance.
//
// Settings persist in expo-secure-store (mirrors the other low-stakes
// preferences in the app: theme mode, inline-comments, default home view).
// Default OFF: the user opts in; the dice icon is hidden until they do.
// Default threshold 6 months: long enough that re-encounter is genuinely
// "old" rather than recent context bleed.
//
// Privacy contract: private entries are excluded from the eligible pool
// at the query layer (see HomeScreen probe + tap query). This module
// only carries the user-facing preference values; the SQL is in
// HomeScreen because the pool depends on threshold + is_private only,
// and no other surface needs to know about the Wander pool.
import * as SecureStore from 'expo-secure-store';
import {
  clampThresholdDays,
  loadThresholdDays,
  saveThresholdDays,
} from './thresholds';

const KEY_ENABLED = 'journal_wander_enabled';
const KEY_THRESHOLD = 'journal_wander_threshold_days';
const DEFAULT_THRESHOLD_DAYS = 180;

// loadWanderSettings keeps its `{enabled, thresholdDays}` shape: the
// HomeScreen pool probe + dice tap both consume it that way. The
// integer-day validation now goes through the shared `thresholds.js`
// clamp so a Custom value written by the Settings screen survives a
// round-trip + clamp on read (snaps back into 1–3650 if a future build
// ever narrows the range).
export async function loadWanderSettings() {
  try {
    const [en, days] = await Promise.all([
      SecureStore.getItemAsync(KEY_ENABLED),
      loadThresholdDays(KEY_THRESHOLD, DEFAULT_THRESHOLD_DAYS),
    ]);
    return { enabled: en === 'true', thresholdDays: days };
  } catch {
    return { enabled: false, thresholdDays: DEFAULT_THRESHOLD_DAYS };
  }
}

export async function saveWanderEnabled(v) {
  try {
    await SecureStore.setItemAsync(KEY_ENABLED, v ? 'true' : 'false');
  } catch (e) {
    console.warn('saveWanderEnabled failed:', e?.message || e);
  }
}

export async function saveWanderThreshold(days) {
  return saveThresholdDays(KEY_THRESHOLD, days);
}

// Re-exported for the Settings screens' Custom-day input UX. It gives them
// a shared clamp without each importing from `thresholds.js` directly.
export { clampThresholdDays };

export const WANDER_THRESHOLD_OPTIONS = [
  { days: 90, label: '3 months' },
  { days: 180, label: '6 months' },
  { days: 365, label: '1 year' },
  { days: 730, label: '2 years' },
];

export const WANDER_DEFAULT_THRESHOLD_DAYS = DEFAULT_THRESHOLD_DAYS;
