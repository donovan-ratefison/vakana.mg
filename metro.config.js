// `babel-plugin-inline-import` (see babel.config.js) replaces
// `require('./foo.md')` with the file's string contents at build time, so
// the bundle never touches the .md at runtime. Metro's resolver, however,
// runs before Babel transforms: it walks the original source and rejects
// require paths whose extension isn't registered. Adding `md` to
// `resolver.assetExts` keeps the resolver happy without re-engaging the
// expo-asset runtime path (the inlined require has no reference back to
// the asset by the time the bundle ships).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

if (!config.resolver.assetExts.includes('md')) {
  config.resolver.assetExts.push('md');
}

module.exports = config;
