// Pure, dependency-free SVG-string renderer for a bead and a bead chain.
// This is the SINGLE source of truth for off-screen bead rendering: Org
// export, the slide deck, and the HTML/PDF/Markdown article chain all go
// through here (svgExport.js is a thin compat shim over this module).
//
// It is a faithful mirror of the on-device renderer `BeadView.js`:
// the same per-shape box geometry (`sizeOf` / `coreDimsOf`), the same
// silhouettes (rounded-square, stadium, 45°-rotated rounded square for
// the lozenge, vertically-centered bar, centered dot, inscribed decagon,
// three-capsule-union flower), the same eight pattern overlays
// (`svgPatternFor`), and the same glyph sizing/weight. Patterns are
// clipped to the silhouette via a per-bead <clipPath> whose id is
// **unique per call** so many inline beads in one HTML document (the
// slide spine) don't all collapse onto the first bead's clip.
//
// No React / no react-native: string templating only, so it runs in the
// export path and is unit-testable in isolation.

import { MOOD_BY_KEY, GLASS_GATE } from './types';

// Monotonic id seed. Per export run the call order is deterministic, so
// re-exporting the same thread yields the same ids (Org reproducible
// mode only cares about timestamps/version, not these local ids).
let _uid = 0;
function nextId() {
  return 'vb' + (_uid++).toString(36);
}

function xmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function n(v) {
  // Compact: 3 decimals max, trailing zeros trimmed.
  return Number(Number(v).toFixed(3)).toString();
}

// Normalize a vocabulary key before lookup. This guards against stray
// casing/whitespace in older rows so a valid bead never silently falls
// back to the gray "slate" default.
function norm(v) {
  return String(v ?? '').trim().toLowerCase();
}

function moodColors(mood) {
  const m = MOOD_BY_KEY[norm(mood)] || MOOD_BY_KEY.slate;
  return { fill: m.color, text: m.text };
}

// Outer box per shape: width varies, height is always `size`
// (BeadView.sizeOf). Connectors/centering rely on this.
export function beadOuterWidth(shape, size) {
  switch (shape) {
    case 'oval':
      return size * 1.4;
    case 'bar':
      return size * 1.6;
    case 'dot':
      return size * 0.6;
    default:
      return size;
  }
}
export function beadOuterHeight(_shape, size) {
  return size;
}

// Visible core dims used for pattern tiling (BeadView.coreDimsOf).
function coreDims(shape, size) {
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

// NOT identical to BeadView.glyphFontSize: BeadView counts the *visual*
// glyph length (variation selectors + keycap stripped, surrogate pairs = 1),
// so keycap numbers / emoji render larger on screen than in exports. Left
// un-unified on purpose (issue #21) until the maker picks the behaviour.
function glyphFontSize(size, glyph) {
  const len = (glyph || '').length; // UTF-16 length
  if (len <= 1) return Math.max(8, size * 0.42);
  if (len === 2) return Math.max(8, size * 0.34);
  return Math.max(7, size * 0.28);
}

// Same geometry as BeadView.decagonPoints, but coordinates are formatted
// with n() (≤3 decimals, zeros trimmed) vs BeadView's toFixed(2), so not
// byte-identical; left un-unified (issue #21).
function decagonPoints(size) {
  const c = size / 2;
  const r = size / 2;
  const out = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI * 2 * i) / 10 - Math.PI / 2;
    out.push(`${n(c + r * Math.cos(a))},${n(c + r * Math.sin(a))}`);
  }
  return out.join(' ');
}

