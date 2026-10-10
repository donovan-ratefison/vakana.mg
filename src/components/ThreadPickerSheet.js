import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import ThreadCard, { loadThreadPreview } from './ThreadCard';
import { getDb } from '../database/db';
import { useTheme } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ThreadPickerSheet({
  visible,
  excludeThreadIds = [],
  onPick,
  onClose,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  const [threads, setThreads] = useState([]);
  const excludeSet = useMemo(
    () => new Set(excludeThreadIds.map((id) => Number(id))),
    [excludeThreadIds]
  );

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      const db = getDb();
      if (!db) return;
      const rows = await db.getAllAsync(
        "SELECT * FROM threads WHERE kind = 'user' ORDER BY updated_at DESC"
      );
      const enriched = await Promise.all(
        rows.map(async (t) => ({
          ...t,
          preview: await loadThreadPreview(db, t.id),
        }))
      );
      if (!cancelled) setThreads(enriched);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: insets.bottom }]}
          onPress={() => {}}
        >
          <View style={styles.handle} />
          <Text style={styles.heading}>Mention a thread</Text>
          {threads.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>No threads yet</Text>
              <Text style={styles.emptySubtext}>
                First, create a thread from the Threads tab.
              </Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.list}>
              {threads.map((t) => {
                const already = excludeSet.has(Number(t.id));
                return (
                  <ThreadCard
                    key={t.id}
                    thread={t}
                    dimmed={already}
                    disabled={already}
                    onPress={already ? undefined : () => onPick(t)}
                  />
                );
              })}
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
      backgroundColor: colors.background,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: '80%',
      borderWidth: 1,
      borderColor: colors.border,
      paddingTop: 8,
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
      marginBottom: 8,
    },
    list: {
      paddingHorizontal: 20,
      paddingBottom: 24,
    },
    emptyWrap: {
      paddingHorizontal: 20,
      paddingVertical: 32,
      alignItems: 'center',
    },
    emptyText: {
      color: colors.textMuted,
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 6,
    },
    emptySubtext: {
      color: colors.textFaint,
      fontSize: 13,
      textAlign: 'center',
    },
  });
