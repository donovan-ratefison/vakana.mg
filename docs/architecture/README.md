# Vakana: Architecture Notes

This set is the developer reference for the subsystems that you must understand
before you change them. The README and `overview.md` describe the surface. This
set describes the details that are easy to get wrong.

## Audience

The reader cloned the repository and read the README. The reader now plans a
change that is not trivial, to one of these areas:

- the editor
- the data layer
- the bead and thread machinery
- the reminders flow
- the navigation and lock shell
- the theme

The docs explain why each part has its shape, which invariants must hold, and
where to look in the source.

## Reading order

1. **`navigation-and-shell.md`**: the boot sequence, the PIN gate, the
   LockContext escape hatch, the stack screens, and how the navigation theme is
   rebuilt. Read it first if you change `App.js`, `AppNavigator.js`, or
   `LockScreen.js`.

2. **`theming.md`**: `ThemeProvider`, `useTheme`, the `makeStyles(colors)`
   pattern that every screen follows, the palette shape, and mode persistence.
   Read it before you add a screen or a component. The styling pattern is
   mandatory, because the theme does not update the UI without it.

3. **`data-layer.md`**: the `expo-sqlite` singleton and every table (entries,
   threads, thread_beads, entry_thread_links, scheduled_prompts, comments,
   thread_collections, thread_collection_links). It also covers the
   PRAGMA-guarded `ALTER TABLE` shims, the services layer, attachments-as-URI,
   and the wholesale-rewrite update pattern. You must read it before you change
   the schema or add a query.

4. **`editor-autosave.md`**: `EntryEditorScreen` line by line. It covers the
   autosave effect, the guard that loads an entry and does not save it again,
   save serialization, draft titles, and reminder acknowledgement. This file
   has more invariants than any other file in the app.

5. **`beads-and-threads.md`**: the bead vocabulary and the `BeadView` /
   `BeadChain` / `ThreadLine` / `ThreadCap` rendering chain. It also covers the
   live-save plumbing of `BeadComposer` and the dual representation (live and
   snapshot) in `thread_beads`. It explains the difference between
   *add-to-thread* and *link-a-thread*, which users frequently confuse.

6. **`reminders.md`**: `scheduled_prompts`, the in-calendar UX, the persistent
   banner with its precise `setTimeout`, and the acknowledge-on-content-fill
   flow. It also explains why defensive code wraps `expo-notifications` (Expo
   Go SDK 53+ on Android).

## Export contracts

Each export format has one authoritative contract doc. The contract gives the
disposition of every primitive (mapped, or an explicit non-goal), the zip
layout, and the reason why the export is a lineage and not a dump. These
formats shipped. The contract stays the source of truth. Keep it in sync with
the code.

- **`org-export.md`**: the export of a thread as an Org-mode `.zip` (the Emacs
  bridge). It contains the complete mapping of every primitive to Org, the
  property schema, the Markdown→Org transform, and the zip layout. It also
  contains the explicit non-goals: the export is one-way, with no transport and
  no sync. Shipped v0.28.0.
- **`slide-export.md`**: the export of a thread as a slide deck `.zip` that the
  reader can walk through (the Memory-Palace pillar). The bead chain is the
  clickable spine. Sections are chapter dividers. Comments are speaker notes
  that only the presenter sees. The mood is the accent color. The export is
  one-way and terminal, with no options and no editability. Shipped v0.31.0.

## Import contracts

There is one inbound bridge. Its doc follows the same contract rules as the
export docs. It gives the disposition of every primitive, the parsing ladders,
the idempotency strategy, and the non-goal (one-way in).

- **`note-import.md`**: the import of a plain-text note from outside the device
  (`.org`/`.md`/`.txt`, from a synced folder or a URL that the user supplies).
  The note becomes an *uncurated draft entry*. The import is the deliberate
  **inverse of `org-export.md`**: it reads the `org-datetree ⇄ auto-thread`
  mapping backwards. The import is one-way *in*, with no sync, no round-trip,
  no transport and no server. In v1, the import captures a draft, and curation
  stays on the phone. Shipped v0.42.0. The doc is the authoritative as-built
  contract.

## Before you call a change done

**`change-checklist.md`** is an index of pointers. Run it before you call a
change done. Read only the groups that match what you changed (editor /
comments / schema / auto-threads / reminders / export / new screen). Also read
the two groups that always apply (identity gut-check, release ritual). The
checklist does not repeat content. It points to the gotchas below, the
subsystem docs, and `overview.md`. There is no test runner, so this checklist
is the control that compensates.

## Common gotchas

If you break one of these invariants, the app can silently corrupt user data
or crash.

- **Do not mount a screen before `initDatabase()` resolves.** Every screen
  calls `getDb()` and assumes that the singleton is not null. The `App.js` gate
  enforces this. Do not bypass the gate.
