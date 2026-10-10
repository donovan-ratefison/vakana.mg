# Editor autosave

`src/screens/EntryEditorScreen.js` has more invariants than any other file in the
codebase. The editor has no Save button. The editor debounces each change to the title,
body, date, photos, voice notes, bead or linked threads, and then saves it
automatically. This document lists the invariants that the implementation relies on. It
also gives the location of each invariant.

## High-level shape

The screen is one React component (`EntryEditorScreen`). It operates as follows:

1. On mount, the screen loads an existing entry from `entries` (and its child rows)
   into local state. If there is no existing entry, it starts blank with the prefill
   from the route params (`useEffect` at `EntryEditorScreen.js:83-85`).
2. While the user types, a `useEffect` monitors the field state and schedules a
   `save()` on a 1-second debounce (`EntryEditorScreen.js:294-304`).
3. On unmount, the cleanup of a separate `useEffect` flushes a pending save before the
   screen is destroyed (`EntryEditorScreen.js:306-312`).
4. `save()` is a serialized async function. Only one save runs at a time. A second
   concurrent call sets a `queuedRef` flag. This flag runs `save()` again after the
   current save is complete (`EntryEditorScreen.js:182-289`).

## Field state vs refs

This state is part of the form. The user can change it, and the autosave depends on it:

- `title`, `content`, `date`: the three primary fields.
- `photos`: an array of URI strings.
- `recordings`: an array of `{ uri, duration }`.
- `bead`: `null` or `{ shape, pattern, mood, glyph }`.
- `linkedThreads`: an array of the thread rows that the user selected as
  cross-references.

These refs are *not* state, because they control behaviour and not rendering:

- `entryIdRef` (`EntryEditorScreen.js:74`): the row id. It is `null` until the first
  save inserts the row. After that, it holds the `lastInsertRowId` that the INSERT
  returned.
- `creationTimeRef` (`EntryEditorScreen.js:75`): for a new entry, the `new Date()`
  captured at mount. For an existing entry, `parseSqliteUtc(entry.created_at)`
  (`EntryEditorScreen.js:98`). The editor uses it to build the stable
  `Draft <timestamp>` fallback title. It must not change between saves.
- `skipNextSaveRef` (`EntryEditorScreen.js:76`): the editor sets it to `true`
  immediately before the batched state setters that hydrate the form from the DB. Thus
  the next run of the save effect does no work.
- `savingRef` / `queuedRef` (`EntryEditorScreen.js:77-78`): the concurrency
  primitives for `save()`.
- `dirtyRef` (`EntryEditorScreen.js:79`): `true` from the moment the user makes an
  unsaved change until `save()` commits. The unmount cleanup and `deleteEntry` read
  it.
- `pendingReminderIdRef` (`EntryEditorScreen.js:81`): initialized from
  `route.params.reminderId`. The editor clears it the first time `save()` succeeds
  with content that is not empty. The clear is idempotent. See "Reminder acknowledge"
  below.

## Invariants

### 1. `loaded` gates the autosave effect

`loaded` starts as `!isEditingInitial` (`EntryEditorScreen.js:55`):

- For a **new** entry, `isEditingInitial` is `false`, so `loaded` starts as `true`.
  The user can type immediately and cause autosaves.
- For an **existing** entry, `loaded` starts as `false`. The autosave effect returns
  early while `loaded` is false (`EntryEditorScreen.js:295`). `loadEntry()` sets it to
  `true` after it hydrates the form (`EntryEditorScreen.js:131`).

Reason: without this guard, the mount of an existing entry would start the autosave
with the empty initial state. That save would do nothing or, if a string field had a
default, it would write empty values to the DB.

### 2. `skipNextSaveRef` swallows the post-hydration effect run

`loadEntry` (`EntryEditorScreen.js:87-133`) reads the entry, the photos, the voice rows
and the linked threads from the DB. Then it calls these setters in sequence:
`setTitle`, `setContent`, `setDate`, `setPhotos`, `setRecordings`, `setBead`,
`setLinkedThreads`, `setLoaded`. React batches these calls and runs the autosave effect
one time with the new values.

