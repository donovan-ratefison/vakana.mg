import React, { useMemo } from 'react';
import { View, Linking } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { useTheme } from '../theme';

// Renders entry/comment content as markdown for read-surfaces. The DB
// column is plain text; this is purely a view treatment. Editor focus
// keeps the raw source visible; blur swaps to this component.
//
// "Journal" tone: bold/italic dominate. Headings are intentionally only
// a hair larger than body so a stray `#` reads as emphasis, not as a
// document-style section break.
export default function MarkdownText({ children, style, strike = false }) {
  const { colors } = useTheme();
  const baseStyles = useMemo(() => makeMarkdownStyles(colors), [colors]);
  // `strike` renders a resolved comment loop struck-through. The lib styles
  // each node independently (no RN-style inheritance), so we can't just set
  // text-decoration on the wrapper. We dim + strike every text-bearing
  // rule, and force a `text` rule (the leaf every string flows through).
  const mdStyles = useMemo(() => {
    if (!strike) return baseStyles;
    const out = {};
    for (const [k, v] of Object.entries(baseStyles)) {
      out[k] =
        v && typeof v === 'object' && 'color' in v
          ? { ...v, color: colors.textFaint, textDecorationLine: 'line-through' }
          : v;
    }
    out.text = { color: colors.textFaint, textDecorationLine: 'line-through' };
    return out;
  }, [baseStyles, strike, colors]);
  const text = typeof children === 'string' ? children : String(children ?? '');
  const onLinkPress = (url) => {
    if (url) Linking.openURL(url).catch(() => {});
    return false;
  };
  if (!text) return null;
  return (
    <View style={style}>
      <Markdown style={mdStyles} onLinkPress={onLinkPress}>
        {text}
      </Markdown>
    </View>
  );
}

const makeMarkdownStyles = (colors) => ({
  body: { color: colors.text, fontSize: 16, lineHeight: 24 },
  heading1: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginTop: 6,
    marginBottom: 4,
  },
  heading2: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    marginTop: 6,
    marginBottom: 4,
  },
  heading3: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginTop: 4,
    marginBottom: 2,
  },
  heading4: { fontSize: 16, fontWeight: '700', color: colors.text },
  heading5: { fontSize: 16, fontWeight: '700', color: colors.text },
  heading6: { fontSize: 16, fontWeight: '700', color: colors.text },
  paragraph: { color: colors.text, marginTop: 0, marginBottom: 8 },
  strong: { fontWeight: '700', color: colors.text },
  em: { fontStyle: 'italic', color: colors.text },
  s: { textDecorationLine: 'line-through', color: colors.textMuted },
  link: { color: colors.primary, textDecorationLine: 'underline' },
  bullet_list: { marginVertical: 2 },
  ordered_list: { marginVertical: 2 },
  list_item: { color: colors.text, marginVertical: 1 },
  bullet_list_icon: {
    color: colors.primary,
    marginRight: 6,
    fontSize: 18,
    lineHeight: 24,
  },
  ordered_list_icon: {
    color: colors.primary,
    marginRight: 6,
    fontSize: 16,
    lineHeight: 24,
  },
  code_inline: {
    backgroundColor: colors.surfaceMuted,
    color: colors.text,
    paddingHorizontal: 4,
    borderRadius: 4,
    fontFamily: 'monospace',
    fontSize: 14,
  },
  code_block: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 10,
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: 13,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fence: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 10,
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: 13,
    borderWidth: 1,
    borderColor: colors.border,
  },
  blockquote: {
    borderLeftWidth: 2,
    borderLeftColor: colors.borderStrong,
    paddingLeft: 10,
    marginVertical: 4,
    color: colors.textMuted,
  },
  hr: { backgroundColor: colors.border, height: 1, marginVertical: 10 },
});
