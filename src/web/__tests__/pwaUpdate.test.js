import { updateAction } from '../pwaUpdate';

const base = { waiting: true, hadController: true, yielded: false, locked: false, hidden: false, tried: false };

describe('updateAction', () => {
  test.each([
    ['no service worker in waiting', { waiting: false }, 'none'],
    ['waiting, no controller at load', { hadController: false }, 'none'],
    ['waiting and locked', { locked: true }, 'reload'],
    ['waiting and hidden', { hidden: true }, 'reload'],
    ['waiting, unlocked and visible', {}, 'notice'],
    ['waiting, locked and tried', { locked: true, tried: true }, 'notice'],
    ['waiting and locked, in a window that yielded the database', { yielded: true, locked: true }, 'none'],
  ])('%s', (_name, change, expected) => {
    expect(updateAction({ ...base, ...change })).toBe(expected);
  });
});
