// Delivery of an export file: write it, share it, save it to the device.
// The web counterpart is exportFile.web.js (download in the browser).

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

// `encoding` is 'utf8' or 'base64'. `mimeType` is used on web only.
export async function writeExportFile(filename, content, { encoding } = {}) {
  const uri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, content, {
    encoding:
      encoding === 'base64'
        ? FileSystem.EncodingType.Base64
        : FileSystem.EncodingType.UTF8,
  });
  return uri;
}

// `filename` is used on web only.
export async function shareExportFile(uri, { mimeType, dialogTitle, UTI } = {}) {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device');
  }
  await Sharing.shareAsync(uri, { mimeType, dialogTitle, UTI });
}

// Android: the user picks a folder (StorageAccessFramework) and the bytes
// are copied there. No share sheet. Returns the SAF uri.
// Other OS: SAF does not exist, so the share sheet ("Save to Files").
export async function saveExportFileToDevice({ uri, filename, mimeType, UTI }, dialogTitle) {
  if (Platform.OS === 'android') {
    const perms =
      await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!perms.granted) throw new Error('Folder permission was denied');
    const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
      perms.directoryUri,
      filename,
      mimeType
    );
    // Always a base64 copy, so binary formats (PDF, zip) survive the round
    // trip and text formats stay byte-identical.
    const b64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await FileSystem.writeAsStringAsync(fileUri, b64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return fileUri;
  }
  await shareExportFile(uri, { filename, mimeType, dialogTitle, UTI });
  return uri;
}
