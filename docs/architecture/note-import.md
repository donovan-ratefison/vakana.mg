# Note import (the capture bridge)

**Status:** **As-built. Shipped in v0.42.0.** The build contract below
was followed fully. All decisions were binding, and the disposition of
each primitive was obeyed.

As-built code:

- `src/services/noteImport.js`
- `src/database/db.js` (the `import_ledger` table)
- `src/screens/HomeScreen.js` (the ⋮ item, the bottom sheet, the focus
  scan, and the notice that reuses `BurstBanner`)

This file is the authoritative as-built contract. Keep it in sync with
the code. The change-checklist group "If you touched note import" lists
the invariants.

The build has three small deviations from the specification. Each one is
recorded inline below:

- The title `Draft` floor is applied at insert (`insertImportedEntry`),
  not in the parser. The editor does the same: it calculates
  `draftTitle` in `save()` (§3 and the §3.1 note).
- A small denylist of binary extensions was added as import hygiene
  (§4.1).
- The `import_ledger.imported_at` column has a
  `DEFAULT (datetime('now'))` as a safety net, although the service
  always writes an explicit ISO string (§7).

**One sentence:** the app can *ingest* a plain-text note that the user
wrote off the device, and make it an uncurated draft entry. Examples of
such a note are an Emacs `org-capture`, a file from a desktop editor, or
a snippet at a URL. Vakana is the mobile **curation** surface. The
desktop is one more **capture** surface. The bridge between them is the
Org-export contract *in the opposite direction*.

This feature is the **inverse of `org-export.md`**, not a generic file
importer. The export already defines the `auto-thread ≅ org-datetree`
mapping. The value of the import is that it reads this mapping as a
*bidirectional* contract. A feature that opens any text file as a note
is a generic Notes-app feature (it fails the swap test). The analysis
below reshapes the request away from that.

---

## 0. Feature-intake analysis (the gate, recorded)

### 0.1 Value through the Vakana lens

**Swap test.** "A Notes app can import a text file" is generic and fails
the test. The file drop is *not* what passes the test. Three properties
pass it, and the contract makes each of them mandatory:

1. **Inverse-of-export.** `orgExport.js` writes an
   `auto_day/week/month` thread as a native `org-datetree`
   (`org-export.md §5`). The import reads the same shape back, with one
   entry for each dated leaf. This is a *lineage* property that no Notes
   app has. The round-trip exists only because the grammar mapping
   exists. This is the **primary idea** (§0.3).
2. **Capture ≠ curation, kept as a boundary.** An imported note arrives
   *uncurated*: no bead, no thread, `highlight_tier 0`. The user
   continues to add beads and chains on the phone, as an intentional
   act. This copies `HomeScreen.openQuickChain`, which writes
   `DEFAULT_BEAD` only on demand. The import does not automate the
   encoding act. The same principle kept S14 a *pre-fill, never a
   stamp*.
3. **Date ladder serves the calendar backbone.** The day of a journal
   entry is essential (foundation 4). The importer resolves a real date.
   It does not put all notes on "today" (§3.2).

**Five foundations:**

- Three-layer model: *amplified*. The import feeds layer 1 only. The
  opt-in cost of layers 2 and 3 does not change.
- Bounded vocabulary: *untouched*. v1 imports no beads.
- Hand-tuned friction: *consistent*. The import pulls on focus. It
  reuses the `Draft <ts>` floor and the focus reload. The folder path
  needs no action for each note.
- Calendar backbone: *amplified* (the date ladder).
- True local-only: *preserved with a documented boundary*. Vakana runs
  no server, hosts nothing, contains no fixed host and sends no
  telemetry. The folder path keeps the bytes on devices that the user
  controls (Syncthing). The user starts the URL path, and the URL path
  accepts all hosts (§4.2, §5 non-goals).

**Four pillars:**

- Lisp/Emacs/TiddlyWiki: *operationalised*. Text files are the
  substrate. The sequence `org-capture` → datetree → ingest completes
  the round-trip of the pillar, which S15 made one-way.
- Memory-Palace / Malagasy-heritage: neutral. The import carries notes,
  not the bead grammar.
- Founder-fit: the maker writes notes at a desktop in Emacs and needs
  them on the phone. This need started the gate.

### 0.2 Issues & true cost (honest)

