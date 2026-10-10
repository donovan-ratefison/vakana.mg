# Org-mode export

**Status:** Specified. Not implemented. This document is the build
contract. It gives a disposition for each Vakana primitive: mapped, or
an explicit non-goal. When the feature ships, this file becomes an
as-built document and the release-doc sweep runs.

**One sentence:** the app can write a thread as a `.zip` that contains
an Emacs **Org-mode** representation of the thread, the rendered bead
assets and the copied attachments. The user can then use the journal in
Org-agenda, org-roam or org-ql on the desktop. Vakana is the mobile,
visual capture surface. Org is the textual, programmable archive.

This is a **lineage feature**, not a generic exporter. It puts the
Lisp/Emacs/TiddlyWiki pillar into operation. Its value is the *fidelity
of the grammar mapping*. A prose dump without that mapping is a generic
feature, and this contract rejects it below.

---

## 1. Scope and non-goals

### In scope

- Export **one thread** to one `.zip`. This works for each
  `threads.kind`: `user`, `auto_day`, `auto_week`, `auto_month`.
- A **user thread** becomes a flat Org outline.
- An **auto-thread** becomes a native **`org-datetree`**. This is the
  primary mapping (§5).
- The export maps these items with as little loss as possible:
  - the thread metadata
  - the bead chain (snapshot grammar and rendered SVG)
  - the entries
  - the Markdown body of each entry, through a defined Markdown→Org
    transform (§7)
  - the photos and the voice notes
  - the comments and the comment-reminders
  - the mentions
  - the section labels
  - the highlight tier
  - the privacy state
  - the collections
  - the placeholder beads and the orphan beads
- These optional modes have a full specification: *include linked
  threads* (§9.2), *include private content* (§8), *reproducible* (§10).
- Delivery: give the `.zip` to the OS share sheet through
  `expo-sharing`. The responsibility of the app stops there.

### Non-goals (explicit, permanent)

- **No transport.** No Bluetooth, no SFTP, no HTTP, no device pairing.
  The zip goes to `Sharing.shareAsync`. The user selects the channel
  (Syncthing, Nearby, email, USB). The app code does not.
- **No sync, no round-trip, no import-back.** The export goes one way
  and is final. An edit of the Org file on the desktop does not return
  to the app. The project will not build reconciliation or merge.
- **No live link.** The zip is a snapshot of one moment. A second export
  makes a new, deterministic zip (§10). It does not patch an earlier
  zip.
- **Not the curated article.** `thread_articles` is the HTML/PDF
  composition overlay (`hidden_bead_ids`, `bead_overrides`, `intro`,
  `template`). It is a *presentation* concern, and the Org export
  **ignores** it. The Org export is a fidelity archive of the *raw
  thread*: all beads, the real titles, the full bodies. An export of the
  composed article as Org prose is a different idea and is out of scope
  (§13).
- **Not app config.** `bead_presets` and the list of
  `thread_collections` are not thread content. The export writes only
  the *membership* of a thread in collections, as metadata (§4).
  `scheduled_prompts` are global and do not belong to a thread, so they
  are out of scope. §13 gives their Org repeater mapping as a future
  idea only.

---

## 2. Where it slots in

The export uses the per-thread export pipeline in
`src/services/threadArticles.js`, which makes Markdown, HTML and PDF
today. Org is a new format beside them.

- New module `src/services/orgExport.js`. It exports
  `exportThreadOrg(threadId, options)`.
- The module uses `getArticleData(threadId)` (`threadArticles.js:230`)
  to load the thread, the sections, the comments and the photo URIs.
  **But** it ignores the `article`, override and hidden fields (see the
  non-goals in §1). It must read the *raw* `thread_beads` rows, not the
  article-filtered `sections`. If `getArticleData` cannot give the
  unfiltered chain, add a second loader `getThreadExportData(threadId)`
  in `orgExport.js`. That loader queries `thread_beads` directly, with a
  left join on `entries`.
- **Zip:** `jszip ^3.10.1`, which is already a dependency.
- **File I/O:** the `expo-file-system` legacy API
  (`expo-file-system/legacy`): `cacheDirectory`, `writeAsStringAsync`,
  `readAsStringAsync` (`EncodingType.Base64` for binary data).
- **Photo bytes:** use `prepPhotoForExport()` (`threadArticles.js:111`)
  and `expo-image-manipulator` to resize and encode. Write the bytes
  into the zip as files, not as data URIs.
- **Share:** `Sharing.shareAsync(zipUri, { mimeType: 'application/zip',
  UTI: 'public.zip-archive', dialogTitle: 'Export thread to Org' })`.
- **UI entry point:** add `Org (Emacs) · .zip` to the export format
  chooser in the export flow of the thread detail, beside HTML, PDF and
  MD. §11 gives the options UX.

