# 🧭 Vakana: Workflows

This document contains playbooks for Vakana. Each playbook is a sequence of steps for one domain. The playbooks show how to use Vakana to think, to remember and to work.

## How this differs from the other docs

- **`possibilities.md`** is the menu. It contains one-line ideas, one on each line. It tells you what is possible.
- **`workflows.md`** (this document) is the playbook. It contains a smaller set of complete flows in sequence: set up X, capture as Y, the system does Z, review through W, export to V. It tells you how to run a practice. It does not describe each tap.
- **`use-cases.md`** and **`user-guide.md`** are the manuals. They contain tap-by-tap procedures and a reference for each screen. When a workflow says "open the auto-thread of the week", the manuals tell you which chip to tap. This document does not repeat that content. It describes how the primitives go together, and why.

Each workflow names the primitives that it composes. Each workflow also states its advantage over a generic tool (Notion, Obsidian, Apple Notes, Roam, Things, Day One).

A flow is in this document only when its advantage comes from the structure of Vakana. The structure has these parts:

- the bead code
- the auto-thread sequence
- the comment-reminder ladder
- reshape across history
- the export bridges

A tool with tags and folders cannot build the same flow. If a workflow has the same meaning when you replace "Vakana" with "Notes app", it is not in this document.

The workflows use these primitives:

- **bead**: a unit with four dimensions (shape, pattern, mood, glyph). A bead has no fixed meaning. You give it a meaning. You can save a bead as a named preset. You can reshape a bead across all of your history.
- **thread**: a chain of beads that you put in order by hand. A thread tells one story.
- **auto-thread**: a chain that the system makes from your judgment. The day chain always exists. The week chain contains the entries with one star. The month chain contains the entries with two stars.
- **comment** + **comment-reminder**: a note in the margin. A comment can have a future alarm that is attached to that exact item.
- **recurring reminder**: one row that moves forward. It sets the cadence of a practice.
- **mention**: a cross-reference that says "this is about that". A mention does not make the entry a member of the chain.
- **fuse & thread**: two operations for a group of quick captures. Fuse makes one entry from the captures. Thread puts the captures on a chain.
- **section**: a chapter label on a bead in a chain. The label belongs to that membership only.
- **close the loop**: an operation that marks a thread (or a comment) as a completed cycle. It does not delete the item.
- **export**: Org (Emacs datetree + roam + org-ql), Slide (a memory palace that you can walk through), HTML, PDF, Markdown and PNG card. All exports go one way. All exports use the same bead renderer.

## 📋 Contents

