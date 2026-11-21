import JSZip from 'jszip';
import { backupDatabaseAsync, deserializeDatabaseAsync } from 'expo-sqlite';
import { buildBackupBytes, restoreArchive } from '../backupArchive';
import { closeDatabase, getDb } from '../../database/db';
import { openMediaFile, writeMediaBlob } from '../../services/mediaStore.web';

jest.mock('expo-sqlite', () => ({
  backupDatabaseAsync: jest.fn(),
  deserializeDatabaseAsync: jest.fn(),
}));
jest.mock('../../database/db', () => ({ getDb: jest.fn(), closeDatabase: jest.fn() }));
jest.mock('../../services/mediaStore.web', () => ({
  openMediaFile: jest.fn(),
  writeMediaBlob: jest.fn(),
}));

const DB_BYTES = new Uint8Array([83, 81, 76, 105, 116, 101, 0, 1, 2, 3]);
const PHOTO_BYTES = new Uint8Array([137, 80, 78, 71, 9, 8, 7]);
const PHOTO_URI = 'opfs:attachments/default/photos/p_1.jpg';
const VOICE_URI = 'opfs:attachments/default/voice/v_1.webm';

const names = {
  manifest: 'manifest.json',
  db: 'journal.db',
  photoDir: 'attachments/photos/',
  voiceDir: 'attachments/voice/',
};
const extOf = (uri) => uri.slice(uri.lastIndexOf('.') + 1);

const db = {
  execAsync: async () => {},
  serializeAsync: async () => DB_BYTES,
  getAllAsync: async (sql) =>
    sql.includes('entry_photos')
      ? [{ id: 7, entry_id: 3, uri: PHOTO_URI }]
      : [{ id: 4, entry_id: 3, uri: VOICE_URI, duration: 2 }],
};

async function build(mode) {
  const manifest = { version: 2, mode, photos: [], voice: [], skipped: [] };
  const bytes = await buildBackupBytes({
    db,
    manifest,
    withDb: mode !== 'media-only',
    withMedia: mode !== 'data-only',
    names,
    extOf,
  });
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
  return { zip, files };
}

beforeEach(() => {
  // The photo is present, the file of the voice note is missing.
  openMediaFile.mockImplementation(async (uri) =>
    uri === PHOTO_URI ? { arrayBuffer: async () => PHOTO_BYTES.buffer } : null
  );
});

describe('buildBackupBytes', () => {
  it('writes a full archive and lists a missing file as skipped', async () => {
    const { zip, files } = await build('full');

    expect(files.sort()).toEqual([
      'attachments/photos/7.jpg',
      'journal.db',
      'manifest.json',
    ]);
    expect(await zip.file('journal.db').async('uint8array')).toEqual(DB_BYTES);
    expect(await zip.file('attachments/photos/7.jpg').async('uint8array')).toEqual(
      PHOTO_BYTES
    );
    const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
    expect(manifest.version).toBe(2);
    expect(manifest.mode).toBe('full');
    expect(manifest.photos).toEqual([
      { id: 7, entryId: 3, archivePath: 'attachments/photos/7.jpg' },
    ]);
    expect(manifest.voice).toEqual([]);
    expect(manifest.skipped).toEqual([{ kind: 'voice', id: 4, originalUri: VOICE_URI }]);
  });

  it('keeps media out of a data-only archive and the database out of a media-only archive', async () => {
    expect((await build('data-only')).files.sort()).toEqual([
      'journal.db',
      'manifest.json',
    ]);
    expect((await build('media-only')).files).not.toContain('journal.db');
  });
});

