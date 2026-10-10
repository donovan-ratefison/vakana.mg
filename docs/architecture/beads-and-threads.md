# Beads and threads

The bead and thread system is the largest visual feature in the app. Users
frequently misunderstand its mental model. This doc describes the vocabulary,
the rendering pipeline, the data shape, and the two concepts that users
confuse.

## Vocabulary

A **bead** is one visual glyph attached to a journal entry. It has four
dimensions, defined in `src/beads/types.js`:

- **shape** (`ACTION_TYPES`, `beads/types.js`): eight geometric values:
  `square`, `round`, `oval`, `lozenge`, `bar`, `dot`, `decagon`, `flower`.
  **A shape has no prescribed semantics.** `ACTION_TYPES` still has the legacy
  `label`/`hint` fields in code. But the BeadComposer and the home Filters
  sheet render shapes **without labels**. Vakana is a personal encoding
  system, so the user decides what a shape means. The app never forces
  `square=Task`. Screen readers announce the geometry (`SHAPE_GEOMETRY`, for
  example "Circle"), not an imposed type.
- **pattern** (`PATTERNS`, `beads/types.js:18-26`): seven decorative motifs:
  `solid`, `striped`, `diagonal`, `dotted`, `floral`, `dashed`, `checkered`. A
  pattern has no semantics. It is only a visual texture.
- **mood** (`MOODS`, `beads/types.js:30-39`): eight named tones: `sun`,
  `ember`, `rose`, `forest`, `ocean`, `plum`, `slate`, `charcoal`. Each tone is
  a `{ key, label, color, text }` quad. The mood controls the bead fill and
  the glyph contrast.
- **glyph** (free text, 8 characters maximum): letters, digits, or emoji.

`DEFAULT_BEAD` (`beads/types.js:43-48`) is `{ shape: 'round', pattern: 'solid',
mood: 'slate', glyph: '' }`. `BeadComposer` uses it when it opens for a new
bead.

The DB stores the bead on `entries` as `bead_shape`, `bead_pattern`,
`bead_mood`, `bead_glyph` (all nullable). `bead_shape IS NULL` ⇔ "no bead".

`readBead(entry)` (`beads/types.js:54-62`) is the canonical adapter. It takes a
raw row and returns `null` or `{ shape, pattern, mood, glyph }`. It applies
defaults to the secondary fields (`pattern || 'solid'`, `mood || 'slate'`,
`glyph || ''`), so partial data still renders. Use `readBead` in all code. Do
not read the `entry.bead_*` columns directly.

A **thread** is a named, ordered chain of beads. The chain is stored in
`thread_beads`. Each row refers to the source entry, so the bead can update
live. Each row also has a frozen snapshot of the bead as it was when the user
added it.

## Rendering chain

### `BeadView`: single bead (`src/components/BeadView.js`)

`BeadView` has two render paths. The display size selects the path.

- **Small beads** (below `GLASS_GATE`, 30px: calendar cells, chain previews,
  chips) use the original flat path. This path draws a colored *core* (the
  bead body). One or more *pattern overlay* layers go on top of the core (pure
  RN `<View>`s, no SVG). The glyph text is centered on top of the layers.
- **Big beads** (≥ 30px) use the **glass finish** (see *Glass finish* below).

The helper functions are:

- `sizeOf(shape, size)` (`BeadView.js:61-72`): the dimensions of the outer
  container. The height is always `size`, so chains share a baseline. The
  width changes with the shape (`oval` 1.4×, `bar` 1.6×, `dot` 0.6×, others
  1.0×).
- `coreDimsOf(shape, size)` (`BeadView.js:75-86`): the dimensions of the inner
  core. They are the same as the outer dimensions, with two exceptions: `bar`
  has half the height, and `dot` is 0.6× in both directions. The pattern
  tiling uses these dimensions.
- `shapeStyleFor(shape, size)` (`BeadView.js:88-110`): the border-radius for
  each shape, and a transform if necessary. The special case is `lozenge`. It
  is a regular rounded square, rotated 45° and scaled to 0.72 so that its
  bounding box fits the core. The rotated diamond is inset from its container,
  which leaves a gap. For this reason `BeadChain` needs a special "joint dot
  overlap" for lozenges: the joint dot must extend across the gap (see below).
- `patternOverlayFor(pattern, w, h, color)` (`BeadView.js:114-305`): generates
  one layer for each pattern, as a tree of absolutely-positioned `<View>`s.
  Each pattern tiles at a fixed pixel density across the core. Thus a larger
  bead has more repeats.

The `diagonal` pattern (`BeadView.js:144-174`) is the most complex pattern. It
draws tall thin stripes, each rotated 60° around its own center. It iterates
the left position from `-reach` to `w + reach`, where `reach = max(w, h)`.
Thus the rotated sweep covers the full bead. The `overflow: 'hidden'` of the
parent core clips all parts that are outside.

`beadOuterWidth(shape, size)` (`BeadView.js:320-331`) is exported for layout
math in `BeadChain`. It returns the same value as `sizeOf().width`.

**Glass finish (≥ `GLASS_GATE`, v0.73.0).** Big beads render a "warm glass"
finish. The finish is a lit radial/linear gradient and a *shape-aware*
specular highlight (sphere spot, cabochon sheen, rod streak, gem band,
flower-lobe spots). `glossyLayers()` / `glossSpots()` build the finish in the
**single** SVG renderer `src/beads/svg.js`, so the finish is identical in
exports.

On the device, `GlassBead` renders that same markup through the `<SvgXml>` of
react-native-svg. There is one source of truth, not a parallel RN
implementation. The glyph stays an RN `<Text>` overlay, so emoji render
correctly.

A soft, **theme-aware cast** is behind the bead (`renderCastSvg`):

- On light themes, the cast is a warm *shadow* with the silhouette of the
  bead.
- On dark themes, the cast is a *glow* in the mood color of the bead. A shadow
  is not visible on the near-black surface.
- The cast is offset to the lower right. Concentric copies of the silhouette,
  scaled outward, make it soft.
- The cast uses no filter, because the blur of react-native-svg is not
  reliable under `<SvgXml>`.
- The cast is in the app only. Exports keep the gradient and the highlight.

`GLASS_GATE` is in `src/beads/types.js`, and both renderers share it. A
`glossy` prop on `BeadView` overrides the size gate. `EntryCard` makes wide
shapes (oval/bar) smaller than the gate so that they fit the leading column.
Thus `EntryCard` forces glossy from the *slot* size, and every shape stays
glass.

### `BeadChain`: serpentine chain (`src/components/BeadChain.js`)

`BeadChain` renders an array of `items = [{ key, bead, faded, onTap,
onLongPress }]` as a boustrophedon chain (the direction alternates on each
row). The chain wraps to fit the container width.

Layout pipeline:

1. **Greedy row packing** (`computeRows`, `BeadChain.js:354-418`). The
   horizontal footprint of each item is `beadOuterWidth + 2*jointDotSize -
   2*overlap`. `overlap` is not zero only for lozenges (`shapeJointOverlap`,
   `BeadChain.js:28-31`). A row takes items until the next item would make the
   total larger than `containerWidth - 2*uRadius`. This is the worst-case
   usable width. It always keeps space for U-turn padding on both sides, also
   when only one side has a U-turn. This prevents sub-pixel spillover.

