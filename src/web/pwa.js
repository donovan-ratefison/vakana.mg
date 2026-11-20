// PWA start-up, web only (loaded by index.js).

// Without persistent storage the browser can clear the journal when the disk
// is full. A refusal changes nothing, so it is ignored.
navigator.storage?.persist?.().catch(() => {});

// The service worker caches a production build: it has no use in development.
if (!__DEV__ && 'serviceWorker' in navigator) {
  const register = () =>
    navigator.serviceWorker
      .register('/sw.js')
      .catch((e) => console.warn('Service worker registration failed', e));
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register);
}
