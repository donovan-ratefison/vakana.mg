#!/usr/bin/env node
//
// Verifies the in-app guides' tables of contents against their own headings.
//
//   node scripts/check-guide-anchors.mjs
//
// There is no test runner in this project, so this is a manual gate. Run it
// after editing docs/user-guide.md or docs/possibilities.md, both of which
// are rendered in-app by SettingsGuideViewerScreen.
//
// It parses with markdown-it exactly as the viewer does, rather than
// regexing the raw file. That distinction is the whole point: markdown-it
// percent-encodes non-ASCII in link hrefs, so an authored `#️-travel-and-place`
// (leading variation selector) arrives as `#%EF%B8%8F-travel-and-place`. A
// raw-text check sees a match and passes; the app saw hex garbage and the
// link silently did nothing. Three separate anchor bugs shipped behind
// checks that didn't model the renderer.
//
// Checks, in order of how badly each one bites:
//   1. every `#anchor` link resolves to a heading  (dead link)
//   2. no two headings share a slug                (ref overwritten -> wrong jump)
//   3. every H2 appears in the Contents list       (drift: section unreachable from TOC)
//   4. the Contents order matches document order   (drift: TOC misleads)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const MarkdownIt = require('markdown-it');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Defaults to the two in-app guides; accepts paths so the checker itself can
// be exercised against a deliberately-broken fixture.
const GUIDES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['docs/user-guide.md', 'docs/possibilities.md'];

// Must stay identical to slugify() in SettingsGuideViewerScreen.js,
// including mapping EACH space rather than each run, which is what keeps
// headings containing `&` or an em-dash correct.
const slugify = (text) =>
  (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9 \-_]/gi, '')
    .replace(/ /g, '-');

const decodeAnchor = (raw) => {
  try {
    return decodeURIComponent(raw || '');
  } catch {
    return raw || '';
  }
};

const md = new MarkdownIt({ typographer: true });
let failures = 0;

for (const rel of GUIDES) {
  const src = fs.readFileSync(path.resolve(ROOT, rel), 'utf8');
  const tokens = md.parse(src, {});

  const headings = []; // { level, text, slug }
  const anchors = []; // decoded href slugs
  let contentsAnchors = null; // TOC entries, in listed order

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'heading_open' && tokens[i + 1]?.type === 'inline') {
      const text = tokens[i + 1].content;
      headings.push({ level: Number(t.tag.slice(1)), text, slug: slugify(text) });
      if (/contents/i.test(text)) contentsAnchors = [];
      continue;
    }
    if (t.type !== 'inline') continue;
    for (const child of t.children || []) {
      if (child.type !== 'link_open') continue;
      const href = (child.attrs?.find((a) => a[0] === 'href') || [])[1] || '';
      if (!href.startsWith('#')) continue;
      const slug = slugify(decodeAnchor(href.slice(1)));
      anchors.push({ href, slug });
      if (contentsAnchors && contentsAnchors.length < 200) contentsAnchors.push(slug);
    }
  }

  const bySlug = new Map();
  for (const h of headings) {
    if (!bySlug.has(h.slug)) bySlug.set(h.slug, []);
    bySlug.get(h.slug).push(h);
  }

  const problems = [];

  for (const a of anchors) {
    if (!bySlug.has(a.slug)) problems.push(`dead link  ${a.href}  (slug '${a.slug}')`);
  }
  for (const [slug, group] of bySlug) {
    if (group.length > 1) {
      problems.push(
        `duplicate slug '${slug}': ${group.length} headings, only the last is reachable: ` +
          group.map((g) => `"${g.text}"`).join(' | ')
      );
    }
  }

  const h2 = headings.filter((h) => h.level === 2 && !/contents/i.test(h.text));
  const listed = new Set(contentsAnchors || []);
  for (const h of h2) {
    if (!listed.has(h.slug)) problems.push(`not in Contents: "${h.text}"`);
  }

  if (contentsAnchors) {
    const inToc = contentsAnchors.filter((s) => h2.some((h) => h.slug === s));
    const inDoc = h2.filter((h) => listed.has(h.slug)).map((h) => h.slug);
    for (let i = 0; i < Math.min(inToc.length, inDoc.length); i++) {
      if (inToc[i] !== inDoc[i]) {
        problems.push(
          `Contents order diverges from the document at position ${i + 1}: ` +
            `TOC has '${inToc[i]}', document has '${inDoc[i]}'`
        );
        break;
      }
    }
  }

  const status = problems.length ? `${problems.length} problem(s)` : 'OK';
  console.log(
    `${problems.length ? '✗' : '✓'} ${rel}: ${headings.length} headings, ` +
      `${anchors.length} anchors · ${status}`
  );
  problems.forEach((p) => console.log(`    ${p}`));
  failures += problems.length;
}

if (failures) {
  console.log(`\n${failures} problem(s) found.`);
  process.exit(1);
}
console.log('\nAll guide anchors resolve, are unique, and the Contents match the documents.');
