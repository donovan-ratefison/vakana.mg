import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import { useTheme } from '../theme';
// Markdown sources are inlined into the JS bundle at build time by
// `babel-plugin-inline-import` (see babel.config.js). The plugin only
// rewrites `ImportDeclaration` nodes, not `require(...)` calls, so these
// must stay as ES imports. After transform, each binding is a plain
// string literal of the file's contents, with no asset system involved.
import userGuideMd from '../../docs/user-guide.md';
import possibilitiesMd from '../../docs/possibilities.md';

const GUIDES = {
  'user-guide': userGuideMd,
  'possibilities': possibilitiesMd,
};

// Slug of the `## 📋 Contents` heading both guides carry. It is the target of the
// back-to-contents pill, and the one section search skips (it is only links).
const CONTENTS_SLUG = '-contents';

// GitHub-style heading slugification. The TOC links in the docs are written
// like `[🔐 Setting up your PIN](#-setting-up-your-pin)`. The leading
// hyphen comes from the (stripped) emoji + space at the start of the
// heading. We mirror that exactly so anchors round-trip.
//
// The final replace maps EACH space to a hyphen. It must not collapse runs
// (`/\s+/g`). Stripping a `&` or an em-dash from a heading leaves the spaces
// that flanked it, and GitHub turns both into hyphens: `Themes & appearance`
// → `-themes--appearance`, double hyphen. Collapsing produced
// `-themes-appearance` and silently broke every anchor whose heading held a
// `&` or an em dash (U+2014): 18 of the 57 links across the two guides.
function slugify(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9 \-_]/gi, '')
    .replace(/ /g, '-');
}

// Undo markdown-it's percent-encoding of a link href. Malformed sequences
// throw, so fall back to the raw value rather than losing the anchor.
function decodeAnchor(raw) {
  try {
    return decodeURIComponent(raw || '');
  } catch (e) {
    return raw || '';
  }
}

// Split the guide into a preamble (title, intro, Contents: always shown)
// and one collapsible block per H2. H3+ stay inside their parent H2's body.
//
// This is what makes opening a guide cheap: ~22,600 words across the two
// guides used to parse into one element tree on mount. Only the preamble and
// whatever sections you've opened are rendered now.
//
// `innerSlugs` records every heading nested inside a section so an anchor
// pointing at an H3 (the user guide has one) can expand its owner before
// scrolling. Otherwise the target isn't mounted and the jump silently fails.
function splitIntoSections(md) {
  const preamble = [];
  const sections = [];
  let current = null;
  let inFence = false;
  let sawContents = false;

  for (const line of (md || '').split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      (current ? current.body : preamble).push(line);
      continue;
    }
    const h2 = inFence ? null : /^##(?!#)\s+(.*)$/.exec(line);
    if (h2) {
      const title = h2[1].trim();
      // The Contents list is the navigation hub. It stays in the preamble,
      // expanded, rather than becoming a section you have to open first.
      if (!sawContents && /contents/i.test(title)) {
        sawContents = true;
        current = null;
        preamble.push(line);
        continue;
      }
      current = { title, slug: slugify(title), body: [], innerSlugs: [] };
      sections.push(current);
      continue; // rendered by our own header row, not by <Markdown>
    }
    if (current && !inFence) {
      const inner = /^(#{3,6})\s+(.*)$/.exec(line);
      if (inner) current.innerSlugs.push(slugify(inner[2].trim()));
    }
    (current ? current.body : preamble).push(line);
  }

  return {
    preamble: preamble.join('\n'),
    sections: sections.map((s) => ({ ...s, body: s.body.join('\n') })),
  };
}

// Split the raw markdown into one record per heading: the section's title,
// its anchor slug, and the body lines beneath it. This is what search runs
// against. Searching the SOURCE rather than the rendered tree is what keeps
// the feature cheap. Highlighting matches in place would mean walking
// react-native-markdown-display's output and splicing spans; filtering the
// contents list instead reuses `scrollToAnchor`, which already works.
function buildSectionIndex(md) {
  const sections = [];
  let current = null;
  let inFence = false;
  for (const line of (md || '').split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      if (current) current.lines.push(line);
      continue;
    }
    const m = inFence ? null : /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      const title = m[2].trim();
      current = {
        level: m[1].length,
        title,
        slug: slugify(title),
        lines: [],
      };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections;
}