// Silhouette element(s) in box coords (box = bw × size). Faithful to
// BeadView.shapeStyleFor / DecagonBead / FlowerBead.
function silhouette(shape, bw, size) {
  const c = size / 2;
  switch (shape) {
    case 'square':
      return `<rect x="0" y="0" width="${n(bw)}" height="${n(size)}" rx="${n(size * 0.18)}" ry="${n(size * 0.18)}"/>`;
    case 'round':
      return `<rect x="0" y="0" width="${n(bw)}" height="${n(size)}" rx="${n(size)}" ry="${n(size)}"/>`;
    case 'oval':
      // 1.4s × s rounded with rx = s → a horizontal stadium (matches
      // BeadView's borderRadius:size on the wide box).
      return `<rect x="0" y="0" width="${n(bw)}" height="${n(size)}" rx="${n(size)}" ry="${n(size)}"/>`;
    case 'lozenge': {
      // A rounded square scaled to 0.72 and rotated 45° about center.
      const side = size * 0.72;
      const x = c - side / 2;
      return `<rect x="${n(x)}" y="${n(x)}" width="${n(side)}" height="${n(side)}" rx="${n(size * 0.18 * 0.72)}" ry="${n(size * 0.18 * 0.72)}" transform="rotate(45 ${n(c)} ${n(c)})"/>`;
    }
    case 'bar': {
      const h = size * 0.55;
      const top = (size - h) / 2;
      return `<rect x="0" y="${n(top)}" width="${n(bw)}" height="${n(h)}" rx="${n(size * 0.2)}" ry="${n(size * 0.2)}"/>`;
    }
    case 'dot': {
      const r = (size * 0.6) / 2;
      return `<circle cx="${n(bw / 2)}" cy="${n(c)}" r="${n(r)}"/>`;
    }
    case 'decagon':
      return `<polygon points="${decagonPoints(size)}"/>`;
    case 'flower': {
      const petalW = size * 0.36;
      const petalH = size * 0.92;
      const x = c - petalW / 2;
      const y = c - petalH / 2;
      const rr = petalW / 2; // capsule
      return [30, 90, 150]
        .map(
          (deg) =>
            `<rect x="${n(x)}" y="${n(y)}" width="${n(petalW)}" height="${n(petalH)}" rx="${n(rr)}" ry="${n(rr)}" transform="rotate(${deg} ${n(c)} ${n(c)})"/>`
        )
        .join('');
    }
    default:
      return `<rect x="0" y="0" width="${n(bw)}" height="${n(size)}" rx="${n(size * 0.18)}" ry="${n(size * 0.18)}"/>`;
  }
}