No schema changes. No new tables. No migration.

---

## 3. Zip layout

Archive name: `<slug>.zip`, where `slug = slugify(thread.name) ||
'thread-' + thread.id`. Use `slugify` from `threadArticles.js:77`.

The archive has one top-level folder, named with the slug. Thus the
archive unpacks into one folder:

```
<slug>/
  <slug>.org            # the thread (§4–§6)
  chain.svg             # the whole bead chain as one image (§6.3)
  README.org            # what this is, the property contract, recipes (§12)
  vakana.el             # elisp helper (§12), included unless toggled off
  assets/
    bead-<beadId>.svg          # one per thread_beads row (§6.1)
    photo-<entryId>-<n>.jpg    # copied, resized photo bytes (§6.4)
    voice-<entryId>-<n>.m4a    # copied voice-note bytes, original ext (§6.4)
```

- `<beadId>` is `thread_beads.id`.
- `<entryId>` is `entries.id`.
- `<n>` is the 1-based index in the ordered attachments of that entry.

In *include-linked-threads* mode (§9.2), the archive root has one
`<slug-N>.org` for each included thread. All of them share one
`assets/` folder.

Encoding for all files: **UTF-8, LF newlines, no BOM**.

---

## 4. Org file preamble

The `.org` file starts with keywords. Each keyword uses an uppercase
`#+` form and has its own line:

```org
#+TITLE: <thread.name>
#+SUBTITLE: <thread.description>                 ; omitted if empty
#+FILETAGS: :vakana:<one tag per collection, slugified>:
#+STARTUP: showeverything inlineimages
#+TODO: | DONE                                   ; file-scoped; resolved comments only (§6.5)
#+VAKANA_SCHEMA: 3
#+VAKANA_APP_VERSION: <package.json version at export>
#+VAKANA_EXPORTED_AT: [<inactive timestamp>]      ; omitted in reproducible mode (§10)
#+VAKANA_THREAD_ID: <threads.id>
#+VAKANA_THREAD_KIND: user|auto_day|auto_week|auto_month
#+VAKANA_ANCHOR_KIND: day|week|month              ; auto-threads only (threads.anchor_kind)
#+VAKANA_ANCHOR_DATE: <YYYY-MM-DD>                ; auto-threads only (threads.anchor_date)
#+VAKANA_COLLECTIONS: <name; name; …>             ; omitted if none (via thread_collection_links)
#+VAKANA_THREAD_CREATED_AT: [<ts>]
#+VAKANA_THREAD_UPDATED_AT: [<ts>]
#+PROPERTY: header-args :eval never
```

`#+VAKANA_SCHEMA` is the contract version. A change to the property
names or to the structure must increase it. Importers branch on it.

- **`1`** shipped in v0.28.0.
- **`2`** (v0.28.1) removed `:BEAD_SHAPE_MEANING:`. The app gives no
  meaning to shapes, so the export must not write that property.
- **`3`** (v0.33.0) added the mapping from a resolved comment to `DONE`.
  This is the first TODO-state keyword that the format writes. The same
  version added `:VAKANA_RESOLVED_AT:` and the file-scoped
  `#+TODO: | DONE` declaration (§6.5).

With the collection tags, `org-ql` and the agenda can filter a journal
by collection without the junction table of the app. The membership
goes with the file as data.

---

## 5. Body structure

### 5.1 User thread → flat outline

The export writes the beads in ascending `thread_beads.position` order.
Each bead is a **level-1 heading** (`*`), unless a section label groups
it (§5.3).

### 5.2 Auto-thread → org-datetree (keystone)

`auto_day`, `auto_week` and `auto_month` threads become a strict
**`org-datetree`**. Thus org-journal and org-agenda can use the file
without changes. The heading text must match `org-datetree` *exactly*.
This is mandatory, because `org-datetree-find-date-create` parses these
headings literally:

```org
* 2026
** 2026-05 May
*** 2026-05-12 Tuesday
```

- Year node: `* %Y`
- Month node: `** %Y-%m %B` (English month name, the Org default)
- Day node: `*** %Y-%m-%d %A` (English weekday name)

Each bead or entry for a calendar date becomes a **level-4 heading**
(`****`) below its day node. The export groups by `entries.date`. The
order in a day follows the `chronologicalPosition` encoding of the chain
(`autoThread.js:113`). That encoding sorts by date and then by id, so
`position` order is correct. `auto_day` gives one day node.
`auto_week` and `auto_month` give more than one.

The datetree is sparse, as in org-journal. It has nodes only for the
dates that have beads.

### 5.3 Section labels → grouping headings

`thread_beads.section_label` is the chapter tag (pendant tag) of the
app. It is a divider. Algorithm:

1. When a bead has a non-null `section_label`, write a heading one level
   **above** the bead level. The label is the heading title.
