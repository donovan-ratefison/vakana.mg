// Quiet-band threshold for the threads list (R2). A peer to `wander.js`
// in stance: a single integer-day knob persisted in expo-secure-store,
// read by `ThreadsList` on mount + focus, configured in
// `SettingsThreadsScreen`. Unlike Wander, there's no enable toggle: the
// Quiet band is naturally conditional (it only renders when at least one
// thread qualifies), so the threshold *is* the control.
import {
  loadThresholdDays,
  saveThresholdDays,
} from './thresholds';

const KEY_QUIET = 'journal_quiet_threshold_days';
const DEFAULT_QUIET_DAYS = 180;

export async function loadQuietThreshold() {
  return loadThresholdDays(KEY_QUIET, DEFAULT_QUIET_DAYS);
}

export async function saveQuietThreshold(days) {
  return saveThresholdDays(KEY_QUIET, days);
}

export const QUIET_THRESHOLD_OPTIONS = [
  { days: 30,  label: '30 days'  },
  { days: 90,  label: '90 days'  },
  { days: 180, label: '180 days' },
  { days: 365, label: '365 days' },
];

export const QUIET_DEFAULT_THRESHOLD_DAYS = DEFAULT_QUIET_DAYS;
