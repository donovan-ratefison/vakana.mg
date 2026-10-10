import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Modal,
  Pressable,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { loadCollectionThreadCounts } from '../services/collections';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardInset } from '../hooks/useKeyboardHeight';

// Searchable multi-select bottom-sheet that replaces the old horizontal
// collection pill strip (which forced you to swipe through every
// collection one by one). Tapping a row toggles it in/out of the filter:
// the gesture *is* the commit, no Done button, backdrop/handle closes
// (same pattern as CollectionPickerSheet). Selecting one or more shows
// threads in ANY of them (union); selecting none shows everything.
//
// A find-box (autofocused on open) narrows the list in memory. The full
// collection set is already loaded by the parent, so no DB hit and no
// debounce. Long-press a row to rename/delete (the affordance the chip
// strip used to own); the parent owns those next-step flows so this
// sheet stays a pure chooser.
//
// Per-collection counts are loaded once per open via one GROUP BY query.
// "All collections" carries no count: it's the reset row, and a number
// there would be murky once a kind filter (User / Days / …) is also on.
export default function CollectionFilterSheet({
  visible,
  collections,
  selectedIds,
  onToggle,
  onClearAll,
  onLongPressCollection,
  onCreateNew,
  onClose,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardInset();

  const [query, setQuery] = useState('');
  const [counts, setCounts] = useState({});
  const searchRef = useRef(null);

  // Reset the search and refresh counts every time the sheet opens: a
  // thread may have been (un)assigned since it was last shown.
  useEffect(() => {
    if (!visible) return;
    setQuery('');
    loadCollectionThreadCounts().then(setCounts).catch(() => {});
  }, [visible]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return collections;
    return collections.filter((c) => (c.name || '').toLowerCase().includes(q));
  }, [collections, q]);

  const noneSelected = !selectedIds || selectedIds.size === 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      // Focus the find-box once the slide-in finishes. This is more reliable
      // than autoFocus across a Modal mount on Android.
      onShow={() => searchRef.current?.focus()}
    >
      <Pressable
        style={[
          styles.backdrop,
          keyboardInset > 0 && { paddingBottom: keyboardInset },
        ]}
        onPress={onClose}
      >
        <Pressable
          style={[
            styles.sheet,
            keyboardInset === 0 && {
              paddingBottom: Math.max(16, insets.bottom + 8),
            },
          ]}
          onPress={() => {}}
        >
          <View style={styles.handle} />
          <Text style={styles.heading}>Filter by collection</Text>

          <View style={styles.searchRow}>
            <Ionicons
              name="search"
              size={16}
              color={colors.textFaint}
              style={styles.searchIcon}
            />
            <TextInput
              ref={searchRef}
              style={styles.searchInput}
              placeholder="Find a collection…"
              placeholderTextColor={colors.placeholder}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {query ? (
              <TouchableOpacity
                onPress={() => setQuery('')}
                hitSlop={8}
                style={styles.searchClear}
              >
                <Ionicons
                  name="close-circle"
                  size={16}
                  color={colors.textFaint}
                />
              </TouchableOpacity>
            ) : null}
          </View>

          <ScrollView
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
          >
            {/* "All collections" reset row: only when not searching
                (you don't search for the thing that means "no filter").
                Reads as active when nothing is selected; tapping it
                clears the whole selection. */}
            {!q ? (
              <TouchableOpacity
                style={styles.row}
                onPress={onClearAll}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={noneSelected ? 'radio-button-on' : 'close-circle'}
                  size={18}
                  color={noneSelected ? colors.primary : colors.textFaint}
                />
                <Ionicons
                  name="albums-outline"
                  size={14}
                  color={noneSelected ? colors.primary : colors.textMuted}
                />
                <Text
                  style={[
                    styles.rowLabel,
                    noneSelected && styles.rowLabelActive,
                  ]}
                  numberOfLines={1}
                >
                  All collections
                </Text>
              </TouchableOpacity>
            ) : null}

            {collections.length === 0 ? (
              <Text style={styles.emptyText}>
                No collections yet. Create one below to group related threads.
              </Text>
            ) : filtered.length === 0 ? (
              <Text style={styles.emptyText}>
                No collection matches “{query.trim()}”.
              </Text>
            ) : (
              filtered.map((c) => {
                const active = !!selectedIds && selectedIds.has(c.id);
                const n = counts[c.id] ?? 0;
                return (
                  <TouchableOpacity
                    key={c.id}
                    style={styles.row}
                    onPress={() => onToggle(c.id)}
                    onLongPress={() => onLongPressCollection?.(c)}
                    delayLongPress={350}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={active ? 'checkbox' : 'square-outline'}
                      size={18}
                      color={active ? colors.primary : colors.textFaint}
                    />
                    <Ionicons
                      name="folder-outline"
                      size={14}
                      color={active ? colors.primary : colors.textMuted}
                    />
                    <Text
                      style={[
                        styles.rowLabel,
                        active && styles.rowLabelActive,
                      ]}
                      numberOfLines={1}
                    >
                      {c.name}
                    </Text>
                    <Text style={styles.rowCount}>{n}</Text>
                  </TouchableOpacity>
                );
              })
            )}

            <TouchableOpacity
              style={styles.row}
              onPress={onCreateNew}
              activeOpacity={0.7}
            >
              <Ionicons name="add" size={20} color={colors.primary} />
              <Text style={styles.rowLabelAccent}>New collection</Text>
            </TouchableOpacity>
          </ScrollView>

          <View style={styles.footnote}>
            <Ionicons
              name="information-circle-outline"
              size={14}
              color={colors.textFaint}
            />
            <Text style={styles.footnoteText}>
              Tap a collection to select or clear it. The list shows the
              threads in any selected collection. Long-press a collection to
              rename or delete it.
            </Text>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: '80%',
      borderWidth: 1,
      borderColor: colors.border,
      paddingTop: 8,
      paddingBottom: 16,
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderStrong,
      alignSelf: 'center',
      marginBottom: 12,
    },
    heading: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      paddingHorizontal: 20,
      paddingBottom: 10,
    },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: 20,
      marginBottom: 4,
      backgroundColor: colors.surfaceMuted,
      borderRadius: 10,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    searchIcon: { marginRight: 8 },
    searchInput: {
      flex: 1,
      paddingVertical: 9,
      color: colors.text,
      fontSize: 15,
    },
    searchClear: { padding: 4 },
    list: {
      paddingHorizontal: 20,
      paddingBottom: 8,
    },
    emptyText: {
      color: colors.textFaint,
      fontSize: 13,
      fontStyle: 'italic',
      paddingVertical: 16,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    rowLabel: {
      flex: 1,
      color: colors.text,
      fontSize: 15,
      fontWeight: '500',
    },
    rowLabelActive: {
      color: colors.primary,
      fontWeight: '600',
    },
    rowLabelAccent: {
      flex: 1,
      color: colors.primary,
      fontSize: 15,
      fontWeight: '600',
    },
    rowCount: {
      color: colors.textFaint,
      fontSize: 13,
      fontWeight: '600',
      minWidth: 24,
      textAlign: 'right',
    },
    footnote: {
      flexDirection: 'row',
      gap: 6,
      alignItems: 'flex-start',
      marginTop: 8,
      marginHorizontal: 20,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    footnoteText: {
      flex: 1,
      color: colors.textFaint,
      fontSize: 11,
      lineHeight: 16,
    },
  });
