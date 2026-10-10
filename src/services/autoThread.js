// Auto-threads: day, week, month.
//
// Day (N11): one "auto_day" thread per calendar date with a snapshot bead
// for every entry on that date.
//
// Week / Month (N20): two-tier highlight on entries drives optional
// roll-up threads. tier 1 → auto_week (ISO-Monday anchor). tier 2 →
// auto_month (first-of-month anchor). Threads materialize on first
// highlight and prune on the last un-highlight.
//
// Bead snapshots are derived from the entry's own bead_* columns (or a
// weekday placeholder if the entry has no custom bead). The entry's
// bead_* columns are NEVER mutated by this service. Placeholder beads
// live only as snapshots so the rest of the app's "is this entry beaded?"
// logic stays simple.
//
// Public surface:
//   - syncAutoBeadForEntry(entry):   call after every entry save
//   - removeAutoBeadForEntry(id):    call before deleting an entry row
//   - removeAutoBeadsForEntriesInTx(db, ids): same, inside a caller's
//                                     transaction (services/entries.js)
//   - promoteAutoWeekToMonth(id):    bump every tier-1 entry on a week
//                                     thread to tier 2 and re-sync
//   - backfillAutoThreadsIfNeeded(): one-shot on first launch after upgrade
//   - resyncAutoThreadTimeOrderIfNeeded(): one-shot re-stamp of bead
//                                     positions into the time-aware encoding
//   - isAutoThreadEnabled()  / setAutoThreadEnabled(bool)

import * as SecureStore from 'expo-secure-store';
import { getDb } from '../database/db';
import { hasBead } from '../beads/types';
import { parseTimeToMinutes } from '../utils/dateString';
import { warn } from '../utils/log';

const AUTO_THREAD_ENABLED_KEY = 'vakana_auto_thread_enabled';
const BACKFILL_DONE_KEY = 'vakana_auto_thread_backfill_done';
// One-shot re-stamp of every auto-thread bead position into the
// time-aware encoding (v0.67.0). Separate flag from BACKFILL_DONE_KEY,
// which is already '1' on every install that predates the time feature.
const TIME_RESYNC_DONE_KEY = 'vakana_auto_thread_time_resync_done';

const AUTO_KINDS = ['auto_day', 'auto_week', 'auto_month'];

// Date.getDay(): 0=Sun, 1=Mon, …, 6=Sat
// Charcoal is intentionally absent: it is reserved for user-composed beads.
const WEEKDAY_BEAD = [
  { glyph: 'S', mood: 'rose' },   // Sun
  { glyph: 'M', mood: 'ocean' },  // Mon
  { glyph: 'T', mood: 'forest' }, // Tue
  { glyph: 'W', mood: 'plum' },   // Wed
  { glyph: 'T', mood: 'sun' },    // Thu
  { glyph: 'F', mood: 'ember' },  // Fri
  { glyph: 'S', mood: 'slate' },  // Sat
];

const WEEKDAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const pad2 = (n) => n.toString().padStart(2, '0');