describe('restoreArchive', () => {
  const OPEN_DB = { name: 'open database' };
  const DAMAGED = 'Backup database is damaged or is not a Vakana journal.';
  // A SQLite header: the magic string, the page size, then bytes 18 and 19.
  const sqliteBytes = (version = 1) =>
    new Uint8Array([
      ...Array.from('SQLite format 3\0', (c) => c.charCodeAt(0)),
      ...[16, 0, version, version, 0, 0],
    ]);
  const manifestOf = (extra) => JSON.stringify({ version: 2, mode: 'full', ...extra });

  let memDb;
  let received;

  async function restore(files) {
    const zip = new JSZip();
    for (const [name, content] of Object.entries(files)) zip.file(name, content);
    return restoreBytes(await zip.generateAsync({ type: 'uint8array' }));
  }

  function restoreBytes(bytes) {
    global.fetch = async () => ({ arrayBuffer: async () => bytes });
    return restoreArchive({
      zipUri: 'blob:archive',
      names,
      modes: { fallback: 'full', refused: 'media-only' },
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    getDb.mockReturnValue(OPEN_DB);
    memDb = {
      getFirstAsync: jest.fn(async (sql) =>
        sql.includes('integrity_check') ? { integrity_check: 'ok' } : { name: 'entries' }
      ),
      runAsync: jest.fn(async () => {}),
      closeAsync: jest.fn(async () => {}),
    };
    received = null;
    deserializeDatabaseAsync.mockImplementation(async (bytes) => {
      received = Array.from(bytes);
      return memDb;
    });
    writeMediaBlob.mockImplementation(async (blob, kind, ext) => `opfs:new/${kind}${ext}`);
  });

  afterEach(() => jest.restoreAllMocks());

  const expectNoWrite = () => {
    expect(writeMediaBlob).not.toHaveBeenCalled();
    expect(backupDatabaseAsync).not.toHaveBeenCalled();
    expect(closeDatabase).not.toHaveBeenCalled();
  };

  it('refuses a file that is not a zip archive', async () => {
    await expect(restoreBytes(new Uint8Array([112, 108, 97, 105, 110]))).rejects.toThrow(
      'This file is not a zip archive.'
    );
    expectNoWrite();
  });

  it.each([
    [
      'an archive with no manifest',
      { 'journal.db': sqliteBytes() },
      'Backup is missing manifest.json',
    ],
    [
      'a manifest that is not JSON',
      { 'manifest.json': '{', 'journal.db': sqliteBytes() },
      'Backup manifest is not valid JSON',
    ],
    [
      'a manifest that is not an object',
      { 'manifest.json': '"full"', 'journal.db': sqliteBytes() },
      'Backup manifest is not valid JSON',
    ],
    [
      'a media-only archive',
      { 'manifest.json': manifestOf({ mode: 'media-only' }) },
      'This is a media-only archive. Vakana cannot restore media without a database.',
    ],
    ['an archive with no database', { 'manifest.json': manifestOf() }, 'Backup is missing journal.db'],
    [
      'a database that is not a SQLite file',
      { 'manifest.json': manifestOf(), 'journal.db': 'SQLite format 4, or some text' },
      'Backup database is not a SQLite file.',
    ],
  ])('refuses %s before any write', async (_, files, message) => {
    await expect(restore(files)).rejects.toThrow(new Error(message));
    expect(deserializeDatabaseAsync).not.toHaveBeenCalled();
    expectNoWrite();
  });

  it.each([
    ['cannot be read', () => memDb.getFirstAsync.mockRejectedValue(new Error('code 26'))],
    [
      'fails the integrity check',
      () => memDb.getFirstAsync.mockResolvedValue({ integrity_check: 'row 3 missing' }),
    ],
    [
      'has no entries table',
      () =>
        memDb.getFirstAsync.mockImplementation(async (sql) =>
          sql.includes('integrity_check') ? { integrity_check: 'ok' } : null
        ),
    ],
  ])('refuses a database that %s, and closes the copy in memory', async (_, damage) => {
    damage();
    const files = {
      'manifest.json': manifestOf({
        photos: [{ id: 7, archivePath: 'attachments/photos/7.jpg' }],
      }),
      'journal.db': sqliteBytes(),
      'attachments/photos/7.jpg': PHOTO_BYTES,
    };

    await expect(restore(files)).rejects.toThrow(new Error(DAMAGED));
    expect(memDb.closeAsync).toHaveBeenCalledTimes(1);
    expectNoWrite();
  });

  it('refuses a database that cannot be deserialized', async () => {
    deserializeDatabaseAsync.mockRejectedValue(new Error('out of memory'));

    await expect(
      restore({ 'manifest.json': manifestOf(), 'journal.db': sqliteBytes() })
    ).rejects.toThrow(new Error(DAMAGED));
    expectNoWrite();
  });

  it('writes and rewrites only the media items that fit the archive layout', async () => {
    const result = await restore({
      'manifest.json': manifestOf({
        photos: [
          { id: 7, archivePath: 'attachments/photos/7.jpg' },
          { id: '../x', archivePath: 'attachments/photos/../x.jpg' },
          { id: 8, archivePath: 'attachments/photos/../../journal.db' },
          { id: 9, archivePath: 'attachments/photos/9.jpg' },
        ],
        voice: 'not a list',
        skipped: [{ kind: 'voice', id: 4 }],
      }),
      'journal.db': sqliteBytes(),
      'attachments/photos/7.jpg': PHOTO_BYTES,
    });

    expect(writeMediaBlob).toHaveBeenCalledTimes(1);
    const [blob, kind, ext] = writeMediaBlob.mock.calls[0];
    expect(blob.size).toBe(PHOTO_BYTES.length);
    expect([kind, ext]).toEqual(['photo', '.jpg']);
    expect(memDb.runAsync.mock.calls).toEqual([
      ['UPDATE entry_photos SET uri = ? WHERE id = ?', ['opfs:new/photo.jpg', 7]],
    ]);
    expect(backupDatabaseAsync).toHaveBeenCalledWith({
      sourceDatabase: memDb,
      destDatabase: OPEN_DB,
    });
    expect(memDb.closeAsync).toHaveBeenCalledTimes(1);
    expect(closeDatabase).toHaveBeenCalledTimes(1);
    expect(result.mode).toBe('full');
    expect([...result.photoIdToUri]).toEqual([[7, 'opfs:new/photo.jpg']]);
    expect(result.voiceIdToUri.size).toBe(0);
    expect(result.manifest.skipped).toHaveLength(1);
  });

  it('leaves the database open and not replaced when a media write fails', async () => {
    writeMediaBlob.mockRejectedValue(new Error('QuotaExceededError'));

    await expect(
      restore({
        'manifest.json': manifestOf({
          photos: [{ id: 7, archivePath: 'attachments/photos/7.jpg' }],
        }),
        'journal.db': sqliteBytes(),
        'attachments/photos/7.jpg': PHOTO_BYTES,
      })
    ).rejects.toThrow('QuotaExceededError');
    expect(backupDatabaseAsync).not.toHaveBeenCalled();
    expect(closeDatabase).not.toHaveBeenCalled();
    expect(memDb.closeAsync).toHaveBeenCalledTimes(1);
  });

  it('gives a WAL database to SQLite with the header bytes 18 and 19 at 1', async () => {
    await restore({ 'manifest.json': manifestOf(), 'journal.db': sqliteBytes(2) });

    expect(received.slice(16, 20)).toEqual([16, 0, 1, 1]);
  });
});
