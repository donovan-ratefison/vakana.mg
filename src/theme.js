import React, { createContext, useContext, useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as SystemUI from 'expo-system-ui';
import { warn } from './utils/log';

const MODE_KEY = 'journal_theme_mode';
const PALETTE_KEY = 'journal_theme_palette';

// Each palette ships a light + dark variant. Keys are flat: every screen
// reads from `useTheme().colors`, so adding a new palette only requires
// filling in this object.
const palettes = {
  cappuccino: {
    label: 'Cappuccino',
    description: 'Warm cream and espresso',
    swatch: { light: '#f5ead5', dark: '#1c1310' },
    accent: '#8b5e3c',
    light: {
      background: '#f5ead5',
      surface: '#ebe0c9',
      surfaceMuted: 'rgba(43,29,20,0.06)',
      text: '#2b1d14',
      textMuted: '#6b513c',
      textFaint: '#917a5d',
      primary: '#8b5e3c',
      primaryOnPrimary: '#fff8ec',
      border: '#d6c5a7',
      borderStrong: '#bba47e',
      danger: '#b14a3a',
      dangerSoft: 'rgba(177,74,58,0.15)',
      placeholder: '#917a5d',
    },
    dark: {
      background: '#1c1310',
      surface: '#2a1f1a',
      surfaceMuted: 'rgba(235,224,201,0.07)',
      text: '#ebe0c9',
      textMuted: '#a89378',
      textFaint: '#88674c',
      primary: '#c9a368',
      primaryOnPrimary: '#1c1310',
      border: '#3d2e25',
      borderStrong: '#5a4536',
      danger: '#ff7a6b',
      dangerSoft: 'rgba(255,122,107,0.18)',
      placeholder: '#88674c',
    },
  },
  ink: {
    label: 'Ink',
    description: 'Cool slate neutrals',
    swatch: { light: '#eef0f3', dark: '#15181d' },
    accent: '#4a6072',
    light: {
      background: '#eef0f3',
      surface: '#e3e6eb',
      surfaceMuted: 'rgba(20,28,40,0.05)',
      text: '#1d242e',
      textMuted: '#54616f',
      textFaint: '#748392',
      primary: '#4a6072',
      primaryOnPrimary: '#f5f7fa',
      border: '#cdd3db',
      borderStrong: '#abb4c0',
      danger: '#a04848',
      dangerSoft: 'rgba(160,72,72,0.14)',
      placeholder: '#748392',
    },
    dark: {
      background: '#15181d',
      surface: '#1f242c',
      surfaceMuted: 'rgba(220,226,234,0.06)',
      text: '#dde2ea',
      textMuted: '#9aa4b1',
      textFaint: '#667080',
      primary: '#8aa3b8',
      primaryOnPrimary: '#15181d',
      border: '#2c333d',
      borderStrong: '#454e5b',
      danger: '#e6786d',
      dangerSoft: 'rgba(230,120,109,0.16)',
      placeholder: '#667080',
    },
  },
  sage: {
    label: 'Sage',
    description: 'Soft muted greens',
    swatch: { light: '#eef1e6', dark: '#161a14' },
    accent: '#5a7a55',
    light: {
      background: '#eef1e6',
      surface: '#e2e7d6',
      surfaceMuted: 'rgba(28,40,28,0.06)',
      text: '#23291e',
      textMuted: '#5a6452',
      textFaint: '#788471',
      primary: '#5a7a55',
      primaryOnPrimary: '#f6f8ee',
      border: '#cbd5b8',
      borderStrong: '#a8b693',
      danger: '#a35345',
      dangerSoft: 'rgba(163,83,69,0.14)',
      placeholder: '#788471',
    },
    dark: {
      background: '#161a14',
      surface: '#212720',
      surfaceMuted: 'rgba(220,230,212,0.06)',
      text: '#dce6d4',
      textMuted: '#94a08a',
      textFaint: '#69755e',
      primary: '#9bb787',
      primaryOnPrimary: '#161a14',
      border: '#2c352a',
      borderStrong: '#475240',
      danger: '#df8474',
      dangerSoft: 'rgba(223,132,116,0.16)',
      placeholder: '#69755e',
    },
  },
  linen: {
    label: 'Linen',
    description: 'Paper-soft monochrome',
    swatch: { light: '#f7f4ee', dark: '#181614' },
    accent: '#3c352d',
    light: {
      background: '#f7f4ee',
      surface: '#ede8df',
      surfaceMuted: 'rgba(40,36,30,0.05)',
      text: '#28241e',
      textMuted: '#5d564c',
      textFaint: '#8c8174',
      primary: '#3c352d',
      primaryOnPrimary: '#faf7f1',
      border: '#d9d2c4',
      borderStrong: '#b8af9e',
      danger: '#9c4a3a',
      dangerSoft: 'rgba(156,74,58,0.14)',
      placeholder: '#8c8174',
    },
    dark: {
      background: '#181614',
      surface: '#22201d',
      surfaceMuted: 'rgba(232,226,214,0.06)',
      text: '#e7e1d3',
      textMuted: '#a59c8c',
      textFaint: '#746b5e',
      primary: '#d9cfba',
      primaryOnPrimary: '#181614',
      border: '#2e2a25',
      borderStrong: '#4a4339',
      danger: '#e0796a',
      dangerSoft: 'rgba(224,121,106,0.16)',
      placeholder: '#746b5e',
    },
  },
  ember: {
    label: 'Ember',
    description: 'Ayu warmth with scarlet embers',
    swatch: { light: '#fafaf3', dark: '#1a1d24' },
    accent: '#d83b2e',
    light: {
      // Ayu-light cream paper, scarlet primary. Danger leans crimson so it
      // stays distinguishable from the primary in delete affordances.
      background: '#fafaf3',
      surface: '#f1efe5',
      surfaceMuted: 'rgba(60,30,24,0.05)',
      text: '#2a2620',
      textMuted: '#6b5e54',
      textFaint: '#958572',
      primary: '#d83b2e',
      primaryOnPrimary: '#fff7f1',
      border: '#e6dfcf',
      borderStrong: '#c9bea5',
      danger: '#8c2828',
      dangerSoft: 'rgba(140,40,40,0.14)',
      placeholder: '#958572',
    },
    dark: {
      // Ayu-mirage dark slate-blue, brighter vermillion primary so it pops
      // against the cool background.
      background: '#1a1d24',
      surface: '#232730',
      surfaceMuted: 'rgba(232,210,196,0.06)',
      text: '#d8d2c9',
      textMuted: '#8a8278',
      textFaint: '#777269',
      primary: '#ff5a45',
      primaryOnPrimary: '#1a1d24',
      border: '#2d323d',
      borderStrong: '#454c5a',
      danger: '#ff8a78',
      dangerSoft: 'rgba(255,138,120,0.16)',
      placeholder: '#777269',
    },
  },
  mist: {
    label: 'Mist',
    description: 'Pale blue-gray, cool and quiet',
    swatch: { light: '#eaeff3', dark: '#13181d' },
    accent: '#557080',
    light: {
      background: '#eaeff3',
      surface: '#dde5eb',
      surfaceMuted: 'rgba(20,32,44,0.05)',
      text: '#1c2630',
      textMuted: '#54616d',
      textFaint: '#728190',
      primary: '#557080',
      primaryOnPrimary: '#f3f7fa',
      border: '#c8d2dc',
      borderStrong: '#a3b1bf',
      danger: '#9d5247',
      dangerSoft: 'rgba(157,82,71,0.14)',
      placeholder: '#728190',
    },
    dark: {
      background: '#13181d',
      surface: '#1c232b',
      surfaceMuted: 'rgba(220,230,238,0.06)',
      text: '#dce6ee',
      textMuted: '#92a0ae',
      textFaint: '#63707f',
      primary: '#9cb5c6',
      primaryOnPrimary: '#13181d',
      border: '#28303a',
      borderStrong: '#424d59',
      danger: '#dd7a6c',
      dangerSoft: 'rgba(221,122,108,0.16)',
      placeholder: '#63707f',
    },
  },
};

const PALETTE_NAMES = Object.keys(palettes);
const VALID_MODES = ['system', 'light', 'dark'];
const DEFAULT_PALETTE = 'cappuccino';

function getColors(paletteName, resolvedScheme) {
  const palette = palettes[paletteName] || palettes[DEFAULT_PALETTE];
  return palette[resolvedScheme] || palette.light;
}

const ThemeContext = createContext({
  mode: 'system',
  resolved: 'light',
  palette: DEFAULT_PALETTE,
  colors: getColors(DEFAULT_PALETTE, 'light'),
  ready: true,
  setMode: () => {},
  setPalette: () => {},
});

export function ThemeProvider({ children }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState('system');
  const [palette, setPaletteState] = useState(DEFAULT_PALETTE);
  // False until the persisted mode/palette have been read back. App.js keeps
  // the splash screen up until this flips, so a stored dark theme never
  // renders a light first frame (the cold-start "white flash").
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all([
      SecureStore.getItemAsync(MODE_KEY)
        .then((stored) => {
          if (VALID_MODES.includes(stored)) setModeState(stored);
        })
        .catch(() => {}),
      SecureStore.getItemAsync(PALETTE_KEY)
        .then((stored) => {
          if (stored && palettes[stored]) setPaletteState(stored);
        })
        .catch(() => {}),
    ]).then(() => setReady(true));
  }, []);

  const setMode = async (next) => {
    if (!VALID_MODES.includes(next)) return;
    setModeState(next);
    try {
      await SecureStore.setItemAsync(MODE_KEY, next);
    } catch (e) {
      warn('theme.setMode', e);
    }
  };

  const setPalette = async (next) => {
    if (!palettes[next]) return;
    setPaletteState(next);
    try {
      await SecureStore.setItemAsync(PALETTE_KEY, next);
    } catch (e) {
      warn('theme.setPalette', e);
    }
  };

  const resolved = mode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode;
  const colors = getColors(palette, resolved);

  // Keep the native window behind the React tree painted in the theme
  // background. Any frame where that window shows through (stack
  // transitions, modal opens, the keyboard) otherwise flashes the OS
  // default (white) under a dark theme.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.background).catch(() => {});
  }, [colors.background]);

  return (
    <ThemeContext.Provider
      value={{ mode, resolved, palette, colors, ready, setMode, setPalette }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

export const THEME_MODES = VALID_MODES;
export const PALETTES = palettes;
export const PALETTE_KEYS = PALETTE_NAMES;