- **`StyleSheet.create({...colors.text...})` at module scope is a bug.** The
  hex codes do not render again when the theme changes. Always use
  `makeStyles(colors)` with `useMemo`.
- **The `theme` prop of `NavigationContainer` must spread from
  `DefaultTheme`/`DarkTheme`.** v7 requires `theme.fonts`. A theme built from
  scratch caused `Cannot read property 'regular' of undefined`
  (`AppNavigator.js:16-31`).
- **Put hooks before early returns in `App.js`.** Every hook (`useState`/
  `useEffect`/`useTheme`/`useMemo(lockValue)`) must run unconditionally. A
  `useFonts` hook broke the Rules of Hooks one time. The Caveat load is now
  imperative code in `prepare()`, not a hook. The rule still applies to the
  other hooks.
- **The dependency array of the autosave effect must list every piece of state
  that the user can change.** If you omit one (for example `linkedThreads` or
  `bead`), edits to that field do not persist (`EntryEditorScreen.js:304`).
- **Set `skipNextSaveRef.current = true` immediately before the batched
  setters.** This applies to `loadEntry` and to each in-place state refresh
  (`refreshLinkedPreviews`). If you do not, the editor saves an existing entry
  again when it opens, and rewrites all child rows
  (`EntryEditorScreen.js:123, 175`).
- **There is no schema migration system.** Add a new column on an existing
  table through a `PRAGMA table_info` shim. See `ensureBeadColumns`,
  `ensureReminderColumns`, `ensureThreadKindColumn`, `ensureThreadCollections`
  and `ensureThreadCollectionLinks` in `db.js`. Add a new table in the
  `CREATE TABLE IF NOT EXISTS` block of `initDatabase`.
- **An index that depends on a shimmed column must be in the shim, not in the
  main schema block.** If it is in the main block, the index refers to a column
  that does not exist yet on a database from before the upgrade. For the
  pattern, see the `kind`-dependent indexes of `ensureThreadKindColumn`.
- **`comments.remind_at` is an ISO string, not a SQLite datetime.** Every
  comparison with `datetime('now')` must wrap **both** sides in
  `datetime(...)`. A lexical string comparison fails, because `'T'` (in the ISO
  form) sorts after `' '` (in the space-separated form of SQLite). This affects
  `loadFiredCommentReminders`, `loadPendingCommentReminders` and
  `acknowledgeFiredCommentRemindersForParent`.
- **The polymorphic `comments.parent_id` has no FK.** App code does the cleanup
  when a parent is deleted, through `removeCommentsForParent` from
  `services/comments.js`. Every delete path for a parent
  (`HomeScreen.handleDeleteEntry`, `ThreadDetailScreen.handleDelete`,
  `HomeScreen.handleDeleteReminder`) must call it before `DELETE FROM …`.
- **An attachment URI must point into the app-owned store, never into the
  cache.** Every capture path goes through `services/mediaStore.js`
  (`persistMediaUri`). This function copies the picker or recorder output into
  `documentDirectory/attachments/<vaultId>/` before the URI goes into the DB.
  The OS and cleaner apps delete URIs that are in the cache (the v0.78.1 Xiaomi
  incident). Only the startup sweep in `rescueAndSweepMedia()` deletes files.
  Delete paths must not touch files (`data-layer.md §Attachments-as-URI`).
- **`Notifications.scheduleNotificationAsync({ trigger: <Date> })`** uses the
  legacy trigger shape. Newer SDKs require `{ type: 'date', date: ... }`. Check
  this on every upgrade of `expo-notifications` (`notifications.js:50`).
- **Expo Go on Android (SDK 53+) silently drops scheduled notifications.** The
  in-app banner compensates with a precise `setTimeout`. Do not remove the
  banner unless you can test with a real development build.
- **Edge-to-edge is different from Expo Go. UI that is correct in Expo Go can
  break only in a standalone build.** `react-native-edge-to-edge` makes the
  activity *and* the Modal windows cover the full physical screen. The Expo Go
  host does not do this, so the difference shows only in a real build. Two
  confirmed failures occurred in v0.32.0:
  1. Android `adjustResize` has no effect. A `Modal` bottom sheet with a
     `TextInput` must use `useKeyboardHeight` and a manual `paddingBottom`. If
     it does not, the IME covers the content of the sheet
     (`hooks/useKeyboardHeight.js`, `BeadPickerModal.js`).
  2. `measureInWindow` reports Y in *content* space (the origin is below the
     status bar). An edge-to-edge `Modal` renders from the physical top. Thus a
     popover anchored with `measureInWindow` appears too high by exactly one
     status-bar height. On Android, add `StatusBar.currentHeight` to the anchor
     `top` (`HomeScreen.js` ⋮ overflow menu).

  **Test every Modal, every anchored popover and every sheet with a keyboard on
  a standalone build. Do not rely on Expo Go alone.**