- **Schema:** one **new table**, `import_ledger`, for idempotency. A new
  table goes in the `CREATE TABLE IF NOT EXISTS` block, **not** in a
  PRAGMA column shim (`README §Common gotchas`). No change to `entries`.
  No new column in v1.
- **Invariants:**
  - Imported entries must reuse the insert semantics of the editor
    (Draft floor, `date` string, timestamps). Do not write a separate
    INSERT (`editor-autosave.md`).
  - The import must write **no bead**. It must not start an
    **auto-thread** create or sync. Thus an imported entry without a
    bead stays out of all chains. The import does not touch the
    `autoThread` invariant (partial-unique index, placeholder bead), so
    that invariant stays correct.
- **The difficult part is idempotency**, not parsing. A new scan of the
  folder on each focus must not import a note again. The true cost is a
  seen-set for each source, with three different strategies (§4.3). This
  is the real engineering work. It is more than a file read.
- **First network call in the app.** Before this feature, Vakana had no
  network identity. The URL source adds `fetch()`. This is a real
  architectural change. It stays in one module. The user starts it. It
  accepts all hosts. A timeout and a size cap limit it. It is not
  telemetry, but it must be *visible* and *singular* in the code (§4.2).
- **UI-minimalism:** no new screen and no persistent chrome. The feature
  uses one overflow item, the existing focus reload, and the existing
  `Draft` and list machinery (§4.4).

### 0.3 Reshape, not rubber-stamp

The first request mixed four things. The contract keeps them apart:

- **Transport** (bytes from off the device to the device): *not the job
  of Vakana*. The source is a synced folder or a URL that the user
  supplies. Syncthing is local-first, with no cloud and no account,
  which agrees with the foundation. Vakana does not run a server, does
  not pair devices, and does not listen on a port. `org-export.md §1`
  came to the same conclusion for export: the user owns the transport.
- **Capture format**: a plain `.org` / `.md` / `.txt` blob. The *only*
  value that Vakana adds is the conversion of a blob into a journal
  entry through the ladders (§3).
- **Import action**: the user starts it, through pull-on-focus and an
  explicit menu item. **Pull, not push.** There is no background
  watcher. The OS limit on background execution made a server on the
  phone fragile, and the same limit applies to a watcher.
- **Curation**: stays on the phone, and is intentionally deferred.

**The primary idea:** *the import is the Org-export contract in the
opposite direction.* The `org-datetree ⇄ auto-thread` mapping is
bidirectional. When the import obeys it as a contract, desktop capture
needs no new concepts. The remaining part (one md or txt file for each
note) is the generic fallback, built on the same core.

### 0.4 Decision

**Build, reshaped. Scope (b):**

- One transport-agnostic **import core**: the parsing contract (§3).
- **Two source adapters** feed the core: a SAF folder reader and a
  host-agnostic URL fetcher (§4).
- **QR is deferred.** It is a convenience on the URL source. Bead-share
  is a related idea but a different feature.
- **v1 is capture-to-draft.** Inline directives for bead, thread and
  mention are a documented **v2 hook** (§6) and are not built now. A
  `{shape,pattern,mood,glyph}` bead in text front-matter is awkward and
  has low value. It also *is* the curation that belongs on the phone.

The decision goes to `change-checklist.md` (a new subsystem group) and
to the release-doc sweep at ship.

---

## 1. Scope and non-goals

### In scope

- Ingest a plain-text blob (`.org`, `.md`, `.markdown`, or a different
  extension) and make zero or more **uncurated draft entries**.
- Two sources on one core: **(A) a synced folder that the user selects
  through SAF**, and **(B) an HTTP(S) URL that the user supplies**.
- The **Org-datetree fan-out**: one `.org` file that contains a datetree
  gives one entry for each dated leaf. This is the primary mapping
  (§3.3), the inverse of `org-export.md §5`. Each other file or blob
  gives exactly one entry.
- Defined fallback ladders resolve the title and the date (§3.1, §3.2).
  The floor is the existing `Draft <YYYYMMDDHHMMSS>` convention.
- Idempotency: a new scan or a new fetch does not import a note again
  (§4.3).
- UI: one overflow item and pull-on-focus. The feature reuses the
  existing draft, list and focus-reload machinery (§4.4).

### Non-goals (explicit, permanent)

- **No transport.** Vakana does not run a server, open a listening
  socket, pair devices, or host a write endpoint. The folder transport
  is the Syncthing or cloud service of the user. The URL must already
  resolve to something that the user arranged.
