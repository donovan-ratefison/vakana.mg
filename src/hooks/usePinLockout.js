import { useCallback, useEffect, useState } from 'react';
import { formatLockoutMessage } from '../utils/pinHash';

// Drives the PIN-backoff countdown on the two keypad screens (LockScreen,
// SettingsChangePinScreen). The deadline is held as a wall-clock timestamp
// and every tick recomputes from `Date.now()`, so a backgrounded app (JS
// timers paused) shows the right value the moment it's visible again; the
// persisted deadline in SecureStore (utils/auth.js) is what carries it
// across restarts.
//
//   startLockout(ms): begin / replace the countdown (0 clears it)
//   locked:          true while input must stay disabled
//   message:         "Too many attempts. Try again in m:ss", or ''
export default function usePinLockout() {
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const startLockout = useCallback((ms) => {
    const t = Date.now();
    setNow(t);
    setLockedUntil(ms > 0 ? t + ms : 0);
  }, []);

  useEffect(() => {
    if (!lockedUntil) return undefined;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= lockedUntil) setLockedUntil(0);
    }, 250);
    return () => clearInterval(id);
  }, [lockedUntil]);

  const remaining = lockedUntil ? Math.max(0, lockedUntil - now) : 0;
  const locked = remaining > 0;
  return {
    locked,
    message: locked ? formatLockoutMessage(remaining) : '',
    startLockout,
  };
}
