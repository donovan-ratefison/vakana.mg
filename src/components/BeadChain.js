import React, { useMemo, useState, Fragment } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import BeadView, { beadOuterWidth } from './BeadView';
import ThreadCap from './ThreadCap';
import ThreadLine from './ThreadLine';
import { useTheme } from '../theme';

// Serpentine (boustrophedon) bead chain renderer.
//
// items: [{ key, bead: {shape, pattern, mood, glyph}, faded, onTap, onLongPress }]
// Wraps to the available width measured via onLayout, alternating row direction
// every row. Between consecutive rows, a half-circle U-turn at the screen edge
// is drawn absolutely; loose-tail caps appear only at the very first and very
// last bead of the chain.

const CONN_W = 10;
const ROW_GAP_DEFAULT = 22;
const STROKE_DEFAULT = 4;
const JOINT_DOT_DEFAULT = 7;
// Slightly golden so the diagonal fibers visually relate to the joint dots;
// rgba so the stripes still darken whatever the base thread color is.
const STRIPE_COLOR_DEFAULT = 'rgba(150, 110, 40, 0.55)';
const JOINT_COLOR_DEFAULT = '#C9A24A';

// How far a joint dot should bleed INTO the bead container to visually meet
// the bead's actual rendered edge. Most shapes fill their container so the
// dot already touches; only lozenge needs help because its rotated+scaled
// diamond leaves a gap on the left/right at the dot's vertical extent.
function shapeJointOverlap(shape, jointDotSize) {
  if (shape === 'lozenge') return Math.ceil(jointDotSize * 0.6);
  return 0;
}

export default function BeadChain({
  items,
  beadSize = 36,
  connectorColor,
  capColor,
  stripeColor = STRIPE_COLOR_DEFAULT,
  jointColor = JOINT_COLOR_DEFAULT,
  stroke = STROKE_DEFAULT,
  jointDotSize = JOINT_DOT_DEFAULT,
  rowGap = ROW_GAP_DEFAULT,
}) {
  const [containerWidth, setContainerWidth] = useState(0);
  const U_R = Math.max(8, Math.round(beadSize * 0.32));
  const capWidth = Math.max(10, Math.round(beadSize * 0.42));
  // Walk items once and stamp each section-header with a
  // `pendantLevel` (0 or 1, alternating in chain order). The pendant
  // renderer reads the level and shifts the level-1 tag up by
  // PENDANT_STAGGER px with a longer drop-string back to the bead so
  // adjacent labelled beads' tags sit at different Y heights instead
  // of stacking on top of each other. Single-section chains never see
  // level 1 and pay no extra vertical.
  const itemsWithLevels = useMemo(() => {
    let level = 0;
    return (items || []).map((it) => {
      if (!it?.sectionLabel) return it;
      const decorated = { ...it, pendantLevel: level };
      level = (level + 1) % 2;
      return decorated;
    });
  }, [items]);
  const rows = useMemo(() => {
    if (!itemsWithLevels?.length) return [];
    if (!containerWidth) {
      return [{ items: itemsWithLevels, connectorWidth: CONN_W, justify: false }];
    }
    return computeRows(itemsWithLevels, beadSize, containerWidth, {
      uRadius: U_R,
      capWidth,
      connWidth: CONN_W,
      jointDotSize,
    });
  }, [itemsWithLevels, containerWidth, beadSize, U_R, capWidth, jointDotSize]);

  const totalRows = rows.length;
  const onLayout = (e) => setContainerWidth(e.nativeEvent.layout.width);

  // Per-row gap budget: each row's bottom-margin is sized to fit the
  // pendants of the *next* row, not a global value. So a row whose
  // next row has no labelled beads gets the user's default rowGap;
  // a row whose next row has a level-1 pendant gets the full 60 px.
  // Same idea for topPad: it accounts only for row 0's labels.
  const rowMaxLevel = rows.map((row) => {
    let max = -1;
    for (const it of row.items) {
      if (it?.sectionLabel) {
        max = Math.max(max, it.pendantLevel ?? 0);
      }
    }
    return max;
  });
  const padForLevel = (level) => {
    if (level < 0) return 0;
    if (level === 0) return 32;
    return 56;
  };
  const gapAfter = (i) => {
    if (i >= rows.length - 1) return 0; // last row has no bottom-margin
    const need = padForLevel(rowMaxLevel[i + 1]);
    return Math.max(rowGap, need);
  };
  const topPad = padForLevel(rowMaxLevel[0] ?? -1);
  // Cumulative row tops: y position of each row's top edge inside the
  // wrap. Used for placing U-turn arcs absolutely with the correct
  // vertical offset under variable gaps.
  const rowTops = [];
  {
    let y = 0;
    for (let r = 0; r < rows.length; r++) {
      rowTops.push(y);
      y += beadSize + gapAfter(r);
    }
  }

  return (
    <View
      style={[styles.wrap, { paddingBottom: 4, marginTop: topPad }]}
      onLayout={onLayout}
    >
      {rows.map((row, rowIdx) => (
        <ChainRow
          key={rowIdx}
          row={row}
          rowIdx={rowIdx}
          totalRows={totalRows}
          beadSize={beadSize}
          uRadius={U_R}
          connectorColor={connectorColor}
          capColor={capColor}
          stripeColor={stripeColor}
          jointColor={jointColor}
          stroke={stroke}
          jointDotSize={jointDotSize}
          rowGap={gapAfter(rowIdx)}
        />
      ))}

      {rows.slice(0, -1).map((_, i) => {
        const isRight = i % 2 === 0;
        const top = rowTops[i] + beadSize / 2;
        const height = beadSize + gapAfter(i);
        return (
          <UTurn
            key={`u-${i}`}
            side={isRight ? 'right' : 'left'}
            top={top}
            width={U_R}
            height={height}
            color={connectorColor}
            stripeColor={stripeColor}
            stroke={stroke}
          />
        );
      })}
    </View>
  );
}

