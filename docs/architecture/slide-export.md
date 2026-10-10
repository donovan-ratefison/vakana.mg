# Slide export: "walk the thread"

**Status:** As-built (shipped v0.31.0). The specification and the
implementation were done in the same pass. This document is the
authoritative contract. Keep it in sync with
`src/services/slideExport.js`.

**One sentence:** the app can write a thread as a self-contained `.zip`
(one `index.html` and an `assets/` folder) that opens as a **walkable
deck**. The deck has one station for each bead. The bead chain is the
spine, and a click on a bead of the spine goes to that station. The
sections are chapter dividers. The comments are the speaker notes, which
only the presenter sees.

This feature puts the **Memory-Palace pillar** into a form that a person
can walk. It is the third export, beside Org (the Lisp/Emacs pillar) and
the HTML/Card article (publishing). The medium uses the loci mechanism
of the system: the calendar is the palace, the year is the corridor, and
the thread is the route. It is **not** a presentation tool. The
primitive composition in §3 is what makes it a pillar feature. A themed
dump of titles and bullets is a generic feature, and this contract
rejects it.

---

## 1. Scope and non-goals

### In scope

- Export **one thread** to one `.zip`. This works for each
  `threads.kind`.
- **Fidelity export of the full thread. The export does NOT apply the
  `thread_articles` HTML composition.** The deck has all beads and the
  raw `entries.title` and body. It has no hidden-bead curation, no title
  or lead overrides, and no composer title, subtitle or intro. This is
  the same position as the Org export: "walk the thread *as it is*."
  The first specification was the opposite (use the curated article).
  The maker reversed it: the composer applies to HTML and PDF only, and
  the deck must show the thread, not a presentation of it.
  `getArticleData` stays the data *loader* (entries, photos, comments,
  `sectionLabel`). The export reads its `article` composition fields
  and ignores them.
- One `index.html` with **all CSS and JS inline**. The `assets/` folder
  holds the bead SVGs, the chain SVG and the copied photo bytes. The
  deck opens offline in a browser, with no network and no build step.
- Delivery: give the `.zip` to the OS through `expo-sharing` (Share) or
  SAF (Save to device). This is the same contract as Org and Markdown.

### Non-goals (explicit)

- **No template/theme picker at export time.** The export takes one
  tap, as Markdown does ("has no options"). The deck contains *both* the
  light and the dark cappuccino palette, and the **person who opens it**
  selects one. The export decides nothing that the thread does not
  already state. A theme picker belongs to a generic deck tool.
- **No editability / round-trip.** The export goes one way and is final,
  as for Org. The entry is the source of truth. To change the deck, edit
  the entry and export again. There is no scratch-edit mode. Such a mode
  suggests that the user owns the deck as a document, and the user would
  then ask where a correction went.
- **No legend, no auto-agenda, no shape relabelling.** Shapes have no
  assigned meaning. This is the primary decision of the system. Schema
  v2 removed `:BEAD_SHAPE_MEANING:` for this reason. The title slide has
  the thread name and the chain. It has no summary.
- **No transport, no sync, no hub.** The zip goes to the share sheet.
  The user selects the channel.
- **No voice notes in v1.** Voice notes are private by nature, and a
  player in a deck is outside the scope. This is the same position as
  `shareable-vakanas.md`. Photos are in the deck. Voice notes are a
  documented omission of v1.
- **Not a builder, and not curated.** There is no slide reordering and
  no layout UI for each slide. The export intentionally does *not* apply
  the curation of the HTML article composer (hidden beads, overrides,
  intro). The full, unchanged thread *is* the deck.

---

## 2. Where it slots in

Slides is a new format beside the others. It follows the structure of
`orgExport.js`:

- New module `src/services/slideExport.js`. It exports
  `exportThreadSlides(threadId)` (Share) and
  `saveThreadSlidesToDevice(threadId)` (Save). There is no options
  argument, because there are no options.
- The module uses `getArticleData(threadId)` (`threadArticles.js`) only
  as a data *loader*. The loader returns each `thread_beads` row with
  the joined entries, photos, voice notes, comments, `sectionLabel` and
  thread comments. The module **ignores** the `article` composition
  fields (hidden, title, lead, intro, template).
