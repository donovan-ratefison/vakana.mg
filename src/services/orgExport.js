// Org-mode export: exporting a thread as an Org `.zip`.
// Build contract: docs/architecture/org-export.md. One-way only; no
// transport, no sync, no import-back (spec §1 non-goals).
//
// This module is being built incrementally. Implemented: the bead SVG
// renderer (src/beads/svg.js), `markdownToOrg`, the raw-thread DB load
// (`getThreadExportData`), and the flat/datetree Org emitters
// (`emitOrgDocument`). Still scaffolded: the asset copier + JSZip
// assembly + share in `exportThreadOrg` (next commit).

import { Platform } from 'react-native';
import JSZip from 'jszip';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { getDb } from '../database/db';
import {
  SHAPE_GEOMETRY,
  MOODS,
  MOOD_BY_KEY,
  PATTERNS,
} from '../beads/types';
import { isPrivate, MASKED_TITLE } from '../utils/privacy';
import { renderBeadSvg, renderChainSvg } from '../beads/svg';
import appConfig from '../../app.json';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

// Reuse the app-wide slug rules (lowercase, alnum+hyphen, ≤60).
export function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

const ORG_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseLocalYMD(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// Org inactive timestamp for a YYYY-MM-DD date: [2026-05-12 Tue]. When an
// optional 'HH:MM' time is given, it's appended Org-style: [2026-05-12 Tue 14:30].
export function orgInactiveDate(ymd, time) {
  const d = parseLocalYMD(ymd);
  if (!d) return '';
  const hm = /^(\d{1,2}):(\d{2})$/.test(String(time || '')) ? ` ${time}` : '';
  return `[${ymd.slice(0, 10)} ${ORG_DOW[d.getDay()]}${hm}]`;
}

// Org timestamp from a JS ISO string (e.g. comments.remind_at). `active`
// → <…> (shows in agenda), else [...]. Includes HH:MM when present.
export function orgTimestamp(iso, active = false) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  const ymd = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const body = `${ymd} ${ORG_DOW[d.getDay()]} ${p(d.getHours())}:${p(d.getMinutes())}`;
  return active ? `<${body}>` : `[${body}]`;
}

// org-datetree heading lines for a date (spec §5.2). Returns
// { year, month, day } heading *text* (without leading stars).
export function datetreeHeadings(ymd) {
  const d = parseLocalYMD(ymd);
  if (!d) return null;
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const days = [
    'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
    'Saturday',
  ];
  const y = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return {
    year: `${y}`,
    month: `${y}-${mm} ${months[d.getMonth()]}`,
    day: `${y}-${mm}-${dd} ${days[d.getDay()]}`,
  };
}

// ---------------------------------------------------------------------------
// Markdown → Org transform (spec §7). Self-contained: the existing
// MarkdownInline.parseInline drops link URLs, so Org needs its own
// inline pass. `headingBaseLevel` = the bead/comment heading level + 1,
// so a body's own `#` headings nest *under* it and never break the
// outline or the datetree.
// ---------------------------------------------------------------------------

// Inline span conversion, scanned left→right with longest-opener-first
// so `**` beats `*` and code spans are atomic (no nested emphasis).
function inlineToOrg(text) {
  const s = String(text == null ? '' : text);
  let out = '';
  let i = 0;
  const n = s.length;
  const findClose = (open, from) => s.indexOf(open, from);
  while (i < n) {
    // inline code `x` → =x= (atomic)
    if (s[i] === '`') {
      const j = s.indexOf('`', i + 1);
      if (j > i) {
        out += `=${s.slice(i + 1, j)}=`;
        i = j + 1;
        continue;
      }
    }
    // image ![alt](url) → [[url]]
    if (s[i] === '!' && s[i + 1] === '[') {
      const m = /^!\[[^\]]*\]\(([^)]+)\)/.exec(s.slice(i));
      if (m) {
        out += `[[${m[1]}]]`;
        i += m[0].length;
        continue;
      }
    }
    // link [text](url) → [[url][text]]
    if (s[i] === '[') {
      const m = /^\[([^\]]+)\]\(([^)]+)\)/.exec(s.slice(i));
      if (m) {
        out += `[[${m[2]}][${m[1]}]]`;
        i += m[0].length;
        continue;
      }
    }
    // bold **x** / __x__ → *x*
    if (s.startsWith('**', i) || s.startsWith('__', i)) {
      const op = s.slice(i, i + 2);
      const j = findClose(op, i + 2);
      if (j > i + 1) {
        out += `*${inlineToOrg(s.slice(i + 2, j))}*`;
        i = j + 2;
        continue;
      }
    }
    // strike ~~x~~ → +x+
    if (s.startsWith('~~', i)) {
      const j = findClose('~~', i + 2);
      if (j > i + 1) {
        out += `+${inlineToOrg(s.slice(i + 2, j))}+`;
        i = j + 2;
        continue;
      }
    }
    // italic *x* / _x_ → /x/
    if (s[i] === '*' || s[i] === '_') {
      const ch = s[i];
      const j = s.indexOf(ch, i + 1);
      if (j > i + 1 && s[i + 1] !== ' ') {
        out += `/${inlineToOrg(s.slice(i + 1, j))}/`;
        i = j + 1;
        continue;
      }
    }
    out += s[i];
    i += 1;
  }
  return out;
}