The dep array changed, so the effect would usually schedule a save. That save would
immediately rewrite the entry that the user opened. It would also delete the photos and
voice notes, because the update branch deletes the child rows first. See the
wholesale-rewrite section of `data-layer.md`.

The editor sets `skipNextSaveRef.current = true` at line 123, immediately before the
batched setters. On its next run, the autosave effect reads this ref and resets it. The
effect does not schedule a save (`EntryEditorScreen.js:296-299`).

`refreshLinkedPreviews` (`EntryEditorScreen.js:162-180`) uses the same pattern. It runs
on focus to fetch new thread previews. Such a read must not count as a user edit.

### 3. `entryIdRef` lifecycle: insert vs update branch

`save()` reads `entryIdRef.current` to select the insert branch or the update branch
(`EntryEditorScreen.js:212`):

```js
let id = entryIdRef.current;
if (id == null) {
  const result = await db.runAsync(`INSERT INTO entries ...`, [...]);
  id = result.lastInsertRowId;
  entryIdRef.current = id;
  setHasSaved(true);
} else {
  await db.runAsync(`UPDATE entries SET ... WHERE id = ?`, [..., id]);
  // ...delete + re-INSERT child rows
}
```

After the first successful save:

- `entryIdRef.current` gets its value from `result.lastInsertRowId` (line 226-227).
- `setHasSaved(true)` sets a render flag (line 228), and the Delete button appears.
- All subsequent saves use the update branch.

If the first save fails, `entryIdRef.current` and `hasSaved` do not change. Thus the
next save tries the insert again. The `try/catch/finally` around the body keeps the
serialization logic correct after a failure (`EntryEditorScreen.js:204, 279-288`).

### 4. `savingRef` + `queuedRef` serialize concurrent saves

```js
if (savingRef.current) {
  queuedRef.current = true;
  return;
}
savingRef.current = true;
// ...do work...
savingRef.current = false;
if (queuedRef.current) {
  queuedRef.current = false;
  save();
}
```

(`EntryEditorScreen.js:183-186, 200, 283-287`.)

Reason: the user continues to type while writes are in progress. Without
serialization, a second autosave could start while the first save is in the middle of
its wholesale rewrite of `entry_photos` / `entry_voice_notes` / `entry_thread_links`.
The two saves would then race. The limit of one queued retry keeps the semantics that
the user expects (the final state wins) and prevents a queue with no limit.

### 5. `dirtyRef` + the mount-only unmount-flush

```js
useEffect(() => {
  return () => {
    if (dirtyRef.current) saveRef.current();
  };
}, []);
```

(`EntryEditorScreen.js:306-312`.)

The editor sets `dirtyRef` to `true` each time it schedules an autosave
(`EntryEditorScreen.js:300`). It sets `dirtyRef` back to `false` when `save()` starts
its real work (`EntryEditorScreen.js:201`). The cleanup runs one time when the screen
unmounts (the `[]` dep array is intentional). If the user goes back during the 1s
debounce window, the cleanup makes a final synchronous call to save, so the work is not
lost.

The `saveRef` indirection (`EntryEditorScreen.js:291-292`) makes sure that the cleanup
uses the *latest* `save` closure with the latest field values. It must not use the
closure captured at mount time.

### 6. Draft title fallback

If `title.trim()` is empty at save time, the editor writes the title
`Draft <YYYYMMDDHHMMSS>` to the DB. The timestamp is
`formatTimestamp(creationTimeRef.current)` (`EntryEditorScreen.js:209-210`).

The editor captures `creationTimeRef` *one time*: at mount for a new entry (line 75
default), and in `loadEntry` for an existing entry (`EntryEditorScreen.js:98`). It does
not change on subsequent saves. Thus a user who opens a draft, edits it and saves it
again sees the same `Draft 20260509...` title in the list, not a new title each time.

The DB never holds an empty title after the entry is saved. `title` is
NOT NULL DEFAULT '', and `save()` always writes the trimmed title or the draft
fallback. The `Draft` prefix is only a fallback display label. The user can replace it.

### 7. Wholesale rewrite on update