- **No sync, no round-trip-merge, no reconciliation.** The import goes
  one way, *in*. It is the exact mirror of the export, which goes one
  way, *out* (`org-export.md §1`). These rules apply:
  - An imported note becomes an **independent** entry.
  - Later edits in the app do not go back to the file.
  - When the import finds the same source again, it **skips by hash**.
    It does not patch or merge the entry.
- **No write-back to the source for the datetree path.** The import
  reads the append-only file and does not change it. A change would be a
  hidden export and would conflict with Syncthing.
- **No account, no telemetry, no cloud identity, no LLM.** Foundation 5
  stays true. The user starts the single `fetch()`, and it accepts all
  hosts.
- **No attachment import (v1).** Photos and voice notes are URIs, and
  URIs do not transfer. An import of the bytes is possible in v2 and is
  explicitly out of scope now.
- **No bead/thread/mention directive parsing (v1).** This is a
  documented v2 hook (§6). v1 notes arrive uncurated by design.
- **No background watcher / no push.** Only pull-on-focus and the
  explicit action.
- **Not a generic "open file".** Ingestion always runs the ladders of
  the journal model. A viewer for arbitrary files is not a goal.
- **No QR (v1).** It is a convenience on the URL source, and it is
  deferred.

---

## 2. Where it slots in

This section follows the structure of `org-export.md §2`.

- New service **`src/services/noteImport.js`**. It exports:
  - `parseNote(blob, filename, mtimeMs) → candidates[]` (pure, the core)
  - `importFromFolder(treeUri)`
  - `importFromUrl(url)`
  - the ledger reads and writes

  Screens must not run import SQL inline (services-layer invariant,
  `overview.md §Services layer`).
- **Entry creation reuses the insert path of the editor.** That code
  applies:
  - the Draft-title floor, with the `creationTime` stamp (here, the
    import moment)
  - the `YYYY-MM-DD` string contract of `entries.date`
  - `created_at` and `updated_at`

  Do **not** write a separate INSERT that bypasses the floor or the date
  contract (`editor-autosave.md`, `overview.md §Entry save semantics`).
- An imported entry has `highlight_tier 0` and **no bead**, and is **not
  auto-threaded**. The import does not call `autoThread`. An entry
  without a bead is correctly outside all chains. The day, week or month
  thread forms only when the user later adds a bead on the phone. This
  is the same lazy contract as `openQuickChain`.
- **File I/O:** `expo-file-system` `StorageAccessFramework`, for the
  **read** of the Android directory and the read of each file.
  **Caution:** this is the SAF *read*. It is **not** the retired SAF
  flat *write* for large files (OOM, `content://` mangling; memory
  `backup-saf-folder-save-removed`). Do not confuse the two. Do not use
  the removed write path.
- **URL fetch:** the RN global `fetch()`, in `noteImport.js` **only**.
  It has a hard timeout and a response **size cap**: reject a response
  larger than ~256 KB, to limit a hostile or large URL. It accepts
  a range of text content types. This is the first and only network call
  of the app. It must stay singular and visible.
- **UI entry point:** an `Import notes…` item in the existing ⋮ overflow
  menu of `HomeScreen`. The edge-to-edge `measureInWindow` status-bar
  offset gotcha applies to this menu (`README §Common gotchas`).
  - First run: the user selects a directory through SAF. The app stores
    the tree URI in `expo-secure-store`.
  - After that, the folder scan is part of the **existing focus reload
    of `HomeScreen`** (debounced, one time for each focus).
  - The same menu also offers `Import from URL…`.
  - The imported count reuses the existing focus refresh and banner.
    There is **no new screen and no persistent chrome**
    (`overview.md §List view chrome`).

No change to `entries`. One new table (§7). There is no migration
system, so the new table goes in the `CREATE TABLE IF NOT EXISTS` block
of `initDatabase`.

---

## 3. The parsing contract (transport-agnostic core)

Input: `(blob, filename, mtimeMs)`. Output: an ordered list of
`{ title, date, content }` candidates. The **extension** selects the
format: `.org`→org, `.md`/`.markdown`→md, all other extensions→plain.
Format detection from the content is a documented v2 refinement. v1
trusts the extension, and the *ladders* give a usable result when the
extension is wrong.

### 3.1 Title ladder

