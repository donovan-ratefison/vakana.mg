// Reminder service. Wraps the ack/advance/management writes to
// `scheduled_prompts`. Recurrence-aware: a series ack advances the cursor
// to the next future occurrence (catching up missed fires in one shot)
// and only sets `acknowledged_at` when the series is one-shot or has hit
// its `recurrence_max` cap.

import { getDb } from '../database/db';
import {
  cancelNotification,
  getScheduledNotificationIds,
  schedulePromptNotification,
} from '../utils/notifications';
import { advanceSeries, computeMissedCount } from './recurrence';

async function loadRow(reminderId) {
  if (reminderId == null) return null;
  const db = getDb();
  if (!db) return null;
  return db.getFirstAsync('SELECT * FROM scheduled_prompts WHERE id = ?', [
    reminderId,
  ]);
}

// Acknowledge a reminder. For one-shot reminders (no recurrence_kind),
// sets `acknowledged_at` so the row drops out of the active list. For
// recurring reminders, advances the cursor past every missed occurrence,
// reschedules the OS notification for the next future fire, and bumps
// `recurrence_fired`. If the cap is reached during catchup, the series
// deactivates and `acknowledged_at` is set as a "done" marker.
//
// Returns { addedFires, reachedMax } for callers that want to surface
// "N due since you last looked" type copy.
export async function acknowledgeReminder(reminderId) {
  const db = getDb();
  if (!db) return { addedFires: 0, reachedMax: true };
  const row = await loadRow(reminderId);
  if (!row) return { addedFires: 0, reachedMax: true };

  // One-shot reminder. Same behavior as before recurrence existed.
  if (!row.recurrence_kind) {
    await db.runAsync(
      `UPDATE scheduled_prompts SET acknowledged_at = datetime('now') WHERE id = ?`,
      [reminderId]
    );
    return { addedFires: 1, reachedMax: true };
  }

  // Recurring. Advance the cursor.
  const result = advanceSeries({
    scheduledDate: row.scheduled_date,
    scheduledTime: row.scheduled_time,
    kind: row.recurrence_kind,
    every: row.recurrence_every,
    fired: row.recurrence_fired || 0,
    max: row.recurrence_max,
    now: new Date(),
    anchorDay: row.recurrence_anchor_day,
  });

  // Cancel the previously scheduled OS notification (the one for the
  // occurrence we just acked). For Expo Go on Android this is a no-op.
  if (row.notification_id) await cancelNotification(row.notification_id);

  if (result.reachedMax) {
    // Series finished. Mark acknowledged so the row leaves the active
    // panel; deactivate so it doesn't show in the recurring list either.
    await db.runAsync(
      `UPDATE scheduled_prompts
          SET acknowledged_at = datetime('now'),
              is_active = 0,
              recurrence_fired = ?,
              notification_id = NULL
        WHERE id = ?`,
      [(row.recurrence_fired || 0) + result.addedFires, reminderId]
    );
    return { addedFires: result.addedFires, reachedMax: true };
  }

  // Schedule the next OS notification for the new cursor.
  const nextNotificationId = await schedulePromptNotification(
    row.title || 'Journal Reminder',
    row.message || 'Time to write in your journal!',
    result.newDate,
    result.newTime,
    { kind: 'reminder', reminderId }
  );

  await db.runAsync(
    `UPDATE scheduled_prompts
        SET scheduled_date = ?,
            scheduled_time = ?,
            notification_id = ?,
            recurrence_fired = ?,
            acknowledged_at = NULL
      WHERE id = ?`,
    [
      result.newDate,
      result.newTime,
      nextNotificationId,
      (row.recurrence_fired || 0) + result.addedFires,
      reminderId,
    ]
  );

  return { addedFires: result.addedFires, reachedMax: false };
}

// Toggle a recurring reminder between active and stopped. Stopping cancels
// the next scheduled OS notification and flips `is_active` to 0; resuming
// schedules a fresh one for the *current cursor* (which still points at
// the occurrence that would have fired had it not been stopped) and flips
// it back. The cursor isn't advanced: pausing the series doesn't make
// time pass for it.
export async function setReminderActive(reminderId, active) {
  const db = getDb();
  if (!db) return;
  const row = await loadRow(reminderId);
  if (!row) return;
  if (active && !row.is_active) {
    // Resume. If the cursor is in the past, the user effectively wants the
    // series to fire now-ish. Leave the cursor alone; the banner stack
    // will pick it up on next tick. Schedule notification only if cursor
    // is in the future.
    const cursor = new Date(
      `${row.scheduled_date}T${row.scheduled_time || '00:00'}:00`
    );
    let notificationId = null;
    if (Number.isFinite(cursor.getTime()) && cursor.getTime() > Date.now()) {
      notificationId = await schedulePromptNotification(
        row.title || 'Journal Reminder',
        row.message || 'Time to write in your journal!',
        row.scheduled_date,
        row.scheduled_time,
        { kind: 'reminder', reminderId }
      );
    }
    await db.runAsync(
      `UPDATE scheduled_prompts
          SET is_active = 1,
              acknowledged_at = NULL,
              notification_id = ?
        WHERE id = ?`,
      [notificationId, reminderId]
    );
  } else if (!active && row.is_active) {
    if (row.notification_id) await cancelNotification(row.notification_id);
    await db.runAsync(
      `UPDATE scheduled_prompts
          SET is_active = 0,
              notification_id = NULL
        WHERE id = ?`,
      [reminderId]
    );
  }
}