The update branch (`EntryEditorScreen.js:230-260`) does this:

```js
UPDATE entries SET ... WHERE id = ?
DELETE FROM entry_photos WHERE entry_id = ?
DELETE FROM entry_voice_notes WHERE entry_id = ?
DELETE FROM entry_thread_links WHERE entry_id = ?
// re-INSERT the entire current photos / recordings / linkedThreads arrays
```

This is intentional. See `data-layer.md` for the reasons. When you add a new child
table to the editor, use the same pattern (delete all rows, then insert all rows
again).

### 8. Reminder-acknowledge side-channel

`pendingReminderIdRef` is initialized from `route.params.reminderId`. The home screen
sets that param when the user taps a fired reminder banner (`HomeScreen.js:191-196`).
The param is `null` when the editor opens in the usual way.

In `save()` (`EntryEditorScreen.js:267-278`):

```js
if (pendingReminderIdRef.current && trimmedContent.length > 0) {
  const rid = pendingReminderIdRef.current;
  pendingReminderIdRef.current = null;
  await db.runAsync(
    `UPDATE scheduled_prompts SET acknowledged_at = datetime('now') WHERE id = ?`,
    [rid]
  );
}
```

The condition is `trimmedContent.length > 0` and not `hasSaved`, for this reason. The
editor is prefilled with the title of the reminder (`HomeScreen.js:194`). Thus a save
with only that prefilled title would pass `hasAnything`. An acknowledgment at that
moment would "mark done" a reminder that the user only looked at. With the condition on
the body content, the editor acknowledges the reminder only after the user writes
*something*.

The editor clears the ref synchronously before the UPDATE. Thus a re-entrant save
(queued through `queuedRef`) does not acknowledge the reminder again.

The user can also dismiss the reminder and write nothing: the × of the banner calls
`acknowledgeReminder` directly (`HomeScreen.js:381`). The two paths set
`acknowledged_at`, and `activeReminders` removes acknowledged reminders
(`HomeScreen.js:137-140`).

### 9. Autosave effect dep array

```js
useEffect(() => { ... }, [title, content, date, photos, recordings, bead, linkedThreads, loaded]);
```

(`EntryEditorScreen.js:304`.)

Each item of state that the user can change must be in this array. A missing item is
the most probable error when you add a new field. If an item is missing, edits to it do
not start an autosave. The user then never sees "Saved" and loses work.

`loaded` is in the array so that the effect runs again at the moment the hydration is
complete. Together with `skipNextSaveRef`, this gives the result "the editor is now
ready, but the hydration must not start a save".

`bead` and `linkedThreads` were added late (with the bead and thread features). If you
add a new item of editor state, examine this array.

### 10. Delete button + empty-entry no-op

The Delete icon renders only when `hasSaved` is true (`EntryEditorScreen.js:418-429`).
If the user opens a new entry, types nothing and goes back, `hasSaved` is false because
no row was inserted. Thus there is no Delete button, and there is nothing to delete.

`save()` returns early when there is nothing to save *and* no row exists:

```js
if (!hasAnything && entryIdRef.current == null) return;
```

(`EntryEditorScreen.js:198`.) `hasAnything` is true for any of these items
(`EntryEditorScreen.js:190-196`):

- a trimmed title or trimmed content that is not empty
- a photo
- a recording
- a linked thread
- a bead

This makes "open editor, type nothing, leave" a true no-op. The autosave debounce does
not write a row, and the unmount-flush cleanup does not write a row.

If the entry *was* saved before (`entryIdRef.current` has a value), `save()` continues
with empty content. Thus the user can clear a draft to empty strings, and the DB shows
that change. The user can then delete the entry explicitly.

### 11. `openAddToThread` flushes before opening

```js
if (!entryIdRef.current) await saveRef.current();
if (entryIdRef.current) setAddToThreadVisible(true);
```

(`EntryEditorScreen.js:341-344`.) The "Add to thread" overlay needs an `entry_id` to
fill `thread_beads.entry_id`. The user can make a bead on a new entry and tap "Add to
thread" before the 1s debounce fires. In that case, the entry does not exist yet. The
`await saveRef.current()` call forces the insert immediately. The second guard is for
the case where the save returned early (for example, nothing to save).

