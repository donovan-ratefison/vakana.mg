# Change Checklist

Do this checklist before you call a change **done**. Do not do it while you design the change.

**This file is an index, not a source of truth.** Each line is a *trigger phrase and a pointer* to the location of the real invariant. The locations are `architecture/README.md §Common gotchas`, the subsystem docs, `overview.md`, or `file.js:line`.

- If a detail of an invariant changes, correct it at the pointer. **Never write the detail again here.**
- This doc changes only when a *subsystem* is added, not when an invariant moves.
- Jest covers only the pure date, history and markdown modules (`npm test`). All code with I/O or UI has no tests. Thus this list is the control that compensates.
- The only function of this list is to make you read the correct 3–5 lines again when you have little time.

Read **only the groups you touched**. Then read the two groups at the end, which always apply.

---

### If you touched the editor (`EntryEditorScreen.js`)

- [ ] The dep array of the autosave effect lists **every** user-mutable state. A state that is not in the array never persists. Pointer: `README §Common gotchas`, `EntryEditorScreen.js:304`
- [ ] `skipNextSaveRef.current = true` is set **immediately before** the batched setters in `loadEntry` *and* before each in-place refresh (`refreshLinkedPreviews`). Pointer: `EntryEditorScreen.js:123,175`
- [ ] The draft-title fallback is still stable across saves of the same entry. Pointer: `overview.md §Entry save semantics`
- [ ] The photo/voice update is still the wholesale `DELETE … then re-insert`, not a diff for each attachment. Pointer: `overview.md §Entry save semantics`
- [ ] The Delete button still renders only when `hasSaved` is true. The final save still runs from the mount-only cleanup.
- [ ] The undo/redo history capture stays a **parallel** effect with its own `historySkipRef`. An undo/redo apply must NOT set `skipNextSaveRef`, because the restored text must auto-save. The uncaptured-tail rule is intact. Pointer: `editor-autosave.md §14`
- [ ] The history-sheet preview keeps `save()` frozen through `historyPreviewRef` for the full preview window. Restore and close start the save path themselves. The revert branch never calls `saveRef.current()` after its setters. Pointer: `editor-autosave.md §14`
- [ ] The history sheet opens through `dismissKeyboardThen`, never through `Keyboard.dismiss()` + `setVisible(true)` in one tick. The freeze is set inside that deferred callback. The unmount cleanup still cancels the pending open and flushes the pre-open snapshot through `save({ override })`. Pointer: `editor-autosave.md §14`

### If you touched comments (`services/comments.js`)

- [ ] Every comparison of `remind_at` with `datetime('now')` wraps **both** sides in `datetime(...)`. Pointer: `README §Common gotchas`
- [ ] Every parent-delete path (entry / thread / reminder) calls `removeCommentsForParent` **before** `DELETE FROM …`. Pointer: `README §Common gotchas`
- [ ] The delete of a comment-reminder cancels the OS notification. Pointer: `overview.md §Services layer`

### If you touched the schema (`db.js`)

- [ ] A new column on an existing table goes through a `PRAGMA table_info` `ensure*` shim, **not** the main `CREATE TABLE` block. Pointer: `README §Common gotchas`
- [ ] An index that depends on a shimmed column is **in the shim**, not in the main schema block. Pointer: `README §Common gotchas`
- [ ] Writes to tables with invariants go through `services/`, not through inline screen SQL. Pointer: `overview.md §Services layer`

### If you touched auto-threads (`services/autoThread.js`)

- [ ] There is still one auto-thread for each `(kind, anchor_date)` (the partial-unique-index invariant). Pointer: `overview.md §Services layer`
- [ ] Prune-on-empty, the placeholder-bead snapshot, and the `YYYYMMDD×1e8 + minuteOfDay×1e4 + (id mod 1e4)` order are still correct. A change to the encoding needs a one-shot position re-stamp (`resyncAutoThreadTimeOrderIfNeeded`), so that the old and new schemes never mix. Pointer: `beads-and-threads.md`
- [ ] The `auto_*` kinds stay read-only in `ThreadDetailScreen` (no composer, no delete, no quick-add FAB).

### If you touched reminders (`services/reminders.js`, `scheduled_prompts`)

