import { useEffect, useState } from 'react';
import { openMediaFile } from '../services/mediaStore.web';

// The URL a player or an image can load for a stored media URI. An `opfs:`
// reference is read from the media store and served through an object URL,
// which is revoked on unmount and when `uri` changes. The result is null
// until the URL is ready, and stays null if the file is missing. Any other
// URI is returned as is.
export default function useMediaUrl(uri) {
  const stored = !!uri && uri.startsWith('opfs:');
  // The URL is kept with its reference: after a change of `uri`, the URL of
  // the previous reference is never returned.
  const [made, setMade] = useState(null);

  useEffect(() => {
    if (!stored) return undefined;
    let live = true;
    let created = null;
    openMediaFile(uri).then((file) => {
      // A late answer after unmount must not create a URL nobody revokes.
      if (!live || !file) return;
      created = URL.createObjectURL(file);
      setMade({ uri, url: created });
    });
    return () => {
      live = false;
      if (created) URL.revokeObjectURL(created);
      // A revoked URL must not be returned if the same `uri` comes back.
      setMade(null);
    };
  }, [uri, stored]);

  if (!stored) return uri;
  return made && made.uri === uri ? made.url : null;
}
