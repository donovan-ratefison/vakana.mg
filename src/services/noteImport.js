// Note import: the capture bridge. Ingests an off-device plain-text
// note (.org / .md / .txt, from a synced folder or a user-supplied URL)
// as an *uncurated draft entry*. This is the deliberate inverse of the
// Org export (src/services/orgExport.js): the `org-datetree ⇄
// auto-thread` mapping read backwards. One-way *in*: no sync, no
// round-trip, no transport, no server.
//
// Authoritative contract: docs/architecture/note-import.md. Read it
// before changing anything here; the change-checklist group
// "If you touched note import" indexes the invariants.
//
// Screens/components must route through this service rather than running
// SQL against `import_ledger` inline (services-layer convention).

import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { getDb } from '../database/db';
import { formatDateStr, todayDateStr } from '../utils/dateString';

// `expo-file-system/legacy` is deliberate: orgExport.js:13 and backup.js
// use it, and the legacy `StorageAccessFramework` namespace is what
// exposes directory read/enumerate/move on Android SAF content:// URIs.
// This module only ever READS user files (+ one best-effort move into an
// imported/ subfolder, §4.3); it never does the large-file SAF flat
// *write* that was retired for OOM/content:// mangling. Do not conflate.
const SAF = FileSystem.StorageAccessFramework;
const IMPORT_FOLDER_KEY = 'vakana_import_folder_uri';
const MAX_FILE_BYTES = 512 * 1024; // a text note is small; guard binaries

// ---------------------------------------------------------------------------
// Idempotency fingerprint. A non-crypto FNV-1a (32-bit) is intentional:
// the consequence of a collision is "one note re-imports / skips", never
// a security boundary, so pulling in expo-crypto would only add audit
// surface against foundation 5 (small, auditable, no added deps). The
// hash is over normalised text so trivial whitespace churn in a growing
// org-capture file does not defeat the seen-set.
// ---------------------------------------------------------------------------

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts (stay in 32-bit range).
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-8);
}

