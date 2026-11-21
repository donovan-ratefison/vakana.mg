import { deleteDatabaseAsync } from 'expo-sqlite';
import { deleteVaultFiles } from '../deleteVaultFiles';

jest.mock('expo-sqlite', () => ({ deleteDatabaseAsync: jest.fn(async () => {}) }));
jest.mock('../../database/db', () => ({ getCurrentDbFilename: () => 'journal.db' }));

// A fake OPFS directory in memory: `children` maps a name to a directory.
function fakeDir(children = {}) {
  const missing = (name) => {
    if (!children[name]) throw Object.assign(new Error(name), { name: 'NotFoundError' });
  };
  return {
    children,
    async getDirectoryHandle(name) {
      missing(name);
      return children[name];
    },
    async removeEntry(name) {
      missing(name);
      delete children[name];
    },
  };
}

function setOpfs(root) {
  Object.defineProperty(global, 'navigator', {
    value: { storage: { getDirectory: async () => root } },
    configurable: true,
  });
}

describe('deleteVaultFiles', () => {
  let attachments;

  beforeEach(() => {
    deleteDatabaseAsync.mockClear();
    attachments = fakeDir({ default: fakeDir(), B: fakeDir() });
    setOpfs(fakeDir({ attachments, 'expo-sqlite': fakeDir() }));
  });

  it('removes attachments/B/ and the database of B, and keeps attachments/default/', async () => {
    await deleteVaultFiles({ id: 'B', dbFilename: 'journal_B.db' });

    expect(Object.keys(attachments.children)).toEqual(['default']);
    expect(deleteDatabaseAsync.mock.calls.map((c) => c[0])).toEqual([
      'journal_B.db',
      'journal_B.db-journal',
      'journal_B.db-wal',
    ]);
  });

  it('refuses a bad id or the open database, and removes nothing', async () => {
    for (const id of ['', 'a/b', '..', undefined]) {
      await expect(deleteVaultFiles({ id, dbFilename: 'journal_B.db' })).rejects.toThrow();
    }
    await expect(deleteVaultFiles({ id: 'B', dbFilename: 'journal.db' })).rejects.toThrow();

    expect(Object.keys(attachments.children)).toEqual(['default', 'B']);
    expect(deleteDatabaseAsync).not.toHaveBeenCalled();
  });

  it('does not throw when the media folder is absent', async () => {
    await deleteVaultFiles({ id: 'C', dbFilename: 'journal_C.db' });
    setOpfs(fakeDir()); // no attachments/ at all
    await deleteVaultFiles({ id: 'C', dbFilename: 'journal_C.db' });

    expect(Object.keys(attachments.children)).toEqual(['default', 'B']);
    expect(deleteDatabaseAsync).toHaveBeenCalledTimes(6);
  });

  it('stops before the database when the media folder cannot be removed', async () => {
    attachments.removeEntry = async () => {
      throw new Error('locked');
    };

    await expect(deleteVaultFiles({ id: 'B', dbFilename: 'journal_B.db' })).rejects.toThrow('locked');
    expect(deleteDatabaseAsync).not.toHaveBeenCalled();
  });
});
