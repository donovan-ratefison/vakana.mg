import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  Pressable,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BeadView from './BeadView';
import { getDb } from '../database/db';
import { ACTION_TYPES, SHAPE_GEOMETRY, readBead } from '../beads/types';
import { listBeadPresets } from '../services/beadPresets';
import { useTheme } from '../theme';
import { isPrivate, MASKED_TITLE } from '../utils/privacy';
import { useKeyboardInset } from '../hooks/useKeyboardHeight';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Bottom-sheet bead picker. Lists every beaded entry, filters by title +
// shape. Used by ThreadComposerScreen (during new-thread chain building)
// and ThreadDetailScreen's FAB chooser (to append an existing bead in
// place). Pure picker: the caller decides what to do with the returned
// entry row.
export default function BeadPickerModal({ visible, onClose, onPick }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makePickerStyles(colors), [colors]);
  // Edge-to-edge nullifies Android adjustResize, so the bottom sheet won't
  // lift on its own and the keyboard covers the results list. Pad the
  // backdrop by the IME height (the documented useKeyboardHeight contract).
  const kb = useKeyboardInset();
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = useState([]);
  const [query, setQuery] = useState('');
  // Two filter lenses, mutually exclusive (last action wins):
  //   - presetFilter: a saved bead. Narrows to entries with that EXACT
  //     {shape,pattern,mood,glyph}. Surfaces the user's own private
  //     vocabulary as the search affordance instead of the imposed
  //     shape→action taxonomy the picker used to render.
  //   - shapeFilter: a single shape. Coarser lens for "any task-like
  //     thing" without naming it (the silhouette IS the chip, no text).
  // The historical text labels (Task / Body / Insight / …) on ACTION_TYPES
  // are vestigial seed copy and must never be shown to the user (per the
  // comment at src/beads/types.js:23). This picker was the last surface
  // still violating that; v0.53.0 closes it.
  const [shapeFilter, setShapeFilter] = useState(null);
  const [presetFilter, setPresetFilter] = useState(null);
  const [presets, setPresets] = useState([]);

  const load = useCallback(async () => {
    const db = getDb();
    if (!db) return;
    const rows = await db.getAllAsync(
      `SELECT id, title, date, bead_shape, bead_pattern, bead_mood, bead_glyph, is_private
         FROM entries
         WHERE bead_shape IS NOT NULL
         ORDER BY date DESC, updated_at DESC`
    );
    setEntries(rows);
  }, []);

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setShapeFilter(null);
    setPresetFilter(null);
    load();
    listBeadPresets().then(setPresets);
  }, [visible, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (presetFilter) {
        // Exact-bead match across all four facets: the same encode⇄retrieve
        // semantics as the N12 Filters sheet's Saved-beads lens.
        if (e.bead_shape !== presetFilter.shape) return false;
        if (e.bead_pattern !== presetFilter.pattern) return false;
        if (e.bead_mood !== presetFilter.mood) return false;
        if ((presetFilter.glyph || '') !== (e.bead_glyph || '')) return false;
      } else if (shapeFilter && e.bead_shape !== shapeFilter) return false;
      if (!q) return true;
      return (e.title || '').toLowerCase().includes(q);
    });
  }, [entries, query, shapeFilter, presetFilter]);

  // The Saved-beads strip narrows alongside the title search: typing
  // "Pla" leaves only presets whose name starts with "Pla" ("Place",
  // "Plant"). Prefix match (not substring) because preset names are short
  // and the user's mental model when typing a short query is "I'm starting
  // a word." Case-insensitive. The active presetFilter is intentionally
  // independent: search and preset compose (entries match the active
  // preset AND the title query), so the strip shrinking out from under
  // the active chip doesn't drop the filter. All clears it explicitly.
  const visiblePresets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return presets;
    return presets.filter((p) =>
      (p.name || '').toLowerCase().startsWith(q)
    );
  }, [presets, query]);

  // Mutual exclusion: tapping one lens clears the other. Each lens is its
  // own narrowing mode; composing them rarely yields more than the preset
  // alone (presets already imply shape), so we keep the surface simple.
  const onTapPreset = (p) => {
    setShapeFilter(null);
    setPresetFilter((curr) => (curr && curr.id === p.id ? null : p));
  };
  const onTapShape = (shape) => {
    setPresetFilter(null);
    setShapeFilter((curr) => (curr === shape ? null : shape));
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={[styles.backdrop, { paddingBottom: kb }]}
        onPress={onClose}
      >
        <Pressable
          style={[
            styles.sheet,
            kb === 0 && { paddingBottom: Math.max(16, insets.bottom + 8) },
          ]}
          onPress={() => {}}
        >
          <View style={styles.header}>
            <Text style={styles.title}>Pick a bead</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.search}
            placeholder="Search titles..."
            placeholderTextColor={colors.placeholder}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
          />
          {/* Saved-beads strip: only shown when the user has authored at
              least one. Tap a chip to filter by that exact bead (all four
              facets). This is the on-philosophy answer to "name a bead in
              the search": the user's own private vocabulary, surfaced as
              chips, displaces the old shape→action taxonomy entirely. */}
          {visiblePresets.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.presetRow}
            >
              {visiblePresets.map((p) => {
                const selected = presetFilter && presetFilter.id === p.id;
                return (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => onTapPreset(p)}
                    style={[
                      styles.presetChip,
                      selected && styles.presetChipSelected,
                    ]}
                    accessibilityLabel={`Filter by ${p.name}`}
                  >
                    <BeadView
                      bead={{
                        shape: p.shape,
                        pattern: p.pattern,
                        mood: p.mood,
                        glyph: p.glyph,
                      }}
                      size={20}
                    />
                    <Text
                      style={[
                        styles.presetChipText,
                        selected && styles.presetChipTextSelected,
                      ]}
                      numberOfLines={1}
                    >
                      {p.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : null}

          {/* Shape silhouette strip: the shapes themselves are the chips,
              never their old text labels (Task / Body / …): those labels
              are vestigial seed copy that the source explicitly says
              "must never be shown to the user" (src/beads/types.js:23).
              Screen readers get the neutral geometry name (`Circle`,
              `Oval`, …), exactly what the grammar essay calls for. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.shapeRow}
          >
            <TouchableOpacity
              style={[
                styles.shapeAllChip,
                !shapeFilter && !presetFilter && styles.shapeAllChipSelected,
              ]}
              onPress={() => {
                setShapeFilter(null);
                setPresetFilter(null);
              }}
              accessibilityLabel="All shapes"
            >
              <Text
                style={[
                  styles.shapeAllChipText,
                  !shapeFilter && !presetFilter && styles.shapeAllChipTextSelected,
                ]}
              >
                All
              </Text>
            </TouchableOpacity>
            {ACTION_TYPES.map((t) => {
              const selected = shapeFilter === t.shape;
              return (
                <TouchableOpacity
                  key={t.shape}
                  onPress={() => onTapShape(t.shape)}
                  style={[
                    styles.shapeSilhouetteChip,
                    selected && styles.shapeSilhouetteChipSelected,
                  ]}
                  accessibilityLabel={`${SHAPE_GEOMETRY[t.shape] || t.shape}${selected ? ', selected' : ''}`}
                >
                  <BeadView
                    bead={{
                      shape: t.shape,
                      pattern: 'solid',
                      mood: 'slate',
                      glyph: '',
                    }}
                    size={22}
                  />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id.toString()}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text style={styles.emptyText}>No beaded entries match.</Text>
            }
            renderItem={({ item }) => {
              const priv = isPrivate(item);
              return (
                <TouchableOpacity
                  style={styles.entryRow}
                  onPress={() => onPick(item)}
                >
                  <BeadView bead={readBead(item)} size={28} />
                  <View style={styles.entryInfo}>
                    <Text
                      style={[
                        styles.entryTitle,
                        priv && { fontStyle: 'italic', color: colors.textMuted },
                      ]}
                      numberOfLines={1}
                    >
                      {priv ? MASKED_TITLE : item.title || 'Untitled'}
                    </Text>
                    <Text style={styles.entryDate}>{item.date}</Text>
                  </View>
                </TouchableOpacity>
              );
            }}
            style={styles.list}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makePickerStyles = (colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: '85%',
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
    },
    title: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
    },
    search: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: colors.text,
      fontSize: 14,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 10,
    },
    presetRow: {
      flexDirection: 'row',
      gap: 6,
      paddingVertical: 4,
      paddingRight: 12,
      marginBottom: 6,
    },
    presetChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingLeft: 6,
      paddingRight: 10,
      paddingVertical: 7,
      // Deterministic vertical floor so layout pressure on the
      // ScrollView (many chips on screen vs. few after a search) can
      // never squeeze the chip below what the text + BeadView need.
      // Without this, descenders (p, g, y) clipped only in the "many
      // chips" state. Typing in the search reduced visible chips and
      // the row reflowed taller, masking the bug.
      minHeight: 34,
      borderRadius: 17,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
    },
    presetChipSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.primary,
    },
    presetChipText: {
      color: colors.text,
      fontSize: 12,
      lineHeight: 18,
      fontWeight: '600',
      maxWidth: 110,
      // Android-only: by default RN's Text adds the font's intrinsic
      // top/bottom padding around the line box, which combines with our
      // explicit padding + lineHeight to produce unpredictable inner
      // heights. Disabling it makes the rendered text height equal
      // exactly `lineHeight`, so the chip's vertical math is honest.
      includeFontPadding: false,
    },
    presetChipTextSelected: {
      color: colors.primaryOnPrimary,
    },
    shapeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 4,
      paddingRight: 12,
    },
    shapeAllChip: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
    },
    shapeAllChipSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    shapeAllChipText: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '600',
    },
    shapeAllChipTextSelected: {
      color: colors.primaryOnPrimary,
    },
    shapeSilhouetteChip: {
      width: 34,
      height: 34,
      borderRadius: 17,
      borderWidth: 1,
      borderColor: 'transparent',
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    shapeSilhouetteChipSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.surfaceMuted,
    },
    list: {
      marginTop: 10,
    },
    entryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
      paddingHorizontal: 4,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    entryInfo: {
      flex: 1,
    },
    entryTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    entryDate: {
      color: colors.textFaint,
      fontSize: 12,
      marginTop: 2,
    },
    emptyText: {
      color: colors.textFaint,
      fontSize: 13,
      textAlign: 'center',
      paddingVertical: 24,
    },
  });
