# Overview

This file gives the top level of the codebase: the stack, the commands and the invariants of each layer. The other files in this folder describe the subsystems in detail.

## Stack

The app is a journal app on Expo (SDK 54), React Native 0.81 and React 19.

The New Architecture is **disabled** (`app.json` → `newArchEnabled: false`). Fabric added a delay on each tap that the user could feel in release builds of this app, and no code depends on Fabric. See CHANGELOG v0.70.0.

As a result, **`react-native-reanimated` is pinned to 3.19.5** (in `expo.install.exclude`):

- Reanimated 4, the default of SDK 54, operates only on the New Architecture.
- 3.19.x is the only 3.x line that supports RN 0.81 on Paper.
- The library is there for `react-native-keyboard-controller`, which gives the exact IME geometry for the undo bar of the editor. The keyboard events of RN are not reliable under edge-to-edge. See `hooks/useKeyboardHeight.js`.

**Caution:** Do not "fix" the reanimated version mismatch unless you also make a decision on the architecture.

Tests and lint:

- Jest (`jest-expo`) tests the pure modules (`src/**/__tests__/`). `jest.global-setup.js` pins the TZ to Indian/Antananarivo.
- ESLint 9 uses `eslint-config-expo` (`eslint.config.js`). It gives warnings only, and there is no autofix pass.
- No formatter is configured.

## Commands

```
npm start          # expo start (dev server + QR)
npm run android    # expo start --android
npm run ios        # expo start --ios
npm run web        # expo start --web
npm test           # jest (pure-module unit tests)
npm run lint       # eslint . (must exit 0; warnings are the backlog)
npm run prerelease # expo-doctor && npm test
```

There is no `typecheck` script. The project is plain JavaScript (no TypeScript).

## Boot sequence (`App.js`)

`App.js` is a gate, not a router:

1. `initDatabase()` from `src/database/db.js` runs one time and sets a module-level `db` singleton.
2. `App.js` shows a spinner until the initialization is complete.
3. `App.js` renders `LockScreen` until the user enters or sets a PIN (`onUnlock` changes the state).
4. `AppNavigator` (the real stack) mounts only after the unlock.

Thus each screen can assume that the DB is ready. Screens still do the `if (!db) return` check after `getDb()` as a precaution. But a screen never mounts before `initDatabase()` resolves.

## Database (`src/database/db.js`)

The app has one `expo-sqlite` database (`journal.db`). A module-level singleton holds it, and code gets it through `getDb()`. `initDatabase()` runs `CREATE TABLE IF NOT EXISTS` for the full schema on each launch. There is **no migration system**. PRAGMA-guarded `ensure*` shim functions change the schema of existing tables. Each shim compares `PRAGMA table_info(...)` with the necessary columns and runs `ALTER TABLE … ADD COLUMN` for each missing column. `initDatabase()` sets WAL mode and `foreign_keys = ON`.

Tables:
- `entries`: title, content, date (YYYY-MM-DD string), bead_*, `highlight_tier`, created_at, updated_at. `highlight_tier` is 0/1/2 (none/weekly/monthly) and controls the `auto_week`/`auto_month` membership.
- `entry_photos` / `entry_voice_notes`: FK → entries, ON DELETE CASCADE. They store URIs.
- `scheduled_prompts`: local notification reminders (with the `acknowledged_at` shim and the `recurrence_kind`/`every`/`max`/`fired`/`anchor_day` recurrence shim). A recurring reminder is **one row** that advances. `scheduled_date`/`scheduled_time` always points at the next occurrence. There are no rows for individual occurrences.
- `threads`: name, anchor_*, `kind` (`'user' | 'auto_day' | 'auto_week' | 'auto_month'`), `collection_id` (vestigial).
- `thread_beads`: beads on a thread (live FK + frozen snapshot). The snapshot is immutable, with **one exception**: the global rewrite `reshapeBeadAcrossHistory` (S14 reshape), which only the user can start. It writes each matching snapshot again, frozen snapshots included. This is the only approved exception to "frozen means frozen" (see `beads-and-threads.md`).
- `entry_thread_links`: entry → thread cross-references (the "Mentions" section in the entry editor). The table name keeps "links" for legacy reasons. The user-facing term is "Mentions".
- `thread_collections`: named buckets for threads.
- `thread_collection_links`: many-to-many junction (`thread_id` × `collection_id`), composite PK, `ON DELETE CASCADE` on the two sides. This table is **authoritative**. The app does not read the legacy `threads.collection_id` column.
- `comments`: polymorphic comments (`parent_kind ∈ {entry, thread, reminder}`). There is no FK because the target table varies. `removeCommentsForParent` does the cleanup. The table has `remind_at` / `notification_id` / `reminded_at` for comment-reminders.