export function markdownToOrg(md, headingBaseLevel = 1) {
  const src = String(md == null ? '' : md).replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  const out = [];
  let inFence = false;
  let ordered = 0;
  let inQuote = false;

  const closeQuote = () => {
    if (inQuote) {
      out.push('#+end_quote');
      inQuote = false;
    }
  };

  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li];

    // Fenced code: verbatim, no inline conversion.
    const fence = /^\s*(```|~~~)(\w*)\s*$/.exec(raw);
    if (fence) {
      if (!inFence) {
        closeQuote();
        out.push(fence[2] ? `#+begin_src ${fence[2]}` : '#+begin_example');
        inFence = fence[2] ? 'src' : 'example';
      } else {
        out.push(inFence === 'src' ? '#+end_src' : '#+end_example');
        inFence = false;
      }
      continue;
    }
    if (inFence) {
      out.push(raw);
      continue;
    }

    if (raw.trim() === '') {
      closeQuote();
      ordered = 0;
      out.push('');
      continue;
    }

    // Horizontal rule.
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(raw)) {
      closeQuote();
      ordered = 0;
      out.push('-----');
      continue;
    }

    // ATX heading → demoted so it nests under the entry heading.
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(raw);
    if (h) {
      closeQuote();
      ordered = 0;
      const stars = Math.max(1, headingBaseLevel + h[1].length);
      out.push(`${'*'.repeat(stars)} ${inlineToOrg(h[2])}`);
      continue;
    }

    // Blockquote.
    const q = /^\s{0,3}>\s?(.*)$/.exec(raw);
    if (q) {
      if (!inQuote) {
        out.push('#+begin_quote');
        inQuote = true;
      }
      out.push(inlineToOrg(q[1]));
      continue;
    }
    closeQuote();

    // Unordered list item.
    const ul = /^(\s*)[-*+]\s+(.*)$/.exec(raw);
    if (ul) {
      ordered = 0;
      out.push(`${ul[1]}- ${inlineToOrg(ul[2])}`);
      continue;
    }

    // Ordered list item: renumber from 1 (spec §7).
    const ol = /^(\s*)\d+\.\s+(.*)$/.exec(raw);
    if (ol) {
      ordered += 1;
      out.push(`${ol[1]}${ordered}. ${inlineToOrg(ol[2])}`);
      continue;
    }
    ordered = 0;

    // Plain text. Hard line break = two trailing spaces → Org `\\`.
    const hardBreak = /\S {2,}$/.test(raw);
    let textLine = inlineToOrg(raw.replace(/\s+$/, ''));
    // Escape a line Org would otherwise read as a heading/keyword.
    if (/^\*|^#\+/.test(textLine)) textLine = `,${textLine}`;
    out.push(hardBreak ? `${textLine} \\\\` : textLine);
  }
  closeQuote();
  if (inFence) out.push(inFence === 'src' ? '#+end_src' : '#+end_example');

  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Options / constants
// ---------------------------------------------------------------------------

// 2: dropped :BEAD_SHAPE_MEANING: (shapes carry no imposed meaning).
// 3: resolved comment → org DONE keyword + :VAKANA_RESOLVED_AT: property
//    (first TODO-state keyword the format emits; open comments stay
//    keyword-free so they never flood org-agenda as tasks).
export const ORG_EXPORT_SCHEMA = 3; // #+VAKANA_SCHEMA (spec §4)

export const DEFAULT_ORG_OPTIONS = Object.freeze({
  includePrivate: true, // spec §8
  includeVakanaEl: true, // spec §12: a toggle with a real home now
  includeLinkedThreads: false, // spec §9.2 (not honored yet: single thread)
  reproducible: false, // spec §10
});

