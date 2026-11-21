import { askPersistentStorage, readStorageStatus, storageStatusText } from '../storageStatus';

const PROTECTED = 'Storage: protected. The browser keeps this journal until you clear the site data.';
const NOT_PROTECTED =
  'Storage: not protected. The browser can clear this journal. Install the app and make a backup.';

describe('storage status', () => {
  test('granted, with usage: protected text with the space used', async () => {
    const status = await readStorageStatus({
      persisted: async () => true,
      estimate: async () => ({ usage: 1572864 }),
      persist: async () => true,
    });
    expect(status).toEqual({ persisted: true, usageBytes: 1572864, canAsk: true });
    expect(storageStatusText(status)).toBe(`${PROTECTED} Space used: 1.5 MB.`);
  });

  test('refused, no estimate: not protected, no space used', async () => {
    const status = await readStorageStatus({ persisted: async () => false });
    expect(status.usageBytes).toBeNull();
    expect(storageStatusText(status)).toBe(NOT_PROTECTED);
  });

  test('no storage API: not protected, cannot ask', async () => {
    const status = await readStorageStatus(undefined);
    expect(status).toEqual({ persisted: false, usageBytes: null, canAsk: false });
    expect(storageStatusText(status)).toBe(NOT_PROTECTED);
  });

  test('persisted rejects: not protected', async () => {
    const status = await readStorageStatus({ persisted: () => Promise.reject(new Error('no')) });
    expect(status.persisted).toBe(false);
  });

  test('persist rejects: askPersistentStorage does not reject', async () => {
    const status = await askPersistentStorage({
      persisted: async () => false,
      persist: () => Promise.reject(new Error('no')),
    });
    expect(status.persisted).toBe(false);
  });
});
