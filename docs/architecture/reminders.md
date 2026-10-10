# Reminders

Reminders are local scheduled prompts. They stay on the device. There is no
push server. The OS notification path uses `expo-notifications`, which is not
reliable on Expo Go (Android, SDK 53+). The in-app banner is the surface that
always works.

## Data: `scheduled_prompts`

The schema is in `src/database/db.js:88-99`. `data-layer.md` has the full table
description. Key columns:

- `scheduled_date` (`YYYY-MM-DD`), `scheduled_time` (`HH:MM`).
- `notification_id`: an opaque handle from
  `Notifications.scheduleNotificationAsync`. `cancelNotification(id)`
  (`utils/notifications.js:59-64`) uses it when the user deletes the reminder.
- `acknowledged_at`: the app sets it when the user acknowledges the reminder.
  NULL means "still active" (visible in the calendar, the banner, and the
  day-cell bell). The `ensureReminderColumns` shim (`db.js:31-49`) adds this
  column to the table.

There are two paths to acknowledge a reminder:

1. The user taps the persistent banner, opens the editor, and writes non-empty
   content. The autosave of the editor then sets
   `acknowledged_at = datetime('now')` (`EntryEditorScreen.js:267-278`). See
   `editor-autosave.md` § "Reminder-acknowledge side-channel".
2. The user taps the × dismiss control of the banner. This control calls
   `acknowledgeReminder` directly (`HomeScreen.js:176-184, 381`).

In both paths, `activeReminders = reminders.filter(r => !r.acknowledged_at)`
removes the row from the calendar bells, the calendar panel, and the banner
stack (`HomeScreen.js:137-140`).

## In-calendar UX

The calendar view (`src/components/CalendarMonth.js`) shows reminders in two
places:

- **Bell glyph in day cells** (`CalendarMonth.js:465-472`). `remindersByDate`
  is a bucket of reminders for each date (`CalendarMonth.js:101-109`). A
  non-empty bucket paints a small `notifications` Ionicon next to the day
  number.
- **`RemindersPanel` below the grid** (`CalendarMonth.js:483-531`). It lists
  each reminder for the visible month, sorted by date and time. Each row has a
  delete button. `monthReminders` filters the list by month
  (`CalendarMonth.js:111-119`).

A FAB on the calendar view opens `ReminderFormSheet` (`HomeScreen.js:479-487`).

## `ReminderFormSheet`

`src/components/ReminderFormSheet.js` is a bottom-sheet form that creates a
reminder. Its structure is important:

```jsx
<Modal>
  <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Pressable backdrop>
      <Pressable sheet>
        <ScrollView keyboardShouldPersistTaps="handled">
```

(`ReminderFormSheet.js:93-109`.) The `KeyboardAvoidingView` + `ScrollView` pair
is there for function, not for appearance.

- Without the pair, the Android soft keyboard covers the time and date buttons
  at the bottom of the form. The user then cannot dismiss the keyboard.
- iOS uses the `'padding'` behavior.
- Android keeps `undefined`, and the adjustResize of the system does the work.
- `keyboardShouldPersistTaps="handled"` is necessary. Without it, a tap on the
  time picker outside the keyboard region dismisses the keyboard before the
  picker opens.

The form resets each time it opens (`ReminderFormSheet.js:49-55`). Thus a
reopen after a cancel does not keep stale draft fields.

On save (`ReminderFormSheet.js:57-91`):

1. Request the permission with `requestNotificationPermissions()`.
2. Schedule with `schedulePromptNotification(...)`. It returns the OS handle,
   or `null` if the schedule failed, is not supported, or is in the past.
3. INSERT the row into `scheduled_prompts` with the handle.
4. Call `onSaved`. `HomeScreen` then runs `loadReminders` again, and the new
   row shows in the panel and the calendar.

**Note:** Since v0.87.0, `ReminderFormSheet` INSERTs the row before it
schedules the notification. See "Notification tap → in-app destination
(v0.87.0)".