// ---------------------------------------------------------------------------
// DB load (spec §2): the *raw* thread, NOT the article-filtered
// getArticleData() (thread_articles overrides/hidden are ignored, §1).
// ---------------------------------------------------------------------------

function inClause(ids) {
  return ids.map(() => '?').join(',');
}

/**
 * @returns {Promise<{
 *   thread, isAuto:boolean, collections:string[],
 *   beads: Array<{beadId,entryId,position,snapshot,sectionLabel,orphan,
 *     placeholder, entry:null|{title,content,date,createdAt,updatedAt,
 *     isPrivate,highlightTier}, photos:string[],
 *     voice:Array<{uri,duration}>, comments:object[],
 *     mentions:Array<{threadId,name}>}>,
 *   threadComments: object[] }>}
 */
export async function getThreadExportData(threadId) {
  const db = getDb();
  if (!db) throw new Error('getThreadExportData: database not ready');

  const thread = await db.getFirstAsync(
    'SELECT * FROM threads WHERE id = ?',
    [threadId]
  );
  if (!thread) throw new Error(`getThreadExportData: no thread ${threadId}`);
  const isAuto = String(thread.kind || '').startsWith('auto_');

  const collectionRows = await db.getAllAsync(
    `SELECT c.name AS name
       FROM thread_collections c
       JOIN thread_collection_links l ON l.collection_id = c.id
      WHERE l.thread_id = ?
      ORDER BY c.name COLLATE NOCASE ASC`,
    [threadId]
  );

  const beadRows = await db.getAllAsync(
    `SELECT tb.id AS bead_id, tb.entry_id, tb.position,
            tb.snapshot_shape, tb.snapshot_pattern, tb.snapshot_mood,
            tb.snapshot_glyph, tb.section_label,
            e.title AS e_title, e.content AS e_content, e.date AS e_date,
            e.time AS e_time,
            e.created_at AS e_created_at, e.updated_at AS e_updated_at,
            e.is_private AS e_is_private,
            e.highlight_tier AS e_highlight_tier,
            e.bead_shape AS e_bead_shape
       FROM thread_beads tb
       LEFT JOIN entries e ON e.id = tb.entry_id
      WHERE tb.thread_id = ?
      ORDER BY tb.position ASC, tb.id ASC`,
    [threadId]
  );

  const entryIds = [
    ...new Set(beadRows.filter((r) => r.entry_id != null).map((r) => r.entry_id)),
  ];

  const photosByEntry = {};
  const voiceByEntry = {};
  const commentsByEntry = {};
  const mentionsByEntry = {};
  if (entryIds.length) {
    const ph = inClause(entryIds);
    const photos = await db.getAllAsync(
      `SELECT entry_id, uri FROM entry_photos
        WHERE entry_id IN (${ph}) ORDER BY entry_id ASC, id ASC`,
      entryIds
    );
    for (const r of photos) (photosByEntry[r.entry_id] ||= []).push(r.uri);

    const voice = await db.getAllAsync(
      `SELECT entry_id, uri, duration FROM entry_voice_notes
        WHERE entry_id IN (${ph}) ORDER BY entry_id ASC, id ASC`,
      entryIds
    );
    for (const r of voice)
      (voiceByEntry[r.entry_id] ||= []).push({ uri: r.uri, duration: r.duration });

    const cmts = await db.getAllAsync(
      `SELECT * FROM comments
        WHERE parent_kind = 'entry' AND parent_id IN (${ph})
        ORDER BY parent_id ASC, datetime(created_at) ASC, id ASC`,
      entryIds
    );
    for (const c of cmts) (commentsByEntry[c.parent_id] ||= []).push(c);

    const mentions = await db.getAllAsync(
      `SELECT l.entry_id AS entry_id, t.id AS m_id, t.name AS m_name
         FROM entry_thread_links l
         JOIN threads t ON t.id = l.thread_id
        WHERE l.entry_id IN (${ph})
        ORDER BY l.entry_id ASC, l.position ASC, l.id ASC`,
      entryIds
    );
    for (const m of mentions)
      (mentionsByEntry[m.entry_id] ||= []).push({
        threadId: m.m_id,
        name: m.m_name,
      });
  }

  const threadComments = await db.getAllAsync(
    `SELECT * FROM comments
      WHERE parent_kind = 'thread' AND parent_id = ?
      ORDER BY datetime(created_at) ASC, id ASC`,
    [threadId]
  );

  const beads = beadRows.map((r) => {
    const orphan = r.entry_id == null;
    const entry = orphan
      ? null
      : {
          title: r.e_title,
          content: r.e_content,
          date: r.e_date,
          time: r.e_time,
          createdAt: r.e_created_at,
          updatedAt: r.e_updated_at,
          isPrivate: !!r.e_is_private,
          highlightTier: r.e_highlight_tier || 0,
        };
    return {
      beadId: r.bead_id,
      entryId: r.entry_id,
      position: r.position,
      snapshot: {
        shape: r.snapshot_shape,
        pattern: r.snapshot_pattern,
        mood: r.snapshot_mood,
        glyph: r.snapshot_glyph || '',
      },
      sectionLabel: r.section_label || null,
      orphan,
      // Placeholder = auto-thread bead whose entry carried no custom bead
      // (the snapshot is the weekday placeholder; spec §5.4).
      placeholder: isAuto && !orphan && !r.e_bead_shape,
      entry,
      photos: photosByEntry[r.entry_id] || [],
      voice: voiceByEntry[r.entry_id] || [],
      comments: commentsByEntry[r.entry_id] || [],
      mentions: mentionsByEntry[r.entry_id] || [],
    };
  });

  return {
    thread,
    isAuto,
    collections: collectionRows.map((c) => c.name),
    beads,
    threadComments,
  };
}

