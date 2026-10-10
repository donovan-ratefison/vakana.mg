// Notification tap → in-app destination (v0.87.0).
//
// The PIN gate makes this a hand-off, not a straight navigation: the tap
// can arrive while the navigator doesn't exist yet (cold start, or the
// app re-locked in the background). So this module only *stores* the
// payload; HomeScreen (the stack's initial route, which by construction
// mounts only after unlock and DB init) consumes it and navigates
// through the SAME handlers the in-app banners use (tap ≠ acknowledge,
// exactly like a banner tap; N15's engage-to-ack rule is untouched).
//
// Payload contract (set at schedule time in utils/notifications.js):
//   { kind: 'reminder', reminderId }:              scheduled prompt
//   { kind: 'comment', parentKind, parentId }:     comment-reminder
//
// Cold start: getLastNotificationResponseAsync reflects the launching
// intent: it resolves null on a normal launcher open, so there is no
// replay of stale taps. Warm taps (app alive, foreground or background)
// arrive through the response listener.

import * as Notifications from 'expo-notifications';
import { warn } from './log';

let pendingRoute = null;
let consumer = null;

const accept = (response) => {
  const data = response?.notification?.request?.content?.data;
  if (!data || !data.kind) return;
  pendingRoute = data;
  if (consumer) {
    const route = pendingRoute;
    pendingRoute = null;
    consumer(route);
  }
};

// Called once from App.js at mount. Safe to call in Expo Go (listeners
// just never fire there).
export function initNotificationResponseHandling() {
  try {
    Notifications.addNotificationResponseReceivedListener(accept);
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) accept(response);
      })
      .catch(() => {});
  } catch (e) {
    warn('notificationRouting.init', e);
  }
}

// HomeScreen registers itself here on mount and hands back a cleanup.
// Anything pending (a cold-start tap that arrived before the screen
// existed) is delivered immediately.
export function setNotificationRouteConsumer(fn) {
  consumer = fn;
  if (consumer && pendingRoute) {
    const route = pendingRoute;
    pendingRoute = null;
    consumer(route);
  }
  return () => {
    if (consumer === fn) consumer = null;
  };
}
