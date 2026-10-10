# Navigation and shell

The "shell" is the set of providers and gates above the navigation stack:
`App.js → ThemeProvider → AppShell → LockContext → AppNavigator`. This document
describes these parts:

- The boot sequence.
- The PIN gate.
- The `LockContext` function that locks the app from any screen.
- The navigation stack.
- The rebuild of the navigation theme that React Navigation v7 needs.

## Boot sequence (`App.js`)

`App.js:60-68` is the outermost component:

```jsx
<GestureHandlerRootView>
  <ThemeProvider>
    <AppShell />
  </ThemeProvider>
</GestureHandlerRootView>
```

`react-native-gesture-handler` requires `GestureHandlerRootView`. The `Swipeable`
rows in `HomeScreen` use that library. The `PanResponder` chain reorder in
`ThreadComposerScreen` also uses it. `ThemeProvider` is above the shell because
`AppShell` needs `useTheme()` for the splash background during the DB
initialization.

`AppShell` (`App.js:15-58`) is the gate. Its sequence:

1. **State**: `isUnlocked` (PIN gate), `isReady` (boot done), `vaultEpoch`.
2. **Boot effect** (`prepare()`, runs one time for each `vaultEpoch`). It awaits
   these calls in sequence:
   - `ensureRegistry()`.
   - **`Font.loadAsync({ Caveat_400Regular })`**. This call has its own
     `.catch(() => {})`. A font failure must never block the boot.
   - `initDatabase()`.
   - `backfillAutoThreadsIfNeeded()`.

   A `finally` block sets `isReady = true` and hides the splash *even if an
   error occurred*. Thus the app never stops on the spinner.
3. **`lockValue = useMemo(() => ({ lock: () => setIsUnlocked(false) }), [])`**:
   the value that `LockContext.Provider` receives. The memo prevents a new
   trigger of the context consumers on each render.
4. **Early returns**:
   - `!isReady || !themeReady || showOnboarding === null` → spinner (behind the splash).
   - `showOnboarding` → `<OnboardingScreen onDone={...} />`. These are the
     first-launch intro slides. They come **before** the PIN gate on purpose
     (`onboarding-slides.md`).
   - `!isUnlocked` → `<LockScreen onUnlock={...} />`.
   - else → `<VaultContext><LockContext><AppNavigator /></…></…>`.

### Hooks before early returns

`useState`, `useEffect`, `useTheme`, and `useMemo(lockValue)` all run
*unconditionally* at the top of the component, before each early-return branch.
The Rules of Hooks make this mandatory. If a hook ran behind a condition on
render-time state, the call order would change between renders. React would
then crash.

This bug occurred one time: a `useFonts` hook was added after the early
`if (!isReady)` return. The font load is now **imperative inside `prepare()`**
(not a hook), so the order problem cannot occur for the font. The rule stays
for the other hooks: put each hook above each early return. Do not change this.

### Splash screen

`SplashScreen.preventAutoHideAsync()` (`App.js:13`) runs at module evaluation
time, before the first render. It keeps the native splash on the screen.
`SplashScreen.hideAsync()` runs from its own effect when **both** conditions
are true:

- `isReady` is true (DB init is complete).
- The `ready` value of the theme provider is true (the provider read back the
  persisted mode and palette).

Before v0.77.1, the splash hid when only the DB was ready. A stored dark theme
then showed a light first frame. v0.77.1 fixed this.

## The PIN gate

The app renders `LockScreen` (`src/screens/LockScreen.js`) until the user enters
or sets a PIN. `LockScreen` calls `onUnlock()`, which changes `isUnlocked` in
`AppShell`. The next render mounts `AppNavigator` for the first time.
Implementation details:

- **PIN storage.** The PIN is in `expo-secure-store`, one record for each vault
  (`utils/auth.js`).
  - `journal_pin_<vaultId>` holds a salted, iterated SHA-256 record
    `v2$<saltHex>$<hashHex>`.
  - The boolean `journal_pin_<vaultId>_set` goes with it.
  - `utils/pinHash.js` contains the format, the reason for 100 rounds, and the
    pure helpers.
  - The app accepts an older `v1$` record one time, then upgrades it. A `v1$`
    record uses 5000 rounds, which takes almost one second for each unlock on
    the device.
  - The app also accepts a legacy plain-text value one time, then upgrades it.
    Legacy values come from the builds before the hash and from the pre-vault
    `journal_app_pin` copy.
  - `checkPin` hashes the PIN again when it matches.
  - `upgradeLegacyPinRecords()` runs from the `LockScreen` mount for each vault.
  - `purgeLegacyPinKeys()` removes the pre-vault key.
  - All writes go through `setPin`.
  - The hex comparison is constant-time.
  - There is no biometric fallback.
  - The PIN gates the in-app UI. It does not encrypt the SQLite file.
