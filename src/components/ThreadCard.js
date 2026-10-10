import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BeadChain from './BeadChain';
import ChainPreview from './ChainPreview';
import { readBead } from '../beads/types';
import { loadComments, PARENT_THREAD } from '../services/comments';
import { useTheme } from '../theme';
import MarkdownInline from './MarkdownInline';

export const PREVIEW_BEAD_SIZE = 26;

export function buildChainItems(beads = []) {
  return beads.map((tb, i) => {
    const live = readBead({
      bead_shape: tb.bead_shape,
      bead_pattern: tb.bead_pattern,
      bead_mood: tb.bead_mood,
      bead_glyph: tb.bead_glyph,
    });
    const fallback = {
      shape: tb.snapshot_shape,
      pattern: tb.snapshot_pattern,
      mood: tb.snapshot_mood,
      glyph: tb.snapshot_glyph,
    };
    return {
      key: String(tb.id ?? `tb-${i}`),
      bead: live || fallback,
      faded: !live,
      // Set `marked` (boolean), not `sectionLabel`, so preview
      // surfaces (ThreadCard rows, EntryCard's inline thread chains)
      // render just the gold ring on section-header beads, never the
      // full price-tag pendant. The detail-view chain in
      // ThreadDetailScreen sets sectionLabel explicitly to opt into
      // the pendant.
      marked: !!tb.section_label,
    };
  });
}

export async function loadThreadPreview(db, threadId) {
  return db.getAllAsync(
    `SELECT tb.*, e.bead_shape, e.bead_pattern, e.bead_mood, e.bead_glyph
       FROM thread_beads tb
       LEFT JOIN entries e ON e.id = tb.entry_id
       WHERE tb.thread_id = ?
       ORDER BY tb.position ASC`,
    [threadId]
  );
}