2. Put that bead and all subsequent beads below this heading.
3. Stop at the next bead that has a different `section_label`.

The label heading has the property `:VAKANA_SECTION_LABEL: t`. In
datetree mode, the label heading goes *inside* the day node, above the
`****` of the bead. The label becomes `****` and the beads become
`*****`. The beads before the first labelled bead stay at the base
level, without a label heading.

### 5.4 Per-bead heading

Resolve the heading title in this order:

1. If `thread_beads.entry_id IS NULL`, the title is `(removed entry)`.
   This is an orphan bead: the entry was deleted and the faded snapshot
   bead stays.
2. If the entry is private and the export excludes private content
   (§8), the title is the masked title (`utils/privacy` `MASKED_TITLE`).
3. If not, the title is `entries.title`, trimmed.
4. If the trimmed title is empty, the title is `Untitled`.

Org tags on the heading:

- `:tier1:` or `:tier2:` from `entries.highlight_tier` (1 or 2). Tier 0
  has no tag.
- `:private:` if `is_private` is set.
- `:orphan:` if `entry_id` is null.
- `:placeholder:` if the snapshot is a weekday placeholder bead of an
  auto-thread (`autoThread.js:88`). To detect it: the bead came from
  `placeholderBeadForDate`. That is, the entry has no `bead_shape` and
  the thread is an auto-thread.

Append the tags after the title in the Org form `:a:b:`.

Immediately after the heading comes a `:PROPERTIES:` drawer. Each key is
always present unless the block marks it as optional:

```org
:PROPERTIES:
:ID:                    vakana-<exportRunId>-thread-<threadId>-bead-<beadId>
:VAKANA_BEAD_ID:        <thread_beads.id>
:VAKANA_ENTRY_ID:       <entries.id>            ; omitted if orphan
:VAKANA_POSITION:       <thread_beads.position>
:BEAD_SHAPE:            <snapshot_shape>          ; geometry key only, no imposed meaning
:BEAD_PATTERN:          <snapshot_pattern>
:BEAD_MOOD:             <snapshot_mood>
:BEAD_MOOD_LABEL:       <MOOD_BY_KEY label, e.g. "Ocean">
:BEAD_MOOD_COLOR:       <MOOD_BY_KEY hex, e.g. #4f88a8>
:BEAD_GLYPH:            <snapshot_glyph>        ; raw, may be empty / multi-char Unicode
:BEAD_SVG:              assets/bead-<beadId>.svg
:HIGHLIGHT_TIER:        0|1|2
:VAKANA_DATE:           <entries.date YYYY-MM-DD>     ; omitted if orphan
:VAKANA_TIME:           <entries.time HH:MM>          ; only if the entry has a time
:VAKANA_PRIVATE:        t                       ; only if is_private
:VAKANA_PLACEHOLDER:    t                       ; only if placeholder bead
:VAKANA_ORPHAN:         t                       ; only if entry_id null
:VAKANA_CREATED_AT:     [<ts>]                  ; entries.created_at, omitted if orphan
:VAKANA_UPDATED_AT:     [<ts>]                  ; entries.updated_at, omitted if orphan
:END:
```

The source for all `BEAD_*` properties and for the SVG is the bead
snapshot (`snapshot_shape/pattern/mood/glyph` on `thread_beads`). Do
**not** use the live `entries.bead_*` values. The snapshot is what the
chain *is*: the app froze it when the user added the bead.

`BEAD_SHAPE` is the raw geometry key. Vakana gives **no** meaning to
shapes. The shapes are a personal encoding system, not a taxonomy. Thus
there is no property that maps a shape to a meaning, and this is
intentional. The neutral geometry names and the mood label and color
come from `src/beads/types.js` (`SHAPE_GEOMETRY`, `MOOD_BY_KEY`).

Then write these items, in this order:

1. An **inactive timestamp** line for the entry date:
   `[<YYYY-MM-DD Day>]`, for example `[2026-05-12 Tue]`. Use the Org day
   abbreviation. When the entry has an optional time-of-day
   (`entries.time`), append it in the Org form:
   `[2026-05-12 Tue 14:30]`. Do not write this line for orphan beads.
   The datetree reader of the note import removes a leading timestamp
   with a regex (`noteImport.js:343`) that ends in `.*\]`. Thus the
   reader already accepts the time. The round-trip date continues to
   come from `:VAKANA_DATE:` or from the day node.
2. The bead image: `[[file:assets/bead-<beadId>.svg]]` on its own line.
   Emacs shows it inline because of `#+STARTUP: inlineimages`. Vakana
   supplies the glyph that Emacs cannot draw.
3. The entry **body**: `entries.content` after the Markdown→Org
   transform (§7). For an orphan bead or an empty entry, write no body.
