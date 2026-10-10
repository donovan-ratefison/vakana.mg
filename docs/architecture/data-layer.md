# Data layer

The app keeps all data in one SQLite database on the device (`journal.db`). The app
opens the database with `expo-sqlite`. There is no remote sync, no encryption at rest
and no migration system. The schema is a set of `CREATE TABLE IF NOT EXISTS` blocks.
PRAGMA-guarded shims add columns to existing tables.

## The singleton

`src/database/db.js` keeps a module-level `db` reference and exports two functions:

- `initDatabase()`: opens the database, applies the pragmas, runs the schema block,
  runs the column shims and returns the handle. This function is **idempotent**. If the
  singleton already holds a handle for the same vault file, the function returns that
  handle. If the singleton holds a handle for a different file, the function closes
  that handle first.
- `getDb()`: returns the cached handle, or `null` if the initialization did not run
  (`db.js:150-152`).

The idempotent behaviour of `initDatabase()` is necessary for correct operation:

- An Android Activity relaunch runs the React root again but does not restart the JS
  runtime. A change of system navigation mode, font size or locale causes such a
  relaunch.
- Thus the boot effect in `App.js` calls `initDatabase()` a second time.
- If the app opens the same file two times through expo-sqlite, it gets two JS
  wrappers over one cached native connection.
- When the garbage collector releases the first wrapper, the release closes that
  connection while the second wrapper still uses it.
- `isClosed` stays `false`, so each query fails with a bare `NullPointerException`.
  The lists are empty and auto-save fails.

**Caution:** Do not add an unconditional open to `initDatabase()`.

The screens use this pattern:

```js
const db = getDb();
if (!db) return;
```

Each screen has this guard, although `App.js` does not render the screens until the
initialization is complete (`App.js:21-46`). The guard has a low cost. It gives
protection when a code path calls `getDb()` before `App.js` mounts (for example, a
test).

`initDatabase()` applies two pragmas:

- `PRAGMA journal_mode = WAL` lets readers operate while a write is in progress.
- `PRAGMA foreign_keys = ON` makes the `ON DELETE CASCADE` clauses below operate.
  Without this pragma, SQLite ignores these clauses and gives no error.

## Tables

### `entries`: the journal note (`db.js:58-69`)

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `title` | TEXT NOT NULL DEFAULT '' | If the title is empty at save time, it becomes `Draft <YYYYMMDDHHMMSS>` (see `editor-autosave.md`). |
| `content` | TEXT NOT NULL DEFAULT '' | Free-form body. |
| `date` | TEXT NOT NULL | A `YYYY-MM-DD` string, *not* a timestamp. The calendar groups entries by this column. |
| `created_at` | TEXT | SQLite `datetime('now')`, UTC. |
| `updated_at` | TEXT | UTC. Each editor save updates it. |
| `bead_shape` | TEXT (nullable) | One of `square`, `round`, `oval`, `lozenge`, `bar`, `dot`. NULL means "no bead". |
| `bead_pattern` | TEXT (nullable) | One of the keys in `PATTERNS` (`src/beads/types.js:18`). |
| `bead_mood` | TEXT (nullable) | One of the keys in `MOODS`. |
| `bead_glyph` | TEXT (nullable) | A label or emoji of 8 characters maximum. |
| `highlight_tier` | INTEGER NOT NULL DEFAULT 0 | The `ensureHighlightColumn` shim adds it. `0` = none, `1` = weekly highlight (feeds `auto_week`), `2` = monthly highlight (feeds `auto_month`). The star control in the bead/meta block of the editor cycles the value. |

`hasBead(entry)` is `Boolean(entry.bead_shape)` (`beads/types.js:50`).

### `entry_photos`: image attachments (`db.js:71-77`)

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `entry_id` | INTEGER NOT NULL | FK → `entries(id)` `ON DELETE CASCADE`. |
| `uri` | TEXT NOT NULL | URI from `expo-image-picker` (camera or library). |
| `created_at` | TEXT | |

