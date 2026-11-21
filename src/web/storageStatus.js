// Web only: does the browser keep the journal (persistent storage), and how
// much space does it use. The screen calls these under Platform.OS === 'web'.

export async function readStorageStatus(storage = globalThis.navigator?.storage) {
  let persisted = false;
  let usageBytes = null;
  try {
    persisted = typeof storage?.persisted === 'function' && (await storage.persisted()) === true;
  } catch {
    persisted = false;
  }
  try {
    if (typeof storage?.estimate === 'function') {
      const usage = (await storage.estimate())?.usage;
      if (typeof usage === 'number') usageBytes = usage;
    }
  } catch {
    usageBytes = null;
  }
  return { persisted, usageBytes, canAsk: typeof storage?.persist === 'function' };
}

export async function askPersistentStorage(storage = globalThis.navigator?.storage) {
  try {
    await storage.persist();
  } catch {
    // The browser refused or has no API: the status read below shows it.
  }
  return readStorageStatus(storage);
}

export function storageStatusText({ persisted, usageBytes }) {
  const text = persisted
    ? 'Storage: protected. The browser keeps this journal until you clear the site data.'
    : 'Storage: not protected. The browser can clear this journal. Install the app and make a backup.';
  return usageBytes == null ? text : `${text} Space used: ${(usageBytes / 1048576).toFixed(1)} MB.`;
}