1. [🧠 Memory & learning](#-memory--learning)
2. [🪢 Personal knowledge & thinking](#-personal-knowledge--thinking)
3. [🛠 Project & deep-work tracking](#-project--deep-work-tracking)
4. [💞 Relationships & people](#-relationships--people)
5. [🌱 Habit & practice cadence](#-habit--practice-cadence)
6. [🪞 Reflection & review rhythm](#-reflection--review-rhythm)
7. [✍️ Research & writing with the export bridges](#️-research--writing-with-the-export-bridges)
8. [🎨 Creative & maker logs](#-creative--maker-logs)

---

## 🧠 Memory & learning

This section is for people who want to keep what they learn. An ordinary note tool stores knowledge but does not show it to you again. A fact in Notion or Obsidian stays where you filed it until you search for it. Usually, you search for it only after you forgot it. In Vakana, a comment-reminder is an alarm that is attached to the note. Thus the system controls the recall intervals, and you do not.

### The spaced-recall ladder

**Composes:** entry · comment · comment-reminder (the self-ping ladder) · search.

1. When you learn something that you want to keep, write a short entry. State the claim in your own words. Do not copy a quote.
2. Open the comments drawer.
3. Add a comment that asks the question that the entry answers. Example: "What's the failure mode of optimistic locking?"
4. Attach a comment-reminder to the comment. Set it to **3 days** from now.
5. When the comment-reminder fires, tap the banner. The banner opens that exact entry.
6. Before you read the body, write your answer in a new comment.
7. Set the next step of the ladder: **1 week**.
8. Do the same procedure for each step: 1 week, then 1 month, then 3 months. Write your answer in a comment each time.

If you can recall the item at the 3-month step, you know it.

Months later, use full-text **search** to find the item. Search includes the text of comments. Thus search finds the fact and also each attempt that you recorded in the ladder.

**Advantage over a generic tool:** the reminder is attached to the knowledge. A separate task in Things or Anki can go out of sync with its note. In Vakana, the history of your attempts collects in the comments of the entry. Anki keeps only the final card. In Vakana, you can read the difference between what you wrote then and what you know now.

### Memory-palace corridor (the anchored year-walk)

**Composes:** thread anchored to a year · the calendar backbone · section markers · slide export.

1. Create a thread with the name of the domain that you study. Example: "Distributed systems 2026".
2. **Anchor the thread to the year** `2026`. The anchor makes the thread a locus. The thread then shows on the calendar each time 2026 is in view. You can go back to it at any time.
3. In each study session, write an entry.
4. Compose a bead for the entry. Use the **shape** for the topic family. Use the **glyph** as a one-character index (`Q` for queues, `C` for consensus).
5. Long-press the bead and add it to the thread.
6. When the chain is long, long-press the first bead of each major area.
7. **Mark the bead as a section header**. Examples: "Replication", "Consensus", "Failure modes". The chain does not break. It becomes a route with named stations.
8. Before an exam or a talk, **slide-export** the thread.

The slide export opens as a deck that you can walk through:

- Each bead is one station.
- You can tap the chain. The chain is the progress bar, the table of contents and the map of the loci.
- Each section marker becomes a full-page chapter divider.

You walk through the corridor. You do not read the notes again.

**Advantage over a generic tool:** the Obsidian graph shows connections. It does not give you an ordered route through them that is attached to a place. The Method of Loci needs sequence and place. A bead chain on an anchored calendar has the two properties. The slide deck is that route in a form that you can walk through. Your private notes about your attempts go with it as speaker notes. The audience does not see them.

### Question log that closes its own loops

**Composes:** entry · comment-reminder · resolve-the-comment (closed loop) · promote comment → bead.

1. Keep one thread with the name "Open questions".
2. Write each question as an entry with a bead. Use the shape for the field of the question.
3. On a question that stays in your mind, add the comment "still open?".
4. Attach a comment-reminder to the comment. Set it to 30 days from now.
5. When the comment-reminder fires and you do not know the answer, set the comment-reminder again.
6. When you know the answer, write the answer as a comment.
7. **Resolve** that comment. Vakana strikes through the comment. The comment is now a closed loop. This is the same operation as close the loop on a thread, at a smaller scale.
8. If an answer changed how you think, long-press the answer.
9. **Promote the comment to a bead** that is chained with its parent. The two beads are now in the chain as question, then answer.

**Advantage over a generic tool:** a generic question list has two states: the question is there, or it is deleted. In Vakana, the Resolve operation gives a question a closed-loop state. All exports keep that state (Org writes it as a native `DONE` headline). The promote step makes the resolved answer a bead in the chain. The answer does not become a checked row that you forget.

## 🪢 Personal knowledge & thinking

This section is for people who use Lisp, Emacs or TiddlyWiki and who think in small units that compose, not in documents. In a knowledge tool that uses tags, the tag vocabulary grows without a limit until it has no value. The Vakana bead is a bounded grammar (8 shapes × 8 patterns × 8 moods × glyph). You compose with it. A saved bead is a macro: "data is code, code is data", applied to your days.

### Build your own type system, then refactor it

**Composes:** saved bead presets · the bead Filters lens · reshape-across-history (the `query-replace`).

1. Decide what each shape means to you. The app gives the shapes no meaning. Examples: a circle is "deep work", a flower is "grief". Decide also what a slate, striped bead means.
2. **Save each bead as a named preset.** The presets are your type system.

After some weeks, the editor opens with your saved beads by default. One tap recalls a symbol. You make a new symbol only rarely, and on purpose. The vocabulary becomes stable.

After some months, a meaning can change. Example: "exercise" became two things, *run* and *gym*. In that condition, do these steps:

1. Long-press the saved bead.
2. Select **Reshape across history**.
3. Reshape the old bead to *run*.
4. Select **rewrite the past**.
5. Save *gym* as a new preset for future entries.

**Warning:** **rewrite the past** is not reversible. It is a counted `query-replace`. It changes each entry and each chain snapshot that had the old bead.

The vocabulary now has two branches. You did not edit an old entry by hand.

**Advantage over a generic tool:** a tag system cannot change the meaning of a tag in one transaction across years of notes and across each chain that contains them. Tags are strings. A bead is a quantized grammar, and its identity is its value. Reshape is the Emacs `query-replace` applied to your history. It is possible because the bead is code, not a label.

### Encode ⇄ retrieve symmetry (one symbol, both directions)

**Composes:** saved bead preset · the Filters sheet · *Select all N → thread*.

1. Compose a "decision" bead and save it.
2. Use the bead (one tap) on each important decision entry, in all projects and in all months.
3. Weeks later, open the **Filters sheet**.
4. Tap the saved "decision" bead in the lens strip. This sets all four facets at the same time.
5. Optional: remove the *pattern* facet. The filter then matches the full family of beads, not only the exact bead.
6. Look at the list. It contains each decision that you recorded with the bead.
7. Tap **Select all N → thread**. The query becomes a curated chain.

A practice that was in many months is now in one chain. You can read the chain, add sections to it and export it.

**Advantage over a generic tool:** in a notes app, a search gives results and nothing more. In Vakana, the named symbol that you encode with is also the lens that you retrieve with. The result of the retrieval goes back into the system as a thread that stays. Encode and retrieve are one primitive that you apply in opposite directions.

### The narrated index (a hub no flat tag can write)

**Composes:** one entry · mentions · collections.

1. When you have ten or more important threads, write one entry with the title "The map".
2. In the entry, write prose that tells why each thread is important.
3. Between the paragraphs, tap the `+` of the editor, then **Mention a thread**, to point at each thread. A mention is a cross-reference. It is not chain membership. Thus the entry adds no bead to a chain.

The entry is now an index with a narrative. You can add comments to it. It is a "see also" list that includes the reasons.

Keep your threads in collections for the flat view that you can scan. Keep this entry for the view with reasons.

**Advantage over a generic tool:** a collection (or a folder, or a tag page) can only list items. It cannot contain the prose that tells why these threads are related. With the mention layer, one entry can be a document and also an index. The index does not need a fixed structure.

## 🛠 Project & deep-work tracking

This section is for people who do work that continues for many months and whose status updates go out of date. A task in Things or Jira has two states, and then the tool archives it. When the ticket closes, the reasons for the decision are lost. Vakana keeps the decision, the prediction and the verdict on one chain. The comment-reminder makes the project ask you for a check.

### Decision journal with a verdict that comes back to you

**Composes:** entry · bead (mood = confidence) · comment-reminder · promote comment → bead chained with the decision.

1. For each important decision, write an entry. State the decision, the reasons and the prediction.
2. Compose the bead. Use the mood for your confidence. Use the glyph for the initial of the project.
3. Add a comment with the text "Did this work?".
4. Add comment-reminders at **1 month** and at **3 months**.
5. When a comment-reminder fires, tap the banner. The banner opens the exact decision. Your past reasons are complete and you cannot edit them.
6. Write your answer in a comment.
7. If the verdict is important, long-press the comment.
8. **Promote the comment to a bead, chained with the decision entry.** The chain now reads: decision, verdict, next decision.

**Advantage over a generic tool:** a decision log in Notion is a table that you do not open again. In Vakana, the decision sends you a reminder at the time that you set. The reminder opens the original prediction, not a summary of it. The verdict becomes a permanent bead in the chain. Thus the chain of the project is a record of how your judgment changes with time. It is not a list of closed tickets.

### Milestone chain with a clean cross-reference layer

**Composes:** project thread (milestone beads only) · mentions (not add-to-thread) · sections · HTML/PDF export.

1. Create one thread for each project.
2. Put **only milestone beads** on the chain. Keep the chain short, so that you can read it quickly.
3. Write daily notes, research and blockers as separate entries.
4. When one of these entries gave information for a milestone, **mention** the project thread from the entry. Do not add the bead of the entry to the thread. The milestone chain stays short. The cross-reference shows when you read the research note.
5. Divide the chain into sections by phase: "Kickoff / Build / Launch / Postmortem". The chain now has four parts. You did not change the title of an entry.
6. For the retrospective, open **Customize layout**.
7. Select the *Editorial* template.
8. Hide the sections that you do not need. Keep the points where the project changed direction.
9. Write one paragraph of introduction for each phase.
10. Export as **PDF**. The bead chain is the banner of the document.

**Advantage over a generic tool:** other tools make you select one of two things: a clean milestone view, or a place for the daily notes. Vakana has two verbs (chronicle and cross-reference). Thus the same note can be a short point in the chain and also a detail with many cross-references. Vakana makes the retrospective document from the real chain. Export again after you edit, and the document is current. You do not write the content a second time.

### Sprint cadence that wraps itself up

**Composes:** bounded recurring reminder · project thread · comments on the entries · close the loop.

1. Set a recurring reminder for each weekday, **capped at 10 fires** (a sprint of two weeks). The reminder is one row that moves forward. It is not ten copies.
2. At each fire, write the standup entry.
3. Add the bead of the entry to the sprint thread.
4. Record events that you did not expect as comments on that entry.
5. If you miss a day (for example, because of illness or travel), open the app when you return. You see one banner: "*N due since you last looked*".
6. Acknowledge the banner one time. The cursor moves past all the missed fires. The banners do not collect.
7. Acknowledge the final fire. The series **deactivates itself**.
8. **Close the loop** on the sprint thread. The thread closes into a ring. It is a completed cycle. It is not an archive that you must clean up later.

**Advantage over a generic tool:** a recurring task in Things or Todoist makes N independent instances. When you stop for some days, the instances collect as overdue tasks. The Vakana recurring reminder is one cursor that catches up accurately. With the cap and **close the loop**, the practice has a clear, visible end. It does not send reminders without end, and you do not lose it in a delete operation.

## 💞 Relationships & people

This section is for people who want to remember other people well. The records are not CRM contacts. They collect detail with time. In a notes app, the page of a person goes out of date. Nothing makes you open it at the correct moment. You also cannot see the shape of the relationship quickly.

### The per-person thread, with the bead as their marker

**Composes:** thread per person · a saved bead whose shape+mood *is* them · sections for relationship eras · the year auto-roll-up.

1. Create one thread for each important person.
2. Save a bead whose shape and mood mean that person to you. The bead is now the marker of that person. It is a memory image that you practiced, not a label.
3. If you must tell two people apart, give each one a different glyph. Example: `M` and `D` for two parents who share the "hard talk" bead.
4. Write each important interaction as an entry.
5. Recall the bead of the person with one tap.
6. Long-press the bead and add it to the thread of the person. The mood color records the feel of the meeting.
7. Add a section at each change in the relationship. Examples: "Met / Dating / Moved-in / Married", or "Before / After" an important event.
8. When a moment was important, tap ★ for a weekly or monthly highlight.

The chain becomes the table of contents of the relationship. A section belongs to one membership. Thus the same entry can be a chapter header on this thread and a plain bead on your year thread.

A highlighted entry goes into the chain of the person and also into your week or month auto-thread. You do no more work for that.

**Advantage over a generic tool:** a page in a CRM or a notes app is a flat list that grows. It has no visible shape and no eras. The bead chain of a person shows the shape of the relationship. Sections give the chain chapters, and the chain stays one thread. The bead is a shared vocabulary. Thus the Filters lens can find "every hard talk" with all people in one operation, and the glyph tells you the person.

### The birthday letter that grows for decades

**Composes:** yearly recurring reminder · person thread · section per year · Postcard export.

1. Set a yearly recurring reminder on the date of the person, with **no cap**. Each fire creates an entry on the thread of the person.
2. Write the letter of that year as the body of the entry.
3. Add the bead.
4. **Mark the first bead of each year as a section** with the year.
5. To give the letter, export with the **Postcard** template, as PDF or as a PNG card.

After decades, the chain is a letter with chapter marks that got one bead each year. A single document cannot grow in increments like that.

The Postcard template looks like a scrapbook. Comments become sticky notes that are taped to the page. The chain banner is the visual signature. The photos of the person and your comments go with the export.

**Advantage over a generic tool:** the cadence makes this possible. The recurring reminder makes sure that you write the entry each year. The chain is the accurate record of that cadence. A notes app cannot change "remind me yearly" into an item with chapters that grows and that you can give. It has no chain to put the entries on.

### Conflict-and-repair, with a contextual cool-off check

**Composes:** entry · comment-reminder bound to that entry · resolve the comment.

1. After a conflict, write an honest entry about it. Use the bead mood for the intensity of the conflict.
2. Add the comment "Is this still hot?".
3. Attach a comment-reminder to the comment. Set it to **one week** from now.
4. When the comment-reminder fires, tap the banner. The banner opens that conflict entry, not a generic "follow up" task.
5. Write your answer in a comment.
6. If the conflict is settled, **Resolve** the comment. The comment is now a closed loop.

**Advantage over a generic tool:** a calendar reminder says "think about the fight" and gives no context. The Vakana comment-reminder opens the conflict entry at the exact place, one week later. Resolve gives the repair an explicit closed state. You do not edit the original entry to record it.

## 🌱 Habit & practice cadence

This section is for people who want a practice that continues with little effort and leaves a visible record. Streak apps use counters to push you, and a missed day counts against you. The checkbox grid of a habit tracker tells you that you did the practice. It does not tell you how the practice felt or how it changed with time.

### Recurring reminder → bead chain (the cadence becomes the proof)

**Composes:** recurring reminder (the metronome) · a saved bead for the practice · a per-practice thread · the day auto-thread.

1. Set the recurring reminder of the practice. Example: "Evening sit", every day, no cap. The reminder is the metronome. The practice occurs because of the reminder, not because you remembered.
2. At each fire, tap the banner.
3. Write a line.
4. Recall the **saved bead** of the practice with one tap. The full chain then has the same visual signature. You do not make the decision again each day.
5. Add the bead to the practice thread. The day auto-thread adds the bead automatically.

After some months, the thread shows the practice in visual form:

- The length of the chain shows consistency.
- The variation in mood shows honesty. Example: a faded bead for a one-minute session is an accurate record.
- The gaps are visible, and nothing counts them against you.

**Advantage over a generic tool:** a streak counter is one number. It goes back to zero after a missed day. The chain has the same data without that pressure. It shows the sequence, the gaps and the quality. A cadence that catches up accurately made it. Overdue alarms do not collect.

### Bounded challenge that deactivates itself

**Composes:** capped recurring reminder · year/challenge thread · close the loop.

1. For a "30-day challenge", set a recurring reminder for each day, **capped at 30 fires**. The reminder is one row that moves forward.
2. Create a thread for the challenge.
3. At each acknowledgement, add the bead of the entry to the thread. The chain grows to 30 beads.
4. Acknowledge the 30th fire. The series deactivates itself. You do not need to turn it off.
5. **Close the loop** on the thread. The closed ring shows that the challenge is complete. There is no counter and no certificate.

**Advantage over a generic tool:** the capped recurring reminder stops by itself, and the thread closes into a ring. Thus a bounded practice has a start, a middle and an **end**. A generic recurring task has no "done forever" state. It continues to send reminders after the end, or you delete it and lose the record.

### Multi-practice month roll-up (no tunnel vision)

**Composes:** per-practice threads · monthly highlight ★★ · the `Month` auto-thread.

1. Keep some practice threads in parallel. Examples: meditation, running, writing.
2. When a session was important, tap ★ two times (monthly highlight). The entry goes into the auto-thread of that month. The practice thread of the entry makes no difference.
3. At the end of the month, open the month auto-thread. Example: `May 2026`.

The month auto-thread is a summary across practices. It shows the important moments of the month in each discipline. Your attention selected them. The summary is not divided by thread.

**Advantage over a generic tool:** a habit tracker keeps each habit separate. Nothing connects the habits, so there is no view of what was important in the month across all of them. The monthly star is one explicit judgment. The system collects the stars across all practices automatically. You do not write a summary.

## 🪞 Reflection & review rhythm

This section is for people who want a review practice but do not have the energy to collect the inputs. Each "weekly review" method has the same problem: at review time, you must collect what occurred. The two-tier highlight of Vakana builds the review pyramid while you write. Thus the input is ready before the review.

### The built-in review pyramid (day → week → month → year)

**Composes:** the ★ highlight (one tap = week, two = month) · auto-week / auto-month threads · *Promote week to month* · the 12 monthly threads as a year skeleton.

1. **Each day:** write. The day auto-thread adds the bead of each entry. You do nothing.
2. **When something is important:** tap ★ one time. The entry goes into the `Week of …` auto-thread of this week. Tap ★ two times for the rare entry that is important for the month.
3. **On Friday or Sunday:** open the current `Week of …` thread. The entries that you starred are on the chain. You do not collect them.
4. If the full week was strong, tap **Promote week to month**. Each weekly star becomes a monthly star in one operation.
5. Write a short review entry that mentions the week thread.
6. **Each month:** open the month thread. Example: `May 2026`. The thread exists because of your two-star judgments.
7. Read the thread and add a comment on the thread as a whole.
8. **Each year:** read the twelve monthly threads. They are the skeleton of the year in review.

**Note:** the empty months are part of the review. A month with no monthly star does not get a thread. That absence is information.

**Advantage over a generic tool:** other review systems make you retrieve the material at review time. In Vakana, the pyramid is a result of one optional tap while you write. You select the entries at the moment when they have meaning, not in a weekly session. There is no threshold and no algorithm that guesses what was important. You make the judgment, and the system files the entry.

### Future-self letter that fires on its own date

**Composes:** entry dated to today · comment-reminder set far out · the anniversary return.

1. Write an entry to yourself at a specific future date.
2. Add a comment-reminder set to that date. Example text: "Read this back".
3. When the comment-reminder fires, tap the banner. The banner opens the letter.
4. Write your answer in a comment.
5. Optional: set a new comment-reminder one year later. The letter then becomes a yearly conversation with yourself.

**Advantage over a generic tool:** a calendar event for "read your letter" is a notification with no content. The comment-reminder opens the letter at the exact place. Your reply is a comment next to the original, and you do not edit the original. The value is in the difference between the two texts.

### Anniversary diff (the same calendar date, a year apart)

**Composes:** anchored threads on the calendar · auto-month threads · the calendar backbone.

1. Anchor important threads to their dates. The threads then show as ribbons on the calendar. Each one is a locus that you can go back to, also on a day with no entry.
2. One year later, open the auto-thread of `May 2025` next to the auto-thread of `May 2026`.

The difference between the two chains shows how the year changed. You do not need a spreadsheet or a metric. You compare two chains of your own encoded judgment.

**Advantage over a generic tool:** a journal app has only a raw timeline. It has no curated chain for each month, so it cannot give a year-to-year comparison of structure. The auto-month thread is the unit that you compare. The calendar anchor is the place where you find it again.

## ✍️ Research & writing with the export bridges

This section is for researchers and writers who work in Emacs, in Obsidian or on a static site, and who do not accept lock-in. Most journal apps let data in and let only screenshots out. The exports of Vakana keep the structure: Vakana maps the grammar and does not flatten it. The exports go one way and are final. You give the export to the operating system, and the journal continues in Vakana.

### A journal that lives a second life in Emacs

**Composes:** auto-thread ≅ org-datetree · mention ≅ org-roam link · bead grammar ≅ org-ql-queryable `:PROPERTIES:` drawer · resolved comment ≅ org `DONE`.

1. Keep a day, week or month auto-thread as your dated backbone. A recurring reminder makes the entries.
2. Use **mentions** freely as your cross-reference layer while you write.
3. Encode beads consistently. A vocabulary of saved beads makes this automatic.
4. Export the thread as **Org**.

The export is a self-contained zip for Emacs. It contains:

- A native `* 2026 / ** 2026-05 / *** 2026-05-17` datetree. You can put it into `org-agenda` or `org-journal` with no changes.
- An `[[id:]]` org-roam link for each mention. The links join your existing graph.
- A `:PROPERTIES:` drawer with the shape, mood, pattern and glyph of each bead. Thus "every grief-flower bead in 2026" is an `org-ql` query.
- A native `DONE` headline for each closed comment loop.

**Advantage over a generic tool:** other apps export Markdown that describes structure. Vakana exports Org that is the structure. The datetree, the roam IDs and the property drawer are real Org objects that you can query. Thus your existing Emacs tools can use years of journal entries, and you change nothing. With the `Reproducible` toggle, a new export gives a clean diff, so you can keep the journal in git.

### Thread → Obsidian map-of-content

**Composes:** thread · Markdown export *One file per bead* mode · the chain SVG as the note banner · mentions as a "see also" footer.

1. Curate the thread. Use sections for structure.
2. If you export HTML or PDF, hide the entries that you do not need through *Customize layout*. The Markdown zip is a fidelity export.
3. Select the **Markdown** export.
4. Set the **One file per bead** toggle to on.
5. Unzip the export into your vault.

The export contains:

- An `index.md` file with the thread head and linked Contents.
- One `<NN>-<slug>.md` file for each bead. Each file has frontmatter and a *← Back to index* link.
- An `assets/` folder with the photos, the voice notes and `chain.svg`.

In the vault, the chain SVG is the banner of the map of content. Each bead is a Zettelkasten node that can have backlinks. The mentions show as a "see also" footer. The thread joins your graph, and you connect nothing by hand.

**Advantage over a generic tool:** the export of a notes app is a flat set of files. You must connect them again by hand. The Vakana export has the shape of a map of content. It keeps the visual signature, and each media path is resolved. The chain is the index, as it was in the app.

### Publish a curated piece without re-authoring it

**Composes:** thread · *Customize layout* (the article composer, a thin curation layer) · the five templates · HTML/PDF/Markdown.

1. Select the thread. Examples: a trip, a year of milestones, a practice log.
2. Open **Customize layout**.
3. Set a title.
4. Write an introduction of one paragraph for each section.
5. Hide the daily entries that you do not need. Keep the points where the story changes direction.
6. Select a template. Use *Editorial* for prose. Use *Storyboard* or *Postcard* to show your comments inline as a conversation.
7. Export in one of these formats:
   - HTML (self-contained, works offline)
   - PDF (ready to print)
   - Markdown (for Hugo, Jekyll or Substack)

Vakana keeps the composition on the thread as a sidecar. The entries stay the source of truth. Thus, after you edit the entries, a new export always contains the latest text.

**Advantage over a generic tool:** to publish from a notes app, you copy the text into a second tool and format it again. In Vakana, the thread is the structure of the article. The composer is a curation layer over the real entries, and it destroys nothing. The bead chain is the signature of the piece. The published piece is a view of the journal, so the two cannot become different.

## 🎨 Creative & maker logs

This section is for makers who want to see how a body of work developed, not a folder of files. A project folder shows what exists. It does not show how you got there: the doubt, the plateau and the change of direction.

### Studio log where the chain shape is the data

**Composes:** thread per body of work · bead mood = energy in the room · sections for the creative arc · slide-export to walk it.

1. Create one thread for each body of work.
2. Write each studio day as an entry. Use the bead mood for the energy, not for the output.
3. Divide the chain into sections: "Concept / Draft / Revision / Publish". A more honest alternative is "Started / Plateau / Recovery / Renewal".
4. Before you start the next piece, **slide-export** the thread and walk through it from start to end. Your past comments go with it as private speaker notes.

The shape of the mood through the months becomes visible. Example: a row of charcoal beads through the plateau, then a change to forest beads at the renewal.

**Advantage over a generic tool:** a file tree has no shape in emotion or in time. The bead chain shows the doubt and the return as something that you can see and walk through. Mood is one of the four encoded dimensions. Thus the plateau is a visible row of one color. You do not need to remember that the period was bad.

### Burst capture → fuse → one clean artifact

**Composes:** drag-FAB quick capture · the burst banner (auto-detect) · fuse (alchemy bead) *or* thread · Postcard/Card export.

1. In the studio or outdoors, **long-press the `+` and drag** to the camera or voice target. This captures without a stop in your work. Do not add a title or a bead.
2. After ≥3 captures in ~30 min, look at the home banner. It offers **Fuse** or **Thread** in one tap. Vakana found the burst for you.
3. If the captures show one moment, tap **Fuse**. The captures become one entry with a computed alchemy bead. The alchemy bead uses the most common shape, mood and pattern of the source entries. Tap the bead to override it.
4. If the captures are a sequence, tap **Thread**. Each capture stays a separate entry, and Vakana puts the beads on a chain.
5. Export the fused entry as a **Postcard** HTML or as a **PNG card**. The export contains the alchemy bead and the photos as one self-contained item that you can share.

**Advantage over a generic tool:** a camera roll or a notes app keeps the burst as N items with no structure, and you do not go back to clean it. Vakana detects the burst and offers the cleanup when the cleanup is easy. The fused entry has a bead that Vakana computes from the source entries. Thus Vakana encodes the consolidation and does not only delete items.

### Idea bank that the system resurfaces

**Composes:** one "Idea bank" thread · comment-reminder on the good ones · promote comment → bead · full-text search.

1. Keep one thread. Put each incomplete idea on it as a bead. Use no structure, so that capture is easy.
2. On an idea that has potential, add a comment-reminder 30 days from now. Example text: "still alive?".
3. When the comment-reminder fires, tap the banner. The banner opens the idea one month later.
4. If the idea has no value now, leave it.
5. If the idea has value, expand it.
6. If a comment on the idea became the real idea, **promote that comment to a bead** that is chained to it.
7. Use search to find an idea that has too few tags. Search includes the text of comments.

**Advantage over a generic tool:** in other tools, nothing brings an idea back from the idea inbox, so you forget it. The comment-reminder is attached to the idea and shows it to you again. With the promote operation, a good idea goes into the chain. It does not stay a note with no connections.

---

See also: [`possibilities.md`](possibilities.md) for the full one-line menu of uses, and [`use-cases.md`](use-cases.md) for tap-by-tap procedures with examples.