### 12. `BeadComposer` does live-commit, not Save-on-Done

The composer modal stays open while the user selects attributes. Each change calls
`onSave({...})` immediately (`BeadComposer.js:59-67`). The `onSave` callback of the
editor only does `setBead(payload); dirtyRef.current = true;`
(`EntryEditorScreen.js:545-550`). The usual autosave path of the editor saves the
bead. The "Done" button only closes the sheet (`BeadComposer.js:72-79`). See
`beads-and-threads.md` for the `justOpenedRef` / `onSaveRef` logic inside
`BeadComposer`.

### 13. The save-state readout is derived, never asserted

`savingState` is an enum with five values:
`'idle' | 'dirty' | 'saving' | 'saved' | 'error'`. The left slot of the header renders
it as an `Ionicons` glyph and a word:

- `pencil-outline` + *Editing…*
- `sync-outline` + *Saving…*
- `checkmark-circle` in `colors.primary` + *Saved*
- `alert-circle-outline` in `colors.danger` + *Not saved. Tap to retry.*

It is presentation only. No branch in `save()` reads it, and no invariant above reads
it.

`savingState` must obey these rules:

- **Initial value.** It starts at `'saved'` for an existing entry
  (`useState(isEditingInitial ? 'saved' : 'idle')`). The row on disk *is* saved, so
  the slot must not be blank when a note opens. It starts at `'idle'` for a new entry.
- **`'saved'` stays while the entry is clean.** Only the autosave effect changes it
  from `'saved'`. That effect returns early under `skipNextSaveRef` (hydration,
  `refreshLinkedPreviews`), so a read never shows as an edit.
- **It never shows `'saved'` while edits are pending.** The autosave effect sets
  `'dirty'` together with `dirtyRef.current = true`.
- **A failed save gives `'error'`.** It must not give `'dirty'` (which looks the same
  as a pending debounce) or `'idle'`. The `catch` (and the `!db` case, which throws
  into it) sets `lastSaveFailedRef` and **arms `dirtyRef` again**, because the top of
  `save()` cleared it. Thus each retry path fires: the next debounce, the
  `beforeRemove` guard and the unmount flush.
- **`'error'` is sticky.** While `lastSaveFailedRef` is set, the autosave effect shows
  `'error'` and not `'dirty'`. This continues until a save commits, or until the
  nothing-to-save early return shows that no data can be lost. In `'error'` the slot
  is a button (`accessibilityRole="button"`) that arms `dirtyRef` again and calls
  `saveRef.current()`.
- **The `beforeRemove` guard checks `lastSaveFailedRef` after its flush.** A new
  dispatch would loop through the guard with no end, because `dirtyRef` is armed
  again. Thus the guard keeps the user on the screen with a *Stay / Leave anyway*
  alert. *Leave anyway* sets `leaveAnywayRef`, so the guard lets the new dispatch
  through. It also clears `dirtyRef`: the user accepted the loss, and the unmount
  flush must not retry and show the prompt a second time.
- **A save that fails after unmount has no readout.** The mount-only cleanup sets
  `unmountedRef` as its first step (auto-lock, deep link). Such a failed save shows a
  *Discard / Retry* alert. *Retry* runs `saveRef.current(opts)` again with the same
  opts, so a history-preview `override` still saves the pre-open text. The alert is
  skipped while `queuedRef` is set: the queued run will try again immediately, and its
  own failure will show the alert.
- **The `'dirty'` transition has a display-only content guard.** The effect also runs
  one time at mount for a new note, and a blank note has nothing to report. Thus the
  slot stays `'idle'` until there is real content (a title beyond the reminder
  prefill, body, photo, recording, mention or bead) or a row already exists. The
  `setTimeout` schedule below the guard is unconditional, as it was before. The guard
  must never gate the save.
- **The nothing-to-save early return of `save()` sets `'idle'`.** Thus an emptied
  draft does not stay on *Editing…*.

