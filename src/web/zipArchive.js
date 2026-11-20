// Web replacement for react-native-zip-archive (wired in metro.config.js).
// shortcut: backup and restore reject on web; replace with a jszip path when web backup is in scope.
const unavailable = async () => {
  throw new Error('Not available on web');
};

export const zip = unavailable;
export const unzip = unavailable;