- [ ] `acknowledgeReminder()` is still the **only** writer of `acknowledged_at` / `recurrence_fired`. A screen never writes them. Pointer: `overview.md §Services layer`
- [ ] A recurring reminder is still **one advancing row** (no per-occurrence rows).
- [ ] On each `expo-notifications` version change, verify the `trigger` shape again. The shape is the object form with `type`. A raw Date throws (the v0.86.1 outage). Keep the in-app `setTimeout` banner, because Expo Go on Android SDK 53+ does not deliver scheduled notifications. Pointer: `reminders.md §SDK-version sensitivity`
- [ ] The rehydrate passes still run on **every boot and are idempotent** (the `getScheduledNotificationIds` live-id check). Never add the `vaultEpoch > 0` gate again. Pointer: `reminders.md §Boot rehydrate`
- [ ] The notification catches stay `console.warn`, never silent. Logcat is the only regression signal of this module.
- [ ] Every schedule call carries the tap payload (`{kind, …id}`). Taps go through the banner handlers and **never acknowledge** (N15). Pointer: `reminders.md §Notification tap`
- [ ] `loadReminders` / `refreshFiredCommentReminders` keep their **stale-request guards** (`loadRemindersReqRef` / `refreshFiredReqRef`). The secondary loads of the focus listener race the user acks. An in-flight read without a guard brings acked banners back (v0.88.3; the same class as `loadEntriesReqRef`).

### If you touched export (Org / slide / HTML / PDF / Markdown)

- [ ] Beads still render through the **single** `src/beads/svg.js`. There is no second renderer.
- [ ] The export is still one-way (no transport, no sync). The contract doc (`org-export.md` / `slide-export.md`) agrees with the code.
- [ ] The PDF photo budget in `buildPhotoBase64Map` is still aggressive (Android Print has a limit of ~2 MB for inline HTML).

### If you touched note import (`services/noteImport.js`, `import_ledger`)

- [ ] Imported entries use the **editor insert path** (Draft-title floor, `YYYY-MM-DD` date string, timestamps). Never write a separate INSERT by hand. Pointer: `overview.md §Entry save semantics`, `note-import.md §2`
- [ ] The import writes **no bead** and starts **no auto-thread** create or sync. An imported entry without a bead stays out of every chain. Pointer: `note-import.md §8`, `overview.md §Services layer`
- [ ] **One-way only**: the import does not write back to the source and does not merge. A re-import is a hash **skip**, not a patch. Pointer: `note-import.md §1, §4.3`
- [ ] Ledger reads and writes go through `services/noteImport.js`, never through inline screen SQL. `import_ledger` is a **new table in the CREATE block**, not a column shim. Pointer: `README §Common gotchas`, `note-import.md §7`
- [ ] The Org **datetree reader stays the exact inverse** of the datetree writer in `orgExport.js`. If you change one, change the other. Pointer: `org-export.md §5`, `note-import.md §3.3`
- [ ] The import uses a SAF directory **read** only. Never use the retired large-file SAF flat-write.
- [ ] The URL `fetch()` stays the **only** network call. It is in `noteImport.js` only. A timeout and a size cap limit it. It is host-agnostic (no fixed host, no telemetry). Pointer: `note-import.md §2, §4.2`

### If you touched the Home header subtitle (`HomeScreen`: `VIEW_TITLE` / `subtitleFor`)

- [ ] **The density rules are correct**: the leading-number form (`15 Beads of life`), the singular at `n === 1` (`1 Bead of life`), and **no number at zero** (`Beads of life`, not `0 Beads of life`). Pointer: `navigation-and-shell.md §Home header: the substrate-phrase density readout`
- [ ] **The list count is `entries.length`. The threads count is lifted through `onCountChange`.** Do not add a second `loadEntries` for the header. Do not read the local state of ThreadsList outside the prop contract.
- [ ] **The calendar subtitle stays static.** `Book of days` does not take a leading number, and the calendar does not respond to filters in the same way.

### If you touched the entry-list search/filter row (`HomeScreen`)

- [ ] **The three-position contract is intact.** The scope-pill is *above* the input (captured filter state). The text input is *in* the bar (content search; inside the pinned scope when a pill is pinned). The suggestion strip is *below* (transient, driven by the prefix). Pointer: `beads-and-threads.md §Entry-list filter chrome`
- [ ] **The pill and the suggestion strip never show together.** `visibleHomePresets` returns `[]` when `homeAppliedPresetId != null`.
- [ ] **The pill owns its lifecycle.** Only `×`, a facet divergence, or a preset deletion detach it. A change of the search text does **not**.
- [ ] **The pill claims a name only on an exact preset match.** A divergence removes the name claim but keeps the facets.
- [ ] **The pill chrome uses the `presetChip` + `presetChipSelected` geometry.** This keeps the chip sizes from v0.55.0 (`minHeight: 34`, `includeFontPadding: false`, `lineHeight: 18`). Do not add a parallel chip style.
- [ ] **`clearFilters` resets `homeAppliedPresetId`.** Thus *Clear all* in the Filters sheet stays in sync with the pill.
- [ ] **Thread-pin and bead-pin stay mutex.** A pin of one clears the other. On the bead-pin side, it also clears the four facet arrays and the search text. Only one captured scope renders at a time. Pointer: `beads-and-threads.md §Thread-pin`
- [ ] **`route.params.pinThreadId` is one-shot for each `pinNonce`.**
  - The caller sets `pinNonce: Date.now()` on each tap.
  - The consumer effect checks `lastConsumedPinNonceRef`. If the same nonce comes back on a focus return, the effect knows that the nonce is consumed and skips it.
  - Do NOT go back to a clear with `setParams({pinThreadId: undefined})`. It is not reliable across a stack pop in React Navigation v7 (see v0.63.1 in CHANGELOG).