## The persistent banner on `HomeScreen`

The banner is the in-app delivery channel that always works. It does not
depend on `expo-notifications`.

`firedReminders` (`HomeScreen.js:142-157`):

```js
const firedReminders = useMemo(() => {
  const now = Date.now();
  return activeReminders
    .filter(r => Date.parse(`${r.scheduled_date}T${r.scheduled_time}:00`) <= now)
    .sort(...);
}, [activeReminders, tick]);
```

The result renders as a stack of banners at the top of the home screen
(`HomeScreen.js:372-385`). Each `ReminderBanner` (`HomeScreen.js:552-600`)
shows the title, the message, the formatted date and time, and an × dismiss
control.

`tick` (`HomeScreen.js:64`) is a counter that forces a new evaluation. The next
`useEffect` (`HomeScreen.js:162-174`) finds the soonest *future* scheduled time
of all active reminders. It sets a precise `setTimeout` for
`nextAt - now + 200ms`, which increments `tick`. When the timer fires,
`firedReminders` runs again. The reminder that is now due passes the `now`
threshold, and the banner shows. There is no polling. A maximum of one timer
exists at a time, and it waits until the exact moment of the next banner.

The 200ms margin protects against small timer drift. Without it, the
calculation could run a millisecond before the threshold and miss the
reminder. No poll cycle exists to find the reminder later.

The OS notification path is a second, redundant layer
(`HomeScreen.js:200-205`):

```js
const sub = Notifications.addNotificationReceivedListener(() => loadReminders());
```

When the OS delivers a notification while the app is in the foreground, the
listener fetches the reminders again. The `acknowledged_at` value of the new
row (if there is one) then shows. On Expo Go Android this listener never
fires. The `setTimeout` does the work.

## Acknowledge-on-content-fill

`openReminderEntry` (`HomeScreen.js:186-196`):

```js
navigation.navigate('EntryEditor', {
  entryId: null,
  prefillTitle: reminder.title || 'Journal Reminder',
  reminderId: reminder.id,
});
```

The editor receives `reminderId` and stores it in `pendingReminderIdRef`. The
editor clears the reminder only when `save()` succeeds with non-empty trimmed
content (`EntryEditorScreen.js:267-278`). If the user taps the banner, sees the
editor, and goes back without text, the reminder stays active. Its banner
shows again on the next open. This is intentional: a reminder is "done" when
the user writes something, not when the user looks at it.

The × dismiss control on the banner is the explicit way to end a reminder
without an entry.

## `expo-notifications` defensive wrapping

`src/utils/notifications.js` wraps each notifications API call in try/catch. It
keeps a module-level `notificationsAvailable` flag. If the initial
`setNotificationHandler` throws, the flag becomes `false`
(`notifications.js:6-16`). After that, each public function returns a no-op
result immediately.

The reason: Expo Go on Android, SDK 53+, removed support for scheduled local
notifications. A call to `scheduleNotificationAsync` does not throw at module
load. It throws (or fails silently) at call time, and not always in the same
way. The defensive wrapping keeps the other parts of the app functional. A
reminder schedules "successfully" with a `null` handle, and the in-app banner
does the visible delivery. Real delivery requires a development build
(`npx expo run:android`).

## SDK-version sensitivity: trigger shape

Both scheduling functions pass the **explicit object trigger**. This is the
only form that `expo-notifications` 0.32 (SDK 54) accepts:

```js
await Notifications.scheduleNotificationAsync({
  content: { title, body, sound: true },
  trigger: {
    type: Notifications.SchedulableTriggerInputTypes.DATE,
    date: triggerDate,
  },
});
```

History of the failure:

- The code passed a raw `Date`. This form was valid before the API became
  stricter.
- The `parseTrigger` function of 0.32 **throws a TypeError** on a trigger
  object without a `type` or `channelId` entry.
