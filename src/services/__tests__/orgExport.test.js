import {
  emitOrgDocument,
  emitEntryOrgDocument,
  getEntryExportData,
} from '../orgExport';
import { getDb } from '../../database/db';

jest.mock('../../database/db', () => ({ getDb: jest.fn() }));

const THREAD = {
  id: 7,
  name: 'Days',
  kind: 'auto_day',
  anchor_kind: 'day',
  anchor_date: '2026-05-12',
  created_at: '2026-05-12 08:00:00',
  updated_at: '2026-05-12 08:00:00',
};

const COMMENT = {
  id: 3,
  body: 'Buy vanilla beans at the market',
  created_at: '2026-05-12T10:00:00.000Z',
  edited_at: null,
  remind_at: null,
  reminded_at: null,
  resolved_at: '2026-05-13 09:00:00',
};

const beadA = {
  beadId: 101,
  entryId: 42,
  position: 202605121430000042,
  snapshot: { shape: 'lozenge', pattern: 'solid', mood: 'amber', glyph: '' },
  sectionLabel: null,
  orphan: false,
  placeholder: false,
  entry: {
    title: 'Market day',
    content: 'Vanilla was cheap today.',
    date: '2026-05-12',
    time: '14:30',
    createdAt: '2026-05-12 08:00:00',
    updatedAt: '2026-05-12 08:00:00',
    isPrivate: false,
    highlightTier: 0,
  },
  photos: ['file:///attachments/photos/a.jpg'],
  voice: [],
  comments: [COMMENT],
  mentions: [],
};

const beadB = {
  beadId: 102,
  entryId: 43,
  position: 202606010000000043,
  snapshot: { shape: 'round', pattern: 'solid', mood: 'slate', glyph: '' },
  sectionLabel: null,
  orphan: false,
  placeholder: false,
  entry: {
    title: 'Rain',
    content: 'Quiet afternoon.',
    date: '2026-06-01',
    time: null,
    createdAt: '2026-06-01 12:00:00',
    updatedAt: '2026-06-01 12:00:00',
    isPrivate: false,
    highlightTier: 0,
  },
  photos: [],
  voice: [],
  comments: [],
  mentions: [],
};

describe('emitOrgDocument', () => {
  test('auto-day thread renders as an org-datetree', () => {
    const data = {
      thread: THREAD,
      isAuto: true,
      collections: [],
      threadComments: [],
      beads: [beadA, beadB],
    };
    const out = emitOrgDocument(data, { reproducible: true });
    expect(out).toMatchSnapshot();
  });
});

describe('emitEntryOrgDocument', () => {
  const ENTRY = { id: 42, title: 'Market day', date: '2026-05-12' };
  const bead = (over = {}) => ({
    ...beadA,
    beadId: null,
    position: null,
    ...over,
    entry: { ...beadA.entry, ...(over.entry || {}) },
  });
  const emit = (b) =>
    emitEntryOrgDocument({ entry: ENTRY, bead: b }, { reproducible: true });

  test('dated entry sits at level 4 in the datetree', () => {
    const out = emit(bead());
    const order = [
      '#+VAKANA_ENTRY_ID: 42',
      '* 2026',
      '** 2026-05 May',
      '*** 2026-05-12 Tuesday',
      '**** Market day',
      ':ID: vakana-entry-42',
      ':BEAD_SVG: assets/bead.svg',
      '[2026-05-12 Tue 14:30]',
      '[[file:assets/bead.svg]]',
    ];
    const idx = order.map((line) => out.indexOf(line));
    expect(idx).not.toContain(-1);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(out).not.toContain('VAKANA_BEAD_ID');
    expect(out).not.toContain('VAKANA_POSITION');
    expect(out).not.toContain('VAKANA_THREAD');
    expect(out).not.toContain('VAKANA_EXPORTED_AT');
  });

  test('undated entry goes under (undated) at level 2', () => {
    const out = emit(bead({ entry: { date: null } }));
    expect(out).toContain('* (undated)\n** Market day');
  });

  test('private entry keeps its body and the crypt tags', () => {
    const out = emit(bead({ entry: { isPrivate: true } }));
    expect(out).toContain(':private:crypt:');
    expect(out).toContain('Vanilla was cheap today.');
  });

  test('resolved comment is a DONE headline', () => {
    expect(emit(bead())).toContain('DONE Comment:');
  });
});

describe('getEntryExportData', () => {
  const ROW = {
    id: 42,
    title: 'Market day',
    content: 'x',
    date: '2026-05-12',
    time: null,
    created_at: '2026-05-12 08:00:00',
    updated_at: '2026-05-12 08:00:00',
    is_private: 0,
    highlight_tier: 0,
  };
  const fakeDb = (row) => ({
    getFirstAsync: jest.fn().mockResolvedValue(row),
    getAllAsync: jest.fn().mockResolvedValue([]),
  });

  test('entry without a bead gets the placeholder of its day', async () => {
    getDb.mockReturnValue(fakeDb(ROW));
    const { bead } = await getEntryExportData(42);
    expect(bead.beadId).toBeNull();
    expect(bead.placeholder).toBe(true);
    expect(bead.snapshot.shape).toBe('dot');
    expect(bead.photos).toEqual([]);
  });

  test('entry with a bead keeps it', async () => {
    getDb.mockReturnValue(
      fakeDb({ ...ROW, bead_shape: 'lozenge', bead_mood: 'amber' })
    );
    const { bead } = await getEntryExportData(42);
    expect(bead.placeholder).toBe(false);
    expect(bead.snapshot).toMatchObject({ shape: 'lozenge', mood: 'amber' });
  });
});
