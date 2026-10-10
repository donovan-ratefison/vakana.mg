import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Modal,
  Pressable,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BeadView from './BeadView';
import { getDb } from '../database/db';
import { readBead } from '../beads/types';
import { useTheme } from '../theme';
import { useKeyboardInset } from '../hooks/useKeyboardHeight';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Batch sibling of AddToThreadOverlay. Pick an existing user thread to
// receive a chain of N entries' beads (appended in chronological order),
// or kick off a brand-new thread that comes prefilled with all of them.
//
// Single-action-per-tap: we don't try to multi-select threads here. The
// caller already knows which entries are being added.
//
// Each row shows up to four beads of the thread's chain as a preview, plus
// a search bar at the top. These are the same affordances as
// AddToThreadOverlay so the long-press → select → thread flow doesn't
// downgrade visually.

const PREVIEW_LIMIT = 4;

export default function BatchThreadPicker({
  visible,
  entryCount,
  onPick,
  onCreateNew,
  onClose,
}) {
  // Same keyboard-occlusion fix as BeadPickerModal: edge-to-edge nullifies
  // Android adjustResize, so the bottom sheet doesn't lift on its own and
  // the keyboard covers a short results list. Pad the backdrop by the IME
  // height (the documented useKeyboardHeight contract). Without this, when
  // a user multi-selects entries and taps Add-to-thread, the picker's
  // search results get hidden behind the keyboard once the search box has
  // focus and the list is short enough to not push the input above the IME.
  const kb = useKeyboardInset();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [query, setQuery] = useState('');
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadThreads = useCallback(async (q) => {
    const db = getDb();
    if (!db) return;
    setLoading(true);
    try {
      const like = `%${(q || '').trim()}%`;
      // Hide auto-threads (same rule as AddToThreadOverlay): user-managed
      // threads only.
      const rows = (q || '').trim()
        ? await db.getAllAsync(
            "SELECT * FROM threads WHERE kind = 'user' AND name LIKE ? ORDER BY updated_at DESC",
            [like]
          )
        : await db.getAllAsync(
            "SELECT * FROM threads WHERE kind = 'user' ORDER BY updated_at DESC"
          );

      const enriched = await Promise.all(
        rows.map(async (t) => {
          const beads = await db.getAllAsync(
            `SELECT tb.*, e.bead_shape, e.bead_pattern, e.bead_mood, e.bead_glyph
               FROM thread_beads tb
               LEFT JOIN entries e ON e.id = tb.entry_id
               WHERE tb.thread_id = ?
               ORDER BY tb.position ASC
               LIMIT ?`,
            [t.id, PREVIEW_LIMIT]
          );
          return { ...t, preview: beads };
        })
      );
      setThreads(enriched);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    loadThreads('');
  }, [visible, loadThreads]);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => loadThreads(query), 150);
    return () => clearTimeout(t);
  }, [query, visible, loadThreads]);

  // Chaining is a write operation (creates thread_beads rows + bumps the
  // thread's updated_at). Misclicks on a long list are easy to make, and
  // the wrong-thread case isn't trivially reversible: the user has to
  // open the thread, find the bead, long-press, remove. So gate the pick
  // behind a native confirm dialog naming the target thread.
  const confirmPick = (thread) => {
    const message =
      entryCount === 1
        ? `Add this entry to "${thread.name}"?`
        : `Add ${entryCount} entries to "${thread.name}"?`;
    Alert.alert('Add to thread', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Add', onPress: () => onPick?.(thread) },
    ]);
  };

  const renderPreview = (thread) => {
    if (!thread.preview || thread.preview.length === 0) {
      return <Text style={styles.previewEmpty}>empty</Text>;
    }
    return (
      <View style={styles.previewRow}>
        {thread.preview.map((tb) => {
          const live = readBead({
            bead_shape: tb.bead_shape,
            bead_pattern: tb.bead_pattern,
            bead_mood: tb.bead_mood,
            bead_glyph: tb.bead_glyph,
          });
          const fallback = {
            shape: tb.snapshot_shape,
            pattern: tb.snapshot_pattern,
            mood: tb.snapshot_mood,
            glyph: tb.snapshot_glyph,
          };
          const display = live || fallback;
          const faded = !live;
          return (
            <View key={tb.id} style={styles.previewBead}>
              <BeadView bead={display} size={18} faded={faded} />
            </View>
          );
        })}
      </View>
    );
  };

  const heading =
    entryCount === 1
      ? 'Add this entry to a thread'
      : `Add ${entryCount} entries to a thread`;

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
            kb === 0 && { paddingBottom: Math.max(24, insets.bottom + 8) },
          ]}
          onPress={() => {}}
        >
          <View style={styles.handle} />
          <Text style={styles.heading}>{heading}</Text>
          <Text style={styles.hint}>
            The app adds the beads at the end of the chain, in date order.
          </Text>

          <TextInput
            style={styles.search}
            placeholder="Search threads..."
            placeholderTextColor={colors.placeholder}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
          />

          <TouchableOpacity
            style={styles.newRow}
            onPress={onCreateNew}
            activeOpacity={0.7}
          >
            <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
            <Text style={styles.newRowText}>Create a new thread</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
          </TouchableOpacity>

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : threads.length === 0 ? (
            <Text style={styles.emptyText}>
              {query.trim()
                ? 'No threads match. Tap + above to create one.'
                : 'No user threads yet. Create one above.'}
            </Text>
          ) : (
            <ScrollView
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {threads.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  style={styles.row}
                  activeOpacity={0.7}
                  onPress={() => confirmPick(t)}
                >
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {t.name}
                    </Text>
                    {renderPreview(t)}
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={colors.textFaint}
                  />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
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
      borderWidth: 1,
      borderColor: colors.border,
      paddingTop: 8,
      paddingBottom: 24,
      maxHeight: '80%',
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderStrong,
      alignSelf: 'center',
      marginBottom: 8,
    },
    heading: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
      paddingHorizontal: 20,
      marginBottom: 4,
    },
    hint: {
      color: colors.textMuted,
      fontSize: 12,
      paddingHorizontal: 20,
      marginBottom: 12,
    },
    search: {
      marginHorizontal: 20,
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
    newRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
    },
    newRowText: {
      flex: 1,
      color: colors.primary,
      fontSize: 15,
      fontWeight: '700',
    },
    list: {
      paddingHorizontal: 20,
      paddingVertical: 6,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rowInfo: {
      flex: 1,
    },
    rowName: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
      marginBottom: 4,
    },
    previewRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    previewBead: {
      marginRight: 2,
    },
    previewEmpty: {
      color: colors.textFaint,
      fontSize: 11,
      fontStyle: 'italic',
    },
    emptyText: {
      color: colors.textFaint,
      fontSize: 13,
      fontStyle: 'italic',
      textAlign: 'center',
      paddingHorizontal: 20,
      paddingVertical: 20,
    },
    loading: {
      paddingVertical: 24,
      alignItems: 'center',
    },
  });
