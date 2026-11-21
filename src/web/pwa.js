// PWA start-up, web only (loaded by index.js).
import { watchController, watchRegistration } from './pwaUpdate';

// Without persistent storage the browser can clear the journal when the disk
// is full. A refusal changes nothing, so it is ignored.
navigator.storage?.persist?.().catch(() => {});

// The service worker caches a production build: it has no use in development.
if (!__DEV__ && 'serviceWorker' in navigator) {
  watchController();
  const register = () =>
    navigator.serviceWorker
      .register('/sw.js')
      .then(watchRegistration)
      .catch((e) => console.warn('Service worker registration failed', e));
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register);
}