// Re-schedule OS notifications for every active reminder whose cursor is
// in the future. Runs on EVERY boot and after a vault switch (v0.86.1;
// previously vault-switch only). Idempotent: a row whose stored
// notification_id is still live with the OS is left alone, so a normal
// relaunch never double-schedules, while rows with a NULL/stale id (the
// raw-Date era stored NULL for everything; a device reboot can drop
// alarms) get a fresh schedule. This pass is also what heals existing
// reminders on every user's device after the v0.86.1 trigger fix.
export async function rehydrateScheduledNotifications() {
  const db = getDb();
  if (!db) return;
  const rows = await db.getAllAsync(
    `SELECT id, title, message, scheduled_date, scheduled_time, notification_id
       FROM scheduled_prompts
      WHERE is_active = 1 AND acknowledged_at IS NULL`
  );
  if (rows.length === 0) return;
  const liveIds = await getScheduledNotificationIds();
  for (const row of rows) {
    const cursor = new Date(
      `${row.scheduled_date}T${row.scheduled_time || '00:00'}:00`
    );
    if (!Number.isFinite(cursor.getTime()) || cursor.getTime() <= Date.now()) {
      continue;
    }
    if (row.notification_id && liveIds.has(row.notification_id)) continue;
    const notificationId = await schedulePromptNotification(
      row.title || 'Journal Reminder',
      row.message || 'Time to write in your journal!',
      row.scheduled_date,
      row.scheduled_time,
      { kind: 'reminder', reminderId: row.id }
    );
    if (notificationId) {
      await db.runAsync(
        `UPDATE scheduled_prompts SET notification_id = ? WHERE id = ?`,
        [notificationId, row.id]
      );
    }
  }
}

// Un-acknowledge a reminder so it returns from "done" to live. The row
// was never deleted (ack only set acknowledged_at). Restore is a
// one-column reversal, the calendar-day is where its corpse waited. For
// a one-shot whose time is still in the future we reschedule the OS
// notification (it can fire again); if its time has passed it simply
// re-appears as a fired banner / on its day. This is a service-level
// state transition (like setReminderActive): the "never write
// acknowledged_at from a screen" invariant still holds. Intended for
// one-shots (the only rows the UI exposes a Restore on); recurring
// series finish via their own cap and live in the recurring sheet.
export async function restoreReminder(reminderId) {
  const db = getDb();
  if (!db) return;
  const row = await loadRow(reminderId);
  if (!row) return;
  let notificationId = null;
  const cursor = new Date(
    `${row.scheduled_date}T${row.scheduled_time || '00:00'}:00`
  );
  if (Number.isFinite(cursor.getTime()) && cursor.getTime() > Date.now()) {
    notificationId = await schedulePromptNotification(
      row.title || 'Journal Reminder',
      row.message || 'Time to write in your journal!',
      row.scheduled_date,
      row.scheduled_time,
      { kind: 'reminder', reminderId }
    );
  }
  await db.runAsync(
    `UPDATE scheduled_prompts
        SET acknowledged_at = NULL,
            is_active = 1,
            notification_id = ?
      WHERE id = ?`,
    [notificationId, reminderId]
  );
}

// One-shot reminders (no recurrence) scheduled on a specific calendar
// day, pending *and* acknowledged ("done"). The Day view uses this so a
// reminder you acked off the banner is still reachable on its day.
// Recurring series are deliberately excluded (one advancing row, no
// per-day occurrences to materialize; they have the recurring sheet).
export async function loadOneShotRemindersForDate(dateStr) {
  if (!dateStr) return [];
  const db = getDb();
  if (!db) return [];
  return db.getAllAsync(
    `SELECT * FROM scheduled_prompts
       WHERE recurrence_kind IS NULL
         AND scheduled_date = ?
       ORDER BY scheduled_time ASC, id ASC`,
    [dateStr]
  );
}

// Read helper used by the recurring-list sheet.
export async function loadRecurringSeries() {
  const db = getDb();
  if (!db) return [];
  return db.getAllAsync(
    `SELECT * FROM scheduled_prompts
       WHERE recurrence_kind IS NOT NULL
       ORDER BY is_active DESC, scheduled_date ASC, scheduled_time ASC`
  );
}

export { computeMissedCount };
