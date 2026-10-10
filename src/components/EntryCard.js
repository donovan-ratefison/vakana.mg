import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import BeadView from './BeadView';
import BeadChain from './BeadChain';
import { readBead, GLASS_GATE } from '../beads/types';
import { loadComments, PARENT_ENTRY } from '../services/comments';
import { loadThreadsForEntry } from '../services/threadMembership';
import { buildChainItems } from './ThreadCard';
import { isPrivate, MASKED_TITLE } from '../utils/privacy';
import { formatTimeLabel } from '../utils/dateString';
import MarkdownInline from './MarkdownInline';

export default function EntryCard({
  entry,
  onPress,
  onLongPress,
  onBeadLongPress,
  onOpenThread,
  inlineCommentsDefault = false,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const photoCount = entry.photos?.length ?? 0;
  const voiceCount = entry.voiceNotes?.length ?? 0;
  const totalCommentCount = entry.commentCount ?? 0;
  const threadCount = entry.threadCount ?? 0;
  // Populated only on bead-filtered lists (see HomeScreen). When present
  // and non-empty, the numeric thread chip becomes a name strip so a
  // bead-search result says *whose* bead it is without a tap. Up to 2
  // names, then +N. Pairs (the dominant cross-arc arity) resolve inline;
  // long names truncate so the row never grows.
  const beadThreadNames = Array.isArray(entry.beadThreadNames)
    ? entry.beadThreadNames
    : null;
  const showNameStrip = beadThreadNames != null && beadThreadNames.length > 0;
  const bead = readBead(entry);
  // Leading-bead sizing: pin every row's leading slot to a uniform width so
  // titles never indent differently. oval (1.4×) and bar (1.6×) render wider
  // than `size` (see BeadView.sizeOf), so shrink those two so their bounding
  // box fits the slot; all other shapes (incl. the narrow dot) stay full size.
  const LEADING_BOX = 40;
  const leadingBeadSize =
    LEADING_BOX / ({ oval: 1.4, bar: 1.6 }[bead?.shape] || 1);

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const priv = isPrivate(entry);
  const title = priv ? MASKED_TITLE : entry.title || 'Untitled';
  const excerpt = priv ? '' : entry.content || '';

  // Per-card preview state. The global toggle sets the *default* visibility
  // of the preview block; tapping the card's 💬 chip locally overrides it.
  // A change to the global default resets every card's local state. The
  // user-facing rule is: "global = default, chip = override; toggling the
  // global wipes overrides".
  const [previewVisible, setPreviewVisible] = useState(inlineCommentsDefault);
  const [expandedAll, setExpandedAll] = useState(false);
  const [fullComments, setFullComments] = useState(null);
  // Threads preview is always off by default. There is no global toggle
  // for it (yet), so tapping the chip is the only way in.
  const [threadsVisible, setThreadsVisible] = useState(false);
  const [threadsData, setThreadsData] = useState(null);
  useEffect(() => {
    setPreviewVisible(inlineCommentsDefault);
    setExpandedAll(false);
    setFullComments(null);
    setThreadsVisible(false);
    setThreadsData(null);
  }, [inlineCommentsDefault, entry.id]);

  const handleToggleChip = () => setPreviewVisible((v) => !v);
  const handleToggleThreads = async () => {
    const next = !threadsVisible;
    setThreadsVisible(next);
    if (next && !threadsData) {
      const rows = await loadThreadsForEntry(entry.id);
      setThreadsData(rows);
    }
  };
  const handleViewAll = async () => {
    if (!fullComments) {
      const all = await loadComments(PARENT_ENTRY, entry.id);
      setFullComments(all);
    }
    setExpandedAll(true);
  };
  const handleCollapseAll = () => setExpandedAll(false);

  const previewSlice = entry.commentsPreview || [];
  const displayedComments =
    expandedAll && fullComments ? fullComments : previewSlice;
  const remainingHidden = Math.max(
    0,
    totalCommentCount - displayedComments.length
  );

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      activeOpacity={0.7}
    >
      <View style={styles.cardRow}>
        <View style={styles.leftCol}>
          {bead ? (
            // Bead aperture has its own touchable so a long-press here is
            // the "set as filter" gesture (A2). Nesting a TouchableOpacity
            // inside the card's outer TouchableOpacity makes the inner one
            // win the RN gesture arena: long-pressing the bead does NOT
            // also fire the card's onLongPress (multi-select); long-press
            // elsewhere on the card still enters multi-select unchanged.
            // Tap on the bead falls through to onPress (opens the entry)
            // so the existing tap affordance is preserved.
            <TouchableOpacity
              style={styles.beadSlot}
              onPress={onPress}
              onLongPress={onBeadLongPress}
              delayLongPress={350}
              activeOpacity={0.7}
              hitSlop={6}
              accessibilityLabel="Bead. Tap to open the entry. Long-press to filter by this bead."
            >
              {/* Force the glass finish by the SLOT size (LEADING_BOX), not the
                  per-shape shrunk size. Otherwise wide shapes (oval/bar),
                  scaled below GLASS_GATE to fit the column, render flat. */}
              <BeadView
                bead={bead}
                size={leadingBeadSize}
                glossy={LEADING_BOX >= GLASS_GATE}
              />
              {(entry.highlight_tier ?? 0) > 0 ? (
                <View
                  style={[
                    styles.highlightBadge,
                    (entry.highlight_tier ?? 0) >= 2 && styles.highlightBadgeMonthly,
                  ]}
                >
                  <Ionicons
                    name="star"
                    size={9}
                    color={colors.primaryOnPrimary}
                  />
                </View>
              ) : null}
            </TouchableOpacity>
          ) : (
            // No bead yet: a faint note glyph fills the leading slot (themed,
            // same Ionicons family as the rest of the app), so a bead-less
            // entry still carries a leading marker and titles stay aligned. A
            // highlight pip overlays it, mirroring the beaded case.
            <View style={styles.noteCircle}>
              <Ionicons
                name="document-text-outline"
                size={20}
                color={colors.textFaint}
              />
              {(entry.highlight_tier ?? 0) > 0 ? (
                <View
                  style={[
                    styles.highlightBadge,
                    (entry.highlight_tier ?? 0) >= 2 && styles.highlightBadgeMonthly,
                  ]}
                >
                  <Ionicons
                    name="star"
                    size={9}
                    color={colors.primaryOnPrimary}
                  />
                </View>
              ) : null}
            </View>
          )}
        </View>
        <View style={styles.body}>
          <Text
            style={[styles.title, priv && styles.titlePrivate]}
            numberOfLines={1}
          >
            {title}
          </Text>
          {excerpt ? (
            <MarkdownInline style={styles.excerpt} numberOfLines={1}>
              {excerpt}
            </MarkdownInline>
          ) : null}
          {(photoCount > 0 || voiceCount > 0 || totalCommentCount > 0 || threadCount > 0) && (
            <View style={styles.metaRow}>
              {photoCount > 0 && (
                <View style={styles.metaItem}>
                  <Ionicons name="image-outline" size={12} color={colors.textMuted} />
                  <Text style={styles.metaText}>{photoCount}</Text>
                </View>
              )}
              {voiceCount > 0 && (
                <View style={styles.metaItem}>
                  <Ionicons name="mic-outline" size={12} color={colors.textMuted} />
                  <Text style={styles.metaText}>{voiceCount}</Text>
                </View>
              )}
              {threadCount > 0 && (
                <TouchableOpacity
                  onPress={handleToggleThreads}
                  style={[styles.metaItem, styles.threadsChip]}
                  hitSlop={6}
                  accessibilityLabel={
                    showNameStrip
                      ? `Bead is on ${beadThreadNames.length} thread${beadThreadNames.length === 1 ? '' : 's'}: ${beadThreadNames
                          .map((t) => t.name || 'Untitled')
                          .join(', ')}. Tap to ${threadsVisible ? 'hide' : 'show'} preview.`
                      : `In ${threadCount} thread${threadCount === 1 ? '' : 's'}. Tap to ${threadsVisible ? 'hide' : 'show'} preview.`
                  }
                >
                  <Ionicons
                    name={threadsVisible ? 'git-network' : 'git-network-outline'}
                    size={12}
                    color={threadsVisible ? colors.primary : colors.textMuted}
                  />
                  {showNameStrip ? (
                    <>
                      {beadThreadNames.slice(0, 2).map((t, i) => (
                        <React.Fragment key={t.id}>
                          {i > 0 ? (
                            <Text style={styles.threadNameSep}>·</Text>
                          ) : null}
                          <Text
                            style={[
                              styles.threadNamePill,
                              threadsVisible && styles.metaTextActive,
                            ]}
                            numberOfLines={1}
                          >
                            {t.name || 'Untitled'}
                          </Text>
                        </React.Fragment>
                      ))}
                      {beadThreadNames.length > 2 ? (
                        <Text
                          style={[
                            styles.metaText,
                            threadsVisible && styles.metaTextActive,
                          ]}
                        >
                          +{beadThreadNames.length - 2}
                        </Text>
                      ) : null}
                    </>
                  ) : (
                    <Text
                      style={[
                        styles.metaText,
                        threadsVisible && styles.metaTextActive,
                      ]}
                    >
                      {threadCount}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
              {totalCommentCount > 0 && (
                <TouchableOpacity
                  onPress={handleToggleChip}
                  style={[styles.metaItem, styles.commentsChip]}
                  hitSlop={6}
                  accessibilityLabel={`${totalCommentCount} comment${totalCommentCount === 1 ? '' : 's'}. Tap to ${previewVisible ? 'hide' : 'show'} preview.`}
                >
                  <Ionicons
                    name={previewVisible ? 'chatbubble' : 'chatbubble-outline'}
                    size={11}
                    color={previewVisible ? colors.primary : colors.textMuted}
                  />
                  <Text
                    style={[
                      styles.metaText,
                      previewVisible && styles.metaTextActive,
                    ]}
                  >
                    {totalCommentCount}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
        <View style={styles.rightCol}>
          <Text style={styles.date}>{formatDate(entry.date)}</Text>
          {entry.time ? (
            <Text style={styles.time}>{formatTimeLabel(entry.time)}</Text>
          ) : null}
        </View>
      </View>
      {previewVisible && totalCommentCount > 0 ? (
        <View style={styles.previewBlock}>
          {displayedComments.map((c) => (
            <View key={c.id} style={styles.previewRow}>
              <View style={styles.previewDot} />
              <MarkdownInline
                style={styles.previewBody}
                numberOfLines={3}
                strike={!!c.resolved_at}
              >
                {c.body}
              </MarkdownInline>
            </View>
          ))}
          {remainingHidden > 0 ? (
            <TouchableOpacity onPress={handleViewAll} hitSlop={4}>
              <Text style={styles.previewMore}>
                View all {totalCommentCount} comments
              </Text>
            </TouchableOpacity>
          ) : expandedAll && totalCommentCount > previewSlice.length ? (
            <TouchableOpacity onPress={handleCollapseAll} hitSlop={4}>
              <Text style={styles.previewMore}>Show less</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
      {threadsVisible && threadCount > 0 ? (
        <View style={styles.threadsBlock}>
          {threadsData === null ? (
            <Text style={styles.threadsLoading}>Loading…</Text>
          ) : threadsData.length === 0 ? (
            <Text style={styles.threadsLoading}>No threads</Text>
          ) : (
            threadsData.map((t) => (
              <TouchableOpacity
                key={t.id}
                style={styles.threadRow}
                onPress={() => onOpenThread?.(t.id)}
                activeOpacity={0.7}
              >
                <Text style={styles.threadName} numberOfLines={1}>
                  {t.name || 'Untitled'}
                </Text>
                {t.preview && t.preview.length > 0 ? (
                  <BeadChain
                    beadSize={12}
                    connectorColor={colors.border}
                    capColor={colors.border}
                    stroke={1.5}
                    jointDotSize={3}
                    rowGap={8}
                    items={buildChainItems(t.preview)}
                  />
                ) : (
                  <Text style={styles.threadEmpty}>No beads</Text>
                )}
              </TouchableOpacity>
            ))
          )}
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    card: {
      // Flat WhatsApp-style rows: no card box (border / rounding / gap). The
      // entries flow continuously, separated only by a hairline divider. The
      // horizontal inset lives here now (listContent no longer pads), so the
      // row + its divider span edge to edge.
      // No surface tint: rows sit on the screen background so the list reads
      // flat (WhatsApp-style). It's the background color, not transparent, so it
      // still covers the swipe actions sitting behind each row until you swipe.
      backgroundColor: colors.background,
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    cardRow: {
      flexDirection: 'row',
      // Stretch so the leading bead column and the trailing date column both
      // take the row's full height. This lets the bead sit vertically centred
      // across the title + excerpt (the body) instead of pinned to the first
      // line. The body is centred too, so a title-only row still aligns its
      // title with the bead; the date stays pinned to the top (see rightCol).
      alignItems: 'stretch',
    },
    // Leading bead column: the entry's bead reads as the row's "avatar"
    // (flat-list pattern): bigger, on the left, and vertically centred so it
    // spans ~two text lines (title + excerpt). FIXED width (= LEADING_BOX in
    // the component) so the column never grows with a wide bead form (oval /
    // bar): every row's title aligns, beaded or not. Wide beads are shrunk to
    // fit this box; the note ring matches it.
    leftCol: {
      width: 40,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    body: {
      flex: 1,
      marginRight: 10,
      // Centred vertically so the text block aligns with the centred bead (a
      // no-op on a tall multi-line row; on a title-only row it centres the
      // title against the bead).
      justifyContent: 'center',
    },
    // Trailing column: just the date (+ optional time). Pinned to the top
    // (flex-start) so the date keeps the conventional top-right position even
    // though the row is taller now; right-aligned so it hugs the edge.
    rightCol: {
      justifyContent: 'flex-start',
      alignItems: 'flex-end',
      gap: 4,
    },
    beadSlot: {
      justifyContent: 'center',
      alignItems: 'center',
    },
    // Small filled-star pip overlaid on the top-right of the bead. Faint
    // border for weekly (tier 1); bordered halo for monthly (tier 2) so a
    // glance at the home row tells you the curation tier without opening
    // the entry.
    highlightBadge: {
      position: 'absolute',
      top: -4,
      right: -6,
      width: 14,
      height: 14,
      borderRadius: 7,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.surface,
    },
    // No-bead leading marker: a faint round ring (a "bead-shaped" slot) with
    // the note glyph inside, so a bead-less entry reads as deliberately
    // un-beaded and lines up with the real beads in the column.
    noteCircle: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: 1.5,
      borderColor: colors.border,
      justifyContent: 'center',
      alignItems: 'center',
    },
    // Monthly tier gets a thicker ring so the upgrade reads as a halo:
    // weekly stars are common, monthly stars are rarer and louder.
    highlightBadgeMonthly: {
      borderWidth: 2,
      borderColor: colors.primary,
    },
    title: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
    },
    titlePrivate: {
      color: colors.textMuted,
      fontWeight: '500',
      fontStyle: 'italic',
    },
    date: {
      color: colors.primary,
      fontSize: 12,
      fontWeight: '600',
    },
    // Sits just under the date, only when the entry carries an optional
    // time-of-day. Quieter than the date so it reads as a refinement.
    // It uses textMuted, not textFaint: it is information, not decoration.
    time: {
      color: colors.textMuted,
      fontSize: 10,
      fontWeight: '500',
      marginTop: -2,
    },
    excerpt: {
      color: colors.textMuted,
      fontSize: 13,
      marginTop: 2,
    },
    metaRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 4,
    },
    metaItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
    },
    // Counts (photos, voice, mentions, comments) carry information, so they
    // sit on textMuted. textFaint is for decoration only.
    metaText: {
      color: colors.textMuted,
      fontSize: 11,
    },
    metaTextActive: {
      color: colors.primary,
    },
    commentsChip: {
      // Dressed-up metaItem so the inner TouchableOpacity reads as a tap
      // target distinct from the photo/voice glyphs.
      paddingVertical: 2,
      paddingHorizontal: 4,
      marginLeft: -4,
      borderRadius: 8,
    },
    threadsChip: {
      paddingVertical: 2,
      paddingHorizontal: 4,
      marginLeft: -4,
      borderRadius: 8,
    },
    // Inline thread-name strip (bead-filtered lists only). Names read a
    // touch stronger than the faint count meta since they're the answer
    // the user is scanning for; maxWidth keeps a long name from growing
    // the row: it truncates, the +N still tells the plurality.
    threadNamePill: {
      color: colors.textMuted,
      fontSize: 11,
      maxWidth: 96,
    },
    threadNameSep: {
      color: colors.textFaint,
      fontSize: 11,
    },
    threadsBlock: {
      marginTop: 8,
      // Indent so the nested block aligns under the title text, not the bead:
      // leftCol width (40) + its marginRight (12) = 52. The quote bar then
      // sits at the title's left edge with the thread rows nested just inside.
      marginLeft: 52,
      paddingLeft: 6,
      borderLeftWidth: 2,
      borderLeftColor: colors.border,
      gap: 4,
    },
    threadsLoading: {
      color: colors.textFaint,
      fontSize: 11,
      fontStyle: 'italic',
    },
    threadRow: {
      gap: 2,
    },
    threadName: {
      color: colors.textMuted,
      fontSize: 11,
      lineHeight: 14,
    },
    threadEmpty: {
      color: colors.textFaint,
      fontSize: 11,
      fontStyle: 'italic',
    },
    previewBlock: {
      marginTop: 8,
      // Indent to align under the title text, not the bead (leftCol 40 +
      // marginRight 12 = 52). Matches threadsBlock.
      marginLeft: 52,
      paddingLeft: 6,
      borderLeftWidth: 2,
      borderLeftColor: colors.border,
      gap: 3,
    },
    previewMore: {
      color: colors.textFaint,
      fontSize: 10,
      fontWeight: '600',
      marginBottom: 2,
    },
    previewRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 5,
    },
    previewDot: {
      width: 4,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderStrong,
      marginTop: 6,
    },
    previewBody: {
      flex: 1,
      color: colors.textMuted,
      fontSize: 11,
      lineHeight: 15,
    },
  });