4. Sub-headings, one level below the bead heading. Write each one only
   if it has content: `Photos`, `Voice notes`, `Comments`, `Mentions`
   (§6.4, §6.5).

---

## 6. Assets

### 6.1 Per-bead SVG (`assets/bead-<beadId>.svg`)

This is a self-contained SVG file that renders the snapshot bead. There
is one file for each `thread_beads` row. The geometry must match the
render on the device. Use the shape math from
`src/components/BeadView.js` and from the list-card `ChainPreview`.
Requirements:

- Canvas: square, 256×256 viewBox, transparent background.
- **Silhouette** for each of the 8 `shape` values (`types.js:5`):
  `square, round, oval, lozenge, bar, dot, decagon, flower`. Use the
  exact geometry from `BeadView`. For example: the decagon is an
  inscribed regular 10-gon, the flower is a union of three rotated
  capsules, and the lozenge is a square rotated by 45°.
- **Fill**: `MOOD_BY_KEY[mood].color` (hex, `types.js:33`).
- **Pattern overlay** for each of the 8 `pattern` values
  (`PATTERN_KEYS:31`): `solid, striped, diagonal, dotted, floral,
  dashed, checkered, circle`. Use the same overlays that `BeadView`
  draws, and clip them to the silhouette.
- **Glyph**: centered, with fill `MOOD_BY_KEY[mood].text` (the contrast
  color). Apply the −45° glyph counter-rotation for the lozenge and the
  multi-char-clockwise rule. Both rules are already in `BeadView`. The
  SVG must match the app exactly.

Add a new pure helper `renderBeadSvg(bead) -> string` in `orgExport.js`
or in `src/beads/svg.js`. The helper must have no React or native
dependencies. It uses string templates only, so that it runs in the
export path.

**As-built note (v0.31.0):** in the first release, `svg.js` drew only
the silhouettes and the glyph. The **pattern overlays were deferred**
(each bead used solid), and the flower was an approximation (three
ellipses). That follow-up is **closed**. `src/beads/svg.js` is now the
single faithful renderer for *all* exports: Org, slides, and the
HTML/PDF/Markdown article chain through the `svgExport.js` shim. The
current state:

- All 8 pattern overlays are implemented and clipped to the silhouette.
- The flower is the true union of three capsules.
- The lozenge is a rounded square rotated by 45°.
- Clip-path ids are unique for each bead. Thus many inline beads in one
  document do not collide.

§6.1 is thus correct as written. No fidelity gap remains for the
patterns or for the flower.

### 6.2 `chain.svg`

`chain.svg` is the full bead chain as one horizontal SVG. It shows the
same sequence that the app draws. The `.org` file refers to it one time
near the top: `[[file:chain.svg]]`. Put the link below a `* The thread`
heading before the beads, or in the preamble area. It gives the Emacs
reader a view of the full chain, which Org cannot produce. To build it,
call `renderBeadSvg` for each bead and put the beads along a connector.

### 6.3 Bead image placement

Each bead heading shows its own `assets/bead-<beadId>.svg` inline (§5.4
step 2). `chain.svg` appears one time, at the top.

### 6.4 Photos & voice notes

The database holds photos and voice notes as **URIs only**
(`entry_photos.uri`, `entry_voice_notes.uri`), and the OS can remove the
bytes from the cache. A URI has no use on the desktop. Thus the export
copies the *bytes* into the zip:

- Photos: pass each photo through `prepPhotoForExport()` (resize to
  2000px maximum, JPEG q0.85). This is the same budget as the HTML
  export, and it limits the zip size. Write the result to
  `assets/photo-<entryId>-<n>.jpg`. Process the photos in sequence, not
  with `Promise.all`. This prevents a heap overflow and follows the
  pattern at `threadArticles.js:111`.
- Voice notes: call `readAsStringAsync(uri, Base64)` and write
  `assets/voice-<entryId>-<n>.<ext>`. Keep the original extension (the
  default is `.m4a`). Do not transcode.
- If a source file is missing or the OS removed it, skip that asset. Write the Org comment
  line `# (asset unavailable: <original filename>)` in its position. Do
  not stop the export.

Below the bead heading:

```org
** Photos
[[file:assets/photo-123-1.jpg]]
[[file:assets/photo-123-2.jpg]]

** Voice notes
- [[file:assets/voice-123-1.m4a]] · 0:42      ; duration from entry_voice_notes.duration (ms → m:ss)
```

The heading level is always one level below the bead. That is `***` or
`*****` in datetree and section contexts.

### 6.5 Comments & comment-reminders → org-agenda items

The export takes the `comments` rows where `parent_kind='entry'` and
`parent_id=entries.id`. It sorts them by `created_at` and nests them by
`parent_id`. When the `parent_id` of a comment refers to a different
comment id, that comment goes one level deeper.

