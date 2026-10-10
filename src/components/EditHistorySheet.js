import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';

// S15 phase 2, the vundo homage: the session's edit-history tree drawn as
// a walkable chain in a half-height sheet. The graph shows *structure only*
// (nodes, lanes, times, deltas); the content lives in the buffer above the
// sheet, which previews whichever state you tap. The buffer is the diff
// view, exactly as the Emacs buffer is under vundo. That division of labour
// is what makes a tree fit a phone: the graph stays small because it never
// has to show text.
//
// Layout is the git-log rotation of vundo: newest at the top, time flows
// down. Lane 0 (the trunk) is the spine: the path root → current, extended
// past the current node along the most-recently-travelled children (the
// redo trail, drawn dashed). Every other branch hangs in its own dashed
// lane at the row where it forked. Rows are sorted by creation time, so a
// child always sits above its parent.
//
// Interaction contract (owned by EntryEditorScreen, not here): tap a row →
// onPreview(snapshot); tap the same row again → onRestore(nodeId); tapping
// the backdrop / hardware back → onClose (the editor reverts the preview).
// The sheet never mutates the history object.

const ROW_H = 44;
const LANE_W = 22;
const GUTTER_PAD = 16;
const NODE_R = 6.5;
const CURRENT_R = 8.5;

const pad2 = (n) => n.toString().padStart(2, '0');
const timeLabel = (ts) => {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

const deltaLabel = (snap, parentSnap) => {
  if (!parentSnap) return 'opened';
  const titleChanged = snap.title !== parentSnap.title;
  const diff = snap.content.length - parentSnap.content.length;
  const contentPart =
    snap.content === parentSnap.content
      ? null
      : diff > 0
        ? `+ ${diff} chars`
        : diff < 0
          ? `− ${-diff} chars`
          : 'edited';
  if (titleChanged && contentPart) return `title · ${contentPart}`;
  if (titleChanged) return 'title edited';
  return contentPart || 'edited';
};

// Pure layout: tree structure in, rows + lanes + edges out.
function buildLayout(history) {
  const tree = history.getTree();
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));

  // Ancestor path (root → current, inclusive): the undo trail.
  const ancestors = new Set();
  for (
    let n = byId.get(tree.currentId);
    n;
    n = n.parentId != null ? byId.get(n.parentId) : null
  ) {
    ancestors.add(n.id);
  }
  // Spine = ancestors + the redo trail (most-recently-travelled children
  // beyond current). Everything else is an abandoned branch.
  const spine = new Set(ancestors);
  for (let n = byId.get(tree.currentId); n && n.childIds.length; ) {
    let best = null;
    for (const cid of n.childIds) {
      const c = byId.get(cid);
      if (!best || c.touched > best.touched) best = c;
    }
    spine.add(best.id);
    n = best;
  }

  // Rows: newest first. ts is non-decreasing across creations (ids break
  // ties), so a child always lands above its parent.
  const rows = [...tree.nodes].sort((a, b) => b.ts - a.ts || b.id - a.id);
  const rowIndex = new Map(rows.map((n, i) => [n.id, i]));

  // Lanes: spine = 0; each abandoned chain takes the lowest free lane over
  // its row span (fork row included, so two branches off nearby forks don't
  // share a lane and overdraw).
  const lane = new Map();
  for (const id of spine) lane.set(id, 0);
  const spans = [];
  const takeLane = (minRow, maxRow) => {
    for (let l = 1; ; l++) {
      const clash = spans.some(
        (s) => s.lane === l && !(maxRow < s.minRow || minRow > s.maxRow)
      );
      if (!clash) {
        spans.push({ lane: l, minRow, maxRow });
        return l;
      }
    }
  };
  const assignChain = (startId, pending) => {
    const chain = [];
    for (let cur = byId.get(startId); cur; ) {
      chain.push(cur.id);
      const kids = cur.childIds
        .map((id) => byId.get(id))
        .filter((c) => !lane.has(c.id));
      if (!kids.length) break;
      kids.sort((a, b) => b.touched - a.touched);
      for (let i = 1; i < kids.length; i++) pending.push(kids[i].id);
      cur = kids[0];
    }
    const rowsSpanned = chain.map((id) => rowIndex.get(id));
    rowsSpanned.push(rowIndex.get(byId.get(startId).parentId));
    const l = takeLane(Math.min(...rowsSpanned), Math.max(...rowsSpanned));
    for (const id of chain) lane.set(id, l);
  };
  const pending = rows
    .filter((n) => !lane.has(n.id) && lane.has(n.parentId))
    .map((n) => n.id);
  while (pending.length) {
    const id = pending.shift();
    if (!lane.has(id)) assignChain(id, pending);
  }

  const maxLane = Math.max(0, ...lane.values());
  const gutterWidth = GUTTER_PAD * 2 + maxLane * LANE_W + NODE_R * 2;
  const x = (id) => GUTTER_PAD + NODE_R + lane.get(id) * LANE_W;
  const y = (id) => rowIndex.get(id) * ROW_H + ROW_H / 2;

  const kindOf = (id) =>
    id === tree.currentId
      ? 'current'
      : ancestors.has(id)
        ? 'ancestor'
        : spine.has(id)
          ? 'redo'
          : 'abandoned';

  return {
    currentId: tree.currentId,
    gutterWidth,
    height: rows.length * ROW_H,
    rows: rows.map((n) => ({
      id: n.id,
      kind: kindOf(n.id),
      time: timeLabel(n.ts),
      delta: deltaLabel(
        history.getSnapshot(n.id),
        n.parentId != null ? history.getSnapshot(n.parentId) : null
      ),
    })),
    nodes: rows.map((n) => ({
      id: n.id,
      kind: kindOf(n.id),
      cx: x(n.id),
      cy: y(n.id),
    })),
    edges: rows
      .filter((n) => n.parentId != null)
      .map((n) => ({
        key: `${n.parentId}-${n.id}`,
        // The edge inherits the child's styling: an abandoned node's link
        // back to the trunk is part of the abandoned branch.
        kind: kindOf(n.id),
        px: x(n.parentId),
        py: y(n.parentId),
        cx: x(n.id),
        cy: y(n.id),
      })),
  };
}

