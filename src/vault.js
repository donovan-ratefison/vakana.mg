import { createContext, useContext } from 'react';

// VaultContext exposes vault-management actions that have to live above
// the navigator (because they tear it down): switchVault flips back to
// LockScreen and re-inits the DB against the new file.
export const VaultContext = createContext({
  switchVault: async () => {},
});

export const useVault = () => useContext(VaultContext);