| Format | Resolution order |
|---|---|
| `.org` | `#+TITLE:` (case-insensitive) → first top-level `*` heading text → filename |
| `.md` / `.markdown` | first ATX `# H1` → front-matter `title:` → filename |
| plain | filename |
| **Universal floor** (all formats) | if still empty → `Draft <YYYYMMDDHHMMSS>` where the stamp = the **import moment** (the existing stable-draft-title rule, `overview.md §Entry save semantics`) |

`content` is the blob without the consumed title line, front-matter
block or datetree heading path. For the plain format, the full file body
is the content.

### 3.2 Date ladder

`entries.date` is a `YYYY-MM-DD` string (`data-layer.md`). The importer
tries these steps in order and uses the first one that gives a date:

1. **Org datetree leaf date** (the case with more than one entry,
   §3.3).
2. Org `#+DATE:` or md front-matter `date:`, parsed as `YYYY-MM-DD`.
3. A leading `YYYY-MM-DD` prefix in the filename (`2026-05-19-foo.md`,
   the daily-note convention of org-roam and Obsidian).
4. The file `mtimeMs` (folder source): its calendar date.
5. **Floor:** today.

The URL source skips step 4, because it has no mtime. For a URL, a
`Date:`-style hint or the front-matter is covered by steps 1–3. If none
gives a date, the date is today.

### 3.3 One-vs-many (the keystone)

An `.org` blob can have the structure of an **org-datetree**. This is
the exact shape that `orgExport.js` writes for `auto_day/week/month`
(`org-export.md §5`: `* YYYY` / `** YYYY-MM` / `*** YYYY-MM-DD …`
leaves). Such a blob **fans out**:

- Each dated leaf gives one candidate.
- The subtree body of the leaf is the content of the candidate.
- The leaf date is the date of the candidate.

**Each other blob (md, txt, flat org) gives exactly one candidate.**

This reader is the **literal inverse** of the datetree writer of the
export. The contract is bidirectional. If the datetree shape of
`orgExport.js` changes, change this reader at the same time. The shape
is defined one time, in `org-export.md §5`. This document points there
and does not repeat it (pointer discipline, as in
`change-checklist.md`).

---

## 4. Source adapters

### 4.1 (A) SAF folder source

`importFromFolder(treeUri)` does these steps:

1. List the files of the selected directory. Skip the `imported/`
   subfolder (§4.3).
2. For each file that is not in the seen-set, call `parseNote`.
3. Create the entries.
4. Mark the file as seen.

It runs from the focus reload of `HomeScreen` (one time for each focus,
debounced) and from the explicit menu item. The access to the user files
is **read-only**. The single exception is the move to `imported/`
(§4.3).

### 4.2 (B) URL source

`importFromUrl(url)` does these steps:

1. `fetch(url)`, with the timeout and the size cap (§2).
2. Pass the body text to
   `parseNote(text, urlBasenameOrEmpty, null)`.
3. Create the entries.
4. Mark the source as seen by content hash (§4.3).

The URL source is **host-agnostic**. Vakana contains no fixed host and
runs no server. The URL resolves to something that the user arranged: a
raw gist link, a public cloud file, a self-hosted endpoint, or a
temporary LAN `http.server`.

The folder path stays the **private backbone**. The URL path is the
**ad-hoc** complement. It is only as private and as durable as the host
that the user selects. The user makes this decision for each use, and
the user guide states it at ship.

### 4.3 Idempotency (the part with teeth)

There are three strategies, one for each mode:

- **Append-only datetree file** (one `.org` file that grows as the user
  adds notes with `org-capture`): a **content hash for each leaf**.
  Calculate the SHA of the normalised text of the leaf subtree. If the
  hash is in the ledger, the leaf is already imported, and the import
  skips it. **Do not move or change the file.** The file continues to
  grow. A change would break the no-write-back non-goal and would
  conflict with Syncthing.
- **One-file-per-note** (folder): after a **successful** import, **move
  the file into an `imported/` subfolder** of the same selected
  directory. The move is visible and clear, and with Syncthing the
  desktop sees that the app consumed the note. If the move is not
  possible (a SAF or permission problem), **fall back** to a ledger row
  with the key `(relativePath, size, mtimeMs)`.
- **URL**: a **content hash** for each URL. The same URL with the same
  bytes does nothing. The same URL with changed bytes gives a new entry.
  A URL is not a stable identity. This is documented behaviour, not a
  bug.

All three strategies store their state in the `import_ledger` table
through `noteImport.js`. The ledger is the only mutable state that the
import owns.