### `entry_voice_notes`: audio attachments (`db.js:79-86`)

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `entry_id` | INTEGER NOT NULL | FK → `entries(id)` `ON DELETE CASCADE`. |
| `uri` | TEXT NOT NULL | Recorder output URI from `expo-audio`. |
| `duration` | INTEGER NOT NULL DEFAULT 0 | Seconds. |
| `created_at` | TEXT | |

### `scheduled_prompts`: reminders

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `title`, `message` | TEXT | The default of each column is `''`. |
| `scheduled_date` | TEXT NOT NULL | `YYYY-MM-DD`. For a recurring reminder, this column always points at the *next* occurrence. An acknowledgment advances the cursor. |
| `scheduled_time` | TEXT NOT NULL | `HH:MM`. The cursor rules of `scheduled_date` apply. |
| `recurring` | TEXT (nullable) | Legacy. This column was "reserved" and has no new function. The recurrence model uses the `recurrence_*` columns below. |
| `is_active` | INTEGER NOT NULL DEFAULT 1 | In use. To stop a recurring series, the app sets this column to 0. This keeps the cursor and the counter. A one-shot reminder uses `acknowledged_at` for the same effect. |
| `notification_id` | TEXT | The OS handle from `Notifications.scheduleNotificationAsync`. The app uses it to cancel the notification. The app schedules the notification again each time the cursor advances. |
| `acknowledged_at` | TEXT (added via shim) | The editor sets it when the user writes content from a fired reminder. A tap on the dismiss × of the banner on `HomeScreen` also sets it. The **Acknowledge** row of the long-press menu also sets it, through the same recurrence-aware `acknowledgeReminder`. For a recurring series, the app sets it only when the series reaches `recurrence_max` during catchup. **An acknowledgment does not hide a one-shot reminder:** the row stays in the table and on its calendar day. The "Reminders this day" list of the Day view shows it struck. The month panel shows it struck when the **"Acked (N)" header toggle** is on. This toggle is off by default. It is panel-local state in `CalendarMonth` and is not persisted. `reminders.restoreReminder()` reverses the acknowledgment: it clears `acknowledged_at` and, if the reminder is still in the future, arms the OS notification again. This is a service-level transition, as `setReminderActive` is. Screens must not write this column directly. The banner stack and the day-cell bell still filter on `!acknowledged_at`, so an acknowledged reminder does not show there again. |
| `recurrence_kind` | TEXT (added via shim) | `null` (one-shot) or `'day' \| 'week' \| 'month' \| 'year'`. |
| `recurrence_every` | INTEGER NOT NULL DEFAULT 1 | Every N units of `recurrence_kind`. |
| `recurrence_max` | INTEGER (added via shim) | `null` = no limit. A number = stop after this number of fires. |
| `recurrence_anchor_day` | INTEGER (added via shim) | The day of the month on which the user set a `month` or `year` series. `null` for day series, week series and one-shot reminders. The cursor clamps in short months. This column lets "every month on the 31st" return to the 31st. See `reminders.md §Single-row model`. |
| `recurrence_fired` | INTEGER NOT NULL DEFAULT 0 | Counter. Each acknowledgment increases it. The counter is catchup-aware: one acknowledgment adds N if N occurrences passed with no acknowledgment. |
| `created_at` | TEXT | |

