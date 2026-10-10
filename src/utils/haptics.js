// Tactile vocabulary: a thin, centralised wrapper around expo-haptics so the
// app *feels handled*, not buzzy. The bead is a physical object (the craft the
// PWA retrospective named as missing); these are the few moments that are the
// encoding act, given a consistent feel. Guarded like notifications.js: if the
// module or platform can't vibrate, every call is a silent no-op (so callers
// never need their own try/catch, and nothing breaks in Expo Go / on web).
//
// The three notes, restrained on purpose (hand-tuned friction, not a rumble):
//   tap:   a faint confirm (selection): a filter engages, a reminder is acked
//   place: a bead settling onto the cord (light impact): composing/placing one
//   clasp: closing a loop (success): the ceremonial completion of a thread
import * as Haptics from 'expo-haptics';

let available = true;

const safe = (fn) => {
  if (!available) return;
  try {
    const r = fn();
    // expo-haptics returns a promise; swallow async rejections (e.g. a device
    // with no haptic engine) without surfacing them.
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch (e) {
    // A synchronous throw means the module isn't usable here. Stop trying.
    available = false;
  }
};

export const hapticTap = () => safe(() => Haptics.selectionAsync());

export const hapticPlace = () =>
  safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));

export const hapticClasp = () =>
  safe(() =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  );
