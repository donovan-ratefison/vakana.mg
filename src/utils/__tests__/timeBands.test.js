import {
  isoDateFromSqlDatetime,
  bandForIsoDate,
  groupIntoBands,
  groupIntoAlphaBands,
} from '../timeBands';

// Tests run in Indian/Antananarivo (UTC+3, no DST). See jest.global-setup.js.
const at = (y, m, d, hh = 12, mm = 0, ss = 0) => new Date(y, m - 1, d, hh, mm, ss);

const titles = (sections) => sections.map((s) => s.title);
const dates = (sections) => sections.map((s) => s.data.map((x) => x.date));

test('tests run in UTC+3', () => {
  expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-180);
});

describe('isoDateFromSqlDatetime', () => {
  test('reads SQLite UTC datetimes as the local calendar day', () => {
    expect(isoDateFromSqlDatetime('2026-03-10 12:00:00')).toBe('2026-03-10');
    // 20:59 UTC is 23:59 local: still the same day.
    expect(isoDateFromSqlDatetime('2026-03-10 20:59:59')).toBe('2026-03-10');
    // 21:00 UTC is local midnight: already the next day.
    expect(isoDateFromSqlDatetime('2026-03-10 21:00:00')).toBe('2026-03-11');
    // Year rolls over in local time before UTC does.
    expect(isoDateFromSqlDatetime('2026-12-31 22:30:00')).toBe('2027-01-01');
  });

  test('accepts ISO strings that already carry a Z', () => {
    expect(isoDateFromSqlDatetime('2026-03-10T22:00:00.000Z')).toBe('2026-03-11');
    expect(isoDateFromSqlDatetime('2026-03-10T22:00:00Z')).toBe('2026-03-11');
  });

  test('falls back to 1970-01-01 on missing or garbled input', () => {
    expect(isoDateFromSqlDatetime(null)).toBe('1970-01-01');
    expect(isoDateFromSqlDatetime('')).toBe('1970-01-01');
    expect(isoDateFromSqlDatetime(1234)).toBe('1970-01-01');
    expect(isoDateFromSqlDatetime('not a date')).toBe('1970-01-01');
  });
});

describe('bandForIsoDate', () => {
  // Wednesday 2026-03-11; the week started Sunday 2026-03-08.
  const wed = at(2026, 3, 11);

  test('fixed bands', () => {
    expect(bandForIsoDate('2026-03-11', wed).key).toBe('today');
    expect(bandForIsoDate('2026-03-10', wed).key).toBe('yesterday');
    expect(bandForIsoDate('2026-03-08', wed).key).toBe('thisWeek');
    expect(bandForIsoDate('2026-03-07', wed).key).toBe('thisMonth');
    expect(bandForIsoDate('2026-03-01', wed).key).toBe('thisMonth');
  });

  test('older dates bucket by month', () => {
    expect(bandForIsoDate('2026-02-28', wed)).toEqual({
      key: '2026-02',
      title: 'February 2026',
    });
    expect(bandForIsoDate('2025-12-25', wed)).toEqual({
      key: '2025-12',
      title: 'December 2025',
    });
  });

  test('on a Sunday the week band is empty: the day before is Yesterday', () => {
    const sun = at(2026, 3, 15);
    expect(bandForIsoDate('2026-03-14', sun).key).toBe('yesterday');
    expect(bandForIsoDate('2026-03-13', sun).key).toBe('thisMonth');
  });

  test('a week straddling the month start wins over the month bucket', () => {
    // Wed 2026-04-01: the week started Sun 2026-03-29.
    const apr1 = at(2026, 4, 1);
    expect(bandForIsoDate('2026-03-31', apr1).key).toBe('yesterday');
    expect(bandForIsoDate('2026-03-29', apr1).key).toBe('thisWeek');
    expect(bandForIsoDate('2026-03-28', apr1)).toEqual({
      key: '2026-03',
      title: 'March 2026',
    });
  });

  test('first of the month: last month is its own bucket, not "this month"', () => {
    // Sun 2026-03-01.
    const mar1 = at(2026, 3, 1);
    expect(bandForIsoDate('2026-03-01', mar1).key).toBe('today');
    expect(bandForIsoDate('2026-02-28', mar1).key).toBe('yesterday');
    expect(bandForIsoDate('2026-02-27', mar1).key).toBe('2026-02');
  });
});

describe('groupIntoBands', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  const items = [
    { date: '2026-03-11' },
    { date: '2026-03-11' },
    { date: '2026-03-10' },
    { date: '2026-03-09' },
    { date: '2026-03-02' },
    { date: '2026-02-14' },
    { date: '2025-12-31' },
  ];

  test('bands newest-first items in insertion order', () => {
    jest.useFakeTimers({ now: at(2026, 3, 11, 9) });
    const sections = groupIntoBands(items);
    expect(titles(sections)).toEqual([
      'Today',
      'Yesterday',
      'Earlier this week',
      'Earlier this month',
      'February 2026',
      'December 2025',
    ]);
    expect(dates(sections)).toEqual([
      ['2026-03-11', '2026-03-11'],
      ['2026-03-10'],
      ['2026-03-09'],
      ['2026-03-02'],
      ['2026-02-14'],
      ['2025-12-31'],
    ]);
  });

  test('one second before and after local midnight', () => {
    const list = [{ date: '2026-03-11' }, { date: '2026-03-10' }];

    jest.useFakeTimers({ now: at(2026, 3, 10, 23, 59, 59) });
    expect(titles(groupIntoBands(list))).toEqual(['Earlier this week', 'Today']);

    jest.setSystemTime(at(2026, 3, 11, 0, 0, 1));
    expect(titles(groupIntoBands(list))).toEqual(['Today', 'Yesterday']);
  });

  test('New Year: December moves to its own month bucket', () => {
    // Fri 2027-01-01; the week started Sun 2026-12-27.
    jest.useFakeTimers({ now: at(2027, 1, 1, 0, 30) });
    const sections = groupIntoBands([
      { date: '2027-01-01' },
      { date: '2026-12-31' },
      { date: '2026-12-27' },
      { date: '2026-12-26' },
    ]);
    expect(titles(sections)).toEqual([
      'Today',
      'Yesterday',
      'Earlier this week',
      'December 2026',
    ]);
  });

  test('custom getIso', () => {
    jest.useFakeTimers({ now: at(2026, 3, 11) });
    const sections = groupIntoBands(
      [{ at: '2026-03-11' }, { at: '2026-01-05' }],
      (x) => x.at
    );
    expect(titles(sections)).toEqual(['Today', 'January 2026']);
  });

  test('empty input', () => {
    expect(groupIntoBands([])).toEqual([]);
  });
});

describe('groupIntoAlphaBands', () => {
  test('buckets by upper-cased first letter; non-letters fold into #', () => {
    const items = ['  apple', 'Avocado', 'banana', '42 things', '', null, 'Écume', 'zebra'];
    const sections = groupIntoAlphaBands(items, (x) => x);
    expect(sections).toEqual([
      { title: 'A', data: ['  apple', 'Avocado'] },
      { title: 'B', data: ['banana'] },
      { title: '#', data: ['42 things', '', null, 'Écume'] },
      { title: 'Z', data: ['zebra'] },
    ]);
  });

  test('insertion order is preserved (the caller sorts)', () => {
    const sections = groupIntoAlphaBands([{ n: 'b' }, { n: 'a' }, { n: 'b2' }], (x) => x.n);
    expect(titles(sections)).toEqual(['B', 'A']);
    expect(sections[0].data).toHaveLength(2);
  });
});
