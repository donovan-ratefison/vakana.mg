// Web replacement for react-native-zip-archive (wired in metro.config.js).
// These 2 functions are not called on web any more: backup and restore use src/web/backupArchive.js.
const unavailable = async () => {
  throw new Error('Not available on web');
};

export const zip = unavailable;
export const unzip = unavailable;
