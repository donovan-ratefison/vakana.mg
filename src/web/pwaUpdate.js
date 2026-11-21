// Web only. A new build of the PWA waits until this page agrees to reload
// (scripts/sw-template.js). This module follows the service worker in waiting,
// decides what the page does, and reloads the page without a lost edit.
import { FINAL_SAVE_MS, isYielded } from './dbHandover';

const TRIED = 'vakana_update_tried';
const NO_CONTROLLER_CHANGE_MS = 5000;

// 'none', 'reload' (the page reloads with no click) or 'notice' (the user decides).
export function updateAction({ waiting, hadController, yielded, locked, hidden, tried }) {
  // No controller before: a first installation, not an update. A window that
  // yielded the database never decides: the window that holds the journal does.
  if (!waiting || !hadController || yielded) return 'none';
  // Locked or hidden: nobody is typing. `tried` stops a reload loop.
  return (locked || hidden) && !tried ? 'reload' : 'notice';
}

let hadController = false;
let waiting = null;
let locked = true;
// Set when this window starts to leave. Resolves after the final save of the editor.
let saved = null;
let onReload = () => {};
let action = 'none';
const listeners = new Set();

function setAction(next) {
  if (next === action) return;
  action = next;
  listeners.forEach((listener) => listener());
}

// For useSyncExternalStore (src/web/UpdateNotice.js).
export const getAction = () => action;
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// The app shows a full-screen notice: the screens unmount, and the editor
// runs its final save. Every reload waits for this.
function leave() {
  if (!saved) {
    setAction('none');
    onReload();
    saved = new Promise((resolve) => setTimeout(resolve, FINAL_SAVE_MS));
  }
  return saved;
}

// The one reload path, for the automatic reload and for the button.
export function safeReload() {
  if (saved || !waiting) return;
  leave().then(() => {
    waiting.postMessage({ type: 'SKIP_WAITING' });
    // The reload comes from the controllerchange listener of watchController.
    setTimeout(() => location.reload(), NO_CONTROLLER_CHANGE_MS);
  });
}

function evaluate() {
  if (saved) return;
  const next = updateAction({
    waiting: waiting !== null,
    hadController,
    yielded: isYielded(),
    locked,
    hidden: document.visibilityState === 'hidden',
    tried: sessionStorage.getItem(TRIED) !== null,
  });
  if (next !== 'reload') return setAction(next);
  sessionStorage.setItem(TRIED, '1');
  safeReload();
}

// Called by the app at each change of the lock state. `showUpdating` shows the
// full-screen notice of a reload.
export function setLocked(value, showUpdating) {
  locked = value;
  onReload = showUpdating;
  if (saved) onReload();
  else evaluate();
}

// Called when the page loads, before the registration.
export function watchController() {
  hadController = navigator.serviceWorker.controller !== null;
  // A new service worker took this page. Without a controller before, this is
  // the claim of a first installation: no reload, and the next service worker
  // is an update. If this window agreed, its final save is done and it reloads
  // immediately. If another window agreed, the user can be typing here: this
  // window does the final save first.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) leave().then(() => location.reload());
    else hadController = true;
  });
}

export function watchRegistration(registration) {
  const found = (worker) => {
    waiting = worker;
    evaluate();
  };
  const track = (worker) =>
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) found(worker);
    });
  if (registration.waiting) found(registration.waiting);
  else sessionStorage.removeItem(TRIED);
  track(registration.installing);
  registration.addEventListener('updatefound', () => track(registration.installing));
  document.addEventListener('visibilitychange', () => {
    // A PWA can stay open for days: look for a new build at each return.
    if (document.visibilityState === 'visible') {
      registration.update().catch((e) => console.warn('Service worker update failed', e));
    }
    evaluate();
  });
}

// Asks the service worker of this page for its cache name: the print of the
// build. No controller or no answer: `onBuild` is never called.
export function requestBuild(onBuild) {
  const container = navigator.serviceWorker;
  if (!container?.controller) return () => {};
  const onMessage = (event) => {
    if (event.data?.type === 'BUILD') onBuild(event.data.cache);
  };
  container.addEventListener('message', onMessage);
  container.controller.postMessage({ type: 'BUILD' });
  return () => container.removeEventListener('message', onMessage);
}
