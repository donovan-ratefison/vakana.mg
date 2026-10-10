import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import BeadView from './BeadView';
import ThreadLine from './ThreadLine';
import { useTheme } from '../theme';

// The vakana clasped shut: the bead chain laid around an ellipse, like a
// necklace or bracelet. This is NOT a second bead renderer: every bead is a
// reused `BeadView`, every connector a reused `ThreadLine` chord (the same
// pure-RN, no-SVG technique BeadChain uses for its U-turns). Only the *path*
// changes: line -> ellipse.
//
// items: same shape as BeadChain: [{ key, bead, faded, sectionLabel, onTap,
//        onLongPress }]
//
// closed === true  -> beads occupy the full 360°; the last bead joins the
//                     first through a golden **clasp** at the top, with the
//                     thread's anchor label sitting at the clasp. This is a
//                     closed loop: a cycle that completed and returns.
// closed === false -> beads occupy a ~290° arc leaving a **gap** at the top
//                     and NO clasp. The absence of the clasp is the whole
//                     visual sentence: "this ring isn't closed yet."

const JOINT_COLOR_DEFAULT = '#C9A24A'; // matches BeadChain's golden joint
// The clasp is always golden regardless of the connector color the screen
// passes. It is the "knot" in the chain vocabulary (same gold as the
// joint dot / marked-bead halo). Solid gold fill, a slightly darker gold
// rim for definition.
const CLASP_GOLD = '#C9A24A';
const CLASP_BORDER = '#9A7B2E';

