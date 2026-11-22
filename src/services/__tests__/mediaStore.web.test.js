import {
  mediaExtension,
  openMediaFile,
  readMediaBase64,
  rescueAndSweepMedia,
  withMediaUrl,
} from '../mediaStore.web';
import { getDb } from '../../database/db';

jest.mock('../../database/db', () => ({ getDb: jest.fn() }));
jest.mock('../../utils/vaults', () => ({
  getCurrentVaultId: async () => 'default',
}));

const HOUR = 60 * 60 * 1000;
const PHOTOS = 'attachments/default/photos';

// A fake OPFS directory in memory: `tree` maps a directory path to a Map of
// file name -> lastModified.
function fakeDir(tree, path) {
  return {
    async getDirectoryHandle(name) {
      const child = path ? `${path}/${name}` : name;
      if (![...tree.keys()].some((p) => p === child || p.startsWith(`${child}/`))) {
        throw new Error('NotFoundError');
      }
      return fakeDir(tree, child);
    },
    async *keys() {
      yield* [...(tree.get(path) || new Map()).keys()];
    },
    async getFileHandle(name) {
      const lastModified = tree.get(path).get(name);
      return { getFile: async () => ({ lastModified }) };
    },
    async removeEntry(name) {
      tree.get(path).delete(name);
    },
  };
}

describe('rescueAndSweepMedia on web', () => {
  it('deletes only a file that no row references and that is older than 24 h', async () => {
    const now = Date.now();
    const files = new Map([
      ['referenced_25h.png', now - 25 * HOUR],
      ['orphan_1h.png', now - 1 * HOUR],
      ['orphan_25h.png', now - 25 * HOUR],
    ]);
    const tree = new Map([[PHOTOS, files]]);
    Object.defineProperty(global, 'navigator', {
      value: { storage: { getDirectory: async () => fakeDir(tree, '') } },
      configurable: true,
    });
    getDb.mockReturnValue({
      getAllAsync: async (sql) =>
        sql.includes('entry_photos')
          ? [{ uri: `opfs:${PHOTOS}/referenced_25h.png` }]
          : [],
    });

    await rescueAndSweepMedia();

    expect([...files.keys()]).toEqual(['referenced_25h.png', 'orphan_1h.png']);
  });
});

describe('openMediaFile on web', () => {
  it('refuses a path outside attachments/ and does not touch the storage', async () => {
    const getDirectory = jest.fn();
    Object.defineProperty(global, 'navigator', {
      value: { storage: { getDirectory } },
      configurable: true,
    });

    expect(await openMediaFile('opfs:expo-sqlite/x')).toBeNull();
    expect(getDirectory).not.toHaveBeenCalled();
  });

  // The refusal comes from OPFS: getDirectoryHandle rejects the name "..".
  it('returns null for a reference with a ".." part', async () => {
    const tree = new Map([[PHOTOS, new Map()], ['', new Map([['x', 42]])]]);
    Object.defineProperty(global, 'navigator', {
      value: { storage: { getDirectory: async () => fakeDir(tree, '') } },
      configurable: true,
    });

    expect(await openMediaFile('opfs:attachments/../x')).toBeNull();
  });

  it('returns the file of a reference into attachments/', async () => {
    const tree = new Map([[PHOTOS, new Map([['a.png', 42]])]]);
    Object.defineProperty(global, 'navigator', {
      value: { storage: { getDirectory: async () => fakeDir(tree, '') } },
      configurable: true,
    });

    expect(await openMediaFile(`opfs:${PHOTOS}/a.png`)).toEqual({ lastModified: 42 });
  });
});

describe('mediaExtension', () => {
  it('reads the type before the parameters, in any case', () => {
    expect(mediaExtension('audio/webm;codecs=opus')).toBe('.webm');
    expect(mediaExtension('Audio/WAV')).toBe('.wav');
    expect(mediaExtension('image/png')).toBe('.png');
  });

  it('gives no extension for an unknown or empty type', () => {
    expect(mediaExtension('application/octet-stream')).toBe('');
    expect(mediaExtension('')).toBe('');
  });
});

// A real File in the fake OPFS: the value of a file in `tree` is returned as is.
function useFiles(files) {
  const tree = new Map([[PHOTOS, new Map(Object.entries(files))]]);
  const dir = (path) => ({
    ...fakeDir(tree, path),
    async getDirectoryHandle(name) {
      await fakeDir(tree, path).getDirectoryHandle(name);
      return dir(path ? `${path}/${name}` : name);
    },
    async getFileHandle(name) {
      const file = tree.get(path)?.get(name);
      if (!file) throw new Error('NotFoundError');
      return { getFile: async () => file };
    },
  });
  Object.defineProperty(global, 'navigator', {
    value: { storage: { getDirectory: async () => dir('') } },
    configurable: true,
  });
}

const REF = `opfs:${PHOTOS}/p.jpg`;

describe('withMediaUrl on web', () => {
  let create;
  let revoke;
  beforeEach(() => {
    useFiles({ 'p.jpg': new File([new Uint8Array([0, 1, 2, 255])], 'p.jpg') });
    create = jest.fn(() => 'blob:made');
    revoke = jest.fn();
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
  });

  it('gives a blob URL of the file to fn and revokes it after', async () => {
    const fn = jest.fn(async (u) => `done ${u}`);
    expect(await withMediaUrl(REF, fn)).toBe('done blob:made');
    expect(fn).toHaveBeenCalledWith('blob:made');
    expect(create.mock.calls[0][0]).toBeInstanceOf(File);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:made');
  });

  it('revokes the URL when fn rejects', async () => {
    await expect(withMediaUrl(REF, async () => { throw new Error('boom'); }))
      .rejects.toThrow('boom');
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it.each([
    `opfs:${PHOTOS}/absent.jpg`,
    'https://example.invalid/p.jpg',
    'opfs:journal.db',
  ])('refuses %s without a call to fn', async (uri) => {
    const fn = jest.fn();
    await expect(withMediaUrl(uri, fn)).rejects.toThrow('Media file is missing');
    expect(fn).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('passes a blob: URL as is', async () => {
    const fn = jest.fn(async () => 'ok');
    expect(await withMediaUrl('blob:abc', fn)).toBe('ok');
    expect(fn).toHaveBeenCalledWith('blob:abc');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('readMediaBase64 on web', () => {
  it('encodes the file in raw base64', async () => {
    useFiles({ 'p.jpg': new File([new Uint8Array([0, 1, 2, 255])], 'p.jpg') });
    expect(await readMediaBase64(REF)).toBe('AAEC/w==');
  });

  it('encodes a file bigger than one chunk without a loss', async () => {
    const bytes = new Uint8Array(70000).map((_, i) => (i * 7) % 256);
    useFiles({ 'p.jpg': new File([bytes], 'p.jpg') });
    const decoded = atob(await readMediaBase64(REF));
    expect(decoded.length).toBe(bytes.length);
    expect(Uint8Array.from(decoded, (c) => c.charCodeAt(0))).toEqual(bytes);
  });

  it('refuses a URI that is not a reference', async () => {
    await expect(readMediaBase64('https://example.invalid/v.webm')).rejects.toThrow(
      'Media file is missing'
    );
  });
});