- The silent `catch { return null }` hid the error. Each OS notification
  between the SDK upgrade and v0.86.1 was a no-op.
- The DB filled with `notification_id = NULL`. The in-app banners continued to
  work and hid the failure.
- The catches now call `console.warn`. Logcat is the only regression signal of
  this module.
- The boot rehydrate passes (below) repair the NULL rows on each device that
  ran the broken builds.

**Caution: On each `expo-notifications` upgrade, verify the accepted trigger
shape again.** If the shape changes again, the warn line is the signal.

## Boot rehydrate (every launch, idempotent)

`rehydrateScheduledNotifications` (reminders) and
`rehydrateCommentReminderNotifications` (comment-reminders) run from `App.js`
on **every** boot and also after a vault switch. This started in v0.86.1.
Before that, they ran only on a vault switch, with a `vaultEpoch > 0` gate.

`getScheduledNotificationIds()` (`utils/notifications.js`) makes the passes
idempotent:

- The pass skips a row whose stored `notification_id` is still live in the OS.
  Thus a normal relaunch never schedules a notification two times.
- A row with a NULL or stale id gets a new schedule, and the pass writes the
  new id to the row. Such rows come from the raw-Date period and from device
  reboots.

`scheduleNotificationAsync` returns `null` when `triggerDate <= new Date()`
(`notifications.js:40-42`). The app treats `null` as "not scheduled", and
`notification_id` becomes NULL in the row. `cancelNotification` returns
immediately on NULL. Thus the delete of a reminder with a no-op schedule still
works correctly.

## Notification tap → in-app destination (v0.87.0)

Each scheduled notification carries a `data` payload that the app sets at
schedule time:

- `{ kind: 'reminder', reminderId }` for prompts.
- `{ kind: 'comment', parentKind, parentId }` for self-pings.

`utils/notificationRouting.js` registers the response listeners at module load.
App.js imports it before React mounts. Thus the app captures a cold-start tap
although the PIN gate delays the navigation. **HomeScreen** is the consumer. It
mounts only after the unlock and the DB init.

A reminder tap opens the **ReminderActionsSheet**:

- The sheet shows the long-press options: write / ack / edit / stop / delete.
  This was the decision of the maker on 2026-08-30: the notification
  announces, the user decides.
- The tap shows Home **in calendar view**, which is the home surface of the
  reminder. It uses `navigation.navigate('Home')` + `setView('calendar')`.
- The sheet opens after a delay of 400 ms. An Android Modal presented during a
  pop transition flashes and closes with the transition (v0.88.1).

A comment tap goes through `openCommentReminder` directly to the parent.

**The payload id is a hint, not the truth** (v0.88.2):

- The app sets the payload id at schedule time.
- An edit/delete/re-create cycle can leave the id on a row that is no longer
  the live fired row.
- A zombie notification can do the same. A zombie comes from the
  stale-`notification_id` period, when a delete could not cancel the
  notification.
- An action on that stale row is a silent no-op, and the banner stays lit.
- Thus the consumer resolves the id against the ACTIVE rows. If the payload
  row is not one of them, the consumer uses the newest *fired active*
  reminder. The bell uses the same derivation.

In both cases the N15 rule stays: **tap never acknowledges**. Only work on the
content acknowledges.

Other rules:

- A payload whose row no longer exists (deleted reminder, different vault
  open) is a silent no-op.
- `getLastNotificationResponseAsync` reflects the launch intent. A normal open
  from the launcher resolves null, so stale taps do not replay.
- Creation in `ReminderFormSheet` now INSERTs before it schedules, because the
  payload needs the row id. A crash between the two steps leaves
  `notification_id` NULL. The boot rehydrate repairs it.

The Android small icon is `assets/notification-icon.png`. It is the bead glyph,
all white on a transparent background. An icon with color renders as a solid
square. The `color` is the cappuccino accent. The `expo-notifications` config
plugin in `app.json` sets both. A change to the icon or the color requires
`expo prebuild`.