- One additive change in the loader: it now returns
  `sections[].sectionLabel`. The query already does `SELECT *` on
  `thread_beads`, so the change has no cost and no effect on the
  existing callers.
- The rendered bead is the **effective** bead: the live `entries.bead_*`
  values, then the snapshot, then the default. This matches the render
  rule of the app. It is not the frozen snapshot that the Org archive
  writes.
- Markdown → HTML goes through the existing `markdown-it`
  (`html:false`, `linkify:true`, `breaks:true`).
  `threadArticles.renderHtml` uses the same instance configuration. Thus
  the bodies render identically in HTML and in Slides. This is a
  transform, not a dump.
- The bead SVG and the chain SVG come from `renderBeadSvg` and
  `renderChainSvg` (`src/beads/svg.js`), which already shipped for Org.
- The photo bytes come from the resize and base64 pass (copy the
  behavior of `prepPhotoRawBase64`). The export writes them into
  `assets/`. It processes the photos in sequence. The peak memory use is
  one prepared photo.
- Zip: `jszip`. I/O: `expo-file-system/legacy`. Share and save copy
  `orgExport.exportThreadOrg` / `saveThreadOrgToDevice` and
  `threadArticles.persistArtifactToDevice` exactly.
- UI: one new row in `ThreadExportSheet` with **no detail panel**. The
  row exports on tap (Share / Save), as the Markdown path without
  options does.

No schema changes. No new tables. No migration.

---

## 3. The primitive composition (what makes this Vakana-shaped)

Each item must pass the swap test: replace "Vakana" with "Notes app",
and the item must lose its meaning.

- **The bead is on the spine, not on the slide.** The bead is the
  *locus image* for its station. But the export does **not** put it on
  the slide body. A test showed that the bead on the slide looks like a
  logo and competes with the text. The slide has only text and media.
  The bead appears on the spine, and as the per-bead
  `assets/bead-*.svg` for the Org and asset path.
- **The bead shown is the *effective* bead, not the frozen snapshot.**
  This is an intentional difference from Org. Org is a frozen archive
  and writes `thread_beads.snapshot_*`. The deck must match what the
  user sees on the screen, so it follows the `thread_beads` render rule
  of the app:
  1. the **live entry bead**, while the entry exists and has one
  2. the snapshot, only as a fallback (orphan bead, or an entry that
     never had a bead)
  3. a neutral default

  When the export rendered only the snapshot, rows with an old or NULL
  snapshot exported as gray default beads. The rule applies to the
  spine, `chain.svg`, `bead-*.svg` and the mood accent.
- **The chain is the spine, and the spine is a walkable minimap.** A
  fixed footer on each slide draws the full chain. It uses the real
  beads, with the correct shape, pattern and glyph. The current bead is
  lit and the other beads are dimmed. **A click on a bead goes to that
  station.** The spine is the progress bar, the table of contents and
  the loci route in one element. Other slide tools do not have this.
  Section beads have a gold ring.
- **Sections → chapter dividers.** `thread_beads.section_label` gives a
  full-bleed divider slide before that bead, and marks the slide of the
  bead as a chapter start. The spine shows a gold ring on section beads.
  This agrees with the pendant/ring in the app and with
  `org-export.md §5.3`.
- **Comments → speaker notes.** The comments of the entry become the
  notes for that slide. Only the presenter sees them. They have a
  timestamp and the style of marginalia. The audience sees the entry.
  The presenter sees the later thoughts about it. Other tools cannot
  copy this part.
  - The export **removes** `remind_at` and `notification_id`. They are a
    privacy risk. Org and shareable-vakanas do the same.
  - A **resolved** comment (`resolved_at` set) shows with a
    strike-through in its note (`.note.resolved`), as in the drawer of
    the app. It is an inline annotation. It does not change the
    structure of the deck or of the spine.
- **The color of the deck comes from the moods of the beads.** The
  accent comes from the dominant bead **mood** of the thread
  (`MOOD_BY_KEY`), not from a selected swatch. The light and dark themes
  are the cappuccino palette of the app (`theme.js`).