// SVG-string analogue of BeadView.svgPatternFor: identical spacing,
// opacity and element density so the texture reads the same off-screen.
// Drawn in core coords (0,0)–(w,h); the caller translates by yOffset.
function patternMarkup(pattern, w, h, color) {
  if (!pattern || pattern === 'solid' || !w || !h) return '';
  switch (pattern) {
    case 'striped': {
      const count = Math.max(2, Math.round(w / 5));
      const step = w / count;
      let o = '';
      for (let i = 0; i < count; i++) {
        const x = (i + 0.5) * step;
        o += `<line x1="${n(x)}" y1="0" x2="${n(x)}" y2="${n(h)}" stroke="${color}" stroke-width="1.5" opacity="0.4"/>`;
      }
      return o;
    }
    case 'diagonal': {
      const reach = Math.max(w, h);
      let lines = '';
      for (let x = -reach; x < w + reach; x += 12) {
        lines += `<line x1="${n(x)}" y1="${n(-reach)}" x2="${n(x)}" y2="${n(h + reach)}" stroke="${color}" stroke-width="1.5" opacity="0.5"/>`;
      }
      return `<g transform="rotate(60 ${n(w / 2)} ${n(h / 2)})">${lines}</g>`;
    }
    case 'dashed': {
      const count = Math.max(2, Math.round(h / 5));
      const step = h / count;
      let o = '';
      for (let i = 0; i < count; i++) {
        const y = (i + 0.5) * step;
        o += `<line x1="0" y1="${n(y)}" x2="${n(w)}" y2="${n(y)}" stroke="${color}" stroke-width="1.5" opacity="0.4"/>`;
      }
      return o;
    }
    case 'dotted': {
      const cols = Math.max(2, Math.round(w / 5));
      const rows = Math.max(2, Math.round(h / 5));
      const sx = w / cols;
      const sy = h / rows;
      let o = '';
      for (let r = 0; r < rows; r++)
        for (let cI = 0; cI < cols; cI++)
          o += `<circle cx="${n((cI + 0.5) * sx)}" cy="${n((r + 0.5) * sy)}" r="0.9" fill="${color}" opacity="0.5"/>`;
      return o;
    }
    case 'checkered': {
      const cols = Math.max(2, Math.round(w / 5));
      const rows = Math.max(2, Math.round(h / 5));
      const tw = w / cols;
      const th = h / rows;
      let o = '';
      for (let r = 0; r < rows; r++)
        for (let cI = 0; cI < cols; cI++) {
          if ((r + cI) % 2 === 0) continue;
          o += `<rect x="${n(cI * tw)}" y="${n(r * th)}" width="${n(tw + 0.5)}" height="${n(th + 0.5)}" fill="${color}" opacity="0.32"/>`;
        }
      return o;
    }
    case 'floral': {
      const cols = Math.max(1, Math.round(w / 9));
      const rows = Math.max(1, Math.round(h / 9));
      const sx = w / cols;
      const sy = h / rows;
      const petal = Math.max(1.6, Math.min(sx, sy) * 0.22);
      const off = Math.min(sx, sy) * 0.3;
      let o = '';
      for (let r = 0; r < rows; r++)
        for (let cI = 0; cI < cols; cI++) {
          const cx = (cI + 0.5) * sx;
          const cy = (r + 0.5) * sy;
          const pts = [
            [cx, cy - off, 0.4],
            [cx, cy + off, 0.4],
            [cx - off, cy, 0.4],
            [cx + off, cy, 0.4],
            [cx, cy, 0.55],
          ];
          for (const [px, py, op] of pts)
            o += `<circle cx="${n(px)}" cy="${n(py)}" r="${n(petal / 2)}" fill="${color}" opacity="${op}"/>`;
        }
      return o;
    }
    case 'circle': {
      const ring = Math.min(w, h);
      const oR = (ring * 0.75) / 2;
      const iR = (ring * 0.4) / 2;
      const rw = Math.max(1, ring * 0.045);
      const cx = w / 2;
      const cy = h / 2;
      return (
        `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(oR)}" stroke="${color}" stroke-width="${n(rw)}" fill="none" opacity="0.5"/>` +
        `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(iR)}" stroke="${color}" stroke-width="${n(rw)}" fill="none" opacity="0.55"/>`
      );
    }
    default:
      return '';
  }
}

const GLYPH_FONT =
  "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue'," +
  "'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";

// Lighten (+pct) or darken (-pct) a hex colour toward white/black.
function shade(hex, pct) {
  const c = String(hex).replace('#', '');
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const t = pct < 0 ? 0 : 255;
  const p = Math.abs(pct) / 100;
  const f = (v) => Math.round((t - v) * p + v).toString(16).padStart(2, '0');
  return '#' + f(r) + f(g) + f(b);
}

