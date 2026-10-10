import { createContext, useContext } from 'react';

// Context exposed by App.js so any screen can call lock() to flip the app
// back to LockScreen without importing or re-architecting the App shell.
// Also carries the auto-lock preference (`autoLock`) + its setter so the
// Settings screen reads/writes it through the same shell that owns the
// AppState listener (keeping the in-memory value in sync with secure-store).
export const LockContext = createContext({
  lock: () => {},
  autoLock: 'off',
  setAutoLock: () => {},
});

export const useLock = () => useContext(LockContext);
