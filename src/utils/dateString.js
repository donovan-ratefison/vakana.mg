// Timezone-stable conversion between a YYYY-MM-DD calendar date and a
// JS `Date` object.
//
// Why this exists: the schema stores entry/reminder dates as `YYYY-MM-DD`
// strings: calendar dates, not instants. The previous code used
// `new Date(s + 'T00:00:00')` to parse (interpreted as local midnight) and
// `date.toISOString().split('T')[0]` to serialize (UTC). That round-trip
// breaks for users east of UTC: local midnight is the previous day in UTC,
// so every save shifts the stored date one day back. In Madagascar (UTC+3)
// opening a "May 12" entry and re-saving stamped it as "May 11".
//
// These helpers use the local year/month/day components directly, so the
// stored string always reflects the day the user sees on the picker: no
// silent timezone drift, no auto-thread jumping to yesterday after a bead
// edit.

export function parseDateStr(s) {
  // Accepts 'YYYY-MM-DD' (with optional time suffix we ignore) and returns
  // a Date at local midnight on that calendar day. Invalid input falls
  // back to today, matching the prior tolerant behavior.
  if (typeof s !== 'string') return new Date();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return new Date();
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return new Date(y, mo - 1, d);
}

export function formatDateStr(date) {
  // Returns 'YYYY-MM-DD' from a Date's *local* components, so the result
  // matches what the user picked / sees on their device. Never uses UTC.
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayDateStr() {
  return formatDateStr(new Date());
}

// --- Optional time-of-day on an entry --------------------------------------
//
// An entry's `date` is a calendar day; `time` is an optional 'HH:MM' (24h,
// local) the user may attach when a note is moment-grained rather than
// day-grained. Stored as a string like reminders' `scheduled_time` and
// threads' `anchor_time`. Null/absent means date-only (the default).

export function formatTimeStr(date) {
  // Returns 'HH:MM' (24h) from a Date's *local* components. Mirrors
  // formatDateStr: what the user sees on the picker is what we store.
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export function parseTimeToMinutes(timeStr) {
  // 'HH:MM' -> minutes since local midnight (0..1439), or null if invalid.
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr || ''));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function formatTimeLabel(timeStr) {
  // 'HH:MM' (24h) -> '2:30 PM'. Deterministic (no toLocaleTimeString) so
  // exported artifacts and on-device chips render identically regardless of
  // device locale / Hermes build. Returns '' for invalid input.
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr || ''));
  if (!m) return '';
  const h = Number(m[1]);
  const min = m[2];
  if (h < 0 || h > 23) return '';
  const ampm = h < 12 ? 'AM' : 'PM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${min} ${ampm}`;
}