- **Backoff.** The unlock path is `attemptPin`, not `verifyPin`.
  - A JSON record for each vault, `journal_pin_<vaultId>_attempts`
    (`{failures, lockedUntil}`), permits 4 free misses.
  - After that, the record locks the input for 30 s. The lock time doubles for
    each subsequent miss, to a maximum of 15 min.
  - A correct PIN clears the record.
  - The app writes the failure *before* it checks the PIN. Thus the counter
    does not reset if the user stops the app during the check.
  - `lockedUntil` is a wall-clock time, so the countdown continues after a
    restart.
  - If the clock moves backwards, the app clamps the wait to the duration of
    the current step.
  - `hooks/usePinLockout.js` shows the lockout message in the existing error
    slot. The message is "Too many attempts. Try again in m:ss"
    (`formatLockoutMessage` in `utils/pinHash.js`).
  - During the lockout, the keypad is `disabled`. There is no other chrome.
  - The verify step of Change PIN uses the same counter. Without the counter,
    that step would be an unmetered oracle.
  - The "new PIN must differ" check of Change PIN uses the unmetered
    `verifyPin`, because the user proved the current PIN before that check.
  - `deleteVault` and `removePin` remove the attempts key together with the PIN.
- **Shake animation.** The shake animation is a four-step `Animated.sequence`
  (`triggerShake`). A wrong PIN or a mismatch on confirm starts it.
- **On-screen keypad.** The digits come from an **on-screen keypad**,
  `src/components/PinKeypad.js`, not from the OS keyboard.
  - `KEY_ROWS` contains 1–9, then blank / 0 / backspace.
  - There is no `TextInput` on this screen.
  - Each key is a `Pressable` that calls `onDigit` or `onBackspace`. Each key is
    circular and has a pressed tint with `scale: 0.94`, `hapticTap`, and its
    own `accessibilityLabel`. The backspace key has no circle.
  - The screen appends the digit to the `pin` string and gives the string to
    the same `handlePinChange`. `handlePinChange` submits automatically at
    four digits.
  - The visible "dots" are styled `<View>`s that `pin.length` controls.

  **`SettingsChangePinScreen` also uses `PinKeypad`** (Settings → Vault →
  Change PIN). That screen had the same hidden input and the same failure
  mode. Both screens render the same component. Do not make a second copy of
  the grid.

  Props: `onDigit(d)`, `onBackspace()`, `disabled`, and an optional `keySize`.
  `keySize` is for callers that need the keypad height before layout. The
  component exports `pinKeySizeForWidth(width)` and `pinKeypadHeight(keySize)`
  for that purpose. LockScreen uses them to calculate `logoRoom`. Change-PIN
  keeps its own three-step flow, error copy, and safe-area bottom padding. The
  two screens share only the digit source.

  Before this keypad, a hidden `TextInput` (`opacity: 0`, 1×1, `autoFocus`)
  captured the PIN. A full-screen `TouchableOpacity` gave the focus back to the
  input on tap. Android did not reliably show a keyboard for an invisible
  input. The problem was worst when auto-lock showed this screen again on
  foreground. A tester could see the dots and have no way to type. The refocus
  overlay also covered the vault chips. Do not add a hidden input here again.
- **Layout.** The layout must fit a small phone (≈360×640) without a scroll.
  - The keypad size comes from the window **width** (64–76 dp circles).
  - The brand artwork takes the vertical space that remains (`logoRoom`). Thus
    the keys cannot move off the bottom of the screen.
  - The container adds the top and bottom values of `useSafeAreaInsets()` as
    padding. Thus the last key row is above the transparent navigation bar.

## `LockContext`: re-lock from anywhere

`src/lock.js`:

```js
export const LockContext = createContext({ lock: () => {} });
export const useLock = () => useContext(LockContext);
```

`AppShell` provides the real `lock` function as `() => setIsUnlocked(false)`
(`App.js:35-38, 53`). Each descendant can call `useLock().lock()` to go back to
the lock screen. `HomeScreen` does this for its lock-button icon
(`HomeScreen.js:25, 48, 362-368`).

