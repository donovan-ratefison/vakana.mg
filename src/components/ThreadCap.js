import React from 'react';
import { View } from 'react-native';
import ThreadLine from './ThreadLine';

// A loose-thread tail rendered before the first bead ('left') or after the
// last bead ('right'). It's a short horizontal stub at the bead's connector
// level followed by a small quarter-arc curling down at the loose tip. It is meant
// to read as "the chain begins / ends here", not as a clasp around the chain.
//
// Stub is a striped ThreadLine; curl is a quarter-arc drawn with two adjacent
// borders + one border-radius (curves can't be striped in pure RN).
export default function ThreadCap({
  side,
  size = 26,
  color,
  thickness = 1.5,
  stripeColor,
}) {
  const W = Math.max(10, size * 0.42);
  const H = Math.max(8, size * 0.45);
  const stub = Math.max(4, size * 0.18);
  const curl = Math.max(4, size * 0.18);
  const centerY = H / 2;
  const stubTop = centerY - thickness / 2;

  // Curl overlaps the stub by `thickness` so the corner joint reads as a
  // single continuous stroke instead of two abutting rectangles.
  const overlap = thickness;

  if (side === 'left') {
    return (
      <View style={{ width: W, height: H, alignSelf: 'center' }}>
        <ThreadLine
          width={stub}
          height={thickness}
          color={color}
          stripeColor={stripeColor}
          style={{ position: 'absolute', right: 0, top: stubTop, alignSelf: 'auto' }}
        />
        <View
          style={{
            position: 'absolute',
            right: stub - overlap,
            top: stubTop,
            width: curl,
            height: curl,
            borderTopWidth: thickness,
            borderLeftWidth: thickness,
            borderColor: color,
            borderTopLeftRadius: curl,
          }}
        />
      </View>
    );
  }
  return (
    <View style={{ width: W, height: H, alignSelf: 'center' }}>
      <ThreadLine
        width={stub}
        height={thickness}
        color={color}
        stripeColor={stripeColor}
        style={{ position: 'absolute', left: 0, top: stubTop, alignSelf: 'auto' }}
      />
      <View
        style={{
          position: 'absolute',
          left: stub - overlap,
          top: stubTop,
          width: curl,
          height: curl,
          borderTopWidth: thickness,
          borderRightWidth: thickness,
          borderColor: color,
          borderTopRightRadius: curl,
        }}
      />
    </View>
  );
}
