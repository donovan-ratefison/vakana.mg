import { downloadBackup } from '../../web/backupArchive';
import {
  writeExportFile,
  shareExportFile,
  saveExportFileToDevice,
} from '../exportFile.web';

jest.mock('../../web/backupArchive', () => ({ downloadBackup: jest.fn() }));

let lastBlob;
beforeEach(() => {
  jest.clearAllMocks();
  global.URL.createObjectURL = jest.fn((blob) => {
    lastBlob = blob;
    return 'blob:test/1';
  });
});

describe('writeExportFile on web', () => {
  it('makes a text Blob of the given type', async () => {
    const uri = await writeExportFile('a.md', 'héllo', { encoding: 'utf8', mimeType: 'text/markdown' });
    expect(uri).toBe('blob:test/1');
    expect(lastBlob.type).toBe('text/markdown');
    expect(await lastBlob.text()).toBe('héllo');
  });

  it('decodes base64 into bytes', async () => {
    await writeExportFile('a.zip', 'AAEC/w==', { encoding: 'base64', mimeType: 'application/zip' });
    expect(lastBlob.type).toBe('application/zip');
    expect([...new Uint8Array(await lastBlob.arrayBuffer())]).toEqual([0, 1, 2, 255]);
  });
});

describe('share and save on web', () => {
  it('shareExportFile downloads the file once and returns the uri', async () => {
    const uri = await shareExportFile('blob:test/1', { filename: 'a.md', mimeType: 'text/markdown' });
    expect(uri).toBe('blob:test/1');
    expect(downloadBackup).toHaveBeenCalledTimes(1);
    expect(downloadBackup).toHaveBeenCalledWith('blob:test/1', 'a.md');
  });

  it('saveExportFileToDevice downloads the file once and returns the uri', async () => {
    const uri = await saveExportFileToDevice(
      { uri: 'blob:test/1', filename: 'a.zip', mimeType: 'application/zip' },
      'Save article'
    );
    expect(uri).toBe('blob:test/1');
    expect(downloadBackup).toHaveBeenCalledTimes(1);
    expect(downloadBackup).toHaveBeenCalledWith('blob:test/1', 'a.zip');
  });
});
