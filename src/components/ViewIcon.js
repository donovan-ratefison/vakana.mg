import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import BeadGlyph from './BeadGlyph';

// One icon per home view. The list view gets the custom bead glyph; the
// other two stay on Ionicons. Single source of truth for the header sigil,
// the bottom nav, and Settings → Appearance → Default view.
const IONICON = {
  calendar: 'calendar-outline',
  threads: 'git-branch-outline',
};

export default function ViewIcon({ view, size = 22, color }) {
  if (view === 'list' || !IONICON[view]) {
    return <BeadGlyph size={size} color={color} />;
  }
  return <Ionicons name={IONICON[view]} size={size} color={color} />;
}