### `threads`: named bead chain

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `name` | TEXT NOT NULL | |
| `description` | TEXT NOT NULL DEFAULT '' | |
| `anchor_kind` | TEXT (nullable) | `null` / `'day'` / `'month'` / `'year'` / `'time'` / `'none'` (the UI changes `'none'` to NULL). |
| `anchor_date` | TEXT (nullable) | The format depends on the anchor kind: `YYYY-MM-DD` for day/time, `YYYY-MM` for month, `YYYY` for year. |
| `anchor_time` | TEXT (nullable) | `HH:MM`. Set only when `anchor_kind = 'time'`. |
| `kind` | TEXT NOT NULL DEFAULT 'user' | A shim adds it. `'user'` = the user curates the thread. `'auto_day'` = daily thread that the system manages. `'auto_week'` = weekly highlight rollup (ISO-Monday anchor). `'auto_month'` = monthly highlight rollup (first-of-month anchor). |
| `closed_at` | TEXT (nullable) | The `ensureThreadClosedColumn` shim adds it. `NULL` = open (ongoing). A SQLite space-form datetime = a **closed loop** (a completed cycle) and the day on which it closed. The UI shows this day as the "Closed · date" chip and the clasp label. The user can edit it with the clasp date picker. The value uses the `datetime('now')` space form (not JS ISO). Thus the ISO-versus-space comparison problem of `comments.remind_at` does not apply. The close is reversible (Reopen → `NULL`). `auto_week` and `auto_month` render as loops because of their `kind`, and they never have this value. `auto_day` is never a loop. This column sets the default render mode in `ThreadDetailScreen` (closed ⇒ Loop) and the marker on the list card. There is no index: `threads` is small and each query already scans it fully. |
| `collection_id` | INTEGER (nullable) | **Vestigial.** The `thread_collection_links` junction replaced it in v0.5.0. The column stays so that a downgrade does not fail. New code must not read it or write it. FK → `thread_collections(id)` `ON DELETE SET NULL`. |
| `created_at`, `updated_at` | TEXT | A bead change in the thread updates `updated_at`. |

`ensureThreadKindColumn` adds these indexes:
- `idx_threads_kind_anchor (kind, anchor_date)`: supports the User / Auto / All filter on the threads tab.
- `idx_threads_auto_day_unique`: `UNIQUE` partial index `WHERE kind = 'auto_day' AND anchor_date IS NOT NULL`. It enforces "at most one auto-thread per calendar day" without a check constraint.
- `idx_threads_auto_week_unique`: `UNIQUE` partial index `WHERE kind = 'auto_week' AND anchor_date IS NOT NULL`. One weekly rollup for each ISO-Monday anchor.
- `idx_threads_auto_month_unique`: `UNIQUE` partial index `WHERE kind = 'auto_month' AND anchor_date IS NOT NULL`. One monthly rollup for each first-of-month anchor.

Read anchored threads through `src/services/anchoredThreads.js`. This module is the
only place that defines "what counts as anchored". The calendar and the Day view share
it, so the two definitions cannot become different.

- `loadAnchoredThreads()` uses `WHERE anchor_kind IS NOT NULL AND anchor_kind != 'none'`
  and selects `kind`. It supplies the month markers and year markers of the calendar.
- The **per-day ribbon** shows only threads that agree with `isUserDayAnchor`:
  `kind = 'user'` and `anchor_kind ∈ {day, time}`. The system `auto_day` thread
  exists for each day that has an entry. Thus the ribbon does **not** include it. If it
  did, the ribbon would be a duplicate of the entry-count heatmap.
- `threadsAnchoredToDay(dateStr)` is the same predicate in SQL. `DayScreen` uses it to
  list the anchored threads that the ribbon of a day shows.

### `thread_beads`: beads on a thread (`db.js:112-126`)

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `thread_id` | INTEGER NOT NULL | FK → `threads(id)` `ON DELETE CASCADE`. |
| `entry_id` | INTEGER (nullable) | FK → `entries(id)` `ON DELETE SET NULL`. If the entry is deleted, the bead row stays. |
| `position` | INTEGER NOT NULL | User threads: 0-based index along the chain. A save rewrites all positions (`ThreadComposerScreen.js:280-296`). Auto-threads: the encoded value `YYYYMMDD × 1e6 + (entry.id mod 1e6)`. Thus weekly and monthly chains that cover many days sort in chronological sequence by entry date, with a stable sequence in each date. |
| `snapshot_shape`, `snapshot_pattern`, `snapshot_mood`, `snapshot_glyph` | TEXT NOT NULL | A frozen copy of the bead of the entry at the moment when the entry was added to this thread. |
| `section_label` | TEXT (nullable) | When not null, this bead is the start of a named chapter in the thread (`ensureSectionLabelColumn` shim). The label belongs to the membership, not to the entry. The same entry in two threads can be "Kickoff" in one thread and a plain bead in the other. A section is the implicit span between two consecutive labelled beads. There is no `thread_sections` table. Auto-threads never have this value. |

