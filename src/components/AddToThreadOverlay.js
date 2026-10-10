import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BeadView from './BeadView';
import { getDb } from '../database/db';
import { readBead } from '../beads/types';
import { useTheme } from '../theme';
import { useKeyboardInset } from '../hooks/useKeyboardHeight';

// Search-or-create overlay invoked from the bead's long-press menu in the editor.
// Lets the user append the current bead to an existing thread, or jump to the
// composer with the entry pre-loaded as the first chain item.
export default function AddToThreadOverlay({
  visible,
  entryId,
  bead,
  onClose,
  onAdded,
  onCreateNew,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const keyboardInset = useKeyboardInset();

  const [query, setQuery] = useState('');
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadThreads = useCallback(async (q) => {
    const db = getDb();
    if (!db) return;
    setLoading(true);
    try {
      const like = `%${(q || '').trim()}%`;
      // Hide auto-threads from "add to thread": they're system-managed. The
      // entry's bead is already represented in its day's auto-thread via the
      // sync service.
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
               LIMIT 4`,
            [t.id]
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

  const handlePickThread = async (thread) => {
    if (busy || !bead) return;
    const db = getDb();
    if (!db) return;
    setBusy(true);
    try {
      const row = await db.getFirstAsync(
        'SELECT COALESCE(MAX(position), -1) AS maxPos FROM thread_beads WHERE thread_id = ?',
        [thread.id]
      );
      const nextPos = (row?.maxPos ?? -1) + 1;
      await db.runAsync(
        `INSERT INTO thread_beads
          (thread_id, entry_id, position, snapshot_shape, snapshot_pattern, snapshot_mood, snapshot_glyph)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          thread.id,
          entryId ?? null,
          nextPos,
          bead.shape,
          bead.pattern || 'solid',
          bead.mood || 'slate',
          bead.glyph || '',
        ]
      );
      await db.runAsync(
        `UPDATE threads SET updated_at = datetime('now') WHERE id = ?`,
        [thread.id]
      );
      onAdded && onAdded({ threadId: thread.id });
    } finally {
      setBusy(false);
    }
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

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={[
          styles.backdrop,
          keyboardInset > 0 && { paddingBottom: keyboardInset },
        ]}
        onPress={onClose}
      >
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>Add to thread</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.search}
            placeholder="Search threads..."
            placeholderTextColor={colors.placeholder}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoFocus
          />

          <TouchableOpacity
            style={styles.newRow}
            onPress={() => {
              onClose && onClose();
              onCreateNew && onCreateNew();
            }}
          >
            <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
            <Text style={styles.newRowText}>New thread</Text>
          </TouchableOpacity>

          <ScrollView
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.listContent}
          >
            {loading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : threads.length === 0 ? (
              <Text style={styles.emptyText}>
                {query.trim() ? 'No matching threads' : 'No threads yet'}
              </Text>
            ) : (
              threads.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  style={styles.threadRow}
                  onPress={() => handlePickThread(t)}
                  disabled={busy}
                >
                  <View style={styles.threadInfo}>
                    <Text style={styles.threadName} numberOfLines={1}>
                      {t.name}
                    </Text>
                    {renderPreview(t)}
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={colors.textFaint}
                  />
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    card: {
      width: '100%',
      maxWidth: 420,
      maxHeight: '80%',
      backgroundColor: colors.surface,
      borderRadius: 14,
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
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    closeBtn: {
      padding: 4,
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
    newRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 8,
      borderRadius: 8,
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 8,
    },
    newRowText: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: '600',
    },
    list: {
      maxHeight: 360,
    },
    listContent: {
      paddingVertical: 4,
    },
    loadingWrap: {
      paddingVertical: 24,
      alignItems: 'center',
    },
    emptyText: {
      color: colors.textFaint,
      fontSize: 13,
      textAlign: 'center',
      paddingVertical: 24,
    },
    threadRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      paddingHorizontal: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    threadInfo: {
      flex: 1,
    },
    threadName: {
      color: colors.text,
      fontSize: 14,
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
  });