- **Auto-thread → a dated walk.** An `auto_*` thread is already a
  chronological loci walk. The sections, if there are some, divide it.
  It needs no special case, because the items above already apply.

---

## 4. Zip layout

```
<slug>/
  index.html                 # the whole deck: CSS + JS inlined
  assets/
    chain.svg                # full chain: title-slide signature
    bead-<beadId>.svg        # one per visible bead (asset/Org-parity; not shown on slides)
    photo-<entryId>-<n>.jpg  # resized/copied photo bytes
```

- `slug = slugify(thread.name) || thread-<id>`. The name comes from the
  **thread**. The deck does not read the title of the article composer.
  This matches the Org export, so the Org, Markdown and slide exports
  give the folder the same name.
- Archive name: `<slug>.zip`. Encoding: UTF-8.
- The export builds the spine from inline `<svg>`. The deck does not
  fetch an asset for each frame.
- The export writes `assets/bead-*.svg` for parity with the Org asset
  path, and as a stable file for each bead. It does not put them on the
  slide body.
- `chain.svg` is the signature of the title slide.
- The export returns
  `{ uri, filename, mimeType:'application/zip', UTI, missing[] }`. If
  the OS removed a photo, the export skips the photo and reports it. The
  export does not stop. Org and Markdown do the same.

---

## 5. Slide model

- **Title slide:** `thread.name`, `thread.description`, the full
  `chain.svg`, and a subtle anchor/date line for anchored threads. It
  has no composer title, subtitle or intro, no agenda and no legend.
- **Section divider** (only where a bead has a `section_label`): a
  full-bleed chapter title. The title is the label, unchanged.
- **Content slide, one for each bead, for all beads** (`position` order,
  no filter for hidden beads):
  - There is no bead on the slide body. It is on the spine (§3).
  - The title is the raw `entry.title || 'Untitled'`, with no composer
    override. For an orphan bead (`entry_id` null), the title is
    `(removed entry)`.
  - The body is the full `entry.content`, converted from Markdown to
    HTML and not shortened. There is no composer lead. Lists become real
    `<ul>/<ol>` elements. These are the "bullets" that the user sees.
  - The first photo is beside the text. Its side alternates with the
    position, for rhythm. The other photos are a small strip below.
  - The date is subtle.
  - The **speaker notes** are the comments of this entry (presenter view
    only).
- **Privacy:** when `isPrivate(entry)` is true, the slide has
  `MASKED_TITLE`. The export omits the body, the photos and the
  comments, and adds the one-line note
  `Private. This entry is not in this deck.` The bead stays on the **spine**.
  The visual content of the chain is not secret. This is the same
  position as the off mode of `org-export.md §8`. There is no option. A
  deck is made to give to a different person, so the safe default is the
  only default.

---

## 6. The deck engine (inlined, ~no deps)

The engine is a small custom engine in plain JavaScript. It is not
reveal.js. This keeps the zip small, offline and possible to audit
(the "small enough to audit" value of the project). It is probably the
base of the renderer for the `.vstrand` reader of
`shareable-vakanas.md`. Build it with that use in mind.

- Keys:
  - `←/→`, `space`, `Home/End`: navigate
  - `t`: theme
  - `s`: speaker notes
  - `f`: fullscreen
  - click on a spine bead: go to that slide
  - touch swipe
- The theme persists in `localStorage` (`vakana-deck-theme`). The first
  paint obeys `prefers-color-scheme`.
- Speaker notes: a bottom drawer in the same window. The engine does not
  depend on a second window. Thus the deck stays self-contained and
  works offline. The content is the marginalia of each slide. The drawer
  is hidden by default.
- Deep link: `#<n>` selects a slide. Thus a spine click or a refresh is
  stable.
- Progressive enhancement: with JS off, the deck is a readable vertical
  document. Each slide is a section and the chain is an image. The deck
  becomes a plain thread that the reader scrolls. It always shows its
  content.

Typography: a system font stack. The zip contains no font bytes, so the
deck stays offline and small.

