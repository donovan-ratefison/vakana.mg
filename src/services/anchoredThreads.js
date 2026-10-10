// Anchored-thread reads: the single source of truth for "what the
// calendar's day-band promises and the Day view delivers".
//
// A thread carries an anchor (anchor_kind ∈ {day, time, week, month,
// year, none}) pinning it to a point on the calendar backbone. The
// calendar surfaces three derived signals (CalendarMonth.js): a per-day
// ribbon, a month banner, a year marker.
//
// The day **ribbon** must mean a *user-meaningful locus*: a thread the
// user deliberately anchored to that day (a year-thread on its Jan 1, a
// 40-day practice on day 1, a per-person record). It must NOT light up
// for the per-day `auto_day` thread, which exists for every day that has
// any entry. That signal is already carried by the cell shading/count,
// so including it dilutes the ribbon into noise (it would mark every day
// with notes). `auto_week`/`auto_month` anchor by week/month and never
// reach the day ribbon anyway.
//
// `isUserDayAnchor` is that predicate; `threadsAnchoredToDay` is the
// same predicate as SQL. The Day view and the ribbon are driven by the
// one definition so they can never drift apart (the ribbon promised a
// thread; tapping the day must show exactly that thread).

import { getDb } from '../database/db';

// A thread whose anchor is a user-placed locus on a specific day.
// `time` is a day-anchor with a clock component: still a single day,
// still user-meaningful. Auto kinds (auto_day/week/month) are excluded.
export function isUserDayAnchor(t) {
  return (
    t &&
    t.kind === 'user' &&
    (t.anchor_kind === 'day' || t.anchor_kind === 'time')
  );
}

// Every anchored thread (any kind/anchor), for the calendar's derived
// signals. `kind` is selected so callers can apply isUserDayAnchor:
// the ribbon filters to user day-anchors; month/year markers keep their
// existing wider behaviour (out of scope here).
export async function loadAnchoredThreads() {
  const db = getDb();
  if (!db) return [];
  return db.getAllAsync(
    `SELECT id, name, kind, anchor_kind, anchor_date, anchor_time
       FROM threads
      WHERE anchor_kind IS NOT NULL AND anchor_kind != 'none'`
  );
}

// The threads a given day's ribbon promises: exactly the set the Day
// view renders. Same predicate as isUserDayAnchor, expressed in SQL so
// the Day view doesn't have to over-fetch and filter. Ordered by name
// (case-insensitive) for a stable, readable section.
export async function threadsAnchoredToDay(dateStr) {
  if (!dateStr) return [];
  const db = getDb();
  if (!db) return [];
  return db.getAllAsync(
    `SELECT id, name, kind, anchor_kind, anchor_date, anchor_time
       FROM threads
      WHERE kind = 'user'
        AND anchor_kind IN ('day', 'time')
        AND anchor_date = ?
      ORDER BY name COLLATE NOCASE ASC, id ASC`,
    [dateStr]
  );
}
