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
import { useTheme } from '../theme';
import {
  loadCollections,
  loadThreadCollectionIdSet,
  addThreadToCollection,
  removeThreadFromCollection,
  createCollectionAndAssignThread,
} from '../services/collections';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardInset } from '../hooks/useKeyboardHeight';

// Multi-select bottom-sheet for assigning a thread to zero or more
// collections. Tap a row to toggle membership immediately: no Done button,
// the gesture *is* the commit. Backdrop dismiss closes the sheet.
//
// onChange() fires after every membership write so the parent can refresh
// its derived UI (chip strip count, collection metadata line, etc).
export default function CollectionPickerSheet({
  visible,
  thread,
  onChange,
  onClose,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardInset();

  const [collections, setCollections] = useState([]);
  const [memberIds, setMemberIds] = useState(() => new Set());
  const [creatingName, setCreatingName] = useState(null); // null = idle, '' = composing

  const isAuto = thread?.kind === 'auto_day';

  const refresh = async () => {
    const [all, mem] = await Promise.all([
      loadCollections(),
      loadThreadCollectionIdSet(thread?.id),
    ]);
    setCollections(all);
    setMemberIds(mem);
  };

  useEffect(() => {
    if (!visible) return;
    setCreatingName(null);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, thread?.id]);

  const toggle = async (collectionId) => {
    if (!thread?.id) return;
    if (memberIds.has(collectionId)) {
      await removeThreadFromCollection(thread.id, collectionId);
    } else {
      await addThreadToCollection(thread.id, collectionId);
    }
    await refresh();
    onChange?.();
  };

  const submitNew = async () => {
    const name = (creatingName || '').trim();
    if (!name) {
      setCreatingName(null);
      return;
    }
    await createCollectionAndAssignThread(name, thread?.id);
    setCreatingName(null);
    await refresh();
    onChange?.();
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
          <Text style={styles.heading}>Collections</Text>
          <Text style={styles.subheading} numberOfLines={1}>
            {thread?.name || 'Thread'}
          </Text>

          <ScrollView contentContainerStyle={styles.list}>
            {collections.length === 0 && creatingName === null ? (
              <Text style={styles.emptyText}>
                No collections yet. Create one below.
              </Text>
            ) : null}

            {collections.map((c) => {
              const active = memberIds.has(c.id);
              return (
                <TouchableOpacity
                  key={c.id}
                  style={styles.row}
                  onPress={() => toggle(c.id)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={active ? 'checkbox' : 'square-outline'}
                    size={20}
                    color={active ? colors.primary : colors.textFaint}
                  />
                  <Ionicons
                    name="folder-outline"
                    size={14}
                    color={active ? colors.primary : colors.textMuted}
                  />
                  <Text
                    style={[styles.rowLabel, active && styles.rowLabelActive]}
                    numberOfLines={1}
                  >
                    {c.name}
                  </Text>
                </TouchableOpacity>
              );
            })}

            {creatingName === null ? (
              <TouchableOpacity
                style={styles.row}
                onPress={() => setCreatingName('')}
                activeOpacity={0.7}
              >
                <Ionicons name="add" size={20} color={colors.primary} />
                <Text style={styles.rowLabelAccent}>New collection</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.newRow}>
                <TextInput
                  style={styles.newInput}
                  placeholder="Name"
                  placeholderTextColor={colors.placeholder}
                  value={creatingName}
                  onChangeText={setCreatingName}
                  autoFocus
                  onSubmitEditing={submitNew}
                  returnKeyType="done"
                  maxLength={80}
                />
                <TouchableOpacity
                  onPress={submitNew}
                  style={styles.newSubmit}
                  accessibilityLabel="Create collection"
                >
                  <Ionicons name="checkmark" size={20} color={colors.primary} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setCreatingName(null)}
                  style={styles.newCancel}
                  accessibilityLabel="Cancel new collection"
                >
                  <Ionicons name="close" size={20} color={colors.textFaint} />
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>

          {isAuto ? (
            <View style={styles.footnote}>
              <Ionicons
                name="information-circle-outline"
                size={14}
                color={colors.textFaint}
              />
              <Text style={styles.footnoteText}>
                Note: The app removes an auto-thread when you delete all its
                entries. If you write on this date again, the app makes a new
                auto-thread. The new auto-thread is not in these collections.
              </Text>
            </View>
          ) : null}
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
    },
    subheading: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
      paddingHorizontal: 20,
      paddingBottom: 8,
      marginTop: 2,
    },
    list: {
      paddingHorizontal: 20,
      paddingBottom: 8,
    },
    emptyText: {
      color: colors.textFaint,
      fontSize: 13,
      fontStyle: 'italic',
      paddingVertical: 12,
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
    newRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    newInput: {
      flex: 1,
      color: colors.text,
      fontSize: 15,
      paddingVertical: 6,
      paddingHorizontal: 10,
      backgroundColor: colors.surfaceMuted,
      borderRadius: 8,
    },
    newSubmit: {
      width: 32,
      height: 32,
      justifyContent: 'center',
      alignItems: 'center',
    },
    newCancel: {
      width: 32,
      height: 32,
      justifyContent: 'center',
      alignItems: 'center',
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
