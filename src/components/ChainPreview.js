import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MOOD_BY_KEY } from '../beads/types';
import BeadView from './BeadView';

// Lightweight bead-chain preview for list cards.
//
// Geometry mirrors BeadView's own `shapeStyleFor` / `sizeOf` so the six
// box shapes read correctly, including the rotated-square `lozenge`
// (a diamond, not a rounded square). `decagon` and `flower` have true
// polygon silhouettes a View can't clip to, so those two delegate to the
// real `BeadView` with `pattern: 'solid'` (silhouette + fill + glyph, no
// pattern SVG). This is exactly the split BeadView itself makes. Beads are
// strung on thin golden connector Views (the "thread").
//
// Still dropped vs the full chain: pattern fills and connector elbows.
// They are imperceptible at preview size and the expensive part. `ThreadDetail`
// and the non-lazy callers keep the full `BeadChain`. Bounded by the
// lazy load + memo + virtualization, so only ~visible cards ever draw.
//
// `items` is the shape `buildChainItems` produces:
//   [{ key, bead: { shape, pattern, mood, glyph }, faded, marked }]

const GOLD = '#C9A24A'; // BeadChain's joint-dot / section-ring / string color

function boxStyle(shape, s) {
  switch (shape) {
    case 'square':
      return { width: s, height: s, borderRadius: s * 0.18 };
    case 'round':
      return { width: s, height: s, borderRadius: s };
    case 'oval':
      return { width: s * 1.4, height: s, borderRadius: s };
    case 'bar':
      return { width: s * 1.6, height: s * 0.55, borderRadius: s * 0.2 };
    case 'dot':
      return { width: s * 0.6, height: s * 0.6, borderRadius: s };
    case 'lozenge':
      return {
        width: s * 0.72,
        height: s * 0.72,
        borderRadius: s * 0.13,
        transform: [{ rotate: '45deg' }],
      };
    default:
      return { width: s, height: s, borderRadius: s * 0.18 };
  }
}

export default function ChainPreview({ items = [], beadSize = 18 }) {
  if (!items.length) return null;
  const gap = Math.max(4, Math.round(beadSize * 0.45));
  return (
    <View style={[styles.wrap, { rowGap: gap }]}>
      {items.map((it, i) => {
        const bead = it?.bead || {};
        const shape = bead.shape;
        const moodInfo = MOOD_BY_KEY[bead.mood] || MOOD_BY_KEY.slate;
        const isPoly = shape === 'decagon' || shape === 'flower';
        return (
          <React.Fragment key={it.key}>
            {i > 0 ? (
              <View
                style={[
                  styles.connector,
                  { width: gap, opacity: it.faded ? 0.45 : 1 },
                ]}
              />
            ) : null}
            {isPoly ? (
              <BeadView
                bead={{
                  shape,
                  pattern: 'solid',
                  mood: bead.mood,
                  glyph: bead.glyph,
                }}
                size={beadSize}
                faded={it.faded}
                marked={it.marked}
              />
            ) : (
              <View
                style={[
                  boxStyle(shape, beadSize),
                  {
                    backgroundColor: moodInfo.color,
                    opacity: it.faded ? 0.45 : 1,
                    borderWidth: it.marked ? 1.5 : 0,
                    borderColor: it.marked ? GOLD : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  },
                ]}
              >
                {bead.glyph ? (
                  <Text
                    style={{
                      color: moodInfo.text,
                      fontSize: Math.round(beadSize * 0.5),
                      fontWeight: '700',
                      transform:
                        shape === 'lozenge'
                          ? [{ rotate: '-45deg' }]
                          : undefined,
                    }}
                    numberOfLines={1}
                  >
                    {bead.glyph}
                  </Text>
                ) : null}
              </View>
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  connector: {
    height: 2,
    backgroundColor: GOLD,
    alignSelf: 'center',
  },
});
