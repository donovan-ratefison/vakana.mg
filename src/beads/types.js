// Single source of truth for the bead vocabulary.
// Stored values are the keys ('square', 'sun', etc.); display labels and
// colors are derived from these tables at render time.

export const ACTION_TYPES = [
  { shape: 'square',  label: 'Task',      hint: 'Things you finished or did' },
  { shape: 'round',   label: 'Encounter', hint: 'People, calls, conversations' },
  { shape: 'oval',    label: 'Body',      hint: 'Nourishment, rest, exercise' },
  { shape: 'lozenge', label: 'Insight',   hint: 'Ideas, realisations, decisions' },
  { shape: 'bar',     label: 'Routine',   hint: 'Habits, recurring practices' },
  { shape: 'dot',     label: 'Fleeting',  hint: 'Micro-notes, quick thoughts' },
  { shape: 'decagon', label: 'Milestone', hint: 'Turning points, multi-faceted events' },
  { shape: 'flower',  label: 'Bloom',     hint: 'Growth, joy, gratitude' },
];

export const ACTION_TYPE_BY_SHAPE = Object.fromEntries(
  ACTION_TYPES.map((t) => [t.shape, t])
);

// Shapes carry NO prescribed meaning: Vakana is a personal encoding
// system, not a fixed taxonomy. `ACTION_TYPES` is only the canonical,
// ordered enumeration of the 8 shapes; its `label`/`hint` are vestigial
// seed copy and must never be shown to the user (in-app or in exports).
// Anything that needs to *name* a shape uses this neutral geometry map.
export const SHAPE_GEOMETRY = {
  square: 'Square',
  round: 'Circle',
  oval: 'Oval',
  lozenge: 'Lozenge',
  bar: 'Bar',
  dot: 'Dot',
  decagon: 'Decagon',
  flower: 'Flower',
};

export const PATTERNS = [
  { key: 'solid',     label: 'Solid' },
  { key: 'striped',   label: 'Striped' },
  { key: 'diagonal',  label: 'Diagonal' },
  { key: 'dotted',    label: 'Dotted' },
  { key: 'floral',    label: 'Floral' },
  { key: 'dashed',    label: 'Dashed' },
  { key: 'checkered', label: 'Checkered' },
  { key: 'circle',    label: 'Circle' },
];

export const PATTERN_KEYS = PATTERNS.map((p) => p.key);

export const MOODS = [
  { key: 'sun',      label: 'Sun',      color: '#e8b94f', text: '#3a2a05' },
  { key: 'ember',    label: 'Ember',    color: '#d6552f', text: '#fff5ec' },
  { key: 'rose',     label: 'Rose',     color: '#e08aa1', text: '#3a1320' },
  { key: 'forest',   label: 'Forest',   color: '#5a8a5e', text: '#f3f8ee' },
  { key: 'ocean',    label: 'Ocean',    color: '#4f88a8', text: '#f1f7fb' },
  { key: 'plum',     label: 'Plum',     color: '#7a4c7a', text: '#f7eef7' },
  { key: 'slate',    label: 'Slate',    color: '#8a8d92', text: '#f4f4f4' },
  { key: 'charcoal', label: 'Charcoal', color: '#3a3a3e', text: '#ededed' },
];

export const MOOD_BY_KEY = Object.fromEntries(MOODS.map((m) => [m.key, m]));

// Beads at or above this display size get the "warm glass" finish (lit
// gradient + specular highlight); smaller beads (chain previews, calendar
// cells, tiny chips) stay flat for perf. Shared by BeadView (on-device) and
// svg.js (exports) so the gate is identical in both renderers.
export const GLASS_GATE = 30;

export const DEFAULT_BEAD = {
  shape: 'round',
  pattern: 'solid',
  mood: 'slate',
  glyph: '',
};

export function hasBead(entry) {
  return Boolean(entry && entry.bead_shape);
}

export function readBead(entry) {
  if (!hasBead(entry)) return null;
  return {
    shape: entry.bead_shape,
    pattern: entry.bead_pattern || 'solid',
    mood: entry.bead_mood || 'slate',
    glyph: entry.bead_glyph || '',
  };
}
