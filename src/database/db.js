import * as SQLite from 'expo-sqlite';
import { getCurrentVault, DEFAULT_DB_FILENAME } from '../utils/vaults';
import { warn } from '../utils/log';

let db = null;
let currentDbFilename = null;

const ENTRY_BEAD_COLUMNS = [
  ['bead_shape', 'TEXT'],
  ['bead_pattern', 'TEXT'],
  ['bead_mood', 'TEXT'],
  ['bead_glyph', 'TEXT'],
];

async function ensureBeadColumns(database) {
  let existing;
  try {
    const cols = await database.getAllAsync('PRAGMA table_info(entries)');
    existing = new Set(cols.map((c) => c.name));
  } catch (e) {
    console.warn('ensureBeadColumns: failed to read entries schema:', e?.message || e);
    return;
  }
  for (const [name, type] of ENTRY_BEAD_COLUMNS) {
    if (existing.has(name)) continue;
    try {
      await database.execAsync(`ALTER TABLE entries ADD COLUMN ${name} ${type}`);
    } catch (e) {
      console.warn(`ensureBeadColumns: ADD COLUMN ${name} failed:`, e?.message || e);
    }
  }
  // Created here, not in the initDatabase exec block, because bead_shape
  // may not exist yet when that block runs on a pre-bead database. Shape
  // alone: the other facets are compared through IFNULL(...) (facet
  // normalization), which a raw-column index can't serve. The shape
  // equality prefix is where the selectivity is (echo chip, reshape
  // count/rewrite, bead filters).
  try {
    await database.execAsync(
      'CREATE INDEX IF NOT EXISTS idx_entries_bead_shape ON entries(bead_shape)'
    );
  } catch (e) {
    console.warn('ensureBeadColumns: bead_shape index failed:', e?.message || e);
  }
}

async function ensureHighlightColumn(database) {
  // Two-tier highlight on entries. 0 = none, 1 = weekly highlight (feeds
  // auto_week threads), 2 = monthly highlight (feeds auto_month). Cycled
  // via the star control in the editor's bead/meta block.
  let existing;
  try {
    const cols = await database.getAllAsync('PRAGMA table_info(entries)');
    existing = new Set(cols.map((c) => c.name));
  } catch (e) {
    console.warn('ensureHighlightColumn: failed to read entries schema:', e?.message || e);
    return;
  }
  if (!existing.has('highlight_tier')) {
    try {
      await database.execAsync(
        'ALTER TABLE entries ADD COLUMN highlight_tier INTEGER NOT NULL DEFAULT 0'
      );
    } catch (e) {
      console.warn('ensureHighlightColumn: ADD COLUMN failed:', e?.message || e);
    }
  }
}

async function ensurePrivateColumn(database) {
  // Per-entry shoulder-surf flag. 0 = normal, 1 = masked in list/preview
  // surfaces and in the editor when neither title nor content is focused.
  // Visual only: DB columns stay plaintext so search keeps working.
  let existing;
  try {
    const cols = await database.getAllAsync('PRAGMA table_info(entries)');
    existing = new Set(cols.map((c) => c.name));
  } catch (e) {
    console.warn('ensurePrivateColumn: failed to read entries schema:', e?.message || e);
    return;
  }
  if (!existing.has('is_private')) {
    try {
      await database.execAsync(
        'ALTER TABLE entries ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0'
      );
    } catch (e) {
      console.warn('ensurePrivateColumn: ADD COLUMN failed:', e?.message || e);
    }
  }
}

async function ensureEntryTimeColumn(database) {
  // Optional time-of-day on an entry. NULL = date-only (the default and
  // every pre-existing entry); a 'HH:MM' string (24h, local) promotes the
  // note from day-grained to moment-grained. Same string convention as
  // scheduled_prompts.scheduled_time / threads.anchor_time. Used for display
  // and to time-order same-day beads on auto-threads (see autoThread.js's
  // chronologicalPosition + resyncAutoThreadTimeOrderIfNeeded).
  let existing;
  try {
    const cols = await database.getAllAsync('PRAGMA table_info(entries)');
    existing = new Set(cols.map((c) => c.name));
  } catch (e) {
    console.warn('ensureEntryTimeColumn: failed to read entries schema:', e?.message || e);
    return;
  }
  if (!existing.has('time')) {
    try {
      await database.execAsync('ALTER TABLE entries ADD COLUMN time TEXT');
    } catch (e) {
      console.warn('ensureEntryTimeColumn: ADD COLUMN time failed:', e?.message || e);
    }
  }
}