The database stores photos and voice notes as **URIs into the app-owned attachment store** (`documentDirectory/attachments/<vaultId>/photos|voice/`). Each capture path copies the cache file of the picker or recorder into the store through `services/mediaStore.js` (`persistMediaUri`). The copy occurs before the URI goes into the DB, because the OS and cleaner apps delete cache files. A startup pass (`rescueAndSweepMedia`, started from `App.js`) does two tasks:

- It migrates legacy cache URIs while the files are readable.
- It deletes store files that no row refers to and that are older than 24 h.

Delete paths must never touch files inline.

**Caution, datetime comparison for `comments.remind_at`:** the column holds JS ISO strings (`'2026-…T…Z'`). The `datetime('now')` function of SQLite returns the space-separated form (`'YYYY-MM-DD HH:MM:SS'`). A string comparison fails because `'T'` sorts after `' '`. Each clause of the type `WHERE remind_at <= datetime('now')` must wrap **both** sides in `datetime(...)`.

## Services layer (`src/services/`)

This layer contains the read helpers and write helpers for tables that have invariants. Screens must not run inline SQL against these tables. Go through the service so that the invariants stay in one place.

- `mediaStore.js`: ownership of the attachment bytes.
  - `persistMediaUri`/`persistMediaUris` copy each captured or picked media file out of the cache into `documentDirectory/attachments/<vaultId>/`. The OS can clean the cache. The copy occurs before the URI is written to the DB.
  - `rescueAndSweepMedia()` is the boot pass. `App.js` starts it and does not await it. It migrates legacy cache URIs and deletes store files that no row refers to (24 h age gate).
  - Delete paths never remove files inline. The sweep is the single cleanup point.
- `attachments.js`: `loadAttachmentsForEntries(entryIds)`, the batched fetch of photos and voice notes for list surfaces (home list, day view).
  - It runs two `WHERE entry_id IN (…)` queries in total, not two for each entry.
  - It uses `ORDER BY id`, so the attachment sequence of each entry agrees with the array-order rewrites of the editor.
  - Single-entry loads (the editor) stay per-entry.
- `comments.js`: polymorphic comments + comment-reminders. It owns:
  - the `(parent_kind, parent_id)` lookup contract
  - the `datetime(...)` wrapping pattern
  - the cascade on parent delete (`removeCommentsForParent`)
  - the cancel of the OS notification on delete

  Each screen that shows comments uses it (entry editor, thread detail, reminder drawer, home banner stack, calendar reminder panel).
- `collections.js`: the thread ↔ collection junction. `loadCollectionsForThread`, `loadThreadCollectionIdSet`, `addThreadToCollection`, `removeThreadFromCollection`, `createCollectionAndAssignThread`, `countThreadsInCollection`, `deleteCollection`. It never touches the legacy `threads.collection_id`.
- `autoThread.js`: the N11 + N20 auto-threads (day always; week if `highlight_tier ≥ 1`; month if `highlight_tier ≥ 2`).
  - It owns the partial-unique-index invariants (one auto-thread for each `(kind, anchor_date)`), the generation of the placeholder-bead snapshot and the prune-on-empty rule.
  - It owns the chronological position encoding (`YYYYMMDD × 1e8 + minuteOfDay × 1e4 + (id mod 1e4)`). Chains sort by entry date, then by the optional time of day of the entry (`entries.time`, or else the clock time of its `created_at`), then by id for a stable sequence.
  - `resyncAutoThreadTimeOrderIfNeeded()` is the upgrade pass that runs one time. It writes the position of each existing bead again in this encoding. The old `YYYYMMDD × 1e6 + id` scheme had no time field, so positions from the two schemes together would give an incorrect `ORDER BY position`.
  - `promoteAutoWeekToMonth(threadId)` changes each tier-1 entry on a week thread to tier 2 in one operation. This is the end-of-week curation gesture that `ThreadDetailScreen` shows.
  - All `auto_*` kinds are read-only in `ThreadDetailScreen` (no composer, no delete, no quick-add FAB).