// ---------------------------------------------------------------------------
// Emitters (pure: data → Org string). Flat (§5.1) for user threads,
// org-datetree (§5.2) for auto-threads. Section labels group (§5.3).
// ---------------------------------------------------------------------------

const stars = (n) => '*'.repeat(Math.max(1, n));

function orgFromSql(sqlDatetime, active = false) {
  if (!sqlDatetime) return '';
  return orgTimestamp(`${String(sqlDatetime).replace(' ', 'T')}Z`, active);
}

function tagSuffix(tags) {
  return tags.length ? `  :${tags.join(':')}:` : '';
}

function uriExt(uri, fallback) {
  const m = /\.([A-Za-z0-9]+)(?:[?#]|$)/.exec(String(uri || ''));
  return m ? m[1].toLowerCase() : fallback;
}

function msToClock(ms) {
  const total = Math.round((Number(ms) || 0) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Org keyword/heading lines a body must not start with get a leading
// comma; labels/titles are plain: collapse newlines defensively.
const oneLine = (s) => String(s == null ? '' : s).replace(/\s*\n\s*/g, ' ').trim();

function emitComment(c, level) {
  const out = [];
  const pending = c.remind_at && !c.reminded_at;
  // A resolved comment is a *closed loop* → org's native DONE state (the
  // comment-scale sibling of a closed thread). Open comments emit no
  // keyword on purpose: most marginalia are not tasks, and a bare
  // `TODO Comment` on every one would drown org-agenda. Deterministic:
  // resolved_at is stored, never "now"-derived (spec §10, like reminded_at).
  const kw = c.resolved_at ? 'DONE ' : '';
  out.push(`${stars(level)} ${kw}Comment: ${orgTimestamp(c.created_at, false)}`);
  // Comment-reminder → org-agenda. Pending: SCHEDULED (deterministic;
  // see spec §6.5. We don't branch on "now" so reproducible stays
  // stable). Acknowledged: inactive ts via the property below.
  if (pending) out.push(`SCHEDULED: ${orgTimestamp(c.remind_at, true)}`);
  out.push(':PROPERTIES:');
  out.push(`:VAKANA_COMMENT_ID: ${c.id}`);
  if (c.edited_at) out.push(`:VAKANA_EDITED_AT: ${orgFromSql(c.edited_at)}`);
  if (c.remind_at && c.reminded_at)
    out.push(`:VAKANA_REMINDED_AT: ${orgFromSql(c.reminded_at)}`);
  if (c.resolved_at)
    out.push(`:VAKANA_RESOLVED_AT: ${orgFromSql(c.resolved_at)}`);
  out.push(':END:');
  const body = markdownToOrg(c.body, level + 1);
  if (body) out.push(body);
  return out.join('\n');
}

function emitBead(bead, level, thread, options) {
  const out = [];
  const tid = thread.id;
  const e = bead.entry;
  const priv = e ? isPrivate({ is_private: e.isPrivate ? 1 : 0 }) : false;
  const hidePrivate = priv && !options.includePrivate;

  let title;
  if (bead.orphan) title = '(removed entry)';
  else if (hidePrivate) title = MASKED_TITLE;
  else title = oneLine(e.title) || 'Untitled';

  const tags = [];
  if (e && e.highlightTier === 1) tags.push('tier1');
  if (e && e.highlightTier === 2) tags.push('tier2');
  if (priv) tags.push('private', 'crypt'); // :crypt: seam, spec §8
  if (bead.orphan) tags.push('orphan');
  if (bead.placeholder) tags.push('placeholder');

  out.push(`${stars(level)} ${title}${tagSuffix(tags)}`);

  // Properties drawer: fixed key order (determinism, spec §10).
  const sh = bead.snapshot.shape || 'round';
  const mo = bead.snapshot.mood || 'slate';
  const moodInfo = MOOD_BY_KEY[mo] || MOOD_BY_KEY.slate;
  out.push(':PROPERTIES:');
  out.push(`:ID: vakana-thread-${tid}-bead-${bead.beadId}`);
  out.push(`:VAKANA_BEAD_ID: ${bead.beadId}`);
  if (!bead.orphan) out.push(`:VAKANA_ENTRY_ID: ${bead.entryId}`);
  out.push(`:VAKANA_POSITION: ${bead.position}`);
  out.push(`:BEAD_SHAPE: ${sh}`);
  out.push(`:BEAD_PATTERN: ${bead.snapshot.pattern || 'solid'}`);
  out.push(`:BEAD_MOOD: ${mo}`);
  out.push(`:BEAD_MOOD_LABEL: ${moodInfo.label}`);
  out.push(`:BEAD_MOOD_COLOR: ${moodInfo.color}`);
  out.push(`:BEAD_GLYPH: ${bead.snapshot.glyph || ''}`);
  out.push(`:BEAD_SVG: assets/bead-${bead.beadId}.svg`);
  if (e) out.push(`:HIGHLIGHT_TIER: ${e.highlightTier}`);
  if (e && e.date) out.push(`:VAKANA_DATE: ${e.date}`);
  if (e && e.time) out.push(`:VAKANA_TIME: ${e.time}`);
  if (priv) out.push(':VAKANA_PRIVATE: t');
  if (bead.placeholder) out.push(':VAKANA_PLACEHOLDER: t');
  if (bead.orphan) out.push(':VAKANA_ORPHAN: t');
  if (e && e.createdAt) out.push(`:VAKANA_CREATED_AT: ${orgFromSql(e.createdAt)}`);
  if (e && e.updatedAt) out.push(`:VAKANA_UPDATED_AT: ${orgFromSql(e.updatedAt)}`);
  out.push(':END:');

  if (e && e.date) out.push(orgInactiveDate(e.date, e.time));
  out.push(`[[file:assets/bead-${bead.beadId}.svg]]`);

  if (hidePrivate) {
    out.push('# (private: body excluded at export)');
    return out.join('\n');
  }
  if (bead.orphan) return out.join('\n');

  const body = markdownToOrg(e.content, level + 1);
  if (body) out.push(body);

  const sub = level + 1;
  if (bead.photos.length) {
    out.push(`${stars(sub)} Photos`);
    bead.photos.forEach((_, i) =>
      out.push(`[[file:assets/photo-${bead.entryId}-${i + 1}.jpg]]`)
    );
  }
  if (bead.voice.length) {
    out.push(`${stars(sub)} Voice notes`);
    bead.voice.forEach((v, i) =>
      out.push(
        `- [[file:assets/voice-${bead.entryId}-${i + 1}.${uriExt(v.uri, 'm4a')}]] · ${msToClock(v.duration)}`
      )
    );
  }
  if (bead.comments.length) {
    out.push(`${stars(sub)} Comments`);
    bead.comments.forEach((c) => out.push(emitComment(c, sub + 1)));
  }
  if (bead.mentions.length) {
    out.push(`${stars(sub)} Mentions`);
    bead.mentions.forEach((m) =>
      out.push(`- [[id:vakana-thread-${m.threadId}][${oneLine(m.name)}]]`)
    );
  }
  return out.join('\n');
}

// Section-label grouping shared by flat + datetree (spec §5.3). A
// non-null label that differs from the current one opens a section
// heading at `baseLevel`; its beads (and following unlabelled beads)
// sit at baseLevel+1. Beads before the first label stay at baseLevel.
function emitBeadGroup(beads, baseLevel, thread, options) {
  const out = [];
  let current = null;
  for (const bead of beads) {
    if (bead.sectionLabel && bead.sectionLabel !== current) {
      current = bead.sectionLabel;
      out.push(`${stars(baseLevel)} ${oneLine(current)}`);
    }
    const lvl = current ? baseLevel + 1 : baseLevel;
    out.push(emitBead(bead, lvl, thread, options));
  }
  return out.join('\n\n');
}

function emitPreamble(data, options) {
  const { thread, collections } = data;
  const L = [];
  L.push(`#+TITLE: ${oneLine(thread.name) || 'Untitled thread'}`);
  if (thread.description && thread.description.trim())
    L.push(`#+SUBTITLE: ${oneLine(thread.description)}`);
  const colTags = collections.map((c) => slugify(c)).filter(Boolean);
  L.push(`#+FILETAGS: :vakana:${colTags.length ? `${colTags.join(':')}:` : ''}`);
  L.push('#+STARTUP: showeverything inlineimages');
  // File-scoped so a resolved comment's DONE keyword is recognized
  // regardless of the reader's global org-todo-keywords (the export is a
  // contract, not a function of the reader's config). No active states:
  // open comments are deliberately keyword-free, so this never turns the
  // snapshot into an agenda of tasks the user never declared.
  L.push('#+TODO: | DONE');
  L.push(`#+VAKANA_SCHEMA: ${ORG_EXPORT_SCHEMA}`);
  if (!options.reproducible) {
    L.push(`#+VAKANA_APP_VERSION: ${options.appVersion || ''}`);
    L.push(`#+VAKANA_EXPORTED_AT: ${orgTimestamp(new Date().toISOString(), false)}`);
  }
  L.push(`#+VAKANA_THREAD_ID: ${thread.id}`);
  L.push(`#+VAKANA_THREAD_KIND: ${thread.kind}`);
  if (data.isAuto) {
    if (thread.anchor_kind) L.push(`#+VAKANA_ANCHOR_KIND: ${thread.anchor_kind}`);
    if (thread.anchor_date) L.push(`#+VAKANA_ANCHOR_DATE: ${thread.anchor_date}`);
  }
  if (collections.length)
    L.push(`#+VAKANA_COLLECTIONS: ${collections.join('; ')}`);
  L.push(`#+VAKANA_THREAD_CREATED_AT: ${orgFromSql(thread.created_at)}`);
  L.push(`#+VAKANA_THREAD_UPDATED_AT: ${orgFromSql(thread.updated_at)}`);
  L.push('#+PROPERTY: header-args :eval never');
  return L.join('\n');
}

// Build the complete .org document for one thread.
export function emitOrgDocument(data, options = {}) {
  const opts = { ...DEFAULT_ORG_OPTIONS, ...options };
  const parts = [emitPreamble(data, opts), ''];

  parts.push('* The thread', '[[file:chain.svg]]', '');

  if (data.threadComments.length) {
    parts.push('* Thread notes');
    data.threadComments.forEach((c) => parts.push(emitComment(c, 2)));
    parts.push('');
  }

  if (data.isAuto) {
    // org-datetree (spec §5.2). Group dated beads by date; undated
    // (orphans w/o a date) collected under a trailing node.
    const dated = data.beads.filter((b) => b.entry && b.entry.date);
    const undated = data.beads.filter((b) => !(b.entry && b.entry.date));
    const byDate = new Map();
    for (const b of dated) {
      const k = b.entry.date.slice(0, 10);
      if (!byDate.has(k)) byDate.set(k, []);
      byDate.get(k).push(b);
    }
    const keys = [...byDate.keys()].sort(); // YYYY-MM-DD sorts chronologically
    let curY = null;
    let curM = null;
    for (const k of keys) {
      const h = datetreeHeadings(k);
      if (!h) continue;
      if (h.year !== curY) {
        parts.push(`* ${h.year}`);
        curY = h.year;
        curM = null;
      }
      if (h.month !== curM) {
        parts.push(`** ${h.month}`);
        curM = h.month;
      }
      parts.push(`*** ${h.day}`);
      parts.push(emitBeadGroup(byDate.get(k), 4, data.thread, opts));
    }
    if (undated.length) {
      parts.push('* (undated)');
      parts.push(emitBeadGroup(undated, 2, data.thread, opts));
    }
  } else {
    // Flat outline (spec §5.1).
    parts.push(emitBeadGroup(data.beads, 1, data.thread, opts));
  }

  return `${parts.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

// ---------------------------------------------------------------------------
// Orchestrator: load + emit are done; asset copy + JSZip + share are
// the next commit on this branch (spec §2/§6/§11).
// ---------------------------------------------------------------------------

// prepPhotoForExport in threadArticles.js is module-private; this is the
// same manipulateAsync call (cf. exportEntryCard.prepPhoto) returning raw
// base64 for JSZip. Budget kept modest so a thread zip stays sane (a zip
// has no Android-Print 2 MB ceiling, but big images bloat it anyway).
async function photoBase64(uri, maxWidth = 1600, quality = 0.82) {
  try {
    const r = await manipulateAsync(uri, [{ resize: { width: maxWidth } }], {
      compress: quality,
      format: SaveFormat.JPEG,
      base64: true,
    });
    return r?.base64 || null;
  } catch {
    return null;
  }
}

async function fileBase64(uri) {
  try {
    return await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch {
    return null;
  }
}

// Self-describing README so the archive is legible with no app (spec §12).
function buildReadmeOrg(data, opts) {
  const L = [];
  L.push('#+TITLE: Vakana → Org export');
  L.push('');
  L.push(
    'A one-way Org-mode snapshot of a Vakana thread. It is not synced. Changes'
  );
  L.push('that you make on the desktop do not go back to the app. Export again to refresh.');
  L.push('');
  L.push('* Files');
  L.push(`- =${slugify(data.thread.name) || `thread-${data.thread.id}`}.org=: the thread`);
  L.push('- =chain.svg=: the full bead chain as one image');
  L.push('- =vakana.el=: optional Emacs helper (load it if you want it)');
  L.push('- =assets/bead-<id>.svg=: one rendered bead for each chain position');
  L.push('- =assets/photo-*=, =assets/voice-*=: copied attachments');
  L.push('');
  L.push('* Recipes');
  L.push('- Add the .org file to ~org-agenda-files~.');
  L.push('- Auto-threads export as a native ~org-datetree~. Point');
  L.push('  org-journal or capture at it. It scrolls by day in org-agenda.');
  L.push('- Run ~M-x org-id-update-id-locations~. Then mentions resolve as');
  L.push('  ~[[id:…]]~ links (an org-roam graph).');
  L.push('- Query the bead grammar: ~(org-ql :props BEAD_SHAPE "lozenge")~.');
  L.push('- A resolved comment loop is a ~DONE~ headline (~:VAKANA_RESOLVED_AT:~');
  L.push('  records the time). ~(org-ql :todo "DONE")~ lists every closed loop.');
  L.push('  Open comments have no keyword.');
  L.push('- Private entries have the ~:crypt:~ tag. Use ~org-encrypt-entry~ on them');
  L.push('  on the desktop. The app never holds a key.');
  L.push('');
  L.push('* Property keys');
  L.push(
    '~VAKANA_*~ = provenance/identity; ~BEAD_*~ = the frozen bead grammar'
  );
  L.push('(shape geometry, pattern, mood label+colour, glyph). Schema:');
  L.push(`~#+VAKANA_SCHEMA: ${ORG_EXPORT_SCHEMA}~.`);
  L.push('');
  L.push('* Bead vocabulary');
  L.push('** Shapes');
  L.push('Vakana is a personal encoding system, not a fixed taxonomy.');
  L.push('Shapes have *no* prescribed meaning. ~BEAD_SHAPE~ records the');
  L.push('geometry only. You decide what each shape means (and you can');
  L.push('write it down here).');
  Object.entries(SHAPE_GEOMETRY).forEach(([shape, name]) =>
    L.push(`- ~${shape}~: ${name}`)
  );
  L.push('** Moods');
  MOODS.forEach((m) => L.push(`- ~${m.key}~: ${m.label} (${m.color})`));
  L.push('** Patterns');
  L.push(`- ${PATTERNS.map((p) => `~${p.key}~`).join(', ')}`);
  if (opts.reproducible) {
    L.push('');
    L.push('* Reproducible');
    L.push('Export time and version are omitted, so re-exports diff cleanly in git.');
  }
  return `${L.join('\n')}\n`;
}

// Emacs helper, always shipped (spec §12). Pure-local, no network.
const VAKANA_EL = `;;; vakana.el --- helpers for a Vakana Org export  -*- lexical-binding: t; -*-
;; Optional convenience. Pure local config, no network.
(defun vakana-add-to-agenda ()
  "Add this file to \`org-agenda-files'."
  (interactive)
  (add-to-list 'org-agenda-files (buffer-file-name))
  (message "Added to org-agenda-files."))
(with-eval-after-load 'org
  (setq org-image-actual-width '(420)))
(provide 'vakana)
;;; vakana.el ends here
`;

// Build the Org `.zip` into the cache and return the artifact (mirrors
// threadArticles.buildArticleArtifact so share & save-to-device are
// symmetric with the other formats).
async function buildThreadOrgZip(threadId, options = {}) {
  const opts = { ...DEFAULT_ORG_OPTIONS, ...options };
  const data = await getThreadExportData(threadId);
  const appVersion = appConfig?.expo?.version || '';
  const org = emitOrgDocument(data, { ...opts, appVersion });

  const slug = slugify(data.thread.name) || `thread-${data.thread.id}`;
  const zip = new JSZip();
  const root = zip.folder(slug);
  root.file(`${slug}.org`, org);
  root.file('README.org', buildReadmeOrg(data, opts));
  root.file('chain.svg', renderChainSvg(data.beads.map((b) => b.snapshot)));
  if (opts.includeVakanaEl) root.file('vakana.el', VAKANA_EL);

  const assets = root.folder('assets');
  const missing = [];
  // Bead SVG + metadata always travel, even for private-excluded beads
  // (the chain's visual truth isn't secret; spec §8).
  for (const b of data.beads) {
    assets.file(`bead-${b.beadId}.svg`, renderBeadSvg(b.snapshot));
  }
  // Photo/voice bytes: sequential (peak memory = one prepped asset, the
  // existing export pattern). Skipped for private-excluded beads.
  for (const b of data.beads) {
    const priv = b.entry ? !!b.entry.isPrivate : false;
    if (priv && !opts.includePrivate) continue;
    for (let i = 0; i < b.photos.length; i++) {
      const b64 = await photoBase64(b.photos[i]);
      if (b64) assets.file(`photo-${b.entryId}-${i + 1}.jpg`, b64, { base64: true });
      else missing.push(`photo-${b.entryId}-${i + 1}.jpg`);
    }
    for (let i = 0; i < b.voice.length; i++) {
      const v = b.voice[i];
      const b64 = await fileBase64(v.uri);
      const ext = uriExt(v.uri, 'm4a');
      if (b64)
        assets.file(`voice-${b.entryId}-${i + 1}.${ext}`, b64, { base64: true });
      else missing.push(`voice-${b.entryId}-${i + 1}.${ext}`);
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

/**
 * Build and **share** the Org `.zip` (OS share sheet; spec §1: no
 * transport, no sync).
 * @returns {Promise<{ uri, filename, missing:string[] }>}
 */
export async function exportThreadOrg(threadId, options = {}) {
  const a = await buildThreadOrgZip(threadId, options);
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device');
  }
  await Sharing.shareAsync(a.uri, {
    mimeType: a.mimeType,
    dialogTitle: 'Export thread to Org',
    UTI: a.UTI,
  });
  return { uri: a.uri, filename: a.filename, missing: a.missing };
}

/**
 * Build and **save to device**. Android: pick a folder via SAF and copy
 * the zip there (no share sheet). iOS: SAF doesn't exist, so route
 * through the share sheet ("Save to Files"). Mirrors
 * threadArticles.persistArtifactToDevice. Still local, no transport.
 * @returns {Promise<{ uri, filename, missing:string[] }>}
 */
export async function saveThreadOrgToDevice(threadId, options = {}) {
  const a = await buildThreadOrgZip(threadId, options);
  if (Platform.OS === 'android') {
    const perms =
      await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!perms.granted) throw new Error('Folder permission was denied');
    const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
      perms.directoryUri,
      a.filename,
      a.mimeType
    );
    const b64 = await FileSystem.readAsStringAsync(a.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await FileSystem.writeAsStringAsync(fileUri, b64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return { uri: fileUri, filename: a.filename, missing: a.missing };
  }
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device');
  }
  await Sharing.shareAsync(a.uri, {
    mimeType: a.mimeType,
    dialogTitle: 'Save thread Org export',
    UTI: a.UTI,
  });
  return { uri: a.uri, filename: a.filename, missing: a.missing };
}

// Re-export the SVG helpers so the export surface is one module.
export { renderBeadSvg, renderChainSvg };