export default function EditHistorySheet({
  visible,
  history,
  onPreview,
  onRestore,
  onClose,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [previewId, setPreviewId] = useState(null);

  // One layout per open. The tree cannot change while the sheet is up:
  // previews go through skip-guarded setters and record nothing.
  const layout = useMemo(
    () => (visible && history ? buildLayout(history) : null),
    [visible, history]
  );

  useEffect(() => {
    if (visible && layout) setPreviewId(layout.currentId);
  }, [visible, layout]);

  if (!layout) return null;

  const strokeFor = (kind) =>
    kind === 'abandoned'
      ? colors.textFaint
      : kind === 'ancestor'
        ? colors.borderStrong
        : colors.primary;
  const dashFor = (kind) =>
    kind === 'redo' ? '5 4' : kind === 'abandoned' ? '4 4' : undefined;

  const handleRowPress = (row) => {
    if (previewId === row.id) {
      onRestore(row.id);
      return;
    }
    setPreviewId(row.id);
    onPreview(history.getSnapshot(row.id));
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      // Both flags are load-bearing, not cosmetic. Under edge-to-edge RN
      // already draws every dialog edge-to-edge, so nothing moves. But
      // without `statusBarTranslucent` RN wraps the content in a
      // `fitsSystemWindows` FrameLayout, and a dialog created while the
      // IME is still animating away can receive a transient negative
      // inset there: the root laid out at 2× screen height and this
      // sheet sat entirely below the screen (v0.88.4, device-verified).
      // The flag removes that wrapper; the opener also waits for
      // `keyboardDidHide` (`dismissKeyboardThen`) so the two animations
      // never overlap.
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      {/* No dim on the backdrop: the buffer above IS the preview. */}
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}
          onPress={() => {}}
        >
          <View style={styles.handle} />
          <View style={styles.headRow}>
            <Text style={styles.heading}>History</Text>
            <Text style={styles.headHint}>
              tap to preview above · tap again to restore
            </Text>
          </View>
          <ScrollView style={styles.scroll}>
            <View style={{ height: layout.height }}>
              <Svg
                width={layout.gutterWidth}
                height={layout.height}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              >
                {layout.edges.map((e) =>
                  e.px === e.cx ? (
                    <Line
                      key={e.key}
                      x1={e.px}
                      y1={e.py}
                      x2={e.cx}
                      y2={e.cy}
                      stroke={strokeFor(e.kind)}
                      strokeWidth={2}
                      strokeDasharray={dashFor(e.kind)}
                    />
                  ) : (
                    <Path
                      key={e.key}
                      d={`M ${e.px} ${e.py} Q ${e.cx} ${e.py} ${e.cx} ${
                        e.py - ROW_H / 2
                      } L ${e.cx} ${e.cy}`}
                      stroke={strokeFor(e.kind)}
                      strokeWidth={2}
                      strokeDasharray={dashFor(e.kind)}
                      fill="none"
                    />
                  )
                )}
                {layout.nodes.map((n) => (
                  <React.Fragment key={n.id}>
                    {n.id === previewId && n.kind !== 'current' ? (
                      <Circle
                        cx={n.cx}
                        cy={n.cy}
                        r={CURRENT_R + 3}
                        stroke={colors.primary}
                        strokeWidth={1.5}
                        fill="none"
                      />
                    ) : null}
                    <Circle
                      cx={n.cx}
                      cy={n.cy}
                      r={n.kind === 'current' ? CURRENT_R : NODE_R}
                      fill={
                        n.kind === 'current'
                          ? colors.primary
                          : n.kind === 'ancestor'
                            ? colors.surface
                            : 'none'
                      }
                      stroke={
                        n.kind === 'abandoned'
                          ? colors.textFaint
                          : n.kind === 'ancestor'
                            ? colors.textMuted
                            : colors.primary
                      }
                      strokeWidth={2}
                      strokeDasharray={
                        n.kind === 'redo' || n.kind === 'abandoned'
                          ? '3 3'
                          : undefined
                      }
                    />
                  </React.Fragment>
                ))}
              </Svg>
              {layout.rows.map((row, i) => (
                <TouchableOpacity
                  key={row.id}
                  style={[
                    styles.row,
                    { top: i * ROW_H, paddingLeft: layout.gutterWidth + 8 },
                  ]}
                  onPress={() => handleRowPress(row)}
                  activeOpacity={0.6}
                  accessibilityRole="button"
                  accessibilityLabel={`State at ${row.time}, ${row.delta}.${
                    row.id === previewId
                      ? ' Previewing. Tap again to restore.'
                      : ' Tap to preview.'
                  }`}
                >
                  <Text
                    style={[
                      styles.rowTime,
                      row.kind === 'current' && styles.rowTimeCurrent,
                      row.kind === 'abandoned' && styles.rowTimeAbandoned,
                    ]}
                  >
                    {row.time}
                  </Text>
                  <Text
                    style={[
                      styles.rowDelta,
                      row.id === previewId &&
                        row.kind !== 'current' &&
                        styles.rowDeltaPreviewing,
                    ]}
                    numberOfLines={1}
                  >
                    {row.id === previewId && row.kind !== 'current'
                      ? 'previewing · tap again to restore'
                      : row.kind === 'current'
                        ? `you are here · ${row.delta}`
                        : row.delta}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: '48%',
      borderWidth: 1,
      borderColor: colors.borderStrong,
      paddingTop: 8,
      // The backdrop is undimmed, so the sheet needs its own lift to read
      // as a layer over the buffer.
      elevation: 12,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.3,
      shadowRadius: 10,
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderStrong,
      alignSelf: 'center',
      marginBottom: 10,
    },
    headRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      marginBottom: 6,
    },
    heading: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
    },
    headHint: {
      color: colors.textFaint,
      fontSize: 11,
    },
    scroll: {
      flexGrow: 0,
    },
    row: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: ROW_H,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingRight: 16,
    },
    rowTime: {
      color: colors.text,
      fontSize: 13,
      fontVariant: ['tabular-nums'],
    },
    rowTimeCurrent: {
      color: colors.primary,
      fontWeight: '700',
    },
    rowTimeAbandoned: {
      color: colors.textMuted,
    },
    rowDelta: {
      flex: 1,
      color: colors.textFaint,
      fontSize: 12,
    },
    rowDeltaPreviewing: {
      color: colors.primary,
      fontWeight: '600',
    },
  });