function ChainRow({
  row,
  rowIdx,
  totalRows,
  beadSize,
  uRadius,
  connectorColor,
  capColor,
  stripeColor,
  jointColor,
  stroke,
  jointDotSize,
  rowGap,
}) {
  const { items: rowItems, connectorWidth, justify } = row;
  const isLTR = rowIdx % 2 === 0;
  const isFirstRow = rowIdx === 0;
  const isLastRow = rowIdx === totalRows - 1;

  // Padding rules: U-turn lives in the padding zone on the connecting side.
  // Caps live INSIDE the row (no padding) so the loose tail reaches the edge.
  let paddingLeft = uRadius;
  let paddingRight = uRadius;
  if (isFirstRow) paddingLeft = 0; // left cap reaches the left edge
  if (isLastRow) {
    if (isLTR) paddingRight = 0; // right cap reaches the right edge
    else paddingLeft = 0; // RTL last row: right-cap (in JSX) renders visually on the LEFT
  }

  const marginBottom = isLastRow ? 0 : rowGap;

  return (
    <View
      style={{
        flexDirection: isLTR ? 'row' : 'row-reverse',
        alignItems: 'center',
        height: beadSize,
        paddingLeft,
        paddingRight,
        marginBottom,
      }}
    >
      {isFirstRow ? (
        <ThreadCap
          side="left"
          size={beadSize}
          color={capColor}
          thickness={stroke}
          stripeColor={stripeColor}
        />
      ) : null}

      {rowItems.map((it, i) => {
        const overlap = shapeJointOverlap(it.bead.shape, jointDotSize);
        // A pendant extending 240 px left of the bead would overflow
        // the screen when the bead is the visually-leftmost in the
        // row (LTR row source idx 0; RTL row source idx length - 1).
        // For that case, flip the pendant so it extends right of the
        // bead instead. For LTR this lands on the "after" connector
        // (the chain's first bead has no real "before" anyway); for
        // RTL, "right of the bead" actually IS the "before" connector
        // in chain order, so the flip aligns semantically.
        const isVisualLeftmost = isLTR
          ? i === 0
          : i === rowItems.length - 1;
        const flipPendant = isVisualLeftmost;
        return (
          <Fragment key={it.key}>
            {i > 0 ? (
              <ThreadLine
                width={connectorWidth}
                height={stroke}
                color={connectorColor}
                stripeColor={stripeColor}
              />
            ) : null}
            <JointDot
              size={jointDotSize}
              color={jointColor}
              overlapNext={overlap}
            />
            <BeadButton item={it} beadSize={beadSize} flipPendant={flipPendant} />
            <JointDot
              size={jointDotSize}
              color={jointColor}
              overlapPrev={overlap}
            />
          </Fragment>
        );
      })}

      {isLastRow ? (
        <ThreadCap
          // RTL last row: the cap appears visually to the LEFT of the last
          // bead, with its loose tail pointing further left, so use side='left'.
          side={isLTR ? 'right' : 'left'}
          size={beadSize}
          color={capColor}
          thickness={stroke}
          stripeColor={stripeColor}
        />
      ) : justify ? null : (
        // Single-bead non-last rows can't be justified (no inter-bead gaps);
        // fall back to a flex-grow stretch line that reaches the U-turn.
        <ThreadLine
          flex={1}
          height={stroke}
          color={connectorColor}
          stripeColor={stripeColor}
        />
      )}
    </View>
  );
}

