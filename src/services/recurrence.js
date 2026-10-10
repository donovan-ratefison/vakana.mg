// N18: recurring reminder helpers. All pure date arithmetic, no I/O.
// Storage and OS-notification concerns live in `services/reminders.js` /
// HomeScreen / ReminderFormSheet.

export const RECURRENCE_KINDS = ['day', 'week', 'month', 'year'];

const pad = (n) => n.toString().padStart(2, '0');

function toLocalParts(date, time) {
  // `date` is YYYY-MM-DD, `time` is HH:MM. Build a JS Date in local time.
  const [y, m, d] = (date || '').split('-').map(Number);
  const [hh, mm] = (time || '00:00').split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
}

function dateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeStr(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// The day-of-month a month/year series is anchored on, read off the date
// the user picked. Day/week series (and one-shots) have no anchor.
export function anchorDayFor(kind, date) {
  if (kind !== 'month' && kind !== 'year') return null;
  const d = Number((date || '').split('-')[2]);
  return d >= 1 && d <= 31 ? d : null;
}

// The anchor to store when a reminder is saved from the form. A series is
// one row whose date advances, so a clamped cursor (Feb 28 of an "every
// month on the 31st") no longer says which day the series was set on.
// `recurrence_anchor_day` does. Editing anything but the date keeps the
// stored anchor; picking a new date re-anchors on that date's day.
export function resolveAnchorDay({ kind, date, prevDate, prevAnchorDay }) {
  const fromDate = anchorDayFor(kind, date);
  if (fromDate == null) return null;
  if (prevAnchorDay != null && prevDate === date) return prevAnchorDay;
  return fromDate;
}

// Add N units of `kind` to a JS Date, with month/year clamping. Adding
// 1 month to Jan 31 gives Feb 28/29; adding 1 year to Feb 29 gives Feb 28
// in non-leap years. Day/week math doesn't need clamping: JS handles it.
//
// `anchorDay` is the series' original day-of-month. The clamp is taken
// from it, not from `base`, so a series that clamped once (Jan 31 → Feb 28)
// returns to the 31st in March instead of staying on the 28th. Without an
// anchor the day of `base` is used.
export function addRecurrence(base, kind, every, anchorDay = null) {
  const out = new Date(base);
  const n = Number(every) || 1;
  if (kind === 'day') {
    out.setDate(out.getDate() + n);
    return out;
  }
  if (kind === 'week') {
    out.setDate(out.getDate() + 7 * n);
    return out;
  }
  if (kind === 'month' || kind === 'year') {
    const targetMonth = out.getMonth() + (kind === 'month' ? n : 0);
    const targetYear = out.getFullYear() + (kind === 'year' ? n : 0);
    const day = anchorDay || out.getDate();
    // Probe: set to first of target month, then bump day with clamp.
    const probe = new Date(out);
    probe.setDate(1);
    if (kind === 'year') probe.setFullYear(targetYear);
    else probe.setMonth(targetMonth);
    const lastDay = new Date(
      probe.getFullYear(),
      probe.getMonth() + 1,
      0
    ).getDate();
    probe.setDate(Math.min(day, lastDay));
    return probe;
  }
  return out;
}

// Public: given the *current* scheduled_date / scheduled_time of a series,
// compute the next occurrence as { date, time } strings.
export function nextOccurrence(scheduledDate, scheduledTime, kind, every, anchorDay = null) {
  const cur = toLocalParts(scheduledDate, scheduledTime);
  const next = addRecurrence(cur, kind, every, anchorDay);
  return { date: dateStr(next), time: timeStr(next) };
}

// How many times the series should "have fired" between its current
// scheduled moment (inclusive) and `now` (inclusive). Used both for the
// banner subtitle ("N due since you last looked") and for the catchup
// counter increment on ack.
//
// Returns 0 if the schedule hasn't fired yet.
export function computeMissedCount(scheduledDate, scheduledTime, kind, every, now = new Date(), anchorDay = null) {
  if (!scheduledDate || !scheduledTime) return 0;
  let cursor = toLocalParts(scheduledDate, scheduledTime);
  if (cursor.getTime() > now.getTime()) return 0;
  // For non-recurring (kind null), it's just one fire.
  if (!kind) return 1;
  let count = 0;
  // Cap iterations to avoid runaway in pathological cases (e.g., bad data).
  const MAX_ITER = 10_000;
  for (let i = 0; i < MAX_ITER; i++) {
    if (cursor.getTime() > now.getTime()) break;
    count += 1;
    cursor = addRecurrence(cursor, kind, every, anchorDay);
  }
  return count;
}

// Catchup-and-advance. Given the *current* row state, return:
//   - newDate, newTime: the next occurrence strictly *after* `now`
//   - addedFires: how many catchup fires (≥ 1)
//   - reachedMax: true if `recurrence_max` was hit during catchup
//
// Returned values describe what the caller should write back. The caller is
// responsible for actually persisting and rescheduling the OS notification.
export function advanceSeries({
  scheduledDate,
  scheduledTime,
  kind,
  every,
  fired = 0,
  max = null,
  now = new Date(),
  anchorDay = null,
}) {
  if (!kind) {
    // One-shot. Single ack, no advance. Caller marks acknowledged_at.
    return {
      newDate: scheduledDate,
      newTime: scheduledTime,
      addedFires: 1,
      reachedMax: true,
    };
  }
  let cursor = toLocalParts(scheduledDate, scheduledTime);
  let added = 0;
  let firedTotal = fired;
  // Advance past every occurrence at or before `now`.
  const MAX_ITER = 10_000;
  for (let i = 0; i < MAX_ITER; i++) {
    if (cursor.getTime() > now.getTime()) break;
    added += 1;
    firedTotal += 1;
    if (max != null && firedTotal >= max) {
      return {
        newDate: dateStr(cursor),
        newTime: timeStr(cursor),
        addedFires: added,
        reachedMax: true,
      };
    }
    cursor = addRecurrence(cursor, kind, every, anchorDay);
  }
  return {
    newDate: dateStr(cursor),
    newTime: timeStr(cursor),
    addedFires: added,
    reachedMax: false,
  };
}

// Short label for UI: "every day", "every 2 weeks", "every Tue", "every Mar 14".
// Compact form prefers fewer words. Given a base date so weekly/monthly/yearly
// forms can pick out the day-of-week / day-of-month.
export function formatRule({ kind, every, scheduledDate }) {
  if (!kind) return '';
  const n = Number(every) || 1;
  if (kind === 'day') return n === 1 ? 'every day' : `every ${n} days`;
  if (kind === 'week') {
    const base = scheduledDate ? toLocalParts(scheduledDate, '00:00') : null;
    const dow = base
      ? base.toLocaleDateString('en-US', { weekday: 'short' })
      : '';
    return n === 1
      ? dow ? `every ${dow}` : 'every week'
      : `every ${n} weeks${dow ? ` (${dow})` : ''}`;
  }
  if (kind === 'month') {
    return n === 1 ? 'every month' : `every ${n} months`;
  }
  if (kind === 'year') {
    return n === 1 ? 'every year' : `every ${n} years`;
  }
  return '';
}

// Compact "fired/max" for the calendar chip. `null max` → just the count.
export function formatProgress({ fired, max }) {
  if (max == null) return `${fired} fired`;
  return `${fired}/${max}`;
}