## Comment-reminders (self-pings)

A second class of reminder uses the same banner mechanism. A `comments` row
can carry an optional `(remind_at, notification_id, reminded_at)` triple. The
triple changes that comment into a future ping. The user-facing concept is the
**self-ping**: a comment that comes back to remind the user about *this thing*
(an entry, a thread, or a calendar reminder).

### Storage and read paths
- All read and write paths are in `src/services/comments.js`. Screens never
  run SQL on `comments` directly.
- `loadFiredCommentReminders` returns rows with `remind_at IS NOT NULL`,
  `reminded_at IS NULL`, and `datetime(remind_at) <= datetime('now')`.
- Both sides of that comparison are in `datetime(...)`. `remind_at` is an ISO
  string, and the `datetime('now')` of SQLite uses a space as separator. A
  lexical comparison of the two forms gives a wrong result. **This error was
  almost released; see `data-layer.md`.**
- `loadPendingCommentReminders` returns the future rows. The precise timer
  effect on `HomeScreen` uses it to wake at the next fire time.
- `loadCommentRemindersWithLabels` joins `entries` / `threads` to get the
  parent `name` / `title`. Thus the bottom panel of the calendar renders its
  rows without an extra query for each row.

### Banner stack on `HomeScreen`
- `firedReminders` (calendar) and `firedCommentReminders` (comments) render
  together as one stack at the top of the screen.
- A comment-reminder banner uses a chatbubble icon, so the user can tell the
  two types apart. The body copy is `parent_label · comment_body`, so the user
  knows the subject of the ping.
- A tap on a comment-reminder banner navigates to the parent (`EntryEditor` or
  `ThreadDetail`) with `autoOpenComments: true`. The target screen opens the
  comments drawer on mount. **A tap alone does not acknowledge.** See
  "Acknowledgement" below.
- The × dismiss control on the banner calls `acknowledgeCommentReminder(id)`
  directly (single ack). It does not navigate to the parent.
- The precise-timer effect that wakes the calendar banners now uses *both*
  lists. The soonest time of the two lists is the next `setTimeout` target.

### Acknowledgement
- The N15 spec says: a **content edit on the parent** acknowledges a
  comment-reminder. A tap never does.
- `addComment` and `updateCommentBody` both call
  `acknowledgeFiredCommentRemindersForParent(parentKind, parentId)` after their
  write. This clears each fired self-ping on that parent in one statement.
- An edit of the entry body in `EntryEditorScreen` also acknowledges. The
  `save()` of the editor calls the same function before it returns.
- The comment-reminder rows of the calendar reminder panel acknowledge in the
  same way. A tap on a row goes through `openCommentReminder` (no ack). The
  drawer then opens, and a content edit acknowledges.

### Calendar bottom panel
- `RemindersPanel` (in `CalendarMonth.js`) merges `monthReminders` and
  `monthCommentReminders` into one chronological list. Each row has a
  `panelKind` discriminator.
- A calendar reminder renders with the bell icon and the existing delete and
  comments-chip controls.
- A comment-reminder renders with a chatbubble icon, the parent label, the
  comment body, and the formatted timestamp.
- A comment-reminder row that is past due has the danger color.
- Tap → `onOpenCommentReminder` (the same handler as the home banner).

### OS notification side
- `scheduleCommentReminder` calls the `scheduleNotificationAt` wrapper that
  calendar reminders also use. The body of the OS notification is the parent
  label, not the comment body. Thus it stays readable on a lock screen.
- The app stores the schedule even if the OS rejects the call (Expo Go
  Android, SDK 53+). The in-app banner derivation uses `remind_at`, not
  `notification_id`. Thus the user still gets the self-ping when the app is
  open at the scheduled moment.

## Recurring reminders (N18)

A calendar reminder can recur by day / week / month / year. The storage and
the ack policy are strict on purpose, so that the app does not fill with
banners and rows.