The entrance animation on `'saved'` is one `Animated.Value` (opacity 0→1, scale 0.8→1,
200 ms, `useNativeDriver: true`). A `useEffect` on `savingState` starts it. Do not use
`LayoutAnimation`: it would animate the full top bar. The wrapper `View` has
`accessibilityLiveRegion="polite"` and an `accessibilityLabel` that repeats the word.
Thus a screen reader announces the state change.

`ThreadDetailScreen` has the same `'error'` state for name + description:

- The state is sticky through its own `lastSaveFailedRef`.
- A tap retries through `persistThreadFields` with the live values.
- The next debounce retries.

That screen has no leave-guard and no unmount flush, so it has no alert path.

### 14. The undo/redo history layer (S15) rides beside autosave, never inside it

The history layer gives session-only undo/redo for **title + content only**. A RAM
tree holds it (`services/editHistory.js`). It is not persisted, and this is
intentional. A stored history would keep "deleted" text in the vault, and a PIN-locked
journal must not do that without the knowledge of the user. The model is that of Emacs:

- Undo moves to the parent state.
- Text typed after an undo makes a *fork* and does not discard the redo trail.
- Thus no state is lost during the session.

The wiring is a second debounced effect, parallel to autosave. The parallel structure
is the invariant:

- **Capture uses the autosave cadence.** The editor records a history node on the same
  `AUTOSAVE_DELAY_MS` pause, from an effect with deps `[title, content, loaded]`.
  History states and *Saved* states are the same states. Do not capture on each
  keystroke. Do not merge the two effects into one (their guard refs are different).
- **`historySkipRef` is the equivalent of `skipNextSaveRef`, and only the capture
  effect consumes it.** `loadEntry` sets the two refs before its hydration batch. It
  also seeds the tree with the loaded row through `reset`. An undo/redo apply sets
  **only** `historySkipRef`. The restored text must go through autosave as usual. If
  not, the undo would be lost on the next launch. `refreshLinkedPreviews` sets only
  `skipNextSaveRef`. It never changes title or content.
- **The uncaptured-tail rule.** If the user starts undo/redo during the debounce (the
  live text is newer than the last node), the editor first records the live snapshot
  and then moves. Without this rule, undo would go past the newly typed tail and lose
  it. Thus `undo`/`redo` always return a snapshot that is different from the live
  buffer. This makes sure that the apply renders again and that the capture effect
  consumes `historySkipRef`.
- **The accessory bar is keyboard-scoped chrome.** It renders only when
  `useKeyboardBottomOffset() > 0` *and* one of the two text fields has focus. The
  focus condition prevents a false bar under keyboards that a Modal owns (comments
  drawer, sheets). While the bar is visible, it adds its height to the keyboard
  padding of the body ScrollView.
- **The accessory bar is pinned with `useKeyboardBottomOffset`, not
  `useKeyboardInset`.** `useKeyboardBottomOffset` gives the exact native IME overlap
  from react-native-keyboard-controller. Under edge-to-edge, the keyboard events of RN
  are stale and not accurate. The measured error was 42 px on the maker's Redmi before
  any correction (see the notes of the hook). On a *pinned* bar, each pixel of error is
  a visible gap. Sheet padding keeps the inset hook, because too much padding is not
  visible there.
- **Bounded memory.** The tree prunes when it has more than 200 nodes. It promotes a
  single-child root, or else it removes the oldest abandoned leaf. It never cuts the
  path under the current state.

**The tree sheet (phase 2, `components/EditHistorySheet.js`)** draws the session tree
in a half-height sheet over a backdrop that is not dimmed. The buffer above the sheet
*is* the preview surface: a tap on a bead shows that state in the buffer, and a second
tap restores it. Thus the graph needs no content and fits on a phone. The sheet has
these invariants:

- **The sheet opens only after the keyboard is gone (v0.88.4).** The tree button
  records the live tail and makes a snapshot of the pre-open text. Then it calls
  `dismissKeyboardThen` (`hooks/useKeyboardHeight.js`). This function dismisses the
  IME and shows the sheet only on the `keyboardDidHide` event of
  react-native-keyboard-controller (600 ms fallback).