async function ensureReminderColumns(database) {
  let existing;
  try {
    const cols = await database.getAllAsync('PRAGMA table_info(scheduled_prompts)');
    existing = new Set(cols.map((c) => c.name));
  } catch (e) {
    console.warn('ensureReminderColumns: failed to read scheduled_prompts schema:', e?.message || e);
    return;
  }
  if (!existing.has('acknowledged_at')) {
    try {
      await database.execAsync(
        'ALTER TABLE scheduled_prompts ADD COLUMN acknowledged_at TEXT'
      );
    } catch (e) {
      console.warn('ensureReminderColumns: ADD COLUMN acknowledged_at failed:', e?.message || e);
    }
  }
}

async function ensureRecurrenceColumns(database) {
  // N18: recurring reminders. The series is the row; `scheduled_date` /
  // `scheduled_time` always points at the *next* occurrence and gets
  // advanced when the series is acked. Catchup is lazy: if multiple
  // occurrences passed while the user was away, the ack increments
  // `recurrence_fired` by the missed count and advances past them in one
  // shot. No per-occurrence rows.
  let existing;
  try {
    const cols = await database.getAllAsync(
      'PRAGMA table_info(scheduled_prompts)'
    );
    existing = new Set(cols.map((c) => c.name));
  } catch (e) {
    console.warn('ensureRecurrenceColumns: failed to read schema:', e?.message || e);
    return;
  }
  const adds = [
    ['recurrence_kind', 'TEXT'],          // null=one-shot | 'day'|'week'|'month'|'year'
    ['recurrence_every', 'INTEGER NOT NULL DEFAULT 1'],
    ['recurrence_max', 'INTEGER'],        // null=forever, else cap
    ['recurrence_fired', 'INTEGER NOT NULL DEFAULT 0'],
    // Day-of-month a month/year series was set on. The cursor clamps in
    // short months (31 → Feb 28); this is what lets it come back.
    ['recurrence_anchor_day', 'INTEGER'],
  ];
  for (const [name, type] of adds) {
    if (existing.has(name)) continue;
    try {
      await database.execAsync(
        `ALTER TABLE scheduled_prompts ADD COLUMN ${name} ${type}`
      );
    } catch (e) {
      console.warn(
        `ensureRecurrenceColumns: ADD COLUMN ${name} failed:`,
        e?.message || e
      );
    }
  }
  // Backfill: month/year series without an anchor take the day of their
  // current cursor. Every launch, not only when the column is added: a
  // restored older backup brings anchor-less rows back. A series that had
  // already drifted (31 → 28) before the column existed stays on its
  // drifted day; the original is gone, and re-picking the date in the
  // reminder form re-anchors it.
  try {
    await database.execAsync(
      `UPDATE scheduled_prompts
          SET recurrence_anchor_day = CAST(substr(scheduled_date, 9, 2) AS INTEGER)
        WHERE recurrence_kind IN ('month', 'year')
          AND recurrence_anchor_day IS NULL`
    );
  } catch (e) {
    console.warn(
      'ensureRecurrenceColumns: anchor-day backfill failed:',
      e?.message || e
    );
  }
}