- `recurrence.js`: pure date math for recurring reminders: `addRecurrence`, `nextOccurrence`, `advanceSeries` (catchup-and-advance), `computeMissedCount`, `formatRule`, `formatProgress`, `anchorDayFor`, `resolveAnchorDay`.
  - Month addition and year addition clamp the day from the **anchor day** of the series (`scheduled_prompts.recurrence_anchor_day`), not from the previous occurrence. "Every month on the 31st" gives Feb 28 and then returns to Mar 31.
  - Each caller that steps a series must pass the anchor. The reminder form sets it through `resolveAnchorDay`.
- `reminders.js`: ack-and-advance writes for `scheduled_prompts`.
  - `acknowledgeReminder(id)` is the single entry point. `HomeScreen` and `EntryEditorScreen` use it.
  - Never write `acknowledged_at` or `recurrence_fired` directly from a screen.
  - It also owns `setReminderActive` (stop/resume) and `loadRecurringSeries`.
- `beadPresets.js`: the named-bead-preset (S14) layer and the **reshape-across-history** query-replace.
  - `listBeadPresets`/`createBeadPreset`/`deleteBeadPreset`/`touchBeadPreset` manage the vocabulary.
  - `countEntriesWithBead(from)` supplies the count for the confirm dialog. `reshapeBeadAcrossHistory({presetId,name,from,to,rewritePast})` does the rewrite.
  - Beads are stored **by value, not by `preset_id`**. Identity is facet-equality, so reshape is a `query-replace`, not an FK model.
  - `rewritePast` changes the entries **and** all matching `thread_beads` snapshots in **one transaction**. Frozen snapshots are included: this is the one approved exception. A future-only reshape changes only the preset row.
  - There is no `autoThread` re-sync. The live-bead render preference already moves live chains. Membership and position do not change when only a facet changes.
  - The rewrite is irreversible by design.

## Entry save semantics (`EntryEditorScreen.js`)

The editor **auto-saves**. There is no Save button. A `useEffect` monitors `[title, content, date, photos, recordings, bead, highlightTier, linkedThreads, loaded]`. A 1s debounce in this effect calls `save()` after the user stops the edit. The key invariants are:

- A `loaded` flag guards the effect. The flag is false for an existing entry until `loadEntry()` is complete. It is immediately true for a new entry. Saves never fire before the initial state is in place.
- `loadEntry()` sets `skipNextSaveRef` to `true` immediately before its batched setters. Thus the effect run that those setters cause is skipped. Without this, the editor would save an existing entry again as soon as it opens, and would rewrite the photo and voice attachments.
- `entryIdRef` holds the row id. The first save inserts: it sets `entryIdRef.current` from `lastInsertRowId` and sets `hasSaved`. Subsequent saves update.
- `savingRef` + `queuedRef` serialize concurrent saves. If a save is in progress, the next save is queued and runs when the first one is complete. This is necessary because the user types while writes occur.
- The cleanup of a mount-only `useEffect` starts a final save. Thus the data persists when the user goes back inside the debounce window.

On update, the screen does `DELETE FROM entry_photos/entry_voice_notes WHERE entry_id = ?` and then inserts the full current arrays again. This is a wholesale rewrite, not a diff for each attachment. Keep this pattern when you extend the editor.

Since v0.75.1 these rules apply to the write. Keep all of them:

- The full write (row + attachments + links) runs in **one `withTransactionAsync`**.
- `entryIdRef`/`hasSaved` are set only **after** the commit. A rollback must never leave the ref pointing at a row that was not persisted.
- The `syncAutoBeadForEntry` call stays **outside** that transaction. It opens its own transaction, and expo-sqlite transactions do not nest.

