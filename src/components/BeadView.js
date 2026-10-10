import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, {
  Polygon,
  Defs,
  ClipPath,
  G,
  Rect,
  Line,
  Circle,
  SvgXml,
} from 'react-native-svg';
import { MOOD_BY_KEY, ACTION_TYPE_BY_SHAPE, GLASS_GATE } from '../beads/types';
import { renderBeadSvgNatural, renderCastSvg } from '../beads/svg';
import { useTheme } from '../theme';

// Renders a single bead from { shape, pattern, mood, glyph } at a given size.
// Most shapes are pure RN Views (square / round / oval / lozenge / bar / dot);
// patterns are overlay layers on top of a colored rectangular core. The
// `decagon` and `flower` shapes have non-rectangular silhouettes that a
// View's overflow:hidden + borderRadius can't clip to, so they're rendered
// inside an SVG with a <ClipPath> over the shape outline. Every pattern
// also gets an SVG implementation so the texture stays inside the polygon.
//
// Props:
//   bead: { shape, pattern, mood, glyph } | null
//   size: number (default 36)
//   faded: boolean. Render at reduced opacity (used in threads when source removed)
//   marked: boolean. Draw a thin gold stadium-ring around the bead.
//     Used to flag section-header beads in any chain rendering (the
//     detail view's chain plus every preview surface). The ring is an
//     absolute child of the bead container at -2 px inset on each
//     side, so chain spacing math stays unchanged.
// `uprightGlyphDeg` (default 0): when a parent rotates the whole bead
// (the stacked/vertical chain turns bar/oval -90° so the long axis follows
// the thread), pass the counter-angle here. Applied to the glyph layer
// ONLY. A single-character glyph is counter-rotated fully upright. A
// multi-character glyph can't go upright (counter-rotated it would run
// across the bead's short axis and clip), so it stays along the long axis
// but is flipped 180° from the bead so it reads clockwise (top-to-bottom)
// rather than anticlockwise. Box shapes only (the rotation never reaches
// decagon/flower, which the stacked view doesn't turn).
export default function BeadView({ bead, size = 36, faded = false, marked = false, style, uprightGlyphDeg = 0, glossy, hasComments = false }) {
  if (!bead) return null;
  const { shape, pattern, mood, glyph } = bead;
  const moodInfo = MOOD_BY_KEY[mood] || MOOD_BY_KEY.slate;
  const fillColor = moodInfo.color;
  const textColor = moodInfo.text;

  // Size-gated "warm glass" finish: big beads (editor hero, the leading
  // avatar, the thread chain) render the lit gradient + specular highlight via
  // the export renderer (the single source of truth) through <SvgXml>, with
  // the glyph kept as an RN <Text> overlay so emoji stay faithful. Small beads
  // (chain previews, calendar cells, chips) fall through to the flat fast path
  // below: no SVG parse cost where many beads render at once. Callers can
  // OVERRIDE the size gate via `glossy`: the list's leading bead shrinks wide
  // shapes (oval/bar) below the gate to fit its fixed column, but they should
  // still be glass: it passes glossy based on the slot size, not the shrunk one.
  if (glossy != null ? glossy : size >= GLASS_GATE) {
    return (
      <GlassBead
        bead={bead}
        size={size}
        textColor={textColor}
        glyph={glyph}
        faded={faded}
        marked={marked}
        style={style}
        uprightGlyphDeg={uprightGlyphDeg}
        hasComments={hasComments}
      />
    );
  }

  if (shape === 'decagon') {
    return (
      <DecagonBead
        size={size}
        fillColor={fillColor}
        textColor={textColor}
        pattern={pattern}
        glyph={glyph}
        faded={faded}
        marked={marked}
        style={style}
        hasComments={hasComments}
      />
    );
  }
  if (shape === 'flower') {
    return (
      <FlowerBead
        size={size}
        fillColor={fillColor}
        textColor={textColor}
        pattern={pattern}
        glyph={glyph}
        faded={faded}
        marked={marked}
        style={style}
        hasComments={hasComments}
      />
    );
  }

  return (
    <BoxBead
      shape={shape}
      size={size}
      fillColor={fillColor}
      textColor={textColor}
      pattern={pattern}
      glyph={glyph}
      faded={faded}
      marked={marked}
      style={style}
      uprightGlyphDeg={uprightGlyphDeg}
      hasComments={hasComments}
    />
  );
}