function ThreadCard({
  thread,
  onPress,
  onLongPress,
  onRemove,
  disabled = false,
  dimmed = false,
  inlineCommentsDefault = false,
  preview,
  onNeedPreview,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Lazy preview is active only when the parent supplies `onNeedPreview`
  // (the threads list). Other callers (pickers, the editor's Mentions)
  // keep the legacy behaviour: render from `thread.preview` directly with
  // the full BeadChain, no skeleton, no fetch.
  const lazy = typeof onNeedPreview === 'function';
  const effectivePreview = lazy ? preview : thread.preview || [];
  const previewLoading = lazy && preview === undefined;

  const chainItems = useMemo(
    () => buildChainItems(effectivePreview || []),
    [effectivePreview]
  );

  useEffect(() => {
    if (lazy && preview === undefined) onNeedPreview(thread.id);
  }, [lazy, preview, onNeedPreview, thread.id]);

  const totalCommentCount = thread.commentCount ?? 0;
  const previewSlice = thread.commentsPreview || [];

  // (Thread cards intentionally carry no date: a thread isn't tied to a
  // calendar day the way an entry is, so an updated_at label was visual
  // noise here, unlike EntryCard, which keeps its date.)

  // Same per-card preview state as EntryCard. Global toggle = default;
  // chip = local override; toggling the global resets all overrides.
  const [previewVisible, setPreviewVisible] = useState(inlineCommentsDefault);
  const [expandedAll, setExpandedAll] = useState(false);
  const [fullComments, setFullComments] = useState(null);
  useEffect(() => {
    setPreviewVisible(inlineCommentsDefault);
    setExpandedAll(false);
    setFullComments(null);
  }, [inlineCommentsDefault]);

  const handleToggleChip = () => setPreviewVisible((v) => !v);
  const handleViewAll = async () => {
    if (!fullComments) {
      const all = await loadComments(PARENT_THREAD, thread.id);
      setFullComments(all);
    }
    setExpandedAll(true);
  };
  const handleCollapseAll = () => setExpandedAll(false);

  const displayedComments =
    expandedAll && fullComments ? fullComments : previewSlice;
  const remainingHidden = Math.max(
    0,
    totalCommentCount - displayedComments.length
  );

  return (
    <TouchableOpacity
      style={[styles.row, dimmed && styles.rowDimmed]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      activeOpacity={onPress ? 0.7 : 1}
      disabled={disabled}
    >
      <View style={styles.headerRow}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {thread.name || 'Untitled'}
        </Text>
        {thread.closed_at ? (
          <View
            style={styles.closedChip}
            accessibilityLabel={`Closed loop · ${String(thread.closed_at).slice(0, 10)}`}
          >
            <Ionicons name="ellipse" size={9} color={colors.primary} />
            <Text style={styles.closedChipText} numberOfLines={1}>
              Closed · {String(thread.closed_at).slice(0, 10)}
            </Text>
          </View>
        ) : null}
        {totalCommentCount > 0 && !onRemove ? (
          <TouchableOpacity
            onPress={handleToggleChip}
            style={styles.commentsChip}
            hitSlop={6}
            accessibilityLabel={`${totalCommentCount} comment${totalCommentCount === 1 ? '' : 's'}. Tap to ${previewVisible ? 'hide' : 'show'} the preview.`}
          >
            <Ionicons
              name={previewVisible ? 'chatbubble' : 'chatbubble-outline'}
              size={11}
              color={previewVisible ? colors.primary : colors.textMuted}
            />
            <Text
              style={[
                styles.commentsChipText,
                previewVisible && styles.commentsChipTextActive,
              ]}
            >
              {totalCommentCount}
            </Text>
          </TouchableOpacity>
        ) : null}
        {onRemove ? (
          <TouchableOpacity
            onPress={onRemove}
            style={styles.removeButton}
            hitSlop={10}
            accessibilityLabel="Remove mention"
          >
            <Ionicons name="close" size={16} color={colors.textFaint} />
          </TouchableOpacity>
        ) : null}
      </View>
      {previewLoading ? (
        <View style={styles.chainSkeleton} />
      ) : chainItems.length === 0 ? (
        <Text style={styles.chainEmpty}>No beads</Text>
      ) : lazy ? (
        <ChainPreview items={chainItems} beadSize={18} />
      ) : (
        <BeadChain
          beadSize={PREVIEW_BEAD_SIZE}
          connectorColor={colors.border}
          capColor={colors.border}
          stroke={2.5}
          jointDotSize={5}
          rowGap={14}
          items={chainItems}
        />
      )}
      {previewVisible && totalCommentCount > 0 ? (
        <View style={styles.commentsPreview}>
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
    </TouchableOpacity>
  );
}

// Data-only equality so a parent re-render (or the lazy preview arriving
// for a *different* row) doesn't re-run this card's chain render. Function
// props are intentionally ignored: the row closures only call stable
// handlers with a fixed thread id, so an older closure is equivalent.
function areEqual(a, b) {
  return (
    a.thread === b.thread &&
    a.preview === b.preview &&
    a.inlineCommentsDefault === b.inlineCommentsDefault &&
    a.disabled === b.disabled &&
    a.dimmed === b.dimmed &&
    a.onRemove === b.onRemove
  );
}

export default React.memo(ThreadCard, areEqual);

const makeStyles = (colors) =>
  StyleSheet.create({
    row: {
      // Flat WhatsApp-style row, harmonised with the notes list (EntryCard):
      // no card box, edge-to-edge, a 1px divider, rows on the screen background
      // (no surface tint). The horizontal inset lives here now since
      // listContent no longer pads. Opaque bg keeps the swipe action covered.
      backgroundColor: colors.background,
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    rowDimmed: {
      opacity: 0.45,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    rowTitle: {
      flex: 1,
      color: colors.textMuted,
      fontFamily: 'Caveat_400Regular',
      fontSize: 22,
      lineHeight: 26,
      marginBottom: 4,
      opacity: 0.75,
    },
    removeButton: {
      width: 24,
      height: 24,
      justifyContent: 'center',
      alignItems: 'center',
      marginLeft: 8,
      marginBottom: 4,
    },
    // Harmonised with EntryCard's comment chip: no pill fill, same
    // paddings/radius/text so a comment count reads identically wherever
    // it appears.
    commentsChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingVertical: 2,
      paddingHorizontal: 4,
      borderRadius: 8,
      marginLeft: 6,
      marginBottom: 4,
    },
    // textMuted to match EntryCard's metaText: a count is information.
    commentsChipText: {
      color: colors.textMuted,
      fontSize: 11,
    },
    commentsChipTextActive: {
      color: colors.primary,
    },
    // The "this thread is a closed loop" marker: a small clasp dot + the
    // day it closed. Same no-fill, muted treatment as the comment chip so
    // the header strip stays harmonised; ChainPreview itself is left
    // linear (a circular thumbnail is a deliberate non-goal).
    closedChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingVertical: 2,
      paddingHorizontal: 4,
      marginLeft: 6,
      marginBottom: 4,
    },
    closedChipText: {
      color: colors.textMuted,
      fontSize: 11,
    },
    chainEmpty: {
      color: colors.textFaint,
      fontSize: 12,
      fontStyle: 'italic',
    },
    // Reserved slot while the preview lazy-loads: a quiet muted strip,
    // not a spinner (a spinner would flicker for fast-resolving chains).
    chainSkeleton: {
      height: 18,
      marginTop: 2,
      borderRadius: 6,
      backgroundColor: colors.surfaceMuted,
      opacity: 0.5,
    },
    commentsPreview: {
      marginTop: 8,
      marginLeft: 4,
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