function BeadButton({ item, beadSize, flipPendant = false }) {
  const { bead, faded, onTap, onLongPress, sectionLabel, marked, pendantLevel, hasComments } = item;
  // Two independent visual cues for a section-header bead:
  //   marked       : adds the gold ring on the bead (used in compact
  //                  preview surfaces; sectionLabel implies this too)
  //   sectionLabel : additionally renders the price-tag pendant; only
  //                  the detail-view chain sets this
  const isMarked = !!sectionLabel || !!marked;
  const beadEl = (
    <BeadView
      bead={bead}
      size={beadSize}
      faded={faded}
      marked={isMarked}
      hasComments={hasComments}
    />
  );
  const tappable =
    !onTap && !onLongPress ? (
      beadEl
    ) : (
      <TouchableOpacity
        onPress={onTap}
        onLongPress={onLongPress}
        delayLongPress={300}
        activeOpacity={0.7}
      >
        {beadEl}
      </TouchableOpacity>
    );

  if (!sectionLabel) return tappable;
  return (
    <BeadWithPendant
      label={sectionLabel}
      level={pendantLevel || 0}
      flip={flipPendant}
    >
      {tappable}
    </BeadWithPendant>
  );
}

// Wraps a bead with a "price-tag" pendant: a rounded rectangle with
// the section label inside, hanging above-left of the bead with a thin
// string dropping from the tag's bottom-right onto the joint/connector
// just before the bead. The outer wrap is position:relative with the
// same intrinsic size as the bead, so the row's flex layout is
// undisturbed and the bead stays vertically centered alongside its
// neighbours. The pendant overflows upward (and leftward) via absolute
// positioning; visibility is granted by the chain wrap's topPad on
// row 0 and by the existing rowGap on inner rows.
//
// The tag itself is tappable: tap toggles `expanded`, which drops
// numberOfLines so the label wraps to multiple lines within the tag's
// fixed width. This is the fallback for section names that don't fit
// on a single line of Caveat at 14 pt. Without it, even a
// generously-wide pendant truncates somewhere. The pendant's
// pointerEvents="box-none" lets the tap reach the inner TouchableOpacity
// while leaving the rest of the pendant (the string, the empty
// horizontal area to its left) transparent to touches.
function BeadWithPendant({ label, level = 0, flip = false, children }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makePendantStyles(colors), [colors]);
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.beadWrap}>
      <View
        style={[styles.pendant, flip && styles.pendantFlipped]}
        pointerEvents="box-none"
      >
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => setExpanded((v) => !v)}
          hitSlop={4}
          accessibilityLabel={`Section: ${label}. Tap to ${expanded ? 'collapse' : 'expand'}.`}
        >
          <View style={styles.tag}>
            <Text
              style={styles.tagText}
              numberOfLines={expanded ? undefined : 1}
            >
              {label}
            </Text>
          </View>
        </TouchableOpacity>
        <View
          style={[
            styles.string,
            level === 1 && styles.stringLevel1,
            flip && styles.stringFlipped,
          ]}
        />
      </View>
      {children}
    </View>
  );
}