### Single-row model
- A recurring reminder is **one row** in `scheduled_prompts`. There is no
  per-occurrence table.
- `scheduled_date` / `scheduled_time` always point at the **next** occurrence.
  This pair is the cursor. The cursor advances on ack.
- `recurrence_fired` counts the occurrences that already fired.
- The rule is in three columns:
  - `recurrence_kind`: `'day'|'week'|'month'|'year'`, or NULL for a one-shot.
  - `recurrence_every`: every N units.
  - `recurrence_max`: NULL for no limit, or the maximum count.
- `recurrence_anchor_day` holds the day of the month on which the user set a
  month or year series. It is NULL for day series, week series and one-shots.
- The cursor clamps in short months: "every month on the 31st" gives Feb 28.
  The cursor is the only date that the row keeps. Thus the anchor is necessary
  to bring the series back to the 31st in March. The anchor also brings a
  yearly Feb 29 back to Feb 29 in the next leap year.
- Each step in `recurrence.js` clamps from the anchor, never from the previous
  occurrence (#29, v0.89.1).
- `ensureRecurrenceColumns` backfills the rows from before the column on each
  launch. It uses the day of the current cursor of the row.
- A series that drifted before the backfill keeps its drifted day until the
  user picks its date again in the form.

### Ack-and-advance
`acknowledgeReminder(id)` in `services/reminders.js` is the single ack
entry point. For a one-shot, it sets `acknowledged_at` as before. For a
recurring series, it does these steps:
1. It calls `advanceSeries` from `services/recurrence.js`. The arguments are
   the current cursor of the row, the rule, the fired count, the max, the
   anchor day, and `now`. The function moves the cursor forward by
   `recurrence_every` units of `recurrence_kind`. It counts each occurrence at
   or before now as "missed". It stops when the cursor is after `now` or when
   the count reaches the max.
2. It cancels the OS notification that was scheduled before.
3. If `reachedMax`: it sets `acknowledged_at = now`, `is_active = 0`, and
   `notification_id = NULL`. It increases `recurrence_fired` by the catchup
   delta. The series is complete.
4. If not: it writes the new `scheduled_date` / `scheduled_time` and schedules
   a new OS notification for it. It increases `recurrence_fired` and clears
   `acknowledged_at`.

### Pollution prevention
- **One banner per series.** `firedReminders` filters on `acknowledged_at`
  and `is_active`. Only a cursor at or before now makes a banner. An ack
  advances the cursor to after now, so the next render makes zero banners for
  that series.
- **Catchup is silent.** Example: a daily reminder fired 7 times while the app
  was closed. `computeMissedCount` returns 7, and the banner subtitle is
  "*7 due since you last looked*". One ack advances the cursor 7 times. There
  is never a stack of 7 banners.
- **Calendar panel never lists past or future occurrences.** A recurring row
  shows the cursor (the next fire), the rule, and the fired count. Past
  occurrences do not exist as rows. The app does not create rows for future
  occurrences.

### Stop / Resume
`setReminderActive(id, active)` toggles `is_active`. It does not change the
cursor or the counter. A stop cancels the current OS notification. A resume
schedules a new notification if the cursor is in the future. If the cursor is
not in the future, the id stays null, and the in-app banner shows the catchup
on the next tick.

### Editing
`ReminderFormSheet` accepts an `initial` prop. When the prop is set, the form
runs in edit mode. The UPDATE keeps `recurrence_fired`, so a rule change does
not reset the cursor. For a clean counter, the user deletes the reminder and
creates it again.

The anchor day goes through `resolveAnchorDay` (`services/recurrence.js`):

- An edit that does not change the date keeps the stored anchor. The cursor
  can be on a clamped day.
- A newly picked date sets the anchor to that date.
- A change to a day or week rule, or to a one-shot, clears the anchor.

The form reads the previous date and anchor from the row itself, not from
`initial`.
