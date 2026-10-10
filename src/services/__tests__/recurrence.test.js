import {
  addRecurrence,
  nextOccurrence,
  computeMissedCount,
  advanceSeries,
  formatRule,
  formatProgress,
  anchorDayFor,
  resolveAnchorDay,
} from '../recurrence';

// Local-time Date builder (month is 1-based here, unlike the JS ctor).
const at = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm, 0, 0);

const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;

describe('addRecurrence', () => {
  test('day and week steps honour `every`', () => {
    expect(ymd(addRecurrence(at(2026, 3, 30), 'day', 3))).toBe('2026-04-02');
    expect(ymd(addRecurrence(at(2026, 12, 29), 'week', 1))).toBe('2027-01-05');
    expect(ymd(addRecurrence(at(2026, 1, 1), 'week', 2))).toBe('2026-01-15');
  });

  test('keeps the time of day', () => {
    const out = addRecurrence(at(2026, 5, 10, 21, 45), 'month', 1);
    expect(out.getHours()).toBe(21);
    expect(out.getMinutes()).toBe(45);
  });

  test('does not mutate its input', () => {
    const base = at(2026, 1, 31);
    addRecurrence(base, 'month', 1);
    expect(ymd(base)).toBe('2026-01-31');
  });

  test('Jan 31 + 1 month clamps to Feb 28 in a common year', () => {
    expect(ymd(addRecurrence(at(2026, 1, 31), 'month', 1))).toBe('2026-02-28');
  });

  test('Jan 31 + 1 month clamps to Feb 29 in a leap year', () => {
    expect(ymd(addRecurrence(at(2028, 1, 31), 'month', 1))).toBe('2028-02-29');
  });

  test('month steps clamp to 30-day months and roll the year', () => {
    expect(ymd(addRecurrence(at(2026, 3, 31), 'month', 1))).toBe('2026-04-30');
    expect(ymd(addRecurrence(at(2026, 11, 30), 'month', 3))).toBe('2027-02-28');
    expect(ymd(addRecurrence(at(2026, 12, 15), 'month', 1))).toBe('2027-01-15');
  });

  test('yearly on Feb 29 lands on Feb 28 in a non-leap year', () => {
    expect(ymd(addRecurrence(at(2028, 2, 29), 'year', 1))).toBe('2029-02-28');
  });

  test('yearly on Feb 29 every 4 years stays on Feb 29', () => {
    expect(ymd(addRecurrence(at(2028, 2, 29), 'year', 4))).toBe('2032-02-29');
  });

  test('missing / non-numeric `every` falls back to 1', () => {
    expect(ymd(addRecurrence(at(2026, 1, 1), 'day'))).toBe('2026-01-02');
    expect(ymd(addRecurrence(at(2026, 1, 1), 'day', 'x'))).toBe('2026-01-02');
    expect(ymd(addRecurrence(at(2026, 1, 1), 'day', 0))).toBe('2026-01-02');
  });

  test('unknown kind returns an unchanged copy', () => {
    const base = at(2026, 1, 1);
    const out = addRecurrence(base, 'fortnight', 1);
    expect(out).not.toBe(base);
    expect(out.getTime()).toBe(base.getTime());
  });
});

