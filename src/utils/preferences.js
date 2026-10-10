import * as SecureStore from 'expo-secure-store';

const DEFAULT_HOME_VIEW_KEY = 'vakana_default_home_view';

export const HOME_VIEWS = ['list', 'calendar', 'threads'];

export async function getDefaultHomeView() {
  try {
    const v = await SecureStore.getItemAsync(DEFAULT_HOME_VIEW_KEY);
    return HOME_VIEWS.includes(v) ? v : 'list';
  } catch {
    return 'list';
  }
}

export async function setDefaultHomeView(view) {
  if (!HOME_VIEWS.includes(view)) return;
  try {
    await SecureStore.setItemAsync(DEFAULT_HOME_VIEW_KEY, view);
  } catch (e) {
    console.warn('setDefaultHomeView failed:', e?.message || e);
  }
}

// --- Onboarding slides ------------------------------------------------------
//
// One-shot marker for the first-launch intro slides (v0.78.0). App-level, not
// per-vault: the slides answer "what is this app", which the user only needs
// once. Replay lives in Settings → Pro Tips and does not touch the marker.

const ONBOARDING_SEEN_KEY = 'vakana_onboarding_seen';

export async function getOnboardingSeen() {
  try {
    return (await SecureStore.getItemAsync(ONBOARDING_SEEN_KEY)) === '1';
  } catch {
    // If the store is unreadable, err on not re-showing the intro.
    return true;
  }
}

export async function setOnboardingSeen() {
  try {
    await SecureStore.setItemAsync(ONBOARDING_SEEN_KEY, '1');
  } catch (e) {
    console.warn('setOnboardingSeen failed:', e?.message || e);
  }
}

// --- Auto-lock --------------------------------------------------------------
//
// How long the app may sit in the background before the PIN screen is
// required again on return. Global (not per-vault): it's a device-privacy
// preference. 'off' (default) keeps the pre-v0.69 behavior: unlocked for the
// session until you lock manually. The check is on *return to foreground*
// (see App.js's AppState listener), keyed off the true 'background' state so
// transient iOS 'inactive' blips (control center, a call) never re-lock.

const AUTO_LOCK_KEY = 'vakana_autolock';

export const AUTO_LOCK_OPTIONS = ['off', 'immediate', '1m', '5m', '15m'];

export async function getAutoLock() {
  try {
    const v = await SecureStore.getItemAsync(AUTO_LOCK_KEY);
    return AUTO_LOCK_OPTIONS.includes(v) ? v : 'off';
  } catch {
    return 'off';
  }
}

export async function setAutoLock(value) {
  if (!AUTO_LOCK_OPTIONS.includes(value)) return;
  try {
    await SecureStore.setItemAsync(AUTO_LOCK_KEY, value);
  } catch (e) {
    console.warn('setAutoLock failed:', e?.message || e);
  }
}

// Grace window in ms. 'off' → null (never auto-lock); 'immediate' → 0 (any
// return from the background re-locks).
export function autoLockGraceMs(value) {
  switch (value) {
    case 'immediate':
      return 0;
    case '1m':
      return 60 * 1000;
    case '5m':
      return 5 * 60 * 1000;
    case '15m':
      return 15 * 60 * 1000;
    default:
      return null;
  }
}
