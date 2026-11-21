import JSZip from 'jszip';
import { buildBackupBytes } from '../backupArchive';
import { openMediaFile } from '../../services/mediaStore.web';

jest.mock('../../services/mediaStore.web', () => ({ openMediaFile: jest.fn() }));

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