**Draft title fallback:** if the title input is empty at save time, the editor writes the title `Draft <YYYYMMDDHHMMSS>` to the DB. The timestamp comes from `creationTimeRef`. For an existing entry, this is `entry.created_at` parsed as UTC. For a new entry, it is the `new Date()` captured at mount. This keeps the draft title stable across subsequent saves of the same entry. The DB never holds an empty title after the first save of the entry.

The Delete button renders only when `hasSaved` is true (that is, the entry was written to the DB at least one time). If the user cancels before the first auto-save fires, no row stays in the DB. `save()` does nothing when title, content, photos and recordings are all empty.

**Undo/redo (S15):** a session-only history tree for title + content (`services/editHistory.js`). It is in RAM only and is never persisted. The invariants are in `docs/architecture/editor-autosave.md` §14. In summary:

- **Capture.** A second debounced effect captures the history on the same 1s pause as auto-save. `historySkipRef` guards it (the `skipNextSaveRef` pattern). `loadEntry` sets the two refs. An undo/redo apply sets only the history ref, so the restored text still auto-saves.
- **Accessory bar.** The UI is a keyboard accessory bar (undo · redo · tree · dismiss). It exists only while a text field has the keyboard up.
- **Tree sheet.** The tree icon opens `components/EditHistorySheet.js`, the vundo-style half-height sheet. The buffer above the sheet previews the tapped state (tap again to restore).
- **Preview freeze.** `historyPreviewRef` freezes `save()` for the full preview window. Thus a pending debounce can never persist a previewed state. The ref is set only inside the deferred open. The unmount cleanup removes the freeze and flushes the pre-open snapshot.
- **Open sequence.** The sheet opens through `dismissKeyboardThen` (`hooks/useKeyboardHeight.js`) and passes `statusBarTranslucent`. An Android Modal created in the same tick as `Keyboard.dismiss()` can get its size from a transient, incorrect inset and appear below the screen (v0.88.4; the rule is in `navigation-and-shell.md §Edge-to-edge`).
- **Nodes.** History nodes are **not** beads. They have no facets. They are plain circles and do not use `src/beads/svg.js`.
- **`ThreadDetailScreen`** mirrors the whole wiring for thread name + description, with two differences. It seeds the history lazily in the capture effect, never in `load()`, which runs again on focus. It has no preview-freeze ref, because its save timer closes over the values at schedule time.

## Navigation (`src/navigation/AppNavigator.js`)

The app uses a stack navigator with `Home`, `EntryEditor`, `Day`, `ThreadComposer`, `ThreadDetail`. On each `focus` event, `HomeScreen` runs `loadEntries()` / `loadEntryCounts()` / `loadAnchoredThreads()` / `loadReminders()` / `refreshFiredCommentReminders()` again. Thus edits made on other screens show immediately when the user returns. There is no global state library.

## List view chrome and gestures

- **Time bands.** `HomeScreen` uses a `SectionList` for time-banded entries (Today / Yesterday / Earlier this week / Earlier this month / [Month YYYY]). The bands are computed at render. They are not in the schema. The banding logic is in `src/utils/timeBands.js` (`groupIntoBands` / `groupIntoAlphaBands` / `isoDateFromSqlDatetime`).
- **Shared with `ThreadsList`.** `ThreadsList` is also a `SectionList` and **shares the banding logic**. User threads band by recency or by first letter, as the sort toggle sets. Auto kinds are one section with no label.
- **Keep the two lists visually the same.** This is intentional (search bar, lens toggles, band headers, comment chip, card metrics). Edit the shared util or the shared style intent. Do not make a per-screen difference. The one intentional exception: `ThreadCard` has **no** per-row date, because a thread does not belong to one calendar day as an entry does. `EntryCard` keeps its date.
- **`tick` state.** A precise-timer `setTimeout` increments `tick` at the moment of the next pending reminder. Thus the fired-banner derivation runs again without polling.
- **Chain previews.** `ThreadsList` does **not** fetch bead-chain previews in its list query. Each card loads its own chain lazily on mount through `ensurePreview` (per-screen `previewCacheRef`, cleared on focus). The card renders the chain with the low-cost `ChainPreview`:
  - 6 box shapes as Views with the exact geometry of BeadView
  - decagon and flower delegate to BeadView with pattern solid
  - golden connector Views
  - glyph Text
  - no patterns and no elbows

  `ThreadCard` is wrapped in `React.memo`.