function normaliseForHash(text) {
  return String(text == null ? '' : text)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function contentHash(text) {
  return fnv1a(normaliseForHash(text));
}

// ---------------------------------------------------------------------------
// §3 The parsing contract (transport-agnostic core). Input: a text blob
// + a filename (may be '') + mtimeMs (may be null for URLs). Output: an
// ordered list of { title, date, content } candidates. `title` may be
// '' here: the `Draft <importMoment>` floor is applied at insert time
// (insertImportedEntry), exactly as the editor computes draftTitle
// inside save() (EntryEditorScreen.js:390; overview.md §Entry save
// semantics), so the stamp reflects the real write moment and the
// floor lives with the insert, not the parser.
// ---------------------------------------------------------------------------

// §3 format selection: by extension. Cross-format content-sniffing is a
// documented v2 hook (note-import.md §6); v1 trusts the extension and
// lets the ladders provide graceful degradation.
export function chooseFormat(filename) {
  const ext = String(filename || '')
    .toLowerCase()
    .replace(/[#?].*$/, '')
    .match(/\.([a-z0-9]+)$/);
  if (!ext) return 'plain';
  if (ext[1] === 'org') return 'org';
  if (ext[1] === 'md' || ext[1] === 'markdown') return 'md';
  return 'plain';
}

function splitLines(blob) {
  return String(blob == null ? '' : blob).replace(/\r\n/g, '\n').split('\n');
}

function basename(filename) {
  const name = String(filename || '')
    .replace(/[#?].*$/, '')
    .replace(/\/+$/, '')
    .split('/')
    .pop();
  return name || '';
}

// Filename → a title: drop the extension and a leading `YYYY-MM-DD`
// daily-note prefix (org-roam / Obsidian convention), turn separators
// into spaces. Returns '' when nothing usable remains (→ Draft floor).
function titleFromFilename(filename) {
  let s = basename(filename).replace(/\.[a-z0-9]+$/i, '');
  s = s.replace(/^\d{4}-\d{2}-\d{2}[-_ ]+/, '');
  s = s.replace(/[-_]+/g, ' ').trim();
  return s;
}

function firstYmd(s) {
  const m = /(\d{4}-\d{2}-\d{2})/.exec(String(s || ''));
  return m ? m[1] : null;
}

// Strip a trailing Org tag suffix ( :tier1:private: ) from a heading.
function stripOrgTags(headingText) {
  return String(headingText || '').replace(/\s+:[A-Za-z0-9_@#%:]+:\s*$/, '').trim();
}

// §3.2 Date ladder (single-file path; datetree leaves resolve their own
// date in parseDatetree). First hit wins:
//   2. org `#+DATE:` / md front-matter `date:`
//   3. filename leading YYYY-MM-DD prefix
//   4. file mtime's calendar date
//   5. floor: today
export function resolveDate(blob, format, filename, mtimeMs) {
  let explicit = null;
  if (format === 'org') {
    const lines = splitLines(blob);
    for (const ln of lines) {
      const m = /^#\+DATE:\s*(.+)$/i.exec(ln.trim());
      if (m) { explicit = firstYmd(m[1]); break; }
      if (/^\*+\s/.test(ln)) break; // past the keyword block
    }
  } else if (format === 'md') {
    const fm = readFrontMatter(blob);
    if (fm && fm.data.date) explicit = firstYmd(fm.data.date);
  }
  if (explicit) return explicit;

  const fromName = firstYmd((basename(filename).match(/^\d{4}-\d{2}-\d{2}/) || [])[0]);
  if (fromName) return fromName;

  if (typeof mtimeMs === 'number' && isFinite(mtimeMs) && mtimeMs > 0) {
    const d = formatDateStr(new Date(mtimeMs));
    if (d) return d;
  }
  return todayDateStr();
}

// Minimal YAML-ish front-matter: a leading `---` … `---` block of
// `key: value` lines. Enough for `title:` / `date:`; not a YAML parser.
function readFrontMatter(blob) {
  const lines = splitLines(blob);
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (lines[i] == null || lines[i].trim() !== '---') return null;
  const out = {};
  let j = i + 1;
  for (; j < lines.length; j++) {
    if (lines[j].trim() === '---') {
      return { data: out, endLine: j };
    }
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[j]);
    if (m) {
      out[m[1].toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return null; // unterminated front-matter → treat as plain content
}

// §3.1 Title ladder + content extraction (coupled: content is the blob
// minus whatever the title consumed). Single-file path only.
function parseSingle(blob, format, filename, mtimeMs) {
  const raw = String(blob == null ? '' : blob);
  let title = '';
  let content = raw;

  if (format === 'org') {
    const lines = splitLines(raw);
    const titleLine = lines.find((l) => /^#\+TITLE:\s*/i.test(l.trim()));
    if (titleLine) {
      title = titleLine.trim().replace(/^#\+TITLE:\s*/i, '').trim();
      // content = body minus org file-keyword lines (#+KEY: …).
      content = lines.filter((l) => !/^#\+\w[\w-]*:/.test(l.trim())).join('\n').trim();
    } else {
      const hi = lines.findIndex((l) => /^\*+\s+\S/.test(l));
      if (hi >= 0) {
        title = stripOrgTags(lines[hi].replace(/^\*+\s+/, ''));
        let rest = lines.slice(hi + 1);
        // drop a leading :PROPERTIES: … :END: drawer (org-capture adds one)
        if (rest[0] && rest[0].trim() === ':PROPERTIES:') {
          const end = rest.findIndex((l) => l.trim() === ':END:');
          if (end >= 0) rest = rest.slice(end + 1);
        }
        content = rest.join('\n').trim();
      } else {
        title = titleFromFilename(filename);
        content = raw.trim();
      }
    }
  } else if (format === 'md') {
    const fm = readFrontMatter(raw);
    let body = raw;
    if (fm) {
      const lines = splitLines(raw);
      body = lines.slice(fm.endLine + 1).join('\n');
    }
    const bodyLines = splitLines(body);
    const hi = bodyLines.findIndex((l) => /^#\s+\S/.test(l));
    if (hi >= 0) {
      title = bodyLines[hi].replace(/^#\s+/, '').trim();
      content = bodyLines.slice(0, hi).concat(bodyLines.slice(hi + 1)).join('\n').trim();
    } else if (fm && fm.data.title) {
      title = fm.data.title;
      content = body.trim();
    } else {
      title = titleFromFilename(filename);
      content = body.trim();
    }
  } else {
    title = titleFromFilename(filename);
    content = raw.trim();
  }

  return {
    title: title || '',
    date: resolveDate(raw, format, filename, mtimeMs),
    content,
  };
}

// ---------------------------------------------------------------------------
// §3.3 The keystone: an .org datetree fans out to one candidate per
// dated leaf: the *literal inverse* of orgExport.js's datetree writer.
// The matched writer lines (keep this reader in lockstep; see
// change-checklist.md "If you touched note import"):
//   datetreeHeadings()        orgExport.js:68-87   (the heading text)
//   emitOrgDocument() isAuto  orgExport.js:657-689 (* YYYY / ** YYYY-MM /
//                                                   *** YYYY-MM-DD / level 4)
//   emitBead()                orgExport.js:506-590 (heading → :PROPERTIES:
//                                                   → [date] → svg → body)
//   emitBeadGroup()           orgExport.js:596-608 (section labels at the
//                                                   bead base level)
// A bead leaf's unforgeable signature: its heading's next non-blank line
// is `:PROPERTIES:`. Section-label headings (emitBeadGroup) have no
// drawer, so they are skipped; that disambiguates leaf vs section even
// though both can sit at level 4.
// ---------------------------------------------------------------------------

const RE_YEAR = /^\*\s+(\d{4})\s*$/;
const RE_MONTH = /^\*\*\s+(\d{4})-(\d{2})\s+\S/;
const RE_DAY = /^\*\*\*\s+(\d{4}-\d{2}-\d{2})\s+\S/;
const RE_HEADING = /^(\*+)\s+(.*\S)\s*$/;

// §3.3 detection: strict three-level nesting must be present (year →
// month → day), matching orgExport.js:675/680/683 exactly. Anything that
// does not strictly match falls to the single-file path (graceful
// degradation, note-import.md §3). The export's `* The thread` /
// `* Thread notes` / `#+`-preamble chrome is ignored structurally.
export function isDatetree(blob) {
  const lines = splitLines(blob);
  let sawYear = false;
  let sawMonth = false;
  for (const ln of lines) {
    if (RE_YEAR.test(ln)) sawYear = true;
    else if (sawYear && RE_MONTH.test(ln)) sawMonth = true;
    else if (sawYear && sawMonth && RE_DAY.test(ln)) return true;
  }
  return false;
}

function nextNonBlank(lines, from) {
  for (let i = from; i < lines.length; i++) {
    if (lines[i].trim() !== '') return lines[i].trim();
  }
  return '';
}

// Parse the :PROPERTIES: … :END: drawer starting at `from` (the
// :PROPERTIES: line index). Returns { props, endIdx }.
function readDrawer(lines, from) {
  const props = {};
  let i = from + 1;
  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === ':END:') break;
    const m = /^:([A-Za-z0-9_]+):\s*(.*)$/.exec(t);
    if (m) props[m[1].toUpperCase()] = m[2].trim();
  }
  return { props, endIdx: i };
}

export function parseDatetree(blob) {
  const lines = splitLines(blob);
  const out = [];
  let curDay = null; // 'YYYY-MM-DD' from the *** day node

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dm = RE_DAY.exec(line);
    if (dm) { curDay = dm[1]; continue; }
    if (RE_YEAR.test(line) || RE_MONTH.test(line)) continue;

    const hm = RE_HEADING.exec(line);
    if (!hm) continue;
    const level = hm[1].length;

    // A leaf = heading immediately followed by :PROPERTIES: (emitBead
    // always emits the drawer right after the heading). No drawer =
    // a section-label heading (emitBeadGroup) or the `* The thread` /
    // `* (undated)` / `* Thread notes` chrome: skip it.
    if (nextNonBlank(lines, i + 1) !== ':PROPERTIES:') continue;

    let p = i + 1;
    while (lines[p] != null && lines[p].trim() === '') p++;
    const { props, endIdx } = readDrawer(lines, p);

    // Skip export artefacts that were never user captures.
    if (
      props.VAKANA_ORPHAN === 't' ||
      props.VAKANA_PLACEHOLDER === 't' ||
      stripOrgTags(hm[2]) === '(removed entry)'
    ) {
      i = endIdx;
      continue;
    }

    // Body = everything after :END: up to the next heading at this
    // level or shallower, minus the leading inactive-date line
    // ([YYYY-MM-DD Dow], orgExport.js:552) and the bead-SVG link
    // ([[file:assets/bead-*.svg]], :553). Sub-headings (Photos /
    // Comments / Mentions, deeper than the leaf) stay in the body
    // verbatim; v1 does not reverse the Markdown→Org transform
    // (lossy; a documented v2 hook, note-import.md §3.3/§6).
    let b = endIdx + 1;
    const body = [];
    for (; b < lines.length; b++) {
      const bh = RE_HEADING.exec(lines[b]);
      if (bh && bh[1].length <= level) break;
      body.push(lines[b]);
    }
    while (body.length && body[0].trim() === '') body.shift();
    if (body[0] && /^\[\d{4}-\d{2}-\d{2} \w+.*\]$/.test(body[0].trim())) body.shift();
    if (body[0] && /^\[\[file:assets\/bead-.*\.svg\]\]$/.test(body[0].trim())) body.shift();
    while (body.length && body[0].trim() === '') body.shift();

    out.push({
      title: stripOrgTags(hm[2]) || '',
      // :VAKANA_DATE: round-trips orgExport.js:544; else the authoritative
      // *** day-node date (orgExport.js:683); else today (floor, §3.2).
      date: firstYmd(props.VAKANA_DATE) || curDay || todayDateStr(),
      content: body.join('\n').trim(),
    });
    i = b - 1;
  }
  return out;
}

// §3 orchestrator. Org datetree → many candidates; everything else →
// exactly one. Returns [] only for the degenerate no-leaf datetree.
export function parseNote(blob, filename, mtimeMs) {
  const format = chooseFormat(filename);
  if (format === 'org' && isDatetree(blob)) {
    return parseDatetree(blob);
  }
  return [parseSingle(blob, format, filename, mtimeMs)];
}

// ---------------------------------------------------------------------------
// Entry creation (note-import.md §2, decision Option B). The editor's
// insert path is inline in EntryEditorScreen.save() and entangled with
// autosave serialization, skipNextSaveRef, attachment rewrite and
// syncAutoBeadForEntry; extracting it would touch the most
// invariant-dense file in the app. Instead we reproduce its *semantics*
// (the contract, not the function): the same `Draft <YYYYMMDDHHMMSS>`
// floor (EntryEditorScreen.js:56-58, :390-391; overview.md §Entry save
// semantics), the same `entries` column set, created_at/updated_at via
// the schema default. Invariant 2 (no bead / no auto-thread) is
// guaranteed *by omission*: bead columns stay NULL and
// syncAutoBeadForEntry is deliberately NOT called, so a bead-less
// imported entry stays outside every auto-thread chain. If the editor's
// draft-title format or column set ever changes, this must change with
// it; the change-checklist "If you touched note import" group points
// here.
// ---------------------------------------------------------------------------

const pad2 = (n) => String(n).padStart(2, '0');

// Mirror of EntryEditorScreen.js:56-58 (local components, never UTC;
// same timezone-stable rationale as utils/dateString).
function importStamp(d) {
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  );
}

// Insert one uncurated draft entry. `date` is already a 'YYYY-MM-DD'
// string from the ladders (resolveDate/parseDatetree), unlike the
// editor which formats a Date; we validate and floor to today rather
// than re-running formatDateStr on a string. Returns the new entry id.
export async function insertImportedEntry({ title, content, date }) {
  const db = getDb();
  if (!db) return null;

  const trimmedTitle = String(title == null ? '' : title).trim();
  const trimmedContent = String(content == null ? '' : content).trim();
  const draftTitle = `Draft ${importStamp(new Date())}`;
  const titleToSave = trimmedTitle || draftTitle;
  const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))
    ? date
    : todayDateStr();

  const result = await db.runAsync(
    `INSERT INTO entries
       (title, content, date, bead_shape, bead_pattern, bead_mood, bead_glyph, highlight_tier, is_private)
     VALUES (?, ?, ?, NULL, NULL, NULL, NULL, 0, 0)`,
    [titleToSave, trimmedContent, dateStr]
  );
  return result.lastInsertRowId;
  // NOTE: no syncAutoBeadForEntry: invariant 2. Do not add one.
}

// ---------------------------------------------------------------------------
// Idempotency ledger (note-import.md §4.3). Two deliberately separate
// checks so each source composes the *correct* rule; conflating them
// would (a) skip every datetree leaf after the first (they share a file)
// and (b) block a legitimately-changed URL from re-importing:
//
//   • hasSeenHash(hash):         content already imported from anywhere.
//                                The durable correctness backbone. Used
//                                by datetree-per-leaf and URL.
//   • hasSeenKey(kind, key):     this exact source slot already
//                                processed even if bytes differ. The
//                                folder one-file-per-note move-failure
//                                safety net ONLY (key = relPath|size|
//                                mtime). Never used for URL (a URL is
//                                not a stable identity; changed bytes
//                                must re-import, note-import.md §4.3).
// ---------------------------------------------------------------------------

export async function hasSeenHash(hash) {
  const db = getDb();
  if (!db) return false;
  const row = await db.getFirstAsync(
    `SELECT 1 FROM import_ledger WHERE hash = ? LIMIT 1`,
    [hash]
  );
  return !!row;
}

export async function hasSeenKey(sourceKind, key) {
  const db = getDb();
  if (!db) return false;
  const row = await db.getFirstAsync(
    `SELECT 1 FROM import_ledger WHERE source_kind = ? AND key = ? LIMIT 1`,
    [sourceKind, key]
  );
  return !!row;
}

export async function markSeen(sourceKind, key, hash, entryId) {
  const db = getDb();
  if (!db) return;
  await db.runAsync(
    `INSERT INTO import_ledger (source_kind, key, hash, entry_id, imported_at)
     VALUES (?, ?, ?, ?, ?)`,
    [sourceKind, key, hash, entryId ?? null, new Date().toISOString()]
  );
}

// ---------------------------------------------------------------------------
// §4.1 Source adapter A: the SAF synced folder (the private backbone:
// with Syncthing the bytes never leave devices the user controls). The
// picked tree URI is persisted in expo-secure-store (mirrors
// utils/preferences.js / auth.js / theme.js). Enumeration is flat
// (non-recursive) so the imported/ subfolder is never re-read. Each file
// is parsed by the transport-agnostic core; the move-to-imported/ step
// is best-effort and the ledger is the real correctness mechanism (§4.3,
// plan risk #1).
// ---------------------------------------------------------------------------

// Extensions we never treat as a note even though §3 would fall them to
// 'plain': import hygiene, not new scope (a synced folder may carry the
// note's own attachments alongside it).
const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic',
  'mp4', 'mov', 'm4a', 'mp3', 'wav', 'ogg', 'aac',
  'pdf', 'zip', 'gz', 'tar', 'bin', 'db', 'sqlite',
]);

export async function getImportFolderUri() {
  try {
    return await SecureStore.getItemAsync(IMPORT_FOLDER_KEY);
  } catch {
    return null;
  }
}

export async function setImportFolderUri(uri) {
  try {
    if (uri) await SecureStore.setItemAsync(IMPORT_FOLDER_KEY, uri);
    else await SecureStore.deleteItemAsync(IMPORT_FOLDER_KEY);
  } catch (e) {
    console.warn('setImportFolderUri failed:', e?.message || e);
  }
}

// User picks a synced folder via the Android SAF dialog; the granted
// tree URI is persisted. Kept here so all SAF stays in the service;
// screens never import expo-file-system. Returns { granted, uri }.
export async function pickImportFolder() {
  try {
    const res = await SAF.requestDirectoryPermissionsAsync();
    if (res && res.granted && res.directoryUri) {
      await setImportFolderUri(res.directoryUri);
      return { granted: true, uri: res.directoryUri };
    }
  } catch (e) {
    console.warn('pickImportFolder failed:', e?.message || e);
  }
  return { granted: false, uri: null };
}

// Display name out of a SAF document content:// URI (the name is the
// URL-encoded trailing path segment).
function safName(uri) {
  try {
    const decoded = decodeURIComponent(String(uri));
    return decoded.split('/').pop() || '';
  } catch {
    return String(uri).split('/').pop() || '';
  }
}

function fileExt(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

// Scan `treeUri`, importing every unseen note. Returns
// { imported, skipped }. One bad file never aborts the scan.
export async function importFromFolder(treeUri) {
  if (!treeUri) return { imported: 0, skipped: 0 };
  let children;
  try {
    children = await SAF.readDirectoryAsync(treeUri);
  } catch (e) {
    console.warn('importFromFolder: readDirectory failed:', e?.message || e);
    return { imported: 0, skipped: 0 };
  }

  let imported = 0;
  let skipped = 0;
  let importedDirUri; // lazily resolved, best-effort, memoised per scan

  const ensureImportedDir = async () => {
    if (importedDirUri !== undefined) return importedDirUri;
    try {
      importedDirUri = await SAF.makeDirectoryAsync(treeUri, 'imported');
    } catch {
      importedDirUri = null; // exists-or-unsupported → moves are skipped
    }
    return importedDirUri;
  };

  for (const childUri of children) {
    try {
      const name = safName(childUri);
      if (!name || BINARY_EXT.has(fileExt(name))) { skipped++; continue; }

      let info;
      try {
        info = await FileSystem.getInfoAsync(childUri, { size: true });
      } catch {
        skipped++;
        continue;
      }
      if (!info || !info.exists || info.isDirectory) { skipped++; continue; }
      if (typeof info.size === 'number' && info.size > MAX_FILE_BYTES) {
        skipped++;
        continue;
      }

      let blob;
      try {
        blob = await FileSystem.readAsStringAsync(childUri);
      } catch {
        skipped++; // a directory or unreadable entry
        continue;
      }

      const mtimeMs =
        typeof info.modificationTime === 'number' && info.modificationTime > 0
          ? info.modificationTime * 1000 // legacy API reports seconds
          : null;
      const isDt = chooseFormat(name) === 'org' && isDatetree(blob);

      if (isDt) {
        // Append-only datetree: per-leaf content hash, file NEVER moved
        // or modified (§4.3). The leaf hash is the sole dedup.
        const leaves = parseNote(blob, name, mtimeMs);
        let any = false;
        for (const c of leaves) {
          const h = contentHash(`${c.date} ${c.title} ${c.content}`);
          if (await hasSeenHash(h)) continue;
          const id = await insertImportedEntry(c);
          await markSeen('folder', `${name}#${h}`, h, id);
          imported++;
          any = true;
        }
        if (!any) skipped++;
      } else {
        // One-file-per-note: skip if this exact file slot was processed
        // (move-failure safety net) or its content already imported.
        // On success, write the ledger key THEN best-effort move into
        // imported/ (visibility nicety; ledger is correctness).
        const fileKey = `${name}|${info.size ?? ''}|${mtimeMs ?? ''}`;
        const h = contentHash(blob);
        if (
          (await hasSeenKey('folder', fileKey)) ||
          (await hasSeenHash(h))
        ) {
          skipped++;
          continue;
        }
        const [c] = parseNote(blob, name, mtimeMs);
        const id = await insertImportedEntry(c);
        await markSeen('folder', fileKey, h, id);
        imported++;
        const dir = await ensureImportedDir();
        if (dir) {
          try {
            await SAF.moveAsync({ from: childUri, to: dir });
          } catch {
            /* best-effort; ledger already prevents re-import */
          }
        }
      }
    } catch (e) {
      console.warn('importFromFolder: file failed:', e?.message || e);
      skipped++;
    }
  }

  return { imported, skipped };
}

// ---------------------------------------------------------------------------
// §4.2 Source adapter B: a user-supplied HTTP(S) URL. This is the app's
// FIRST and ONLY network call (note-import.md §0.2/§8.7): it lives only
// here, is user-initiated, host-agnostic (Vakana bakes in no host and
// runs no server), bounded by a hard timeout AND a size cap, and sends
// no telemetry. Idempotency is per-content-hash ONLY; a URL is not a
// stable identity, so changed bytes at the same URL deliberately create
// a new entry (note-import.md §4.3); never key-skip a URL.
// ---------------------------------------------------------------------------

const URL_TIMEOUT_MS = 15000;
const MAX_FETCH_BYTES = 256 * 1024;

export async function importFromUrl(url) {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) {
    return { imported: 0, skipped: 0, error: 'bad-url' };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), URL_TIMEOUT_MS);
  let text;
  try {
    const resp = await fetch(u, { signal: ctrl.signal });
    if (!resp.ok) {
      return { imported: 0, skipped: 0, error: `http-${resp.status}` };
    }
    const cl = Number(resp.headers.get('content-length') || 0);
    if (cl && cl > MAX_FETCH_BYTES) {
      return { imported: 0, skipped: 0, error: 'too-large' };
    }
    text = await resp.text();
    if (text.length > MAX_FETCH_BYTES) {
      return { imported: 0, skipped: 0, error: 'too-large' };
    }
  } catch (e) {
    return {
      imported: 0,
      skipped: 0,
      error: e && e.name === 'AbortError' ? 'timeout' : 'fetch-failed',
    };
  } finally {
    clearTimeout(timer);
  }

  const name = safName(u.split(/[?#]/)[0]);
  const isDt = chooseFormat(name) === 'org' && isDatetree(text);
  const candidates = parseNote(text, name, null);

  let imported = 0;
  let skipped = 0;
  for (const c of candidates) {
    const h = contentHash(
      isDt ? `${c.date} ${c.title} ${c.content}` : text
    );
    if (await hasSeenHash(h)) {
      skipped++;
      continue;
    }
    const id = await insertImportedEntry(c);
    await markSeen('url', u, h, id);
    imported++;
  }
  return { imported, skipped };
}