async function ensureThreadCollections(database) {
  // The table can live in the initial CREATE block since it doesn't depend
  // on anything else, but the ALTER TABLE for threads.collection_id has the
  // same constraint as ensureThreadKindColumn: it must run after the initial
  // schema block, before any index that references the new column. Keeping
  // both column shim and dependent index together here keeps that ordering
  // explicit.
  try {
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS thread_collections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  } catch (e) {
    console.warn('ensureThreadCollections: CREATE TABLE failed:', e?.message || e);
    return;
  }

  let existing;
  try {
    const cols = await database.getAllAsync('PRAGMA table_info(threads)');
    existing = new Set(cols.map((c) => c.name));
  } catch (e) {
    console.warn('ensureThreadCollections: failed to read threads schema:', e?.message || e);
    return;
  }
  if (!existing.has('collection_id')) {
    try {
      await database.execAsync(
        `ALTER TABLE threads ADD COLUMN collection_id INTEGER
           REFERENCES thread_collections(id) ON DELETE SET NULL`
      );
    } catch (e) {
      console.warn('ensureThreadCollections: ADD COLUMN collection_id failed:', e?.message || e);
      return;
    }
  }

  try {
    await database.execAsync(
      'CREATE INDEX IF NOT EXISTS idx_threads_collection ON threads(collection_id)'
    );
  } catch (e) {
    console.warn('ensureThreadCollections: index creation failed:', e?.message || e);
  }
}

