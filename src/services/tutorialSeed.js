// Interactive tutorial: a seeded, walkable, exportable sample thread.
//
// The cold-start problem: a brand-new Vakana is an empty list, visually
// indistinguishable from any notes app. Everything that makes it Vakana (a
// bead you tap, a chain you walk, a thread, a comment in the margin) only
// exists once there's content, and a real thread takes weeks to build. So
// the first-touch user has nothing to react to and leaves before the grammar
// ever had a body.
//
// The fix: plant a tiny closed thread of numbered-glyph beads that teaches
// the app by *being the thing it describes*: open it, walk the chain, swipe
// a note to comment, long-press a bead to filter, export it to a slide deck,
// then delete it and start your own. It's the maker's live-demo tool too.
//
// Hard rule (load-bearing decision 1; see docs/architecture/interactive-tutorial.md):
// the copy teaches GRAMMAR and GESTURES only. It NEVER says what a bead
// *means*: no "circle = encounter". The numbered glyphs (0…5) carry step
// order, which is content-free. Meaning is always the user's.
//
// Lifecycle (full contract: docs/architecture/interactive-tutorial.md):
//   - seedTutorial():           Settings "Add". The ONLY way the tutorial
//     enters a journal since v0.77.0; nothing seeds at boot.
//   - isTutorialPresent():      derived from the DB (seeded rows), never a
//     stored boolean (which would desync after a partial manual delete).
//   - reloadTutorial():         wipe-then-insert; repairs a partial delete.
//   - removeTutorial():         one-tap clean removal.
//   Reload/Remove are the round-trip pair exposed in Settings → Pro Tips.

import { getDb } from '../database/db';
import { formatDateStr } from '../utils/dateString';
import { removeAutoBeadForEntry } from './autoThread';
import { removeCommentsForParent, PARENT_ENTRY, PARENT_THREAD } from './comments';

const THREAD_NAME = 'Your first thread';
const THREAD_DESC =
  'A 90-second tour. Go through it bead by bead, then make it yours. Delete it, ' +
  'or reload it at any time from Settings → Pro Tips.';

