import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import {
  writeExportFile,
  shareExportFile,
  saveExportFileToDevice,
} from '../exportFile';

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  EncodingType: { UTF8: 'utf8', Base64: 'base64' },
  writeAsStringAsync: jest.fn(async () => {}),
  readAsStringAsync: jest.fn(async () => 'QUJD'),
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: jest.fn(),
    createFileAsync: jest.fn(async () => 'content://saf/a.zip'),
  },
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => {}),
}));

const SAF = FileSystem.StorageAccessFramework;
const ARTIFACT = {
  uri: 'file:///cache/a.zip',
  filename: 'a.zip',
  mimeType: 'application/zip',
  UTI: 'public.zip-archive',
};

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'android';
});

describe('writeExportFile', () => {
  it('writes UTF-8 text in the cache and returns the uri', async () => {
    const uri = await writeExportFile('a.md', 'hi', { encoding: 'utf8', mimeType: 'text/markdown' });
    expect(uri).toBe('file:///cache/a.md');
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith('file:///cache/a.md', 'hi', {
      encoding: 'utf8',
    });
  });

  it('writes base64 bytes in the cache', async () => {
    const uri = await writeExportFile('a.zip', 'AAEC', { encoding: 'base64' });
    expect(uri).toBe('file:///cache/a.zip');
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith('file:///cache/a.zip', 'AAEC', {
      encoding: 'base64',
    });
  });
});

describe('shareExportFile', () => {
  it('refuses when sharing is not available', async () => {
    Sharing.isAvailableAsync.mockResolvedValueOnce(false);
    await expect(shareExportFile('file:///cache/a.md', {})).rejects.toThrow(
      'Sharing is not available on this device'
    );
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });
});

describe('saveExportFileToDevice', () => {
  it('on Android, refuses when the folder permission is denied', async () => {
    SAF.requestDirectoryPermissionsAsync.mockResolvedValueOnce({ granted: false });
    await expect(saveExportFileToDevice(ARTIFACT, 'Save article')).rejects.toThrow(
      'Folder permission was denied'
    );
    expect(SAF.createFileAsync).not.toHaveBeenCalled();
  });

  it('on Android, copies the bytes as base64 to the SAF uri and returns it', async () => {
    SAF.requestDirectoryPermissionsAsync.mockResolvedValueOnce({
      granted: true,
      directoryUri: 'content://saf',
    });
    const uri = await saveExportFileToDevice(ARTIFACT, 'Save article');
    expect(uri).toBe('content://saf/a.zip');
    expect(SAF.createFileAsync).toHaveBeenCalledWith('content://saf', 'a.zip', 'application/zip');
    expect(FileSystem.readAsStringAsync).toHaveBeenCalledWith(ARTIFACT.uri, { encoding: 'base64' });
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith('content://saf/a.zip', 'QUJD', {
      encoding: 'base64',
    });
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });

  it('on iOS, opens the share sheet with the given title and returns the uri', async () => {
    Platform.OS = 'ios';
    const uri = await saveExportFileToDevice(ARTIFACT, 'Save article');
    expect(uri).toBe(ARTIFACT.uri);
    expect(Sharing.shareAsync).toHaveBeenCalledWith(ARTIFACT.uri, {
      mimeType: 'application/zip',
      dialogTitle: 'Save article',
      UTI: 'public.zip-archive',
    });
    expect(SAF.requestDirectoryPermissionsAsync).not.toHaveBeenCalled();
  });
});