- [ ] **The thread-pin detaches automatically if the thread is deleted.** `loadPinnedThread` runs on an id change *and* from the focus listener. If the row is missing, the pin is removed.
- [ ] **`loadEntries` reads `homePinnedThreadId` through `homePinnedThreadIdRef.current`, not through a closure.**
  - The reason is the React 19/Hermes single-dep-flip quirk. v0.63.1 documented it for the focus listener, and v0.63.2 found it on the entries-load effect. With the ref, the quirk cannot leave the entries scope stale when only the pin changes.
  - `homePinnedThreadId` is deliberately NOT in the useCallback deps of `loadEntries`.
  - The dep-driven effect at `~881` keeps `homePinnedThreadId` in its trigger list as a second protection.
  - The × handler of the thread-pill does three steps: (1) `setHomePinnedThreadId(null)`, (2) `homePinnedThreadIdRef.current = null` synchronously in the same handler, (3) `loadEntries()` directly.
  - The ref read makes the dismissal atomic. There is no timing window.
  - Do NOT add `homePinnedThreadId` to the useCallback deps of `loadEntries` again. Do NOT replace the ref read with a closure variable (see v0.63.2 in CHANGELOG).
- [ ] **The lens booleans of the Filters sheet also read through `lensRef.current`.**
  - The booleans are `unwoven` / `mentionsOthers` / `hasPhoto` / `hasVoice`.
  - They are synced during render and read from the ref inside `loadEntries`.
  - They stay **out** of the useCallback deps of `loadEntries` and **in** the trigger list of the reload effect.
  - This is the same quirk and the same fix. `unwoven` shipped without the fix in v0.44.0 and silently never filtered until v0.80.0. Pointer: `beads-and-threads.md §Filters-sheet lens groups`
- [ ] **The Connection lenses stay mutex.** `Unwoven only` and `Mentions a thread` clear each other, because both together always give an empty list. The Capture lenses combine with a normal AND.
- [ ] **`activeFacetCount` counts groups, not lit lenses.** Connection counts one time and Capture counts one time. This agrees with the facets-not-values rule. A new lens joins the `||` of a group. It does not add a term.

### If you added a screen or component

- [ ] A `Modal` that can open while the keyboard is up (a sheet opened from a focused field) passes `statusBarTranslucent` + `navigationBarTranslucent` **and** opens through `dismissKeyboardThen`. An Android dialog created during the IME hide can get its size from a wrong inset and stay off-screen. Pointer: `navigation-and-shell.md §Edge-to-edge`, `hooks/useKeyboardHeight.js`

- [ ] `makeStyles(colors)` + `useMemo`, and **no** hex color at module scope. Pointer: `README §Common gotchas`, `theming.md`
- [ ] A new `NavigationContainer` theme spreads `DefaultTheme`/`DarkTheme` (it must carry `fonts`). Pointer: `README §Common gotchas`
- [ ] Hooks run unconditionally before early returns. Pointer: `README §Common gotchas`
- [ ] A `TextInput` above a list is a **sibling**, never a `ListHeaderComponent`. Pointer: `overview.md §List view chrome`
- [ ] State that other screens can change refreshes on `HomeScreen` focus. Pointer: `overview.md §Navigation`
- [ ] No screen can mount before `initDatabase()` resolves. A new attachment capture path sends its URIs through `persistMediaUri` before the DB write. File cleanup stays in the startup sweep only. Pointer: `README §Common gotchas`, `data-layer.md §Attachments-as-URI`
- [ ] Each `Modal`, anchored popover, or sheet with a keyboard is verified on a **standalone build**, not only on Expo Go. Edge-to-edge behaves differently from Expo Go: IME occlusion and the `measureInWindow` status-bar offset. Pointer: `README §Common gotchas`

---

### Any feature or doc: identity gut-check (always)

- [ ] The change keeps or strengthens the five foundations: three-layer model · bounded vocabulary · hand-tuned friction · calendar-as-backbone · true local-only (no accounts, telemetry, cloud or LLM)
- [ ] The change passes the swap test: replace "Vakana" with "Notes app". If the text is still correct, the change is too generic.
- [ ] There is no new persistent UI chrome for marginal value. Use the existing tap affordances first.

### Shipping a capability: release ritual (always, in order)

- [ ] `CHANGELOG.md` entry and version bump (keep `app.json` and the Android `versionCode` in sync)
- [ ] `npm run prerelease` (expo-doctor) gives no errors
- [ ] Doc sweep: terminology and layout in `user-guide.md` · `README.md` · `use-cases.md` · the affected `architecture/*.md`; Vakana-specific entries in **`possibilities.md`**
