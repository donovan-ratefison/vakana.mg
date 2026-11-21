import React from 'react';
import { Image } from 'react-native';

// An entry photo from its stored reference. The web version resolves an
// `opfs:` reference; here the reference is a file URI the Image can load.
export default function MediaImage({ uri, ...rest }) {
  return <Image {...rest} source={{ uri }} />;
}