// Per-shape specular highlight(s), tuned to each silhouette so the glass
// shine follows the surface: a spherical spot (round/dot), a stretched spot
// (oval), a broad cabochon sheen (square/lozenge), a streak down the rod
// (bar), a band on the top facets (decagon), a spot per upper lobe (flower),
// rather than one spot pasted on everything. Each ellipse is filled with a
// soft white→transparent radial (id `hg`) so no blur filter is needed, which
// keeps it identical under react-native-svg's <SvgXml>.
// Per-shape spot geometry [cx, cy, rx, ry, opacity, rotateDeg] for the
// specular highlight. The opposite-side core shadow reuses the SAME spots,
// reflected through the bead centre, so the light and the shadow always agree.
function glossSpots(shape, bw, size) {
  switch (shape) {
    case 'round':
      return [[bw * 0.34, size * 0.28, bw * 0.2, size * 0.15, 1, 0]];
    case 'dot':
      return [[bw * 0.4, size * 0.4, bw * 0.24, size * 0.14, 1, 0]];
    case 'oval':
      return [[bw * 0.32, size * 0.28, bw * 0.16, size * 0.15, 0.95, -8]];
    case 'square':
      return [[size * 0.4, size * 0.3, size * 0.3, size * 0.17, 0.8, 0]];
    case 'lozenge':
      return [[size * 0.4, size * 0.3, size * 0.24, size * 0.15, 0.8, 0]];
    case 'bar':
      return [[bw * 0.5, size * 0.34, bw * 0.42, size * 0.08, 0.85, 0]];
    case 'decagon':
      return [[size * 0.42, size * 0.3, size * 0.25, size * 0.13, 0.9, 0]];
    case 'flower':
      return [
        [size * 0.5, size * 0.18, size * 0.13, size * 0.16, 0.8, 0],
        [size * 0.66, size * 0.22, size * 0.12, size * 0.15, 0.7, 0],
        [size * 0.34, size * 0.22, size * 0.12, size * 0.15, 0.7, 0],
      ];
    default:
      return [[bw * 0.34, size * 0.28, bw * 0.2, size * 0.15, 1, 0]];
  }
}

// The "warm glass" body for a bead: a lit gradient fill on the silhouette +
// a clipped specular highlight. Replaces the flat `<g fill>`. Filter-free
// (softness comes from gradients), so BeadView renders the exact same markup
// through <SvgXml>. Size-gated by the caller.
function glossyLayers(shape, bw, size, fill, geo, idSeed) {
  const L = (p) => shade(fill, p);
  const D = (p) => shade(fill, -p);
  const gid = idSeed + '-g';
  const hg = idSeed + '-h';
  const hc = idSeed + '-hc';
  let grad;
  if (shape === 'bar') {
    grad =
      `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="0" ` +
      `y1="${n(size * 0.18)}" x2="0" y2="${n(size * 0.88)}">` +
      `<stop offset="0" stop-color="${L(46)}"/>` +
      `<stop offset="0.42" stop-color="${fill}"/>` +
      `<stop offset="1" stop-color="${D(30)}"/></linearGradient>`;
  } else {
    const gr = shape === 'oval' ? bw * 0.55 : size * 0.82;
    grad =
      `<radialGradient id="${gid}" gradientUnits="userSpaceOnUse" ` +
      `cx="${n(bw * 0.36)}" cy="${n(size * 0.28)}" r="${n(gr)}" ` +
      `fx="${n(bw * 0.3)}" fy="${n(size * 0.22)}">` +
      `<stop offset="0" stop-color="${L(48)}"/>` +
      `<stop offset="0.46" stop-color="${fill}"/>` +
      `<stop offset="1" stop-color="${D(30)}"/></radialGradient>`;
  }
  const hgrad =
    `<radialGradient id="${hg}">` +
    `<stop offset="0" stop-color="#ffffff" stop-opacity="0.72"/>` +
    `<stop offset="0.7" stop-color="#ffffff" stop-opacity="0.14"/>` +
    `<stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>`;
  const E = (cx, cy, rx, ry, op, rot) =>
    `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" ` +
    `fill="url(#${hg})" opacity="${op}"` +
    (rot ? ` transform="rotate(${rot} ${n(cx)} ${n(cy)})"` : '') +
    `/>`;
  const highlights = glossSpots(shape, bw, size)
    .map(([cx, cy, rx, ry, op, rot]) => E(cx, cy, rx, ry, op, rot))
    .join('');
  return (
    `<defs>${grad}${hgrad}<clipPath id="${hc}">${geo}</clipPath></defs>` +
    `<g fill="url(#${gid})">${geo}</g>` +
    `<g clip-path="url(#${hc})">${highlights}</g>`
  );
}