// Flat fast path for the six box shapes (square / round / oval / lozenge /
// bar / dot). Its own component, like the three above it in BeadView's
// dispatch, so its hooks never sit behind an early return: a bead whose
// shape changes across renders swaps component type instead of changing
// BeadView's hook count ("Rendered fewer hooks than expected").
function BoxBead({
  shape,
  size,
  fillColor,
  textColor,
  pattern,
  glyph,
  faded,
  marked,
  style,
  uprightGlyphDeg,
  hasComments,
}) {
  const shapeStyle = useMemo(() => shapeStyleFor(shape, size), [shape, size]);
  const core = useMemo(() => coreDimsOf(shape, size), [shape, size]);
  const patternOverlay = useMemo(
    () => patternOverlayFor(pattern, core.w, core.h, textColor),
    [pattern, core.w, core.h, textColor]
  );

  const containerSize = sizeOf(shape, size);

  // The lozenge core is a 45°-rotated square, so its glyph inherits that
  // tilt. Counter it by -45° so the glyph reads upright (matches the
  // list-card ChainPreview, which already does this). This is intrinsic to
  // the shape and applies regardless of char count / parent rotation; it
  // composes additively with the parent counter below.
  const intrinsicGlyphDeg = shape === 'lozenge' ? -45 : 0;
  // Single code point ⇒ keep it upright against a parent rotation (the
  // stacked view turns bar/oval). A multi-character glyph can't go upright
  // (counter-rotated it would run across the bead's short axis and clip),
  // so it stays along the long axis, but flipped 180° from the bead so it
  // reads *clockwise* (top-to-bottom) instead of anticlockwise
  // (bottom-to-top), which read wrong. The parent wrapper turns the bead by
  // -uprightGlyphDeg, so the flip that lands the glyph at +uprightGlyphDeg
  // (clockwise) is 2 × uprightGlyphDeg.
  const singleCharGlyph = !!glyph && Array.from(glyph).length === 1;
  const parentGlyphDeg = uprightGlyphDeg
    ? singleCharGlyph
      ? uprightGlyphDeg
      : 2 * uprightGlyphDeg
    : 0;
  const totalGlyphDeg = intrinsicGlyphDeg + parentGlyphDeg;
  const glyphCounterRotate = totalGlyphDeg
    ? { transform: [{ rotate: `${totalGlyphDeg}deg` }] }
    : null;

  return (
    <View
      style={[
        styles.container,
        { width: containerSize.width, height: containerSize.height },
        faded && styles.faded,
        style,
      ]}
    >
      {marked ? (
        <View
          style={[
            styles.markedHalo,
            { borderRadius: haloBorderRadius(shape, size) },
          ]}
          pointerEvents="none"
        />
      ) : null}
      <View style={[styles.core, shapeStyle, { backgroundColor: fillColor }]}>
        {patternOverlay}
        {glyph ? (
          <Text
            style={[
              styles.glyph,
              {
                color: textColor,
                fontSize: glyphFontSize(size, glyph),
              },
              glyphCounterRotate,
            ]}
            numberOfLines={1}
          >
            {glyph}
          </Text>
        ) : null}
      </View>
      {hasComments ? <CommentDot beadSize={size} /> : null}
    </View>
  );
}

