// Web replacement for expo-secure-store (wired in metro.config.js).
// shortcut: plain localStorage, readable by any script on the origin; replace with an encrypted store before a public web release.
const store = () => globalThis.localStorage;

export async function getItemAsync(key) {
  return store().getItem(key);
}

export async function setItemAsync(key, value) {
  store().setItem(key, value);
}

export async function deleteItemAsync(key) {
  store().removeItem(key);
}