describe('nextOccurrence', () => {
  test('returns date + time strings', () => {
    expect(nextOccurrence('2026-01-31', '08:05', 'month', 1)).toEqual({
      date: '2026-02-28',
      time: '08:05',
    });
    expect(nextOccurrence('2026-12-31', '23:59', 'day', 1)).toEqual({
      date: '2027-01-01',
      time: '23:59',
    });
  });

  // A series is one row whose scheduled_date advances, so the cursor alone
  // can't say which day the series was set on once it has clamped (#29).
  // The anchor day (scheduled_prompts.recurrence_anchor_day) carries it.
  test('monthly-on-the-31st returns to the 31st after February', () => {
    const feb = nextOccurrence('2026-01-31', '09:00', 'month', 1, 31);
    expect(feb.date).toBe('2026-02-28');
    const mar = nextOccurrence(feb.date, feb.time, 'month', 1, 31);
    expect(mar.date).toBe('2026-03-31');
    const apr = nextOccurrence(mar.date, mar.time, 'month', 1, 31);
    expect(apr.date).toBe('2026-04-30');
    const may = nextOccurrence(apr.date, apr.time, 'month', 1, 31);
    expect(may.date).toBe('2026-05-31');
  });

  test('yearly-on-Feb-29 returns to Feb 29 in the next leap year', () => {
    let cur = { date: '2028-02-29', time: '09:00' };
    const seen = [];
    for (let i = 0; i < 4; i++) {
      cur = nextOccurrence(cur.date, cur.time, 'year', 1, 29);
      seen.push(cur.date);
    }
    expect(seen).toEqual(['2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
  });

  test('without an anchor the day of the cursor is used (legacy rows)', () => {
    const feb = nextOccurrence('2026-01-31', '09:00', 'month', 1);
    expect(nextOccurrence(feb.date, feb.time, 'month', 1).date).toBe('2026-03-28');
  });

  test('the anchor is ignored for day and week series', () => {
    expect(nextOccurrence('2026-02-28', '09:00', 'day', 1, 31).date).toBe('2026-03-01');
    expect(nextOccurrence('2026-02-28', '09:00', 'week', 1, 31).date).toBe('2026-03-07');
  });
});

describe('anchorDayFor / resolveAnchorDay', () => {
  test('only month and year series carry an anchor', () => {
    expect(anchorDayFor('month', '2026-01-31')).toBe(31);
    expect(anchorDayFor('year', '2028-02-29')).toBe(29);
    expect(anchorDayFor('day', '2026-01-31')).toBeNull();
    expect(anchorDayFor('week', '2026-01-31')).toBeNull();
    expect(anchorDayFor(null, '2026-01-31')).toBeNull();
    expect(anchorDayFor('month', '')).toBeNull();
  });

  test('a new reminder anchors on the picked date', () => {
    expect(resolveAnchorDay({ kind: 'month', date: '2026-01-31' })).toBe(31);
    expect(resolveAnchorDay({ kind: null, date: '2026-01-31' })).toBeNull();
  });

  test('an edit that leaves the date alone keeps the stored anchor', () => {
    expect(
      resolveAnchorDay({
        kind: 'month',
        date: '2026-02-28',
        prevDate: '2026-02-28',
        prevAnchorDay: 31,
      })
    ).toBe(31);
  });

  test('an edit that picks a new date re-anchors on it', () => {
    expect(
      resolveAnchorDay({
        kind: 'month',
        date: '2026-03-15',
        prevDate: '2026-02-28',
        prevAnchorDay: 31,
      })
    ).toBe(15);
  });

  test('switching to a day/week rule or a one-shot drops the anchor', () => {
    expect(
      resolveAnchorDay({
        kind: 'week',
        date: '2026-02-28',
        prevDate: '2026-02-28',
        prevAnchorDay: 31,
      })
    ).toBeNull();
  });
});

describe('anchored catchup', () => {
  test('advanceSeries walks a clamped series back onto its anchor', () => {
    expect(
      advanceSeries({
        scheduledDate: '2026-01-31',
        scheduledTime: '09:00',
        kind: 'month',
        every: 1,
        anchorDay: 31,
        now: at(2026, 3, 10, 12, 0),
      })
    ).toMatchObject({ newDate: '2026-03-31', addedFires: 2, reachedMax: false });
  });

  test('computeMissedCount counts on the anchored dates', () => {
    // Anchored: Jan 31, Feb 28, Mar 31 -> the March fire is not due on the 30th.
    expect(
      computeMissedCount('2026-01-31', '09:00', 'month', 1, at(2026, 3, 30, 12, 0), 31)
    ).toBe(2);
    // Unanchored (legacy): Jan 31, Feb 28, Mar 28 -> three by the 30th.
    expect(
      computeMissedCount('2026-01-31', '09:00', 'month', 1, at(2026, 3, 30, 12, 0))
    ).toBe(3);
  });
});

describe('computeMissedCount', () => {
  const now = at(2026, 3, 10, 12, 0);

  test('0 when the schedule is still in the future', () => {
    expect(computeMissedCount('2026-03-10', '12:01', 'day', 1, now)).toBe(0);
    expect(computeMissedCount('2026-03-11', '09:00', null, null, now)).toBe(0);
  });

  test('0 on missing date or time', () => {
    expect(computeMissedCount(null, '09:00', 'day', 1, now)).toBe(0);
    expect(computeMissedCount('2026-03-01', '', 'day', 1, now)).toBe(0);
  });

  test('one-shot that has fired counts once', () => {
    expect(computeMissedCount('2026-01-01', '09:00', null, null, now)).toBe(1);
  });

  test('the scheduled moment and `now` are both inclusive', () => {
    expect(computeMissedCount('2026-03-10', '12:00', 'day', 1, now)).toBe(1);
    // Mar 8, 9, 10 at 12:00. The last one is exactly `now`.
    expect(computeMissedCount('2026-03-08', '12:00', 'day', 1, now)).toBe(3);
  });

  test('daily catch-up counts every missed day', () => {
    // Mar 1..10 at 09:00.
    expect(computeMissedCount('2026-03-01', '09:00', 'day', 1, now)).toBe(10);
    // Every 3 days: Mar 1, 4, 7, 10.
    expect(computeMissedCount('2026-03-01', '09:00', 'day', 3, now)).toBe(4);
  });

  test('weekly and monthly catch-up', () => {
    // Feb 3, 10, 17, 24, Mar 3, 10 (09:00 < 12:00).
    expect(computeMissedCount('2026-02-03', '09:00', 'week', 1, now)).toBe(6);
    // Jan 31, Feb 28, Mar 28. Mar 28 is after now, so 2.
    expect(computeMissedCount('2026-01-31', '09:00', 'month', 1, now)).toBe(2);
  });
});

describe('advanceSeries', () => {
  const now = at(2026, 3, 10, 12, 0);

  test('one-shot: no advance, reachedMax', () => {
    expect(
      advanceSeries({ scheduledDate: '2026-03-01', scheduledTime: '09:00', kind: null, now })
    ).toEqual({
      newDate: '2026-03-01',
      newTime: '09:00',
      addedFires: 1,
      reachedMax: true,
    });
  });

  test('advances to the first occurrence strictly after now', () => {
    expect(
      advanceSeries({
        scheduledDate: '2026-03-01',
        scheduledTime: '09:00',
        kind: 'day',
        every: 1,
        now,
      })
    ).toEqual({
      newDate: '2026-03-11',
      newTime: '09:00',
      addedFires: 10,
      reachedMax: false,
    });
  });

  test('an occurrence exactly at now counts as fired', () => {
    const r = advanceSeries({
      scheduledDate: '2026-03-10',
      scheduledTime: '12:00',
      kind: 'week',
      every: 1,
      now,
    });
    expect(r).toEqual({
      newDate: '2026-03-17',
      newTime: '12:00',
      addedFires: 1,
      reachedMax: false,
    });
  });

  test('addedFires matches computeMissedCount for the same state', () => {
    const args = ['2026-01-31', '09:00', 'month', 1];
    const r = advanceSeries({
      scheduledDate: args[0],
      scheduledTime: args[1],
      kind: args[2],
      every: args[3],
      now,
    });
    expect(r.addedFires).toBe(computeMissedCount(...args, now));
    expect(r.newDate).toBe('2026-03-28');
  });

  test('catch-up stops at the max and parks on the capping occurrence', () => {
    // fired=1, max=3: two more fires allowed: Mar 1 (2), Mar 2 (3, cap).
    expect(
      advanceSeries({
        scheduledDate: '2026-03-01',
        scheduledTime: '09:00',
        kind: 'day',
        every: 1,
        fired: 1,
        max: 3,
        now,
      })
    ).toEqual({
      newDate: '2026-03-02',
      newTime: '09:00',
      addedFires: 2,
      reachedMax: true,
    });
  });

  test('max not reached during catch-up keeps the series going', () => {
    const r = advanceSeries({
      scheduledDate: '2026-03-09',
      scheduledTime: '09:00',
      kind: 'day',
      every: 1,
      fired: 0,
      max: 5,
      now,
    });
    expect(r).toEqual({
      newDate: '2026-03-11',
      newTime: '09:00',
      addedFires: 2,
      reachedMax: false,
    });
  });

  // Actual behavior: the header comment promises addedFires >= 1, but an
  // ack before the scheduled moment advances nothing. Callers only ack
  // fired rows, so this is documented rather than flagged.
  test('ack before the scheduled moment is a no-op with 0 fires', () => {
    expect(
      advanceSeries({
        scheduledDate: '2026-03-12',
        scheduledTime: '09:00',
        kind: 'day',
        every: 1,
        now,
      })
    ).toEqual({
      newDate: '2026-03-12',
      newTime: '09:00',
      addedFires: 0,
      reachedMax: false,
    });
  });
});

describe('formatRule / formatProgress', () => {
  test('formatRule', () => {
    expect(formatRule({ kind: null })).toBe('');
    expect(formatRule({ kind: 'day', every: 1 })).toBe('every day');
    expect(formatRule({ kind: 'day', every: 2 })).toBe('every 2 days');
    // 2026-03-10 is a Tuesday.
    expect(formatRule({ kind: 'week', every: 1, scheduledDate: '2026-03-10' })).toBe(
      'every Tue'
    );
    expect(formatRule({ kind: 'week', every: 2, scheduledDate: '2026-03-10' })).toBe(
      'every 2 weeks (Tue)'
    );
    expect(formatRule({ kind: 'week', every: 1 })).toBe('every week');
    expect(formatRule({ kind: 'month', every: 1 })).toBe('every month');
    expect(formatRule({ kind: 'year', every: 3 })).toBe('every 3 years');
  });

  test('formatProgress', () => {
    expect(formatProgress({ fired: 4, max: null })).toBe('4 fired');
    expect(formatProgress({ fired: 4, max: 10 })).toBe('4/10');
  });
});