```org
** Comments
*** Comment: [<created_at ts>]                   ; "*** DONE Comment: …" if resolved
<comment.body via Markdown→Org §7>
:PROPERTIES:
:VAKANA_COMMENT_ID: <id>
:VAKANA_EDITED_AT: [<ts>]        ; only if edited_at set
:VAKANA_REMINDED_AT: [<ts>]      ; only if acknowledged (see below)
:VAKANA_RESOLVED_AT: [<ts>]      ; only if resolved_at set
:END:
```

**Resolved comment → `DONE` (the closed comment loop).** A resolved
comment has `resolved_at` set. It is the comment-level equivalent of a
closed thread (`threads.closed_at`, the Loop feature). These rules
apply:

- The headline of a resolved comment gets the `DONE` keyword before the
  word `Comment`. The comment also gets a `:VAKANA_RESOLVED_AT: [<ts>]`
  property.
- `DONE` is the **first and only TODO-state keyword** that the format
  writes. The file declares it with `#+TODO: | DONE` (§4). Thus Emacs
  recognizes it for all values of the global `org-todo-keywords` of the
  reader.
- **Open comments have no keyword. This is intentional.** Most comments
  are not tasks. A `TODO Comment` on each one would fill `org-agenda`.
  Only the loops that the user closed show as `DONE`.
- The output is deterministic and reproducible (§10). `resolved_at` is a
  stored value (`datetime('now')`, in the space form, as `reminded_at`).
  The export does not calculate it from the current time. Thus a second
  export gives the same bytes.
- `resolved_at` is independent of the reminder columns. To resolve a
  comment does not schedule a reminder and does not acknowledge one.
- **No structural change.** A resolved comment has the same heading
  level, nesting, drawer and body as an open comment. Only the keyword
  token and one property line are different.

Comment-**reminders** connect the self-ping ladder of Vakana to
`org-agenda`:

- `remind_at` set and `reminded_at` null (pending): add an **active
  timestamp**, so that the reminder shows in the agenda. If the reminder
  is in the future, also write `SCHEDULED: <active ts>`. The format is
  `<YYYY-MM-DD Day HH:MM>`. Convert the stored ISO `remind_at` value.
  **Note:** the ISO form and the space form of a datetime do not compare
  correctly as strings (`comments.js:14`).
- `remind_at` set and `reminded_at` set (acknowledged): write an
  inactive timestamp and a `:VAKANA_REMINDED_AT: [<ts>]` property. Do
  not write `SCHEDULED`.

Thread-level comments (`parent_kind='thread'`, `parent_id=thread.id`) go
below one heading at the top of the file, `* Thread notes`. This heading
comes before the beads or before the datetree. The comment format is the
same.

### 6.6 Mentions → org links (org-roam graph)

The `entry_thread_links` rows of the entry are the mentions (the soft
cross-references, `threadMembership.js`). They go below a `Mentions`
sub-heading:

```org
** Mentions
- [[id:vakana-thread-<mentionedThreadId>][<mentioned thread name>]]
```

The `id:` target is the deterministic ID that a different Vakana Org
export gives to the file or root of that thread (§9.1). If the mentioned
thread is **not** in this zip, the link has no target. This is
intentional. The description (the thread name) stays readable for a
person. The link resolves automatically after the user also exports that
thread, or in include-linked-threads mode (§9.2). Thus the mentions
become an org-roam graph that the user can navigate.

---

## 7. Markdown → Org body transform

The bodies of Vakana entries and comments are Markdown. The app renders
them with `src/components/MarkdownInline.js`. Org is not Markdown. Thus
the export **transforms the body to Org** and does not copy it raw. This
transform is the difference between a lineage feature and a prose dump.

Use the inline grammar that the app already has:

- the token kinds of `MarkdownInline.parseInline`: text, bold, italic,
  strike, code, link
- the block markers that `blockify` already removes

Implement `markdownToOrg(md, headingBaseLevel) -> string`.

The table below is the exact rule set. It is the contract:

| Markdown | Org |
|---|---|
| `**x**` / `__x__` (bold) | `*x*` |
| `*x*` / `_x_` (italic) | `/x/` |
| `~~x~~` (strike) | `+x+` |
| `` `x` `` (inline code) | `=x=` |
| ```` ```lang\n…\n``` ```` (fence) | `#+begin_src lang` … `#+end_src` (no lang → `#+begin_example`/`#+end_example`) |
| `[t](u)` | `[[u][t]]` |
| `![alt](u)` | `[[u]]` (alt dropped; external/remote URLs kept verbatim) |
| `# … ######` (ATX heading) | demoted: a level-`k` MD heading → an Org heading at `headingBaseLevel + k` stars (so the `#` body of an entry does not collide with its bead heading and does not go above it) |
| `- ` / `* ` / `+ ` (bullet) | `- ` (Org plain list) |
| `1. ` (ordered) | `1. ` (Org ordered list; renumber from 1) |
| `> ` (blockquote) | `#+begin_quote` … `#+end_quote` |
| `---` / `***` (hr) | `-----` |
| line with leading `*` or `#` that is *not* one of the above | escape with Org comma: `,*…` / leave `#` (Org only needs `,*`/`,#+` at col 0) |
| hard line break (two trailing spaces) | `\\` then newline |
| everything else | verbatim |

