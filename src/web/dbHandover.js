// Web only. The database files accept one window at a time, and expo-sqlite
// keeps its file handles until the page unloads. So the last window opened
// takes the database, and the window before it reloads to a notice.
const FLAG = 'vakana_yielded';
const GIVE_UP_MS = 10000;
const hold = () => new Promise(() => {});
let claimed = false;

export function isYielded() {
  return sessionStorage.getItem(FLAG) !== null;
}

// Resolves when the database can be opened: the window that owned it has
// unloaded, or 10 s have passed (the open then fails with the real error).
// A failed open cannot be tried again: the expo-sqlite worker stays in
// "Invalid VFS state". So this waits before the open, and never retries it.
export async function claimDatabase(onStolen) {
  const locks = globalThis.navigator?.locks;
  if (!locks || claimed) return;
  claimed = true;
  // A newer window steals this lock: the rejection is the signal to yield.
  locks.request('vakana-db', { steal: true }, hold).catch(() => onStolen());
  // The owner keeps this second lock until its page unloads. Only then are
  // its file handles free.
  await new Promise((resolve) => {
    const giveUp = new AbortController();
    const timer = setTimeout(() => giveUp.abort(), GIVE_UP_MS);
    locks
      .request('vakana-db-handles', { signal: giveUp.signal }, () => {
        clearTimeout(timer);
        resolve();
        return hold();
      })
      .catch(resolve);
  });
}

export function yieldToOtherWindow() {
  sessionStorage.setItem(FLAG, '1');
  // shortcut: a fixed delay for the final save of the editor, replace it with an awaited save if a save can take longer.
  setTimeout(() => location.reload(), 1000);
}

export function useHere() {
  sessionStorage.removeItem(FLAG);
  location.reload();
}