// Ramanujan's ellipse-perimeter approximation (used only to size the
// ellipse for a target spacing; placement uses an exact sampled table).
function ellipsePerimeter(rx, ry) {
  const h = ((rx - ry) ** 2) / ((rx + ry) ** 2);
  return Math.PI * (rx + ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

// Smallest ry in [minRy, maxRy] whose ellipse perimeter reaches targetP
// (perimeter grows monotonically with ry, so bisection is stable). Used
// only when a round loop won't fit the width, to keep the stretch gentle.
function solveRyForPerimeter(rx, targetP, minRy, maxRy) {
  if (ellipsePerimeter(rx, minRy) >= targetP) return minRy;
  if (ellipsePerimeter(rx, maxRy) <= targetP) return maxRy;
  let lo = minRy;
  let hi = maxRy;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (ellipsePerimeter(rx, mid) < targetP) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export default function LoopBeadChain({
  items,
  beadSize = 36,
  connectorColor,
  capColor,
  stripeColor = 'rgba(150, 110, 40, 0.55)',
  jointColor = JOINT_COLOR_DEFAULT,
  stroke = 4,
  closed = false,
  claspLabel = null,
  onClaspPress = null,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [w, setW] = useState(0);

  const list = items || [];
  const n = list.length;

  // Reserve vertical room above the ellipse for the clasp's anchor label.
  const LABEL_BAND = closed && claspLabel ? 22 : 8;

  const geom = useMemo(() => {
    if (!w || n === 0) return null;

    const margin = beadSize / 2 + 8;
    const widthBound = Math.max(beadSize, w / 2 - margin);
    const cx = w / 2;

    // Single bead: a small circle, just centre it (no connectors/clasp).
    if (n === 1) {
      const r = beadSize;
      const cy = LABEL_BAND + r + beadSize / 2;
      return {
        rx: r, ry: r, cx, cy,
        height: cy + r + beadSize / 2 + 6,
        bead: beadSize,
        nodes: [{ x: cx, y: cy, deg: 0 }],
        links: [],
      };
    }

    // Desired centre-to-centre arc spacing, and the open-loop top gap as a
    // fraction of the whole perimeter.
    const S = beadSize * 1.7;
    const GAP_FRAC = 0.12;
    // Perimeter needed so spacing ≈ S: closed has n segments, open has
    // (n-1) plus the top gap.
    const targetP = closed ? n * S : ((n - 1) * S) / (1 - GAP_FRAC);

    // Round-first. The loop is a CIRCLE whose radius grows with bead
    // count (more beads -> a bigger round loop, which on mobile naturally
    // takes more vertical room and scrolls). Only when that circle would
    // exceed the screen width do we allow a GENTLE vertical stretch
    // (capped at AR_MAX) so the top and bottom never sharpen into points;
    // past that, the bead-size/spacing clamp gives a little instead of
    // going pointy. Floored so a 2-bead loop isn't tiny.
    const AR_MAX = 1.6;
    const rCircle = targetP / (2 * Math.PI);
    const rx = Math.min(widthBound, Math.max(beadSize * 1.1, rCircle));
    const ry =
      rCircle <= rx
        ? rx // fits as a true circle (roundest possible)
        : solveRyForPerimeter(rx, targetP, rx, rx * AR_MAX);

    const cy = LABEL_BAND + ry + beadSize / 2;
    const height = cy + ry + beadSize / 2 + 6;

    // Exact arc-length table. Equal *parametric* steps bunch beads at the
    // sharp ends of an ellipse; we want equal *arc* spacing, so sample the
    // perimeter densely, accumulate true chord length, and invert.
    const M = 720;
    const ts = new Array(M + 1);
    const cum = new Array(M + 1);
    let px = rx;
    let py = 0;
    ts[0] = 0;
    cum[0] = 0;
    for (let k = 1; k <= M; k++) {
      const t = (2 * Math.PI * k) / M;
      const x = rx * Math.cos(t);
      const y = ry * Math.sin(t);
      cum[k] = cum[k - 1] + Math.hypot(x - px, y - py);
      ts[k] = t;
      px = x;
      py = y;
    }
    const total = cum[M];
    const thetaForArc = (s) => {
      let q = s % total;
      if (q < 0) q += total;
      let k = 1;
      while (k <= M && cum[k] < q) k++;
      const k0 = k - 1;
      const seg = cum[k] - cum[k0] || 1;
      return ts[k0] + ((q - cum[k0]) / seg) * (ts[k] - ts[k0]);
    };
    const arcForTheta = (t) => {
      let tt = t % (2 * Math.PI);
      if (tt < 0) tt += 2 * Math.PI;
      const kf = (tt / (2 * Math.PI)) * M;
      const k0 = Math.floor(kf);
      const c0 = cum[k0];
      const c1 = cum[Math.min(M, k0 + 1)];
      return c0 + (kf - k0) * (c1 - c0);
    };

    // Top of the ellipse (12 o'clock) is θ = 3π/2; the clasp / gap is
    // centred there.
    const topArc = arcForTheta((3 * Math.PI) / 2);
    const arcs = [];
    if (closed) {
      // Reserve a WIDER arc slot for the clasp than a normal gap so the
      // golden knot never collides with its two neighbour beads; the
      // remaining n-1 gaps share the rest evenly. Capped at half the
      // perimeter so tiny loops don't collapse the rest.
      const claspArc = Math.min(total * 0.42, S * 1.3);
      const step = (total - claspArc) / (n - 1);
      const start = topArc + claspArc / 2; // first bead, just past the clasp
      for (let i = 0; i < n; i++) arcs.push(start + i * step);
    } else {
      const gapLen = Math.max(S, total * GAP_FRAC);
      const step = (total - gapLen) / (n - 1);
      const start = topArc + gapLen / 2;
      for (let i = 0; i < n; i++) arcs.push(start + i * step);
    }

    const nodes = arcs.map((s) => {
      const a = thetaForArc(s);
      return {
        x: cx + rx * Math.cos(a),
        y: cy + ry * Math.sin(a),
        // Tangent of the ellipse at θ: d/dθ (rx cosθ, ry sinθ) =
        // (−rx sinθ, ry cosθ). The bead lies along the thread.
        deg: (Math.atan2(ry * Math.cos(a), -rx * Math.sin(a)) * 180) / Math.PI,
      };
    });

    // Bead keeps its requested size; only clamp if the width/aspect caps
    // forced spacing below the bead footprint (very long chains).
    const actualStep = total / (closed ? n : n - 1);
    const bead = Math.max(12, Math.min(beadSize, actualStep * 0.82));

    const links = [];
    for (let i = 0; i < n - 1; i++) links.push([i, i + 1]);
    if (closed) links.push([n - 1, 0]); // closing chord -> carries the clasp

    return { rx, ry, cx, cy, height, bead, nodes, links };
  }, [w, n, beadSize, closed, LABEL_BAND]);

  const claspPoint = useMemo(() => {
    if (!geom || !closed || n < 2) return null;
    const a = geom.nodes[n - 1];
    const b = geom.nodes[0];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }, [geom, closed, n]);

  return (
    <View
      style={[styles.wrap, geom ? { height: geom.height } : { height: 1 }]}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
    >
      {geom
        ? geom.links.map(([i, j], idx) => {
            const p = geom.nodes[i];
            const q = geom.nodes[j];
            const dx = q.x - p.x;
            const dy = q.y - p.y;
            const length = Math.hypot(dx, dy);
            const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
            return (
              <View
                key={`lnk-${idx}`}
                style={{
                  position: 'absolute',
                  left: (p.x + q.x) / 2 - length / 2,
                  top: (p.y + q.y) / 2 - stroke / 2,
                  width: length,
                  height: stroke,
                  transform: [{ rotate: `${angle}deg` }],
                }}
              >
                <ThreadLine
                  width={length}
                  height={stroke}
                  color={connectorColor}
                  stripeColor={stripeColor}
                />
              </View>
            );
          })
        : null}

      {geom
        ? list.map((it, i) => {
            const node = geom.nodes[i];
            const sz = geom.bead;
            const isMarked = !!it.sectionLabel || !!it.marked;
            const beadEl = (
              <BeadView
                bead={it.bead}
                size={sz}
                faded={it.faded}
                marked={isMarked}
                hasComments={it.hasComments}
              />
            );
            return (
              // BeadView's container is NOT sz×sz for every shape:
              // sizeOf() makes oval 1.4·sz wide, bar 1.6·sz, dot 0.6·sz
              // (height always sz). Centre the child so each shape's
              // self-centred core lands exactly on the ellipse node
              // regardless of its intrinsic width; without this, oval/bar
              // overflow right and dot sits left of the thread, and the
              // tangent rotation then swings that offset around.
              <View
                key={it.key}
                style={{
                  position: 'absolute',
                  left: node.x - sz / 2,
                  top: node.y - sz / 2,
                  width: sz,
                  height: sz,
                  alignItems: 'center',
                  justifyContent: 'center',
                  transform: [{ rotate: `${node.deg}deg` }],
                }}
              >
                {!it.onTap && !it.onLongPress ? (
                  beadEl
                ) : (
                  <TouchableOpacity
                    onPress={it.onTap}
                    onLongPress={it.onLongPress}
                    delayLongPress={300}
                    activeOpacity={0.7}
                  >
                    {beadEl}
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        : null}

      {claspPoint ? (
        <>
          <TouchableOpacity
            disabled={!onClaspPress}
            onPress={onClaspPress || undefined}
            activeOpacity={onClaspPress ? 0.7 : 1}
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
            accessibilityLabel={
              onClaspPress ? 'Change the close date of this loop' : undefined
            }
            style={[
              styles.clasp,
              {
                left: claspPoint.x - geom.bead * 0.3,
                top: claspPoint.y - geom.bead * 0.3,
                width: geom.bead * 0.6,
                height: geom.bead * 0.6,
                borderRadius: geom.bead * 0.6,
              },
            ]}
          />
          {claspLabel ? (
            <TouchableOpacity
              disabled={!onClaspPress}
              onPress={onClaspPress || undefined}
              activeOpacity={onClaspPress ? 0.7 : 1}
              style={[styles.anchor, { top: 0, width: w }]}
            >
              <Text style={styles.anchorText} numberOfLines={1}>
                {claspLabel}
              </Text>
            </TouchableOpacity>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    wrap: {
      position: 'relative',
      width: '100%',
    },
    clasp: {
      position: 'absolute',
      borderWidth: 1.5,
      borderColor: CLASP_BORDER,
      backgroundColor: CLASP_GOLD,
    },
    anchor: {
      position: 'absolute',
      alignItems: 'center',
    },
    anchorText: {
      textAlign: 'center',
      color: colors.textMuted,
      fontFamily: 'Caveat_400Regular',
      fontSize: 15,
      opacity: 0.9,
    },
  });
