import React, { useMemo } from 'react';
import { Text } from 'react-native';
import { useTheme } from '../theme';

// Inline-only markdown renderer for tight previews (EntryCard's 1-line
// excerpt, VerticalBeadChain's bubble). Inline emphasis / code / links /
// strikethrough render as nested Text spans so `numberOfLines` and
// ellipsis still work on the outer Text.
//
// Two modes, both still a single Text (so `numberOfLines` clips them):
//   - default: block-level tokens are stripped to their text and ALL
//     whitespace (incl. newlines) is collapsed to one flowing paragraph.
//   - `block`: block markers are stripped but line breaks are PRESERVED
//     (list bullets become `• ` on their own line), so a markdown list
//     no longer renders as one run-on line. Intra-line whitespace is
//     still collapsed and blank-line runs are capped at one.
//
// Behavioural contract: behaves like Text. Accepts `style`,
// `numberOfLines`, `block`. Returns null for empty input.
export default function MarkdownInline({
  children,
  style,
  numberOfLines,
  block = false,
  strike = false,
}) {
  const { colors } = useTheme();
  const raw = typeof children === 'string' ? children : String(children ?? '');
  const prepared = useMemo(
    () => (block ? blockify(raw) : flattenForPreview(raw)),
    [raw, block]
  );
  const tokens = useMemo(() => parseInline(prepared), [prepared]);
  if (!prepared) return null;
  return (
    <Text
      style={[
        style,
        strike && {
          textDecorationLine: 'line-through',
          color: colors.textFaint,
        },
      ]}
      numberOfLines={numberOfLines}
    >
      {tokens.map((t, i) => {
        if (t.kind === 'text') return <Text key={i}>{t.text}</Text>;
        const segStyle = {};
        if (t.bold) segStyle.fontWeight = '700';
        if (t.italic) segStyle.fontStyle = 'italic';
        if (t.strike) segStyle.textDecorationLine = 'line-through';
        if (t.code) {
          segStyle.fontFamily = 'monospace';
          segStyle.backgroundColor = colors.surfaceMuted;
        }
        if (t.link) {
          segStyle.color = colors.primary;
          segStyle.textDecorationLine = 'underline';
        }
        return (
          <Text key={i} style={segStyle}>
            {t.text}
          </Text>
        );
      })}
    </Text>
  );
}

// Strip block-level tokens (keep their text), then collapse whitespace
// for a single-flow preview. The result still contains inline emphasis
// markers (`**foo**`, `_bar_`, etc.) for the inline parser to handle.
function flattenForPreview(s) {
  if (!s) return '';
  let t = String(s);
  // Fenced code blocks → keep inner text, drop fences and language tag.
  t = t.replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?|```/g, ''));
  // Line-leading block markers: headings, blockquotes, list bullets, hrs.
  t = t.replace(/^\s*#{1,6}\s+/gm, '');
  t = t.replace(/^\s*>\s?/gm, '');
  t = t.replace(/^\s*[-*+]\s+/gm, '• ');
  t = t.replace(/^\s*(\d+)\.\s+/gm, '$1. ');
  t = t.replace(/^\s*[-*_]{3,}\s*$/gm, '');
  // Collapse every whitespace run to a single space so the preview
  // flows as one paragraph; numberOfLines on the outer Text clips it.
  return t.replace(/\s+/g, ' ').trim();
}

// Like flattenForPreview but newline-preserving: strip the same block
// markers, but keep line breaks so a list / multi-paragraph note renders
// with its structure. Inline emphasis markers are left for parseInline
// (which treats `\n` as ordinary text, so the line breaks survive into
// the rendered Text).
function blockify(s) {
  if (!s) return '';
  let t = String(s);
  // Fenced code blocks → keep inner text (incl. its line breaks), drop
  // the fences and language tag.
  t = t.replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?|```/g, ''));
  // Line-leading block markers (per line, newlines kept).
  t = t.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
  t = t.replace(/^[ \t]*>[ \t]?/gm, '');
  t = t.replace(/^[ \t]*[-*+][ \t]+/gm, '• ');
  t = t.replace(/^[ \t]*(\d+)\.[ \t]+/gm, '$1. ');
  t = t.replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, '');
  // Collapse intra-line whitespace runs (spaces/tabs only, never the
  // newlines), trim each line's edges, then cap blank-line runs at one.
  t = t.replace(/[ \t]+/g, ' ');
  t = t.replace(/ *\n */g, '\n');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

// Order matters: longer openers (`**`, `__`, `~~`) must be checked
// before their single-char siblings (`*`, `_`) so emphasis parsing
// disambiguates correctly.
const INLINE_PATTERNS = [
  ['**', 'bold'],
  ['__', 'bold'],
  ['~~', 'strike'],
  ['*', 'italic'],
  ['_', 'italic'],
  ['`', 'code'],
];

function parseInline(text) {
  const tokens = [];
  if (!text) return tokens;
  const len = text.length;
  let pos = 0;
  let plainStart = 0;
  const pushPlain = (start, end) => {
    if (end > start) tokens.push({ kind: 'text', text: text.slice(start, end) });
  };
  while (pos < len) {
    // Link `[text](url)` → render as link-styled text.
    if (text[pos] === '[') {
      const m = text.slice(pos).match(/^\[([^\]]+)\]\(([^)]+)\)/);
      if (m) {
        pushPlain(plainStart, pos);
        tokens.push({ kind: 'styled', text: m[1], link: true });
        pos += m[0].length;
        plainStart = pos;
        continue;
      }
    }
    // Image `![alt](url)` → emit alt as plain text.
    if (text[pos] === '!' && text[pos + 1] === '[') {
      const m = text.slice(pos).match(/^!\[([^\]]*)\]\(([^)]+)\)/);
      if (m) {
        pushPlain(plainStart, pos);
        if (m[1]) tokens.push({ kind: 'text', text: m[1] });
        pos += m[0].length;
        plainStart = pos;
        continue;
      }
    }
    // Emphasis. Greedy on opener length so `**` wins over `*`.
    let opener = null;
    for (const [token, flag] of INLINE_PATTERNS) {
      if (text.startsWith(token, pos)) {
        opener = { token, flag };
        break;
      }
    }
    if (opener) {
      const closeIdx = text.indexOf(opener.token, pos + opener.token.length);
      if (closeIdx > pos + opener.token.length) {
        pushPlain(plainStart, pos);
        tokens.push({
          kind: 'styled',
          text: text.slice(pos + opener.token.length, closeIdx),
          [opener.flag]: true,
        });
        pos = closeIdx + opener.token.length;
        plainStart = pos;
        continue;
      }
      // No close found: skip the opener so we don't re-enter the same
      // position and loop forever, but leave it in the plain run.
      pos += opener.token.length;
      continue;
    }
    pos++;
  }
  pushPlain(plainStart, len);
  return tokens;
}