// Numbered-glyph beads. Every bead is the SAME shape (round) and pattern
// (solid) ON PURPOSE: the chain reads as a clean numbered rosary where the
// glyph 0…5 is the one thing that distinguishes each bead, and the shapes
// and patterns are deliberately left for the user to discover and try
// themselves (not pre-assigned, which could also read as a meaning legend).
// Only the mood-colour varies, so the rosary still has visual life. The
// numbered glyph is content-free step order; the copy never assigns meaning.
// `dayOffset` dates each note N days back from "today" at seed time, so the
// home list (newest-first) reads 0→5 top-to-bottom AND the chain (position
// 0→5) reads 0→5 left-to-right, with the time-band headers (Today /
// Yesterday / Earlier this week) shown for free.
// Titles are the *action itself* (the reader is inside the note, not the
// list) and carry a progress fraction: bead 0️⃣ is the unnumbered welcome,
// beads 1️⃣–5️⃣ are steps "1/5"…"5/5". The two hidden gestures
// (swipe-to-comment, long-press-to-filter) live on the *list row*, so those
// bodies say where to do them; the bead-tap and thread-open work from inside
// the editor too.
const TUTORIAL_NOTES = [
  {
    dayOffset: 0,
    bead: { shape: 'round', pattern: 'solid', mood: 'sun', glyph: '0️⃣' },
    title: 'Start here · a 90-second tour',
    content:
      'Welcome. If this is all new to you, that is not a problem. This tour ' +
      'goes slowly.\n\n' +
      '*Vakana* is the Malagasy word for **beads**. The language has no other ' +
      'word for them, and the app takes its name from this word. The idea is ' +
      'old. You turn a moment into a **bead**, which is a small coloured ' +
      'token. Beads that you keep together make a **thread**. You can go ' +
      'back along a thread, bead by bead. (These six notes are already a ' +
      'thread: *"Your first thread"*.)\n\n' +
      'That is all of the structure. You decide what a bead *means*. The app ' +
      'does not decide it for you.\n\n' +
      'This tour is short and practical. It has five steps, and you do each ' +
      'step yourself.\n\n' +
      'Next → **1/5 · Tap the bead**.',
  },
  {
    dayOffset: 1,
    bead: { shape: 'round', pattern: 'solid', mood: 'ocean', glyph: '1️⃣' },
    title: '1/5 · Tap the bead',
    content:
      '**Tap the bead** at the top of this note. The composer opens. In the ' +
      'composer, you select the **shape**, the **pattern**, the ' +
      '**mood-colour** and a small **glyph** of a bead (the glyph of this ' +
      'bead is the number 1️⃣).\n\n' +
      'There are eight shapes, eight patterns and eight moods. You can learn ' +
      'this small set quickly, and you can use it for all subjects. There is ' +
      'no legend. A circle is not "an encounter" unless *you* make that ' +
      'decision.\n\n' +
      'Next → **2/5 · Open the thread**.',
  },
  {
    dayOffset: 2,
    bead: { shape: 'round', pattern: 'solid', mood: 'forest', glyph: '2️⃣' },
    title: '2/5 · Open the thread',
    content:
      'This note is on a **thread**. A thread is a chain of beads that you ' +
      'put together on purpose. **Open *"Your first thread"***: tap its chip ' +
      'here, or find it in the Threads view. You see all six beads in a row. ' +
      'You can go along the row, bead by bead.\n\n' +
      'The app also keeps a thread for **every day** on which you write. ' +
      'These threads are under *Days* in the Threads view. The app makes ' +
      'them for you.\n\n' +
      'Next → **3/5 · Comment**.',
  },
  {
    dayOffset: 3,
    bead: { shape: 'round', pattern: 'solid', mood: 'plum', glyph: '3️⃣' },
    title: '3/5 · Comment: swipe me right',
    content:
      'Some thoughts come *after* the moment. Do not write the note again. ' +
      'Leave a **comment** in its margin.\n\n' +
      'Try it. Tap the **💬 at the top** of this note. Or go back to your ' +
      'list and **swipe this row to the right**. Each of these two actions ' +
      'opens the margin. There, you can write a thought, and you can set it ' +
      'to remind you later.\n\n' +
      '(The next bead, 4️⃣, already has a comment. Find the 💬 on its row.)' +
      '\n\nNext → **4/5 · Long-press the bead**.',
  },
  {
    dayOffset: 4,
    bead: { shape: 'round', pattern: 'solid', mood: 'ember', glyph: '4️⃣' },
    title: '4/5 · Long-press a bead in the list',
    comment:
      'I come back to this one frequently. Many people do not know that ' +
      'they can long-press a bead.',
    content:
      'Beads repeat, and you will want to find the beads that are the same ' +
      'as a given bead. You do this from your **list**, not from a note. Go ' +
      'back to the list first.\n\n' +
      'In the list, **press and hold a bead**. The list immediately shows ' +
      'only the beads that are the same. (Many people do not know this ' +
      'gesture.)\n\n' +
      'For more control, tap the **funnel** at the top of the list. You can ' +
      'filter by shape, mood, pattern or glyph. Then you can put the results ' +
      'into a new thread.\n\n' +
      'Next → **5/5 · Make it yours**.',
  },
  {
    dayOffset: 5,
    bead: { shape: 'round', pattern: 'solid', mood: 'rose', glyph: '5️⃣' },
    title: '5/5 · Close it, then make it yours',
    content:
      'This thread is **closed**. Look at the clasp. A closed thread shows ' +
      'that a loop is complete. You can open it again at any time.\n\n' +
      'A complete thread can leave the app. Open it and tap **Export** to ' +
      'make a web page or a slide deck from it.\n\n' +
      'That is all of the grammar: **bead, thread, comment, close, export**. ' +
      'Now make it yours:\n\n' +
      '• **Delete this tour**: swipe a note to the left, or remove the tour ' +
      'with one tap from **Settings → Pro Tips → Interactive tutorial**.\n' +
      '• To get it back later, tap **Reload** in the same place.\n\n' +
      'Now write your first real moment, and give it the bead that *you* ' +
      'want.',
  },
];

function offsetDays(base, n) {
  const d = new Date(base);
  d.setDate(d.getDate() - n);
  return d;
}

// True iff any seeded rows still exist. Derived, not stored: it survives a
// partial manual delete (swipe-deleting some tutorial notes).
export async function isTutorialPresent() {
  const db = getDb();
  if (!db) return false;
  try {
    const row = await db.getFirstAsync(
      `SELECT
         (SELECT COUNT(*) FROM entries WHERE seeded = 1) AS e,
         (SELECT COUNT(*) FROM threads WHERE seeded = 1) AS t`
    );
    return (row?.e ?? 0) > 0 || (row?.t ?? 0) > 0;
  } catch (e) {
    console.warn('isTutorialPresent failed:', e?.message || e);
    return false;
  }
}