`headingBaseLevel` is the level of the bead heading + 1. Thus the
demoted MD headings stay *below* the entry. They cannot break the
outline or the datetree. Keep the blank lines. Collapse a run of 3 or
more blank lines to 1, as `blockify` does. The output is UTF-8 Org text.
No line has trailing whitespace.

The comment bodies (§6.5) use the same transform. For them,
`headingBaseLevel` is the level of the comment heading + 1.

---

## 8. Privacy

`entries.is_private` is a mask in the app against a person who looks at
the screen. It is not encryption (`utils/auth.js`: a PIN, no
cryptography). The export is the archive of the user, for the machine of
the user. The **Include private entries** option (§11) controls the
behavior. The default is **on**.

- **On (default):**
  - Private entries export with the full title and body.
  - They get `:VAKANA_PRIVATE: t` and the `:private:` tag.
  - They also get the Org tag **`:crypt:`**. With it, the user can
    encrypt the subtree in Emacs with `org-encrypt-entry` or
    `org-crypt`. The app does not encrypt. It only supplies the tag that
    Emacs uses.
  - The bead, the SVG and the metadata always export. The visual
    content of the chain is not secret.
- **Off:** each private entry becomes a stub that keeps its position.
  - The stub has the masked title.
  - The stub keeps `:private:` and `:VAKANA_PRIVATE:`.
  - The stub keeps the bead SVG and the bead properties.
  - The export **omits the body, the photos, the voice notes and the
    comments**.
  - The export adds the line `# (private: body excluded at export)`.

---

## 9. Identity & linking

### 9.1 Deterministic IDs

Deterministic IDs let a second export give a clean diff, and let
org-roam remove duplicates:

- The thread root gets `:ID: vakana-thread-<threadId>`. This ID is the
  same for all exports of that thread, permanently.
- Each bead heading gets `:ID: vakana-thread-<threadId>-bead-<beadId>`.
  `thread_beads.id` is stable.
- These IDs are **not** the random `exportRunId`. They come only from
  database ids. Thus the same thread always gives the same IDs, which is
  stable in git (§10). `exportRunId` appears only in the
  `#+VAKANA_EXPORTED_AT` provenance, never in `:ID:`.
- The position of the thread `:ID:` needs a rule:
  - A `:PROPERTIES:` block with `:ID: vakana-thread-<threadId>` before
    `#+TITLE` is **not** valid Org.
  - A leading `:PROPERTIES:` drawer below a synthetic first heading is
    also not wanted.
  - Resolution: always write the thread ID as `#+VAKANA_THREAD_ID:`
    (§4).
  - In include-linked-threads mode only, also write a real `:ID:` in a
    top heading without content, `* ${thread.name}`. Cross-file `id:`
    links need that target.
  - In single-thread mode, the file-level `#+VAKANA_THREAD_ID` is
    sufficient. The bead `:ID:` values hold the graph.

### 9.2 Include linked threads (option, default off)

When this option is set, the export also writes the mentioned **user**
threads:

- It follows the mentions through `entry_thread_links`, and then the
  mentions of those threads, breadth-first.
- The maximum depth is 2. This limits the size.
- Each such thread becomes its own `<slug-N>.org` at the archive root.
  All files share one `assets/` folder.
- The cross-thread `[[id:…]]` links then resolve in the zip. The result
  is a self-contained org-roam graph.
- The export does not follow mentions into auto-threads. The app derives
  auto-threads. The user does not write them.

The default is off, to keep the usual zip small and predictable.

---

## 10. Determinism (git-friendliness)

Users of tools for thought keep their Org files in git. The same thread
with the same database state must give a **byte-identical** `.org` file
and assets. The only exception is `#+VAKANA_EXPORTED_AT`.

The **Reproducible** option (§11, default off) omits
`#+VAKANA_EXPORTED_AT` and `#+VAKANA_APP_VERSION`. The output then
depends only on the content. A second export into a repository shows a
diff of only the changes in the journal.

Requirements:

- stable order (always `thread_beads.position`)
- stable IDs (§9.1)
- fixed key order in the property drawers
- no random temporary names in the zip
- sorted asset output

---

## 11. UX

The thread export sheet is **format-first**. It has two steps in one
bottom sheet:

1. Select a format: Org, Markdown, HTML or PDF.
2. Use the detail panel of that format. The panel shows the options and
   then the destination as the last action: **Share** or **Save to
   device**. **Save to device** uses SAF on Android and the share sheet
   on iOS. It stays local, with no transport.