// Strip the markdown noise that would otherwise dominate a one-line snippet.
function plainify(line) {
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// A snippet centred on the match, so the hit is visible even when it falls
// deep in a long paragraph.
function snippetAround(line, q, width = 120) {
  const plain = plainify(line);
  const at = plain.toLowerCase().indexOf(q);
  if (at < 0) return plain.slice(0, width);
  const start = Math.max(0, at - Math.floor(width / 3));
  const out = plain.slice(start, start + width);
  return (start > 0 ? '…' : '') + out + (start + width < plain.length ? '…' : '');
}

// Walk a markdown-it AST node and concatenate every text leaf.
//
// Children are checked BEFORE `content`, and that order is the whole point.
// react-native-markdown-display's `createNode` copies `token.content` onto
// every node it builds, and a `heading_open` token's content is `''`. So a
// `typeof node.content === 'string'` guard placed first matches the empty
// string and returns immediately, never descending to the text leaves that
// actually hold the heading. That silently slugged EVERY heading to `''`, so
// all of them registered under one key and no anchor could ever resolve.
// Text leaves have `children: []` and their text in `content`, so they fall
// through to the second branch correctly.
function nodeText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node.children) && node.children.length > 0) {
    return node.children.map(nodeText).join('');
  }
  if (typeof node.content === 'string') return node.content;
  return '';
}

