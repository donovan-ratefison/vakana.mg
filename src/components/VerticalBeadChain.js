import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BeadView, { beadOuterWidth } from './BeadView';
import { loadComments, PARENT_ENTRY } from '../services/comments';
import { useTheme } from '../theme';
import { isPrivate, MASKED_TITLE } from '../utils/privacy';
import MarkdownInline from './MarkdownInline';

const COMMENT_PREVIEW_SLICE = 2;
// Bubble body teaser height. Collapsed, the note clips to this many lines
// (block-rendered, so a list keeps its line breaks); "More" lifts the cap.
const BODY_PREVIEW_LINES = 6;

const ROW_HEIGHT = 46;
const BEAD_SIZE = 28;
const BEAD_COL_LEFT = 20;
const BEAD_CENTER_X = BEAD_COL_LEFT + BEAD_SIZE / 2;
const CONNECTOR_WIDTH = 2;
const TAIL_SIZE = 10;
const BUBBLE_LEFT = BEAD_COL_LEFT + BEAD_SIZE + 14;
// Where the pendant tag sits when a bead carries a sectionLabel. A
// thin horizontal tick connects the bead's right edge to the caption
// in the margin between the bead column and the bubble's leftmost
// reach. Tag is hidden when the bead's bubble is the one expanded
// (the bubble would overlap it).
const PENDANT_LEFT = BEAD_COL_LEFT + BEAD_SIZE + 4;

