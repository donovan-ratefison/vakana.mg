import { directMediaUrl } from '../useMediaUrl.web';

jest.mock('../../services/mediaStore.web', () => ({ openMediaFile: jest.fn() }));

describe('directMediaUrl', () => {
  it.each(['blob:abc', 'data:image/png;base64,AAAA'])('returns %p', (uri) => {
    expect(directMediaUrl(uri)).toBe(uri);
  });

  it.each([
    'https://example.invalid/p.jpg',
    'http://x/y',
    'file:///data/p.jpg',
    '//host/p.jpg',
    'BLOB:x',
    '',
    null,
    undefined,
  ])('returns null for %p', (uri) => {
    expect(directMediaUrl(uri)).toBeNull();
  });
});