const makePendantStyles = (colors) =>
  StyleSheet.create({
    beadWrap: {
      position: 'relative',
    },
    pendant: {
      position: 'absolute',
      // Explicit width is the load-bearing piece here. Without it,
      // yoga bounds the absolute element's intrinsic width by the
      // bead wrap's own width (~36 px), which crushed the tag's
      // text to a couple of characters even with maxWidth: 220 on
      // the inner Text. With a fixed 240 px, the tag has guaranteed
      // room to render. `right: '100%'` anchors the pendant's right
      // edge at the bead wrap's left edge, so the pendant extends
      // 240 px to the left of the bead.
      bottom: '100%',
      right: '100%',
      width: 240,
      marginBottom: 0,
      alignItems: 'flex-end',
    },
    // Flipped pendant for beads at the visually-leftmost position in
    // a row: extends RIGHT of the bead so the tag stays on-screen.
    // Anchor swaps to left: '100%' and children left-align (so the
    // tag and string sit at the bead-adjacent edge of the pendant).
    pendantFlipped: {
      right: undefined,
      left: '100%',
      alignItems: 'flex-start',
    },
    tag: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 5,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    tagText: {
      color: colors.textMuted,
      fontFamily: 'Caveat_400Regular',
      fontSize: 14,
      lineHeight: 16,
      // Generous cap: typical section names ("Launch phase",
      // "Postmortem", "End of Q2 review") fit without truncation. The
      // numberOfLines=1 still ellipsizes anything extreme.
      maxWidth: 220,
      opacity: 0.9,
    },
    string: {
      width: 1,
      height: 5,
      backgroundColor: colors.borderStrong,
      marginRight: 5,
    },
    // Level-1 pendants ride PENDANT_STAGGER px higher than level 0,
    // so the string has to be that much longer to reach back down to
    // the bead's top edge: 5 (level 0 string length) + 24 (stagger).
    // Tag itself stays the same shape, just floats at a higher Y.
    stringLevel1: {
      height: 29,
    },
    // Flipped string sits at the tag's bottom-LEFT instead of
    // bottom-right, so it drops onto the joint/connector zone next
    // to the bead's right edge (where the chain-order "before" lives
    // for RTL rows; for LTR's leftmost bead it lands on the "after"
    // connector, which is the only adjacent connector that exists).
    stringFlipped: {
      marginRight: 0,
      marginLeft: 5,
    },
  });

function JointDot({ size, color, overlapNext = 0, overlapPrev = 0 }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size,
        backgroundColor: color,
        alignSelf: 'center',
        // Negative margin pulls the adjacent bead container's edge under the
        // dot so the dot visually sticks to the bead's RENDERED shape (matters
        // for lozenges, where the diamond is inset from its container).
        marginRight: overlapNext ? -overlapNext : 0,
        marginLeft: overlapPrev ? -overlapPrev : 0,
      }}
    />
  );
}

// U-turn drawn as a polyline of short rotated ThreadLine segments so the
// diagonal stripe pattern follows the curve. Pure-RN (no SVG): the curve is
// approximated by N tangent chord segments per quarter-arc plus an optional
// straight middle when bbox height > 2*radius.
function UTurn({ side, top, width, height, color, stripeColor, stroke }) {
  const R = Math.min(width, height / 2);
  const N = 6; // segments per quarter-arc
  const segments = [];
  const arcStep = Math.PI / 2 / N;

  // Right-side reference shape: stadium `)` with bbox (0,0)-(W,H), inner edge
  // open on the LEFT. Top arc center at (W-R, R); bottom at (W-R, H-R).
  // Top arc: t = -π/2 (top tangent at (W-R, 0)) -> 0 (right tangent at (W, R))
  for (let i = 0; i < N; i++) {
    const t1 = -Math.PI / 2 + i * arcStep;
    const t2 = -Math.PI / 2 + (i + 1) * arcStep;
    segments.push(
      makeSeg(
        width - R + R * Math.cos(t1),
        R + R * Math.sin(t1),
        width - R + R * Math.cos(t2),
        R + R * Math.sin(t2)
      )
    );
  }
  if (height > 2 * R) {
    segments.push({
      cx: width,
      cy: height / 2,
      length: height - 2 * R,
      angle: 90,
    });
  }
  for (let i = 0; i < N; i++) {
    const t1 = i * arcStep;
    const t2 = (i + 1) * arcStep;
    segments.push(
      makeSeg(
        width - R + R * Math.cos(t1),
        height - R + R * Math.sin(t1),
        width - R + R * Math.cos(t2),
        height - R + R * Math.sin(t2)
      )
    );
  }

  // For the LEFT-side U-turn, mirror across the vertical centerline of the
  // bbox: x -> width - x and angle -> 180 - angle.
  const mirrored =
    side === 'left'
      ? segments.map((s) => ({
          ...s,
          cx: width - s.cx,
          angle: 180 - s.angle,
        }))
      : segments;

  return (
    <View
      style={{
        position: 'absolute',
        left: side === 'left' ? 0 : undefined,
        right: side === 'right' ? 0 : undefined,
        top,
        width,
        height,
      }}
    >
      {mirrored.map((s, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: s.cx - s.length / 2,
            top: s.cy - stroke / 2,
            width: s.length,
            height: stroke,
            transform: [{ rotate: `${s.angle}deg` }],
          }}
        >
          <ThreadLine
            width={s.length}
            height={stroke}
            color={color}
            stripeColor={stripeColor}
          />
        </View>
      ))}
    </View>
  );
}