2. **Per-row justification** (same function, `BeadChain.js:395-417`). A row
   that is not the last row and has 2 or more beads makes its connectors
   between beads wider. Thus the row reaches both edges of its content area,
   and there is no long trailing line before the U-turn. The last row and
   rows with one bead use the default connector width (`CONN_W = 10`).

3. **Render** (`ChainRow`, `BeadChain.js:108-209`). The direction alternates
   on each row (`isLTR = rowIdx % 2 === 0`). Caps are *inside* the row (no
   padding), so the loose tail reaches the screen edge. U-turns are in the
   *padding zone* on the side that connects.

4. **U-turns** are absolutely-positioned siblings of the rows
   (`BeadChain.js:87-103`). The `UTurn` component (`BeadChain.js:251-337`)
   approximates a stadium-shaped curve as a polyline. Each quarter-arc has
   `N=6` rotated `ThreadLine` segments. If the bbox height is more than
   `2*radius`, an optional straight segment goes in the middle. The component
   is pure RN, with no SVG. Each segment is a `ThreadLine`, so the curve keeps
   the diagonal stripe pattern. `makeSeg` (`BeadChain.js:339-347`) computes
   the center, the length and the angle from two endpoints.

5. **Joint dots** (`JointDot`, `BeadChain.js:228-245`). These are small filled
   circles between each bead and each connector. For lozenges,
   `shapeJointOverlap(...)` makes `marginRight` / `marginLeft` negative. Thus
   the dot touches the real edge of the diamond.

6. **Section pendants** (`BeadWithPendant`, `BeadChain.js`). An item can have
   `sectionLabel` (string → render the full price-tag pendant) and `marked`
   (boolean → render only the gold ring on the bead), or one of the two. The
   detail-view chain sets both. Preview surfaces (`ThreadCard`, `EntryCard`
   inline chains through `buildChainItems`) set only `marked`, so previews
   show the ring without the pendant. The pendant is a `position: absolute`
   child of a `position: relative` wrap around the bead. Thus the flex layout
   of the row does not change, and the bead keeps the same vertical alignment
   as its neighbours without labels.

   - **Anchor**: `right: '100%'` (the right edge is at the left edge of the
     bead wrap) and an explicit `width: 240`. Without the explicit width, yoga
     collapses the intrinsic width to the ~36 px of the bead wrap and crushes
     the tag.
   - **Two-level stagger**: `BeadChain` goes through `items` one time. It
     gives each `sectionLabel` row a `pendantLevel: 0 | 1`, which alternates
     in chain order. Level 1 is 24 px higher than level 0, with a 29 px
     drop-string back to the bead. Thus the tags of adjacent labelled beads
     are at different Y heights. They stay fully visible when they overlap
     horizontally.
   - **Edge-flip**: the pendant flips for the bead that is visually leftmost
     in each row (LTR source idx 0, RTL source idx length-1). The flipped
     pendant uses `left: '100%'` and `alignItems: 'flex-start'`, and the
     string moves to `marginLeft`. This keeps the tag on the screen when the
     labelled bead is at the start of the row. For LTR, the flipped pendant is
     over the "after" connector, because the first bead of the chain has no
     "before" connector. For RTL, it is over the "before" connector in chain
     order.
   - **Per-row gap budget**: `gapAfter(rowIdx)` sets the `marginBottom` of
     each row from the maximum pendant level of the *next* row (32 px for
     level 0, 56 px for level 1). If the next row has no labels, it uses the
     default `rowGap` of the user. `topPad` follows the same rule on row 0.
     Thus a chain with all its sections in one row adds no vertical space
     between rows without sections. U-turn arcs get their absolute position
     from the cumulative `rowTops`.
   - **Tap-to-expand**: the tag is a `TouchableOpacity`. The pendant uses
     `pointerEvents: 'box-none'`, so taps reach the inner button and the empty
     space stays transparent to taps. A tap toggles `numberOfLines` between 1
     and `undefined`. Thus a long label wraps to more than one line in the
     same fixed-width tag.

   In `VerticalBeadChain`, the pendant is to the right of the labelled bead at
   `PENDANT_LEFT = BEAD_COL_LEFT + BEAD_SIZE + 4`. The pendant hides while the
   bubble of that bead is the expanded bubble, because the tail of the bubble
   uses the same lateral space. The connector line never breaks at a section
   boundary. The gold ring on the bead and the tag beside it are the only
   cues.

### `ThreadLine` and `ThreadCap`

`ThreadLine` (`src/components/ThreadLine.js`) is a horizontal colored bar. Thin
rotated rectangles, absolutely positioned, lie over it as diagonal stripes.
This gives the "twisted fiber" look. The width can be a fixed number or
`flex: 1`. With `flex: 1`, `onLayout` reads the real width, and the stripes
render again when the width is known.

`ThreadCap` (`src/components/ThreadCap.js`) is the tail of a loose thread. It
is a short `ThreadLine` stub and a quarter-arc curl. The curl is made from two
adjacent borders and one border-radius. The curl cannot have stripes, because
RN stripe overlays do not work on curves without SVG. Thus only the stub has
the stripe pattern. The corner joint overlaps by `thickness`, so the two
strokes look like one continuous line.

## `BeadComposer` live-save semantics

`src/components/BeadComposer.js` is the modal sheet where the user selects the
four attributes. It does **not** wait for "Done" to commit. Every state change
calls `onSave` immediately. The debounced autosave of the parent then persists
the change a short time later. The "Done" button only closes the sheet.

Two refs make this safe:

- **`onSaveRef`** (`BeadComposer.js:41-42`): holds the latest `onSave` prop.
  The parent usually passes a new arrow function on every render. Without the
  ref, each parent render would run the live-commit effect again. The effect
  reads `onSave` from the ref, so the dependencies of the effect do not
  include `onSave`.

- **`justOpenedRef`** (`BeadComposer.js:38, 46-54, 59-67`): set to `true` on
  every open and consumed on the *next* run of the live-commit effect. The
  four calls `setShape` / `setPattern` / `setMood` / `setGlyph` fill the form
  from `initial`. Without the ref, these calls would start the live-commit
  again and save the same bead that the user opened to edit. This is the same
  method as the `skipNextSaveRef` of the editor.

The "Done" handler calls `onSave` one more time and closes the sheet. This
call is defensive, because the live-commit has almost certainly run already.
The code comment explains why the handler does *not* use `slice` to truncate
the glyph: a slice by code unit corrupts multi-codepoint emoji and ZWJ
sequences. The `maxLength={8}` of the TextInput already limits the input.

### Three faces, one sheet (v0.36.0)

`BeadComposer` is not three components. It is one sheet with three faces.