// One bead as an inner `<g>` laid out in a (bw × size) box. `idSeed`
// keys its private clipPath. Pattern color = the mood's contrast text
// color (same as BeadView).
function beadGroup(bead, size, idSeed, opts = {}) {
  const b = bead || {};
  const shape = norm(b.shape) || 'round';
  const { fill, text } = moodColors(b.mood);
  const glossy = opts.glossy != null ? opts.glossy : size >= GLASS_GATE;
  const bw = beadOuterWidth(shape, size);
  const core = coreDims(shape, size);
  const yOff = (size - core.h) / 2; // bar/dot are vertically centered
  const geo = silhouette(shape, bw, size);
  const pat = patternMarkup(norm(b.pattern), core.w, core.h, text);
  const glyph = (b.glyph || '').trim();
  // omitGlyph lets BeadView overlay its own RN <Text> (emoji-faithful) on top.
  const glyphEl =
    glyph && !opts.omitGlyph
      ? `<text x="${n(bw / 2)}" y="${n(size / 2)}" text-anchor="middle" ` +
        `dominant-baseline="central" fill="${text}" font-weight="700" ` +
        `font-size="${n(glyphFontSize(size, glyph))}" font-family="${GLYPH_FONT}">` +
        `${xmlEscape(glyph)}</text>`
      : '';
  // The silhouette is filled DIRECTLY (color on the shape), not a
  // rect-clipped-to-a-shape. So even if a viewer mishandles
  // `clip-path: url(#…)` the bead still shows its correct shape + color
  // (it just loses the pattern texture). It can never degrade to a
  // blank/!-shaped blob. The clipPath is emitted only when there's a
  // pattern to bound, and only bounds that overlay.
  const clipId = idSeed + '-c';
  const body = glossy
    ? glossyLayers(shape, bw, size, fill, geo, idSeed)
    : `<g fill="${fill}">${geo}</g>`;
  return (
    `<g>` +
    body +
    (pat
      ? `<defs><clipPath id="${clipId}">${geo}</clipPath></defs>` +
        `<g clip-path="url(#${clipId})">` +
        (yOff ? `<g transform="translate(0 ${n(yOff)})">${pat}</g>` : pat) +
        `</g>`
      : '') +
    glyphEl +
    `</g>`
  );
}

// A single bead → a self-contained, square SVG document. The (possibly
// non-square) bead box is centered and scaled to fit, so every asset is
// a tidy square that drops into a fixed-size container (the slide spine,
// an Org inline image) without distortion.
export function renderBeadSvg(bead, opts = {}) {
  const S = opts.size || 256;
  const shape = norm(bead && bead.shape) || 'round';
  const bw = beadOuterWidth(shape, S);
  const scale = bw > S ? S / bw : 1;
  const tx = (S - bw * scale) / 2;
  const ty = (S - S * scale) / 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" ` +
    `width="${S}" height="${S}" role="img">` +
    `<g transform="translate(${n(tx)} ${n(ty)}) scale(${n(scale)})">` +
    beadGroup(bead, S, nextId()) +
    `</g></svg>`
  );
}

// Like renderBeadSvg but at the bead's natural (bw × size) box (no square
// fit/scale) for the on-device <SvgXml> path so it lines up 1:1 with
// BeadView's container. Always glossy (the caller only reaches here when the
// size gate is already passed). `omitGlyph` so BeadView keeps its RN glyph.
export function renderBeadSvgNatural(bead, opts = {}) {
  const size = opts.size || 40;
  const shape = norm(bead && bead.shape) || 'round';
  const bw = beadOuterWidth(shape, size);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(bw)} ${n(size)}" ` +
    `width="${n(bw)}" height="${n(size)}">` +
    beadGroup(bead, size, nextId(), { glossy: true, omitGlyph: opts.omitGlyph }) +
    `</svg>`
  );
}