function makeSeg(x1, y1, x2, y2) {
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) + 1; // tiny overlap so chords visually join
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return { cx, cy, length, angle };
}

// Greedy row packing followed by per-row justification. Each non-last row that
// has 2+ beads expands its inter-bead connector width so the row's content
// reaches both edges of its content area. This eliminates the long trailing
// stretch segment before the U-turn. Last row and single-bead rows fall back
// to the default connector width.
function computeRows(items, beadSize, containerWidth, opts) {
  const { uRadius, capWidth, connWidth, jointDotSize } = opts;
  // Worst-case usable width per row: leaves room for left+right U-turn padding.
  // First and last rows actually have one side without padding, but we'd rather
  // wrap a touch early than ever spill past the edge.
  const usable = Math.max(0, containerWidth - 2 * uRadius);

  // Each bead's effective horizontal footprint = bead outer width + two joint
  // dots minus any per-side overlap (lozenge dots overlap into the bead).
  const dotsPerBead = 2 * jointDotSize;
  const beadFootprint = (item) =>
    beadOuterWidth(item.bead.shape, beadSize) +
    dotsPerBead -
    2 * shapeJointOverlap(item.bead.shape, jointDotSize);

  const rawRows = [];
  let cur = [];
  let used = 0;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const bw = beadFootprint(it);
    const isFirst = i === 0;
    const isLast = i === items.length - 1;

    const startReserve = (isFirst && rawRows.length === 0 && cur.length === 0) ? capWidth : 0;
    const endReserve = isLast ? capWidth : 0;
    const conn = cur.length === 0 ? 0 : connWidth;
    const candidate = used + conn + bw + endReserve + startReserve;

    if (cur.length > 0 && candidate > usable) {
      rawRows.push(cur);
      cur = [it];
      used = bw + endReserve;
    } else {
      cur.push(it);
      used += conn + bw + startReserve;
    }
  }
  if (cur.length > 0) rawRows.push(cur);

  return rawRows.map((rowItems, rowIdx) => {
    const isFirstRow = rowIdx === 0;
    const isLastRow = rowIdx === rawRows.length - 1;
    const n = rowItems.length;

    if (isLastRow || n < 2) {
      return { items: rowItems, connectorWidth: connWidth, justify: false };
    }

    const sumFootprint = rowItems.reduce((s, it) => s + beadFootprint(it), 0);
    // Content area width depends on which side has U-turn padding:
    //   - first row (LTR, has outgoing only): right pad uRadius, no left pad
    //   - middle row: both sides padded
    const contentWidth = containerWidth - uRadius - (isFirstRow ? 0 : uRadius);
    const startCap = isFirstRow ? capWidth : 0;
    const slack = contentWidth - sumFootprint - startCap;
    const justifiedConn = slack / (n - 1);
    return {
      items: rowItems,
      connectorWidth: Math.max(connWidth, justifiedConn),
      justify: true,
    };
  });
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    width: '100%',
  },
});