- **Pick** (the default, always collapsed, when saved beads exist). The saved
  beads are the *body*: a wrapped chip grid.

  - A search box shows only above `SEARCH_THRESHOLD = 8`. Below that number,
    the user scans the grid faster than a filter (the UI-minimalism rule).
  - A tap on a chip **pre-fills, never stamps** (`pickPreset`). It sets
    `hasPicked` and sends the four facets through the normal setters. The
    existing live-commit effect then persists the bead a short time later.
  - The sheet **stays collapsed**. It does not expand automatically. The
    64 px preview and the selected chip with its primary border confirm the
    choice.
  - **Done is available in the collapsed footer.** Done only closes the sheet,
    because the pick was already live-committed. Done deliberately never
    stamps. Thus a new entry with no choice cannot get a default bead.
  - The composer opens only if the user taps `Compose new` to adjust the bead.
  - Pick changes the *landing surface*. It does not change what a tap *does*.

  The maker corrected two v0.36.0 pre-releases:

  1. Tap-to-commit-and-close. The sudden close removed the opportunity to
     adjust the bead.
  2. Tap-to-pre-fill-**and-auto-expand**. The editor opened on every pick,
     which was jarring. It also brought back a reset thrash caused by the
     `initial` echo.

  The final design is: collapsed by default, expand only to edit.

  The open-reset effect keys on **`visible` only**. It reads `initial` /
  `defaultGlyph` through refs. It must not run again when the live-commit of
  the sheet itself sends a new `initial` back during the session. That run
  started the reset again and thrashed `composing`, the search and
  `hasPicked`. There is no adaptive landing between Pick and Compose. The
  sheet always opens collapsed. Only `showCompose = composing ||
  presets.length === 0` shows the composer (when there are zero presets).
- **Compose** (the opt-in `Compose new` accordion, or the only face when there
  are zero presets). At cold start, the sheet looks like the old composer. The
  first "Save this bead" makes Pick available at the next open. Compose keeps
  the original live-commit and the explicit *Done* (no auto-stamp). The
  `Compose new` control **toggles in both directions**
  (`setComposing((c) => !c)`): expand to adjust the bead, collapse to go back
  to the list of saved beads. `showCompose = composing || presets.length ===
  0` prevents an empty sheet when the user deletes the last preset in Pick.
  The composer is then the only face, and the toggle is hidden, because there
  is no list to collapse to.
- **Reshape** (long-press a chip → *Reshape across history…*). It renames or
  reshapes the saved bead *globally*, or both (`reshapeBeadAcrossHistory`). A
  third ref, **`reshapeRef`**, is set to `true` *synchronously before* the
  setters that load the preset into the form. The live-commit effect returns
  early when the ref is set. Thus none of these edits go onto the entry in the
  editor. The counted confirm offers Future-only (default) or "Also rewrite N"
  (destructive). The entry in the editor can match the old tuple when the user
  rewrites the past. In that case the handler calls `onSave(to)` again. Thus
  the stale in-memory bead of the editor cannot autosave the old tuple back.

**Sheet gesture structure (do not regress).** Do not wrap the `ScrollView` in
a `Pressable`. The other sheets in the app use
`<Pressable backdrop onPress={close}><Pressable sheet onPress={()=>{}}>` to
swallow taps on the sheet. But a `Pressable` ancestor claims the touch
responder on press-start. A `ScrollView` can only take a pan from a
*descendant* touchable. Thus a swipe that starts on empty space never scrolls,
and the user must start the drag on a button.

`BeadComposer` uses a plain `View` sheet with a **sibling** dismiss
`Pressable` (`backdropDismiss`, `flex: 1`). The `Pressable` fills only the dim
strip above the sheet. A tap outside the sheet still closes it. A tap on the
sheet still does not close it. The scroll works from all points on the sheet.
The other sheets have the same latent bug. If the bug shows on one of them,
correct it in the same way.

## Thread data model

There are two tables with two responsibilities. See `data-layer.md` for the
full column list.

**`thread_beads`** stores the chain. Each row has:

- `entry_id` (nullable, `ON DELETE SET NULL`): the live reference to the
  source entry.
- `snapshot_shape`, `snapshot_pattern`, `snapshot_mood`, `snapshot_glyph`: a
  frozen copy of the bead of the entry at the moment when the user added it to
  this thread.
- `section_label` (nullable TEXT): when it is not null, this bead is the start
  of a named chapter in the thread.
  - The label belongs to the membership, not to the entry. The same entry in
    two threads can be a "Kickoff" header in one thread and a plain bead in
    the other.
  - Sections are implicit. A section is the span between two consecutive
    labelled beads. There is no `thread_sections` table and no
    `(thread_id, section_id)` mapping.
  - If you move or remove the labelled bead, the chapter moves or goes away
    with it.
  - The `ensureSectionLabelColumn` shim in `db.js` adds the column.
  - **Auto-threads never have section labels.** The auto_day / auto_week /
    auto_month chains are derived from entries and highlight tiers. On those
    threads, the long-press action sheet shows an explanation and not the
    Mark/Rename/Clear options.

To load a thread, the code joins `thread_beads` to `entries` and uses
`readBead(entry)` to test for a live bead (`ThreadCard.js:11-30`). The render
selects one of two cases:

- A live bead is present → render the live bead. The chain follows the later
  edits of the user.
- The live bead is missing (the entry was deleted, or its bead was removed) →
  render the snapshot with `faded: true`. A comment in
  `ThreadDetailScreen.handleTapBead` tells the user that the bead is no longer
  linked (`ThreadDetailScreen.js:94-103`).

This is the reason for both columns. With only the snapshot, the chain would
look wrong after the user changes the bead of an entry. With only the live
reference, historical chains would get holes. The dual representation keeps
the chain visually complete, and the chain stays interactive while the source
exists.