This sheet replaces the old flat matrix of format × destination. The
options of each format now have their own panel. Before, they were all
added to one row.

Org panel options:

- **Include private entries**: default **on** (§8).
- **Include `vakana.el`**: default **on** (§12).
- **Reproducible (omit export time/version)**: default **off** (§10).

The linked-threads option (§9.2) is not built, so the sheet does **not**
show it.

As built, the sheet is the shared `ThreadExportSheet`. The Thread Detail
header opens it directly. The composer does not host it. The HTML and
PDF panels have a **Customize layout** row that opens the composer as a
sub-step. The user selects the template in the composer body, and the
app stores it on the article. Thus the panel does **not** show the
template selection again. The read-only template label renders only when
a caller passes `templateLabel`, and the thread-view path does not pass
it. Markdown has no options.

Progress and completion use the existing export overlay. When one asset
fails, the export continues. At the end, the app shows one summary alert
("N attachments were not available. The export skipped the missing attachments.").

---

## 12. In-zip companions

### `README.org`

The zip always includes this file. Its outline:

- What the archive is: a one-way Org snapshot of a Vakana thread, not
  synced.
- The `#+VAKANA_SCHEMA` contract and the full list of property keys with
  their meanings (§4, §5.4). Thus the file describes itself.
- Recipes:
  - Add the file to `org-agenda-files`.
  - Run `org-id-update-id-locations` for the mention graph.
  - `org-ql` examples, for example all headings with
    `:BEAD_SHAPE: lozenge`.
  - For auto-threads: the file is an org-datetree, so the user can
    point `org-journal` or capture at it.
  - The `:crypt:` note for private subtrees.
- The bead vocabulary from `src/beads/types.js`: 8 shapes, 8 moods with
  their colors, and 8 patterns. The shapes are **neutral geometry
  only**. Vakana gives no meaning to a shape. The user assigns it. With
  this vocabulary, a person can read the archive without the app.

### `vakana.el` (toggle, default **on**)

The export writes this file unless the user turns off **Include
`vakana.el`** in the Org panel. The file is a convenience and uses no
network. It sets `org-image-actual-width` and supplies an interactive
`vakana-add-to-agenda` command.

The default is on for two reasons: the elisp file is an intentional
signal to Emacs users, and it is small. The format-first panel
gives the toggle a visible position. The first design was a hidden flag
with the default off, and the result was that the file did not ship. The
user decides to load the file or not. Nothing in the `.org` file depends
on it.

---

## 13. Future / out of scope (sketches only: do not build now)

- **Reminders → Org repeaters.** The recurrence of `scheduled_prompts`
  (`recurrence_kind`/`recurrence_every`) maps directly to Org repeaters
  (`+1w`, `++1m`, `.+1d`), and `recurrence_max` maps to a counter. This
  is a different feature ("export reminders → `agenda.org`"). It is
  *not* part of the thread export. This document records it only to show
  how the features can combine.
- **Composed-article-as-Org.** Export `thread_articles` (curated, with
  hidden beads, overrides, intro and template) as Org *prose*. This is a
  different artifact from the fidelity archive in this document.
- **Whole-collection export.** A folder of thread `.org` files for one
  `thread_collections` bucket. The cross-links resolve as in §9.2. The
  per-thread specification in this document is the unit. The collection
  mode is a thin wrapper, to be defined later.

---

## 14. Coverage matrix (nothing left out)

Each primitive and its disposition:

