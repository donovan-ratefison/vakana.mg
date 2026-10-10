import React from 'react';
import Svg, { Circle } from 'react-native-svg';

// The "Beads" view glyph: one bead, seen head-on, with a small specular
// highlight up-left. Drawn in the Ionicons-outline recipe (512 viewBox,
// 32-unit stroke) so it sits beside `calendar-outline` / `git-branch-outline`
// as a sibling, not an import. It replaces `list-outline`, which a tester
// kept tapping because it reads as a hamburger menu; the off-centre
// highlight is what stops this one reading as a radio button or a target.
// It says "sphere", the way `BeadView` draws beads in the app.
export default function BeadGlyph({ size = 22, color = '#000' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512">
      <Circle cx="256" cy="256" r="200" fill="none" stroke={color} strokeWidth="32" />
      <Circle cx="182" cy="182" r="40" fill={color} />
    </Svg>
  );
}
