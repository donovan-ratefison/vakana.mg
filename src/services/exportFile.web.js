// Web counterpart of exportFile.js. The browser has no file cache and
// expo-sharing shares only a URL, so an export is an object URL that the
// browser downloads.

import { downloadBackup } from '../web/backupArchive';

export async function writeExportFile(filename, content, { encoding, mimeType } = {}) {
  const part =
    encoding === 'base64'
      ? Uint8Array.from(atob(content), (c) => c.charCodeAt(0))
      : content;
  return URL.createObjectURL(new Blob([part], { type: mimeType }));
}

export async function shareExportFile(uri, { filename } = {}) {
  downloadBackup(uri, filename);
  return uri;
}

export async function saveExportFileToDevice({ uri, filename }) {
  downloadBackup(uri, filename);
  return uri;
}