- **Search.** The two lists debounce search by approximately 250 ms.
- **Caution:** Do not add a per-row query to `loadThreads`/`loadEntries`.
- `HomeScreen` and `ThreadsList` wrap rows in `Swipeable` (from `react-native-gesture-handler`):
  - Swipe-left → shows a red Delete (entries only). `onSwipeableOpen('right')` shows an `Alert.alert` confirm. The action is destructive, so the friction is intentional.
  - Swipe-right → shows a primary-colored Comment. `onSwipeableOpen('left')` opens the comments drawer immediately. The gesture *is* the commit, and there is no confirmation.
- **Long-press an entry row** to enter multi-select mode with that entry already checked (`HomeScreen.handleLongPressEntry` → `enterSelectMode([entry.id], 'entry')`). Tap more rows to add them to the selection. The select-mode header shows the batch chrome (Fuse / Thread-batch / Delete).
- **Long-press a thread card** to do the same on the threads side (`HomeScreen.handleLongPressThread` → `enterSelectMode([thread.id], 'thread')`). The header chrome there is **Add-to-collection / Delete**. There is no Fuse, because Fuse applies only to notes.
- **Selection state.** The two views share the selection state: `selectMode` + `selectionContext` + one `selectedIds` Set in HomeScreen. Thus the same header changes with the context and does not flicker.
- **Collections.** The single-thread "edit my collections" path stays on `ThreadDetailScreen` (tap the *Collection: …* metadata line → `CollectionPickerSheet`). The *Add-to-collection* action of the multi-select header assigns N threads to **one** collection on each tap (`BatchCollectionPicker` → loops `addThreadToCollection`).
- **Auto-threads in a selection.** Delete skips them with no message. They are derived state, and `pruneEmptyAutoThreads` removes them.
- **Caution, `ListHeaderComponent`:** the `ListHeaderComponent` of `FlatList` accepts a function whose identity changes on each parent render. A TextInput inside it then mounts again on each keystroke, and the keyboard closes. If a TextInput must be above a list, render it as a sibling and give the list `flex: 1`. (`ThreadsList` does this. Its search bar is *not* a list header.)

## Auth (`src/utils/auth.js`)

PINs are **per vault**. They are in `expo-secure-store` under `journal_pin_<vaultId>` (`pinKeyForVault`, `utils/vaults.js`).

**Record format.** A PIN is a salted, iterated SHA-256 record `v2$<saltHex>$<hashHex>`, with a 16-byte salt and 100 rounds of the `digest` function of `expo-crypto`. The format, the rationale and the pure logic are in `utils/pinHash.js`. The tests are in `utils/__tests__/pinHash.test.js`. Each `digest` is a native call that costs approximately 0.2 ms on Android, so the user waits for the rounds on the unlock tap. The 5000 rounds of v1 took almost one second on a mid-range test phone.

**Older records.** These rules apply:

- An older version (`v1$`) or a legacy plain-text value (no known `vN$` prefix) still verifies. On the first match, the app stores it again in the current format.
- A change of the round count is always a new prefix, never an edit.
- `upgradeLegacyPinRecords()` (started from the `LockScreen` mount) hashes the legacy value of each vault in place.
- The pre-vault `journal_app_pin` copy is purged.
- Each write goes through `setPin`. Never write the pin key directly.

**Backoff:** `attemptPin` (the lock screen and the verify step of Change PIN) keeps a per-vault `{failures, lockedUntil}` record under `journal_pin_<vaultId>_attempts`.

- The first 4 misses have no wait. Each subsequent miss gives a wait that starts at 30 s and doubles, to a maximum of 15 min. A success resets the record.
- The app records the failure *before* the check, so the user cannot avoid it by killing the app.
- The wall-clock deadline stays across restarts. It is clamped if the clock goes backwards. If the user moves the clock forward, the wait is skipped.
- The countdown shows in the existing error slot, and the keypad is disabled (`hooks/usePinLockout.js`).