The lock is a one-line state change, so this pattern makes a redesign of the
App shell unnecessary. To add a new shell-level function (for example "go back
to onboarding"), use the same pattern:

1. Define a context next to `lock.js`.
2. Provide the function from `AppShell`.
3. Expose a hook.
4. Call the hook where the function is necessary.

## Home list: On this day · prior years (head section)

The `sections` memo of `HomeScreen` (`HomeScreen.js`) starts from the
`groupIntoBands(entries)` output. When entries from prior years have the same
date as today, the memo adds a **head section** above the natural date bands.

- **Header.** The band header is the literal string `On this day · prior years`.
  The existing `sectionHeaderText` style (`textTransform: 'uppercase'`) shows it
  in uppercase, so the visible header is `ON THIS DAY · PRIOR YEARS`. It is one
  section in the SectionList, not separate chrome.
- **Gate condition.** The gate condition is a four-clause AND:
  `!filterActive && !debouncedQuery && homePinnedThreadId == null &&
  homeAppliedPresetId == null`. It hides the band when the list is already a
  filtered scope. A "same-date" surface on top of a captured query (funnel
  facets, typed search, pinned bead pill, or pinned thread pill) would not be
  coherent.
- **De-dup.** The de-dup is a pure-JS pass on the loaded `entries` array. There
  is no extra query, because the row set is complete for the visible window.
  The pass compares the MM-DD of each entry with today to find the prior-year
  matches. It then removes their ids from the other entries before
  `groupIntoBands` runs. Thus an entry from January 2 of last year never shows
  two times (one time on top, one time in *January 2025*).
- **Feb 29.** In a non-leap year, no row matches Feb 29, so the band does not
  render. This needs no special code.
- **Sort.** The section sorts its rows locally by year, newest prior year
  first. Thus the order of the section does not depend on the order from the
  caller.
- **Style.** The head section uses `sectionHeaderText` again. It looks like the
  other band headers (TODAY / EARLIER THIS WEEK / [Month YYYY]). There is no
  new section style and no new chrome.

## Home header: the Returns pair (Bell and Wander)

The Home header has two **returns** primitives: **Bell** and **Wander**.

- Bell shows *intentional* returns that the user set: scheduled reminders and
  comment-reminders that fired.
- Wander shows *chance* returns that the system brings back: a random entry
  older than the configured threshold.

Both primitives bring the past into the present. They are a deliberate pair,
not a bell with a utility button next to it. Wander is opt-in (default off).
Its pool does not contain private entries.

Implementation notes:

- **Bell presentation.** The banners for fired reminders and fired
  comment-reminders render as a **bell-anchored popover**.
  - The popover is a `Modal` that copies the ⋮ overflow menu: a transparent
    backdrop, a `measureInWindow` anchor with the Android status-bar offset
    added back, and a rotated tail below the bell center.
  - The banners are *not* inline in the header flow. Thus the popover never
    reflows the search row and the list when it opens.
  - The card is almost full width, with 12px side margins. The banners wrap.
    They are not truncated.
  - The inner `ScrollView` has a maximum height equal to the screen height that
    remains. It scrolls when there are many banners.
  - The popover **always opens**. With `pendingBannerCount === 0` it draws a
    compact empty state: "No reminders have fired." and one muted line that
    tells what arrives here.
  - An earlier version did not open on a zero count. A tester then thought the
    bell was a dead button. Do not add that guard again.
  - Do not add the old auto-close-on-empty effect again. An ack of the last
    banner now shows the same empty state. The empty state confirms the
    dismissal and the card stays open.
- **Bottom banner slot** (list view, above the bottom nav). Three items share
  this slot, in this priority: the burst banner, the import notice, and the
  **backup nudge strip**. The slot never shows two items stacked.
  - The nudge (`BackupNudgeStrip`, v0.79.0) is the quiet variant: one line,
    hairline border, muted text, `cloud-offline-outline`.
  - `services/backup.js` contains its derivation.
  - `getBackupNudge` returns a nudge when all of these are true: the backup is
    stale (`isBackupStale`), there are non-seeded writes since `lastBackupAt`,
    and the nudge is not snoozed.
  - `snoozeBackupNudge`: the ✕ control sets a 7-day snooze in
    `backup-meta.json`. `recordBackup` replaces the full entry, which clears
    the snooze.
  - Tap → `SettingsBackup`.
  - The nudge loads with the secondary focus loaders and also in a mount-only
    run.
- **Dice icon.** The dice icon (`dice-outline`) is immediately left of the bell
  in the `headerActions` row of `HomeScreen`. It has the same 36×36 `iconButton`
  geometry and the `gap: 6` spacing of the row.
- **Visibility.** Three conditions joined with AND control the visibility:
  `wanderReady && wanderEnabled && wanderPoolNonEmpty`.
  - `wanderReady` keeps the icon hidden during boot, before the settings load.
  - `wanderEnabled` is the user opt-in in Settings → Threads & returns → Wander.
  - `wanderPoolNonEmpty` is a cheap `SELECT 1 … LIMIT 1` probe. The probe runs
    again on mount, on a settings change, on focus, and on an entries reload.
- **Settings.** The settings are in `expo-secure-store` (`journal_wander_enabled`,
  `journal_wander_threshold_days`). `src/utils/wander.js` wraps them.
  - The threshold picker has four presets (3 months / 6 months / 1 year /
    2 years) and a **Custom** row.
  - The **Custom** row shows an inline numeric input. The input accepts an
    integer day count from 1 to 3650.
  - The Quiet threshold (R2) uses the same UX. Both share the parse and clamp
    code in `src/utils/thresholds.js` (`clampThresholdDays`).
- **Privacy contract.** The query layer enforces the privacy contract
  (`AND is_private = 0` in both the probe and the pick). Private entries are
  never in the Wander pool. This is a contract, not a default that can change.

## Home header: the substrate-phrase density readout

The Home header pairs a Malagasy title (`Vakana` / `Tetiandro` / `Tohivakana`)
with an English epithet (`Beads of life` / `Book of days` / `Threads of life`).
On the **list** and **threads** views, the epithet shows the density:

- The current filtered count comes before the epithet (`15 Beads of life`,
  `5 Threads of life`).
- At exactly one, the epithet changes to the singular (`1 Bead of life`).
- At zero, the header **hides the number** and shows only the plural. The
  absence is visible. This is the same rule as the echo chip: "no prior → no
  chip".

The calendar epithet stays static. *Book of days* does not take a leading
number, and the calendar does not respond to filters in the same way.

Implementation contract (`src/screens/HomeScreen.js:105-128`):

- `VIEW_TITLE` has `singular` and `plural` keys for list and threads, and a
  plain `subtitle` for calendar.
- `subtitleFor(view, listCount, threadsCount)` selects the correct form. It
  includes the singular/plural switch and the hidden number at zero.
- The list count is `entries.length`. It already responds to filters, because
  `loadEntries` writes the filtered set. There is no separate state and no
  lifted state.
- The threads count is in the local state of `ThreadsList`. `ThreadsList` owns
  `kindFilter`, `collection`, `sort`, and `debouncedQuery`.
- An `onCountChange` prop lifts the threads count. A `useEffect` on
  `threads.length` calls the prop. HomeScreen holds `threadsCount` and gives it
  to `subtitleFor`.
- When the user changes views, the count that is not in use becomes stale. The
  active view never reads it, so the stale value cannot show.
- When `ThreadsList` unmounts (view !== 'threads'), the last reported count
  stays. It causes no problem.
- On remount, the load reports `0` then `N`. For a short time the header shows
  `Threads of life` and then `N Threads of life`. The list view has the same
  behavior: it paints before the data arrives.

## Stack screens (`AppNavigator.js`)

There are five screens in one `createStackNavigator`:

| Name | Component | Purpose |
|---|---|---|
| `Home` | `HomeScreen` | List/calendar/threads view, drag-FAB, and reminder banner. Renders its own header. |
| `EntryEditor` | `EntryEditorScreen` | Entry editor with auto-save. Renders its own header. |
| `Day` | `DayScreen` | Threads anchored to that date (the destination of the ribbon), one-shot reminders on that date (acked reminders included, struck and restorable), all entries on that date, and a FAB for that day. Renders its own header. |
| `ThreadComposer` | `ThreadComposerScreen` | Create or edit a thread (name, anchor, ordered chain). |
| `ThreadDetail` | `ThreadDetailScreen` | Read a thread, go to its source entries, edit or delete the thread. |

Each screen sets `headerShown: false` (`AppNavigator.js:48, 53, 58, 63, 68`)
and draws its own header. The app does not use the React Navigation header.
The reason is visual. The screens overlap their headers with content that must
flow below the notch insets. Each in-screen header sets its own
`paddingTop: 60` (or 40 in the editor).

## Focus-driven reload (no global state)

There is no Redux, Zustand, or Recoil. `navigation.addListener('focus', ...)`
keeps the data current across screens:

- `HomeScreen.js:226-240` runs `loadEntries`, `loadEntryCounts`,
  `loadAnchoredThreads`, and `loadReminders` again each time it gets the focus.
- `ThreadDetailScreen.js:73-76` runs `load()` again for the thread and the chain.
- `ThreadsList.js:28-33` loads the thread cards again.
- `DayScreen` loads the entries of that date, its anchored threads, **and** its
  one-shot reminders again on focus.
- `EntryEditorScreen.js:154-160` refreshes the thread memberships and the
  linked-thread previews on focus.

This is sufficient for a local DB with small row counts (a personal journal).
The cost is one set of queries on each navigation transition. If this cost
becomes noticeable, use a normalized cache (RTK Query or TanStack Query against
`getDb()`). Do not use a global store.

## Navigation theme rebuild and the v7 `fonts` requirement

`AppNavigator.js:13-31`:

```jsx
const navTheme = useMemo(() => {
  const base = resolved === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...base,                       // <-- spread is load-bearing
    dark: resolved === 'dark',
    colors: { ...base.colors, primary, background, card, text, border, notification },
  };
}, [colors, resolved]);
```

React Navigation v7 **requires** the spread of `DefaultTheme` / `DarkTheme`.
The theme object must include a `fonts` field. This field is a font
configuration for each variant, which the library uses internally (for example
for header titles). A theme built with only `{ dark, colors }` caused a
`Cannot read property 'regular' of undefined` crash on each navigation render.
This crash occurred one time. The spread inherits `fonts` from the base theme,
so the code does not list the fonts.

**Caution:** If you upgrade React Navigation, first make sure of the theme
shape that the new version requires. Do *not* remove the spread before that
check.

`useMemo` caches the theme on `[colors, resolved]`. Thus
`<NavigationContainer>` does not tear down and rebuild on each render of
`AppNavigator`. When the theme changes (the user cycles the theme on
`HomeScreen`), the memo returns a new object. React Navigation then changes the
palette for the full stack. This includes the header colors, the status bar
(set by `App.js:54`), and all `useNavigationContainerRef` consumers.

## Edge-to-edge, safe areas, and sheet animation (v0.77.1)

Android runs **edge-to-edge** (`app.json → edgeToEdgeEnabled`). Thus no content
stays clear of the system navigation bar automatically. The rules:

- **Bottom-anchored chrome.** `App.js` wraps the tree in `SafeAreaProvider`.
  All **bottom-anchored chrome** reads `useSafeAreaInsets()` and increases its
  bottom padding to the inset as a minimum.
  - A 3-button Android nav bar is ~48dp. This is taller than a static "clears
    the home indicator" constant tuned on gesture devices.
  - The Home bottom nav and the BeadComposer sheet have this rule. A Redmi
    Note 11 hid both before the change.
  - Other sheets still have static padding. When you change one of them, give
    it the same inline `Math.max`/`+ insets.bottom` override.
- **Modal animation.** Each transparent overlay `Modal` (sheets, drawers,
  pickers) uses **`animationType="fade"`, never `"slide"`**.
  - On Android, `"slide"` animates the full modal window, which includes the
    dim backdrop. The user sees a black translucent panel slide up before the
    sheet arrives.
  - The edit-history sheet is the one permitted `"slide"`. Its backdrop is not
    dimmed by design, so there is no panel to see.
- **Never create a `Modal` in the same tick in which you dismiss the keyboard**
  (v0.88.4).
  - RN wraps the content of a Modal in a `fitsSystemWindows` FrameLayout unless
    the Modal passes `statusBarTranslucent`.
  - A dialog created during the IME hide animation can receive a transient
    *negative* inset there. RN then calculates the size of the modal root from
    that inset.
  - This was verified on a device: a 5539 px root on a 2772 px screen. A
    `flex-end` sheet stayed below the bottom edge. The sheet was present and
    focused, but not visible.
  - Two rules apply, and both are mandatory.
  - Rule 1: a sheet that the user can open from a focused field passes
    `statusBarTranslucent` + `navigationBarTranslucent`. With edge-to-edge,
    this changes nothing visually, because RN already forces dialogs
    edge-to-edge.
  - Rule 2: the sheet opens through `dismissKeyboardThen`
    (`hooks/useKeyboardHeight.js`). `dismissKeyboardThen` waits for the
    `keyboardDidHide` event of react-native-keyboard-controller before it sets
    `visible`.
- **Tab switches.** A tab switch on Home crossfades the body (70ms out / 70ms
  in, native driver) through `jumpToView`. This is deliberately quicker than
  the 150ms pushes of the stack.
