// Thread → article pipeline. One row per thread in `thread_articles` stores
// the composition (title, intro, template, hidden beads, per-section
// overrides); entries themselves stay the source of truth so re-exports
// always pick up the latest content.
//
// Exports three transforms over the same composed-article data:
//   - Markdown (frontmatter + ordered sections, photos referenced by name)
//   - Self-contained HTML (inline SVG chain banner, base64-embedded photos)
//   - PDF (HTML routed through expo-print)
// Everything funnels through the share sheet via expo-sharing.

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';
import MarkdownIt from 'markdown-it';
import JSZip from 'jszip';
import { getDb } from '../database/db';
import { chainSvgString } from '../beads/svgExport';
import { PARENT_ENTRY, PARENT_THREAD } from './comments';
import { formatTimeLabel } from '../utils/dateString';

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

export const TEMPLATES = [
  {
    key: 'editorial',
    label: 'Editorial',
    hint: 'Serif blog, generous whitespace',
  },
  {
    key: 'journal',
    label: 'Journal',
    hint: 'Cream + warm, app aesthetic',
  },
  {
    key: 'minimal',
    label: 'Minimal',
    hint: 'Sans-serif, narrow column',
  },
  {
    key: 'storyboard',
    label: 'Storyboard',
    hint: 'Social feed with comment replies',
  },
  {
    key: 'postcard',
    label: 'Postcard',
    hint: 'Scrapbook polaroids + taped notes',
  },
];

// Templates that render comments inline as part of the story.
export const TEMPLATES_WITH_COMMENTS = new Set(['storyboard', 'postcard']);

export const TEMPLATE_KEYS = TEMPLATES.map((t) => t.key);

const DEFAULT_TEMPLATE = 'editorial';

