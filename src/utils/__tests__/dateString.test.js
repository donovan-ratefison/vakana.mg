import {
  parseDateStr,
  formatDateStr,
  todayDateStr,
  formatTimeStr,
  parseTimeToMinutes,
  formatTimeLabel,
} from '../dateString';

// Tests run in Indian/Antananarivo (UTC+3), the zone where the old
// toISOString() round-trip shifted every saved date one day back.

describe('parseDateStr / formatDateStr', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('parses to local midnight on that calendar day', () => {
    const d = parseDateStr('2026-05-12');
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 4, 12]);
    expect([d.getHours(), d.getMinutes()]).toEqual([0, 0]);
  });

  test('ignores a time suffix', () => {
    const d = parseDateStr('2026-05-12 23:59:00');
    expect(formatDateStr(d)).toBe('2026-05-12');
  });

  test('round-trips without drifting east of UTC', () => {
    for (const s of ['2026-05-12', '2026-01-01', '2026-12-31', '2028-02-29']) {
      expect(formatDateStr(parseDateStr(s))).toBe(s);
    }
    // The bug this module replaced: toISOString() on local midnight.
    expect(parseDateStr('2026-05-12').toISOString().slice(0, 10)).toBe('2026-05-11');
  });

  test('invalid input falls back to now', () => {
    jest.useFakeTimers({ now: new Date(2026, 2, 10, 15, 30) });
    expect(parseDateStr(null).getTime()).toBe(new Date(2026, 2, 10, 15, 30).getTime());
    expect(parseDateStr('12/05/2026').getTime()).toBe(
      new Date(2026, 2, 10, 15, 30).getTime()
    );
  });

  test('formatDateStr uses local components and pads', () => {
    // 22:30 UTC on Mar 1 is 01:30 local on Mar 2.
    expect(formatDateStr(new Date('2026-03-01T22:30:00Z'))).toBe('2026-03-02');
    expect(formatDateStr(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  test('formatDateStr rejects non-dates', () => {
    expect(formatDateStr('2026-01-01')).toBe('');
    expect(formatDateStr(new Date('nope'))).toBe('');
    expect(formatDateStr(undefined)).toBe('');
  });

  test('todayDateStr follows the local day across midnight', () => {
    jest.useFakeTimers({ now: new Date('2026-03-10T20:59:59Z') });
    expect(todayDateStr()).toBe('2026-03-10');
    jest.setSystemTime(new Date('2026-03-10T21:00:00Z'));
    expect(todayDateStr()).toBe('2026-03-11');
  });
});

describe('time helpers', () => {
  test('formatTimeStr', () => {
    expect(formatTimeStr(new Date(2026, 0, 1, 7, 5))).toBe('07:05');
    expect(formatTimeStr(new Date(2026, 0, 1, 0, 0))).toBe('00:00');
    expect(formatTimeStr(new Date('bad'))).toBe('');
    expect(formatTimeStr(null)).toBe('');
  });

  test('parseTimeToMinutes', () => {
    expect(parseTimeToMinutes('00:00')).toBe(0);
    expect(parseTimeToMinutes('7:05')).toBe(425);
    expect(parseTimeToMinutes('23:59')).toBe(1439);
    expect(parseTimeToMinutes('24:00')).toBeNull();
    expect(parseTimeToMinutes('12:60')).toBeNull();
    expect(parseTimeToMinutes('12:5')).toBeNull();
    expect(parseTimeToMinutes('')).toBeNull();
    expect(parseTimeToMinutes(null)).toBeNull();
  });

  test('formatTimeLabel', () => {
    expect(formatTimeLabel('00:00')).toBe('12:00 AM');
    expect(formatTimeLabel('00:30')).toBe('12:30 AM');
    expect(formatTimeLabel('11:59')).toBe('11:59 AM');
    expect(formatTimeLabel('12:00')).toBe('12:00 PM');
    expect(formatTimeLabel('14:30')).toBe('2:30 PM');
    expect(formatTimeLabel('7:05')).toBe('7:05 AM');
    expect(formatTimeLabel('24:00')).toBe('');
    expect(formatTimeLabel('noon')).toBe('');
  });
});