### 4.4 Surfacing

There is no screen. `Import notes…` in the ⋮ menu of `HomeScreen` opens
a small sheet with two items:

- *Choose / change synced folder*: the SAF picker. The app stores the
  URI in secure-store.
- *Import from a URL…*: a text field. The QR scan is deferred (§0.4).

The folder scan also runs silently on `HomeScreen` focus. The new
entries appear as drafts in the usual list through the **existing**
focus reload. A small "N notes imported" confirmation reuses the
existing banner. After that, the user does the curation (bead, thread)
with the usual gestures on the phone.

---

## 5. Primitive disposition (every primitive, like `org-export.md`)

| Primitive | Disposition |
|---|---|
| **entry** | created (uncurated draft; the insert path of the editor is reused) |
| **title / date / content** | resolved by the ladders (§3) |
| **bead** | **non-goal v1**: the import does not write a bead (curation is on the phone) |
| **thread / auto-thread** | **non-goal v1**: the import does not create or sync one (an entry without a bead stays out of all chains) |
| **comment / comment-reminder** | non-goal (not present in a captured note) |
| **mention** | **v2 hook** (§6): directive parsing is deferred |
| **highlight tier** | always `0` on import |
| **attachments (photo/voice)** | **non-goal v1**: URIs do not transfer |
| **org-datetree** | **mapped, keystone**: inverse of `org-export.md §5` (§3.3) |
| **transport / sync / round-trip** | **permanent non-goal** (§1) |

---

## 6. v2 hooks (documented, not built)

- **Inline curation directives**: `#+VAKANA_THREAD:`, or front-matter
  `thread:` / `mentions:`, so that a captured note can declare its
  position in advance. The bead is intentionally excluded, also from v2,
  unless a short and honest text encoding appears. A
  `{shape,pattern,mood,glyph}` tuple in front-matter moves the app
  toward a generic product. It is not the value of the feature.
- **QR scanner** that feeds the URL source (`expo-camera`).
- **Content-sniff** format detection (for example, a `.txt` file that
  contains Org text).
- **Attachment ingest** (copy the referenced local files into the
  entry).
- **`entries.source` provenance column** (nullable, through a PRAGMA
  shim), if "imported" must become visible or filterable.

Each hook adds to this contract. None changes the core or the
non-goals.

---

## 7. Schema

There is one new table. It goes in the `CREATE TABLE IF NOT EXISTS`
block of `initDatabase`. A new table goes in the main block, **not** in
a PRAGMA column shim. The shim rule is for new *columns* on existing
tables.

```sql
CREATE TABLE IF NOT EXISTS import_ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_kind TEXT NOT NULL,         -- 'folder' | 'url'
  key         TEXT NOT NULL,         -- relPath|size|mtime  OR  url
  hash        TEXT NOT NULL,         -- content / leaf-subtree SHA
  entry_id    INTEGER,               -- the created entry (nullable; no FK: entry may be deleted)
  imported_at TEXT NOT NULL          -- ISO; this app's own writes are ISO (cf. comments.remind_at note)
);
CREATE INDEX IF NOT EXISTS idx_import_ledger_hash ON import_ledger(hash);
```

There is no FK on `entry_id`. The user can delete the entry, and the
ledger row must stay after that. A deleted import must not be imported
again. No change to `entries`.

---

## 8. Invariant summary (feeds the change-checklist)

1. Imported entries must use the **editor insert path** (Draft floor,
   `YYYY-MM-DD` date string, timestamps). Do not write a separate
   INSERT.
2. The import must write **no bead**. It must not start an
   **auto-thread** create or sync. An imported entry without a bead
   stays out of all chains.
3. **One-way only**: no write-back and no merge to the source. A second
   import of the same source is a hash **skip**, not a patch.
4. Ledger reads and writes must go through `services/noteImport.js`. Do
   not put the SQL inline in a screen. `import_ledger` is a **new table
   in the CREATE block**, not a column shim.
5. The Org **datetree reader must stay the exact inverse** of the
   datetree writer of `orgExport.js` (`org-export.md §5`). If you change
   one, change the other.
6. Use the SAF directory **read** only. Do not use the retired SAF
   flat-write for large files.
7. The URL `fetch()` must stay the **only** network call. It must be in
   `noteImport.js` only. A timeout and a size cap must limit it. It must
   stay host-agnostic (no fixed host in the code, no telemetry).