function parseJsonArray(s, fallback = []) {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function parseJsonObject(s, fallback = {}) {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export function slugify(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeYamlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function basenameOf(uri) {
  if (!uri) return '';
  const cleaned = uri.split('?')[0].split('#')[0];
  const idx = cleaned.lastIndexOf('/');
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

// Resize + base64-encode in one pass. Inlining the raw photo bytes used to
// blow the JS heap on phones with big originals (a 4000px / 4 MB photo
// becomes ~5 MB of in-memory base64; a 20-section thread × 2 photos each
// would push ~200 MB before the PDF engine even starts). The manipulator
// downsizes on the native side and hands us base64 directly, so the export
// peaks at one prepped photo at a time.
async function prepPhotoForExport(uri, maxWidth, compress = 0.85) {
  try {
    const result = await manipulateAsync(
      uri,
      [{ resize: { width: maxWidth } }],
      {
        compress,
        format: SaveFormat.JPEG,
        base64: true,
      }
    );
    if (!result?.base64) return null;
    return `data:image/jpeg;base64,${result.base64}`;
  } catch {
    return null;
  }
}

// Raw (no data: prefix) base64 for JSZip's { base64: true }. Same
// resize+compress pass as prepPhotoForExport; a modest budget keeps the
// Markdown zip sane (no Android-Print ceiling here, but big images bloat
// the archive anyway). Mirrors orgExport.photoBase64.
async function prepPhotoRawBase64(uri, maxWidth = 1600, compress = 0.82) {
  try {
    const r = await manipulateAsync(uri, [{ resize: { width: maxWidth } }], {
      compress,
      format: SaveFormat.JPEG,
      base64: true,
    });
    return r?.base64 || null;
  } catch {
    return null;
  }
}

async function readFileRawBase64(uri) {
  try {
    return await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch {
    return null;
  }
}

function extFromUri(uri, fallback) {
  const m = /\.([A-Za-z0-9]+)(?:[?#]|$)/.exec(String(uri || ''));
  return m ? m[1].toLowerCase() : fallback;
}

function clockFromMs(ms) {
  const total = Math.round((Number(ms) || 0) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Deterministic in-zip asset paths. Shared by renderMarkdown (which
// writes the links) and buildThreadMarkdownZip (which writes the bytes)
// so the two can never drift. Entry-scoped + 1-based, matching the Org
// export's naming.
function photoAssetName(entryId, i) {
  return `photo-${entryId}-${i + 1}.jpg`;
}
function voiceAssetName(entryId, i, uri) {
  return `voice-${entryId}-${i + 1}.${extFromUri(uri, 'm4a')}`;
}

function formatDate(yyyy_mm_dd) {
  if (!yyyy_mm_dd) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyy_mm_dd);
  if (!m) return yyyy_mm_dd;
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const y = Number(m[1]);
  const mo = months[Number(m[2]) - 1] || '';
  const d = Number(m[3]);
  return `${mo} ${d}, ${y}`;
}

// formatDate, plus the entry's optional time-of-day appended ("· 2:30 PM")
// when present. Used for the per-section date line so a moment-grained
// entry reads as such in the exported article.
function formatDateTime(yyyy_mm_dd, time) {
  const base = formatDate(yyyy_mm_dd);
  const label = formatTimeLabel(time);
  return label ? `${base} · ${label}` : base;
}

export function defaultArticleFor(thread) {
  return {
    thread_id: thread?.id ?? null,
    title: thread?.name || '',
    subtitle: '',
    intro: '',
    cover_photo_uri: null,
    template: DEFAULT_TEMPLATE,
    hidden_bead_ids: [],
    bead_overrides: {},
    created_at: null,
    updated_at: null,
  };
}

function deserializeArticleRow(row) {
  if (!row) return null;
  return {
    thread_id: row.thread_id,
    title: row.title || '',
    subtitle: row.subtitle || '',
    intro: row.intro || '',
    cover_photo_uri: row.cover_photo_uri || null,
    template: TEMPLATE_KEYS.includes(row.template) ? row.template : DEFAULT_TEMPLATE,
    hidden_bead_ids: parseJsonArray(row.hidden_bead_ids).map((n) => Number(n)),
    bead_overrides: parseJsonObject(row.bead_overrides),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function loadArticle(threadId) {
  if (threadId == null) return null;
  const db = getDb();
  if (!db) return null;
  const row = await db.getFirstAsync(
    'SELECT * FROM thread_articles WHERE thread_id = ?',
    [threadId]
  );
  return deserializeArticleRow(row);
}

export async function saveArticle(threadId, fields) {
  if (threadId == null) throw new Error('threadId required');
  const db = getDb();
  if (!db) throw new Error('Database not ready');

  const title = (fields.title || '').slice(0, 500);
  const subtitle = (fields.subtitle || '').slice(0, 500);
  const intro = fields.intro || '';
  const coverUri = fields.cover_photo_uri || null;
  const template = TEMPLATE_KEYS.includes(fields.template)
    ? fields.template
    : DEFAULT_TEMPLATE;
  const hiddenJson = JSON.stringify(
    Array.isArray(fields.hidden_bead_ids)
      ? fields.hidden_bead_ids.map((n) => Number(n))
      : []
  );
  const overridesJson = JSON.stringify(
    fields.bead_overrides && typeof fields.bead_overrides === 'object'
      ? fields.bead_overrides
      : {}
  );

  // INSERT OR REPLACE is fine here: thread_id is the PK and there are no FKs
  // pointing at this row. The created_at column resets to now on replace,
  // which is acceptable since the column is informational, not used in
  // ordering or invariants.
  await db.runAsync(
    `INSERT OR REPLACE INTO thread_articles
       (thread_id, title, subtitle, intro, cover_photo_uri, template,
        hidden_bead_ids, bead_overrides, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(
       (SELECT created_at FROM thread_articles WHERE thread_id = ?),
       datetime('now')
     ), datetime('now'))`,
    [
      threadId, title, subtitle, intro, coverUri, template,
      hiddenJson, overridesJson, threadId,
    ]
  );
}

// Load the full composed-article view: thread metadata, ordered beads,
// linked entries, photos. The article is created lazily: callers that
// just want to preview can pass through with the default.
export async function getArticleData(threadId) {
  if (threadId == null) return null;
  const db = getDb();
  if (!db) return null;

  const thread = await db.getFirstAsync('SELECT * FROM threads WHERE id = ?', [
    threadId,
  ]);
  if (!thread) return null;

  const article = (await loadArticle(threadId)) || defaultArticleFor(thread);

  const beads = await db.getAllAsync(
    `SELECT * FROM thread_beads
       WHERE thread_id = ?
       ORDER BY position ASC`,
    [threadId]
  );

  // Load all referenced entries + photos in batch.
  const entryIds = beads
    .map((b) => b.entry_id)
    .filter((id) => id != null);
  const uniqueEntryIds = Array.from(new Set(entryIds));

  let entriesById = {};
  let photosByEntry = {};
  let voiceByEntry = {};
  if (uniqueEntryIds.length > 0) {
    const placeholders = uniqueEntryIds.map(() => '?').join(',');
    const entryRows = await db.getAllAsync(
      `SELECT * FROM entries WHERE id IN (${placeholders})`,
      uniqueEntryIds
    );
    entriesById = Object.fromEntries(entryRows.map((r) => [r.id, r]));
    const photoRows = await db.getAllAsync(
      `SELECT entry_id, uri FROM entry_photos WHERE entry_id IN (${placeholders}) ORDER BY id ASC`,
      uniqueEntryIds
    );
    for (const p of photoRows) {
      if (!photosByEntry[p.entry_id]) photosByEntry[p.entry_id] = [];
      photosByEntry[p.entry_id].push(p.uri);
    }
    // Voice notes travel in the Markdown/Org zips (referenced by the
    // .md, bytes copied into assets/). Same id-order as the Org export.
    const voiceRows = await db.getAllAsync(
      `SELECT entry_id, uri, duration FROM entry_voice_notes WHERE entry_id IN (${placeholders}) ORDER BY entry_id ASC, id ASC`,
      uniqueEntryIds
    );
    for (const v of voiceRows) {
      if (!voiceByEntry[v.entry_id]) voiceByEntry[v.entry_id] = [];
      voiceByEntry[v.entry_id].push({ uri: v.uri, duration: v.duration });
    }
  }

  const hiddenSet = new Set(
    (article.hidden_bead_ids || []).map((n) => Number(n))
  );

  // Batch-load comments for every referenced entry, plus the thread itself.
  // We always load these (cheap query) so callers/renderers can decide
  // whether to include them based on template choice.
  let commentsByEntry = {};
  if (uniqueEntryIds.length > 0) {
    const placeholders = uniqueEntryIds.map(() => '?').join(',');
    const commentRows = await db.getAllAsync(
      `SELECT id, parent_id, body, created_at, resolved_at
         FROM comments
        WHERE parent_kind = ? AND parent_id IN (${placeholders})
        ORDER BY parent_id, created_at ASC, id ASC`,
      [PARENT_ENTRY, ...uniqueEntryIds]
    );
    for (const c of commentRows) {
      if (!commentsByEntry[c.parent_id]) commentsByEntry[c.parent_id] = [];
      commentsByEntry[c.parent_id].push(c);
    }
  }
  const threadComments = await db.getAllAsync(
    `SELECT id, body, created_at, resolved_at
       FROM comments
      WHERE parent_kind = ? AND parent_id = ?
      ORDER BY created_at ASC, id ASC`,
    [PARENT_THREAD, threadId]
  );

  const sections = beads.map((b) => {
    const override = article.bead_overrides[String(b.id)] || {};
    const entry = b.entry_id != null ? entriesById[b.entry_id] || null : null;
    const photos = b.entry_id != null ? photosByEntry[b.entry_id] || [] : [];
    const voice = b.entry_id != null ? voiceByEntry[b.entry_id] || [] : [];
    const comments = b.entry_id != null ? commentsByEntry[b.entry_id] || [] : [];
    // The frozen snapshot taken when the bead was strung onto the thread.
    const snapshot = {
      shape: b.snapshot_shape,
      pattern: b.snapshot_pattern,
      mood: b.snapshot_mood,
      glyph: b.snapshot_glyph || '',
    };
    // `bead` follows the in-app `thread_beads` render rule (see
    // docs/architecture/beads-and-threads.md): show the LIVE entry bead
    // while the entry exists and carries one, the snapshot only as the
    // orphan/removed fallback. Rendering the snapshot unconditionally is
    // why an edited bead showed its OLD shape in "Customize layout" and
    // in the exported chain banners. The raw `snapshot` stays available
    // for any consumer that explicitly wants the frozen value.
    const live =
      entry && entry.bead_shape
        ? {
            shape: entry.bead_shape,
            pattern: entry.bead_pattern,
            mood: entry.bead_mood,
            glyph: entry.bead_glyph || '',
          }
        : null;
    return {
      beadId: b.id,
      position: b.position,
      // Per-membership chapter label (drives section dividers in the
      // slide deck; harmless to consumers that ignore it). The query
      // already SELECT *s thread_beads, so this is free.
      sectionLabel: b.section_label || '',
      bead: live || snapshot,
      snapshot,
      entry,
      photos,
      voice,
      comments,
      hidden: hiddenSet.has(b.id),
      titleOverride: typeof override.title === 'string' ? override.title : '',
      leadOverride: typeof override.lead === 'string' ? override.lead : '',
    };
  });

  // Gather every photo URI referenced by the article (cover + every
  // included section). Callers that need base64 versions use this.
  const allPhotoUris = new Set();
  if (article.cover_photo_uri) allPhotoUris.add(article.cover_photo_uri);
  for (const s of sections) {
    if (s.hidden) continue;
    for (const u of s.photos) allPhotoUris.add(u);
  }

  return {
    thread,
    article,
    sections,
    threadComments,
    photoUris: Array.from(allPhotoUris),
  };
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

// Absolute date+time for comments. The export is a static artifact:
// "3 hours ago" goes stale the moment the file is read later, so we burn
// in the wall-clock time the comment was written. Rendered in the
// device's local timezone (the data is UTC).
//
// Falls back to a hand-rolled format if `toLocaleString` with
// dateStyle/timeStyle isn't supported (older Hermes builds, etc.). We
// never want comment rendering to throw and bring down the entire export.
function formatCommentTime(createdAt) {
  if (!createdAt) return '';
  // SQLite default is space-separated; the JS ISO form is also valid input.
  const t = Date.parse(createdAt.replace(' ', 'T') + (createdAt.endsWith('Z') ? '' : 'Z'));
  if (Number.isNaN(t)) return createdAt;
  const d = new Date(t);
  try {
    const out = d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    if (out && typeof out === 'string') return out;
  } catch {
    // fall through to manual format
  }
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const h24 = d.getHours();
  const hours = h24 % 12 || 12;
  const ampm = h24 < 12 ? 'AM' : 'PM';
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${hours}:${mins} ${ampm}`;
}

// A resolved comment loop renders struck-through in Markdown (GFM
// `~~…~~`), mirroring the in-app drawer. Wrapped per non-empty line
// because GFM strikethrough cannot span a newline; open comments pass
// through verbatim.
function commentBodyMarkdown(c) {
  const body = c.body || '';
  if (!c.resolved_at) return body;
  return body
    .split('\n')
    .map((ln) => (ln.trim() ? `~~${ln}~~` : ln))
    .join('\n');
}

function sectionTitleOf(s) {
  return (
    (s.titleOverride || '').trim() ||
    (s.entry?.title || '').trim() ||
    'Section'
  );
}

// `<NN>-<slug>.md`: the zero-padded 1-based position keeps the per-bead
// files ordered in any file browser, and the index links to exactly
// these names (same `visible` array, same order, so they can't drift).
function sectionFileName(i, s) {
  return `${String(i + 1).padStart(2, '0')}-${slugify(sectionTitleOf(s)) || 'section'}.md`;
}

// Frontmatter + title + chain + subtitle/intro + thread-level comments.
// Shared by the single-file article and the multi-file `index.md` so the
// two modes present the thread identically above the fold.
function appendArticleHead(lines, { thread, article, visible, includeComments, threadComments }) {
  const title = (article.title || thread.name || 'Untitled article').trim();
  lines.push('---');
  lines.push(`title: ${escapeYamlString(title)}`);
  if (article.subtitle) lines.push(`subtitle: ${escapeYamlString(article.subtitle)}`);
  if (thread.created_at) lines.push(`thread_created_at: ${escapeYamlString(thread.created_at)}`);
  lines.push(`template: ${escapeYamlString(article.template)}`);
  lines.push(`section_count: ${visible.length}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${title}`);
  if (article.subtitle) {
    lines.push('');
    lines.push(`> ${article.subtitle}`);
  }
  lines.push('');
  // The bead chain travels as the article's visual signature (parity
  // with the HTML/PDF banner and the Org chain.svg). Bytes are written
  // by buildThreadMarkdownZip; we only link them.
  if (visible.length > 0) {
    lines.push('![Bead chain](assets/chain.svg)');
    lines.push('');
  }
  if ((article.intro || '').trim()) {
    lines.push(article.intro.trim());
    lines.push('');
  }
  if (includeComments && threadComments.length > 0) {
    lines.push('### Reflections on this thread');
    lines.push('');
    for (const c of threadComments) {
      const t = formatCommentTime(c.created_at);
      lines.push(`> ${commentBodyMarkdown(c).replace(/\n/g, '\n> ')}`);
      const meta = [t, c.resolved_at ? 'resolved' : null].filter(Boolean).join(' · ');
      if (meta) lines.push(`> *${meta}*`);
      lines.push('');
    }
  }
}

// One section's body: heading (level 2 in the single-file article, 1 in
// a standalone per-bead file), date, lead, content, photos, voice,
// comments. Asset links use the shared name helpers, so they always
// match the bytes buildThreadMarkdownZip writes. Single- and
// multi-file modes are byte-identical per section.
function appendSectionBody(lines, s, { headingLevel, includeComments }) {
  lines.push(`${'#'.repeat(headingLevel)} ${sectionTitleOf(s)}`);
  if (s.entry?.date) {
    lines.push('');
    lines.push(`*${formatDateTime(s.entry.date, s.entry.time)}*`);
  }
  if ((s.leadOverride || '').trim()) {
    lines.push('');
    lines.push(s.leadOverride.trim());
  }
  if ((s.entry?.content || '').trim()) {
    lines.push('');
    lines.push(s.entry.content.trim());
  }
  if (s.entry && s.photos.length > 0) {
    lines.push('');
    s.photos.forEach((p, i) => {
      lines.push(
        `![${basenameOf(p)}](assets/${photoAssetName(s.entry.id, i)})`
      );
    });
  }
  if (s.entry && (s.voice?.length || 0) > 0) {
    lines.push('');
    s.voice.forEach((v, i) => {
      lines.push(
        `🎙️ [Voice note · ${clockFromMs(v.duration)}](assets/${voiceAssetName(s.entry.id, i, v.uri)})`
      );
    });
  }
  if (includeComments && (s.comments?.length || 0) > 0) {
    lines.push('');
    lines.push(`*${s.comments.length} comment${s.comments.length === 1 ? '' : 's'}:*`);
    for (const c of s.comments) {
      const t = formatCommentTime(c.created_at);
      lines.push('');
      lines.push(`> ${commentBodyMarkdown(c).replace(/\n/g, '\n> ')}`);
      const meta = [t, c.resolved_at ? 'resolved' : null].filter(Boolean).join(' · ');
      if (meta) lines.push(`> *${meta}*`);
    }
  }
}

// Single-file article: head + every visible section inline (H2).
export function renderMarkdown({ thread, article, sections, threadComments = [] }) {
  const visible = sections.filter((s) => !s.hidden);
  const includeComments = TEMPLATES_WITH_COMMENTS.has(article.template);
  const lines = [];
  appendArticleHead(lines, { thread, article, visible, includeComments, threadComments });
  for (const s of visible) {
    appendSectionBody(lines, s, { headingLevel: 2, includeComments });
    lines.push('');
  }
  return lines.join('\n');
}

// Multi-file mode: `index.md`. The same head, then a linked contents
// list pointing at the per-bead files (no section bodies here).
export function renderMarkdownIndex({ thread, article, sections, threadComments = [] }) {
  const visible = sections.filter((s) => !s.hidden);
  const includeComments = TEMPLATES_WITH_COMMENTS.has(article.template);
  const lines = [];
  appendArticleHead(lines, { thread, article, visible, includeComments, threadComments });
  lines.push('## Contents');
  lines.push('');
  visible.forEach((s, i) => {
    const date = s.entry?.date ? ` · *${formatDateTime(s.entry.date, s.entry.time)}*` : '';
    lines.push(`${i + 1}. [${sectionTitleOf(s)}](${sectionFileName(i, s)})${date}`);
  });
  lines.push('');
  return lines.join('\n');
}

// Multi-file mode: one standalone `.md` per bead. Own frontmatter, the
// section body at H1, and a backlink to the index.
export function renderMarkdownSectionFile({ thread, article }, s, i) {
  const includeComments = TEMPLATES_WITH_COMMENTS.has(article.template);
  const lines = [];
  lines.push('---');
  lines.push(`title: ${escapeYamlString(sectionTitleOf(s))}`);
  if (s.entry?.date) lines.push(`date: ${escapeYamlString(s.entry.date)}`);
  if (s.entry?.time) lines.push(`time: ${escapeYamlString(s.entry.time)}`);
  lines.push(`thread: ${escapeYamlString((article.title || thread.name || '').trim())}`);
  lines.push(`position: ${i + 1}`);
  lines.push('---');
  lines.push('');
  appendSectionBody(lines, s, { headingLevel: 1, includeComments });
  lines.push('');
  lines.push('---');
  lines.push('[← Back to index](index.md)');
  return lines.join('\n');
}

// CSS per template, kept inline so the resulting HTML is fully
// self-contained. System font stacks only (no external font loads) so the
// file works offline.
function cssForTemplate(template) {
  const common = `
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { -webkit-font-smoothing: antialiased; }
    img { max-width: 100%; height: auto; display: block; margin: 1.5em auto; border-radius: 4px; }
    /* PDF pagination: tell the print layout not to split these mid-element.
     * Without this, a photo (or a polaroid/post-card) can be sliced across
     * two pages (half on page N, half on page N+1), which looks broken. */
    img, figure, .cover, .polaroid, .post, .post-photos, .filmstrip, .mini-polaroid, section {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    blockquote { margin: 1.2em 0; padding: 0.4em 1em; border-left: 3px solid; }
    hr { border: none; border-top: 1px solid; margin: 2.5em 0; }
    .chain-banner { width: 100%; max-width: 100%; overflow: hidden; }
    .chain-banner svg { display: block; width: 100%; height: auto; max-height: 60px; }
    .cover { width: 100%; max-height: 360px; object-fit: cover; }
    .section-date { font-size: 0.85em; opacity: 0.6; font-style: italic; margin-top: -0.4em; }
    .lead { font-style: italic; opacity: 0.85; }
    pre, code { font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace; font-size: 0.92em; }
    pre { background: rgba(0,0,0,0.04); padding: 12px; border-radius: 6px; overflow: auto; }
    code { background: rgba(0,0,0,0.05); padding: 1px 5px; border-radius: 3px; }
    pre code { background: transparent; padding: 0; }
    a { color: inherit; }
  `;

  if (template === 'journal') {
    return common + `
      body {
        background: #f5ead5;
        color: #3a2a05;
        font-family: 'Iowan Old Style', Charter, Georgia, 'Times New Roman', serif;
        font-size: 17px;
        line-height: 1.65;
      }
      .wrap { max-width: 680px; margin: 0 auto; padding: 32px 24px 80px; }
      h1.article-title {
        font-family: 'Caveat', 'Brush Script MT', 'Bradley Hand', cursive;
        font-weight: 700;
        font-size: 3em;
        line-height: 1.1;
        margin: 0.4em 0 0.1em;
        color: #2a1d04;
      }
      .subtitle { font-style: italic; font-size: 1.15em; color: #6a4f1a; margin: 0 0 1.5em; }
      h2 { font-size: 1.5em; margin: 2em 0 0.4em; color: #2a1d04; border-bottom: 1px dashed rgba(58,42,5,0.18); padding-bottom: 0.2em; }
      blockquote { border-left-color: #b89248; background: rgba(232,185,79,0.12); }
      hr { border-top-color: rgba(58,42,5,0.18); }
      .chain-banner { padding: 16px 0 8px; }
    `;
  }

  if (template === 'minimal') {
    return common + `
      body {
        background: #ffffff;
        color: #1a1a1a;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
        font-size: 16px;
        line-height: 1.55;
      }
      .wrap { max-width: 600px; margin: 0 auto; padding: 40px 20px 80px; }
      h1.article-title { font-weight: 600; font-size: 2em; line-height: 1.15; letter-spacing: -0.02em; margin: 0.6em 0 0.2em; }
      .subtitle { font-size: 1.05em; color: #555; margin: 0 0 1.8em; }
      h2 { font-weight: 600; font-size: 1.25em; margin: 2.2em 0 0.4em; letter-spacing: -0.01em; }
      blockquote { border-left-color: #888; color: #444; }
      hr { border-top-color: #e5e5e5; }
    `;
  }

  if (template === 'storyboard') {
    return common + `
      body {
        background: #efe7d6;
        color: #2a1f10;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
        font-size: 16px;
        line-height: 1.55;
      }
      .wrap { max-width: 560px; margin: 0 auto; padding: 24px 16px 80px; }
      h1.article-title { font-weight: 700; font-size: 1.9em; line-height: 1.15; margin: 0.2em 0 0.1em; letter-spacing: -0.01em; color: #2a1d04; }
      .subtitle { font-size: 1em; color: #6a4f1a; margin: 0 0 1.2em; }
      .chain-banner { padding: 8px 0 16px; }
      img { margin: 0; border-radius: 0; }
      hr { display: none; }

      /* Each "post" is a card in the feed. */
      .post {
        background: #fdfcf8;
        border-radius: 14px;
        margin: 0 0 16px;
        overflow: hidden;
        box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
      }
      .post.pinned {
        background: #fff7e3;
        border: 1px solid rgba(184,146,72,0.35);
      }
      .post-head {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 14px 8px;
      }
      .avatar {
        width: 38px;
        height: 38px;
        border-radius: 19px;
        background: #d8c6a5;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        overflow: hidden;
      }
      .avatar svg { width: 28px; height: 28px; display: block; }
      .post-byline { flex: 1; min-width: 0; }
      .post-author { font-weight: 600; font-size: 0.95em; line-height: 1.2; color: #2a1d04; }
      .post-meta { font-size: 0.78em; color: #8a7a5a; margin-top: 2px; }
      .pin-badge {
        font-size: 0.7em;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #b89248;
        background: rgba(184,146,72,0.14);
        padding: 3px 8px;
        border-radius: 10px;
      }
      .post-title { font-weight: 700; font-size: 1.15em; margin: 0 14px 6px; color: #2a1d04; }
      .post-body { padding: 0 14px 12px; font-size: 0.95em; color: #2a1f10; }
      .post-body p { margin: 0 0 0.7em; }
      .post-body p:last-child { margin-bottom: 0; }
      .post-photos { display: flex; flex-direction: column; gap: 1px; background: #d8c6a5; }
      .post-photos img { width: 100%; max-height: 480px; object-fit: cover; border-radius: 0; }

      /* Comment replies stack below each post, iMessage style. */
      .replies {
        padding: 6px 14px 14px;
        border-top: 1px solid rgba(58,42,5,0.08);
        margin-top: 4px;
      }
      .replies-label {
        font-size: 0.72em;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #8a7a5a;
        margin: 6px 0 8px;
      }
      .reply {
        display: flex;
        gap: 8px;
        margin-bottom: 8px;
      }
      .reply:last-child { margin-bottom: 0; }
      .reply-avatar {
        width: 22px;
        height: 22px;
        border-radius: 11px;
        background: #d8c6a5;
        flex-shrink: 0;
        margin-top: 4px;
      }
      .reply-bubble {
        flex: 1;
        background: #f5ead5;
        border-left: 3px solid var(--bead-accent, #b89248);
        border-radius: 12px;
        padding: 8px 12px;
        font-size: 0.9em;
        line-height: 1.45;
        color: #2a1f10;
      }
      .reply-body { white-space: pre-wrap; }
      .reply.resolved .reply-body { text-decoration: line-through; opacity: 0.55; }
      .reply-time { font-size: 0.75em; color: #8a7a5a; margin-top: 4px; }
    `;
  }

  if (template === 'postcard') {
    return common + `
      body {
        background:
          radial-gradient(circle at 20% 0%, rgba(184,146,72,0.10) 0%, transparent 50%),
          radial-gradient(circle at 80% 100%, rgba(58,42,5,0.06) 0%, transparent 50%),
          #f3ead2;
        color: #2a1f10;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
        font-size: 16px;
        line-height: 1.6;
      }
      .wrap { max-width: 700px; margin: 0 auto; padding: 32px 20px 80px; }
      h1.article-title {
        font-family: 'Caveat', 'Bradley Hand', 'Marker Felt', cursive;
        font-weight: 700;
        font-size: 3em;
        line-height: 1.05;
        margin: 0.2em 0 0.05em;
        color: #2a1d04;
        transform: rotate(-1deg);
      }
      .subtitle {
        font-family: 'Caveat', 'Bradley Hand', cursive;
        font-size: 1.5em;
        color: #6a4f1a;
        margin: 0 0 1.5em;
        transform: rotate(0.5deg);
      }
      .chain-banner { padding: 12px 0 4px; opacity: 0.7; }
      img { margin: 0; border-radius: 0; }
      hr { display: none; }

      .thread-intro {
        background: #fffdf6;
        padding: 18px 22px;
        margin: 0 auto 28px;
        max-width: 480px;
        box-shadow: 0 2px 6px rgba(0,0,0,0.08);
        transform: rotate(-0.6deg);
        border: 1px solid rgba(184,146,72,0.2);
      }
      .thread-intro p { margin: 0 0 0.6em; }
      .thread-intro p:last-child { margin: 0; }

      .polaroid {
        background: #fffdf6;
        padding: 14px 14px 56px;
        margin: 0 auto 36px;
        max-width: 460px;
        box-shadow: 0 4px 10px rgba(0,0,0,0.12), 0 2px 3px rgba(0,0,0,0.06);
        position: relative;
      }
      .polaroid:nth-of-type(odd)  { transform: rotate(-1.4deg); }
      .polaroid:nth-of-type(even) { transform: rotate(1.2deg); }

      /* Faux washi-tape on the top edge. */
      .polaroid::before {
        content: '';
        position: absolute;
        top: -8px;
        left: 50%;
        transform: translateX(-50%) rotate(-3deg);
        width: 88px;
        height: 18px;
        background: rgba(232,185,79,0.45);
        border-left: 1px dashed rgba(232,185,79,0.55);
        border-right: 1px dashed rgba(232,185,79,0.55);
      }

      .polaroid-photo {
        width: 100%;
        aspect-ratio: 4 / 3;
        background: #2a1d04;
        overflow: hidden;
        margin-bottom: 14px;
      }
      .polaroid-photo img { width: 100%; height: 100%; object-fit: cover; }
      .polaroid-photo.no-photo {
        display: flex;
        align-items: center;
        justify-content: center;
        background: #efe1bd;
      }
      .polaroid-photo.no-photo svg { width: 64px; height: 64px; opacity: 0.85; }

      .polaroid-caption {
        font-family: 'Caveat', 'Bradley Hand', 'Marker Felt', cursive;
        font-size: 1.5em;
        line-height: 1.2;
        color: #2a1d04;
        margin: 0 0 6px;
      }
      .polaroid-date {
        font-family: 'Caveat', 'Bradley Hand', cursive;
        font-size: 1.05em;
        color: #8a6d2f;
        margin: 0 0 8px;
      }
      .polaroid-body {
        font-size: 0.95em;
        color: #3a2a05;
        margin: 0;
      }
      .polaroid-body p { margin: 0 0 0.5em; }
      .polaroid-body p:last-child { margin: 0; }

      /* Stacked polaroid: when the entry has >1 photo, two thin "card
       * edges" peek out from behind the main polaroid suggesting a stack.
       * Pure decoration: the actual additional photos are rendered in
       * the filmstrip below, so this works in PDF and HTML alike. */
      .polaroid.stack { z-index: 1; }
      .polaroid.stack::before,
      .polaroid.stack-deep::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: #fffdf6;
        box-shadow: 0 3px 8px rgba(0,0,0,0.10);
        border: 1px solid rgba(184,146,72,0.18);
        z-index: -1;
      }
      .polaroid.stack::before        { transform: rotate(-3deg) translate(-6px, 4px); }
      .polaroid.stack-deep::after    { transform: rotate(4deg)  translate(8px, 6px); }

      /* Filmstrip of additional photos when an entry has >1 photo. Each
       * mini-polaroid is a smaller scrapbook snapshot, slightly tilted
       * (alternating). All photos stay visible without needing JS. */
      .filmstrip {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        justify-content: center;
        max-width: 460px;
        margin: -24px auto 32px;
        padding: 0 8px;
      }
      .mini-polaroid {
        background: #fffdf6;
        padding: 6px 6px 14px;
        box-shadow: 0 2px 5px rgba(0,0,0,0.10);
        width: 96px;
      }
      .mini-polaroid:nth-of-type(odd)  { transform: rotate(-2deg); }
      .mini-polaroid:nth-of-type(even) { transform: rotate(2.5deg); }
      .mini-polaroid:nth-of-type(3n)   { transform: rotate(-1deg); }
      .mini-polaroid img {
        width: 100%;
        aspect-ratio: 1 / 1;
        object-fit: cover;
        display: block;
        margin: 0;
        border-radius: 0;
      }

      /* Sticky-note style comments. */
      .sticky-notes {
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-width: 460px;
        margin: -16px auto 40px;
      }
      .sticky {
        padding: 12px 14px 14px;
        font-family: 'Caveat', 'Bradley Hand', cursive;
        font-size: 1.2em;
        line-height: 1.3;
        color: #2a1d04;
        background: #ffeaa6;
        box-shadow: 0 2px 4px rgba(0,0,0,0.10);
        position: relative;
      }
      .sticky:nth-of-type(odd)  { transform: rotate(-0.8deg) translateX(8px); }
      .sticky:nth-of-type(even) { transform: rotate(1deg) translateX(-8px); }
      .sticky:nth-of-type(3n)   { background: #ffd6b3; }
      .sticky:nth-of-type(3n+1) { background: #d8edd0; }
      .sticky::before {
        content: '';
        position: absolute;
        top: -5px;
        left: 50%;
        transform: translateX(-50%) rotate(2deg);
        width: 36px;
        height: 10px;
        background: rgba(184,146,72,0.55);
      }
      .sticky-body { white-space: pre-wrap; }
      .sticky.resolved .sticky-body { text-decoration: line-through; opacity: 0.6; }
      .sticky-time {
        display: block;
        margin-top: 6px;
        font-size: 0.7em;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        color: #6a4f1a;
        letter-spacing: 0.03em;
      }
    `;
  }

  // editorial (default)
  return common + `
    body {
      background: #fdfcf8;
      color: #222;
      font-family: 'Iowan Old Style', Charter, Georgia, 'Times New Roman', serif;
      font-size: 18px;
      line-height: 1.7;
    }
    .wrap { max-width: 720px; margin: 0 auto; padding: 48px 32px 80px; }
    h1.article-title { font-weight: 700; font-size: 2.6em; line-height: 1.1; margin: 0.6em 0 0.2em; letter-spacing: -0.015em; }
    .subtitle { font-style: italic; font-size: 1.2em; color: #555; margin: 0 0 2em; }
    h2 { font-weight: 700; font-size: 1.6em; margin: 2.5em 0 0.5em; letter-spacing: -0.01em; }
    blockquote { border-left-color: #888; color: #333; font-style: italic; }
    hr { border-top-color: #ddd; }
  `;
}

function threadColorForTemplate(template) {
  if (template === 'journal') return '#8a6d2f';
  if (template === 'minimal') return '#999999';
  if (template === 'storyboard') return '#b89248';
  if (template === 'postcard') return '#8a6d2f';
  return '#8a7355';
}

// A small inline SVG for a single bead, used as the avatar circle in the
// storyboard "post head." We reuse the same family of shapes the bead chain
// uses so the avatar feels consistent with the rest of the app, but render a
// simplified single-bead SVG inline to keep the file self-contained.
function beadAvatarSvg(bead, fallbackColor) {
  const fill = fallbackColor || '#b89248';
  const shape = bead?.shape || 'circle';
  const glyph = (bead?.glyph || '').slice(0, 2);
  // Generic round badge with the bead glyph inside. It works for all shapes
  // since we don't need full fidelity here.
  return `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
    <circle cx="14" cy="14" r="13" fill="${fill}" opacity="0.18"/>
    <circle cx="14" cy="14" r="9" fill="${fill}"/>
    ${glyph ? `<text x="14" y="18" text-anchor="middle" font-size="11" font-family="-apple-system, sans-serif" font-weight="600" fill="#fff">${escapeXml(glyph)}</text>` : ''}
    <title>${escapeXml(shape)}</title>
  </svg>`;
}

// Bead accents for storyboard's reply-bubble stripe. Cycles through a few
// warm palette colors so successive posts feel distinct without us needing
// real per-bead colors.
const STORYBOARD_ACCENTS = ['#b89248', '#8a6d2f', '#6a4f1a', '#c47a3a', '#9e5c2f'];
function accentForPosition(position) {
  const i = ((position % STORYBOARD_ACCENTS.length) + STORYBOARD_ACCENTS.length) % STORYBOARD_ACCENTS.length;
  return STORYBOARD_ACCENTS[i];
}

function renderRepliesHtml(comments, accent) {
  if (!comments || comments.length === 0) return '';
  const items = comments
    .map((c) => {
      const body = escapeXml((c.body || '').trim());
      const time = formatCommentTime(c.created_at);
      const meta = [time, c.resolved_at ? 'resolved' : null]
        .filter(Boolean)
        .join(' · ');
      return (
        `<div class="reply${c.resolved_at ? ' resolved' : ''}">` +
        `<div class="reply-avatar"></div>` +
        `<div class="reply-bubble" style="--bead-accent: ${accent}">` +
        `<div class="reply-body">${body}</div>` +
        (meta ? `<div class="reply-time">${escapeXml(meta)}</div>` : '') +
        `</div>` +
        `</div>`
      );
    })
    .join('');
  return (
    `<div class="replies">` +
    `<div class="replies-label">${comments.length} repl${comments.length === 1 ? 'y' : 'ies'}</div>` +
    items +
    `</div>`
  );
}

function renderStickyNotesHtml(comments) {
  if (!comments || comments.length === 0) return '';
  const items = comments
    .map((c) => {
      const body = escapeXml((c.body || '').trim());
      const time = formatCommentTime(c.created_at);
      const meta = [time, c.resolved_at ? 'resolved' : null]
        .filter(Boolean)
        .join(' · ');
      return (
        `<div class="sticky${c.resolved_at ? ' resolved' : ''}">` +
        `<div class="sticky-body">${body}</div>` +
        (meta ? `<span class="sticky-time">${escapeXml(meta)}</span>` : '') +
        `</div>`
      );
    })
    .join('');
  return `<div class="sticky-notes">${items}</div>`;
}

function renderStoryboardHtml({ thread, article, sections, threadComments, photosBase64, chainBanner, threadColor }) {
  const title = (article.title || thread.name || 'Untitled article').trim();
  const subtitle = (article.subtitle || '').trim();
  const intro = (article.intro || '').trim();
  const visible = sections.filter((s) => !s.hidden);

  const headerBlock =
    `<h1 class="article-title">${escapeXml(title)}</h1>` +
    (subtitle ? `<p class="subtitle">${escapeXml(subtitle)}</p>` : '');

  const pinnedPost =
    (intro || (threadComments && threadComments.length > 0))
      ? (
          `<article class="post pinned">` +
          `<div class="post-head">` +
          `<div class="avatar">${beadAvatarSvg({ shape: 'circle', glyph: '' }, threadColor)}</div>` +
          `<div class="post-byline">` +
          `<div class="post-author">${escapeXml(thread.name || 'Thread')}</div>` +
          `<div class="post-meta">${escapeXml(formatDate(thread.created_at?.slice(0, 10)) || '')}</div>` +
          `</div>` +
          `<div class="pin-badge">Pinned</div>` +
          `</div>` +
          (intro ? `<div class="post-body">${md.render(intro)}</div>` : '') +
          renderRepliesHtml(threadComments, threadColor) +
          `</article>`
        )
      : '';

  const postCards = visible
    .map((s) => {
      const sectionTitle =
        (s.titleOverride || '').trim() ||
        (s.entry?.title || '').trim() ||
        'Section';
      const date = s.entry?.date ? formatDateTime(s.entry.date, s.entry.time) : '';
      const lead = (s.leadOverride || '').trim();
      const body = (s.entry?.content || '').trim();
      const accent = accentForPosition(s.position);
      const photosHtml = s.photos.length > 0
        ? (
            `<div class="post-photos">` +
            s.photos
              .map((u) => {
                const data = photosBase64[u];
                if (!data) return '';
                return `<img src="${data}" alt="${escapeXml(basenameOf(u))}"/>`;
              })
              .join('') +
            `</div>`
          )
        : '';
      return (
        `<article class="post">` +
        `<div class="post-head">` +
        `<div class="avatar">${beadAvatarSvg(s.bead, accent)}</div>` +
        `<div class="post-byline">` +
        `<div class="post-author">${escapeXml(sectionTitle)}</div>` +
        (date ? `<div class="post-meta">${escapeXml(date)}</div>` : '') +
        `</div>` +
        `</div>` +
        (lead ? `<div class="post-title">${escapeXml(lead)}</div>` : '') +
        photosHtml +
        (body ? `<div class="post-body">${md.render(body)}</div>` : '') +
        renderRepliesHtml(s.comments, accent) +
        `</article>`
      );
    })
    .join('');

  return chainBanner + headerBlock + pinnedPost + postCards;
}

function renderPostcardHtml({ thread, article, sections, threadComments, photosBase64, chainBanner }) {
  const title = (article.title || thread.name || 'Untitled article').trim();
  const subtitle = (article.subtitle || '').trim();
  const intro = (article.intro || '').trim();
  const visible = sections.filter((s) => !s.hidden);

  const headerBlock =
    `<h1 class="article-title">${escapeXml(title)}</h1>` +
    (subtitle ? `<p class="subtitle">${escapeXml(subtitle)}</p>` : '');

  const introBlock =
    intro || (threadComments && threadComments.length > 0)
      ? (
          (intro ? `<div class="thread-intro">${md.render(intro)}</div>` : '') +
          renderStickyNotesHtml(threadComments)
        )
      : '';

  const polaroids = visible
    .map((s) => {
      const sectionTitle =
        (s.titleOverride || '').trim() ||
        (s.entry?.title || '').trim() ||
        'Section';
      const date = s.entry?.date ? formatDateTime(s.entry.date, s.entry.time) : '';
      const body = (s.entry?.content || '').trim();
      const photos = s.photos.filter((u) => !!photosBase64[u]);
      const firstPhoto = photos[0];
      const extraPhotos = photos.slice(1);

      const photoHtml = firstPhoto
        ? `<div class="polaroid-photo"><img src="${photosBase64[firstPhoto]}" alt="${escapeXml(basenameOf(firstPhoto))}"/></div>`
        : `<div class="polaroid-photo no-photo">${beadAvatarSvg(s.bead, '#b89248')}</div>`;

      // When the entry has >1 photo, mark the main polaroid as "stacked"
      // so two faint card edges peek out behind it (decorative depth cue)
      // and render the remaining photos as a small filmstrip of mini
      // polaroids below. Every photo stays visible without relying on
      // interactivity. The class also adapts the visual when there are 1
      // vs 2+ extras (only render :after when there are 3+ photos total).
      const stackClass =
        photos.length >= 3
          ? 'polaroid stack stack-deep'
          : photos.length === 2
          ? 'polaroid stack'
          : 'polaroid';

      const filmstrip = extraPhotos.length > 0
        ? (
            `<div class="filmstrip">` +
            extraPhotos
              .map(
                (u) =>
                  `<div class="mini-polaroid"><img src="${photosBase64[u]}" alt="${escapeXml(basenameOf(u))}"/></div>`
              )
              .join('') +
            `</div>`
          )
        : '';

      return (
        `<div class="${stackClass}">` +
        photoHtml +
        `<div class="polaroid-caption">${escapeXml(sectionTitle)}</div>` +
        (date ? `<div class="polaroid-date">${escapeXml(date)}</div>` : '') +
        (body ? `<div class="polaroid-body">${md.render(body)}</div>` : '') +
        `</div>` +
        filmstrip +
        renderStickyNotesHtml(s.comments)
      );
    })
    .join('');

  return chainBanner + headerBlock + introBlock + polaroids;
}

// Render the article to a self-contained HTML string. `photosBase64` is a
// map { uri -> 'data:image/...;base64,...' } produced by getArticlePhotoMap.
// Missing entries fall through to the raw URI (which renders as a broken
// link in the standalone HTML, but works inside the app's WebView if any).
export function renderHtml({ thread, article, sections, threadComments = [], photosBase64 = {} }) {
  const visible = sections.filter((s) => !s.hidden);
  const title = (article.title || thread.name || 'Untitled article').trim();
  const template = article.template;
  const css = cssForTemplate(template);
  const threadColor = threadColorForTemplate(template);

  const beadList = visible.map((s) => s.bead);
  // Postcard hides the chain banner: it would clash with the scrapbook
  // aesthetic. Other templates keep it.
  const chainBanner =
    template !== 'postcard' && beadList.length > 0
      ? `<div class="chain-banner">${chainSvgString(beadList, { size: 36, gap: 6, padding: 14, threadColor })}</div>`
      : '';

  let bodyInner;
  if (template === 'storyboard') {
    bodyInner = renderStoryboardHtml({
      thread, article, sections, threadComments, photosBase64, chainBanner, threadColor,
    });
  } else if (template === 'postcard') {
    bodyInner = renderPostcardHtml({
      thread, article, sections, threadComments, photosBase64, chainBanner,
    });
  } else {
    // Editorial / journal / minimal: original long-form layout.
    const subtitle = (article.subtitle || '').trim();
    const intro = (article.intro || '').trim();
    const coverUri = article.cover_photo_uri;
    const coverData = coverUri ? photosBase64[coverUri] : null;
    const coverHtml = coverData
      ? `<img class="cover" src="${coverData}" alt="Cover photo"/>`
      : '';
    const titleHtml = `<h1 class="article-title">${escapeXml(title)}</h1>`;
    const subtitleHtml = subtitle ? `<p class="subtitle">${escapeXml(subtitle)}</p>` : '';
    const introHtml = intro ? md.render(intro) : '';

    const sectionHtml = visible
      .map((s) => {
        const sectionTitle =
          (s.titleOverride || '').trim() ||
          (s.entry?.title || '').trim() ||
          'Section';
        const date = s.entry?.date ? formatDateTime(s.entry.date, s.entry.time) : '';
        const lead = (s.leadOverride || '').trim();
        const body = (s.entry?.content || '').trim();
        const photos = s.photos
          .map((u) => {
            const data = photosBase64[u];
            if (!data) return '';
            return `<img src="${data}" alt="${escapeXml(basenameOf(u))}"/>`;
          })
          .join('');
        return (
          `<section>` +
          (s.hideTitle ? '' : `<h2>${escapeXml(sectionTitle)}</h2>`) +
          (date ? `<p class="section-date">${escapeXml(date)}</p>` : '') +
          (lead ? `<div class="lead">${md.render(lead)}</div>` : '') +
          (body ? md.render(body) : '') +
          photos +
          `</section>`
        );
      })
      .join('<hr/>');

    bodyInner = `${chainBanner}\n${coverHtml}\n${titleHtml}\n${subtitleHtml}\n${introHtml}\n${sectionHtml}`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeXml(title)}</title>
<style>${css}</style>
</head>
<body>
<div class="wrap">
${bodyInner}
</div>
</body>
</html>`;
}

// Per-role width budgets, with two modes:
//   - HTML: generous; the file is meant to be read on a phone/laptop screen
//     and has no size ceiling because we write it straight to disk.
//   - PDF: aggressive. Android's Print uses `WebView.loadDataWithBaseURL`,
//     which has a hard size limit (around ~2 MB on many devices). When
//     exceeded, the WebView silently fails to load and Print captures an
//     empty page. So PDF mode trades photo crispness for fitting under
//     that ceiling no matter how many sections the thread has.
const PHOTO_BUDGETS = {
  html: { cover: 2000, main: 1600, extra: 500, quality: 0.85 },
  pdf:  { cover: 1200, main: 800,  extra: 300, quality: 0.70 },
};

// Walk the article data, assign each photo URI a role, and prep it at the
// width appropriate to that role + the export kind. Sequential rather than
// Promise.all so peak memory stays at one prepped photo's worth of base64,
// not N. The composer already shows a "Preparing PDF/HTML/MD…" overlay.
export async function buildPhotoBase64Map(data, kind = 'html') {
  const budget = PHOTO_BUDGETS[kind] || PHOTO_BUDGETS.html;
  const out = {};
  const seen = new Set();

  const cover = data.article?.cover_photo_uri || null;
  if (cover && !seen.has(cover)) {
    seen.add(cover);
    const r = await prepPhotoForExport(cover, budget.cover, budget.quality);
    if (r) out[cover] = r;
  }

  for (const s of data.sections) {
    if (s.hidden) continue;
    for (let i = 0; i < s.photos.length; i++) {
      const u = s.photos[i];
      if (seen.has(u)) continue;
      seen.add(u);
      const width = i === 0 ? budget.main : budget.extra;
      const r = await prepPhotoForExport(u, width, budget.quality);
      if (r) out[u] = r;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Top-level export-and-share entry points
// ---------------------------------------------------------------------------

async function shareFile(uri, mimeType, dialogTitle, UTI) {
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error('Sharing is not available on this device');
  }
  await Sharing.shareAsync(uri, { mimeType, dialogTitle, UTI });
}

function articleFilename(article, thread, ext) {
  const base =
    slugify(article.title) || slugify(thread.name) || `thread-${thread.id}`;
  return `${base}.${ext}`;
}

// Build a shareable cache artifact for HTML/PDF. Returns the cached uri,
// the suggested filename, and the share/save metadata (mimeType, UTI).
// HTML is written directly; PDF goes through expo-print so the cache uri
// is whatever expo-print produced. Markdown is a zip; see
// buildThreadMarkdownZip.
async function buildArticleArtifact(threadId, kind) {
  const data = await getArticleData(threadId);
  if (!data) throw new Error('Thread not found');

  if (kind === 'html') {
    const photosBase64 = await buildPhotoBase64Map(data, 'html');
    const html = renderHtml({ ...data, photosBase64 });
    const filename = articleFilename(data.article, data.thread, 'html');
    const uri = `${FileSystem.cacheDirectory}${filename}`;
    await FileSystem.writeAsStringAsync(uri, html, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    return { uri, filename, mimeType: 'text/html', UTI: 'public.html' };
  }

  if (kind === 'pdf') {
    const photosBase64 = await buildPhotoBase64Map(data, 'pdf');
    const html = renderHtml({ ...data, photosBase64 });
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    const filename = articleFilename(data.article, data.thread, 'pdf');
    return { uri, filename, mimeType: 'application/pdf', UTI: 'com.adobe.pdf' };
  }

  throw new Error(`Unknown export kind: ${kind}`);
}

// Markdown exports as a self-contained `.zip` (parity with the Org
// bridge): the `.md`(s) whose photo/voice links resolve into a sibling
// `assets/` folder, plus `assets/chain.svg` (the bead-chain signature).
// Drop the unzipped folder into Obsidian / a static-site repo and the
// media resolves with no rewriting. Sequential asset prep so peak
// memory stays at one prepped asset (same pattern as buildPhotoBase64Map
// and the Org zip). Returns the cache uri + a `missing[]` of any
// attachments evicted from disk (surfaced by ThreadExportSheet).
//
// `multiFile`: false → one `<slug>.md` with every section inline. true →
// `index.md` (thread head + a linked contents list) plus one
// `<NN>-<slug>.md` per bead. Either way the assets/ folder is shared and
// every `.md` links it with the same relative `assets/…` paths.
async function buildThreadMarkdownZip(threadId, { multiFile = false } = {}) {
  const data = await getArticleData(threadId);
  if (!data) throw new Error('Thread not found');

  // Zip/folder name follows the THREAD, not the article-composer title
  // (a presentation field). Consistent with the Org bridge and the slide
  // deck; the article title still drives the .md's H1/frontmatter.
  const slug =
    slugify(data.thread.name) ||
    slugify(data.article.title) ||
    `thread-${data.thread.id}`;

  const zip = new JSZip();
  const root = zip.folder(slug);

  const visible = data.sections.filter((s) => !s.hidden);

  if (multiFile) {
    root.file('index.md', renderMarkdownIndex(data));
    visible.forEach((s, i) => {
      root.file(sectionFileName(i, s), renderMarkdownSectionFile(data, s, i));
    });
  } else {
    root.file(`${slug}.md`, renderMarkdown(data));
  }

  const assets = root.folder('assets');
  const missing = [];

  const beadList = visible.map((s) => s.bead);
  if (beadList.length > 0) {
    assets.file(
      'chain.svg',
      chainSvgString(beadList, {
        size: 36,
        gap: 6,
        padding: 14,
        threadColor: threadColorForTemplate(data.article.template),
      })
    );
  }

  for (const s of visible) {
    if (!s.entry) continue;
    for (let i = 0; i < s.photos.length; i++) {
      const name = photoAssetName(s.entry.id, i);
      const b64 = await prepPhotoRawBase64(s.photos[i]);
      if (b64) assets.file(name, b64, { base64: true });
      else missing.push(name);
    }
    for (let i = 0; i < (s.voice?.length || 0); i++) {
      const v = s.voice[i];
      const name = voiceAssetName(s.entry.id, i, v.uri);
      const b64 = await readFileRawBase64(v.uri);
      if (b64) assets.file(name, b64, { base64: true });
      else missing.push(name);
    }
  }

  const zb64 = await zip.generateAsync({ type: 'base64' });
  const filename = `${slug}.zip`;
  const uri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, zb64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return {
    uri,
    filename,
    mimeType: 'application/zip',
    UTI: 'public.zip-archive',
    missing,
  };
}

// Save the artifact to the user's device storage.
// - Android: requests a folder via StorageAccessFramework, copies bytes
//   straight to the picked location. No share sheet involved.
// - iOS: SAF doesn't exist; route through the system share sheet, which
//   surfaces "Save to Files" as a top option. (User confirmed this UX path.)
async function persistArtifactToDevice({ uri, filename, mimeType, UTI }) {
  if (Platform.OS === 'android') {
    const perms = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!perms.granted) {
      throw new Error('Folder permission was denied');
    }
    const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
      perms.directoryUri,
      filename,
      mimeType
    );
    // Always base64-copy so binary formats (PDF) survive the round trip
    // and text formats stay byte-identical.
    const b64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await FileSystem.writeAsStringAsync(fileUri, b64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return fileUri;
  }

  await shareFile(uri, mimeType, 'Save article', UTI);
  return uri;
}

// Markdown ships as a zip (assets bundled), so (like the Org bridge)
// these return { uri, filename, missing } and ThreadExportSheet surfaces
// any skipped attachments. HTML/PDF stay single files and return a uri.
export async function exportArticleMarkdown(threadId, options = {}) {
  const a = await buildThreadMarkdownZip(threadId, options);
  await shareFile(a.uri, a.mimeType, 'Share thread as Markdown', a.UTI);
  return { uri: a.uri, filename: a.filename, missing: a.missing };
}

export async function exportArticleHtml(threadId) {
  const a = await buildArticleArtifact(threadId, 'html');
  await shareFile(a.uri, a.mimeType, 'Share article as HTML', a.UTI);
  return a.uri;
}

export async function exportArticlePdf(threadId) {
  const a = await buildArticleArtifact(threadId, 'pdf');
  await shareFile(a.uri, a.mimeType, 'Share article as PDF', a.UTI);
  return a.uri;
}

// One save-to-device entry point per format, symmetric with the share
// variants above. Returns the saved location (a SAF content:// uri on
// Android, the cached file uri on iOS after the user dismisses the share
// sheet).
export async function saveArticleMarkdownToDevice(threadId, options = {}) {
  const a = await buildThreadMarkdownZip(threadId, options);
  const savedUri = await persistArtifactToDevice(a);
  return { uri: savedUri, filename: a.filename, missing: a.missing };
}

export async function saveArticleHtmlToDevice(threadId) {
  const a = await buildArticleArtifact(threadId, 'html');
  return persistArtifactToDevice(a);
}

export async function saveArticlePdfToDevice(threadId) {
  const a = await buildArticleArtifact(threadId, 'pdf');
  return persistArtifactToDevice(a);
}