There is an index on `thread_id` and an index on `entry_id`.

The two representations (live FK *and* snapshot) are intentional. To load a chain, the
app joins `thread_beads` to `entries`:

- If the entry exists and its `bead_*` columns have values, the app shows the **live**
  bead.
- If not, the app uses the **snapshot** and renders the bead `faded`
  (`ThreadCard.js:10-30`, `ThreadDetailScreen.js:179-201`).

This keeps the appearance of a thread stable. If the user deletes the source entry, the
chain keeps its bead. If the user changes the bead of an entry, the snapshots of
historical threads do not change. But a chain with a live entry shows the live bead.

### `entry_thread_links`: cross-references (`db.js:128-141`)

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `entry_id` | INTEGER NOT NULL | FK → `entries(id)` `ON DELETE CASCADE`. |
| `thread_id` | INTEGER NOT NULL | FK → `threads(id)` `ON DELETE CASCADE`. |
| `position` | INTEGER NOT NULL DEFAULT 0 | Display sequence of the linked threads in the entry editor. |
| `created_at` | TEXT | |

There is an index on each FK.

This table holds the *mention a thread* concept. The user sees it as the Mentions
section of the entry editor, which opens from the top-bar `+` → Mention a thread. It is
**not** the same as `thread_beads`. See `beads-and-threads.md` for the difference. The
table name keeps the legacy word "links". The user-facing UI uses the word "mentions".

### `thread_collections`: named buckets above threads

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `name` | TEXT NOT NULL | |
| `position` | INTEGER NOT NULL DEFAULT 0 | Reserved for a sort sequence. The UI does not use it at this time (chips render in alphabetical sequence). |
| `created_at`, `updated_at` | TEXT | |

`ensureThreadCollections` creates this table. When a collection is deleted, the FK of
the junction deletes its rows in `thread_collection_links`. The member threads do not
change.

### `thread_collection_links`: many-to-many membership

| Column | Type | Notes |
|---|---|---|
| `thread_id` | INTEGER NOT NULL | FK → `threads(id)` `ON DELETE CASCADE`. |
| `collection_id` | INTEGER NOT NULL | FK → `thread_collections(id)` `ON DELETE CASCADE`. |
| `created_at` | TEXT | |

The composite primary key `(thread_id, collection_id)` makes inserts idempotent. The
`INSERT OR IGNORE` backfill statement relies on this. There is an index on each column,
for lookup in the two directions: the filter "threads in collection X" *and* the picker
"collections of thread Y".

The legacy `threads.collection_id` column stays in the table, but the app does not read
it. The service module `src/services/collections.js` owns each read path and write path
for this junction. No other code writes to the legacy column.

### `comments`: polymorphic comment stream

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `parent_kind` | TEXT NOT NULL | `'entry'` / `'thread'` / `'reminder'`. |
| `parent_id` | INTEGER NOT NULL | An id in the namespace of `parent_kind`. |
| `body` | TEXT NOT NULL DEFAULT '' | Plain text. The service trims it at write time. |
| `created_at`, `updated_at` | TEXT | |
| `edited_at` | TEXT (nullable) | Set on the first edit. The drawer shows it as an "edited" tag. |
| `remind_at` | TEXT (nullable) | ISO timestamp from `Date.toISOString()`. Null = plain comment. |
| `notification_id` | TEXT (nullable) | OS notification handle, used to cancel and to schedule again. |
| `reminded_at` | TEXT (nullable) | Set when the user acknowledges a fired self-ping (a content edit on the parent, or the × on the banner). An acknowledgment never deletes the comment: the comment stays in the drawer of the parent. Thus there is no restore function. The "Acked" toggle of the calendar panel shows acknowledged comment-reminders struck (`loadDoneCommentRemindersWithLabels`). A tap on a struck row opens the parent. |

