import React, { useEffect, useMemo, useState } from 'react';
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
import { getDb } from '../database/db';
import { useKeyboardInset } from '../hooks/useKeyboardHeight';
import { useTheme } from '../theme';
import {
  addThreadToCollection,
  removeThreadFromCollection,
} from '../services/collections';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Bottom-sheet for adding multiple existing threads to a single collection
// in one go. Companion to CollectionPickerSheet (which is "for one thread,
// pick many collections"); this one is "for one collection, pick many
// threads".
//
// Lists every thread that's eligible (i.e., not already a member) and
// also includes already-member threads at the bottom with the checkbox
// pre-checked, so the user can both add new and revoke recently-added
// memberships without leaving the sheet. Tap row → toggle membership
// instantly. Backdrop dismiss closes.
export default function ExistingThreadsPicker({
  visible,
  collection,
  onChange,
  onClose,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardInset();

  const [allThreads, setAllThreads] = useState([]);
  const [memberIds, setMemberIds] = useState(() => new Set());
  const [search, setSearch] = useState('');

  const refresh = async () => {
    if (!collection?.id) return;
    const db = getDb();
    if (!db) return;
    const threads = await db.getAllAsync(
      `SELECT id, name, description, kind FROM threads
        ORDER BY name COLLATE NOCASE ASC`
    );
    const links = await db.getAllAsync(
      `SELECT thread_id FROM thread_collection_links WHERE collection_id = ?`,
      [collection.id]
    );
    setAllThreads(threads);
    setMemberIds(new Set(links.map((l) => l.thread_id)));
  };

  useEffect(() => {
    if (!visible) return;
    setSearch('');
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, collection?.id]);

  const toggle = async (threadId) => {
    if (!collection?.id) return;
    if (memberIds.has(threadId)) {
      await removeThreadFromCollection(threadId, collection.id);
    } else {
      await addThreadToCollection(threadId, collection.id);
    }
    await refresh();
    onChange?.();
  };

  // Sort eligible threads (non-members) above members so the "add" surface
  // is what the user sees first. Within each group, alphabetical (already
  // sorted by SQL); search filters by name + description.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (t) => {
      if (!q) return true;
      const n = (t.name || '').toLowerCase();
      const d = (t.description || '').toLowerCase();
      return n.includes(q) || d.includes(q);
    };
    const eligible = [];
    const already = [];
    for (const t of allThreads) {
      if (!matches(t)) continue;
      if (memberIds.has(t.id)) already.push(t);
      else eligible.push(t);
    }
    return { eligible, already };
  }, [allThreads, memberIds, search]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={[styles.backdrop, keyboardInset > 0 && { paddingBottom: keyboardInset }]}
        onPress={onClose}
      >
        <Pressable
          style={[
            styles.sheet,
            keyboardInset === 0 && { paddingBottom: Math.max(16, insets.bottom + 8) },
          ]}
          onPress={() => {}}
        >
            <View style={styles.handle} />
            <Text style={styles.heading}>Add to collection</Text>
            <Text style={styles.subheading} numberOfLines={1}>
              {collection?.name || 'Collection'}
            </Text>

            <View style={styles.searchRow}>
              <Ionicons
                name="search"
                size={16}
                color={colors.textFaint}
                style={styles.searchIcon}
              />
              <TextInput
                style={styles.searchInput}
                placeholder="Search threads…"
                placeholderTextColor={colors.placeholder}
                value={search}
                onChangeText={setSearch}
                autoCorrect={false}
                autoCapitalize="none"
              />
              {search ? (
                <TouchableOpacity
                  onPress={() => setSearch('')}
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
              {filtered.eligible.length === 0 && filtered.already.length === 0 ? (
                <Text style={styles.emptyText}>
                  {search
                    ? 'No threads match.'
                    : 'No threads to add. Each thread is already in this collection.'}
                </Text>
              ) : null}

              {filtered.eligible.map((t) => (
                <ThreadRow
                  key={t.id}
                  thread={t}
                  active={false}
                  styles={styles}
                  colors={colors}
                  onPress={() => toggle(t.id)}
                />
              ))}

              {filtered.already.length > 0 ? (
                <Text style={styles.sectionHeader}>Already in collection</Text>
              ) : null}
              {filtered.already.map((t) => (
                <ThreadRow
                  key={t.id}
                  thread={t}
                  active={true}
                  styles={styles}
                  colors={colors}
                  onPress={() => toggle(t.id)}
                />
              ))}
            </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ThreadRow({ thread, active, styles, colors, onPress }) {
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Ionicons
        name={active ? 'checkbox' : 'square-outline'}
        size={20}
        color={active ? colors.primary : colors.textFaint}
      />
      <View style={styles.rowBody}>
        <Text
          style={[styles.rowTitle, active && styles.rowTitleActive]}
          numberOfLines={1}
        >
          {thread.name || 'Untitled'}
        </Text>
        {thread.description ? (
          <Text style={styles.rowDescription} numberOfLines={1}>
            {thread.description}
          </Text>
        ) : null}
      </View>
      {thread.kind === 'auto_day' ? (
        <Text style={styles.kindTag}>auto</Text>
      ) : null}
    </TouchableOpacity>
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
      maxHeight: '85%',
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
    },
    subheading: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
      paddingHorizontal: 20,
      paddingBottom: 8,
      marginTop: 2,
    },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: 20,
      marginBottom: 6,
      backgroundColor: colors.surfaceMuted,
      borderRadius: 10,
      paddingHorizontal: 10,
      borderWidth: 1,
      borderColor: colors.border,
    },
    searchIcon: { marginRight: 6 },
    searchInput: {
      flex: 1,
      paddingVertical: 8,
      color: colors.text,
      fontSize: 14,
    },
    searchClear: {
      padding: 4,
    },
    list: {
      paddingHorizontal: 20,
      paddingTop: 4,
      paddingBottom: 12,
    },
    emptyText: {
      color: colors.textFaint,
      fontSize: 13,
      fontStyle: 'italic',
      paddingVertical: 16,
      textAlign: 'center',
    },
    sectionHeader: {
      color: colors.textMuted,
      fontSize: 10,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: 16,
      marginBottom: 4,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    rowBody: {
      flex: 1,
    },
    rowTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '500',
    },
    rowTitleActive: {
      color: colors.primary,
      fontWeight: '600',
    },
    rowDescription: {
      color: colors.textFaint,
      fontSize: 12,
      marginTop: 2,
    },
    kindTag: {
      color: colors.textFaint,
      fontSize: 10,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginLeft: 4,
    },
  });
