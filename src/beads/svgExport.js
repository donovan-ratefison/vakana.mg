// Compatibility shim. The HTML/PDF/Markdown article exports import
// `chainSvgString` from here; the real, faithful renderer is now the
// single source of truth in `./svg`. Keeping this thin wrapper means
// there is exactly ONE off-screen bead renderer: no drift between the
// Org/slide path and the article path (they were diverging, each with
// its own shape/pattern/glyph bugs).

import { renderChainSvg, beadOuterWidth, beadOuterHeight } from './svg';

export { beadOuterWidth, beadOuterHeight };

// Same signature/options the article pipeline already passes
// ({ size, gap, padding, threadColor }). Returns '' for an empty chain
// (the article renderer treats falsy as "no banner").
export function chainSvgString(beads, options = {}) {
  if (!Array.isArray(beads) || beads.length === 0) return '';
  return renderChainSvg(beads, options);
}
