# Interactive tutorial: the walkable cold-start sample

> **Status:** shipped v0.65.0. **Auto-seeding removed in v0.77.0.** The
> tutorial is now opt-in from Settings only. An invitation to the guide in the
> empty list now covers the cold-start problem that the auto-seed solved. The
> text below continues to describe the content and the lifecycle of the seed,
> which did not change. See
> **[Revision: auto-seed removed](#revision-auto-seed-removed-v0770)** for
> the changes and the reasons. Read this document before you change the
> tutorial seed, the `seeded` column, or the Pro Tips reload/remove UI. All the
> decisions are recorded here, so there is **no** need to repeat the design
> discussion.

## The problem it solves

A reviewer found Vakana "not intuitive", because "the features are hidden." This is
partly true and partly a result of the structure. The app has little chrome on
purpose. Thus its functions are in gestures that a new user cannot see:

- swipe-to-comment
- long-press-bead-to-filter
- the drag-FAB
- the funnel sheet
- close-the-loop
- export

The maker changed the frame of the problem during the feature-intake
discussion: **most users try first, and read the documentation only after they
become interested.** Thus anything that *interrupts a trial with text* works
against the user. Examples are a `react-native-copilot` spotlight tour and a
slide-deck onboarding. Both were **declined**. The copilot tour also has a
technical problem: it measures refs over a virtualized `SectionList`, which is
its weakest case, under the New Architecture.

The real cold-start failure is more basic: **a new Vakana is an empty list, and
it looks the same as any notes app.** Each thing that is specific to Vakana
exists only when there is content: a bead to tap, a *chain* to walk, a thread,
a comment in the margin. A real thread takes weeks to build. The new user has
nothing to react to.

## The shape (as built)

The tutorial plants a small **closed thread of six beads with numbered
glyphs**. The thread teaches the app because it *is the thing that it
describes*. The user does these steps:

1. Open the thread.
2. Walk the chain.
3. Swipe a note to comment.
4. Long-press a bead to filter.
5. Export the thread to a slide deck.
6. Delete the thread and start a new one.

The tutorial is also the **live-demo tool** of the maker. For founder-fit,
"Settings → Reload → walk → export → remove" is a pitch gesture that the maker
can repeat. It is not temporary onboarding chrome.

The user can **fully delete and reload** the tutorial. The two controls are in
**Settings → Pro Tips → Interactive tutorial**. This pair is the purpose of the
design: the tour can tell the user to delete the tutorial without risk, because
Reload restores it.

## The one hard rule: mechanics, never meaning

This rule is the full risk surface of the feature. It comes from **load-bearing
decision 1**: *the app never tells you what a bead means.*

- The tutorial copy must teach **grammar and gestures only**: "chain beads into
  a thread", "swipe to comment", "close a finished loop".
- The copy must **never** say "a circle is an encounter". It must not give a
  meaning to a shape, a pattern or a mood.

The numbered glyphs show the step order, which has no content. They are the
**one identifier for each bead**. They are **keycap number emoji** (`0️⃣…5️⃣`,
`digit + U+FE0F + U+20E3`), not plain digits. A filled, coloured keycap is
legible on a small bead. A thin text digit was not. This agrees with
`src/beads/types.js`, where `ACTION_TYPES.label/hint` are vestigial. Do not
show them.

**Each bead is round and solid. Only the mood colour changes** (decision of the
maker, v0.65.0 follow-up). There are two reasons:

1. In a plain numbered chain, the keycap glyph is the legible difference.
   Different shapes and patterns hid it.
2. The eight **forms stay for the user to find and try**. The tutorial does not
   assign them in advance. This also prevents the seed from looking like a
   shape legend (decision 1).

**Caution:** if you make the shapes different again, both problems come back.

**Renderer change: `BeadView.glyphFontSize`.** The size calculation used the
raw `glyph.length`. A keycap emoji has 3 code units, so it got the smallest
font (the 3-character size) and was almost invisible. The fix added
`visualGlyphLength()`. This function removes the variation selectors and the
combining enclosing keycap, and counts a surrogate pair as one. Thus a single
*visual* grapheme (a keycap or one emoji) gets the size of one character. This
is a general correctness fix, not a tutorial-only fix. It only *increases* the
size for glyphs with more than one code unit. The `singleCharGlyph` path for
upright rotation is intentionally unchanged. It does not apply to the round
tutorial beads.

## Lifecycle & state model

There are two different pieces of state, with two different jobs. **Do not
confuse them:**

1. **`entries.seeded` / `threads.seeded`** (schema, `INTEGER DEFAULT 0`,
   `ensureSeededColumns` shim in `db.js`). These columns mark the rows that the
   app planted. With them, Reload and Remove can **find the tutorial set
   exactly**. The answer to "Is the tutorial present?" is **derived** from
   these columns (`COUNT(*) WHERE seeded = 1`). Do not store it as a boolean.
   The user can swipe-delete *some* tutorial notes in the list, and a stored
   flag would then be wrong.
2. ~~**`vakana_tutorial_autoseed_done`** (secure-store). Governs **only** the
   first-run auto-seed.~~ **Retired in v0.77.0** together with the auto-seed.
   The app does not read or write the key. A value that stays in secure-store
   on an existing install has no effect. Nothing needs to clear it.

`src/services/tutorialSeed.js` is the only writer:

| Function | Trigger | Behaviour |
|---|---|---|
| ~~`seedTutorialIfFirstRun()`~~ | None | **Removed in v0.77.0.** The tutorial does not plant itself at boot. It is opt-in from Settings. See [Revision](#revision-auto-seed-removed-v0770). |
| `seedTutorial()` | Settings "Add" | Inserts the thread, 6 beads and 1 demo comment. Does nothing if the tutorial is already present. |
| `isTutorialPresent()` | Pro Tips screen (on focus) | Derived from the `seeded` rows. |
| `reloadTutorial()` | Settings "Reload" | Calls `removeTutorial()` and then `seedTutorial()`. This is also the repair path after a partial delete. |
| `removeTutorial()` | Settings "Remove" / the user is done with it | Removes the comments (polymorphic, through `removeCommentsForParent`). Detaches auto-beads as a precaution. Deletes the seeded entries (the delete cascades to photos and voice notes) and the seeded thread (the delete cascades to `thread_beads` and the collection links). |

## Decisions resolved (so they aren't re-litigated)

- **Seed does NOT auto-thread.** `seedTutorial` does not call
  `syncAutoBeadForEntry`. Thus the only thread on a new install is the curated
  tutorial thread. This gives a clear answer to "what is a thread?" at first
  contact, and leaves nothing extra to remove at teardown. If the user *edits*
  a tutorial entry, the save of the editor auto-threads it. For that reason,
  `removeTutorial` detaches auto-beads as a precaution.
- **Dates: `today - dayOffset`, note 0 = today … note 5 = 5 days ago.** With
  these dates, the home list (newest first) reads `0→5` from top to bottom.
  The chain (position `0→5`) reads `0→5` from left to right. The dates also
  show the time-band headers. The dates go backward relative to the chain
  position. The user does not see this, because the copy does not refer to
  dates.
- **Closed thread.** The tutorial thread has `closed_at` set. Thus it shows the
  close-the-loop clasp and the gesture to export a finished thread.
- **One demo comment** is on note 4, and note 3 refers to it. Thus the 💬 chip
  and the margin are visible before the user does anything.
- ~~**Vault caveat.** The autoseed marker is global (not per-vault)…~~ **Not
  applicable since v0.77.0.** Nothing auto-seeds, in any vault. Each vault
  starts empty and offers the guide from its empty list. Settings adds the
  tutorial on request, into the active vault.
- **`possibilities.md` intentionally NOT swept.** The tutorial is onboarding
  chrome. It is not a use that composes primitives. A bullet such as "we have
  an onboarding tutorial" fails the swap test, because all apps have
  onboarding. `possibilities.md` forbids that type of generic entry. The
  operational instructions are in `user-guide.md`.

## Revision: auto-seed removed (v0.77.0)

**Decision: the tutorial does not plant itself.** It is opt-in from
**Settings → Pro Tips → Interactive tutorial**, as before. Only the injection
at boot was removed. A one-line invitation to the guide now covers the
cold-start problem. The invitation shows in the empty list and in no other
location.

The *content* of the seed, the lifecycle functions and the `seeded` columns did
not change. `seedTutorialIfFirstRun()` and its `vakana_tutorial_autoseed_done`
marker are retired. `seedTutorial()`, `reloadTutorial()`, `removeTutorial()`
and `isTutorialPresent()` are unchanged.

### Why the original reasoning stopped holding

The v0.65.0 argument was correct *at that time*. Users try before they read, so
anything that interrupts a trial with text works against the user. For this
reason a copilot tour and a slide deck were declined.

But that argument assumed that **"just point them at the guide" was not a real
option. At that time, it was not:**

- The guide took ~3 seconds to open.
- A third of the links in its table of contents did not work. Three different
  anchor bugs caused this. All were fixed in v0.76.0/v0.76.1.
- The guide was one 12,000-word scroll with no divisions and no search.

As of v0.76.1, the guide opens in **~75ms**. The user can search it by heading
*and* by body text, and each anchor resolves. The alternative that was rejected
in v0.65.0 was not usable then. It is usable now. This revision does not
reverse a bad decision. It makes the same decision again with different costs
and benefits. Independently, the bottom navigation of v0.70.0 also removed part
of the first "features are hidden" complaint.

### The identity argument (the decisive one)

For a notes app, sample data is not important. For Vakana.mg, it is. The app
holds that the beads are **yours**, and that meaning is private and written by
the user (load-bearing decision 1). The app is a memory palace. On the first
day, the auto-seed put six memories of a different person into that palace.
The first act of the user was then *to delete the notes of a different person
to make room for their own*.

The **mechanics-never-meaning** rule above was a careful attempt to prevent
this problem. For the wording, it works: the copy does not assign a meaning to
a shape. But seeded rows with mechanics-only copy are still content in the
palace that the user did not put there. The contradiction is in the
*placement*, not in the wording. Thus better copy cannot remove it. The maker
made this decision after direct use of the feature.

### What replaces it

The empty-journal branch of `HomeScreen.renderEmpty` gets one line that invites
the reader into the user guide. `SettingsGuideViewer` is a flat route in the
same stack, so the line needs one `navigate` call and no new navigation
surface.

This line is not the "persistent chrome" that the minimalism rule forbids:

- It exists **only while the journal is empty**. It goes away permanently at
  the first entry.
- It uses space that was already an empty state.
- It adds no header icon, no toggle and no setting.
- An error in this decision has no cost. A user who ignores the line does not
  see it again.

### Rejected in the same discussion

- **A first-run "Start empty / Explore a sample?" chooser.** This is generic
  onboarding chrome. It forces a decision at the worst moment, and it clearly
  fails the swap test.
- **Deleting the tutorial code.** The founder-fit point of this document stays
  correct: "Settings → Reload → walk → export → remove" is a live-demo gesture
  that the maker can repeat, and Settings always started it. The removal of the
  auto-seed does not change that gesture.

### Deferred: the tutorial as its own vault

Examine this idea again later, not now. If the app seeds into a **separate
vault**, the tutorial becomes a place that the user visits. It is no longer
clutter in the journal. It stays walkable and real, it does not touch the
palace of the user, and the user removes it when they delete a vault. The maker
could also give a public demo **without a personal journal on screen**. The
current gesture from Settings cannot do that.

The blocker is that vaults have **per-vault PINs**. A tutorial vault must do
one of these two things:

- ask for a PIN at the first touch, which is awkward at the worst moment
- use an exception without a PIN, which weakens the vault model

This is a real design problem, not a detail. Thus it is a separate question and
is not part of this revision.

## Files

- `src/services/tutorialSeed.js`: content and lifecycle (the full feature).
- `src/database/db.js`: the `ensureSeededColumns` shim (entries and threads).
- ~~`App.js`: `seedTutorialIfFirstRun()` in the boot `prepare()`.~~ Removed
  in v0.77.0. Boot does not touch the tutorial.
- `src/screens/HomeScreen.js`: the empty-journal branch of `renderEmpty` has
  the guide invitation that replaced the auto-seed (v0.77.0).
- `src/screens/SettingsProTipsScreen.js`: the Reload/Remove/Add UI.
- `src/components/BeadView.js`: `visualGlyphLength` and `glyphFontSize` (size
  of keycap emoji).

## Change-checklist pointers

- Schema: `seeded` is a `PRAGMA table_info` shim. It is not in the main CREATE
  block (`change-checklist.md` → "If you touched the schema").
- Writes must go through the `tutorialSeed` service. Do not put the SQL inline
  in a screen.
- Comment cleanup must call `removeCommentsForParent` **before** the row
  delete (polymorphic, no FK).
- Identity check:
  - The tutorial passes the swap test. The sample notes of a Notes app do not
    form a closed chain that the user can export and that documents chaining.
  - It adds no new *persistent* home chrome. The controls are in Settings.
  - It teaches grammar, never meaning.

## Revision: intro slides added alongside (v0.78.0)

Field feedback from two testers (2026-08-13) showed that the remaining gap was
not *how* but *what*. Nothing before the third tap answered "c'est quoi?", and
the guide has the length of documentation. Six first-launch **intro slides**
now run before the PIN gate. The user can replay them from Pro Tips.

This revision supersedes the "no slides" part of the v0.65.0 decision. The
maker overrode that part with this evidence. It does not change this tutorial.
The slides are the *what* layer. The walkable thread stays the opt-in *how*
layer. Contract: `docs/architecture/onboarding-slides.md`.
