import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { warn } from './log';

let notificationsAvailable = true;

try {
  Notifications.setNotificationHandler({
    // shouldShowBanner/shouldShowList replaced the deprecated
    // shouldShowAlert (banner = heads-up presentation, list = the
    // notification shade); together they are the old behavior.
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
} catch {
  notificationsAvailable = false;
}

export function isNotificationsSupported() {
  return notificationsAvailable;
}

export async function requestNotificationPermissions() {
  if (!notificationsAvailable) return false;
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

// `data` (optional) is the tap payload: a plain serializable object the
// response listener routes on (see utils/notificationRouting.js). Reminder
// notifications carry { kind: 'reminder', reminderId }; comment-reminders
// carry { kind: 'comment', parentKind, parentId }.
export async function schedulePromptNotification(title, message, date, time, data) {
  if (!notificationsAvailable) return null;
  try {
    const [year, month, day] = date.split('-').map(Number);
    const [hours, minutes] = time.split(':').map(Number);

    const triggerDate = new Date(year, month - 1, day, hours, minutes, 0);

    if (triggerDate <= new Date()) {
      return null;
    }

    // The trigger MUST be the explicit object form: since SDK 52-era
    // expo-notifications, parseTrigger rejects anything without a `type`
    // (or `channelId`) entry: a raw Date throws a TypeError, which the
    // catch below used to swallow silently. That combination is why no OS
    // notification ever fired between the SDK upgrade and v0.86.1.
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: title || 'Journal Reminder',
        body: message || 'Time to write in your journal!',
        sound: true,
        data: data || undefined,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: triggerDate,
      },
    });

    return notificationId;
  } catch (e) {
    // Never silent: a thrown schedule is exactly the failure mode that
    // hid the raw-Date break for months. Callers still get null (the
    // in-app banner path doesn't depend on the OS schedule).
    console.warn('Notification scheduling failed:', e?.message || e);
    return null;
  }
}

// Generalised version of schedulePromptNotification: takes a Date directly
// so callers (e.g. comment-reminders) can compose their own time arithmetic.
export async function scheduleNotificationAt(title, message, date, data) {
  if (!notificationsAvailable) return null;
  try {
    if (!(date instanceof Date) || isNaN(date.getTime())) return null;
    if (date <= new Date()) return null;
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: title || 'Journal',
        body: message || '',
        sound: true,
        data: data || undefined,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date,
      },
    });
    return notificationId;
  } catch (e) {
    console.warn('Notification scheduling failed:', e?.message || e);
    return null;
  }
}

export async function cancelNotification(notificationId) {
  if (!notificationsAvailable || !notificationId) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch (e) {
    warn('notifications.cancel', e);
  }
}

// Identifiers of every notification currently scheduled with the OS.
// The boot rehydrate passes use this to be idempotent: a reminder whose
// stored notification_id is still live is left alone; one whose id is
// missing/stale (the raw-Date era stored NULLs; a reboot can drop alarms)
// gets a fresh schedule. Returns a Set; empty on any failure.
export async function getScheduledNotificationIds() {
  if (!notificationsAvailable) return new Set();
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    return new Set(scheduled.map((s) => s.identifier));
  } catch (e) {
    console.warn('Reading scheduled notifications failed:', e?.message || e);
    return new Set();
  }
}