Indexes:
- `idx_comments_parent (parent_kind, parent_id, created_at)`: supports the drawer
  query for one parent.
- `idx_comments_remind (remind_at) WHERE remind_at IS NOT NULL AND reminded_at IS NULL`:
  a partial index. It keeps the cost of the fired-banner derivation low on each tick,
  because the query scans only unfired comment-reminders.

There is **no foreign key** on `(parent_kind, parent_id)`. SQLite cannot express an FK
whose target table depends on a different column. Thus the app code does the cleanup
when a parent is deleted. Each parent delete path must call it:

- Single-row paths (reminders) call `removeCommentsForParent`.
- Entries and threads use the transaction-safe pair `deleteCommentsForParentsInTx` +
  `cancelCommentNotifications`, which `services/entries.js` and `services/threads.js`
  call. The rows are deleted inside the transaction of the caller. The OS
  notifications are cancelled only after the commit.

> **Caution: datetime comparison.** `remind_at` holds a JS ISO string
> (`'2026-05-10T11:00:00.000Z'`). The `datetime('now')` function of SQLite returns
> `'YYYY-MM-DD HH:MM:SS'` (no T, no Z). A lexical string comparison fails because `'T'`
> (0x54) sorts after `' '` (0x20). Each check for a fired self-ping must wrap **both**
> sides in `datetime(...)` so that SQLite parses them as timestamps. See
> `src/services/comments.js`.

### `bead_presets`: named, reusable beads (the macro/snippet layer)

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `name` | TEXT NOT NULL | The name that the user gives (for example "Morning run"). The service trims it at write time and rejects an empty name. |
| `shape` | TEXT NOT NULL | |
| `pattern` | TEXT NOT NULL DEFAULT 'solid' | |
| `mood` | TEXT NOT NULL DEFAULT 'slate' | |
| `glyph` | TEXT NOT NULL DEFAULT '' | |
| `created_at` | TEXT | |
| `last_used_at` | TEXT (nullable) | Updated on recall. It sorts the recents strip. NULL (never used) sorts last under `DESC`. |

There is **no foreign key**. A preset is independent of all entries: when an entry is
deleted, the presets do not change, and the opposite is also true. All reads and writes
go through `src/services/beadPresets.js`:

- `listBeadPresets` (sorted `last_used_at DESC, created_at DESC`)
- `createBeadPreset`
- `deleteBeadPreset`
- `touchBeadPreset`

Two places use the presets, through the same *pre-fill* mechanic:

- `BeadComposer` pre-fills the bead that the user encodes.
- The home **Filters sheet** pre-fills the four facets that the user retrieves by.

Encode and retrieve are the same primitive in opposite directions. The user can create
and delete presets only in `BeadComposer`. The filter sheet only reads the presets.

## Migration shims

There is no `expo-sqlite` migration runner. Shim functions add to existing tables and
do not drop data. They run in sequence after the main `CREATE TABLE` block:

- `ensureBeadColumns`: adds `bead_shape` / `bead_pattern` / `bead_mood` /
  `bead_glyph` to `entries` if they are missing.
- `ensureReminderColumns`: adds `acknowledged_at` to `scheduled_prompts`.
- `ensureRecurrenceColumns`: adds `recurrence_kind` / `recurrence_every` /
  `recurrence_max` / `recurrence_fired` / `recurrence_anchor_day` to
  `scheduled_prompts`. Existing rows get safe defaults (kind = NULL means one-shot, so
  the behaviour does not change). On each launch, it also backfills
  `recurrence_anchor_day` for month rows and year rows that do not have one. The
  backfill value is the day of the current cursor.
- `ensureThreadKindColumn`: adds `kind` to `threads` (`DEFAULT 'user'`) and creates
  the indexes that depend on `kind` (regular and partial-unique). These indexes are
  in this shim, not in the main schema block. They refer to a column that possibly
  does not exist in a database older than v0.2.0.
- `ensureThreadCollections`: creates `thread_collections`, adds the legacy
  `threads.collection_id` column (kept as a vestigial migration artifact) and adds an
  index on it.