// Parse a 'YYYY-MM-DD' string as a local-time Date (avoiding the UTC drift
// that `new Date('YYYY-MM-DD')` introduces).
function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function formatLocalDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatThreadName(dateStr) {
  const d = parseLocalDate(dateStr);
  if (!d) return dateStr;
  return `${WEEKDAY_NAMES[d.getDay()]}, ${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

function formatWeekThreadName(weekAnchor) {
  const d = parseLocalDate(weekAnchor);
  if (!d) return weekAnchor;
  return `Week of ${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

function formatMonthThreadName(monthAnchor) {
  const d = parseLocalDate(monthAnchor);
  if (!d) return monthAnchor;
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

function placeholderBeadForDate(dateStr) {
  const d = parseLocalDate(dateStr);
  const wd = d ? WEEKDAY_BEAD[d.getDay()] : { glyph: '', mood: 'slate' };
  return { shape: 'dot', pattern: 'solid', mood: wd.mood, glyph: wd.glyph };
}

// ISO week: Monday-start. getDay() returns 0=Sun..6=Sat, so days back to
// Monday is (getDay() + 6) % 7.
export function getWeekAnchor(dateStr) {
  const d = parseLocalDate(dateStr);
  if (!d) return null;
  const offset = (d.getDay() + 6) % 7;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset);
  return formatLocalDate(monday);
}

export function getMonthAnchor(dateStr) {
  const d = parseLocalDate(dateStr);
  if (!d) return null;
  return formatLocalDate(new Date(d.getFullYear(), d.getMonth(), 1));
}

// Position encodes three sort keys into one integer so a single
// `ORDER BY position` gives date → time-of-day → stable tiebreak:
//
//   YYYYMMDD * 1e8  +  minuteOfDay * 1e4  +  (id mod 1e4)
//
// - date prefix (YYYYMMDD, ≤ ~2.0e7 in practice) keeps multi-day
//   week/month chains chronological by entry date, exactly as before.
// - minuteOfDay (0..1439) orders same-day beads by their time-of-day:
//   the entry's explicit `time`, or its created_at clock if untimed (see
//   minuteOfDay()), so an all-untimed day still reads in creation order.
// - id tail (mod 1e4) is the final stable tiebreak.
//
// 20260608 * 1e8 ≈ 2.03e15, safely under Number.MAX_SAFE_INTEGER (9.007e15),
// so the whole value is an exact integer. The id tail is mod 1e4 (not 1e6 as
// in the old YYYYMMDD*1e6 scheme) to fit the time field into the budget; a
// collision needs two same-day-same-minute entries whose ids differ by an
// exact multiple of 10000, which only swaps their order (harmless). Because
// the magnitude differs from the old scheme, every pre-existing bead must be
// re-stamped once on upgrade (resyncAutoThreadTimeOrderIfNeeded).
function chronologicalPosition(date, minute, id) {
  const [y, m, d] = (date || '').split('-').map(Number);
  const dateOrder = (y || 0) * 10000 + (m || 0) * 100 + (d || 0);
  const min = Math.max(0, Math.min(1439, Number(minute) || 0));
  return dateOrder * 100000000 + min * 10000 + ((Number(id) || 0) % 10000);
}

// Effective minute-of-day for ordering. Prefers the entry's explicit
// 'HH:MM' time; falls back to its created_at wall clock (converted from
// SQLite's UTC datetime to local) so untimed entries interleave in the
// order they were written; 0 only when neither is parseable.
function minuteOfDay(timeStr, createdAtSql) {
  const fromTime = parseTimeToMinutes(timeStr);
  if (fromTime != null) return fromTime;
  if (createdAtSql) {
    const d = new Date(String(createdAtSql).replace(' ', 'T') + 'Z');
    if (!Number.isNaN(d.getTime())) return d.getHours() * 60 + d.getMinutes();
  }
  return 0;
}

export async function isAutoThreadEnabled() {
  try {
    const v = await SecureStore.getItemAsync(AUTO_THREAD_ENABLED_KEY);
    if (v === null) return true; // default ON
    return v === '1';
  } catch {
    return true;
  }
}

export async function setAutoThreadEnabled(enabled) {
  try {
    await SecureStore.setItemAsync(AUTO_THREAD_ENABLED_KEY, enabled ? '1' : '0');
  } catch (e) {
    console.warn('setAutoThreadEnabled failed:', e?.message || e);
  }
}

async function ensureAutoThreadForDate(db, dateStr) {
  // The partial unique index `idx_threads_auto_day_unique` (db.js) makes
  // INSERT OR IGNORE race-safe.
  await db.runAsync(
    `INSERT OR IGNORE INTO threads (name, description, anchor_kind, anchor_date, kind)
       VALUES (?, '', 'day', ?, 'auto_day')`,
    [formatThreadName(dateStr), dateStr]
  );
  const row = await db.getFirstAsync(
    `SELECT id FROM threads WHERE kind = 'auto_day' AND anchor_date = ?`,
    [dateStr]
  );
  return row?.id ?? null;
}

async function ensureAutoWeekThreadForAnchor(db, weekAnchor) {
  await db.runAsync(
    `INSERT OR IGNORE INTO threads (name, description, anchor_kind, anchor_date, kind)
       VALUES (?, '', 'week', ?, 'auto_week')`,
    [formatWeekThreadName(weekAnchor), weekAnchor]
  );
  const row = await db.getFirstAsync(
    `SELECT id FROM threads WHERE kind = 'auto_week' AND anchor_date = ?`,
    [weekAnchor]
  );
  return row?.id ?? null;
}

async function ensureAutoMonthThreadForAnchor(db, monthAnchor) {
  await db.runAsync(
    `INSERT OR IGNORE INTO threads (name, description, anchor_kind, anchor_date, kind)
       VALUES (?, '', 'month', ?, 'auto_month')`,
    [formatMonthThreadName(monthAnchor), monthAnchor]
  );
  const row = await db.getFirstAsync(
    `SELECT id FROM threads WHERE kind = 'auto_month' AND anchor_date = ?`,
    [monthAnchor]
  );
  return row?.id ?? null;
}

async function detachEntryFromAutoThreads(db, entryId) {
  await db.runAsync(
    `DELETE FROM thread_beads
       WHERE entry_id = ?
         AND thread_id IN (
           SELECT id FROM threads WHERE kind IN ('auto_day', 'auto_week', 'auto_month')
         )`,
    [entryId]
  );
}

async function pruneEmptyAutoThreads(db) {
  await db.runAsync(
    `DELETE FROM threads
       WHERE kind IN ('auto_day', 'auto_week', 'auto_month')
         AND id NOT IN (SELECT DISTINCT thread_id FROM thread_beads)`
  );
}

async function attachEntryToAutoThread(db, threadId, entry, minute) {
  const bead = hasBead(entry)
    ? {
        shape: entry.bead_shape,
        pattern: entry.bead_pattern || 'solid',
        mood: entry.bead_mood || 'slate',
        glyph: entry.bead_glyph || '',
      }
    : placeholderBeadForDate(entry.date);
  const position = chronologicalPosition(entry.date, minute, entry.id);
  await db.runAsync(
    `INSERT INTO thread_beads
       (thread_id, entry_id, position, snapshot_shape, snapshot_pattern, snapshot_mood, snapshot_glyph)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [threadId, entry.id, position, bead.shape, bead.pattern, bead.mood, bead.glyph]
  );
  await db.runAsync(
    `UPDATE threads SET updated_at = datetime('now') WHERE id = ?`,
    [threadId]
  );
}

// Idempotent. Detaches the entry from every auto-thread first (day, week,
// month), prunes empty auto-threads, then re-attaches based on current
// state: auto_day always; auto_week if highlight_tier ≥ 1; auto_month if
// highlight_tier ≥ 2. Handles date changes naturally: moving an entry
// from May 11 to June 4 also moves it from May's week/month threads to
// June's, and prunes the old anchors if they end up empty.
export async function syncAutoBeadForEntry(entry) {
  if (!entry || entry.id == null || !entry.date) return;
  const enabled = await isAutoThreadEnabled();
  if (!enabled) return;

  const db = getDb();
  if (!db) return;

  // The within-day sort key (explicit time, else created_at) is read from
  // the canonical row by id, not from the passed object. Several callers
  // pass only { id, date } (HomeScreen quick-add, ThreadDetail), and the
  // row is always already written by the time we sync, so this keeps
  // ordering correct regardless of how thin the caller's entry is.
  const meta = await db.getFirstAsync(
    'SELECT time, created_at FROM entries WHERE id = ?',
    [entry.id]
  );
  const minute = minuteOfDay(entry.time ?? meta?.time, meta?.created_at);

  // Detach → prune → re-attach is only idempotent as a whole; a crash
  // between detach and re-attach would silently drop the entry from its
  // day/week/month chains. One transaction makes the sync atomic (and
  // turns ~8-10 per-statement WAL commits into one; this runs on every
  // entry save). Callers must not already hold a transaction (none do;
  // tutorialSeed deliberately skips this sync inside its own).
  await db.withTransactionAsync(async () => {
    await detachEntryFromAutoThreads(db, entry.id);
    await pruneEmptyAutoThreads(db);

    const dayThreadId = await ensureAutoThreadForDate(db, entry.date);
    if (dayThreadId) {
      await attachEntryToAutoThread(db, dayThreadId, entry, minute);
    }

    const tier = Number(entry.highlight_tier ?? 0) || 0;

    if (tier >= 1) {
      const weekAnchor = getWeekAnchor(entry.date);
      if (weekAnchor) {
        const weekThreadId = await ensureAutoWeekThreadForAnchor(db, weekAnchor);
        if (weekThreadId) {
          await attachEntryToAutoThread(db, weekThreadId, entry, minute);
        }
      }
    }

    if (tier >= 2) {
      const monthAnchor = getMonthAnchor(entry.date);
      if (monthAnchor) {
        const monthThreadId = await ensureAutoMonthThreadForAnchor(db, monthAnchor);
        if (monthThreadId) {
          await attachEntryToAutoThread(db, monthThreadId, entry, minute);
        }
      }
    }
  });
}

// Call BEFORE the entries DELETE. The FK on thread_beads.entry_id is SET NULL,
// not CASCADE. That's the existing live+snapshot semantics for *user* threads
// (a bead survives the deletion of its source entry as a faded snapshot). For
// auto-threads we want the opposite: an auto-bead has no meaning without its
// entry, so we strip it proactively here.
export async function removeAutoBeadForEntry(entryId) {
  if (entryId == null) return;
  const db = getDb();
  if (!db) return;
  await db.withTransactionAsync(async () => {
    await removeAutoBeadsForEntriesInTx(db, [entryId]);
  });
}

// Same detach + prune as removeAutoBeadForEntry, for N entries, but inside
// the CALLER's transaction: it opens none itself (expo-sqlite transactions
// don't nest). Used by services/entries.js deleteEntries so the auto-bead
// strip, the comment cascade and the entries DELETE commit or roll back
// together. Prunes once after all detaches.
export async function removeAutoBeadsForEntriesInTx(db, entryIds) {
  if (!db) return;
  const ids = (entryIds || []).filter((id) => id != null);
  if (ids.length === 0) return;
  for (const id of ids) {
    await detachEntryFromAutoThreads(db, id);
  }
  await pruneEmptyAutoThreads(db);
}

// End-of-week curation: every entry currently on this auto_week thread
// gets bumped to highlight_tier ≥ 2, so the week's highlights also flow
// into the month roll-up. Idempotent: entries already at tier 2 are
// untouched. Returns the count of entries that were actually promoted.
export async function promoteAutoWeekToMonth(weekThreadId) {
  if (weekThreadId == null) return 0;
  const db = getDb();
  if (!db) return 0;

  const thread = await db.getFirstAsync(
    `SELECT id, kind FROM threads WHERE id = ?`,
    [weekThreadId]
  );
  if (!thread || thread.kind !== 'auto_week') return 0;

  const rows = await db.getAllAsync(
    `SELECT DISTINCT e.id, e.date
       FROM entries e
       JOIN thread_beads tb ON tb.entry_id = e.id
      WHERE tb.thread_id = ?
        AND e.highlight_tier < 2`,
    [weekThreadId]
  );
  if (rows.length === 0) return 0;

  for (const row of rows) {
    await db.runAsync(
      `UPDATE entries SET highlight_tier = 2, updated_at = datetime('now') WHERE id = ?`,
      [row.id]
    );
    const fresh = await db.getFirstAsync(
      `SELECT id, date, bead_shape, bead_pattern, bead_mood, bead_glyph, highlight_tier
         FROM entries WHERE id = ?`,
      [row.id]
    );
    if (fresh) await syncAutoBeadForEntry(fresh);
  }
  return rows.length;
}

// One-shot pass on first launch after the v0.2.0 upgrade so historical
// entries get auto-threaded too. Marks itself done in expo-secure-store.
export async function backfillAutoThreadsIfNeeded() {
  let done = null;
  try {
    done = await SecureStore.getItemAsync(BACKFILL_DONE_KEY);
  } catch {
    // proceed
  }
  if (done === '1') return;

  const enabled = await isAutoThreadEnabled();
  if (!enabled) {
    // Don't backfill if the user has already turned the feature off; mark
    // the migration done so flipping it back on later doesn't suddenly
    // resurrect every old entry.
    try {
      await SecureStore.setItemAsync(BACKFILL_DONE_KEY, '1');
    } catch (e) {
      warn('autoThread.backfillFlag', e);
    }
    return;
  }

  const db = getDb();
  if (!db) return;

  const entries = await db.getAllAsync(
    `SELECT id, date, bead_shape, bead_pattern, bead_mood, bead_glyph,
            highlight_tier
       FROM entries
       ORDER BY date ASC, id ASC`
  );
  for (const e of entries) {
    await syncAutoBeadForEntry(e);
  }

  try {
    await SecureStore.setItemAsync(BACKFILL_DONE_KEY, '1');
  } catch (e) {
    warn('autoThread.backfillFlag', e);
  }
}

// One-shot on first launch after the v0.67.0 upgrade (optional entry time).
// chronologicalPosition changed magnitude (YYYYMMDD*1e6 → YYYYMMDD*1e8 with a
// minute field), so every pre-existing auto-thread bead carries an old-scheme
// position. Mixing schemes would scramble `ORDER BY position`, so re-stamp
// each existing auto-bead in place from its entry's date/time/created_at.
//
// Done in place (UPDATE position only) rather than via syncAutoBeadForEntry so
// it (a) doesn't churn thread rows / pruning and (b) runs even when auto-threads
// are toggled off. Leaving old-scheme positions behind would corrupt ordering
// the moment the user re-enabled and an edit re-stamped a single bead.
export async function resyncAutoThreadTimeOrderIfNeeded() {
  let done = null;
  try {
    done = await SecureStore.getItemAsync(TIME_RESYNC_DONE_KEY);
  } catch {
    // proceed
  }
  if (done === '1') return;

  const db = getDb();
  if (!db) return;

  try {
    const rows = await db.getAllAsync(
      `SELECT tb.id AS tb_id, tb.entry_id AS entry_id,
              e.date AS date, e.time AS time, e.created_at AS created_at
         FROM thread_beads tb
         JOIN threads t ON t.id = tb.thread_id
         JOIN entries e ON e.id = tb.entry_id
        WHERE t.kind IN ('auto_day', 'auto_week', 'auto_month')`
    );
    for (const r of rows) {
      const minute = minuteOfDay(r.time, r.created_at);
      const position = chronologicalPosition(r.date, minute, r.entry_id);
      await db.runAsync('UPDATE thread_beads SET position = ? WHERE id = ?', [
        position,
        r.tb_id,
      ]);
    }
  } catch (e) {
    console.warn('resyncAutoThreadTimeOrderIfNeeded failed:', e?.message || e);
    return; // leave the flag unset so we retry next boot
  }

  try {
    await SecureStore.setItemAsync(TIME_RESYNC_DONE_KEY, '1');
  } catch (e) {
    warn('autoThread.timeResyncFlag', e);
  }
}
