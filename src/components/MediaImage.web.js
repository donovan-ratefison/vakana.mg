import React, { useEffect, useState } from 'react';
import { Image } from 'react-native';
import { openMediaFile } from '../services/mediaStore.web';

// An entry photo from its stored reference. An `opfs:` reference is read
// from the media store and shown through an object URL, which is revoked on
// unmount and when `uri` changes. A missing file renders an empty image.
export default function MediaImage({ uri, ...rest }) {
  const stored = !!uri && uri.startsWith('opfs:');
  const [url, setUrl] = useState(null);

  useEffect(() => {
    if (!stored) return undefined;
    let live = true;
    let created = null;
    openMediaFile(uri).then((file) => {
      // A late answer after unmount must not create a URL nobody revokes.
      if (!live || !file) return;
      created = URL.createObjectURL(file);
      setUrl(created);
    });
    return () => {
      live = false;
      if (created) URL.revokeObjectURL(created);
      setUrl(null);
    };
  }, [uri, stored]);

  const source = stored ? (url ? { uri: url } : undefined) : { uri };
  return <Image {...rest} source={source} />;
}