// A soft, offset, colour-filled copy of the bead's own silhouette: the cast
// shadow (warm dark, on light themes) or the cast glow (the bead's own mood
// colour, on dark themes, where a shadow can't read). Thrown to the lower-
// right (opposite the top-left light). The softness is faked by a small stack
// of concentric, outward-scaled copies (the union peaks ~0.4 at the core and
// fades out) so it needs NO blur filter: react-native-svg renders this
// faithfully under <SvgXml>. Drawn into a padded box; BeadView positions it
// behind the bead (left/top = -pad). In-app only (exports keep gradient +
// highlight; a cast shadow on paper isn't wanted).
export function renderCastSvg(bead, opts = {}) {
  const size = opts.size || 40;
  const color = opts.color || '#000000';
  const pad = opts.pad != null ? opts.pad : size * 0.4;
  const dx = opts.dx != null ? opts.dx : size * 0.13;
  const dy = opts.dy != null ? opts.dy : size * 0.17;
  const shape = norm(bead && bead.shape) || 'round';
  const bw = beadOuterWidth(shape, size);
  const geo = silhouette(shape, bw, size);
  const W = bw + pad * 2;
  const H = size + pad * 2;
  const cx = bw / 2;
  const cy = size / 2;
  // Diffuse, light rings (largest/faintest drawn first, behind): the "lifted"
  // throw (see dx/dy), kept faint: the union peaks ~0.15. (Stacked rings
  // concentrate more than a CSS blur, so this reads lighter on-device than the
  // same nominal alpha in the browser sim.)
  const layers = [
    [1.34, 0.006],
    [1.29, 0.01],
    [1.25, 0.014],
    [1.2, 0.018],
    [1.15, 0.022],
    [1.1, 0.026],
    [1.05, 0.03],
    [1.0, 0.034],
  ];
  const body = layers
    .map(
      ([s, o]) =>
        `<g transform="translate(${n(cx)} ${n(cy)}) scale(${s}) ` +
        `translate(${n(-cx)} ${n(-cy)})" opacity="${o}">` +
        `<g fill="${color}">${geo}</g></g>`
    )
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(W)} ${n(H)}" ` +
    `width="${n(W)}" height="${n(H)}">` +
    `<g transform="translate(${n(pad + dx)} ${n(pad + dy)})">${body}</g></svg>`
  );
}

// An ordered list of beads → one horizontal chain SVG: beads on a thin
// connector, spaced by their per-shape outer widths (mirrors the
// in-app chain). `size` is the per-bead box height.
export function renderChainSvg(beads, opts = {}) {
  const list = Array.isArray(beads) ? beads : [];
  const size = opts.size || 40;
  const gap = opts.gap ?? 8;
  const pad = opts.padding ?? 16;
  const thread = opts.threadColor || '#c9b79c';
  if (list.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" width="1" height="1"/>`;
  }
  let x = pad;
  const placed = list.map((bead) => {
    const w = beadOuterWidth(norm(bead && bead.shape) || 'round', size);
    const at = x;
    x += w + gap;
    return { bead, at, w };
  });
  const last = placed[placed.length - 1];
  const totalW = last.at + last.w + pad;
  const totalH = size + pad * 2;
  const cy = totalH / 2;
  const connector =
    `<line x1="${n(pad)}" y1="${n(cy)}" x2="${n(totalW - pad)}" y2="${n(cy)}" ` +
    `stroke="${thread}" stroke-width="${n(Math.max(1.5, size * 0.04))}"/>`;
  const items = placed
    .map(
      (p) =>
        `<g transform="translate(${n(p.at)} ${n(pad)})">` +
        beadGroup(p.bead, size, nextId()) +
        `</g>`
    )
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(totalW)} ${n(totalH)}" ` +
    `width="${n(totalW)}" height="${n(totalH)}" preserveAspectRatio="xMidYMid meet" ` +
    `role="img" aria-label="Thread chain">` +
    connector +
    items +
    `</svg>`
  );
}
