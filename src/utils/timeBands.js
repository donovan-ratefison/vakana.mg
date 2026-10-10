// Shared time-band + alpha-band grouping for list surfaces.
//
// Extracted from HomeScreen so the notes list and the threads list band
// identically (the whole point of harmonising the two screens: one
// banding rule, not two that drift). Computed at render: no schema, no
// persistence.

const pad = (n) => n.toString().padStart(2, '0');

const isoDate = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// SQLite `datetime('now')` returns UTC, space-separated
// ('YYYY-MM-DD HH:MM:SS'). Convert to a *local* 'YYYY-MM-DD' so the
// "Today" band matches the user's day, not UTC's. Returns '1970-01-01'
// on a missing/garbled value (the row's schema default always sets it,
// so this is just a defensive floor that lands in an old month bucket).
export function isoDateFromSqlDatetime(s) {
  if (!s || typeof s !== 'string') return '1970-01-01';
  const d = new Date(s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return '1970-01-01';
  return isoDate(d);
}

// The four reference boundaries are invariant across every item in one
// grouping pass, and so is the "Month YYYY" title for a given YYYY-MM.
// Computing them per item is what made banding a 283-entry list cost
// ~180ms of pure JS: four Date allocations per row, plus a
// toLocaleDateString (ICU-backed, the dominant term) for every row older
// than this month. Hoisting them into a context built once per pass,
// and memoizing month titles by key, makes the loop allocation-free for
// the common case. Same bands, same titles, same order.
function makeBandContext(refToday) {
  const yesterday = new Date(refToday);
  yesterday.setDate(refToday.getDate() - 1);

  // Week starts Sunday (matches the calendar grid).
  const weekStart = new Date(refToday);
  weekStart.setDate(refToday.getDate() - refToday.getDay());
  weekStart.setHours(0, 0, 0, 0);

  return {
    today: isoDate(refToday),
    yesterday: isoDate(yesterday),
    weekStart: isoDate(weekStart),
    monthStart: isoDate(
      new Date(refToday.getFullYear(), refToday.getMonth(), 1)
    ),
    monthTitles: new Map(),
  };
}

// Frozen singletons: the fixed bands carry no per-call data, so there is
// no reason to allocate a fresh object per row.
const BAND_TODAY = { key: 'today', title: 'Today' };
const BAND_YESTERDAY = { key: 'yesterday', title: 'Yesterday' };
const BAND_WEEK = { key: 'thisWeek', title: 'Earlier this week' };
const BAND_MONTH = { key: 'thisMonth', title: 'Earlier this month' };

function bandWithContext(dateStr, ctx) {
  if (dateStr === ctx.today) return BAND_TODAY;
  if (dateStr === ctx.yesterday) return BAND_YESTERDAY;
  if (dateStr >= ctx.weekStart) return BAND_WEEK;
  if (dateStr >= ctx.monthStart) return BAND_MONTH;

  // Older: bucket by (Year, Month). 'YYYY-MM-DD'.slice(0, 7) is the same
  // key the split-and-rejoin produced, without the intermediate array.
  const key = dateStr.slice(0, 7);
  let title = ctx.monthTitles.get(key);
  if (title === undefined) {
    const [y, m] = key.split('-');
    title = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });
    ctx.monthTitles.set(key, title);
  }
  return { key, title };
}

// Map a 'YYYY-MM-DD' string to the section header it belongs in. Kept as
// a standalone export for single-date callers; `groupIntoBands` uses the
// context form so it pays the setup once rather than once per item.
export function bandForIsoDate(dateStr, refToday) {
  return bandWithContext(dateStr, makeBandContext(refToday));
}

// Group items into chronological bands. `items` must already be sorted
// newest-first; Map preserves insertion order so sections come out in
// the right order. `getIso` returns the item's 'YYYY-MM-DD' (defaults to
// `item.date`, which is what the notes list passes).
export function groupIntoBands(items, getIso = (x) => x.date) {
  const ctx = makeBandContext(new Date());
  const buckets = new Map();
  for (const it of items) {
    const band = bandWithContext(getIso(it), ctx);
    if (!buckets.has(band.key)) {
      buckets.set(band.key, { title: band.title, data: [] });
    }
    buckets.get(band.key).data.push(it);
  }
  return Array.from(buckets.values());
}

// Group items into A–Z bands by first character. `items` must already be
// name-sorted (so Map insertion order is alphabetical). Non-letters fold
// into a single '#' bucket.
export function groupIntoAlphaBands(items, getName) {
  const buckets = new Map();
  for (const it of items) {
    const raw = (getName(it) || '').trim();
    const ch = raw.charAt(0).toUpperCase();
    const key = /[A-Z]/.test(ch) ? ch : '#';
    if (!buckets.has(key)) {
      buckets.set(key, { title: key, data: [] });
    }
    buckets.get(key).data.push(it);
  }
  return Array.from(buckets.values());
}
