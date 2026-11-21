import React from 'react';
import { Image } from 'react-native';
import useMediaUrl from '../hooks/useMediaUrl';

// An entry photo from its stored reference. An `opfs:` reference is shown
// through the object URL of useMediaUrl. Until that URL is ready, and when
// the file is missing, the image is empty.
export default function MediaImage({ uri, ...rest }) {
  const url = useMediaUrl(uri);
  return <Image {...rest} source={url ? { uri: url } : undefined} />;
}