**Limits.** With 10 000 possible PINs, the hash cannot stop an offline brute-force attack. The backoff and the Keystore-backed store are the real controls. There is still no biometric fallback. The lock gates only the in-app UI. It does not encrypt the SQLite file or the attachments.

**Auto-lock.** `App.js` owns the lock gate (`isUnlocked`). It supplies `lock()` and the **auto-lock** preference through `LockContext`.

- The setting is `Settings → Vault → Auto-lock`. The preference is in `preferences.js` as `vakana_autolock`. It is global, not per-vault. The default is Off.
- Auto-lock engages the lock again when the app returns to the foreground after a time in the `background` that is longer than the selected grace (Off / Immediately / 1 / 5 / 15 min).
- The `AppState` listener uses the definitive `background` state, **not** the transient iOS `inactive` state. Thus the control center, a call or a look at the app switcher never causes a false lock.
- Auto-lock only shows `LockScreen` again. The same no-encryption limit applies. The OS captures the app-switcher snapshot before the lock, and the snapshot is not masked.

## Notifications (`src/utils/notifications.js`)

The module wraps `expo-notifications` in try/catch with a `notificationsAvailable` flag. Expo Go on Android does not support push notifications or scheduled notifications since SDK 53. In that environment the module does nothing and gives no error. To test reminders, use a development build, not Expo Go.

- **Trigger form.** Triggers use the **explicit object form** (`{ type: SchedulableTriggerInputTypes.DATE, date }`). SDK 52 made this form mandatory. A raw `Date` throws. A silent catch around that throw is the reason why notifications did not operate for months, until v0.86.1. The catches now call `console.warn`.
- **Rehydrate passes.** The two rehydrate passes (`rehydrateScheduledNotifications` / `rehydrateCommentReminderNotifications`) run on **each** boot. They are idempotent through `getScheduledNotificationIds()`. Do not add the vault-epoch gate again. The live-id check is what now prevents a double schedule.
- **Upgrades.** On each `expo-notifications` upgrade, verify the trigger shape again (`docs/architecture/reminders.md §SDK-version sensitivity`).
- **Taps.** A tap deep-links through a `data` payload. HomeScreen consumes the payload after unlock (`utils/notificationRouting.js`) through the banner handlers. A tap never acknowledges (N15).
- **Icon.** The Android small icon is the white bead glyph, set through the config plugin (`reminders.md §Notification tap`).

## Theming (`src/theme.js`)

One `ThemeProvider` wraps the full app (in `App.js`). It supplies `useTheme()`, which returns `{ colors, mode, resolved, setMode }`:

- `mode` is the preference of the user: `'system' | 'light' | 'dark'`. It is persisted in `expo-secure-store` under `journal_theme_mode`.
- `resolved` is the scheme that is applied. When `mode === 'system'`, it follows `useColorScheme()`. If not, it is equal to `mode`.
- `colors` is the palette object for the resolved scheme. It is a flat map (`background`, `surface`, `surfaceMuted`, `text`, `textMuted`, `textFaint`, `primary`, `primaryOnPrimary`, `border`, `borderStrong`, `danger`, `dangerSoft`, `placeholder`).

The palette is "cappuccino" (warm cream / espresso). The light variant and the dark variant are in `palettes` inside `theme.js`.

**Component pattern:** each screen and component builds its `StyleSheet` through a `makeStyles(colors)` factory and memoizes it with `useMemo(() => makeStyles(colors), [colors])`. Do not put hex colors into a top-level `StyleSheet.create`. Such colors do not change with the theme.

`AppNavigator.js` builds the React Navigation theme again from `colors` each time they change. In v7, the `NavigationContainer` theme **must include `fonts`**. The code spreads from `DarkTheme`/`DefaultTheme` to get the default fonts. Without them, the app crashed with `Cannot read property 'regular' of undefined`.

The mode picker is one header icon on `HomeScreen`. It cycles `system → light → dark → system`. The icon shows the current mode (`phone-portrait-outline` / `sunny-outline` / `moon-outline`).
