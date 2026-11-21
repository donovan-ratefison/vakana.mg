import { rescueAndSweepMedia } from '../mediaStore.web';
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
