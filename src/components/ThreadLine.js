import React, { useState } from 'react';
import { View } from 'react-native';

// A horizontal "thread" segment: a colored bar with subtle diagonal stripes
// overlaid to suggest twisted fibers. Stripes are absolutely-positioned thin
// rectangles rotated and tiled across the bar; the parent clips them with
// overflow:hidden.
//
// Width can be a number or omitted in favor of `flex`. If flex is used, the
// actual rendered width is read via onLayout and stripes re-render once known.
export default function ThreadLine({
  width,
  height,
  flex,
  color,
  stripeColor = 'rgba(0,0,0,0.45)',
  stripeAngle = 55,
  stripeSpacing = 3.5,
  style,
}) {
  const widthIsNumber = typeof width === 'number' && Number.isFinite(width);
  const [measured, setMeasured] = useState(widthIsNumber ? width : 0);
  const renderWidth = widthIsNumber ? width : measured;

  const stripeW = Math.max(1.5, height * 0.5);
  // +2 covers stripes that bleed past the right edge after rotation.
  const count =
    renderWidth > 0 ? Math.ceil(renderWidth / stripeSpacing) + 2 : 0;

  return (
    <View
      onLayout={
        widthIsNumber
          ? undefined
          : (e) => setMeasured(e.nativeEvent.layout.width)
      }
      style={[
        {
          width,
          height,
          flex,
          backgroundColor: color,
          overflow: 'hidden',
          alignSelf: 'center',
        },
        style,
      ]}
    >
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            // Extend top/bottom so the rotated rectangle still covers the
            // visible band after tilt.
            top: -height,
            bottom: -height,
            left: i * stripeSpacing - stripeW,
            width: stripeW,
            backgroundColor: stripeColor,
            transform: [{ rotate: `${stripeAngle}deg` }],
          }}
        />
      ))}
    </View>
  );
}