// Warm-glass bead (size-gated). The shape + gradient + specular highlight +
// pattern come from the export renderer via <SvgXml> (so on-device and
// exported beads are literally the same markup); the glyph is overlaid as an
// RN <Text> (emoji-faithful, with the same counter-rotation as the flat path).
function GlassBead({
  bead,
  size,
  textColor,
  glyph,
  faded,
  marked,
  style,
  uprightGlyphDeg,
  hasComments,
}) {
  const shape = bead.shape;
  const container = sizeOf(shape, size);
  const xml = useMemo(
    () => renderBeadSvgNatural(bead, { size, omitGlyph: true }),
    [bead.shape, bead.pattern, bead.mood, bead.glyph, size]
  );
  const { resolved } = useTheme();
  const fillColor = (MOOD_BY_KEY[bead.mood] || MOOD_BY_KEY.slate).color;
  // Cast shadow on light themes (warm espresso); on dark themes a shadow can't
  // read on the near-black surface, so the bead casts a GLOW in its own mood
  // colour instead. Same throw either way: only the colour flips.
  const castColor = resolved === 'dark' ? fillColor : '#2b1d14';
  const castPad = size * 0.4;
  const castXml = useMemo(
    () => renderCastSvg(bead, { size, color: castColor, pad: castPad }),
    [bead.shape, bead.mood, size, castColor, castPad]
  );

  // Unlike the flat path, the lozenge's 45° tilt is baked into the SVG shape
  // here; the glyph is a plain sibling overlay (not a child of a rotated core),
  // so it's already upright and needs NO intrinsic counter-rotation. Only a
  // parent-bead rotation (the stacked chain turning bar/oval) must be countered.
  const singleCharGlyph = !!glyph && Array.from(glyph).length === 1;
  const totalGlyphDeg = uprightGlyphDeg
    ? singleCharGlyph
      ? uprightGlyphDeg
      : 2 * uprightGlyphDeg
    : 0;
  const glyphCounterRotate = totalGlyphDeg
    ? { transform: [{ rotate: `${totalGlyphDeg}deg` }] }
    : null;

  return (
    <View
      style={[
        styles.container,
        { width: container.width, height: container.height },
        faded && styles.faded,
        style,
      ]}
    >
      {marked ? (
        <View
          style={[
            styles.markedHalo,
            { borderRadius: haloBorderRadius(shape, size) },
          ]}
          pointerEvents="none"
        />
      ) : null}
      {/* Cast shadow (light) / cast glow (dark): a soft, offset copy of the
          bead's own silhouette thrown to the lower-right (opposite the
          top-left light). Filter-free: renderCastSvg fakes the softness with
          concentric outward-scaled copies. Drawn behind the bead, so only the
          offset penumbra past the bead's edge shows. */}
      <SvgXml
        xml={castXml}
        width={container.width + castPad * 2}
        height={container.height + castPad * 2}
        style={{ position: 'absolute', left: -castPad, top: -castPad }}
        pointerEvents="none"
      />
      <SvgXml
        xml={xml}
        width={container.width}
        height={container.height}
        style={StyleSheet.absoluteFill}
      />
      {glyph ? (
        <Text
          style={[
            styles.glyph,
            { color: textColor, fontSize: glyphFontSize(size, glyph) },
            glyphCounterRotate,
          ]}
          numberOfLines={1}
        >
          {glyph}
        </Text>
      ) : null}
      {hasComments ? <CommentDot beadSize={size} /> : null}
    </View>
  );
}

// Regular 10-sided polygon inscribed in the bead's bounding square. SVG
// gives us a true polygon outline; trying to fake it with `borderRadius`
// just yields a circle. Pattern is drawn inside a <G clipPath="..."> so it
// stays clipped to the polygon and doesn't bleed past the 10 sides.
function DecagonBead({ size, fillColor, textColor, pattern, glyph, faded, marked, style, hasComments }) {
  const points = useMemo(() => decagonPoints(size), [size]);
  const patternEls = useMemo(
    () => svgPatternFor(pattern, size, size, textColor),
    [pattern, size, textColor]
  );
  return (
    <View
      style={[
        styles.container,
        { width: size, height: size },
        faded && styles.faded,
        style,
      ]}
    >
      {marked ? (
        <View
          style={[
            styles.markedHalo,
            { borderRadius: haloBorderRadius('decagon', size) },
          ]}
          pointerEvents="none"
        />
      ) : null}
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <ClipPath id="decagonClip">
            <Polygon points={points} />
          </ClipPath>
        </Defs>
        <G clipPath="url(#decagonClip)">
          <Rect x={0} y={0} width={size} height={size} fill={fillColor} />
          {patternEls}
        </G>
      </Svg>
      {glyph ? (
        <Text
          style={[
            styles.glyph,
            { color: textColor, fontSize: glyphFontSize(size, glyph) },
          ]}
          numberOfLines={1}
        >
          {glyph}
        </Text>
      ) : null}
      {hasComments ? <CommentDot beadSize={size} /> : null}
    </View>
  );
}

