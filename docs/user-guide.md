# 📿 Vakana: User Guide

This guide describes each screen and each gesture. Read it from top to bottom the first time, or go directly to a section.

> 🔍 In the app, tap the **search icon** in the header to filter these sections by a word. The search reads the headings *and* the body text. Tap a result to go to that section. After you scroll down, a **Contents** pill appears in the corner. Tap it to go back to this list.

## 📋 Contents
1. [🔐 Setting up your PIN](#-setting-up-your-pin)
2. [✨ First launch: an empty journal, and the optional tutorial](#-first-launch-an-empty-journal-and-the-optional-tutorial)
3. [🏠 Home screen at a glance](#-home-screen-at-a-glance)
3. [🔄 Switching between list, calendar, and threads](#-switching-between-list-calendar-and-threads)
4. [✍️ Creating an entry](#️-creating-an-entry)
5. [🧹 Editing and deleting entries](#-editing-and-deleting-entries)
6. [🔍 Filtering and searching](#-filtering-and-searching)
7. [⚡ Quick capture (drag-FAB)](#-quick-capture-drag-fab)
8. [📷 Photos](#-photos)
9. [🎙 Voice notes](#-voice-notes)
10. [🧿 Beads](#-beads)
11. [🧵 Threads](#-threads)
12. [🌀 Auto-threads](#-auto-threads)
13. [🗂 Collections](#-collections)
14. [📎 Mentions](#-mentions)
15. [💬 Comments](#-comments)
16. [🔔 Comment-reminders](#-comment-reminders)
17. [⏰ Reminders](#-reminders)
18. [🔄 Returns: the bell and Wander](#-returns-the-bell-and-wander)
19. [🎨 Themes & appearance](#-themes--appearance)
20. [🗄 Vaults](#-vaults)
21. [📦 Backup & restore](#-backup--restore)
22. [📤 Sharing & publishing](#-sharing--publishing)
23. [📥 Importing notes (the capture bridge)](#-importing-notes-the-capture-bridge)
24. [⚗️ Fuse & thread (cleanup)](#️-fuse--thread-cleanup)
25. [🔒 Privacy & re-locking](#-privacy--re-locking)

---

## 🔐 Setting up your PIN

After a new installation, the app first shows a short set of **intro slides**. The slides show a welcome and then the five steps of the system:

1. Take a note.
2. Shape its bead.
3. Do this again a few times.
4. See the day make its own thread.
5. Or string your own thread.

Swipe through the slides, or tap Skip. The app shows them one time only. To see them again, go to **Settings → Pro Tips → Intro slides → Watch the intro again**.

After the slides, the app tells you to **create a 4-digit PIN**.

1. Type 4 digits. The dots fill as you type.
2. Type the same 4 digits again to confirm. If the digits do not agree, the screen shakes and you start again.

After that, each launch shows the lock screen and asks for the PIN. Type the PIN on the **on-screen keypad**. Vakana.mg does not open the keyboard of your phone on this screen. Use the ⌫ key to correct a digit. If the PIN is wrong, the screen shakes. If the PIN is correct, the app unlocks immediately.

Five wrong PINs in sequence lock the keypad for 30 seconds. The message *Too many attempts. Try again in 0:30* shows below the dots and counts down. Each subsequent wrong PIN doubles the wait time, to a maximum of 15 minutes. The wait time does not reset when you close the app. The correct PIN resets the count.

> 💡 The PIN is stored on the device only. Vakana has no accounts, no cloud sync, and no telemetry. Each **vault** has its own PIN (refer to the [Vaults](#-vaults) section). If you forget the PIN of a vault, no remote recovery is available. Keep [backups](#-backup--restore) to make sure that you do not lose the data.

## ✨ First launch: an empty journal, and the optional tutorial

A new journal is **empty**. This is intended: Vakana does not put sample notes in your journal before you write your first note. Below **New here?**, the empty list shows two links:

- **User guide**: this document, which tells you how each function works.
- **Possibilities**: what people do with the app.

The two links go away permanently after you make your first entry. After that, you can find them in **Settings → Pro Tips → Guides**.

If you prefer to learn by practice, you can add an optional **interactive tutorial** at any time. Go to **Settings → Pro Tips → Interactive tutorial → Add to my journal**. The tutorial adds a small *closed* thread with the name **"Your first thread"**. The thread has six numbered beads (0–5). The tutorial takes 90 seconds. Each note tells you to do one action:

- Tap a bead.
- Open the thread.
- Swipe a note to write a comment.
- Long-press a bead to filter.
- Close the loop and export.

The tutorial does not tell you what a bead *means*. You always make that decision.

When you complete the tutorial, **make the journal yours**. Swipe a tutorial note to the left to delete it. Or remove the full set with one tap from the same Settings page. You can get the tutorial back: tap **Reload**. Use it to learn the app again, or to show Vakana to a different person. The app adds the tutorial only when you ask for it.

## 🏠 Home screen at a glance

After you unlock the app, you see the home screen. The header title changes with the view and tells you where you are. The title is a Malagasy word. The English line below the title is the epithet.

- **Vakana**, *Beads of life*: the list.
- **Tetiandro**, *Book of days*: the calendar.
- **Tohivakana**, *Threads of life*: the threads.

On the list and on the threads, the epithet also shows a **live density**: *15 Beads of life* / *5 Threads of life*.

- The count follows the applied filter (pin / facets / search).
- The noun changes to the singular when the count is one (*1 Bead of life*).
- When no item agrees with the filter, the app hides the number and shows only *Beads of life*. It does not show *0*.
- The epithet of the calendar does not change. *Book of days* does not show a number.

The header also contains these icons:

- 🎲 A **Wander** icon (dice). This icon is *opt-in* and is hidden by default. When Wander is on, the icon is immediately to the left of the bell.
  - Tap the icon to open a random entry that is older than your configured threshold.
  - The bell shows returns that *you* set. The dice shows a return that the *system* selects at random.
  - To enable Wander and select a threshold, go to Settings → Threads & returns → Wander. The thresholds are 3 months / 6 months / 1 year / 2 years, or a custom day count from 1 to 3650. The default is 6 months. Refer also to [Themes & appearance → Returns: bell and Wander](#-themes--appearance).
  - The icon is also hidden if your journal has no old entries that qualify.
  - Private entries are never in the Wander pool.
- 🔔 A **notifications** bell. It shows fired calendar reminders and comment-reminders. Tap it to expand the banner stack. The panel opens also when no reminder waits. On such a day, it tells you that no reminders fired.
- ⚙️ A **settings** icon. It opens the Settings page (theme, vaults, backup, pro tips, about).
- 🔒 A **lock** icon. It re-locks the app immediately.

Below the header, you find these items:

- A search box (full-text search in title + body).
- The entries.
- A floating `+` button, immediately above the bottom navigation bar.
- The **bottom navigation bar**, which changes the view.

> **ON THIS DAY · PRIOR YEARS**: when an entry from a prior year has the MM-DD of today, a head section with the label `ON THIS DAY · PRIOR YEARS` appears above TODAY and shows those rows.
>
> The band is hidden when the list is already a filtered scope: a typed search, a pinned bead pill, a pinned thread pill, or an active funnel facet. A "same-date" band above a filtered view does not make sense.
>
> Each prior-year row is a normal `EntryCard`. Thus the usual gestures work on it: swipe-comment, swipe-delete, long-press into select, and long-press the bead to filter.
>
> In a year that is not a leap year, no row agrees with Feb 29, and the band does not show.

## 🔄 Switching between list, calendar, and threads

Use the **bottom navigation bar**: **Vakana (beads) · Tetiandro (calendar) · Tohivakana (threads)**. Each view shows an icon and a label, and the active view has a tint. Tap a view to go to it. The change is immediate.

There is **no swipe-to-switch**. That gesture was removed when the bar was added. As a result, a horizontal drag does not conflict with the vertical scroll or with the row swipes. These gestures are separate and did not change:

- The calendar keeps its left/right **month-nav swipe** *inside the grid*.
- Entry rows and thread rows keep their swipe-to-Comment / swipe-to-Delete.

The calendar also keeps its state between view changes: it remembers the month that you looked at.

- **List view** (the **Beads** tab) shows a vertical feed of flat entry rows, newest first. Sticky time bands group the rows: *Today*, *Yesterday*, *Earlier this week*, *Earlier this month*, then [Month YYYY] for older entries.
  - Each row **starts with its bead on the left**. The bead is larger and vertically centred across the title and the excerpt. An entry without a bead shows a note glyph in a faint round ring in the same position.
  - Adjacent to the bead, the row shows the title, a one-line excerpt of the body, attachment-count icons (📷 / 🎙), and a comment chip.
  - The row also shows a 🜸 **thread chip** when the entry is on one or more threads (≥1). The chip shows the number of threads.
  - The **date** of the entry is at the top-right. When the entry has a time of day, the time is below the date.
  - A highlighted entry shows a small ★ pip at the top-right of the bead. The pip is filled for a weekly highlight. It has a halo ring for a monthly highlight.
- **Calendar view** shows a month grid (Sunday → Saturday) where each day is a colored cell:
  - Each day shows the **bead it holds**. This is the highlighted bead of the day or, if there is none, the latest entry of the day that has a bead. A faint `+N` shows when the day holds more than one bead. As a result, the month looks like a string of beads.
  - A day with entries but **no** bead shows the entry-count **heatmap fill** (more entries = darker).
  - A **ring** marks today.
  - A small numeral shows the entry count on the filled days that have no bead.
  - A **bell** glyph appears on days that have scheduled reminders.
  - A **ribbon** marks days that you **anchored a thread to** (a year-thread on its start date, a practice on day 1, a per-person record). The ribbon shows *your* anchors only. It does **not** count the automatic per-day thread. Thus the ribbon stays an infrequent signal with a meaning, and does not appear on each day that has notes.
- **Threads view** shows each thread as a card. The card has a handwritten title in Caveat above its bead chain, with a short date.
  - You can filter the list by collection, by kind (User / Auto / All), and with a name/description search.
  - You can sort the list Recent ⇄ A–Z.
  - Band headers (recency or first-letter) group the cards, as in the entry list.

In calendar view, you can do these actions:

- **Swipe** left/right (or tap the chevrons) to change the month.
- **Tap the month label** to open a year picker.
- **Tap a day** to open the Day screen. The threads anchored to that day show at the top, above the entries of the day. Tap a thread to open it.
- **Long-press a day** to go directly to the editor with that date pre-filled.

A day that has an anchored thread but no entry is not "empty". The thread shows there, because the anchor is the important data. The panel below the grid lists each reminder for the visible month. It shows **calendar reminders** (bell icon) and **comment-reminders** (chatbubble icon) together, in chronological order.

## ✍️ Creating an entry

These are the fastest procedures:

- **From list view**, tap the `+` FAB. The editor opens with the date of today.
- **From calendar view**, tap a day to open the Day screen, then tap its `+` FAB.
- **From calendar view**, long-press a day. The editor opens with that date pre-filled.

The editor has these parts:

- **Title row**: a 40 px **bead avatar** is inline, to the left of the title input. Tap the bead to compose or edit it. For a new entry with no bead, tap the dashed circle ("Make a bead").
- **Meta strip** (immediately below the title):
  - A small calendar chip shows the formatted date. Tap it to change the date.
  - A **clock glyph** is adjacent to the date. Most entries are about a *day*. Tap the clock to give an entry a **time of day**. The chip then shows, for example, `11 Aug 2025 · 2:30 PM`. Tap the clock again to change the time, or tap the × to clear it.
  - A timed entry sorts by its hour in the day on the auto-thread chain. Entries with no time keep the sequence in which you wrote them.
  - A **★ Highlight** chip cycles `off → Weekly highlight → Monthly highlight → off`.
  - A chevron-thread chip shows when the bead of this entry is on one or more threads.
- **Body** (multiline): your free-form text. On a new entry, the body has the focus automatically.
- **Top-bar `+`** opens an **Attach** sheet with five rows: *Take photo*, *Pick from library*, *Voice note* (starts to record immediately), *Pick audio file* ("Up to 50 MB"), *Mention a thread*. The photos section, the mentions section, and the voice-note section appear below the body only when they hold content. An empty entry shows only the content area below the meta strip.

There is **no Save button**. Vakana saves automatically approximately one second after you stop typing. The left slot of the header always shows the state of your entry:

- A pencil and `Editing…`: some changes are still in memory.
- `Saving…`: the write operation runs.
- A check mark in the accent colour of the palette and `Saved`: the entry agrees with the data on disk. This state stays on screen for as long as that is true. It also shows when you open an existing entry.

The check mark appears with a short animation when the save completes. A new entry with no text shows no state, because there is no data to save. If you go back before the save delay ends, the app does a final save automatically.

**Undo and redo.** While you type, a thin bar shows on top of the keyboard. It has **undo** and **redo** arrows on the left, a **tree** icon adjacent to them, and a chevron on the right that dismisses the keyboard.

- Undo moves the title and the body back through your pauses in this session. Each state where you paused is one step. These are the same pauses that start the auto-save.
- Redo moves forward again.
- It is not important that auto-save already saved a deletion. Undo restores the text, and the restored version saves automatically like any edit.
- Undo does not discard data. If you type after an undo, redo can still get the undone version.
- The bar shows only while the keyboard is open.
- The history stays for the current visit to the entry. It resets when you leave the entry.
- Undo does not include attachments, the bead, the date, or highlights. Each of these has its own controls.

**The history tree.** Tap the tree icon. A half-height sheet shows each state from this session as a chain of beads.

- The newest state is at the top. Your current state is filled solid.
- A version that you abandoned (you did an undo, then typed different text) hangs in its own dashed branch. You can still restore it.
- Each row shows the time of the pause and the change (`+ 42 chars`, `title edited`).
- **Tap a bead, and the entry above the sheet changes to that state.** You can read it there as it was.
- **Tap the same bead again to restore it.** It then saves automatically as usual.
- Tap outside the sheet to close it and restore nothing. Your entry goes back to its state before you opened the sheet.

Use the tree to get back a paragraph that you deleted many edits before. Find the branch where the paragraph exists, preview it to make sure, then tap to restore.

**Markdown formatting.** The content body, the thread description, and comments all accept inline markdown: `**bold**`, `_italic_`, `~~strike~~`, `` `code` ``, fenced blocks, `# headings` (rendered small, not document-sized), `> blockquotes`, `- bulleted` / `1. numbered` lists, `[link](https://…)`.

When the field loses focus, the source text changes to the rendered view. Tap the rendered view to edit again. The cursor goes to the position where you stopped. The database stores plain text, thus the text that you type *is* the text that is saved. The format is only a view. List previews and bubble tooltips on the threads tab use a compact inline-only render: bold, italic, code, strike, and links are visible, and block elements become flat. As a result, `numberOfLines` still clamps correctly.

## 🧹 Editing and deleting entries

- **Tap** an entry in the list or in the day view to open it in the editor. The auto-save behavior is the same.
- **Swipe left** on an entry in the list. A red **Delete** action shows, and the app asks for confirmation.
- **Swipe right** on an entry. A primary-colored **Comment** action shows, and the comments drawer opens immediately. There is no confirmation. The swipe *is* the commit.
- **Long-press** an entry to enter [multi-select mode](#multi-select-mode) with that entry already checked. Tap more rows to add them, then use the header actions:
  - **Fuse** (needs ≥2 selected).
  - **Thread**: string the selected beads onto an existing thread, or start a new thread in the composer with the beads pre-loaded.
  - **Delete** (after a confirmation).
- When you thread an entry that has no bead, the entry gets a default bead (round, slate, no glyph). Thus the chain has a bead to snapshot. You can change the bead from the editor afterward.
- If you long-press the *bead* of the row, the bead becomes a filter (see below).
- **From inside the editor**, the trash icon (top-right) deletes the entry after a confirm dialog.
- **Share icon** (top-right, left of trash) opens a **format-first Export** sheet. First select a format: **Markdown**, **HTML**, or **Card**. Then a per-format panel appears.
  - HTML shows a five-template radio (Editorial, Journal, Minimal, Storyboard, Postcard).
  - Card shows an *Include sticky-note comments* toggle (Card vs. Card with Notes).
  - Each panel ends in one **Share** action. Refer to [Sharing & publishing](#-sharing--publishing) for the full procedure.

## 🔍 Filtering and searching

The list view has a search box and a **Filters sheet**. You can use the two together with all other filters.

- **Search** looks in the title, the body, and the **comments**. The list becomes narrower as you type.
  - **A saved-bead pin**: when the typed prefix agrees with one of your saved beads, a chip strip appears immediately below the search bar. For example, `Pla` shows *Place* and *Plant*.
  - Tap a chip to **pin** that preset as a removable pill **above** the search bar. The input clears, and you can then search *within* the entries of that bead (title, body, comments).
  - The pill shows the symbol of the bead, its name, a **live count** of the entries that agree, and a × button to remove it. An example is *morning ritual · 47*. The count shows how frequently the bead occurs in your journal. It decreases live when you refine the search with the text input.
  - If you change the facets of the bead in the Filters sheet, the pill detaches automatically. The name goes away, and your facet edits stay.
  - The strip and the pill never show together. The strip offers the beads, and the pill holds the selected scope.
  - If your search finds no entry, the empty state names the pinned bead (in primary color). It also points to the × of the pill, which removes the scope.
- **Thread pin** (v0.62.0): the same pill slot above the search bar also accepts a **thread** as a scope.
  - From a user thread, tap the **bead-count chip** in the metaStrip below the title. The chip is tappable when the count has a `list-outline` icon. On auto-threads, the count has the inert `ellipse-outline` icon.
  - The chip opens Home with the scope set to the members of that thread.
  - The pill shows the thread name + live count + ×. The input placeholder reads *"Search within this thread…"*. The empty state names the thread and points to × to remove the scope.
  - Thread-pin and bead-pin are mutually exclusive. Only one captured scope is possible at a time.
  - The chain view (on the thread) shows the beads. The list view (on Home) shows the text.
  - This function is available on user threads only. Auto-threads (day / week / month) do not have the trigger in v1.
- **Filters sheet**: the funnel icon in the search row opens a bottom sheet that holds each bead facet. There is no inline pill bar, thus the list keeps its full height. When filters are on, the funnel becomes colored and shows a small **count badge** (the number of active facets). The sheet contains these items:
  - **Connection: Unwoven only / Mentions a thread**. These are two switches above the bead facets. They are the two opposite parts of one filter.
    - *Unwoven only* shows only the entries with **no thread connection of either type**. Such an entry is not on a user-thread chain, *and* does not mention a user thread. Auto-threads are excluded, because each entry is on the daily auto-thread.
    - *Mentions a thread* is the opposite: each entry that points at a different user thread.
    - Each switch clears the other, because the two together always give an empty list.
    - The two switches AND-compose with the bead facets. For example, `Unwoven + a saved bead` lists each unwoven entry that has that bead.
    - *Unwoven* works directly with *Select all N → thread*. Thus you can find the entries and thread them in one operation.
    - You open this filter by choice. It is never an inbox banner or an automatic reminder.
  - **Capture: Has a photo / Has a voice note**. These switches find the entries that search cannot find.
    - Search reads the title, the body, and the comments. A voice-only entry has none of the three. A photo that you saved with no title has a `Draft …` timestamp as its title.
    - There are two switches and not one *has media* switch, because users look for voice notes most frequently.
    - The switches AND together and with all other filters. *Has a voice note* + a saved bead is a permitted query.
  - **Shape · Mood · Pattern**. Each facet shows the bead vocabulary itself (the actual shapes, mood-colored beads, pattern swatches), not text labels. Tap to multi-select. The logic is AND between facets and OR within a facet.
  - **Glyph**. This is a searchable list of each glyph that you used (with counts), because glyphs are open-ended. You can multi-select.
  - **Select all N → thread**. With an active filter, one tap strings each entry that agrees onto a thread. The query becomes a curated chain. The sheet also has **Clear all** and **Done**.
  - **Whose bead is this?** While a filter is active, each result names the user thread(s) on which its bead is strung. It names a maximum of two, then *+N*. Tap to expand the full list.
    - Thus you can tell apart two persons who share the same bead vocabulary, and you do not have to open an entry.
    - Mentions do not show in this strip. It shows only the chains on which the bead sits.
    - The strip follows the filter. The normal list keeps the plain thread count.
  - Filters are temporary. The app does not save them. When you close or clear the filters, the full chronological list comes back.
- **Inline comments toggle** (chatbubble icon at the right of the search bar) changes a global default. When it is on, each list row shows the latest 2 comments below the main content. The comment chip of each card is also a per-card toggle that overrides the global default.

The threads view has its own search box (it looks in `name` or `description`), a kind filter (User / Auto / All), and a collection filter. All of these AND-compose.

- Its search bar and its lens toggles have the same look and position as those of the entry list: the same metrics, an inline × clear, and the sort + inline-comments icons in the bar.
- A small sort icon toggles **Recent ⇄ A–Z**. The app remembers the selection.
- The list groups into **band headers**, as the entry list does:
  - Recent → Today / Earlier this week / [Month YYYY], by last-updated.
  - A–Z → first-letter sections. If you prefix threads `Person · Mom`, `Person · Dad`, `Proj · …`, the prefixes group together. This gives structure with no folder tree.
- Only User threads re-sort and band. Auto-threads stay newest-first, because their names are dates. They show as one group with no label.
- Thread cards have no date, because a thread is not tied to a calendar day. Entry rows keep their date.
- The list appears immediately. The bead chain of each card fills in a moment later, and a placeholder holds its position until then. The app draws the full chain lightly, thus a long list stays fast.

> **QUIET · {N}d+**: this band appears below User + Recent. It holds the threads that you did not touch for longer than the Quiet threshold and that are not closed (no clasp). These threads move out of their usual date band into a tail section at the bottom of the list. The section label is `QUIET · {N}d+` (default `QUIET · 180d+`).
>
> The threshold counts from the *last real touch* of the thread itself. These actions count as a touch: you add a bead, write a comment, collect the thread, rename it, change the anchor, or save an edit. A Mention of the thread does **not** count. A mention is a soft cross-reference on the entry side, not a commit on the thread side.
>
> Quiet is a third state between *Live* and closed with *Close the loop*. The app does not delete the thread, and the thread does not look active. Add a bead again (or write a comment, or rename the thread), and the thread goes back into TODAY on the next reload.
>
> Closed threads (those that you clasped with *Close the loop*) keep their usual date band. They have their own visual mark (the clasp chip on the card) and never enter Quiet.
>
> The band appears only below User + Recent. If you change to A–Z or to Auto / All, the section goes away. It conflicts with the alphabet and with the auto-thread anchor dates.
>
> **Configure the threshold** in **Settings → Threads & returns → Quiet threshold**. The presets are 30 / 90 / 180 / 365 days. Or select **Custom** to type an integer day count from 1 to 3650.

## ⚡ Quick capture (drag-FAB)

Use quick capture when you do not want to open the editor:

- **Long-press** the `+` FAB. A small radial menu appears.
- **Drag** your finger to a target and do not lift it:
  - **↑ Voice**: opens a centered recording sheet that starts automatically. Tap stop to save. This creates an entry with the title `Record <stamp>`. Tap X to cancel.
  - **↖ Photo**: starts the camera. Confirm the photo to save it as a new entry with the title `Photo <stamp>`.

Quick captures appear in the list immediately. To expand one later, tap it to open the editor.

## 📷 Photos

Inside an entry:

- **Camera**: take a photo with the back or front camera.
- **Gallery**: select one or more photos from the library.
- **Long-press** a thumbnail in the strip to remove it.
- **Tap** a thumbnail to open a full-screen viewer:
  - Swipe horizontally between photos.
  - A counter shows `n / total`.
  - The X (top-right) closes the viewer.
  - On web, prev/next chevrons appear, because the swipe gesture is not available.

> The app copies each photo into its own storage when you attach it (since v0.78.1). Thus the system cache cleanup cannot remove the photos. The photos are still only on this device. Backups protect them if the phone is lost or broken.

## 🎙 Voice notes

Inside an entry:

- **Mic** button: starts to record. While it records, you see a red dot that pulses and a live `m:ss` timer.
- **Stop** the recording to save it to the entry.
- **Library** button (musical-notes icon, adjacent to the mic): selects an audio file from your phone (recordings, music, podcasts). The app copies the file into its own storage, as it does for a new recording.
  - **Up to 50 MB per file.** The limit shows below the row. The picker rejects a file that is too large and shows an Alert with the actual size.
  - The app reads the duration of the file on import. Thus the row shows, for example, "3:42" and not "0:00".
- **Tap** a recording to play it. **Tap again** to pause.
- Tap the **Trash** icon adjacent to a recording to remove it.

## 🧿 Beads

A **bead** is one small visual that records the mood, the theme, or the type of moment of an entry. Each entry can have one bead. Beads have a **warm-glass finish**: a soft lit gradient and highlight, with a light cast shadow. In dark mode, the shadow is a glow in the colour of the bead. Thus a bead looks like a small physical object and not like a flat icon.

Tap the bead slot at the top of the editor (or the existing bead) to open the **Bead Composer**. When you have saved beads, the sheet opens on your **saved beads**. These are your stable vocabulary. The sheet does not open on a blank composer.

- **Pick a saved bead:** tap a saved bead to apply it. The preview shows it, and the chip that you selected shows as selected. The app saves the bead a moment later, as it saves all other changes. The composer **stays collapsed**: tap **Done** there to finish, and do not open the composer. If you have more than eight saved beads, a search box appears. Use it to find a bead by name.
- **Compose new:** tap **Compose new** only when you want to *change* the bead. It expands the four-dimension composer in place. Tap it again (**Collapse**) to go back to the saved-bead list. When you have no saved beads, the composer is the first thing that you see.

A bead has four dimensions. Each change shows immediately:

- **Shape:** eight shapes (square, circle, oval, lozenge, bar, dot, decagon, flower), shown as compact swatches with **no fixed meaning**. Vakana is a personal encoding system, not a taxonomy. *You* decide what a circle means to you. The app never forces "square = task". Screen readers say the geometry, for example "Circle", and not an imposed label.
- **Pattern:** solid, striped, diagonal, dotted, floral, dashed, checkered, circle. The pattern applies to the surface of the bead. It has the same compact swatch layout as Shape.
- **Mood:** controls the color of the bead.
- **Glyph:** a short character (letter, digit, or emoji-like symbol) shown on the bead. The glyph is the one place where *you* name the bead. The default is the first letter of the title. You can clear it to none.

To add a bead to your saved beads, tap **+ Save this bead** inside the composer and give it a name (for example "Morning run"). The app saves each change as you make it. There is no commit button. Tap **Done** to close.

**To manage a saved bead, long-press it:**

- **Delete** removes it from your vocabulary. Your past entries do not change. A saved bead is a stamp, not a link.
- **Reshape across history…** renames or reshapes the *symbol itself*, or does the two together. Change its facets, then select one of these options:
  - **Future use only**: only the beads that you stamp from now on have the new look.
  - **Also rewrite the N past entries** that currently use this exact bead: your history shows the new symbol at each place where the bead appears. This includes the chains on which it is strung. The screen tells you the exact number of entries.
  - **Warning:** if you select **Also rewrite the N past entries**, **this cannot be undone**. Thus the safe "future only" option is the default.
  - A rename alone never changes past entries. Past entries store only the look of the bead, never its name.

**Long-press** the bead in the editor to open a small action sheet:
- **Edit bead** (same as a tap).
- **Add to thread** (links this bead into a thread; see below).
- **Remove bead** (the entry then has no bead).

**Echo chip: `⤺ {date}`.** A small `⤺ {date}` chip appears when the bead of the current entry has one or more occurrences that are strictly older. An older occurrence has the same `{shape, pattern, mood, glyph}`, by exact value, on an entry dated before this one. The chip is in the meta strip of the editor, adjacent to the date / highlight / private / thread chips.

- Tap the chip to go to that occurrence. The chip on *that* entry then points one step farther back. Thus successive taps move back along the chain through the earlier occurrences of the bead.
- The `⤺` arrow always means *return to the past*, never *see another one*.
- The chip is hidden at the oldest occurrence. It is also hidden the first time that you use this exact bead.
- The chip updates a moment after you change the facets of the bead or the date of the entry. The update is debounced. It does not run again when you type in the title or the body.

**Getting back out of a deep walk.** Each echo tap opens the older entry *on top* of the current entry. After some taps, you must press back many times to get to the main list. When you are some entries deep, a floating **`↩ Back to list`** pill appears near the bottom. One tap takes you back to the place where you started. If you started from a thread, the pill reads **`↩ Back to «thread name»`** and takes you back to that thread and not to the global list. The usual back arrow still moves one entry at a time. The pill is hidden while you type.

**Peek: `👁 Peek`.** Adjacent to the Echo chip in the meta strip of the editor, there is an **eye** with the label *Peek*.

- Tap it to open a read-only sheet over a different entry. You do **not leave the entry that you write**. Your draft stays in position and saves automatically as usual.
- Type to search your entries by title, by body, or by their comments. Or scroll the recent list.
- Tap an entry to read its full content. Then dismiss the sheet to go directly back to your draft.
- The peek is **read-only**. To edit the entry that you looked at, tap **Open fully**. This opens it in its own editor. Your draft waits below, as it does after an echo tap.
- The app remembers the entries that you open in the peek for the session. They move to the top, below **Recently peeked**. Thus you can open a frequent reference with one tap, and you do not have to search for it again.
- Private entries stay masked here. The list shows the lock, and the detail does not show the body. Use *Open fully* to read a private entry.

**Long-press a bead on a list row → set as filter.** From an `EntryCard` in the home list, long-press the bead of the row. Press the bead itself, not the body.

- The four facets become the current scope, and a removable pill appears above the search bar.
- If the bead agrees exactly with a saved preset, the pill shows the name of that preset (count, name, ×, "Search within this bead…").
- If it does not, the pill reads a neutral "Bead · N". It has the same × and the same scoped search.
- The text search clears, and you can refine within the new scope.
- The gesture is hidden: the card shows no change. It also works with select-mode. A long-press on the remaining area of the row still enters multi-select.

Beads appear in these places:
- In the editor, at the top.
- In list rows, under the date.
- In thread chains, where they are strung together visually.

## 🧵 Threads

A **thread** is an ordered chain of beads from your entries. With a thread, Vakana joins related entries into one chain that you can read quickly. A thread can be a year, a project, a habit, a relationship, or a trip.

To create or open threads:

- Open **Beads of life** → go to the **Threads** tab (header chip or tab; this depends on your layout).
- Each thread shows as a **card**: its name in handwritten Caveat above its bead chain.
- **Tap** a thread to open **Thread Detail**. There you can do these actions:
  - **See the full chain in three views.** Select the view from the segmented pill at the top of the chain:
    - **Beaded line**: a horizontal serpentine bead-and-thread strand.
    - **Stacked**: a vertical column with bubbles that expand on a tap.
    - **Loop**: the chain laid around a vertical ring, like a necklace. The beads have equal spacing and tilt to follow the curve.
  - **Close the loop.** From the overflow menu of the thread, *Close the loop* marks the thread as a completed **cycle**.
    - This is not an archive and not a deletion. You can reverse it with *Reopen*, because cycles can occur again.
    - A closed thread opens in **Loop** view by default. A golden **clasp** at the top closes its chain, with the close date adjacent to it.
    - You can still change to Beaded line / Stacked to read the chain in sequence.
    - An *open* thread in Loop view is an open ring with a gap and no clasp. This means "not closed yet."
    - Auto week/month threads are cycles by their nature, thus they always show as loops.
    - **Tap the clasp** (the knot or its date) to select the close date again in a date picker.
  - **Edit the thread name.** Tap the title at the top. It is an inline editor that saves automatically on a 1-second debounce. The header shows the same save state as the entry editor (*Editing… → Saving… → Saved* with the check animation). Thus you always know if the thread agrees with the data on disk.
  - **Edit the description** in the same way. The multiline field below the meta strip is always editable on user threads.
    - While you type in the name or the description, the same **undo / redo / history-tree bar** as in the entry editor shows on top of the keyboard.
    - Move back through your pauses of this visit. Or open the tree to preview and restore a state from the session. This includes the versions that you abandoned.
    - Refer to *Undo and redo* and *The history tree* under Writing entries. They work in the same way here.
  - **Re-anchor.** Tap the anchor chip in the meta strip. A bottom sheet lets you select None / Day / Month / Year / Time and the applicable date/time.
  - **Tap** a bead to preview its source entry. The preview drawer has an Open button that goes to the editor.
    - When you open an entry *from a thread* in this way (or from the Stacked view), the editor shows a thin **‹ Prev · n / N · «thread» · Next ›** strip below the header.
    - Use the strip to move through the beads of the thread in chain order. You do not have to go back to the chain each time.
    - The strip appears only when you came from a thread. The system Back button always takes you back to the chain.
  - **Scrub the chain like a rosary.** Drag a finger sideways across the chain. The preview drawer moves through the entries **in chain order**. One bead passes for each 26px of drag (approximately), with a faint haptic click for each bead. Vertical scroll and single bead taps still work. This is a fast procedure to read a thread again from start to end.
  - **Long-press any bead** to open a per-bead action sheet: *Move up/down* (or *Move left/right* in the horizontal view), *Open source entry*, *Mark / Rename / Clear section header*, *Remove from thread*. Auto-threads (day / week / month) show an alert with an explanation. You manage their beads from the entries of the day and the highlight tiers.
  - **Add a bead** with the ➕ FAB at the bottom-right. A tap opens a small chooser:
    - *Quick-add new entry* creates a draft entry dated today and chains it.
    - *Pick an existing bead* opens the bead picker. There you can append an entry that has a bead to the chain.

**Section headers: chapters within a thread.** On a user thread, long-press a bead → *Mark as section header* → give the chapter a name. From that point, the bead is the start of a named section in the chain:
- In the detail view, the section name hangs above the bead as a **price-tag pendant**. The pendant is a rounded rectangle with the name in Caveat handwriting, tied to the chain by a thin string. Tap the tag to **expand** it to multiple lines for long names. Tap again to collapse it.
- When two labelled beads are near each other, their tags **stagger on two vertical levels**. Thus the two tags stay fully visible.
- When the labelled bead is at the leftmost edge of a row, the tag **flips** to the right of the bead. Thus it does not go off the screen.
- Long-press a labelled bead → *Rename section header* / *Clear section header*. If you press **Save** with an empty input on the rename prompt, this also clears the label.
- In preview surfaces (threads list, batch picker, the inline thread chains of EntryCard), the bead has a soft **gold ring** and not the full pendant. This smaller mark does not fill the small previews.
- Section markers are **per-membership**. The same entry chained into two threads can be a "Kickoff" header in one and a plain bead in the other.
- If you move the labelled bead, the chapter moves with it. If you remove it, the chapter becomes part of the chapter before it.

Threads have an **anchor**. An anchor is metadata that tells the time period of the thread:
- **None**: no anchor.
- **Day**: anchored to one date.
- **Month**: for example "May 2026".
- **Year**: for example "2026".
- **Time**: a specific date and time.

Anchors only describe the thread. They do not limit the beads that can join.

To **add a bead to a thread**:
1. Open the entry that has the bead.
2. Long-press the bead → **Add to thread**.
3. Select an existing thread, or tap **Create new thread** to compose one.

A bead on a thread has a **live** reference (back to the entry) and a **snapshot** of its look when you added it. Thus the look of the chain stays stable if the bead of the source entry changes or if the entry is deleted.

In the threads list, **swipe right** on a thread card to open its comments drawer. **Long-press** a thread card to enter **multi-select mode** with that thread pre-checked. Tap more cards to add them to the selection, then use the header actions:

- **Add to collection** assigns each selected thread to one collection, with `+ New collection` inline.
- **Delete** deletes the selected threads. It skips the auto-threads in the selection and gives no message, because the app derives them again from their entries.

The single-thread "edit my collections" procedure is still inside the thread itself. Open the thread and tap the Collection metadata line.

## 🌀 Auto-threads

Auto-threads are threads that the system manages. There are three types: **daily**, **weekly**, and **monthly**. When auto-thread creation is on, they appear automatically, with no composer and no add-to-thread step. The setting is Settings → Threads & returns → Auto-threads → *Create auto-threads* switch, and it is on by default. The filter chips of the threads tab are **User · Days · Weeks · Months · All**. They select the type that you see. **All** shows all types together.

**Daily auto-threads.** Each calendar day with one or more entries gets a daily auto-thread. Each entry that you write on that date adds a **placeholder bead** to the chain. The chain holds the beads of the day, in sequence. Thus the auto-thread is a summary of that day that you can read quickly.

**Weekly auto-threads (`Week of …`).** These are made from your weekly highlights. Tap the **★ Highlight** chip in the meta strip of the editor to mark an entry as a weekly highlight. The chip then shows **Weekly highlight**. Each entry with a weekly star in a given ISO week (Monday–Sunday) goes into the auto-thread of that week. A weekly thread exists only while one or more entries have a star for it. If you remove the star from the last entry, the `Week of …` thread goes away.

**Monthly auto-threads.** These are made from your monthly highlights. Tap the star chip a second time to change from **Weekly** to **Monthly highlight**. That entry then also goes into the thread of the month. A third tap clears the highlight. Monthly highlights are intentional. There is no threshold and no heuristic: *you* decide what the month thread holds.

**Promote week to month.** At the end of the week, open a `Week of …` auto-thread and tap **Promote week to month** at the top of the chain. This changes each entry with a weekly star on that thread to monthly. The operation is idempotent: entries that already have a monthly highlight do not change.

- Auto-threads of all types are read-only. You cannot edit or delete from inside the thread. To remove the bead of an entry from a weekly/monthly auto-thread, change its highlight in the editor.
- An auto-thread goes away when its last entry is removed (deleted, or un-highlighted). It comes back as a new thread when a new entry refers to it.
- You can add an auto-thread to a collection. The membership is lost when the thread is pruned and created again. The picker shows a footnote about this.

## 🗂 Collections

A **collection** is a named group above threads. It is like a Gmail label for threads. The hierarchy is `collection → thread → bead`. It has three levels maximum and no nesting. A thread can be in **zero, one, or many** collections.

The threads tab has a **collection selector** at the top. It is one row that gives a summary of the filter: **All collections**, the name of one collection, or **N collections**. Tap it to open a searchable sheet:
- A **find-box** has the focus when the sheet opens. Type to make a long list shorter. You do not have to swipe through each collection.
- **All collections**: clears the selection (no filter).
- One checkbox row for each collection (with a `folder-outline` glyph and its thread count), in alphabetical order.
- **+ New collection**: creates a new collection.

Tap rows to **toggle** them. When you select one or more collections, the list shows the threads that are in **any** of them. This is a union. It does not make the list narrower with each selection. The selector then shows the summary with an inline **×** that clears the filter back to All. Tap outside the sheet to close it. Long-press a collection row to open a small actions sheet:
- **Rename**: opens the collection form sheet in rename mode.
- **Delete**: asks for confirmation and shows the number of threads that lose the assignment. The threads stay in place. They lose only this membership.

To assign **one** thread to one or more collections, open the thread and tap the **Collection** metadata line. You can toggle multiple memberships there.

To assign **many** threads to one collection in one operation:

1. Long-press a thread card to enter select mode.
2. Tap each additional thread that you want.
3. Use the **Add to collection** header action (`+ New collection` inline).

To assign many threads to many collections, use these two procedures in sequence.

When the threads tab is filtered to a specific collection, the FAB opens a chooser:
- **+ New thread**: opens the composer. On save, the app assigns the new thread to the active collection automatically.
- **+ Add existing thread**: opens a picker that shows each thread, with a name/description **search input**. Eligible threads are at the top, and threads already in the collection are below. Tap to toggle membership. This is the fastest procedure to add many existing threads to one collection.

With no collection filter, the FAB has one function and opens the composer directly.



Inside the entry editor, **Mentions** let an entry point at other threads as context. The entry does not join those threads by bead. To add the first mention, tap the top-bar `+` → **Mention a thread**. When one or more mentions exist, a Mentions section appears below the body. It lists the mentioned threads as cards.

- Tap a card to go to the detail of that thread.
- Tap the × on a card to remove the mention.

> **Mentions ≠ Adding to thread.** A mention is metadata on the entry that points out from it. It is a "see also" annotation. Adding-to-thread (through long-press → **Thread** in the home list, or the bead menu) puts the bead of the entry into the chain of the thread. Use a mention to say "this note refers to this thread" when you do not want to put the entry on the thread.

## 📎 Mentions

Mentions are the "see also" pointers of an entry. They are soft cross-references to other threads. They are in a small section below the body of the entry. To add one, tap the top-bar `+` of the editor → **Mention a thread**. Refer to [Beads vs. mentions](#-beads) above to see how they are different from chain membership.

**Read them backwards: "Mentioned by".** You write a mention from the entry, but you can also read it from the thread.

- Open a thread. If entries point at it, an `@ N` chip shows adjacent to the bead count in the strip below the title.
- Tap the chip to open a **Mentioned by** list. It shows each entry that mentions this thread, as its bead + title + date.
- Tap a row to open that entry.
- The chip does not show when no entry mentions the thread. It also does not show on auto-threads, because you cannot mention them.
- No setup is necessary. The list shows the same mentions that you wrote, read from the thread side.
- On a closed loop, this list is the bibliography of that completed cycle.

## 💬 Comments

Each entry, thread, and reminder can have a chronological list of **comments**. A comment is a small observation with a timestamp. It does not belong in the main body, but you want to keep it adjacent to the body.

Open the comments drawer in one of these ways:
- Tap the 💬 chip on a list row (entries or thread cards).
- **Swipe right** on an entry row in the home list, or on a thread card in the threads tab.
- Tap the 💬 chip in the entry editor or in the thread detail header.
- Tap the 💬 chip on a reminder row in the reminder panel of the calendar.

Inside the drawer:
- The oldest comment is at the top, and the composer is pinned at the bottom. The latest 10 comments are visible by default. Tap **Show N older** at the top to see the others.
- Type and tap the send arrow to add a comment. The drawer body and each inline-preview surface render the same markdown format as the entry editor (`**bold**`, `_italic_`, lists, links, code). You type plain text and you read formatted text.
- **Long-press** a comment to open an action row: **Edit**, **Resolve** / **Reopen**, **Remind** (see below), **Clear** (clears the reminder, if there is one), **Make a bead** (see below), **Delete**.
- After your first edit, the comment shows an "edited" indicator adjacent to its timestamp.
- **Resolve** marks a comment as a *closed loop*. It is the comment-scale version of *Close the loop* on a thread. Use it for the things that you note while you still *try* something.
  - A resolved comment shows **struck-through** (with a *· resolved* tag) here and in each inline preview.
  - **Reopen** removes the strike, because the loop can occur again.
  - Resolve is only a lifecycle mark. It does not change a reminder that you attached, and it does not change the sequence.
  - The struck state goes into each export. HTML/PDF/Markdown/slide/card show the comment struck. The Org export writes it as a native `DONE` headline.
  - Open comments get no keyword in the Org export. Thus an Org agenda does not fill with notes that are not tasks.
  - The fired-reminder banner and the calendar reminder panel intentionally do *not* strike. They are the reminder record, which is separate from resolution.

**Make a bead: grow a comment into an entry.** Long-press a comment → **Make a bead**. The comment becomes a new entry: dated today, with a default bead, and with a title from the first line of the comment. The app removes the initial comment. Thus one thought gives one item. A sub-sheet asks where the entry goes:

- **Just a bead**: a standalone entry.
- **Make a bead and chain with this…**:
  - On a *thread* comment, it appends the new bead to the chain of that thread.
  - On an *entry* comment, it opens the thread composer with the two beads prefilled. You can then start a thread from the pair.

**Inline previews:** the chatbubbles toggle at the right of the search bar (or in the threads tab header) shows the latest 2 comments below each list row. **Tap "View all N comments"** inside a card to expand the others inline. You do not have to open the entry. **Show less** collapses the list again. The chip of each card is also a per-card toggle that overrides the global default.

## 🔔 Comment-reminders

Some comments are also a ping for a future time. In Vakana, you can attach a date+time **reminder** to a comment. The comment then comes back to you at that time.

To attach a reminder to a **brand-new comment** as you write it:
1. Type your comment in the composer.
2. Tap the 🔔 toggle adjacent to the send arrow. A date picker and a time picker appear below.
3. Adjust the date and the time.
4. Tap send. The app saves the comment with its reminder attached.

To **add a reminder to an existing comment**:
1. Long-press the comment.
2. Tap **Remind** in the action row.
3. Select a date and a time.
4. Tap **Set**.

To change or clear a reminder, long-press the comment again. When a reminder is already attached, **Reschedule** or **Clear** appear adjacent to **Edit**.

When a comment-reminder fires:
- A banner appears at the top of the home screen with a chatbubble icon, the name of the parent, and the body of the comment. Tap the banner to go to the parent. The comments drawer opens automatically.
- The same comment-reminder also shows in the bottom panel of the calendar view. It is in chronological order with the calendar reminders, and the chatbubble icon identifies it. Past-due rows show in danger color.

A fired comment-reminder is **acknowledged on content edit**. When you add or edit a comment on the parent, the app automatically clears all fired comment-reminders for that parent at the same time. You can also dismiss one banner with its **×** button. This does not go to the parent.

## ⏰ Reminders

Reminders are in the **calendar view**.

- Days that have scheduled reminders show a **bell** glyph in the cell.
- Below the month grid, a **Reminders** panel lists each reminder for the visible month, with a delete button on each.
- To create a reminder for a specific day, open the `+` action of that day and select **Schedule reminder**. Or use the add button of the panel. This depends on the layout. The form is a keyboard-aware bottom sheet:
  - **Title**: a short label.
  - **Message**: the body text shown in the banner.
  - **Time**: the time at which the reminder fires.

At the set time, a **persistent banner** appears at the top of the home screen. You can do one of these actions:

- **Tap the banner** to open the **action sheet** of the reminder (the same sheet that a long-press opens). You see the title and the message of the reminder, then you select an action. *Nothing is created until you pick an action.* A tap that only looks at the reminder does not make an empty entry. The banner stays until you act on it.
- **Tap the ×** for the quick procedure. It dismisses the banner and acknowledges the reminder immediately, with no sheet.

You can open the **action sheet** in three ways: tap the banner, long-press a reminder in the calendar panel, or use the recurring-reminders list. The sheet has these actions:

- **Write entry**: a new entry opens with the title of the reminder pre-filled.
  - The app acknowledges the reminder the first time that you save content that is not empty. A recurring series moves to its next occurrence. A one-shot reminder is marked done.
  - If you go back and type nothing, the app saves nothing. The reminder stays, and the app reminds you again.
  - You can open the sheet from the calendar. Thus this action works for **any** reminder, also for a reminder that is not due yet. For example, if you complete a weekly review on Friday, the series moves to the next week.
- **Acknowledge**: marks the reminder done, and you write nothing. A recurring series moves to its next occurrence. A one-shot reminder shows struck on its calendar day, and you can restore it at any time.
- **Edit**: change the title, the message, the time, or the recurrence rule. **Stop·Resume** appears for a recurring series. **Delete** removes the reminder and its comments.

A dismissed (acknowledged) one-shot reminder is **not gone**. It stays on its calendar day, and the app never deletes the row.

- The **Reminders this month** panel of the calendar keeps it. It is hidden by default behind an **"Acked (N)" toggle** in the panel header (the eye icon). The toggle appears only when that month has acknowledged reminders.
- Tap the toggle to show the acknowledged reminders struck-through, each with a **↶ restore** button. When you open that day, **Reminders this day** on the Day screen shows the reminders of the day in the same way.
- Tap restore to bring a reminder back. If its time is still in the future, it fires again. If its time is past, it goes back to its day as a live banner.
- The banner stack and the day-cell bell intentionally do not show acknowledged reminders again. The calendar keeps them, and the app does not remind you again.
- The same **Acked** toggle also shows acknowledged **comment-reminders** struck. These have no restore button, because the comment was never lost. Tap the struck row to go directly to its parent. There you can read the comment or set a new reminder.

> On Android Expo Go (SDK 53+), OS-level scheduled notifications are disabled. The in-app banner still appears at the correct time, but no notification shows on the lock screen. Use a development build (`npx expo run:android`) if you need OS notifications.

**Tapping a notification** opens the action sheet of the reminder. It has the same options as a long-press (Write entry / Acknowledge / Edit / Stop / Delete). Thus the notification tells you about the reminder, and you make the decision. A comment-reminder notification opens its parent entry or thread, with the comments drawer open. If the app is locked, the PIN screen comes first, and the destination opens after you unlock. A tap alone never acknowledges a reminder.

> **Xiaomi / Redmi / POCO (MIUI, HyperOS):** reminders can fire while the app is open but stop after you swipe the app away from Recents. If this occurs, enable **Autostart** for Vakana (**Settings → Apps → Manage apps → Vakana → Autostart**). Unless this setting is on, the Xiaomi system stops closed apps from waking up for their scheduled alarms. The reminder was scheduled, but the phone did not deliver it. As an option, also set Battery saver for Vakana to **No restrictions**.

### Recurring reminders

The reminder form has a **Repeat** section that changes a one-shot reminder into a series:
- Select a kind: `Day / Week / Month / Year` (or `None` to keep a one-shot reminder).
- Set `Every N` (1 by default, for example *every 2 weeks*).
- As an option, set `Stop after N fires`. Leave it blank for a series with no end.

A series behaves as follows:
- A monthly series set on the 29th, 30th or 31st falls on the last day of a shorter month. It goes back to its own day the month after. A yearly series set on Feb 29 falls on Feb 28 outside leap years.
- **Only one banner ever stacks up.** If the reminder fired five times while you were away, you see one banner with "5 due since you last looked" in the subtitle. When you acknowledge it, the series moves past all of them in one step.
- The reminder panel of the calendar shows recurring rows with a 🔁 icon and a faint subtitle: *"every Mo · 3/10"* (the rule and the fire count).
- **Long-press** a reminder row in the panel to open an actions sheet with **Edit**, **Stop series**, and **Delete**. **Stop series** pauses the series and keeps the counter. You can **Resume** at any time.
- A **Recurring (N)** link appears in the panel header when you have one or more active series. Tap it to open a dedicated sheet that lists each series across all time. There you can stop or resume them in one place.

## 🔄 Returns: the bell and Wander

The Home header has two **returns** primitives: one is *intentional* and one is *chance*.

- **The bell** (always present) shows the fired calendar reminders and comment-reminders that *you* scheduled. These are returns that you set. A tap always opens the panel. When no reminder fired, the panel tells you so.
- **🎲 Wander** (opt-in, off by default): when Wander is on, a dice-outline icon is immediately to the left of the bell on Home.
  - Tap the icon to open a **random entry older than your configured threshold**. This is a chance return, not one that you set.
  - The options are 3 months / 6 months / 1 year / 2 years (default 6 months). A **Custom** row lets you type an integer day count from 1 to 3650. For example, use a short 14-day cycle, or a limit of many years.
  - Configure it in **Settings → Threads & returns → Wander**. The page has a switch that turns Wander on or off, and the threshold picker.
  - The dice icon is hidden in three conditions: the settings did not load yet, Wander is off, or your journal has no old entries that qualify. Thus the icon shows only when it is useful.

**Privacy contract.** Private entries are never in the Wander pool. The database query excludes them. This is not a default that can change. The dice never opens a private entry.

The bell and Wander are an intended pair. The two bring *the past into the present*. The bell shows a return because you set it. The dice shows a return because the system selected it at random.

## 🎨 Themes & appearance

Open **Settings → Appearance → Theme**. You select two things there, and each is independent of the other:

- 🎛 **Mode**: System (follows your phone), Light, or Dark.
- 🎨 **Palette**: five muted themes that are easy on the eyes:
  - **Cappuccino**: warm cream and espresso (the first palette).
  - **Ink**: cool slate neutrals.
  - **Sage**: soft muted greens.
  - **Linen**: paper-soft monochrome.
  - **Mist**: pale blue-gray, cool and quiet.

The app saves your selection across launches and applies it on each screen.

## 🗄 Vaults

A **vault** is a self-contained journal. It has its own database, its own attachments, and its own PIN. Use vaults when you want a full separation: work and personal, public and private, or one for you and one for a partner.

- 📂 **List & manage**: Settings → Vault → Vaults shows each vault. A filled bookmark marks the current vault.
- ➕ **Create**: tap `+` in the Vaults header. The first time that you open a new vault, the app tells you to create its PIN.
- ✏️ **Rename**: tap a vault row → Rename.
- 🗑 **Delete**: tap a vault row → Delete vault. You cannot delete the vault that is open. Go to a different vault first.
- 🔄 **Switch from Settings**: tap a vault row → "Switch to this vault". The session locks and the PIN screen of the new vault appears.
- 🔓 **Switch from the Lock screen**: when you have 2 or more vaults, a row of vault chips appears above the PIN dots. Tap a chip to change the active vault before you enter its PIN. If you have one vault, you see no chips.

When you change vaults, the app cancels the scheduled OS notifications of the previous vault. When the DB of the new vault is loaded, the app schedules its pending reminders again. Thus you get no notifications from the previous vault, and you miss none from the new vault.

## 📦 Backup & restore

Open **Settings → Vault → Backup & Restore** to put a full vault into one `.zip` file. You can save the file to Drive, send it to yourself, or move it to a different device.

- 🗜 **Create & share backup**: puts the database of the vault and each photo and voice note that is still on disk into one zip. Then it opens the OS share sheet.
  - On iOS, select **"Save to Files"** in the share sheet to put the zip into the Files app at the location that you want.
  - On Android, send the zip to Drive, to your own email, or to a file-manager share target.
  - The app reports an attachment as "skipped" if its file is no longer on disk.
- 📥 **Restore from backup**: select a `.zip` that you created before. After confirmation, the backup fully replaces the current vault. All entries, threads, comments, reminders, photos, and voice notes come from the backup. The session locks afterwards, and the restored DB then loads correctly.

> ⚠️ **Warning:** Restore is destructive. The backup overwrites the content of the current vault. If you are not sure, make a new backup of the current state first.

The Backup & Restore screen shows a **"Last backup created …"** line. The **Backup & Restore row in Settings** shows the same age. The row becomes amber with a dot when the last backup is more than 30 days old, or when you never made a backup. Thus you can see that a backup is overdue, and you do not have to open the screen.

The **journal list also shows a one-line reminder** above the bottom tabs when two conditions are true: a backup is overdue, and you wrote entries after your last backup. The reminder reads *This vault has no backup. Make a backup.* if the vault has no backup. If not, it reads *Last backup …. Make a new backup.* with the age of the last backup.

- Tap the reminder to go directly to Backup & Restore.
- Dismiss it with **✕** to hide it for a week.
- After you make a backup, the reminder stays away until a backup is overdue again.
- A journal with no new entries to protect never shows the reminder.

The indicator records the last time that you *created and shared* a backup (full or data-only). A media-only export does not count, because you cannot restore from it. The OS share sheet never reports if you saved the file. Thus the indicator tells you that you did the backup gesture. It does not guarantee that a copy is safely stored.

There is still no automatic backup. This is by design: Vakana has no background process, thus an "auto-backup" cannot promise to run when the app is closed. Use the indicator as your signal to do the manual backup at regular intervals. A recurring reminder with the title "Back up" is one method.

## 📤 Sharing & publishing

With Vakana, you can share the content of your journal, and you do not have to write it again in a different app. There are two scopes, and the two use the same **format-first** Export sheet:

- The entry editor exports one entry.
- A thread exports as Org / Markdown / HTML / PDF. An optional **Customize layout** step makes a thread into an article that you can publish.

### Export a single entry

The header of the entry editor has a **share** icon between the comments chip and the trash icon. Tap it to open the **Export** sheet. The app first completes the pending auto-save. Thus the exported file agrees with the content on screen.

The sheet is **format-first**. You select a format, then a per-format detail panel appears. Use the back chevron to go back to the format list. There are three formats:

- **📄 Markdown**: `<slug>-<date>.md` with YAML frontmatter (`title`, `date`, `created_at`, `updated_at`, `photos`). You can put the file into Hugo / Jekyll / Astro / Zola / Substack / Obsidian. The file lists photos and voice notes by filename and does not include them. A tap on Markdown goes directly to the Share action, with no other options.
- **🌐 HTML**: one self-contained HTML file. The panel shows a **template radio** with the same five skins that the thread article composer uses (Editorial / Journal / Minimal / Storyboard / Postcard). Photos are embedded as base64, thus the file works offline. *Storyboard* and *Postcard* render the comments of the entry inline (reply bubbles / sticky notes). The other three are long-form prose.
- **🖼 Card (PNG)**: a 1080 × 1350 portrait social card.
  - The card shows the bead avatar inline with the title and one polaroid photo (lightly tilted, with a soft drop shadow). It also shows an excerpt of the body and a "VAKANA" logo wordmark footer.
  - If the entry has more than one photo, a picker asks which photo becomes the hero. Two other photos show as the edges of stacked polaroids behind the main photo.
  - The panel has an **Include sticky-note comments** toggle. Turn it on for *Card with Notes*. This renders the first three comments of the entry below, as italic excerpts with hairline rules between them (magazine annotation style), under a small "💬 N NOTES" header.

Each panel ends in one **Share** action. WhatsApp / Telegram / Signal show a PNG card as an inline preview. This is the primary reason for the format: HTML shows as a file attachment, and the card shows as an image. The card always uses a fixed warm palette, whatever the theme of the app.

### Export a thread

Open a thread → tap the **share icon** in the header (top-right; the same `share` glyph as in the entry editor). A **format-first** Export sheet opens. Select a format first. A per-format detail panel follows. Use the back chevron to go back to the format list. There are four formats:

- **🔮 Org (Emacs)**: a self-contained `.zip` that you can use in Emacs (refer to [Org-mode export](#org-mode-export-the-emacs-bridge) below).
- **📄 Markdown**: a self-contained `.zip` (like Org). It holds the `.md` file or files and an `assets/` folder. The folder holds the bead-chain image (`chain.svg`) and each photo / voice note. Each link is rewritten to a relative `assets/…` link.
  - Unzip the file into an Obsidian vault or a static-site repo. All media resolves with no rewrite.
  - The panel has one option, **One file per bead** (off by default).
  - Off → one `<slug>.md` file with frontmatter + each section inline.
  - On → an **`index.md`** (thread head + a linked **Contents** list) and one `<NN>-<slug>.md` for each bead. Each bead file has its own frontmatter and a *← Back to index* link. The result is an Obsidian map-of-content.
  - The Storyboard / Postcard templates include comments as block-quotes in each section.
  - The app skips an attachment that is no longer on disk and reports it afterwards.
- **🌐 HTML**: one self-contained file. Photos are embedded as base64. CSS is inlined. It uses system-font stacks only. It works offline, and you can share it as a file to any destination.
- **📕 PDF**: the same HTML sent through the OS print engine. It is print-ready and you can attach it.

The panels have these controls:

- The **Org** panel has three toggles (see below) and **Share** and **Save to device**.
- The **Markdown** panel has the *One file per bead* checkbox, then **Share** / **Save to device**.
- The **HTML** and **PDF** panels have a **Customize layout** row (chevron). It opens the layout composer, where you set the template and curate the sections. The panels then end in **Share** / **Save to device**.

**Share** uses the system share sheet to send the file directly to a chat app, email, cloud drive, or social app. **Save to device** puts the file in your filesystem, and you do not select an app:

- On **Android**, the app asks you to select a folder one time. The file goes there directly.
- On **iOS**, a share sheet opens with **Save to Files** as a top option. Tap it and select a folder.

Export is non-destructive. If you edit the source entries later and export again, the export always contains the latest content. The article state does not change the entries.

> 💡 **Auto-threads can be exported too.** A daily auto-thread of an important day, with one or two paragraphs of intro, makes a day-in-the-life post. Export handles user-curated threads and auto-day threads in the same way.

### Customize layout (the article composer)

A thread is already an ordered chain of entries. The layout composer is a thin curation layer on that chain. You select what is included, you give the article a title and a short intro, and you select a visual style. The composer duplicates no data. Your entries stay the source of truth. You can open it **only** from the **Customize layout** row on the **HTML** or **PDF** panel of the Export sheet. There is no separate "Compose article" button.

- **Chain banner preview** at the top shows the SVG that ships with the article. Your bead chain becomes the visual signature of the article.
- **Title / Subtitle / Intro**: plain Markdown inputs. The default title is the name of the thread. All other inputs are optional.
- **Template**: five skins. The first three render long-form prose. The last two show the thread as a story that includes its comments.
  - **Editorial**: serif blog, with much whitespace.
  - **Journal**: cream + Caveat-style handwritten title. It agrees with the look of the app.
  - **Minimal**: sans-serif, narrow column.
  - **Storyboard**: vertical social feed (Twitter/Instagram thread feel).
    - A pinned post at the top holds the intro of the thread and *its* comments as reply bubbles.
    - Each section becomes a post card with a bead-avatar circle, the photos of the entry as a stacked carousel, and the body as caption.
    - The comments of the entry show as reply bubbles, with the color of that bead as a left-edge accent.
    - Use it for trip recaps and "here is the whole story" posts where you want the comments in the text.
  - **Postcard**: scrapbook (vision-board feel).
    - It shows tilted polaroids with handwritten-style captions.
    - Comments appear as taped-down sticky notes in alternating yellow / peach / sage.
    - The thread intro becomes a note card with a small rotation and a washi-tape edge.
    - Use it for memory pieces that must look hand-made, such as birthdays, weddings, and trips.
- **Cover photo**: a horizontal strip of each photo across the entries of the thread. Tap **Chain only** to keep the bead chain as the only hero.
- **Sections**: one row for each bead in the chain. Each row has:
  - An eye toggle to **include or hide** that section.
  - A tap-to-expand area where you set a custom **section title** and **lead paragraph** (Markdown). The two are optional.
- All changes **auto-save** in the background. The composition is stored on the thread. Thus you can come back and refine it, and you lose no work.

The composer has no Export button of its own. Tap **Done** (top-right) or the back chevron. The app saves your current edits and takes you back to the **same HTML/PDF panel** that you came from. There you can **Share** or **Save to device** with the new layout. You can hide a section today and show it again tomorrow. The article state does not change the entries.

### Org-mode export (the Emacs bridge)

**Org (Emacs)** exports the thread as a self-contained `.zip`. Its purpose is fidelity. It is not a flat text dump:

- The day / week / month entries of an **auto-thread** become an exact **`org-datetree`** (`* 2026` → `** 2026-05` → `*** 2026-05-17`). You can put it directly into org-agenda / org-journal with no changes.
- Each **mention** becomes an `[[id:…]]` org-roam link with a generated `:ID:`. Thus the cross-references stay in your roam graph.
- The **grammar** of each bead (shape / mood / pattern / glyph) is written in **two** forms. The first is a queryable `:PROPERTIES:` drawer, thus `org-ql` can filter on it. The second is an inline SVG, because Emacs cannot draw the bead and the app can.
- Markdown bodies are transformed into real Org markup.
- The zip also holds the photos / voice notes of the thread, a self-describing **`README.org`**, and an optional **`vakana.el`** Emacs helper.

The Org panel has three toggles:

- **Include private entries**: off → private entries ship as a masked stub (`:crypt:`-tagged, body and photos excluded) and not in full.
- **Include vakana.el**: includes the optional Emacs helper (no network; pure local elisp).
- **Reproducible**: omits the export timestamp and the app version. Thus a new export gives a clean `git diff`.

This is **one-way only**. There is no transport, no sync, and no import-back. Give the zip to the OS share sheet with **Share**, or use **Save to device** as above. The full as-built contract is in `docs/architecture/org-export.md`.

## 📥 Importing notes (the capture bridge)

You can write at a computer (in Emacs, or in a desktop editor) and then bring the text into Vakana to curate it on the phone. Note import does this. It is the **inverse of Org export above**. Export writes an auto-thread out as an `org-datetree`, and import reads that same shape back in. The desktop is a *capture* surface. The phone stays the *curation* surface.

Open it from the **⋮ overflow menu → Import notes…**. The sheet has two sources:

**A folder (the private path).** Tap **Choose synced folder…** and select a folder that a sync tool keeps mirrored between your computer and your phone. **Syncthing** is the best fit: it is peer-to-peer, with no cloud and no account, and the bytes never leave devices that you control. A cloud-drive folder also works. After that, Vakana **silently scans that folder every time you return to the Home screen**. A **Scan now** button starts a scan immediately.

- A `.org` file that is an **org-datetree** becomes **one entry per dated day**. If you capture all week with `org-capture`, you get a week of entries.
- A `.md` / `.txt` / flat `.org` file becomes **one entry**.
  - The title comes from `#+TITLE:`, or the first `# heading`, or the filename.
  - The date comes from the first of these that exists: the datetree day, a `#+DATE:` / front-matter `date:`, a `2026-05-19-…` filename prefix, the modified date of the file, or today.
- The app moves a one-file note into an `imported/` subfolder after it reads the note. Thus you can see that the note is "done". The app reads a datetree file to which you continuously append, but **never modifies** it. In the two cases, the app never imports a note twice.

**A URL (the ad-hoc path).** Paste an `https://…` link and tap fetch. Vakana downloads the text one time and imports it in the same way. The host is **yours to choose**: a GitHub gist raw link, a self-hosted endpoint, or a temporary LAN server. The content is **only as private as wherever you point it**.

> ⚠️ **Caution:** for a private journal, use the synced-folder path. A public paste service stores your text on a server that you do not control.

This is the only network request of the app: one fetch, bounded, with no telemetry and no built-in host.

**Imported notes land as plain drafts.** They have no bead and no thread. If you gave no title, the title is `Draft …`. A small banner tells you the number of notes that arrived. This is intended: capture costs little, and **curation is the gesture you do here**. Open a draft, add its bead, and chain it to a thread at the time that you usually do this.

Import is **one-way *in***, as export is one-way *out*. If you edit the note later on the phone, the app does not write back to the file. If you sync the same source again, the app does not import it again and does not merge. The full as-built contract is in `docs/architecture/note-import.md`.

## ⚗️ Fuse & thread (cleanup)

A group of quick captures (photos in the same place, a sequence of voice memos) gives you many loose entries. Vakana has two procedures to consolidate them. It also makes an automatic offer when it detects a burst.

### Multi-select mode

**Long-press** an entry in the list to enter select-mode with that entry already checked. Or open the **⋮** menu in the home header and tap **Select entries** to start with no entry checked. The header becomes an action bar with the selected count and three icons. Rows show a checkbox on the left.

- **Tap a row** (or long-press it) to add it to the selection or remove it. Swipes are intentionally disabled in this mode. Thus you cannot delete or comment by accident while you select.
- **Tap ✗** to exit select mode with no changes.

The action bar has three operations:

- **⚗️ Fuse** *(needs ≥2 selected)*: replaces N entries with one new entry.
  - The app joins the bodies in chronological order with `---` separators.
  - It merges the photos and the voice notes, and moves the comments to the new entry.
  - It **deletes** the source entries.
  - The new entry gets a **computed alchemy bead**: the most common shape, pattern, and mood across the source entries. If there is a tie, the earliest source wins. Tap the bead in the preview to override it.
  - The preview also shows the new title (editable), the date (earliest), and the entries that the operation replaces.
  - **Warning:** **Fusion cannot be undone.** The preview tells you exactly what the app deletes.
- **🧵 Thread** *(needs ≥1 selected)*: keeps all the entries in place, and strings their beads onto a thread.
  - Select an existing user thread. The app appends the beads at the end of its chain in date order.
  - Or select **Create a new thread**. The composer opens prefilled with all the beads.
  - An entry with no bead first gets the default round/slate bead. Thus the chain always has a real snapshot.
- **🗑 Delete**: removes the selected entries (with a confirm dialog).

### The burst banner (auto-detect)

A banner appears at the top of the home list when ≥3 quick-capture entries arrive in a short time. Their titles agree with `Photo <stamp>` or `Record <stamp>`, and all were created in the last 30 min:

> ⚗️ **3 new quick captures.** Tap to fuse them into one entry or to thread them.

- **Tap the banner** to go directly into select-mode. The burst is pre-loaded and the **Fuse** preview is open. From there you can change to Thread, adjust the selection, or confirm.
- **Tap ×** to dismiss the banner for the session. The cluster ages out in ~30 min. If new captures arrive with the dismissed captures, the offer shows again.

> 💡 **Fuse vs Thread:** fuse when the burst was *one moment captured with many shots* (for example, several photos of the same scene). Thread when the captures were *a sequence of moments* that you want to keep separate (a walk, a series of observations). The two intents are different, and the two are valid.

## 🔒 Privacy & re-locking

- 🔐 Tap the **lock** icon in the header at any time to re-lock the app immediately. You must enter the PIN of the current vault again to come back in.
- ⏱ **Auto-lock.** Open **Settings → Vault → Auto-lock** to make the app re-lock automatically when you leave it.
  - The options are *Off* (the default; the app stays unlocked until you lock it manually), *Immediately*, or after *1 / 5 / 15 minutes*.
  - The timer starts when you go to a different app or lock your phone. If you come back before the time ends, the journal stays open. If you come back later, the PIN screen shows.
  - A short interruption (you pull down notifications or control center, or a call comes in) does not count as leaving. It does not re-lock the app.
  - The selection applies to the vault that is open. Like the lock icon, it only shows the PIN screen again. It does not encrypt data.
- 🔑 **Change PIN.** Open **Settings → Vault → Change PIN** to change the PIN of the vault that is open.
  - The procedure has three steps: type the current PIN, then type a new 4-digit PIN, then confirm it.
  - You use the same on-screen keypad as on the lock screen. Thus the keyboard of your phone does not appear.
  - A wrong PIN at any step shakes the dots. If the confirmation does not agree, you go back to "choose a new PIN".
  - You cannot use the existing PIN as the "new" PIN. The screen tells you to select a different one.
  - Wrong PINs at the first step count toward the same lockout as on the lock screen.
  - To change the PIN of a different vault, go into that vault first. The verification step needs its current PIN.
- 🔍 The PIN gate is a UI gate. It does not encrypt the SQLite database itself. A person with file-system access to the device can possibly read the entries. Use that as your threat model when you decide what to write here.
- ☁️ There is no cloud sync, no account, and no telemetry. The only off-device path is the **backup zip** that you choose to export.