- `ensureThreadCollectionLinks`: creates `thread_collection_links` (many-to-many)
  with FKs `ON DELETE CASCADE` on the two sides. It also runs the backfill
  `INSERT OR IGNORE … SELECT id, collection_id FROM threads WHERE collection_id IS
  NOT NULL` from the legacy column. The backfill is idempotent across boots: the
  composite primary key ignores repeated rows, so a migration flag is not necessary.

The reasons for this approach, and not a full migration system:

1. The app shipped at v0.1.0 with two added columns. The upgrade cost ("boot, read
   pragma, possibly run an ALTER") is negligible compared with the cost to integrate a
   migration framework.
2. The two shims are additive `ADD COLUMN` operations with default-NULL semantics.
   SQLite does such a change with no difficulty. A change of column type, a dropped
   column or a value backfill will make a versioned migration table necessary. The
   Caveats section of the README records this as technical debt.
3. The `CREATE TABLE IF NOT EXISTS` block in `initDatabase` is the source of truth for
   *fresh installs*. The shims apply only to *existing* installs that upgrade from a
   build without the column. A new table needs only the `CREATE TABLE IF NOT EXISTS`
   entry and no shim.

To add a new column:
1. Add it to the `CREATE TABLE` in `initDatabase`.
2. Add it to a shim (existing or new) so that deployed installs get it on the next boot.

## Attachments-as-URI: app-owned bytes (`services/mediaStore.js`)

The database stores photos and voice notes as URIs. Since v0.78.1 the **app owns** the
bytes at those URIs. Each capture path goes through `persistMediaUri` /
`persistMediaUris`:

- the editor photo picker
- the voice recorder
- the audio import
- the Home quick-capture

These functions copy the cache file of the picker or recorder into
`documentDirectory/attachments/<vaultId>/photos|voice/` and return the durable URI. The
DB contains only store URIs. The reason is that the OS *and* third-party cleaner apps
can delete files in the cache directory. A Xiaomi cleaner deleted the media of field
testers (the v0.78.1 incident).

`rescueAndSweepMedia()` does all the bookkeeping. `App.js` starts it (and does not
await it) after `initDatabase()` on each boot:

- **Rescue**: the pass migrates each row whose URI is outside the store while its
  bytes are still readable (data from before v0.78.1). The pass also corrects in place
  each store URI that has a stale container prefix (iOS changes the app container
  path on update). If the bytes of a row are already gone, the pass does not change the
  row, and the row renders as a blank.
- **Sweep**: the pass deletes store files that no row refers to (removed photos,
  deleted entries, fused-away sources). A file must be older than 24 h before the pass
  deletes it. Thus the pass cannot delete a new copy before its row commits.

The sweep is the only cleanup point. Thus the delete paths (editor delete, swipe
delete, batch delete, fusion) do not touch files.

**Caution:** Do not add inline file deletion to a delete path.

Backup restore is compatible. It builds the same store layout with files named by row
id and rewrites the rows. `deleteVault` removes the store directory of the vault.

## Wholesale-rewrite-on-update pattern

`EntryEditorScreen.save()` (`EntryEditorScreen.js:182-289`) does this on the update
branch:

```js
await db.runAsync('DELETE FROM entry_photos WHERE entry_id = ?', [id]);
await db.runAsync('DELETE FROM entry_voice_notes WHERE entry_id = ?', [id]);
await db.runAsync('DELETE FROM entry_thread_links WHERE entry_id = ?', [id]);
// then re-INSERT the entire current arrays
```

`ThreadComposerScreen.handleSave()` uses the same pattern for `thread_beads`
(`ThreadComposerScreen.js:262-296`). On edit, it deletes each bead row of the thread.
Then it inserts the rows again in the new sequence with new positions.

The reasons for a wholesale rewrite, and not a diff for each row:

1. The arrays are small (a small number of rows for each entry or thread). A diff
   costs more than a rewrite.
2. A change of sequence is the usual case for `thread_beads`. It is more difficult to
   track each moved row than to delete and insert all rows.
3. No FK from a different table points into `entry_photos`, `entry_voice_notes`,
   `entry_thread_links` or `thread_beads`. Thus a deleted row does not cascade into
   data that is important to the user.

Keep this pattern when you extend a child relationship of `entries` or `threads`. A
different strategy is necessary if a new child table holds state that a save must not
delete (for example, per-row timestamps that the user expects to stay stable). No table
in the schema is in that condition at this time.

## Services layer

`src/services/` contains the read helpers and write helpers for tables whose invariants
apply to more than one screen:

- **`comments.js`**: reads and writes for polymorphic comments and comment-reminders.
  It owns:
  - the `(parent_kind, parent_id)` lookup contract
  - the `datetime(...)` wrapping pattern for ISO timestamps
  - the cascade on parent delete (`removeCommentsForParent`)
  - the cancel of the OS notification on delete

  Each screen that shows comments (entry editor, thread detail, reminder drawer, home
  banner) goes through this module.

- **`entries.js`**: `deleteEntries(ids)`, the only entry-delete path (Home swipe,
  Home batch, editor Delete). The auto-bead strip and prune
  (`removeAutoBeadsForEntriesInTx`), the comment cascade and `DELETE FROM entries` run
  in **one** `withTransactionAsync`. The function cancels the comment-reminder
  notifications after the commit. User-thread snapshots stay because of the `SET NULL`
  FK. Do not call this function inside a different transaction.

- **`threads.js`**: `deleteThreads(ids)`, the only thread-delete path (Home batch,
  thread detail). The comments and the thread rows are deleted in one transaction. The
  FKs cascade to `thread_beads`, the collection links, the Mentions and
  `thread_articles`. The function deletes exactly the ids that it gets. The callers
  must remove auto kinds from the list.

- **`collections.js`**: operations on the thread ↔ collection junction:
  `loadCollectionsForThread`, `loadThreadCollectionIdSet`, `addThreadToCollection`,
  `removeThreadFromCollection`, `createCollectionAndAssignThread`,
  `countThreadsInCollection`, `deleteCollection`. This module **never** reads or
  writes the legacy `threads.collection_id` column. The junction is the single source
  of truth.

- **`autoThread.js`**: the N11 auto-thread of the day. It owns:
  - the partial-unique-index invariant (one auto-thread for each `anchor_date`)
  - the generation of the placeholder-bead snapshot
  - the prune-on-empty rule. This rule creates a new auto-thread when the user writes
    again on a date that was cleared before.

- **`recurrence.js`**: pure date math for recurring reminders: `addRecurrence`,
  `nextOccurrence`, `advanceSeries` (catchup-and-advance, which returns
  `{ newDate, newTime, addedFires, reachedMax }`), `computeMissedCount`,
  `formatRule`, `formatProgress`, `anchorDayFor`, `resolveAnchorDay`. Month addition
  and year addition clamp the day: one month added to Jan 31 gives Feb 28 (or 29). The
  clamp uses the anchor day of the series, not the previous occurrence, so the
  subsequent step is Mar 31. The iteration has a limit of 10 000 as a guard against
  bad data.

- **`reminders.js`**: ack-and-advance writes for `scheduled_prompts`. The single
  entry point is `acknowledgeReminder(id)`. `HomeScreen` (banner dismiss path) and
  `EntryEditorScreen` (content-fill path) use it. For a one-shot reminder, it sets
  `acknowledged_at`. For a recurring reminder, it does these steps:
  1. It cancels the previous OS notification.
  2. It advances the cursor past each missed occurrence.
  3. It increments `recurrence_fired`.
  4. It schedules the next OS notification. But if the series reaches the cap during
     catchup, it deactivates the row.

  **Do not write `acknowledged_at` or `recurrence_fired` directly from a screen.**

Do not write inline SQL in a screen against `comments`, `thread_collection_links` or
auto-threads. Go through the applicable service. The invariants are not obvious, and
one central module keeps them correct.