function decagonPoints(size) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2;
  const sides = 10;
  const out = [];
  for (let i = 0; i < sides; i++) {
    // -PI/2 so the first vertex sits at the top of the bead.
    const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    out.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return out.join(' ');
}

// Three overlapping capsules (rounded rectangles, Tic-Tac shape) rotated
// 60° apart around the bead's center form the flower silhouette. Capsules
// stay full-width along most of their length and only taper at the very
// ends, so adjacent petals overlap heavily in the inter-petal regions and
// the union outline has no scallop notches. Drawn entirely in SVG so the
// pattern can be clipped to the union via ClipPath. The rotation set is
// offset by 30° so two of the six petal tips point horizontally, aligning
// with the chain's thread connector at each side.
function FlowerBead({ size, fillColor, textColor, pattern, glyph, faded, marked, style, hasComments }) {
  const cx = size / 2;
  const cy = size / 2;
  const petalW = size * 0.36;
  const petalH = size * 0.92;
  const rectX = cx - petalW / 2;
  const rectY = cy - petalH / 2;
  // rx = ry = petalW/2 turns the rect's short sides into half-circles,
  // i.e., a capsule. Same proportions as the original v0.7.8 pure-View
  // flower so the silhouette matches the look you had before.
  const capsuleR = petalW / 2;
  const rotations = [30, 90, 150];
  const patternEls = useMemo(
    () => svgPatternFor(pattern, size, size, textColor),
    [pattern, size, textColor]
  );
  return (
    <View
      style={[
        styles.container,
        { width: size, height: size },
        faded && styles.faded,
        style,
      ]}
    >
      {marked ? (
        <View
          style={[
            styles.markedHalo,
            { borderRadius: haloBorderRadius('flower', size) },
          ]}
          pointerEvents="none"
        />
      ) : null}
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          {/* Three rotated capsules inside one ClipPath form a union: any
              point inside ANY capsule is inside the clip region. */}
          <ClipPath id="flowerClip">
            {rotations.map((deg) => (
              <Rect
                key={deg}
                x={rectX}
                y={rectY}
                width={petalW}
                height={petalH}
                rx={capsuleR}
                ry={capsuleR}
                transform={`rotate(${deg} ${cx} ${cy})`}
              />
            ))}
          </ClipPath>
        </Defs>
        <G clipPath="url(#flowerClip)">
          <Rect x={0} y={0} width={size} height={size} fill={fillColor} />
          {patternEls}
        </G>
      </Svg>
      {glyph ? (
        <Text
          style={[
            styles.glyph,
            { color: textColor, fontSize: glyphFontSize(size, glyph) },
          ]}
          numberOfLines={1}
        >
          {glyph}
        </Text>
      ) : null}
      {hasComments ? <CommentDot beadSize={size} /> : null}
    </View>
  );
}

// Presence cue at a bead's top-right corner: the bead's entry carries at
// least one comment. Primary-coloured (the comment-affordance hue, matching
// the count-chip → drawer idiom) with a background-coloured rim so it reads
// on any mood colour. Deliberately NOT gold: gold is the section-landmark
// ring. Presence only; the count lives in the comments drawer one tap away.
// Sits just past the bead's bounding box (the container doesn't clip), so it
// reads as a small badge clinging to the bead. Pure-derived: shows only when
// a caller passes hasComments, so every other BeadView surface is unaffected.
function CommentDot({ beadSize }) {
  const { colors } = useTheme();
  const d = Math.max(7, Math.round(beadSize * 0.26));
  const out = Math.round(d * 0.18);
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: -out,
        right: -out,
        width: d,
        height: d,
        borderRadius: d / 2,
        backgroundColor: colors.primary,
        borderWidth: Math.max(1, Math.round(d * 0.14)),
        borderColor: colors.background,
      }}
    />
  );
}

