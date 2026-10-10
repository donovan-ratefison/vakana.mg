# Vakana: Use Cases

This document contains scenarios with examples. They show how the parts of Vakana work together: entries, beads, threads, mentions, comments, comment-reminders, collections and reminders. Each scenario is a procedure that you can adapt. No scenario is the only correct way to use the app.

## Contents
1. [Daily mood log → year-long thread](#1-daily-mood-log--year-long-thread)
2. [Habit tracking with one thread per habit](#2-habit-tracking-with-one-thread-per-habit)
3. [Trip journal with photos + voice + a single thread](#3-trip-journal-with-photos--voice--a-single-thread)
4. [Project log with linked threads as cross-refs](#4-project-log-with-linked-threads-as-cross-refs)
4b. [Consulting other notes while you write: the peek](#4b-consulting-other-notes-while-you-write-the-peek)
5. [Reminder-driven gratitude practice](#5-reminder-driven-gratitude-practice)
6. [Field capture: drag-FAB for photos and voice memos](#6-field-capture-drag-fab-for-photos-and-voice-memos)
7. [Threaded reflection with comments](#7-threaded-reflection-with-comments)
8. [Self-pings: comments that remind you](#8-self-pings-comments-that-remind-you)
9. [Organizing many threads with collections](#9-organizing-many-threads-with-collections)
9b. [Weekly + monthly highlights: curated auto-threads](#9b-weekly--monthly-highlights-curated-auto-threads)
10. [Recurring reminders for ritual practice](#10-recurring-reminders-for-ritual-practice)
11. [Long thread, named chapters: section markers](#11-long-thread-named-chapters-section-markers)
12. [Closing a loop: a practice that completes and returns](#12-closing-a-loop-a-practice-that-completes-and-returns)
13. [Select-mode power moves: bulk archive & throwaway threads](#13-select-mode-power-moves-bulk-archive--throwaway-threads)

---

## 1. Daily mood log → year-long thread

**Goal:** write one short entry each day, with the mood of the day encoded as a bead. At the end of the year, you can see all 365 beads on one chain.

**Setup**
- Create a thread with the name **"2026"**, anchor = **Year**, anchor date = `2026`. Description: "One bead per day."

**Daily flow**
1. Open Vakana.
2. Tap `+`.
3. Write a short body line. A few words are sufficient.
4. Tap the bead slot. The BeadComposer opens.
5. Select a **mood** (color).
6. Select a **shape**. Example: round for ordinary days, lozenge for sharp days, dot for quiet days.
7. Optional: select a **glyph**. The glyph is one letter that encodes a theme. Example: `W` for a day with much work, `R` for rest.
8. Long-press the bead.
9. Tap **Add to thread**.
10. Select **2026**.

**What you get**
- The list view shows your entries as flat rows. Each row starts with its bead on the left.
- The Threads tab shows **2026** as a card. The chain grows each day.
- When you tap a bead in the chain, Vakana opens the entry of that day.

**Tip:** if you miss a day, add a backdated entry. Use the date picker in the editor. Then add the bead of the entry to the thread.

---

## 2. Habit tracking with one thread per habit

**Goal:** track more than one habit independently. Each instance of a habit is one entry. Each habit has its own thread.

**Setup**
- Create one thread for each habit that you want to track:
  - **"Run"** (anchor = None): each run is a bead.
  - **"Read"**: each reading session is a bead.
  - **"Meditate"**: each session is a bead.
- Select a different bead **shape** for each habit (round for runs, square for reads, dot for meditation). You can then read the chains quickly.

**Daily flow**
1. After the activity, open Vakana.
2. Tap `+`.
3. Write one line in the body. Example: `5 km, easy pace, sunrise`.
4. Compose the bead. Select the shape that you reserved for that habit.
5. Select the **mood** color for the quality of the session. Example: green for a great session, neutral for a satisfactory one, faded for a forced one.
6. Long-press the bead.
7. Tap **Add to thread**.
8. Select the thread of the habit.

**What you get**
- The Threads tab is your dashboard. The chain of each habit shows frequency (a gap is a missed day) and quality (the variation in color).
- Open a thread to see its entries. Tap a bead to go to the source entry.

**Tip:** if you stop a habit, the thread stays as a record. If a habit becomes too detailed, divide it. Create a second thread and add the new beads there.

**Variant with a recurring reminder:** use this variant when the cadence of a habit is important (daily meditation, weekly review).

1. In the calendar, tap `+`.
2. Set Repeat to Day or Week, with no cap.
3. When you did the activity and added the bead, acknowledge the banner.

The banner keeps the schedule. If you miss a day, the next banner shows "*N due since you last looked*". You see one accurate banner, not seven.

---

## 3. Trip journal with photos + voice + a single thread

**Goal:** capture a trip with sufficient detail to remember it months later, and keep the chronology.

**Setup**
- Before or during the trip, create a thread **"Iceland 2026"**. Set anchor = **Month** or **Day**, as applicable to the length of the trip.

**During the trip**
1. Tap `+` each time something of interest occurs.
2. Write a sentence.
3. Take one or two photos with the camera button of the editor.
4. Hold the mic to record a voice note of 30 seconds. Example: "standing at the foot of the glacier, wind from the south, smells of wet rock".
5. Compose a bead for the entry. Use the color for the tone of the day. Use the glyph for the first letter of the location (`R` for Reykjavik, `V` for Vík).
6. Long-press the bead.
7. Tap **Add to thread**.
8. Select **Iceland 2026**.

**Quick capture en route**
1. If you cannot type, **long-press** the home `+`.
2. Drag to the photo target or the voice target. The capture goes into the list as `Photo <stamp>` or `Record <stamp>`.
3. Add a title and a bead later.

**What you get**
- A chain of beads in **Iceland 2026**, in the order of time. You can scroll through it again.
- Each bead opens an entry with its attachments. The photo viewer shows the photos. The voice playback plays the audio that you recorded.

---

## 4. Project log with linked threads as cross-refs

**Goal:** track a project that continues for many months. The entries belong on the thread of the project. Some entries are also related to other threads (a year log, a relationship, a research direction).

**Setup**
- Thread **"Vakana 0.1"**: the main thread of the example project. Its beads are milestones.
- Threads that exist: **"2026"** (year log) and **"R&D"** (research notes).

**During the project**

For a milestone (`shipped beads MVP`):

1. Write the entry.
2. Compose the bead: shape = round, mood = warm green, glyph = the number of the milestone (`1`, `2`, …).
3. Long-press the bead.
4. Tap **Add to thread**.
5. Select **Vakana 0.1**.
6. In the entry editor, tap **+** in the top bar.
7. Tap **Mention a thread**.
8. Select **2026**. The note now has a cross-reference to the year thread. Its bead is not on the year chain.

For a research note that gave information for a decision:

1. Write the entry.
2. Give the entry a bead.
3. **Mention** the **R&D** thread. Do not add the bead to that thread. The note keeps its bead in **Vakana 0.1**. It shows as a cross-reference when you read the research thread.

**What you get**
- The chain of **Vakana 0.1** stays clean. It contains only milestone beads, in order.
- Open a milestone entry to see the other threads that it mentions.
- Open **R&D** later and go to a research entry. From that entry, follow the mentioned thread to the milestone that it influenced.
- You can also go in the opposite direction. Open **Vakana 0.1**, tap its `@` chip and read **Mentioned by**. The list shows each research note that mentioned this milestone, with its bead and date. You wrote the cross-reference from the entry. You can now read it from the thread also.

> Use **add to thread** when a bead belongs in the chain. Use a **mention** when you want only a pointer.

---

## 4b. Consulting other notes while you write: the peek

**Goal:** while you write an entry, read a different note for reference. Examples: a past decision, the details of a person, an index. You do not lose your position or your draft.

**The gesture**
1. In the editor, tap the **👁 Peek** chip in the meta strip. The chip is next to the date, highlight and Echo chips.
2. Search by title, body or comment text. As an alternative, scroll the recent list.
3. Tap a note. Vakana shows the full note, read-only.
4. Tap the back chevron to select a different note, or dismiss the sheet to go back to your draft.

Your text and your cursor are where you left them. The editor did not close, and auto-save continued during the peek.

**Reading and citing in one pass** (use with use case 4)
1. While you write the milestone entry, peek the **R&D** research note. Make sure that it is the note that gave information for the decision.
2. Dismiss the sheet.
3. Add the note as a **Mention**.

You read the source first and cited it second. The peek reads. The mention points.

**Keep a reference one tap away**
- Vakana remembers the notes that you open in the peek for the session. It shows them at the top under **Recently peeked**.
- Keep one note that lists your people, projects or open questions. Peek it each day while you write. It is always the first row. It is your private table of contents, and you do not search for it.

**When a glance turns into an edit**
- If you must change the note that you read, tap **Open fully**. The note opens in its own editor. Your draft stays below it, as it does in an Echo hop. The system back gesture returns you to your draft.

**Note:** the peek is read-only, and a **private** entry stays masked. The list shows the lock, and the detail does not show the body. Use *Open fully* to read a private entry.

---

## 5. Reminder-driven gratitude practice

**Goal:** each evening at 9pm, write three things that you are grateful for.

**Setup (one-time)**
1. Change to **calendar view** in the home header.
2. Tap the `+` of the calendar to schedule a reminder.
3. Set these fields:
   - **Title:** Gratitude
   - **Message:** Three things you are grateful for today.
   - **Time:** 21:00
   - **Repeat:** `Day`, `Every 1 day`. Leave `Stop after` blank, so that the reminder has no end. The reminder then fires each night, and you do not create it again.
4. Optional: create a thread **"Gratitude"**, anchor = None.

**Daily flow**
1. At 9pm, the in-app banner shows at the top of the home screen with the title of the reminder.
2. Tap the banner. A new entry opens with the text of the reminder in the title or the body.
3. Type three lines.
4. Compose a small bead. Use the same shape each time (for example, dot), so that the chain is uniform.
5. Long-press the bead.
6. Tap **Add to thread**.
7. Select **Gratitude**.

**What you get**
- Vakana acknowledges the reminder automatically when you save content that is not empty. The banner goes away. The series moves to the next day at 21:00.
- After some weeks, the **Gratitude** thread is a long chain of small beads. Tap a bead to read what you wrote that night.
- If you miss a day, the thread has a gap for that day. The gap is visible, and the record is accurate.
- The recurring reminder catches up the next time that you open the app. If you missed two days, the banner reads "*2 due since you last looked*". One acknowledgement moves the series past the two days. The banners do not collect.

**Notes on platform**
- On a development build of Android (or on iOS), you also get the OS notification at 9pm.
- On Expo Go for Android (SDK 53+), the OS notification does not show. The in-app banner shows when you open Vakana. It also shows at 21:00 if the app is open.

---

## 6. Field capture: drag-FAB for photos and voice memos

**Goal:** capture a moment without a stop in what you do. There is no editor and no text entry. You use only the shutter or the mic.

**Photo capture**
1. **Long-press** the `+` FAB on the home screen. The radial targets show.
2. Do not release. **Drag toward ↖ Photo**.
3. The camera opens. Take the photo.
4. Confirm the photo.
5. The new entry goes into the list with a title such as `Photo 20260509T143012`.

**Voice capture**
1. **Long-press** the `+` FAB.
2. Drag toward **↑ Voice**.
3. A recording sheet shows in the center and **auto-starts** the recording. You do not press a button to start.
4. Tap **stop** to save. The title of the entry is `Record <stamp>`.
5. To cancel and not save, tap **X**, not **stop**.

**Cleanup later**
- Entries from quick capture show in the list with their automatic titles. When you have time, tap one to open the editor. Then add a body, a bead or a thread. You can also leave the entries as they are. The timestamp title is sufficient to find an entry later.
- A group of captures (≥3 within ~30 min) causes a **burst banner**. The banner offers two operations:
  - **Fuse**: make one entry with an alchemy bead from many captures of one scene.
  - **Thread**: keep each capture, and put the beads on a chain.
- You can also do these operations later, through select-mode on an older group of entries. (For the full procedure, refer to the User Guide → *Fuse & thread*.)

> The drag-FAB needs a touch device. A desktop browser has no long-press. There, the `+` button only opens the editor, as a tap does.

---

## 7. Threaded reflection with comments

**Goal:** go back to older entries with a new point of view, and do not edit the original. Build a conversation in layers with your past self.

**Daily flow**
1. Open the home list.
2. Find an older entry that gets your attention. If you remember a phrase, search for it. Search also matches the text of comments.
3. **Swipe right** on the row. The comments drawer opens immediately.
4. Type a thought. Examples: what you see now that you did not see then, what changed, what you would ask the writer of that entry.
5. Send. The comment has a timestamp and stays attached to that entry.

**On a thread**
1. Open the threads tab.
2. Find the thread that you want to reflect on.
3. **Swipe right** on the thread card. The drawer opens with the comments on the *whole thread* (not on one bead).

This is useful for a reflection at the end of the year on a year-long mood thread. It is also useful for a retrospective on a project thread.

**What you get**
- A separate channel of comments with timestamps, next to your raw entries. You do not change the history.
- The comment chip on the row shows the count.
- Set the chatbubble toggle in the search bar to on. The latest 2 comments then show inline below each row, and you do not need the drawer.
- Tap **View all N comments** in a card to show the other comments in place.

---

## 8. Self-pings: comments that remind you

**Goal:** leave a note for your future self that is attached to a *specific entry or thread*. You then come back to *that item* at the correct moment. A generic calendar reminder does not do that.

**Examples**
- After you write an entry about a difficult conversation: add the comment "How does this feel one week from now?" and tap **🔔** to schedule it for next Wednesday at 18:00.
- On a habit thread: add the comment "Check streak progress" and schedule it for the first day of next month.
- On a calendar reminder ("Pay rent"): add the comment "Confirmed paid? Receipt screenshot in Drive?". A comment-reminder on a reminder gives you a follow-up.

**How**
1. Open the comments drawer. Use the chip, a swipe right, or the 💬 button in the editor or the detail screen.
2. Type the comment.
3. Tap the **🔔** toggle in the composer. The date and time pickers show below.
4. Set the date and time.
5. Send.

At the scheduled time:
- A banner shows at the top of the home screen with a chatbubble icon and the text of the comment. Tap the banner to go to the parent and open the drawer.
- The comment-reminder also shows in the bottom panel of the calendar view, together with the calendar reminders. Rows that are past due show in the danger color.
- **Acknowledged on content edit**: when you add or edit a comment on the parent, Vakana clears all fired self-pings for that parent at the same time. You can also dismiss one banner with **×**.

> **Tip:** use comment-reminders for pings that occur one time and have a context. For recurring or generic reminders ("write in journal at 9pm"), use the reminder form sheet of the calendar.

---

## 9. Organizing many threads with collections

**Goal:** when you have 10+ threads, the tab is hard to scan. Use **collections** as named groups (`Habits`, `Projects`, `Travel`, `Reflection`) and filter to one collection at a time.

**Setup**
1. Go to the threads tab.
2. Tap the **collection selector** at the top.
3. Tap **+ New collection** in the sheet.
4. Create some collections: `Habits`, `Projects`, `Travel`.

To put one thread into many collections:

1. Open the thread.
2. Tap the **Collection** metadata line. The picker with a toggle for each collection opens in the detail screen.

To put many threads into one collection:

1. Long-press a card to enter select mode.
2. Tap each card that you want to include.
3. Tap **Add to collection** in the header.

A thread can belong to *more than one* collection. Example: a "2026 Iceland" thread in `Travel` and in `Reflection`. To do that, use the two procedures in sequence.

**Daily flow**
1. Tap the collection selector.
2. Find `Travel`. If the list is long, type in the find-box of the sheet.
3. Tap `Travel`. The list now shows only the travel threads.
4. Tap the FAB. A small chooser shows:
   - **+ New thread**: creates a new thread that is assigned to `Travel`.
   - **+ Add existing thread**: opens a multi-select picker of all threads. The picker has a **search** by name and description, so that you can find a thread without a scroll. Tap a thread to toggle its membership.

**Long-press a collection** in the selector sheet to open an actions sheet:
- **Rename**: changes the name. The threads do not change.
- **Delete**: asks for confirmation and shows the count of threads that it will unassign. Vakana does not delete the threads. They only lose this membership.

**What you get**
- A threads tab that you can scan when you have dozens of threads.
- A thread can be in more than one collection. Example: a "Marathon training 2026" thread in `Habits` and in `Projects`.
- You can also add auto-threads (the daily, weekly and monthly threads that the system manages) to collections.

**Caution:** an auto-thread loses all its memberships when Vakana prunes it and later makes it again. Vakana prunes an auto-thread when you delete its last entry or remove the highlight from its last entry. The picker shows a footnote about this.

---

## 9b. Weekly + monthly highlights: curated auto-threads

**Goal:** mark, with little effort, the entries that were important this week, and the rare entries that were important for the full month. The journal then builds its own summaries, and you do not write them.

**Setup**
- No setup is necessary. The feature starts the first time that you tap the **★ Highlight** chip in the meta strip of an entry.

**Daily flow**
1. At the end of the day (or at the end of an entry), tap the **★ Highlight** chip in the editor.
   - First tap: **Weekly highlight**. The entry goes into the `Week of …` auto-thread for the ISO week of that entry (Monday–Sunday).
   - Second tap: **Monthly highlight**. The entry also goes into the auto-thread of the month (for example, `May 2026`). Use this rarely, for the entries that you want to read again at the end of the year.
   - Third tap: clears the highlight.
2. Look at the home screen. A highlighted entry shows a small ★ pip at the top right of the bead (filled = weekly, halo = monthly).

**End-of-week curation**
1. Go to the Threads tab.
2. Select the **Auto** filter.
3. Tap the current `Week of …` thread in the **Weeks** section.
4. Read the chain.
5. If the full week was important, tap **Promote week to month** at the top of the chain. Each weekly star on that thread becomes a monthly star in one tap.
6. If only some entries are important for the month, open each one in the editor and tap the star chip a second time.

**What you get**
- A `Week of 11 May 2026` thread for each week that has highlights. The thread goes away when you remove the star from its last entry. Empty weeks leave no thread.
- A `May 2026` thread for each month that has monthly highlights. By design, a month without monthly stars has no thread. The *absence* of a month thread shows that no entry of that month got a second star.
- At the end of a year, the 12 monthly auto-threads are the skeleton of the year in review.

**Read-only chain**
- Auto-week and auto-month threads are projections. They are not lists that you can edit.
- If you long-press a bead, an alert tells you to change the highlight of the entry in the editor. The chain follows the highlight. The highlight does not follow the chain.
- A change to the bead of the source entry shows in the chain automatically.

---

## 10. Recurring reminders for ritual practice

**Goal:** get a daily, weekly or monthly reminder that does not make noise. You do not create the reminder again each day. You also do not come back to seven banners.

**Setup**
1. In the calendar view, tap `+` to open the reminder form.
2. Set the title. Example: *Evening review*.
3. Set the time. Example: 21:00.
4. In the **Repeat** section, select `Day` and `Every 1 day`. Leave `Stop after` blank, so that the reminder has no end.
5. Save.

**Daily flow**
1. At 9pm, the in-app banner shows. Its subtitle is "every day".
2. Tap the banner.
3. Write your three lines (or the content of your practice).
4. Wait for the autosave. When the body is not empty and the autosave fires, Vakana acknowledges the reminder. The series moves to the next day at 9pm. The banner goes away.

If you miss a day, the banner reads "*2 due since you last looked*" when you come back. One acknowledgement moves the series past the two days. The banners do not collect.

**Weekly variants**
- *Monday-only stand-up with yourself*: `Week`, `Every 1 week`. The form picker is anchored to a specific date and time. Thus the day of the week is the day that you set. The reminder repeats on that weekday with no end.
- *Bi-weekly review*: `Week`, `Every 2 weeks`.

**Bounded series ("for X times")**
- *21-day kickstart*: `Day`, `Every 1 day`, `Stop after 21 fires`. The series deactivates itself after the 21st acknowledgement. You do not need to turn it off.
- *Quarterly check-in for a year*: `Month`, `Every 3 months`, `Stop after 4 fires`.

**Managing them**
- In the calendar, the header of the reminder panel shows **Recurring (N)** when one or more series are active. Tap it to see a list of all series.
- Long-press a reminder row in the panel to open an actions sheet with **Edit**, **Stop / Resume** and **Delete**. Stop keeps the counter and the cursor. Resume continues from the same point.
- **Retreat mode:** before a week offline, **Stop** your daily series. When you return, **Resume** it. The cadence continues from the same point. No old banners wait for you, and you do not build the schedule again.

**What you get**
- A practice with a reminder on a schedule. You do not create the reminder again, and the banners do not collect when you stop for some days.
- The "N due since you last looked" subtitle tells you accurately what you missed. You do not acknowledge each missed fire.
- A bounded series ("21 days", "10 sessions") deactivates itself. Open the recurring list at any time to see which series run and which are complete.

---

## 11. Long thread, named chapters: section markers

**Goal:** change a chain of dozens (or hundreds) of beads into a story with chapters. You do not divide it into more than one thread, and you do not change an entry.

**Setup**
- You have a thread that runs for a long time. Examples: a year log, a project with many phases, a trip across countries, a recovery journal. The chain is too long to scan quickly.

**Mark the chapter starts**
1. Open the thread (ThreadDetail).
2. Long-press the bead at the start of a chapter. Examples: the first day in a country, the start of a project phase, the first session of a course module.
3. In the action sheet, tap **Mark as section header**. A small prompt (in the Caveat style) asks for the chapter name.
4. Type the name.
5. Save.

The bead is now the start of a named section in the chain:
- In the chain detail view, the chapter name hangs above the bead as a **price-tag pendant**. The pendant is a rounded rectangle that a thin string ties to the chain. Tap the tag to expand a long name to more than one line.
- The bead has a soft **gold ring**. Thus you can see it as a landmark in the compact previews also (threads list, batch picker, inline thread chains below entries).

**Repeat per chapter**
- Do the procedure again for each chapter. Examples:
  - "Reykjavik", "Vík", "East fjords" on a trip thread
  - "Concept", "Draft", "Revision", "Publish" on a thread for a creative project
  - "Q1", "Q2", "Q3", "Q4" on a year thread

The chain then shows the parts of the story.

**Edit, rename, clear**
- Long-press a labelled bead again, then tap **Rename section header** or **Clear section header**.
- If you save the rename prompt with an empty input, Vakana also clears the label.
- If you move the labelled bead in the chain, the chapter moves with it.
- If you remove the labelled bead, its chapter becomes part of the chapter before it.

**Per-membership semantics**
- An entry that is on two threads can be a chapter header in one thread and a plain bead in the other. The label belongs to the *membership*, not to the entry. Thus "Reykjavik" can mark Day 1 on an Iceland thread, and the same entry stays a plain bead on a separate year-log thread.

**What you get**
- You can read a long thread as a book of chapters. The chain is still one continuous thread, with no breaks and no segments. But you can find a chapter and know where you are. Examples: "this is where the recovery started", "this is where the launch happened", "this is the chapter about a period in Berlin".

## 12. Closing a loop: a practice that completes and returns

Some threads have an end. Examples: a 40-day devotional, a "2026" year-log, a recovery period, a period of mourning. These threads *complete*. In Vakana, you can record that, and you do not delete or archive the thread.

**Close it**
1. Open the thread.
2. Open the overflow menu.
3. Tap **Close the loop**. There is no prompt, because the operation destroys nothing.

The thread now opens in **Loop** view. Vakana puts the chain around a vertical ring, as a necklace. A golden **clasp** at the top joins the last bead to the first. The close date is next to the clasp.

You can still change to **Beaded line** or **Stacked** from the pill. A closed thread keeps its chronological view.

**Edit the close date**
1. Tap the clasp (the knot or its date). A date picker opens.
2. Select the true date. Example: you closed the thread today, but the practice ended last month.

**Reopen: cycles recur**
- In the overflow menu, tap **Reopen**. This clears the closure. The clasp detaches, and the ring opens with a gap.
- Examples: a "90 days" thread that you did not complete, or a grief thread that you need again next year. Reopen the thread, continue, and close it again later.

**It composes**
- Put a **comment-reminder** on the last bead of the closed loop, one year from now. The completed cycle then reminds you each year to walk through it again.
- A new thread can **mention** a closed loop ("descends from '2025 sabbatical'"). Your open work can then cite its closed loops.
- `auto_week` and `auto_month` threads are cycles by nature. Thus they always show as loops (the 1st is at the clasp). No gesture is necessary.

**What you get**
- A completed practice that *looks* completed. It is a closed object that you can go back to. It is not an open chain that asks for more beads. The grammar has a word for "done, and it returns".

---

## 13. Select-mode power moves: bulk archive & throwaway threads

**Goal:** long-press to enter **select mode**, then do batch work with one gesture. You can remove completed threads. You can also collect different bead kinds onto a temporary thread to read them together.

**Bulk archive (clear the done)**
1. Long-press a thread card to enter select mode.
2. Tap each thread that you completed.
3. Tap **Delete** in the header.

Vakana silently skips the auto-threads in the selection, because it derives them again from their entries. Thus you can select threads of mixed kinds and not sort them first.

**Caution:** threads are records. Use **Delete** only when you are sure that you want to remove them. For a practice that *ended*, use **Close the loop** (use case 12). It destroys nothing: the thread stays, closed with a clasp.

**Throwaway thread (browse bead-kinds together, then dissolve)**

Use this procedure to see, for example, *morning run*, *hard talk* and *deep work* entries together for one session.

1. In the list, apply one saved bead as a filter.
2. Tap **Select all → thread** to put the results on a new temporary thread. Example name: `Mornings & Talks & Work`.
3. Do steps 1 and 2 again for each of the other saved beads, with the same thread.
4. Scroll the combined chain.
5. Delete the thread when you complete the session.

The thread is the correct primitive to show these bead kinds together. This one thread is temporary. To group *existing threads* under a name, refer to use case 9. It uses the same select-mode gesture with **Add to collection**.

**What you get**
- You do in one pass the batch actions that you would do one card at a time.
- You can compose a temporary view across beads, and your real threads stay clean.
