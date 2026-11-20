import { getItemAsync, setItemAsync, deleteItemAsync } from '../secureStore';

describe('web secure store', () => {
  beforeEach(() => {
    const data = new Map();
    globalThis.localStorage = {
      getItem: (k) => (data.has(k) ? data.get(k) : null),
      setItem: (k, v) => data.set(k, String(v)),
      removeItem: (k) => data.delete(k),
    };
  });

  afterEach(() => {
    delete globalThis.localStorage;
  });

  test('round trip: set, get, delete', async () => {
    await setItemAsync('k', 'v');
    expect(await getItemAsync('k')).toBe('v');
    await deleteItemAsync('k');
    expect(await getItemAsync('k')).toBeNull();
  });

  test('a missing key reads as null', async () => {
    expect(await getItemAsync('missing')).toBeNull();
  });
});