// SVG analogues of the View-based pattern overlays. Same spacing / opacity
// / element-density so the visual reads consistently across all shapes.
// Returns an array of SVG elements ready to drop inside a clipped <G>.
function svgPatternFor(pattern, w, h, color) {
  if (!pattern || pattern === 'solid' || !w || !h) return null;

  switch (pattern) {
    case 'striped': {
      const SPACING = 5;
      const STRIPE = 1.5;
      const count = Math.max(2, Math.round(w / SPACING));
      const step = w / count;
      const out = [];
      for (let i = 0; i < count; i++) {
        const x = (i + 0.5) * step;
        out.push(
          <Line
            key={i}
            x1={x}
            y1={0}
            x2={x}
            y2={h}
            stroke={color}
            strokeWidth={STRIPE}
            opacity={0.4}
          />
        );
      }
      return out;
    }
    case 'diagonal': {
      const SPACING = 12;
      const STRIPE = 1.5;
      const reach = Math.max(w, h);
      const lines = [];
      let idx = 0;
      for (let x = -reach; x < w + reach; x += SPACING, idx++) {
        lines.push(
          <Line
            key={idx}
            x1={x}
            y1={-reach}
            x2={x}
            y2={h + reach}
            stroke={color}
            strokeWidth={STRIPE}
            opacity={0.5}
          />
        );
      }
      return (
        <G key="diag" transform={`rotate(60 ${w / 2} ${h / 2})`}>
          {lines}
        </G>
      );
    }
    case 'dashed': {
      const SPACING = 5;
      const LINE = 1.5;
      const count = Math.max(2, Math.round(h / SPACING));
      const step = h / count;
      const out = [];
      for (let i = 0; i < count; i++) {
        const y = (i + 0.5) * step;
        out.push(
          <Line
            key={i}
            x1={0}
            y1={y}
            x2={w}
            y2={y}
            stroke={color}
            strokeWidth={LINE}
            opacity={0.4}
          />
        );
      }
      return out;
    }
    case 'dotted': {
      const SPACING = 5;
      const cols = Math.max(2, Math.round(w / SPACING));
      const rows = Math.max(2, Math.round(h / SPACING));
      const stepX = w / cols;
      const stepY = h / rows;
      const r = 0.9;
      const out = [];
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const cx = (col + 0.5) * stepX;
          const cy = (row + 0.5) * stepY;
          out.push(
            <Circle
              key={`${row}-${col}`}
              cx={cx}
              cy={cy}
              r={r}
              fill={color}
              opacity={0.5}
            />
          );
        }
      }
      return out;
    }
    case 'checkered': {
      const TILE = 5;
      const cols = Math.max(2, Math.round(w / TILE));
      const rows = Math.max(2, Math.round(h / TILE));
      const tileW = w / cols;
      const tileH = h / rows;
      const out = [];
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          if ((row + col) % 2 === 0) continue;
          out.push(
            <Rect
              key={`${row}-${col}`}
              x={col * tileW}
              y={row * tileH}
              width={tileW + 0.5}
              height={tileH + 0.5}
              fill={color}
              opacity={0.32}
            />
          );
        }
      }
      return out;
    }
    case 'floral': {
      const TILE = 9;
      const cols = Math.max(1, Math.round(w / TILE));
      const rows = Math.max(1, Math.round(h / TILE));
      const stepX = w / cols;
      const stepY = h / rows;
      const petal = Math.max(1.6, Math.min(stepX, stepY) * 0.22);
      const offset = Math.min(stepX, stepY) * 0.3;
      const out = [];
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const cx = (col + 0.5) * stepX;
          const cy = (row + 0.5) * stepY;
          const positions = [
            [cx, cy - offset, 0.4],
            [cx, cy + offset, 0.4],
            [cx - offset, cy, 0.4],
            [cx + offset, cy, 0.4],
            [cx, cy, 0.55],
          ];
          positions.forEach(([px, py, op], i) => {
            out.push(
              <Circle
                key={`${row}-${col}-${i}`}
                cx={px}
                cy={py}
                r={petal / 2}
                fill={color}
                opacity={op}
              />
            );
          });
        }
      }
      return out;
    }
    case 'circle': {
      const ringDim = Math.min(w, h);
      const outerR = (ringDim * 0.75) / 2;
      const innerR = (ringDim * 0.4) / 2;
      const ringWidth = Math.max(1, ringDim * 0.045);
      const cx = w / 2;
      const cy = h / 2;
      return [
        <Circle
          key="outer"
          cx={cx}
          cy={cy}
          r={outerR}
          stroke={color}
          strokeWidth={ringWidth}
          fill="none"
          opacity={0.5}
        />,
        <Circle
          key="inner"
          cx={cx}
          cy={cy}
          r={innerR}
          stroke={color}
          strokeWidth={ringWidth}
          fill="none"
          opacity={0.55}
        />,
      ];
    }
    default:
      return null;
  }
}

