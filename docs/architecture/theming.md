# Theming

The app has one global theme provider. The provider persists the preference of
the user. Every screen and component must use the same factory pattern for
styles. Without the pattern, a theme change does not update the UI.

## API

`src/theme.js` exports:

- **`ThemeProvider`**: wraps the full app in `App.js` (`App.js:63-65`).
- **`useTheme()`**: returns `{ mode, resolved, colors, setMode }`.
- **`THEME_MODES`**: `['system', 'light', 'dark']`. It is exported for the
  cycle logic on `HomeScreen`.

The hook returns:

- **`mode`** (`'system' | 'light' | 'dark'`): the preference that the user
  set. It is persisted in `expo-secure-store` under `journal_theme_mode`
  (`theme.js:5, 65`).
- **`resolved`** (`'light' | 'dark'`): the scheme that the app renders. When
  `mode` is `'system'`, `resolved` follows `useColorScheme()`. In the other
  modes, it is equal to `mode` (`theme.js:69`).
- **`colors`**: the palette object for the resolved scheme. See "Palette shape"
  below.
- **`setMode(next)`**: validates the value against `VALID_MODES`, updates the
  state, and persists the value to secure-store. It ignores errors
  (`theme.js:61-67`).

## Persistence

A `useEffect` loads the mode one time on mount (`theme.js:53-59`). If the load
fails, the mode stays at the `'system'` default. The mode is stored as a plain
string. It is not encrypted, because it is preference data and not a secret.

The provider exposes **`ready`**. `ready` is false until both secure-store
reads settle. `App.js` keeps the splash screen visible until `ready` is true.
Thus a stored dark theme never paints a light first frame (the v0.77.1 fix for
the white flash at cold start).

The provider also copies `colors.background` into the **native window** on
every change, with `setBackgroundColorAsync` from `expo-system-ui`. Without
this, each frame that shows the window would flash the OS default color. Such
frames occur in stack transitions, when a modal opens, and with the keyboard.

`app.json` supports this: `userInterfaceStyle` is `"automatic"`. The old value
`"light"` pinned the Android window to light. It also pinned `useColorScheme()`
to `'light'`. As a result, mode `system` could not resolve to dark in a
standalone Android build.

The lock-screen PIN uses the same `expo-secure-store` (`utils/auth.js`). The
keys are not related (`journal_theme_mode` and the per-vault
`journal_pin_<vaultId>`). The keys do not collide, and neither key depends on
the other.

## Palette shape

The palette is a flat color map (`theme.js:7-38`). The `light` and `dark`
variants have the same set of keys:

| Key | Role |
|---|---|
| `background` | Screen background. |
| `surface` | Cards, sheets, raised surfaces. |
| `surfaceMuted` | Translucent overlay tint (chips, tag-pill backgrounds). Note: the value is an `rgba(...)` value, not a hex value. |
| `text` | Primary body text. |
| `textMuted` | Secondary text: labels, metadata. |
| `textFaint` | Tertiary text: placeholders, text with less emphasis. |
| `primary` | Brand and accent color (the cappuccino espresso brown). |
| `primaryOnPrimary` | Text and icon color on top of `primary` fills (light cream). |
| `border` | Card and input borders. |
| `borderStrong` | Heavier dividers and handles. |
| `danger` | Destructive actions, error text. |
| `dangerSoft` | Translucent danger color (delete buttons). |
| `placeholder` | TextInput placeholder text. |

The light palette is a warm cream and espresso ("cappuccino"). The dark variant
inverts it to deep brown and cream (`theme.js:7-38`). Both variants are tuned
by hand. If you add a key, you must define it in *both* variants.

**Contrast floor.** In every palette and in both schemes, `textFaint` and
`placeholder` have a contrast of at least 3:1 (WCAG) against *both*
`background` and `surface`. They are tuned to approximately 3.1:1. Only the
lightness changed, and the hue family stayed the same. When you add or tune a
palette, check both tokens against both surfaces. Use `textFaint` for
decoration and hints. Use `textMuted` for all text on a list card that carries
information (counts, time-of-day, closed-loop date).

## The `makeStyles(colors)` pattern

Every screen and component that uses theme colors has this shape:

```js
import { useTheme } from '../theme';

export default function MyComponent() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // ...
}

const makeStyles = (colors) =>
  StyleSheet.create({
    container: { backgroundColor: colors.background, ... },
    title: { color: colors.text, ... },
  });
```

The factory is a **module-scope function**, not a top-level
`StyleSheet.create`. The component memoizes the result on `[colors]`. Thus the
same palette identity gives the same `styles` object reference on each render.

### Why this pattern, not `StyleSheet.create({...colors.text...})` at module scope

A top-level `StyleSheet.create({ title: { color: '#2b1d14' } })` runs *one
time*, when the module is evaluated. It uses the `colors` object that is in
scope at that moment, which is usually nothing. The hex codes become fixed.
When the user changes the theme, `colors` changes. But the `styles` object is
still the object from the module load, so the component renders again with
stale colors. The UI does not change.

The factory pattern corrects this. It builds the `StyleSheet` from the live
palette each time `colors` changes. The result is memoized, so a render with
no palette change has no cost.

Do not write `StyleSheet.create` at module scope with a `colors.something`
value. Move such a style into a `makeStyles(colors)` factory. A module-level
`StyleSheet.create` is correct for *static* values: sizes, layout, opacity.
The test is this question: does a value depend on `colors`?

## Mode picker

`HomeScreen.js:252-256` cycles `system → light → dark → system → ...`:

```js
const cycleTheme = () => {
  const idx = THEME_MODES.indexOf(mode);
  setMode(THEME_MODES[(idx + 1) % THEME_MODES.length]);
};
```

The header icon shows the current mode (`HomeScreen.js:40-44`):

| Mode | Icon |
|---|---|
| `system` | `phone-portrait-outline` |
| `light` | `sunny-outline` |
| `dark` | `moon-outline` |

The icon is the only mode picker. There is no settings screen. Tap the icon to
go to the next mode. Tap it again to go to the mode after that. The app
persists the mode automatically.

## Where else theme touches the app

- **Status bar**: `App.js:54` sets `<StatusBar style="light"|"dark">` from
  `resolved`.
- **Navigation theme**: `AppNavigator.js:16-31` rebuilds it each time `colors`
  changes. `navigation-and-shell.md` explains why the spread of `DefaultTheme`
  / `DarkTheme` is mandatory in v7 (the `fonts` field).
- **The cappuccino brand** is implicit in the palette. No other code hardcodes
  brand colors. `LockScreen.js` (PIN dots, keypad) and `HomeScreen.js:613-617`
  use `colors.primary` for text with a brand look. They are ordinary consumers
  of the palette.

## Adding a new color key

1. Add the key to *both* `palettes.light` and `palettes.dark` in
   `theme.js:7-38`.
2. Use it in a `makeStyles(colors)` factory.

Some keys have a meaning in only one mode (for example, a special accent for
dark). Add such a key to both palettes, and give the light variant an
applicable neutral value. If the key is `undefined` in one palette, the result
is `backgroundColor: undefined`. This silently uses the default, and it is
difficult to see in a review.