async function ensureThreadCollectionLinks(database) {
  // Many-to-many between threads and thread_collections. Replaces the older
  // single-collection model that used threads.collection_id. The column
  // stays in place (vestigial) so downgrades don't blow up; new writes go
  // exclusively through this table.
  try {
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS thread_collection_links (
        thread_id INTEGER NOT NULL,
        collection_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (thread_id, collection_id),
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
        FOREIGN KEY (collection_id) REFERENCES thread_collections(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_thread_collection_links_thread
        ON thread_collection_links(thread_id);
      CREATE INDEX IF NOT EXISTS idx_thread_collection_links_collection
        ON thread_collection_links(collection_id);
    `);
  } catch (e) {
    console.warn('ensureThreadCollectionLinks: CREATE TABLE failed:', e?.message || e);
    return;
  }

  // One-shot backfill: for every thread that still has a non-null
  // collection_id, ensure a corresponding link row exists. INSERT OR IGNORE
  // makes this idempotent across boots without a separate "did we backfill"
  // flag: the primary key (thread_id, collection_id) collapses repeats.
  try {
    let hasColumn = false;
    try {
      const cols = await database.getAllAsync('PRAGMA table_info(threads)');
      hasColumn = cols.some((c) => c.name === 'collection_id');
    } catch {
      hasColumn = false;
    }
    if (hasColumn) {
      await database.execAsync(`
        INSERT OR IGNORE INTO thread_collection_links (thread_id, collection_id)
          SELECT id, collection_id FROM threads
           WHERE collection_id IS NOT NULL;
      `);
    }
  } catch (e) {
    console.warn('ensureThreadCollectionLinks: backfill failed:', e?.message || e);
  }
}

async function ensureSectionLabelColumn(database) {
  // Per-membership section header on thread_beads. When non-null, the bead
  // is rendered as the start of a chapter within the thread: a vertical
  // tick + label in the horizontal chain, or a full-width banner row in
  // the vertical chain. Lives on the junction (not on the entry) so the
  // same entry can be a section header in one thread and a plain bead in
  // another.
  let existing;
  try {
    const cols = await database.getAllAsync('PRAGMA table_info(thread_beads)');
    existing = new Set(cols.map((c) => c.name));
  } catch (e) {
    console.warn(
      'ensureSectionLabelColumn: failed to read thread_beads schema:',
      e?.message || e
    );
    return;
  }
  if (!existing.has('section_label')) {
    try {
      await database.execAsync(
        'ALTER TABLE thread_beads ADD COLUMN section_label TEXT'
      );
    } catch (e) {
      console.warn(
        'ensureSectionLabelColumn: ADD COLUMN section_label failed:',
        e?.message || e
      );
    }
  }
}

async function ensureThreadKindColumn(database) {
  let existing;
  try {
    const cols = await database.getAllAsync('PRAGMA table_info(threads)');
    existing = new Set(cols.map((c) => c.name));
  } catch (e) {
    console.warn('ensureThreadKindColumn: failed to read threads schema:', e?.message || e);
    return;
  }
  if (!existing.has('kind')) {
    try {
      await database.execAsync(
        "ALTER TABLE threads ADD COLUMN kind TEXT NOT NULL DEFAULT 'user'"
      );
    } catch (e) {
      console.warn('ensureThreadKindColumn: ADD COLUMN kind failed:', e?.message || e);
      return;
    }
  }
  // Indexes that depend on `kind` live here, not in the initial schema block,
  // because that block can't reference a column that doesn't exist yet on
  // databases created before v0.2.0.
  try {
    await database.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_threads_kind_anchor
        ON threads(kind, anchor_date);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_threads_auto_day_unique
        ON threads(anchor_date)
        WHERE kind = 'auto_day' AND anchor_date IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_threads_auto_week_unique
        ON threads(anchor_date)
        WHERE kind = 'auto_week' AND anchor_date IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_threads_auto_month_unique
        ON threads(anchor_date)
        WHERE kind = 'auto_month' AND anchor_date IS NOT NULL;
    `);
  } catch (e) {
    console.warn('ensureThreadKindColumn: index creation failed:', e?.message || e);
  }
}

async function ensureCommentResolvedColumn(database) {
  // `resolved_at` closes a *comment loop*, the micro-scale sibling of
  // threads.closed_at ("close the vakana"). A comment is often a thing the
  // user is trying; resolving it marks the loop shut. NULL = open;
  // a datetime('now') string = resolved (and the day it resolved). Stored
  // in SQLite's space-separated datetime form (like created_at/updated_at),
  // NOT JS ISO. It is only ever null-checked / displayed / mapped to org
  // DONE, never compared against datetime('now'), so the comments.remind_at
  // ISO-vs-space gotcha does not apply. Reversible: "Reopen" sets it NULL.
  // Orthogonal to remind_at/reminded_at (reminder lifecycle ≠ resolution).
  // No index: comments are always read by (parent_kind, parent_id) which is
  // already indexed; resolution is a render/export annotation, not a filter.
  let existing;
  try {
    const cols = await database.getAllAsync('PRAGMA table_info(comments)');
    existing = new Set(cols.map((c) => c.name));
  } catch (e) {
    console.warn('ensureCommentResolvedColumn: failed to read comments schema:', e?.message || e);
    return;
  }
  if (!existing.has('resolved_at')) {
    try {
      await database.execAsync('ALTER TABLE comments ADD COLUMN resolved_at TEXT');
    } catch (e) {
      console.warn('ensureCommentResolvedColumn: ADD COLUMN resolved_at failed:', e?.message || e);
    }
  }
}

async function ensureThreadClosedColumn(database) {
  // `closed_at` marks a user thread as a *closed loop*, the vakana clasped
  // shut: a cycle that completed and returns, not an infinite chain. NULL =
  // open/ongoing; a datetime('now') string = closed (and the day it closed,
  // surfaced as the "Closed · date" chip). Stored in SQLite's space-separated
  // datetime form (like threads.created_at/updated_at), NOT JS ISO, so it
  // sidesteps the comments.remind_at ISO-vs-space comparison gotcha entirely.
  // Reversible (cycles recur): "Reopen" sets it back to NULL. auto_week /
  // auto_month are intrinsically closed rings and never carry this column:
  // their loop is derived from `kind`, not stored. No index: the threads
  // table is tiny and every read is a full scan already.
  let existing;
  try {
    const cols = await database.getAllAsync('PRAGMA table_info(threads)');
    existing = new Set(cols.map((c) => c.name));
  } catch (e) {
    console.warn('ensureThreadClosedColumn: failed to read threads schema:', e?.message || e);
    return;
  }
  if (!existing.has('closed_at')) {
    try {
      await database.execAsync('ALTER TABLE threads ADD COLUMN closed_at TEXT');
    } catch (e) {
      console.warn('ensureThreadClosedColumn: ADD COLUMN closed_at failed:', e?.message || e);
    }
  }
}

async function ensureSeededColumns(database) {
  // `seeded` marks rows the app planted itself: the interactive tutorial
  // (docs/architecture/interactive-tutorial.md). 0 = the user's own data,
  // 1 = tutorial sample. It lives on both `entries` and `threads` so the
  // tutorial set can be located exactly for one-tap Reload/Remove from
  // Settings → Pro Tips, without a parallel id-ledger that could drift.
  // "Is the tutorial present?" is then derived from the DB (COUNT WHERE
  // seeded = 1), never stored as a boolean that desyncs after a partial
  // manual delete. A separate secure-store marker (in services/tutorialSeed.js)
  // governs only the *first-run auto-seed*, a different concern.
  for (const table of ['entries', 'threads']) {
    let existing;
    try {
      const cols = await database.getAllAsync(`PRAGMA table_info(${table})`);
      existing = new Set(cols.map((c) => c.name));
    } catch (e) {
      console.warn(`ensureSeededColumns: failed to read ${table} schema:`, e?.message || e);
      continue;
    }
    if (!existing.has('seeded')) {
      try {
        await database.execAsync(
          `ALTER TABLE ${table} ADD COLUMN seeded INTEGER NOT NULL DEFAULT 0`
        );
      } catch (e) {
        console.warn(`ensureSeededColumns: ADD COLUMN seeded on ${table} failed:`, e?.message || e);
      }
    }
  }
}

export async function initDatabase() {
  let filename = DEFAULT_DB_FILENAME;
  try {
    const vault = await getCurrentVault();
    if (vault?.dbFilename) filename = vault.dbFilename;
  } catch (e) {
    // Falls back to the default vault's DB. Worth a trace if it happens.
    warn('db.initDatabase.currentVault', e);
  }
  // Idempotent on purpose. An Android Activity relaunch (system navigation-
  // mode change, font-size change, locale change, …) remounts the React root
  // without restarting the JS runtime, so App.js's boot effect calls us again
  // while this module still holds a live handle. Opening the same file twice
  // is not harmless with expo-sqlite: the second `openDatabaseAsync` is handed
  // the SAME cached native connection, and when the orphaned first wrapper is
  // garbage-collected its release closes that shared connection underneath
  // the new wrapper (`NativeDatabase.sharedObjectDidRelease` → `ref.close()`,
  // with `isClosed` left false). Every later query then fails with a bare
  // NullPointerException: lists render empty, auto-save fails. Reuse the
  // open handle for the same file; close first when the vault changed.
  if (db && currentDbFilename === filename) return db;
  if (db) await closeDatabase();

  db = await SQLite.openDatabaseAsync(filename);
  currentDbFilename = filename;

  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      bead_shape TEXT,
      bead_pattern TEXT,
      bead_mood TEXT,
      bead_glyph TEXT,
      is_private INTEGER NOT NULL DEFAULT 0
    );

    -- entries.date is the hottest predicate in the app (day view, home
    -- bands/counts, echo chip, auto-thread anchors all filter or sort on
    -- it) and the date column exists from the very first schema, so it is
    -- safe to create here. Bead-facet columns arrive via ensureBeadColumns,
    -- so their index lives in that shim (same reason as threads(kind)).
    CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);

    CREATE TABLE IF NOT EXISTS entry_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL,
      uri TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS entry_voice_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL,
      uri TEXT NOT NULL,
      duration INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
    );

    -- SQLite does not auto-index FK columns; without these, every
    -- per-entry attachment lookup (and every ON DELETE CASCADE check on
    -- an entries delete) is a full scan of the attachment tables.
    CREATE INDEX IF NOT EXISTS idx_entry_photos_entry
      ON entry_photos(entry_id);
    CREATE INDEX IF NOT EXISTS idx_entry_voice_notes_entry
      ON entry_voice_notes(entry_id);

    CREATE TABLE IF NOT EXISTS scheduled_prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      scheduled_date TEXT NOT NULL,
      scheduled_time TEXT NOT NULL,
      recurring TEXT DEFAULT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      notification_id TEXT,
      acknowledged_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      anchor_kind TEXT,
      anchor_date TEXT,
      anchor_time TEXT,
      kind TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- Note: indexes on threads(kind, …) are created in ensureThreadKindColumn
    -- so they don't reference a column that may not yet exist on pre-v0.2.0
    -- databases (this whole exec block runs before the ALTER TABLE shim).

    CREATE TABLE IF NOT EXISTS thread_beads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER NOT NULL,
      entry_id INTEGER,
      position INTEGER NOT NULL,
      snapshot_shape TEXT NOT NULL,
      snapshot_pattern TEXT NOT NULL,
      snapshot_mood TEXT NOT NULL,
      snapshot_glyph TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
      FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_thread_beads_thread ON thread_beads(thread_id);
    CREATE INDEX IF NOT EXISTS idx_thread_beads_entry ON thread_beads(entry_id);

    CREATE TABLE IF NOT EXISTS entry_thread_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL,
      thread_id INTEGER NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE,
      FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_entry_thread_links_entry
      ON entry_thread_links(entry_id);
    CREATE INDEX IF NOT EXISTS idx_entry_thread_links_thread
      ON entry_thread_links(thread_id);

    -- Polymorphic comments (parent_kind ∈ {entry, thread, reminder}).
    -- No FK because parent_id only makes sense in the context of
    -- parent_kind; cleanup on parent delete is handled in app code
    -- via removeCommentsForParent in src/services/comments.js.
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_kind TEXT NOT NULL,
      parent_id INTEGER NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      edited_at TEXT,
      remind_at TEXT,
      notification_id TEXT,
      reminded_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_comments_parent
      ON comments(parent_kind, parent_id, created_at);

    -- Partial index keeps the per-tick fired-banner derivation cheap:
    -- only unfired comment-reminders are scanned.
    CREATE INDEX IF NOT EXISTS idx_comments_remind
      ON comments(remind_at)
      WHERE remind_at IS NOT NULL AND reminded_at IS NULL;

    -- One article per thread. Source of truth for what gets exported as a
    -- polished MD/HTML/PDF post; entries themselves stay untouched. Stored
    -- as a sidecar so the composition survives entry edits: re-export
    -- always pulls live content. JSON columns are app-managed strings.
    CREATE TABLE IF NOT EXISTS thread_articles (
      thread_id INTEGER PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      subtitle TEXT NOT NULL DEFAULT '',
      intro TEXT NOT NULL DEFAULT '',
      cover_photo_uri TEXT,
      template TEXT NOT NULL DEFAULT 'editorial',
      hidden_bead_ids TEXT NOT NULL DEFAULT '[]',
      bead_overrides TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
    );

    -- Named bead presets (the macro/snippet layer). Independent of
    -- entries: a preset is a reusable {shape,pattern,mood,glyph} the
    -- user names once and recalls in BeadComposer. last_used_at orders
    -- the recents strip so the rhythm you're in floats to the front.
    CREATE TABLE IF NOT EXISTS bead_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      shape TEXT NOT NULL,
      pattern TEXT NOT NULL DEFAULT 'solid',
      mood TEXT NOT NULL DEFAULT 'slate',
      glyph TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT
    );

    -- Note-import idempotency ledger (the capture bridge, see
    -- docs/architecture/note-import.md section 7). A row records that a
    -- source (a synced-folder file or a fetched URL) has already been
    -- ingested so a re-scan / re-fetch never re-imports. hash is a
    -- content / datetree-leaf-subtree fingerprint; key is
    -- relPath|size|mtime (folder) or the URL. No FK on entry_id: the
    -- user may delete the imported entry, but a deleted import must
    -- still not re-import, so the ledger row legitimately outlives the
    -- entry. imported_at is an ISO string (this app's own writes are
    -- ISO, cf. the comments.remind_at datetime() note).
    CREATE TABLE IF NOT EXISTS import_ledger (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      source_kind TEXT NOT NULL,
      key         TEXT NOT NULL,
      hash        TEXT NOT NULL,
      entry_id    INTEGER,
      imported_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_import_ledger_hash
      ON import_ledger(hash);
  `);

  await ensureBeadColumns(db);
  await ensureHighlightColumn(db);
  await ensurePrivateColumn(db);
  await ensureEntryTimeColumn(db);
  await ensureReminderColumns(db);
  await ensureRecurrenceColumns(db);
  await ensureThreadKindColumn(db);
  await ensureThreadClosedColumn(db);
  await ensureCommentResolvedColumn(db);
  await ensureSectionLabelColumn(db);
  await ensureThreadCollections(db);
  await ensureThreadCollectionLinks(db);
  await ensureSeededColumns(db);

  return db;
}

export function getDb() {
  return db;
}

export function getCurrentDbFilename() {
  return currentDbFilename;
}

export async function closeDatabase() {
  if (!db) return;
  try {
    await db.closeAsync();
  } catch (e) {
    warn('db.closeDatabase', e);
  }
  db = null;
  currentDbFilename = null;
}