// Container height is constant `size` for every shape so chains of beads share
// a baseline; only width and the inner core size vary per shape. Width matches
// the visible core so connectors and chain caps touch the bead edge directly.
function sizeOf(shape, size) {
  switch (shape) {
    case 'oval':
      return { width: size * 1.4, height: size };
    case 'bar':
      return { width: size * 1.6, height: size };
    case 'dot':
      return { width: size * 0.6, height: size };
    default:
      return { width: size, height: size };
  }
}

// The visible core dimensions per shape. Used to size and tile pattern overlays.
function coreDimsOf(shape, size) {
  switch (shape) {
    case 'oval':
      return { w: size * 1.4, h: size };
    case 'bar':
      return { w: size * 1.6, h: size * 0.55 };
    case 'dot':
      return { w: size * 0.6, h: size * 0.6 };
    default:
      return { w: size, h: size };
  }
}

function shapeStyleFor(shape, size) {
  switch (shape) {
    case 'square':
      return { borderRadius: size * 0.18, width: '100%', height: '100%' };
    case 'round':
      return { borderRadius: size, width: '100%', height: '100%' };
    case 'oval':
      return { borderRadius: size, width: '100%', height: '100%' };
    case 'lozenge':
      return {
        borderRadius: size * 0.18,
        width: '100%',
        height: '100%',
        transform: [{ rotate: '45deg' }, { scale: 0.72 }],
      };
    case 'bar':
      return { borderRadius: size * 0.2, width: '100%', height: size * 0.55 };
    case 'dot':
      return { borderRadius: size, width: size * 0.6, height: size * 0.6 };
    default:
      return { borderRadius: size * 0.18, width: '100%', height: '100%' };
  }
}

