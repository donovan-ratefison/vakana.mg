// `babel-plugin-inline-import` (see babel.config.js) replaces
// `require('./foo.md')` with the file's string contents at build time, so
// the bundle never touches the .md at runtime. Metro's resolver, however,
// runs before Babel transforms: it walks the original source and rejects
// require paths whose extension isn't registered. Adding `md` to
// `resolver.assetExts` keeps the resolver happy without re-engaging the
// expo-asset runtime path (the inlined require has no reference back to
// the asset by the time the bundle ships).
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

if (!config.resolver.assetExts.includes('md')) {
  config.resolver.assetExts.push('md');
}

// expo-sqlite's web backend loads wa-sqlite as a .wasm asset.
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

// Web only: modules with no web implementation resolve to a replacement in
// src/web/. Every other platform keeps the default resolution.
const WEB_REPLACEMENTS = {
  'expo-secure-store': 'secureStore.js',
  'react-native-zip-archive': 'zipArchive.js',
  '@react-native-community/datetimepicker': 'dateTimePicker.js',
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_REPLACEMENTS[moduleName]) {
    return {
      type: 'sourceFile',
      filePath: path.join(__dirname, 'src/web', WEB_REPLACEMENTS[moduleName]),
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