// Vertical alternative to BeadChain. Renders the chain as a column of beads
// joined by a thin vertical connector. Tapping a bead opens a tooltip-style
// popover anchored to its right with the entry title and a clamped excerpt;
// when the note is longer, an inline More…/Less grows the bubble in place.
// Accordion: tapping a different bead swaps the popover; tapping the same
// bead closes it. Private entries show a masked title and no excerpt.
//
// Controlled component: parent owns expandedKey + onChangeExpanded for the
// accordion. The bubble is absolute-positioned *inside the chain* (it
// scrolls with the content, anchored to its bead), so the parent must NOT
// dismiss it on scroll: that made reading an expanded note impossible
// (the gesture to scroll to the rest was the gesture that closed it).
//
// items shape: [{ key, entryId, bead, faded, entry: { title, content,
//   is_private, commentCount } }]
export default function VerticalBeadChain({
  items,
  expandedKey,
  onChangeExpanded,
  onOpenEntry,
  onLongPressItem,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Measured height of the expanded bubble (see bottomSpacer below).
  // Declared before the early return so hook order stays stable.
  const [bubbleH, setBubbleH] = useState(0);

  if (!items?.length) return null;

  const expandedIndex = items.findIndex((it) => it.key === expandedKey);

  // The expanded bubble is position:absolute (so it overlays and isn't
  // dismissed on scroll), which means it contributes ZERO height to the
  // ScrollView. For the last bead there's no row below it, so a long
  // expanded note overflows past the scrollable content and its bottom
  // is unreachable. Measure the bubble and add an in-flow bottom spacer
  // equal to however far it overruns the row stack (plus a gutter that
  // also clears ThreadDetail's floating FAB). Exact for any length.
  const BUBBLE_BOTTOM_GUTTER = 72;
  let bottomSpacer = 0;
  if (expandedIndex >= 0 && bubbleH > 0) {
    const rowsH = ROW_HEIGHT * items.length;
    const bubbleTop = ROW_HEIGHT * expandedIndex + ROW_HEIGHT / 2 - 24;
    bottomSpacer = Math.max(
      0,
      bubbleTop + bubbleH + BUBBLE_BOTTOM_GUTTER - rowsH
    );
  }

  return (
    <View style={styles.container}>
      {items.map((item, i) => {
        const isFirst = i === 0;
        const isLast = i === items.length - 1;
        const showPendant = !!item.sectionLabel && item.key !== expandedKey;
        return (
          <View key={item.key} style={styles.row}>
            {!isFirst ? (
              <View style={[styles.connector, styles.connectorTop]} />
            ) : null}
            {!isLast ? (
              <View style={[styles.connector, styles.connectorBottom]} />
            ) : null}
            {(() => {
              // Center each bead's container on the connector column
              // regardless of its shape's outer width. Bar/oval render
              // wider than BEAD_SIZE; dot renders narrower. Without
              // this offset they anchor to the connector's left edge
              // instead of sitting visually on it. Touch target stays
              // at least BEAD_SIZE wide so dots are still tappable.
              const outerW = beadOuterWidth(item.bead?.shape || 'round', BEAD_SIZE);
              const wrapW = Math.max(BEAD_SIZE, outerW);
              return (
                <TouchableOpacity
                  onPress={() =>
                    onChangeExpanded(item.key === expandedKey ? null : item.key)
                  }
                  onLongPress={
                    onLongPressItem ? () => onLongPressItem(item) : undefined
                  }
                  delayLongPress={350}
                  style={[
                    styles.beadWrap,
                    { left: BEAD_CENTER_X - wrapW / 2, width: wrapW },
                  ]}
                  activeOpacity={0.7}
                  accessibilityLabel={`Bead ${i + 1} of ${items.length}. Tap to ${item.key === expandedKey ? 'close' : 'preview'}.`}
                >
                  {item.bead?.shape === 'bar' ||
                  item.bead?.shape === 'oval' ? (
                    // bar/oval are drawn wide (long axis horizontal); in
                    // the vertical chain that runs *across* the thread
                    // (bar also leaves a connector gap above/below).
                    // Rotate -90° (anti-clockwise) so the long axis
                    // follows the vertical thread: the stacked-view
                    // equivalent of how they sit along the horizontal
                    // chain. Visual only; the wrap stays centered on the
                    // connector column. uprightGlyphDeg=+90 counters the
                    // wrapper's -90° so a single-char glyph stays upright;
                    // a multi-char glyph is flipped to read clockwise
                    // (top-to-bottom) along the long axis (see BeadView).
                    <View style={styles.elongatedRotate}>
                      <BeadView
                        bead={item.bead}
                        size={BEAD_SIZE}
                        marked={!!item.sectionLabel}
                        uprightGlyphDeg={90}
                        hasComments={!!item.hasComments}
                      />
                    </View>
                  ) : (
                    <BeadView
                      bead={item.bead}
                      size={BEAD_SIZE}
                      marked={!!item.sectionLabel}
                      hasComments={!!item.hasComments}
                    />
                  )}
                </TouchableOpacity>
              );
            })()}
            {showPendant ? (
              <View style={styles.pendantWrap} pointerEvents="none">
                <View style={styles.pendantString} />
                <View style={styles.pendantTag}>
                  <Text style={styles.pendantText} numberOfLines={1}>
                    {item.sectionLabel}
                  </Text>
                </View>
              </View>
            ) : null}
          </View>
        );
      })}

      {/* In-flow spacer: grows the ScrollView's content so a long
          expanded bubble on (or near) the last bead can be scrolled
          fully into view. 0 when nothing is expanded. */}
      {bottomSpacer > 0 ? <View style={{ height: bottomSpacer }} /> : null}

      {expandedIndex >= 0 ? (
        <BubblePopover
          // Key by entry so switching directly from one bead to another
          // (without closing first) remounts the bubble: its preview /
          // comments / more-less state resets per bead, as intended.
          key={items[expandedIndex].key}
          item={items[expandedIndex]}
          index={expandedIndex}
          colors={colors}
          styles={styles}
          onMeasure={setBubbleH}
          onOpen={() =>
            items[expandedIndex].entryId != null
              ? onOpenEntry(items[expandedIndex].entryId)
              : null
          }
        />
      ) : null}
    </View>
  );
}

function BubblePopover({ item, index, colors, styles, onOpen, onMeasure }) {
  const entry = item.entry || {};
  const priv = isPrivate({ is_private: entry.is_private });
  const title = priv
    ? MASKED_TITLE
    : (entry.title && entry.title.trim()) || 'Untitled';
  const excerpt = priv ? '' : entry.content || '';
  const commentCount = entry.commentCount || 0;

  // Inline comments preview state. Matches the EntryCard pattern: chip
  // toggles visibility; the first `COMMENT_PREVIEW_SLICE` comments show
  // by default; "View all" expands to the full list. Lazy-loaded on
  // first chip tap. Resets when the bubble is destroyed (a different
  // bead is expanded or the bubble is dismissed on scroll).
  const [commentsVisible, setCommentsVisible] = useState(false);
  const [comments, setComments] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [bodyExpanded, setBodyExpanded] = useState(false);

  // Heuristic for whether the note overflows the collapsed teaser. We
  // don't measure (onTextLayout is unreliable under numberOfLines); err
  // toward showing the toggle since it just re-renders the same text
  // uncapped: an occasional needless "More" is harmless. The bubble
  // grows in place; the screen no longer dismisses it on scroll, so a
  // long expanded note can be scrolled into view with the page.
  const bodyLineCount = excerpt ? excerpt.split('\n').length : 0;
  const isLongBody =
    !!excerpt &&
    (bodyLineCount > BODY_PREVIEW_LINES || excerpt.length > 200);

  const handleToggleComments = async () => {
    const next = !commentsVisible;
    setCommentsVisible(next);
    if (next && comments === null && item.entryId != null) {
      const all = await loadComments(PARENT_ENTRY, item.entryId);
      setComments(all);
    }
  };

  const displayed = comments
    ? showAll
      ? comments
      : comments.slice(0, COMMENT_PREVIEW_SLICE)
    : [];
  const remaining = comments ? comments.length - displayed.length : 0;

  // Center the tail vertically with the bead row.
  const top = ROW_HEIGHT * index + ROW_HEIGHT / 2 - 24;

  return (
    <View
      style={[
        styles.bubbleWrap,
        { top },
      ]}
      pointerEvents="box-none"
      onLayout={(e) => onMeasure?.(e.nativeEvent.layout.height)}
    >
      <View style={styles.tail} />
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={onOpen}
        disabled={item.entryId == null}
        style={styles.bubble}
        accessibilityLabel={
          priv ? 'Private entry. Tap to open.' : `${title}. Tap to open.`
        }
      >
        <View style={styles.bubbleHeader}>
          <Text
            style={[
              styles.bubbleTitle,
              priv && styles.bubbleTitlePrivate,
            ]}
            numberOfLines={1}
          >
            {title}
          </Text>
          {commentCount > 0 ? (
            <TouchableOpacity
              onPress={handleToggleComments}
              style={styles.commentChip}
              hitSlop={6}
              accessibilityLabel={`${commentCount} comment${commentCount === 1 ? '' : 's'}. Tap to ${commentsVisible ? 'hide' : 'show'}.`}
            >
              <Ionicons
                name={commentsVisible ? 'chatbubble' : 'chatbubble-outline'}
                size={11}
                color={colors.primary}
              />
              <Text style={styles.commentChipText}>{commentCount}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {excerpt ? (
          <>
            <MarkdownInline
              block
              style={styles.bubbleBody}
              numberOfLines={bodyExpanded ? undefined : BODY_PREVIEW_LINES}
            >
              {excerpt}
            </MarkdownInline>
            {isLongBody ? (
              <TouchableOpacity
                onPress={() => setBodyExpanded((v) => !v)}
                hitSlop={4}
                accessibilityLabel={
                  bodyExpanded
                    ? 'Show less of this note'
                    : 'Show the rest of this note'
                }
              >
                <Text style={styles.bodyMore}>
                  {bodyExpanded ? 'Less' : 'More…'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : null}
        {commentsVisible && commentCount > 0 ? (
          <View style={styles.commentsBlock}>
            {comments === null ? (
              <Text style={styles.commentsLoading}>Loading…</Text>
            ) : displayed.length === 0 ? (
              <Text style={styles.commentsLoading}>No comments</Text>
            ) : (
              displayed.map((c) => (
                <View key={c.id} style={styles.commentRow}>
                  <View style={styles.commentDot} />
                  <MarkdownInline
                    style={styles.commentBody}
                    numberOfLines={3}
                    strike={!!c.resolved_at}
                  >
                    {c.body}
                  </MarkdownInline>
                </View>
              ))
            )}
            {remaining > 0 ? (
              <TouchableOpacity onPress={() => setShowAll(true)} hitSlop={4}>
                <Text style={styles.commentsMore}>
                  View all {commentCount} comments
                </Text>
              </TouchableOpacity>
            ) : showAll && comments && comments.length > COMMENT_PREVIEW_SLICE ? (
              <TouchableOpacity onPress={() => setShowAll(false)} hitSlop={4}>
                <Text style={styles.commentsMore}>Show less</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    container: {
      position: 'relative',
      paddingVertical: 4,
    },
    row: {
      height: ROW_HEIGHT,
      justifyContent: 'center',
    },
    connector: {
      position: 'absolute',
      width: CONNECTOR_WIDTH,
      left: BEAD_CENTER_X - CONNECTOR_WIDTH / 2,
      backgroundColor: colors.borderStrong,
    },
    connectorTop: {
      top: 0,
      height: ROW_HEIGHT / 2 - BEAD_SIZE / 2,
    },
    connectorBottom: {
      bottom: 0,
      height: ROW_HEIGHT / 2 - BEAD_SIZE / 2,
    },
    beadWrap: {
      // left + width are set per-row to keep each bead's visual center
      // aligned with the connector column at BEAD_CENTER_X.
      position: 'absolute',
      height: BEAD_SIZE,
      top: ROW_HEIGHT / 2 - BEAD_SIZE / 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // bar/oval: -90° (anti-clockwise) so the long axis follows the
    // vertical thread. Visual only: the layout box is unchanged, so the
    // connector-centering math (beadOuterWidth) still holds.
    elongatedRotate: {
      transform: [{ rotate: '-90deg' }],
    },
    bubbleWrap: {
      position: 'absolute',
      left: BUBBLE_LEFT,
      right: 16,
      zIndex: 10,
    },
    tail: {
      position: 'absolute',
      left: -TAIL_SIZE / 2,
      top: 14,
      width: TAIL_SIZE,
      height: TAIL_SIZE,
      backgroundColor: colors.surface,
      borderLeftWidth: 1,
      borderBottomWidth: 1,
      borderColor: colors.border,
      transform: [{ rotate: '45deg' }],
      zIndex: 11,
    },
    bubble: {
      backgroundColor: colors.surface,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
      // Subtle elevation so the bubble reads as a layer above the chain.
      shadowColor: '#000',
      shadowOpacity: 0.1,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },
    bubbleHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 4,
    },
    bubbleTitle: {
      flex: 1,
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    bubbleTitlePrivate: {
      color: colors.textMuted,
      fontWeight: '500',
      fontStyle: 'italic',
    },
    bubbleBody: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
    },
    commentChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 8,
      backgroundColor: colors.surfaceMuted,
    },
    commentChipText: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: '600',
    },
    commentsBlock: {
      marginTop: 8,
      marginLeft: 2,
      paddingLeft: 6,
      borderLeftWidth: 2,
      borderLeftColor: colors.border,
      gap: 4,
    },
    commentsLoading: {
      color: colors.textFaint,
      fontSize: 11,
      fontStyle: 'italic',
    },
    commentRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 5,
    },
    commentDot: {
      width: 4,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderStrong,
      marginTop: 6,
    },
    commentBody: {
      flex: 1,
      color: colors.textMuted,
      fontSize: 11,
      lineHeight: 15,
    },
    commentsMore: {
      color: colors.textFaint,
      fontSize: 10,
      fontWeight: '600',
      marginTop: 2,
    },
    // The note's own More…/Less: a primary affordance (vs. the fainter
    // comments "View all"), so it's tinted and a touch larger.
    bodyMore: {
      color: colors.primary,
      fontSize: 12,
      fontWeight: '600',
      marginTop: 4,
    },
    // Pendant tag rendered to the right of a labelled bead: chain
    // stays unbroken, the section name hangs off the bead like a
    // hand-written price tag on a beaded thread. A short string runs
    // from the connector / bead edge to the tag's left side, then
    // the tag itself is a rounded-rect with text inside. Vertically
    // centered with the bead's row. Hidden when this bead's bubble
    // is open (the bubble takes over the same lateral space; once
    // dismissed the pendant reappears).
    pendantWrap: {
      position: 'absolute',
      left: PENDANT_LEFT,
      top: 0,
      bottom: 0,
      flexDirection: 'row',
      alignItems: 'center',
    },
    pendantString: {
      width: 6,
      height: 1,
      backgroundColor: colors.borderStrong,
    },
    pendantTag: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 5,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      marginLeft: 1,
    },
    pendantText: {
      color: colors.textMuted,
      fontFamily: 'Caveat_400Regular',
      fontSize: 14,
      lineHeight: 16,
      maxWidth: 180,
      opacity: 0.9,
    },
  });