// View-based pattern overlay engine used by the simple shapes. Each pattern is
// tiled at a fixed pixel density across the visible core dimensions, so larger
// beads carry more repeats instead of being sparse.
function patternOverlayFor(pattern, w, h, color) {
  if (!pattern || pattern === 'solid' || !w || !h) return null;
  const base = { position: 'absolute', backgroundColor: color };

  switch (pattern) {
    case 'striped': {
      const SPACING = 5;
      const STRIPE = 1.5;
      const count = Math.max(2, Math.round(w / SPACING));
      const step = w / count;
      const lines = [];
      for (let i = 0; i < count; i++) {
        lines.push(
          <View
            key={i}
            style={[
              base,
              {
                top: 0,
                bottom: 0,
                width: STRIPE,
                left: (i + 0.5) * step - STRIPE / 2,
                opacity: 0.4,
              },
            ]}
          />
        );
      }
      return <View style={StyleSheet.absoluteFill}>{lines}</View>;
    }
    case 'diagonal': {
      // Tall thin stripes rotated 60° around their own center; iterate left
      // positions from -reach to w+reach so the rotated sweep covers the full
      // bead. overflow:hidden on the parent core clips anything that lands
      // outside.
      const SPACING = 12;
      const STRIPE = 1.5;
      const ANGLE = 60;
      const reach = Math.max(w, h);
      const lines = [];
      let idx = 0;
      for (let x = -reach; x < w + reach; x += SPACING, idx++) {
        lines.push(
          <View
            key={idx}
            style={[
              base,
              {
                top: -reach,
                bottom: -reach,
                width: STRIPE,
                left: x - STRIPE / 2,
                opacity: 0.5,
                transform: [{ rotate: `${ANGLE}deg` }],
              },
            ]}
          />
        );
      }
      return <View style={StyleSheet.absoluteFill}>{lines}</View>;
    }
    case 'dashed': {
      const SPACING = 5;
      const LINE = 1.5;
      const count = Math.max(2, Math.round(h / SPACING));
      const step = h / count;
      const lines = [];
      for (let i = 0; i < count; i++) {
        lines.push(
          <View
            key={i}
            style={[
              base,
              {
                left: 0,
                right: 0,
                height: LINE,
                top: (i + 0.5) * step - LINE / 2,
                opacity: 0.4,
              },
            ]}
          />
        );
      }
      return <View style={StyleSheet.absoluteFill}>{lines}</View>;
    }
    case 'dotted': {
      const SPACING = 5;
      const cols = Math.max(2, Math.round(w / SPACING));
      const rows = Math.max(2, Math.round(h / SPACING));
      const stepX = w / cols;
      const stepY = h / rows;
      const dot = 1.8;
      const dots = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          dots.push(
            <View
              key={`${r}-${c}`}
              style={[
                base,
                {
                  width: dot,
                  height: dot,
                  borderRadius: dot,
                  left: (c + 0.5) * stepX - dot / 2,
                  top: (r + 0.5) * stepY - dot / 2,
                  opacity: 0.5,
                },
              ]}
            />
          );
        }
      }
      return <View style={StyleSheet.absoluteFill}>{dots}</View>;
    }
    case 'checkered': {
      const TILE = 5;
      const cols = Math.max(2, Math.round(w / TILE));
      const rows = Math.max(2, Math.round(h / TILE));
      const tileW = w / cols;
      const tileH = h / rows;
      const tiles = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if ((r + c) % 2 === 0) continue;
          tiles.push(
            <View
              key={`${r}-${c}`}
              style={[
                base,
                {
                  left: c * tileW,
                  top: r * tileH,
                  // +0.5 closes hairline gaps from sub-pixel rounding
                  width: tileW + 0.5,
                  height: tileH + 0.5,
                  opacity: 0.32,
                },
              ]}
            />
          );
        }
      }
      return <View style={StyleSheet.absoluteFill}>{tiles}</View>;
    }
    case 'circle': {
      // Concentric rings centered on the bead. Two rings (outer at 75%
      // of the smaller core dimension, inner at 40%) read as "circles"
      // without crowding small beads.
      const ringDim = Math.min(w, h);
      const outer = ringDim * 0.75;
      const inner = ringDim * 0.4;
      const ringWidth = Math.max(1, ringDim * 0.045);
      return (
        <View style={StyleSheet.absoluteFill}>
          <View
            style={{
              position: 'absolute',
              left: (w - outer) / 2,
              top: (h - outer) / 2,
              width: outer,
              height: outer,
              borderRadius: outer / 2,
              borderWidth: ringWidth,
              borderColor: color,
              opacity: 0.5,
            }}
          />
          <View
            style={{
              position: 'absolute',
              left: (w - inner) / 2,
              top: (h - inner) / 2,
              width: inner,
              height: inner,
              borderRadius: inner / 2,
              borderWidth: ringWidth,
              borderColor: color,
              opacity: 0.55,
            }}
          />
        </View>
      );
    }
    case 'floral': {
      const TILE = 9;
      const cols = Math.max(1, Math.round(w / TILE));
      const rows = Math.max(1, Math.round(h / TILE));
      const stepX = w / cols;
      const stepY = h / rows;
      const petal = Math.max(1.6, Math.min(stepX, stepY) * 0.22);
      const offset = Math.min(stepX, stepY) * 0.3;
      const petals = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cx = (c + 0.5) * stepX;
          const cy = (r + 0.5) * stepY;
          const positions = [
            [cx, cy - offset],
            [cx, cy + offset],
            [cx - offset, cy],
            [cx + offset, cy],
            [cx, cy],
          ];
          positions.forEach(([px, py], i) => {
            petals.push(
              <View
                key={`${r}-${c}-${i}`}
                style={[
                  base,
                  {
                    width: petal,
                    height: petal,
                    borderRadius: petal,
                    left: px - petal / 2,
                    top: py - petal / 2,
                    opacity: i === 4 ? 0.55 : 0.4,
                  },
                ]}
              />
            );
          });
        }
      }
      return <View style={StyleSheet.absoluteFill}>{petals}</View>;
    }
    default:
      return null;
  }
}