// Insert the sample thread + its six numbered beads + the one demo comment.
// No-ops if the tutorial is already present (so a stray double-call can't
// duplicate it). Does NOT call syncAutoBeadForEntry: the seed deliberately
// stays out of auto-threads so the only thread on a fresh install is the
// curated tutorial one (cleaner "what is a thread?" on first contact, and
// nothing to chase on teardown). If the user later edits a tutorial entry,
// the editor's own save will auto-thread it. removeTutorial detaches
// defensively for exactly that case.
export async function seedTutorial() {
  const db = getDb();
  if (!db) return;
  if (await isTutorialPresent()) return;

  const today = new Date();
  try {
    await db.withTransactionAsync(async () => {
      const threadRes = await db.runAsync(
        `INSERT INTO threads
           (name, description, anchor_kind, anchor_date, kind, closed_at, seeded)
         VALUES (?, ?, NULL, NULL, 'user', datetime('now'), 1)`,
        [THREAD_NAME, THREAD_DESC]
      );
      const threadId = threadRes.lastInsertRowId;

      let position = 0;
      for (const note of TUTORIAL_NOTES) {
        const dateStr = formatDateStr(offsetDays(today, note.dayOffset));
        const { shape, pattern, mood, glyph } = note.bead;
        const entryRes = await db.runAsync(
          `INSERT INTO entries
             (title, content, date, bead_shape, bead_pattern, bead_mood,
              bead_glyph, highlight_tier, is_private, seeded)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 1)`,
          [note.title, note.content, dateStr, shape, pattern, mood, glyph]
        );
        const entryId = entryRes.lastInsertRowId;

        await db.runAsync(
          `INSERT INTO thread_beads
             (thread_id, entry_id, position, snapshot_shape, snapshot_pattern,
              snapshot_mood, snapshot_glyph)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [threadId, entryId, position, shape, pattern, mood, glyph]
        );

        if (note.comment) {
          await db.runAsync(
            `INSERT INTO comments (parent_kind, parent_id, body)
             VALUES ('entry', ?, ?)`,
            [entryId, note.comment]
          );
        }
        position += 1;
      }
    });
  } catch (e) {
    console.warn('seedTutorial failed:', e?.message || e);
  }
}

// Remove every seeded row cleanly. Comments have no FK (polymorphic) so they
// go through removeCommentsForParent first; auto-thread snapshots are
// detached defensively in case the user edited a tutorial entry into one;
// then the entries (cascades photos/voice) and the seeded thread (cascades
// thread_beads + collection links) are dropped.
export async function removeTutorial() {
  const db = getDb();
  if (!db) return;
  try {
    const entryRows = await db.getAllAsync(
      `SELECT id FROM entries WHERE seeded = 1`
    );
    for (const r of entryRows) {
      await removeAutoBeadForEntry(r.id);
      await removeCommentsForParent(PARENT_ENTRY, r.id);
    }
    const threadRows = await db.getAllAsync(
      `SELECT id FROM threads WHERE seeded = 1`
    );
    for (const r of threadRows) {
      await removeCommentsForParent(PARENT_THREAD, r.id);
    }
    await db.withTransactionAsync(async () => {
      await db.runAsync(`DELETE FROM entries WHERE seeded = 1`);
      await db.runAsync(`DELETE FROM threads WHERE seeded = 1`);
    });
  } catch (e) {
    console.warn('removeTutorial failed:', e?.message || e);
  }
}

// Wipe-then-insert. Idempotent way to (re)summon a clean tutorial, and the
// repair path for a partially-deleted one.
export async function reloadTutorial() {
  await removeTutorial();
  await seedTutorial();
}

// The boot-time auto-seed (`seedTutorialIfFirstRun`) was REMOVED in v0.77.0,
// along with its `vakana_tutorial_autoseed_done` secure-store marker. The
// tutorial is opt-in from Settings → Pro Tips; boot plants nothing, and the
// empty list invites the reader into the guide instead.
//
// Deliberately deleted rather than left dormant: a dormant seeder is one
// stray call away from furnishing a user's memory palace with six notes that
// aren't theirs, which is the exact thing the removal was about. Any value
// left in secure-store under the old key on an existing install is inert.
// Reasoning in docs/architecture/interactive-tutorial.md § Revision.
