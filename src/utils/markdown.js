// Strip the common markdown tokens for tight previews where a Markdown
// block render would be wasted (1- or 3-line excerpts on cards and
// bubble tooltips). Source stays in the DB; MarkdownText handles full
// rendering on detail surfaces.
export function stripMarkdown(text) {
  if (!text) return '';
  let s = String(text);
  // Fenced blocks: keep inner text, drop the fences and optional language tag.
  s = s.replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?|```/g, ''));
  // Inline code.
  s = s.replace(/`([^`]+)`/g, '$1');
  // Images: ![alt](url) → alt.
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  // Links: [text](url) → text.
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // Emphasis pairs: pair-aware so a lone `*` doesn't strip surrounding text.
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/__([^_]+)__/g, '$1');
  s = s.replace(/\*([^*]+)\*/g, '$1');
  s = s.replace(/_([^_]+)_/g, '$1');
  s = s.replace(/~~([^~]+)~~/g, '$1');
  // Line-leading tokens: headings, blockquotes, list markers.
  s = s.replace(/^\s*#{1,6}\s+/gm, '');
  s = s.replace(/^\s*>\s?/gm, '');
  s = s.replace(/^\s*[-*+]\s+/gm, '');
  s = s.replace(/^\s*\d+\.\s+/gm, '');
  // Horizontal rules on their own line.
  s = s.replace(/^\s*[-*_]{3,}\s*$/gm, '');
  // Collapse whitespace for single-line preview consumers.
  return s.replace(/\s+/g, ' ').trim();
}