// Border radius for the marked-bead halo, matched to the bead's own
// silhouette so the gold ring follows the shape instead of clipping
// across the bead's corners. Square / bar get the same rounded-rect
// curvature as their cores, plus a few px for the halo's inset; every
// other shape (round, oval, dot, lozenge, decagon, flower) falls
// through to a stadium / circle, which is a good fit for those
// silhouettes' bounding boxes.
function haloBorderRadius(shape, size) {
  switch (shape) {
    case 'square':
      return size * 0.18 + 2;
    case 'bar':
      return size * 0.2 + 2;
    default:
      return 999;
  }
}

// A glyph's *visual* length, not its UTF-16 code-unit length, so a single
// grapheme spanning several code points sizes like one character. Keycap
// emoji ("1️⃣" = digit + U+FE0F + U+20E3) and any variation-selector
// sequence collapse to 1 (strip the selectors + the combining enclosing
// keycap); surrogate-pair emoji count as 1 via Array.from. Without this a
// keycap number got the smallest (3-char) size and nearly vanished on small
// beads. The tutorial's numbered beads use exactly these.
function visualGlyphLength(glyph) {
  if (!glyph) return 0;
  const stripped = glyph.replace(/[\uFE0E\uFE0F\u20E3]/g, '');
  return Array.from(stripped).length;
}

function glyphFontSize(size, glyph) {
  const len = visualGlyphLength(glyph);
  if (len <= 1) return Math.max(8, size * 0.42);
  if (len === 2) return Math.max(8, size * 0.34);
  return Math.max(7, size * 0.28);
}

export function actionTypeOf(shape) {
  return ACTION_TYPE_BY_SHAPE[shape]?.label ?? null;
}

// Outer width of a rendered bead at `size`, for layout math (chain wrapping).
// Single definition lives in the bead renderer (src/beads/svg.js); re-exported
// here so BeadChain / VerticalBeadChain keep importing it from BeadView.
export { beadOuterWidth } from '../beads/svg';

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  faded: { opacity: 0.4 },
  core: {
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  glyph: {
    fontWeight: '700',
    includeFontPadding: false,
  },
  // Soft golden ring drawn around section-header beads. Gold matches
  // the chain's joint dot color (#C9A24A in BeadChain) so the ring
  // reads as part of the chain vocabulary ("this bead is a landmark
  // on the thread"), not a generic UI highlight. -2 px inset on each
  // side; the borderRadius is supplied per-shape by haloBorderRadius
  // so square / bar beads get a rounded-rect halo that follows their
  // silhouette and the rest fall through to a stadium / circle.
  markedHalo: {
    position: 'absolute',
    left: -2,
    top: -2,
    right: -2,
    bottom: -2,
    borderWidth: 1,
    borderColor: 'rgba(201, 162, 74, 0.7)',
  },
});