**Frozen-snapshot carve-out (v0.36.0).** The snapshot is frozen *by design*,
with exactly one sanctioned exception: the S14 **Reshape across history**
(`reshapeBeadAcrossHistory` in `beadPresets.js`). Reshape is a global
`query-replace` on one saved bead. The user starts it, the confirm shows a
count, and it is irreversible. When the user chooses to rewrite the past, it
`UPDATE`s every `thread_beads` row whose snapshot is equal to the old tuple,
**including the frozen rows**. This is deliberate (the maker's "everything
travels" decision). It is the only documented exception to "frozen means
frozen". `overview.md` has the same carve-out.

Note one detail. The load path above *prefers the live bead*. Thus a rewrite
of `entries` alone already moves every chain whose source entry still has a
live bead. The explicit `UPDATE` of the `thread_beads` snapshot also moves the
*faded ghost* snapshots (deleted entries, removed beads). Thus the dead ends
of the history also show the new symbol. No `autoThread` re-sync occurs. A
facet-only change does not change thread membership or the
`YYYYMMDD×1e8 + minuteOfDay×1e4 + id` position.

Every thread save rewrites `thread_beads.position` wholesale
(`ThreadComposerScreen.js:262-296`). See `data-layer.md`.

## "Add to thread" vs "Mention a thread": the distinction users miss

These are two different mechanisms. They have different storage and a
different intent.

### Add to thread (`AddToThreadOverlay`, `thread_beads`)

- **Where**: long-press the bead in the editor, then choose "Add to thread"
  (`EntryEditorScreen.js`, `AddToThreadOverlay.js`).
- **What**: it appends a new `thread_beads` row to the chosen thread. The row
  has a snapshot of the bead of the entry, and `entry_id` is set. It also
  updates the `updated_at` of the thread.
- **Result**: the bead now shows as the next bead on the chain of that thread.
- **Mental model**: you *chronicle*. You put the moment of this entry into the
  story that this thread tells.

### Mention a thread (`ThreadPickerSheet`, `entry_thread_links`)

- **Where**: the `+` in the top bar of the editor → "Mention a thread"
  (`ThreadPickerSheet.js`). When one or more mentions exist, the editor
  renders a Mentions section below the body. The section lists the mentioned
  threads.
- **What**: it adds a row to `entry_thread_links` that points this entry at
  that thread. It does **not** change `thread_beads`.
- **Result**: the editor shows a card for the mentioned thread. Tap the card
  to open the thread. The thread itself does not change.
- **Mental model**: you *cross-reference*. You say "this note is *about* that
  ongoing thread". You do not say that the bead of the entry is part of the
  chain.

#### The inbound read: "Mentioned by" (the backlink)

The mention above is **outbound** (entry → thread). The **inbound** read gives
the opposite direction and needs no new storage.

- `ThreadDetailScreen` shows an `@ N` chip in the sticky metaStrip. The chip
  is beside the bead count, and it is hidden when the count is zero.
- The chip opens a read-only **Mentioned by** drawer (`MentionedByDrawer.js`).
  The drawer lists every entry whose editor points at this thread.
- The read is a pure reverse query over the same `entry_thread_links` rows. It
  uses the existing `idx_entry_thread_links_thread` index.
- `loadMentioningEntriesForThread()` in `services/threadMembership.js` owns
  the query. It returns one backlink for each entry, with the newest citation
  first. It includes `bead_*` and `is_private`, so each row renders the live
  bead and masks private titles.
- The drawer refreshes on the existing focus listener of the screen. It needs
  no new wiring.

The drawer is deliberately read-only and small (bead, title, date, tap to open
the source). A mention is a footnote, not a chapter, and the only gesture is
to go to the source. Only `kind='user'` threads get mentions, because the
mention picker shows only user threads. Thus auto-threads need no special
case, and the chip never shows on them. This drawer is the in-app equivalent
of the org-roam `[[id:]]` backlink that the Org export already writes
(`org-export.md`). On a *closed* thread, it is the bibliography of that
finished cycle.

An example: a user who reflects on "the year so far" can have a 2026 thread
(the yearly chain) and write a meta-note about that thread. It is correct to
*mention* the 2026 thread in that meta-note. It is probably not correct to
*add* the bead of the meta-note to the 2026 thread. The meta-note is not one
more moment in the year. It is a commentary about the year.

Note: the table is still named `entry_thread_links`. The rename is only
user-facing (see `data-layer.md`).

## Threads list: handwritten title in Caveat

`ThreadCard` (`src/components/ThreadCard.js`) renders the thread name in the
`Caveat_400Regular` font. The name is deliberately large (`fontSize: 22`,
`lineHeight: 26`) and has reduced opacity. Thus it looks like a label drawn by
hand and not like UI text (`ThreadCard.js:115-123`).

The font loads one time at boot, in the `prepare()` sequence of `App.js`,
through `Font.loadAsync({ Caveat_400Regular })` (from
`@expo-google-fonts/caveat`). The load has its own `.catch(() => {})`. If the
font fails, the app uses the system font, and boot does not stop. The load
runs before the existing `isReady` spinner clears. Thus `ThreadCard` never
renders Caveat before the font is registered, and no fallback font shows for a
moment.

**Note:** until v0.26.6, the font was declared *only* through the `expo-font`
config plugin (native builds). There was no runtime load, although older docs
described a `useFonts` hook. Thus in Expo Go every `Caveat_400Regular`
silently became the system font. See `navigation-and-shell.md`.

## Threads list: sort preference

`ThreadsList` reads a sort preference from `expo-secure-store`
(`vakana_threads_sort_mode`, default `'recent'`).

- `'recent'` keeps the historical `ORDER BY updated_at DESC`.
- `'alpha'` changes the user-thread branch to
  `ORDER BY name COLLATE NOCASE ASC`.

The toggle is **wired only for `kind='user'`**. Auto-thread names are
date-formatted strings ("Week of …", "May 2026"), so an alphabetical sort of
them has no meaning. The auto views and the `All` view always keep
`anchor_date DESC` / `updated_at DESC`. The preference is global. The list
reads it one time on mount, not on focus, and persists it on toggle. This is
the same pattern as `vakana_auto_thread_enabled` and the theme mode.

The toggle icon is **inside the search bar**, beside the inline-comments
toggle, at the `searchInlineToggle` size of the notes list. It shows only
while the User filter is active. The threads search bar and the notes search
bar deliberately have the same chrome.

`ThreadsList` is a `SectionList` (since v0.25.0). It uses the same banding
util as the notes list: `src/utils/timeBands.js` (`groupIntoBands` /
`groupIntoAlphaBands` / `isoDateFromSqlDatetime`). The util was extracted from
`HomeScreen` so that the two surfaces cannot drift apart. A `sections`
`useMemo` keyed on `[threads, kindFilter, sortMode]` gives:

- for `kind='user'`: recency bands by `updated_at` (Recent), or first-letter
  bands (A–Z)
- for auto and `All`: one `{ title: null }` section whose header renders
  nothing
- for an empty list: `[]`, so `ListEmptyComponent` still shows

`ThreadCard` renders a short `updated_at` date, parsed to local time from the
SQLite UTC datetime. It renders the date for user threads on real list cards
only. It does not render the date when `onRemove` is set (mention-picker
cards). It does not render the date for auto threads, because their names are
already a date. `EntryCard` and `ThreadCard` share one comment-chip treatment
and one card metric scale. Thread comment previews use `MarkdownInline`, as
entry previews do.

**Lazy bead-chain previews (v0.26.0).** `loadThreads` no longer fetches
chains. The old code was an N+1 of unbounded `loadThreadPreview` queries on
the single SQLite connection. It ran again on every load, focus and keystroke.
The current design is:

- Rows paint from the cheap threads query and the batched comment counts.
- Each `ThreadCard` calls `onNeedPreview(thread.id)` on mount.
- `ThreadsList.ensurePreview` runs the query one time. It fills
  `previewCacheRef` and a `previewMap` state slot. An in-flight `Set` removes
  duplicate queries when scroll recycling mounts a card again.
- Search, sort and scroll never query again, because a filter does not change
  a chain. The cache clears only on focus.
- With list virtualization, only the rows that are approximately visible
  query.

Card previews render through **`ChainPreview`**. It has the same split as
`BeadView`:

- The six box shapes (`square/round/oval/lozenge/bar/dot`) are cheap Views.
  They use the exact `shapeStyleFor`/`sizeOf` geometry of `BeadView` (the
  lozenge is a real rotated square).
- `decagon`/`flower` delegate to the real `BeadView` with `pattern:'solid'`
  (true polygon silhouette, no pattern SVG). Thus only 2 of 8 shapes use SVG,
  and only on visible cards.
- The beads are on thin golden connector Views. The glyph is a small Text.
- The preview shows the *full* chain, with no truncation.
- Pattern fills and connector elbows are still omitted. They are not
  perceptible at preview size.

`ThreadDetail` and the callers that are not lazy (pickers, Mentions) keep the
full `BeadChain`. `ThreadCard` is `React.memo`'d with a data-only comparator.
Search is debounced ~250 ms on both lists. The mount/focus effect was split,
so `loadCollections` does not run again on thread search or sort.

## Thread last-touched semantics

`threads.updated_at` is the contract for touch recency. The gestures in the
table below update it. No other code writes it. The Quiet band in
`ThreadsList` derives from this column.

| File | Reason it bumps `updated_at` |
|---|---|
| `src/services/collections.js` | thread added to / removed from a collection |
| `src/services/autoThread.js` | placeholder-bead snapshot updates on an auto-thread |
| `src/services/comments.js` | comment added on the thread |
| `src/services/entryFusion.js` | fuse operation touches affected threads |
| `src/components/AddToThreadOverlay.js` | bead added to a thread from the editor |
| `src/screens/ThreadDetailScreen.js` | rename, anchor change, bead add/remove/reorder, highlight-tier change |
| `src/screens/ThreadComposerScreen.js` | thread create/edit save |
| `src/components/AnchorSheet.js` | anchor edit |

**Mentions** do **not** update `threads.updated_at`. A mention is the
addition or removal of an entry → thread cross-reference through
`entry_thread_links` (the "Mentions" section in the entry editor). This is the
most ambiguous gesture in the model, so this doc states the rule explicitly. A
mention is a soft cross-reference on the entry side. It is not a commit on the
thread side.

Some threads have only mentions: no bead added, no comment, no collection, no
rename. Such a thread is *not* "touched" in the Quiet-band sense. It goes into
QUIET when the configured threshold (default 180 days) passes after the last
real touch.

The reader on the list side is the `sections` derivation of `ThreadsList`. It
applies under `kindFilter === 'user'` and `sortMode === 'recent'`.

- The derivation selects threads with `closed_at IS NULL` and an `updated_at`
  older than the configured Quiet threshold.
- It removes these threads from their natural date band and puts them into a
  tail section. The section title is `QUIET · {N}d+`, where `{N}` is the live
  threshold.
- The threshold default is 180 days. The user can set it in **Settings →
  Threads & returns → Quiet threshold**, in the range 1–3650 days.
- The threshold is persisted in expo-secure-store under
  `journal_quiet_threshold_days`, through `src/utils/quietThreads.js`.
- `ThreadsList` reads the persisted value again on mount and on focus. This is
  the same listener that reads `isAutoThreadEnabled` again.
- The `sections` `useMemo` depends on the threshold state. Thus a change in
  Settings shows immediately when the user returns.

Closed threads (S17 Loop, `closed_at IS NOT NULL`) keep their natural date
band. They have their own visual treatment (the clasp chip on the card) and
never go into the Quiet band.

The split is a pure JS derivation over the result set that is already loaded.
Thus the search and the collection filters narrow the Quiet section correctly:
it shows the quiet threads among the threads that matched. There is no new
write path and no schema column. There is only one secure-store key. The
derivation only reads `updated_at`.

## Bead-filter result disambiguation: `loadBeadThreadNamesForEntries`

`src/services/threadMembership.js` adds a batched function that returns only
names. It is a sibling of `loadThreadCountsForEntries`.

- `HomeScreen` calls it **only when a bead filter is active**, and puts the
  result in `entry.beadThreadNames`.
- `HomeScreen` computes "filter active" again inside the load callback, from
  the filter arrays. It does not use the render-scope `filterActive`. This
  prevents a stale closure.
- When the array is present and not empty, `EntryCard` replaces its numeric
  thread chip with a name strip. The strip shows the first two names, then
  `+N`. A tap opens the existing `threadsBlock` expand.
- The query is limited to `thread_beads` joined to `kind='user'` threads. The
  *locus* of a bead is the chain that holds it, not a soft Mention.
- The tap-to-expand block still adds Mentions through `loadThreadsForEntry`.
  Thus the inline strip can correctly list fewer threads than the expand.
- When no bead filter is active, `beadThreadNames` stays undefined. Thus the
  chronological list keeps the plain count and runs no additional query.

## Entry-list filter chrome: the three-position search row

The entry-list view of `HomeScreen` has a search and filter row with three
vertical positions. Each position has a different semantic role.

1. **Scope pill, *above* the search bar.** This is a captured preset filter.
   It renders only when `homeAppliedPresetId != null` (the `pinnedPreset` memo
   controls it).

   - The pill shows the `BeadView` of the bead, the name of the preset, a
     **live density readout**, and a × button.
   - The density readout is the entry count of the current view. It renders
     as a `· N` suffix in a lighter inline `pinnedPillCount` span. The count
     decreases as the user refines with the text input. It returns to the
     total of the bead when the user clears the input.
   - A tap on × clears the four facet arrays and the `homeAppliedPresetId`.
   - The pill uses the existing `presetChip` + `presetChipSelected` geometry.
     Thus the v0.55.0 chip settings (`minHeight: 34`,
     `includeFontPadding: false`, `lineHeight: 18`) also apply to the pill.
     A `pinnedPill` override adds right padding so that the × has space.
   - A **second flavor** of this pill renders when `homeAnonBead != null`.
     This is a long-pressed bead that matches no saved preset. It has the
     same chrome but a neutral *"Bead · N"* label, because it has no name.
     See *Long-press a bead → set as filter* below (v0.70.1).
   - The named-preset pill, the anonymous-bead pill and the thread-pin pill
     are mutually exclusive. Thus this position holds one pill at most.

2. **Search text, *in* the bar.** This is a pure content search over the
   title, the body and the comments (the LIKE clause of `loadEntries`). When a
   pill is pinned, the placeholder changes from *"Search entries…"* to
   *"Search within this bead…"*. The scope of the input is now the set of the
   bead. The query shape does not change: the AND of the LIKE clause and the
   facet arrays gives the correct result.

3. **Suggestion strip, *below* the bar.** This is the same horizontal
   `presetChip` strip that has been there since v0.56.0. It shows the presets
   whose name starts with the typed search text.

   - `visibleHomePresets` returns `[]` when a pill is already pinned. The
     strip only *summons* a pill. It never shows together with a pill.
   - A tap on a chip pins the preset as a pill, clears the search text, and
     dismisses the keyboard.
   - The strip no longer renders a *selected* state. That state is not
     possible: selected ⇒ pinned ⇒ strip hidden.

**Pill lifecycle.** The pill detaches through exactly three paths:

- **(a) Tap × on the pill**: the inline `onPress` clears the four facet arrays
  and `homeAppliedPresetId`.
- **(b) Facet divergence**: a useEffect watches `[homeAppliedPresetId,
  beadPresets, shapeFilter, moodFilter, patternFilter, glyphFilter]`. It
  checks whether each facet array exactly matches the related facet of the
  preset (singleton or empty). On divergence (usually an edit in the Filters
  sheet), it drops only the name-claim. The facets stay applied, because the
  user edited them. The funnel-badge then shows the manual facets with no
  name.
- **(c) Preset deleted**: the same useEffect sets the id to null in the same
  way. The four facet arrays stay as the last applied state of the user,
  because the user can still use them as a manual filter.

Changes to the search text do **not** change the pill. This is the deliberate
opposite of the behaviour before v0.60. In that behaviour, text input summoned
the lens of the strip, and a cleared input dismissed it.

**Composability with the Filters sheet (the funnel).** The pill claims a name
only when the four facet arrays exactly match a preset. A manual edit in the
funnel that diverges detaches the pill. `clearFilters` (the *Clear all* of the
Filters sheet) also sets `homeAppliedPresetId` to null, so the two paths stay
in sync. The active-facet count badge of the funnel continues to show "filters
on". A pill (named) and a badge with no pill (manual facets) are two different
visual states for two different origins.

**Scope-aware empty state.** `renderEmpty` branches on `pinnedPreset` *before*
the generic `filterActive` branch. Then it branches on `homeAnonBead`, with
the same shape but a generic *"this bead"*. When a pill is pinned and the
result is empty, the empty-state copy names the preset in the primary color
(through `emptyTextEmphasis`). The copy points at the × of the pill as the
control that relaxes the scope, not at the *Clear all* of the funnel.

- Pinned + search → *"No entries in **X** match `q`. Tap × on the bead to
  widen, or clear the search."*
- Pinned-only → *"No entries with **X** yet. Tap × on the bead to clear, or
  stamp a new entry with it."*

The primary color connects the named bead in the copy to the pill above it,
which has the primary background. The same color in two places refers to the
same thing.

**Non-goals (v1).**

- Multi-pill stacking (a shape pill, a glyph pill and a mention pill above the
  bar) is out of scope. The design permits it, but no code uses it.
- The same pattern in the `ThreadsList` search is a follow-up. It waits for
  dogfooding of the entry-list version.
- Persistence of the pinned pill across sessions is out of scope. Pill state
  is ephemeral, as in the existing filter-state model.

### Filters-sheet lens groups: Connection and Capture (v0.80.0)

Above the four bead facets, the sheet has two groups of boolean lenses. They
are not facets. Each lens is one predicate appended to the `wheres` array of
`loadEntries`. It is AND-composed with all other clauses.

**Connection**: the two halves of one cut over the thread-relation verbs. Both
are restricted to `kind='user'`. Auto-threads are excluded, which is the same
noise-exclusion invariant as
`services/threadMembership.js#loadThreadCountsForEntries`.

- `unwoven`: `NOT EXISTS` over `thread_beads` **and** `NOT EXISTS` over
  `entry_thread_links`. A mention counts as wovenness.
- `mentionsOthers`: `EXISTS` over `entry_thread_links` alone.

They are **mutually exclusive in the UI**: the handler of each row clears the
other. This is not a query constraint, because the two clauses would compose
correctly. It keeps the affordance correct. `unwoven` requires the absence of
exactly the thing that `mentionsOthers` requires. If both are on, the list is
always empty.

**Capture**: `hasPhoto` / `hasVoice`, with one `EXISTS` each over
`entry_photos` / `entry_voice_notes`. These are deliberately two lenses and
not one *has media* lens. The search clause reads the title, the content and
the comments. Thus no other query in the app can find a voice-only entry. A
photo-only entry is almost as difficult to find, because it is filed under
the `Draft <timestamp>` fallback title. One attachment filter would make the
group generic. As two lenses, the group names the gap that it closes. These
two lenses AND with each other in the usual way. If both are on, the meaning
is *carries photo and voice*.

All three new clauses use existing indexes (`idx_entry_thread_links_entry`,
`idx_entry_photos_entry`, `idx_entry_voice_notes_entry`), so each clause is
`O(log n)` per row. There is no schema change.

**Invariant: read the lenses through `lensRef`, not the closure.**

- All four booleans are synced into `lensRef.current` during render.
  `loadEntries` reads them from there.
- The four booleans are deliberately **not** in the `useCallback` dependency
  list of `loadEntries`.
- All four **are** in the trigger list of the reload effect.
- This is the same double protection as `homePinnedThreadIdRef` (above), for
  the same reason. A change to one boolean is exactly the single-dep flip that
  the React 19/Hermes quirk in v0.63.1 / v0.63.2 can drop.
- This failure occurred. `unwoven` shipped in v0.44.0 and read the closure,
  but it was missing from those deps. Its clause stayed at the `false` of the
  first render, and the lens filtered nothing until v0.80.0.
- Do not move these booleans back into the `useCallback` deps.

The `activeFacetCount` of the funnel counts each **group** one time, not each
active lens: `(unwoven || mentionsOthers ? 1 : 0) + (hasPhoto || hasVoice ? 1
: 0)`. This agrees with the facets-not-values rule that the four bead facets
already follow. `clearFilters` resets all four.

### Thread-pin: the second pill type (v0.62.0)

The pill row above the search bar has **two** pill types: a bead-preset pin
(v0.60.0, above) and a **thread pin**. They are **mutex**: one or the other
renders, never both. Multi-pill stacking stays the named non-goal. When the
user pins one, the other clears. A thread pin also clears the four facet
arrays and the search text that the bead-pin claims. Thus the user is always
in exactly one captured scope.

The trigger for the thread-pin is outside Home.

- The **bead-count chip** in the `metaStrip` of `ThreadDetailScreen` is
  tappable on user threads. This is the same row that has anchor / collection
  / `@ N`. The chip calls `navigation.navigate('Home', { pinThreadId })`.
- The icon of the chip is the affordance signal: **`list-outline`** when the
  chip is tappable (user threads), **`ellipse-outline`** when it only gives
  information (auto-threads, which do not get the trigger in v1). The icon
  change is the visual cue, as with `funnel-outline ↔ funnel` for filter-on.
- The chain header got no new chrome. The trigger uses the existing chip slot
  of the strip. That slot was the only item in the strip that was not
  tappable: the anchor / collection / `@ N` of `metaStrip` were already
  tappable. The bead count now follows the same pattern.
- The trigger is not in the orientation pill (Beaded line / Stacked / Loop).
  Thus that pill keeps its single purpose: *how to walk the chain*.
- `HomeScreen` consumes the param one time in a `useEffect` and sets
  `homePinnedThreadId`. Then it clears the param with
  `navigation.setParams({ pinThreadId: undefined })`. Thus a later re-focus
  cannot apply a stale trigger again.

The thread-pill uses the same `presetChip` + `presetChipSelected` +
`pinnedPill` chrome, with two deliberate substitutions:

- **Avatar**: the `git-network-outline` Ionicon, not a `BeadView`. A thread is
  not a bead. The first bead of the thread would confuse the locus (the
  thread) with the content (the beads of its members).
- **Search placeholder**: *"Search within this thread…"* (parallel to the
  *"Search within this bead…"* of the bead-pin).

`loadEntries` adds the scope as `id IN (SELECT entry_id FROM thread_beads
WHERE thread_id = ? AND entry_id IS NOT NULL)`, AND-ed with the facet clauses
and the search clause. It uses the existing `idx_thread_beads_thread` index,
with one subquery and no join. `renderEmpty` has thread-scope branches before
the bead-scope branch. The thread is the broader scope if both could match.
The mutex makes that impossible, but the order still encodes the precedence.
The pill has the same `· N` density readout as the bead-pin: *"Marathon · 47"*
decreases live as the user types into the input.

**Thread-pin lifecycle** has the same three detach paths as the bead-pin:

- (a) The × on the pill.
- (b) The *other* pill type takes over (mutex). The `onPress` of the
  suggestion strip also clears `homePinnedThreadId`.
- (c) The underlying thread is deleted. A `loadPinnedThread` callback runs on
  id change and from the focus listener. If the row is missing, the pin drops.

The *Clear all* of the funnel/Filters sheet does **not** change the
thread-pin. *Clear all* applies to the facet filters. The thread-pin is the
*scope* in which those filters apply. Scope and facets are orthogonal.

**Non-goals (still v1).**

- Thread-pin support on auto-threads. Each kind would map to a different
  query: date for `auto_day`, highlight-tier for `auto_week`/`auto_month`.
- Multi-pill stacking (a thread-pin AND a bead-pin). This is still the same
  named non-goal as in v0.60.0. The design permits it, but no code uses it.

### Long-press a bead on an entry row → set as filter (v0.63.0)

A hidden gesture in `HomeScreen` lets the user enter the bead-pin scope
without a typed preset prefix and without the Filters sheet. Long-press the
bead inside an `EntryCard`, and the four facets become the current scope.

`EntryCard` (`src/components/EntryCard.js:18,228`) wraps the bead in a
`TouchableOpacity`. Its `onLongPress` calls
`HomeScreen.handleBeadLongPress` (`HomeScreen.js:1497-1549`). The handler runs
`readBead(entry)` and looks for a saved preset whose `{shape, pattern, mood,
glyph}` matches **exactly**. This is the same facet-equality contract that S14
reshape uses. There is no `preset_id` reference: two identical quadruples
*are* the same symbol, by value.

The match compares the glyph through `normGlyph`. `normGlyph` removes the
U+FE0F / U+FE0E variation selectors and applies NFC normalisation. A keycap
emoji can be stored in two ways (`5️⃣` as `5 FE0F 20E3` or as `5 20E3`). With
`normGlyph`, it still resolves to its preset and does not silently go to the
anonymous path (v0.70.1).

**If a preset matches**, the handler writes the four facet arrays *and* sets
`homeAppliedPresetId`. This reproduces the preset-strip path exactly. Thus the
pinned-bead pill renders above the search bar (count, name, ×, *"Search within
this bead…"*).

**If no preset matches** (an **anonymous bead**), the handler writes the four
facet arrays directly **and captures the bead in `homeAnonBead`**.
`homeAnonBead` is a third captured scope, a sibling of `homeAppliedPresetId` /
`homePinnedThreadId`.

- A removable pill still renders above the search bar. It shows a neutral
  *"Bead · N"*, because it has no name. It has the same `BeadView`, count, ×
  and *"Search within this bead…"* placeholder as the named pill (v0.70.1).
- Before v0.70.1, the anonymous path showed no pill, only the funnel badge.
  Thus the filter had no inline ×.
- The lifecycle is the same as for the named pill. The × clears the four
  facets and `homeAnonBead`. A parallel divergence effect (which watches
  `[homeAnonBead, shapeFilter, moodFilter, patternFilter, glyphFilter]`)
  detaches the pill when an edit in the Filters sheet moves the facets off the
  bead. `clearFilters` resets it.
- The empty glyph maps to an empty filter array, as in the `applyPresetFilter`
  convention.

The three captured scopes stay mutually exclusive. A pinned thread or a named
preset clears `homeAnonBead`. The anonymous bead clears the other two. Thus
only one pill renders at a time. The mutex with the pinned-thread pill follows
the v0.62.0 contract. The search text also clears, so the new scope starts
with no text filter.

**Gesture-bubbling pattern.** The nested touchables of RN resolve inner-first
on touch hit-tests. The inner `TouchableOpacity` of the bead wins on bead
touches. The card-level long-press (which enters select mode) fires only when
the press is on chrome that is not the bead. No explicit gesture coordination
(`simultaneousHandlers` / `waitFor`) is necessary, because the pressables of
RN are not gesture-handler primitives. The same hit-test priority lets the
`Swipeable` of a row work together with the body pan. Here the inner pressable
has the role of the child of the row.

## `ThreadComposerScreen` extras

These are notable behaviours in the composer
(`src/screens/ThreadComposerScreen.js`):

- **Prefilled entry**: the composer can open from `AddToThreadOverlay → "New
  thread"` (`AddToThreadOverlay.js:177-180`, `EntryEditorScreen.js:569-575`).
  In that case, the composer reads `route.params.prefilledEntryId` one time
  (gated by `prefilledLoaded.current`). It appends the bead snapshot of the
  entry to the chain as the first bead. The name input gets the focus
  automatically 250ms later (`ThreadComposerScreen.js:134-161`).

- **Anchor kind**: the UI offers `none / day / month / year / time`. On save,
  `'none'` becomes NULL (`ThreadComposerScreen.js:245`). The `anchor_date`
  format changes with the kind: `YYYY-MM-DD` for day/time, `YYYY-MM` for
  month, `YYYY` for year. See `data-layer.md`.

- **Drag-to-reorder**: `ChainItem` uses a `PanResponder` on its handle. The
  handle claims the gesture immediately on touch
  (`onStartShouldSetPanResponder: () => true`, `ThreadComposerScreen.js:537`),
  so the outer ScrollView does not intercept it. On release, the code rounds
  the `dx` delta to `CHAIN_ITEM_WIDTH` units to compute the insertion index.
  This is approximate: the constant `CHAIN_ITEM_WIDTH = 86` is tuned by hand
  (see the comment at `ThreadComposerScreen.js:31`). For a precise drop, each
  item also has explicit ◀ ▶ buttons (`ThreadComposerScreen.js:573-593`).

- **Prefill collection**: the composer can open from the FAB chooser of the
  threads tab while a collection filter is active. In that case, the chooser
  passes `route.params.prefillCollectionId`. After the `INSERT` succeeds, the
  composer calls `addThreadToCollection`. Thus the new thread joins the active
  collection automatically. Edit mode ignores this param. The user manages
  collection membership through the long-press picker, not through the
  composer (`ThreadComposerScreen.js`).

## Auto-threads: `auto_day`, `auto_week`, `auto_month`

Auto-threads are threads that the system manages. There are three kinds, and
`threads.kind` identifies the kind. All three kinds are in the same `threads`
table as user threads. The threads tab shows them through five flat filter
pills (`User · Days · Weeks · Months · All`). Each auto sub-kind has its own
pill. Thus Days does not hide Weeks / Months on screens with hundreds of
entries.

Each kind has a partial unique index on `(kind, anchor_date)`, so
`INSERT OR IGNORE` upserts stay race-safe:

- `idx_threads_auto_day_unique`: one for each calendar date.
- `idx_threads_auto_week_unique`: one for each ISO-Monday anchor.
- `idx_threads_auto_month_unique`: one for each first-of-month anchor.

`syncAutoBeadForEntry(entry)` in `services/autoThread.js` is the single sync
point. It detaches the entry from every auto-thread. It prunes each
auto-thread that became empty. Then it attaches the entry again from the
current state:

- `auto_day`: always, as in N11. If the entry has no custom bead, it uses a
  placeholder bead from `placeholderBeadForDate(entry.date)`.
- `auto_week`: only if `entries.highlight_tier ≥ 1`. The anchor is
  `getWeekAnchor(entry.date)` (ISO Monday).
- `auto_month`: only if `entries.highlight_tier ≥ 2`. The anchor is
  `getMonthAnchor(entry.date)`.

The position is encoded as `YYYYMMDD × 1e8 + minuteOfDay × 1e4 + (entry.id mod
1e4)`. Thus chains sort chronologically by entry date, then by the
time-of-day of the entry, then stably by id.

- `minuteOfDay` is the optional `time` (`HH:MM`) of the entry, if it is set.
  If not, it is the local clock from the `created_at` of the entry, so entries
  without a time still show in the order in which the user wrote them. If
  neither exists, it is 0.
- `auto_day` chains have the same date prefix on every bead, so the minute+id
  tail gives the order in the day.
- The value stays an exact integer (`20260608 × 1e8 ≈ 2.0e15 < 2^53`).
- The id tail is `mod 1e4` (the old scheme used `1e6`), which gives space for
  the minute field. A collision only swaps two beads from the same day and the
  same minute. This causes no harm.
- The magnitude is different from the old `YYYYMMDD × 1e6 + id` scheme, which
  had no time. Thus `resyncAutoThreadTimeOrderIfNeeded()` writes the position
  of every existing bead again, one time on upgrade. It does this in place and
  does not depend on the auto-thread enabled flag. Thus old positions and new
  positions never mix.

`thread_beads.entry_id` is `ON DELETE SET NULL` (the live + snapshot semantics
for user threads). Auto-threads need the opposite, because an auto-bead has no
meaning without its source entry. `deleteEntries` in `services/entries.js`
calls `removeAutoBeadsForEntriesInTx(db, ids)` inside its transaction, before
`DELETE FROM entries`. This call removes the snapshots of the entries from
every auto-thread. Then it prunes each auto-thread that became empty.
`removeAutoBeadForEntry(id)` is the single-entry form that opens its own
transaction. Fusion and the tutorial still use it.

**Two-tier highlight, intentional curation.** `entries.highlight_tier` is the
single source of truth. The bead/meta block of the editor has a star control
that cycles `0 → 1 → 2 → 0` (off → weekly → monthly → off). The user
explicitly chooses what is monthly. There is no threshold heuristic. An
`auto_week` or `auto_month` thread exists only when one or more entries refer
to it. It goes away when the last reference is removed. This is the same
prune-on-empty rule as for auto_day.

**Auto-thread read-only enforcement.** `ThreadDetailScreen` treats every
`auto_*` kind as read-only:

- There are no composer or delete buttons in the header.
- There is no quick-add FAB.
- A long-press on a bead shows an alert for the kind (auto-day → "delete the
  source entry"; auto-week/month → "change the entry's highlight in the
  editor").
- Bead changes on the source entry show automatically in the auto-thread.
  This uses the existing snapshot+live render path in
  `ThreadDetailScreen.load`. The service writes the snapshot, but the chain
  renderer prefers the live bead when it is present.

**End-of-week curation: Promote week → month.** The detail screen of an
`auto_week` thread has one "Promote week to month" button. It calls
`promoteAutoWeekToMonth(threadId)`. This function finds every entry on the
week thread with `highlight_tier < 2`, sets its tier to 2, and syncs the month
thread again. The function is idempotent: it skips entries that are already
promoted. It returns the count of entries that it promoted, so the UI can show
a "nothing changed" hint when applicable.

When the user deletes the last entry on a date, `removeAutoBeadForEntry`
deletes the empty auto-thread. If the user later writes again on that date,
the app creates a new auto-thread.

**Caution:** collection memberships and earlier comments are *not* kept across
this prune-and-recreate cycle. The collection picker shows a footnote about
this.

The same applies to week and month auto-threads. If the user removes the star
from the last highlighted entry of a week or a month, the thread is pruned.
If the user stars a new entry, the app creates a new thread.

## Collections: many-to-many

A **collection** is a named bucket above threads. It is a `thread_collections`
row and membership links in the `thread_collection_links` junction. The
hierarchy is `collection → thread → bead`. It has three levels maximum and no
nesting.

- A thread can belong to **zero, one, or many** collections.
  - A collection selector in `ThreadsList` opens `CollectionFilterSheet` (a
    searchable multi-select bottom sheet).
  - When the user selects one or more collections, the list filters to the
    **union**: the threads in *any* selected collection.
  - The filter is a single `EXISTS … collection_id IN (…)` lookup against the
    junction. It needs no `DISTINCT`, also when a thread is in more than one
    of the selected collections.
  - When the user selects none, the filter clears.
  - The selection is a `Set` in `ThreadsList`. Effects and queries depend on a
    derived key (the ids, sorted and joined into a string), never on the
    identity of the `Set`.
- All read and write paths go through `services/collections.js`. The legacy
  `threads.collection_id` column stays as a vestigial migration artifact. The
  one-shot backfill in `ensureThreadCollectionLinks` fills the junction from
  it. Current code never reads or writes the column.
- Long-press a thread card → enter multi-select mode with that thread checked
  (`HomeScreen.handleLongPressThread`). The select-mode header has two
  actions:
  - *Add-to-collection* opens `BatchCollectionPicker`. One tap applies the
    collection to N threads, through a loop of `addThreadToCollection`.
  - *Delete* skips auto-thread rows.
- The single-thread "edit my collections" path is now in the detail screen.
  Tap the *Collection: …* metadata line in `ThreadDetailScreen` →
  `CollectionPickerSheet` (a multi-toggle for that one thread across many
  collections).
- Long-press a collection row in `CollectionFilterSheet` →
  `CollectionActionsSheet` (rename/delete for one collection).
- The FAB, while a collection filter is active, opens `FabChooserSheet`. It
  has `+ New thread` (auto-assigns) and `+ Add existing thread`
  (`ExistingThreadsPicker`, a multi-add of many threads into one collection,
  with a search by name and description).
- Auto-threads can be in collections without restriction. But the memberships
  are lost on prune-and-recreate. The picker sheet shows a footnote when the
  target thread is an auto-thread.
