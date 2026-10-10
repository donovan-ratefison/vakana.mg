// Inline .md imports at build time. Without this, the bundler would have
// to resolve markdown as a runtime asset, which works in Expo Go but
// fails in standalone release builds (expo-asset rejects downloadAsync
// for custom extensions). Inlining bakes the file contents into the JS
// bundle as a plain string, so the viewer never touches the asset system.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // reanimated's plugin must stay LAST in this list (its own requirement).
    plugins: [
      ['babel-plugin-inline-import', { extensions: ['.md'] }],
      'react-native-reanimated/plugin',
    ],
  };
};