| Primitive (source) | Disposition |
|---|---|
| `threads.name/description` | `#+TITLE` / `#+SUBTITLE` (§4) |
| `threads.kind` | user→flat, auto_*→datetree (§5); `#+VAKANA_THREAD_KIND` |
| `threads.anchor_kind/anchor_date` | `#+VAKANA_ANCHOR_*` (§4); controls the datetree (§5.2) |
| `threads.anchor_time` | not written (reserved/unused in the schema) |
| `threads.collection_id` | ignored (vestigial; the junction is authoritative) |
| `threads.created_at/updated_at` | `#+VAKANA_THREAD_CREATED/UPDATED_AT` (§4) |
| `thread_collection_links` | `#+VAKANA_COLLECTIONS` + `:vakana:` filetags (§4) |
| `thread_collections` (rows) | not exported (app config; only the membership is written) |
| `thread_beads.position` | output order + `:VAKANA_POSITION:` (§5) |
| `thread_beads.snapshot_*` | `BEAD_*` props + SVG (§5.4, §6.1) |
| `thread_beads.section_label` | grouping heading (§5.3) |
| `thread_beads.entry_id` null | orphan heading + `:orphan:` (§5.4) |
| placeholder bead (auto, no `bead_shape`) | `:placeholder:` + `:VAKANA_PLACEHOLDER:` (§5.4) |
| `entries.title/content` | heading title / body via MD→Org (§5.4, §7) |
| `entries.date` | inactive ts + `:VAKANA_DATE:` + datetree day (§5.2/§5.4) |
| `entries.time` (optional) | appended to inactive ts (`… 14:30`) + `:VAKANA_TIME:` (§5.4) |
| `entries.created_at/updated_at` | `:VAKANA_CREATED/UPDATED_AT:` (§5.4) |
| `entries.bead_*` (live) | **not** used, by design (the snapshot is authoritative) |
| `entries.highlight_tier` | `:tierN:` tag + `:HIGHLIGHT_TIER:` (§5.4) |
| `entries.is_private` | privacy handling + `:crypt:` tag (§8) |
| `entry_photos` | copied bytes → `assets/`, linked (§6.4) |
| `entry_voice_notes` (+duration) | copied bytes → `assets/`, linked with m:ss (§6.4) |
| `entry_thread_links` (Mentions) | `[[id:…]]` org-roam links (§6.6) |
| `comments` (entry) | nested `Comments` subtree (§6.5) |
| `comments` (thread) | `* Thread notes` (§6.5) |
| `comments` (reminder kind) | not applicable to a thread (the parent of the reminder is a prompt); not in thread scope |
| `comments.remind_at/reminded_at/notification_id` | agenda timestamp / SCHEDULED / acknowledged (§6.5); `notification_id` not written (local to the device, no meaning off the device) |
| `comments.edited_at` | `:VAKANA_EDITED_AT:` (§6.5) |
| `comments.resolved_at` | `DONE` keyword + `:VAKANA_RESOLVED_AT:` (§6.5); open comments have no keyword |
| `scheduled_prompts` | out of scope (global, not thread); future §13 |
| `bead_presets` | out of scope (app config) |
| `thread_articles` | ignored by design (§1; presentation overlay) |
| bead glyph rules (lozenge −45°, multi-char clockwise) | reproduced in SVG (§6.1) |
| app version / export time | provenance keywords, can be omitted (§10) |

---

## 15. Possibilities framing (draft: apply at ship)

Add these bullets to `docs/possibilities.md` *when the feature ships*,
not before. The possibilities sweep comes after the release. Each bullet
uses a Vakana primitive and passes the swap test:

- **Your year becomes an org-agenda.** Export an `auto_month` or
  `auto_week` thread. It arrives as a native `org-datetree`, and
  `org-agenda` shows the last quarter day by day without changes.
- **Mentions become a knowledge graph.** The threads that you mentioned
  export as `[[id:]]` links. Open the zip in `org-roam` and navigate the
  mentions as a graph.
- **org-ql your own grammar.** The shape, mood and pattern of each bead
  export in a `:PROPERTIES:` drawer. `(org-ql :props BEAD_SHAPE
  "lozenge")` finds each entry that has a lozenge bead.
- **Private, then encrypted.** Private entries export as `:crypt:`
  subtrees. Encrypt them on the desktop with `org-crypt`. The app does
  not hold a key.
- **A journal that diffs.** Use reproducible mode with git. The diff of
  each new export shows only the text that you wrote after the last
  export.
- **The bead travels.** Each entry has an inline SVG of its bead. Emacs
  cannot draw the bead, so the app supplies it.

---

## 16. Implementation checklist (when greenlit)

1. `src/beads/svg.js`: `renderBeadSvg(bead)` and `renderChainSvg`.
   `renderBeadSvg` is pure. It copies the `BeadView` geometry, including
   the lozenge and clockwise glyph rules.
2. `src/services/orgExport.js`:
   - `getThreadExportData`
   - `markdownToOrg`
   - the datetree emitter and the flat emitter
   - the property and drawer writers
   - the asset copier (use `prepPhotoForExport`)
   - the JSZip assembly
   - `Sharing.shareAsync`
   - the export `exportThreadOrg(threadId, options)`
3. Templates for `README.org` (always included) and `vakana.el` (toggle,
   default on).
4. Connect the export to the format chooser of the thread export, and
   add the disclosure with the 3 options.
5. Manual tests:
   - a user thread
   - `auto_day`
   - `auto_week` (more than one day)
   - an orphan bead
   - a placeholder bead
   - section labels
   - private on and off
   - a comment-reminder, pending and acknowledged
   - mentions, in the zip and without a target
   - a photo that the OS removed
   - SVG parity for a multi-char glyph and a lozenge glyph
   - byte stability of reproducible mode across two exports
   - unzip and open in Emacs: Emacs recognizes the datetree, shows the
     inline images, and resolves the ids
6. CHANGELOG entry and version bump **at ship**, not for this
   specification document. Run the release-doc sweep, including the
   possibilities bullets of §15.