- Titles: a high-contrast serif display font
  (`'Iowan Old Style','Palatino Linotype',Palatino,'Book Antiqua',Georgia,serif`).
- Body: a humanist sans font (`system-ui`).
- Much whitespace and a limited cappuccino palette.

"Gorgeous and minimal" means type, space and the bead as the source of
color. It does not mean chrome.

---

## 7. Coverage matrix

| Primitive | Disposition |
|---|---|
| `threads.name/description` | title slide / subtitle fallback |
| `threads.kind` (auto_*) | dated walk; no special case (§3) |
| `threads.anchor_*` | subtle title-slide line |
| `thread_articles` (title/subtitle/intro/template/hidden/overrides) | **ignored** (§1). It applies to HTML and PDF only. The deck is a raw fidelity export, as Org is |
| `thread_beads.position` | slide order |
| `thread_beads.snapshot_*` | **fallback only**. The *effective* bead (live `entries.bead_*` if present, else snapshot, else default) controls the spine, `chain.svg` and `bead-*.svg`. This matches the render rule of the app and is intentionally different from the frozen-snapshot archive of Org |
| `entries.bead_*` (live) | **primary** source for the rendered bead (§3) |
| `thread_beads.section_label` | divider slide + spine gold ring (§3) |
| `thread_beads.entry_id` null (orphan) | `(removed entry)` slide; the bead stays on the spine |
| `entries.title/content` | slide title / body via markdown-it |
| `entries.date` | subtle date on each slide |
| `entries.is_private` | masked slide; body, photos and comments omitted; the bead stays on the spine (§5) |
| `entries.highlight_tier` | star pip beside the slide title |
| `entry_photos` | resized bytes → `assets/`, beside the text |
| `entry_voice_notes` | **v1 non-goal** (§1) |
| `comments` (entry) | speaker notes (presenter only) |
| `comments.remind_at/notification_id` | **removed** (privacy) |
| `comments` (thread) | the speaker notes of the title slide (the comments on the full thread) |
| `entry_thread_links` (Mentions) | v1: not written (a deck is not a graph; examine again if users ask for it) |
| `bead_presets` / `thread_collections` | out of scope (app config) |
| app version / export time | not embedded (the deck has no provenance UI; to change the deck, export again) |

---

## 8. Possibilities framing (apply at ship)

Short bullets for `docs/possibilities.md`, each based on a primitive.
Add them at ship, not before:

- **Walk the thread for someone**: export a thread about a person or a
  project. Give that person an `index.html`. The arrow keys move through
  it, and a click on the bead chain of the spine goes to a station.
- **Your year, presented**: an `auto_month` or `auto_week` thread
  becomes a chronological loci walk with month dividers. The star did
  the curation.
- **The talk only you can hear**: your comment ladder goes with the
  deck as speaker notes. The room sees the entry. You see your later
  thoughts.
- **A chapter deck**: beads with a section mark become divider slides.
  A long thread arrives already divided into chapters.
- **Light or dark is their call**: the deck contains both cappuccino
  palettes. The person who opens it selects one. You decide nothing in
  advance.

---

## 9. Implementation checklist

1. `getArticleData`: return `sections[].sectionLabel` (additive).
2. `src/services/slideExport.js`:
   - the data load
   - `markdownToSlideHtml` (markdown-it)
   - `renderDeckHtml` (title, divider and content slides, the inline
     CSS/JS engine, the spine)
   - the photo asset copy
   - the JSZip assembly
   - share and save
   - the exports `exportThreadSlides` / `saveThreadSlidesToDevice`
3. `ThreadExportSheet`: one new row without options (it exports on tap).
4. Manual tests:
   - a user thread
   - auto_week (more than one day)
   - section labels
   - orphan beads and private beads
   - a long body with lists, a quote and code
   - more than one photo
   - a photo that the OS removed
   - comments → notes
   - the theme toggle persists
   - a spine click
   - keyboard and swipe
   - degradation with JS off
   - unzip and open in a new browser
5. CHANGELOG, version bump, and the release-doc sweep including the
   bullets of §8.