export default function SettingsGuideViewerScreen({ navigation, route }) {
  const guide = route?.params?.guide;
  const title = route?.params?.title || 'Guide';
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const mdStyles = useMemo(() => makeMarkdownStyles(colors), [colors]);

  const [content, setContent] = useState(null);
  const [error, setError] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  // Threshold-crossing only: onScroll fires per frame, so re-rendering on
  // every offset would cost more than the pill is worth.
  const [showTopPill, setShowTopPill] = useState(false);
  const showTopPillRef = useRef(false);
  const scrollRef = useRef(null);
  const searchInputRef = useRef(null);
  // Live scroll offset. The window-relative fallback needs it to convert a
  // viewport delta back into an absolute content offset.
  const scrollYRef = useRef(0);
  // Each heading View is registered here by slug. We measure on tap rather
  // than at layout time so the y is relative to the ScrollView's inner
  // content node (onLayout's y is relative to the immediate parent and
  // would be off by any wrapper offset / contentContainer padding).
  const headingRefs = useRef({});

  useEffect(() => {
    const text = GUIDES[guide];
    if (typeof text !== 'string') {
      setError('Unknown guide');
      return;
    }
    headingRefs.current = {};
    setContent(text);
    setError(null);
  }, [guide]);

  // Same ~250ms debounce the entry and thread lists use.
  useEffect(() => {
    const h = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(h);
  }, [query]);

  const sections = useMemo(() => buildSectionIndex(content), [content]);

  const doc = useMemo(() => splitIntoSections(content), [content]);

  // slug (section OR any heading nested in one) -> owning section slug.
  const ownerOf = useMemo(() => {
    const map = {};
    for (const s of doc.sections) {
      map[s.slug] = s.slug;
      for (const inner of s.innerSlugs) map[inner] = s.slug;
    }
    return map;
  }, [doc]);
  // Read through a ref inside scrollToAnchor, never from the closure. The
  // `rules` memo keys on [mdStyles], so the link rule (and the
  // scrollToAnchor it captures) is frozen at the FIRST render, when
  // `content` is still null and this map is therefore empty. Reading the
  // closure meant `ownerOf[slug]` was always undefined: the jump fell
  // through to the scroll and the target section never expanded, which
  // looked like the scroll working and the expansion being unimplemented.
  const ownerOfRef = useRef(ownerOf);
  ownerOfRef.current = ownerOf;

  const [expanded, setExpanded] = useState(() => new Set());
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  // Set when a jump lands in a collapsed section: the scroll has to wait for
  // the section to mount and lay out before its position can be measured.
  const pendingScrollRef = useRef(null);

  // Collapse everything again when switching guides.
  useEffect(() => {
    setExpanded(new Set());
    pendingScrollRef.current = null;
  }, [guide]);


  const allExpanded =
    doc.sections.length > 0 && expanded.size >= doc.sections.length;

  const toggleSection = (slug) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const toggleAll = () => {
    setExpanded(allExpanded ? new Set() : new Set(doc.sections.map((s) => s.slug)));
  };

  // The Contents section is nothing but links to the others. Matching it
  // would put a duplicate of the whole TOC at the top of every result set.
  const results = useMemo(() => {
    const q = debouncedQuery.toLowerCase();
    if (q.length < 2) return [];
    const out = [];
    for (const s of sections) {
      if (s.slug === CONTENTS_SLUG) continue;
      const titleHit = s.title.toLowerCase().includes(q);
      const hitLine = s.lines.find((l) => l.toLowerCase().includes(q));
      if (!titleHit && !hitLine) continue;
      out.push({
        slug: s.slug,
        title: s.title,
        level: s.level,
        snippet: hitLine ? snippetAround(hitLine, q) : '',
      });
    }
    return out;
  }, [sections, debouncedQuery]);

  const scrollToAnchor = (rawSlug) => {
    // Authored anchors can carry leftover variation-selector characters
    // (e.g. `✍️`) that the heading slugifier strips. Re-slugify the
    // incoming href so we always look up by the canonical form.
    //
    // Percent-DECODE first. markdown-it normalizes link hrefs and
    // percent-encodes anything non-ASCII, so an authored `#️-travel-and-place`
    // reaches us as `#%EF%B8%8F-travel-and-place`. slugify then strips the
    // `%` signs and leaves the hex behind (`efb88f-travel-and-place`), which
    // matches no heading. Affects exactly the anchors whose emoji carries a
    // variation selector (✈️ ⚗️ ✍️): 5 links across the two guides.
    const slug = slugify(decodeAnchor(rawSlug));

    // If the target lives in a collapsed section, open it and defer the
    // scroll: the heading isn't mounted (or laid out) until it expands.
    const owner = ownerOfRef.current[slug];
    if (owner && !expandedRef.current.has(owner)) {
      pendingScrollRef.current = slug;
      setExpanded((prev) => new Set(prev).add(owner));
      return;
    }
    scrollToSlugNow(slug);
  };

  const scrollToSlugNow = (slug) => {
    const headingRef = headingRefs.current[slug];
    const scrollNode = scrollRef.current?.getInnerViewNode?.();
    if (!headingRef) {
      // Never fail silently here again: a swallowed miss is exactly what
      // hid the nodeText bug that made every anchor dead from the start.
      console.warn(`Guide anchor '${slug}' has no registered heading`);
      return;
    }

    // Fallback: window-relative measurement needs no ancestor relationship,
    // so it survives whatever the markdown renderer wraps the headings in.
    // `measureLayout` is the fast path and does work today; this exists so a
    // renderer change degrades into a working scroll rather than a dead tap.
    const viaWindow = () => {
      if (
        typeof headingRef.measureInWindow !== 'function' ||
        typeof scrollRef.current?.measureInWindow !== 'function'
      ) {
        console.warn('Guide anchor: no usable measurement path');
        return;
      }
      scrollRef.current.measureInWindow((_sx, sy) => {
        headingRef.measureInWindow((_hx, hy) => {
          // Viewport delta + where we currently are = absolute content offset.
          const target = Math.max(0, scrollYRef.current + (hy - sy) - 12);
          scrollRef.current?.scrollTo({ y: target, animated: true });
        });
      });
    };

    if (scrollNode && typeof headingRef.measureLayout === 'function') {
      headingRef.measureLayout(
        scrollNode,
        (_x, y) => {
          // Pull above the heading a touch so it doesn't jam against the
          // top of the viewport.
          scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
        },
        viaWindow
      );
    } else {
      viaWindow();
    }
  };

  // Run a deferred jump once the newly-expanded section has laid out. A plain
  // rAF fires before native layout has settled often enough to miss, so give
  // it a short beat, imperceptible on a jump that already animates.
  useEffect(() => {
    const slug = pendingScrollRef.current;
    if (!slug) return;
    pendingScrollRef.current = null;
    const t = setTimeout(() => scrollToSlugNow(slug), 60);
    return () => clearTimeout(t);
  }, [expanded]);

  // Jump to a section from the results overlay. The document stays mounted
  // underneath the overlay precisely so this works: unmounting the markdown
  // while searching would drop every heading ref, and the re-mounted refs
  // wouldn't have been laid out yet when the scroll fires.
  const goToResult = (slug) => {
    setQuery('');
    setDebouncedQuery('');
    setSearchOpen(false);
    requestAnimationFrame(() => scrollToAnchor(slug));
  };

  const closeSearch = () => {
    setQuery('');
    setDebouncedQuery('');
    setSearchOpen(false);
  };

  const onScroll = (e) => {
    const y = e.nativeEvent?.contentOffset?.y ?? 0;
    scrollYRef.current = y;
    const should = y > 700;
    if (should !== showTopPillRef.current) {
      showTopPillRef.current = should;
      setShowTopPill(should);
    }
  };

  // Back to the Contents list, not raw top: the TOC is the hub, and on
  // these guides it sits a couple of paragraphs down.
  const goToContents = () => {
    if (headingRefs.current[CONTENTS_SLUG]) {
      scrollToAnchor(CONTENTS_SLUG);
    } else {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  };

  const headingRule = (level) => (node, children) => {
    const slug = slugify(nodeText(node));
    const styleKey = `heading${level}`;
    return (
      <View
        key={node.key}
        ref={(r) => {
          if (r) headingRefs.current[slug] = r;
        }}
      >
        <Text style={mdStyles[styleKey]}>{children}</Text>
      </View>
    );
  };

  // Override the link rule so `#anchor` taps scroll inside the viewer
  // instead of being handed off to the system (which would do nothing).
  const linkRule = (node, children) => {
    const href = node.attributes?.href || '';
    const onPress = () => {
      if (href.startsWith('#')) {
        scrollToAnchor(href.slice(1));
      } else if (href) {
        Linking.openURL(href).catch(() => {});
      }
    };
    return (
      <Text key={node.key} style={mdStyles.link} onPress={onPress}>
        {children}
      </Text>
    );
  };

  const rules = useMemo(
    () => ({
      heading1: headingRule(1),
      heading2: headingRule(2),
      heading3: headingRule(3),
      heading4: headingRule(4),
      link: linkRule,
    }),
    [mdStyles]
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        {/* Reuses the header's existing right-hand slot: no new persistent
            chrome; the field only exists once you ask for it. */}
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => {
            if (searchOpen) closeSearch();
            else setSearchOpen(true);
          }}
          accessibilityLabel={searchOpen ? 'Close search' : 'Search this guide'}
        >
          <Ionicons
            name={searchOpen ? 'close' : 'search'}
            size={20}
            color={colors.primary}
          />
        </TouchableOpacity>
      </View>

      {searchOpen ? (
        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={colors.textFaint} />
          <TextInput
            ref={searchInputRef}
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search this guide"
            placeholderTextColor={colors.placeholder}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 ? (
            <TouchableOpacity
              onPress={() => setQuery('')}
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close-circle" size={18} color={colors.textFaint} />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {content == null && !error ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.loading}>
          <Text style={styles.errorText}>Could not load guide: {error}</Text>
        </View>
      ) : (
        <View style={styles.body}>
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.content}
            onScroll={onScroll}
            scrollEventThrottle={16}
          >
            {/* Preamble: title, intro, and the Contents list. Always shown,
                because it is how you get anywhere else. */}
            <Markdown style={mdStyles} rules={rules}>
              {doc.preamble}
            </Markdown>

            {doc.sections.length > 0 ? (
              <TouchableOpacity
                style={styles.expandAllRow}
                onPress={toggleAll}
                accessibilityLabel={
                  allExpanded ? 'Collapse all sections' : 'Expand all sections'
                }
              >
                <Ionicons
                  name={allExpanded ? 'contract-outline' : 'expand-outline'}
                  size={15}
                  color={colors.primary}
                />
                <Text style={styles.expandAllText}>
                  {allExpanded ? 'Collapse all' : 'Expand all'}
                </Text>
              </TouchableOpacity>
            ) : null}

            {doc.sections.map((s) => {
              const open = expanded.has(s.slug);
              return (
                <View key={s.slug}>
                  {/* Ref lives on a plain View, not the Touchable: it is the
                      scroll target and plain Views reliably expose the
                      measure methods. It renders whether or not the section
                      is open, so a collapsed section is still jumpable. */}
                  <View
                    ref={(r) => {
                      if (r) headingRefs.current[s.slug] = r;
                    }}
                  >
                    <TouchableOpacity
                      style={styles.sectionRow}
                      onPress={() => toggleSection(s.slug)}
                      accessibilityLabel={`${open ? 'Collapse' : 'Expand'} ${s.title}`}
                    >
                      <Text style={styles.sectionRowText}>{s.title}</Text>
                      <Ionicons
                        name={open ? 'chevron-up' : 'chevron-down'}
                        size={18}
                        color={colors.textFaint}
                      />
                    </TouchableOpacity>
                  </View>
                  {open ? (
                    <Markdown style={mdStyles} rules={rules}>
                      {s.body}
                    </Markdown>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>

          {/* Overlaid, not swapped: the document below stays mounted so its
              heading refs survive and a tapped result can scroll straight to
              a node that has already been laid out. */}
          {searchOpen && debouncedQuery.trim().length >= 2 ? (
            <View style={styles.overlay}>
              <ScrollView
                contentContainerStyle={styles.resultsContent}
                keyboardShouldPersistTaps="handled"
              >
                <Text style={styles.resultsCount}>
                  {results.length === 0
                    ? 'No sections match'
                    : `${results.length} section${results.length === 1 ? '' : 's'}`}
                </Text>
                {results.map((r) => (
                  <TouchableOpacity
                    key={r.slug}
                    style={styles.resultRow}
                    onPress={() => goToResult(r.slug)}
                    accessibilityLabel={`Jump to ${r.title}`}
                  >
                    <Text style={styles.resultTitle} numberOfLines={2}>
                      {r.title}
                    </Text>
                    {r.snippet ? (
                      <Text style={styles.resultSnippet} numberOfLines={2}>
                        {r.snippet}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                ))}
                {results.length === 0 ? (
                  <Text style={styles.resultsHint}>
                    Try a shorter word, or a word that a heading can contain.
                  </Text>
                ) : null}
              </ScrollView>
            </View>
          ) : null}

          {showTopPill && !searchOpen ? (
            <TouchableOpacity
              style={styles.topPill}
              onPress={goToContents}
              accessibilityLabel="Back to contents"
            >
              <Ionicons name="list" size={16} color={colors.primaryOnPrimary} />
              <Text style={styles.topPillText}>Contents</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingTop: 60,
      paddingBottom: 12,
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
      paddingHorizontal: 8,
    },
    iconButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceMuted,
      justifyContent: 'center',
      alignItems: 'center',
    },
    content: { padding: 20, paddingBottom: 60 },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
    errorText: { color: colors.danger, fontSize: 14, textAlign: 'center' },
    body: { flex: 1 },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 20,
      marginBottom: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.border,
    },
    searchInput: {
      flex: 1,
      color: colors.text,
      fontSize: 15,
      padding: 0,
    },
    overlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.background,
    },
    resultsContent: { padding: 20, paddingBottom: 60 },
    resultsCount: {
      color: colors.textFaint,
      fontSize: 12,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 10,
    },
    resultRow: {
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 10,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 8,
    },
    resultTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
    resultSnippet: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 4,
    },
    resultsHint: {
      color: colors.textFaint,
      fontSize: 13,
      lineHeight: 19,
      marginTop: 4,
    },
    expandAllRow: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 6,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 8,
      backgroundColor: colors.surfaceMuted,
      marginTop: 4,
      marginBottom: 12,
    },
    expandAllText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
    sectionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      paddingVertical: 14,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    sectionRowText: {
      flex: 1,
      color: colors.text,
      fontSize: 17,
      fontWeight: '700',
    },
    topPill: {
      position: 'absolute',
      right: 20,
      bottom: 28,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 20,
      backgroundColor: colors.primary,
    },
    topPillText: {
      color: colors.primaryOnPrimary,
      fontSize: 13,
      fontWeight: '700',
    },
  });

const makeMarkdownStyles = (colors) => ({
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  heading1: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginTop: 8,
    marginBottom: 8,
  },
  heading2: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginTop: 16,
    marginBottom: 6,
  },
  heading3: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    marginTop: 12,
    marginBottom: 4,
  },
  heading4: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 8 },
  paragraph: { color: colors.text, marginTop: 4, marginBottom: 8 },
  strong: { fontWeight: '700', color: colors.text },
  em: { fontStyle: 'italic', color: colors.text },
  link: { color: colors.primary, textDecorationLine: 'underline' },
  bullet_list: { marginVertical: 4 },
  ordered_list: { marginVertical: 4 },
  list_item: { color: colors.text, marginVertical: 2 },
  bullet_list_icon: { color: colors.primary, marginRight: 8, fontSize: 18, lineHeight: 22 },
  ordered_list_icon: { color: colors.primary, marginRight: 8, fontSize: 15, lineHeight: 22 },
  code_inline: {
    backgroundColor: colors.surfaceMuted,
    color: colors.text,
    paddingHorizontal: 4,
    borderRadius: 4,
    fontFamily: 'monospace',
  },
  code_block: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 12,
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: 13,
  },
  fence: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 12,
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: 13,
    borderWidth: 1,
    borderColor: colors.border,
  },
  blockquote: {
    backgroundColor: colors.surfaceMuted,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginVertical: 6,
    color: colors.textMuted,
  },
  hr: {
    backgroundColor: colors.border,
    height: 1,
    marginVertical: 16,
  },
});
