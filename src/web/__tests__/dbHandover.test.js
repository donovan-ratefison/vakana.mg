// A fake of the Web Locks API: one holder for each name, a queue, `steal` and `signal`.
function fakeLocks() {
  const held = new Map();
  const queues = new Map();
  const grant = (name, entry) => {
    held.set(name, entry);
    entry.callback();
  };
  return {
    request(name, options, callback) {
      return new Promise((resolve, reject) => {
        const entry = { callback, reject };
        if (options.steal && held.has(name)) {
          held.get(name).reject(new Error('stolen'));
          held.delete(name);
        }
        if (!held.has(name)) return grant(name, entry);
        queues.set(name, [...(queues.get(name) || []), entry]);
        options.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    },
    // The page of the holder unloads.
    release(name) {
      held.delete(name);
      const next = (queues.get(name) || []).shift();
      if (next) grant(name, next);
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('claimDatabase', () => {
  let locks;
  // Each load of the module is one window.
  const openWindow = () => {
    let handover;
    jest.isolateModules(() => {
      handover = require('../dbHandover');
    });
    return handover;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    locks = fakeLocks();
    globalThis.navigator = { locks };
  });

  afterEach(() => {
    delete globalThis.navigator;
    jest.useRealTimers();
  });

  test('the second window waits until the first one has unloaded', async () => {
    const stolen = jest.fn();
    await openWindow().claimDatabase(stolen);

    let ready = false;
    openWindow()
      .claimDatabase(() => {})
      .then(() => (ready = true));
    await flush();
    expect(stolen).toHaveBeenCalledTimes(1);
    expect(ready).toBe(false);

    locks.release('vakana-db-handles');
    await flush();
    expect(ready).toBe(true);
  });

  test('the second window gives up the wait after 10 s', async () => {
    await openWindow().claimDatabase(() => {});

    let ready = false;
    openWindow()
      .claimDatabase(() => {})
      .then(() => (ready = true));
    jest.advanceTimersByTime(9999);
    await flush();
    expect(ready).toBe(false);

    jest.advanceTimersByTime(1);
    await flush();
    expect(ready).toBe(true);
  });

  test('a second claim in the same window does not steal from itself', async () => {
    const stolen = jest.fn();
    const handover = openWindow();
    await handover.claimDatabase(stolen);
    await handover.claimDatabase(stolen);
    await flush();
    expect(stolen).not.toHaveBeenCalled();
  });
});