- **Do not set `historySheetVisible` in the same tick as `Keyboard.dismiss()`.** On
  Android, a dialog created during the IME hide animation can get its layout from a
  transient, incorrect inset. A device test showed a 5539 px root on a 2772 px screen.
  The sheet was fully below the bottom edge: it had focus but was not visible.
- **The `Modal` of the sheet must pass `statusBarTranslucent` and
  `navigationBarTranslucent`.** These remove the `fitsSystemWindows` wrapper of RN,
  which is where the inset comes in. Keep this rule and the deferred open together.
  Each one alone is only a partial fix.
- **`historyPreviewRef` freezes `save()` for the full preview window.** The editor
  sets the ref in the same tick in which the sheet becomes visible (inside the
  deferred open), and never earlier. A freeze with no sheet to close would drop each
  subsequent save with no indication. While the ref is set, `save()` returns
  immediately. Without the freeze, a pending autosave timer from text typed
  immediately before the open would fire during the preview and persist the previewed
  old state. Restore and close clear the ref and start the save path again.
- **The mount-only unmount cleanup is the last protection.** It cancels a pending
  deferred open. If the screen is destroyed while the sheet is open (auto-lock, deep
  link), the cleanup removes the freeze and flushes the **pre-open snapshot** through
  `save({ override })`. It never flushes the previewed buffer.
- **Preview applies with *both* guards** (`skipNextSaveRef` + `historySkipRef`),
  behind an equality check. Thus a tap on the same state cannot set guards that no
  setter run will consume.
- **Restore applies with only `historySkipRef`**, because restore must save. When the
  buffer already shows the target (it was previewed), the setters would do nothing.
  Thus restore calls `saveRef.current()` directly. This is safe there because the
  closure of that render *is* the target text.
- **The revert-on-close path must never call `saveRef.current()` after its setters.**
  The closure still holds the previewed text. The path lets the usual save effect
  persist the text again. This also flushes a tail save that the freeze stopped.
- **The sheet never mutates the history.** It computes the layout one time for each
  open (`buildLayout`):
  - The spine is root→current plus the most-touched descendants, in lane 0.
  - The newest row is on top.
  - Abandoned chains are packed greedily into dashed lanes by row-span overlap.
  - A child always renders above its parent, because `ts` and id are monotonic.
- **The private-content mask gives way to the preview** (`historySheetVisible` is in
  the two branch conditions). The user got there from inside the unlocked, focused
  editor.
- **History nodes are not beads.** They do not render through `src/beads/svg.js`.
  They have no facets. Plain circles keep the single-renderer rule.

**ThreadDetailScreen mirrors the whole wiring** for thread name + description (mapped
to the `{title, content}` snapshot shape of the service). It has two local differences:

1. The capture effect seeds the history lazily (`size() === 0` → `reset`). **Never**
   seed the history in `load()`. `load()` runs again on each focus and would erase the
   session tree each time the user goes into an entry and comes back.
2. There is no `historyPreviewRef` freeze. The auto-save timer of that screen captures
   name and description in its effect closure at schedule time. Thus a pending save
   can write only real text. A preview only uses up one effect run through
   `skipNextSaveRef`.

The second difference has a cost. A restore path or close path whose setters do nothing
must persist explicitly (`persistThreadFields` with explicit args). The
close-without-restore flush runs only if a previewed-this-session ref is set. Thus an
open and close with no action never changes `updated_at`.

## When extending the editor

Checklist to add a new editor field that is stored on `entries` (for example, a tags
array):

1. Add the column to the `CREATE TABLE` block in `db.js` and write a column shim.
2. Add a `useState` for the field at the top of `EntryEditorScreen`.
3. Initialize it in `loadEntry` *before* you set `skipNextSaveRef.current = true`, so
   that it is part of the same hydration batch.
4. Add it to the dep array of the autosave effect (`EntryEditorScreen.js:304`).
5. Read it in `save()` and write it on the insert branch and on the update branch.
6. If it is a child relationship (stored in its own table), use the wholesale-rewrite
   pattern: `DELETE WHERE entry_id = ?`, then one `INSERT` for each row.
